// K010-K013 (intent playable-instrument, milestone M058 Synth voice): the Studio voice nodes
// that leave every existing studioHash alone (a new node type, a new enum option or a wider
// range never changes a saved document; fact 3-4 of the instrument plan).
//   K010  LFO rate at audio rate: up to FREQUENCY_MAX_HZ in the model, clamped to 0.95 x
//         Nyquist of the running context through hooks.clampFrequency, and reported
//   K011  Filter types low-shelf, high-shelf and all-pass; brown noise
//   K012  Drive: a tanh WaveShaper (4x oversampling) between a drive gain and a trim <= 1
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
  DRIVE_CURVE_SIZE, DRIVE_HEADROOM, DRIVE_MAX_DB, DRIVE_SPAN, createDriveStage, driveCurve,
  driveGain,
} from '../../src/js/audio/drive.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import {
  CLIP_TARGET_TEXT, clipTarget, gainIsUsed, qIsUsed,
} from '../../src/js/studio/clip-targets.js';
import { FREQUENCY_MAX_HZ } from '../../src/js/studio/nodes/common.js';
import { canConnect } from '../../src/js/studio/ports.js';
import { NODE_REGISTRY as R, searchNodeTypes } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { edgeEffectReason } from '../../src/js/ui/studio/graph-view.js';
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
  // Room for the 4x resampling filter's overshoot (up to ~18 % of a hard-saturated edge).
  assert.ok(peak < DRIVE_HEADROOM && peak * 1.18 < 1, `peak ${peak}`);
  // The curve spans DRIVE_SPAN: input x in [-1, 1] maps to 0.8 tanh(DRIVE_SPAN x).
  assert.ok(Math.abs(c[c.length - 1] - DRIVE_HEADROOM * Math.tanh(DRIVE_SPAN)) < 1e-6);
  assert.equal(driveGain(0), 1);
  assert.ok(Math.abs(driveGain(1) - 10 ** (DRIVE_MAX_DB / 20)) < 1e-9);
  const t = R.param('drive', 'trim');
  assert.equal(t.max, 1);
  assert.equal(t.min, 0);
  assert.equal(R.param('drive', 'drive').max, 1);
});

test('K012 createDriveStage: drive gain, 4x oversampled tanh shaper, trim, all tracked', () => {
  const ctx = new StudioFakeContext({ sampleRate: 48000 });
  const tracked = [];
  const track = (n) => {
    tracked.push(n);
    return n;
  };
  const st = createDriveStage(ctx, { drive: 1, trim: 3 }, { track });
  assert.equal(st.shaper.oversample, '4x');
  assert.equal(st.shaper.curve.length, DRIVE_CURVE_SIZE);
  assert.deepEqual(new Set(tracked), new Set([st.input, st.shaper, st.output]));
  assert.ok(st.input.outputs.includes(st.shaper) && st.shaper.outputs.includes(st.output));
  assert.ok(Math.abs(lastValue(st.input.gain) - driveGain(1) / DRIVE_SPAN) < 1e-9);
  assert.equal(lastValue(st.output.gain), 1, 'trim above 1 is held at 1');
  st.update({ drive: 0, trim: 0.25 });
  assert.ok(Math.abs(lastValue(st.input.gain) - 1 / DRIVE_SPAN) < 1e-9);
  assert.equal(lastValue(st.output.gain), 0.25);
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
    const cs = s.runtime.nodes.get(macro).outputs.control;
    assert.equal(cs.kind, 'constant-source');
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
