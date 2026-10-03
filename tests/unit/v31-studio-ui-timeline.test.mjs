// OSCILLA V3.1 Studio timeline UI — pure view helpers (spec §81-§96, §125, §129, §141, §184-§185;
// plan V417, V418, V428): src/js/ui/studio/timeline-view.js, transport-view.js,
// transport-commands.js (against a fake transport) and the pure parts of compact-timeline.js.
// The DOM editor itself is exercised by tests/browser/v31-studio-timeline.cjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import {
  CONTENT_TAIL_S, EDITOR_DEFAULT_SNAP, SNAP_CHOICES, TIMELINE_ZOOM, addClipAction, applySplit,
  blockTypeOptions, choiceForSnap, clampZoom, clipClass, clipOrder, clipTargetOptions, clipText,
  clipView, compatibleTracks, contentSpanS, describeTime, fitZoom, focusAfterDelete, followScroll,
  formatClock, formatTransportTime, freeStartOnTrack, keyboardStepS, markerAria,
  measurementActionOptions, parseSecondsText, rulerTicks, snapForChoice, splitClipPlan,
  trackTargetOptions, trackView, visibleRange, xToTime, timeToX, zoomAround,
} from '../../src/js/ui/studio/timeline-view.js';
import {
  KEY_HELP, keyCommand, transportAnnouncement, transportStrip,
} from '../../src/js/ui/studio/transport-view.js';
import { createTransportCommands } from '../../src/js/ui/studio/transport-commands.js';
import { compactSpan, compactSummary } from '../../src/js/ui/studio/compact-timeline.js';

const synth = () => templateModel('subtractive-synth');
const storeOf = (m = synth()) => createStudioStore(m, { idGenerator: createIdGenerator(m) });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const MUSICAL = { timeMode: 'musical', tempo: 120, timeSignature: [4, 4] };

// ---------------------------------------------------------------- snap choices (§92)

test('snap choices resolve to timeline.js settings; bar follows the time signature', () => {
  assert.equal(SNAP_CHOICES[0].id, 'off');
  assert.deepEqual(snapForChoice('time-0.25', { pxPerSecond: 100 }).gridS, 0.25);
  assert.equal(snapForChoice('bar', { transport: { ...MUSICAL, timeSignature: [3, 4] } })
    .beatsPerStep, 3);
  assert.equal(snapForChoice('markers', { pxPerSecond: 200, thresholdPx: 8 }).thresholdS, 0.04);
  assert.equal(snapForChoice('nope').mode, 'off');
  assert.equal(choiceForSnap(EDITOR_DEFAULT_SNAP), 'time-0.1');
  assert.equal(choiceForSnap({ mode: 'musical', beatsPerStep: 4 }, MUSICAL), 'bar');
  assert.equal(choiceForSnap({ mode: 'musical', beatsPerStep: 0.5 }, MUSICAL), 'beat-0.5');
  assert.equal(choiceForSnap({ mode: 'markers' }), 'markers');
  assert.equal(choiceForSnap(null), 'off');
});

test('keyboard step: grid, beat at the tempo, a tenth with Shift; measurement keeps seconds',
  () => {
    const tr = { tempo: 120, timeSignature: [4, 4] };
    assert.equal(keyboardStepS({ mode: 'time', gridS: 0.1 }, tr), 0.1);
    assert.ok(near(keyboardStepS({ mode: 'time', gridS: 0.1 }, tr, { fine: true }), 0.01));
    assert.equal(keyboardStepS({ mode: 'musical', beatsPerStep: 1 }, tr), 0.5);
    assert.equal(keyboardStepS({ mode: 'musical', beatsPerStep: 1, gridS: 0.1 }, tr,
      { clipKind: 'measurement' }), 0.1);
    assert.equal(keyboardStepS({ mode: 'off' }, tr), 0.1);
  });

// ---------------------------------------------------------------- scale and scroll (§89)

