// The audio clock as the main thread can know it: a context time the audio thread has rendered
// at least up to, for anchoring a change to something that is sounding (a stop, a release).
// Moved unchanged from src/js/sequencer/compiler.js (its realtime stop anchor), so the engine's
// releases (AudioEngine._soon) and the sequencer's stop share one estimate and one set of clock
// readings per context. `now` (a performance.now() reading) is a parameter so a caller can
// take it from its own environment; null means "no clock": the estimate is ctx.currentTime.

import { RENDER_QUANTUM } from '../core/constants.js';

// Bounds for the rendered-time estimate (renderedTimeAtLeast): how far it may run ahead of
// ctx.currentTime in all, how far beyond the real time since the newest clock reading, and how
// long and how many readings are kept.
const MAX_CLOCK_LAG_S = 0.2;
const CLOCK_LAG_SLACK_S = 0.05;
const CLOCK_OBS_MAX_AGE_MS = 2000;
const CLOCK_OBS_COUNT = 16;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const clockObs = new WeakMap(); // ctx -> [{ ct, perf }], oldest first

/** performance.now() of the global scope, or null without one. */
export function perfNow() {
  const p = globalThis.performance;
  return p && typeof p.now === 'function' ? p.now() : null;
}

/**
 * Record a reading (ctx.currentTime, performance.now()). Called when a voice is compiled or
 * played and by per-frame readouts (UI bookkeeping), so a stop has recent readings.
 */
export function observeClock(ctx, now = perfNow()) {
  if (!ctx || typeof ctx.startRendering === 'function') return;
  const perf = now;
  const ct = ctx.currentTime;
  if (perf === null || !isNum(perf) || !isNum(ct)) return;
  let list = clockObs.get(ctx);
  if (!list) clockObs.set(ctx, (list = []));
  list.push({ ct, perf });
  const tooOld = () => perf - list[0].perf > CLOCK_OBS_MAX_AGE_MS;
  while (list.length > CLOCK_OBS_COUNT || (list.length && tooOld())) list.shift();
}

/** Drop the readings of a context (its clock stalls or restarts: suspended, resumed, closed). */
export function forgetClock(ctx) {
  if (ctx) clockObs.delete(ctx);
}

/**
 * A context time the audio thread has rendered at least up to, for anchoring a realtime stop.
 * ctx.currentTime alone can be stale: Firefox updates it only between tasks (and not at every
 * frame), so a main thread that is late within a task reads a time rendered long ago, and a fade
 * anchored there starts in the past (one or more quanta render unfaded, then the ramp jumps in).
 * Two further estimates, each used only when larger:
 *   - every recent reading advanced by the real time elapsed since (the freshest wins);
 *   - getOutputTimestamp() extrapolated to now plus baseLatency and outputLatency (the output
 *     position plus the latency between rendering and output).
 * An audio clock that stalled since a reading makes the estimate late, never early; so the gain
 * over currentTime is bounded by the real time since the newest reading plus CLOCK_LAG_SLACK_S,
 * and by MAX_CLOCK_LAG_S in all.
 * options.outputTimestamp: false leaves out the getOutputTimestamp estimate. Firefox reports a
 * timestamp whose contextTime and performanceTime both trail by outputLatency, so adding the
 * latency again puts that estimate one outputLatency (about 22 ms) after currentTime on every
 * call; the engine, whose stops are bounded tightly, uses the readings only.
 */
export function renderedTimeAtLeast(ctx, now = perfNow(), { outputTimestamp = true } = {}) {
  const ct = ctx.currentTime;
  if (now === null || !isNum(now)) return ct;
  let t = ct;
  const list = clockObs.get(ctx) || [];
  for (const o of list) {
    if (now - o.perf <= CLOCK_OBS_MAX_AGE_MS) t = Math.max(t, o.ct + (now - o.perf) / 1000);
  }
  if (outputTimestamp && typeof ctx.getOutputTimestamp === 'function') {
    try {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const lat = (isNum(ctx.baseLatency) ? ctx.baseLatency : 0) +
          (isNum(ctx.outputLatency) ? ctx.outputLatency : 0);
        t = Math.max(t, ts.contextTime + (now - ts.performanceTime) / 1000 + lat);
      }
    } catch (e) {
      /* no timestamp: currentTime and the readings stand */
    }
  }
  const newest = list.length ? list[list.length - 1].perf : now;
  const bound = Math.min(MAX_CLOCK_LAG_S, Math.max(0, now - newest) / 1000 + CLOCK_LAG_SLACK_S);
  return Math.min(t, ct + bound);
}

