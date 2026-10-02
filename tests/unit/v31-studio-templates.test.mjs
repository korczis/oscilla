// V3.1 Studio templates, accessible graph text and the offline rendering plan
// (src/js/studio/templates/*, a11y.js, offline.js). Spec §105, §143-§144, §175-§176,
// §194-§196, §249-§250, §256-§258. Plan issues V423, V427, V428.
//   node --test tests/unit/v31-studio-templates.test.mjs
//
// Tolerances: none. Templates, summaries and plans are plain data and text; every assertion is
// exact (strings, hashes and times taken from the authored data without arithmetic).

import test from 'node:test';
import assert from 'node:assert';

import {
  LEARN_LIMITS, MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, STUDIO_TEMPLATES, getTemplate,
  listTemplates, templateModel, templateProvenance, validateTemplate,
} from '../../src/js/studio/templates/index.js';
import {
  announceAction, announceLabel, announceRedo, announceSelection, announceUndo, describeEdge,
  describeNode, describePortLabel, summarizeGraph, summarizeStudio,
} from '../../src/js/studio/a11y.js';
import {
  OFFLINE_TEXT, offlineEngine, planOfflineRender, renderStudioOffline,
} from '../../src/js/studio/offline.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import {
  STUDIO_KIND, normalizeStudio, serializeStudio, studioHash,
} from '../../src/js/studio/schema.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { validateClip } from '../../src/js/studio/timeline.js';
import { MIC_UNAVAILABLE_TEXT } from '../../src/js/audio/microphone.js';
import { DEFAULT_RENDER } from '../../src/js/audio/offline-renderer.js';

// ---------------------------------------------------------------- fixtures

/** The engine surface compileStudio reads (studioCapabilities): Web Audio present. */
const engineWith = (navigator) => ({ isSupported: () => true, _env: { navigator } });
const MIC_NAV = { mediaDevices: { getUserMedia() {} } };
const FILE_NAV = {}; // Chromium on file:// exposes no mediaDevices

const SPEC_249 = '6 nodes, 5 connections. Signal path: Oscillator 1 to Envelope 1 to Filter 1 '
  + 'to Master. Modulation: LFO 1 controls Filter 1 cutoff. Analysis: Spectrum 1 observes '
  + 'Filter 1 output.';

function storeOf(model) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

const raw = (nodes, edges = [], timeline = {}) => normalizeStudio({ kind: STUDIO_KIND,
  schemaVersion: 1, graph: { nodes, edges }, timeline });
const n = (id, type, params = {}, name) => ({ id, type, position: { x: 0, y: 0 }, params,
  ...(name ? { metadata: { name } } : {}) });
const e = (id, from, fromPort, to, toPort, props) => ({ id, from: { node: from, port: fromPort },
  to: { node: to, port: toPort }, ...(props ? { props } : {}) });

// ---------------------------------------------------------------- templates (§195-§196)

test('§195 the six templates exist, in library order, with unique ids', () => {
  assert.deepStrictEqual(STUDIO_TEMPLATES.map((t) => t.id), ['basic-tone', 'subtractive-synth',
    'sweep-sequence', 'stereo-beat', 'filter-automation', 'measurement-sweep']);
  assert.deepStrictEqual(listTemplates().map((t) => t.title), ['Basic Tone',
    'Subtractive Synth', 'Sweep Sequence', 'Stereo Beat', 'Filter Automation',
    'Measurement Sweep']);
  assert.strictEqual(getTemplate('nope'), null);
  assert.throws(() => templateModel('nope'), RangeError);
  assert.strictEqual(REFERENCE_TEMPLATE_ID, 'subtractive-synth');
  assert.strictEqual(MEASUREMENT_TEMPLATE_ID, 'measurement-sweep');
});

