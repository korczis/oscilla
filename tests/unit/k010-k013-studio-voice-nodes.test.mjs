// K010-K013 (intent playable-instrument, milestone M058 Synth voice): the Studio voice nodes
// that leave every existing studioHash alone (a new node type, a new enum option or a wider
// range never changes a saved document; fact 3-4 of the instrument plan).
//   K010  LFO rate at audio rate: up to FREQUENCY_MAX_HZ in the model, clamped to 0.95 x
//         Nyquist of the running context through hooks.clampFrequency, and reported
//   K011  Filter types low-shelf, high-shelf and all-pass; brown noise
//   K012  Drive: a tanh WaveShaper (4x oversampling) between a drive gain and a trim <= 1,
//         then a clip (WaveShaper, no oversampling) that holds the output at DRIVE_CLIP
//   K013  Macro: one ConstantSourceNode 0..1, automatable, with a CONTROL output
// On the real AudioEngine with the recording fake context of sequencer-fake-audio.mjs, at
// 44.1 and 48 kHz. Real rendering (FM sidebands, shelf and all-pass responses, the Drive peak)
// is tests/browser/v31-studio-offline.cjs.
//   node --test tests/unit/k010-k013-studio-voice-nodes.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import {
  FILTER_TYPES, createFilterStage, nodeQ, normalizeFilter, usesGain, usesQ,
} from '../../src/js/audio/filters.js';
import { createNoiseBuffer, noiseSamples } from '../../src/js/audio/noise.js';
import {
  DRIVE_CLIP, DRIVE_CLIP_CURVE_SIZE, DRIVE_CURVE_SIZE, DRIVE_HEADROOM, DRIVE_MAX_DB, DRIVE_SPAN,
  clipCurve, createDriveStage, driveCurve, driveGain,
} from '../../src/js/audio/drive.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import {
  automationScale, editPointAction, nudgePointAction, pointAtLaneCoordinates,
} from '../../src/js/studio/automation.js';
import {
  CLIP_TARGET_TEXT, clipTarget, gainIsUsed, qIsUsed,
} from '../../src/js/studio/clip-targets.js';
import { FREQUENCY_MAX_HZ } from '../../src/js/studio/nodes/common.js';
import { canConnect } from '../../src/js/studio/ports.js';
import { NODE_REGISTRY as R, searchNodeTypes } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { edgeEffectReason } from '../../src/js/ui/studio/graph-view.js';
import {
  SLIDER_STEPS, parseParamInput, sliderRange, sliderToValue, valueToSlider,
} from '../../src/js/ui/studio/inspector.js';
import { StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const RATES = [44100, 48000];
const safeMax = (sr) => (sr / 2) * 0.95;

// ---------------------------------------------------------------- fixtures

function newStore() {
  return createStudioStore(null, { idGenerator: createIdGenerator(null) });
}

function builder(store) {
  const ok = (r) => {
    assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
    return r;
  };
  return {
    add: (nodeType, params) => {
      const id = ok(store.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }))
        .created.nodes[0];
      for (const [key, value] of Object.entries(params || {})) {
        ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, key, value }));
      }
      return id;
    },
    connect: (a, ap, b, bp, props) => ok(store.dispatch({ type: 'EDGE_ADD',
      from: { node: a, port: ap }, to: { node: b, port: bp }, props })).created.edges[0],
    ok,
  };
}

function setup(sampleRate = 48000) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  return { ...fx, engine, runtime, ctx: fx.ctx };
}

/** The last value written to a FakeParam (set or target). */
const lastValue = (p) => p.events[p.events.length - 1].value;

/** Start, play, stop: the engine's node census after the stop has finished. */
async function censusAfterStop(s, model) {
  assert.equal(s.runtime.apply(model).ok, true);
  assert.equal(s.runtime.start().ok, true);
  s.advance(0.3);
  const playing = s.engine.activeNodeCount;
  const done = s.runtime.stop();
  s.advance(0.3);
  return { playing, after: await done };
}

// ---------------------------------------------------------------- K010 LFO at audio rate

test('K010 the LFO rate reaches audio rate in the model; Random and Step stay at 100 Hz', () => {
  const p = R.param('lfo', 'rate');
  assert.equal(p.max, FREQUENCY_MAX_HZ);
  assert.equal(p.min, 0.01);
  assert.equal(p.unit, 'Hz');
  assert.equal(p.scale, 'log');
  assert.equal(p.default, 5, 'the default is unchanged, so no saved hash moves');
  assert.equal(R.param('random', 'rate').max, 100);
  assert.equal(R.param('step-modulator', 'rate').max, 100);
  assert.match(R.get('lfo').help.constraints, /0\.95 × the digital Nyquist limit/);
  // The Inspector slider keeps the four decades of slow rates; an audio rate is typed.
  assert.deepEqual(sliderRange(p), { lo: 0.01, hi: 100, log: true });
  assert.equal(sliderToValue(p, SLIDER_STEPS), 100);
  assert.deepEqual(parseParamInput(p, '2000 Hz'), { ok: true, value: 2000 });
  assert.equal(valueToSlider(p, 2000), SLIDER_STEPS, 'a typed audio rate pins the slider end');
  assert.match(R.get('lfo').help.what, /slider spans 0\.01-100 Hz; an audio rate is typed/);
});

