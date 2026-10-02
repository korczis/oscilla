// Voice-level envelope scheduling: recorded automation (every envelope and release-gain event
// is logged, so the param's value at any time follows from its schedule and it can be frozen
// there in every browser), the click-free step envelope, and the pluggable open-pattern envelope
// (V2 ADSR extension point). Extracted from V1 AudioEngine (index.html@36f4b47, section 6) and
// ported to index.html@a7b7a23, where _loggedParam/_holdEnv became _track/_ev/_valueAt/_freeze/
// _prune (no cancelAndHoldAtTime anywhere, the same code in every browser).
//
// INVARIANT (inventory K4 / risk 4): freezeParam() is only correct when EVERY automation of a
// tracked param goes through recordEvent() — for envelope functions, through the `eg` wrapper
// they receive (trackedParam). An envelope function that schedules on env.gain directly makes
// the frozen value wrong and the release clicks.

import { GAIN_FLOOR } from '../core/constants.js';
import { clamp } from '../core/math.js';

// ---- recorded automation
// V1: AudioEngine._track, _ev, _valueAt, _freeze, _prune (index.html@a7b7a23)

/** A tracked param: { param, ev: [{ kind, value, time }], initial }. */
export function trackParam(param, initial) { return { param, ev: [], initial }; }

/**
 * Record and apply one automation event. V1 appends; events from V2 envelope hooks may arrive
 * out of time order (envelope.js pins the floor at time 0), so an earlier event is inserted at
 * its sorted position (after events with the same time). For V1's in-order calls this is V1's
 * push.
 */
export function recordEvent(pt, kind, value, time) {
  const ev = pt.ev;
  const e = { kind, value, time };
  if (!ev.length || ev[ev.length - 1].time <= time) ev.push(e);
  else {
    let i = ev.length;
    while (i > 0 && ev[i - 1].time > time) i--;
    ev.splice(i, 0, e);
  }
  pt.param[kind](value, time);
}

/** The scheduled value of a tracked param at time t. */
export function valueAt(pt, t) {
  const ev = pt.ev;
  let lo = 0;
  let hi = ev.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ev[mid].time <= t) { i = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (i < 0) return pt.initial;
  const prev = ev[i];
  const next = ev[i + 1];
  if (!next || next.kind === 'setValueAtTime') return prev.value;
  const k = clamp((t - prev.time) / Math.max(1e-9, next.time - prev.time), 0, 1);
  if (next.kind === 'linearRampToValueAtTime') return prev.value + (next.value - prev.value) * k;
  return prev.value * Math.pow(next.value / prev.value, k);
}

/**
 * Hold a recorded param at its scheduled value from time t on. An in-progress ramp is re-ended
 * at t on its own curve (inserted first, so the segment sounding now never loses its end),
 * then everything after t is cancelled. The same code runs in every browser.
 */
export function freezeParam(pt, t) {
  const value = valueAt(pt, t);
  const ev = pt.ev;
  let i = ev.findIndex((e) => e.time > t);
  if (i < 0) i = ev.length;
  const next = ev[i];
  const kind = next && next.kind !== 'setValueAtTime' ? next.kind : 'setValueAtTime';
  pt.param[kind](value, t);
  if (next) pt.param.cancelScheduledValues(next.time);
  ev.length = i;
  ev.push({ kind, value, time: t });
  return value;
}

/** Forget events no longer needed to compute values at or after t. */
export function pruneParam(pt, t) {
  let i = 0;
  while (i + 1 < pt.ev.length && pt.ev[i + 1].time <= t) i++;
  if (i > 0) pt.ev.splice(0, i);
}

/**
 * The param-like wrapper envelope functions schedule through (setValueAtTime,
 * linearRampToValueAtTime, exponentialRampToValueAtTime), recording every call on `pt`. It has
 * no cancel methods, so envelope.js's feature detection falls back to its recorded-schedule
 * hold, which schedules through these three methods as well.
 */
