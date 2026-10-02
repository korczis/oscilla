// Studio timeline compiler and transport scheduling (spec §93-§96, §180-§185, §212; plan V418).
// Pure: plain data in, plain data out; no DOM, no Web Audio objects, no clock, no timers. The
// runtime owns the AudioContext, calls advance(ctx.currentTime) from its UI bookkeeping timer and
// applies what comes back; AudioContext.currentTime is the only time authority (§94, §181).
//
// REUSE (§84, §180). A pattern clip is compiled by the existing sequencer: the clip becomes a
// one-block V2 sequence (sequencer/model.js normalizeModel) whose plan is
// sequencer/compiler.js buildTimeline + planFromTimeline, and the runtime plays it with
// compileSequence(item.sequence, ctx, destination, item.startTime). No scheduling maths is
// rewritten here: envelopes, edges, frame quantisation, clamping and stop/hold stay the
// sequencer's. One clip is one voice; a block boundary is at the envelope floor in both cases,
// so contiguous clips sound as the V2 block chain did, and an edit replaces exactly one voice.
//
// Transport anchor. Playback started at audio time baseTime (rounded up to a whole frame) from
// timeline position startPosition. Pass 0 covers [startPosition, loopEnd) when an active loop
// lies ahead, else [startPosition, timelineEnd); pass k >= 1 covers [loopStart, loopEnd). Pass
// starts are whole frames: firstPassFrames + (k - 1) × loopFrames after baseFrame, so a
// thousand passes do not drift. A position inside pass k plays at
//   (passStartFrame(k) + round((position - passPosStart(k)) × sampleRate)) / sampleRate.
// Loop boundaries (§95): in each pass, clips whose start lies in the pass range play; a clip
// crossing the pass end is truncated there (a sweep or chirp keeps its curve and ends at the
// frequency it reaches at the cut; a clip that would become shorter than its type's minimum is
// dropped); a clip that starts before the loop start is not retriggered in loop passes.
// Automation is anchored at every pass start and ramps to its exact value at every cut
// (automation.js), so each pass reproduces the authored curve.
//
// Look-ahead (§181). createTimelineScheduler().advance(now) returns the items whose start falls
// in [scheduledUntil, now + lookAheadS) and the automation events of that window — a ramp is
// due when its segment BEGINS (`scheduleAt` = the previous event's time), because an AudioParam
// ramp interpolates from the previous event and must be known before the audio thread renders
// that segment; a set is due at its own time. lookAheadS is
// the sequencer's LOOKAHEAD_S (1 s) and the suggested wake-up is at most the engine's
// TOP_UP_EVERY_MS, so the existing look-ahead behaviour is kept. After a stall, items that would
// start less than SCHEDULE_LEAD_S from now are skipped (the grid is kept, as
// audio/scheduler.js scheduleCycles does) and automation is re-anchored at the safe horizon.
//
// Edit during playback (§182-§183): EDIT_POLICY below, implemented by scheduler.edit(); STOP
// (§184): STOP_POLICY, scheduler.stop(); Escape (§185): resolveEscape(). docs/v31/timeline.md
// documents all three.

import {
  buildTimeline, planFromTimeline, STOP_LEAD_S, STOP_PAD_S, STOP_RAMP_S,
} from '../sequencer/compiler.js';
import {
  BLOCK_SCHEMA, DEFAULT_SEED, PROVISIONAL_SAMPLE_RATE, WAVEFORMS, normalizeModel,
} from '../sequencer/model.js';
import { LOOKAHEAD_S } from '../sequencer/editor.js';
import { SCHEDULE_LEAD_S, TOP_UP_EVERY_MS } from '../audio/scheduler.js';
import { NODE_REGISTRY } from './registry.js';
import {
  compileLaneEvents, laneParamDef, laneValueAt, scheduledValueAt,
} from './automation.js';
import {
  CONTIGUITY_TOLERANCE_S, MIN_LOOP_S, clipEnd, effectiveTarget, timelineEnd,
} from './timeline.js';

// ---------------------------------------------------------------- constants

