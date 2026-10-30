// Review of #332, round 2 (K090-K092, K121-K123): what the engines must do, on the fake Web
// Audio context (the measured sound is tests/browser/synth-engines.cjs, its offline checks).
//   P1  the clap keeps its 0.28 s decay after the last burst; a modulator that is itself
//       modulated is a phase operator, no frequency drive and no high-pass (round 3: its 0 Hz
//       line would detune the note, the block rang at bass notes); 16 voices at the highest
//       Level and velocity sum to at most digital full scale
//       (ADR 0058's rule for note voices), and a steal starts after the stolen voice's fade
//   P2  the wavetable morph is level-continuous and never peaks above one table; the hat sum
//       is bounded by its coherent peak and a voice's layers by their sum; a note that sounds
//       nothing steals no voice; a held note retriggered re-attacks from the level it holds;
//       every FM algorithm connects what its table says; every percussion key and the choke
//       group are what the face says
//   P3  all-off cuts ringing one-shots; the DC of coinciding lines is stated (a high-pass would
//       break the peak bound); an engine preset sets
//       its own engine; the offline plan says why an engine plays no notes; a degraded
//       wavetable still passes its Chain input; the steal order is released-first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FM_ALGORITHMS } from '../../src/js/synth/fm-algorithms.js';
import {
  HAT_RATIOS, PERC_KEYMAP, PERC_VOICES, layerLevel, percLevelScale,
} from '../../src/js/synth/perc-recipes.js';
import {
  MORPH_HEADROOM, WAVETABLE_BANKS, WAVETABLE_BANK_IDS, morphPeak, morphWeight,
} from '../../src/js/synth/wavetables.js';
import { synthesizePeriod, waveformPeak } from '../../src/js/audio/additive.js';
import { MAX_VOICES, createVoicePool } from '../../src/js/synth/voice-pool.js';
import {
  CHOKE_RELEASE_S, STEAL_RELEASE_S, voicePeak,
} from '../../src/js/studio/adapters/voices.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { OFFLINE_TEXT, planOfflineRender } from '../../src/js/studio/offline.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { presetAction } from '../../src/js/synth/presets.js';
import { defaults, engineEnv } from './engine-fixture.mjs';
import { panelStore } from './synth-fixture.mjs';
import { StudioFakeContext } from './sequencer-fake-audio.mjs';
import fs from 'node:fs';

const ENGINE_TYPES = ['additive-voice', 'fm-voice', 'am-voice', 'wavetable-voice', 'perc-voice'];

/** A param's value at t from its recorded set / setTarget events (Web Audio's rules). */
function valueAt(param, t, initial = 1) {
  const ev = param.calls.map((c, i) => ({ c, i })).filter(({ c }) => c[0] === 'setValueAtTime'
    || c[0] === 'setTargetAtTime').map(({ c, i }) => ({ kind: c[0], v: c[1], t: c[2],
    tau: c[3], i })).sort((a, b) => a.t - b.t || a.i - b.i);
  let value = initial;
  let target = null;
  for (const e of ev) {
    if (e.t > t) break;
    if (target) value = target.v + (value - target.v) * Math.exp(-(e.t - target.t) / target.tau);
    if (e.kind === 'setValueAtTime') { value = e.v; target = null; } else target = e;
  }
  if (target) value = target.v + (value - target.v) * Math.exp(-(t - target.t) / target.tau);
  return value;
}

// ------------------------------------------------------------------ P1 clap

