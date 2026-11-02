// Studio adapters of the Synth engines (nodes/engines.js): additive, FM, AM and ring,
// wavetable (with the hard-sync bank) and percussion, each a polyphonic voice host
// (adapters/voices.js). The adapter contract is the header of adapters/nodes.js; a note source
// adds noteOn(t, note, velocity), noteOff(t, note) and allOff(t), which studio/live-notes.js
// calls while the Synth is armed. Native Web Audio only, every node through acct.track /
// acct.source; no recurrence and no DelayNode (project.no-silent-feedback v1).

import { SAFE_NYQUIST_FACTOR } from '../../core/constants.js';
import { buildPeriodicWave, harmonicSeries } from '../../audio/additive.js';
import { createNoiseBuffer } from '../../audio/noise.js';
import { ADDITIVE_HARMONICS } from '../nodes/engines.js';
import { fmAlgorithm } from '../../synth/fm-algorithms.js';
import { MORPH_MAX, WAVETABLE_BANKS, morphCurve } from '../../synth/wavetables.js';
import {
  DECAY_TAU_PER_S, layerLevel, percLevelScale, percNote,
} from '../../synth/perc-recipes.js';
import { ringLaw } from './instrument.js';
import { createVoiceHost } from './voices.js';
import { did, inertHandle, linearOnly, setParam } from './common.js';

const limitHz = (ctx) => (SAFE_NYQUIST_FACTOR * ctx.sampleRate) / 2;
const hasConstant = (ctx) => typeof ctx.createConstantSource === 'function';

/** The handle every engine shares: the voice host's output, notes, live parameter updates. */
function engineHandle({ host, ctx, extra = {}, onUpdate = () => {}, sources = [] }) {
  return {
    inputs: { thru: host.thru, ...(extra.inputs || {}) },
    outputs: { audio: host.out },
    outputRange: {},
    modTarget: extra.modTarget || ((key) => ({ reason: `${key} is not modulatable` })),
    applyBase: extra.applyBase || (() => {}),
    update(changed, owned, w) {
      host.update(changed);
      onUpdate(changed);
      did(w, changed, Object.keys(changed), 'next-note');
    },
    noteOn: (t, note, velocity) => host.noteOn(t, note, velocity),
    noteOff: (t, note) => host.noteOff(t, note),
    allOff: (t, fast) => host.allOff(t, fast),
    stop(t) {
      host.stop(t);
      for (const s of sources) { try { s.stop(t); } catch (e) { /* stopped */ } }
    },
    dispose() { host.dispose(); },
    info: { notes: true, voices: (t) => host.voices(t), held: () => host.held(),
      sampleRate: ctx.sampleRate, ...(extra.info || {}) },
    status: 'ready',
    reason: null,
  };
}

// ------------------------------------------------------------------ additive (K091)

/** The engine's partials at these parameters: drawbars or a shape, with the tilt applied. */
export function additivePartials(p, count = ADDITIVE_HARMONICS) {
  const base = p.shape === 'custom'
    ? Array.from({ length: count }, (_, i) => ({ n: i + 1, gain: Number(p[`h${i + 1}`]) || 0,
      phase: 0 }))
    : harmonicSeries(p.shape, count);
  return base.map((x) => ({ ...x, gain: x.gain * 10 ** ((p.tilt * Math.log2(x.n)) / 20) }));
}

/** Harmonics of a note at `hz` that fit under 0.95 × Nyquist, and how many sounding ones do not. */
export function partialsBelow(partials, hz, sampleRate) {
  const max = (SAFE_NYQUIST_FACTOR * sampleRate) / 2;
  const kept = partials.filter((x) => x.n * hz <= max);
  return { kept, dropped: partials.filter((x) => x.n * hz > max && x.gain > 0).length };
}