/** Look-ahead of the timeline scheduler: the sequencer editor's LOOKAHEAD_S. */
export const TIMELINE_LOOKAHEAD_S = LOOKAHEAD_S;
/** Safe horizon: nothing is changed closer to now than the engine's SCHEDULE_LEAD_S. */
export const SAFE_HORIZON_S = SCHEDULE_LEAD_S;
/** Frames per Web Audio render quantum; STOP lands on a quantum boundary (stopTime). */
export const RENDER_QUANTUM = 128;
/** Guard against pathological loops: passes compiled per window at most. */
export const MAX_PASSES_PER_WINDOW = 4096;
const MIN_WAKE_MS = 50;

/** Edit-during-playback policy (§182-§183), as data; scheduler.edit() implements it. */
export const EDIT_POLICY = Object.freeze({
  horizon: 'now + SAFE_HORIZON_S, rounded up to a whole frame',
  parameter: 'live', // NODE_PARAM_SET: the runtime applies it now, click-free (§80)
  futureItem: 'reschedule', // starts at or after the horizon: cancelled, rebuilt from the model
  playingItem: Object.freeze({
    unchanged: 'keep',
    removed: 'release', // faded at the horizon (voice.stop / gate off)
    retargeted: 'release', // it would keep sounding into the wrong node
    shortened: 'retime-end', // compatible live edit: ends at the new end (still after horizon)
    eventLengthened: 'retime-end', // a gate's off event simply moves later
    other: 'keep-until-end', // payload, start or a longer pattern: the current event stays and
    //                          the edited clip plays from its next trigger (loop pass / play)
  }),
  newUnderPlayhead: 'next-trigger', // a clip now covering the horizon that never started
  automation: 'hold-and-continue', // exact value held at the horizon, new events after it
  loopChange: 're-anchor', // a new pass grid from the horizon; the position stays continuous
});

/** STOP policy (§184), as data; scheduler.stop() implements it. */
export const STOP_POLICY = Object.freeze({
  at: 'now + STOP_LEAD_S (at least 2 render quanta), rounded up to a render-quantum boundary',
  // voice.stop(at): the voice's output gain (a constant 1) held and faded over STOP_RAMP_S, its
  // schedules left untouched; sources stopped after the fade, automation cancelled once ended
  sounding: 'release',
  pending: 'cancel', // scheduled but not started: disposed, never heard
  futureScheduling: 'cancelled', // advance() returns nothing after stop
  automation: 'hold', // every lane held at its exact value at `at`
  model: 'unchanged', // STOP never dispatches an action
  playhead: 'return-to-play-start', // the position playback started from; RETURN goes to 0
});

/** Escape priority (§185): the first applicable entry wins. */
export const ESCAPE_PRIORITY = Object.freeze(['cancel-gesture', 'close-popup',
  'cancel-selection-mode', 'stop-audio']);

// ---------------------------------------------------------------- helpers

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const rateOf = (sr) => (finite(sr) && sr > 0 ? sr : PROVISIONAL_SAMPLE_RATE);

/** Smallest whole-frame time >= t. */
export function frameCeil(t, sampleRate) {
  const sr = rateOf(sampleRate);
  return Math.ceil(t * sr - 1e-6) / sr;
}

/** The safe horizon for an edit at `now`: frameCeil(now + SAFE_HORIZON_S). */
export function safeHorizon(now, sampleRate) {
  return frameCeil(now + SAFE_HORIZON_S, sampleRate);
}

/**
 * STOP time at `now`: the realtime voice.stop() default of compileSequence (STOP_LEAD_S, at least
 * two render quanta, rounded up to a render-quantum boundary), which is also the engine's
 * release time (AudioEngine._soon, hooks.soon, the same lead and boundary): the voices' fade and
 * the runtime's output fade start together, on frames not rendered yet, and no ramp starts
 * mid-quantum (Firefox anchors such a ramp at the quantum's edge). `now` is the context clock
 * the transport read; the result is a whole frame at every sample rate.
 */
