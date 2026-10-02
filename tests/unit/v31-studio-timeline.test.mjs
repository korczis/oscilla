// OSCILLA V3.1 Studio timeline, transport scheduling, automation and V2 sequence import
// (spec §81-§105, §180-§185, §211-§212; plan V416-V420). Pure modules, a fake AudioContext
// (sequencer-fake-audio.mjs) and a fake scheduler loop driven by explicit clock values.
//
// Tolerances: times are compared EXACTLY wherever they are whole frames at 48 kHz (every §212
// boundary is) or integer arithmetic (the automation values below are integers on integer
// times); 1e-9 s only where a value passes through a frame division; 1e-3 Hz where the
// sequencer's own normalizeBlock rounds a frequency to three decimals (round(v, 3)); 1e-9 for
// beats (actions.js rounds derived beats to 1e-9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimeline, compileSequence, planFromTimeline, GAIN_FLOOR, STOP_LEAD_S, STOP_PAD_S,
  STOP_RAMP_S, automationValueAt,
} from '../../src/js/sequencer/compiler.js';
import {
  addBlock, createSequence, moveBlock, referenceSequence, serializeSequence, setTempo,
  updateBlock, DEFAULT_SEED,
} from '../../src/js/sequencer/model.js';
import { SCHEDULE_LEAD_S, TOP_UP_EVERY_MS } from '../../src/js/audio/scheduler.js';
import { LOOKAHEAD_S } from '../../src/js/sequencer/editor.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { normalizeStudio, serializeStudio, STUDIO_KIND } from '../../src/js/studio/schema.js';
import { validateStudioImport, validateStudioModel } from '../../src/js/studio/validate.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import {
  CONTIGUITY_TOLERANCE_S, DEFAULT_SNAP, MEASUREMENT_CLIP_LIMITS, adjacentMarker, addMarkerAction,
  beatsToSeconds, clipDurationBounds, clipsAtTempo, duplicateClipPlacement, formatMusicalPosition,
  fromMusicalPosition, linkClipToTempo, loopAroundClips, loopEdgeResult, moveClipResult,
  moveMarkerAction, normalizeLoopBounds, nudgeClipResult, patternRuns, resizeClipResult,
  secondsToBeats, snapGridLines, snapTime, timelineRows, toMusicalPosition, unlinkClip,
  validateClip,
} from '../../src/js/studio/timeline.js';
import {
  ESCAPE_PRIORITY, EDIT_POLICY, SAFE_HORIZON_S, STOP_POLICY, TIMELINE_LOOKAHEAD_S, audioTimeOf,
  compilePass, compileTimeline, createAnchor, createTimelineScheduler, frameCeil, holdEvents,
  passInfo, positionAt, resolveEscape, safeHorizon, stopTime, truncatePatternPayload,
} from '../../src/js/studio/timeline-compiler.js';
import {
  AutomationError, applyAutomation, automateParameter, automationScale,
  combineAutomationAndModulation, compileLaneEvents, curveOptions, editPointAction,
  holdAutomation, isExponentialLegal, laneValueAt, modulationRange, nudgePointAction,
  pointProblem, scheduledValueAt,
} from '../../src/js/studio/automation.js';
import {
  exportSequence, importSequence, sequenceToTimeline,
} from '../../src/js/studio/sequence-import.js';
import { FakeContext, FakeParam } from './sequencer-fake-audio.mjs';

const SR = 48000;
const R = NODE_REGISTRY;

// ---------------------------------------------------------------- fixtures

function newStore(model = null) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

function ok(r) {
  assert.ok(r.ok, r.reason);
  return r;
}

/** §212: Tone 0.0-1.0, Sweep 1.0-3.0, Silence 3.0-3.5, Pulse 3.5-4.5 on a Sequence node. */
function spec212() {
  const store = newStore();
  const d = (a) => ok(store.dispatch(a));
  const seq = d({ type: 'NODE_ADD', nodeType: 'sequence' }).created.nodes[0];
  const master = d({ type: 'NODE_ADD', nodeType: 'master', position: { x: 300, y: 0 } })
    .created.nodes[0];
  const filter = d({ type: 'NODE_ADD', nodeType: 'filter', position: { x: 150, y: 0 } })
    .created.nodes[0];
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'audio' }, to: { node: filter, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: filter, port: 'audio' },
    to: { node: master, port: 'audio' } });
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: seq, name: 'Source' })
    .created.tracks[0];
  const clip = (start, duration, blockType, params) => d({ type: 'CLIP_ADD', trackId: track,
    start, duration, payload: { blockType, params } }).created.clips[0];
  const tone = clip(0, 1, 'tone', { freq: 440 });
  const sweep = clip(1, 2, 'sweep', { start: 440, end: 880, curve: 'log' });
  const silence = clip(3, 0.5, 'silence', {});
  const pulse = clip(3.5, 1, 'pulse', { freq: 1200, pulseMs: 100, pauseMs: 100 });
  return { store, ids: { seq, master, filter, track, tone, sweep, silence, pulse } };
}

/** §211: filter cutoff 0 s 500 Hz, 1 s 2 kHz, 2 s 8 kHz with one curve for the ramps. */
function spec211(curve) {
  const { store, ids } = spec212();
  for (const [time, value] of [[0, 500], [1, 2000], [2, 8000]]) {
    ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
      param: 'frequency' }, time, value, curve }));
  }
  return { store, ids, lane: store.getModel().timeline.automation[0] };
}

/** Measurement chain with a measurement track (Sweep 2 s log, Microphone, Capture). */
function measurementStore() {
  const store = newStore();
  const d = (a) => ok(store.dispatch(a));
  const sweep = d({ type: 'NODE_ADD', nodeType: 'sweep', params: { duration: 2 } })
    .created.nodes[0];
  const master = d({ type: 'NODE_ADD', nodeType: 'master' }).created.nodes[0];
  const mic = d({ type: 'NODE_ADD', nodeType: 'microphone' }).created.nodes[0];
  d({ type: 'EDGE_ADD', from: { node: sweep, port: 'audio' },
    to: { node: master, port: 'audio' } });
  const track = d({ type: 'TRACK_ADD', kind: 'measurement', name: 'Measurement' })
    .created.tracks[0];
  const noise = d({ type: 'CLIP_ADD', trackId: track, start: 0, duration: 1, target: mic,
    payload: { action: 'noise-check' } }).created.clips[0];
  const stim = d({ type: 'CLIP_ADD', trackId: track, start: 1, duration: 2, target: sweep,
    payload: { action: 'stimulus' } }).created.clips[0];
  return { store, ids: { sweep, master, mic, track, noise, stim } };
}

const frames = (t) => t * SR;
const isWholeFrame = (t) => Number.isInteger(Math.round(frames(t) * 1e6) / 1e6);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

/**
 * A fake runtime loop: the scheduler is advanced at explicit audio-clock values (no timers, no
 * polling), every pattern item is played with the sequencer's own compileSequence on a fake
 * context, exactly as the Studio runtime does.
 */