export const additiveVoice = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params }) {
    let cache = new Map(); // number of harmonics kept -> PeriodicWave
    let last = { dropped: 0, hz: null };
    const waveFor = (p, kept) => {
      const key = kept.length;
      if (!cache.has(key)) cache.set(key, buildPeriodicWave(ctx, kept).wave);
      return cache.get(key);
    };
    const host = createVoiceHost({ ctx, acct, params, build(v) {
      const { kept, dropped } = partialsBelow(additivePartials(v.p), v.hz, ctx.sampleRate);
      last = { dropped, hz: v.hz };
      const wave = kept.some((x) => x.gain > 0) ? waveFor(v.p, kept) : null;
      if (!wave) return { dropped };
      const osc = v.source(hooks.oscillator('sine', v.hz, v.t));
      osc.setPeriodicWave(wave);
      osc.connect(v.into);
      return { dropped };
    } });
    return engineHandle({ host, ctx, onUpdate: () => { cache = new Map(); },
      extra: { info: { dropped: () => last } } });
  },
};

// ------------------------------------------------------------------ FM (K090)

/**
 * A modulator that is itself modulated (the middle of a stack) is a phase operator, computed
 * in the phase domain (review of #332, round 3): its inputs add I(t) · sin θ_j to its phase,
 * and its output is built from two fixed-frequency oscillators and two wave shapers,
 *
 *   sin θ_m = sin(ω_m t) · cos φ + cos(ω_m t) · sin φ,   φ = Σ_j I_j(t) · sin θ_j,
 *
 * the shapers cos(Φ x) and sin(Φ x) of x = φ / Φ (Φ: the sum of the inputs' peak indices).
 * Every operator starts at phase 0 and nothing is integrated, so every phase in the stack is a
 * sum of sines of the time and the modulator's output is a sum of lines sin(Ω t): the line at
 * Ω = 0 is sin 0, so it has no 0 Hz line at any ratio, index or moment, and the carrier it
 * drives keeps its pitch from the onset (an earlier high-pass at a tenth of the lowest operator
 * rang at bass notes, ±50-230 cents for 0.2-0.5 s). The phase modulation of index I has the
 * peak drive I · f_mod, so its sidebands have the levels |J_k(I)| of the linear FM it replaces.
 * The edges into a carrier stay linear FM, Δf = I · f_mod · sin θ_mod Hz: the non-stack
 * algorithms are those alone, unchanged.
 */
export const FM_PHASE_CURVE_POINTS = 4097; // odd: x = 0 is a curve point, cos 0 = 1, sin 0 = 0

/** The shaper curve fn(Φ x) for x in [-1, 1]. */
export function phaseCurve(fn, phi, n = FM_PHASE_CURVE_POINTS) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((phi * (2 * i - (n - 1))) / (n - 1));
  return c;
}