test('P1 the clap decays from its last burst: -30 dB at half its decay, not -80 dB', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.1, 61, 127); // C#: clap
  const layer = PERC_VOICES.clap.layers[0];
  const last = layer.bursts[layer.bursts.length - 1][0];
  const env = ctx.of('gain').find((g) => g.gain.calls.some((c) => c[0] === 'setTargetAtTime'));
  const level = layerLevel(PERC_VOICES.clap, layer, 0.5);
  const rel = (dt) => 20 * Math.log10(valueAt(env.gain, 0.1 + last + dt) / level);
  assert.ok(Math.abs(rel(layer.decayS / 2) + 30) < 0.5, `half the decay: ${rel(0.14)} dB`);
  assert.ok(Math.abs(rel(layer.decayS * 0.9) + 54) < 0.5, `0.9 decay: ${rel(0.252)} dB`);
  // every burst before the last one still gates off
  const [on0, len0] = layer.bursts[0];
  assert.ok(valueAt(env.gain, 0.1 + on0 + len0 + 0.001) < 1e-3);
});

// ------------------------------------------------------------------ P1 FM pitch

/** The nodes a node's output reaches through gains and filters, up to `depth`. */
const outputsOf = (n) => n.outputs || [];

/**
 * The operators of a built FM voice: op k -> { oscs, input } by frequency (ratios distinct).
 * A plain operator's input is its oscillator's frequency; a phase operator (two oscillators,
 * sine and cosine tables) takes its input at the shapers that drive its two products.
 */
function fmOperators(ctx, a, hz, ratios) {
  const ops = new Map();
  for (let k = 1; k <= a.ops; k++) {
    const oscs = ctx.oscillators.filter((o) => Math.abs(o.frequency.calls[0][1]
      - hz * ratios[`ratio${k}`]) < 1e-9);
    const products = oscs.flatMap(outputsOf).filter((g) => g.kind === 'gain');
    const shapers = ctx.of('waveshaper').filter((sh) => products.some((g) => sh.outputs
      .includes(g.gain)));
    ops.set(k, { oscs, shapers, products, input: shapers.length ? shapers
      : [oscs[0].frequency] });
  }
  return ops;
}
/** Whether `from` reaches one of `to`, through gains (never through an oscillator or shaper). */
const reaches = (from, to, depth = 6) => outputsOf(from).some((x) => to.includes(x)
  || (depth > 0 && x.kind !== 'oscillator' && x.kind !== 'waveshaper'
    && reaches(x, to, depth - 1)));

test('P1 a modulator that is itself modulated is a phase operator: no drive, no high-pass', () => {
  const ratios = { ratio1: 1, ratio2: 2, ratio3: 3, ratio4: 4 };
  for (const a of FM_ALGORITHMS) {
    const { ctx, h } = engineEnv('fm-voice', { algorithm: a.id, ...ratios });
    h.noteOn(0.1, 57, 127);
    const mods = new Set(a.edges.map(([m]) => m));
    const ops = fmOperators(ctx, a, 220, ratios);
    assert.ok(!ctx.created.some((n) => n.kind === 'biquad'), `${a.id}: nothing high-passes`);
    for (const [k, op] of ops) {
      const phase = mods.has(k) && a.edges.some(([, t]) => t === k);
      assert.equal(op.oscs.length, phase ? 2 : 1, `${a.id}: op ${k}`);
      if (!phase) continue;
      // sin(ω t) and cos(ω t) at the operator's fixed frequency, never driven.
      assert.deepEqual(op.oscs.map((o) => [...o.wave.imag, ...o.wave.real]),
        [[0, 1, 0, 0], [0, 0, 0, 1]], `${a.id}: op ${k} sine and cosine tables`);
      assert.ok(!ctx.created.some((n) => op.oscs.some((o) => outputsOf(n).includes(o.frequency))),
        `${a.id}: op ${k} has no frequency drive`);
      // the shapers cos(Φ x) and sin(Φ x), Φ the sum of the inputs' indices, x = 0 a point
      const phi = a.edges.filter(([, t]) => t === k).reduce((s, [m]) => s + (m === 2 ? 2 : 1), 0);
      const [cos, sin] = op.shapers.map((sh) => sh.curve);
      const n = cos.length;
      assert.equal(n % 2, 1, `${a.id}: an odd curve length`);
      assert.equal(cos[(n - 1) / 2], 1);
      assert.equal(sin[(n - 1) / 2], 0);
      assert.ok(Math.abs(cos[n - 1] - Math.cos(phi)) < 1e-6 && Math.abs(sin[0] + Math.sin(phi))
        < 1e-6, `${a.id}: op ${k} curves at Φ = ${phi}`);
    }
    for (const [m, t] of a.edges) {
      assert.ok(ops.get(m).oscs.some((o) => reaches(o, ops.get(t).input)), `${a.id}: ${m} -> ${t}`);
    }
  }
});