function runPlayback(model, { baseTime = 10, startNow = 9.98, until = 20, sampleRate = SR,
  scheduler: given } = {}) {
  const ctx = new FakeContext({ sampleRate, currentTime: startNow });
  const sched = given || createTimelineScheduler(model, { sampleRate, baseTime });
  const voices = new Map();
  const log = [];
  let now = startNow;
  for (let guard = 0; guard < 1000 && now <= until; guard++) {
    ctx.advance(now);
    const r = sched.advance(now);
    for (const it of r.items) {
      log.push({ key: it.key, at: now, startTime: it.startTime });
      if (it.type === 'pattern') {
        voices.set(it.key, compileSequence(it.sequence, ctx, ctx.destination, it.startTime,
          { timers: null }));
      }
    }
    assert.deepEqual(r.skipped, [], 'nothing late');
    const wake = sched.nextWakeMs(now);
    if (wake === null) break;
    now += wake / 1000;
  }
  return { ctx, sched, voices, log, now };
}

// ---------------------------------------------------------------- §212 timeline schedule

test('§212 timeline compiles to the expected schedule on the audio clock', () => {
  const { store, ids } = spec212();
  const model = store.getModel();
  const c = compileTimeline(model, { sampleRate: SR, baseTime: 10 });
  assert.deepEqual(c.warnings, []);
  assert.equal(c.anchor.baseTime, 10);
  assert.equal(c.endTime, 14.5);
  assert.deepEqual(c.items.map((i) => [i.type, i.clipId, i.target, i.startTime, i.endTime]), [
    ['pattern', ids.tone, ids.seq, 10, 11],
    ['pattern', ids.sweep, ids.seq, 11, 13],
    ['pattern', ids.silence, ids.seq, 13, 13.5],
    ['pattern', ids.pulse, ids.seq, 13.5, 14.5],
  ]);
  for (const it of c.items) {
    assert.ok(isWholeFrame(it.startTime) && isWholeFrame(it.endTime), 'whole frames');
    // REUSE: the item's events are exactly the sequencer plan of its one-block sequence.
    const plan = planFromTimeline(buildTimeline(it.sequence, { sampleRate: SR }));
    assert.deepEqual(it.events.map((e) => ({ ...e, time: undefined })),
      plan.map((e) => ({ ...e, time: undefined })));
    for (const e of it.events) assert.equal(e.time, it.startTime + e.t);
    assert.equal(it.sequence.blocks[0].id, it.clipId);
  }
  const sweep = c.items[1];
  const freq = sweep.events.filter((e) => e.kind === 'freq' && e.blockId === ids.sweep);
  assert.deepEqual(freq.map((e) => [e.time, e.value, e.ramp]),
    [[11, 440, 'set'], [13, 880, 'exponential']]);
  // A timeline started at 2.0 s plays only what starts at or after it, shifted.
  const late = compileTimeline(model, { sampleRate: SR, baseTime: 10, startPosition: 2 });
  assert.deepEqual(late.items.map((i) => [i.clipId, i.startTime]),
    [[ids.silence, 11], [ids.pulse, 11.5]]);
});

test('§212 fake scheduler plays every clip on the AudioContext clock with look-ahead', () => {
  const { store, ids } = spec212();
  const { ctx, voices, log, sched } = runPlayback(store.getModel());
  assert.equal(TIMELINE_LOOKAHEAD_S, LOOKAHEAD_S);
  assert.deepEqual(log.map((l) => l.startTime), [10, 11, 13, 13.5]);
  for (const l of log) {
    // 1e-9: 10 - 9.98 is 0.01999999999999957 in binary floating point.
    assert.ok(l.startTime - l.at >= SAFE_HORIZON_S - 1e-9, `${l.startTime - l.at} s ahead`);
    assert.ok(l.startTime - l.at <= TIMELINE_LOOKAHEAD_S, 'never beyond the look-ahead');
  }
  const carriers = ctx.oscillators.filter((o) => o.type === 'sine');
  assert.deepEqual(carriers.map((o) => o.startAt), [10, 11, 13, 13.5]);
  assert.deepEqual(carriers.map((o) => o.stopAt), [11, 13, 13.5, 14.5].map((t) => t + STOP_PAD_S));
  const sweepVoice = [...voices.values()][1];
  // Every voice has ended and cancelled its automation (compileSequence cleanup): the schedule it
  // played is FakeParam.scheduled, the one written before that cleanup.
  assert.deepEqual(ctx.oscillators[1].frequency.events, []);
  assert.deepEqual(ctx.oscillators[1].frequency.scheduled.filter((e) => e.t >= 11)
    .map((e) => [e.t, e.value, e.ramp]), [[11, 440, 'set'], [11, 440, 'set'],
    [13, 880, 'exponential']]);
  assert.equal(sweepVoice.blockIndexAt(12), 0);
  // The silence voice keeps its envelope at the floor for its whole clip.
  const silenceEnv = ctx.created.filter((n) => n.kind === 'gain')[7];
  const silence = silenceEnv.gain.scheduled.filter((e) => e.t >= 13);
  assert.ok(silence.length > 0 && silence.every((e) => e.value === GAIN_FLOOR));
  // Playhead from the audio clock (§94).
  const a = sched.getState().anchor;
  assert.deepEqual(positionAt(a, 12), { position: 2, pass: 0, playing: true });
  assert.deepEqual(positionAt(a, 9), { position: 0, pass: 0, playing: false });
  assert.equal(positionAt(a, 14.5), null);
  assert.equal(sched.advance(15).done, true);
  // Every voice ends and releases its nodes.
  ctx.advance(20);
  assert.equal(ctx.liveSources, 0);
  assert.ok([...voices.values()].every((v) => v.ended && v.activeNodeCount === 0));
  assert.ok(ids.pulse);
});

test('scheduler wake-up keeps the engine look-ahead cadence; a stall skips late items', () => {
  const { store } = spec212();
  const s = createTimelineScheduler(store.getModel(), { sampleRate: SR, baseTime: 10 });
  s.advance(9.98);
  const wake = s.nextWakeMs(9.98);
  assert.ok(wake <= TOP_UP_EVERY_MS && wake >= 50, `${wake}`);
  // Stall: the next advance comes 3.1 s late; the sweep (11 s) is already in the past.
  const r = s.advance(13.1);
  assert.deepEqual(r.skipped.map((i) => i.startTime), [11, 13]);
  assert.deepEqual(r.items.map((i) => i.startTime), [13.5]);
});

test('the first window keeps the clip at baseTime although the clock moved since the anchor',
  () => {
  // baseTime comes from hooks.soon() (>= SAFE_HORIZON_S after the clock reading), but the first
  // advance reads the clock again: in a fresh browser context it had moved two render quanta
  // (measured in chromium: baseTime 0.021333, first advance at 0.005333), and the Tone clip at
  // baseTime was skipped as late — PLAY without its first clip.
  const { store } = spec212();
  const q = 128 / SR;
  const s = createTimelineScheduler(store.getModel(), { sampleRate: SR, baseTime: 10 });
  const r = s.advance(10 - SAFE_HORIZON_S + 2 * q);
  assert.deepEqual(r.skipped, [], 'nothing skipped: baseTime is still ahead of the clock');
  assert.deepEqual(r.items.map((i) => i.startTime), [10]);
  // A stall past baseTime itself still skips (the grid is kept).
  const late = createTimelineScheduler(store.getModel(), { sampleRate: SR, baseTime: 10 });
  const r2 = late.advance(10.5);
  assert.deepEqual(r2.skipped.map((i) => i.startTime), [10]);
  assert.deepEqual(r2.items.map((i) => i.startTime), [11]);
  // Later windows keep the full safe horizon.
  const r3 = s.advance(11 - SAFE_HORIZON_S + q);
  assert.deepEqual(r3.skipped.map((i) => i.startTime), [11]);
});

