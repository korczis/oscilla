// V3.1 Studio canonical model core: schema, typed ports, node registry, validation and cycle
// policy, action layer and history, import and migration (src/js/studio/*). Spec §9-§11,
// §27-§40, §47-§52, §115, §121-§124, §159-§163, §172-§176, §187-§193, §207-§208, §237-§241,
// §252-§258. Plan issues V404-V408.
//   node --test tests/unit/v31-studio-model.test.mjs
//
// Tolerances: none. Every assertion is exact. The model layer moves plain data without
// arithmetic except integer coordinate offsets (exact in IEEE-754 doubles) and summary text,
// which is formatted from exact decimal inputs; hashes are compared byte for byte.

import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

import {
  DEFAULT_TITLE, STUDIO_KIND, STUDIO_SCHEMA_VERSION, StudioSchemaError, assertPlainData,
  createStudioModel, executionState, isSemanticallyEqual, normalizeStudio, serializeStudio,
  splitExecutionAndView, studioHash,
} from '../../src/js/studio/schema.js';
import {
  DIRECTIONS, PORT_TYPE_LIST, PORT_VISUALS, canConnect, definePort, describePort,
  portAccessibleLabel, typeCompatibility, validateEdgeProps,
} from '../../src/js/studio/ports.js';
import {
  NODE_DEFINITIONS, NODE_REGISTRY, createNodeRegistry, searchNodeTypes, validateNodeDefinition,
  validateParamValue,
} from '../../src/js/studio/registry.js';
import {
  AUDIO_FEEDBACK_MESSAGE, CONTROL_CYCLE_MESSAGE, STUDIO_IMPORT_LIMITS, analyzeCycles,
  validateStudioImport, validateStudioModel,
} from '../../src/js/studio/validate.js';
import {
  ACTION_TYPES, CLIPBOARD_KIND, PASTE_OFFSET, STUDIO_HISTORY_LIMIT, copySubgraph,
  createIdGenerator, createStudioStore,
} from '../../src/js/studio/actions.js';
import { createHistory } from '../../src/js/studio/history.js';
import { importStudio, migrateStudio, studioMigrations } from '../../src/js/studio/migrate.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import { EXPERIMENT_SCHEMA_VERSION } from '../../src/js/experiments/schema.js';
import { DEFAULT_FILTER } from '../../src/js/audio/filters.js';
import { DEFAULT_ADSR } from '../../src/js/audio/envelope.js';
import { DEFAULT_SWEEP } from '../../src/js/audio/patterns.js';
import { DEFAULT_GAIN, MAX_OUTPUT_GAIN } from '../../src/js/core/constants.js';

// ---------------------------------------------------------------- fixtures

const nodeSha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const R = NODE_REGISTRY;
const port = (type, id, dir) => R.port(type, id, dir);

function newStore(model = null, opts = {}) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model), ...opts });
}

/** Store helpers that assert success, so a fixture never silently half-builds. */
function builder(store) {
  const ok = (r) => {
    assert.ok(r.ok, r.reason);
    return r;
  };
  return {
    add: (nodeType, x = 0, y = 0, extra = {}) => ok(store.dispatch({ type: 'NODE_ADD', nodeType,
      position: { x, y }, ...extra })).created.nodes[0],
    connect: (from, fromPort, to, toPort, props) => ok(store.dispatch({ type: 'EDGE_ADD',
      from: { node: from, port: fromPort }, to: { node: to, port: toPort }, props }))
      .created.edges[0],
    track: (kind, target = null, name) => ok(store.dispatch({ type: 'TRACK_ADD', kind, target,
      name })).created.tracks[0],
    clip: (trackId, start, duration, extra = {}) => ok(store.dispatch({ type: 'CLIP_ADD',
      trackId, start, duration, ...extra })).created.clips[0],
    point: (node, param, time, value, curve) => ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD',
      target: { node, param }, time, value, curve })).created.points[0],
    ok,
  };
}

/** §257 Basic Synth: OSC → ADSR → FILTER → MASTER; LFO → FILTER cutoff; Tone, Sweep; cutoff. */
function basicSynth() {
  const store = newStore();
  const b = builder(store);
  const osc = b.add('oscillator', 40, 160);
  const env = b.add('envelope', 240, 160);
  const filter = b.add('filter', 430, 160, { params: { frequency: 2400 } });
  const master = b.add('master', 640, 160);
  const lfo = b.add('lfo', 430, 340, { params: { rate: 0.5 } });
  b.connect(osc, 'audio', env, 'audio');
  b.connect(env, 'audio', filter, 'audio');
  b.connect(filter, 'audio', master, 'audio');
  b.connect(lfo, 'control', filter, 'frequency', { depth: 1200, polarity: 'bipolar' });
  const track = b.track('event', osc, 'Source');
  b.clip(track, 0, 1, { payload: { blockType: 'tone', params: { freq: 440 } } });
  b.clip(track, 1, 2, { payload: { blockType: 'sweep', params: { start: 440, end: 880,
    curve: 'log' } } });
  b.point(filter, 'frequency', 0, 500, 'linear');
  b.point(filter, 'frequency', 3, 8000, 'exponential');
  return { store, ids: { osc, env, filter, master, lfo, track } };
}

/** §258 Measurement: Sweep → Master; Sweep reference → TA; Microphone → Calibration → TA. */
function measurementChain() {
  const store = newStore();
  const b = builder(store);
  const sweep = b.add('sweep', 40, 80, { params: { duration: 5 } });
  const master = b.add('master', 400, 80);
  const mic = b.add('microphone', 40, 300);
  const cal = b.add('calibration', 240, 300);
  const ta = b.add('transfer-analyzer', 440, 220);
  const result = b.add('measurement-result', 640, 220);
  b.connect(sweep, 'audio', master, 'audio');
  b.connect(sweep, 'reference', ta, 'reference');
  b.connect(mic, 'capture', cal, 'observed');
  b.connect(cal, 'observed', ta, 'observed');
  b.connect(ta, 'result', result, 'result');
  const track = b.track('measurement', null, 'Measurement');
  b.clip(track, 0, 1, { target: mic, payload: { action: 'noise-check' } });
  b.clip(track, 1, 5, { target: sweep, payload: { action: 'stimulus' } });
  store.dispatch({ type: 'MARKER_ADD', time: 1, kind: 'sweep', label: 'Sweep' });
  return { store, ids: { sweep, master, mic, cal, ta, result, track } };
}

/** A hand-written model (not through the store) for validator tests. */
function rawModel(nodes, edges = [], timeline = {}) {
  return normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1, graph: { nodes, edges },
    timeline });
}
const n = (id, type, params = {}) => ({ id, type, position: { x: 0, y: 0 }, params });
const e = (id, from, fromPort, to, toPort, props) => ({ id, from: { node: from, port: fromPort },
  to: { node: to, port: toPort }, ...(props ? { props } : {}) });
const codes = (report) => report.errors.map((d) => d.code);
const warnCodes = (report) => report.warnings.map((d) => d.code);

// ---------------------------------------------------------------- schema

test('createStudioModel returns the normalized schema-1 shape', () => {
  const m = createStudioModel();
  assert.deepStrictEqual(Object.keys(m).sort(), ['graph', 'kind', 'metadata', 'schemaVersion',
    'timeline', 'transport', 'view']);
  assert.strictEqual(m.schemaVersion, 1);
  assert.strictEqual(STUDIO_SCHEMA_VERSION, 1);
  assert.strictEqual(m.kind, STUDIO_KIND);
  assert.deepStrictEqual(m.graph, { nodes: [], edges: [] });
  assert.deepStrictEqual(Object.keys(m.timeline).sort(), ['automation', 'clips', 'loop',
    'markers', 'tracks']);
  assert.deepStrictEqual(m.transport, { timeMode: 'seconds', tempo: 120, timeSignature: [4, 4] });
  assert.deepStrictEqual(m.view, { graph: { panX: 0, panY: 0, zoom: 1 },
    timeline: { pxPerSecond: 100, scrollX: 0 } });
  assert.deepStrictEqual(m.metadata, { title: DEFAULT_TITLE, notes: '' });
  assert.ok(validateStudioModel(m).ok);
});

test('Studio schema version is its own constant, independent of the experiment schema', () => {
  // Both start at 1 (ADR 0023) but are separate exports; neither is a product version string.
  assert.strictEqual(typeof STUDIO_SCHEMA_VERSION, 'number');
  assert.strictEqual(typeof EXPERIMENT_SCHEMA_VERSION, 'number');
  assert.ok(Number.isInteger(STUDIO_SCHEMA_VERSION));
});

