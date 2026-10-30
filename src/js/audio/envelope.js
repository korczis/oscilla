// ADSR envelope maths and scheduling on an AudioParam (normally a voice's dedicated envelope
// GainNode, as in V1's `env` node).
//
// Shape: linear attack from the floor to the peak, exponential decay to the sustain level,
// exponential release to the floor. Only setValueAtTime / linearRampToValueAtTime /
// exponentialRampToValueAtTime are used, because they have closed forms: the module can then
// compute the param's value at any time from the recorded schedule (valueAtTime), which is what
// the graph draws and what the Firefox release path needs.
//
// Release must start from the value the envelope has at that instant. cancelAndHoldAtTime does
// that while a ramp is in progress, but inserts nothing when t is after the last event, so the
// module always anchors the hold with setValueAtTime(v, t). Firefox lacks cancelAndHoldAtTime.
// There, cancelScheduledValues alone would drop an in-progress ramp and jump back to the
// previous event's value (a click), so the emulation
// computes the current value from the recorded schedule and re-ends the in-progress segment at
// the release time with that value — same curve up to t, then the release ramp.
//
// Rules: no ramp is ever shorter than MIN_SEGMENT_S; no exponential ramp starts or ends at 0
// (ENVELOPE_FLOOR = 1e-4, −80 dB); the param must be driven only through this module so the
// recorded schedule matches the real one.
//
// V1 integration: the module keeps its OWN event log (a WeakMap keyed by the param object), so
// valueAtTime() and the Firefox hold need nothing from the param. The param may be a real
// AudioParam or a param-like object such as V1's _loggedParam wrapper. Only
// setValueAtTime, linearRampToValueAtTime and exponentialRampToValueAtTime are required;
// cancelScheduledValues and cancelAndHoldAtTime are feature-detected and used when present.
// .value is never assigned (it is only read as a last resort when no log exists). When the
// param lacks cancelScheduledValues the hold cannot remove future events; with a fresh
// per-voice envelope node (V1's model) none are pending after the decay, so the hold is exact.
//
// Live sustain (C008): retargetSustain moves a held note to a new sustain level (1 for an
// envelope switched off) on the same recorded schedule: in sustain an exponential glide of at
// least SUSTAIN_GLIDE_S from the value at t, in the decay a decay that ends at the new level, in
// the attack the attack untouched and then that decay; a release scheduled ahead (a finite note)
// is kept and starts from the new level, also one held at the floor (sustain 0, no ramp).
// Removing the old future events needs a cancel: the param's own cancelScheduledValues, or the
// caller's (the engine's tracked envelope wrapper has none, so the engine passes one that also
// keeps its own log exact). The level never exceeds 1.

export const ENVELOPE_FLOOR = 1e-4;
export const MIN_SEGMENT_S = 0.001;
export const DEFAULT_ADSR = Object.freeze({ a: 0.01, d: 0.1, s: 0.7, r: 0.2 });
/** Shortest glide of a sustain change on a held note (retargetSustain): never a step. */
export const SUSTAIN_GLIDE_S = 0.02;

const schedules = new WeakMap(); // AudioParam → recorded events

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp an ADSR to playable values: a, d, r ≥ MIN_SEGMENT_S seconds, s in [0, 1]. */
export function normalizeAdsr(adsr = {}) {
  return {
    a: Math.max(MIN_SEGMENT_S, num(adsr.a, DEFAULT_ADSR.a)),
    d: Math.max(MIN_SEGMENT_S, num(adsr.d, DEFAULT_ADSR.d)),
    s: Math.min(1, Math.max(0, num(adsr.s, DEFAULT_ADSR.s))),
    r: Math.max(MIN_SEGMENT_S, num(adsr.r, DEFAULT_ADSR.r)),
  };
}

/**
 * Events that applyAdsr schedules, as plain data: [{ kind: 'set' | 'linear' | 'exp', time,
 * value }]. startValue defaults to the floor.
 */