for (const t of STUDIO_TEMPLATES) {
  test(`§196 ${t.id}: canonical, versioned, validated data with a pinned hash`, () => {
    const v = validateTemplate(t);
    assert.deepStrictEqual(v.errors, []);
    assert.deepStrictEqual(v.warnings.map((w) => w.code), [], 'no unconnected or silent parts');
    assert.ok(Number.isInteger(t.version) && t.version >= 1);
    assert.strictEqual(studioHash(templateModel(t.id)), t.studioHash);
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.model.graph.nodes[0]), 'frozen data');
    // Learn text (§194): one summary and a few short points.
    assert.ok(t.learn.summary.length <= LEARN_LIMITS.summaryChars);
    assert.ok(t.learn.points.length >= 1 && t.learn.points.length <= LEARN_LIMITS.points);
    // The normalized model round-trips through the untrusted import pipeline unchanged.
    const m = templateModel(t.id);
    const back = importStudio(serializeStudio(m));
    assert.strictEqual(back.ok, true);
    assert.strictEqual(serializeStudio(back.model), serializeStudio(m));
    // Every clip passes the editor-level clip rules too (timeline.js).
    for (const c of m.timeline.clips) {
      const r = validateClip(m, c);
      assert.deepStrictEqual([r.errors, r.warnings], [[], []], c.id);
    }
    assert.deepStrictEqual(templateProvenance(t), { templateId: t.id,
      templateVersion: t.version, studioHash: t.studioHash });
  });

  test(`§256 ${t.id}: compiles; only a Microphone without permission degrades`, () => {
    const m = templateModel(t.id);
    const plan = compileStudio(m, { engine: engineWith(MIC_NAV) });
    assert.strictEqual(plan.ok, true);
    for (const node of plan.nodes.values()) {
      if (node.type === 'microphone') {
        assert.strictEqual(node.status, 'degraded');
        assert.match(node.reason, /Microphone input is off/);
      } else {
        assert.ok(['ready', 'data'].includes(node.status), `${node.id} ${node.status}`);
      }
    }
    const granted = compileStudio(m, { engine: engineWith(MIC_NAV),
      options: { inputPermission: true } });
    assert.ok([...granted.nodes.values()].every((x) => ['ready', 'data'].includes(x.status)));
    const fileUrl = compileStudio(m, { engine: engineWith(FILE_NAV) });
    for (const node of fileUrl.nodes.values()) {
      if (node.type === 'microphone') assert.strictEqual(node.reason, MIC_UNAVAILABLE_TEXT);
    }
  });
}

test('templateModel returns a fresh, independent copy each time', () => {
  const a = templateModel('basic-tone');
  a.graph.nodes[0].params.frequency = 880;
  assert.strictEqual(templateModel('basic-tone').graph.nodes[0].params.frequency, 440);
  assert.strictEqual(getTemplate('basic-tone').model.graph.nodes[0].params.frequency, 440);
});

test('§196 any executed change fails the pinned hash until the version is raised', () => {
  const t = getTemplate('basic-tone');
  const changed = JSON.parse(JSON.stringify(t));
  changed.model.graph.nodes[0].params.frequency = 441;
  assert.match(validateTemplate(changed).errors.join(), /studioHash is [0-9a-f]{64}/);
  // Presentation is not executed: moving or renaming a node keeps the hash.
  const moved = JSON.parse(JSON.stringify(t));
  moved.model.graph.nodes[0].position = { x: 999, y: 999 };
  moved.model.graph.nodes[0].metadata = { name: 'Tone' };
  assert.deepStrictEqual(validateTemplate(moved).errors, []);
  const bad = JSON.parse(JSON.stringify(t));
  bad.learn.points = ['a', 'b', 'c', 'd', 'e'];
  bad.id = 'Bad Id';
  assert.deepStrictEqual(validateTemplate(bad).errors, ['invalid id',
    `learn.points must be at most ${LEARN_LIMITS.points} short texts`]);
});