// ------------------------------------------------------------------ P1 voice sum

test('P1 16 voices at the highest Level and velocity sum to at most full scale', () => {
  for (const type of ENGINE_TYPES) {
    const max = NODE_REGISTRY.param(type, 'level').max;
    assert.ok(MAX_VOICES * voicePeak(max, 127) <= 1 + 1e-12, `${type}: Level ${max}`);
    const def = NODE_REGISTRY.param(type, 'level').default;
    assert.ok(MAX_VOICES * voicePeak(def, 127) <= 1 + 1e-12, `${type}: the default Level`);
  }
  // ADR 0058's rule, the instrument's note voices: each note at level / NOTE_POLYPHONY.
  const text = NODE_REGISTRY.get('fm-voice').help.constraints;
  assert.match(text, /16 voices together peak at most at digital full scale/);
  assert.doesNotMatch(text, /output ceiling limits them/);
});

test('P1 a stolen voice fades before the new note starts (the sum never holds 17 voices)', () => {
  const { ctx, h } = engineEnv('additive-voice');
  for (let i = 0; i < 16; i++) h.noteOn(0.1, 48 + i, 127);
  const before = ctx.oscillators.length;
  const r = h.noteOn(0.2, 90, 127);
  assert.equal(r.stolen, true);
  const osc = ctx.oscillators[before];
  assert.ok(Math.abs(osc.startAt - (0.2 + STEAL_RELEASE_S)) < 1e-9,
    `the new voice starts at ${osc.startAt}, after the ${STEAL_RELEASE_S} s fade`);
});

// ------------------------------------------------------------------ P2 wavetable morph

test('P2 the morph is level-continuous within ±0.5 dB and never peaks above one table', () => {
  const N = 4096;
  for (const id of WAVETABLE_BANK_IDS) {
    const tabs = WAVETABLE_BANKS[id].partials().map((ps) => synthesizePeriod(ps, N,
      1 / waveformPeak(ps)));
    const mix = (m) => {
      const y = new Float64Array(N);
      tabs.forEach((x, i) => {
        const w = morphWeight(i, m, id);
        if (w) for (let k = 0; k < N; k++) y[k] += w * x[k];
      });
      let s = 0;
      let p = 0;
      for (const v of y) { s += v * v; p = Math.max(p, Math.abs(v)); }
      return { db: 10 * Math.log10(s / N), peak: p };
    };
    for (let m = 0; m <= 3 + 1e-9; m += 0.125) {
      const i = Math.min(2, Math.floor(m));
      const x = m - i;
      const a = mix(i).db;
      const b = mix(i + 1).db;
      const got = mix(m);
      assert.ok(Math.abs(got.db - (a + (b - a) * x)) <= 0.5,
        `${id} morph ${m}: ${got.db.toFixed(2)} dB, between ${a.toFixed(2)} and ${b.toFixed(2)}`);
      assert.ok(got.peak <= 1 + 1e-3, `${id} morph ${m}: peak ${got.peak.toFixed(3)}`);
    }
  }
  assert.doesNotMatch(NODE_REGISTRY.get('wavetable-voice').help.constraints, /equal power/);
});

test('P2 each bank\'s headroom is at or below 1 / its morph peak, within 1 %', () => {
  for (const id of WAVETABLE_BANK_IDS) {
    const h = 1 / morphPeak(id);
    assert.ok(MORPH_HEADROOM[id] <= h && MORPH_HEADROOM[id] >= 0.99 * h,
      `${id}: ${MORPH_HEADROOM[id]} against 1 / peak ${h.toFixed(5)}`);
  }
});