// ---------------------------------------------------------------- §211 automation

test('§211 automation produces the exact AudioParam event list (linear, step, exponential)', () => {
  const expected = {
    linear: [['setValueAtTime', 500, 5], ['linearRampToValueAtTime', 2000, 6],
      ['linearRampToValueAtTime', 8000, 7]],
    step: [['setValueAtTime', 500, 5], ['setValueAtTime', 2000, 6], ['setValueAtTime', 8000, 7]],
    exponential: [['setValueAtTime', 500, 5], ['exponentialRampToValueAtTime', 2000, 6],
      ['exponentialRampToValueAtTime', 8000, 7]],
  };
  for (const curve of ['linear', 'step', 'exponential']) {
    const { store, lane, ids } = spec211(curve);
    const model = store.getModel();
    const def = R.param('filter', 'frequency');
    const events = compileLaneEvents(lane.points, { paramDef: def, sampleRate: SR, baseTime: 5 });
    assert.deepEqual(events.map((e) => [e.method, e.value, e.time]), expected[curve], curve);
    // The same list through the timeline compiler, and applied to a fake AudioParam.
    const c = compileTimeline(model, { sampleRate: SR, baseTime: 5 });
    assert.equal(c.automation.length, 1);
    assert.deepEqual(c.automation[0].target, { node: ids.filter, param: 'frequency' });
    assert.deepEqual(c.automation[0].events.map((e) => [e.method, e.value, e.time]),
      expected[curve]);
    const param = new FakeParam(2400);
    assert.equal(applyAutomation(param, c.automation[0].events), 3);
    assert.deepEqual(param.calls, expected[curve]);
    // Values between points follow Web Audio semantics (sequencer automationValueAt).
    const mid = automationValueAt(param.events, 5.5);
    near(mid, { linear: 1250, step: 500, exponential: 1000 }[curve], 1e-9, curve);
    near(laneValueAt(lane.points, 0.5), mid, 1e-9, 'authored = scheduled');
  }
});

test('exponential automation to or from zero, or on a zero-reaching parameter, is rejected', () => {
  const def = R.param('filter', 'frequency');
  assert.equal(isExponentialLegal(def), true);
  assert.equal(isExponentialLegal(R.param('gain', 'gain')), false);
  assert.equal(isExponentialLegal(R.param('pan', 'pan')), false);
  assert.deepEqual(curveOptions(R.param('gain', 'gain')), ['step', 'linear']);
  assert.deepEqual(curveOptions(def), ['step', 'linear', 'exponential']);
  const pts = [{ id: 'a', time: 0, value: 500, curve: 'linear' },
    { id: 'b', time: 1, value: 0, curve: 'exponential' }];
  assert.match(pointProblem(def, pts[0], pts[1]), /never to or from zero/);
  assert.throws(() => compileLaneEvents(pts, { paramDef: def, sampleRate: SR }),
    (e) => e instanceof AutomationError && e.pointId === 'b');
  assert.throws(() => applyAutomation(new FakeParam(1), [{ method: 'exponentialRampToValueAtTime',
    value: 0, time: 1 }]), AutomationError);
  // The store refuses both: to zero, and exponential on Gain (domain includes 0).
  const { store, ids } = spec212();
  const r1 = store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 1, value: 0, curve: 'exponential' });
  assert.equal(r1.ok, false);
  const gain = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'gain' })).created.nodes[0];
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: gain, param: 'gain' },
    time: 0, value: 0.5 }));
  const r2 = store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: gain, param: 'gain' },
    time: 1, value: 1, curve: 'exponential' });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /cannot use an exponential ramp/);
});

test('automation clamps to the parameter range and 0.95 × Nyquist of the running context', () => {
  const { lane } = spec211('exponential');
  const def = R.param('filter', 'frequency');
  const ev = compileLaneEvents(lane.points, { paramDef: def, sampleRate: 8000, baseTime: 0 });
  assert.deepEqual(ev.map((e) => e.value), [500, 2000, 3800]);
  assert.ok(ev.every((e) => e.value > 0), 'exponential stays positive after clamping');
});

test('holding automation (STOP / rebuild) keeps the exact value without cancelAndHold', () => {
  const ev = compileLaneEvents([{ id: 'a', time: 0, value: 0, curve: 'linear' },
    { id: 'b', time: 2, value: 1, curve: 'linear' }], { paramDef: R.param('gain', 'gain'),
    sampleRate: SR, baseTime: 1 });
  const p = new FakeParam(1);
  applyAutomation(p, ev);
  const v = holdAutomation(p, ev, 2);
  assert.equal(v, 0.5);
  assert.equal(automationValueAt(p.events, 2), 0.5);
  assert.equal(automationValueAt(p.events, 2.5), 0.5, 'held after the hold time');
  near(automationValueAt(p.events, 1.5), 0.25, 1e-12, 'unchanged before');
  const held = holdEvents(ev, 2);
  assert.deepEqual(held.events.map((e) => [e.method, e.value, e.time]),
    [['linearRampToValueAtTime', 0.5, 2], ['setValueAtTime', 0.5, 2]]);
  const native = new FakeParam(1, { holdSupported: true });
  applyAutomation(native, ev);
  assert.equal(holdAutomation(native, ev, 2), 0.5);
  assert.deepEqual(native.calls.at(-1), ['cancelAndHoldAtTime', 2]);
  assert.equal(scheduledValueAt(ev, 3), 1);
});

// ---------------------------------------------------------------- loop boundaries (§95)

test('loop region: passes on whole frames, clips before the loop start not retriggered', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 2, end: 4 }));
  const model = store.getModel();
  const c = compileTimeline(model, { sampleRate: SR, baseTime: 10, passes: 3 });
  assert.deepEqual(c.items.map((i) => [i.clipId, i.pass, i.startTime, i.endTime, i.truncated]), [
    [ids.tone, 0, 10, 11, false],
    [ids.sweep, 0, 11, 13, false],
    [ids.silence, 0, 13, 13.5, false],
    [ids.pulse, 0, 13.5, 14, true],
    [ids.silence, 1, 15, 15.5, false],
    [ids.pulse, 1, 15.5, 16, true],
    [ids.silence, 2, 17, 17.5, false],
    [ids.pulse, 2, 17.5, 18, true],
  ]);
  assert.equal(c.endTime, 18);
  const a = c.anchor;
  assert.deepEqual(passInfo(a, 2), { pass: 2, posStart: 2, posEnd: 4, startFrame: 16 * SR,
    endFrame: 18 * SR, startTime: 16, endTime: 18 });
  assert.deepEqual(positionAt(a, 15.25), { position: 3.25, pass: 1, playing: true });
  assert.equal(audioTimeOf(a, 2, 3.5), 17.5);
});

