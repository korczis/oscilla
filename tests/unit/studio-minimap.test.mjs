// V3.1 Studio graph minimap (src/js/ui/studio/graph-minimap.js). Spec §153; plan V602.
//   node --test tests/unit/studio-minimap.test.mjs
// The minimap's geometry reflects node positions and the viewport after every pan and zoom; a
// minimap pointer and a minimap key at the same minimap point ask for the same viewport; the
// minimap is view state only (it hands back a view and never changes the model).
// Tolerances: 1e-9 where a value goes through the map's scale (a division), exact elsewhere.

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  MINIMAP_KEY_STEP_PX, MINIMAP_PADDING_PX, MINIMAP_SIZE, centerViewOn, minimapKeyTarget,
  minimapKeyView, minimapLayout, minimapPointView, minimapToGraph, visibleRect,
} from '../../src/js/ui/studio/graph-minimap.js';
import {
  NODE_WIDTH, NUDGE_LARGE, ZOOM_STEP, fitView, boundsOf, normalizeView, panBy, pinchView,
  screenToGraph, zoomAt,
} from '../../src/js/ui/studio/graph-geometry.js';
import { createIdGenerator, createStudioStore, deepFreeze } from '../../src/js/studio/actions.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const near = (a, b, what = '', eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps,
  `${what}: ${a} != ${b}`);
const SIZE = Object.freeze({ w: 900, h: 560 });
const NODE_H = 80;
const rectsOf = (model) => model.graph.nodes.map((n) => ({ id: n.id, x: n.position.x,
  y: n.position.y, w: NODE_WIDTH, h: NODE_H }));
const viewsEqual = (a, b, what) => {
  near(a.panX, b.panX, `${what} panX`);
  near(a.panY, b.panY, `${what} panY`);
  assert.strictEqual(a.zoom, b.zoom, `${what} zoom`);
};

/** The layout's own claims, checked against the geometry it was made from. */
function assertReflects(L, rects, view, size, what) {
  const v = normalizeView(view);
  // Every node: its logical rect through the one map (m = logical * scale + o).
  assert.strictEqual(L.nodes.length, rects.length, `${what}: one minimap rect per node`);
  rects.forEach((r, i) => {
    const n = L.nodes[i];
    assert.strictEqual(n.id, r.id);
    near(n.x, r.x * L.scale + L.ox, `${what} ${r.id} x`);
    near(n.y, r.y * L.scale + L.oy, `${what} ${r.id} y`);
    near(n.w, r.w * L.scale, `${what} ${r.id} w`);
    near(n.h, r.h * L.scale, `${what} ${r.id} h`);
  });
  // The viewport rectangle: its corners are the logical points at the viewport's corners.
  const tl = minimapToGraph(L, L.viewport.x, L.viewport.y);
  const br = minimapToGraph(L, L.viewport.x + L.viewport.w, L.viewport.y + L.viewport.h);
  const s0 = screenToGraph(v, 0, 0);
  const s1 = screenToGraph(v, size.w, size.h);
  near(tl.x, s0.x, `${what} viewport left`, 1e-6);
  near(tl.y, s0.y, `${what} viewport top`, 1e-6);
  near(br.x, s1.x, `${what} viewport right`, 1e-6);
  near(br.y, s1.y, `${what} viewport bottom`, 1e-6);
  // Everything is on the map, inside its padding (eps for rounding).
  const inside = (r, label) => {
    assert.ok(r.x >= MINIMAP_PADDING_PX - 1e-6 && r.y >= MINIMAP_PADDING_PX - 1e-6, label);
    assert.ok(r.x + r.w <= L.map.w - MINIMAP_PADDING_PX + 1e-6, label);
    assert.ok(r.y + r.h <= L.map.h - MINIMAP_PADDING_PX + 1e-6, label);
  };
  inside(L.viewport, `${what}: the viewport rectangle stays on the map`);
  L.nodes.forEach((n) => inside(n, `${what}: node ${n.id} stays on the map`));
}

test('visibleRect is the logical rectangle the viewport shows', () => {
  const v = { panX: 120, panY: -40, zoom: 0.5 };
  assert.deepStrictEqual(visibleRect(v, SIZE), { x: -240, y: 80, w: 1800, h: 1120 });
  assert.deepStrictEqual(visibleRect(v, { w: 0, h: 0 }), { x: -240, y: 80, w: 0, h: 0 });
});