export function adsrEvents(t0, adsr, peak = 1, { floor = ENVELOPE_FLOOR, startValue } = {}) {
  const e = normalizeAdsr(adsr);
  const p = Math.max(floor, peak);
  const sustain = Math.max(floor, e.s * p);
  const start = Math.max(floor, startValue != null ? startValue : floor);
  return [
    { kind: 'set', time: t0, value: start },
    { kind: 'linear', time: t0 + e.a, value: p },
    { kind: 'exp', time: t0 + e.a + e.d, value: sustain },
  ];
}

/**
 * Value of an automation timeline at time t, following the Web Audio automation rules for
 * setValueAtTime, linearRampToValueAtTime and exponentialRampToValueAtTime. Events must be
 * sorted by time. `initial` is the value before the first event.
 */
export function valueAtTime(events, t, initial = ENVELOPE_FLOOR) {
  let prev = null;
  let i = 0;
  for (; i < events.length && events[i].time <= t; i++) prev = events[i];
  const next = i < events.length ? events[i] : null;
  if (next && (next.kind === 'linear' || next.kind === 'exp')) {
    const t0 = prev ? prev.time : t;
    const v0 = prev ? prev.value : initial;
    const span = next.time - t0;
    if (!(span > 0)) return v0;
    const k = (t - t0) / span;
    if (next.kind === 'linear') return v0 + (next.value - v0) * k;
    if (v0 === 0 || v0 * next.value <= 0) return v0; // spec: exponential undefined → hold V0
    return v0 * (next.value / v0) ** k;
  }
  return prev ? prev.value : initial;
}

/**
 * The timeline after holding at t (what holdAt schedules): events before t, then an event at t
 * with the held value that continues the in-progress segment's curve.
 */
export function holdEvents(events, t, initial = ENVELOPE_FLOOR) {
  const v = valueAtTime(events, t, initial);
  const kept = events.filter((e) => e.time < t);
  const atT = events.filter((e) => e.time === t);
  if (atT.length) {
    // Events exactly at t already define the value there; keep them as they are.
    for (const e of atT) kept.push({ ...e });
    return { events: kept, value: v };
  }
  const next = events.find((e) => e.time > t);
  const kind = next && (next.kind === 'linear' || next.kind === 'exp') ? next.kind : 'set';
  kept.push({ kind, time: t, value: v });
  return { events: kept, value: v };
}

/** The timeline after releaseAt(t, r): hold at t, then an exponential ramp to the floor. */
export function releaseEvents(events, t, r, { floor = ENVELOPE_FLOOR, initial = floor } = {}) {
  const held = holdEvents(events, t, initial);
  const rel = Math.max(MIN_SEGMENT_S, num(r, DEFAULT_ADSR.r));
  if (held.value > floor) held.events.push({ kind: 'exp', time: t + rel, value: floor });
  return { events: held.events, value: held.value, endTime: t + rel };
}

function cancelFrom(param, t) {
  if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(t);
}

function apply(param, e) {
  if (e.kind === 'set') param.setValueAtTime(e.value, e.time);
  else if (e.kind === 'linear') param.linearRampToValueAtTime(e.value, e.time);
  else param.exponentialRampToValueAtTime(e.value, e.time);
}

/** Copy of the schedule recorded for a param (empty when none). */
export function getSchedule(param) {
  return (schedules.get(param) || []).map((e) => ({ ...e }));
}

/** Drop the recorded schedule (call when the param's node is discarded or reused). */
export function forgetParam(param) {
  schedules.delete(param);
}

/**
 * holdAt(param, t, { native }) → value held at t
 * Freezes the param at time t without a step: cancelAndHoldAtTime when available (and
 * native !== false), otherwise the emulation described at the top of this file. Without a
 * recorded schedule the emulation can only hold param.value (the last rendered value).
 */