test('loop boundary truncation keeps a sweep on its curve; too-short remnants are dropped', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 2 }));
  const c = compileTimeline(store.getModel(), { sampleRate: SR, baseTime: 0, passes: 2 });
  const sweeps = c.items.filter((i) => i.clipId === ids.sweep);
  assert.deepEqual(sweeps.map((i) => [i.startTime, i.endTime]), [[1, 2], [3, 4]]);
  near(sweeps[0].sequence.blocks[0].params.end, 440 * Math.SQRT2, 1e-3, 'log curve at the cut');
  const lin = truncatePatternPayload({ blockType: 'chirp', params: { start: 1000, end: 8000,
    ramp: 'linear' } }, 0.5, 0.25);
  assert.equal(lin.params.end, 4500);
  // A loop end 5 ms into the pulse leaves less than the 10 ms block minimum: dropped, reported.
  ok(store.dispatch({ type: 'LOOP_SET', start: 0, end: 3.505 }));
  const d = compileTimeline(store.getModel(), { sampleRate: SR, baseTime: 0 });
  assert.ok(!d.items.some((i) => i.clipId === ids.pulse));
  assert.ok(d.warnings.some((w) => w.includes(ids.pulse)));
});

test('loop boundary automation: anchored at each pass start, exact value at each cut', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 0, value: 500 }));
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 4, value: 8500, curve: 'linear' }));
  ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 1, end: 3 }));
  const c = compileTimeline(store.getModel(), { sampleRate: SR, baseTime: 10, passes: 2 });
  assert.deepEqual(c.automation[0].events.map((e) => [e.method, e.value, e.time]), [
    ['setValueAtTime', 500, 10],
    ['linearRampToValueAtTime', 6500, 13],
    ['setValueAtTime', 2500, 13],
    ['linearRampToValueAtTime', 6500, 15],
  ]);
  const p = new FakeParam(2400);
  applyAutomation(p, c.automation[0].events);
  assert.equal(automationValueAt(p.events, 14), 4500, 'pass 1 reproduces the authored line');
});

test('a thousand loop passes do not drift; scheduler keeps producing passes', () => {
  const { store } = spec212();
  ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 1.0001 }));
  const a = createAnchor(store.getModel(), { baseTime: 0.0123, sampleRate: 44100 });
  const p = passInfo(a, 1000);
  assert.equal(p.startFrame, a.baseFrame + 1000 * a.loopFrames);
  assert.ok(Number.isInteger(p.startFrame));
  const s = createTimelineScheduler(store.getModel(), { sampleRate: SR, baseTime: 10 });
  const keys = new Set();
  for (let now = 9.98, i = 0; i < 40; i++, now += 0.5) {
    for (const it of s.advance(now).items) {
      assert.ok(!keys.has(it.key), 'each pass item scheduled once');
      keys.add(it.key);
    }
  }
  assert.ok(keys.size >= 19, `${keys.size}`);
  assert.equal(s.nextWakeMs(30) !== null, true, 'a loop never finishes by itself');
});

// ---------------------------------------------------------------- snap (§92)

test('snap: off, time grid, musical grid, markers; measurement never snaps musically', () => {
  const tr = { tempo: 100, timeSignature: [4, 4] };
  const markers = [{ id: 'm1', time: 2.37, kind: 'sweep', label: 'Sweep' }];
  assert.equal(snapTime(1.234, null), 1.234);
  assert.equal(DEFAULT_SNAP.mode, 'off');
  assert.equal(snapTime(0.29, { mode: 'time', gridS: 0.1 }), 0.3, 'no float residue');
  assert.equal(snapTime(-0.04, { mode: 'time', gridS: 0.1 }), 0, 'never negative');
  assert.equal(snapTime(1.0, { mode: 'musical', beatsPerStep: 1 }, { transport: tr }), 1.2);
  assert.equal(snapTime(1.0, { mode: 'musical', beatsPerStep: 0.25 }, { transport: tr }), 1.05);
  assert.equal(snapTime(1.0, { mode: 'musical', beatsPerStep: 1, gridS: 0.25 },
    { transport: tr, clipKind: 'measurement' }), 1, 'time grid fallback for measurement');
  assert.equal(snapTime(2.4, { mode: 'markers', thresholdS: 0.05 }, { markers }), 2.37);
  assert.equal(snapTime(2.5, { mode: 'markers', thresholdS: 0.05 }, { markers }), 2.5);
  assert.equal(snapTime(3.98, { mode: 'markers' }, { markers,
    loop: { enabled: true, start: 1, end: 4 } }), 4);
  assert.deepEqual(snapGridLines(0, 1, { mode: 'time', gridS: 0.25 }), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(snapGridLines(0, 1.3, { mode: 'musical', beatsPerStep: 1 }, tr),
    [0, 0.6, 1.2]);
  assert.deepEqual(snapGridLines(0, 1, { mode: 'off' }), []);
});

test('clip drag snaps the closer edge to a marker and refuses incompatible tracks', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'MARKER_ADD', time: 6, kind: 'end', label: 'End' }));
  const m = store.getModel();
  const r = moveClipResult(m, ids.pulse, { start: 4.97, snap: { mode: 'markers',
    thresholdS: 0.05 } });
  assert.equal(r.ok, true);
  assert.equal(r.start, 5, 'end edge snapped to the 6 s marker');
  assert.deepEqual(r.action, { type: 'CLIP_MOVE', clipId: ids.pulse, start: 5,
    trackId: ids.track });
  const g = moveClipResult(m, ids.pulse, { deltaS: 0.26, snap: { mode: 'time', gridS: 0.1 } });
  assert.equal(g.start, 3.8);
  const mtrack = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'measurement' })).created.tracks[0];
  const bad = moveClipResult(store.getModel(), ids.pulse, { trackId: mtrack });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /cannot go on a measurement track/);
  const over = moveClipResult(m, ids.pulse, { start: 3 });
  assert.equal(over.ok, true);
  assert.deepEqual(over.warnings.map((w) => w.code), ['clip-overlap']);
  assert.equal(moveClipResult(m, ids.pulse, { start: 3.5 }).action, null, 'no change, no action');
});

// ---------------------------------------------------------------- musical vs seconds (§90-§91)

test('musical time conversion: beats, bars and positions at the transport tempo', () => {
  const tr = { tempo: 120, timeSignature: [3, 4] };
  assert.equal(beatsToSeconds(3, 120), 1.5);
  assert.equal(secondsToBeats(1.5, 120), 3);
  assert.deepEqual(toMusicalPosition(0, tr), { bar: 1, beat: 1, fraction: 0 });
  assert.deepEqual(toMusicalPosition(1.75, tr), { bar: 2, beat: 1, fraction: 0.5 });
  assert.equal(fromMusicalPosition({ bar: 2, beat: 1, fraction: 0.5 }, tr), 1.75);
  assert.equal(formatMusicalPosition(1.75, tr), '2.1.500');
  for (const s of [0, 0.1, 0.3333, 2.75, 59.999]) {
    near(fromMusicalPosition(toMusicalPosition(s, tr), tr), s, 1e-9, 'round trip');
  }
});

