// Studio graph editor geometry (spec §56-§62, §67-§68, §118-§119, §140, §149-§151). Pure: numbers
// in, numbers out; no DOM, no clock. The editor (graph-editor.js) keeps the logical coordinates
// of the model and maps them to the screen through one viewport { panX, panY, zoom }:
//
//   screen = logical * zoom + pan          (screen: px relative to the viewport element)
//
// Decisions (recorded here; candidates for Majordomus decisions, docs/v31/studio-model.md):
//   - graph coordinate unit: the model's logical unit, 1 unit = 1 CSS px at zoom 1
//   - zoom bounds 0.25x-2.5x (ZOOM_MIN/ZOOM_MAX): below 0.25 the 10 px node titles are not
//     legible on a 1x display, above 2.5 a 168-unit node fills a phone screen
//   - default grid 8 units, snapping on (GRID); the model stores coordinates, never grid indices
//   - pointer-drag threshold 4 px (DRAG_THRESHOLD_PX): below it a press is a click / tap
//   - connection hit width 12 px fine pointer, 24 px coarse pointer (CABLE_HIT_PX)
//   - nudge: one grid step, Shift x4 (§125, §140)

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;
/** One zoom button / key step. */
export const ZOOM_STEP = 1.2;
/** Fit never enlarges past this (a single node does not fill the screen). */
export const FIT_MAX_ZOOM = 1.25;
export const FIT_PADDING_PX = 32;
export const GRID = 8;
export const NUDGE_LARGE = 4;
export const DRAG_THRESHOLD_PX = 4;
export const CABLE_HIT_PX = Object.freeze({ fine: 12, coarse: 24 });
/** Logical width of a node card (the CSS width of .osc-sg-node at zoom 1). */
export const NODE_WIDTH = 168;
/**
 * The smallest zoom a fit (Frame all, Frame selection) picks on a coarse pointer (V431 U9): a
 * port row is 26 units there (.osc-sg-port, studio.css coarse query), so each port target stays
 * at least 24 px tall on screen (WCAG 2.5.8) instead of about 10 px at a phone's frame-all
 * zoom. A graph that needs less is centred and the rest is a pan away.
 */
