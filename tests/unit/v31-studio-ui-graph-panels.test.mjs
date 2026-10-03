// V3.1 Studio panels: Inspector view and field helpers (inspector.js), node library view
// (library-panel.js), compact widget view (compact.js), saved-record helpers (patches-panel.js)
// and the store handle of the workspace (workspace.js). Spec §78-§80, §101, §111-§115,
// §127-§130, §154-§158, §197, §214. Plan V412-V413, V421-V423, V426.
//   node --test tests/unit/v31-studio-ui-graph-panels.test.mjs
// Tolerances: slider round trips within one slider step (1/1000 of the range, log or linear).

import test from 'node:test';
import assert from 'node:assert';

import {
  SLIDER_STEPS, formatParamValue, inspectorView, parseParamInput, sliderRange, sliderToValue,
  valueToSlider,
} from '../../src/js/ui/studio/inspector.js';
import { libraryView } from '../../src/js/ui/studio/library-panel.js';
import { chipLabel, clipLabel, compactTime, compactView } from '../../src/js/ui/studio/compact.js';
import { recordId, savedListView } from '../../src/js/ui/studio/patches-panel.js';
import { createStoreHandle } from '../../src/js/ui/studio/workspace.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { EMPTY_SELECTION } from '../../src/js/studio/actions.js';

const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const param = (type, key) => NODE_REGISTRY.param(type, key);

test('the Inspector follows the primary selection (§78)', () => {
  const m = synth();
  const none = inspectorView(m, EMPTY_SELECTION);
  assert.equal(none.kind, 'studio');
  assert.equal(none.summary.split('.')[0], '6 nodes, 5 connections');
  const node = inspectorView(m, { nodes: ['osc-1', 'filter-1'].slice(1) });
  assert.equal(node.kind, 'node');
  assert.equal(node.name, 'Filter 1');
  assert.deepEqual(node.fields.map((f) => [f.key, f.control]), [['type', 'select'],
    ['frequency', 'number'], ['Q', 'number'], ['gain', 'number'], ['enabled', 'toggle']]);
  const cutoff = node.fields.find((f) => f.key === 'frequency');
  assert.equal(cutoff.text, '500 Hz');
  assert.equal(cutoff.automated, true, 'the template automates the cutoff');
  assert.deepEqual(cutoff.modulatedBy,
    ['Connection from LFO 1 control to Filter 1 cutoff, depth 1 octave, bipolar']);
  assert.equal(inspectorView(m, { nodes: ['osc-1', 'filter-1'] }).kind, 'multi');
  const edge = inspectorView(m, { edges: ['edge-4'] });
  assert.equal(edge.kind, 'edge');
  assert.equal(edge.control, true);
  assert.equal(edge.unit, 'octaves');
  assert.equal(edge.fromText, 'LFO 1 / Control');
  assert.equal(edge.toText, 'Filter 1 / Cutoff');
  assert.equal(edge.linearDepth, 1200);
  const audio = inspectorView(m, { edges: ['edge-1'] });
  assert.equal(audio.control, false);
  const clip = inspectorView(m, { clips: ['clip-2'] });
  assert.equal(clip.kind, 'clip');
  assert.deepEqual([clip.start, clip.duration, clip.detail, clip.targetName],
    [1, 2, 'sweep', 'Oscillator 1']);
  const pt = inspectorView(m, { points: ['pt-2'] });
  assert.equal(pt.kind, 'point');
  assert.equal(pt.valueText, '8.00 kHz');
});

test('parameter fields format, parse and validate with the registry ranges (§79)', () => {
  const f = param('filter', 'frequency');
  assert.equal(formatParamValue(f, 2400), '2.40 kHz');
  assert.deepEqual(parseParamInput(f, '2.4k'), { ok: true, value: 2400 });
  assert.deepEqual(parseParamInput(f, '1.5 kHz'), { ok: true, value: 1500 });
  assert.equal(parseParamInput(f, '5').ok, false, 'below the 10 Hz minimum');
  assert.match(parseParamInput(f, '5').error, /^Cutoff must be between 10 and/);
  const g = param('filter', 'gain');
  assert.equal(formatParamValue(g, -6), '-6 dB');
  assert.deepEqual(parseParamInput(g, '-6 dB'), { ok: true, value: -6 });
  assert.equal(parseParamInput(g, 'loud').ok, false);
  assert.equal(formatParamValue(param('filter', 'type'), 'bandpass'), 'Band-pass');
  assert.equal(formatParamValue(param('filter', 'enabled'), false), 'Off');
  const steps = param('step-modulator', 'steps');
  assert.deepEqual(parseParamInput(steps, '1, 0.5; -1').value, [1, 0.5, -1]);
  assert.equal(parseParamInput(steps, '1, x').ok, false);
});