test('tempo-linked clips follow the tempo, absolute clips stay, measurement in seconds', () => {
  const { store, ids } = spec212();
  const r = ok(store.dispatch({ type: 'CLIP_ADD', trackId: ids.track, timeBase: 'tempo',
    startBeats: 10, durationBeats: 2, payload: { blockType: 'tone', params: { freq: 660 } } }));
  const id = r.created.clips[0];
  const at = (cid) => store.getModel().timeline.clips.find((c) => c.id === cid);
  assert.deepEqual([at(id).start, at(id).duration, at(id).musical],
    [5, 1, { startBeats: 10, durationBeats: 2 }]);
  const before = store.getModel();
  ok(store.dispatch({ type: 'TRANSPORT_SET', tempo: 60 }));
  assert.deepEqual([at(id).start, at(id).duration], [10, 2], 'tempo-linked: beats kept');
  assert.deepEqual([at(ids.pulse).start, at(ids.pulse).duration], [3.5, 1], 'absolute: unchanged');
  assert.deepEqual(clipsAtTempo(before.timeline.clips, 60).find((c) => c.id === id).start, 10);
  // Moving a tempo-linked clip in seconds re-derives its beats.
  ok(store.dispatch({ type: 'CLIP_MOVE', clipId: id, start: 12 }));
  near(at(id).musical.startBeats, 12, 1e-9);
  ok(store.dispatch({ type: 'CLIP_SET_TIME_BASE', clipId: id, timeBase: 'absolute' }));
  assert.equal(at(id).musical, undefined);
  ok(store.dispatch({ type: 'TRANSPORT_SET', tempo: 120 }));
  assert.equal(at(id).start, 12, 'absolute after unlinking');
  // Measurement clips are never musical: action, helper and validator all refuse.
  const ms = measurementStore();
  const refused = ms.store.dispatch({ type: 'CLIP_SET_TIME_BASE', clipId: ms.ids.stim,
    timeBase: 'tempo' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /musical time never enters a measurement/);
  const mclip = ms.store.getModel().timeline.clips.find((c) => c.id === ms.ids.stim);
  assert.throws(() => linkClipToTempo(mclip, 120), RangeError);
  const raw = JSON.parse(serializeStudio(ms.store.getModel()));
  raw.timeline.clips[1].musical = { startBeats: 2, durationBeats: 4 };
  assert.ok(validateStudioModel(normalizeStudio(raw)).errors
    .some((e) => e.code === 'musical-measurement'));
  assert.deepEqual(unlinkClip(linkClipToTempo(at(ids.tone), 120)), at(ids.tone));
});

test('the musical field is validated and imported; mismatched beats are rejected', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'CLIP_SET_TIME_BASE', clipId: ids.sweep, timeBase: 'tempo' }));
  const text = serializeStudio(store.getModel());
  const imported = validateStudioImport(text);
  assert.ok(imported.ok, JSON.stringify(imported.errors));
  assert.deepEqual(imported.model.timeline.clips.find((c) => c.id === ids.sweep).musical,
    { startBeats: 2, durationBeats: 4 });
  const raw = JSON.parse(text);
  raw.timeline.clips.find((c) => c.id === ids.sweep).musical.startBeats = 3;
  const bad = validateStudioModel(normalizeStudio(raw));
  assert.ok(bad.errors.some((e) => e.code === 'invalid-musical'));
  // Models without musical clips serialize exactly as before (no musical key at all).
  assert.ok(!serializeStudio(spec212().store.getModel()).includes('musical'));
});

// ---------------------------------------------------------------- V2 sequence import (§85)

function v2Fixtures() {
  let all = createSequence({ tempoBpm: 96, waveform: 'square', seed: 4242 });
  for (const type of ['tone', 'silence', 'sweep', 'pulse', 'chirp', 'burst', 'siren', 'am', 'fm',
    'random']) all = addBlock(all, type);
  let locked = referenceSequence();
  locked = updateBlock(locked, 'b2', { beats: 1.5 });
  locked = updateBlock(locked, 'b4', { beats: 0.75 });
  locked = setTempo(locked, 137);
  return {
    reference: referenceSequence(),
    allTypes: all,
    tempoLocked: locked,
    looped: { ...referenceSequence(), loop: true, waveform: 'triangle' },
    reordered: moveBlock(moveBlock(referenceSequence(), 0, 4), 1, 3),
    single: createSequence({ blocks: [{ id: 'b7', type: 'chirp', durationMs: 333.333 }] }),
  };
}

test('V2 sequence import → export reproduces every fixture exactly', () => {
  for (const [name, seq] of Object.entries(v2Fixtures())) {
    const v2 = serializeSequence(seq);
    const imp = importSequence(v2, { sampleRate: SR });
    assert.ok(imp.ok, `${name}: ${JSON.stringify(imp.errors)}`);
    assert.deepEqual(imp.issues, [], name);
    const ex = exportSequence(imp.model, { seed: imp.extras.seed, sampleRate: SR });
    assert.deepEqual(ex.issues, [], name);
    assert.deepEqual(ex.sequence, v2, name);
    // JSON text input reads the same.
    assert.deepEqual(importSequence(JSON.stringify(v2)).model, imp.model, name);
  }
});

test('imported sequence keeps the V2 timing: clip starts equal the sequencer block starts', () => {
  const fx = v2Fixtures();
  for (const seq of [fx.reference, fx.allTypes, fx.tempoLocked]) {
    const imp = importSequence(serializeSequence(seq));
    const tl = buildTimeline(seq, { sampleRate: SR });
    const c = compileTimeline(imp.model, { sampleRate: SR, baseTime: 1 });
    // Compared in frames (integers): the V2 sequencer quantises boundaries to frames too.
    assert.deepEqual(c.items.map((i) => Math.round((i.startTime - 1) * SR)),
      tl.blocks.map((b) => b.startFrame));
    assert.deepEqual(c.items.map((i) => Math.round((i.endTime - 1) * SR)),
      tl.blocks.map((b) => b.endFrame));
    assert.deepEqual(patternRuns(imp.model.timeline.clips).length, 1, 'one contiguous run');
  }
  const locked = importSequence(serializeSequence(fx.tempoLocked)).model;
  const linked = locked.timeline.clips.filter((c) => c.musical);
  assert.deepEqual(linked.map((c) => c.musical.durationBeats), [1.5, 0.75]);
  assert.equal(locked.transport.tempo, 137);
  assert.equal(locked.timeline.loop.enabled, false);
  const looped = importSequence(serializeSequence(fx.looped)).model;
  assert.deepEqual(looped.timeline.loop, { enabled: true, start: 0, end: 2.25 });
  assert.equal(looped.graph.nodes[0].params.waveform, 'triangle');
});

test('export: gaps become silence, overlaps are reported, damaged input never throws', () => {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'CLIP_MOVE', clipId: ids.pulse, start: 4 }));
  const ex = exportSequence(store.getModel(), { trackId: ids.track });
  assert.deepEqual(ex.sequence.blocks.map((b) => [b.type, b.durationMs]), [['tone', 1000],
    ['sweep', 2000], ['silence', 500], ['silence', 500], ['pulse', 1000]]);
  ok(store.dispatch({ type: 'CLIP_MOVE', clipId: ids.pulse, start: 2.5 }));
  const ov = exportSequence(store.getModel(), { trackId: ids.track });
  assert.ok(ov.issues.some((i) => i.includes('overlaps')));
  const broken = importSequence('{not json');
  assert.equal(broken.ok, true);
  assert.deepEqual(broken.issues, ['Sequence JSON could not be parsed.']);
  assert.equal(broken.model.timeline.clips.length, 0);
  const t = sequenceToTimeline(serializeSequence(referenceSequence()), { trackId: 'track-9',
    startAt: 2 });
  assert.deepEqual(t.clips.map((c) => c.start), [2, 2.5, 3, 3.25, 3.75]);
  assert.equal(t.seed, DEFAULT_SEED);
});

