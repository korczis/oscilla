// Studio graph commands (spec §63-§64, §118-§125, §140-§142; V272 C5, V431 U1, U7; plan K006):
// the keyboard and selection commands of the graph editor, moved out of graph-editor.js. Each
// command is one store action, or one gesture of actions (one history entry, §50), and says what
// it did through the announcer. Keyboard focus that lands on a node selects it; focus that a
// pointer press moves does not (the press selects on release).
//
//   createGraphCommands(ctx) -> { addNodeAt, addNodeAtClient, deleteSelection, copySelection,
//     cutSelection, paste, duplicateSelection, selectAll, toggleFocusedNode, nudge, endNudge,
//     onPress(), destroy() }
//     ctx: { viewport, store, registry, svc, view(), setView(v), centerPoint(),
//            clientToGraph(x, y), isOverViewport(x, y), focusNode(id), isShown() }

import { announceAction } from '../../studio/a11y.js';
import { copySubgraph } from '../../studio/actions.js';
import { NODE_WIDTH, nudgeDelta, panBy, snapPoint } from './graph-geometry.js';
import { connectionTargets } from './graph-view.js';
import { focusSelection, toggleFocusedSelection } from './graph-keys.js';

const NODE_HEAD_OFFSET = 18; // logical units above the pointer where an inserted node's top sits

export function createGraphCommands(ctx) {
  const { viewport, store, registry, svc } = ctx;
  let clipboard = null;
  let pasteCount = 0;
  let nudging = false;
  // True from a pointer press until the focus it causes (or the end of that event-loop turn):
  // focus that a press moves does not select (the press selects on release). A press that
  // moves no focus (a port, a cable, an already focused canvas) must not leave it set, or the
  // next KEYBOARD focus would skip selection and Delete / C act on another node (V431 U1).
  let pointerFocus = false;
  let pointerFocusTimer = null;
  // The selection that keyboard focus landing on a node replaced, for T (V272 C5).
  let focusReplaced = null; // { node, before: node ids }

  const model = () => store.getModel();
  const selection = () => store.getSelection();
  const announce = (text, opts) => { if (text) svc.announce(text, opts); };
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });

  /** A pointer press: the focus it moves in this event-loop turn does not select. */
  function onPress() {
    pointerFocus = true;
    focusReplaced = null;
    clearTimeout(pointerFocusTimer);
    pointerFocusTimer = setTimeout(() => { pointerFocus = false; }, 0);
  }

  function onFocusIn(e) {
    const ne = e.target.closest && e.target.closest('.osc-sg-node');
    if (!ne || pointerFocus) {
      pointerFocus = false;
      return;
    }
    // Keyboard focus selects the node (actions apply to the selection, §142); on a member of
    // a multi-selection it keeps the selection (V272 C5).
    const id = ne.dataset.nodeId;
    const cur = selection().nodes;
    const next = focusSelection(cur, id);
    if (next) {
      focusReplaced = { node: id, before: [...cur] };
      select({ nodes: next });
    }
  }

  /** T (V272 C5): add the focused node to the selection, or take it out. */
  function toggleFocusedNode() {
    const a = document.activeElement;
    const ne = a && viewport.contains(a) && a.closest ? a.closest('.osc-sg-node') : null;
    const n = ne ? model().graph.nodes.find((x) => x.id === ne.dataset.nodeId) : null;
    if (!n) {
      announce('Focus a node to add it to the selection.');
      return false;
    }
    const replaced = focusReplaced && focusReplaced.node === n.id ? focusReplaced.before : null;
    const next = toggleFocusedSelection(selection().nodes, n.id, replaced);
    focusReplaced = null;
    select({ nodes: next });
    announce(`${n.metadata.name} ${next.includes(n.id) ? 'added to' : 'taken out of'} the `
      + `selection: ${next.length} node${next.length === 1 ? '' : 's'} selected`);
    return true;
  }

  function onNodeKey(e) {
    const ne = e.target.closest && e.target.closest('.osc-sg-node');
    if (ne && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      svc.onActivateNode(ne.dataset.nodeId);
    }
  }

  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('keydown', onNodeKey);

  function addNodeAt(type, at = null, { connectFrom = null } = {}) {
    const p = at || ctx.centerPoint();
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
    requestAnimationFrame(() => ctx.focusNode(id));
    return r;
  }

  function addNodeAtClient(type, cx, cy) {
    if (!ctx.isOverViewport(cx, cy)) return false;
    addNodeAt(type, ctx.clientToGraph(cx, cy));
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
    // Focus the nearest remaining node, else the canvas (§142): never <body>. While the graph
    // subview is hidden (a phone, Delete from the Inspector) focus stays where it is (V431 U7).
    const next = primary ? nearestNodeTo(primary.position, gone) : null;
    requestAnimationFrame(() => {
      if (!ctx.isShown()) return;
      if (next) {
        pointerFocus = true; // focus the neighbour without selecting it
        ctx.focusNode(next);
        pointerFocus = false; // focusin has run (or the node could not take focus)
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
      ctx.setView(panBy(ctx.view(), -d.x * 4, -d.y * 4));
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

  return {
    addNodeAt,
    addNodeAtClient,
    deleteSelection,
    copySelection,
    cutSelection,
    paste,
    duplicateSelection,
    selectAll,
    toggleFocusedNode,
    nudge,
    endNudge,
    onPress,
    destroy() {
      clearTimeout(pointerFocusTimer);
    },
  };
}