test('K010 an LFO at 440 Hz into the oscillator frequency (log) validates and plays at 440 Hz',
  () => {
    for (const sr of RATES) {
      const store = newStore();
      const b = builder(store);
      const osc = b.add('oscillator', { frequency: 1000 });
      const master = b.add('master');
      const lfo = b.add('lfo', { rate: 440 });
      b.connect(osc, 'audio', master, 'audio');
      const e = b.connect(lfo, 'control', osc, 'frequency', { mapping: 'log', depth: 1 });
      assert.equal(validateStudioModel(store.getModel()).ok, true);
      const s = setup(sr);
      assert.equal(s.runtime.apply(store.getModel()).ok, true);
      assert.equal(s.runtime.start().ok, true);
      const mod = s.runtime.nodes.get(lfo).info.oscillator;
      assert.equal(lastValue(mod.frequency), 440, `${sr}: the modulator runs at 440 Hz`);
      const carrier = s.runtime.nodes.get(osc).info.oscillator;
      assert.ok(s.runtime.edges.get(e).gain.outputs.includes(carrier.detune),
        'a log edge drives the carrier detune (cents)');
      assert.deepEqual(s.runtime.debugInfo().limitedParams, []);
      s.runtime.stop();
    }
  });

test('K010 a rate above 0.95 x Nyquist is clamped there and reported, never silent', () => {
  for (const sr of RATES) {
    const store = newStore();
    const b = builder(store);
    const osc = b.add('oscillator');
    const master = b.add('master');
    const lfo = b.add('lfo', { rate: 30000 });
    b.connect(osc, 'audio', master, 'audio');
    b.connect(lfo, 'control', osc, 'level', { depth: 0.5 });
    const s = setup(sr);
    assert.equal(s.runtime.apply(store.getModel()).ok, true);
    assert.equal(s.runtime.start().ok, true);
    const mod = s.runtime.nodes.get(lfo).info.oscillator;
    assert.ok(Math.abs(lastValue(mod.frequency) - safeMax(sr)) < 1e-6,
      `${sr}: ${lastValue(mod.frequency)} vs ${safeMax(sr)}`);
    assert.deepEqual(s.runtime.debugInfo().limitedParams, [{ node: lfo, param: 'rate' }]);
    s.runtime.stop();
  }
});

// ---------------------------------------------------------------- K011 filter types, brown noise

test('K011 low-shelf, high-shelf and all-pass are Filter types the stage keeps', () => {
  for (const t of ['lowshelf', 'highshelf', 'allpass']) {
    assert.ok(FILTER_TYPES.includes(t), t);
    assert.equal(normalizeFilter({ type: t }, 48000).type, t);
  }
  const opts = R.param('filter', 'type').options.map((o) => [...o]);
  assert.deepEqual(opts.slice(-3), [['lowshelf', 'Low-shelf'], ['highshelf', 'High-shelf'],
    ['allpass', 'All-pass']]);
  assert.equal(R.defaults('filter').type, 'lowpass', 'the default is unchanged');
  // Web Audio: the shelves use gain and ignore Q; all-pass uses a linear Q and ignores gain.
  for (const t of ['lowshelf', 'highshelf']) {
    assert.equal(usesGain(t), true);
    assert.equal(usesQ(t), false);
    assert.equal(gainIsUsed(t), true);
    assert.equal(qIsUsed(t), false);
  }
  assert.equal(gainIsUsed('allpass'), false);
  assert.equal(qIsUsed('allpass'), true);
  assert.equal(nodeQ('allpass', 2), 2, 'all-pass Q is linear on the node');
  assert.equal(R.summarize({ type: 'filter', params: { type: 'lowshelf', frequency: 200, Q: 0.7,
    gain: 6, enabled: true } }), 'Low-shelf · 200 Hz · +6 dB');
  assert.equal(R.summarize({ type: 'filter', params: { type: 'allpass', frequency: 1000, Q: 2,
    gain: 0, enabled: true } }), 'All-pass · 1.00 kHz · Q 2');
});

test('K011 a shelf takes gain modulation and refuses Q with the one reason everywhere', () => {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const f = b.add('filter', { type: 'lowshelf', gain: 6 });
  const master = b.add('master');
  const lfo = b.add('lfo');
  b.connect(osc, 'audio', f, 'audio');
  b.connect(f, 'audio', master, 'audio');
  const q = b.connect(lfo, 'control', f, 'Q', { depth: 0.5 });
  const g = b.connect(lfo, 'control', f, 'gain', { depth: 3 });
  const model = store.getModel();
  const edge = (id) => model.graph.edges.find((x) => x.id === id);
  // The graph view, the clip-target policy and the runtime give the same verdict.
  assert.equal(edgeEffectReason(model, edge(q)), CLIP_TARGET_TEXT.filterQUnused);
  assert.equal(edgeEffectReason(model, edge(g)), null);
  const node = model.graph.nodes.find((n) => n.id === f);
  assert.equal(clipTarget(node, { kind: 'automation', param: 'Q' }).reason,
    CLIP_TARGET_TEXT.filterQUnused);
  assert.equal(clipTarget(node, { kind: 'automation', param: 'gain' }).plays, true);
  const s = setup();
  assert.equal(s.runtime.apply(model).ok, true);
  assert.equal(s.runtime.start().ok, true);
  const inactive = new Map(s.runtime.debugInfo().inactiveEdges.map((x) => [x.id, x.reason]));
  assert.deepEqual([...inactive.keys()], [q]);
  assert.equal(inactive.get(q), CLIP_TARGET_TEXT.filterQUnused);
  const biquad = s.runtime.nodes.get(f).info.stage.node;
  assert.equal(biquad.type, 'lowshelf');
  assert.ok(s.runtime.edges.get(g).gain.outputs.includes(biquad.gain));
  s.runtime.stop();
});