// ------------------------------------------------------------------ P2 peaks of a voice

test('P2 the hat sum is bounded by its coherent peak; a voice\'s layers by their sum', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.1, 66, 127); // closed hat
  const sum = ctx.of('gain').find((g) => ctx.oscillators.filter((o) => o.type === 'square')
    .every((o) => o.outputs.includes(g)));
  assert.ok(sum, 'the six squares sum into one gain');
  assert.ok(Math.abs(sum.gain.value - 1 / HAT_RATIOS.length) < 1e-12);
  for (const v of Object.values(PERC_VOICES)) {
    for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
      const total = v.layers.reduce((s, l) => s + layerLevel(v, l, tone), 0)
        * percLevelScale(v, tone);
      assert.ok(total <= 1 + 1e-12, `${v.id} at tone ${tone}: layers sum to ${total}`);
    }
  }
});

// ------------------------------------------------------------------ P2 sourceless steal

test('P2 a note that sounds nothing steals no voice from a full pool', () => {
  const { h } = engineEnv('fm-voice', { algorithm: '2-op', ratio1: 1, ratio2: 1 },
    { sampleRate: 44100 });
  for (let i = 0; i < 16; i++) h.noteOn(0.1, 48 + i, 100);
  h.update({ ratio1: 16, ratio2: 16 });
  const r = h.noteOn(0.2, 100, 100);
  assert.equal(r.stolen, false);
  assert.equal(r.dropped, 2);
  assert.equal(h.info.voices(0.25), 16);
  assert.ok(h.info.held().includes(48));
  assert.equal(h.noteOff(0.4, 48), true);
});

test('P2 a silent note holds no voice: an FM carrier above the limit, a ring with no modulator',
  () => {
    const fm = engineEnv('fm-voice', { algorithm: '2-op', ratio1: 16, ratio2: 1 },
      { sampleRate: 44100 });
    assert.equal(fm.h.noteOn(0.1, 96, 127).dropped, 1);
    assert.equal(fm.h.info.voices(0.2), 0);
    assert.equal(fm.ctx.oscillators.length, 0, 'no modulator is built for a dropped carrier');
    const am = engineEnv('am-voice', { mode: 'ring', ratio: 16 }, { sampleRate: 44100 });
    assert.equal(am.h.noteOn(0.1, 100, 127).dropped, 1);
    assert.equal(am.h.info.voices(0.2), 0);
    const amOn = engineEnv('am-voice', { mode: 'am', ratio: 16 }, { sampleRate: 44100 });
    amOn.h.noteOn(0.1, 100, 127);
    assert.equal(amOn.h.info.voices(0.2), 1, 'AM still sounds its carrier');
  });

// ------------------------------------------------------------------ P2 retrigger

test('P2 a held note retriggered re-attacks its own voice from the level it holds', () => {
  const { ctx, h } = engineEnv('wavetable-voice', { attack: 0.6, sustain: 1 });
  h.noteOn(0.1, 60, 100);
  const oscs = ctx.oscillators.length;
  const amp = ctx.of('gain').find((g) => g.outputs.includes(h.outputs.audio));
  const r = h.noteOn(1.5, 60, 100);
  assert.equal(r.retrigger, true);
  assert.equal(ctx.oscillators.length, oscs, 'no new voice is built');
  assert.ok(!amp.gain.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && c[1] < 1e-3
    && c[2] < 1.6), 'the voice is not released to the floor');
  assert.ok(amp.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime' && c[1] === 1.5),
    'it holds the value it has and attacks from there');
  assert.equal(h.info.voices(1.6), 1);
  assert.equal(h.noteOff(2, 60), true);
});

// ------------------------------------------------------------------ P2 FM routing, 7 algorithms

