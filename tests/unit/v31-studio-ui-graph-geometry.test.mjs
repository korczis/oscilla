// V3.1 Studio graph editor geometry (src/js/ui/studio/graph-geometry.js) and compact layout
// (graph-layout.js). Spec §56-§62, §67, §119, §140, §197. Plan V409-V411, V421.
//   node --test tests/unit/v31-studio-ui-graph-geometry.test.mjs
// Tolerances: 1e-9 where a value is computed through a division (zoom), exact elsewhere.

import test from 'node:test';
import assert from 'node:assert';

import {
  GRID, NUDGE_LARGE, ZOOM_MAX, ZOOM_MIN, boundsOf, cablePath, clampZoom, dragPosition, fitView,
  graphToScreen, idsInRect, mergeSelection, normalizeRect, normalizeView, nudgeDelta, panBy,
  pastThreshold, pinchView, rectsIntersect, screenToGraph, snap, snapPoint, toggleInSelection,
  zoomAt, zoomText, FIT_MAX_ZOOM,
} from '../../src/js/ui/studio/graph-geometry.js';
import { compactLayout } from '../../src/js/ui/studio/graph-layout.js';
import { MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel } from
  '../../src/js/studio/templates/index.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('zoom is clamped to the decided bounds; invalid zoom becomes 1', () => {
  assert.equal(clampZoom(0.01), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(-2), 1);
  assert.deepEqual(normalizeView({ panX: 'x', zoom: 3 }), { panX: 0, panY: 0, zoom: ZOOM_MAX });
});

test('screen and logical coordinates are inverse mappings', () => {
  const v = { panX: 40, panY: -12, zoom: 1.5 };
  const p = graphToScreen(v, 100, 50);
  assert.deepEqual(p, { x: 190, y: 63 });
  assert.deepEqual(screenToGraph(v, p.x, p.y), { x: 100, y: 50 });
});

test('zoomAt keeps the logical point under the pointer fixed (§58)', () => {
  const v = { panX: 10, panY: 20, zoom: 1 };
  const before = screenToGraph(v, 300, 200);
  const z = zoomAt(v, 2, 300, 200);
  assert.equal(z.zoom, 2);
  const after = screenToGraph(z, 300, 200);
  near(after.x, before.x);
  near(after.y, before.y);
  // At the bound the view does not drift.
  const top = zoomAt({ panX: 0, panY: 0, zoom: ZOOM_MAX }, 2, 50, 50);
  assert.deepEqual(top, { panX: 0, panY: 0, zoom: ZOOM_MAX });
  assert.deepEqual(panBy(v, 5, -5), { panX: 15, panY: 15, zoom: 1 });
});

test('fitView centres the bounds and never enlarges past FIT_MAX_ZOOM (§59)', () => {
  const b = { x: 0, y: 0, w: 400, h: 200 };
  const v = fitView(b, { w: 1000, h: 600 }, { padding: 0 });
  assert.equal(v.zoom, FIT_MAX_ZOOM);
  const c = graphToScreen(v, 200, 100);
  near(c.x, 500);
  near(c.y, 300);
  const small = fitView({ x: 0, y: 0, w: 2000, h: 1000 }, { w: 1000, h: 600 }, { padding: 50 });
  near(small.zoom, 900 / 2000);
  assert.ok(small.zoom >= ZOOM_MIN);
  assert.deepEqual(fitView(null, { w: 800, h: 400 }), { panX: 400, panY: 200, zoom: 1 });
  assert.deepEqual(boundsOf([{ x: 10, y: 5, w: 10, h: 10 }, { x: -5, y: 20, w: 5, h: 5 }]),
    { x: -5, y: 5, w: 25, h: 20 });
  assert.equal(boundsOf([]), null);
});

