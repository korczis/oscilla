// Studio graph editor (spec §53-§77, §118-§125, §137-§152, §168-§171, §245-§248; ADR 0034):
// custom HTML nodes and ONE SVG layer for the cables, rendered from the canonical StudioModel.
// No third-party editor (§53-§55). The editor holds only ephemeral view state (the viewport
// while a gesture runs, the drag preview, the tap-connect source); every semantic change is one
// store action at gesture end (§61): NODE_MOVE, EDGE_ADD, NODE_ADD, SELECTION_CHANGE, VIEW_SET.
//
//   createGraphEditor(host, svc) -> editor
//     svc: { store, registry, announce(text, { assertive }), status() -> Map, warnings() -> Map,
//            edgeStatus() -> Map edge id -> plan { status, reason } (cables that carry nothing
//            are drawn as such, §237), onQuickAdd({ at, from }), onConnectDialog(nodeId),
//            onActivateNode(id) }
//   editor.render()                     project the model and selection (keyed, incremental)
//   editor.frameAll(), frameSelection(), zoomBy(f), panBy(dx, dy), setView(view)
//   editor.toggleMinimap(on?) -> shown, minimapLayout() -> layout | null     (§153, V602:
//                        graph-minimap.js; view state only, it moves the viewport like a pan)
//   editor.addNodeAt(type, at?, { connectFrom }) -> result     at: logical point (default centre)
//   editor.addNodeAtClient(type, clientX, clientY) -> bool      library drop (§63)
//   editor.isOverViewport(clientX, clientY), clientToGraph(x, y), centerPoint()
//   editor.deleteSelection(), copySelection(), cutSelection(), paste(), duplicateSelection(),
//   editor.selectAll(), toggleFocusedNode(), nudge(key, large), endNudge()
//   editor.startTapConnect(from), cancelTransient() -> bool, hasGesture(), inSelectionMode()
//   editor.setRunning(bool), focusNode(id) -> bool, focusViewport() -> bool, isShown(),
//   destroy()        focusNode / focusViewport refuse (false) while the graph subview is hidden
//                    (phones, §136): focus never goes to an element nobody can see (V431 U7)
//
// The pointer gestures (drag, cable, pan, pinch, wheel, tap-connect) are graph-gestures.js, its
// pointer model is stated there; the keyboard and selection commands are graph-commands.js
// (plan K006). This module owns the DOM, the view and the keyed render.

import { NODE_REGISTRY } from '../../studio/registry.js';
import { summarizeGraph } from '../../studio/a11y.js';
import {
  CABLE_HIT_PX, COARSE_FIT_MIN_ZOOM, GRID, NODE_WIDTH, boundsOf, cableCross, cablePath,
  clampZoom, fitView, graphToScreen, normalizeView, panBy, screenToGraph, zoomAt, ZOOM_STEP,
} from './graph-geometry.js';
import { edgeView, nodeCard, probeConnection } from './graph-view.js';
import { coarsePointer, h, s, setAttr, setText, replaceChildren } from './graph-dom.js';
import { createMinimap } from './graph-minimap.js';
import { createGraphGestures } from './graph-gestures.js';
import { createGraphCommands } from './graph-commands.js';

