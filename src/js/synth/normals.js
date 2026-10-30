// Normalling of a Synth panel (plan K061; design §2): pure functions from the StudioModel and a
// panel declaration to the ONE store action that makes a cable change. The panel never repairs
// the model: a normal removed in the Studio graph stays removed ('open') until the user restores
// it, and every change is one BATCH (one history entry, one commit-gate call).
//
//   panelEdges(model, panel) -> { normals: Map<normal id, edge>, cables: [edge], foreign: [edge] }
//     cables: non-normal edges between panel modules; foreign: edges into a panel jack from a
//     node outside the panel (a Studio edit)
//   panelCables(model, panel) -> [{ id, from, to, fromModule }]   the cables as jack ids
//   jackState(model, panel, jackId) -> 'normalled' | 'patched' | 'mixed' | 'open' | 'free'
//     mixed: something the panel did not patch (a Studio edge) feeds the jack while its normals
//     still sound; breakNormals(model, panel, jackId) is the panel's way to make it 'patched'
//   jackReason(model, panel, jackId) -> why a cable into the jack would do nothing, or null
//   cableProps(model, panel, from, to, { memory }) -> the props a new cable gets
//   patchCable(model, panel, fromJack, toJack, { registry, memory }) -> { action } | { reason }
//   unpatch(model, panel, edgeId, { memory }) -> { action } | { reason }
//   restoreNormals(model, panel, jackId, { memory }) -> { action } | { reason }
//   amountEdges(model, panel, amount) -> [edge];  setAmount(model, panel, amount, depth) -> action
//   createAmountMemory(panel) -> { note(model), depth(amountKey) }   the last depth of each
//     amount knob in this session, so a knob whose every edge a cable broke comes back at its
//     setting when the normal is restored (the model holds a depth only on an edge)
//
// A new cable's props (review of #329): the props of the normal it replaces when it has the
// same source; else polarity and mapping of a normal of the jack whose source has the same
// range; else from the source's range (a unipolar source is unipolar, a pitch source in octaves
// into an octave or log input tracks 1.00 oct per octave). An amount knob that covers the cable
// gives its depth, so one knob never sits over unequal depths. The source ranges are the
// runtime adapters' (panel.source, proved equal in tests/unit/synth-review-329-round2).

import { NODE_REGISTRY } from '../studio/registry.js';
import { defaultEdgeProps } from '../studio/ports.js';
import { splitJack } from './panel.js';

const nodeIds = (model, panel) => {
  const map = panel.resolve(model);
  return { map, id: (mid) => (map.get(mid) ? map.get(mid).id : null) };
};
const endsAt = (e, node, port) => e.to.node === node && e.to.port === port;
const startsAt = (e, node, port) => e.from.node === node && e.from.port === port;

/**
 * The edge that is normal `n`, if present: its own id (`panel-instance-nX`, the id instantiate,
 * unpatch and restore give it) on the normal's endpoints. A cable the user patches between the
 * same jacks has another id, so it stays a cable: it is drawn, listed, removable and linked.
 */
function normalEdge(model, n, id) {
  const a = splitJack(n.from);
  const b = splitJack(n.to);
  const from = id(a.module);
  const to = id(b.module);
  if (!from || !to) return null;
  return model.graph.edges.find((e) => e.id === n.edgeId && startsAt(e, from, a.port)
    && endsAt(e, to, b.port)) || null;
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
  const foreign = model.graph.edges.filter((e) => !taken.has(e.id) && !mine.has(e.from.node)
    && mine.has(e.to.node));
  return { normals, cables, foreign };
}

/** The user's cables as jacks: [{ id, from: 'module.port', to: 'module.port', fromModule }]. */
export function panelCables(model, panel) {
  const byNode = new Map([...panel.resolve(model)].filter(([, n]) => n)
    .map(([mid, n]) => [n.id, mid]));
  return panelEdges(model, panel).cables.map((e) => {
    const fm = byNode.get(e.from.node);
    return { id: e.id, from: `${fm}.${e.from.port}`, to: `${byNode.get(e.to.node)}.${e.to.port}`,
      fromModule: fm };
  });
}

/** Cables (non-normal edges) into input jack `jack`; `foreign` adds edges from outside. */
function cablesInto(model, panel, jack, { foreign = false } = {}) {
  const { id } = nodeIds(model, panel);
  const { module, port } = splitJack(jack);
  const node = id(module);
  const pe = panelEdges(model, panel);
  return [...pe.cables, ...(foreign ? pe.foreign : [])].filter((e) => endsAt(e, node, port));
}