test('K011 an all-pass ignores gain: one statement of usesQ/usesGain, a correct article', () => {
  for (const type of FILTER_TYPES) {
    assert.equal(qIsUsed(type), usesQ(type), type);
    assert.equal(gainIsUsed(type), usesGain(type), type);
  }
  assert.equal(qIsUsed, usesQ, 'clip-targets.js re-exports audio/filters.js usesQ');
  assert.equal(gainIsUsed, usesGain, 'clip-targets.js re-exports audio/filters.js usesGain');
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const ap = b.add('filter', { type: 'allpass' });
  const lp = b.add('filter');
  const master = b.add('master');
  const lfo = b.add('lfo');
  b.connect(osc, 'audio', ap, 'audio');
  b.connect(ap, 'audio', lp, 'audio');
  b.connect(lp, 'audio', master, 'audio');
  const ga = b.connect(lfo, 'control', ap, 'gain', { depth: 3 });
  const gl = b.connect(lfo, 'control', lp, 'gain', { depth: 3 });
  const model = store.getModel();
  const edge = (id) => model.graph.edges.find((x) => x.id === id);
  assert.equal(edgeEffectReason(model, edge(ga)),
    'Filter gain applies to peaking and the shelves only; an All-pass filter ignores it.');
  assert.equal(edgeEffectReason(model, edge(gl)),
    'Filter gain applies to peaking and the shelves only; a Low-pass filter ignores it.');
});

test('K011 a type change to a shelf or all-pass is the crossfaded node replace', () => {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const f = b.add('filter');
  const master = b.add('master');
  b.connect(osc, 'audio', f, 'audio');
  b.connect(f, 'audio', master, 'audio');
  const s = setup();
  assert.equal(s.runtime.apply(store.getModel()).ok, true);
  assert.equal(s.runtime.start().ok, true);
  for (const type of ['highshelf', 'allpass', 'lowshelf']) {
    b.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: f, key: 'type', value: type }));
    const r = s.runtime.apply(store.getModel());
    assert.deepEqual(r.ops.filter((o) => o.id === f),
      [{ op: 'node-replace', id: f, keys: ['type'] }], type);
    assert.equal(s.runtime.nodes.get(f).info.stage.node.type, type);
    s.advance(0.1);
  }
  s.runtime.stop();
});

/** Power of x in [f1, f2) Hz: the sum of |DFT|^2 over the bins of one block (real data). */
function bandPower(x, sr, f1, f2) {
  const n = x.length;
  let p = 0;
  for (let k = Math.ceil((f1 * n) / sr); k < (f2 * n) / sr; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += x[i] * h * Math.cos(w * i);
      im -= x[i] * h * Math.sin(w * i);
    }
    p += re * re + im * im;
  }
  return p;
}

test('K011 brown noise falls at -6 dB per octave within 1.5 dB, at either sample rate', () => {
  const block = 2048;
  const bands = [[375, 750], [750, 1500], [1500, 3000], [3000, 6000]];
  for (const sr of RATES) {
    const x = noiseSamples(block * 16, { color: 'brown', seed: 7, sampleRate: sr });
    const power = bands.map(() => 0);
    for (let b = 0; b < 16; b++) {
      const seg = x.subarray(b * block, (b + 1) * block);
      bands.forEach(([f1, f2], i) => { power[i] += bandPower(seg, sr, f1, f2); });
    }
    // An octave band is twice as wide as the one below it, so a density falling 6 dB per
    // octave (1/f^2) gives band powers 3 dB apart: the density's slope is the band ratio in dB
    // minus the 3 dB of the doubled width.
    for (let i = 1; i < bands.length; i++) {
      const slope = 10 * Math.log10(power[i] / power[i - 1]) - 10 * Math.log10(2);
      assert.ok(Math.abs(slope + 6) <= 1.5,
        `${sr} Hz, ${bands[i][0]} Hz: ${slope.toFixed(2)} dB`);
    }
    // White noise, measured the same way, is flat: the method does not invent the slope.
    const w = noiseSamples(block * 4, { color: 'white', seed: 7 });
    let w0 = 0;
    let w1 = 0;
    for (let b = 0; b < 4; b++) {
      const seg = w.subarray(b * block, (b + 1) * block);
      w0 += bandPower(seg, sr, 750, 1500);
      w1 += bandPower(seg, sr, 1500, 3000);
    }
    assert.ok(Math.abs(10 * Math.log10(w1 / w0) - 10 * Math.log10(2)) < 1.5);
  }
});

test('K011 brown noise is level-matched, seamless at the loop and needs the sample rate', () => {
  const sr = 48000;
  const x = noiseSamples(sr * 2, { color: 'brown', seed: 3, sampleRate: sr });
  let s = 0;
  let peak = 0;
  let step = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] * x[i];
    peak = Math.max(peak, Math.abs(x[i]));
    if (i) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
  }
  const rms = Math.sqrt(s / x.length);
  assert.ok(peak <= 0.99 + 1e-6, `peak ${peak}`);
  assert.ok(rms > 0.05 && rms <= 0.2 + 1e-6, `rms ${rms}`);
  assert.ok(Math.abs(x[0] - x[x.length - 1]) <= step, 'no step at the loop point');
  // No DC: the integrator's mean is removed (it was −17 to −29 dB re the RMS by seed).
  for (const [seed, len] of [[3, sr * 2], [1, sr * 4], [11, sr], [20261001, sr * 2]]) {
    const y = noiseSamples(len, { color: 'brown', seed, sampleRate: sr });
    let m = 0;
    let q = 0;
    for (let i = 0; i < y.length; i++) {
      m += y[i];
      q += y[i] * y[i];
    }
    const dcDb = 20 * Math.log10(Math.abs(m / y.length) / Math.sqrt(q / y.length));
    assert.ok(dcDb < -80, `seed ${seed}, ${len}: DC ${dcDb.toFixed(1)} dB re RMS`);
  }
  assert.deepEqual(noiseSamples(4096, { color: 'brown', seed: 3, sampleRate: sr }),
    noiseSamples(4096, { color: 'brown', seed: 3, sampleRate: sr }), 'deterministic');
  assert.throws(() => noiseSamples(1024, { color: 'brown', seed: 3 }), /sample rate/);
  const ctx = new StudioFakeContext({ sampleRate: 44100 });
  assert.equal(createNoiseBuffer(ctx, { color: 'brown', seconds: 0.5 }).length, 22050);
  const opts = R.param('noise', 'color').options.map((o) => [...o]);
  assert.deepEqual(opts, [['white', 'White'], ['pink', 'Pink'], ['brown', 'Brown']]);
  assert.equal(R.defaults('noise').color, 'white');
});

