// K168: the graph summary is structured, linked and untruncated (src/js/studio/a11y.js
// summarizeGraphModel; the Inspector's src/js/ui/studio/graph-summary-view.js lays it out).
//   node --test tests/unit/studio-graph-summary.test.mjs
//
// summarizeGraphModel is the ONE derivation of the summary: every signal path to the Master
// Output with all its nodes in order, every sounding node no path reaches, every CONTROL,
// TRIGGER, TAP and ANALYSIS edge once in its group; summarizeGraph (the §249 screen-reader
// sentence, bounded by §250) is boundedSummary of that same model. The expectations here are
// computed independently from the graph's edges and the registry's port types (a brute-force
// walk), on the shipped templates and on a 26-node patch shaped like the owner's of 2026-11-03
// (VCOs into a mixer chain of 8 nodes to Master, an unconnected Oscillator, 11 modulation edges,
// triggers, analysis taps). Tolerances: none (plain data and text).

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUMMARY_DEFAULTS, SUMMARY_SECTIONS, boundedSummary, summarizeGraph, summarizeGraphModel,
} from '../../src/js/studio/a11y.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { STUDIO_TEMPLATES, templateModel } from '../../src/js/studio/templates/index.js';
import { STUDIO_KIND, normalizeStudio } from '../../src/js/studio/schema.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const raw = (nodes, edges = []) => normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1,
  graph: { nodes, edges }, timeline: {} });
const n = (id, type, name) => ({ id, type, position: { x: 0, y: 0 }, params: {},
  ...(name ? { metadata: { name } } : {}) });
const e = (id, from, fromPort, to, toPort, props) => ({ id, from: { node: from, port: fromPort },
  to: { node: to, port: toPort }, ...(props ? { props } : {}) });

/** The 26-node patch of the owner's defect report, shaped as described above. */
export function ownerPatch() {
  const nodes = [
    n('vco-1', 'vco'), n('vco-2', 'vco'), n('vco-3', 'vco'), n('noise-1', 'noise'),
    n('osc-1', 'oscillator'), n('mixer-1', 'mixer'), n('filter-1', 'filter'),
    n('ring-1', 'ring'), n('filter-2', 'filter'), n('env-1', 'envelope'), n('gain-1', 'gain'),
    n('pan-1', 'pan'), n('master-1', 'master'), n('osc-2', 'oscillator'), n('lfo-1', 'lfo'),
    n('lfo-2', 'lfo'), n('lfo-3', 'lfo'), n('lfo-4', 'lfo'), n('macro-1', 'macro'),
    n('seq-1', 'sequence'), n('step-1', 'step-modulator'), n('random-1', 'random'),
    n('spectrum-1', 'spectrum'), n('scope-1', 'scope'), n('meter-1', 'meter'),
    n('recorder-1', 'recorder'),
  ];
  const edges = [
    e('edge-1', 'vco-1', 'audio', 'mixer-1', 'in1'),
    e('edge-2', 'vco-2', 'audio', 'mixer-1', 'in2'),
    e('edge-3', 'vco-3', 'audio', 'mixer-1', 'in3'),
    e('edge-4', 'noise-1', 'audio', 'mixer-1', 'in4'),
    e('edge-5', 'mixer-1', 'audio', 'filter-1', 'audio'),
    e('edge-6', 'filter-1', 'audio', 'ring-1', 'carrier'),
    e('edge-7', 'ring-1', 'audio', 'filter-2', 'audio'),
    e('edge-8', 'filter-2', 'audio', 'env-1', 'audio'),
    e('edge-9', 'env-1', 'audio', 'gain-1', 'audio'),
    e('edge-10', 'gain-1', 'audio', 'pan-1', 'audio'),
    e('edge-11', 'pan-1', 'audio', 'master-1', 'audio'),
    e('edge-12', 'osc-1', 'audio', 'ring-1', 'modulator', { muted: false }),
    e('edge-13', 'lfo-1', 'control', 'filter-1', 'frequency'),
    e('edge-14', 'lfo-1', 'control', 'filter-2', 'frequency'),
    e('edge-15', 'lfo-2', 'control', 'vco-1', 'pitch'),
    e('edge-16', 'lfo-2', 'control', 'vco-2', 'pitch', { muted: true }),
    e('edge-17', 'lfo-3', 'control', 'pan-1', 'pan'),
    e('edge-18', 'lfo-3', 'control', 'gain-1', 'gain'),
    e('edge-19', 'lfo-4', 'control', 'mixer-1', 'level1'),
    e('edge-20', 'lfo-4', 'control', 'filter-1', 'Q'),
    e('edge-21', 'macro-1', 'control', 'osc-2', 'detune'),
    e('edge-22', 'seq-1', 'trigger', 'env-1', 'gate'),
    e('edge-23', 'seq-1', 'trigger', 'step-1', 'clock'),
    e('edge-24', 'seq-1', 'trigger', 'random-1', 'trigger'),
    e('edge-25', 'step-1', 'control', 'vco-3', 'tune'),
    e('edge-26', 'random-1', 'control', 'osc-1', 'frequency'),
    e('edge-27', 'filter-1', 'audio', 'spectrum-1', 'audio'),
    e('edge-28', 'pan-1', 'audio', 'scope-1', 'audio'),
    e('edge-29', 'gain-1', 'audio', 'meter-1', 'audio'),
    e('edge-30', 'pan-1', 'audio', 'recorder-1', 'audio'),
  ];
  return raw(nodes, edges);
}

