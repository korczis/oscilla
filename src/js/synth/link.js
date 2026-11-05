// The Synth deep link as panel state (plan K106 part): pure functions between the StudioModel
// and the decoded link of core/url-state-synth.js, so a copied link reopens the same sound.
//
//   linkOf(model, panel, presetId) -> { preset, values, cables }
//     values: [['module.param' | 'module.amount', value]] that differ from the preset;
//     cables: [['module.port', 'module.port']] the user's cables (normals.js panelCables).
//   linkAction(model, panel, link, { registry, modules }) -> BATCH action   one history entry
//     modules: the module ids the link may write (an XY preset, synth/xy.js xyScope); null,
//     the default, is the whole panel. Outside them no value, preset or cable is touched.
//
// A link reopens the sender's patch whatever the receiver's panel holds: the receiver's cables
// are removed and the normals they broke restored first (in the same BATCH), then the preset,
// the values and the link's cables apply on that panel. A cable takes the depth of the amount
// knob that covers it (its source and its jack), from the link or else from the preset,
// because linkOf records an amount only where it differs from the preset. Normals a cable
// breaks are removed once, however many cables break them.

import { NODE_REGISTRY } from '../studio/registry.js';
import { amountEdges, normalSteps, panelCables, panelEdges, patchCable } from './normals.js';
import { presetAction, presetOf, presetValues } from './presets.js';

/**
 * `model` with the panel's cables removed and the normals they broke back (declared props);
 * with `within` (a Set of module ids) only the cables whose both ends are those modules.
 */
function unpatched(model, panel, within = null) {
  const moduleOf = new Map([...panel.resolve(model)].filter(([, n]) => n)
    .map(([mid, n]) => [n.id, mid]));
  const inside = (e) => !within || (within.has(moduleOf.get(e.from.node))
    && within.has(moduleOf.get(e.to.node)));
  const cables = panelEdges(model, panel).cables.filter(inside);
  if (!cables.length) return { model, steps: [] };
  const gone = new Set(cables.map((e) => e.id));
  const bare = { ...model, graph: { ...model.graph,
    edges: model.graph.edges.filter((e) => !gone.has(e.id)) } };
  const jacks = [...new Set(panelCables(model, panel).filter((c) => gone.has(c.id))
    .map((c) => c.to))];
  const adds = jacks.flatMap((j) => normalSteps(bare, panel, j));
  const edges = adds.map((s) => ({ id: s.id, from: s.from, to: s.to,
    props: { muted: false, ...s.props } }));
  return { model: { ...bare, graph: { ...bare.graph, edges: [...bare.graph.edges, ...edges] } },
    steps: [{ type: 'EDGE_REMOVE', edgeIds: [...gone] }, ...adds] };
}

export function linkOf(model, panel, presetId) {
  const p = presetOf(presetId) || presetOf('init');
  const base = presetValues(panel, p);
  const res = panel.resolve(model);
  const values = [];
  for (const mod of panel.modules) {
    const n = res.get(mod.id);
    if (!n || mod.def.maxInstances === 1) continue;
    for (const c of panel.faceOf(mod.id)) {
      if (c.kind === 'amount') {
        const e = amountEdges(model, panel, c.amount)[0];
        if (e && e.props.depth !== (p.amounts[c.key] ?? 0)) {
          values.push([`${mod.id}.${c.key}`, e.props.depth]);
        }
      } else if (n.params[c.key] !== base[mod.id][c.key]) {
        values.push([`${mod.id}.${c.key}`, n.params[c.key]]);
      }
    }
  }
  return { preset: p.id, values, cables: panelCables(model, panel).map((c) => [c.from, c.to]) };
}

export function linkAction(model0, panel, link, { registry = NODE_REGISTRY, modules = null }
  = {}) {
  const p = presetOf(link.preset || 'init') || presetOf('init');
  const within = modules ? new Set(modules) : null;
  const ours = (jack) => !within || within.has(String(jack).split('.')[0]);
  const clean = unpatched(model0, panel, within);
  const model = clean.model;
  const steps = [
    ...clean.steps,
    // one PATCH_REPLACE step: the whole panel, or exactly the modules given
    presetAction(model, panel, p.id, modules ? { modules } : { all: true }).action,
  ];
  const given = new Map(link.values);
  const nodes = panel.resolve(model);
  for (const [k, v] of link.values) {
    const [mid, key] = k.split('.');
    const node = ours(mid) ? nodes.get(mid) : null;
    const c = node && panel.faceOf(mid).find((x) => x.key === key);
    if (!c) continue;
    if (c.kind === 'amount') {
      for (const e of amountEdges(model, panel, c.amount)) {
        steps.push({ type: 'EDGE_UPDATE', edgeId: e.id, props: { depth: v } });
      }
    } else steps.push({ type: 'NODE_PARAM_SET', nodeId: node.id, key, value: v });
  }
  const removed = new Set();
  for (const [from, to] of link.cables) {
    if (!ours(from) || !ours(to)) continue;
    const r = patchCable(model, panel, from, to, { registry });
    if (!r.action) continue;
    for (const s of r.action.steps) {
      if (s.type === 'EDGE_REMOVE') {
        const ids = s.edgeIds.filter((id) => !removed.has(id));
        ids.forEach((id) => removed.add(id));
        if (ids.length) steps.push({ ...s, edgeIds: ids });
        continue;
      }
      const a = panel.amounts.find((x) => x.source === from && x.to.includes(to));
      if (!a) { steps.push(s); continue; }
      const key = `${a.module}.${a.key}`;
      const depth = given.has(key) ? given.get(key) : (p.amounts[a.key] ?? 0);
      steps.push({ ...s, props: { ...(s.props || {}), depth } });
    }
  }
  return { type: 'BATCH', label: 'Apply link to Synth panel', steps };
}