export const fmVoice = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params }) {
    let last = { dropped: 0 };
    let waves = null; // [sine, cosine] tables of the phase operators' fixed oscillators
    const quadrature = () => {
      if (!waves) {
        const mk = (re, im) => ctx.createPeriodicWave(new Float32Array(re), new Float32Array(im),
          { disableNormalization: true });
        waves = [mk([0, 0], [0, 1]), mk([0, 1], [0, 0])];
      }
      return waves;
    };
    const curves = new Map(); // Φ -> [cos, sin] curves, the last 16 indices played
    const curvesFor = (phi) => {
      if (!curves.has(phi)) {
        if (curves.size >= 16) curves.delete(curves.keys().next().value);
        curves.set(phi, [phaseCurve(Math.cos, phi), phaseCurve(Math.sin, phi)]);
      }
      return curves.get(phi);
    };
    const host = createVoiceHost({ ctx, acct, params, build(v) {
      const a = fmAlgorithm(v.p.algorithm);
      const max = limitHz(ctx);
      const freq = (k) => v.hz * v.p[`ratio${k}`];
      let dropped = 0;
      for (let k = 1; k <= a.ops; k++) if (freq(k) > max) dropped++;
      last = { dropped };
      // The operators that reach a kept carrier through kept operators: a modulator of a
      // dropped carrier would be a source that sounds nothing.
      const kept = (k) => freq(k) <= max;
      const needed = new Set(a.carriers.filter(kept));
      for (let pass = 0; pass < a.ops; pass++) {
        for (const [m, t] of a.edges) if (needed.has(t) && kept(m)) needed.add(m);
      }
      if (!needed.size) return { dropped };
      const modulators = new Set(a.edges.map(([m]) => m));
      const inputsOf = (k) => a.edges.filter(([m, t]) => t === k && needed.has(m)).map(([m]) => m);
      const phaseOp = (k) => needed.has(k) && modulators.has(k) && inputsOf(k).length > 0;
      const tau = Math.max(1e-3, v.p.modDecay / 3);
      const sus = v.p.modSustain;
      const index = (m) => v.p[`index${m}`];
      /** I(t) × scale: the index falls from I to I × Index sustain over Index decay. */
      const indexGain = (m, scale) => {
        const g = v.track(ctx.createGain());
        g.gain.setValueAtTime(index(m) * scale, v.t);
        g.gain.setTargetAtTime(index(m) * scale * sus, v.t, tau);
        return g;
      };
      const ops = new Map();
      for (let k = 1; k <= a.ops; k++) {
        if (!needed.has(k)) continue;
        const f = freq(k);
        if (!phaseOp(k)) {
          const osc = v.source(hooks.oscillator('sine', f, v.t));
          // Into a phase operator: the same sine table as its own oscillators, so a browser's
          // table and phase rounding is the same on both sides of the edge (Firefox's 'sine'
          // and a table differ by some 5e-3 at bass notes).
          const feedsPhase = a.edges.some(([m, t]) => m === k && phaseOp(t));
          if (feedsPhase) osc.setPeriodicWave(quadrature()[0]);
          ops.set(k, { f, osc, out: osc });
          continue;
        }
        // A phase operator: sin(ω t) · cos φ + cos(ω t) · sin φ.
        const [sinWave, cosWave] = quadrature();
        const sine = v.source(hooks.oscillator('sine', f, v.t));
        sine.setPeriodicWave(sinWave);
        const cosine = v.source(hooks.oscillator('sine', f, v.t));
        cosine.setPeriodicWave(cosWave);
        const phi = inputsOf(k).reduce((sum, m) => sum + index(m), 0) || 1;
        const x = v.track(ctx.createGain()); // φ / Φ
        const [cosCurve, sinCurve] = curvesFor(phi);
        const shaper = (curve) => {
          const sh = v.track(ctx.createWaveShaper());
          sh.curve = curve;
          sh.oversample = 'none';
          x.connect(sh);
          return sh;
        };
        const out = v.track(ctx.createGain());
        const times = (src, sh) => {
          const g = v.track(ctx.createGain());
          g.gain.setValueAtTime(0, v.t);
          sh.connect(g.gain);
          src.connect(g).connect(out);
        };
        times(sine, shaper(cosCurve));
        times(cosine, shaper(sinCurve));
        ops.set(k, { f, out, phase: x, phi });
      }
      for (const [m, target] of a.edges) {
        const op = ops.get(m);
        const to = ops.get(target);
        if (!op || !to) continue;
        if (to.phase) {
          // I(t) · sin θ_m into the target's phase (scaled by 1 / Φ for its shapers).
          op.out.connect(indexGain(m, 1 / to.phi)).connect(to.phase);
        } else {
          // Δf = I · f_mod: the modulator's unit sine times I · f_mod Hz.
          op.out.connect(indexGain(m, op.f)).connect(to.osc.frequency);
        }
      }
      for (const c of a.carriers) {
        const op = ops.get(c);
        if (!op) continue;
        const g = v.track(ctx.createGain());
        g.gain.setValueAtTime(v.p[`level${c}`] / a.carriers.length, v.t);
        op.osc.connect(g).connect(v.into);
      }
      return { dropped };
    } });
    return engineHandle({ host, ctx, extra: { info: { dropped: () => last } } });
  },
};