test('sliders map log and linear ranges and round to the step (§101)', () => {
  const f = param('filter', 'frequency');
  assert.deepEqual(sliderRange(f), { lo: 20, hi: 20000, log: true });
  assert.equal(valueToSlider(f, 20), 0);
  assert.equal(valueToSlider(f, 20000), SLIDER_STEPS);
  for (const v of [50, 500, 2400, 9000]) {
    const back = sliderToValue(f, valueToSlider(f, v));
    assert.ok(Math.abs(Math.log(back / v)) <= Math.log(1000) / SLIDER_STEPS + 1e-3, `${v} → ${back}`);
  }
  const pan = param('pan', 'pan');
  assert.equal(sliderToValue(pan, SLIDER_STEPS / 2), 0);
  assert.equal(sliderToValue(pan, 0), -1);
  assert.equal(sliderToValue(param('oscillator', 'detune'), 0), -1200);
});

test('the library groups the registry and marks types at their limit (§29-§30, §187)', () => {
  const m = synth();
  const all = libraryView(m, '');
  assert.deepEqual(all.groups.map((g) => g.label), ['Sources', 'Modulation', 'Processing',
    'Analysis', 'Output', 'Measurement']);
  assert.equal(all.count, NODE_REGISTRY.list().length);
  const master = all.groups.flatMap((g) => g.items).find((i) => i.type === 'master');
  assert.equal(master.disabled, true);
  assert.equal(master.reason, 'A Studio has exactly one Master Output.');
  const found = libraryView(m, 'vcf');
  assert.equal(found.first.type, 'filter');
  assert.equal(libraryView(m, 'zzz').empty, true);
  const only = libraryView(m, '', { onlyTypes: ['gain', 'pan'] });
  assert.deepEqual(only.groups.flatMap((g) => g.items).map((i) => i.type), ['gain', 'pan']);
});

test('the compact view is a projection of the same model (§127-§129, §197)', () => {
  const m = synth();
  const v = compactView(m, { nodes: ['filter-1'], clips: ['clip-1'] });
  assert.equal(v.title, 'Subtractive Synth');
  assert.equal(v.path.nodes.find((n) => n.id === 'filter-1').selected, true);
  assert.deepEqual(v.clips.items.map((c) => [c.id, c.label, c.left, c.width]),
    [['clip-1', 'Tone', 0, 48], ['clip-2', 'Sweep', 48, 96]]);
  assert.equal(v.clips.items[0].selected, true);
  assert.match(v.summary, /^6 nodes, 5 connections\./);
  // The shortest clip stays a usable target: the scale grows for coarse pointers.
  const coarse = compactView(m, EMPTY_SELECTION, { minClipPx: 44 });
  assert.equal(coarse.clips.pxPerSecond, 48);
  const meas = compactView(templateModel(MEASUREMENT_TEMPLATE_ID), EMPTY_SELECTION,
    { minClipPx: 44 });
  assert.equal(meas.clips.pxPerSecond, 88, 'the 0.5 s pre-roll is 44 px');
  assert.deepEqual(meas.clips.items.map((c) => c.label).slice(0, 3),
    ['Noise check', 'Pre-roll', 'Stimulus']);
  assert.equal(chipLabel('Main Sweep Generator X'), 'MAIN SWEEP GE…');
  assert.equal(clipLabel({ kind: 'event', payload: {} }), 'Gate');
  assert.equal(compactTime(4.21), '00:04.210');
  assert.equal(compactTime(65.5), '01:05.500');
});

test('saved-record ids are readable, unique and keep the document’s own id (§113, §155)', () => {
  assert.equal(recordId('project', 'Subtractive Synth', []), 'project-subtractive-synth');
  assert.equal(recordId('project', 'Subtractive Synth', ['project-subtractive-synth']),
    'project-subtractive-synth-2');
  assert.equal(recordId('project', 'X', ['project-x'], 'project-x'), 'project-x');
  assert.equal(recordId('patch', '', []), 'patch-patch');
  assert.deepEqual(savedListView([{ id: 'p', kind: 'oscilla-patch', name: 'Voice',
    savedAt: '2026-10-03T10:20:30.000Z' }]), [{ id: 'p', kind: 'patch', kindLabel: 'Patch',
    name: 'Voice', when: '2026-10-03 10:20' }]);
});

test('one store behind a stable handle; opening a document keeps revisions monotonic (§9)', () => {
  const h = createStoreHandle(synth());
  const events = [];
  h.subscribe((e) => events.push([e.type, e.revision]));
  const first = h.current();
  const r = h.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1', position: { x: 48, y: 160 } });
  assert.equal(r.ok, true);
  const rev = h.getRevision();
  assert.equal(rev, 1);
  h.replace(templateModel(MEASUREMENT_TEMPLATE_ID), 'template');
  assert.notEqual(h.current(), first);
  assert.ok(h.getRevision() > rev, 'a new document never reuses a revision');
  assert.equal(h.canUndo(), false, 'opening a document starts a new history');
  const after = h.getRevision();
  h.dispatch({ type: 'NODE_MOVE', nodeId: 'sweep-1', position: { x: 0, y: 0 } });
  assert.equal(h.getRevision(), after + 1);
  assert.deepEqual(events.map((e) => e[0]), ['model', 'model', 'model']);
  assert.ok(events.every((e, i) => i === 0 || e[1] > events[i - 1][1]));
  h.undo();
  assert.equal(h.getModel().graph.nodes[0].position.x, 40);
});
