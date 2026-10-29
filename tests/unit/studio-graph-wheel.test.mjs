// Studio graph wheel (plan K007; spec §56-§57): a wheel or two-finger trackpad scroll pans the
// view by its deltaX and deltaY, Ctrl/Cmd + wheel and a trackpad pinch (a wheel with ctrlKey in
// Chromium and Firefox, gesturechange events in Safari) zoom at the pointer.
// src/js/ui/studio/graph-gestures.js wheelAction, gestureZoomFactor.
//   node --test tests/unit/studio-graph-wheel.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WHEEL_LINE_PX, WHEEL_ZOOM_MAX_DELTA, gestureZoomFactor, wheelAction,
} from '../../src/js/ui/studio/graph-gestures.js';
import { ZOOM_STEP, zoomAt } from '../../src/js/ui/studio/graph-geometry.js';

const wheel = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false,
  shiftKey: false, ...o });

test('K007 a plain wheel or two-finger scroll pans by deltaX and deltaY, never zooms', () => {
  assert.deepEqual(wheelAction(wheel({ deltaX: 30, deltaY: 40 })), { kind: 'pan', dx: -30,
    dy: -40 });
  assert.deepEqual(wheelAction(wheel({ deltaY: -120 })), { kind: 'pan', dx: 0, dy: 120 });
  assert.deepEqual(wheelAction(wheel({ deltaX: -7.5 })), { kind: 'pan', dx: 7.5, dy: 0 });
});

test('K007 line and page delta modes are converted to px before panning', () => {
  assert.deepEqual(wheelAction(wheel({ deltaY: 3, deltaMode: 1 })),
    { kind: 'pan', dx: 0, dy: -3 * WHEEL_LINE_PX });
  const page = wheelAction(wheel({ deltaY: 1, deltaMode: 2 }), { pageHeight: 500 });
  assert.deepEqual(page, { kind: 'pan', dx: 0, dy: -500 });
});

test('K007 Shift turns a vertical-only wheel into a horizontal pan', () => {
  assert.deepEqual(wheelAction(wheel({ deltaY: 50, shiftKey: true })), { kind: 'pan', dx: -50,
    dy: 0 });
  // A device that already reports deltaX with Shift keeps it.
  assert.deepEqual(wheelAction(wheel({ deltaX: 50, shiftKey: true })), { kind: 'pan', dx: -50,
    dy: 0 });
});

test('K007 Ctrl or Cmd + wheel (and a trackpad pinch) zoom: up zooms in, down zooms out', () => {
  const zin = wheelAction(wheel({ deltaY: -4, ctrlKey: true }));
  assert.equal(zin.kind, 'zoom');
  assert.ok(zin.factor > 1);
  const zout = wheelAction(wheel({ deltaY: 4, metaKey: true }));
  assert.equal(zout.kind, 'zoom');
  assert.ok(zout.factor < 1);
  assert.ok(Math.abs(zin.factor * zout.factor - 1) < 1e-12, 'symmetric');
  // A small pinch step keeps the rate it had before K007 (exp(-0.01 * dy)).
  assert.ok(Math.abs(zin.factor - Math.exp(0.04)) < 1e-12);
});

test('K007 one mouse-wheel notch with Ctrl zooms about one zoom step, not a jump', () => {
  const notch = wheelAction(wheel({ deltaY: -100, ctrlKey: true }));
  assert.equal(notch.factor, Math.exp(WHEEL_ZOOM_MAX_DELTA * 0.01));
  assert.ok(notch.factor < ZOOM_STEP * 1.05 && notch.factor > ZOOM_STEP / 1.05, notch.factor);
  const lines = wheelAction(wheel({ deltaY: 3, deltaMode: 1, ctrlKey: true }));
  assert.equal(lines.factor, Math.exp(-WHEEL_ZOOM_MAX_DELTA * 0.01));
});

test('K007 zoom keeps the logical point under the pointer (zoomAt)', () => {
  const view = { panX: 40, panY: -20, zoom: 1 };
  const a = wheelAction(wheel({ deltaY: -10, ctrlKey: true }));
  const v = zoomAt(view, a.factor, 300, 200);
  const before = { x: (300 - view.panX) / view.zoom, y: (200 - view.panY) / view.zoom };
  const after = { x: (300 - v.panX) / v.zoom, y: (200 - v.panY) / v.zoom };
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('K007 a wheel with no delta does nothing', () => {
  assert.equal(wheelAction(wheel({})), null);
  assert.equal(wheelAction(wheel({ ctrlKey: true })), null);
  assert.equal(wheelAction(wheel({ deltaY: Number.NaN })), null);
  assert.equal(wheelAction(null), null);
});

test('K007 a Safari pinch zooms by the change of its cumulative scale', () => {
  // gesturestart at scale 1, then 1.1, then 1.21: two equal zoom steps.
  assert.equal(gestureZoomFactor(1, 1.1), 1.1);
  assert.ok(Math.abs(gestureZoomFactor(1.1, 1.21) - 1.1) < 1e-12);
  assert.equal(gestureZoomFactor(2, 1), 0.5, 'pinching in zooms out');
  for (const [a, b] of [[1, 1], [0, 1.1], [1, 0], [1, NaN], [1, Infinity], [NaN, 1]]) {
    assert.equal(gestureZoomFactor(a, b), null, `${a} -> ${b}`);
  }
});