// ---------------------------------------------------------------- edit during playback (§182-§183)

function playing() {
  const { store, ids } = spec212();
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 0, value: 500 }));
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 4, value: 8500, curve: 'linear' }));
  const sched = createTimelineScheduler(store.getModel(), { sampleRate: SR, baseTime: 10 });
  const first = sched.advance(9.98);
  const second = sched.advance(10.5);
  return { store, ids, sched, scheduled: [...first.items, ...second.items], first, second };
}

test('edit during playback: future clips rebuilt from the safe horizon, current one stays', () => {
  const { store, ids, sched, scheduled } = playing();
  assert.deepEqual(scheduled.map((i) => i.clipId), [ids.tone, ids.sweep]);
  ok(store.dispatch({ type: 'CLIP_UPDATE', clipId: ids.sweep, payload: { blockType: 'sweep',
    params: { start: 440, end: 1760, curve: 'log' } } }));
  ok(store.dispatch({ type: 'CLIP_UPDATE', clipId: ids.tone, payload: { blockType: 'tone',
    params: { freq: 550 } } }));
  const plan = sched.edit(store.getModel(), 10.6);
  assert.equal(plan.horizon, frameCeil(10.6 + SAFE_HORIZON_S, SR));
  assert.equal(plan.horizon, safeHorizon(10.6, SR));
  const byClip = Object.fromEntries(plan.decisions.map((d) => [d.clipId, d.decision]));
  assert.equal(byClip[ids.tone], 'keep-until-end', 'the current event stays');
  assert.equal(byClip[ids.sweep], 'cancel');
  assert.deepEqual(plan.cancel, [scheduled[1].key]);
  assert.deepEqual(plan.schedule.map((i) => [i.clipId, i.startTime]), [[ids.sweep, 11]]);
  assert.equal(plan.schedule[0].sequence.blocks[0].params.end, 1760);
  assert.deepEqual(plan.automation, [], 'unchanged lanes are left alone');
  // The next loop pass / next play uses the edited tone.
  const next = compileTimeline(store.getModel(), { sampleRate: SR, baseTime: 20 });
  assert.equal(next.items[0].sequence.blocks[0].params.freq, 550);
});

test('edit during playback: shorten = retime, delete = release, new clip waits', () => {
  {
    const { store, ids, sched } = playing();
    ok(store.dispatch({ type: 'CLIP_RESIZE', clipId: ids.tone, duration: 0.8 }));
    const plan = sched.edit(store.getModel(), 10.6);
    assert.deepEqual(plan.retime.map((r) => r.at), [10.8]);
    assert.equal(plan.decisions.find((d) => d.clipId === ids.tone).decision, 'retime-end');
  }
  {
    const { store, ids, sched } = playing();
    ok(store.dispatch({ type: 'CLIP_REMOVE', clipId: ids.tone }));
    const plan = sched.edit(store.getModel(), 10.6);
    assert.deepEqual(plan.release.map((r) => r.at), [plan.horizon]);
  }
  {
    const { store, ids, sched } = playing();
    const t2 = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: ids.seq }))
      .created.tracks[0];
    const added = ok(store.dispatch({ type: 'CLIP_ADD', trackId: t2, start: 0.2, duration: 1,
      payload: { blockType: 'tone', params: { freq: 330 } } })).created.clips[0];
    const plan = sched.edit(store.getModel(), 10.6);
    assert.equal(plan.decisions.find((d) => d.clipId === added).decision, 'next-trigger');
    assert.ok(!plan.schedule.some((i) => i.clipId === added));
  }
});

test('edit during playback: automation holds its exact value at the horizon, continues', () => {
  const { store, sched, first, second } = playing();
  const scheduledEvents = [...first.automation[0].events, ...(second.automation[0]
    ? second.automation[0].events : [])];
  const param = new FakeParam(2400);
  applyAutomation(param, scheduledEvents);
  const lane = store.getModel().timeline.automation[0];
  ok(store.dispatch({ type: 'AUTOMATION_POINT_MOVE', laneId: lane.id,
    pointId: lane.points[1].id, value: 4500 }));
  const plan = sched.edit(store.getModel(), 10.6);
  assert.equal(plan.automation.length, 1);
  const a = plan.automation[0];
  const h = plan.horizon;
  assert.equal(a.cancelFrom, h);
  near(a.holdValue, 500 + 2000 * (h - 10), 1e-9, 'old trajectory value at the horizon');
  const before = automationValueAt(param.events, h - 0.001);
  applyAutomation(param, a.events, { cancelFrom: a.cancelFrom });
  near(automationValueAt(param.events, h - 0.001), before, 1e-9, 'unchanged before the horizon');
  near(automationValueAt(param.events, h), a.holdValue, 1e-9, 'continuous at the horizon');
  // After the horizon the new lane ramps to its new point (4500 at 14 s).
  assert.deepEqual(a.events.at(-1).value, 4500);
  assert.equal(a.events.at(-1).time, 14);
});

test('loop change during playback re-anchors with a continuous position', () => {
  const { store, sched } = playing();
  ok(store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 2 }));
  const plan = sched.edit(store.getModel(), 10.6);
  assert.equal(plan.reanchored, true);
  const anchor = sched.getState().anchor;
  near(positionAt(anchor, plan.horizon).position, plan.horizon - 10, 1e-9);
  near(positionAt(anchor, plan.horizon + 1.5).position, 0.12 + plan.horizon - 10.62, 1e-6,
    'wrapped to the loop start after 2 s');
});

// ---------------------------------------------------------------- STOP (§184) and Escape (§185)

test('STOP releases sounding voices, cancels pending ones, holds automation, keeps model', () => {
  const { store } = spec212();
  const model = store.getModel();
  const { ctx, voices, sched } = runPlayback(model, { until: 10.5 });
  ctx.advance(11.5);
  sched.advance(11.5);
  const plan = sched.stop(11.5);
  assert.equal(plan.at, stopTime(11.5, SR));
  // The sequencer's realtime voice.stop() default: STOP_LEAD_S ahead, on a render quantum.
  const q = 128 / SR;
  assert.equal(plan.at, Math.ceil((11.5 + STOP_LEAD_S) / q - 1e-9) * q);
  assert.ok(plan.at >= 11.5 + STOP_LEAD_S && isWholeFrame(plan.at));
  assert.equal(plan.fadeS, STOP_RAMP_S);
  assert.deepEqual(plan.playhead, { mode: 'return-to-play-start', position: 0 });
  assert.equal(plan.model, 'unchanged');
  const releasedClips = plan.release.map((r) => r.key.split('#')[0]);
  assert.equal(releasedClips.length, 1, 'only the sweep sounds at 11.5 s');
  for (const r of plan.release) {
    const v = voices.get(r.key);
    assert.ok(v, r.key);
    assert.equal(v.stop(r.at), true);
  }
  for (const k of plan.cancel) voices.get(k)?.dispose();
  ctx.advance(plan.releasedBy + 0.01);
  ctx.advance(20);
  assert.equal(ctx.liveSources, 0);
  const after = sched.advance(12);
  assert.equal(after.done, true);
  assert.deepEqual(after.items, []);
  assert.equal(sched.nextWakeMs(12), null);
  assert.equal(store.getModel(), model, 'STOP never touches the model');
  assert.equal(STOP_POLICY.playhead, 'return-to-play-start');
});