test('§257 Subtractive Synth is the Basic Synth reference topology', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const types = Object.fromEntries(m.graph.nodes.map((x) => [x.id, x.type]));
  const route = (x) => `${types[x.from.node]}.${x.from.port}>${types[x.to.node]}.${x.to.port}`;
  assert.deepStrictEqual(m.graph.edges.map(route), ['oscillator.audio>envelope.audio',
    'envelope.audio>filter.audio', 'filter.audio>master.audio', 'lfo.control>filter.frequency',
    'filter.audio>spectrum.audio']);
  assert.deepStrictEqual(m.timeline.clips.map((c) => [c.payload.blockType, c.start, c.duration]),
    [['tone', 0, 1], ['sweep', 1, 2]]);
  const lane = m.timeline.automation[0];
  assert.deepStrictEqual(lane.target, { node: 'filter-1', param: 'frequency' });
  assert.deepStrictEqual(lane.points.map((p) => [p.time, p.value, p.curve]),
    [[0, 500, 'linear'], [3, 8000, 'exponential']]);
  assert.deepStrictEqual(m.graph.edges[3].props, { muted: false, depth: 1, polarity: 'bipolar',
    mapping: 'log', offset: 0 });
});

test('§258 Measurement Sweep is the measurement topology; the microphone never sounds', () => {
  const m = templateModel(MEASUREMENT_TEMPLATE_ID);
  const types = Object.fromEntries(m.graph.nodes.map((x) => [x.id, x.type]));
  const route = (x) => `${types[x.from.node]}.${x.from.port}>${types[x.to.node]}.${x.to.port}`;
  assert.deepStrictEqual(m.graph.edges.map(route), ['sweep.audio>master.audio',
    'sweep.reference>transfer-analyzer.reference', 'microphone.capture>calibration.observed',
    'calibration.observed>transfer-analyzer.observed',
    'transfer-analyzer.result>measurement-result.result']);
  assert.ok(!m.graph.edges.some((x) => x.from.node === 'mic-1' && x.from.port === 'audio'));
  assert.deepStrictEqual(m.timeline.clips.map((c) => c.payload.action), ['noise-check',
    'pre-roll', 'stimulus', 'tail', 'analysis', 'capture']);
  // Swapping reference and observed is impossible in the model (§191).
  const swapped = JSON.parse(serializeStudio(m));
  swapped.graph.edges[1].to.port = 'observed';
  swapped.graph.edges[3].to.port = 'reference';
  assert.strictEqual(importStudio(swapped).ok, false);
});

// ---------------------------------------------------------------- §249 summary

test('§249 the Subtractive Synth graph reads exactly as the specification example', () => {
  assert.strictEqual(summarizeGraph(templateModel('subtractive-synth')), SPEC_249);
  assert.strictEqual(summarizeStudio(templateModel('subtractive-synth')),
    `${SPEC_249} Timeline: 1 track, 2 clips, 1 automation lane.`);
  assert.strictEqual(summarizeStudio(templateModel('basic-tone')),
    '2 nodes, 1 connection. Signal path: Oscillator 1 to Master.');
});

test('§249 summaries of the other templates', () => {
  assert.strictEqual(summarizeGraph(templateModel('stereo-beat')), '5 nodes, 4 connections. '
    + 'Signal paths: Left tone to Stereo Split 1 to Master; Right tone to Stereo Split 1. '
    + 'Analysis: Meter 1 observes Stereo Split 1 output.');
  assert.strictEqual(summarizeGraph(templateModel('measurement-sweep')), '6 nodes, '
    + '5 connections. Signal path: Sweep 1 to Master. Measurement: Transfer Analyzer 1 takes '
    + 'reference from Sweep 1 and observed from Calibration 1; Calibration 1 takes observed '
    + 'from Microphone 1; Measurement Result 1 takes result from Transfer Analyzer 1.');
});