// ---------------------------------------------------------------- the independent oracle

/** Port types of an edge, read from the registry (null when it does not resolve). */
function ports(m, edge) {
  const type = (id) => (m.graph.nodes.find((x) => x.id === id) || {}).type;
  const from = NODE_REGISTRY.port(type(edge.from.node), edge.from.port, 'out');
  const to = NODE_REGISTRY.port(type(edge.to.node), edge.to.port, 'in');
  return from && to ? { from, to } : null;
}

/** Every source-to-master path over AUDIO edges into SIGNAL inputs, as edge-id lists. */
function oraclePaths(m) {
  const master = m.graph.nodes.find((x) => x.type === 'master');
  if (!master) return [];
  const sig = m.graph.edges.filter((x) => {
    const p = ports(m, x);
    return p && p.from.type === 'AUDIO' && p.to.role === 'SIGNAL';
  });
  const out = [];
  const back = (node, suffix) => {
    const ins = sig.filter((x) => x.to.node === node);
    if (!ins.length) { if (suffix.length) out.push(suffix); return; }
    for (const x of ins) back(x.from.node, [x.id, ...suffix]);
  };
  back(master.id, []);
  return out;
}

function oracleGroups(m) {
  const g = { modulation: [], triggers: [], analysis: [], measurement: [] };
  for (const x of m.graph.edges) {
    const p = ports(m, x);
    if (!p) continue;
    if (p.from.type === 'CONTROL') g.modulation.push(x.id);
    else if (p.from.type === 'TRIGGER') g.triggers.push(x.id);
    else if (p.from.type === 'AUDIO' && p.to.role === 'TAP') g.analysis.push(x.id);
    else if (p.from.type === 'ANALYSIS') g.measurement.push(x.id);
  }
  return g;
}

const section = (s, id) => s.sections.find((x) => x.id === id);
const sorted = (a) => [...a].sort();

