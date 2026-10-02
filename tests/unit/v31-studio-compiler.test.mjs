// V3.1 Studio graph compiler and incremental runtime (src/js/studio/compiler.js, runtime.js,
// adapters/*.js) on the real AudioEngine with a recording fake AudioContext. Spec §41-§46,
// §170-§171, §177-§179, §186-§190, §240-§242, §257-§258. Plan issues V414, V415.
//   node --test tests/unit/v31-studio-compiler.test.mjs
//
// The fake context records every node, connection, disconnection and AudioParam call, fires
// `ended` when its clock passes a source's stop time, and shares one virtual clock with the
// engine's timers, so plans, patches, crossfade schedules and cleanup are asserted exactly.
// Real rendering (signal, modulation, clicks, leaks) is tests/browser/v31-studio-audio.cjs.
// Tolerances: 1e-9 for times and gains computed from sums of binary fractions (render-quantum
// arithmetic), exact everywhere else.

import test from 'node:test';
import assert from 'node:assert';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { MIC_UNAVAILABLE_TEXT } from '../../src/js/audio/microphone.js';
import { DEFAULT_GAIN } from '../../src/js/core/constants.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { STUDIO_KIND, normalizeStudio } from '../../src/js/studio/schema.js';
import {
  CLEANUP_MARGIN_S, EMPTY_PLAN, ROUTE_FLOOR, STUDIO_XFADE_S, compileStudio, computeBases, diffPlans,
} from '../../src/js/studio/compiler.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { createRamp } from '../../src/js/studio/adapters/ramp.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';

const EPS = 1e-9;

// ---------------------------------------------------------------- fake Web Audio

class Param {
  constructor(ctx, value) {
    this.ctx = ctx;
    this.value = value;
    this.calls = [];
  }