test('STOP holds every scheduled automation lane at the stop time', () => {
  const { sched } = playing();
  const plan = sched.stop(11);
  assert.equal(plan.automation.length, 1);
  const a = plan.automation[0];
  near(a.holdValue, 500 + 2000 * (plan.at - 10), 1e-9);
  assert.deepEqual(a.events.map((e) => e.method), ['linearRampToValueAtTime', 'setValueAtTime']);
});

test('Escape priority and the policies are explicit data', () => {
  assert.deepEqual(ESCAPE_PRIORITY, ['cancel-gesture', 'close-popup', 'cancel-selection-mode',
    'stop-audio']);
  assert.equal(resolveEscape({ gesture: true, popup: true, audioActive: true }), 'cancel-gesture');
  assert.equal(resolveEscape({ popup: true, audioActive: true }), 'close-popup');
  assert.equal(resolveEscape({ selectionMode: true, audioActive: true }),
    'cancel-selection-mode');
  assert.equal(resolveEscape({ audioActive: true }), 'stop-audio');
  assert.equal(resolveEscape({}), null);
  assert.ok(Object.isFrozen(EDIT_POLICY) && Object.isFrozen(STOP_POLICY));
  assert.equal(EDIT_POLICY.playingItem.other, 'keep-until-end');
  assert.equal(SAFE_HORIZON_S, SCHEDULE_LEAD_S);
});

// ---------------------------------------------------------------- clip validation and gestures

test('clip validation: minimum duration, pattern bounds, measurement requirements', () => {
  const { store, ids } = spec212();
  const m = store.getModel();
  const sweep = m.timeline.clips.find((c) => c.id === ids.sweep);
  assert.deepEqual(clipDurationBounds(sweep), { min: 0.02, max: 30 });
  const r = resizeClipResult(m, ids.sweep, { edge: 'end', time: 1.001 });
  assert.equal(r.ok, true);
  assert.equal(r.clamped, true);
  assert.equal(r.duration, 0.02, 'clamped to the sweep block minimum');
  assert.deepEqual(r.action, { type: 'CLIP_RESIZE', clipId: ids.sweep, start: 1,
    duration: 0.02 });
  const s = resizeClipResult(m, ids.sweep, { edge: 'start', time: 1.5,
    snap: { mode: 'time', gridS: 0.25 } });
  assert.deepEqual([s.start, s.duration], [1.5, 1.5]);
  const ms = measurementStore();
  const mm = ms.store.getModel();
  const stim = mm.timeline.clips.find((c) => c.id === ms.ids.stim);
  assert.deepEqual(clipDurationBounds(stim), { min: MEASUREMENT_CLIP_LIMITS.stimulus[0],
    max: MEASUREMENT_CLIP_LIMITS.stimulus[1] });
  assert.equal(validateClip(mm, stim).ok, true);
  const short = validateClip(mm, { ...stim, duration: 1.5 });
  assert.deepEqual(short.warnings.map((w) => w.code), ['stimulus-truncated']);
  const wrong = validateClip(mm, { ...stim, target: ms.ids.mic });
  assert.ok(wrong.errors.some((e) => e.code === 'measurement-target'));
  const noise = mm.timeline.clips.find((c) => c.id === ms.ids.noise);
  assert.ok(validateClip(mm, { ...noise, duration: 0.1 }).errors
    .some((e) => e.code === 'duration-bounds'), 'noise check at least 0.25 s');
  assert.ok(validateClip(mm, { ...noise, musical: { startBeats: 0, durationBeats: 2 } }).errors
    .some((e) => e.code === 'musical-measurement'));
});

test('duplicate goes after the clip and past overlapping clips; nudge moves by one step', () => {
  const { store, ids } = spec212();
  const m = store.getModel();
  const d = duplicateClipPlacement(m, ids.sweep);
  assert.equal(d.start, 4.5, 'skips silence and pulse');
  const r = ok(store.dispatch(d.action));
  const copy = store.getModel().timeline.clips.find((c) => c.id === r.created.clips[0]);
  assert.deepEqual([copy.start, copy.trackId, copy.payload], [4.5, ids.track,
    m.timeline.clips.find((c) => c.id === ids.sweep).payload]);
  assert.notEqual(copy.id, ids.sweep);
  const n = nudgeClipResult(store.getModel(), ids.pulse, { direction: 1,
    snap: { mode: 'time', gridS: 0.5 } });
  assert.equal(n.start, 4);
  const back = nudgeClipResult(store.getModel(), ids.pulse, { direction: -1,
    snap: { mode: 'musical', beatsPerStep: 1 } });
  assert.equal(back.start, 3, 'one beat at 120 BPM');
});

test('loop and marker helpers produce the actions an editor dispatches', () => {
  const { store, ids } = spec212();
  const m = store.getModel();
  assert.deepEqual(normalizeLoopBounds(3, 1), { start: 1, end: 3 });
  assert.deepEqual(normalizeLoopBounds(2, 2), { start: 2, end: 2.01 });
  assert.deepEqual(loopEdgeResult(m, 'end', 3.04, { mode: 'time', gridS: 0.1 }).action,
    { type: 'LOOP_SET', start: 0, end: 3 });
  assert.deepEqual(loopEdgeResult(m, 'move', 1).loop, { enabled: false, start: 1, end: 5 });
  assert.deepEqual(loopAroundClips(m, [ids.sweep, ids.silence]), { start: 1, end: 3.5 });
  const add = addMarkerAction(m, 'sweep', 1.02, { mode: 'time', gridS: 0.1 });
  assert.deepEqual(add, { type: 'MARKER_ADD', kind: 'sweep', time: 1, label: 'Sweep' });
  const marker = ok(store.dispatch(add)).created.markers[0];
  ok(store.dispatch(addMarkerAction(store.getModel(), 'end', 4.5)));
  const mv = moveMarkerAction(store.getModel(), marker, 1.26, { mode: 'time', gridS: 0.25 });
  assert.deepEqual(mv, { type: 'MARKER_MOVE', markerId: marker, time: 1.25 });
  ok(store.dispatch(mv));
  assert.equal(adjacentMarker(store.getModel(), 0, 1).time, 1.25);
  assert.equal(adjacentMarker(store.getModel(), 4.5, -1).time, 1.25);
  assert.equal(adjacentMarker(store.getModel(), 4.5, 1), null);
  const rows = timelineRows(store.getModel());
  assert.deepEqual(rows.map((r) => r.type), ['event']);
});

// ---------------------------------------------------------------- undo / redo