test('assertPlainData rejects runtime objects, typed arrays and unsafe values (§10)', () => {
  class FakeAudioNode { constructor() { this.gain = 1; } }
  const bad = [
    ['function', { f: () => 1 }],
    ['class instance', { node: new FakeAudioNode() }],
    ['Map', { m: new Map() }],
    ['Date', { d: new Date(0) }],
    ['typed array', { a: new Float32Array(4) }],
    ['symbol', { s: Symbol('x') }],
    ['NaN', { v: NaN }],
    ['Infinity', [Infinity]],
    ['prototype key', JSON.parse('{"__proto__": {"x": 1}}')],
    ['constructor key', { constructor: 1 }],
    ['BigInt', { b: 1n }],
  ];
  for (const [what, v] of bad) {
    assert.throws(() => assertPlainData(v), StudioSchemaError, what);
  }
  const cyc = { a: {} };
  cyc.a.b = cyc;
  assert.throws(() => assertPlainData(cyc), /cycle/);
  assert.ok(assertPlainData({ a: [1, 'x', null, true, { b: [] }] }));
  assert.throws(() => normalizeStudio({ graph: { nodes: [{ id: 'x', type: 'gain',
    params: { gain: new Float64Array(1) } }], edges: [] } }), /typed arrays/);
});

test('normalizeStudio fills engine defaults and never mutates its input', () => {
  const input = Object.freeze({
    kind: STUDIO_KIND, schemaVersion: 1,
    graph: Object.freeze({ nodes: Object.freeze([
      Object.freeze({ id: 'filter-1', type: 'filter', position: Object.freeze({ x: 430, y: 160 }),
        params: Object.freeze({ frequency: 2400 }) }),
      Object.freeze({ id: 'env-1', type: 'envelope' }),
      Object.freeze({ id: 'sweep-1', type: 'sweep' }),
      Object.freeze({ id: 'master-1', type: 'master' }),
    ]), edges: Object.freeze([]) }),
  });
  const before = JSON.stringify(input);
  const m = normalizeStudio(input);
  assert.strictEqual(JSON.stringify(input), before);
  const [f, env, sweep, master] = m.graph.nodes;
  assert.deepStrictEqual(f.params, { ...DEFAULT_FILTER, frequency: 2400 });
  assert.deepStrictEqual(f.position, { x: 430, y: 160 });
  assert.strictEqual(f.metadata.name, 'Filter 1');
  assert.deepStrictEqual(env.params, { attack: DEFAULT_ADSR.a, decay: DEFAULT_ADSR.d,
    sustain: DEFAULT_ADSR.s, release: DEFAULT_ADSR.r });
  assert.strictEqual(sweep.params.start, DEFAULT_SWEEP.start);
  assert.strictEqual(sweep.params.end, DEFAULT_SWEEP.end);
  assert.strictEqual(sweep.params.duration, DEFAULT_SWEEP.durationMs / 1000);
  assert.strictEqual(sweep.params.curve, DEFAULT_SWEEP.curve);
  assert.strictEqual(master.params.level, DEFAULT_GAIN);
  assert.throws(() => normalizeStudio({ schemaVersion: 2 }), /migrate/);
  assert.throws(() => normalizeStudio({ kind: 'oscilla-experiment' }), /kind/);
});

test('serialization is deterministic and round-trips through normalize (§161)', () => {
  const { store } = basicSynth();
  const m = store.getModel();
  const text = serializeStudio(m);
  assert.strictEqual(serializeStudio(m), text);
  // Reversed key insertion order everywhere gives the same bytes.
  const reverseKeys = (v) => {
    if (Array.isArray(v)) return v.map(reverseKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
      return out;
    }
    return v;
  };
  assert.strictEqual(serializeStudio(reverseKeys(m)), text);
  const again = normalizeStudio(JSON.parse(text));
  assert.strictEqual(serializeStudio(again), text);
  assert.deepStrictEqual(again, JSON.parse(JSON.stringify(m)));
  const pretty = serializeStudio(m, 2);
  assert.ok(pretty.includes('\n  "graph"'));
  assert.strictEqual(canonicalJson(JSON.parse(pretty)), text);
});

test('studioHash covers execution state only (§162-§163, §252-§255)', () => {
  const { store, ids } = basicSynth();
  const m = store.getModel();
  const h = studioHash(m);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.strictEqual(h, nodeSha(canonicalJson(executionState(m))));
  const variant = (f) => {
    const c = JSON.parse(JSON.stringify(m));
    f(c);
    return studioHash(normalizeStudio(c));
  };
  // Excluded: view, positions, names, markers, metadata, array order; selection is not in it.
  assert.strictEqual(variant((c) => { c.view.graph = { panX: 99, panY: -5, zoom: 2.5 }; }), h);
  assert.strictEqual(variant((c) => { c.view.timeline.pxPerSecond = 13; }), h);
  assert.strictEqual(variant((c) => { c.graph.nodes[0].position = { x: 1, y: 2 }; }), h);
  assert.strictEqual(variant((c) => { c.graph.nodes[0].metadata.name = 'Main Osc'; }), h);
  assert.strictEqual(variant((c) => { c.metadata.title = 'Other'; }), h);
  assert.strictEqual(variant((c) => { c.timeline.markers.push({ id: 'marker-9', time: 2,
    kind: 'custom', label: 'x' }); }), h);
  assert.strictEqual(variant((c) => { c.graph.nodes.reverse(); c.graph.edges.reverse(); }), h);
  store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [ids.filter] } });
  store.dispatch({ type: 'VIEW_SET', view: { graph: { zoom: 1.5 } } });
  assert.strictEqual(studioHash(store.getModel()), h);
  // Included: parameters, edge props, clips, automation, transport, loop.
  assert.notStrictEqual(variant((c) => { c.graph.nodes[2].params.Q = 2; }), h);
  assert.notStrictEqual(variant((c) => { c.graph.edges[3].props.depth = 600; }), h);
  assert.notStrictEqual(variant((c) => { c.timeline.clips[0].start = 0.5; }), h);
  assert.notStrictEqual(variant((c) => { c.timeline.automation[0].points[0].value = 600; }), h);
  assert.notStrictEqual(variant((c) => { c.transport.tempo = 90; }), h);
  assert.notStrictEqual(variant((c) => { c.timeline.loop.enabled = true; }), h);
  const split = splitExecutionAndView(m);
  assert.deepStrictEqual(Object.keys(split).sort(), ['execution', 'presentation', 'view']);
  assert.strictEqual(split.view, m.view);
});

// ---------------------------------------------------------------- ports

test('port compatibility matrix: only same-type connections are allowed (§31, §33)', () => {
  const ports = Object.fromEntries(PORT_TYPE_LIST.map((t) => [t, {
    out: definePort({ id: 'o', direction: 'out', type: t, role: t === 'ANALYSIS' ? 'OBSERVED'
      : undefined }),
    in: definePort({ id: 'i', direction: 'in', type: t, role: t === 'ANALYSIS' ? 'OBSERVED'
      : undefined, param: t === 'CONTROL' ? { key: 'k', unit: 'Hz', range: [1, 2],
      mapping: 'linear' } : null }),
  }]));
  for (const s of PORT_TYPE_LIST) {
    for (const t of PORT_TYPE_LIST) {
      const r = canConnect(ports[s].out, ports[t].in);
      assert.strictEqual(r.allowed, s === t, `${s} → ${t}`);
      if (s === t) assert.strictEqual(r.signalType, s);
      else {
        assert.strictEqual(r.code, 'type-mismatch');
        assert.strictEqual(r.reason, typeCompatibility(s, t));
        assert.match(r.reason, /cannot connect to/);
      }
    }
  }
  assert.strictEqual(canConnect(ports.AUDIO.out, ports.TRIGGER.in).reason,
    'Audio output cannot connect to a trigger input.');
});

test('ANALYSIS roles keep reference and observed apart (§191-§192)', () => {
  const ref = port('sweep', 'reference', 'out');
  const obs = port('microphone', 'capture', 'out');
  const taRef = port('transfer-analyzer', 'reference', 'in');
  const taObs = port('transfer-analyzer', 'observed', 'in');
  assert.ok(canConnect(ref, taRef).allowed);
  assert.ok(canConnect(obs, taObs).allowed);
  const swapped = canConnect(ref, taObs);
  assert.strictEqual(swapped.code, 'role-mismatch');
  assert.match(swapped.reason, /reference signal cannot connect to an observed input/);
  assert.strictEqual(canConnect(obs, taRef).code, 'role-mismatch');
  assert.strictEqual(canConnect(port('transfer-analyzer', 'result', 'out'), taObs).code,
    'role-mismatch');
  // AUDIO taps accept any audio output (side-chain, §190).
  assert.ok(canConnect(port('oscillator', 'audio', 'out'), port('scope', 'audio', 'in')).allowed);
});

