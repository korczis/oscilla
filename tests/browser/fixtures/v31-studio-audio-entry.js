// Fixture for tests/browser/v31-studio-audio.cjs: bundled with esbuild (IIFE) into one classic
// <script> of a single file:// page. It drives the Studio compiler/runtime (src/js/studio/) on
// the real AudioEngine and exposes window.T with measurement routines that return plain
// numbers; the runner asserts.
//
// Instrumentation, installed before anything creates a node, independent of the engine's own
// accounting: every node created by a BaseAudioContext factory after T.mark() is recorded with
// its live outgoing connections (connect / disconnect(dest) / disconnect()), and every
// AudioScheduledSourceNode is live from start() until its `ended` event. The output tap is a
// frame-indexed AudioWorklet (data: URL, file://-safe) on engine.analyser, the end of the master
// chain, i.e. exactly what reaches the destination; its nodes are internal and not counted.
// Waiting is driven by the tap's messages on the audio clock (T.until), never by timers.

import { AudioEngine } from '../../../src/js/audio/audio-engine.js';
import { nodeQ } from '../../../src/js/audio/filters.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../../src/js/studio/runtime.js';

// ---------------------------------------------------------------- instrumentation
const probe = { internal: false, marked: false, created: [], conns: new Map(), sources: new Set(),
  started: 0 };
const BAC = window.BaseAudioContext || window.AudioContext;
for (const name of Object.getOwnPropertyNames(BAC.prototype)) {
  if (!name.startsWith('create') || name === 'createBuffer' || name === 'createPeriodicWave') {
    continue;
  }
  const orig = BAC.prototype[name];
  if (typeof orig !== 'function') continue;
  BAC.prototype[name] = function (...a) {
    const node = orig.apply(this, a);
    if (!probe.internal && probe.marked && node instanceof AudioNode) {
      probe.created.push(node);
      probe.conns.set(node, new Set());
    }
    return node;
  };
}
const oConnect = AudioNode.prototype.connect;
const oDisconnect = AudioNode.prototype.disconnect;
AudioNode.prototype.connect = function (dest, ...rest) {
  const r = oConnect.call(this, dest, ...rest);
  const set = probe.conns.get(this);
  if (set) set.add(dest);
  return r;
};
AudioNode.prototype.disconnect = function (...a) {
  const r = oDisconnect.apply(this, a);
  const set = probe.conns.get(this);
  if (set) {
    if (a.length === 0) set.clear();
    else if (a[0] && typeof a[0] === 'object') set.delete(a[0]);
  }
  return r;
};
const SSN = window.AudioScheduledSourceNode;
const oStart = SSN.prototype.start;
SSN.prototype.start = function (...a) {
  if (probe.conns.has(this)) {
    probe.sources.add(this);
    probe.started += 1;
    this.addEventListener('ended', () => probe.sources.delete(this), { once: true });
  }
  return oStart.apply(this, a);
};