// ------------------------------------------------------------------ AM and ring (K121)

export const amVoice = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params }) {
    const host = createVoiceHost({ ctx, acct, params, build(v) {
      const law = ringLaw(v.p.mode, v.p.depth);
      const fm = v.hz * v.p.ratio;
      const noMod = fm > limitHz(ctx);
      if (noMod && !(law.base > 0)) return { dropped: 1 }; // ring with no modulator: silent
      const car = v.source(hooks.oscillator(v.p.carrier, v.hz, v.t));
      const vca = v.track(ctx.createGain());
      vca.gain.setValueAtTime(law.base, v.t);
      car.connect(vca).connect(v.into);
      if (noMod) return { dropped: 1 }; // AM with no modulator: the carrier alone
      const mod = v.source(hooks.oscillator(v.p.modulator, fm, v.t));
      const scale = v.track(ctx.createGain());
      scale.gain.setValueAtTime(law.scale, v.t);
      mod.connect(scale).connect(vca.gain);
      return { dropped: 0 };
    } });
    return engineHandle({ host, ctx });
  },
};

// ------------------------------------------------------------------ wavetable and sync (K092)

export const wavetableVoice = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, at, params }) {
    if (!hasConstant(ctx)) { // degraded: no voices, but the Chain input still passes
      const thru = acct.track(ctx.createGain());
      return { ...inertHandle('degraded', 'The wavetable engine needs ConstantSourceNode, which '
        + 'this browser lacks; its Chain input passes through.'),
      inputs: { thru }, outputs: { audio: thru } };
    }
    let bank = null;
    let waves = [];
    const wavesFor = (id) => {
      if (id !== bank) {
        bank = id;
        waves = (WAVETABLE_BANKS[id] || WAVETABLE_BANKS.basic).partials()
          .map((ps) => buildPeriodicWave(ctx, ps).wave);
      }
      return waves;
    };
    // Morph, node-wide: cv (morph, edges add to it) × 2/3 − 1 → four shapers per bank (its own
    // level-continuous law, synth/wavetables.js) → the voices.
    const cv = acct.source(acct.track(ctx.createConstantSource()));
    const bias = acct.source(acct.track(ctx.createConstantSource()));
    const x = acct.track(ctx.createGain());
    cv.offset.setValueAtTime(params.morph, ctx.currentTime);
    bias.offset.setValueAtTime(-1, ctx.currentTime);
    x.gain.value = 2 / MORPH_MAX;
    cv.connect(x);
    const sum = acct.track(ctx.createGain());
    x.connect(sum);
    bias.connect(sum);
    const shaperSets = new Map(); // bank -> four shapers
    const shapersFor = (id) => {
      const key = WAVETABLE_BANKS[id] ? id : 'basic';
      if (!shaperSets.has(key)) {
        shaperSets.set(key, [0, 1, 2, 3].map((i) => {
          const s = acct.track(ctx.createWaveShaper());
          s.curve = morphCurve(i, undefined, key);
          s.oversample = 'none';
          sum.connect(s);
          return s;
        }));
      }
      return shaperSets.get(key);
    };
    shapersFor(params.bank);
    cv.start(at);
    bias.start(at);
    const host = createVoiceHost({ ctx, acct, params, build(v) {
      const w = wavesFor(v.p.bank);
      const shapers = shapersFor(v.p.bank);
      const gains = [];
      w.forEach((wave, i) => {
        if (!wave) return;
        const osc = v.source(hooks.oscillator('sine', v.hz, v.t));
        osc.setPeriodicWave(wave);
        const g = v.track(ctx.createGain());
        g.gain.value = 0;
        shapers[i].connect(g.gain);
        gains.push([shapers[i], g]);
        osc.connect(g).connect(v.into);
      });
      return { cleanup() {
        for (const [s, g] of gains) {
          try { s.disconnect(g.gain); } catch (e) { /* already gone */ }
        }
      } };
    } });
    return engineHandle({ host, ctx, sources: [cv, bias], extra: {
      modTarget: (key, mapping) => (key === 'morph' ? linearOnly(cv.offset)(key, mapping)
        : { reason: `${key} is not modulatable` }),
      applyBase(b, immediate, owned, w) {
        if (!(owned && owned.has('morph'))) {
          setParam(cv.offset, b.morph.value, immediate, ctx.currentTime, w, 'morph');
        }
      },
    } });
  },
};

