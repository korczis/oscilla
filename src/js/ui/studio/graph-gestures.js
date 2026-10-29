// Studio graph pointer gestures (spec §56-§68, §118-§119, §137-§139, §185, §246-§247; plan
// K006): the pointer, wheel and tap-connect handling of the graph editor, moved out of
// graph-editor.js. The editor owns the DOM, the view and the render; this module owns the one
// running gesture, the tap-connect source and the live connection feedback, and changes the model
// only by store actions at gesture end (§61).
//
//   createGraphGestures(ctx) -> { dragging(id), kind(), inTap(), refresh(), startTapConnect(from),
//     cancelTransient(), cancel(), destroy() }
//     ctx: { host, viewport, preview, marquee, banner: { el, text, cancel }, nodeEls, edgeEls,
//            store, registry, svc, view(), setLocalView(v), commitView(now), nodeRects(),
//            anchorOf(nodeId, key), routeEdge(entry), routeAll(), render(), clientToGraph(x, y),
//            isOverViewport(x, y), onPress() }
//
// Pointer model (decision, docs in tests/browser/v31-studio-graph.cjs): mouse/pen — drag a node
// to move it (snap to the 8-unit grid; Alt disables snapping), drag from an output port to draw
// a cable, drag on blank canvas to pan, Shift/Ctrl/Cmd + drag on blank canvas for rectangle
// selection, middle-button drag pans, wheel zooms at the pointer, double-click blank canvas opens
// the quick-add picker. Touch — one finger on blank canvas pans, two fingers pinch-zoom, a tap on
// an output port starts tap-connect mode (no precision cable drag needed on phones, §137-§138).
// A press without movement past DRAG_THRESHOLD_PX is a click/tap. Every gesture uses pointer
// capture; pointercancel, lostpointercapture and window blur cancel it cleanly (§246-§247).
// Performance (§61-§62, §146-§147): a node drag moves only the dragged node elements and the
// cables attached to them, coalesced in requestAnimationFrame (visual only: rAF never schedules
// audio); nothing is dispatched until the gesture ends.

import { announceAction } from '../../studio/a11y.js';
import {
  GRID, cablePath, dragPosition, idsInRect, mergeSelection, normalizeRect, panBy, pastThreshold,
  pinchView, screenToGraph, toggleInSelection, zoomAt,
} from './graph-geometry.js';
import { connectingText, connectionTargets } from './graph-view.js';
import { setText } from './graph-dom.js';

