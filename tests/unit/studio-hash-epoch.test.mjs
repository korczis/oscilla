// K022 (D2): one hash epoch for every new parameter on an existing node type. STUDIO_HASH_VERSION
// goes from 1 to 2 once, with unison and spread (Oscillator), slope (Filter), depth and sync
// (LFO), sync (Random), sync and quantize (Step Modulator) and bypass (Gain, Pan, Drive). A
// project, a patch and an experiment saved under hash v1 open migrated, their original hash kept;
// the new parameters at their defaults build what the node built before; each new parameter acts
// (a Macro on an LFO's depth, unison voices, a 24 dB/oct cascade, tempo sync, Step quantize,
// bypass).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HASH_EPOCH_PARAMS, STUDIO_HASH_VERSION, STUDIO_KIND, executionState, hashEpochOf,
  serializeStudio, studioHash, studioHashAt,
} from '../../src/js/studio/schema.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioLibrary, hashMigrationText } from '../../src/js/studio/library.js';
import { createMemoryStore } from '../../src/js/experiments/store.js';
import { verifyExperimentStudio } from '../../src/js/studio/provenance.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { quantizeSteps } from '../../src/js/studio/adapters/modulation.js';
import { TEMPO_DIVISIONS, divisionSeconds } from '../../src/js/studio/nodes/common.js';
import { unisonDetune } from '../../src/js/studio/nodes/sources.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

/** The plan's list (K022's objective), type -> the keys epoch 2 adds. */
const EPOCH_2 = {
  oscillator: ['unison', 'spread'], filter: ['slope'], lfo: ['depth', 'sync'],
  random: ['sync'], 'step-modulator': ['sync', 'quantize'], gain: ['bypass'], pan: ['bypass'],
  drive: ['bypass'],
};
/** subtractive-synth's studioHash as main pinned it under hash epoch 1 (before K022). */
const SUBTRACTIVE_V1 = '3982a31f8fe6f92f9206bca48ab19b7cfe091105fdb841143e7d1f1e892ec424';

/** A document as hash epoch 1 saved it: the model's own JSON without epoch 2's parameters. */
function v1Doc(model) {
  const doc = JSON.parse(serializeStudio(model));
  for (const n of doc.graph.nodes) for (const k of EPOCH_2[n.type] || []) delete n.params[k];
  return doc;
}

test('STUDIO_HASH_VERSION is bumped once, and every new parameter is in that bump', () => {
  assert.equal(STUDIO_HASH_VERSION, 2);
  assert.deepEqual(Object.keys(HASH_EPOCH_PARAMS), ['2'], 'one epoch after the first');
  assert.deepEqual(JSON.parse(JSON.stringify(HASH_EPOCH_PARAMS[2])), EPOCH_2);
  for (const [type, keys] of Object.entries(EPOCH_2)) {
    for (const k of keys) assert.ok(NODE_REGISTRY.param(type, k), `${type}.${k} exists`);
  }
  const lfoDepth = NODE_REGISTRY.param('lfo', 'depth');
  assert.equal(lfoDepth.modulatable, true, 'the LFO depth takes modulation');
  assert.equal(lfoDepth.automatable, true);
  assert.ok(NODE_REGISTRY.port('lfo', 'depth', 'in'), 'and has its CONTROL input');
});

test('the epoch 1 hash of a template is the one main pinned; the current hash differs', () => {
  const m = templateModel('subtractive-synth');
  assert.equal(studioHashAt(m, 1), SUBTRACTIVE_V1);
  assert.notEqual(studioHash(m), SUBTRACTIVE_V1);
  assert.equal(executionState(m).v, 2);
  assert.equal(hashEpochOf(m, SUBTRACTIVE_V1), 1);
  assert.equal(hashEpochOf(m, studioHash(m)), 2);
  // A value epoch 1 could not record is never matched to an epoch 1 hash.
  const st = createStudioStore(m, { idGenerator: createIdGenerator(m) });
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'unison', value: 3 })
    .ok, true);
  assert.equal(studioHashAt(st.getModel(), 1), null);
  assert.equal(hashEpochOf(st.getModel(), SUBTRACTIVE_V1), null);
});