test('the minimap reflects node positions and the viewport after every pan and zoom', () => {
  const rects = rectsOf(templateModel(REFERENCE_TEMPLATE_ID));
  assert.ok(rects.length >= 5, 'the reference template has its nodes');
  let view = fitView(boundsOf(rects), SIZE);
  const steps = [
    ['fit', (v) => v],
    ['pan right/down', (v) => panBy(v, 140, 60)],
    ['pan far left', (v) => panBy(v, -2600, 0)],
    ['zoom in at the centre', (v) => zoomAt(v, ZOOM_STEP, SIZE.w / 2, SIZE.h / 2)],
    ['zoom out at a corner', (v) => zoomAt(v, 1 / (ZOOM_STEP * ZOOM_STEP), 10, 10)],
    ['zoom to the lower bound', (v) => zoomAt(v, 1e-6, 300, 200)],
    ['zoom to the upper bound', (v) => zoomAt(v, 1e6, 300, 200)],
    ['pinch', (v) => pinchView(v, [{ x: 100, y: 100 }, { x: 200, y: 100 }],
      [{ x: 80, y: 120 }, { x: 260, y: 120 }])],
    ['pan up', (v) => panBy(v, 0, 900)],
  ];
  let prev = null;
  for (const [what, op] of steps) {
    view = op(view);
    const L = minimapLayout(rects, view, SIZE);
    assert.deepStrictEqual(L.map, { ...MINIMAP_SIZE });
    assertReflects(L, rects, view, SIZE, what);
    if (prev && what !== 'fit') {
      assert.notDeepStrictEqual(L.viewport, prev.viewport, `${what}: the rectangle moved`);
    }
    prev = L;
  }
});

test('moving a node through the store moves its minimap rect to its new position', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const view = fitView(boundsOf(rectsOf(model)), SIZE);
  const id = model.graph.nodes[0].id;
  const pos = model.graph.nodes[0].position;
  const before = minimapLayout(rectsOf(store.getModel()), view, SIZE).nodes[0];
  const r = store.dispatch({ type: 'NODE_MOVE', nodeId: id, position: { x: pos.x + 48,
    y: pos.y + 16 } });
  assert.ok(r.ok, r.reason);
  const L = minimapLayout(rectsOf(store.getModel()), view, SIZE);
  assertReflects(L, rectsOf(store.getModel()), view, SIZE, 'after NODE_MOVE');
  const a = L.nodes.find((n) => n.id === id);
  near(a.x, (pos.x + 48) * L.scale + L.ox, 'moved x');
  near(a.y, (pos.y + 16) * L.scale + L.oy, 'moved y');
  assert.notDeepStrictEqual({ x: a.x, y: a.y }, { x: before.x, y: before.y });
});

test('a minimap press or drag centres the viewport on the logical point under it', () => {
  const rects = rectsOf(templateModel(REFERENCE_TEMPLATE_ID));
  const view = zoomAt(fitView(boundsOf(rects), SIZE), 2, 200, 150);
  const L = minimapLayout(rects, view, SIZE);
  // Pressing on the rectangle's own centre keeps the view.
  const c = { x: L.viewport.x + L.viewport.w / 2, y: L.viewport.y + L.viewport.h / 2 };
  viewsEqual(minimapPointView(L, view, SIZE, c.x, c.y), view, 'press on the centre');
  for (const [mx, my] of [[20, 30], [150, 90], [L.map.w / 2, L.map.h / 2]]) {
    const v = minimapPointView(L, view, SIZE, mx, my);
    assert.strictEqual(v.zoom, view.zoom, 'the zoom is kept');
    const p = minimapToGraph(L, mx, my);
    const centre = screenToGraph(v, SIZE.w / 2, SIZE.h / 2);
    near(centre.x, p.x, 'centre x', 1e-6);
    near(centre.y, p.y, 'centre y', 1e-6);
    // In the same layout the rectangle's centre is now the pressed point.
    const vis = visibleRect(v, SIZE);
    near((vis.x + vis.w / 2) * L.scale + L.ox, mx, 'rectangle centre x', 1e-6);
    near((vis.y + vis.h / 2) * L.scale + L.oy, my, 'rectangle centre y', 1e-6);
  }
  // A drag past the edge stops at it.
  viewsEqual(minimapPointView(L, view, SIZE, -50, L.map.h + 40),
    minimapPointView(L, view, SIZE, 0, L.map.h), 'clamped to the map');
  viewsEqual(centerViewOn(view, SIZE, screenToGraph(view, SIZE.w / 2, SIZE.h / 2)), view,
    'centerViewOn of the current centre');
});