test('canConnect rejects wrong direction, unknown ports and self-connection', () => {
  const out = port('oscillator', 'audio', 'out');
  const inp = port('filter', 'audio', 'in');
  assert.strictEqual(canConnect(inp, inp).code, 'wrong-direction');
  assert.strictEqual(canConnect(out, out).code, 'wrong-direction');
  assert.strictEqual(canConnect(null, inp).code, 'unknown-port');
  assert.strictEqual(canConnect(port('filter', 'audio', 'out'), inp,
    { sourceNodeId: 'f', targetNodeId: 'f' }).code, 'self-connection');
});

test('port visuals are distinguishable without colour; labels are accessible (§32, §143)', () => {
  const shapes = PORT_TYPE_LIST.map((t) => PORT_VISUALS[t].shape);
  assert.deepStrictEqual(shapes, ['circle', 'diamond', 'triangle', 'square']);
  assert.strictEqual(new Set(PORT_TYPE_LIST.map((t) => PORT_VISUALS[t].cable)).size, 4);
  assert.strictEqual(portAccessibleLabel(port('oscillator', 'audio', 'out'),
    { connections: ['Filter 1'] }), 'Audio output port, connected to Filter 1');
  assert.strictEqual(portAccessibleLabel(port('filter', 'frequency', 'in'),
    { nodeName: 'Filter 1' }), 'Filter 1 cutoff control input, available');
  assert.strictEqual(describePort(port('transfer-analyzer', 'reference', 'in')),
    'Reference analysis input');
  assert.strictEqual(describePort(port('envelope', 'gate', 'in')), 'Gate trigger input');
  assert.strictEqual(DIRECTIONS.IN, 'in');
});

test('parameter target ports know parameter, unit, range and mapping (§34)', () => {
  const cutoff = port('filter', 'frequency', 'in');
  assert.strictEqual(cutoff.type, 'CONTROL');
  assert.strictEqual(cutoff.role, 'PARAMETER');
  assert.strictEqual(cutoff.multiple, true);
  assert.deepStrictEqual({ ...cutoff.param, range: [...cutoff.param.range] },
    { key: 'frequency', unit: 'Hz', range: [10, R.param('filter', 'frequency').max],
      mapping: 'log' });
  assert.deepStrictEqual([...port('pan', 'pan', 'in').param.range], [-1, 1]);
  assert.strictEqual(port('gain', 'gain', 'in').param.mapping, 'linear');
  assert.strictEqual(port('oscillator', 'frequency', 'in').param.unit, 'Hz');
  // Non-modulatable parameters have no port.
  assert.strictEqual(port('filter', 'type', 'in'), null);
  assert.strictEqual(port('master', 'level', 'in'), null);
});

test('modulation edge properties: depth, polarity, mapping, offset (§35)', () => {
  const cutoff = port('filter', 'frequency', 'in');
  const def = R.param('filter', 'frequency');
  const ok = validateEdgeProps({ depth: 1200, polarity: 'bipolar' }, 'CONTROL', cutoff, def);
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.props, { muted: false, depth: 1200, polarity: 'bipolar',
    mapping: 'linear', offset: 0 });
  assert.ok(validateEdgeProps({ mapping: 'log', depth: 2 }, 'CONTROL', cutoff, def).ok);
  assert.ok(!validateEdgeProps({ mapping: 'log', depth: 11 }, 'CONTROL', cutoff, def).ok);
  const pan = port('pan', 'pan', 'in');
  const log = validateEdgeProps({ mapping: 'log' }, 'CONTROL', pan, R.param('pan', 'pan'));
  assert.match(log.errors[0].text, /logarithmic/);
  assert.ok(!validateEdgeProps({ depth: 3 }, 'CONTROL', pan, R.param('pan', 'pan')).ok);
  assert.ok(!validateEdgeProps({ polarity: 'tri' }, 'CONTROL', pan).ok);
  assert.ok(!validateEdgeProps({ depth: NaN }, 'CONTROL', pan).ok);
  assert.ok(validateEdgeProps({ muted: true }, 'AUDIO', null).ok);
  assert.match(validateEdgeProps({ depth: 1 }, 'AUDIO', null).errors[0].text, /no depth/);
});

// ---------------------------------------------------------------- registry

test('registry holds the §29 library and every definition validates', () => {
  const expected = ['oscillator', 'noise', 'sweep', 'sequence', 'microphone', 'lfo', 'envelope',
    'random', 'step-modulator', 'gain', 'filter', 'pan', 'stereo-split', 'mixer', 'scope',
    'spectrum', 'spectrogram', 'meter', 'rta', 'master', 'recorder', 'capture', 'calibration',
    'transfer-analyzer', 'measurement-result'];
  assert.deepStrictEqual(R.list().map((d) => d.type), expected);
  assert.deepStrictEqual(R.categories().map((c) => [c.id, c.types.length]), [['SOURCES', 5],
    ['MODULATION', 4], ['PROCESSING', 5], ['ANALYSIS', 5], ['OUTPUT', 2], ['MEASUREMENT', 4]]);
  for (const def of NODE_DEFINITIONS) assert.deepStrictEqual(validateNodeDefinition(def), []);
  for (const def of R.list()) {
    for (const p of def.params) {
      assert.strictEqual(validateParamValue(p, p.default), null, `${def.type}.${p.key}`);
    }
    for (const portDef of [...def.inputs, ...def.outputs]) {
      assert.strictEqual(R.port(def.type, portDef.id, portDef.direction), portDef);
    }
    assert.ok(def.capabilities.serializable);
    assert.strictEqual(typeof def.summary(R.defaults(def.type)), 'string');
  }
  assert.throws(() => createNodeRegistry([...NODE_DEFINITIONS, NODE_DEFINITIONS[0]]),
    /duplicate type/);
  assert.throws(() => createNodeRegistry([{ ...NODE_DEFINITIONS[0], compiler: 'nope' }]),
    /compiler/);
});

test('every compiler and reuse key names an existing export (§28)', async () => {
  for (const def of R.list()) {
    for (const key of [def.compiler, ...def.reuses]) {
      const [file, name] = key.split('#');
      const mod = await import(`../../src/js/${file}`);
      assert.ok(name in mod, `${def.type}: ${key}`);
    }
    assert.doesNotThrow(() => assertPlainData(JSON.parse(JSON.stringify(def))));
  }
});

test('node defaults match the existing engine defaults', () => {
  assert.deepStrictEqual(R.defaults('filter'), { ...DEFAULT_FILTER });
  assert.deepStrictEqual(R.defaults('envelope'), { attack: DEFAULT_ADSR.a,
    decay: DEFAULT_ADSR.d, sustain: DEFAULT_ADSR.s, release: DEFAULT_ADSR.r });
  assert.deepStrictEqual(R.defaults('oscillator'), { waveform: 'sine', frequency: 440,
    detune: 0, level: 1 });
  assert.deepStrictEqual(R.defaults('stereo-split'), { mode: 'split', panA: -1, panB: 1,
    levelA: 1, levelB: 1 });
  assert.strictEqual(R.defaults('master').level, DEFAULT_GAIN);
  assert.strictEqual(R.param('master', 'level').max, MAX_OUTPUT_GAIN);
  assert.strictEqual(R.defaults('transfer-analyzer').pointsPerOctave, 48);
  assert.strictEqual(R.defaults('spectrum').fftSize, 8192);
});

test('compact summaries (§75), capabilities (§175-§176) and output policy (§187-§188)', () => {
  assert.strictEqual(R.summarize({ type: 'filter', params: { type: 'lowpass', frequency: 2400,
    Q: Math.SQRT1_2, gain: 0, enabled: true } }), 'Low-pass · 2.40 kHz · Q 0.707');
  assert.strictEqual(R.summarize({ type: 'filter', params: { ...DEFAULT_FILTER,
    type: 'peaking', gain: -6 } }), 'Peaking · 1.00 kHz · -6 dB');
  assert.strictEqual(R.summarize({ type: 'oscillator', params: {} }), 'Sine · 440 Hz');
  assert.strictEqual(R.summarize({ type: 'nope' }), 'Unknown node type');
  const mic = R.get('microphone').capabilities;
  assert.deepStrictEqual({ ...mic }, { realtime: true, offline: false, measurement: true,
    requiresInputPermission: true, serializable: true });
  assert.strictEqual(R.get('recorder').capabilities.realtime, false);
  assert.strictEqual(R.get('recorder').capabilities.offline, true);
  assert.deepStrictEqual(R.list().filter((d) => d.capabilities.requiresInputPermission)
    .map((d) => d.type), ['microphone']);
  assert.deepStrictEqual(R.list().filter((d) => d.maxInstances === 1).map((d) => d.type),
    ['master']);
  assert.deepStrictEqual(R.list().filter((d) => d.summing).map((d) => d.type), ['mixer']);
  // Only the Mixer has several audio inputs meant for summing; no audio input is multi-edge.
  for (const def of R.list()) {
    for (const p of def.inputs) if (p.type === 'AUDIO') assert.strictEqual(p.multiple, false);
  }
  for (const def of R.list()) {
    assert.deepStrictEqual(Object.keys(def.help).sort(), ['constraints', 'inputs', 'outputs',
      'what']);
  }
});