test('§249 empty, no master, unheard sources, triggers and muted edges', () => {
  assert.strictEqual(summarizeGraph(raw([])), 'Empty Studio: no nodes.');
  assert.strictEqual(summarizeGraph(raw([n('osc-1', 'oscillator')])),
    '1 node, 0 connections. No Master Output. Not connected to the output: Oscillator 1.');
  const m = raw([n('seq-1', 'sequence'), n('env-1', 'envelope'), n('osc-1', 'oscillator'),
    n('master-1', 'master'), n('lfo-1', 'lfo'), n('osc-2', 'oscillator')], [
    e('edge-1', 'osc-1', 'audio', 'env-1', 'audio'),
    e('edge-2', 'env-1', 'audio', 'master-1', 'audio'),
    e('edge-3', 'seq-1', 'trigger', 'env-1', 'gate'),
    e('edge-4', 'lfo-1', 'control', 'osc-1', 'detune', { muted: true, depth: 100 }),
  ]);
  assert.strictEqual(summarizeGraph(m), '6 nodes, 4 connections. Signal path: Oscillator 1 to '
    + 'Envelope 1 to Master Output 1. Not connected to the output: Sequence 1, Oscillator 2. '
    + 'Modulation: LFO 1 controls Oscillator 1 detune, muted. Triggers: Sequence 1 triggers '
    + 'Envelope 1 gate.');
  assert.strictEqual(summarizeGraph(raw([n('master-1', 'master')])),
    '1 node, 0 connections. Signal path: nothing reaches Master Output 1.');
});

test('§249 a mixer: later paths stop at the first node already named', () => {
  const m = raw([n('osc-1', 'oscillator'), n('noise-1', 'noise'), n('gain-1', 'gain'),
    n('mix-1', 'mixer'), n('master-1', 'master', {}, 'Master')], [
    e('edge-1', 'osc-1', 'audio', 'gain-1', 'audio'),
    e('edge-2', 'noise-1', 'audio', 'mix-1', 'in2'),
    e('edge-3', 'gain-1', 'audio', 'mix-1', 'in1'),
    e('edge-4', 'mix-1', 'audio', 'master-1', 'audio'),
  ]);
  assert.strictEqual(summarizeGraph(m), '5 nodes, 4 connections. Signal paths: Oscillator 1 to '
    + 'Gain 1 to Mixer 1 to Master; Noise 1 to Mixer 1.');
});

test('§250 large graphs: paths and sections are bounded', () => {
  // A 200-node gain chain and 4 sources into a mixer: one long path, elided in the middle.
  const nodes = [n('osc-1', 'oscillator')];
  const edges = [];
  let prev = 'osc-1';
  for (let i = 1; i <= 200; i++) {
    nodes.push(n(`gain-${i}`, 'gain'));
    edges.push(e(`edge-${i}`, prev, 'audio', `gain-${i}`, 'audio'));
    prev = `gain-${i}`;
  }
  nodes.push(n('master-1', 'master', {}, 'Master'));
  edges.push(e('edge-201', prev, 'audio', 'master-1', 'audio'));
  const long = summarizeGraph(raw(nodes, edges));
  assert.strictEqual(long, '202 nodes, 201 connections. Signal path: Oscillator 1 to Gain 1 to '
    + 'Gain 2 to Gain 3 to Gain 4 to Gain 5 through 195 more nodes to Master.');
  // Many modulations: maxItems entries, then "and N more".
  const mods = [n('osc-1', 'oscillator'), n('master-1', 'master')];
  const medges = [e('edge-1', 'osc-1', 'audio', 'master-1', 'audio')];
  for (let i = 1; i <= 9; i++) {
    mods.push(n(`lfo-${i}`, 'lfo'));
    medges.push(e(`edge-${i + 1}`, `lfo-${i}`, 'control', 'osc-1', 'frequency'));
  }
  const text = summarizeGraph(raw(mods, medges), { maxItems: 2 });
  assert.ok(text.endsWith('Modulation: LFO 1 controls Oscillator 1 frequency; LFO 2 controls '
    + 'Oscillator 1 frequency; and 7 more.'), text);
  // Many paths: maxPaths, then the exact remainder.
  const fan = [n('mix-1', 'mixer'), n('master-1', 'master')];
  const fedges = [e('edge-0', 'mix-1', 'audio', 'master-1', 'audio')];
  for (let i = 1; i <= 4; i++) {
    fan.push(n(`osc-${i}`, 'oscillator'));
    fedges.push(e(`edge-${i}`, `osc-${i}`, 'audio', 'mix-1', `in${i}`));
  }
  assert.match(summarizeGraph(raw(fan, fedges), { maxPaths: 2 }),
    new RegExp('Signal paths: Oscillator 1 to Mixer 1 to Master Output 1; Oscillator 2 to '
      + 'Mixer 1; and 2 more\\.'));
});

