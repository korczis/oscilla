// OSCILLA V3.1 Studio automation lane UI — pure view helpers (spec §97-§102; plan V420):
// src/js/ui/studio/automation-view.js. Scales, curves, legality and the editor actions are
// automation.js's (tested in v31-studio-timeline.test.mjs); this file covers what the lane editor
// adds: geometry in the parameter's own scale, words, parsed numeric entry and the actions it
// builds. The DOM lane editor is exercised by tests/browser/v31-studio-timeline.cjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { automationScale } from '../../src/js/studio/automation.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import {
  LANE_HEIGHT_PX, addPointAction, automatableTargets, curveChoices, fineNudge, laneAria,
  laneInfo, lanePath, parseValueText, pointAria, pointNeighbour, valueToY, yToValue,
} from '../../src/js/ui/studio/automation-view.js';

const synth = () => templateModel('subtractive-synth');
const storeOf = (m = synth()) => createStudioStore(m, { idGenerator: createIdGenerator(m) });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const param = (type, key) => NODE_REGISTRY.param(type, key);
const freq = automationScale(param('filter', 'frequency'), { sampleRate: 48000 });

test('lane info: the parameter, its scale and range in its own unit (§101)', () => {
  const m = synth();
  const info = laneInfo(m, m.timeline.automation[0], { sampleRate: 48000 });
  assert.equal(info.name, 'Filter 1 Cutoff');
  assert.equal(info.scale.kind, 'log');
  assert.equal(info.scaleLabel, 'LOG Hz');
  assert.equal(info.bottom, '20 Hz');
  assert.equal(info.top, '20 kHz');
  assert.equal(laneAria(info, m.timeline.automation[0]),
    'Filter 1 Cutoff automation, logarithmic scale, 2 points');
  assert.equal(laneInfo(m, { id: 'x', target: { node: 'gone', param: 'frequency' }, points: [] }),
    null);
});

test('value <-> y in the lane scale: log frequency, dB gain, bipolar pan', () => {
  assert.equal(valueToY(20000, freq), 0);
  assert.equal(valueToY(20, freq), LANE_HEIGHT_PX);
  // 632 Hz is the geometric middle of 20 Hz-20 kHz.
  assert.ok(near(valueToY(Math.sqrt(20 * 20000), freq), LANE_HEIGHT_PX / 2, 0.01));
  assert.ok(near(yToValue(LANE_HEIGHT_PX / 2, freq), Math.sqrt(20 * 20000), 1e-6));
  assert.ok(near(yToValue(-10, freq), 20000, 1e-6));
  const pan = automationScale(param('pan', 'pan'));
  assert.equal(pan.kind, 'bipolar');
  assert.equal(valueToY(0, pan), LANE_HEIGHT_PX / 2);
});

test('lane path: held ends, steps as hold + jump, a linear ramp curved on a log scale', () => {
  const pts = [{ id: 'a', time: 1, value: 100, curve: 'linear' },
    { id: 'b', time: 2, value: 1000, curve: 'step' },
    { id: 'c', time: 3, value: 1000, curve: 'linear' }];
  const d = lanePath(pts, freq, { pxPerSecond: 100, from: 0, to: 5 });
  assert.match(d, /^M0 /);
  const yA = valueToY(100, freq);
  const yB = valueToY(1000, freq);
  assert.ok(d.startsWith(`M0 ${yA} L100 ${yA}`));
  // The step holds 100 Hz to 2 s, then jumps.
  assert.ok(d.includes(`L200 ${yA} L200 ${yB}`));
  assert.ok(d.endsWith(`L500 ${yB}`));
  // A linear Hz ramp on the log scale is sampled (more than one segment).
  const lin = lanePath([{ id: 'a', time: 0, value: 100, curve: 'linear' },
    { id: 'b', time: 1, value: 10000, curve: 'linear' }], freq, { pxPerSecond: 90 });
  assert.equal(lin.split('L').length - 1, 1 + 30);
  // On a linear scale a linear ramp is one straight segment.
  const lfoDepth = automationScale({ key: 'x', min: -10, max: 10, unit: '' });
  assert.equal(lanePath([{ time: 0, value: 0, curve: 'linear' }, { time: 1, value: 5,
    curve: 'linear' }], lfoDepth, { pxPerSecond: 100 }).split('L').length - 1, 2);
  assert.equal(lanePath([], freq, { pxPerSecond: 100 }), '');
});

test('point words: lane, index, time, value in its unit, curve, selection (§143)', () => {
  const m = synth();
  const info = laneInfo(m, m.timeline.automation[0], { sampleRate: 48000 });
  const [p1, p2] = m.timeline.automation[0].points;
  assert.equal(pointAria(info, p1, 0, 2, m.transport), 'Filter 1 Cutoff point 1 of 2: 0.000 s, '
    + '500 Hz, start');
  assert.equal(pointAria(info, p2, 1, 2, m.transport, { selected: true }),
    'Filter 1 Cutoff point 2 of 2: 3.000 s, 8 kHz, exponential, selected');
  assert.deepEqual(curveChoices(info.def).map((c) => c.id), ['step', 'linear', 'exponential']);
  assert.deepEqual(curveChoices(param('oscillator', 'level')).map((c) => c.id),
    ['step', 'linear']);
});