test('K011 a Noise node switched to brown crossfades (noise.js) and stops clean', async () => {
  const store = newStore();
  const b = builder(store);
  const noise = b.add('noise');
  const master = b.add('master');
  b.connect(noise, 'audio', master, 'audio');
  const s = setup(44100);
  assert.equal(s.runtime.apply(store.getModel()).ok, true);
  assert.equal(s.runtime.start().ok, true);
  b.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: noise, key: 'color', value: 'brown' }));
  const r = s.runtime.apply(store.getModel());
  assert.ok(r.ops.some((o) => o.op === 'node-params' && o.id === noise), JSON.stringify(r.ops));
  assert.equal(s.runtime.nodes.get(noise).info.noise.buffer.sampleRate, 44100);
  s.advance(0.2);
  const done = s.runtime.stop();
  s.advance(0.3);
  assert.deepEqual(await done, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
});

// ---------------------------------------------------------------- K012 Drive

test('K012 the Drive curve is odd, monotone and below full scale; trim is at most 1', () => {
  const c = driveCurve();
  assert.equal(c.length, DRIVE_CURVE_SIZE);
  const mid = (c.length - 1) / 2;
  assert.equal(c[mid], 0);
  let peak = 0;
  for (let i = 0; i < c.length; i++) {
    assert.ok(Math.abs(c[i] + c[c.length - 1 - i]) < 1e-7, 'odd');
    if (i) assert.ok(c[i] >= c[i - 1], 'monotone');
    peak = Math.max(peak, Math.abs(c[i]));
  }
  // Room for the 4x resampling filter's ordinary overshoot (17 % on a sawtooth); the clip
  // bounds the rest (next test).
  assert.ok(peak < DRIVE_HEADROOM, `peak ${peak}`);
  // The curve spans DRIVE_SPAN: input x in [-1, 1] maps to 0.8 tanh(DRIVE_SPAN x).
  assert.ok(Math.abs(c[c.length - 1] - DRIVE_HEADROOM * Math.tanh(DRIVE_SPAN)) < 1e-6);
  assert.equal(driveGain(0), 1);
  assert.ok(Math.abs(driveGain(1) - 10 ** (DRIVE_MAX_DB / 20)) < 1e-9);
  const t = R.param('drive', 'trim');
  assert.equal(t.max, 1);
  assert.equal(t.min, 0);
  assert.equal(R.param('drive', 'drive').max, 1);
});

/** A WaveShaperNode's curve at x with oversample 'none' (Web Audio: linear interpolation). */
function shape(curve, x) {
  const n = curve.length;
  if (x <= -1) return curve[0];
  if (x >= 1) return curve[n - 1];
  const v = ((n - 1) / 2) * (x + 1);
  const k = Math.floor(v);
  const f = v - k;
  return k >= n - 1 ? curve[n - 1] : (1 - f) * curve[k] + f * curve[k + 1];
}

test('K012 the clip curve bounds every input at DRIVE_CLIP and is the identity inside it', () => {
  const c = clipCurve();
  assert.equal(c.length, DRIVE_CLIP_CURVE_SIZE);
  assert.ok(DRIVE_CLIP < 1);
  // The 4x resampler's overshoot reaches about 1.6 x the tanh curve's peak (white noise, HF
  // sines); whatever reaches the clip, inside or far beyond [-1, 1], leaves at most DRIVE_CLIP.
  let worst = 0;
  for (let i = -4000; i <= 4000; i++) {
    const x = i / 1000;
    const y = shape(c, x);
    worst = Math.max(worst, Math.abs(y));
    if (Math.abs(x) <= DRIVE_CLIP) assert.ok(Math.abs(y - x) < 1e-6, `identity at ${x}: ${y}`);
    else assert.ok(Math.abs(Math.abs(y) - DRIVE_CLIP) < 1e-6, `clipped at ${x}: ${y}`);
  }
  assert.ok(worst <= DRIVE_CLIP + 1e-7, `worst ${worst}`);
  // The tanh curve's ordinary overshoot (17 % on a sawtooth) stays below the clip.
  assert.ok(DRIVE_HEADROOM * 1.17 < DRIVE_CLIP);
});

test('K012 createDriveStage: drive gain, 4x tanh shaper, trim, then the clip, tracked', () => {
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  const tracked = [];
  const track = (n) => {
    tracked.push(n);
    return n;
  };
  const st = createDriveStage(ctx, { drive: 1, trim: 3 }, { track });
  assert.equal(st.shaper.oversample, '4x');
  assert.equal(st.shaper.curve.length, DRIVE_CURVE_SIZE);
  assert.equal(st.clip.oversample, 'none', 'nothing after the clip resamples');
  assert.deepEqual(Array.from(st.clip.curve), Array.from(clipCurve()));
  assert.equal(st.output, st.clip, 'the clip is the last node: a trim edge is bounded too');
  assert.deepEqual(new Set(tracked), new Set([st.input, st.shaper, st.trim, st.clip]));
  assert.ok(st.input.outputs.includes(st.shaper) && st.shaper.outputs.includes(st.trim)
    && st.trim.outputs.includes(st.clip));
  assert.ok(Math.abs(lastValue(st.input.gain) - driveGain(1) / DRIVE_SPAN) < 1e-9);
  assert.equal(lastValue(st.trim.gain), 1, 'trim above 1 is held at 1');
  st.update({ drive: 0, trim: 0.25 });
  assert.ok(Math.abs(lastValue(st.input.gain) - 1 / DRIVE_SPAN) < 1e-9);
  assert.equal(lastValue(st.trim.gain), 0.25);
  st.dispose();
  assert.ok(tracked.every((n) => n.disconnected));
});