test('a project and a patch saved under hash v1 open migrated, the original hash kept', async () => {
  const store = createMemoryStore();
  const lib = createStudioLibrary(store);
  const m = templateModel('subtractive-synth');
  await store.putStudio({ id: 'p-v1', kind: STUDIO_KIND, name: 'Old synth',
    savedAt: '2026-11-01T00:00:00.000Z', studioHash: SUBTRACTIVE_V1, doc: v1Doc(m) });
  const r = await lib.loadProject('p-v1');
  assert.deepEqual(r.hashMigration, { from: 1, originalHash: SUBTRACTIVE_V1 });
  assert.equal(studioHash(r.model), studioHash(m), 'the new parameters at their defaults');
  const text = hashMigrationText(r.hashMigration);
  assert.match(text, /hashem v1, převedeno na v2/);
  assert.ok(text.includes(SUBTRACTIVE_V1.slice(0, 12)), 'it names the original hash');
  const kept = await store.getStudio('p-v1');
  assert.equal(kept.studioHash, SUBTRACTIVE_V1, 'the stored record is not rewritten');
  // A record saved now opens with no migration; a tampered v1 record is still corrupt.
  const saved = await lib.saveProject(m, { id: 'p-v2', now: '2026-11-09T00:00:00.000Z' });
  assert.equal((await lib.loadProject(saved.id)).hashMigration, null);
  const bad = v1Doc(m);
  bad.graph.nodes.find((n) => n.id === 'filter-1').params.frequency = 501;
  await store.putStudio({ id: 'p-bad', kind: STUDIO_KIND, name: 'Tampered',
    savedAt: '2026-11-01T00:00:00.000Z', studioHash: SUBTRACTIVE_V1, doc: bad });
  await assert.rejects(lib.loadProject('p-bad'), /does not match its stored studioHash/);
});

test('an experiment whose Studio block is hash v1 verifies migrated, its hash as recorded', () => {
  const m = templateModel('measurement-sweep');
  const execution = JSON.parse(canonicalJson(executionState(m, 1)));
  const block = { schemaVersion: m.schemaVersion, studioHash: studioHashAt(m, 1), execution };
  const r = verifyExperimentStudio({ studio: block });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hashMigration, { from: 1, originalHash: block.studioHash,
    studioHash: studioHash(m) });
  const wrong = verifyExperimentStudio({ studio: { ...block, studioHash: studioHash(m) } });
  assert.equal(wrong.ok, false, 'a v1 block carrying another epoch\'s hash is refused');
});

// ---------------------------------------------------------------- the parameters act