export function jackState(model, panel, jack) {
  const rows = panel.normals.filter((n) => n.to === jack);
  const { normals } = panelEdges(model, panel);
  const live = rows.some((n) => normals.has(n.id));
  if (cablesInto(model, panel, jack, { foreign: true }).length) return live ? 'mixed' : 'patched';
  if (!rows.length) return 'free';
  return live ? 'normalled' : 'open';
}

export const STATE_TEXT = Object.freeze({
  normalled: 'normalled', patched: 'patched', free: 'free',
  open: 'open: normal removed in Studio',
  mixed: 'patched in Studio while its normal still sounds',
});

/** Why a cable into `jack` would do nothing now (project.no-inert-surfaces), or null. */
export function jackReason(model, panel, jack) {
  const { module, port } = splitJack(jack);
  const m = panel.module(module);
  const node = panel.resolve(model).get(module);
  if (m && node && m.node === 'random' && port === 'rate'
    && model.graph.edges.some((e) => e.to.node === node.id && e.to.port === 'trigger')) {
    return `${m.label} Rate has no effect while Clock is patched (normalled to the keyboard `
      + 'gate): each gate steps the value. Unpatch Clock first.';
  }
  return null;
}

export function createAmountMemory(panel) {
  const depths = new Map();
  return {
    note(model) {
      for (const a of panel.amounts) {
        const e = amountEdges(model, panel, a)[0];
        if (e) depths.set(a.key, e.props.depth);
      }
    },
    depth: (key) => (depths.has(key) ? depths.get(key) : null),
  };
}

/** The depth amount knob `a` shows: its first edge's, else the session memory's, else null. */
function amountDepth(model, panel, a, memory) {
  const e = amountEdges(model, panel, a)[0];
  if (e) return e.props.depth;
  return memory ? memory.depth(a.key) : null;
}
const coverOf = (panel, from, to) => panel.amounts.find((a) => a.source === from
  && a.to.includes(to)) || null;
const sameRange = (x, y) => x[0] === y[0] && x[1] === y[1];
const CONTROL_KEYS = ['depth', 'polarity', 'mapping', 'offset'];
const pick = (props) => Object.fromEntries(CONTROL_KEYS.filter((k) => props[k] !== undefined)
  .map((k) => [k, props[k]]));

export function cableProps(model, panel, from, to, { registry = NODE_REGISTRY, memory = null }
  = {}) {
  const inp = portOf(panel, to, 'in', registry);
  if (!inp || inp.type !== 'CONTROL') return undefined;
  const b = splitJack(to);
  const pd = inp.param ? registry.param(panel.module(b.module).node, inp.param.key) : null;
  const log = !!pd && pd.scale === 'log';
  const src = panel.source(from);
  const [lo, hi] = src.range;
  const unipolar = lo >= 0;
  const tracks = src.unit === 'oct' && (log || (pd && pd.unit === 'oct'));
  const fallback = tracks ? (unipolar ? hi - lo : (hi - lo) / 2)
    : log ? 1 : defaultEdgeProps('CONTROL', inp, pd).depth;
  const rows = panel.normals.filter((n) => n.to === to);
  const same = rows.find((n) => n.from === from);
  const kin = rows.find((n) => sameRange(panel.sourceRange(n.from), src.range));
  let props;
  if (same) props = pick(same.props);
  else if (kin) props = { ...pick(kin.props), depth: kin.props.depth || fallback, offset: 0 };
  else {
    props = { depth: fallback, polarity: unipolar ? 'unipolar' : 'bipolar',
      mapping: log ? 'log' : 'linear', offset: 0 };
  }
  const a = coverOf(panel, from, to);
  const d = a ? amountDepth(model, panel, a, memory) : null;
  if (d !== null) props.depth = d;
  return props;
}

const portOf = (panel, jack, dir, registry) => {
  const { module, port } = splitJack(jack);
  const m = panel.module(module);
  return m ? registry.port(m.node, port, dir) : null;
};