test('a minimap key maps to the same viewport as the pointer at the point it stands for', () => {
  const rects = rectsOf(templateModel(REFERENCE_TEMPLATE_ID));
  const view = zoomAt(fitView(boundsOf(rects), SIZE), 1.6, 120, 120);
  const L = minimapLayout(rects, view, SIZE);
  const c = { x: L.viewport.x + L.viewport.w / 2, y: L.viewport.y + L.viewport.h / 2 };
  const step = MINIMAP_KEY_STEP_PX;
  const big = MINIMAP_KEY_STEP_PX * NUDGE_LARGE;
  const cases = [
    ['ArrowLeft', false, c.x - step, c.y], ['ArrowRight', false, c.x + step, c.y],
    ['ArrowUp', false, c.x, c.y - step], ['ArrowDown', false, c.x, c.y + step],
    ['ArrowLeft', true, c.x - big, c.y], ['ArrowRight', true, c.x + big, c.y],
    ['ArrowUp', true, c.x, c.y - big], ['ArrowDown', true, c.x, c.y + big],
  ];
  for (const [key, shift, mx, my] of cases) {
    const t = minimapKeyTarget(L, key, shift);
    near(t.x, mx, `${key}${shift ? '+Shift' : ''} target x`);
    near(t.y, my, `${key}${shift ? '+Shift' : ''} target y`);
    const byKey = minimapKeyView(L, view, SIZE, key, shift);
    const byPointer = minimapPointView(L, view, SIZE, mx, my);
    assert.deepStrictEqual(byKey, byPointer, `${key}${shift ? '+Shift' : ''}: key = pointer`);
    // The rectangle moved by exactly the step, in minimap px, in the same layout.
    const vis = visibleRect(byKey, SIZE);
    near(vis.x * L.scale + L.ox - L.viewport.x, mx - c.x, `${key} moved x`, 1e-6);
    near(vis.y * L.scale + L.oy - L.viewport.y, my - c.y, `${key} moved y`, 1e-6);
  }
  // Home: the centre of the graph, which a pointer press there also gives.
  const g = boundsOf(rects);
  const home = { x: (g.x + g.w / 2) * L.scale + L.ox, y: (g.y + g.h / 2) * L.scale + L.oy };
  assert.deepStrictEqual(minimapKeyView(L, view, SIZE, 'Home'),
    minimapPointView(L, view, SIZE, home.x, home.y), 'Home = pointer on the graph centre');
  const centred = screenToGraph(minimapKeyView(L, view, SIZE, 'Home'), SIZE.w / 2, SIZE.h / 2);
  near(centred.x, g.x + g.w / 2, 'Home centres x', 1e-6);
  near(centred.y, g.y + g.h / 2, 'Home centres y', 1e-6);
  // Other keys are not the minimap's.
  for (const key of ['Enter', 'a', ' ', 'End', 'Tab']) {
    assert.strictEqual(minimapKeyView(L, view, SIZE, key), null, key);
  }
  // An empty graph: Home is the map's centre, the view stays where it is.
  const E = minimapLayout([], view, SIZE);
  assert.deepStrictEqual(minimapKeyTarget(E, 'Home'), { x: E.map.w / 2, y: E.map.h / 2 });
  viewsEqual(minimapKeyView(E, view, SIZE, 'Home'), view, 'empty graph Home');
});

test('repeated keys walk the viewport the way repeated pointer presses do', () => {
  const rects = rectsOf(templateModel(REFERENCE_TEMPLATE_ID));
  let byKey = fitView(boundsOf(rects), SIZE);
  let byPointer = byKey;
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home']) {
    const Lk = minimapLayout(rects, byKey, SIZE);
    byKey = minimapKeyView(Lk, byKey, SIZE, key, key === 'ArrowDown');
    const Lp = minimapLayout(rects, byPointer, SIZE);
    const t = minimapKeyTarget(Lp, key, key === 'ArrowDown');
    byPointer = minimapPointView(Lp, byPointer, SIZE, t.x, t.y);
    assert.deepStrictEqual(byKey, byPointer, `after ${key}`);
    assertReflects(minimapLayout(rects, byKey, SIZE), rects, byKey, SIZE, `after ${key}`);
  }
});

test('the minimap is view state only: it never changes the model', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const graph0 = store.getModel().graph;
  const timeline0 = store.getModel().timeline;
  const info0 = store.debugInfo();
  const rects = deepFreeze(rectsOf(store.getModel()));
  const size = deepFreeze({ ...SIZE });
  let view = deepFreeze(fitView(boundsOf(rects), size));
  // Frozen inputs: a minimap function that wrote to them would throw in strict mode.
  for (const step of ['press', 'ArrowRight', 'ArrowDown', 'Home', 'drag']) {
    const L = deepFreeze(minimapLayout(rects, view, size));
    const next = step === 'press' ? minimapPointView(L, view, size, 30, 40)
      : step === 'drag' ? minimapPointView(L, view, size, 150, 100)
        : minimapKeyView(L, view, size, step, false);
    // What the editor does with it: one VIEW_SET, as at the end of a canvas pan.
    const r = store.dispatch({ type: 'VIEW_SET', view: { graph: { ...next } } });
    assert.ok(r.ok, r.reason);
    assert.strictEqual(r.changed, false, `${step}: a view action changes nothing semantic`);
    view = deepFreeze({ ...store.getModel().view.graph });
    viewsEqual(view, next, `${step}: the store keeps the minimap's view`);
  }
  const info1 = store.debugInfo();
  assert.strictEqual(store.getModel().graph, graph0, 'the graph is the same object');
  assert.strictEqual(store.getModel().timeline, timeline0, 'the timeline is the same object');
  assert.strictEqual(info1.revision, info0.revision, 'no revision bump');
  assert.strictEqual(info1.undoDepth, info0.undoDepth, 'nothing to undo');
  assert.strictEqual(info1.redoDepth, info0.redoDepth);
  // The module holds no store and dispatches nothing: it only hands a view to the editor.
  const src = readFileSync(new URL('../../src/js/ui/studio/graph-minimap.js', import.meta.url),
    'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /\bdispatch\b|\bstore\b|\bbeginGesture\b/,
    'graph-minimap.js does not touch the store');
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/studio\//, 'graph-minimap.js imports no model code');
});