function running(model) {
  const fx = createFakeAudioEnv({ sampleRate: 44100 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const r = runtime.apply(model, { revision: 1 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(runtime.start().ok, true);
  return { fx, engine, runtime, ctx: fx.ctx };
}

function graph(nodes, edges = []) {
  const st = createStudioStore(templateModel('basic-tone'), { idGenerator: createIdGenerator() });
  const m = st.getModel();
  const doc = { ...m, graph: { nodes: [...m.graph.nodes.filter((n) => n.type === 'master'),
    ...nodes.map(([id, type, params]) => ({ id, type, position: { x: 0, y: 0 }, params,
      metadata: { name: id } }))],
  edges: edges.map(([id, from, to, props = {}]) => ({ id, from: { node: from[0], port: from[1] },
    to: { node: to[0], port: to[1] }, props })) }, timeline: { ...m.timeline, tracks: [],
    clips: [], automation: [] } };
  return createStudioStore(doc, { idGenerator: createIdGenerator(doc) }).getModel();
}

test('a Macro drives an LFO depth through a CONTROL edge with its own depth and polarity', () => {
  const master = templateModel('basic-tone').graph.nodes.find((n) => n.type === 'master').id;
  const m = graph([['macro-1', 'macro', { value: 0.5 }], ['lfo-1', 'lfo', { depth: 0.2 }],
    ['osc-1', 'oscillator', {}]],
  [['e-1', ['macro-1', 'control'], ['lfo-1', 'depth'], { depth: 0.6, polarity: 'unipolar' }],
    ['e-2', ['lfo-1', 'control'], ['osc-1', 'detune'], { depth: 50 }],
    ['e-3', ['osc-1', 'audio'], [master, 'audio']]]);
  const plan = compileStudio(m);
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  assert.equal(plan.edges.get('e-1').props.polarity, 'unipolar', 'the edge keeps its polarity');
  assert.equal(plan.edges.get('e-1').props.depth, 0.6, 'and its own depth');
  const s = running(m);
  const eh = s.runtime.edges.get('e-1');
  assert.equal(eh.status, 'active', eh.reason);
  const lfo = s.runtime.nodes.get('lfo-1');
  assert.equal(lfo.modTarget('depth', 'linear').param, lfo.outputs.control.gain,
    'the edge drives the gain after the LFO\'s oscillator');
  assert.equal(s.runtime.debugInfo().inactiveEdges.length, 0);
});

test('unison: n engine oscillators detuned across spread, one bus each for frequency and detune',
  () => {
    assert.deepEqual([0, 1, 2].map((i) => unisonDetune(i, 3, 20)), [-10, 0, 10]);
    assert.equal(unisonDetune(0, 1, 50), 0, 'one voice is not detuned');
    const one = running(graph([['osc-1', 'oscillator', {}]]));
    assert.equal(one.runtime.nodes.get('osc-1').info.voices, 1);
    const s = running(graph([['osc-1', 'oscillator', { unison: 5, spread: 40 }]]));
    const h = s.runtime.nodes.get('osc-1');
    assert.equal(h.info.voices, 5);
    assert.equal(h.status, 'ready');
    assert.ok(h.modTarget('frequency', 'linear').param, 'one frequency target for every voice');
    const set = h.info.mix.gain.calls.find((c) => c[0] === 'setValueAtTime');
    assert.equal(set && set[1], 1 / 5, 'the voices sum at 1/n');
  });

test('unison is peak-safe: at spread 0 and 10 ct the summed voices never pass one voice', () => {
  // The engine starts every voice at the same time, so their sines start in phase (the worst
  // case: at spread 0 they stay aligned, at any spread they align again at the beat rate).
  const sr = 44100;
  for (const n of [2, 3, 7]) {
    for (const spread of [0, 10]) {
      let peak = 0;
      let rootN = 0;
      for (let k = 0; k < sr; k++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const f = 440 * 2 ** (unisonDetune(i, n, spread) / 1200);
          sum += Math.sin((2 * Math.PI * f * k) / sr);
        }
        peak = Math.max(peak, Math.abs(sum / n));
        rootN = Math.max(rootN, Math.abs(sum / Math.sqrt(n)));
      }
      assert.ok(peak <= 1 + 1e-9, `n ${n}, spread ${spread}: peak ${peak} within one voice`);
      assert.ok(rootN > 1.2, `n ${n}, spread ${spread}: 1/sqrt(n) would peak at ${rootN}`);
    }
  }
});

test('slope 24 cascades two biquads on low- and high-pass only; 12 keeps one', () => {
  const s = running(graph([['f-12', 'filter', {}], ['f-24', 'filter', { slope: '24' }],
    ['f-hp', 'filter', { type: 'highpass', slope: '24' }],
    ['f-bp', 'filter', { type: 'bandpass', slope: '24' }],
    ['f-notch', 'filter', { type: 'notch', slope: '24' }],
    ['f-shelf', 'filter', { type: 'lowshelf', slope: '24' }]]));
  for (const id of ['f-24', 'f-hp']) {
    assert.equal(s.runtime.nodes.get(id).info.slope, 24, id);
    assert.equal(s.runtime.nodes.get(id).info.stages.length, 2, id);
  }
  for (const id of ['f-12', 'f-bp', 'f-notch', 'f-shelf']) {
    assert.equal(s.runtime.nodes.get(id).info.slope, undefined, `${id}: one biquad`);
  }
  const opt = NODE_REGISTRY.param('filter', 'slope').options.find((o) => o[0] === '24');
  assert.match(opt[1], /low-\/high-pass/, 'the option says where 24 dB/oct applies');
});

test('sync: one period per tempo division of the transport, in the compiled plan', () => {
  assert.deepEqual(TEMPO_DIVISIONS, ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32']);
  assert.equal(divisionSeconds('1/4', 120), 0.5, 'a quarter note at 120 BPM');
  const m = graph([['lfo-1', 'lfo', { rate: 3, sync: '1/8' }],
    ['rnd-1', 'random', { sync: '1/4' }], ['st-1', 'step-modulator', { sync: 'off', rate: 2 }]]);
  const plan = compileStudio(m);
  const tempo = m.transport.tempo;
  assert.equal(plan.nodes.get('lfo-1').params.rate, 1 / divisionSeconds('1/8', tempo));
  assert.equal(plan.nodes.get('rnd-1').params.rate, 1 / divisionSeconds('1/4', tempo));
  assert.equal(plan.nodes.get('st-1').params.rate, 2, 'off keeps its own rate');
});

test('Step quantize rounds each step to a twelfth; off keeps it', () => {
  assert.deepEqual(quantizeSteps([0.5, 0.04, -0.3, 1], 'semitone'),
    [6 / 12, 0, -4 / 12, 1]);
  assert.deepEqual(quantizeSteps([0.04, -0.3], 'off'), [0.04, -0.3]);
});

test('bypass passes the audio unchanged and takes no modulation', () => {
  const s = running(graph([['g-1', 'gain', { gain: 0, bypass: true }],
    ['d-1', 'drive', { bypass: true }], ['p-1', 'pan', { pan: -1, bypass: true }]]));
  for (const id of ['g-1', 'd-1', 'p-1']) {
    const h = s.runtime.nodes.get(id);
    assert.equal(h.info.bypassed, true, id);
    assert.match(h.modTarget(id === 'd-1' ? 'trim' : id === 'g-1' ? 'gain' : 'pan', 'linear')
      .reason, /Bypass/);
  }
  const g = s.runtime.nodes.get('g-1');
  assert.equal(g.inputs.audio, g.outputs.audio, 'one unity gain');
});

test('at their defaults the new parameters build what the node built before', () => {
  const m = templateModel('subtractive-synth');
  const s = running(m);
  for (const n of m.graph.nodes) {
    const h = s.runtime.nodes.get(n.id);
    if (n.type === 'oscillator') assert.equal(h.info.voices, 1, n.id);
    if (n.type === 'filter') assert.ok(h.info.stage && !h.info.stages, `${n.id}: one stage`);
    if (n.type === 'lfo') {
      assert.equal(h.outputs.control.gain.value, 1, `${n.id}: depth 1 passes the LFO as before`);
    }
  }
});

test('the Synth panel shows no jack for the MG depth: 62 jacks, the LFO node keeps its input', async () => {
  // K022-3 (oscilla-43 with oscilla-c1 and oscilla-c3): the panel fixes the MG's depth at 1 and
  // its amount knobs set each cable's depth, so a depth jack would be a second path to it.
  const { default: PANEL } = await import('../../src/js/synth/panels/semi-mono.js');
  assert.deepEqual(PANEL.jacksOf('mg').map((j) => j.id), ['mg.rate', 'mg.control']);
  assert.equal(PANEL.modules.reduce((n, m) => n + PANEL.jacksOf(m.id).length, 0), 62);
  assert.ok(NODE_REGISTRY.port('lfo', 'depth', 'in'), 'the Studio\'s LFO keeps its depth input');
});