test('zoom is clamped and keeps the time under the anchor', () => {
  assert.equal(clampZoom(1), TIMELINE_ZOOM.min);
  assert.equal(clampZoom(1e9), TIMELINE_ZOOM.max);
  assert.equal(clampZoom(NaN), 100);
  const z = zoomAround({ pxPerSecond: 100, scrollX: 200 }, 1, 300);
  assert.equal(z.pxPerSecond, 125);
  // time under the anchor: (200 + 300) / 100 = 5 s, still at 300 px.
  assert.ok(near((z.scrollX + 300) / z.pxPerSecond, 5));
  assert.equal(zoomAround({ pxPerSecond: 100, scrollX: 0 }, -1, 0).scrollX, 0);
  assert.equal(fitZoom(10, 1016), 100);
});

test('time <-> x, visible range, content span and playhead follow', () => {
  assert.equal(timeToX(1.5, 100), 150);
  assert.equal(xToTime(150, 100), 1.5);
  assert.equal(xToTime(-5, 100), 0);
  assert.deepEqual(visibleRange(100, 400, 100), { from: 1, to: 5 });
  const m = synth();
  // Last executable item is the 3 s automation point / the sweep's end; loop end 4 s.
  assert.equal(contentSpanS(m), 4 + CONTENT_TAIL_S);
  assert.equal(contentSpanS(m, 20), 20);
  assert.equal(followScroll(150, 0, 600), null);
  assert.equal(followScroll(700, 0, 600), 640);
  assert.equal(followScroll(10, 400, 600), 0);
  assert.equal(followScroll(10, 0, 0), null);
});

// ---------------------------------------------------------------- readouts (§90, §127)

test('clock and musical readouts', () => {
  assert.equal(formatClock(4.21), '00:04.210');
  assert.equal(formatClock(65.0005), '01:05.000');
  assert.equal(formatClock(-1), '00:00.000');
  assert.equal(formatTransportTime(1.25, { timeMode: 'seconds' }), '00:01.250');
  assert.equal(formatTransportTime(2.25, MUSICAL), '2.1.500');
  assert.equal(describeTime(1.25, null), '1.250 s');
  assert.equal(describeTime(2, MUSICAL), 'bar 2 beat 1 (2.000 s)');
});

test('ruler ticks: 1-2-5 seconds with labelled majors; musical bars and beats', () => {
  const t = rulerTicks({ from: 0, to: 4, pxPerSecond: 100 });
  const majors = t.filter((x) => x.major);
  // 100 px/s and a 64 px label distance: a 1 s step, five minor ticks per second.
  assert.equal(majors.length, 5);
  assert.deepEqual(majors.map((x) => x.label), ['0s', '1s', '2s', '3s', '4s']);
  assert.equal(t.length, 21);
  const fine = rulerTicks({ from: 0, to: 0.2, pxPerSecond: 2000 });
  assert.equal(fine.filter((x) => x.major)[1].label, '0.05s');
  const mus = rulerTicks({ from: 0, to: 2, pxPerSecond: 200, transport: MUSICAL });
  // 120 BPM: a beat is 0.5 s = 100 px >= 64 px: every beat labelled, bars as "n".
  assert.deepEqual(mus.filter((x) => x.major).map((x) => x.label), ['1', '1.2', '1.3', '1.4',
    '2']);
  const bars = rulerTicks({ from: 0, to: 16, pxPerSecond: 20, transport: MUSICAL });
  // A bar is 2 s = 40 px < 64 px: labels every 2 bars.
  assert.deepEqual(bars.filter((x) => x.major).map((x) => x.label), ['1', '3', '5', '7', '9']);
  assert.deepEqual(rulerTicks({ from: 2, to: 1, pxPerSecond: 100 }), []);
});

// ---------------------------------------------------------------- descriptions (§143)