test('K012 the Drive node: registry entry, help, aliases, picker, census 0 after stop',
  async () => {
    const def = R.get('drive');
    assert.equal(def.category, 'PROCESSING');
    assert.equal(def.compiler, 'audio/drive.js#createDriveStage');
    assert.deepEqual(Object.keys(def.help).sort(), ['constraints', 'inputs', 'outputs', 'what']);
    assert.match(def.help.what, /tanh/);
    assert.match(def.help.what, /4× oversampling/);
    for (const q of ['drive', 'distortion', 'overdrive', 'saturation']) {
      assert.equal(searchNodeTypes(q)[0].type, 'drive', q);
    }
    const picker = R.categories().find((c) => c.id === 'PROCESSING').types.map((d) => d.type);
    assert.ok(picker.includes('drive'));
    assert.equal(R.summarize({ type: 'drive', params: { drive: 0.5, trim: 0.5 } }),
      'Drive 50 % · trim -6.02 dB');
    for (const sr of RATES) {
      const store = newStore();
      const b = builder(store);
      const osc = b.add('oscillator', { waveform: 'sawtooth', frequency: 110 });
      const drive = b.add('drive', { drive: 1, trim: 1 });
      const master = b.add('master');
      const lfo = b.add('lfo');
      b.connect(osc, 'audio', drive, 'audio');
      b.connect(drive, 'audio', master, 'audio');
      b.connect(lfo, 'control', drive, 'trim', { depth: 0.25, polarity: 'unipolar' });
      const s = setup(sr);
      const { playing, after } = await censusAfterStop(s, store.getModel());
      assert.ok(playing > 0);
      assert.deepEqual(after, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 }, `${sr}`);
    }
  });

// ---------------------------------------------------------------- K013 Macro

test('K013 the Macro node: a 0..1 automatable value and a CONTROL output', () => {
  const def = R.get('macro');
  assert.equal(def.category, 'MODULATION');
  assert.deepEqual(def.outputs.map((p) => [p.id, p.type]), [['control', 'CONTROL']]);
  const v = R.param('macro', 'value');
  assert.deepEqual([v.min, v.max, v.automatable, v.modulatable], [0, 1, true, true]);
  assert.equal(searchNodeTypes('macro')[0].type, 'macro');
  assert.equal(R.summarize({ type: 'macro', params: { value: 0.25 } }), '25 %');
});

test('K013 typed ports: the Macro CONTROL output connects only to CONTROL inputs', () => {
  const out = R.port('macro', 'control', 'out');
  const allowed = [R.port('filter', 'frequency', 'in'), R.port('lfo', 'rate', 'in'),
    R.port('drive', 'trim', 'in'), R.port('macro', 'value', 'in')];
  for (const p of allowed) assert.equal(canConnect(out, p).allowed, true, p.id);
  const refused = [R.port('filter', 'audio', 'in'), R.port('envelope', 'gate', 'in'),
    R.port('transfer-analyzer', 'reference', 'in')];
  for (const p of refused) {
    const r = canConnect(out, p);
    assert.equal(r.allowed, false, p.id);
    assert.equal(r.code, 'type-mismatch');
    assert.match(r.reason, /^Control output cannot connect to an? \w+ input\./);
  }
});

test('K013 one Macro drives cutoff and LFO rate through each edge\'s depth and polarity', () => {
  for (const sr of RATES) {
    const store = newStore();
    const b = builder(store);
    const osc = b.add('oscillator');
    const f = b.add('filter', { frequency: 800 });
    const master = b.add('master');
    const lfo = b.add('lfo', { rate: 6 });
    const macro = b.add('macro', { value: 0.5 });
    b.connect(osc, 'audio', f, 'audio');
    b.connect(f, 'audio', master, 'audio');
    b.connect(lfo, 'control', osc, 'level', { depth: 0.25 });
    const toCutoff = b.connect(macro, 'control', f, 'frequency',
      { depth: 1000, polarity: 'unipolar' });
    const toRate = b.connect(macro, 'control', lfo, 'rate', { depth: 4, polarity: 'bipolar' });
    const s = setup(sr);
    assert.equal(s.runtime.apply(store.getModel()).ok, true);
    assert.equal(s.runtime.start().ok, true);
    const cs = s.runtime.nodes.get(macro).info.source;
    assert.equal(cs.kind, 'constant-source');
    assert.equal(s.runtime.nodes.get(macro).outputs.control.kind, 'waveshaper', 'the clip');
    assert.equal(lastValue(cs.offset), 0.5);
    const biquad = s.runtime.nodes.get(f).info.stage.node;
    const eC = s.runtime.edges.get(toCutoff);
    const eR = s.runtime.edges.get(toRate);
    assert.ok(eC.gain.outputs.includes(biquad.frequency));
    assert.ok(eR.gain.outputs.includes(s.runtime.nodes.get(lfo).info.oscillator.frequency));
    // Unipolar on a 0..1 control: 0 → +0, 1 → +depth (gain = depth). Bipolar: 0 → −depth,
    // 1 → +depth (gain = 2 depth, the base lowered by depth).
    assert.ok(Math.abs(eC.ramp.target - 1000) < 1e-9, String(eC.ramp.target));
    assert.ok(Math.abs(eR.ramp.target - 8) < 1e-9, String(eR.ramp.target));
    assert.equal(lastValue(s.runtime.nodes.get(lfo).info.oscillator.frequency), 6 - 4);
    // At value 0.5 the cutoff is 800 + 500 Hz and the LFO rate 6 Hz: the sum of the base, the
    // edge's constant part and the control times its gain.
    assert.equal(lastValue(biquad.frequency) + 0.5 * eC.ramp.target, 1300);
    s.runtime.stop();
  }
});