test('searchNodeTypes matches name, aliases and category (§30)', () => {
  const first = (q) => searchNodeTypes(q)[0] && searchNodeTypes(q)[0].type;
  assert.strictEqual(first('filter'), 'filter');
  assert.strictEqual(first('biquad'), 'filter');
  assert.strictEqual(first('adsr'), 'envelope');
  assert.strictEqual(first('Mic'), 'microphone');
  assert.strictEqual(first('transfer analyzer'), 'transfer-analyzer');
  assert.strictEqual(first('output'), 'master');
  assert.ok(searchNodeTypes('measurement').some((d) => d.type === 'capture'));
  assert.deepStrictEqual(searchNodeTypes('analysis').map((d) => d.category).slice(0, 5),
    ['ANALYSIS', 'ANALYSIS', 'ANALYSIS', 'ANALYSIS', 'ANALYSIS']);
  assert.strictEqual(searchNodeTypes('').length, R.list().length);
  assert.deepStrictEqual(searchNodeTypes('zzzz'), []);
});

// ---------------------------------------------------------------- validation

test('graph validation reports structured diagnostics (§37)', () => {
  const m = rawModel([n('osc-1', 'oscillator'), n('f-1', 'filter'), n('x-1', 'warp-drive'),
    n('master-1', 'master')], [
    e('e1', 'osc-1', 'audio', 'nowhere', 'audio'),
    e('e2', 'osc-1', 'sparkle', 'f-1', 'audio'),
    e('e3', 'f-1', 'frequency', 'master-1', 'audio'),
    e('e4', 'osc-1', 'audio', 'f-1', 'gate'),
    e('e5', 'osc-1', 'audio', 'f-1', 'frequency'),
    e('e6', 'osc-1', 'audio', 'f-1', 'audio'),
    e('e7', 'osc-1', 'audio', 'f-1', 'audio'),
  ]);
  const r = validateStudioModel(m);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(codes(r).sort(), ['duplicate-edge', 'missing-node', 'type-mismatch',
    'unknown-node-type', 'unknown-port', 'unknown-port', 'wrong-direction'].sort());
  for (const d of r.diagnostics) {
    assert.ok(typeof d.message === 'string' && d.message.length > 5);
    assert.ok(['error', 'warning'].includes(d.severity));
  }
  assert.strictEqual(r.order, null);
  const wrongDir = r.errors.find((d) => d.code === 'wrong-direction');
  assert.strictEqual(wrongDir.edgeId, 'e3');
});

test('single-input ports reject a second edge; parameter inputs accept several (§37, §188)', () => {
  const m = rawModel([n('a', 'oscillator'), n('b', 'oscillator'), n('f', 'filter'),
    n('l1', 'lfo'), n('l2', 'lfo'), n('mix', 'mixer'), n('master-1', 'master')], [
    e('e1', 'a', 'audio', 'f', 'audio'),
    e('e2', 'b', 'audio', 'f', 'audio'),
  ]);
  const r = validateStudioModel(m);
  assert.deepStrictEqual(codes(r), ['multiple-connections']);
  assert.match(r.errors[0].message, /use a Mixer/);
  const fixed = rawModel(m.graph.nodes, [
    e('e1', 'a', 'audio', 'mix', 'in1'), e('e2', 'b', 'audio', 'mix', 'in2'),
    e('e3', 'mix', 'audio', 'f', 'audio'), e('e4', 'f', 'audio', 'master-1', 'audio'),
    e('e5', 'l1', 'control', 'f', 'frequency'), e('e6', 'l2', 'control', 'f', 'frequency'),
  ]);
  const ok = validateStudioModel(fixed);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.deepStrictEqual(warnCodes(ok), []);
});

test('cycle detection: audio feedback rejected with the spec message (§38-§39, §241)', () => {
  const m = rawModel([n('osc', 'oscillator'), n('mix', 'mixer'), n('f', 'filter'),
    n('g', 'gain'), n('master-1', 'master')], [
    e('e1', 'osc', 'audio', 'mix', 'in1'), e('e2', 'mix', 'audio', 'f', 'audio'),
    e('e3', 'f', 'audio', 'g', 'audio'), e('e4', 'g', 'audio', 'mix', 'in2'),
  ]);
  const r = validateStudioModel(m);
  assert.deepStrictEqual(codes(r), ['audio-feedback']);
  assert.strictEqual(r.errors[0].message, AUDIO_FEEDBACK_MESSAGE);
  assert.strictEqual(AUDIO_FEEDBACK_MESSAGE, 'Connection rejected: This would create an '
    + 'unsupported instantaneous audio feedback loop.');
  assert.strictEqual(r.errors[0].detail, 'Mixer 1 → Filter 1 → Gain 1 → Mixer 1');
  const cycles = analyzeCycles(m);
  assert.strictEqual(cycles.order, null);
  assert.deepStrictEqual(cycles.cycles, [{ kind: 'audio-feedback',
    nodes: ['mix', 'f', 'g', 'mix'], edges: ['e2', 'e3', 'e4'] }]);
});

test('topological order is deterministic and respects every edge (§38)', () => {
  const { store } = basicSynth();
  const m = store.getModel();
  const r = validateStudioModel(m);
  assert.ok(r.ok);
  const pos = new Map(r.order.map((id, i) => [id, i]));
  assert.strictEqual(r.order.length, m.graph.nodes.length);
  for (const edge of m.graph.edges) assert.ok(pos.get(edge.from.node) < pos.get(edge.to.node));
  assert.deepStrictEqual(r.order, ['osc-1', 'env-1', 'lfo-1', 'filter-1', 'master-1']);
  assert.deepStrictEqual(analyzeCycles(m).order, r.order);
});

test('control-cycle policy (§40)', () => {
  const nodes = [n('osc', 'oscillator'), n('env', 'envelope'), n('l1', 'lfo'), n('l2', 'lfo'),
    n('rnd', 'random'), n('mix', 'mixer'), n('f', 'filter'), n('master-1', 'master')];
  const chain = [e('a1', 'osc', 'audio', 'env', 'audio'), e('a2', 'env', 'audio', 'f', 'audio'),
    e('a3', 'f', 'audio', 'master-1', 'audio')];
  // Allowed: LFO modulating another modulator, which modulates a parameter (acyclic).
  const allowed = rawModel(nodes, [...chain, e('c1', 'l1', 'control', 'l2', 'rate'),
    e('c2', 'l2', 'control', 'f', 'frequency'), e('c3', 'rnd', 'control', 'l1', 'rate'),
    e('c4', 'env', 'control', 'f', 'frequency')]);
  assert.ok(validateStudioModel(allowed).ok, JSON.stringify(validateStudioModel(allowed).errors));
  // Rejected: a modulation loop between modulators.
  const loop = rawModel(nodes, [...chain, e('c1', 'l1', 'control', 'l2', 'rate'),
    e('c2', 'l2', 'control', 'l1', 'rate')]);
  const r1 = validateStudioModel(loop);
  assert.deepStrictEqual(codes(r1), ['control-cycle']);
  assert.strictEqual(r1.errors[0].message, CONTROL_CYCLE_MESSAGE);
  assert.strictEqual(r1.errors[0].detail, 'LFO 1 → LFO 2 → LFO 1');
  // Rejected: an envelope controlling the pitch of the oscillator it envelopes (node cycle).
  const self = rawModel(nodes, [...chain, e('c1', 'env', 'control', 'osc', 'frequency')]);
  assert.deepStrictEqual(codes(validateStudioModel(self)), ['control-cycle']);
  // Rejected: the output modulating its own source through the audio path.
  const back = rawModel(nodes, [e('a1', 'osc', 'audio', 'mix', 'in1'),
    e('a2', 'mix', 'audio', 'master-1', 'audio'), e('c1', 'rnd', 'control', 'mix', 'level1'),
    e('c2', 'l1', 'control', 'rnd', 'rate'), e('c3', 'l2', 'control', 'l1', 'rate')]);
  assert.ok(validateStudioModel(back).ok);
});