test('clip and track descriptions use names, kinds and times, never coordinates', () => {
  const m = synth();
  const c2 = m.timeline.clips.find((c) => c.id === 'clip-2');
  const v = clipView(m, c2, { selected: true });
  assert.equal(v.label, 'Sweep');
  assert.match(v.aria,
    /^Pattern clip Sweep .*220.*880.* on Source, 1\.000 s to 3\.000 s, selected$/);
  assert.equal(v.cls, 'osc-block--sweep');
  assert.deepEqual(v.problems, []);
  assert.deepEqual(clipText({ kind: 'event', payload: { action: 'trigger' } }),
    { label: 'Trigger', detail: '' });
  assert.equal(clipText({ kind: 'measurement', payload: { action: 'noise-check' } }).label,
    'Noise check');
  assert.equal(clipClass({ kind: 'event', payload: {} }), 'osc-stl-clip--event');
  const tv = trackView(m, m.timeline.tracks[0]);
  assert.equal(tv.aria, 'Source, event track, target Oscillator 1, 2 clips');
  assert.equal(markerAria({ kind: 'sweep', label: 'Sweep', time: 1 }, null),
    'Sweep marker at 1.000 s');
  assert.equal(markerAria({ kind: 'custom', label: 'Drop', time: 2 }, null),
    'Marker marker "Drop" at 2.000 s');
});

test('a clip the transport would not play lists the reason as a problem', () => {
  const s = storeOf();
  const r = s.dispatch({ type: 'CLIP_ADD', trackId: 'track-1', kind: 'event', start: 5,
    duration: 0.5, payload: { action: 'gate' } });
  assert.ok(r.ok, r.reason);
  const m = s.getModel();
  const v = clipView(m, m.timeline.clips.find((c) => c.id === r.created.clips[0]));
  assert.ok(v.problems.some((p) => /Only gate events on an Envelope/.test(p)),
    v.problems.join(' | '));
  assert.match(v.aria, /problem/);
});

test('focus order and focus after delete (§142)', () => {
  const s = storeOf();
  s.dispatch({ type: 'CLIP_ADD', trackId: 'track-1', kind: 'pattern', start: 5, duration: 1 });
  const m = s.getModel();
  assert.deepEqual(clipOrder(m).map((c) => c.id), ['clip-1', 'clip-2', 'clip-3']);
  assert.equal(focusAfterDelete(m, ['clip-2']), 'clip-3');
  assert.equal(focusAfterDelete(m, ['clip-3']), 'clip-2');
  assert.equal(focusAfterDelete(m, ['clip-1', 'clip-2', 'clip-3']), null);
  assert.equal(focusAfterDelete(m, ['nope']), null);
});

// ---------------------------------------------------------------- creation and split

test('add clip: pattern on an oscillator track, gate on an envelope track, pre-roll on measurement',
  () => {
    const s = storeOf();
    let m = s.getModel();
    const a = addClipAction(m, 'track-1', 2.5);
    assert.deepEqual(a.action, { type: 'CLIP_ADD', trackId: 'track-1', kind: 'pattern',
      start: 2.5, duration: 1, payload: { blockType: 'tone' } });
    assert.ok(s.dispatch(a.action).ok);
    s.dispatch({ type: 'TRACK_ADD', kind: 'event', target: 'env-1', name: 'Gate' });
    s.dispatch({ type: 'TRACK_ADD', kind: 'measurement', name: 'Meas' });
    m = s.getModel();
    const gate = addClipAction(m, 'track-2', 0);
    assert.equal(gate.action.kind, 'event');
    assert.ok(s.dispatch(gate.action).ok);
    const meas = addClipAction(m, 'track-3', 3599.9);
    assert.equal(meas.action.payload.action, 'pre-roll');
    assert.equal(meas.action.start, 3599.5);
    assert.ok(s.dispatch(meas.action).ok);
    assert.equal(addClipAction(m, 'nope', 0).reason, 'There is no such track.');
    assert.equal(freeStartOnTrack(s.getModel(), 'track-1', 0.5), 3.5);
    assert.equal(freeStartOnTrack(s.getModel(), 'track-1', 10), 10);
    assert.ok(trackTargetOptions(m, 'event').some((n) => n.id === 'osc-1'));
    assert.ok(clipTargetOptions(m, 'pattern').every((n) => n.id !== 'filter-1'));
    assert.deepEqual(compatibleTracks(s.getModel(), { kind: 'pattern' }).map((t) => t.id),
      ['track-1', 'track-2']);
  });

