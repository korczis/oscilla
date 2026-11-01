// The XY tab's panel state (plan K097): pure functions from the StudioModel and the Synth panel
// to the ONE store action of each change, over normals.js (cables), link.js (whole-panel state)
// and studio/patches.js (presets). No DOM, no Web Audio.
//
// An XY preset is an ordinary Studio patch (patches.js) of the panel's nodes, tagged
// `category: 'xy'` with its `scale` beside the graph, so the one patch library saves, lists,
// exports and imports it like any other patch. The built-in ones are recipes over a panel
// preset (presets.js) that xyPresetPatch turns into that patch on the document's own panel.
//
//   XY_VOICE                       the cables that let the pad play the voice
//   xyTargets(panel) -> [{ id, label }]   the CONTROL inputs Y may drive (the timbre targets)
//   xyTarget(model, panel) -> jack | null the input Y drives now
//   xyPatched(model, panel) -> bool        the pad's Pitch and Gate reach the voice
//   xyCablesAction(model, panel, pairs, label) -> { action } | { reason }   cables, one BATCH
//   xyTargetAction(model, panel, to) -> { action } | { reason }   Y moved to `to`, one BATCH
//   xyPatchOf(model, panel, { name, description }) -> patch        the panel as an XY preset
//   xyPresetPatch(model, panel, recipe) -> patch                    a built-in preset's patch
//   xyPatchAction(model, panel, patch) -> { action } | { reason }   load it, one BATCH

import { createPatch } from '../studio/patches.js';
import { linkAction, linkOf } from './link.js';
import { panelCables, patchCable, unpatch } from './normals.js';

export const XY_CATEGORY = 'xy';
export const XY_VOICE = Object.freeze([['xy.pitch', 'vco1.pitch'], ['xy.pitch', 'vco2.pitch'],
  ['xy.gate', 'eg1.gate'], ['xy.gate', 'eg2.gate']]);
const PITCH_PORTS = ['pitch', 'fm'];

/** Built-in XY presets: a panel preset, the scale, the pad's values and the target of Y. */
export const XY_RECIPES = Object.freeze([
  { id: 'xy-lead', base: 'lead', scale: { mode: 'minor-pentatonic', key: 'C' },
    y: 'lpf.frequency', values: [], name: 'XY lead: C minor pentatonic, Y opens the low-pass' },
  { id: 'xy-bass', base: 'bass', scale: { mode: 'dorian', key: 'D' }, y: 'lpf.frequency',
    values: [['xy.octave', 2], ['xy.span', 1]], name: 'XY bass: D Dorian, Y opens the low-pass' },
  { id: 'xy-sweep', base: 'sweep', scale: { mode: 'minor', key: 'A' }, y: 'hpf.frequency',
    values: [], name: 'XY sweep: A natural minor, Y raises the high-pass' },
  { id: 'xy-bell', base: 'ring-bell', scale: { mode: 'major', key: 'E' }, y: 'vco2.tune',
    values: [['xy.glide', 0.05]], name: 'XY bell: E major, Y detunes VCO 2 against the ring' },
].map((r) => Object.freeze(r)));

export function xyTargets(panel) {
  return panel.modulesOf('panel').flatMap((m) => panel.jacksOf(m.id)
    .filter((j) => j.direction === 'in' && j.type === 'CONTROL' && j.param
      && !PITCH_PORTS.includes(j.port))
    .map((j) => ({ id: j.id, label: `${m.label} ${j.label}` })));
}

const cablesFrom = (model, panel, jack) => panelCables(model, panel).filter((c) => c.from === jack);
export const xyTarget = (model, panel) => (cablesFrom(model, panel, 'xy.y')[0] || {}).to || null;
export const xyPatched = (model, panel) => ['xy.pitch', 'xy.gate']
  .every((j) => cablesFrom(model, panel, j).length);