export function createGraphGestures(ctx) {
  const { host, viewport, preview, marquee, nodeEls, edgeEls, store, registry, svc } = ctx;
  const { el: banner, text: bannerText, cancel: bannerCancel } = ctx.banner;
  let gesture = null;
  let tap = null; // { from, targets }
  let targets = null; // Map 'node\0port' -> verdict during a cable gesture / tap mode
  let rafId = 0;
  let pendingDrag = null;
  const pointers = new Map(); // touch pointers for pinch

  const model = () => store.getModel();
  const selection = () => store.getSelection();
  const announce = (text, opts) => { if (text) svc.announce(text, opts); };
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });

  // ---------------------------------------------------------------- connection feedback
  const tkey = (node, port) => `${node}\u0000${port}`;

  function refreshTargets(from) {
    targets = new Map(connectionTargets(model(), from, registry).map((t) => [tkey(t.node, t.port),
      t]));
    for (const [id, entry] of nodeEls) {
      for (const [key, pe] of entry.ports) {
        if (!key.startsWith('in:')) {
          pe.classList.toggle('is-source', id === from.node && key === `out:${from.port}`);
          continue;
        }
        const t = targets.get(tkey(id, key.slice(3)));
        pe.classList.toggle('is-compatible', !!(t && t.allowed));
        pe.classList.toggle('is-incompatible', !!(t && !t.allowed));
        if (t && !t.allowed) pe.setAttribute('title', t.reason);
        else if (t) pe.setAttribute('title', `Connect to ${t.label}`);
      }
    }
    host.classList.add('is-connecting');
  }

  function clearTargets() {
    targets = null;
    for (const entry of nodeEls.values()) {
      for (const pe of entry.ports.values()) {
        pe.classList.remove('is-compatible', 'is-incompatible', 'is-source', 'is-hover');
      }
    }
    host.classList.remove('is-connecting');
    // Restore the descriptive port titles.
    for (const entry of nodeEls.values()) entry.sig = `${entry.sig}~`;
  }

  function showBanner(text, cancellable) {
    banner.hidden = !text;
    setText(bannerText, text || '');
    bannerCancel.hidden = !cancellable;
  }

  function connect(from, to) {
    const r = store.dispatch({ type: 'EDGE_ADD', from, to });
    if (r.ok) {
      announce(announceAction(r));
      select({ edges: r.created && r.created.edges ? r.created.edges : [] });
    } else announce(announceAction(r), { assertive: true });
    return r;
  }

  /** The first compatible input of a node for a cable dropped on its body. */
  function bestTargetOn(nodeId) {
    if (!targets) return null;
    let firstReason = null;
    for (const t of targets.values()) {
      if (t.node !== nodeId) continue;
      if (t.allowed) return t;
      if (!firstReason) firstReason = t;
    }
    return firstReason;
  }

  function startTapConnect(from) {
    cancelGestureLocal();
    tap = { from };
    refreshTargets(from);
    const text = `${connectingText(model(), from, registry)}: choose a highlighted input.`;
    showBanner(text, true);
    announce(text);
  }

  function endTapConnect() {
    if (!tap) return false;
    tap = null;
    clearTargets();
    showBanner('', false);
    ctx.render();
    return true;
  }
  bannerCancel.addEventListener('click', () => {
    endTapConnect();
    announce('Connection cancelled');
    viewport.focus();
  });

  // ---------------------------------------------------------------- pointer
  function local(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function capture(e) {
    try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  }

  function portUnder(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const pe = el && el.closest ? el.closest('.osc-sg-port') : null;
    const ne = el && el.closest ? el.closest('.osc-sg-node') : null;
    return { pe: pe && host.contains(pe) ? pe : null, ne: ne && host.contains(ne) ? ne : null };
  }

  function onPointerDown(e) {
    if (e.target.closest('.osc-sg-controls, .osc-sg-banner')) return;
    ctx.onPress();
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        cancelGestureLocal();
        capture(e);
        gesture = { kind: 'pinch', id: e.pointerId, last: [...pointers.values()] };
        return;
      }
      if (pointers.size > 2) return;
    }
    if (gesture) return;
    const middle = e.button === 1;
    if (!middle && e.button !== 0) return;
    const pt = local(e);
    const base = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
      pointerType: e.pointerType };
    const pe = e.target.closest('.osc-sg-port');
    const ne = e.target.closest('.osc-sg-node');
    const ee = e.target.closest('.osc-sg-edge');
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (middle) {
      e.preventDefault();
      capture(e);
      gesture = { ...base, kind: 'pan', start: { ...ctx.view() } };
      return;
    }
    if (tap) {
      e.preventDefault();
      if (pe && pe.dataset.dir === 'in' && ne) {
        const to = { node: ne.dataset.nodeId, port: pe.dataset.port };
        const t = targets && targets.get(tkey(to.node, to.port));
        if (t && !t.allowed) {
          announce(t.reason, { assertive: true });
          showBanner(t.reason, true);
          return;
        }
        const from = tap.from;
        endTapConnect();
        connect(from, to);
      } else if (pe && pe.dataset.dir === 'out' && ne) {
        startTapConnect({ node: ne.dataset.nodeId, port: pe.dataset.port });
      } else if (ne) {
        const t = bestTargetOn(ne.dataset.nodeId);
        if (t && t.allowed) {
          const from = tap.from;
          endTapConnect();
          connect(from, { node: t.node, port: t.port });
        } else if (t) {
          announce(t.reason, { assertive: true });
          showBanner(t.reason, true);
        }
      } else {
        endTapConnect();
        announce('Connection cancelled');
      }
      return;
    }
    if (pe && ne && pe.dataset.dir === 'out') {
      e.preventDefault();
      capture(e);
      gesture = { ...base, kind: 'port-press', from: { node: ne.dataset.nodeId,
        port: pe.dataset.port } };
      return;
    }
    if (pe && ne && pe.dataset.dir === 'in') {
      e.preventDefault();
      const nodeId = ne.dataset.nodeId;
      const edge = model().graph.edges.find((x) => x.to.node === nodeId
        && x.to.port === pe.dataset.port);
      select(edge ? { edges: [edge.id] } : { nodes: [nodeId] });
      return;
    }
    if (ne) {
      capture(e);
      gesture = { ...base, kind: 'node-press', nodeId: ne.dataset.nodeId, additive,
        noSnap: e.altKey };
      return;
    }
    if (ee) {
      e.preventDefault();
      const id = ee.getAttribute('data-edge-id');
      const cur = selection().edges;
      select({ edges: additive ? toggleInSelection(cur, id) : [id] });
      viewport.focus({ preventScroll: true });
      return;
    }
    // Blank canvas.
    e.preventDefault();
    viewport.focus({ preventScroll: true });
    capture(e);
    if (additive && e.pointerType !== 'touch') {
      gesture = { ...base, kind: 'marquee', start: pt, base: selection().nodes.slice(),
        additive: e.ctrlKey || e.metaKey || e.shiftKey };
    } else {
      gesture = { ...base, kind: 'pan', start: { ...ctx.view() } };
    }
  }

  function scheduleDrag(fn) {
    pendingDrag = fn;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const f = pendingDrag;
      pendingDrag = null;
      if (f) f();
    });
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, local(e));
    }
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) return;
      const next = [...pointers.values()].slice(0, 2);
      ctx.setLocalView(pinchView(ctx.view(), gesture.last, next));
      gesture.last = next;
      return;
    }
    if (e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (!gesture.moved && !pastThreshold(dx, dy)) return;
    const first = !gesture.moved;
    gesture.moved = true;
    switch (gesture.kind) {
      case 'pan':
        ctx.setLocalView(panBy(gesture.start, dx, dy));
        break;
      case 'port-press':
        gesture.kind = 'cable';
        refreshTargets(gesture.from);
        showBanner(connectingText(model(), gesture.from, registry), false);
        // fallthrough
      case 'cable': {
        const a = ctx.anchorOf(gesture.from.node, `out:${gesture.from.port}`);
        const p = ctx.clientToGraph(e.clientX, e.clientY);
        if (a) preview.setAttribute('d', cablePath(a.x, a.y, p.x, p.y));
        const { pe, ne } = portUnder(e.clientX, e.clientY);
        for (const entry of nodeEls.values()) {
          for (const x of entry.ports.values()) x.classList.toggle('is-hover', x === pe);
        }
        let text = connectingText(model(), gesture.from, registry);
        let t = null;
        if (pe && ne && pe.dataset.dir === 'in') t = targets.get(tkey(ne.dataset.nodeId, pe.dataset.port));
        else if (ne && ne.dataset.nodeId !== gesture.from.node) t = bestTargetOn(ne.dataset.nodeId);
        if (t) text = t.allowed ? `Release to connect to ${t.label}` : t.reason;
        showBanner(text, false);
        break;
      }
      case 'node-press': {
        const id = gesture.nodeId;
        let ids = selection().nodes;
        if (!ids.includes(id)) {
          ids = gesture.additive ? [...ids, id] : [id];
          select({ nodes: ids });
        }
        const m = model();
        const starts = new Map();
        for (const n of m.graph.nodes) if (ids.includes(n.id)) starts.set(n.id, { ...n.position });
        gesture.kind = 'node-drag';
        gesture.starts = starts;
        for (const nid of starts.keys()) {
          const en = nodeEls.get(nid);
          if (en) en.el.classList.add('is-dragging');
        }
        // fallthrough
      }
      // eslint-disable-next-line no-fallthrough
      case 'node-drag': {
        const g = gesture;
        scheduleDrag(() => dragFrame(g, dx, dy));
        break;
      }
      case 'marquee': {
        const view = ctx.view();
        const p = local(e);
        const r = normalizeRect(gesture.start.x, gesture.start.y, p.x, p.y);
        marquee.hidden = false;
        marquee.style.transform = `translate(${r.x}px, ${r.y}px)`;
        marquee.style.width = `${r.w}px`;
        marquee.style.height = `${r.h}px`;
        const a = screenToGraph(view, r.x, r.y);
        const lr = { x: a.x, y: a.y, w: r.w / view.zoom, h: r.h / view.zoom };
        const hits = new Set(idsInRect(ctx.nodeRects(), lr));
        for (const [id, entry] of nodeEls) entry.el.classList.toggle('is-marquee', hits.has(id));
        gesture.hits = [...hits];
        break;
      }
      default:
        break;
    }
    if (first && gesture && gesture.kind === 'pan') host.classList.add('is-panning');
  }

  function dragDelta(g, dx, dy) {
    const primary = g.starts.get(g.nodeId) || g.starts.values().next().value;
    const p = dragPosition(primary, dx, dy, ctx.view().zoom, g.noSnap ? 0 : GRID);
    return { x: p.x - primary.x, y: p.y - primary.y };
  }

  function dragFrame(g, dx, dy) {
    if (gesture !== g) return;
    const d = dragDelta(g, dx, dy);
    g.delta = d;
    const moving = new Set(g.starts.keys());
    for (const [id, st] of g.starts) {
      const entry = nodeEls.get(id);
      if (!entry) continue;
      entry.pos = { x: st.x + d.x, y: st.y + d.y };
      entry.el.style.transform = `translate(${entry.pos.x}px, ${entry.pos.y}px)`;
    }
    // Only the cables attached to moving nodes (§147).
    for (const entry of edgeEls.values()) {
      const e = entry.edge;
      if (moving.has(e.from.node) || moving.has(e.to.node)) ctx.routeEdge(entry);
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) {
        gesture = null;
        ctx.commitView(true);
      }
      return;
    }
    if (e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    host.classList.remove('is-panning');
    switch (g.kind) {
      case 'pan':
        if (g.moved) ctx.commitView(true);
        else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
          if (selection().nodes.length || selection().edges.length) select({});
        }
        break;
      case 'port-press':
        startTapConnect(g.from);
        break;
      case 'cable': {
        preview.setAttribute('d', '');
        const { pe, ne } = portUnder(e.clientX, e.clientY);
        let t = null;
        if (pe && ne && pe.dataset.dir === 'in') t = targets.get(tkey(ne.dataset.nodeId, pe.dataset.port));
        else if (ne && ne.dataset.nodeId !== g.from.node) t = bestTargetOn(ne.dataset.nodeId);
        clearTargets();
        showBanner('', false);
        if (t && t.allowed) connect(g.from, { node: t.node, port: t.port });
        else if (t) announce(t.reason, { assertive: true });
        else if (!ne && ctx.isOverViewport(e.clientX, e.clientY)) {
          // Create-node-from-cable (§66): a picker of the types that accept this cable.
          svc.onQuickAdd({ at: ctx.clientToGraph(e.clientX, e.clientY), from: g.from });
        } else announce('Connection cancelled');
        ctx.render();
        break;
      }
      case 'node-press': {
        const id = g.nodeId;
        const cur = selection().nodes;
        select({ nodes: g.additive ? toggleInSelection(cur, id) : [id] });
        break;
      }
      case 'node-drag': {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
          pendingDrag = null;
        }
        const d = dragDelta(g, e.clientX - g.x0, e.clientY - g.y0);
        for (const id of g.starts.keys()) {
          const en = nodeEls.get(id);
          if (en) en.el.classList.remove('is-dragging');
        }
        const ids = [...g.starts.keys()];
        if (d.x || d.y) {
          const r = ids.length === 1
            ? store.dispatch({ type: 'NODE_MOVE', nodeId: ids[0],
              position: { x: g.starts.get(ids[0]).x + d.x, y: g.starts.get(ids[0]).y + d.y } })
            : store.dispatch({ type: 'NODE_MOVE', nodeIds: ids, delta: d });
          if (r.ok) announce(announceAction(r));
          else announce(announceAction(r), { assertive: true });
        }
        ctx.render();
        break;
      }
      case 'marquee': {
        marquee.hidden = true;
        for (const entry of nodeEls.values()) entry.el.classList.remove('is-marquee');
        if (g.moved) select({ nodes: mergeSelection(g.base, g.hits || [], g.additive) });
        break;
      }
      default:
        break;
    }
  }

  /** Abandon the running pointer gesture without committing anything (cancel, blur). */
  function cancelGestureLocal() {
    const g = gesture;
    gesture = null;
    host.classList.remove('is-panning');
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      pendingDrag = null;
    }
    if (!g) return false;
    if (g.kind === 'node-drag') {
      for (const [id, st] of g.starts) {
        const en = nodeEls.get(id);
        if (!en) continue;
        en.el.classList.remove('is-dragging');
        en.pos = { ...st };
        en.el.style.transform = `translate(${st.x}px, ${st.y}px)`;
      }
      ctx.routeAll();
    } else if (g.kind === 'cable') {
      preview.setAttribute('d', '');
      clearTargets();
      showBanner('', false);
      ctx.render();
    } else if (g.kind === 'marquee') {
      marquee.hidden = true;
      for (const entry of nodeEls.values()) entry.el.classList.remove('is-marquee');
    } else if (g.kind === 'pan' || g.kind === 'pinch') {
      ctx.commitView(true);
    }
    return true;
  }

  function onCancel(e) {
    if (e && e.pointerType === 'touch') pointers.delete(e.pointerId);
    if (gesture && (!e || gesture.kind === 'pinch' || e.pointerId === gesture.id)) {
      if (cancelGestureLocal()) announce('Gesture cancelled');
    }
  }

  function onWheel(e) {
    if (gesture) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    const p = local(e);
    ctx.setView(zoomAt(ctx.view(), Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y));
  }

  function onDblClick(e) {
    if (e.target.closest('.osc-sg-node, .osc-sg-edge, .osc-sg-controls, .osc-sg-banner')) return;
    svc.onQuickAdd({ at: ctx.clientToGraph(e.clientX, e.clientY), from: null });
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onCancel);
  viewport.addEventListener('lostpointercapture', (e) => {
    if (gesture && gesture.id === e.pointerId && gesture.kind !== 'pinch') onCancel(e);
  });
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('dblclick', onDblClick);
  const onBlur = () => onCancel(null);
  window.addEventListener('blur', onBlur);

  return {
    /** True while a node drag moves `id` (the render keeps its preview position). */
    dragging: (id) => !!(gesture && gesture.kind === 'node-drag' && gesture.starts.has(id)),
    kind: () => (gesture ? gesture.kind : null),
    inTap: () => !!tap,
    /** Re-judge the tap-connect targets after a render. */
    refresh() {
      if (tap) refreshTargets(tap.from);
    },
    startTapConnect,
    cancel: cancelGestureLocal,
    cancelTransient() {
      if (gesture) {
        cancelGestureLocal();
        announce('Gesture cancelled');
        return 'cancel-gesture';
      }
      if (tap) {
        endTapConnect();
        announce('Connection cancelled');
        return 'cancel-selection-mode';
      }
      return null;
    },
    destroy() {
      cancelGestureLocal();
      window.removeEventListener('blur', onBlur);
    },
  };
}
