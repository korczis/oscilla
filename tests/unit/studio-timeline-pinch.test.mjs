// V603: a two-pointer pinch zooms the Studio timeline about the pointers' midpoint with the
// graph's pinch geometry (pinchGeometry of src/js/ui/studio/graph-geometry.js, which pinchView
// uses too), reaching the keyboard zoom's levels and limits: a pinch whose pointers spread by
// one zoom factor is exactly one zoom-in step (zoomAround) about the same anchor. The expected
// values are computed here from px per second and the time under the anchor, not read from the
// editor. Pinch is view state only: it returns a view and touches no model.
//   node --test tests/unit/studio-timeline-pinch.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { pinchGeometry, pinchView } from '../../src/js/ui/studio/graph-geometry.js';
import {
  TIMELINE_ZOOM, pinchTimeline, zoomAround,
} from '../../src/js/ui/studio/timeline-view.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const pair = (mid, half, y = 30) => [{ x: mid - half, y }, { x: mid + half, y }];
const timeAt = (v, px) => (v.scrollX + px) / v.pxPerSecond;

test('pinchGeometry: the distance ratio and both midpoints', () => {
  const g = pinchGeometry([{ x: 0, y: 0 }, { x: 30, y: 40 }], [{ x: 10, y: 0 }, { x: 70, y: 80 }]);
  assert.ok(near(g.factor, 100 / 50));
  assert.deepEqual(g.from, { x: 15, y: 20 });
  assert.deepEqual(g.to, { x: 40, y: 40 });
  assert.equal(pinchGeometry(pair(5, 0), pair(5, 10)).factor, 1, 'zero start distance: no zoom');
});

test('the graph pinch still zooms about the midpoint through the shared geometry', () => {
  const v = pinchView({ x: 0, y: 0, zoom: 1 }, pair(200, 50), pair(200, 100));
  assert.ok(v.zoom > 1);
});

test('a spread by one zoom factor is one keyboard zoom-in step at the same anchor', () => {
  for (const [pps, scrollX, anchor] of [[100, 0, 200], [100, 340, 75], [37.5, 12, 410]]) {
    const view = { pxPerSecond: pps, scrollX };
    const key = zoomAround(view, 1, anchor);
    const half = 40;
    const pinch = pinchTimeline(view, pair(anchor, half),
      pair(anchor, half * TIMELINE_ZOOM.factor));
    assert.ok(near(pinch.pxPerSecond, key.pxPerSecond),
      `${pps}: ${pinch.pxPerSecond} vs ${key.pxPerSecond}`);
    assert.ok(near(pinch.scrollX, key.scrollX, 1e-7), `${pps}: ${pinch.scrollX} vs ${key.scrollX}`);
    assert.ok(near(pinch.pxPerSecond, pps * TIMELINE_ZOOM.factor));
    assert.ok(near(timeAt(pinch, anchor), timeAt(view, anchor), 1e-7), 'the anchor keeps its time');
  }
});

test('three factors of spread equal three steps; pinching in equals zooming out', () => {
  const view = { pxPerSecond: 100, scrollX: 50 };
  const f = TIMELINE_ZOOM.factor;
  const three = pinchTimeline(view, pair(300, 20), pair(300, 20 * f ** 3));
  const key3 = zoomAround(view, 3, 300);
  assert.ok(near(three.pxPerSecond, key3.pxPerSecond) && near(three.scrollX, key3.scrollX, 1e-7));
  const out = pinchTimeline(view, pair(300, 50), pair(300, 50 / f));
  const keyOut = zoomAround(view, -1, 300);
  assert.ok(near(out.pxPerSecond, keyOut.pxPerSecond) && near(out.scrollX, keyOut.scrollX, 1e-7));
});

test('a pinch keeps the keyboard zoom limits', () => {
  const top = pinchTimeline({ pxPerSecond: TIMELINE_ZOOM.max / 1.1, scrollX: 0 }, pair(100, 10),
    pair(100, 1000));
  assert.equal(top.pxPerSecond, TIMELINE_ZOOM.max);
  const bottom = pinchTimeline({ pxPerSecond: TIMELINE_ZOOM.min * 1.1, scrollX: 0 }, pair(100, 500),
    pair(100, 5));
  assert.equal(bottom.pxPerSecond, TIMELINE_ZOOM.min);
});

test('a two-finger drag without spread pans by the midpoint movement, never below zero', () => {
  const view = { pxPerSecond: 100, scrollX: 200 };
  const panned = pinchTimeline(view, pair(300, 40), pair(260, 40));
  assert.equal(panned.pxPerSecond, 100);
  assert.ok(near(panned.scrollX, 240), 'moving the fingers left scrolls right by as much');
  const atStart = pinchTimeline({ pxPerSecond: 100, scrollX: 10 }, pair(100, 40), pair(150, 40));
  assert.equal(atStart.scrollX, 0);
});

test('pinch returns a new view and leaves its input alone', () => {
  const view = Object.freeze({ pxPerSecond: 100, scrollX: 0 });
  const next = pinchTimeline(view, pair(100, 40), pair(100, 50));
  assert.notEqual(next, view);
  assert.deepEqual(Object.keys(next).sort(), ['pxPerSecond', 'scrollX']);
});