// ---------------------------------------------------------------- output tap
const WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.N = 4096; this.L = new Float32Array(this.N); this.n = 0;
    this.f0 = 0; }
  flush() { if (this.n) this.port.postMessage({ f: this.f0, L: this.L.slice(0, this.n) });
    this.n = 0; }
  process(inputs) {
    const i = inputs[0];
    if (this.n && currentFrame !== this.f0 + this.n) this.flush();
    if (!this.n) this.f0 = currentFrame;
    const L = i && i.length ? i[0] : null;
    const len = L ? L.length : 128;
    if (L) this.L.set(L, this.n); else this.L.fill(0, this.n, this.n + len);
    this.n += len;
    if (this.n + 128 > this.N) this.flush();
    return true;
  }
}
registerProcessor('oscilla-studio-tap', Tap);`;

const rec = { chunks: [], sr: 0, waiters: [] };
function onChunk(f, L) {
  rec.chunks.push({ f, L });
  let total = 0;
  for (let k = rec.chunks.length - 1; k >= 0; k--) {
    total += rec.chunks[k].L.length;
    if (total > rec.sr * 30) { rec.chunks.splice(0, k); break; }
  }
  const end = recEnd();
  rec.waiters = rec.waiters.filter((w) => {
    if (end >= w.t || w.pred()) { w.resolve(true); return false; }
    return true;
  });
}
function recEnd() {
  const c = rec.chunks[rec.chunks.length - 1];
  return c ? (c.f + c.L.length) / rec.sr : 0;
}

/** Resolve once the tap has recorded audio up to context time t, or pred() holds. */
function until(t, pred = () => false) {
  if (recEnd() >= t || pred()) return Promise.resolve(true);
  return new Promise((resolve) => rec.waiters.push({ t, pred, resolve }));
}

/** The longest contiguous run of recorded samples within [t0, t1) (context seconds). */
function samples(t0, t1) {
  const f0 = Math.round(t0 * rec.sr);
  const f1 = Math.round(t1 * rec.sr);
  const out = new Float32Array(Math.max(0, f1 - f0));
  let filled = 0;
  for (const c of rec.chunks) {
    const a = Math.max(f0, c.f);
    const b = Math.min(f1, c.f + c.L.length);
    if (b <= a) continue;
    out.set(c.L.subarray(a - c.f, b - c.f), a - f0);
    filled += b - a;
  }
  return { data: out, complete: filled === out.length };
}

/**
 * Largest one-sample step in [t0, t1), within contiguous runs of recorded audio only (a block
 * the tap did not receive is a gap, never a step); gaps are counted and reported.
 */
function maxStep(t0, t1) {
  const f0 = Math.round(t0 * rec.sr);
  const f1 = Math.round(t1 * rec.sr);
  let m = 0;
  let n = 0;
  let gaps = 0;
  let prevEnd = null;
  let prev = null;
  let stepAt = null;
  for (const c of rec.chunks) {
    const a = Math.max(f0, c.f);
    const b = Math.min(f1, c.f + c.L.length);
    if (b <= a) continue;
    if (prevEnd !== null && a !== prevEnd) { gaps += 1; prev = null; }
    for (let i = a; i < b; i++) {
      const v = c.L[i - c.f];
      if (prev !== null && Math.abs(v - prev) > m) {
        m = Math.abs(v - prev);
        stepAt = i / rec.sr;
      }
      prev = v;
      n += 1;
    }
    prevEnd = b;
  }
  return { maxStep: m, n, gaps, stepAt };
}

/** Amplitude of the component at f Hz (Goertzel, Hann window, amplitude-corrected). */
function amplitudeAt(data, f, sr) {
  const n = data.length;
  const w = (2 * Math.PI * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum += h;
    const s0 = data[i] * h + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / wsum;
}

function rms(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

// ---------------------------------------------------------------- fixture state
const T = { engine: null, runtime: null, probe,
  samples: (a, b) => Array.from(samples(a, b).data) };
window.T = T;

T.start = async () => {
  T.engine = new AudioEngine();
  T.engine.init();
  await T.engine.resume();
  const ctx = T.engine.ctx;
  rec.sr = ctx.sampleRate;
  probe.internal = true;
  let kind = 'worklet';
  try {
    await ctx.audioWorklet.addModule(`data:application/javascript;charset=utf-8,${
      encodeURIComponent(WORKLET)}`);
    const node = new AudioWorkletNode(ctx, 'oscilla-studio-tap', { numberOfInputs: 1,
      numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    oConnect.call(T.engine.analyser, node);
    oConnect.call(node, sink);
    oConnect.call(sink, ctx.destination);
    node.port.onmessage = (e) => onChunk(e.data.f, e.data.L);
  } catch (err) {
    kind = `scriptprocessor (${err.message})`;
    const sp = ctx.createScriptProcessor(1024, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    oConnect.call(T.engine.analyser, sp);
    oConnect.call(sp, sink);
    oConnect.call(sink, ctx.destination);
    sp.onaudioprocess = (e) => {
      const b = e.inputBuffer;
      onChunk(Math.round((e.playbackTime - b.duration) * rec.sr), b.getChannelData(0).slice());
    };
  }
  probe.internal = false;
  probe.marked = true;
  T.runtime = createStudioRuntime({ engine: T.engine });
  return { state: ctx.state, sampleRate: ctx.sampleRate, tap: kind };
};

const now = () => T.engine.ctx.currentTime;
const wait = (s) => until(now() + s);

/** Independent counts: live sources and live connections of nodes created since T.mark(). */
T.counts = () => {
  let connections = 0;
  let connectedNodes = 0;
  for (const set of probe.conns.values()) {
    connections += set.size;
    if (set.size) connectedNodes += 1;
  }
  return { liveSources: probe.sources.size, connections, connectedNodes,
    created: probe.created.length, engineNodes: T.engine.activeNodeCount,
    engineSources: T.engine.activeSourceCount,
    runtimeNodes: T.runtime.debugInfo().runtimeNodeCount };
};

function studio() {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const ok = (r) => {
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  const b = {
    store,
    add: (nodeType, params) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
      position: { x: 0, y: 0 }, params })).created.nodes[0],
    connect: (from, fp, to, tp, props) => ok(store.dispatch({ type: 'EDGE_ADD',
      from: { node: from, port: fp }, to: { node: to, port: tp }, props })).created.edges[0],
    remove: (nodeId) => ok(store.dispatch({ type: 'NODE_REMOVE', nodeId })),
    removeEdge: (edgeId) => ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId })),
    set: (nodeId, key, value) => ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId, key,
      value })),
    edge: (edgeId, props) => ok(store.dispatch({ type: 'EDGE_UPDATE', edgeId, props })),
    apply: () => {
      const r = T.runtime.apply(store.getModel(), { revision: store.getRevision() });
      if (!r.ok) throw new Error(`apply: ${r.errors[0].message}`);
      return r;
    },
  };
  return b;
}

T.studio = () => studio();
T.until = (t) => until(t);

/** Wait for the runtime's deferred disposals and the sources' `ended` events. */
async function settle() {
  await until(now() + 2, () => T.runtime.debugInfo().pendingCleanups === 0
    && probe.sources.size === 0);
  return T.counts();
}

/** |H(f)| of a reference biquad (the browser's own response for the same settings). */
function biquadMag(type, fc, qLinear, f) {
  const ref = T.engine.ctx.createBiquadFilter();
  ref.type = type;
  ref.frequency.value = fc;
  ref.Q.value = nodeQ(type, qLinear);
  const mag = new Float32Array(1);
  const ph = new Float32Array(1);
  ref.getFrequencyResponse(Float32Array.of(f), mag, ph);
  return mag[0];
}

// ---------------------------------------------------------------- §209 audio graph
T.audioGraph = async () => {
  const sr = T.engine.ctx.sampleRate;
  const b = studio();
  const osc = b.add('oscillator', { waveform: 'sawtooth', frequency: 220 });
  const gain = b.add('gain', { gain: 1 });
  const filter = b.add('filter', { type: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 });
  const master = b.add('master', { level: 0.08 });
  b.connect(osc, 'audio', gain, 'audio');
  b.connect(gain, 'audio', filter, 'audio');
  b.connect(filter, 'audio', master, 'audio');
  b.apply();
  const before = T.counts();
  const start = T.runtime.start();
  const t0 = start.at;
  await until(t0 + 0.6);
  const w1 = samples(t0 + 0.2, t0 + 0.6);
  const fH = 4400; // 20th harmonic
  const a = { fund: amplitudeAt(w1.data, 220, sr), harm: amplitudeAt(w1.data, fH, sr) };
  const withFilter = T.counts();
  const filterHandle = T.runtime.nodes.get(filter);
  const filterNodes = [...filterHandle.nodes];
  b.remove(filter);
  b.connect(gain, 'audio', master, 'audio');
  const r = b.apply();
  await until(r.at + 0.5);
  const w2 = samples(r.at + 0.1, r.at + 0.5);
  const c = { fund: amplitudeAt(w2.data, 220, sr), harm: amplitudeAt(w2.data, fH, sr) };
  const afterRemove = await settle();
  const filterNodesConnected = filterNodes.filter((n) => probe.conns.get(n).size > 0).length;
  const filterNodesTracked = filterNodes.filter((n) => T.engine.nodes.has(n)).length;
  const done = T.runtime.stop();
  await wait(0.15);
  await done;
  const stopped = await settle();
  return {
    complete: w1.complete && w2.complete,
    ops: r.ops,
    withFilterDb: db(a.harm) - db(a.fund),
    withoutFilterDb: db(c.harm) - db(c.fund),
    expectedFilterDb: db(biquadMag('lowpass', 1000, Math.SQRT1_2, fH))
      - db(biquadMag('lowpass', 1000, Math.SQRT1_2, 220)),
    fundamentalWith: a.fund,
    fundamentalWithout: c.fund,
    filterNodeCount: filterNodes.length,
    filterNodesConnected,
    filterNodesTracked,
    counts: { before, withFilter, afterRemove, stopped },
  };
};

// ---------------------------------------------------------------- §210 modulation
T.modulation = async () => {
  const b = studio();
  const osc = b.add('oscillator', { waveform: 'sine', frequency: 1000 });
  const filter = b.add('filter', { type: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 });
  const master = b.add('master', { level: 0.08 });
  const lfo = b.add('lfo', { shape: 'sine', rate: 1 });
  b.connect(osc, 'audio', filter, 'audio');
  b.connect(filter, 'audio', master, 'audio');
  const mod = b.connect(lfo, 'control', filter, 'frequency', { depth: 800, polarity: 'bipolar' });
  b.apply();
  const envelope = async (t0, seconds) => {
    await until(t0 + seconds);
    const levels = [];
    for (let t = t0; t + 0.02 <= t0 + seconds; t += 0.02) {
      levels.push(db(rms(samples(t, t + 0.02).data)));
    }
    return { max: Math.max(...levels), min: Math.min(...levels) };
  };
  const expected = (fc) => db((0.08 * biquadMag('lowpass', fc, Math.SQRT1_2, 1000)) / Math.SQRT2);
  const start = T.runtime.start();
  const deep = await envelope(start.at + 0.1, 2.05);
  b.edge(mod, { depth: 400 });
  const r1 = b.apply();
  const shallow = await envelope(r1.at + 0.1, 2.05);
  b.edge(mod, { muted: true });
  const r2 = b.apply();
  const muted = await envelope(r2.at + 0.2, 1.0);
  const done = T.runtime.stop();
  await wait(0.15);
  await done;
  const stopped = await settle();
  return {
    deep, shallow, muted,
    expected: {
      deep: { max: expected(1800), min: expected(200) },
      shallow: { max: expected(1400), min: expected(600) },
      muted: expected(1000),
    },
    ops: [r1.ops, r2.ops],
    stopped,
  };
};

// ---------------------------------------------------------------- §213 leak test
T.leak = async (cycles = 3) => {
  const out = { cycles: [], applied: [] };
  for (let cycle = 0; cycle < cycles; cycle++) {
    const b = studio();
    const ids = {};
    ids.osc = b.add('oscillator', { waveform: 'sine', frequency: 220 });
    ids.gain = b.add('gain', { gain: 0.5 });
    ids.filter = b.add('filter', { frequency: 1200 });
    ids.master = b.add('master', { level: 0.08 });
    b.connect(ids.osc, 'audio', ids.gain, 'audio');
    b.connect(ids.gain, 'audio', ids.filter, 'audio');
    ids.eFM = b.connect(ids.filter, 'audio', ids.master, 'audio');
    b.apply();
    T.runtime.start();
    let lfo; let noise; let mix; let spec;
    const edits = [
      () => b.set(ids.filter, 'frequency', 2000),
      () => {
        lfo = b.add('lfo', { rate: 3 });
        b.connect(lfo, 'control', ids.filter, 'frequency', { depth: 500 });
      },
      () => b.set(ids.osc, 'waveform', 'square'),
      () => { spec = b.add('spectrum'); b.connect(ids.gain, 'audio', spec, 'audio'); },
      () => b.set(ids.gain, 'gain', 0.3),
      () => b.set(ids.filter, 'type', 'highpass'),
      () => b.set(lfo, 'shape', 'triangle'),
      () => {
        noise = b.add('noise', { level: 0.2 });
        mix = b.add('mixer');
        b.connect(noise, 'audio', mix, 'in1');
      },
      () => { b.removeEdge(ids.eFM); b.connect(ids.filter, 'audio', mix, 'in2'); },
      () => b.connect(mix, 'audio', ids.master, 'audio'),
      () => b.set(noise, 'color', 'pink'),
      () => b.remove(spec),
      () => b.set(ids.osc, 'frequency', 330),
      () => b.remove(lfo),
      () => { b.remove(ids.filter); b.connect(ids.gain, 'audio', mix, 'in2'); },
      () => b.set(mix, 'level1', 0.2),
      () => b.remove(noise),
      () => b.set(ids.osc, 'waveform', 'triangle'),
      () => {
        const r = b.add('random');
        b.connect(r, 'control', ids.osc, 'frequency', { depth: 30 });
      },
      () => b.set(ids.master, 'level', 0.06),
    ];
    let applied = 0;
    for (const edit of edits) {
      edit();
      if (b.apply().applied) applied += 1;
      await wait(0.03);
    }
    const peak = T.counts();
    const done = T.runtime.stop();
    await wait(0.15);
    await done;
    const after = await settle();
    out.applied.push(applied);
    out.cycles.push({ peak, after });
  }
  return out;
};

// ---------------------------------------------------------------- clicks
T.clicks = async () => {
  const sr = T.engine.ctx.sampleRate;
  const f = 110;
  const level = 0.08;
  const slope = (2 * Math.PI * f * level) / sr;
  const out = {};
  const measure = async (name, setup, act) => {
    const takes = [];
    for (let k = 0; k < 3; k++) {
      const ctx = await setup();
      await wait(0.25);
      const at = await act(ctx);
      await until(at + 0.2);
      const s = maxStep(at - 0.05, at + 0.15);
      takes.push({ ratio: +(s.maxStep / slope).toFixed(2), n: s.n, gaps: s.gaps,
        stepAtMs: Math.round((s.stepAt - at) * 1000) });
      const done = T.runtime.stop();
      await wait(0.1);
      await done;
      await settle();
    }
    const ratios = takes.map((x) => x.ratio).sort((p, q) => p - q);
    out[name] = { ratio: ratios[1], n: Math.min(...takes.map((x) => x.n)), takes };
  };
  const fanOut = () => {
    const b = studio();
    const ids = {};
    ids.osc = b.add('oscillator', { waveform: 'sine', frequency: f });
    ids.a = b.add('gain', { gain: 1 });
    ids.b = b.add('gain', { gain: 1 });
    ids.lp = b.add('filter', { type: 'lowpass', frequency: 12000 });
    ids.master = b.add('master', { level });
    b.connect(ids.osc, 'audio', ids.a, 'audio');
    b.connect(ids.osc, 'audio', ids.b, 'audio');
    b.connect(ids.osc, 'audio', ids.lp, 'audio');
    ids.toMaster = b.connect(ids.a, 'audio', ids.master, 'audio');
    b.apply();
    T.runtime.start();
    return { b, ids };
  };
  await measure('reconnect', fanOut, ({ b, ids }) => {
    b.removeEdge(ids.toMaster);
    b.connect(ids.b, 'audio', ids.master, 'audio');
    return b.apply().at;
  });
  await measure('reconnectThroughFilter', fanOut, ({ b, ids }) => {
    b.removeEdge(ids.toMaster);
    b.connect(ids.lp, 'audio', ids.master, 'audio');
    return b.apply().at;
  });
  await measure('insertFilter', fanOut, ({ b, ids }) => {
    // remove the a → master route, route a → new filter → master (node + 2 edges)
    b.removeEdge(ids.toMaster);
    const flt = b.add('filter', { type: 'lowpass', frequency: 10000 });
    b.connect(ids.a, 'audio', flt, 'audio');
    b.connect(flt, 'audio', ids.master, 'audio');
    return b.apply().at;
  });
  await measure('waveformReplace', fanOut, ({ b, ids }) => {
    b.set(ids.osc, 'waveform', 'triangle');
    return b.apply().at;
  });
  await measure('mute', fanOut, ({ b, ids }) => {
    b.edge(ids.toMaster, { muted: true });
    return b.apply().at;
  });
  await measure('stop', fanOut, () => {
    const t = now();
    T.runtime.stop();
    return t + 0.02;
  });
  out.final = T.counts();
  return out;
};
