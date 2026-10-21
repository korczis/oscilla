// Studio graph minimap (spec §153; plan V602): the whole graph and the viewport rectangle, drawn
// small. A press or a drag on it moves the viewport so that its centre lies under the pointer; the
// arrow keys move the viewport rectangle by MINIMAP_KEY_STEP_PX minimap px (Shift: NUDGE_LARGE
// times that) and Home centres the graph, each through the same mapping as the pointer, so a key
// and a pointer at the same minimap point give the same viewport.
//
// The minimap is view state of the graph editor only: it reads node rectangles, the view and the
// viewport size, and hands back a view { panX, panY, zoom }. It holds no store and dispatches
// nothing; the editor applies the view as it does a pan (one VIEW_SET at gesture end, which is not
// undoable, bumps no revision and is never dirty, actions.js).
//
//   visibleRect(view, size) -> { x, y, w, h }      the logical rectangle the viewport shows
//   minimapLayout(rects, view, size, map?, padding?) -> { map, scale, ox, oy, bounds, graph,
//     nodes: [{ id, x, y, w, h }], viewport: { x, y, w, h } }    minimap px: m = logical * scale + o
//   minimapToGraph(layout, mx, my) -> logical point
//   centerViewOn(view, size, point) -> view       the same zoom, `point` at the viewport centre
//   minimapPointView(layout, view, size, mx, my) -> view    pointer at (mx, my), clamped to the map
//   minimapKeyTarget(layout, key, shift) -> { x, y } | null   the minimap point a key stands for
//   minimapKeyView(layout, view, size, key, shift) -> view | null
//   createMinimap(svc) -> { el, render(), setShown(on), isShown(), layout(), destroy() }
//     svc: { rects() -> [{ id, x, y, w, h }], view() -> view, size() -> { w, h },
//            setView(view, commit), commit() }
//
// Decisions: the bounds are those of the nodes and of the visible rectangle together, so the
// viewport rectangle never leaves the map; a pointer gesture keeps the layout of its press, so the
// map does not rescale under the pointer while it drags; the minimap is hidden until its toggle in
// the graph controls shows it (it then never covers nodes unasked, and the accepted Studio visual
// references keep their pixels).

import { NUDGE_LARGE, boundsOf, normalizeView, screenToGraph } from './graph-geometry.js';
import { h, s, setAttr } from './graph-dom.js';

/** CSS size of the minimap (the .osc-sg-minimap box of studio.css). */
export const MINIMAP_SIZE = Object.freeze({ w: 176, h: 112 });
export const MINIMAP_PADDING_PX = 6;
/** Minimap px one arrow key moves the viewport rectangle (Shift: NUDGE_LARGE times). */
export const MINIMAP_KEY_STEP_PX = 8;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const positive = (v) => (finite(v) && v > 0 ? v : 0);

/** The logical rectangle a viewport of `size` { w, h } px shows through `view`. */
export function visibleRect(view, size) {
  const v = normalizeView(view);
  const a = screenToGraph(v, 0, 0);
  return { x: a.x, y: a.y, w: positive(size && size.w) / v.zoom,
    h: positive(size && size.h) / v.zoom };
}

/**
 * The minimap of node rects { id, x, y, w, h } (logical) for `view` on a viewport of `size` px,
 * fitted and centred into `map` { w, h } px with `padding` px around it.
 */
export function minimapLayout(rects, view, size, map = MINIMAP_SIZE, padding = MINIMAP_PADDING_PX) {
  const nodes = (rects || []).filter((r) => r && [r.x, r.y, r.w, r.h].every(finite));
  const vis = visibleRect(view, size);
  const graph = boundsOf(nodes);
  const bounds = boundsOf([graph, vis.w > 0 && vis.h > 0 ? vis : null])
    || { x: vis.x, y: vis.y, w: 1, h: 1 };
  const mw = positive(map && map.w) || MINIMAP_SIZE.w;
  const mh = positive(map && map.h) || MINIMAP_SIZE.h;
  const scale = Math.min(Math.max(1, mw - 2 * padding) / Math.max(1, bounds.w),
    Math.max(1, mh - 2 * padding) / Math.max(1, bounds.h));
  const ox = mw / 2 - (bounds.x + bounds.w / 2) * scale;
  const oy = mh / 2 - (bounds.y + bounds.h / 2) * scale;
  const toMap = (r) => ({ x: r.x * scale + ox, y: r.y * scale + oy, w: r.w * scale,
    h: r.h * scale });
  return { map: { w: mw, h: mh }, scale, ox, oy, bounds, graph,
    nodes: nodes.map((r) => ({ id: r.id, ...toMap(r) })), viewport: toMap(vis) };
}

/** Minimap point (px) -> logical point. */
export function minimapToGraph(layout, mx, my) {
  return { x: (mx - layout.ox) / layout.scale, y: (my - layout.oy) / layout.scale };
}

/** The view of the same zoom with logical `point` at the centre of a viewport of `size` px. */
export function centerViewOn(view, size, point) {
  const v = normalizeView(view);
  return { panX: positive(size && size.w) / 2 - point.x * v.zoom,
    panY: positive(size && size.h) / 2 - point.y * v.zoom, zoom: v.zoom };
}

/** The view a minimap press or drag at (mx, my) asks for; the point is clamped to the map. */
export function minimapPointView(layout, view, size, mx, my) {
  const x = Math.min(layout.map.w, Math.max(0, finite(mx) ? mx : 0));
  const y = Math.min(layout.map.h, Math.max(0, finite(my) ? my : 0));
  return centerViewOn(view, size, minimapToGraph(layout, x, y));
}