// ------------------------------------------------------------------ percussion (K123)

export const percVoice = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params }) {
    let noise = null;
    const noiseBuffer = () => {
      if (!noise) noise = createNoiseBuffer(ctx, { color: 'white', seconds: 1, seed: 7 });
      return noise;
    };
    const host = createVoiceHost({ ctx, acct, params, build(v) {
      const { voice, octaveSt } = percNote(v.note);
      const k = 2 ** ((v.p.tune + octaveSt) / 12);
      let end = v.t;
      const scale = percLevelScale(voice, v.p.tone); // the layers sum to at most 1
      for (const layer of voice.layers) {
        const decay = layer.decayS * v.p.decay;
        const level = layerLevel(voice, layer, v.p.tone) * scale;
        const env = v.track(ctx.createGain());
        const start = v.t + (layer.bursts ? layer.bursts[layer.bursts.length - 1][0] : 0);
        if (layer.bursts) {
          env.gain.setValueAtTime(0, ctx.currentTime);
          // Every burst but the last gates off; the decay starts at the last one's onset.
          layer.bursts.forEach(([on, len], i) => {
            env.gain.setValueAtTime(level, v.t + on);
            if (i < layer.bursts.length - 1) env.gain.setValueAtTime(0.0001, v.t + on + len);
          });
        }
        env.gain.setValueAtTime(level, start);
        env.gain.setTargetAtTime(0, start, decay * DECAY_TAU_PER_S);
        end = Math.max(end, start + decay);
        env.connect(v.into);
        if (layer.kind === 'tone') {
          const o = v.source(hooks.oscillator(layer.wave, layer.hz * k, v.t));
          if (layer.toHz) {
            o.frequency.setValueAtTime(Math.min(limitHz(ctx), layer.hz * k), v.t);
            o.frequency.exponentialRampToValueAtTime(Math.min(limitHz(ctx), layer.toHz * k),
              v.t + layer.sweepS);
          }
          o.connect(env);
        } else {
          const f = v.track(ctx.createBiquadFilter());
          f.type = layer.kind === 'metal' ? 'highpass' : layer.filter;
          f.frequency.value = Math.min(limitHz(ctx), (layer.kind === 'metal' ? layer.filterHz
            : layer.hz) * (layer.tracks || layer.kind === 'metal' ? k : 1));
          if (layer.q) f.Q.value = layer.q;
          f.connect(env);
          if (layer.kind === 'metal') {
            const sum = v.track(ctx.createGain());
            // The squares start in phase and their edges coincide: the sum is coherent, so
            // 1 / count bounds its peak (a power sum, 1 / √count, peaked at 1.4).
            sum.gain.value = 1 / layer.ratios.length;
            sum.connect(f);
            for (const r of layer.ratios) {
              const hz = layer.baseHz * r * k;
              if (hz > limitHz(ctx)) continue;
              const o = v.source(hooks.oscillator('square', hz, v.t));
              o.connect(sum);
            }
          } else {
            const src = v.source(ctx.createBufferSource());
            src.buffer = noiseBuffer();
            src.loop = true;
            src.connect(f);
            src.start(v.t);
          }
        }
      }
      return { oneShotEnd: end, group: voice.group || null,
        chokes: v.p.choke && voice.chokes ? voice.chokes : null };
    } });
    return engineHandle({ host, ctx });
  },
};
