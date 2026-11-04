// V638: Frame all (graph-geometry.js fitView) centres the graph only on an axis where it fits.
// Where the graph does not fit even at the minimum zoom, centring cut both ends and hid the
// top row of nodes (merge train 4: the demo song's bass-filter card under a short viewport).
// On such an axis the view now starts at the graph's top or left edge, `padding` px in.
//   node --test tests/unit/studio-fit-overflow.test.mjs
// Tolerances: 1e-9 (plain arithmetic).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as geometry from '../../src/js/ui/studio/graph-geometry.js';

const { FIT_PADDING_PX: PAD, ZOOM_MIN, fitView } = geometry;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('a graph taller than the viewport at the minimum zoom shows its top row', () => {
  const bounds = { x: 100, y: 200, w: 400, h: 4000 };
  const size = { w: 1200, h: 300 };
  const v = fitView(bounds, size);
  near(v.zoom, ZOOM_MIN, 'held at the minimum zoom');
  near(bounds.y * v.zoom + v.panY, PAD, 'the top edge sits padding px below the viewport top');
  near((bounds.x + bounds.w / 2) * v.zoom + v.panX, size.w / 2, 'the fitting axis stays centred');
});

test('a graph wider than the viewport at the minimum zoom shows its left column', () => {
  const bounds = { x: -50, y: 0, w: 9000, h: 200 };
  const size = { w: 400, h: 800 };
  const v = fitView(bounds, size);
  near(v.zoom, ZOOM_MIN, 'held at the minimum zoom');
  near(bounds.x * v.zoom + v.panX, PAD, 'the left edge sits padding px in');
  near((bounds.y + bounds.h / 2) * v.zoom + v.panY, size.h / 2, 'the fitting axis stays centred');
});

test('a graph that fits stays centred on both axes', () => {
  const bounds = { x: 10, y: 20, w: 300, h: 200 };
  const size = { w: 1000, h: 800 };
  const v = fitView(bounds, size);
  near((bounds.x + bounds.w / 2) * v.zoom + v.panX, size.w / 2, 'x centred');
  near((bounds.y + bounds.h / 2) * v.zoom + v.panY, size.h / 2, 'y centred');
});

test('an empty graph still centres the origin at zoom 1', () => {
  assert.deepEqual(fitView(null, { w: 200, h: 100 }), { panX: 100, panY: 50, zoom: 1 });
});