test('split: a log sweep is cut where its curve is; one undo entry restores it exactly', () => {
  const s = storeOf();
  const before = s.getModel();
  const plan = splitClipPlan(before, 'clip-2', 2);
  assert.ok(plan.ok);
  assert.equal(plan.left.duration, 1);
  assert.ok(near(plan.left.payload.params.end, 440, 1e-9));
  assert.ok(near(plan.right.payload.params.start, 440, 1e-9));
  assert.equal(plan.right.payload.params.end, 880);
  const r = applySplit(s, 'clip-2', plan);
  assert.ok(r.ok);
  assert.equal(r.label, 'Split pattern clip');
  const m = s.getModel();
  const right = m.timeline.clips.find((c) => c.id === r.created);
  assert.deepEqual([right.start, right.duration], [2, 1]);
  assert.equal(s.debugInfo().undoDepth, 1);
  s.undo();
  assert.equal(s.getModel(), before);
  // A tone keeps its payload on both sides; edges and measurement refuse.
  const tone = splitClipPlan(before, 'clip-1', 0.5);
  assert.equal(tone.left.payload, tone.right.payload);
  assert.equal(splitClipPlan(before, 'clip-1', 1).ok, false);
  assert.match(splitClipPlan(before, 'clip-2', 1.01).reason, /at least/);
  assert.equal(splitClipPlan(before, 'nope', 1).ok, false);
});

test('split refused by the store leaves the model untouched (gesture cancelled)', () => {
  const s = storeOf();
  const before = s.getModel();
  const plan = splitClipPlan(before, 'clip-2', 2);
  const bad = { ...plan, right: { ...plan.right, payload: { blockType: 'sweep',
    params: { start: -5, end: 880, curve: 'log' } } } };
  const r = applySplit(s, 'clip-2', bad);
  assert.equal(r.ok, false);
  assert.equal(s.getModel(), before);
  assert.equal(s.debugInfo().undoDepth, 0);
});

test('editor choices and seconds parsing', () => {
  assert.ok(blockTypeOptions().some((o) => o.id === 'sweep' && o.label === 'Sweep'));
  assert.equal(measurementActionOptions().length, 6);
  assert.equal(parseSecondsText('1.5'), 1.5);
  assert.equal(parseSecondsText(' 250 ms '), 0.25);
  assert.equal(parseSecondsText('2 s'), 2);
  assert.equal(parseSecondsText('abc'), null);
  assert.equal(parseSecondsText(''), null);
});

// ---------------------------------------------------------------- transport view (§93-§96, §125)

test('transport strip and announcements', () => {
  const m = synth();
  const v = transportStrip(m, { position: 1.25, playing: true });
  assert.equal(v.playLabel, 'Stop');
  assert.equal(v.readout, '00:01.250');
  assert.equal(v.loopOn, false);
  assert.match(v.loopLabel, /^Loop off, 0\.000 s to 4\.000 s$/);
  assert.equal(transportAnnouncement('play', { position: 0 }, m), 'Playing from 0.000 s');
  assert.equal(transportAnnouncement('loop', { enabled: true, start: 1, end: 2 }),
    'Loop on, 1.000 s to 2.000 s');
  assert.equal(transportAnnouncement('refused', { reason: 'busy' }), 'Not playing: busy');
  assert.equal(transportAnnouncement('nope'), '');
  assert.match(KEY_HELP, /Space play or stop/);
});