// ---------------------------------------------------------------- §143 labels

test('§143 node, connection and port labels', () => {
  const m = templateModel('subtractive-synth');
  assert.strictEqual(describeNode(m, 'osc-1', { selected: true }),
    'Oscillator 1, source node, selected');
  assert.strictEqual(describeNode(m, 'filter-1', { summary: true }),
    'Filter 1, processing node, Low-pass · 500 Hz · Q 0.707');
  assert.strictEqual(describeNode(m, 'spectrum-1', { status: 'degraded' }),
    'Spectrum 1, analysis node, unavailable');
  assert.strictEqual(describeNode(m, 'nope'), 'Unknown node');
  assert.strictEqual(describeEdge(m, 'edge-1'),
    'Connection from Oscillator 1 audio to Envelope 1 input');
  assert.strictEqual(describeEdge(m, 'edge-4', { selected: true }),
    'Connection from LFO 1 control to Filter 1 cutoff, depth 1 octave, bipolar, selected');
  assert.strictEqual(describeEdge(m, 'edge-5'),
    'Connection from Filter 1 audio to Spectrum 1 input');
  assert.strictEqual(describeEdge(m, 'nope'), 'Unknown connection');
  assert.strictEqual(describePortLabel(m, 'osc-1', 'audio', 'out'),
    'Oscillator 1 audio output, connected to Envelope 1');
  assert.strictEqual(describePortLabel(m, 'filter-1', 'Q', 'in'),
    'Filter 1 q control input, available'); // ports.js lower-cases every label
  assert.strictEqual(describePortLabel(m, 'filter-1', 'frequency', 'in'),
    'Filter 1 cutoff control input, connected to LFO 1');
  const lin = raw([n('lfo-1', 'lfo'), n('filter-1', 'filter'), n('osc-1', 'oscillator')], [
    e('edge-1', 'lfo-1', 'control', 'filter-1', 'frequency', { depth: 1200 }),
    e('edge-2', 'osc-1', 'audio', 'filter-1', 'audio', { muted: true })]);
  assert.strictEqual(describeEdge(lin, 'edge-1'),
    'Connection from LFO 1 control to Filter 1 cutoff, depth 1200 Hz, bipolar');
  assert.strictEqual(describeEdge(lin, 'edge-2'),
    'Connection from Oscillator 1 audio to Filter 1 input, muted');
});

// ---------------------------------------------------------------- §144 announcements

test('§144 semantic announcements from real store results; never coordinates', () => {
  const store = storeOf(templateModel('basic-tone'));
  const add = store.dispatch({ type: 'NODE_ADD', nodeType: 'filter',
    position: { x: 437, y: 291 } });
  assert.strictEqual(announceAction(add), 'Added Filter 1');
  const id = add.created.nodes[0];
  const moved = store.dispatch({ type: 'NODE_MOVE', nodeId: id, position: { x: 512, y: 384 } });
  assert.strictEqual(announceAction(moved), 'Moved Filter 1');
  assert.doesNotMatch(announceAction(moved), /\d{3}/, 'no pointer coordinates');
  const bad = store.dispatch({ type: 'EDGE_ADD', from: { node: 'osc-1', port: 'audio' },
    to: { node: id, port: 'frequency' } });
  assert.strictEqual(announceAction(bad), 'Connection rejected: Audio output cannot connect to '
    + 'a control input. Modulate parameters from an LFO, Envelope, Random or Step Modulator.');
  const conn = store.dispatch({ type: 'EDGE_REMOVE', edgeId: 'edge-1' });
  assert.strictEqual(announceAction(conn), 'Disconnected Oscillator 1 from Master');
  const c2 = store.dispatch({ type: 'EDGE_ADD', from: { node: 'osc-1', port: 'audio' },
    to: { node: id, port: 'audio' } });
  assert.strictEqual(announceAction(c2), 'Connected Oscillator 1 to Filter 1');
  const del = store.dispatch({ type: 'NODE_REMOVE', nodeId: id });
  assert.strictEqual(announceAction(del), 'Deleted Filter 1');
  assert.strictEqual(announceUndo(store.undo()), 'Undo: deleted Filter 1');
  assert.strictEqual(announceRedo(store.redo()), 'Redo: deleted Filter 1');
  assert.strictEqual(announceUndo({ ok: false, reason: 'Nothing to undo.' }), 'Nothing to undo.');
  assert.strictEqual(announceRedo(null), 'Nothing to redo.');
  const master = store.dispatch({ type: 'NODE_ADD', nodeType: 'master' });
  assert.strictEqual(announceAction(master), 'Not done: A Studio has exactly one Master Output.');
  // View-only changes say nothing (no per-frame chatter).
  assert.strictEqual(announceAction(store.dispatch({ type: 'VIEW_SET',
    view: { graph: { panX: 10 } } })), '');
  assert.strictEqual(announceLabel('Edit connection LFO 1 → Filter 1'),
    'Edited connection LFO 1 to Filter 1');
  assert.strictEqual(announceLabel('Insert Synth voice'), 'Inserted Synth voice');
  assert.strictEqual(announceLabel('Something else'), 'Something else');
});

