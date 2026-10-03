// Studio graph editor (spec §53-§77, §118-§125, §137-§152, §168-§171, §245-§248; ADR 0034):
// custom HTML nodes and ONE SVG layer for the cables, rendered from the canonical StudioModel.
// No third-party editor (§53-§55). The editor holds only ephemeral view state (the viewport
// while a gesture runs, the drag preview, the tap-connect source); every semantic change is one
// store action at gesture end (§61): NODE_MOVE, EDGE_ADD, NODE_ADD, SELECTION_CHANGE, VIEW_SET.
//
//   createGraphEditor(host, svc) -> editor
//     svc: { store, registry, announce(text, { assertive }), status() -> Map, warnings() -> Map,
//            onQuickAdd({ at, from }), onConnectDialog(nodeId), onActivateNode(id) }
//   editor.render()                     project the model and selection (keyed, incremental)
//   editor.frameAll(), frameSelection(), zoomBy(f), panBy(dx, dy), setView(view)
//   editor.addNodeAt(type, at?, { connectFrom }) -> result     at: logical point (default centre)
//   editor.addNodeAtClient(type, clientX, clientY) -> bool      library drop (§63)
//   editor.isOverViewport(clientX, clientY), clientToGraph(x, y), centerPoint()
//   editor.deleteSelection(), copySelection(), cutSelection(), paste(), duplicateSelection(),
//   editor.selectAll(), nudge(key, large), endNudge()
//   editor.startTapConnect(from), cancelTransient() -> bool, hasGesture(), inSelectionMode()
//   editor.setRunning(bool), focusNode(id), focusViewport(), destroy()
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

import { NODE_REGISTRY } from '../../studio/registry.js';
import { summarizeGraph, announceAction } from '../../studio/a11y.js';
import { copySubgraph } from '../../studio/actions.js';
import {
  CABLE_HIT_PX, GRID, NODE_WIDTH, boundsOf, cablePath, clampZoom, dragPosition, fitView,
  graphToScreen, idsInRect, mergeSelection, normalizeRect, normalizeView, nudgeDelta, panBy,
  pastThreshold, pinchView, screenToGraph, snapPoint, toggleInSelection, zoomAt, ZOOM_STEP,
} from './graph-geometry.js';
import {
  connectingText, connectionTargets, edgeView, nodeCard, probeConnection,
} from './graph-view.js';
import { coarsePointer, h, s, setAttr, setText, replaceChildren } from './graph-dom.js';

const VIEW_COMMIT_MS = 250;
const NODE_HEAD_OFFSET = 18; // logical units above the pointer where an inserted node's top sits