test('K013 a Macro value edit is one undo entry; undo restores the model', () => {
  const store = newStore();
  const b = builder(store);
  const macro = b.add('macro');
  const before = store.getModel();
  const depth = store.debugInfo().undoDepth;
  b.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: macro, key: 'value', value: 0.8 }));
  assert.equal(store.debugInfo().undoDepth, depth + 1);
  assert.equal(store.getModel().graph.nodes[0].params.value, 0.8);
  assert.equal(store.undo().ok, true);
  assert.equal(store.getModel(), before);
  const refused = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: macro, key: 'value',
    value: 1.5 });
  assert.equal(refused.ok, false);
  assert.equal(store.getModel(), before);
});

test('K013 without ConstantSourceNode the Macro degrades with a reason', () => {
  const store = newStore();
  const b = builder(store);
  const macro = b.add('macro');
  const f = b.add('filter');
  b.connect(macro, 'control', f, 'frequency', { depth: 100 });
  const s = setup();
  s.ctx.createConstantSource = undefined;
  assert.equal(s.runtime.apply(store.getModel()).ok, true);
  assert.equal(s.runtime.start().ok, true);
  const h = s.runtime.nodes.get(macro);
  assert.equal(h.status, 'degraded');
  assert.match(h.reason, /ConstantSourceNode/);
  s.runtime.stop();
});

// -------------------------------------------------------- review of #267 (R-1, R-2, R-4, R-5)

/** The [min, max] a node's control output reaches while its input sweeps [lo, hi]. */
function controlOutputRange(out, lo, hi) {
  if (out.kind !== 'waveshaper') return [lo, hi]; // a ConstantSourceNode passes what drives it
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 4000; i++) {
    const y = shape(out.curve, lo + ((hi - lo) * i) / 4000);
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return [min, max];
}

test('R-1 a modulated Macro stays in its declared 0..1 range: a downstream frequency keeps '
  + '0.95 x Nyquist', () => {
  for (const sr of [...RATES, 96000]) {
    const store = newStore();
    const b = builder(store);
    const osc = b.add('oscillator', { frequency: 100 });
    const master = b.add('master');
    const macro = b.add('macro', { value: 0.5 });
    const lfo = b.add('lfo', { rate: 3 });
    b.connect(osc, 'audio', master, 'audio');
    const e = b.connect(macro, 'control', osc, 'frequency', { depth: 50000,
      polarity: 'unipolar' });
    const m = b.connect(lfo, 'control', macro, 'value', { depth: 1 });
    const s = setup(sr);
    assert.equal(s.runtime.apply(store.getModel()).ok, true);
    assert.equal(s.runtime.start().ok, true);
    const h = s.runtime.nodes.get(macro);
    const cs = h.info.source || h.outputs.control;
    // What drives the Macro: its offset (0.5) plus the LFO edge, ±1: −0.5 … 1.5.
    const g = Math.abs(s.runtime.edges.get(m).ramp.target);
    const lo = lastValue(cs.offset) - g;
    const hi = lastValue(cs.offset) + g;
    assert.ok(lo < 0 && hi > 1, `the probe drives the value outside 0..1: ${lo} … ${hi}`);
    const [outLo, outHi] = controlOutputRange(h.outputs.control, lo, hi);
    assert.ok(outLo >= 0 && outHi <= 1, `${sr}: the Macro output reaches ${outLo} … ${outHi}`);
    assert.deepEqual(h.outputRange.control, [0, 1], 'the range computeBases sizes edges from');
    const carrier = s.runtime.nodes.get(osc).info.oscillator;
    const peak = lastValue(carrier.frequency) + s.runtime.edges.get(e).ramp.target * outHi;
    assert.ok(peak <= safeMax(sr) * (1 + 1e-12), `${sr}: peak ${peak} > ${safeMax(sr)}`);
    assert.ok(peak > 0.99 * safeMax(sr), `${sr}: the edge reaches the cap (${peak})`);
    assert.ok(s.runtime.debugInfo().limitedEdges.includes(e), 'the scaled edge is reported');
    s.runtime.stop();
  }
});

test('R-1 the Macro clip: identity on 0..1, held at 0 and 1 beyond, no resampling, census 0',
  async () => {
    const { MACRO_CLIP_CURVE_SIZE, macroClipCurve } = await import(
      '../../src/js/studio/adapters/modulation.js');
    assert.equal(typeof macroClipCurve, 'function', 'adapters/modulation.js#macroClipCurve');
    const c = macroClipCurve();
    assert.equal(c.length, MACRO_CLIP_CURVE_SIZE);
    assert.match(R.get('macro').help.outputs, /^Control, 0 to 1, held there when modulation/);
    for (let i = -4000; i <= 4000; i++) {
      const x = i / 1000;
      const y = shape(c, x);
      const want = Math.min(1, Math.max(0, x));
      assert.ok(Math.abs(y - want) < 1e-6, `${x}: ${y}`);
    }
    for (const sr of RATES) {
      const store = newStore();
      const b = builder(store);
      const osc = b.add('oscillator');
      const f = b.add('filter');
      const master = b.add('master');
      const macro = b.add('macro', { value: 0.25 });
      const lfo = b.add('lfo');
      b.connect(osc, 'audio', f, 'audio');
      b.connect(f, 'audio', master, 'audio');
      b.connect(macro, 'control', f, 'frequency', { depth: 1000, polarity: 'unipolar' });
      b.connect(lfo, 'control', macro, 'value', { depth: 1 });
      const s = setup(sr);
      assert.equal(s.runtime.apply(store.getModel()).ok, true);
      assert.equal(s.runtime.start().ok, true);
      const h = s.runtime.nodes.get(macro);
      const out = h.outputs.control;
      assert.equal(out.kind, 'waveshaper');
      assert.equal(out.oversample, 'none', 'nothing after the clip resamples');
      assert.deepEqual(Array.from(out.curve), Array.from(c));
      assert.equal(h.info.source.kind, 'constant-source');
      assert.ok(h.info.source.outputs.includes(out), 'the ConstantSourceNode feeds the clip');
      assert.equal(lastValue(h.info.source.offset), 0.25, 'a static value passes unchanged');
      s.runtime.stop();
      const { after } = await censusAfterStop(setup(sr), store.getModel());
      assert.deepEqual(after, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 }, `${sr}`);
    }
  });

