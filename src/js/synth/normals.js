// Normalling of a Synth panel (plan K061; design §2): pure functions from the StudioModel and a
// panel declaration to the ONE store action that makes a cable change. The panel never repairs
// the model: a normal removed in the Studio graph stays removed ('open') until the user restores
// it, and every change is one BATCH (one history entry, one commit-gate call).
//
//   panelEdges(model, panel) -> { normals: Map<normal id, edge>, cables: [edge] }
//   jackState(model, panel, jackId) -> 'normalled' | 'patched' | 'open' | 'free'
//   patchCable(model, panel, fromJack, toJack) -> { action } | { reason }
//   unpatch(model, panel, edgeId) -> { action } | { reason }
//   restoreNormals(model, panel, jackId) -> { action } | { reason }
//   amountEdges(model, panel, amount) -> [edge];  setAmount(model, panel, amount, depth) -> action

import { NODE_REGISTRY } from '../studio/registry.js';
import { splitJack } from './panel.js';

const nodeIds = (model, panel) => {
  const map = panel.resolve(model);
  return { map, id: (mid) => (map.get(mid) ? map.get(mid).id : null) };
};
const endsAt = (e, node, port) => e.to.node === node && e.to.port === port;
const startsAt = (e, node, port) => e.from.node === node && e.from.port === port;

/** The edge that is normal `n` (same endpoints), if present. */
function normalEdge(model, n, id) {
  const a = splitJack(n.from);
  const b = splitJack(n.to);
  const from = id(a.module);
  const to = id(b.module);
  if (!from || !to) return null;
  return model.graph.edges.find((e) => startsAt(e, from, a.port) && endsAt(e, to, b.port))
    || null;
}

export function panelEdges(model, panel) {
  const { map, id } = nodeIds(model, panel);
  const normals = new Map();
  const taken = new Set();
  for (const n of panel.normals) {
    const e = normalEdge(model, n, id);
    if (e) { normals.set(n.id, e); taken.add(e.id); }
  }
  const mine = new Set([...map.values()].filter(Boolean).map((n) => n.id));
  const cables = model.graph.edges.filter((e) => !taken.has(e.id) && mine.has(e.from.node)
    && mine.has(e.to.node));
  return { normals, cables };
}

/** Cables (non-normal edges) into input jack `jack`. */
function cablesInto(model, panel, jack) {
  const { id } = nodeIds(model, panel);
  const { module, port } = splitJack(jack);
  const node = id(module);
  const { cables } = panelEdges(model, panel);
  return cables.filter((e) => endsAt(e, node, port));
}

export function jackState(model, panel, jack) {
  const rows = panel.normals.filter((n) => n.to === jack);
  if (cablesInto(model, panel, jack).length) return 'patched';
  if (!rows.length) return 'free';
  const { normals } = panelEdges(model, panel);
  return rows.some((n) => normals.has(n.id)) ? 'normalled' : 'open';
}

export const STATE_TEXT = Object.freeze({
  normalled: 'normalled', patched: 'patched', free: 'free',
  open: 'open: normal removed in Studio',
});

const portOf = (panel, jack, dir, registry) => {
  const { module, port } = splitJack(jack);
  const m = panel.module(module);
  return m ? registry.port(m.node, port, dir) : null;
};

export function patchCable(model, panel, from, to, { registry = NODE_REGISTRY } = {}) {
  const { id } = nodeIds(model, panel);
  const a = splitJack(from);
  const b = splitJack(to);
  if (!id(a.module) || !id(b.module)) return { reason: 'That module is not in the Studio.' };
  const out = portOf(panel, from, 'out', registry);
  const inp = portOf(panel, to, 'in', registry);
  if (!out || !inp) return { reason: 'A cable runs from an output jack to an input jack.' };
  const steps = [];
  const { normals } = panelEdges(model, panel);
  const broken = panel.normals.filter((n) => n.to === to && normals.has(n.id))
    .map((n) => normals.get(n.id).id);
  const replaced = inp.multiple ? [] : cablesInto(model, panel, to).map((e) => e.id);
  const same = model.graph.edges.find((e) => startsAt(e, id(a.module), a.port)
    && endsAt(e, id(b.module), b.port) && !broken.includes(e.id));
  if (same) return { reason: 'That cable is already patched.' };
  const gone = [...broken, ...replaced];
  if (gone.length) steps.push({ type: 'EDGE_REMOVE', edgeIds: gone });
  const pd = inp.param ? registry.param(panel.module(b.module).node, inp.param.key) : null;
  steps.push({ type: 'EDGE_ADD', from: { node: id(a.module), port: a.port },
    to: { node: id(b.module), port: b.port },
    props: pd && pd.scale === 'log' ? { mapping: 'log', depth: 1 } : undefined });
  return { action: { type: 'BATCH', label: `Patch ${from} to ${to}`, steps } };
}

/** Normal edges of `jack` that are missing, as EDGE_ADD steps with their own ids. */
function normalSteps(model, panel, jack) {
  const { id } = nodeIds(model, panel);
  const { normals } = panelEdges(model, panel);
  const steps = [];
  for (const n of panel.normals.filter((x) => x.to === jack && !normals.has(x.id))) {
    const a = splitJack(n.from);
    const b = splitJack(n.to);
    if (!id(a.module) || !id(b.module)) continue;
    if (model.graph.edges.some((e) => e.id === n.edgeId)) continue;
    steps.push({ type: 'EDGE_ADD', id: n.edgeId, from: { node: id(a.module), port: a.port },
      to: { node: id(b.module), port: b.port }, props: n.props });
  }
  return steps;
}

export function unpatch(model, panel, edgeId) {
  const e = model.graph.edges.find((x) => x.id === edgeId);
  if (!e) return { reason: 'That cable is not patched.' };
  const map = panel.resolve(model);
  let jack = null;
  for (const [mid, node] of map) if (node && node.id === e.to.node) jack = `${mid}.${e.to.port}`;
  const steps = [{ type: 'EDGE_REMOVE', edgeIds: [edgeId] }];
  const rest = jack ? cablesInto(model, panel, jack).filter((x) => x.id !== edgeId) : [1];
  if (jack && !rest.length) steps.push(...normalSteps(model, panel, jack));
  return { action: { type: 'BATCH', label: `Remove cable into ${jack || e.to.port}`, steps } };
}

export function restoreNormals(model, panel, jack) {
  const steps = normalSteps(model, panel, jack);
  if (!steps.length) return { reason: 'Nothing to restore: every normal of this jack is there.' };
  return { action: { type: 'BATCH', label: `Restore normal into ${jack}`, steps } };
}

export function amountEdges(model, panel, amount) {
  const { id } = nodeIds(model, panel);
  const src = splitJack(amount.source);
  const from = id(src.module);
  return amount.to.flatMap((t) => {
    const b = splitJack(t);
    const to = id(b.module);
    return model.graph.edges.filter((e) => startsAt(e, from, src.port) && endsAt(e, to, b.port));
  });
}

export function setAmount(model, panel, amount, depth) {
  const edges = amountEdges(model, panel, amount);
  if (!edges.length) return null;
  return { type: 'BATCH', label: `Change ${amount.label}`,
    steps: edges.map((e) => ({ type: 'EDGE_UPDATE', edgeId: e.id, props: { depth } })) };
}

/** Why an amount knob is disabled, or null when it edits at least one edge. */
export function amountReason(model, panel, amount) {
  if (amountEdges(model, panel, amount).length) return null;
  const src = panel.module(splitJack(amount.source).module);
  return `Nothing from ${src ? src.label : amount.source} is patched into `
    + `${amount.to.join(' or ')}.`;
}