export function stopTime(now, sampleRate) {
  const q = RENDER_QUANTUM / rateOf(sampleRate);
  return Math.ceil((now + Math.max(STOP_LEAD_S, 2 * q)) / q - 1e-9) * q;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- transport anchor

/**
 * The mapping between timeline positions and audio times for one playback.
 *   createAnchor(model, { baseTime, startPosition = 0, sampleRate, generation = 0 })
 * -> { sampleRate, baseFrame, baseTime, startPosition, loop: { start, end } | null, end,
 *      firstPassFrames, loopFrames, generation }
 * The loop applies when enabled, at least MIN_LOOP_S long and still ahead of startPosition.
 */
export function createAnchor(model, { baseTime = 0, startPosition = 0, sampleRate,
  generation = 0 } = {}) {
  const sr = rateOf(sampleRate);
  const baseFrame = Math.ceil(baseTime * sr - 1e-6);
  const l = model.timeline.loop;
  const loop = l.enabled && l.end - l.start >= MIN_LOOP_S && startPosition < l.end
    ? { start: l.start, end: l.end } : null;
  const end = timelineEnd(model);
  const firstEnd = loop ? loop.end : end;
  return {
    sampleRate: sr,
    baseFrame,
    baseTime: baseFrame / sr,
    startPosition,
    loop,
    end,
    firstPassFrames: Math.max(0, Math.round((firstEnd - startPosition) * sr)),
    loopFrames: loop ? Math.round((loop.end - loop.start) * sr) : 0,
    generation,
  };
}

/** Position range and first frame of pass k: { pass, posStart, posEnd, startFrame, endFrame }. */
export function passInfo(anchor, k) {
  const posStart = k === 0 ? anchor.startPosition : anchor.loop.start;
  const posEnd = anchor.loop ? anchor.loop.end : anchor.end;
  const startFrame = anchor.baseFrame + (k === 0 ? 0
    : anchor.firstPassFrames + (k - 1) * anchor.loopFrames);
  const endFrame = startFrame + (k === 0 ? anchor.firstPassFrames : anchor.loopFrames);
  return { pass: k, posStart, posEnd, startFrame, endFrame,
    startTime: startFrame / anchor.sampleRate, endTime: endFrame / anchor.sampleRate };
}

/** Audio time of a timeline position inside pass k (whole frames). */
export function audioTimeOf(anchor, k, position) {
  const p = passInfo(anchor, k);
  return (p.startFrame + Math.round((position - p.posStart) * anchor.sampleRate))
    / anchor.sampleRate;
}

/**
 * The playhead at audio time t (§94): { position, pass, playing } — before baseTime the head
 * waits at startPosition (playing false), after a non-looping end it returns null.
 */
export function positionAt(anchor, t) {
  const sr = anchor.sampleRate;
  const frames = t * sr - anchor.baseFrame;
  if (frames < 0) return { position: anchor.startPosition, pass: 0, playing: false };
  if (frames < anchor.firstPassFrames) {
    return { position: anchor.startPosition + frames / sr, pass: 0, playing: true };
  }
  if (!anchor.loop || anchor.loopFrames <= 0) return null;
  const rest = frames - anchor.firstPassFrames;
  const k = Math.floor(rest / anchor.loopFrames);
  return { position: anchor.loop.start + (rest - k * anchor.loopFrames) / sr, pass: k + 1,
    playing: true };
}

/** Audio time at which a non-looping playback ends (Infinity while a loop is active). */
export function anchorEndTime(anchor) {
  return anchor.loop ? Infinity : (anchor.baseFrame + anchor.firstPassFrames) / anchor.sampleRate;
}

/** Passes whose audio range intersects [from, until). */
export function passesInWindow(anchor, from, until) {
  const out = [];
  if (!(until > from)) return out;
  const first = passInfo(anchor, 0);
  if (first.endFrame > first.startFrame && first.startTime < until && first.endTime > from) {
    out.push(0);
  }
  if (!anchor.loop || anchor.loopFrames <= 0) return out;
  const sr = anchor.sampleRate;
  const fromFrames = Math.max(0, from * sr - anchor.baseFrame - anchor.firstPassFrames);
  let k = 1 + Math.floor(fromFrames / anchor.loopFrames);
  for (; out.length < MAX_PASSES_PER_WINDOW; k++) {
    const p = passInfo(anchor, k);
    if (p.startTime >= until) break;
    if (p.endTime > from) out.push(k);
  }
  return out;
}

// ---------------------------------------------------------------- per-clip compilation

/**
 * A pattern payload cut to a shorter duration: the sweep / chirp end frequency becomes the one
 * the curve reaches at the cut (log or linear), so the truncated clip sounds exactly like the
 * first part of the full one. Other block types lay their steps from the block start already.
 */
export function truncatePatternPayload(payload, fullS, cutS) {
  const p = { ...payload.params };
  const k = fullS > 0 ? Math.min(1, cutS / fullS) : 1;
  const curve = payload.blockType === 'sweep' ? p.curve
    : payload.blockType === 'chirp' ? p.ramp : null;
  if (curve && k < 1) {
    const log = curve === 'log' || curve === 'exponential';
    p.end = log ? p.start * Math.pow(p.end / p.start, k) : p.start + (p.end - p.start) * k;
  }
  return { ...payload, params: p };
}

function nodeOf(model, id) {
  return id ? model.graph.nodes.find((n) => n.id === id) || null : null;
}

/** The one-block V2 sequence that plays a pattern clip (the sequencer's own model). */
export function clipSequence(model, clip, { durationS = clip.duration, sampleRate } = {}) {
  const node = nodeOf(model, effectiveTarget(model, clip));
  const waveform = node && WAVEFORMS.includes(node.params.waveform) ? node.params.waveform
    : 'sine';
  const payload = durationS < clip.duration - CONTIGUITY_TOLERANCE_S
    ? truncatePatternPayload(clip.payload, clip.duration, durationS) : clip.payload;
  return normalizeModel({ version: 1, tempoBpm: model.transport.tempo, loop: false, waveform,
    seed: DEFAULT_SEED, blocks: [{ id: clip.id, type: payload.blockType,
      durationMs: durationS * 1000, beats: null, params: payload.params }] },
  { sampleRate: rateOf(sampleRate) });
}

function clipSnapshot(model, clip) {
  return { start: clip.start, duration: clip.duration, trackId: clip.trackId, kind: clip.kind,
    target: effectiveTarget(model, clip), payload: clip.payload };
}

/**
 * Everything pass k of the timeline schedules: { items, automation, warnings }.
 * Items (sorted by start time, then model order):
 *   pattern      { key, type, clipId, trackId, target, pass, position, startTime, endTime,
 *                  duration, truncated, sequence, events, level, clip }
 *                events = the sequencer plan with absolute `time` (= startTime + t)
 *   event        { ..., action: 'gate' | 'trigger' }
 *   measurement  { ..., action } (seconds only; never musical)
 * Automation: [{ key, laneId, target, pass, events }] (automation.js compileLaneEvents).
 */
export function compilePass(model, anchor, k, { registry = NODE_REGISTRY } = {}) {
  const info = passInfo(anchor, k);
  const sr = anchor.sampleRate;
  const items = [];
  const warnings = [];
  const looping = !!anchor.loop;
  const gen = anchor.generation;
  model.timeline.clips.forEach((clip, order) => {
    if (clip.start < info.posStart - CONTIGUITY_TOLERANCE_S
      || clip.start >= info.posEnd - CONTIGUITY_TOLERANCE_S) return;
    let duration = clip.duration;
    let truncated = false;
    if (looping && clipEnd(clip) > info.posEnd + CONTIGUITY_TOLERANCE_S) {
      duration = info.posEnd - clip.start;
      truncated = true;
    }
    let min = CONTIGUITY_TOLERANCE_S;
    if (clip.kind === 'pattern') {
      const s = BLOCK_SCHEMA[clip.payload.blockType];
      min = s ? s.durationMs.min / 1000 : min;
    }
    if (duration < min - CONTIGUITY_TOLERANCE_S) {
      warnings.push(`Clip ${clip.id} is cut by the loop end to ${duration.toFixed(4)} s, shorter `
        + 'than its minimum; it does not play in loop passes.');
      return;
    }
    const target = effectiveTarget(model, clip);
    const startTime = audioTimeOf(anchor, k, clip.start);
    const base = { key: `${clip.id}#${gen}.${k}`, clipId: clip.id, trackId: clip.trackId, target,
      pass: k, position: clip.start, startTime, truncated, order,
      clip: clipSnapshot(model, clip) };
    if (clip.kind === 'pattern') {
      const { model: sequence, issues } = clipSequence(model, clip, { durationS: duration,
        sampleRate: sr });
      const tl = buildTimeline(sequence, { sampleRate: sr });
      const events = planFromTimeline(tl).map((e) => ({ ...e, time: startTime + e.t }));
      const node = nodeOf(model, target);
      warnings.push(...issues.map((i) => `Clip ${clip.id}: ${i}`));
      items.push({ ...base, type: 'pattern', duration: tl.duration,
        endTime: startTime + tl.duration, sequence, events,
        level: node && finite(node.params.level) ? node.params.level : 1 });
    } else {
      const endTime = audioTimeOf(anchor, k, clip.start + duration);
      const action = clip.kind === 'event' ? (clip.payload.action || 'gate')
        : clip.payload.action;
      items.push({ ...base, type: clip.kind, action, duration: endTime - startTime, endTime });
    }
  });
  if (looping && k > 0 && model.timeline.clips.some((c) => c.kind === 'measurement'
    && c.start >= info.posStart - CONTIGUITY_TOLERANCE_S && c.start < info.posEnd)) {
    warnings.push('Measurement clips inside the loop region repeat on every pass.');
  }
  items.sort((a, b) => a.startTime - b.startTime || a.order - b.order);
  const automation = model.timeline.automation.map((lane) => ({
    key: `${lane.id}#${gen}.${k}`,
    laneId: lane.id,
    target: { ...lane.target },
    pass: k,
    events: compileLaneEvents(lane.points, { paramDef: laneParamDef(model, lane, registry),
      sampleRate: sr, posStart: info.posStart, posEnd: looping ? info.posEnd : Infinity,
      toAudio: (pos) => audioTimeOf(anchor, k, pos) }).map((e, i, all) => ({ ...e, pass: k,
      scheduleAt: e.method === 'setValueAtTime' || i === 0 ? e.time : all[i - 1].time })),
  }));
  return { pass: k, info, items, automation, warnings };
}

const dueIn = (from, until) => (e) => e.scheduleAt >= from && e.scheduleAt < until;

/**
 * Items starting in [from, until) and automation events due in [from, until) (scheduleAt), over
 * every pass that intersects the window: { items, automation: [{ laneId, target, events }],
 * warnings }. opts.laneFilter(event) replaces the automation window test.
 */
export function compileWindow(model, anchor, from, until, opts = {}) {
  const laneFilter = opts.laneFilter || dueIn(from, until);
  const items = [];
  const lanes = new Map();
  const warnings = [];
  for (const k of passesInWindow(anchor, from, until)) {
    const pass = opts.passCache ? opts.passCache(k) : compilePass(model, anchor, k, opts);
    for (const it of pass.items) {
      if (it.startTime >= from && it.startTime < until) items.push(it);
    }
    for (const a of pass.automation) {
      const evs = a.events.filter(laneFilter);
      if (!evs.length) continue;
      if (!lanes.has(a.laneId)) lanes.set(a.laneId, { laneId: a.laneId, target: a.target,
        events: [] });
      lanes.get(a.laneId).events.push(...evs);
    }
    warnings.push(...pass.warnings);
  }
  return { items, automation: [...lanes.values()], warnings: [...new Set(warnings)] };
}

/**
 * Compile a whole playback (§180, §212): every pass of a non-looping timeline, or the first
 * `passes` passes of a looping one.
 *   compileTimeline(model, { sampleRate, baseTime = 0, startPosition = 0, passes = 1 })
 * -> { anchor, items, automation, warnings, endTime }
 */
export function compileTimeline(model, opts = {}) {
  const anchor = createAnchor(model, opts);
  const n = anchor.loop ? Math.max(1, Math.min(MAX_PASSES_PER_WINDOW, opts.passes || 1)) : 1;
  const items = [];
  const lanes = new Map();
  const warnings = [];
  for (let k = 0; k < n; k++) {
    const pass = compilePass(model, anchor, k, opts);
    items.push(...pass.items);
    for (const a of pass.automation) {
      if (!lanes.has(a.laneId)) lanes.set(a.laneId, { laneId: a.laneId, target: a.target,
        events: [] });
      lanes.get(a.laneId).events.push(...a.events);
    }
    warnings.push(...pass.warnings);
  }
  return { anchor, items, automation: [...lanes.values()].filter((a) => a.events.length),
    warnings: [...new Set(warnings)],
    endTime: anchor.loop ? passInfo(anchor, n - 1).endTime : anchorEndTime(anchor) };
}

// ---------------------------------------------------------------- holding automation

/**
 * Events that hold a param at `at` given what was scheduled (`scheduled`, compiled events in
 * order): after cancelScheduledValues(at), a ramp that was in progress across `at` is re-ended
 * at `at` with its exact value (same curve up to `at`), then the value is pinned. Returns
 * { value, events }; value is null when nothing was scheduled.
 */
export function holdEvents(scheduled, at, defaultValue = null) {
  const value = scheduledValueAt(scheduled, at, defaultValue);
  if (value === null) return { value, events: [] };
  let next = null;
  for (const e of scheduled) if (e.time >= at && (!next || e.time < next.time)) next = e;
  const events = [];
  if (next && next.method === 'linearRampToValueAtTime') {
    events.push({ method: 'linearRampToValueAtTime', value, time: at, hold: true });
  } else if (next && next.method === 'exponentialRampToValueAtTime' && value > 0) {
    events.push({ method: 'exponentialRampToValueAtTime', value, time: at, hold: true });
  }
  events.push({ method: 'setValueAtTime', value, time: at, hold: true });
  return { value, events };
}

// ---------------------------------------------------------------- scheduler

/**
 * The transport's scheduling state machine (§93-§95, §180-§184). No timers: the runtime calls
 *   advance(now)      -> { from, until, items, automation, skipped, warnings, done }
 *   nextWakeMs(now)   -> ms until the next advance (null when done or stopped)
 *   edit(model, now)  -> rebuild plan (EDIT_POLICY)
 *   stop(now)         -> stop plan (STOP_POLICY)
 *   playhead(now)     -> positionAt(anchor, now) (§94)
 *   getState()        -> { anchor, scheduledUntil, active, stopped, decisions }
 * opts: { sampleRate, baseTime, startPosition = 0, lookAheadS = TIMELINE_LOOKAHEAD_S, registry }
 */
export function createTimelineScheduler(initialModel, opts = {}) {
  const sr = rateOf(opts.sampleRate);
  const registry = opts.registry || NODE_REGISTRY;
  const lookAheadS = finite(opts.lookAheadS) && opts.lookAheadS > 0 ? opts.lookAheadS
    : TIMELINE_LOOKAHEAD_S;
  const playStart = finite(opts.startPosition) ? opts.startPosition : 0;
  let model = initialModel;
  let anchor = createAnchor(model, { baseTime: opts.baseTime || 0, startPosition: playStart,
    sampleRate: sr });
  let scheduledUntil = anchor.baseTime;
  let stopped = false;
  const active = new Map(); // key -> item (scheduled, not yet ended)
  const laneEvents = new Map(); // laneId -> scheduled events (in scheduling order)
  const decisions = [];
  let cache = new Map();

  const passCache = (k) => {
    if (!cache.has(k)) cache.set(k, compilePass(model, anchor, k, { registry }));
    return cache.get(k);
  };
  const prune = (now) => {
    for (const [key, it] of active) if (it.endTime + STOP_PAD_S < now) active.delete(key);
    for (const [id, evs] of laneEvents) {
      // Keep the last event before now (the value base) and everything after it.
      let i = 0;
      while (i + 1 < evs.length && evs[i + 1].time <= now) i++;
      if (i > 0) laneEvents.set(id, evs.slice(i));
    }
  };
  const record = (laneId, events) => {
    if (!laneEvents.has(laneId)) laneEvents.set(laneId, []);
    laneEvents.get(laneId).push(...events);
  };
  const done = () => stopped || (!anchor.loop && scheduledUntil > anchorEndTime(anchor));

  function advance(now) {
    if (done()) {
      return { from: scheduledUntil, until: scheduledUntil, items: [], automation: [],
        skipped: [], warnings: [], done: true };
    }
    const from = scheduledUntil;
    const until = Math.max(from, now + lookAheadS);
    const w = compileWindow(model, anchor, from, until, { passCache });
    const late = now + SAFE_HORIZON_S - 1e-9;
    const items = [];
    const skipped = [];
    for (const it of w.items) {
      if (it.startTime < late) skipped.push(it);
      else {
        items.push(it);
        active.set(it.key, it);
      }
    }
    const automation = w.automation.map((a) => {
      let events = a.events;
      if (events.some((e) => e.scheduleAt < late)) {
        const at = frameCeil(now + SAFE_HORIZON_S, sr);
        const prior = [...(laneEvents.get(a.laneId) || []), ...events.filter((e) => e.time < at)];
        const v = scheduledValueAt(prior, at, null);
        events = [...(v === null ? [] : [{ method: 'setValueAtTime', value: v, time: at,
          position: null, pointId: null, reanchored: true }]),
        ...events.filter((e) => e.time >= at)];
      }
      record(a.laneId, events);
      return { laneId: a.laneId, target: a.target, events };
    });
    scheduledUntil = until;
    prune(now);
    return { from, until, items, automation, skipped, warnings: w.warnings, done: done() };
  }

  function nextWakeMs(now) {
    if (done()) return null;
    const ms = (scheduledUntil - lookAheadS / 2 - now) * 1000;
    return Math.round(Math.min(TOP_UP_EVERY_MS, Math.max(MIN_WAKE_MS, ms)));
  }

  /** Classify a scheduled item that sounds across the horizon against the edited model. */
  function decideCurrent(it, next, horizon) {
    const clip = next.timeline.clips.find((c) => c.id === it.clipId);
    if (!clip) return { decision: 'release', at: horizon };
    const snap = clipSnapshot(next, clip);
    if (snap.target !== it.clip.target || snap.kind !== it.clip.kind) {
      return { decision: 'release', at: horizon };
    }
    if (sameJson(snap, it.clip)) return { decision: 'keep' };
    const onlyDuration = snap.start === it.clip.start && snap.trackId === it.clip.trackId
      && sameJson(snap.payload, it.clip.payload);
    if (onlyDuration) {
      const newEnd = it.startTime + Math.round(snap.duration * sr) / sr;
      const shorter = snap.duration < it.clip.duration;
      if (shorter && newEnd <= horizon) return { decision: 'release', at: horizon };
      if (shorter || it.type !== 'pattern') {
        return { decision: 'retime-end', at: Math.max(horizon, newEnd) };
      }
    }
    return { decision: 'keep-until-end' };
  }

  /**
   * Rebuild the schedule from the safe horizon after the model changed (§182-§183). Returns
   * { horizon, keep, release: [{ key, at }], retime: [{ key, at }], cancel: [key], schedule:
   * [item], automation: [{ laneId, target, cancelFrom, holdValue, events }], decisions,
   * reanchored }.
   */
  function edit(nextModel, now) {
    const horizon = safeHorizon(now, sr);
    const plan = { horizon, keep: [], release: [], retime: [], cancel: [], schedule: [],
      automation: [], decisions: [], reanchored: false };
    if (stopped) return plan;
    const prevModel = model;
    const pos = positionAt(anchor, horizon);
    const l0 = prevModel.timeline.loop;
    const l1 = nextModel.timeline.loop;
    model = nextModel;
    if (!sameJson(l0, l1) && pos) {
      anchor = createAnchor(model, { baseTime: horizon, startPosition: pos.position,
        sampleRate: sr, generation: anchor.generation + 1 });
      plan.reanchored = true;
    } else {
      anchor = { ...createAnchor(model, { baseTime: anchor.baseTime,
        startPosition: anchor.startPosition, sampleRate: sr, generation: anchor.generation }),
      baseFrame: anchor.baseFrame, baseTime: anchor.baseTime };
    }
    cache = new Map();
    // Scheduled items.
    const kept = new Set();
    for (const [key, it] of [...active]) {
      if (it.startTime >= horizon) {
        plan.cancel.push(key);
        active.delete(key);
        plan.decisions.push({ key, clipId: it.clipId, decision: 'cancel' });
        continue;
      }
      if (it.endTime <= horizon) {
        active.delete(key);
        continue;
      }
      const d = decideCurrent(it, model, horizon);
      plan.decisions.push({ key, clipId: it.clipId, ...d });
      if (d.decision === 'keep' || d.decision === 'keep-until-end') {
        plan.keep.push(key);
        kept.add(it.clipId);
      } else if (d.decision === 'retime-end') {
        plan.retime.push({ key, at: d.at });
        active.set(key, { ...it, endTime: d.at });
        kept.add(it.clipId);
      } else {
        plan.release.push({ key, at: d.at });
        active.set(key, { ...it, endTime: Math.min(it.endTime, d.at + STOP_RAMP_S) });
      }
    }
    // Rebuild [horizon, scheduledUntil) from the new model.
    if (scheduledUntil > horizon) {
      const w = compileWindow(model, anchor, Math.min(horizon, scheduledUntil), scheduledUntil,
        { passCache });
      for (const it of w.items) {
        if (it.startTime >= horizon) {
          plan.schedule.push(it);
          active.set(it.key, it);
        }
      }
      // Clips that now cover the horizon but never started wait for their next trigger.
      for (const k of passesInWindow(anchor, horizon, horizon + 1e-9)) {
        for (const it of passCache(k).items) {
          if (it.startTime < horizon && it.endTime > horizon && !kept.has(it.clipId)) {
            plan.decisions.push({ key: it.key, clipId: it.clipId, decision: 'next-trigger' });
          }
        }
      }
    }
    // Automation: hold the exact value at the horizon, continue with the new lane's events.
    const laneIds = new Set([...prevModel.timeline.automation.map((l) => l.id),
      ...model.timeline.automation.map((l) => l.id)]);
    for (const laneId of laneIds) {
      const prevLane = prevModel.timeline.automation.find((l) => l.id === laneId);
      const lane = model.timeline.automation.find((l) => l.id === laneId);
      if (prevLane && lane && sameJson(prevLane, lane) && !plan.reanchored) continue;
      const scheduled = laneEvents.get(laneId) || [];
      const target = (lane || prevLane).target;
      let fallback = null;
      if (!scheduled.length) {
        const node = nodeOf(model, target.node);
        fallback = node && finite(node.params[target.param]) ? node.params[target.param]
          : lane && pos ? laneValueAt(lane.points, pos.position) : null;
      }
      const held = holdEvents(scheduled, horizon, fallback);
      let events = [...held.events];
      if (lane && scheduledUntil > horizon) {
        // Every new event after the horizon whose segment is due before scheduledUntil — a ramp
        // that began before the horizon now starts from the held value.
        const w = compileWindow({ ...model, timeline: { ...model.timeline, clips: [],
          automation: [lane] } }, anchor, horizon, scheduledUntil, { registry,
          laneFilter: (e) => e.scheduleAt < scheduledUntil && (e.time > horizon
            || (e.time === horizon && e.method !== 'setValueAtTime')) });
        events = events.concat(w.automation.length ? w.automation[0].events : []);
      }
      laneEvents.set(laneId, scheduled.filter((e) => e.time < horizon).concat(events));
      plan.automation.push({ laneId, target: { ...target }, cancelFrom: horizon,
        holdValue: held.value, events, removed: !lane });
    }
    decisions.push(...plan.decisions);
    return plan;
  }

  /** STOP (§184): see STOP_POLICY. Returns the plan; the model is never touched. */
  function stop(now) {
    const at = stopTime(now, sr);
    const plan = { at, fadeS: STOP_RAMP_S, releasedBy: at + STOP_RAMP_S + STOP_PAD_S,
      release: [], cancel: [], automation: [], model: STOP_POLICY.model,
      playhead: { mode: STOP_POLICY.playhead, position: playStart } };
    if (stopped) return plan;
    stopped = true;
    for (const [key, it] of active) {
      if (it.startTime > at) plan.cancel.push(key);
      else if (it.endTime > at) plan.release.push({ key, at });
    }
    active.clear();
    for (const [laneId, scheduled] of laneEvents) {
      const lane = model.timeline.automation.find((l) => l.id === laneId);
      const held = holdEvents(scheduled, at);
      plan.automation.push({ laneId, target: lane ? { ...lane.target } : null, cancelFrom: at,
        holdValue: held.value, events: held.events });
    }
    laneEvents.clear();
    return plan;
  }

  return Object.freeze({
    advance,
    nextWakeMs,
    edit,
    stop,
    playhead: (now) => positionAt(anchor, now),
    getState: () => ({ anchor, scheduledUntil, active: [...active.values()], stopped,
      decisions: [...decisions], model }),
  });
}

// ---------------------------------------------------------------- Escape (§185)

/**
 * What Escape does now: the first applicable of ESCAPE_PRIORITY, or null.
 * state: { gesture, popup, selectionMode, audioActive } (booleans).
 */
export function resolveEscape(state = {}) {
  if (state.gesture) return 'cancel-gesture';
  if (state.popup) return 'close-popup';
  if (state.selectionMode) return 'cancel-selection-mode';
  if (state.audioActive) return 'stop-audio';
  return null;
}
