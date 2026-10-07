// Shared waits of the browser suites (rule project.bounded-test-timing).
//
// A browser check waits for the condition its assertion judges, against a wall-clock deadline
// that names the check when it expires. Nothing here sleeps for a fixed time in place of a
// product condition, and nothing follows only the audio clock: a stalled AudioContext or a
// page that never answers ends in a named timeout instead of a job that runs until CI kills it.
//
//   const { until, bounded, anchor, frames } = require('./lib/wait.cjs');
//
//   await until(() => page.evaluate(() => window.OSCILLA.engine.snapshot().playing),
//     { ms: 5000, what: 'the engine reports playing after PLAY' });
//
// tests/unit/browser-timing.test.mjs scans tests/browser for waits that bypass this module.
'use strict';

class WaitTimeout extends Error {
  constructor(message) {
    super(message);
    this.name = 'WaitTimeout';
  }
}

function describe(value) {
  if (value === undefined) return 'undefined';
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.slice(0, 200);
  } catch {
    return String(value);
  }
}

function requireBound(fn, ms, what) {
  if (!(Number.isFinite(ms) && ms > 0)) {
    throw new TypeError(`${fn}: ms must be a positive wall-clock deadline in milliseconds `
      + '(project.bounded-test-timing)');
  }
  if (typeof what !== 'string' || !what.trim()) {
    throw new TypeError(`${fn}: what must name the check this wait serves `
      + '(project.bounded-test-timing)');
  }
}

// A promise that settles as `promise` does, or rejects with a named WaitTimeout after `ms` of
// wall time. The original promise keeps its handlers, so a late rejection (a page closed after
// the deadline) is never an unhandled rejection.
function bounded(promise, { ms, what } = {}) {
  requireBound('bounded', ms, what);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WaitTimeout(`${what}: no answer within ${ms} ms of wall time`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// Poll `pred` until it returns a truthy value and return that value. The predicate is the
// condition the following assertion judges; a looser one moves the race into the assertion.
// The deadline is wall time and also covers a predicate that never answers.
async function until(pred, { ms, what, every = 50 } = {}) {
  requireBound('until', ms, what);
  if (typeof pred !== 'function') throw new TypeError('until: pred must be a function');
  const start = Date.now();
  const deadline = start + ms;
  let last;
  let polls = 0;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0 && polls > 0) break;
    polls += 1;
    try {
      last = await bounded(Promise.resolve().then(pred), { ms: Math.max(1, left), what });
    } catch (error) {
      if (error instanceof WaitTimeout) break;
      throw error;
    }
    if (last) return last;
    if (Date.now() >= deadline) break;
    const pause = Math.min(every, Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => { setTimeout(resolve, pause); });
  }
  throw new WaitTimeout(`${what}: not reached within ${ms} ms of wall time `
    + `(${polls} poll(s), last value ${describe(last)})`);
}

// Frames in `seconds` at the context's own rate. A window written as a frame count is right at
// one sample rate only (CI browsers run 44.1 kHz, a Mac 48 kHz).
function frames(seconds, sampleRate) {
  if (!(Number.isFinite(sampleRate) && sampleRate > 0)) {
    throw new TypeError('frames: sampleRate must be the context rate, never an assumed one');
  }
  return Math.max(1, Math.round(seconds * sampleRate));
}

// A point on the audio clock `leadS` ahead of now, with helpers that express offsets and
// windows relative to it at the context's rate. `ctx` is anything with `currentTime` and
// `sampleRate`; the function is self-contained so a page can run it:
//   page.evaluate(`(${anchor})(window.ctx, 0.05).t0`)
function anchor(ctx, leadS = 0.05) {
  const rate = ctx.sampleRate;
  if (!(Number.isFinite(rate) && rate > 0)) {
    throw new TypeError('anchor: ctx.sampleRate must be the context rate');
  }
  const t0 = ctx.currentTime + leadS;
  return {
    t0,
    sampleRate: rate,
    at: (seconds) => t0 + seconds,
    frames: (seconds) => Math.max(1, Math.round(seconds * rate)),
    frameAt: (seconds) => Math.round((t0 + seconds) * rate),
  };
}

module.exports = { until, bounded, anchor, frames, WaitTimeout };