test('numeric entry in the lane unit (§100)', () => {
  assert.equal(parseValueText('2000', freq), 2000);
  assert.equal(parseValueText('2k', freq), 2000);
  assert.equal(parseValueText('2 kHz', freq), 2000);
  assert.equal(parseValueText('1.5 khz', freq), 1500);
  assert.equal(parseValueText('440 Hz', freq), 440);
  assert.equal(parseValueText('440 dB', freq), null);
  assert.equal(parseValueText('lots', freq), null);
  assert.equal(parseValueText('', freq), null);
  const db = automationScale(param('oscillator', 'level'));
  assert.equal(db.kind, 'db');
  assert.ok(near(parseValueText('-6 dB', db), Math.pow(10, -6 / 20)));
  assert.ok(near(parseValueText('−20', db), 0.1));
  assert.equal(parseValueText('-inf', db), 0);
  assert.equal(parseValueText('−∞ dB', db), 0);
  assert.equal(parseValueText('x0.5', db), 0.5);
  const pan = automationScale({ key: 'pan', min: -1, max: 1, unit: '' });
  assert.equal(parseValueText('C', pan), 0);
  assert.equal(parseValueText('L 50', pan), -0.5);
  assert.equal(parseValueText('R25 %', pan), 0.25);
  assert.equal(parseValueText('-0.3', pan), -0.3);
  const gainDb = automationScale({ key: 'gain', min: -40, max: 40, unit: 'dB' });
  assert.equal(parseValueText('-3 dB', gainDb), -3);
});

test('add point: the lane value at that time, linear; exponential never by default', () => {
  const s = storeOf();
  const m = s.getModel();
  const a = addPointAction(m, 'lane-1', 1.5);
  assert.ok(a.ok);
  // Halfway along the 500 Hz -> 8 kHz exponential ramp: 2 kHz.
  assert.ok(near(a.action.value, 2000, 1e-6));
  assert.equal(a.action.curve, 'linear');
  assert.deepEqual(a.action.target, { node: 'filter-1', param: 'frequency' });
  const r = s.dispatch(a.action);
  assert.ok(r.ok);
  const given = addPointAction(s.getModel(), 'lane-1', 5, { value: 1e9 });
  assert.equal(given.action.value, param('filter', 'frequency').max);
  assert.equal(addPointAction(m, 'nope', 1).ok, false);
});

test('fine nudge: a thousandth of the scale and 1 ms; clamped; neighbour after delete', () => {
  const m = synth();
  const r = fineNudge(m, 'lane-1', 'pt-2', { dValue: 1, sampleRate: 48000 });
  assert.ok(r.ok);
  const n = freq.toNormalized(8000);
  assert.ok(near(r.action.value, freq.fromNormalized(n + 0.001), 1e-6));
  const t = fineNudge(m, 'lane-1', 'pt-1', { dTime: -1 });
  // Already at 0 s: clamped, nothing changes.
  assert.ok(t.ok);
  assert.equal(t.action, null);
  const t2 = fineNudge(m, 'lane-1', 'pt-2', { dTime: 1 });
  assert.equal(t2.action.time, 3.001);
  assert.equal(fineNudge(m, 'lane-1', 'nope', {}).ok, false);
  const lane = m.timeline.automation[0];
  assert.equal(pointNeighbour(lane, 'pt-1'), 'pt-2');
  assert.equal(pointNeighbour(lane, 'pt-2'), 'pt-1');
  assert.equal(pointNeighbour(lane, 'nope'), null);
});

test('automatable targets list each node with its automatable parameters and lanes', () => {
  const m = synth();
  const t = automatableTargets(m);
  const filter = t.find((x) => x.id === 'filter-1');
  assert.ok(filter.params.find((p) => p.key === 'frequency').laned);
  // R7 (clip-targets.js): a low-pass Q lane would never play (its AudioParam is in dB), so the
  // form does not offer it; a band-pass Q lane plays and is offered.
  assert.equal(m.graph.nodes.find((n) => n.id === 'filter-1').params.type, 'lowpass');
  assert.ok(!filter.params.some((p) => p.key === 'Q'));
  const s = storeOf(m);
  assert.ok(s.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'type',
    value: 'bandpass' }).ok);
  const bp = automatableTargets(s.getModel()).find((x) => x.id === 'filter-1');
  assert.ok(bp.params.some((p) => p.key === 'Q' && !p.laned));
  assert.ok(!t.some((x) => x.id === 'master-1' && !x.params.length));
});