export function createGraphEditor(host, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  const store = svc.store;
  const summaryId = `osc-sg-summary-${Math.random().toString(36).slice(2, 8)}`;

  // ---------------------------------------------------------------- DOM skeleton
  const edgesG = s('g', { class: 'osc-sg-edges' });
  const preview = s('path', { class: 'osc-sg-preview', d: '' });
  const svg = s('svg', { class: 'osc-sg-cables', 'aria-hidden': 'true', focusable: 'false' },
    [edgesG, preview]);
  const nodesEl = h('div', { class: 'osc-sg-nodes', role: 'group', 'aria-label': 'Nodes',
    'data-osc': 'studio.graph.nodes' });
  const world = h('div', { class: 'osc-sg-world' }, [svg, nodesEl]);
  const marquee = h('div', { class: 'osc-sg-marquee', hidden: true, 'aria-hidden': 'true' });
  const viewport = h('div', { class: 'osc-sg-viewport', tabindex: '0', role: 'group',
    'aria-roledescription': 'signal graph', 'aria-label': 'Studio graph',
    'aria-describedby': summaryId, 'data-osc': 'studio.graph.viewport' }, [world, marquee]);
  const summary = h('p', { class: 'osc-sr-only', id: summaryId,
    'data-osc': 'studio.graph.summary' });
  const bannerText = h('span', { class: 'osc-sg-banner-text', 'data-osc': 'studio.graph.banner' });
  const bannerCancel = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
    'data-osc': 'studio.graph.cancelConnect', text: 'Cancel' });
  const banner = h('div', { class: 'osc-sg-banner', hidden: true }, [bannerText, bannerCancel]);
  const zoomLabel = h('span', { class: 'osc-sg-zoom osc-num', 'data-osc': 'studio.graph.zoom',
    'aria-live': 'off' });
  const ctl = (label, osc, glyph, fn) => h('button', { type: 'button',
    class: 'osc-icon-btn osc-sg-ctl', 'aria-label': label, title: label, 'data-osc': osc,
    onClick: fn }, [h('span', { class: 'osc-sg-ctl-glyph', 'aria-hidden': 'true', text: glyph })]);
  const controls = h('div', { class: 'osc-sg-controls', role: 'group', 'aria-label': 'View' }, [
    ctl('Zoom out', 'studio.graph.zoomOut', '−', () => zoomBy(1 / ZOOM_STEP)),
    zoomLabel,
    ctl('Zoom in', 'studio.graph.zoomIn', '+', () => zoomBy(ZOOM_STEP)),
    ctl('Frame all', 'studio.graph.frameAll', '⤢', () => frameAll()),
    ctl('Frame selection', 'studio.graph.frameSelection', '◎', () => frameSelection()),
  ]);
  replaceChildren(host, [viewport, summary, banner, controls]);
  host.classList.add('osc-sg');

  // ---------------------------------------------------------------- state
  let view = normalizeView(store.getModel().view.graph);
  let size = { w: 0, h: 0 };
  let framedOnce = false;
  const nodeEls = new Map(); // id -> { el, sig, node, ports: Map key -> el, anchors: Map }
  const edgeEls = new Map(); // id -> { g, hit, line, sig }
  let gesture = null;
  let tap = null; // { from, targets }
  let targets = null; // Map 'node\0port' -> verdict during a cable gesture / tap mode
  let viewTimer = null;
  let clipboard = null;
  let pasteCount = 0;
  let nudging = false;
  let pointerFocus = false;
  let running = false;
  let rafId = 0;
  let pendingDrag = null;
  const pointers = new Map(); // touch pointers for pinch

  const model = () => store.getModel();
  const selection = () => store.getSelection();
  const announce = (text, opts) => { if (text) svc.announce(text, opts); };
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });

  // ---------------------------------------------------------------- view
  function applyView() {
    world.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    world.style.setProperty('--osc-sg-z', String(view.zoom));
    const g = GRID * 3 * view.zoom;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${view.panX}px ${view.panY}px`;
    setText(zoomLabel, `${Math.round(view.zoom * 100)} %`);
  }

  function commitView(now = false) {
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = null;
    const send = () => {
      const cur = model().view.graph;
      if (cur.panX === view.panX && cur.panY === view.panY && cur.zoom === view.zoom) return;
      store.dispatch({ type: 'VIEW_SET', view: { graph: { ...view } } });
    };
    if (now) send();
    else viewTimer = setTimeout(send, VIEW_COMMIT_MS);
  }

  function setView(v, commit = true) {
    view = normalizeView(v);
    applyView();
    if (commit) commitView();
  }

  function zoomBy(f, sx = size.w / 2, sy = size.h / 2) {
    setView(zoomAt(view, f, sx, sy));
  }

  function nodeRects(ids = null) {
    const m = model();
    const out = [];
    for (const n of m.graph.nodes) {
      if (ids && !ids.includes(n.id)) continue;
      const e = nodeEls.get(n.id);
      out.push({ id: n.id, x: n.position.x, y: n.position.y,
        w: e && e.el.offsetWidth ? e.el.offsetWidth : NODE_WIDTH,
        h: e && e.el.offsetHeight ? e.el.offsetHeight : 80 });
    }
    return out;
  }

  function frameAll() {
    measureSize();
    setView(fitView(boundsOf(nodeRects()), size));
    return true;
  }

  function frameSelection() {
    const ids = selection().nodes;
    if (!ids.length) return frameAll();
    measureSize();
    setView(fitView(boundsOf(nodeRects(ids)), size));
    return true;
  }

  function measureSize() {
    size = { w: viewport.clientWidth, h: viewport.clientHeight };
  }

  function centerPoint() {
    measureSize();
    return screenToGraph(view, size.w / 2, size.h / 2);
  }

  function clientToGraph(cx, cy) {
    const r = viewport.getBoundingClientRect();
    return screenToGraph(view, cx - r.left, cy - r.top);
  }

  function isOverViewport(cx, cy) {
    const r = viewport.getBoundingClientRect();
    return r.width > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  // ---------------------------------------------------------------- nodes
  function portEl(p) {
    const glyph = h('span', { class: `osc-sg-glyph osc-sg-glyph--${p.shape}`,
      'aria-hidden': 'true' });
    const label = h('span', { class: 'osc-sg-plabel', text: p.label });
    return h('div', { class: `osc-sg-port osc-sg-port--${p.direction} is-${p.type.toLowerCase()}${
      p.param ? ' is-param' : ''}${p.connected ? ' is-connected' : ''}`, 'data-port': p.id,
    'data-dir': p.direction, 'data-type': p.type, 'data-role': p.role, title: p.ariaLabel,
    'aria-hidden': 'true' }, p.direction === 'in' ? [glyph, label] : [label, glyph]);
  }

  function buildNode(entry, card) {
    const el = entry.el;
    el.className = `osc-sg-node osc-sg-node--${card.category.toLowerCase()}${
      card.flags.selected ? ' is-selected' : ''}${card.flags.unconnected ? ' is-unconnected' : ''}${
      card.flags.error ? ' is-error' : ''}${card.flags.offline ? ' is-offline' : ''}${
      card.flags.bypassed ? ' is-bypassed' : ''}`;
    setAttr(el, 'aria-label', card.ariaLabel);
    setAttr(el, 'aria-current', card.flags.selected ? 'true' : null);
    setAttr(el, 'title', card.reason || null);
    const ports = new Map();
    const ins = card.inputs.map((p) => {
      const e = portEl(p);
      ports.set(`in:${p.id}`, e);
      return e;
    });
    const outs = card.outputs.map((p) => {
      const e = portEl(p);
      ports.set(`out:${p.id}`, e);
      return e;
    });
    replaceChildren(el, [
      h('div', { class: 'osc-sg-node-head' }, [
        h('span', { class: 'osc-sg-cat', text: card.categoryLabel }),
        card.statusLabel ? h('span', { class: 'osc-sg-flag', 'data-osc': 'studio.graph.flag',
          text: card.statusLabel }) : null,
      ]),
      h('div', { class: 'osc-sg-title', text: card.title }),
      h('div', { class: 'osc-sg-sum osc-num', text: card.summary }),
      h('div', { class: 'osc-sg-ports' }, [
        h('div', { class: 'osc-sg-col osc-sg-col--in' }, ins),
        h('div', { class: 'osc-sg-col osc-sg-col--out' }, outs),
      ]),
    ]);
    entry.ports = ports;
    entry.anchors = null;
  }

  function anchors(entry) {
    if (entry.anchors) return entry.anchors;
    const a = new Map();
    const w = entry.el.offsetWidth || NODE_WIDTH;
    for (const [key, pe] of entry.ports) {
      const glyph = pe.firstElementChild && pe.firstElementChild.classList.contains('osc-sg-glyph')
        ? pe.firstElementChild : pe.lastElementChild;
      const y = pe.offsetTop + (glyph ? glyph.offsetTop + glyph.offsetHeight / 2
        : pe.offsetHeight / 2);
      a.set(key, { x: key.startsWith('in:') ? 0 : w, y });
    }
    if (a.size || entry.el.offsetWidth) entry.anchors = a;
    return a;
  }

  function anchorOf(nodeId, key, pos = null) {
    const entry = nodeEls.get(nodeId);
    if (!entry) return null;
    const n = pos || entry.pos;
    const a = anchors(entry).get(key);
    if (!a || !n) return null;
    return { x: n.x + a.x, y: n.y + a.y };
  }

  // ---------------------------------------------------------------- render
  function edgeSigs(m) {
    const by = new Map();
    for (const e of m.graph.edges) {
      for (const [id, k] of [[e.from.node, `o${e.from.port}`], [e.to.node, `i${e.to.port}`]]) {
        if (!by.has(id)) by.set(id, []);
        by.get(id).push(`${e.id}:${k}:${e.props && e.props.muted ? 1 : 0}`);
      }
    }
    return by;
  }

  function render() {
    const m = model();
    const sel = selection();
    const selNodes = new Set(sel.nodes);
    const selEdges = new Set(sel.edges);
    const status = svc.status ? svc.status() : new Map();
    const warnings = svc.warnings ? svc.warnings() : new Map();
    const conns = edgeSigs(m);
    const seen = new Set();
    let prevEl = null;
    for (const n of m.graph.nodes) {
      seen.add(n.id);
      let entry = nodeEls.get(n.id);
      if (!entry) {
        const el = h('div', { class: 'osc-sg-node', 'data-node-id': n.id, role: 'group',
          'aria-roledescription': 'node', tabindex: '0', 'data-osc': 'studio.graph.node' });
        entry = { el, sig: '', node: null, ports: new Map(), anchors: null, pos: null };
        nodeEls.set(n.id, entry);
      }
      // DOM order follows the model (Tab order, §142).
      const want = prevEl ? prevEl.nextSibling : nodesEl.firstChild;
      if (want !== entry.el) nodesEl.insertBefore(entry.el, want);
      prevEl = entry.el;
      const st = status.get(n.id);
      const w = warnings.get(n.id) || [];
      const sig = [selNodes.has(n.id) ? 1 : 0, st ? `${st.status}:${st.reason}` : '',
        w.join('|'), (conns.get(n.id) || []).join(',')].join('#');
      if (entry.node !== n || entry.sig !== sig) {
        const contentChanged = !entry.node || entry.node.params !== n.params
          || entry.node.metadata !== n.metadata || entry.sig !== sig;
        if (contentChanged) {
          buildNode(entry, nodeCard(m, n, { registry, selected: selNodes.has(n.id),
            status: st, warnings: w }));
        }
        entry.node = n;
        entry.sig = sig;
      }
      if (!gesture || gesture.kind !== 'node-drag' || !gesture.starts.has(n.id)) {
        entry.pos = { x: n.position.x, y: n.position.y };
        entry.el.style.transform = `translate(${n.position.x}px, ${n.position.y}px)`;
      }
    }
    for (const [id, entry] of nodeEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        nodeEls.delete(id);
      }
    }
    // Edges.
    const seenE = new Set();
    for (const e of m.graph.edges) {
      seenE.add(e.id);
      let entry = edgeEls.get(e.id);
      const selected = selEdges.has(e.id);
      if (!entry) {
        const hit = s('path', { class: 'osc-sg-edge-hit' });
        const line = s('path', { class: 'osc-sg-edge-line' });
        const g = s('g', { 'data-edge-id': e.id, 'data-osc': 'studio.graph.edge' }, [hit, line]);
        edgesG.appendChild(g);
        entry = { g, hit, line, edge: null, sig: '' };
        edgeEls.set(e.id, entry);
      }
      const sig = `${selected ? 1 : 0}`;
      if (entry.edge !== e || entry.sig !== sig) {
        const v = edgeView(m, e, { registry, selected });
        entry.g.setAttribute('class', `osc-sg-edge is-${v.type.toLowerCase()} is-${v.cable}${
          v.muted ? ' is-muted' : ''}${selected ? ' is-selected' : ''}`);
        setAttr(entry.g, 'data-label', v.ariaLabel);
        let title = entry.g.querySelector('title');
        if (!title) {
          title = s('title');
          entry.g.insertBefore(title, entry.g.firstChild);
        }
        setText(title, v.title);
        entry.edge = e;
        entry.sig = sig;
      }
    }
    for (const [id, entry] of edgeEls) {
      if (!seenE.has(id)) {
        entry.g.remove();
        edgeEls.delete(id);
      }
    }
    routeAll();
    setText(summary, summarizeGraph(m, { registry }));
    host.classList.toggle('is-empty', !m.graph.nodes.length);
    if (!gesture) {
      const v = normalizeView(m.view.graph);
      if (v.panX !== view.panX || v.panY !== view.panY || v.zoom !== view.zoom) {
        if (!viewTimer) {
          view = v;
          applyView();
        }
      }
    }
    if (tap) refreshTargets(tap.from);
  }

  function routeEdge(entry) {
    const e = entry.edge;
    const a = anchorOf(e.from.node, `out:${e.from.port}`);
    const b = anchorOf(e.to.node, `in:${e.to.port}`);
    if (!a || !b) {
      entry.line.setAttribute('d', '');
      entry.hit.setAttribute('d', '');
      return;
    }
    const d = cablePath(a.x, a.y, b.x, b.y);
    entry.line.setAttribute('d', d);
    entry.hit.setAttribute('d', d);
  }

  function routeAll() {
    for (const entry of edgeEls.values()) routeEdge(entry);
    fitSvg();
  }

  function fitSvg() {
    const rects = [];
    for (const entry of nodeEls.values()) {
      if (!entry.pos) continue;
      rects.push({ x: entry.pos.x, y: entry.pos.y, w: entry.el.offsetWidth || NODE_WIDTH,
        h: entry.el.offsetHeight || 80 });
    }
    const b = boundsOf(rects) || { x: 0, y: 0, w: 1, h: 1 };
    const pad = 400;
    const x = Math.floor(b.x - pad);
    const y = Math.floor(b.y - pad);
    const w = Math.ceil(b.w + 2 * pad);
    const hgt = Math.ceil(b.h + 2 * pad);
    svg.style.left = `${x}px`;
    svg.style.top = `${y}px`;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(hgt));
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${hgt}`);
  }

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
    render();
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
    pointerFocus = true;
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
      gesture = { ...base, kind: 'pan', start: { ...view } };
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
      gesture = { ...base, kind: 'pan', start: { ...view } };
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
      view = pinchView(view, gesture.last, next);
      gesture.last = next;
      applyView();
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
        view = panBy(gesture.start, dx, dy);
        applyView();
        break;
      case 'port-press':
        gesture.kind = 'cable';
        refreshTargets(gesture.from);
        showBanner(connectingText(model(), gesture.from, registry), false);
        // fallthrough
      case 'cable': {
        const a = anchorOf(gesture.from.node, `out:${gesture.from.port}`);
        const p = clientToGraph(e.clientX, e.clientY);
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
        const p = local(e);
        const r = normalizeRect(gesture.start.x, gesture.start.y, p.x, p.y);
        marquee.hidden = false;
        marquee.style.transform = `translate(${r.x}px, ${r.y}px)`;
        marquee.style.width = `${r.w}px`;
        marquee.style.height = `${r.h}px`;
        const a = screenToGraph(view, r.x, r.y);
        const lr = { x: a.x, y: a.y, w: r.w / view.zoom, h: r.h / view.zoom };
        const hits = new Set(idsInRect(nodeRects(), lr));
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
    const p = dragPosition(primary, dx, dy, view.zoom, g.noSnap ? 0 : GRID);
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
      if (moving.has(e.from.node) || moving.has(e.to.node)) routeEdge(entry);
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) {
        gesture = null;
        commitView(true);
      }
      return;
    }
    if (e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    host.classList.remove('is-panning');
    switch (g.kind) {
      case 'pan':
        if (g.moved) commitView(true);
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
        else if (!ne && isOverViewport(e.clientX, e.clientY)) {
          // Create-node-from-cable (§66): a picker of the types that accept this cable.
          svc.onQuickAdd({ at: clientToGraph(e.clientX, e.clientY), from: g.from });
        } else announce('Connection cancelled');
        render();
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
        render();
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
      routeAll();
    } else if (g.kind === 'cable') {
      preview.setAttribute('d', '');
      clearTargets();
      showBanner('', false);
      render();
    } else if (g.kind === 'marquee') {
      marquee.hidden = true;
      for (const entry of nodeEls.values()) entry.el.classList.remove('is-marquee');
    } else if (g.kind === 'pan' || g.kind === 'pinch') {
      commitView(true);
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
    setView(zoomAt(view, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y));
  }

  function onDblClick(e) {
    if (e.target.closest('.osc-sg-node, .osc-sg-edge, .osc-sg-controls, .osc-sg-banner')) return;
    svc.onQuickAdd({ at: clientToGraph(e.clientX, e.clientY), from: null });
  }

  function onFocusIn(e) {
    const ne = e.target.closest && e.target.closest('.osc-sg-node');
    if (!ne || pointerFocus) {
      pointerFocus = false;
      return;
    }
    // Keyboard focus selects the node (actions apply to the selection, §142).
    const id = ne.dataset.nodeId;
    const cur = selection();
    if (!(cur.nodes.length === 1 && cur.nodes[0] === id)) select({ nodes: [id] });
  }

  function onNodeKey(e) {
    const ne = e.target.closest && e.target.closest('.osc-sg-node');
    if (ne && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      svc.onActivateNode(ne.dataset.nodeId);
    }
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
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('keydown', onNodeKey);
  const onBlur = () => onCancel(null);
  window.addEventListener('blur', onBlur);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    measureSize();
    if (size.w > 0 && size.h > 0 && !framedOnce) {
      framedOnce = true;
      const v = model().view.graph;
      if (v.panX === 0 && v.panY === 0 && v.zoom === 1) frameAll();
    }
    for (const entry of nodeEls.values()) entry.anchors = null;
    routeAll();
  }) : null;
  if (ro) ro.observe(viewport);
  // Node sizes change with fonts, theme and content (§148): re-measure the port anchors.
  const nodeRo = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    let any = false;
    for (const en of entries) {
      const id = en.target.dataset.nodeId;
      const entry = id ? nodeEls.get(id) : null;
      if (entry) {
        entry.anchors = null;
        any = true;
      }
    }
    if (any) routeAll();
  }) : null;
  const mo = new MutationObserver((list) => {
    if (!nodeRo) return;
    for (const m of list) {
      for (const n of m.addedNodes) if (n.nodeType === 1) nodeRo.observe(n);
      for (const n of m.removedNodes) if (n.nodeType === 1) nodeRo.unobserve(n);
    }
  });
  mo.observe(nodesEl, { childList: true });

  // ---------------------------------------------------------------- commands
  function addNodeAt(type, at = null, { connectFrom = null } = {}) {
    const p = at || centerPoint();
    const pos = snapPoint({ x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEAD_OFFSET });
    const def = registry.get(type);
    if (!def) return { ok: false, reason: 'Unknown node type.' };
    store.beginGesture(connectFrom ? `Add ${def.displayName} and connect` : null);
    const r = store.dispatch({ type: 'NODE_ADD', nodeType: type, position: pos });
    let edgeResult = null;
    if (r.ok && connectFrom && r.created && r.created.nodes) {
      const id = r.created.nodes[0];
      const t = connectionTargets(model(), connectFrom, registry)
        .find((x) => x.node === id && x.allowed);
      if (t) edgeResult = store.dispatch({ type: 'EDGE_ADD', from: connectFrom,
        to: { node: t.node, port: t.port } });
    }
    store.endGesture();
    if (!r.ok) {
      announce(announceAction(r), { assertive: true });
      return r;
    }
    const id = r.created.nodes[0];
    select({ nodes: [id] });
    announce(edgeResult && edgeResult.ok ? `${announceAction(r)} and ${
      announceAction(edgeResult).replace(/^Connected/, 'connected')}` : announceAction(r));
    if (edgeResult && !edgeResult.ok) announce(announceAction(edgeResult), { assertive: true });
    requestAnimationFrame(() => focusNode(id));
    return r;
  }

  function addNodeAtClient(type, cx, cy) {
    if (!isOverViewport(cx, cy)) return false;
    addNodeAt(type, clientToGraph(cx, cy));
    return true;
  }

  function nearestNodeTo(point, exclude) {
    let best = null;
    let bd = Infinity;
    for (const n of model().graph.nodes) {
      if (exclude.has(n.id)) continue;
      const d = Math.hypot(n.position.x - point.x, n.position.y - point.y);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  function deleteSelection() {
    const sel = selection();
    const m = model();
    const nodes = sel.nodes.filter((id) => m.graph.nodes.some((n) => n.id === id));
    const gone = new Set(nodes);
    const edges = sel.edges.filter((id) => m.graph.edges.some((e) => e.id === id
      && !gone.has(e.from.node) && !gone.has(e.to.node)));
    if (!nodes.length && !edges.length) {
      announce('Nothing selected to delete.');
      return false;
    }
    const primary = nodes.length ? m.graph.nodes.find((n) => n.id === nodes[nodes.length - 1])
      : null;
    store.beginGesture();
    let last = null;
    if (nodes.length) last = store.dispatch({ type: 'NODE_REMOVE', nodeIds: nodes });
    if (edges.length && (!last || last.ok)) {
      const r = store.dispatch({ type: 'EDGE_REMOVE', edgeIds: edges });
      if (!last) last = r;
    }
    const entry = store.endGesture();
    if (last && last.ok) {
      announce(entry && entry.label && nodes.length && edges.length
        ? `Deleted ${nodes.length + edges.length} items` : announceAction(last));
    } else if (last) announce(announceAction(last), { assertive: true });
    // Focus the nearest remaining node, else the canvas (§142): never <body>.
    const next = primary ? nearestNodeTo(primary.position, gone) : null;
    requestAnimationFrame(() => {
      if (next) {
        pointerFocus = true;
        focusNode(next);
      } else viewport.focus({ preventScroll: true });
    });
    return true;
  }

  function copySelection() {
    const ids = selection().nodes;
    if (!ids.length) {
      announce('Select nodes to copy.');
      return false;
    }
    clipboard = copySubgraph(model(), ids);
    pasteCount = 0;
    announce(`Copied ${ids.length === 1 ? model().graph.nodes.find((n) => n.id === ids[0])
      .metadata.name : `${ids.length} nodes`}`);
    return true;
  }

  function cutSelection() {
    if (!copySelection()) return false;
    pasteCount = -1;
    return deleteSelection();
  }

  function paste() {
    if (!clipboard) {
      announce('The Studio clipboard is empty.');
      return false;
    }
    pasteCount += 1;
    const k = Math.max(1, pasteCount);
    const r = store.dispatch({ type: 'PASTE', clipboard, offset: { x: 24 * k, y: 24 * k } });
    announce(announceAction(r), { assertive: !r.ok });
    return r.ok;
  }

  function duplicateSelection() {
    const ids = selection().nodes;
    if (!ids.length) {
      announce('Select nodes to duplicate.');
      return false;
    }
    const r = store.dispatch({ type: 'DUPLICATE', nodeIds: ids });
    announce(announceAction(r), { assertive: !r.ok });
    return r.ok;
  }

  function selectAll() {
    const ids = model().graph.nodes.map((n) => n.id);
    select({ nodes: ids });
    announce(`${ids.length} nodes selected`);
  }

  /** Arrow keys (§125, §140): one history entry per key sequence (gesture until keyup). */
  function nudge(key, large) {
    const ids = selection().nodes;
    const d = nudgeDelta(key, large);
    if (!d) return false;
    if (!ids.length) {
      setView(panBy(view, -d.x * 4, -d.y * 4));
      return true;
    }
    if (!nudging) {
      nudging = true;
      store.beginGesture();
    }
    const r = store.dispatch({ type: 'NODE_MOVE', nodeIds: ids, delta: d });
    if (!r.ok) announce(announceAction(r), { assertive: true });
    return true;
  }

  function endNudge() {
    if (!nudging) return;
    nudging = false;
    const entry = store.endGesture();
    if (entry && entry.label) announce(announceAction({ ok: true, changed: true,
      label: entry.label }));
  }

  function focusNode(id) {
    const entry = nodeEls.get(id);
    if (!entry) return false;
    entry.el.focus({ preventScroll: true });
    // Keep it visible: pan when it lies outside the viewport.
    measureSize();
    const p = graphToScreen(view, entry.pos.x, entry.pos.y);
    const w = entry.el.offsetWidth * view.zoom;
    const hh = entry.el.offsetHeight * view.zoom;
    if (size.w && (p.x < 0 || p.y < 0 || p.x + w > size.w || p.y + hh > size.h)) {
      setView(panBy(view, size.w / 2 - (p.x + w / 2), size.h / 2 - (p.y + hh / 2)));
    }
    return true;
  }

  function cancelTransient() {
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
  }

  applyView();
  render();

  return {
    render,
    frameAll,
    frameSelection,
    zoomBy,
    panBy: (dx, dy) => setView(panBy(view, dx, dy)),
    setView,
    getView: () => ({ ...view }),
    addNodeAt,
    addNodeAtClient,
    isOverViewport,
    clientToGraph,
    centerPoint,
    deleteSelection,
    copySelection,
    cutSelection,
    paste,
    duplicateSelection,
    selectAll,
    nudge,
    endNudge,
    startTapConnect,
    cancelTransient,
    hasGesture: () => !!gesture,
    inSelectionMode: () => !!tap,
    probe: (from, to) => probeConnection(model(), from, to, registry),
    setRunning(on) {
      running = !!on;
      host.classList.toggle('is-running', running);
    },
    focusNode,
    focusViewport: () => viewport.focus({ preventScroll: true }),
    onShow() {
      measureSize();
      for (const entry of nodeEls.values()) entry.anchors = null;
      routeAll();
      if (!framedOnce && size.w > 0) {
        framedOnce = true;
        const v = model().view.graph;
        if (v.panX === 0 && v.panY === 0 && v.zoom === 1) frameAll();
      }
    },
    /** Node element geometry for tests and the compact projection: { id: { x, y, w, h } }. */
    debugInfo() {
      return { nodes: nodeEls.size, edges: edgeEls.size, view: { ...view },
        gesture: gesture ? gesture.kind : null, tap: !!tap, zoom: clampZoom(view.zoom),
        hitPx: coarsePointer() ? CABLE_HIT_PX.coarse : CABLE_HIT_PX.fine };
    },
    destroy() {
      cancelGestureLocal();
      window.removeEventListener('blur', onBlur);
      if (ro) ro.disconnect();
      if (nodeRo) nodeRo.disconnect();
      mo.disconnect();
      replaceChildren(host, []);
    },
  };
}