/** The whole contract on one model: paths complete, groups exact, sentence = projection. */
function assertContract(m, what) {
  const s = summarizeGraphModel(m);
  assert.deepStrictEqual(s.sections.map((x) => x.id), SUMMARY_SECTIONS.map((x) => x.id), what);
  assert.deepStrictEqual(s.counts, { nodes: m.graph.nodes.length, edges: m.graph.edges.length });
  const byId = new Map(m.graph.nodes.map((x) => [x.id, x]));
  const edgeById = new Map(m.graph.edges.map((x) => [x.id, x]));
  // Signal: one item per path, every node in order from the source to the Master Output.
  const signal = section(s, 'signal');
  const paths = oraclePaths(m);
  assert.deepStrictEqual(sorted(signal.items.map((it) => it.edges.join(','))),
    sorted(paths.map((p) => p.join(','))), `${what}: every path once`);
  assert.strictEqual(signal.total, paths.length, what);
  assert.strictEqual(signal.omitted, 0, what);
  for (const it of signal.items) {
    assert.strictEqual(it.nodes.length, it.edges.length + 1, what);
    it.edges.forEach((id, i) => {
      assert.strictEqual(edgeById.get(id).from.node, it.nodes[i].id, `${what}: ${it.text}`);
      assert.strictEqual(edgeById.get(id).to.node, it.nodes[i + 1].id, `${what}: ${it.text}`);
    });
    assert.strictEqual(byId.get(it.nodes.at(-1).id).type, 'master', what);
    assert.strictEqual(it.text, it.nodes.map((x) => x.name).join(' to '), what);
    assert.ok(!/\bmore\b/.test(it.text), `${what}: nothing elided in "${it.text}"`);
    assert.strictEqual(it.muted, it.edges.some((id) => !!(edgeById.get(id).props
      && edgeById.get(id).props.muted)), what);
  }
  // Unconnected: every sounding node that is on no path, with the output to start from.
  const onPath = new Set(signal.items.flatMap((it) => it.nodes.map((x) => x.id)));
  const silent = m.graph.nodes.filter((x) => {
    const def = NODE_REGISTRY.get(x.type);
    return def && def.sounding && !onPath.has(x.id);
  }).map((x) => x.id);
  const unconnected = section(s, 'unconnected');
  assert.deepStrictEqual(unconnected.items.map((it) => it.nodes[0].id), silent, what);
  for (const it of unconnected.items) {
    assert.strictEqual(NODE_REGISTRY.port(byId.get(it.nodes[0].id).type, it.port, 'out').type,
      'AUDIO', `${what}: the fix starts from an audio output`);
  }
  // Each CONTROL, TRIGGER, TAP and ANALYSIS edge in its group exactly once.
  const groups = oracleGroups(m);
  for (const [id, want] of Object.entries(groups)) {
    const got = section(s, id).items.flatMap((it) => it.edges);
    assert.deepStrictEqual(sorted(got), sorted(want), `${what}: ${id}`);
    assert.strictEqual(new Set(got).size, got.length, `${what}: ${id} once`);
  }
  // Items name their nodes as text, and the item's words read them in place.
  for (const sec of s.sections) {
    for (const it of sec.items) {
      assert.strictEqual(it.text, it.parts.map((p) => (typeof p === 'string' ? p : p.name))
        .join(''), what);
      assert.deepStrictEqual(it.nodes, it.parts.filter((p) => typeof p !== 'string'), what);
      for (const x of it.nodes) assert.strictEqual(x.name, byId.get(x.id).metadata.name, what);
    }
  }
  // One derivation, two renderings: the sentence is the bounded projection of this model.
  assert.strictEqual(summarizeGraph(m), boundedSummary(s), `${what}: projection`);
  assert.strictEqual(summarizeGraph(m, { maxItems: 2, maxPaths: 1, maxPathNodes: 4 }),
    boundedSummary(s, { maxItems: 2, maxPaths: 1, maxPathNodes: 4 }), `${what}: projection`);
  return s;
}

// ---------------------------------------------------------------- reference templates

test('K168 the reference templates: every path complete, every group exact, one derivation',
  () => {
    for (const t of STUDIO_TEMPLATES) assertContract(templateModel(t.id), t.id);
    const s = summarizeGraphModel(templateModel('subtractive-synth'));
    assert.deepStrictEqual(section(s, 'signal').items.map((it) => it.text),
      ['Oscillator 1 to Envelope 1 to Filter 1 to Master']);
    assert.deepStrictEqual(section(s, 'modulation').items.map((it) => it.text),
      ['LFO 1 controls Filter 1 cutoff']);
    assert.deepStrictEqual(section(s, 'analysis').items.map((it) => it.text),
      ['Spectrum 1 observes Filter 1 output']);
    // stereo-beat: two paths, each whole (the sentence cuts the second at Stereo Split 1).
    const beat = summarizeGraphModel(templateModel('stereo-beat'));
    assert.deepStrictEqual(section(beat, 'signal').items.map((it) => it.text),
      ['Left tone to Stereo Split 1 to Master', 'Right tone to Stereo Split 1 to Master']);
    assert.strictEqual(section(beat, 'signal').label, 'Signal paths');
    const meas = summarizeGraphModel(templateModel('measurement-sweep'));
    assert.deepStrictEqual(section(meas, 'measurement').items.map((it) => it.text), [
      'Transfer Analyzer 1 takes reference from Sweep 1 and observed from Calibration 1',
      'Calibration 1 takes observed from Microphone 1',
      'Measurement Result 1 takes result from Transfer Analyzer 1']);
  });