export function holdAt(param, t, { native = true, floor = ENVELOPE_FLOOR } = {}) {
  const log = schedules.get(param);
  const base = log && log.length ? log : null;
  const initial = base ? floor : num(param.value, floor);
  const held = base
    ? holdEvents(base, t, initial)
    : { events: [{ kind: 'set', time: t, value: initial }], value: initial };
  if (native && typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
    // cancelAndHoldAtTime inserts no event when t lies after the last event (the sustain
    // phase): a following ramp would then start at the decay end, not at t. Anchor it.
    param.setValueAtTime(held.value, t);
  } else {
    cancelFrom(param, t);
    for (const e of held.events) if (e.time >= t) apply(param, e);
  }
  schedules.set(param, held.events);
  return held.value;
}

/**
 * applyAdsr(param, t0, adsr, peak = 1, { retrigger = false, native, floor }) →
 *   { start, attackEnd, decayEnd, sustainLevel, peak }
 * Schedules the attack and decay; the sustain holds until releaseAt. A fresh voice starts from
 * the floor; for a param this module has not seen before, the floor is also pinned from time 0
 * (a fresh GainNode would otherwise play at its default 1.0 until t0). retrigger: true starts
 * the attack from the value the param has at t0 (held without a step) — use it when
 * re-attacking a gain that may still be sounding.
 */
export function applyAdsr(param, t0, adsr, peak = 1, options = {}) {
  const floor = options.floor || ENVELOPE_FLOOR;
  let startValue = floor;
  if (options.retrigger && schedules.has(param)) {
    startValue = holdAt(param, t0, options);
  } else {
    cancelFrom(param, t0);
  }
  const ev = adsrEvents(t0, adsr, peak, { floor, startValue });
  let kept = (schedules.get(param) || []).filter((e) => e.time < t0);
  if (!schedules.has(param) && t0 > 0) {
    // A fresh GainNode sits at its default 1.0 until the first event: pin the floor from time 0
    // (a past event, so it applies immediately) so nothing sounds before the attack.
    param.setValueAtTime(floor, 0);
    kept = [{ kind: 'set', time: 0, value: floor }];
  }
  // A retrigger already holds at t0; re-setting the same value there is harmless.
  for (const e of ev) apply(param, e);
  schedules.set(param, kept.concat(ev));
  return {
    start: t0,
    attackEnd: ev[1].time,
    decayEnd: ev[2].time,
    sustainLevel: ev[2].value,
    peak: ev[1].value,
  };
}

/**
 * releaseAt(param, t, r, { native, floor }) → { value, endTime }
 * Holds the current value at t (see holdAt) and ramps exponentially to the floor by t + r.
 * Works for t = ctx.currentTime (note-off now) and for future times (scheduled note length).
 * Stop the voice's sources at or after endTime.
 */
export function releaseAt(param, t, r, options = {}) {
  const floor = options.floor || ENVELOPE_FLOOR;
  const value = holdAt(param, t, options);
  const rel = Math.max(MIN_SEGMENT_S, num(r, DEFAULT_ADSR.r));
  const log = schedules.get(param);
  if (value > floor) {
    param.exponentialRampToValueAtTime(floor, t + rel);
    log.push({ kind: 'exp', time: t + rel, value: floor });
  }
  return { value, endTime: t + rel };
}

const same = (x, y) => x.kind === y.kind && x.time === y.time && x.value === y.value;

/**
 * The release scheduled ahead in `events` when the note ends at releaseEnd (finite), as
 * { at, end, tail }: releaseAt's hold and its ramp to the floor are the last two events (tail
 * 2), or, when the held value was the floor (a sustain of 0, where releaseAt adds no ramp),
 * the hold alone, a 'set' at the floor before releaseEnd (tail 1). null when the note is open
 * (releaseEnd not finite); false when the schedule does not end with a release there.
 */