test('key commands: fields keep their keys, controls keep Space and Enter, Escape always', () => {
  const k = (key, extra = {}) => ({ key, code: key === ' ' ? 'Space' : key, ...extra });
  assert.deepEqual(keyCommand(k('Escape'), 'field'), { cmd: 'escape' });
  assert.equal(keyCommand(k(' '), 'field'), null);
  assert.equal(keyCommand(k('ArrowLeft'), 'field'), null);
  assert.equal(keyCommand(k(' '), 'control'), null);
  assert.deepEqual(keyCommand(k('z', { metaKey: true }), 'control'), { cmd: 'undo' });
  assert.deepEqual(keyCommand(k('Z', { ctrlKey: true, shiftKey: true }), 'clip'), { cmd: 'redo' });
  assert.deepEqual(keyCommand(k(' '), 'clip'), { cmd: 'play-stop' });
  assert.deepEqual(keyCommand(k('ArrowRight', { shiftKey: true }), 'clip'),
    { cmd: 'nudge-time', dir: 1, fine: true });
  assert.deepEqual(keyCommand(k('ArrowUp'), 'clip'), { cmd: 'nudge-row', dir: 1, fine: false });
  assert.deepEqual(keyCommand(k('ArrowUp'), 'point'), { cmd: 'nudge-value', dir: 1, fine: false });
  assert.deepEqual(keyCommand(k('PageDown'), 'point'), { cmd: 'nudge-value', dir: -1,
    large: true });
  assert.deepEqual(keyCommand(k('d', { ctrlKey: true }), 'clip'), { cmd: 'duplicate' });
  assert.equal(keyCommand(k('d', { ctrlKey: true }), 'other'), null);
  assert.deepEqual(keyCommand(k('Delete'), 'marker'), { cmd: 'delete' });
  assert.equal(keyCommand(k('Delete'), 'loop'), null);
  assert.deepEqual(keyCommand(k('s'), 'clip'), { cmd: 'split' });
  assert.equal(keyCommand(k('s'), 'other'), null);
  assert.deepEqual(keyCommand(k('m'), 'other'), { cmd: 'add-marker' });
  assert.deepEqual(keyCommand(k('Home'), 'other'), { cmd: 'return' });
  assert.equal(keyCommand(k('ArrowLeft', { altKey: true }), 'clip'), null);
  assert.equal(keyCommand(k('r', { metaKey: true }), 'clip'), null);
});

// ---------------------------------------------------------------- transport commands (§184-§185)

function fakeTransport(store) {
  const log = [];
  let playing = false;
  let pos = 0;
  return {
    log,
    get playing() { return playing; },
    playhead: () => ({ position: pos, playing }),
    start: ({ position }) => { log.push(['start', position]); playing = true;
      return { ok: true }; },
    stop: ({ fast } = {}) => { log.push(['stop', !!fast]); playing = false;
      return Promise.resolve({ nodes: 0 }); },
    locate: (p) => { pos = p; log.push(['locate', p]); return { position: p }; },
    returnToStart: () => { pos = 0; return { position: 0 }; },
    setLoop: (patch) => store.dispatch({ type: 'LOOP_SET', ...patch }),
    escape: () => { log.push(['escape']); if (playing) { playing = false; return 'stop-audio'; }
      return null; },
  };
}

test('transport commands go through the transport and announce once', async () => {
  const store = storeOf();
  const t = fakeTransport(store);
  const said = [];
  const c = createTransportCommands({ store, transport: t, announce: (x) => said.push(x) });
  c.locate(1.5);
  c.playStop();
  assert.deepEqual(t.log.slice(0, 2), [['locate', 1.5], ['start', 1.5]]);
  assert.equal(c.playing, true);
  await c.playStop();
  assert.deepEqual(t.log[2], ['stop', false]);
  c.toggleLoop();
  assert.equal(store.getModel().timeline.loop.enabled, true);
  c.play();
  assert.equal(c.escape({}), 'stop-audio');
  assert.deepEqual(said, ['Playhead at 1.500 s', 'Playing from 1.500 s', 'Stopped',
    'Loop on, 0.000 s to 4.000 s', 'Playing from 1.500 s', 'Stopped (Escape)']);
  const refused = createTransportCommands({ store, transport: { ...t, get playing() {
    return false; }, start: () => ({ ok: false, reason: 'claimed' }) },
  announce: (x) => said.push(x) });
  refused.play();
  assert.equal(said.at(-1), 'Not playing: claimed');
});

// ---------------------------------------------------------------- compact timeline (§129)

test('compact timeline span and summary', () => {
  const m = synth();
  assert.equal(compactSpan(m), 3);
  assert.equal(compactSummary(m, 1.5), 'Timeline: 2 clips on 1 track, 1 automation lane; '
    + 'length 3.000 s, playhead 1.500 s');
  const s = storeOf();
  s.dispatch({ type: 'LOOP_SET', enabled: true, start: 1, end: 5 });
  s.dispatch({ type: 'MARKER_ADD', kind: 'end', time: 6, label: 'End' });
  assert.equal(compactSpan(s.getModel()), 6);
  assert.match(compactSummary(s.getModel()), /1 marker, loop 1\.000 s to 5\.000 s/);
});