test('cable path is the specified cubic and handles targets left of the source (§67)', () => {
  assert.equal(cablePath(0, 0, 200, 50), 'M 0 0 C 100 0, 100 50, 200 50');
  assert.equal(cablePath(0, 0, 40, 0), 'M 0 0 C 40 0, 0 0, 40 0');
  const back = cablePath(300, 100, 100, 300);
  const m = /^M 300 100 C ([\d.]+) 100, ([\d.-]+) 300, 100 300$/.exec(back);
  assert.ok(m, back);
  assert.ok(Number(m[1]) > 300, 'the source handle leaves to the right');
  assert.ok(Number(m[2]) < 100, 'the target handle enters from the left');
});

test('snapping stores coordinates, not grid indices (§151)', () => {
  assert.equal(GRID, 8);
  assert.equal(snap(13), 16);
  assert.equal(snap(-3), 0);
  assert.equal(snap(13, 0), 13);
  assert.deepEqual(snapPoint({ x: 3.9, y: 12.1 }), { x: 0, y: 16 });
  assert.deepEqual(dragPosition({ x: 40, y: 160 }, 30, -9, 2), { x: 56, y: 152 });
  assert.deepEqual(dragPosition({ x: 40, y: 160 }, 30, -9, 2, 0), { x: 55, y: 155.5 });
});

test('rectangle selection, toggles and nudges (§118-§119, §125, §140)', () => {
  const rects = [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }, { id: 'b', x: 200, y: 0, w: 100, h: 50 },
    { id: 'c', x: 0, y: 200, w: 100, h: 50 }];
  assert.deepEqual(idsInRect(rects, normalizeRect(250, 60, 50, -10)), ['a', 'b']);
  assert.ok(!rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }));
  assert.deepEqual(mergeSelection(['c'], ['a'], true), ['c', 'a']);
  assert.deepEqual(mergeSelection(['c'], ['a'], false), ['a']);
  assert.deepEqual(toggleInSelection(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleInSelection(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(nudgeDelta('ArrowLeft'), { x: -GRID, y: 0 });
  assert.deepEqual(nudgeDelta('ArrowDown', true), { x: 0, y: GRID * NUDGE_LARGE });
  assert.equal(nudgeDelta('Enter'), null);
  assert.ok(!pastThreshold(2, 3));
  assert.ok(pastThreshold(4, 3));
  assert.equal(zoomText(1.156), '116 %');
});

test('pinch zooms about the midpoint and follows its movement', () => {
  const v = { panX: 0, panY: 0, zoom: 1 };
  const next = pinchView(v, [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    [{ x: 50, y: 100 }, { x: 250, y: 100 }]);
  assert.equal(next.zoom, 2);
  const mid = screenToGraph(next, 150, 100);
  near(mid.x, 150);
  near(mid.y, 100);
});

test('compact layout of the Basic Synth keeps the chain on one row (§197)', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const l = compactLayout(m);
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, [n.col, n.row]]));
  assert.deepEqual(at, { 'osc-1': [0, 0], 'env-1': [1, 0], 'filter-1': [2, 0],
    'master-1': [3, 0], 'lfo-1': [0, 1], 'spectrum-1': [3, 1] });
  assert.equal(l.columns, 4);
  assert.equal(l.rows, 2);
  assert.deepEqual(l.links.map((x) => x.type), ['AUDIO', 'AUDIO', 'AUDIO', 'CONTROL', 'AUDIO']);
  // Deterministic and pure: same input, same output; the model is untouched.
  assert.deepEqual(compactLayout(m), l);
  assert.equal(m.graph.nodes[0].position.x, 40);
});

test('compact layout reads the measurement chain left to right', () => {
  const l = compactLayout(templateModel(MEASUREMENT_TEMPLATE_ID));
  const col = Object.fromEntries(l.nodes.map((n) => [n.id, n.col]));
  assert.ok(col['mic-1'] < col['cal-1'] && col['cal-1'] < col['transfer-1']
    && col['transfer-1'] < col['result-1']);
  assert.equal(col['sweep-1'], 0);
  assert.equal(compactLayout({ graph: { nodes: [], edges: [] } }).columns, 0);
});