function scheduledRelease(events, releaseEnd, floor) {
  if (!Number.isFinite(releaseEnd)) return null;
  const n = events.length;
  const last = events[n - 1];
  if (n >= 2 && last.kind === 'set' && last.value <= floor && last.time < releaseEnd) {
    return { at: last.time, end: releaseEnd, tail: 1 };
  }
  if (n < 2 || last.kind !== 'exp' || last.value > floor
    || Math.abs(last.time - releaseEnd) > 1e-9) return false;
  return { at: events[n - 2].time, end: last.time, tail: 2 };
}

/**
 * sustainSteadyFrom(events, { releaseEnd }) → seconds
 * When the envelope holds a constant level: the end of its last attack, decay or glide (the
 * scheduled release excluded). -Infinity for a schedule with no ramp, NaN when releaseEnd is
 * given and the schedule does not end with a release there.
 */
export function sustainSteadyFrom(events, { releaseEnd = Infinity, floor = ENVELOPE_FLOOR } = {}) {
  const release = scheduledRelease(events, releaseEnd, floor);
  if (release === false) return NaN;
  const body = release ? events.slice(0, -release.tail) : events;
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i].kind !== 'set') return body[i].time;
  }
  return -Infinity;
}

/**
 * retargetEvents(events, t, s, { peak = 1, glideS, releaseEnd, floor }) →
 *   { events, value, target, keep } | null
 * The timeline after retargetSustain(param, t, s): `keep` leading events of the input are
 * unchanged, the rest follow from the new sustain level target = min(1, max(floor, s · peak))
 * (see the header). null when there is nothing to retarget: no schedule, a release that has
 * already begun at t, or a releaseEnd the schedule does not end at.
 */
export function retargetEvents(events, t, s, options = {}) {
  const floor = options.floor || ENVELOPE_FLOOR;
  if (!events || !events.length) return null;
  const peak = Math.min(1, Math.max(floor, num(options.peak, 1)));
  const glide = Math.max(MIN_SEGMENT_S, num(options.glideS, SUSTAIN_GLIDE_S));
  const target = Math.min(1, Math.max(floor, Math.min(1, Math.max(0, num(s, 1))) * peak));
  const release = scheduledRelease(events, options.releaseEnd, floor);
  if (release === false || (release && release.at <= t)) return null;
  const body = release ? events.slice(0, -release.tail) : events;
  const value = valueAtTime(body, t, floor);
  let lin = -1;
  for (let i = body.length - 1; i >= 0; i--) if (body[i].kind === 'linear') { lin = i; break; }
  const last = body[body.length - 1];
  let out;
  if (lin >= 0 && t < body[lin].time) {
    // In the attack: it runs to its peak unchanged, then a decay ends on the new level when the
    // old one would have (one MIN_SEGMENT_S at least).
    const attackEnd = body[lin].time;
    const decayEnd = lin + 1 < body.length ? body[lin + 1].time : attackEnd + glide;
    out = body.slice(0, lin + 1).map((e) => ({ ...e }));
    out.push({ kind: 'exp', time: Math.max(decayEnd, attackEnd + MIN_SEGMENT_S), value: target });
  } else if (last.kind !== 'set' && t < last.time) {
    // In the decay (or an earlier glide): re-ended at t on its own curve, then a ramp from there
    // to the new level that ends when the old one would have, SUSTAIN_GLIDE_S at least.
    const now = body.find((e) => e.time > t);
    out = body.filter((e) => e.time < t).map((e) => ({ ...e }));
    out.push({ kind: now.kind, time: t, value });
    out.push({ kind: 'exp', time: Math.max(last.time, t + glide), value: target });
  } else {
    // In the sustain: anchored at its value at t, then the glide.
    out = body.filter((e) => e.time <= t).map((e) => ({ ...e }));
    out.push({ kind: 'set', time: t, value });
    out.push({ kind: 'exp', time: t + glide, value: target });
  }
  if (release) out = releaseEvents(out, release.at, release.end - release.at, { floor }).events;
  let keep = 0;
  while (keep < events.length && keep < out.length && same(events[keep], out[keep])) keep++;
  return { events: out, value, target, keep };
}

