// The audio clock as the main thread can know it: a context time the audio thread has rendered
// at least up to, for anchoring a change to something that is sounding (a stop, a release).
// Moved unchanged from src/js/sequencer/compiler.js (its realtime stop anchor), so the engine's
// releases (AudioEngine._soon) and the sequencer's stop share one estimate and one set of clock
// readings per context. `now` (a performance.now() reading) is a parameter so a caller can
// take it from its own environment; null means "no clock": the estimate is ctx.currentTime.

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
