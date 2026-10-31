// C014 (finding vis-divergence-2): the shared frame loop tells its subscribers when a frame is
// the first one after frames were skipped ("Pause animation", a hidden document), so a
// time-axis renderer restarts its clock there instead of painting the skipped interval.
import test from 'node:test';
import assert from 'node:assert/strict';

let queued = null;
let handles = 0;
const listeners = {};
globalThis.requestAnimationFrame = (cb) => {
  queued = cb;
  handles += 1;
  return handles;
};
globalThis.cancelAnimationFrame = () => {
  queued = null;
};
const doc = {
  hidden: false,
  addEventListener: (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  },
};
globalThis.document = doc;

const { onFrame, setFramesPaused } = await import('../../src/js/charts/frame-loop.js');

function run(now) {
  const cb = queued;
  queued = null;
  assert.ok(cb, `no frame was requested before ${now}`);
  cb(now);
}

test('the first frame after Pause animation carries resumed, the others do not', () => {
  const calls = [];
  const off = onFrame((now, info) => calls.push([now, !!(info && info.resumed)]));
  run(16);
  run(32);
  setFramesPaused(true);
  run(48);
  run(64);
  setFramesPaused(false);
  run(4000);
  run(4016);
  assert.deepEqual(calls, [[16, false], [32, false], [4000, true], [4016, false]]);
  off();
});

test('the first frame after a hidden document carries resumed', () => {
  const calls = [];
  const off = onFrame((now, info) => calls.push([now, !!(info && info.resumed)]));
  run(5000);
  doc.hidden = true;
  run(5016);
  doc.hidden = false;
  run(9000);
  run(9016);
  assert.deepEqual(calls, [[5000, false], [9000, true], [9016, false]]);
  off();
});

test('a tab hidden without a frame in between (rAF stopped) still resumes', () => {
  const calls = [];
  const off = onFrame((now, info) => calls.push([now, !!(info && info.resumed)]));
  run(10000);
  // A really hidden tab gets no animation frame at all; only visibilitychange tells of it.
  doc.hidden = true;
  for (const fn of listeners.visibilitychange || []) fn();
  doc.hidden = false;
  for (const fn of listeners.visibilitychange || []) fn();
  run(14000);
  run(14016);
  assert.deepEqual(calls, [[10000, false], [14000, true], [14016, false]]);
  off();
});