test('§144 selection announcements name things and count the rest', () => {
  const m = templateModel('subtractive-synth');
  assert.strictEqual(announceSelection(m, { nodes: ['filter-1'] }), 'Filter 1 selected');
  assert.strictEqual(announceSelection(m, { nodes: ['osc-1', 'env-1'], edges: ['edge-1'] }),
    '2 nodes, 1 connection selected');
  assert.strictEqual(announceSelection(m, {}), 'Selection cleared');
});

// ---------------------------------------------------------------- §105 offline plan

test('§105 offline plan: a tone graph renders; duration is explicit or the timeline', () => {
  const tone = planOfflineRender(templateModel('basic-tone'), { duration: 2 });
  assert.strictEqual(tone.ok, true);
  assert.deepStrictEqual(tone.nodes.map((x) => [x.id, x.role]), [['osc-1', 'rendered'],
    ['master-1', 'rendered']]);
  assert.deepStrictEqual(tone.render, { sampleRate: DEFAULT_RENDER.sampleRate,
    channels: DEFAULT_RENDER.channels });
  assert.deepStrictEqual(tone.limitations, []);
  const none = planOfflineRender(templateModel('basic-tone'));
  assert.strictEqual(none.ok, false);
  assert.deepStrictEqual(none.errors.map((x) => x.message), [OFFLINE_TEXT.noDuration]);
  assert.strictEqual(planOfflineRender(templateModel('basic-tone'), { duration: 121 })
    .errors[0].code, 'too-long');
  const seq = planOfflineRender(templateModel('sweep-sequence'));
  assert.strictEqual(seq.ok, true);
  assert.strictEqual(seq.duration, 4.5, 'the end of the last clip');
  assert.ok(seq.clips.every((c) => c.rendered));
  assert.deepStrictEqual(seq.nodes.find((x) => x.id === 'sgram-1'), { id: 'sgram-1',
    name: 'Spectrogram 1', type: 'spectrogram', role: 'skipped', reason: OFFLINE_TEXT.analysis });
  const filt = planOfflineRender(templateModel('filter-automation'));
  assert.strictEqual(filt.duration, 8, 'the last automation point');
  assert.deepStrictEqual(filt.automation, [{ id: 'lane-1',
    target: { node: 'filter-1', param: 'frequency' }, rendered: true, reason: null }]);
});

test('§105 offline plan: live-only Microphone refuses with an explicit limitation', () => {
  const p = planOfflineRender(templateModel('measurement-sweep'));
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.refused, true);
  assert.strictEqual(p.limitations[0], OFFLINE_TEXT.liveInput('Microphone 1'));
  assert.deepStrictEqual(p.nodes.map((x) => x.role), ['rendered', 'rendered', 'refused',
    'skipped', 'skipped', 'skipped']);
  assert.ok(p.clips.every((c) => !c.rendered && c.reason === OFFLINE_TEXT.measurementClip));
});