test('undo/redo of clip move/resize (one gesture) and automation point edits is exact', () => {
  const { store, ids } = spec212();
  const start = serializeStudio(store.getModel());
  store.beginGesture();
  for (const t of [3.6, 3.7, 3.8]) {
    const r = moveClipResult(store.getModel(), ids.pulse, { start: t });
    ok(store.dispatch(r.action));
  }
  store.endGesture();
  const moved = serializeStudio(store.getModel());
  const rz = resizeClipResult(store.getModel(), ids.pulse, { edge: 'end', time: 5.3 });
  ok(store.dispatch(rz.action));
  const resized = serializeStudio(store.getModel());
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 0, value: 500 }));
  ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 2, value: 8000, curve: 'exponential' }));
  const lane = store.getModel().timeline.automation[0];
  const pointed = serializeStudio(store.getModel());
  const e = editPointAction(store.getModel(), lane.id, lane.points[1].id, { time: 2.5,
    value: 1e9 }, { sampleRate: SR });
  assert.equal(e.ok, true);
  assert.equal(e.action.value, 0.95 * SR / 2, 'clamped to 0.95 × Nyquist');
  ok(store.dispatch(e.action));
  const edited = serializeStudio(store.getModel());
  const illegal = editPointAction(store.getModel(), lane.id, lane.points[0].id,
    { value: 500, curve: 'exponential' });
  assert.equal(illegal.ok, true, 'first point: exponential has no previous value to fail');
  const nudge = nudgePointAction(store.getModel(), lane.id, lane.points[0].id, { dValue: 1 });
  assert.ok(nudge.action.value > 500);
  assert.equal(store.undo().label, 'Move automation point');
  assert.equal(serializeStudio(store.getModel()), pointed);
  store.undo();
  store.undo();
  assert.equal(serializeStudio(store.getModel()), resized);
  assert.equal(store.undo().label, 'Resize pattern clip');
  assert.equal(serializeStudio(store.getModel()), moved);
  assert.equal(store.undo().label, 'Move pattern clip', 'the drag is one entry');
  assert.equal(serializeStudio(store.getModel()), start);
  for (let i = 0; i < 5; i++) ok(store.redo());
  assert.equal(serializeStudio(store.getModel()), edited);
});

// ------------------------------------------------------------ scales and modulation (§101, §103)

test('automation scales are parameter-appropriate (log Hz, dB gain, pan, Q)', () => {
  const f = automationScale(R.param('filter', 'frequency'), { sampleRate: SR });
  assert.equal(f.kind, 'log');
  assert.deepEqual([f.min, f.max], [20, 20000]);
  near(f.toNormalized(632.455532), 0.5, 1e-9, 'geometric middle');
  near(f.fromNormalized(0.5), Math.sqrt(20 * 20000), 1e-9);
  assert.equal(f.format(2000), '2 kHz');
  assert.ok(f.ticks().some((t) => t.value === 1000));
  const g = automationScale(R.param('gain', 'gain'));
  assert.equal(g.kind, 'db');
  assert.equal(g.toNormalized(0), 0);
  near(g.toNormalized(2), 1, 1e-12, '+6 dB at the top');
  near(g.fromNormalized(g.toNormalized(0.5)), 0.5, 1e-12);
  assert.equal(g.format(1), '0.0 dB');
  const p = automationScale(R.param('pan', 'pan'));
  assert.equal(p.kind, 'bipolar');
  assert.equal(p.toNormalized(0), 0.5);
  assert.equal(p.format(-0.5), 'L 50 %');
  const q = automationScale(R.param('filter', 'Q'));
  assert.equal(q.kind, 'log');
  assert.deepEqual([q.min, q.max], [0.1, 30]);
  const fg = automationScale(R.param('filter', 'gain'));
  assert.equal(fg.kind, 'linear');
  assert.equal(fg.unit, 'dB');
  assert.equal(fg.toNormalized(0), 0.5);
  const low = automationScale(R.param('filter', 'frequency'), { sampleRate: 22050 });
  assert.equal(low.max, 22050 / 2 * 0.95, 'display capped at the running safe maximum');
});

test('automation + modulation: actual = base + modulation within bounds (§103)', () => {
  const def = R.param('filter', 'frequency');
  const lfo = (signal, props) => ({ signal, props: { muted: false, depth: 1200,
    polarity: 'bipolar', mapping: 'linear', offset: 0, ...props } });
  assert.equal(combineAutomationAndModulation({ base: 1000, modulations: [lfo(0.5)],
    paramDef: def, sampleRate: SR }).value, 1600);
  assert.equal(combineAutomationAndModulation({ base: 1000, modulations: [lfo(-1,
    { polarity: 'unipolar' })], paramDef: def }).value, 1000);
  assert.equal(combineAutomationAndModulation({ base: 1000, modulations: [lfo(1,
    { mapping: 'log', depth: 1 })], paramDef: def }).value, 2000);
  assert.equal(combineAutomationAndModulation({ base: 1000, modulations: [lfo(1,
    { muted: true })], paramDef: def }).value, 1000);
  const two = combineAutomationAndModulation({ base: 1000, modulations: [lfo(1), lfo(1,
    { depth: 300 })], paramDef: def });
  assert.equal(two.value, 2500, 'contributions add');
  const top = combineAutomationAndModulation({ base: 20000, modulations: [lfo(1,
    { depth: 10000 })], paramDef: def, sampleRate: SR });
  assert.equal(top.value, 0.95 * SR / 2);
  assert.equal(top.clamped, true);
  const bottom = combineAutomationAndModulation({ base: 100, modulations: [lfo(-1)],
    paramDef: def });
  assert.equal(bottom.value, def.min);
  assert.deepEqual(modulationRange({ base: 1000, modulations: [lfo(0)], paramDef: def }),
    [10, 2200]);
});

test('AUTOMATE from the Inspector creates or reveals the lane (§102)', () => {
  const { store, ids } = spec212();
  const r = automateParameter(store.getModel(), ids.filter, 'frequency', 1);
  assert.deepEqual(r.action, { type: 'AUTOMATION_POINT_ADD', target: { node: ids.filter,
    param: 'frequency' }, time: 1, value: 1000, curve: 'linear' });
  ok(store.dispatch(r.action));
  assert.deepEqual(automateParameter(store.getModel(), ids.filter, 'frequency'),
    { reveal: store.getModel().timeline.automation[0].id });
  assert.match(automateParameter(store.getModel(), ids.filter, 'type').reason,
    /cannot be automated/);
  assert.match(automateParameter(store.getModel(), ids.master, 'level').reason,
    /cannot be automated/);
});

test('validate.js additions: short active loop rejected; sub-sample contiguity tolerance', () => {
  const { store } = spec212();
  const r = store.dispatch({ type: 'LOOP_SET', enabled: true, start: 1, end: 1.001 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least/);
  assert.ok(CONTIGUITY_TOLERANCE_S < 1 / 384000);
  const raw = { kind: STUDIO_KIND, schemaVersion: 1, graph: { nodes: [], edges: [] },
    timeline: { loop: { enabled: false, start: 1, end: 1.001 } } };
  assert.ok(validateStudioModel(normalizeStudio(raw)).ok, 'an inactive short loop is fine');
  // The pass compiler for a single pass agrees with compileTimeline.
  const m = store.getModel();
  const a = createAnchor(m, { baseTime: 10, sampleRate: SR });
  assert.deepEqual(compilePass(m, a, 0).items.map((i) => i.startTime), [10, 11, 13, 13.5]);
});