const VIEW_COMMIT_MS = 250;

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
  // Hidden until shown (graph-minimap.js); first in the group, so the others keep their place.
  const minimapBtn = ctl('Minimap', 'studio.graph.minimapToggle', '▣', () => toggleMinimap());
  minimapBtn.setAttribute('aria-pressed', 'false');
  const controls = h('div', { class: 'osc-sg-controls', role: 'group', 'aria-label': 'View' }, [
    minimapBtn,
    ctl('Zoom out', 'studio.graph.zoomOut', '−', () => zoomBy(1 / ZOOM_STEP)),
    zoomLabel,
    ctl('Zoom in', 'studio.graph.zoomIn', '+', () => zoomBy(ZOOM_STEP)),
    ctl('Frame all', 'studio.graph.frameAll', '⤢', () => frameAll()),
    ctl('Frame selection', 'studio.graph.frameSelection', '◎', () => frameSelection()),
  ]);
  // The empty canvas says how to begin (V431 U10); shown by CSS on .is-empty, also on phones,
  // where the Inspector's hint is in another subview.
  const empty = h('p', { class: 'osc-sg-empty', 'data-osc': 'studio.graph.empty',
    text: 'Empty graph. Press N or use Add node, or open a setup from Templates.' });
  const minimap = createMinimap({ rects: () => nodeRects(), view: () => view,
    size: () => (size.w > 0 ? size : (measureSize(), size)),
    setView: (v, commit) => setView(v, commit), commit: () => commitView(true) });
  replaceChildren(host, [viewport, empty, summary, banner, minimap.el, controls]);
  host.classList.add('osc-sg');

  // ---------------------------------------------------------------- state
  let view = normalizeView(store.getModel().view.graph);
  let size = { w: 0, h: 0 };
  let framedOnce = false;
  const nodeEls = new Map(); // id -> { el, sig, node, ports: Map key -> el, anchors: Map }
  const edgeEls = new Map(); // id -> { g, hit, line, sig }
  let viewTimer = null;
  let running = false;

  const model = () => store.getModel();
  const selection = () => store.getSelection();
  const announce = (text, opts) => { if (text) svc.announce(text, opts); };

  // ---------------------------------------------------------------- view
  function applyView() {
    world.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    world.style.setProperty('--osc-sg-z', String(view.zoom));
    const g = GRID * 3 * view.zoom;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${view.panX}px ${view.panY}px`;
    setText(zoomLabel, `${Math.round(view.zoom * 100)} %`);
    minimap.render();
  }

  function toggleMinimap(on = !minimap.isShown()) {
    const shown = minimap.setShown(on);
    minimapBtn.setAttribute('aria-pressed', String(shown));
    announce(shown ? 'Minimap shown' : 'Minimap hidden');
    return shown;
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

  /** Fit options: a coarse pointer keeps port targets at least 24 px (COARSE_FIT_MIN_ZOOM). */
  const fitOpts = () => (coarsePointer() ? { minZoom: COARSE_FIT_MIN_ZOOM } : {});

  function frameAll() {
    measureSize();
    setView(fitView(boundsOf(nodeRects()), size, fitOpts()));
    return true;
  }

  function frameSelection() {
    const ids = selection().nodes;
    if (!ids.length) return frameAll();
    measureSize();
    setView(fitView(boundsOf(nodeRects(ids)), size, fitOpts()));
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
    const edgeStatus = svc.edgeStatus ? svc.edgeStatus() : new Map();
    const byId = new Map(m.graph.nodes.map((n) => [n.id, n]));
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
      if (!gestures.dragging(n.id)) {
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
        const mark = s('path', { class: 'osc-sg-edge-x' });
        const g = s('g', { 'data-edge-id': e.id, 'data-osc': 'studio.graph.edge' },
          [hit, line, mark]);
        edgesG.appendChild(g);
        entry = { g, hit, line, mark, edge: null, sig: '', inactive: false };
        edgeEls.set(e.id, entry);
      }
      // The plan status and the target's parameters decide liveness (a filter type change
      // alters it without touching the edge): both are in the signature.
      const st = edgeStatus.get(e.id) || null;
      const to = byId.get(e.to.node);
      const sig = `${selected ? 1 : 0}#${st ? `${st.status}:${st.reason}` : ''}#${
        to && to.type === 'filter' ? to.params.type : ''}`;
      if (entry.edge !== e || entry.sig !== sig) {
        const v = edgeView(m, e, { registry, selected, status: st });
        entry.g.setAttribute('class', `osc-sg-edge is-${v.type.toLowerCase()} is-${v.cable}${
          v.muted ? ' is-muted' : ''}${v.inactive ? ' is-inactive' : ''}${
          selected ? ' is-selected' : ''}`);
        setAttr(entry.g, 'data-route', v.route);
        entry.inactive = v.inactive;
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
    if (!gestures.kind()) {
      const v = normalizeView(m.view.graph);
      if (v.panX !== view.panX || v.panY !== view.panY || v.zoom !== view.zoom) {
        if (!viewTimer) {
          view = v;
          applyView();
        }
      }
    }
    gestures.refresh();
  }

  function routeEdge(entry) {
    const e = entry.edge;
    const a = anchorOf(e.from.node, `out:${e.from.port}`);
    const b = anchorOf(e.to.node, `in:${e.to.port}`);
    if (!a || !b) {
      entry.line.setAttribute('d', '');
      entry.hit.setAttribute('d', '');
      entry.mark.setAttribute('d', '');
      return;
    }
    const d = cablePath(a.x, a.y, b.x, b.y);
    entry.line.setAttribute('d', d);
    entry.hit.setAttribute('d', d);
    // A cable that carries nothing has a cross at its midpoint (shape, not colour alone, §167).
    entry.mark.setAttribute('d', entry.inactive ? cableCross(a.x, a.y, b.x, b.y) : '');
  }

  function routeAll() {
    for (const entry of edgeEls.values()) routeEdge(entry);
    fitSvg();
    minimap.render();
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

  /** Whether the graph is rendered (not a hidden subview or workspace). */
  function isShown() {
    return viewport.isConnected && viewport.getClientRects().length > 0;
  }

  function focusNode(id) {
    const entry = nodeEls.get(id);
    if (!entry || !isShown()) return false;
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

  // ---------------------------------------------------------------- gestures and commands
  const base = { viewport, store, registry, svc, view: () => view, setView, clientToGraph,
    isOverViewport };
  const commands = createGraphCommands({ ...base, centerPoint, focusNode, isShown });
  const gestures = createGraphGestures({ ...base, host, preview, marquee, nodeEls, edgeEls,
    banner: { el: banner, text: bannerText, cancel: bannerCancel },
    setLocalView: (v) => { view = v; applyView(); }, commitView, nodeRects, anchorOf,
    routeEdge, routeAll, render, onPress: commands.onPress });

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
    toggleMinimap,
    minimapLayout: () => minimap.layout(),
    addNodeAt: commands.addNodeAt,
    addNodeAtClient: commands.addNodeAtClient,
    isOverViewport,
    clientToGraph,
    centerPoint,
    deleteSelection: commands.deleteSelection,
    copySelection: commands.copySelection,
    cutSelection: commands.cutSelection,
    paste: commands.paste,
    duplicateSelection: commands.duplicateSelection,
    selectAll: commands.selectAll,
    toggleFocusedNode: commands.toggleFocusedNode,
    nudge: commands.nudge,
    endNudge: commands.endNudge,
    startTapConnect: gestures.startTapConnect,
    cancelTransient: gestures.cancelTransient,
    hasGesture: () => !!gestures.kind(),
    inSelectionMode: gestures.inTap,
    probe: (from, to) => probeConnection(model(), from, to, registry),
    setRunning(on) {
      running = !!on;
      host.classList.toggle('is-running', running);
    },
    focusNode,
    focusViewport() {
      if (!isShown()) return false;
      viewport.focus({ preventScroll: true });
      return true;
    },
    isShown,
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
        gesture: gestures.kind(), tap: gestures.inTap(), zoom: clampZoom(view.zoom),
        hitPx: coarsePointer() ? CABLE_HIT_PX.coarse : CABLE_HIT_PX.fine };
    },
    destroy() {
      gestures.destroy();
      commands.destroy();
      if (ro) ro.disconnect();
      if (nodeRo) nodeRo.disconnect();
      mo.disconnect();
      minimap.destroy();
      replaceChildren(host, []);
    },
  };
}