export function trackedParam(pt) {
  const rec = (kind) => (value, time) => { recordEvent(pt, kind, value, time); };
  return {
    setValueAtTime: rec('setValueAtTime'),
    linearRampToValueAtTime: rec('linearRampToValueAtTime'),
    exponentialRampToValueAtTime: rec('exponentialRampToValueAtTime'),
  };
}

/** One click-free envelope step: linear attack, hold, exponential release to the floor. */
export function stepEnv(param, t, dur, attack, release) {
  // V1: AudioEngine._stepEnv (index.html@a7b7a23); `param` is the voice's trackedParam wrapper
  // (V1 passes the tracked record and calls this._ev on it: the same events)
  const a = Math.max(0.001, Math.min(attack, dur * 0.4));
  const r = Math.max(0.001, Math.min(release, dur * 0.5));
  param.setValueAtTime(GAIN_FLOOR, t);
  param.linearRampToValueAtTime(1, t + a);
  if (dur - r > a) param.setValueAtTime(1, t + dur - r);
  param.exponentialRampToValueAtTime(GAIN_FLOOR, t + dur);
}

/**
 * The default open-pattern envelope: V1's linear attack to 1, hold, and — for a finite length
 * (TRIGGER, the hard safety limit, or a replacement voice's inherited deadline) — an
 * exponential release ending at t0 + len. The attack shrinks to 40 % of a finite length and the
 * release to half of it, so a short limit is never exceeded. Returns the end time (Infinity
 * while held).
 *
 * Envelope function contract (engine.setEnvelope(fn) / play(plan, { envelope })):
 *   fn(eg, t0, len, attackS, releaseS, adsr) -> endTime (seconds, or Infinity)
 *   eg     the voice's tracked envelope param (schedule through it only, see INVARIANT)
 *   len    seconds the note lasts (Infinity = until released); already capped by the safety
 *          limit and by o.until
 *   adsr   play() options.adsr ({ a, d, s, r } in seconds / 0..1) or null
 * The engine stops the voice's sources 10 ms after endTime and records a finite endTime as the
 * voice's deadline; a release while held freezes the tracked envelope and fades the release
 * gain over releaseS (adsr.r when an ADSR is given).
 * V1: AudioEngine.play, "Open patterns" block (index.html@a7b7a23)
 */
export function v1OpenEnvelope(eg, t0, len, a, r) {
  // A finite length shortens the attack rather than stretching past the limit.
  const atk = Number.isFinite(len) ? Math.min(a, len * 0.4) : a;
  eg.setValueAtTime(GAIN_FLOOR, t0);
  eg.linearRampToValueAtTime(1, t0 + atk);
  if (Number.isFinite(len)) {
    const rel = Math.min(r, Math.max(0.005, len * 0.5));
    len = Math.max(len, atk + rel + 0.005);
    eg.setValueAtTime(1, t0 + len - rel);
    eg.exponentialRampToValueAtTime(GAIN_FLOOR, t0 + len);
    return t0 + len;
  }
  return Infinity;
}

/**
 * Adapter for the DSP agent's ADSR module (src/js/audio/envelope.js):
 *   engine.setEnvelope(makeAdsrEnvelope({ applyAdsr, releaseAt }))
 * With options.adsr the attack/decay/sustain is scheduled by applyAdsr on the tracked param; a
 * finite length releases with releaseAt so the release ends at t0 + len (the release shrinks to
 * half the length, like V1). Without options.adsr it is exactly v1OpenEnvelope.
 * This is glue only; the ADSR maths live in envelope.js.
 */
export function makeAdsrEnvelope({ applyAdsr, releaseAt }) {
  return (eg, t0, len, a, r, adsr) => {
    if (!adsr) return v1OpenEnvelope(eg, t0, len, a, r);
    applyAdsr(eg, t0, adsr, 1);
    if (!Number.isFinite(len)) return Infinity;
    const rel = Math.min(r, Math.max(0.005, len * 0.5));
    const at = t0 + Math.max(len - rel, 0.001);
    return releaseAt(eg, at, rel).endTime;
  };
}