test('analysis cycles and live input to output are rejected (§240)', () => {
  const loop = rawModel([n('c1', 'calibration'), n('c2', 'calibration')], [
    e('e1', 'c1', 'observed', 'c2', 'observed'), e('e2', 'c2', 'observed', 'c1', 'observed')]);
  assert.deepStrictEqual(codes(validateStudioModel(loop)), ['analysis-cycle']);
  const mic = rawModel([n('mic', 'microphone'), n('g', 'gain'), n('master-1', 'master'),
    n('s', 'spectrum')], [e('e1', 'mic', 'audio', 'g', 'audio'),
    e('e2', 'g', 'audio', 'master-1', 'audio'), e('e3', 'mic', 'audio', 's', 'audio')]);
  const r = validateStudioModel(mic);
  assert.deepStrictEqual(codes(r), ['live-input-to-output']);
  assert.match(r.errors[0].message, /feed back acoustically/);
  const analysisOnly = rawModel(mic.graph.nodes, [e('e3', 'mic', 'audio', 's', 'audio')]);
  assert.ok(validateStudioModel(analysisOnly).ok);
});

test('more than one Master Output is an error; unreachable sources are warnings (§187)', () => {
  const two = rawModel([n('m1', 'master'), n('m2', 'master')]);
  const r = validateStudioModel(two);
  assert.deepStrictEqual(codes(r), ['too-many-instances']);
  assert.match(r.errors[0].message, /exactly one Master Output/);
  const lonely = rawModel([n('osc', 'oscillator'), n('master-1', 'master'), n('s', 'scope')]);
  const w = validateStudioModel(lonely);
  assert.ok(w.ok);
  assert.deepStrictEqual(warnCodes(w).sort(), ['unconnected-input', 'unconnected-input',
    'unreachable-output'].sort());
  assert.match(w.warnings.find((d) => d.code === 'unreachable-output').message,
    /Oscillator 1 does not reach Master Output/);
  assert.deepStrictEqual(warnCodes(validateStudioModel(rawModel([n('osc', 'oscillator')]))),
    ['no-master-output']);
});

test('invalid parameters, edge properties and timeline references are reported', () => {
  const m = rawModel([n('osc', 'oscillator', { frequency: -5 }), n('l', 'lfo'),
    n('f', 'filter'), n('master-1', 'master')], [
    e('e1', 'osc', 'audio', 'f', 'audio'), e('e2', 'f', 'audio', 'master-1', 'audio'),
    e('e3', 'l', 'control', 'f', 'frequency', { depth: 1e9 }),
  ], {
    tracks: [{ id: 't1', kind: 'event', name: 'T', target: 'osc' }],
    clips: [{ id: 'c1', trackId: 'nope', kind: 'pattern', start: 0, duration: 1 },
      { id: 'c2', trackId: 't1', kind: 'measurement', start: 0, duration: 1,
        payload: { action: 'stimulus' } },
      { id: 'c3', trackId: 't1', kind: 'pattern', start: 0, duration: 0.001 }],
    automation: [{ id: 'l1', target: { node: 'f', param: 'type' },
      points: [{ id: 'p1', time: 0, value: 0 }] },
    { id: 'l2', target: { node: 'f', param: 'frequency' },
      points: [{ id: 'p2', time: 0, value: 0.0, curve: 'linear' },
        { id: 'p3', time: 1, value: 800, curve: 'exponential' }] }],
  });
  const r = validateStudioModel(m);
  const got = new Set(codes(r));
  for (const c of ['invalid-param', 'invalid-edge-props', 'missing-track', 'clip-kind-mismatch',
    'invalid-clip-target', 'invalid-time', 'not-automatable', 'invalid-automation']) {
    assert.ok(got.has(c), c);
  }
  assert.ok(r.errors.some((d) => /never to or from zero/.test(d.message)));
});

// ---------------------------------------------------------------- topologies

test('§257 Basic Synth topology builds and validates', () => {
  const { store, ids } = basicSynth();
  const m = store.getModel();
  const r = validateStudioModel(m);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(m.graph.edges.map((x) => `${x.from.node}.${x.from.port} → `
    + `${x.to.node}.${x.to.port}`), ['osc-1.audio → env-1.audio', 'env-1.audio → filter-1.audio',
    'filter-1.audio → master-1.audio', 'lfo-1.control → filter-1.frequency']);
  assert.deepStrictEqual(m.graph.edges[3].props, { muted: false, depth: 1200,
    polarity: 'bipolar', mapping: 'linear', offset: 0 });
  assert.strictEqual(R.summarize(m.graph.nodes.find((x) => x.id === ids.filter)),
    'Low-pass · 2.40 kHz · Q 0.707');
  assert.deepStrictEqual(m.timeline.clips.map((c) => c.payload.blockType), ['tone', 'sweep']);
  assert.deepStrictEqual(m.timeline.automation[0].points.map((p) => [p.time, p.value, p.curve]),
    [[0, 500, 'linear'], [3, 8000, 'exponential']]);
});

test('§258 Measurement topology builds and validates', () => {
  const { store } = measurementChain();
  const m = store.getModel();
  const r = validateStudioModel(m);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.order, ['sweep-1', 'master-1', 'mic-1', 'cal-1', 'transfer-1',
    'result-1']);
  const sig = m.graph.edges.map((x) => canConnect(port(m.graph.nodes.find((q) =>
    q.id === x.from.node).type, x.from.port, 'out'), port(m.graph.nodes.find((q) =>
    q.id === x.to.node).type, x.to.port, 'in')).signalType);
  assert.deepStrictEqual(sig, ['AUDIO', 'ANALYSIS', 'ANALYSIS', 'ANALYSIS', 'ANALYSIS']);
  // Swapping reference and observed is impossible through the action layer.
  const b = builder(store);
  b.ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId: m.graph.edges[1].id }));
  const bad = store.dispatch({ type: 'EDGE_ADD', from: { node: 'sweep-1', port: 'reference' },
    to: { node: 'transfer-1', port: 'observed' } });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /reference signal cannot connect to an observed input/);
});

// ---------------------------------------------------------------- import and migration

test('validateStudioImport accepts a serialized Studio and returns a normalized copy', () => {
  const { store } = basicSynth();
  const text = serializeStudio(store.getModel());
  const r = validateStudioImport(text);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(serializeStudio(r.model), text);
  const obj = JSON.parse(text);
  const before = JSON.stringify(obj);
  assert.ok(validateStudioImport(obj).ok);
  assert.strictEqual(JSON.stringify(obj), before);
});

