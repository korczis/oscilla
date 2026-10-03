// Compact Signal Path layout (spec §128, §150, §197): the compact widget draws the SAME graph as
// the full editor with a simplified, automatic layout; the full Studio keeps the authored
// positions (same topology, different projection). Pure and deterministic: no randomness, ties
// broken by model order. Never writes positions into the model (§150: auto layout never moves
// a user graph without an explicit action).
//
//   compactLayout(model, opts) -> { columns, nodes: [{ id, col, row }], links: [{ id, from, to,
//     type }], width: columns, height: rows }
//
// Columns are the longest path from a node without inputs over AUDIO, CONTROL and TRIGGER edges
// (ANALYSIS data edges too: measurement chains read left to right); the model is always acyclic
// (validate.js), so the longest path exists. Rows inside a column follow the model order, with a
// node placed on the row of its first upstream neighbour when that row is free, which keeps a
// straight chain (OSC → ENV → FILTER → OUT) on one row.

import { NODE_REGISTRY } from '../../studio/registry.js';

export function compactLayout(model, { registry = NODE_REGISTRY } = {}) {
  const nodes = model.graph.nodes;
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const links = [];
  for (const e of model.graph.edges) {
    if (!order.has(e.from.node) || !order.has(e.to.node)) continue;
    incoming.get(e.to.node).push(e.from.node);
    outgoing.get(e.from.node).push(e.to.node);
    const a = nodes[order.get(e.from.node)];
    const port = registry.port(a.type, e.from.port, 'out');
    links.push({ id: e.id, from: e.from.node, to: e.to.node, type: port ? port.type : 'AUDIO',
      muted: !!(e.props && e.props.muted) });
  }
  // Longest path depth (Kahn order; ties in model order).
  const indeg = new Map(nodes.map((n) => [n.id, incoming.get(n.id).length]));
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const seen = new Set();
  while (queue.length) {
    queue.sort((x, y) => order.get(x) - order.get(y));
    const id = queue.shift();
    seen.add(id);
    for (const t of outgoing.get(id)) {
      depth.set(t, Math.max(depth.get(t), depth.get(id) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  // A cyclic remainder cannot occur in a valid model; keep such nodes in column 0 anyway.
  for (const n of nodes) if (!seen.has(n.id)) depth.set(n.id, 0);
  const columns = nodes.length ? Math.max(...nodes.map((n) => depth.get(n.id))) + 1 : 0;
  const rowOf = new Map();
  const used = Array.from({ length: columns }, () => new Set());
  const byColumn = Array.from({ length: columns }, () => []);
  for (const n of nodes) byColumn[depth.get(n.id)].push(n.id);
  for (let c = 0; c < columns; c++) {
    for (const id of byColumn[c]) {
      const ups = incoming.get(id).filter((u) => rowOf.has(u))
        .sort((x, y) => order.get(x) - order.get(y));
      let row = ups.length ? rowOf.get(ups[0]) : 0;
      while (used[c].has(row)) row++;
      used[c].add(row);
      rowOf.set(id, row);
    }
  }
  const rows = nodes.length ? Math.max(...nodes.map((n) => rowOf.get(n.id))) + 1 : 0;
  return {
    columns,
    rows,
    nodes: nodes.map((n) => ({ id: n.id, col: depth.get(n.id), row: rowOf.get(n.id) })),
    links,
  };
}