export function xyCablesAction(model, panel, pairs, label = 'Patch the XY pad') {
  const steps = [];
  for (const [from, to] of pairs) {
    const r = patchCable(model, panel, from, to);
    if (r.reason && !/already patched/.test(r.reason)) return r;
    if (r.action) steps.push(...r.action.steps);
  }
  return { action: { type: 'BATCH', label, steps } };
}

export function xyTargetAction(model, panel, to) {
  const old = cablesFrom(model, panel, 'xy.y');
  const steps = old.filter((c) => c.to !== to)
    .flatMap((c) => unpatch(model, panel, c.id).action.steps);
  const r = to && !old.some((c) => c.to === to) ? patchCable(model, panel, 'xy.y', to) : null;
  if (r && r.reason) return r;
  return { action: { type: 'BATCH', label: 'Change XY Y target',
    steps: [...steps, ...(r ? r.action.steps : [])] } };
}

export function xyPatchOf(model, panel, { name, description = '' }) {
  const res = panel.resolve(model);
  const pad = res.get('xy');
  if (!pad) throw new RangeError('The Synth panel has no XY pad: Restore module first.');
  return createPatch(model, [...res.values()].filter(Boolean).map((n) => n.id), { name,
    description, category: XY_CATEGORY, scale: { mode: pad.params.mode, key: pad.params.key } });
}

/**
 * The panel's graph after the steps of one of its BATCHes, as plain data and unchecked (the
 * store stays the one writer of the document; createPatch validates what this returns).
 */
function afterSteps(model, steps) {
  let { nodes, edges } = model.graph;
  let k = 0;
  for (const s of steps) {
    if (s.type === 'EDGE_REMOVE') edges = edges.filter((e) => !s.edgeIds.includes(e.id));
    if (s.type === 'EDGE_ADD') {
      edges = [...edges, { id: s.id || `xycable-${(k += 1)}`, from: s.from, to: s.to,
        props: s.props || {} }];
    }
    if (s.type === 'EDGE_UPDATE') {
      edges = edges.map((e) => (e.id === s.edgeId ? { ...e, props: { ...e.props, ...s.props } }
        : e));
    }
    if (s.type === 'NODE_PARAM_SET') {
      const set = s.params || { [s.key]: s.value };
      nodes = nodes.map((n) => (n.id === s.nodeId ? { ...n, params: { ...n.params, ...set } } : n));
    }
  }
  return { ...model, graph: { ...model.graph, nodes, edges } };
}

export function xyPresetPatch(model, panel, recipe) {
  const a = linkAction(model, panel, { preset: recipe.base,
    values: [...recipe.values, ['xy.mode', recipe.scale.mode], ['xy.key', recipe.scale.key]],
    cables: [...XY_VOICE, ['xy.y', recipe.y]] });
  return xyPatchOf(afterSteps(model, a.steps), panel, { name: recipe.name });
}

export function xyPatchAction(model, panel, patch) {
  // The patch's nodes keep the panel's ids (createPatch), so its graph reads as a panel again.
  const byId = new Map(panel.modules.map((m) => [panel.nodeIdOf(m.id), m.id]));
  const nodes = patch.graph.nodes.map((n) => (byId.has(n.id) ? { ...n, metadata: { ...n.metadata,
    panel: { id: panel.instance, module: byId.get(n.id) } } } : n));
  const doc = { graph: { nodes, edges: patch.graph.edges } };
  if (!panel.resolve(doc).get('xy')) {
    return { reason: `"${patch.name}" holds no XY pad of the ${panel.title}.` };
  }
  const steps = linkAction(model, panel, linkOf(doc, panel, 'init')).steps;
  const pad = panel.resolve(model).get('xy');
  if (patch.scale && pad) {
    steps.push({ type: 'NODE_PARAM_SET', nodeId: pad.id, params: { ...patch.scale } });
  }
  return { action: { type: 'BATCH', label: `XY preset ${patch.name.split(':')[0]}`, steps } };
}
