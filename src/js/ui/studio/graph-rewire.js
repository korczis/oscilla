// Studio graph cable rewiring (plan K008, moved out of graph-gestures.js by K006 for headroom):
// the pure decision where a cable dropped on a node's body goes, and the end of a cable drag as
// one history entry. No DOM, no Web Audio; the gesture code (graph-gestures.js) calls them.
//
//   bodyTarget(verdicts, nodeId) -> verdict | null   the input a cable dropped on a node's body
//     takes (a free one before one it would replace)
//   rewireCable(store, { from, to, detach, registry }) -> { ok, changed, text, label? }   the
//     end of a cable drag (K008) as one history entry: EDGE_REMOVE of the picked-up cable and of
//     the cable an occupied single input had, then EDGE_ADD; `to` null deletes the picked-up
//     cable. probeRewire judges first: a refusal dispatches nothing (model, history, revision
//     and the runtime gate untouched) and a store refusal after it cancels the whole gesture.
//     A moved cable stays muted when it was; depth, polarity, mapping and offset carry over
//     only to the same parameter of the same node type.

import { announceAction } from '../../studio/a11y.js';
import { probeRewire } from './graph-view.js';

/**
 * The input of node `nodeId` a cable dropped on its body takes, from connectionTargets verdicts:
 * the first free compatible one; one that replaces a cable (K008) only when the node has no
 * free one; else the first refusal (its reason is said); null when the node has no input.
 */
export function bodyTarget(verdicts, nodeId) {
  let firstReason = null;
  let firstReplace = null;
  for (const t of verdicts) {
    if (t.node !== nodeId) continue;
    if (t.allowed && !(t.replaces && t.replaces.length)) return t;
    if (t.allowed && !firstReplace) firstReplace = t;
    if (!t.allowed && !firstReason) firstReason = t;
  }
  return firstReplace || firstReason;
}

const nameOf = (m, id) => {
  const n = m.graph.nodes.find((x) => x.id === id);
  return n ? n.metadata.name : id;
};

export function rewireCable(store, { from, to = null, detach = null, registry } = {}) {
  const m = store.getModel();
  const old = detach ? m.graph.edges.find((e) => e.id === detach) : null;
  if (!to) {
    if (!old) return { ok: false, changed: false, text: 'Nothing to delete.' };
    const r = store.dispatch({ type: 'EDGE_REMOVE', edgeIds: [old.id] });
    return { ok: r.ok, changed: !!r.changed, text: announceAction(r), label: r.label };
  }
  const v = probeRewire(m, from, to, { detach, registry });
  if (!v.allowed) return { ok: false, changed: false, text: v.reason };
  if (v.same) return { ok: true, changed: false, text: 'Connection unchanged' };
  const replaced = v.replaces.map((id) => m.graph.edges.find((e) => e.id === id));
  const label = old ? `Reconnect ${nameOf(m, from.node)} to ${nameOf(m, to.node)}`
    : `Replace the connection into ${nameOf(m, to.node)}`;
  // A cable moved to the same parameter keeps its settings (depth, polarity, mapping, offset);
  // a muted one stays muted wherever it goes (a move never makes a silenced signal audible).
  const typeOf = (id) => (m.graph.nodes.find((n) => n.id === id) || {}).type;
  const keep = !!old && old.to.port === to.port && typeOf(old.to.node) === typeOf(to.node);
  const props = keep ? old.props : old && old.props && old.props.muted ? { muted: true } : null;
  const addEdge = () => store.dispatch({ type: 'EDGE_ADD', from, to, ...(props ? { props } : {}) });
  if (!v.remove.length) {
    const r = addEdge(); // a new cable to a free input: the plain EDGE_ADD of before K008
    return { ok: r.ok, changed: !!r.changed, text: announceAction(r), label: r.label,
      created: r.created };
  }
  store.beginGesture(label);
  const rm = store.dispatch({ type: 'EDGE_REMOVE', edgeIds: v.remove });
  const add = rm.ok ? addEdge() : rm;
  if (!add.ok) {
    // A refused return to the start keeps what was dispatched as one undo entry (actions.js).
    if (store.cancelGesture()) return { ok: false, changed: false, text: announceAction(add) };
    return { ok: false, changed: true, text: `${announceAction(add).replace(/\.$/, '')}. The `
      + 'cable was removed and not put back: Undo restores it' };
  }
  store.endGesture();
  const text = `${announceAction(add)}${replaced.length ? `, replacing the connection from ${
    replaced.map((e) => nameOf(m, e.from.node)).join(', ')}` : ''}`;
  return { ok: true, changed: true, text, label, created: add.created };
}