/**
 * retargetSustain(param, t, s, { cancel, peak, glideS, releaseEnd, floor }) →
 *   { value, target, end } | null
 * Moves the held note on `param` (scheduled by applyAdsr, optionally released ahead by
 * releaseAt at releaseEnd) to the sustain level s from time t without a step, through the
 * module's recorded schedule (see the header and retargetEvents). The future events it
 * replaces are removed with options.cancel(time) or else the param's cancelScheduledValues;
 * with neither, and events to remove, nothing is scheduled and it returns null, as it does
 * when retargetEvents has nothing to retarget. `end` is when the new level is reached.
 */
export function retargetSustain(param, t, s, options = {}) {
  const log = schedules.get(param);
  const next = retargetEvents(log, t, s, options);
  if (!next) return null;
  const cancel = typeof options.cancel === 'function' ? options.cancel
    : typeof param.cancelScheduledValues === 'function'
      ? (time) => param.cancelScheduledValues(time) : null;
  const cancelAt = next.keep < log.length ? log[next.keep].time : null;
  if (cancelAt != null && !cancel) return null;
  const added = next.events.slice(next.keep);
  // Events before the first removed one go in first, so the segment sounding at t keeps its end
  // (as freezeParam does); the cancel then drops the old future, and the rest follows.
  for (const e of added) if (cancelAt == null || e.time < cancelAt) apply(param, e);
  if (cancelAt != null) {
    cancel(cancelAt);
    for (const e of added) if (e.time >= cancelAt) apply(param, e);
  }
  schedules.set(param, next.events);
  const reach = next.events.filter((e) => e.kind === 'exp' && e.value === next.target);
  return { value: next.value, target: next.target,
    end: reach.length ? reach[reach.length - 1].time : t };
}

/**
 * envelopePoints(adsr, { peak = 1, holdS, samples = 160, floor }) → graph data
 *   { t: Float32Array, v: Float32Array, totalS, handles: { attack, decay, sustainEnd, release } }
 * Samples the exact schedule applyAdsr + releaseAt produce for a note held holdS seconds after
 * the decay (default: max(a + d, r) / 2), including the exponential curve shapes. Handles are
 * { t, v } points for draggable controls.
 */
export function envelopePoints(adsr, options = {}) {
  const e = normalizeAdsr(adsr);
  const floor = options.floor || ENVELOPE_FLOOR;
  const peak = options.peak != null ? options.peak : 1;
  const hold = options.holdS != null ? Math.max(0, options.holdS) : Math.max(e.a + e.d, e.r) / 2;
  const samples = Math.max(8, options.samples | 0 || 160);
  const ev = adsrEvents(0, e, peak, { floor });
  const relAt = e.a + e.d + hold;
  const all = releaseEvents(ev, relAt, e.r, { floor }).events;
  const totalS = relAt + e.r;
  // Exact corner points plus uniform samples, merged in time order.
  const corners = [0, e.a, e.a + e.d, relAt, totalS];
  const n = samples + corners.length;
  const t = new Float32Array(n);
  const v = new Float32Array(n);
  const times = [];
  for (let i = 0; i < samples; i++) times.push((i / (samples - 1)) * totalS);
  times.push(...corners);
  times.sort((x, y) => x - y);
  for (let i = 0; i < n; i++) {
    t[i] = times[i];
    v[i] = valueAtTime(all, times[i], floor);
  }
  return {
    t,
    v,
    totalS,
    handles: {
      attack: { t: e.a, v: Math.max(floor, peak) },
      decay: { t: e.a + e.d, v: Math.max(floor, e.s * peak) },
      sustainEnd: { t: relAt, v: Math.max(floor, e.s * peak) },
      release: { t: totalS, v: floor },
    },
  };
}
