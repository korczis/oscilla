// The minimal patch between two Studio runtime plans (spec §44): diffPlans, split from
// compiler.js (K023, the source-size budget), which re-exports it. Pure: plans in, ops out.

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => !sameValue(a[k], b[k])).sort();

/**
 * The minimal patch from `prev` to `next` (both plans). A parameter change on a running node
 * is `node-params` unless it touches a structural key of its adapter (`node-replace`), as a
 * node that becomes clocked or free-running is (`clocked`, another builder); edges of
 * a replaced node are `edge-rewire` (rebuilt and crossfaded); a modulation edge whose mapping
 * changes is rewired (it targets another AudioParam); other edge property changes are
 * `edge-props`. `owned` (Map node id → Set of owned parameter keys): on a node with an owned
 * parameter, a change of one of its adapter's `rebuildWhenOwned` keys is a `node-replace` too —
 * the builder's live update for that key rewrites every parameter and cannot skip an owned one
 * (adapters/nodes.js, the owned-parameter contract). `replace` (Set of node ids): nodes rebuilt
 * although their plan entry is unchanged (runtime setOptions: a Microphone whose input failed).
 */
export function diffPlans(prev, next, { owned = null, replace = null } = {}) {
  const ops = [];
  const replaced = new Set();
  const removed = new Set();
  for (const [id, n] of next.nodes) {
    const p = prev.nodes.get(id);
    if (!p) { ops.push({ op: 'node-add', id }); continue; }
    if (p.type !== n.type || p.status !== n.status || p.reason !== n.reason
      || p.clocked !== n.clocked || (replace && replace.has(id))) {
      replaced.add(id);
      ops.push({ op: 'node-replace', id, keys: [] });
      continue;
    }
    const keys = changedKeys(p.params, n.params);
    if (!keys.length) continue;
    const ownedHere = !!(owned && owned.get(id) && owned.get(id).size);
    const rebuild = ownedHere && n.adapter ? n.adapter.rebuildWhenOwned || [] : [];
    const structural = n.adapter ? keys.filter((k) => n.adapter.structural.includes(k)
      || rebuild.includes(k)) : keys;
    if (structural.length) {
      replaced.add(id);
      ops.push({ op: 'node-replace', id, keys });
    } else {
      ops.push({ op: 'node-params', id, keys });
    }
  }
  for (const id of prev.nodes.keys()) {
    if (!next.nodes.has(id)) { removed.add(id); ops.push({ op: 'node-remove', id }); }
  }
  for (const [id, e] of next.edges) {
    const p = prev.edges.get(id);
    if (!p) { ops.push({ op: 'edge-add', id }); continue; }
    const moved = p.from.node !== e.from.node || p.from.port !== e.from.port
      || p.to.node !== e.to.node || p.to.port !== e.to.port || p.kind !== e.kind;
    if (moved) {
      ops.push({ op: 'edge-remove', id }, { op: 'edge-add', id });
      continue;
    }
    if (replaced.has(e.from.node) || replaced.has(e.to.node) || p.status !== e.status
      || p.props.mapping !== e.props.mapping) {
      ops.push({ op: 'edge-rewire', id });
      continue;
    }
    const keys = changedKeys(p.props, e.props);
    if (keys.length) ops.push({ op: 'edge-props', id, keys });
  }
  for (const id of prev.edges.keys()) {
    if (!next.edges.has(id)) ops.push({ op: 'edge-remove', id });
  }
  return ops;
}