test('import rejects malicious and oversized input (§115, §159, §238)', () => {
  const base = JSON.parse(serializeStudio(basicSynth().store.getModel()));
  const clone = () => JSON.parse(JSON.stringify(base));
  const fails = (input, re, limits) => {
    const r = validateStudioImport(input, limits);
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((x) => re.test(`${x.path} ${x.message}`)),
      `${re}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    return r;
  };
  fails('{"kind":"oscilla-studio","__proto__":{"polluted":1}}', /forbidden/);
  assert.strictEqual({}.polluted, undefined);
  const proto = clone();
  proto.graph.nodes[0].params = JSON.parse('{"constructor": 1}');
  fails(proto, /forbidden/);
  const nan = clone();
  nan.graph.nodes[0].position.x = NaN;
  fails(nan, /finite/);
  const inf = clone();
  inf.timeline.clips[0].start = Infinity;
  fails(inf, /finite/);
  const huge = clone();
  huge.graph.nodes = Array.from({ length: 100000 }, (_, i) => n(`x-${i}`, 'gain'));
  fails(huge, /import limit/);
  const many = clone();
  many.graph.nodes.push(n('g-1', 'gain'), n('g-2', 'gain'));
  fails(many, /more than 5 nodes/, { nodes: 5 });
  const longName = clone();
  longName.graph.nodes[0].metadata.name = 'x'.repeat(5000);
  fails(longName, /longer than/);
  const unknownType = clone();
  unknownType.graph.nodes[0].type = '<img src=x onerror=alert(1)>';
  fails(unknownType, /unknown node type/);
  const unknownPort = clone();
  unknownPort.graph.edges[0].to.port = 'sidechain';
  fails(unknownPort, /has no input/);
  const unknownField = clone();
  unknownField.graph.nodes[0].script = 'alert(1)';
  fails(unknownField, /unknown field/);
  const unknownParam = clone();
  unknownParam.graph.nodes[0].params.eval = 1;
  fails(unknownParam, /unknown parameter/);
  let deep = { x: 1 };
  for (let i = 0; i < 40; i++) deep = { deep };
  const nested = clone();
  nested.timeline.clips[0].payload.params = deep;
  fails(nested, /nested deeper/);
  fails('x'.repeat(64), /larger than/, { maxBytes: 32 });
  fails('{not json', /Not valid JSON/);
  fails({ kind: 'oscilla-experiment' }, /experiment file/);
  fails({ ...clone(), schemaVersion: 7 }, /importStudio/);
  fails([1, 2], /Studio object/);
  const cyclic = clone();
  cyclic.graph.edges.push(e('edge-x', 'filter-1', 'audio', 'osc-1', 'audio'));
  const r = validateStudioImport(cyclic);
  assert.strictEqual(r.ok, false);
  assert.ok(STUDIO_IMPORT_LIMITS.nodes >= 100 && STUDIO_IMPORT_LIMITS.edges >= 200);
});

test('migration: synthetic schema 0 → 1 through the registry (§160)', () => {
  // A hypothetical pre-release shape: flat node list with x/y and "a.port" connection strings.
  const v0 = {
    kind: STUDIO_KIND, schemaVersion: 0,
    nodes: [{ id: 'osc-1', type: 'oscillator', x: 10, y: 20, params: { frequency: 220 } },
      { id: 'master-1', type: 'master', x: 200, y: 20, params: {} }],
    connections: [{ id: 'edge-1', from: 'osc-1.audio', to: 'master-1.audio' }],
    transport: {},
  };
  const frozen = JSON.stringify(v0);
  const split = (s) => {
    const [node, p] = s.split('.');
    return { node, port: p };
  };
  const migrations = {
    1: (doc) => ({
      kind: doc.kind, schemaVersion: 1, transport: doc.transport, timeline: {},
      graph: {
        nodes: doc.nodes.map(({ id, type, x, y, params }) => ({ id, type, position: { x, y },
          params })),
        edges: doc.connections.map((c) => ({ id: c.id, from: split(c.from), to: split(c.to) })),
      },
    }),
  };
  const m = migrateStudio(v0, { migrations });
  assert.ok(m.ok);
  assert.deepStrictEqual(m.applied, [1]);
  assert.strictEqual(m.doc.schemaVersion, 1);
  const r = importStudio(JSON.stringify(v0), { migrations });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.migratedFrom, 0);
  assert.deepStrictEqual(r.model.graph.nodes[0].position, { x: 10, y: 20 });
  assert.strictEqual(r.model.graph.nodes[0].params.frequency, 220);
  assert.strictEqual(r.model.graph.edges[0].to.node, 'master-1');
  assert.strictEqual(JSON.stringify(v0), frozen);
  // The shipped registry has no 0 → 1 step beyond identity, so the v0 shape fails strictly.
  assert.strictEqual(typeof studioMigrations[1], 'function');
  assert.strictEqual(importStudio(v0).ok, false);
  const newer = importStudio({ ...v0, schemaVersion: 2 });
  assert.strictEqual(newer.ok, false);
  assert.match(newer.errors[0].message, /Studio schema 2 is newer/);
  assert.strictEqual(newer.errors[0].code, 'unsupported-version');
  const current = importStudio(serializeStudio(basicSynth().store.getModel()));
  assert.ok(current.ok);
  assert.strictEqual(current.migratedFrom, null);
  const unsafe = importStudio('{"kind":"oscilla-studio","schemaVersion":0,"__proto__":{}}',
    { migrations: { 1: () => { throw new Error('migration must not run'); } } });
  assert.strictEqual(unsafe.ok, false);
  assert.match(unsafe.errors[0].message, /forbidden/);
});

// ---------------------------------------------------------------- actions

test('node add/remove with deletion cascade and one-step undo (§124)', () => {
  const { store, ids } = basicSynth();
  const before = store.getModel();
  const r = store.dispatch({ type: 'NODE_REMOVE', nodeId: ids.filter });
  assert.ok(r.ok);
  assert.strictEqual(r.label, 'Delete Filter 1');
  const m = store.getModel();
  assert.ok(!m.graph.nodes.some((x) => x.id === ids.filter));
  assert.ok(m.graph.edges.every((x) => x.from.node !== ids.filter && x.to.node !== ids.filter));
  assert.strictEqual(m.graph.edges.length, 1);
  assert.strictEqual(m.timeline.automation.length, 0);
  store.dispatch({ type: 'NODE_REMOVE', nodeId: ids.osc });
  const m2 = store.getModel();
  assert.strictEqual(m2.timeline.clips.length, 2, 'clips target the track, not the node');
  assert.strictEqual(m2.timeline.tracks[0].target, null);
  store.undo();
  store.undo();
  assert.strictEqual(store.getModel(), before);
  assert.strictEqual(store.dispatch({ type: 'NODE_REMOVE', nodeId: 'ghost' }).ok, false);
});

test('ids are unique and come only from the injected generator (§172)', () => {
  const dupes = ['osc-1', 'osc-1', 'osc-1', 'osc-2'];
  const store = createStudioStore(null, { idGenerator: () => dupes.shift() || 'osc-9' });
  const b = builder(store);
  assert.strictEqual(b.add('oscillator'), 'osc-1');
  assert.strictEqual(b.add('oscillator'), 'osc-2');
  const stuck = createStudioStore(null, { idGenerator: () => 'same' });
  builder(stuck).add('gain');
  const r = stuck.dispatch({ type: 'NODE_ADD', nodeType: 'gain' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /unique id/);
  assert.throws(() => createStudioStore(null, {}), /idGenerator/);
  const bad = createStudioStore(null, { idGenerator: () => '../etc/passwd' });
  assert.strictEqual(bad.dispatch({ type: 'NODE_ADD', nodeType: 'gain' }).ok, false);
  const gen = createIdGenerator(basicSynth().store.getModel());
  assert.strictEqual(gen('osc'), 'osc-2');
  assert.strictEqual(gen('edge'), 'edge-5');
  assert.strictEqual(gen('brand-new'), 'brand-new-1');
  const names = basicSynth().store;
  const nb = builder(names);
  nb.add('filter');
  assert.strictEqual(names.getModel().graph.nodes.at(-1).metadata.name, 'Filter 2');
  names.dispatch({ type: 'NODE_RENAME', nodeId: 'filter-2', name: 'HF Filter' });
  assert.strictEqual(names.getModel().graph.nodes.at(-1).metadata.name, 'HF Filter');
  assert.strictEqual(names.getModel().graph.nodes.at(-1).type, 'filter');
  assert.strictEqual(names.dispatch({ type: 'NODE_RENAME', nodeId: 'filter-2', name: ' ' }).ok,
    false);
});

test('Master Output policy and Mixer summing through the action layer (§187-§188)', () => {
  const store = newStore();
  const b = builder(store);
  const m = b.add('master');
  const second = store.dispatch({ type: 'NODE_ADD', nodeType: 'master' });
  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /exactly one Master Output/);
  const a = b.add('oscillator');
  const c = b.add('noise');
  b.connect(a, 'audio', m, 'audio');
  const sum = store.dispatch({ type: 'EDGE_ADD', from: { node: c, port: 'audio' },
    to: { node: m, port: 'audio' } });
  assert.strictEqual(sum.ok, false);
  assert.match(sum.reason, /use a Mixer/);
});

test('rejected EDGE_ADD leaves model, history and revision unchanged', () => {
  const { store, ids } = basicSynth();
  const model = store.getModel();
  const rev = store.getRevision();
  const depth = store.debugInfo().undoDepth;
  const attempts = [
    { from: { node: ids.filter, port: 'audio' }, to: { node: ids.osc, port: 'frequency' } },
    { from: { node: ids.master, port: 'audio' }, to: { node: ids.osc, port: 'audio' } },
    { from: { node: ids.env, port: 'audio' }, to: { node: ids.filter, port: 'audio' } },
    { from: { node: ids.lfo, port: 'control' }, to: { node: ids.filter, port: 'gate' } },
    { from: { node: ids.lfo, port: 'control' }, to: { node: ids.filter, port: 'Q' },
      props: { depth: 1e6 } },
    { from: { node: ids.env, port: 'control' }, to: { node: ids.osc, port: 'frequency' } },
  ];
  const reasons = attempts.map((a) => store.dispatch({ type: 'EDGE_ADD', ...a }));
  for (const r of reasons) {
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.length > 10);
  }
  assert.match(reasons[0].reason, /Audio output cannot connect to a control input/);
  assert.match(reasons[1].reason, /is an input/);
  assert.match(reasons[2].reason, /already connected/);
  assert.match(reasons[5].reason, /control its own source/);
  assert.strictEqual(store.getModel(), model);
  assert.strictEqual(store.getRevision(), rev);
  assert.strictEqual(store.debugInfo().undoDepth, depth);
  assert.strictEqual(store.canRedo(), false);
});

test('§208 history: undo all → exact initial state; redo all → exact final state', () => {
  const store = newStore();
  const initial = store.getModel();
  const initialText = serializeStudio(initial);
  const b = builder(store);
  const osc = b.add('oscillator', 0, 0);
  const filter = b.add('filter', 200, 0);
  b.connect(osc, 'audio', filter, 'audio');
  b.ok(store.dispatch({ type: 'NODE_MOVE', nodeId: filter, position: { x: 260, y: 40 } }));
  b.ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: filter, key: 'frequency', value: 2400 }));
  const track = b.track('event', osc);
  b.clip(track, 0, 1, { payload: { blockType: 'tone', params: { freq: 440 } } });
  const final = store.getModel();
  const finalText = serializeStudio(final);
  const labels = [];
  while (store.canUndo()) labels.push(store.undo().label);
  assert.deepStrictEqual(labels, ['Add pattern clip', 'Add Track 1',
    'Change Filter 1 Cutoff', 'Move Filter 1', 'Connect Oscillator 1 to Filter 1',
    'Add Filter 1', 'Add Oscillator 1']);
  assert.strictEqual(store.getModel(), initial);
  assert.strictEqual(serializeStudio(store.getModel()), initialText);
  assert.ok(isSemanticallyEqual(store.getModel(), initial));
  while (store.canRedo()) store.redo();
  assert.strictEqual(store.getModel(), final);
  assert.strictEqual(serializeStudio(store.getModel()), finalText);
  assert.strictEqual(store.getRevision(), 21, 'monotonic: 7 edits + 7 undos + 7 redos');
});

test('gesture coalescing: 400 NODE_MOVE dispatches are one history entry (§50)', () => {
  const { store, ids } = basicSynth();
  const start = store.getModel();
  const depth = store.debugInfo().undoDepth;
  store.beginGesture();
  for (let i = 1; i <= 400; i++) {
    assert.ok(store.dispatch({ type: 'NODE_MOVE', nodeId: ids.filter,
      position: { x: 430 + i, y: 160 + (i % 7) } }).ok);
  }
  const entry = store.endGesture();
  assert.deepStrictEqual(entry, { label: 'Move Filter 1' });
  assert.strictEqual(store.debugInfo().undoDepth, depth + 1);
  assert.deepStrictEqual(store.getModel().graph.nodes.find((x) => x.id === ids.filter).position,
    { x: 830, y: 160 + (400 % 7) });
  assert.strictEqual(store.undoLabel(), 'Move Filter 1');
  store.undo();
  assert.strictEqual(store.getModel(), start);
  // Slider drags coalesce the same way, with an explicit label.
  store.beginGesture('Sweep cutoff');
  for (const f of [600, 900, 1500, 3000]) {
    store.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids.filter, key: 'frequency', value: f });
  }
  store.endGesture();
  assert.strictEqual(store.undoLabel(), 'Sweep cutoff');
  // A gesture without changes records nothing; cancel restores the start without history.
  const d = store.debugInfo().undoDepth;
  store.beginGesture('Nothing');
  store.endGesture();
  assert.strictEqual(store.debugInfo().undoDepth, d);
  const pre = store.getModel();
  store.beginGesture();
  store.dispatch({ type: 'NODE_MOVE', nodeId: ids.osc, position: { x: -50, y: -50 } });
  assert.ok(store.cancelGesture());
  assert.strictEqual(store.getModel(), pre);
  assert.strictEqual(store.debugInfo().undoDepth, d);
});

test('a new edit after undo clears redo (§51)', () => {
  const { store, ids } = basicSynth();
  store.dispatch({ type: 'NODE_MOVE', nodeId: ids.osc, position: { x: 1, y: 1 } });
  store.undo();
  assert.ok(store.canRedo());
  store.dispatch({ type: 'NODE_PARAM_SET', nodeId: ids.osc, key: 'frequency', value: 220 });
  assert.strictEqual(store.canRedo(), false);
  assert.strictEqual(store.redo().ok, false);
  // The first change inside a gesture clears redo too.
  store.undo();
  assert.ok(store.canRedo());
  store.beginGesture();
  store.dispatch({ type: 'NODE_MOVE', nodeId: ids.osc, position: { x: 5, y: 5 } });
  assert.strictEqual(store.canRedo(), false);
  store.endGesture();
});

test('selection and view are view state: not undoable, no revision, pruned on delete', () => {
  const { store, ids } = basicSynth();
  const rev = store.getRevision();
  const depth = store.debugInfo().undoDepth;
  const events = [];
  const s2 = createStudioStore(store.getModel(), { idGenerator: createIdGenerator(
    store.getModel()), onChange: (ev) => events.push(ev.type) });
  store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [ids.filter, ids.osc, 'ghost'],
    edges: ['edge-1'] } });
  assert.deepStrictEqual([...store.getSelection().nodes], [ids.filter, ids.osc]);
  store.dispatch({ type: 'VIEW_SET', view: { graph: { panX: 120, zoom: 2 } } });
  assert.deepStrictEqual(store.getModel().view.graph, { panX: 120, panY: 0, zoom: 2 });
  assert.strictEqual(store.getRevision(), rev);
  assert.strictEqual(store.debugInfo().undoDepth, depth);
  assert.strictEqual(store.dispatch({ type: 'VIEW_SET', view: { graph: { zoom: 0 } } }).ok, false);
  store.dispatch({ type: 'NODE_REMOVE', nodeId: ids.filter });
  assert.deepStrictEqual([...store.getSelection().nodes], [ids.osc]);
  assert.deepStrictEqual([...store.getSelection().edges], ['edge-1']);
  s2.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [ids.osc] } });
  s2.dispatch({ type: 'VIEW_SET', view: { timeline: { pxPerSecond: 50 } } });
  s2.dispatch({ type: 'NODE_MOVE', nodeId: ids.osc, position: { x: 3, y: 3 } });
  assert.deepStrictEqual(events, ['selection', 'view', 'model']);
  assert.ok(ACTION_TYPES.includes('SELECTION_CHANGE'));
});

test('copy/paste maps a subgraph to new ids with internal edges and an offset (§121)', () => {
  const { store, ids } = basicSynth();
  const clip = copySubgraph(store.getModel(), [ids.env, ids.filter, ids.lfo]);
  assert.strictEqual(clip.kind, CLIPBOARD_KIND);
  assert.deepStrictEqual(clip.nodes.map((x) => x.id), ['env-1', 'filter-1', 'lfo-1']);
  assert.deepStrictEqual(clip.edges.map((x) => x.id), ['edge-2', 'edge-4']);
  assert.doesNotThrow(() => assertPlainData(clip));
  const viaJson = JSON.parse(JSON.stringify(clip));
  const r = store.dispatch({ type: 'PASTE', clipboard: viaJson });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.label, 'Paste 3 nodes');
  assert.deepStrictEqual(r.created.nodes, ['env-2', 'filter-2', 'lfo-2']);
  assert.deepStrictEqual(r.created.edges, ['edge-5', 'edge-6']);
  const m = store.getModel();
  const byId = (id) => m.graph.nodes.find((x) => x.id === id);
  assert.deepStrictEqual(byId('filter-2').position, { x: 430 + PASTE_OFFSET.x,
    y: 160 + PASTE_OFFSET.y });
  assert.deepStrictEqual(byId('filter-2').params, byId('filter-1').params);
  assert.strictEqual(byId('filter-2').metadata.name, 'Filter 2');
  const pasted = m.graph.edges.filter((x) => r.created.edges.includes(x.id));
  assert.deepStrictEqual(pasted.map((x) => `${x.from.node}.${x.from.port}→${x.to.node}.`
    + `${x.to.port}`), ['env-2.audio→filter-2.audio', 'lfo-2.control→filter-2.frequency']);
  assert.deepStrictEqual(pasted[1].props, m.graph.edges.find((x) => x.id === 'edge-4').props);
  assert.deepStrictEqual([...store.getSelection().nodes], r.created.nodes);
  // Master is skipped on paste (one per Studio), not duplicated.
  const all = copySubgraph(store.getModel(), store.getModel().graph.nodes.map((x) => x.id));
  const r2 = store.dispatch({ type: 'PASTE', clipboard: all, offset: { x: 0, y: 400 } });
  assert.ok(r2.ok, r2.reason);
  assert.deepStrictEqual(r2.skipped, ['master-1']);
  assert.strictEqual(store.getModel().graph.nodes.filter((x) => x.type === 'master').length, 1);
  assert.strictEqual(store.dispatch({ type: 'PASTE', clipboard: { kind: 'x' } }).ok, false);
  const evil = { ...clip, nodes: [{ ...clip.nodes[0], type: 'nope' }] };
  assert.strictEqual(store.dispatch({ type: 'PASTE', clipboard: evil }).ok, false);
});

test('duplicate keeps relative geometry and payloads with new ids (§88, §123)', () => {
  const { store, ids } = basicSynth();
  const r = store.dispatch({ type: 'DUPLICATE', nodeIds: [ids.filter] });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.label, 'Duplicate Filter 1');
  assert.deepStrictEqual(r.created.nodes, ['filter-2']);
  const m = store.getModel();
  const f2 = m.graph.nodes.find((x) => x.id === 'filter-2');
  assert.deepStrictEqual(f2.position, { x: 454, y: 184 });
  const pair = store.dispatch({ type: 'DUPLICATE', nodeIds: [ids.osc, ids.env],
    offset: { x: 0, y: 300 } });
  const pm = store.getModel();
  const [o2, e2] = pair.created.nodes.map((id) => pm.graph.nodes.find((x) => x.id === id));
  assert.strictEqual(e2.position.x - o2.position.x, 200);
  assert.ok(pm.graph.edges.some((x) => x.from.node === o2.id && x.to.node === e2.id));
  const clipId = pm.timeline.clips[0].id;
  const rc = store.dispatch({ type: 'DUPLICATE', clipIds: [clipId] });
  assert.ok(rc.ok, rc.reason);
  const copy = store.getModel().timeline.clips.find((x) => x.id === rc.created.clips[0]);
  assert.strictEqual(copy.start, 1);
  assert.deepStrictEqual(copy.payload, pm.timeline.clips[0].payload);
  assert.notStrictEqual(copy.id, clipId);
  assert.strictEqual(store.dispatch({ type: 'DUPLICATE', nodeIds: [] }).ok, false);
});

test('timeline actions validate references and undo exactly', () => {
  const { store, ids } = basicSynth();
  const b = builder(store);
  const start = store.getModel();
  const track = start.timeline.tracks[0].id;
  const clip = start.timeline.clips[0].id;
  const fail = (action, re) => {
    const r = store.dispatch(action);
    assert.strictEqual(r.ok, false, JSON.stringify(action));
    if (re) assert.match(r.reason, re);
  };
  fail({ type: 'CLIP_ADD', trackId: 'ghost', start: 0, duration: 1 }, /no track/);
  fail({ type: 'CLIP_ADD', trackId: track, start: 0, duration: 1, target: ids.filter },
    /cannot play pattern clips/);
  fail({ type: 'CLIP_ADD', trackId: track, start: -1, duration: 1 }, /between 0/);
  fail({ type: 'CLIP_RESIZE', clipId: clip, duration: 0.001 }, /at least/);
  fail({ type: 'CLIP_ADD', trackId: track, start: 0, duration: 1, kind: 'measurement',
    payload: { action: 'stimulus' } }, /cannot go on a event track/);
  fail({ type: 'CLIP_ADD', trackId: track, start: 0, duration: 1,
    payload: { blockType: 'laser' } }, /Unknown pattern block type/);
  fail({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter, param: 'type' }, time: 0,
    value: 1 }, /cannot be automated/);
  fail({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.master, param: 'level' }, time: 0,
    value: 0.1 }, /cannot be automated/);
  fail({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter, param: 'frequency' },
    time: 4, value: 0, curve: 'exponential' });
  fail({ type: 'TRACK_ADD', kind: 'event', target: 'ghost' }, /no node/);
  fail({ type: 'MARKER_ADD', time: 1, kind: 'party' }, /marker kind/);
  fail({ type: 'LOOP_SET', start: 3, end: 2 }, /start < end/);
  fail({ type: 'TRANSPORT_SET', tempo: 1000 }, /Tempo/);
  fail({ type: 'NODE_PARAM_SET', nodeId: ids.filter, key: 'frequency', value: 'loud' },
    /finite number/);
  fail({ type: 'NODE_PARAM_SET', nodeId: ids.filter, key: 'wobble', value: 1 }, /no parameter/);
  fail({ type: 'NOT_AN_ACTION' }, /Unknown action/);
  fail(null, /type/);
  assert.strictEqual(store.getModel(), start);
  b.ok(store.dispatch({ type: 'CLIP_MOVE', clipId: clip, start: 0.25 }));
  b.ok(store.dispatch({ type: 'CLIP_RESIZE', clipId: clip, duration: 0.5 }));
  const lane = store.getModel().timeline.automation[0];
  b.ok(store.dispatch({ type: 'AUTOMATION_POINT_MOVE', laneId: lane.id,
    pointId: lane.points[0].id, time: 3.5 }));
  assert.deepStrictEqual(store.getModel().timeline.automation[0].points.map((p) => p.time),
    [3, 3.5], 'points stay sorted');
  b.ok(store.dispatch({ type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id,
    pointId: lane.points[1].id }));
  b.ok(store.dispatch({ type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id,
    pointId: lane.points[0].id }));
  assert.strictEqual(store.getModel().timeline.automation.length, 0, 'empty lane removed');
  const marker = b.ok(store.dispatch({ type: 'MARKER_ADD', time: 2, kind: 'capture',
    label: 'Capture' })).created.markers[0];
  b.ok(store.dispatch({ type: 'MARKER_REMOVE', markerId: marker }));
  b.ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 3 }));
  b.ok(store.dispatch({ type: 'TRANSPORT_SET', tempo: 96 }));
  b.ok(store.dispatch({ type: 'CLIP_REMOVE', clipId: clip }));
  b.ok(store.dispatch({ type: 'TRACK_REMOVE', trackId: track }));
  assert.strictEqual(store.getModel().timeline.clips.length, 0, 'track removal cascades');
  while (store.getModel() !== start) assert.ok(store.undo().ok);
  assert.strictEqual(serializeStudio(store.getModel()), serializeStudio(start));
});

test('edge update and removal are undoable; history depth is bounded', () => {
  const { store } = basicSynth();
  const mod = store.getModel().graph.edges[3];
  const r = store.dispatch({ type: 'EDGE_UPDATE', edgeId: mod.id, props: { depth: 600,
    polarity: 'unipolar' } });
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.label, 'Edit connection LFO 1 → Filter 1');
  assert.strictEqual(store.getModel().graph.edges[3].props.depth, 600);
  assert.strictEqual(store.dispatch({ type: 'EDGE_UPDATE', edgeId: mod.id,
    props: { mapping: 'cubic' } }).ok, false);
  assert.strictEqual(store.dispatch({ type: 'EDGE_UPDATE', edgeId: store.getModel().graph
    .edges[0].id, props: { depth: 1 } }).ok, false);
  const rm = store.dispatch({ type: 'EDGE_REMOVE', edgeId: mod.id });
  assert.strictEqual(rm.label, 'Disconnect LFO 1 from Filter 1');
  store.undo();
  store.undo();
  assert.deepStrictEqual(store.getModel().graph.edges[3], mod);
  assert.strictEqual(STUDIO_HISTORY_LIMIT, 200);
  const small = newStore(null, { historyLimit: 3 });
  const sb = builder(small);
  for (let i = 0; i < 5; i++) sb.add('gain', i * 10, 0);
  assert.strictEqual(small.debugInfo().undoDepth, 3);
  const h = createHistory({ limit: 2 });
  h.record({ label: 'a', before: 1, after: 2 });
  h.record({ label: 'b', before: 2, after: 3 });
  h.record({ label: 'c', before: 3, after: 4 });
  assert.deepStrictEqual(h.depth(), { undo: 2, redo: 0 });
  assert.strictEqual(h.undo().label, 'c');
  assert.throws(() => createHistory({ limit: 0 }), RangeError);
});

test('store models are frozen plain data and the initial model must be valid', () => {
  const { store } = basicSynth();
  const m = store.getModel();
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.graph.nodes[0].params));
  assert.throws(() => { m.graph.nodes.push({}); }, TypeError);
  assert.doesNotThrow(() => assertPlainData(m));
  const invalid = rawModel([n('m1', 'master'), n('m2', 'master')]);
  assert.throws(() => newStore(invalid), /initial model is invalid/);
  const info = store.debugInfo();
  assert.deepStrictEqual(Object.keys(info).sort(), ['edgeCount', 'inGesture', 'lastAction',
    'nodeCount', 'redoDepth', 'revision', 'undoDepth']);
});