export function patchCable(model, panel, from, to, { registry = NODE_REGISTRY, memory = null }
  = {}) {
  const { id } = nodeIds(model, panel);
  const a = splitJack(from);
  const b = splitJack(to);
  if (!id(a.module) || !id(b.module)) return { reason: 'That module is not in the Studio.' };
  const out = portOf(panel, from, 'out', registry);
  const inp = portOf(panel, to, 'in', registry);
  if (!out || !inp || !panel.jacksOf(b.module).some((j) => j.id === to && j.direction === 'in')
    || !panel.jacksOf(a.module).some((j) => j.id === from && j.direction === 'out')) {
    return { reason: 'A cable runs from an output jack to an input jack.' };
  }
  const why = jackReason(model, panel, to);
  if (why) return { reason: why };
  const steps = [];
  const { normals } = panelEdges(model, panel);
  const broken = panel.normals.filter((n) => n.to === to && normals.has(n.id))
    .map((n) => normals.get(n.id).id);
  const replaced = inp.multiple ? []
    : cablesInto(model, panel, to, { foreign: true }).map((e) => e.id);
  const same = model.graph.edges.find((e) => startsAt(e, id(a.module), a.port)
    && endsAt(e, id(b.module), b.port) && !broken.includes(e.id));
  if (same) return { reason: 'That cable is already patched.' };
  const gone = [...broken, ...replaced];
  if (gone.length) steps.push({ type: 'EDGE_REMOVE', edgeIds: gone });
  steps.push({ type: 'EDGE_ADD', from: { node: id(a.module), port: a.port },
    to: { node: id(b.module), port: b.port },
    props: cableProps(model, panel, from, to, { registry, memory }) });
  return { action: { type: 'BATCH', label: `Patch ${from} to ${to}`, steps } };
}

/**
 * Normal edges of `jack` that are missing, as EDGE_ADD steps with their own ids; a normal an
 * amount knob covers comes back at the knob's depth (read before the cable is removed).
 */
export function normalSteps(model, panel, jack, { memory = null } = {}) {
  const { id } = nodeIds(model, panel);
  const { normals } = panelEdges(model, panel);
  const steps = [];
  for (const n of panel.normals.filter((x) => x.to === jack && !normals.has(x.id))) {
    const a = splitJack(n.from);
    const b = splitJack(n.to);
    if (!id(a.module) || !id(b.module)) continue;
    if (model.graph.edges.some((e) => e.id === n.edgeId)) continue;
    const cover = coverOf(panel, n.from, n.to);
    const d = cover ? amountDepth(model, panel, cover, memory) : null;
    steps.push({ type: 'EDGE_ADD', id: n.edgeId, from: { node: id(a.module), port: a.port },
      to: { node: id(b.module), port: b.port },
      props: d === null ? n.props : { ...n.props, depth: d } });
  }
  return steps;
}

export function unpatch(model, panel, edgeId, { memory = null } = {}) {
  const e = model.graph.edges.find((x) => x.id === edgeId);
  if (!e) return { reason: 'That cable is not patched.' };
  const map = panel.resolve(model);
  let jack = null;
  for (const [mid, node] of map) if (node && node.id === e.to.node) jack = `${mid}.${e.to.port}`;
  const steps = [{ type: 'EDGE_REMOVE', edgeIds: [edgeId] }];
  const rest = jack ? cablesInto(model, panel, jack, { foreign: true })
    .filter((x) => x.id !== edgeId) : [1];
  if (jack && !rest.length) steps.push(...normalSteps(model, panel, jack, { memory }));
  return { action: { type: 'BATCH', label: `Remove cable into ${jack || e.to.port}`, steps } };
}

export function restoreNormals(model, panel, jack, { memory = null } = {}) {
  const steps = normalSteps(model, panel, jack, { memory });
  if (!steps.length) return { reason: 'Nothing to restore: every normal of this jack is there.' };
  return { action: { type: 'BATCH', label: `Restore normal into ${jack}`, steps } };
}

/** Remove the live normals of a jack something else feeds ('mixed' -> 'patched'). */
export function breakNormals(model, panel, jack) {
  const { normals } = panelEdges(model, panel);
  const ids = panel.normals.filter((n) => n.to === jack && normals.has(n.id))
    .map((n) => normals.get(n.id).id);
  if (!ids.length) return { reason: 'No normal of this jack is sounding.' };
  return { action: { type: 'BATCH', label: `Break normal into ${jack}`,
    steps: [{ type: 'EDGE_REMOVE', edgeIds: ids }] } };
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