export const COARSE_FIT_MIN_ZOOM = 24 / 26;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The zoom clamped to [ZOOM_MIN, ZOOM_MAX]; a non-finite value becomes 1. */
export function clampZoom(z) {
  if (!finite(z) || z <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** A complete, finite viewport from a partial one. */
export function normalizeView(view) {
  const v = view || {};
  return { panX: finite(v.panX) ? v.panX : 0, panY: finite(v.panY) ? v.panY : 0,
    zoom: clampZoom(v.zoom) };
}

/** Screen point (px, relative to the viewport) → logical point. */
export function screenToGraph(view, x, y) {
  const v = normalizeView(view);
  return { x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom };
}

/** Logical point → screen point (px, relative to the viewport). */
export function graphToScreen(view, x, y) {
  const v = normalizeView(view);
  return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
}

/**
 * Zoom by `factor` keeping the logical point under the screen point (sx, sy) fixed (§58: zoom
 * centred on the pointer). The result is clamped; at a bound the view does not drift.
 */
export function zoomAt(view, factor, sx, sy) {
  const v = normalizeView(view);
  const zoom = clampZoom(v.zoom * (finite(factor) && factor > 0 ? factor : 1));
  const k = zoom / v.zoom;
  return { panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k, zoom };
}

/** The view panned by (dx, dy) screen px. */
export function panBy(view, dx, dy) {
  const v = normalizeView(view);
  return { panX: v.panX + (finite(dx) ? dx : 0), panY: v.panY + (finite(dy) ? dy : 0),
    zoom: v.zoom };
}

/** Bounding box { x, y, w, h } of rects { x, y, w, h }; null for none. */
export function boundsOf(rects) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects || []) {
    if (!r || ![r.x, r.y, r.w, r.h].every(finite)) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The view that fits `bounds` (logical) into a viewport of `size` { w, h } px with `padding`
 * px around it, centred (§59-§60). Never zooms past `maxZoom` nor below `minZoom`; an empty
 * bounds centres the origin at zoom 1.
 */
export function fitView(bounds, size, { padding = FIT_PADDING_PX, maxZoom = FIT_MAX_ZOOM,
  minZoom = ZOOM_MIN } = {}) {
  const w = size && finite(size.w) ? size.w : 0;
  const h = size && finite(size.h) ? size.h : 0;
  if (!bounds || w <= 0 || h <= 0) return { panX: w / 2, panY: h / 2, zoom: 1 };
  const availW = Math.max(1, w - 2 * padding);
  const availH = Math.max(1, h - 2 * padding);
  const zoom = clampZoom(Math.max(minZoom, Math.min(maxZoom, availW / Math.max(1, bounds.w),
    availH / Math.max(1, bounds.h))));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { panX: w / 2 - cx * zoom, panY: h / 2 - cy * zoom, zoom };
}

/** v rounded to the nearest multiple of `grid` (grid <= 0: unchanged). */
export function snap(v, grid = GRID) {
  if (!(grid > 0)) return v;
  return Math.round(v / grid) * grid + 0; // + 0 turns -0 into 0
}

/** A point with both coordinates snapped. */
export function snapPoint(p, grid = GRID) {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/**
 * The SVG path of a cable from an output anchor (sx, sy) to an input anchor (tx, ty) (§67):
 * M sx sy C sx+dx sy, tx-dx ty, tx ty. The handle length grows with the horizontal distance and,
 * when the target lies left of the source, with the vertical distance too, so a backwards cable
 * loops out of the source and into the target instead of folding over itself.
 */
export function cablePath(sx, sy, tx, ty) {
  const ddx = tx - sx;
  const ddy = Math.abs(ty - sy);
  let dx = Math.max(40, Math.abs(ddx) / 2);
  if (ddx < 0) dx = Math.max(dx, Math.min(160, 40 + ddy / 2 + Math.abs(ddx) / 4));
  const r = (n) => Math.round(n * 100) / 100 + 0;
  return `M ${r(sx)} ${r(sy)} C ${r(sx + dx)} ${r(sy)}, ${r(tx - dx)} ${r(ty)}, ${r(tx)} ${r(ty)}`;
}

/** Half the arm length of the cross on a cable that carries nothing (logical units). */
export const CABLE_CROSS_HALF = 5;

/**
 * The cross drawn at the midpoint of a cablePath (the cubic's t = 0.5 point is the midpoint of
 * its two ends, since its control points mirror each other): an SVG path of two strokes.
 */
export function cableCross(sx, sy, tx, ty, half = CABLE_CROSS_HALF) {
  const r = (n) => Math.round(n * 100) / 100 + 0;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  return `M ${r(mx - half)} ${r(my - half)} L ${r(mx + half)} ${r(my + half)} `
    + `M ${r(mx - half)} ${r(my + half)} L ${r(mx + half)} ${r(my - half)}`;
}

/** { x, y, w, h } of the rectangle spanned by two corners (any order). */
export function normalizeRect(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0) };
}

/** True when two rects { x, y, w, h } intersect (touching edges do not count). */
export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Ids of the node rects { id, x, y, w, h } intersecting the logical rectangle (§119: rectangle
 * selection selects intersecting nodes), in the order given.
 */
export function idsInRect(rects, rect) {
  return (rects || []).filter((r) => rectsIntersect(r, rect)).map((r) => r.id);
}

/** Merge a rectangle selection with the selection it started from (additive with a modifier). */
export function mergeSelection(base, hits, additive) {
  if (!additive) return [...hits];
  const out = [...base];
  for (const id of hits) if (!out.includes(id)) out.push(id);
  return out;
}

/** Toggle `id` in a selection list (Shift / Cmd / Ctrl click, §118). */
export function toggleInSelection(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * The logical delta of an arrow key (§125, §140): one grid step, NUDGE_LARGE steps with Shift;
 * null for any other key.
 */
export function nudgeDelta(key, shift = false, grid = GRID) {
  const step = grid * (shift ? NUDGE_LARGE : 1);
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 };
    case 'ArrowRight': return { x: step, y: 0 };
    case 'ArrowUp': return { x: 0, y: -step };
    case 'ArrowDown': return { x: 0, y: step };
    default: return null;
  }
}

/** True once a pointer moved past the drag threshold (screen px). */
export function pastThreshold(dx, dy, threshold = DRAG_THRESHOLD_PX) {
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * The position of a dragged node: start + screen delta / zoom, snapped when `grid` > 0. The
 * drag commits exactly this (one NODE_MOVE at gesture end, §61).
 */
export function dragPosition(start, dxPx, dyPx, zoom, grid = GRID) {
  const z = clampZoom(zoom);
  return snapPoint({ x: start.x + dxPx / z, y: start.y + dyPx / z }, grid);
}

/** Two-pointer pinch: the new view from the previous and current pointer pairs. */
export function pinchView(view, prev, next) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const d0 = d(prev[0], prev[1]);
  const d1 = d(next[0], next[1]);
  const mid0 = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
  const mid1 = { x: (next[0].x + next[1].x) / 2, y: (next[0].y + next[1].y) / 2 };
  const zoomed = d0 > 0 ? zoomAt(view, d1 / d0, mid0.x, mid0.y) : normalizeView(view);
  return panBy(zoomed, mid1.x - mid0.x, mid1.y - mid0.y);
}

/** Zoom text for the toolbar: "100 %". */
export function zoomText(zoom) {
  return `${Math.round(clampZoom(zoom) * 100)} %`;
}