test('P2 every FM algorithm (all 7) connects its table: edges, carriers, ratios, levels', () => {
  assert.equal(FM_ALGORITHMS.length, 7);
  const ratios = { ratio1: 1, ratio2: 2.5, ratio3: 3.25, ratio4: 4.75 };
  const levels = { level1: 0.9, level2: 0.8, level3: 0.7, level4: 0.6 };
  for (const a of FM_ALGORITHMS) {
    const { ctx, h } = engineEnv('fm-voice', { algorithm: a.id, ...ratios, ...levels });
    h.noteOn(0.1, 57, 127);
    const mods = new Set(a.edges.map(([m]) => m));
    const phaseOps = [...mods].filter((k) => a.edges.some(([, t]) => t === k)).length;
    assert.equal(ctx.oscillators.length, a.ops + phaseOps, `${a.id}: ${a.ops} operators`);
    const ops = fmOperators(ctx, a, 220, ratios);
    for (const [k, op] of ops) assert.ok(op.oscs.length >= 1, `${a.id}: op ${k} ratio`);
    for (let m = 1; m <= a.ops; m++) {
      for (let t = 1; t <= a.ops; t++) {
        if (m === t) continue;
        const want = a.edges.some(([x, y]) => x === m && y === t);
        assert.equal(ops.get(m).oscs.some((o) => reaches(o, ops.get(t).input)), want,
          `${a.id}: ${m} -> ${t}`);
      }
    }
    const shaped = (g) => ctx.of('waveshaper').some((sh) => sh.outputs.includes(g.gain));
    for (let k = 1; k <= a.ops; k++) {
      const g = outputsOf(ops.get(k).oscs[0]).find((x) => x.kind === 'gain' && !shaped(x)
        && x.gain.calls[0] && x.gain.calls[0][0] === 'setValueAtTime'
        && !x.gain.calls.some((c) => c[0] === 'setTargetAtTime'));
      if (a.carriers.includes(k)) {
        assert.ok(g, `${a.id}: op ${k} is a carrier`);
        assert.ok(Math.abs(g.gain.calls[0][1] - levels[`level${k}`] / a.carriers.length) < 1e-12,
          `${a.id}: carrier ${k} at level / ${a.carriers.length}`);
      } else {
        assert.ok(!g, `${a.id}: op ${k} is not a carrier`);
      }
    }
  }
  const text = [NODE_REGISTRY.get('fm-voice').help.what, fs.readFileSync(
    new URL('../../docs/synth.md', import.meta.url), 'utf8')].join(' ');
  assert.doesNotMatch(text, /\b(six|6) algorithms\b/i);
});

// ------------------------------------------------------------------ P2 percussion keys, choke

test('P2 every percussion key plays what the face says, and the facts are the keymap', () => {
  assert.deepEqual([...PERC_KEYMAP], ['kick', 'clap', 'snare', 'clap', 'tomLow', 'tomMid',
    'hatClosed', 'tomHigh', 'hatClosed', 'noise', 'hatOpen', 'noise']);
  const facts = NODE_REGISTRY.get('perc-voice').facts(defaults('perc-voice'));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const keys = /Keys: (.*?);/.exec(facts)[1];
  for (const [i, id] of PERC_KEYMAP.entries()) {
    const label = PERC_VOICES[id].keyLabel;
    const part = keys.split(', ').find((p) => p.endsWith(` ${label}`));
    assert.ok(part && part.replace(` ${label}`, '').split(/ and | /).includes(names[i]),
      `${names[i]} plays ${label}: "${keys}"`);
  }
});

test('P2 a closed hat chokes the open hat only: a ringing kick and snare play on', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.1, 60, 100); // kick
  h.noteOn(0.1, 62, 100); // snare
  h.noteOn(0.1, 70, 100); // open hat
  const amps = ctx.of('gain').filter((g) => g.outputs.includes(h.outputs.audio));
  assert.equal(amps.length, 3);
  h.noteOn(0.15, 66, 100); // closed hat
  const cut = amps.map((a) => a.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime'
    && c[1] === 0.15));
  assert.deepEqual(cut, [false, false, true]);
  const end = amps[2].gain.calls.at(-1);
  assert.ok(end[2] - 0.15 <= CHOKE_RELEASE_S + 1e-9);
});