/**
 * The minimap point a key stands for: an arrow moves the viewport rectangle's centre by
 * MINIMAP_KEY_STEP_PX (Shift: NUDGE_LARGE times), Home is the centre of the graph (of the map
 * when there are no nodes); null for any other key.
 */
export function minimapKeyTarget(layout, key, shift = false) {
  const step = MINIMAP_KEY_STEP_PX * (shift ? NUDGE_LARGE : 1);
  const vp = layout.viewport;
  const cx = vp.x + vp.w / 2;
  const cy = vp.y + vp.h / 2;
  switch (key) {
    case 'ArrowLeft': return { x: cx - step, y: cy };
    case 'ArrowRight': return { x: cx + step, y: cy };
    case 'ArrowUp': return { x: cx, y: cy - step };
    case 'ArrowDown': return { x: cx, y: cy + step };
    case 'Home': {
      const g = layout.graph;
      if (!g) return { x: layout.map.w / 2, y: layout.map.h / 2 };
      return { x: (g.x + g.w / 2) * layout.scale + layout.ox,
        y: (g.y + g.h / 2) * layout.scale + layout.oy };
    }
    default: return null;
  }
}

/** The view a minimap key asks for (the pointer mapping at minimapKeyTarget), or null. */
export function minimapKeyView(layout, view, size, key, shift = false) {
  const t = minimapKeyTarget(layout, key, shift);
  return t ? minimapPointView(layout, view, size, t.x, t.y) : null;
}

const round = (n) => String(Math.round(n * 100) / 100 + 0);

/** The minimap element of a graph editor (see the header for svc). */
export function createMinimap(svc) {
  const nodesG = s('g', { class: 'osc-sg-mm-nodes' });
  const frame = s('rect', { class: 'osc-sg-mm-view', rx: '1' });
  const svg = s('svg', { class: 'osc-sg-mm-svg', 'aria-hidden': 'true', focusable: 'false' },
    [nodesG, frame]);
  const el = h('div', { class: 'osc-sg-minimap', tabindex: '0', role: 'group',
    'aria-roledescription': 'minimap', 'data-osc': 'studio.graph.minimap', hidden: true,
    'aria-label': 'Graph minimap: press or drag to move the view there; arrow keys move it '
      + '(Shift: 4 steps), Home centres the graph' }, [svg]);
  let shown = false;
  let drag = null; // { id, layout }
  let last = null;
  const rectEls = [];

  function compute() {
    const map = { w: el.clientWidth || MINIMAP_SIZE.w, h: el.clientHeight || MINIMAP_SIZE.h };
    return minimapLayout(svc.rects(), svc.view(), svc.size(), map);
  }

  function render() {
    if (!shown) return;
    const L = drag ? drag.layout : compute();
    last = L;
    setAttr(svg, 'viewBox', `0 0 ${L.map.w} ${L.map.h}`);
    while (rectEls.length < L.nodes.length) {
      const r = s('rect', { class: 'osc-sg-mm-node' });
      nodesG.appendChild(r);
      rectEls.push(r);
    }
    while (rectEls.length > L.nodes.length) rectEls.pop().remove();
    L.nodes.forEach((n, i) => {
      const r = rectEls[i];
      setAttr(r, 'data-node-id', n.id);
      setAttr(r, 'x', round(n.x));
      setAttr(r, 'y', round(n.y));
      setAttr(r, 'width', round(Math.max(1, n.w)));
      setAttr(r, 'height', round(Math.max(1, n.h)));
    });
    const v = L.viewport;
    setAttr(frame, 'x', round(v.x));
    setAttr(frame, 'y', round(v.y));
    setAttr(frame, 'width', round(Math.max(1, v.w)));
    setAttr(frame, 'height', round(Math.max(1, v.h)));
  }

  /** The pointer in minimap px (the CSS box may scale the map). */
  function local(e, L) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (r.width ? L.map.w / r.width : 1),
      y: (e.clientY - r.top) * (r.height ? L.map.h / r.height : 1) };
  }

  function moveTo(e) {
    const p = local(e, drag.layout);
    svc.setView(minimapPointView(drag.layout, svc.view(), svc.size(), p.x, p.y), false);
  }

  function onDown(e) {
    if (drag || (e.button !== 0 && e.pointerType !== 'touch')) return;
    e.preventDefault();
    e.stopPropagation();
    el.focus({ preventScroll: true });
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    drag = { id: e.pointerId, layout: last || compute() };
    moveTo(e);
  }

  function onMove(e) {
    if (drag && e.pointerId === drag.id) moveTo(e);
  }

  function onEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    svc.commit();
    render();
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = minimapKeyView(last || compute(), svc.view(), svc.size(), e.key, e.shiftKey);
    if (!v) return;
    // The Studio's own arrow keys (nudge, pan) must not act on the same press.
    e.preventDefault();
    e.stopPropagation();
    svc.setView(v, true);
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onEnd);
  el.addEventListener('pointercancel', onEnd);
  el.addEventListener('lostpointercapture', onEnd);
  el.addEventListener('keydown', onKey);

  return {
    el,
    render,
    setShown(on) {
      shown = !!on;
      el.hidden = !shown;
      if (!shown) drag = null;
      render();
      return shown;
    },
    isShown: () => shown,
    layout: () => (shown ? compute() : null),
    destroy() {
      drag = null;
      el.remove();
    },
  };
}
