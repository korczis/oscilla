// The Synth deep link as panel state (plan K106 part): pure functions between the StudioModel
// and the decoded link of core/url-state-synth.js, so a copied link reopens the same sound.
//
//   linkOf(model, panel, presetId) -> { preset, values, cables }
//     values: [['module.param' | 'module.amount', value]] that differ from the preset;
//     cables: [['module.port', 'module.port', props?]] the user's cables (normals.js
//     panelCables), each with the props (depth, polarity, mapping, offset, muted) where they
//     differ from what linkAction would give it (review S7: an Inspector edit, the XY pad's Y
//     range); a cable without them is rebuilt as before.
//   linkOmissions(model, panel) -> { studio: [edge id], open: ['module.port'] }   what a link of
//     this patch does not carry (K239): Studio connections touching the panel's modules (not
//     normals, not panel cables) and inputs whose normal was removed in the Studio ('open');
//   linkOmissionText(omissions) -> Czech sentence | null   said when the link is copied
//   linkPlan(model, panel, link, { registry, modules }) -> { action, skipped }   the BATCH and
//     the link's cables it does not apply because patchCable refuses them on the receiver's
//     state, [{ from, to, reason }] (K239: never dropped in silence; sh.rate while Clock clocks)
//   skippedText(skipped, name?) -> Czech sentence | null   what the Synth says after applying the link
//   linkAction(model, panel, link, { registry, modules }) -> BATCH action   one history entry
//     modules: the module ids the link may write (an XY preset, synth/xy.js xyScope); null,
//     the default, is the whole panel. Outside them no value, preset or cable is touched.
//
// A link reopens the sender's patch whatever the receiver's panel holds: the receiver's cables
// are removed and the normals they broke restored first (in the same BATCH), then the preset,
// the values and the link's cables apply on that panel. A cable takes the depth of the amount
// knob that covers it (its source and its jack), from the link or else from the preset,
// because linkOf records an amount only where it differs from the preset. Normals a cable
// breaks are removed once, however many cables break them. A knob whose every edge a cable
// broke is linked at the depth the model remembers (metadata.synthAmounts, normals.js
// rememberAmounts), and linkAction remembers it on the receiver in the same BATCH, so removing
// the cable there brings the knob back at the sender's setting (review S10).

import { NODE_REGISTRY } from '../studio/registry.js';
import { EDGE_PROPERTY_FIELDS, defaultEdgeProps } from '../studio/ports.js';
import {
  amountDepth, amountEdges, cableProps, jackState, normalSteps, panelCables, panelEdges,
  patchCable,
} from './normals.js';
import { splitJack } from './panel.js';
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

/**
 * The props of cable `c` that differ from the ones linkAction builds for it: cableProps, the
 * covering amount knob's depth, then the port's defaults. null when none differ.
 */
function ownProps(model, panel, c, registry) {
  const e = model.graph.edges.find((x) => x.id === c.id);
  const { module, port } = splitJack(c.to);
  const node = panel.module(module).node;
  const inp = registry.port(node, port, 'in');
  if (!e || !inp) return null;
  const built = { ...(cableProps(model, panel, c.from, c.to, { registry }) || {}) };
  const a = panel.amounts.find((x) => x.source === c.from && x.to.includes(c.to));
  if (a) built.depth = amountDepth(model, panel, a);
  const want = { ...defaultEdgeProps(inp.type, inp,
    inp.param ? registry.param(node, inp.param.key) : null), ...built };
  const own = EDGE_PROPERTY_FIELDS[inp.type].filter((k) => e.props[k] !== undefined
    && e.props[k] !== want[k]).map((k) => [k, e.props[k]]);
  return own.length ? Object.fromEntries(own) : null;
}

export function linkOf(model, panel, presetId, { registry = NODE_REGISTRY } = {}) {
  const p = presetOf(presetId) || presetOf('init');
  const base = presetValues(panel, p);
  const res = panel.resolve(model);
  const values = [];
  for (const mod of panel.modules) {
    const n = res.get(mod.id);
    if (!n || mod.def.maxInstances === 1) continue;
    for (const c of panel.faceOf(mod.id)) {
      if (c.kind === 'amount') {
        const d = amountDepth(model, panel, c.amount);
        if (d !== null && d !== (p.amounts[c.key] ?? 0)) values.push([`${mod.id}.${c.key}`, d]);
      } else if (n.params[c.key] !== base[mod.id][c.key]) {
        values.push([`${mod.id}.${c.key}`, n.params[c.key]]);
      }
    }
  }
  return { preset: p.id, values, cables: panelCables(model, panel).map((c) => {
    const own = ownProps(model, panel, c, registry);
    return own ? [c.from, c.to, own] : [c.from, c.to];
  }) };
}