/**
 * When a setTargetAtTime glide (AudioEngine.setMasterGain) starts: ctx.currentTime, or, on a
 * context that has rendered nothing yet (currentTime 0), the end of its first render quantum
 * (V502). Gecko starts a setTargetAtTime at time 0, on a gain whose input is still silent, from
 * the param's default 1 instead of its value (a setValueAtTime at 0 before it changes nothing),
 * so the first sound of a page came out at up to 12.5 x the default master level (the ceiling
 * the only bound), settling over about 100 ms. Measured with the Playwright 1.63 Firefox on
 * darwin arm64 and linux amd64: value 0.08 and setTargetAtTime(0.08, 0, 0.02) read 0.418 at
 * 20 ms (0.08 + 0.92 e^-1), started one quantum later 0.08, as Chromium and WebKit read both;
 * tests/browser/midi.cjs "velocity 127 peaks under the master level" caught it on the CI
 * runners. A voice starts START_OFFSET_S (20 ms) after currentTime at the earliest, after a
 * quantum's end at any rate above 6.4 kHz, so nothing sounds before the glide starts.
 */
export function glideStart(ctx) {
  return ctx.currentTime > 0 ? ctx.currentTime : RENDER_QUANTUM / ctx.sampleRate;
}

// ------------------------------------------------------------------ the one transport clock

/**
 * The one lookahead window of every scheduler that plays on an engine (C055): the sequencer's
 * loop compiles its next pass this far ahead of the pass's start, and the Studio timeline
 * schedules this far ahead of ctx.currentTime (timeline-compiler.js TIMELINE_LOOKAHEAD_S, the
 * sequencer's LOOKAHEAD_S, both this value).
 */
export const TRANSPORT_LOOKAHEAD_S = 1.0;

const transportClocks = new WeakMap(); // engine -> its transport clock

/**
 * The one transport clock (C055): one timer for every scheduler on an engine, so the
 * sequencer's loop pump and the Studio transport's tick wake from the same timer instead of
 * arming one each. A scheduler asks wake(key, ms, fn) for its next wake-up and cancel(key) to
 * drop it; the clock keeps one timer, armed at the earliest wake-up asked for, and when it fires
 * calls every scheduler that asked. A scheduler woken before its own time schedules nothing new:
 * each one places its sound on ctx.currentTime with the one lookahead window and asks for its
 * next wake-up again. The timer is UI bookkeeping, never the audio schedule (ADR 0001).
 *   timers  { setTimeout, clearTimeout } (the engine's own), or null: no wake-up ever fires
 *   nowMs   a millisecond clock for how long an earlier wake-up still has to wait
 * -> { wake(key, ms, fn), cancel(key), has(key), pending (count), lookAheadS }
 */
export function createTransportClock(timers, nowMs = perfNow) {
  const wakes = new Map(); // key -> { fn, at }
  let timer = null;
  const now = () => {
    const t = nowMs();
    return isNum(t) ? t : 0;
  };
  function rearm() {
    if (timer !== null && timers) timers.clearTimeout(timer);
    timer = null;
    if (!wakes.size || !timers) return;
    let at = Infinity;
    for (const w of wakes.values()) at = Math.min(at, w.at);
    timer = timers.setTimeout(fire, Math.max(1, Math.round(at - now())));
  }
  function fire() {
    timer = null;
    const due = [...wakes.values()];
    wakes.clear();
    let failure = null;
    for (const w of due) {
      try {
        w.fn();
      } catch (e) {
        failure = failure || e; // the other schedulers still wake
      }
    }
    rearm();
    if (failure) throw failure;
  }
  return {
    lookAheadS: TRANSPORT_LOOKAHEAD_S,
    wake(key, ms, fn) {
      wakes.set(key, { fn, at: now() + Math.max(0, Number(ms) || 0) });
      rearm();
    },
    cancel(key) {
      if (wakes.delete(key)) rearm();
    },
    has: (key) => wakes.has(key),
    get pending() { return wakes.size; },
  };
}

/** setTimeout and clearTimeout of the global scope, or null without them. */
function globalTimers() {
  if (typeof globalThis.setTimeout !== 'function') return null;
  return { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id) };
}

/**
 * The transport clock of `engine` (an AudioEngine), made on first use from the engine's own
 * timers (engine._timers, which a test may replace before), else the global ones. Every
 * scheduler that plays on the engine shares it.
 */
export function transportClockOf(engine) {
  if (!engine || typeof engine !== 'object') return null;
  let c = transportClocks.get(engine);
  if (!c) transportClocks.set(engine, (c = createTransportClock(engine._timers || globalTimers())));
  return c;
}