// ------------------------------------------------------------------ P3

test('P3 all-off cuts a ringing one-shot, and counts it', () => {
  const { ctx, h } = engineEnv('perc-voice', { decay: 4 });
  h.noteOn(0.1, 70, 100); // open hat, 2 s
  const amp = ctx.of('gain').find((g) => g.outputs.includes(h.outputs.audio));
  assert.equal(h.allOff(0.3, true), 1);
  const end = amp.gain.calls.at(-1);
  assert.equal(end[0], 'exponentialRampToValueAtTime');
  assert.ok(end[2] <= 0.3 + STEAL_RELEASE_S + 1e-9);
  assert.equal(h.info.voices(0.4), 0);
});

test('P3 the AM and FM faces state the DC of coinciding lines; nothing high-passes a voice',
  () => {
    assert.match(NODE_REGISTRY.get('am-voice').help.constraints, /sines at ratio 1 put half the/);
    assert.match(NODE_REGISTRY.get('fm-voice').help.constraints, /0 Hz line of its own: a DC/);
    for (const type of ENGINE_TYPES) {
      const { ctx, h } = engineEnv(type);
      h.noteOn(0.1, 57, 127);
      const amp = ctx.of('gain').find((g) => g.outputs.includes(h.outputs.audio));
      assert.ok(!ctx.created.some((n) => n.kind === 'biquad' && n.outputs.includes(amp)), type);
      assert.equal(h.inputs.thru, h.outputs.audio, `${type}: the chain passes unchanged`);
    }
  });

test('P3 an engine preset sets its own engine and leaves the other engines', () => {
  const st = panelStore();
  const res = PANEL.resolve(st.getModel());
  const set = (mid, key, value) => st.dispatch({ type: 'NODE_PARAM_SET', nodeId: res.get(mid).id,
    key, value });
  set('additive', 'h1', 0.1);
  set('perc', 'tune', 7);
  set('am', 'ratio', 2.7);
  assert.equal(st.dispatch(presetAction(st.getModel(), PANEL, 'fm-bell').action).ok, true);
  const node = (mid) => st.getModel().graph.nodes.find((n) => n.id === res.get(mid).id);
  assert.equal(node('additive').params.h1, 0.1);
  assert.equal(node('perc').params.tune, 7);
  assert.equal(node('am').params.ratio, 2.7);
  assert.equal(node('fm').params.ratio2, 3.5);
});

test('P3 the offline plan says an engine plays no notes and passes its Chain input', () => {
  const plan = planOfflineRender(panelStore().getModel(), { duration: 2 });
  const engines = plan.nodes.filter((n) => ENGINE_TYPES.includes(n.type));
  assert.ok(engines.length >= 5);
  for (const n of engines) {
    assert.equal(n.reason, OFFLINE_TEXT.notes, n.type);
    assert.notEqual(n.reason, OFFLINE_TEXT.analysis);
  }
  assert.match(OFFLINE_TEXT.notes, /Chain input/);
});

test('P3 a wavetable without ConstantSourceNode still passes its Chain input', () => {
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  ctx.createConstantSource = undefined;
  const acct = { track: (n) => n, source: (n) => n, untrack() {} };
  const h = NODE_ADAPTERS['wavetable-voice'].create({ ctx, hooks: {}, acct, at: 0, now: 0,
    params: defaults('wavetable-voice') });
  assert.equal(h.status, 'degraded');
  assert.ok(h.inputs.thru && h.inputs.thru === h.outputs.audio, 'the chain is not broken');
});

test('P3 the released voice that released first is stolen first', () => {
  const pool = createVoicePool({ max: 3 });
  pool.on(60, 0);
  pool.on(61, 1);
  pool.on(62, 2);
  pool.off(61, 3); // released first
  pool.off(60, 4);
  assert.equal(pool.on(70, 5).steal, 1);
});