export function linkOmissions(model, panel) {
  const pe = panelEdges(model, panel);
  const kept = new Set([...[...pe.normals.values()].map((e) => e.id),
    ...pe.cables.map((e) => e.id)]);
  const mine = new Set([...panel.resolve(model).values()].filter(Boolean).map((n) => n.id));
  const studio = model.graph.edges.filter((e) => !kept.has(e.id)
    && (mine.has(e.from.node) || mine.has(e.to.node))).map((e) => e.id);
  const open = [];
  for (const m of panel.modules) {
    if (!panel.resolve(model).get(m.id)) continue;
    for (const j of panel.jacksOf(m.id)) {
      if (j.direction === 'in' && jackState(model, panel, j.id) === 'open') open.push(j.id);
    }
  }
  return { studio, open };
}

export function linkOmissionText({ studio, open }) {
  const parts = [];
  if (studio.length) parts.push(`${studio.length} spojení se Studiem`);
  if (open.length) {
    parts.push(`${open.length === 1 ? 'normál odpojený' : 'normály odpojené'} ve Studiu `
      + `(${open.join(', ')})`);
  }
  return parts.length ? `Odkaz nenese ${parts.join(' ani ')}; kdo ho otevře, dostane panel `
    + 'bez nich.' : null;
}

/** Czech count of cables: 1 kabel, 2-4 kabely, 5 and more kabelů. */
const cablesWord = (n) => (n === 1 ? 'kabel' : n >= 2 && n <= 4 ? 'kabely' : 'kabelů');

export function skippedText(skipped, name = (id) => id) {
  if (!skipped.length) return null;
  // The jacks by the names the bay shows (K243, R2-T7B-2), not their ids.
  const which = skipped.map((x) => `${name(x.from)} → ${name(x.to)} `
    + `(${x.reason.replace(/\.$/, '')})`);
  return `Odkaz nezapojil ${skipped.length} ${cablesWord(skipped.length)}: ${which.join('; ')}.`;
}

export function linkAction(model0, panel, link, opts = {}) {
  return linkPlan(model0, panel, link, opts).action;
}

export function linkPlan(model0, panel, link, { registry = NODE_REGISTRY, modules = null }
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
  const skipped = [];
  for (const [from, to, own] of link.cables) {
    if (!ours(from) || !ours(to)) continue;
    const r = patchCable(model, panel, from, to, { registry });
    if (!r.action) {
      skipped.push({ from, to, reason: r.reason });
      continue;
    }
    for (const s of r.action.steps) {
      if (s.type === 'METADATA_SET') continue; // remembered below, at the link's depths
      if (s.type === 'EDGE_REMOVE') {
        const ids = s.edgeIds.filter((id) => !removed.has(id));
        ids.forEach((id) => removed.add(id));
        if (ids.length) steps.push({ ...s, edgeIds: ids });
        continue;
      }
      const a = s.type === 'EDGE_ADD'
        && panel.amounts.find((x) => x.source === from && x.to.includes(to));
      const key = a && `${a.module}.${a.key}`;
      const depth = a && (given.has(key) ? given.get(key) : (p.amounts[a.key] ?? 0));
      steps.push(a || (own && s.type === 'EDGE_ADD') ? { ...s, props: { ...(s.props || {}),
        ...(a ? { depth } : {}), ...own } } : s);
    }
  }
  const kept = panel.amounts.filter((a) => ours(a.module)).map((a) => [a, amountEdges(model,
    panel, a)]).filter(([, edges]) => edges.length && edges.every((e) => removed.has(e.id)))
    .map(([a]) => [a.key, given.get(`${a.module}.${a.key}`) ?? p.amounts[a.key] ?? 0]);
  if (kept.length) steps.push({ type: 'METADATA_SET', synthAmounts: Object.fromEntries(kept) });
  return { action: { type: 'BATCH', label: 'Použít odkaz na panel Synthu', steps }, skipped };
}