  setValueAtTime(v, t) { this._rec('set', v, t); }
  linearRampToValueAtTime(v, t) { this._rec('linear', v, t); }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v}`);
    this._rec('exp', v, t);
  }

  setTargetAtTime(v, t, tau) { this._rec('target', v, t, tau); }
  cancelScheduledValues(t) { this._rec('cancel', null, t); }

  _rec(kind, v, t, tau) {
    if ((v !== null && !Number.isFinite(v)) || !Number.isFinite(t) || t < 0) {
      throw new TypeError(`bad automation ${kind} ${v} at ${t}`);
    }
    this.calls.push({ kind, v, t, tau });
    if (kind !== 'cancel') this.value = v;
  }

  last(kind) {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      if (this.calls[i].kind === kind) return this.calls[i];
    }
    return null;
  }
}

class Node {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.context = ctx;
    this.kind = kind;
    this.out = new Set();
    this.channelCount = 2;
    this.channelCountMode = 'max';
    this.channelInterpretation = 'speakers';
    ctx.created.push(this);
  }

  connect(dest) {
    if (!dest) throw new TypeError('connect to nothing');
    this.out.add(dest);
    this.ctx.connections += 1;
    return dest;
  }

  disconnect(dest) {
    if (dest === undefined) {
      this.ctx.disconnections += this.out.size;
      this.out.clear();
      return;
    }
    if (!this.out.has(dest)) throw new Error('InvalidAccessError: not connected');
    this.out.delete(dest);
    this.ctx.disconnections += 1;
  }
}

class Source extends Node {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startAt = null;
    this.stopAt = null;
    this.ended = false;
    this.listeners = [];
    this.onended = null;
  }

  start(t = 0) {
    if (this.startAt !== null) throw new Error('InvalidStateError: start twice');
    this.startAt = t;
  }

  stop(t = 0) {
    if (this.startAt === null) throw new Error('InvalidStateError: stop before start');
    this.stopAt = this.stopAt === null ? t : Math.min(this.stopAt, t);
    if (t <= this.ctx.currentTime) this.ctx.pendingEnd.add(this);
  }

  addEventListener(type, fn) { if (type === 'ended') this.listeners.push(fn); }
  removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }

  fireEnded() {
    if (this.ended) return;
    this.ended = true;
    for (const fn of [...this.listeners]) fn({ type: 'ended', target: this });
    if (this.onended) this.onended({ type: 'ended', target: this });
  }
}

class FakeContext {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.created = [];
    this.connections = 0;
    this.disconnections = 0;
    this.pendingEnd = new Set();
    this.failNext = null;
    this.destination = new Node(this, 'destination');
    this.onstatechange = null;
  }

  _maybeFail(name) {
    if (this.failNext === name) {
      this.failNext = null;
      throw new Error(`injected failure in ${name}`);
    }
  }

  createGain() {
    this._maybeFail('createGain');
    const n = new Node(this, 'gain');
    n.gain = new Param(this, 1);
    return n;
  }

  createOscillator() {
    this._maybeFail('createOscillator');
    const n = new Source(this, 'oscillator');
    n.type = 'sine';
    n.frequency = new Param(this, 440);
    n.detune = new Param(this, 0);
    n.setPeriodicWave = (w) => { n.wave = w; };
    return n;
  }

  createBiquadFilter() {
    this._maybeFail('createBiquadFilter');
    const n = new Node(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = new Param(this, 350);
    n.Q = new Param(this, 1);
    n.gain = new Param(this, 0);
    n.detune = new Param(this, 0);
    n.getFrequencyResponse = (f, mag, ph) => { mag.fill(1); ph.fill(0); };
    return n;
  }

  createBufferSource() {
    const n = new Source(this, 'buffer-source');
    n.buffer = null;
    n.loop = false;
    n.loopStart = 0;
    n.loopEnd = 0;
    n.playbackRate = new Param(this, 1);
    n.detune = new Param(this, 0);
    return n;
  }

  createConstantSource() {
    const n = new Source(this, 'constant-source');
    n.offset = new Param(this, 1);
    return n;
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: (c) => data[c], copyToChannel: (src, c) => data[c].set(src) };
  }

  createStereoPanner() {
    const n = new Node(this, 'panner');
    n.pan = new Param(this, 0);
    return n;
  }

  createAnalyser() {
    const n = new Node(this, 'analyser');
    n.fftSize = 2048;
    Object.defineProperty(n, 'frequencyBinCount', { get: () => n.fftSize / 2 });
    n.smoothingTimeConstant = 0.8;
    n.minDecibels = -100;
    n.maxDecibels = -30;
    n.getFloatFrequencyData = (a) => a.fill(-100);
    n.getFloatTimeDomainData = (a) => a.fill(0);
    return n;
  }

  createDynamicsCompressor() {
    const n = new Node(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(this, 0);
    return n;
  }

  createWaveShaper() {
    const n = new Node(this, 'waveshaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }

  createChannelMerger() { return new Node(this, 'merger'); }
  createChannelSplitter() { return new Node(this, 'splitter'); }
  createPeriodicWave(real, imag) { return { real, imag }; }

  createMediaStreamSource(stream) {
    const n = new Node(this, 'media-stream-source');
    n.stream = stream;
    return n;
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() {
    this.state = 'closed';
    if (this.onstatechange) this.onstatechange();
    return Promise.resolve();
  }

  // ---- test helpers
  get sources() { return this.created.filter((n) => n instanceof Source); }
  get liveSources() { return this.sources.filter((s) => s.startAt !== null && !s.ended).length; }
  get liveConnections() { return this.created.reduce((n, x) => n + x.out.size, 0); }
  of(kind) { return this.created.filter((n) => n.kind === kind); }
}

/** Shared virtual clock: engine timers (ms) follow the audio clock (s). */
function makeEnv(opts = {}) {
  let id = 0;
  const pending = new Map();
  let ctx = null;
  const env = {
    AudioContext: class extends FakeContext {
      constructor() {
        super(opts);
        ctx = this; // eslint-disable-line consistent-this
      }
    },
    setTimeout(fn, ms) {
      id += 1;
      pending.set(id, { fn, at: (ctx ? ctx.currentTime * 1000 : 0) + Math.max(0, ms) });
      return id;
    },
    clearTimeout(i) { pending.delete(i); },
    navigator: opts.navigator || {},
  };
  const advance = (seconds) => {
    const end = ctx.currentTime + seconds;
    const step = 0.005;
    while (ctx.currentTime < end - 1e-12) {
      ctx.currentTime = Math.min(end, ctx.currentTime + step);
      for (const s of ctx.sources) {
        if (!s.ended && s.stopAt !== null && s.stopAt <= ctx.currentTime) s.fireEnded();
      }
      let fired = true;
      while (fired) {
        fired = false;
        for (const [i, p] of [...pending]) {
          if (p.at <= ctx.currentTime * 1000 + 1e-6) {
            pending.delete(i);
            p.fn();
            fired = true;
          }
        }
      }
    }
  };
  return { env, advance, get ctx() { return ctx; }, timers: pending };
}

function setup(opts = {}) {
  const e = makeEnv(opts);
  const engine = new AudioEngine({ env: e.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine, options: opts.runtime || {} });
  return { ...e, engine, runtime, ctx: e.ctx };
}

// ---------------------------------------------------------------- model fixtures

function newStore(model = null) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

function builder(store) {
  const ok = (r) => {
    assert.ok(r.ok, r.reason);
    return r;
  };
  return {
    add: (nodeType, extra = {}) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
      position: { x: 0, y: 0 }, ...extra })).created.nodes[0],
    connect: (from, fromPort, to, toPort, props) => ok(store.dispatch({ type: 'EDGE_ADD',
      from: { node: from, port: fromPort }, to: { node: to, port: toPort }, props }))
      .created.edges[0],
    remove: (nodeId) => ok(store.dispatch({ type: 'NODE_REMOVE', nodeId })),
    removeEdge: (edgeId) => ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId })),
    set: (nodeId, key, value) => ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId, key,
      value })),
    edge: (edgeId, props) => ok(store.dispatch({ type: 'EDGE_UPDATE', edgeId, props })),
    ok,
  };
}

/** §257 Basic Synth: OSC → ADSR → FILTER → MASTER; LFO → FILTER cutoff (depth 1200, bipolar). */
function basicSynth() {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const env = b.add('envelope');
  const filter = b.add('filter', { params: { frequency: 2400 } });
  const master = b.add('master');
  const lfo = b.add('lfo', { params: { rate: 0.5 } });
  const e1 = b.connect(osc, 'audio', env, 'audio');
  const e2 = b.connect(env, 'audio', filter, 'audio');
  const e3 = b.connect(filter, 'audio', master, 'audio');
  const e4 = b.connect(lfo, 'control', filter, 'frequency', { depth: 1200, polarity: 'bipolar' });
  return { store, b, ids: { osc, env, filter, master, lfo, e1, e2, e3, e4 } };
}

/** §258 Measurement: Sweep → Master; Sweep reference → TA; Microphone → Calibration → TA. */
function measurementChain() {
  const store = newStore();
  const b = builder(store);
  const sweep = b.add('sweep', { params: { duration: 2 } });
  const master = b.add('master');
  const mic = b.add('microphone');
  const cal = b.add('calibration');
  const ta = b.add('transfer-analyzer');
  const result = b.add('measurement-result');
  b.connect(sweep, 'audio', master, 'audio');
  b.connect(sweep, 'reference', ta, 'reference');
  b.connect(mic, 'capture', cal, 'observed');
  b.connect(cal, 'observed', ta, 'observed');
  b.connect(ta, 'result', result, 'result');
  return { store, b, ids: { sweep, master, mic, cal, ta, result } };
}

/** OSC → GAIN → FILTER → MASTER (§209). */
function chain() {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator', { params: { waveform: 'sawtooth', frequency: 220 } });
  const gain = b.add('gain', { params: { gain: 0.5 } });
  const filter = b.add('filter', { params: { frequency: 1000 } });
  const master = b.add('master');
  const eOG = b.connect(osc, 'audio', gain, 'audio');
  const eGF = b.connect(gain, 'audio', filter, 'audio');
  const eFM = b.connect(filter, 'audio', master, 'audio');
  return { store, b, ids: { osc, gain, filter, master, eOG, eGF, eFM } };
}

const rawModel = (nodes, edges = []) => normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1,
  graph: { nodes, edges } });
const n = (id, type, params = {}) => ({ id, type, position: { x: 0, y: 0 }, params });
const e = (id, from, fromPort, to, toPort, props) => ({ id, from: { node: from, port: fromPort },
  to: { node: to, port: toPort }, ...(props ? { props } : {}) });

/** Every node the Studio created (not the engine's chain, not the destination). */
const studioNodes = (s, chainCount) => s.ctx.created.slice(chainCount);
const ENGINE_CHAIN_NODES = 6; // destination, master, limiter, trim, ceiling, analyser

// ---------------------------------------------------------------- compile (§41, §257, §258)

test('§257 Basic Synth compiles to a deterministic plan without creating audio nodes', () => {
  const { store, ids } = basicSynth();
  const s = setup();
  const before = s.ctx.created.length;
  const plan = compileStudio(store.getModel(), { engine: s.engine });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(s.ctx.created.length, before, 'compiling is pure');
  assert.deepStrictEqual(plan.order, [ids.osc, ids.env, ids.lfo, ids.filter, ids.master]);
  assert.deepStrictEqual(compileStudio(store.getModel(), { engine: s.engine }).order, plan.order);
  for (const pn of plan.nodes.values()) assert.strictEqual(pn.status, 'ready', pn.id);
  assert.strictEqual(plan.masterId, ids.master);
  const kinds = plan.edgeOrder.map((id) => plan.edges.get(id).kind);
  assert.deepStrictEqual(kinds.sort(), ['audio', 'audio', 'audio', 'control']);
  const mod = plan.edges.get(ids.e4);
  assert.deepStrictEqual({ ...mod.props }, { muted: false, depth: 1200, polarity: 'bipolar',
    mapping: 'linear', offset: 0 });
  assert.strictEqual(mod.paramDef.key, 'frequency');
  // every adapter implements the registry's compiler key
  for (const def of NODE_REGISTRY.list()) {
    assert.ok(NODE_ADAPTERS[def.type], `adapter for ${def.type}`);
    assert.strictEqual(NODE_ADAPTERS[def.type].compiler, def.compiler, def.type);
  }
});

test('§258 Measurement compiles; Microphone degrades with a reason under file:// (§171)', () => {
  const { store, ids } = measurementChain();
  const s = setup(); // navigator without mediaDevices, as Chromium on file://
  const plan = compileStudio(store.getModel(), { engine: s.engine });
  assert.strictEqual(plan.ok, true);
  const st = (id) => plan.nodes.get(id).status;
  assert.strictEqual(st(ids.sweep), 'ready');
  assert.strictEqual(st(ids.master), 'ready');
  assert.strictEqual(st(ids.mic), 'degraded');
  assert.strictEqual(plan.nodes.get(ids.mic).reason, MIC_UNAVAILABLE_TEXT);
  for (const id of [ids.cal, ids.ta, ids.result]) assert.strictEqual(st(id), 'data');
  const byPorts = (from, to) => [...plan.edges.values()].find((x) => x.from.node === from
    && x.to.node === to);
  assert.strictEqual(byPorts(ids.sweep, ids.master).status, 'active');
  assert.strictEqual(byPorts(ids.sweep, ids.ta).status, 'data');
  assert.strictEqual(byPorts(ids.mic, ids.cal).status, 'inactive');
  assert.match(byPorts(ids.mic, ids.cal).reason, /Microphone/);
  assert.strictEqual(byPorts(ids.ta, ids.result).status, 'data');
  // Started, the measurement graph plays the exact digital reference (§191).
  s.runtime.apply(store.getModel());
  assert.strictEqual(s.runtime.start().ok, true);
  const sweep = s.runtime.nodes.get(ids.sweep);
  assert.ok(sweep.info.reference && sweep.info.reference.samples.length === 2 * 48000);
  assert.strictEqual(s.ctx.of('buffer-source')[0].buffer.length, 2 * 48000);
  const mic = s.runtime.nodes.get(ids.mic);
  assert.strictEqual(mic.status, 'degraded');
  assert.strictEqual(mic.nodes.size, 0);
  assert.deepStrictEqual(s.runtime.bindings().data.map((x) => x.status).sort(),
    ['data', 'data', 'data', 'inactive']);
  const dbg = s.runtime.debugInfo();
  assert.deepStrictEqual(dbg.degraded.map((x) => x.id), [ids.mic]);
});

test('invalid models are refused before Web Audio; the runtime keeps its last graph (§179)', () => {
  const s = setup();
  const good = chain();
  assert.strictEqual(s.runtime.apply(good.store.getModel()).ok, true);
  assert.strictEqual(s.runtime.start().ok, true);
  const created = s.ctx.created.length;
  const revision = s.runtime.revision;
  const handles = [...s.runtime.nodes.values()];
  const bad = [
    ['audio-feedback', rawModel([n('m', 'mixer'), n('f', 'filter'), n('g', 'gain')],
      [e('a', 'm', 'audio', 'f', 'audio'), e('b', 'f', 'audio', 'g', 'audio'),
        e('c', 'g', 'audio', 'm', 'in2')])],
    ['too-many-instances', rawModel([n('m1', 'master'), n('m2', 'master')])],
    ['live-input-to-output', rawModel([n('mic', 'microphone'), n('m', 'master')],
      [e('a', 'mic', 'audio', 'm', 'audio')])],
    ['control-cycle', rawModel([n('l1', 'lfo'), n('l2', 'lfo')],
      [e('a', 'l1', 'control', 'l2', 'rate'), e('b', 'l2', 'control', 'l1', 'rate')])],
    ['multiple-connections', rawModel([n('o1', 'oscillator'), n('o2', 'oscillator'),
      n('m', 'master')], [e('a', 'o1', 'audio', 'm', 'audio'), e('b', 'o2', 'audio', 'm',
      'audio')])],
  ];
  for (const [code, model] of bad) {
    const plan = compileStudio(model, { engine: s.engine });
    assert.strictEqual(plan.ok, false, code);
    assert.ok(plan.errors.some((d) => d.code === code), `${code}: ${plan.errors.map((d) =>
      d.code)}`);
    const r = s.runtime.apply(model);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.phase, 'validate');
    assert.strictEqual(s.runtime.lastError.phase, 'validate');
  }
  assert.strictEqual(compileStudio({ nonsense: true }, { engine: s.engine }).ok, false);
  assert.strictEqual(s.ctx.created.length, created, 'no node was created');
  assert.strictEqual(s.runtime.revision, revision);
  assert.deepStrictEqual([...s.runtime.nodes.values()], handles);
});

// ---------------------------------------------------------------- output safety (§186, §240)

test('Master Output feeds only the engine safety chain; nothing reaches destination', () => {
  const { store, ids } = basicSynth();
  const b = builder(store);
  const spec = b.add('spectrum');
  b.connect(ids.filter, 'audio', spec, 'audio');
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  const mine = new Set(studioNodes(s, ENGINE_CHAIN_NODES));
  assert.ok(mine.size > 10);
  // The only connection from a Studio node to a non-Studio node is the bus into engine.master.
  const outside = [];
  for (const node of mine) {
    for (const d of node.out) if (d instanceof Node && !mine.has(d)) outside.push([node, d]);
  }
  assert.strictEqual(outside.length, 1);
  assert.strictEqual(outside[0][1], s.engine.master);
  assert.strictEqual(outside[0][0], s.runtime.nodes.get(ids.master).info.bus);
  // The destination is fed only by the engine's analyser (end of the chain).
  const intoDest = s.ctx.created.filter((x) => x.out.has(s.ctx.destination));
  assert.deepStrictEqual(intoDest, [s.engine.analyser]);
  // Accounting: every Studio node is in engine.nodes, and the counts agree.
  for (const node of mine) assert.ok(s.engine.nodes.has(node), node.kind);
  assert.strictEqual(s.engine.activeNodeCount, mine.size);
  assert.strictEqual(s.runtime.debugInfo().runtimeNodeCount, mine.size);
  assert.strictEqual(s.engine.activeSourceCount, s.ctx.liveSources);
  // The analysis tap has no output: a side-chain that cannot alter the path (§190).
  const analyser = s.runtime.nodes.get(spec).info.analyser;
  assert.strictEqual(analyser.out.size, 0);
  // Fan-out (§189): the filter output feeds two edge gains.
  assert.strictEqual(s.runtime.nodes.get(ids.filter).outputs.audio.out.size, 2);
  // The Master Output level is the engine's logical master gain.
  assert.strictEqual(s.engine.gainLevel, DEFAULT_GAIN);
});

test('LFO → cutoff binds the real AudioParam with edge depth and polarity (§35, §210)', () => {
  const { store, b, ids } = basicSynth();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  const biquad = s.runtime.nodes.get(ids.filter).info.stage.node;
  const edge = s.runtime.edges.get(ids.e4);
  assert.ok(edge.gain.out.has(biquad.frequency), 'depth gain drives biquad.frequency');
  assert.ok(s.runtime.nodes.get(ids.lfo).outputs.control.out.has(edge.gain));
  assert.ok(Math.abs(edge.ramp.target - 1200) < EPS, 'bipolar ±1 → ±1200 Hz');
  assert.strictEqual(biquad.frequency.last('target').v, 2400);
  // unipolar: 0..+1200 Hz → gain 600 and base + 600
  b.edge(ids.e4, { polarity: 'unipolar' });
  const r = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r.ops, [{ op: 'edge-props', id: ids.e4, keys: ['polarity'] }]);
  assert.ok(Math.abs(edge.ramp.target - 600) < EPS);
  assert.strictEqual(biquad.frequency.last('target').v, 3000);
  // log mapping: octaves on the biquad's detune (cents), a new route (rewire)
  s.advance(0.05);
  b.edge(ids.e4, { polarity: 'bipolar', mapping: 'log', depth: 1, offset: 0.5 });
  const r2 = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r2.ops, [{ op: 'edge-rewire', id: ids.e4 }]);
  const logEdge = s.runtime.edges.get(ids.e4);
  assert.notStrictEqual(logEdge, edge);
  assert.ok(logEdge.gain.out.has(biquad.detune));
  assert.ok(Math.abs(logEdge.ramp.target - 1200) < EPS);
  assert.strictEqual(biquad.detune.last('target').v, 600);
  assert.strictEqual(biquad.frequency.last('target').v, 2400);
  // the old route fades to 0 at the same time the new one fades in (crossfade)
  const up = logEdge.gain.gain.last('linear');
  const down = edge.gain.gain.last('linear');
  assert.strictEqual(up.v, 1200);
  assert.strictEqual(down.v, 0, 'a modulation route fades to exactly 0');
  assert.ok(Math.abs(up.t - down.t) < EPS);
});

test('computeBases: unipolar contour, offsets, several edges and the Nyquist clamp', () => {
  const filterDef = NODE_REGISTRY.get('filter');
  const plan = { def: filterDef, params: { type: 'lowpass', frequency: 20000, Q: 0.7, gain: 0,
    enabled: true } };
  const edge = (id, props, port = 'frequency') => ({ edge: { id, kind: 'control',
    to: { node: 'f', port }, props: { muted: false, polarity: 'bipolar', mapping: 'linear',
      offset: 0, ...props } }, handle: { status: 'active', range: [-1, 1], scale: 1 } });
  const hooks = { safeMaximum: 22800 };
  // 20 kHz ± 10 kHz would exceed 0.95 × Nyquist (22.8 kHz at 48 kHz): excursion scaled to 2.8 kHz
  const r = computeBases(plan, [edge('a', { depth: 10000 })], hooks);
  assert.ok(Math.abs(r.gains.get('a') - 2800) < 1e-6);
  assert.ok(r.limited.has('a'));
  // two edges add; muted contributes nothing
  const plan2 = { ...plan, params: { ...plan.params, frequency: 1000 } };
  const r2 = computeBases(plan2, [edge('a', { depth: 200, offset: 50 }),
    edge('b', { depth: 100, polarity: 'unipolar' }), edge('c', { depth: 900, muted: true })],
  hooks);
  assert.strictEqual(r2.base.frequency.value, 1000 + 50 + 50);
  assert.strictEqual(r2.gains.get('a'), 200);
  assert.strictEqual(r2.gains.get('b'), 50);
  assert.strictEqual(r2.gains.get('c'), 0);
  assert.strictEqual(r2.limited.size, 0);
  // an Envelope contour (0..1) as bipolar ±400 Hz: gain 800, base − 400
  const env = edge('d', { depth: 400 });
  env.handle.range = [0, 1];
  const r3 = computeBases(plan2, [env], hooks);
  assert.strictEqual(r3.gains.get('d'), 800);
  assert.strictEqual(r3.base.frequency.value, 600);
  // log mapping: cents, and the octave excursion is clamped to the Nyquist room
  const lg = edge('e', { depth: 4, mapping: 'log' });
  lg.handle.scale = 1200;
  const r4 = computeBases(plan2, [lg], hooks);
  assert.strictEqual(r4.gains.get('e'), 4800);
  const r5 = computeBases(plan, [lg], hooks);
  const room = 1200 * Math.log2(22800 / 20000);
  assert.ok(Math.abs(r5.gains.get('e') - room) < 1e-6);
  // a gain parameter may exceed its range through modulation: reported, not clamped (§242)
  const gainDef = NODE_REGISTRY.get('gain');
  const r6 = computeBases({ def: gainDef, params: { gain: 1.8 } },
    [edge('g', { depth: 0.5 }, 'gain')], hooks);
  assert.strictEqual(r6.gains.get('g'), 0.5);
  assert.deepStrictEqual(r6.exceeds, ['gain']);
});

// ---------------------------------------------------------------- diff and patch (§44-§45)

test('diff: a parameter change updates the existing node, nothing is rebuilt', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  const created = s.ctx.created.length;
  const filter = s.runtime.nodes.get(ids.filter);
  b.set(ids.filter, 'frequency', 3000);
  const r = s.runtime.apply(store.getModel(), { revision: store.getRevision() });
  assert.deepStrictEqual(r.ops, [{ op: 'node-params', id: ids.filter, keys: ['frequency'] }]);
  assert.strictEqual(s.ctx.created.length, created);
  assert.strictEqual(s.runtime.nodes.get(ids.filter), filter);
  const call = filter.info.stage.node.frequency.last('target');
  assert.strictEqual(call.v, 3000);
  assert.ok(call.tau > 0, 'smoothed (setTargetAtTime)');
  assert.strictEqual(s.runtime.revision, store.getRevision());
  // a non-modulatable live key goes through the builder (crossfaded bypass)
  b.set(ids.filter, 'enabled', false);
  assert.deepStrictEqual(s.runtime.apply(store.getModel()).ops,
    [{ op: 'node-params', id: ids.filter, keys: ['enabled'] }]);
  assert.strictEqual(filter.info.stage.config.enabled, false);
  // the master level goes to the engine's logical master gain
  b.set(ids.master, 'level', 0.05);
  s.runtime.apply(store.getModel());
  assert.strictEqual(s.engine.gainLevel, 0.05);
  assert.strictEqual(s.ctx.created.length, created);
});

test('diff: node and edge additions create only the new parts; routes fade in', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  const created = s.ctx.created.length;
  const spec = b.add('spectrum');
  const tap = b.connect(ids.gain, 'audio', spec, 'audio');
  const r = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r.ops, [{ op: 'node-add', id: spec }, { op: 'edge-add', id: tap }]);
  assert.strictEqual(s.ctx.created.length - created, 2, 'one analyser, one edge gain');
  const eh = s.runtime.edges.get(tap);
  const calls = eh.gain.gain.calls;
  assert.deepStrictEqual(calls.map((c) => c.kind), ['set', 'set', 'linear']);
  assert.strictEqual(calls[0].v, 0);
  assert.strictEqual(calls[2].v, 1);
  assert.ok(Math.abs(calls[2].t - calls[1].t - STUDIO_XFADE_S) < EPS);
  assert.ok(calls[1].t > s.ctx.currentTime, 'scheduled ahead on the audio clock');
  // removing the edge only: one op, the route fades out, disconnection waits for the fade
  b.removeEdge(tap);
  const r2 = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r2.ops, [{ op: 'edge-remove', id: tap }]);
  assert.strictEqual(eh.gain.gain.last('linear').v, ROUTE_FLOOR);
  assert.ok(s.runtime.nodes.get(ids.gain).outputs.audio.out.has(eh.gain), 'still connected');
  s.advance(STUDIO_XFADE_S + CLEANUP_MARGIN_S + 0.05);
  assert.ok(!s.runtime.nodes.get(ids.gain).outputs.audio.out.has(eh.gain), 'disconnected');
  assert.ok(!s.engine.nodes.has(eh.gain), 'untracked');
  // removing the node: its (now unconnected) analyser is disposed after the fade
  b.remove(spec);
  assert.deepStrictEqual(s.runtime.apply(store.getModel()).ops, [{ op: 'node-remove', id: spec }]);
  s.advance(0.2);
  assert.strictEqual(s.runtime.debugInfo().pendingCleanups, 0);
  assert.strictEqual(s.engine.activeNodeCount, created - ENGINE_CHAIN_NODES);
});

test('§209 remove the filter: crossfade to the new route, then release the old nodes', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  s.advance(0.1);
  const count = s.engine.activeNodeCount;
  const filter = s.runtime.nodes.get(ids.filter);
  const filterNodes = [...filter.nodes];
  const oldIn = s.runtime.edges.get(ids.eGF);
  const oldOut = s.runtime.edges.get(ids.eFM);
  b.remove(ids.filter);
  const direct = b.connect(ids.gain, 'audio', ids.master, 'audio');
  const r = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r.ops, [{ op: 'node-remove', id: ids.filter },
    { op: 'edge-add', id: direct }, { op: 'edge-remove', id: ids.eGF },
    { op: 'edge-remove', id: ids.eFM }]);
  const add = s.runtime.edges.get(direct).gain.gain.last('linear');
  const rem = oldOut.gain.gain.last('linear');
  assert.strictEqual(add.v, 1);
  assert.strictEqual(rem.v, ROUTE_FLOOR, 'audio routes fade to −80 dB, never to 0');
  assert.ok(Math.abs(add.t - rem.t) < EPS, 'equal-gain crossfade, same window');
  assert.ok(filterNodes.every((x) => s.engine.nodes.has(x)), 'not cut while sounding');
  s.advance(STUDIO_XFADE_S + CLEANUP_MARGIN_S + 0.05);
  assert.ok(filterNodes.every((x) => !s.engine.nodes.has(x)), 'released after the fade');
  assert.ok(filterNodes.every((x) => x.out.size === 0), 'disconnected');
  assert.ok(!oldIn.gain.out.size && !oldOut.gain.out.size);
  // filter stage: 7 nodes and two edge gains go, one edge gain comes
  assert.strictEqual(s.engine.activeNodeCount, count - filterNodes.length - 2 + 1);
  assert.strictEqual(s.runtime.nodes.has(ids.filter), false);
});

test('diff: a structural change replaces the node and rewires its edges with a crossfade', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  s.advance(0.1);
  const oldOsc = s.runtime.nodes.get(ids.osc);
  const oscNode = oldOsc.info.oscillator;
  b.set(ids.osc, 'waveform', 'square');
  const r = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r.ops, [{ op: 'node-replace', id: ids.osc, keys: ['waveform'] },
    { op: 'edge-rewire', id: ids.eOG }]);
  const newOsc = s.runtime.nodes.get(ids.osc);
  assert.notStrictEqual(newOsc, oldOsc);
  assert.strictEqual(newOsc.info.oscillator.type, 'square');
  assert.strictEqual(oscNode.type, 'sawtooth', 'OscillatorNode.type is never switched live');
  assert.ok(Math.abs(oscNode.stopAt - (r.at + STUDIO_XFADE_S + 0.01)) < EPS,
    'old source stops after its route faded');
  assert.ok(newOsc.info.oscillator.startAt >= s.ctx.currentTime);
  s.advance(0.2);
  assert.ok(oscNode.ended && oscNode.out.size === 0 && !s.engine.sources.has(oscNode));
  assert.strictEqual(s.engine.activeSourceCount, 1);
});

test('diff: edge props and mute ramp the existing route only', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  const created = s.ctx.created.length;
  b.edge(ids.eFM, { muted: true });
  const r = s.runtime.apply(store.getModel());
  assert.deepStrictEqual(r.ops, [{ op: 'edge-props', id: ids.eFM, keys: ['muted'] }]);
  assert.strictEqual(s.runtime.edges.get(ids.eFM).gain.gain.last('linear').v, ROUTE_FLOOR);
  b.edge(ids.eFM, { muted: false });
  s.runtime.apply(store.getModel());
  assert.strictEqual(s.runtime.edges.get(ids.eFM).gain.gain.last('linear').v, 1);
  assert.strictEqual(s.ctx.created.length, created);
  // the same model again: no operation at all
  assert.deepStrictEqual(s.runtime.apply(store.getModel()).ops, []);
});

test('createRamp re-ends an in-progress ramp on its own line (no jump, ADR 0001)', () => {
  const p = new Param(null, 1);
  const r = createRamp(p, 0, 0, 48000);
  r.to(1, 1, 1); // 0 → 1 over [1, 2]
  r.to(0, 1.5, 0.5); // reverse in the middle
  const calls = p.calls.slice(-3);
  assert.deepStrictEqual(calls.map((c) => c.kind), ['linear', 'cancel', 'linear']);
  assert.strictEqual(calls[0].v, 0.5);
  assert.strictEqual(calls[0].t, 1.5);
  assert.strictEqual(calls[1].t, 2, 'only the old segment end is cancelled');
  assert.strictEqual(calls[2].v, 0);
  // a ramp after the previous one ended anchors the value and cancels nothing
  const p2 = new Param(null, 1);
  const r2 = createRamp(p2, 1, 0, 48000);
  r2.to(0, 0.5, 0.02);
  assert.deepStrictEqual(p2.calls.map((c) => c.kind), ['set', 'set', 'linear']);
  assert.strictEqual(r.valueAt(1.75), 0.25);
  // a second ramp at the same instant moves one render quantum later
  const end = r.to(1, 1.5, 0.1);
  assert.ok(Math.abs(end - (1.5 + 128 / 48000 + 0.1)) < EPS);
});

// ---------------------------------------------------------------- transactions (§46, §179)

test('a failed transaction leaves the previous runtime intact and leaks nothing', () => {
  const { store, b, ids } = chain();
  const s = setup();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  s.advance(0.05);
  const handles = new Map([...s.runtime.nodes.entries()]);
  const edgesBefore = new Map([...s.runtime.edges.entries()]);
  const nodes = s.engine.activeNodeCount;
  const sources = s.engine.activeSourceCount;
  const revision = s.runtime.revision;
  const plan = s.runtime.plan;
  const connections = s.ctx.liveConnections;
  // insert a second filter after the gain; its biquad creation fails mid-prepare
  b.removeEdge(ids.eGF);
  const f2 = b.add('filter');
  b.connect(ids.gain, 'audio', f2, 'audio');
  b.connect(f2, 'audio', ids.filter, 'audio');
  b.set(ids.osc, 'waveform', 'square'); // a replacement is prepared before the failure too
  s.ctx.failNext = 'createBiquadFilter';
  const r = s.runtime.apply(store.getModel());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.phase, 'prepare');
  assert.match(r.errors[0].message, /injected failure/);
  assert.strictEqual(s.runtime.lastError.phase, 'prepare');
  assert.strictEqual(s.runtime.revision, revision);
  assert.strictEqual(s.runtime.plan, plan);
  assert.deepStrictEqual(new Map([...s.runtime.nodes.entries()]), handles);
  assert.deepStrictEqual(new Map([...s.runtime.edges.entries()]), edgesBefore);
  assert.strictEqual(s.engine.activeNodeCount, nodes, 'prepared nodes were released');
  assert.strictEqual(s.engine.activeSourceCount, sources);
  assert.strictEqual(s.ctx.liveConnections, connections, 'never half-connected');
  // the old route is still at full gain (nothing was faded)
  assert.strictEqual(edgesBefore.get(ids.eGF).ramp.target, 1);
  // the same edit applies once the failure is gone
  const ok = s.runtime.apply(store.getModel());
  assert.strictEqual(ok.ok, true);
  assert.ok(s.runtime.nodes.has(f2));
});

// ---------------------------------------------------------------- stop / dispose (§184, §213)

test('stop releases every source and node; PLAY → STOP → PLAY repeats without growth', async () => {
  const { store, ids } = basicSynth();
  const b = builder(store);
  const noise = b.add('noise');
  const mix = b.add('mixer');
  b.connect(noise, 'audio', mix, 'in1');
  const rnd = b.add('random');
  b.connect(rnd, 'control', ids.osc, 'frequency', { depth: 20 });
  const steps = b.add('step-modulator');
  b.connect(steps, 'control', mix, 'level1', { depth: 0.2 });
  const s = setup();
  assert.strictEqual(s.runtime.apply(store.getModel()).ok, true);
  const peaks = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.strictEqual(s.runtime.start().ok, true);
    s.advance(0.3);
    peaks.push([s.engine.activeNodeCount, s.engine.activeSourceCount]);
    const done = s.runtime.stop();
    const bus = s.runtime.debugInfo();
    assert.strictEqual(bus.state, 'idle');
    s.advance(0.2);
    const c = await done;
    assert.deepStrictEqual(c, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
    assert.strictEqual(s.ctx.liveSources, 0, 'every source ended');
    const mine = studioNodes(s, ENGINE_CHAIN_NODES);
    assert.ok(mine.every((x) => x.out.size === 0), 'every Studio node disconnected');
  }
  assert.ok(peaks.every((p) => p[0] === peaks[0][0] && p[1] === peaks[0][1]),
    JSON.stringify(peaks));
  // the stop fades the Studio output on the bus, never cuts the engine chain
  assert.strictEqual(s.engine.master.out.size, 1);
  await s.runtime.dispose();
  assert.strictEqual(s.engine.activeNodeCount, 0);
  assert.strictEqual(s.runtime.apply(store.getModel()).ok, false, 'disposed');
});

test('20 edits during playback then stop: 0 tracked nodes, 0 live sources (§213)', async () => {
  const s = setup();
  const { store, b, ids } = chain();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  let lfo = null;
  let noise = null;
  let mix = null;
  let spec = null;
  const edits = [
    () => b.set(ids.filter, 'frequency', 2000),
    () => {
      lfo = b.add('lfo');
      b.connect(lfo, 'control', ids.filter, 'frequency', { depth: 500 });
    },
    () => b.set(ids.osc, 'waveform', 'square'),
    () => { spec = b.add('spectrum'); b.connect(ids.gain, 'audio', spec, 'audio'); },
    () => b.set(ids.gain, 'gain', 0.3),
    () => b.set(ids.filter, 'type', 'highpass'),
    () => b.set(lfo, 'shape', 'triangle'),
    () => { noise = b.add('noise'); mix = b.add('mixer'); b.connect(noise, 'audio', mix, 'in1'); },
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
    const r = s.runtime.apply(store.getModel());
    assert.ok(r.ok, r.errors && r.errors[0].message);
    if (r.applied) applied++;
    s.advance(0.013);
  }
  assert.strictEqual(applied, 20);
  const done = s.runtime.stop();
  s.advance(0.3);
  const c = await done;
  assert.deepStrictEqual(c, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
  assert.strictEqual(s.ctx.liveSources, 0);
  assert.ok(studioNodes(s, ENGINE_CHAIN_NODES).every((x) => x.out.size === 0));
});

test('a suspended context frees nodes at once; a closed context drops the graph', async () => {
  const s = setup();
  const { store } = chain();
  s.runtime.apply(store.getModel());
  s.runtime.start();
  s.ctx.state = 'suspended';
  await s.runtime.stop();
  assert.strictEqual(s.engine.activeNodeCount, 0);
  s.ctx.state = 'running';
  s.runtime.start();
  assert.ok(s.engine.activeNodeCount > 0);
  s.ctx.close(); // engine._discardContext → 'context' closed
  assert.strictEqual(s.runtime.state, 'idle');
  assert.strictEqual(s.runtime.debugInfo().runtimeNodeCount, 0);
  assert.strictEqual(s.engine.nodes.size, 0);
});

// ---------------------------------------------------------------- degraded, idle, debug

test('Microphone with permission opens the input; without the API it degrades (§171)', async () => {
  const tracks = [{ stopped: false, stop() { this.stopped = true; }, onended: null }];
  const stream = { getTracks: () => tracks };
  const navigator = { mediaDevices: { getUserMedia: async () => stream } };
  const s = setup({ navigator, runtime: { inputPermission: false } });
  const store = newStore();
  const bb = builder(store);
  const mic = bb.add('microphone');
  const sp = bb.add('spectrum');
  bb.connect(mic, 'audio', sp, 'audio');
  s.runtime.apply(store.getModel());
  s.runtime.start();
  assert.strictEqual(s.runtime.nodes.get(mic).status, 'degraded');
  assert.match(s.runtime.nodes.get(mic).reason, /Microphone input is off/);
  const r = s.runtime.setOptions({ inputPermission: true });
  assert.deepStrictEqual(r.ops.map((o) => o.op), ['node-replace', 'edge-rewire']);
  const h = s.runtime.nodes.get(mic);
  assert.strictEqual(h.status, 'pending');
  await new Promise((res) => setImmediate(res));
  assert.strictEqual(h.status, 'ready');
  assert.ok(h.info.analyser);
  const src = s.ctx.of('media-stream-source')[0];
  assert.ok(src.out.has(h.outputs.audio));
  const done = s.runtime.stop();
  s.advance(0.2);
  await done;
  assert.ok(tracks[0].stopped, 'tracks stopped on dispose');
  assert.strictEqual(s.engine.activeNodeCount, 0);
});

test('apply while stopped only stores the plan; debugInfo reports the runtime (§177-§178)', () => {
  const s = setup();
  const { store, b, ids } = chain();
  const created = s.ctx.created.length;
  const r = s.runtime.apply(store.getModel(), { revision: store.getRevision() });
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.ops.length, 7);
  assert.strictEqual(s.ctx.created.length, created);
  assert.strictEqual(s.runtime.revision, store.getRevision());
  s.runtime.start();
  b.set(ids.gain, 'gain', 0.25);
  s.runtime.apply(store.getModel(), { revision: store.getRevision() });
  const d = s.runtime.debugInfo();
  assert.strictEqual(d.state, 'running');
  assert.strictEqual(d.compiledRevision, store.getRevision());
  assert.strictEqual(d.modelNodeCount, 4);
  assert.strictEqual(d.modelEdgeCount, 3);
  assert.strictEqual(d.handleCount, 4);
  assert.strictEqual(d.routedEdgeCount, 3);
  assert.strictEqual(d.runtimeNodeCount, s.engine.activeNodeCount);
  assert.deepStrictEqual(d.lastOps, [{ op: 'node-params', id: ids.gain, keys: ['gain'] }]);
  assert.strictEqual(d.lastError, null);
  assert.deepStrictEqual(d.degraded, []);
  const empty = diffPlans(EMPTY_PLAN, EMPTY_PLAN);
  assert.deepStrictEqual(empty, []);
});

test('unsupported modulation targets compile to inactive routes with a reason (§170)', () => {
  const s = setup();
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator');
  const f = b.add('filter'); // lowpass: Q is a dB AudioParam
  const m = b.add('master');
  const l = b.add('lfo');
  b.connect(osc, 'audio', f, 'audio');
  b.connect(f, 'audio', m, 'audio');
  const q = b.connect(l, 'control', f, 'Q', { depth: 0.5 });
  s.runtime.apply(store.getModel());
  assert.strictEqual(s.runtime.start().ok, true);
  const eh = s.runtime.edges.get(q);
  assert.strictEqual(eh.status, 'inactive');
  assert.match(eh.reason, /dB AudioParam/);
  assert.deepStrictEqual(s.runtime.debugInfo().inactiveEdges.map((x) => x.id), [q]);
  // a band-pass Q is linear: the same edge routes after the replacement
  b.set(f, 'type', 'bandpass');
  const r = s.runtime.apply(store.getModel());
  assert.ok(r.ops.some((o) => o.op === 'node-replace' && o.id === f));
  assert.strictEqual(s.runtime.edges.get(q).status, 'active');
});