/**
 * The Drive trim a control source of range [lo, hi] gives through one edge: the trim gain's
 * base plus the edge gain times the source, at the source's lo, middle and hi.
 */
function driveTrimSpan({ source, trim, props }, sr = 48000) {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const drive = b.add('drive', { drive: 0.5, trim });
  const master = b.add('master');
  const src = b.add(source, source === 'macro' ? { value: 0.5 } : {});
  b.connect(osc, 'audio', drive, 'audio');
  b.connect(drive, 'audio', master, 'audio');
  const e = b.connect(src, 'control', drive, 'trim', props);
  const s = setup(sr);
  assert.equal(s.runtime.apply(store.getModel()).ok, true);
  assert.equal(s.runtime.start().ok, true);
  const edge = s.runtime.edges.get(e);
  const base = lastValue(s.runtime.nodes.get(drive).info.stage.trim.gain);
  const [lo, hi] = source === 'macro' ? [0, 1] : [-1, 1];
  const out = { edge, base, at: [lo, (lo + hi) / 2, hi].map((m) => base + edge.ramp.target * m) };
  s.runtime.stop();
  return out;
}

test('R-2 the Drive trim maps each edge over its full span: the static trim, then the edges',
  () => {
    const near3 = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
    // [source, trim, edge props, trim at the source's lo / middle / hi]
    const cases = [
      // A unipolar source (Macro) on the default bipolar edge: trim ± depth, not 0 … 2 depth.
      ['macro', 0.1, { depth: 0.25 }, [-0.15, 0.1, 0.35]],
      ['macro', 0.1, { depth: 0.25, polarity: 'unipolar' }, [0.1, 0.225, 0.35]],
      ['macro', 1, { depth: 0.25 }, [0.75, 1, 1.25]],
      // A bipolar source (LFO) on a unipolar edge: trim … trim + depth, not held at 1.
      ['lfo', 1, { depth: 0.25, polarity: 'unipolar' }, [1, 1.125, 1.25]],
      ['lfo', 0.5, { depth: 0.25 }, [0.25, 0.5, 0.75]],
      ['lfo', 0, { depth: 0.25, offset: -0.1 }, [-0.35, -0.1, 0.15]],
    ];
    for (const [source, trim, props, want] of cases) {
      for (const sr of RATES) {
        const r = driveTrimSpan({ source, trim, props }, sr);
        assert.equal(r.edge.status, 'active');
        assert.ok(near3(r.at, want), `${source} ${JSON.stringify(props)} trim ${trim} at ${sr}: `
          + `${r.at.join(', ')} vs ${want.join(', ')}`);
      }
    }
    // The trim is linear: a log-mapped edge onto it is refused where it is drawn.
    const store = newStore();
    const b = builder(store);
    const drive = b.add('drive');
    const lfo = b.add('lfo');
    const r = store.dispatch({ type: 'EDGE_ADD', from: { node: lfo, port: 'control' },
      to: { node: drive, port: 'trim' }, props: { depth: 0.25, mapping: 'log' } });
    assert.equal(r.ok, false);
    assert.match(r.reason, /log mapping needs a logarithmic parameter/);
  });

test('R-4 Drive changes glide (tau GLIDE_TAU_S) on the drive gain and the trim', async () => {
  const { GLIDE_TAU_S } = await import('../../src/js/audio/drive.js');
  assert.equal(GLIDE_TAU_S, 0.015, 'audio/drive.js#GLIDE_TAU_S');
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  const st = createDriveStage(ctx, { drive: 0.5, trim: 0.5 });
  const n0 = st.input.gain.events.length;
  const t0 = st.trim.gain.events.length;
  st.update({ drive: 1, trim: 0.25 });
  const d = st.input.gain.events.slice(n0);
  const t = st.trim.gain.events.slice(t0);
  assert.deepEqual(d.map((x) => [x.ramp, x.tau]), [['target', GLIDE_TAU_S]], 'drive: one glide');
  assert.ok(Math.abs(d[0].value - driveGain(1) / DRIVE_SPAN) < 1e-9);
  assert.deepEqual(t.map((x) => [x.ramp, x.tau, x.value]), [['target', GLIDE_TAU_S, 0.25]],
    'trim: one glide');
  st.update({ drive: 1, trim: 0.25 });
  assert.equal(st.input.gain.events.length, n0 + 1, 'an unchanged value writes nothing');
  assert.equal(st.trim.gain.events.length, t0 + 1);
  // Through the Studio runtime: a drive or trim edit on a playing graph glides, never steps.
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const drive = b.add('drive', { drive: 0.5, trim: 0.5 });
  const master = b.add('master');
  b.connect(osc, 'audio', drive, 'audio');
  b.connect(drive, 'audio', master, 'audio');
  const s = setup();
  assert.equal(s.runtime.apply(store.getModel()).ok, true);
  assert.equal(s.runtime.start().ok, true);
  s.advance(0.1);
  const stage = s.runtime.nodes.get(drive).info.stage;
  for (const [key, value, param] of [['drive', 0.9, stage.input.gain],
    ['trim', 0.3, stage.trim.gain]]) {
    b.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: drive, key, value }));
    assert.equal(s.runtime.apply(store.getModel()).ok, true);
    const last = param.events[param.events.length - 1];
    assert.equal(last.ramp, 'target', `${key}: a glide`);
    assert.ok(last.tau > 0 && last.tau <= GLIDE_TAU_S, `${key}: tau ${last.tau}`);
  }
  s.runtime.stop();
});