test('§105 offline plan: unsupported clips are listed, the rest still renders', () => {
  const p = planOfflineRender(templateModel('subtractive-synth'));
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.duration, 3);
  assert.deepStrictEqual(p.limitations, [
    `Clip clip-1: ${OFFLINE_TEXT.patternTarget('Oscillator 1')}`,
    `Clip clip-2: ${OFFLINE_TEXT.patternTarget('Oscillator 1')}`]);
  assert.strictEqual(p.automation[0].rendered, true);
  // A gate event on an Envelope renders; a Recorder sets the format; late clips are noted.
  const m = raw([n('osc-1', 'oscillator'), n('env-1', 'envelope'), n('master-1', 'master'),
    n('rec-1', 'recorder', { sampleRate: 44100, channels: 1 })], [
    e('edge-1', 'osc-1', 'audio', 'env-1', 'audio'),
    e('edge-2', 'env-1', 'audio', 'master-1', 'audio'),
    e('edge-3', 'env-1', 'audio', 'rec-1', 'audio')], {
    tracks: [{ id: 'track-1', kind: 'event', name: 'Gates', target: 'env-1' }],
    clips: [{ id: 'clip-1', trackId: 'track-1', kind: 'event', start: 0, duration: 0.5,
      payload: { action: 'gate' } }, { id: 'clip-2', trackId: 'track-1', kind: 'event',
      start: 3, duration: 0.5, payload: { action: 'gate' } }] });
  const q = planOfflineRender(m, { duration: 2 });
  assert.strictEqual(q.ok, true);
  assert.deepStrictEqual(q.render, { sampleRate: 44100, channels: 1 });
  assert.deepStrictEqual(q.clips.map((c) => [c.id, c.rendered, c.reason]), [
    ['clip-1', true, null], ['clip-2', false, OFFLINE_TEXT.afterEnd]]);
  assert.deepStrictEqual(q.limitations, []);
  assert.strictEqual(q.nodes.find((x) => x.id === 'rec-1').reason, OFFLINE_TEXT.format);
});

test('§105 offline plan: an invalid model is refused before anything is built', () => {
  const m = raw([n('osc-1', 'oscillator'), n('master-1', 'master'), n('mic-1', 'microphone')],
    [e('edge-1', 'mic-1', 'audio', 'master-1', 'audio')]);
  const p = planOfflineRender(m, { duration: 1 });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.errors[0].code, 'live-input-to-output');
  const silent = planOfflineRender(raw([n('osc-1', 'oscillator'), n('master-1', 'master')]),
    { duration: 1 });
  assert.ok(silent.warnings.includes(OFFLINE_TEXT.silent));
});

test('§105 renderStudioOffline refuses a refused plan without touching audio', async () => {
  const r = await renderStudioOffline(templateModel('measurement-sweep'), {
    OfflineAudioContext: () => { throw new Error('must not be constructed'); } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.limitations[0], OFFLINE_TEXT.liveInput('Microphone 1'));
  // Node has no OfflineAudioContext: a renderable plan reaches the renderer, which says so.
  await assert.rejects(renderStudioOffline(templateModel('basic-tone'), { duration: 1 }),
    /OfflineAudioContext is not available/);
});

test('offlineEngine exposes only the engine surface the runtime hooks use', () => {
  const master = { gain: { value: 1 } };
  const eng = offlineEngine({ sampleRate: 48000 }, master);
  assert.strictEqual(eng.init(), true);
  assert.strictEqual(eng.safeMaximum, 22800);
  eng.setMasterGain(5);
  assert.strictEqual(master.gain.value, 0.25, 'MAX_OUTPUT_GAIN');
  eng.setMasterGain(0.08);
  assert.strictEqual(master.gain.value, 0.08);
  assert.strictEqual(eng.activeNodeCount, 0);
  assert.strictEqual(typeof eng.on(() => {}), 'function');
});