// ---------------------------------------------------------------- the owner's 26-node patch

test('K168 a 26-node patch: no "more", every path whole, the unheard flagged with a port', () => {
  const m = ownerPatch();
  assert.strictEqual(m.graph.nodes.length, 26);
  assert.ok(validateStudioModel(m).ok, JSON.stringify(validateStudioModel(m)));
  const s = assertContract(m, 'owner patch');
  const tail = 'Ring 1 to Filter 2 to Envelope 1 to Gain 1 to Pan 1 to Master Output 1';
  const chain = `Mixer 1 to Filter 1 to ${tail}`;
  assert.deepStrictEqual(section(s, 'signal').items.map((it) => it.text), [
    `VCO 1 to ${chain}`, `VCO 2 to ${chain}`, `VCO 3 to ${chain}`, `Noise 1 to ${chain}`,
    `Oscillator 1 to ${tail}`]);
  assert.ok(section(s, 'signal').items.every((it) => it.nodes.length >= 7));
  assert.deepStrictEqual(section(s, 'unconnected').items.map((it) => [it.text, it.port]),
    [['Oscillator 2', 'audio'], ['Sequence 1', 'audio']]);
  assert.strictEqual(section(s, 'modulation').items.length, 11);
  assert.ok(section(s, 'modulation').items.length >= 8);
  assert.deepStrictEqual(section(s, 'modulation').items.filter((it) => it.muted)
    .map((it) => it.text), ['LFO 2 controls VCO 2 pitch']);
  assert.deepStrictEqual(section(s, 'triggers').items.map((it) => it.text), [
    'Sequence 1 triggers Envelope 1 gate', 'Sequence 1 triggers Step Modulator 1 clock',
    'Sequence 1 triggers Random 1 clock']);
  assert.deepStrictEqual(section(s, 'analysis').items.map((it) => it.text), [
    'Spectrum 1 observes Filter 1 output', 'Scope 1 observes Pan 1 output',
    'Meter 1 observes Gain 1 output', 'Recorder/Export 1 records Pan 1 output']);
  // The screen-reader sentence keeps its §250 bounds (the elisions the Inspector no longer
  // shows) and is still the projection of the same model.
  const said = summarizeGraph(m);
  assert.match(said, /^26 nodes, 30 connections\. Signal paths: VCO 1 to Mixer 1 to Filter 1 to /);
  assert.ok(said.includes(' through 2 more nodes to Master Output 1; VCO 2 to Mixer 1; VCO 3 to '
    + 'Mixer 1; and 2 more.'), said);
  assert.match(said, /Modulation: .*; and 5 more\./);
  assert.strictEqual(said, boundedSummary(s, SUMMARY_DEFAULTS));
});

// ---------------------------------------------------------------- negatives