test('R-4 the LFO adapter clamps its rate to 0.95 x Nyquist itself, past computeBases', () => {
  for (const sr of [...RATES, 96000]) {
    const store = newStore();
    const b = builder(store);
    const osc = b.add('oscillator');
    const master = b.add('master');
    const lfo = b.add('lfo', { rate: 440 });
    b.connect(osc, 'audio', master, 'audio');
    b.connect(lfo, 'control', osc, 'level', { depth: 0.5 });
    const s = setup(sr);
    assert.equal(s.runtime.apply(store.getModel()).ok, true);
    assert.equal(s.runtime.start().ok, true);
    const h = s.runtime.nodes.get(lfo);
    const mod = h.info.oscillator;
    // A base above the cap (as a lane's initial value that overrides the computed base can be)
    // and one below the floor: the adapter's own clamp is the last bound.
    for (const [v, want] of [[100000, safeMax(sr)], [1e-6, 0.01]]) {
      const w = {};
      h.applyBase({ rate: { value: v, cents: 0 } }, true, new Set(), w);
      assert.ok(Math.abs(lastValue(mod.frequency) - want) < 1e-9,
        `${sr}: ${v} -> ${lastValue(mod.frequency)} vs ${want}`);
      assert.ok(Math.abs(w.rate - want) < 1e-9);
    }
    s.runtime.stop();
  }
});

test('R-5 an LFO rate lane spans 0.01 Hz to 0.95 x Nyquist on a log scale (audio rates drawn)',
  () => {
    const p = R.param('lfo', 'rate');
    for (const sr of [...RATES, 96000]) {
      const scale = automationScale(p, { sampleRate: sr });
      assert.equal(scale.kind, 'log');
      assert.equal(scale.min, 0.01);
      assert.ok(Math.abs(scale.max - safeMax(sr)) < 1e-9, `${sr}: ${scale.max}`);
      assert.ok(Math.abs(scale.fromNormalized(1) - safeMax(sr)) < 1e-6, 'the lane top');
      const n = scale.toNormalized(2000);
      assert.ok(n > 0.5 && n < 1, `2000 Hz sits inside the lane (${n})`);
      assert.ok(Math.abs(scale.fromNormalized(n) - 2000) < 1e-6);
      // A point drawn at the top of the lane is the cap; one at 2/3 of the height an audio rate.
      const top = pointAtLaneCoordinates({ x: 0, y: 0, height: 120, pxPerSecond: 100 }, scale);
      assert.ok(Math.abs(top.value - safeMax(sr)) < 1e-6);
      const up = pointAtLaneCoordinates({ x: 0, y: 40, height: 120, pxPerSecond: 100 }, scale);
      assert.ok(up.value > 100, `audio rate drawn: ${up.value}`);
      assert.ok(scale.ticks().some((t) => t.value === 10000), 'ticks reach the kHz decade');
    }
    // The Inspector slider keeps its four decades; the lane is a separate range.
    assert.deepEqual(sliderRange(p), { lo: 0.01, hi: 100, log: true });
    // Random and Step Modulator lanes stay at their 0.01-100 Hz range; a cutoff lane is unchanged.
    for (const type of ['random', 'step-modulator']) {
      const sc = automationScale(R.param(type, 'rate'), { sampleRate: 48000 });
      assert.deepEqual([sc.min, sc.max], [0.01, 100], type);
    }
    const cut = automationScale(R.param('filter', 'frequency'), { sampleRate: 48000 });
    assert.deepEqual([cut.min, cut.max], [20, 20000]);
  });

test('R-5 a typed 2000 Hz LFO rate point keeps its value; a nudge moves it by one lane step',
  () => {
    for (const sr of RATES) {
      const store = newStore();
      const b = builder(store);
      const lfo = b.add('lfo');
      b.ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: lfo, param: 'rate' },
        time: 0, value: 2000 }));
      const model = store.getModel();
      const lane = model.timeline.automation[0];
      const pt = lane.points[0];
      const typed = editPointAction(model, lane.id, pt.id, { value: 2000 }, { sampleRate: sr });
      assert.equal(typed.ok, true);
      assert.equal(typed.action, null, 'a typed 2000 Hz is not rewritten');
      const above = editPointAction(model, lane.id, pt.id, { value: 1e6 }, { sampleRate: sr });
      assert.ok(Math.abs(above.action.value - safeMax(sr)) < 1e-6, 'held at 0.95 x Nyquist');
      const scale = automationScale(R.param('lfo', 'rate'), { sampleRate: sr });
      for (const dir of [1, -1]) {
        const r = nudgePointAction(model, lane.id, pt.id, { dValue: dir, sampleRate: sr });
        assert.equal(r.ok, true);
        const want = scale.fromNormalized(scale.toNormalized(2000) + dir * 0.01);
        assert.ok(Math.abs(r.action.value - want) < 1e-6, `${sr} ${dir}: ${r.action.value}`);
        assert.ok(dir > 0 ? r.action.value > 2000 : r.action.value < 2000);
        assert.ok(r.action.value > 1000 && r.action.value < 4000, 'one step, not to 100 Hz');
      }
    }
  });