test('K168 negatives: empty, no Master Output, the only path muted, a name with markup', () => {
  // An empty graph: nothing listed, nothing claimed.
  const empty = assertContract(raw([]), 'empty');
  assert.ok(empty.sections.every((x) => !x.items.length && !x.total));
  assert.strictEqual(empty.master, null);
  assert.strictEqual(boundedSummary(empty), 'Empty Studio: no nodes.');
  // No Master Output: no path, the reason said, every sounding node unheard, edges still grouped.
  const loose = raw([n('osc-1', 'oscillator'), n('lfo-1', 'lfo'), n('gain-1', 'gain')], [
    e('edge-1', 'osc-1', 'audio', 'gain-1', 'audio'),
    e('edge-2', 'lfo-1', 'control', 'osc-1', 'detune')]);
  const nm = assertContract(loose, 'no master');
  assert.strictEqual(section(nm, 'signal').note, 'No Master Output.');
  assert.deepStrictEqual(section(nm, 'signal').items, []);
  assert.deepStrictEqual(section(nm, 'unconnected').items.map((it) => it.text), ['Oscillator 1']);
  assert.deepStrictEqual(section(nm, 'modulation').items.map((it) => it.edges), [['edge-2']]);
  // A Master Output nothing reaches.
  const alone = assertContract(raw([n('master-1', 'master')]), 'master alone');
  assert.strictEqual(section(alone, 'signal').note, 'Nothing reaches Master Output 1.');
  // The only path muted: listed whole and flagged muted (it is connected, it is not heard).
  const muted = assertContract(raw([n('osc-1', 'oscillator'), n('master-1', 'master')],
    [e('edge-1', 'osc-1', 'audio', 'master-1', 'audio', { muted: true })]), 'muted');
  assert.deepStrictEqual(section(muted, 'signal').items.map((it) => [it.text, it.muted]),
    [['Oscillator 1 to Master Output 1', true]]);
  assert.deepStrictEqual(section(muted, 'unconnected').items, []);
  // A node named with markup stays text: the model carries the literal name, never HTML.
  const markup = assertContract(raw([n('osc-1', 'oscillator', '<b>x</b>'),
    n('master-1', 'master')], [e('edge-1', 'osc-1', 'audio', 'master-1', 'audio')]), 'markup');
  assert.deepStrictEqual(section(markup, 'signal').items[0].nodes[0],
    { id: 'osc-1', name: '<b>x</b>' });
  assert.strictEqual(section(markup, 'signal').items[0].text, '<b>x</b> to Master Output 1');
  const view = readFileSync(path.join(ROOT, 'src/js/ui/studio/graph-summary-view.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(view),
    'the summary view sets text through textContent only');
});

test('K168 paths are listed whole however many nodes they run through', () => {
  const nodes = [n('osc-1', 'oscillator')];
  const edges = [];
  let prev = 'osc-1';
  for (let i = 1; i <= 40; i++) {
    nodes.push(n(`gain-${i}`, 'gain'));
    edges.push(e(`edge-${i}`, prev, 'audio', `gain-${i}`, 'audio'));
    prev = `gain-${i}`;
  }
  nodes.push(n('master-1', 'master', 'Master'));
  edges.push(e('edge-41', prev, 'audio', 'master-1', 'audio'));
  const s = assertContract(raw(nodes, edges), 'long chain');
  assert.strictEqual(section(s, 'signal').items[0].nodes.length, 42);
  assert.match(summarizeGraph(raw(nodes, edges)), / through 35 more nodes to Master\.$/);
});

// ---------------------------------------------------------------- one derivation

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('K168 one derivation: only a11y.js computes the paths and groups', () => {
  const files = walk(path.join(ROOT, 'src/js'));
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  const text = new Map(files.map((p) => [rel(p), readFileSync(p, 'utf8')]));
  const A11Y = 'src/js/studio/a11y.js';
  for (const [f, src] of text) {
    if (f === A11Y) continue;
    assert.ok(!/\bsignalPaths\b/.test(src), `${f} must not compute or import signalPaths`);
    assert.ok(!/function\s+(summarizeGraphModel|boundedSummary)\b/.test(src),
      `${f} must not define its own summary`);
    assert.ok(!/SUMMARY_SECTIONS\s*=/.test(src), `${f} must not define summary sections`);
  }
  assert.match(text.get(A11Y), /export function summarizeGraphModel\(/);
  const sentence = text.get(A11Y).split('export function summarizeGraph(')[1].split('\nexport ')[0];
  assert.match(sentence, /summarizeGraphModel\(model/);
  assert.match(sentence, /return boundedSummary\(summary, o\);/);
  // The Inspector and its summary view read the model; they never walk the graph themselves.
  const insp = text.get('src/js/ui/studio/inspector.js');
  assert.match(insp, /summarizeGraphModel\(model, \{ registry \}\)/);
  assert.match(insp, /boundedSummary\(graph\)/);
  const view = text.get('src/js/ui/studio/graph-summary-view.js');
  assert.ok(!/from '\.\.\/\.\.\/studio\//.test(view), 'the view imports no Studio domain module');
  assert.ok(!/signalInputs|\.sounding\b|graph\.edges/.test(view), 'the view derives nothing');
  for (const f of ['src/js/ui/studio/inspector.js', 'src/js/ui/studio/graph-summary-view.js']) {
    assert.ok(!/signal-path-projection/.test(text.get(f)), `${f} reads no signal path itself`);
  }
  // The screen-reader renderings keep the bounded sentence.
  assert.match(text.get('src/js/ui/studio/graph-editor.js'),
    /setText\(summary, summarizeGraph\(m, \{ registry \}\)\)/);
  assert.match(text.get('src/js/ui/studio/compact.js'), /summarizeStudio\(model, \{ registry \}\)/);
});
