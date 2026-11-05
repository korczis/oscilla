// The XY tab's panel state (plan K097): pure functions from the StudioModel and the Synth panel
// to the ONE store action of each change, over normals.js (cables), link.js (whole-panel state)
// and studio/patches.js (presets). No DOM, no Web Audio.
//
// An XY preset is an ordinary Studio patch (patches.js) of the panel's nodes, tagged
// `category: 'xy'` with its `scale` beside the graph, so the one patch library saves, lists,
// exports and imports it like any other patch. The built-in ones are recipes over a panel
// preset (presets.js) that xyPresetPatch turns into that patch on the document's own panel.
// An XY preset is the voice the pad plays: the modules of the Panel and XY tabs (xyScope) and
// the cables between them. Under K183 (option B) the pad plays through the keys' one note
// layer, so a built-in preset sets the scale, the target of Y and the values only: no Pitch or
// Gate cable (which would replace the keyboard's normals and silence the computer keys, review
// F3), and its Y cable adds to its target's normals, whose amount knobs keep the base preset's
// depths. Applying one writes those nodes and edges only, as a node preset
// writes its named nodes (K020): the Engines tab's modules and every cable into them keep their
// values, built-in or saved, whatever the patch carries.
//
//   xyScope(panel) -> [module id]          the modules an XY preset holds and writes
//   xyTargets(panel) -> [{ id, label }]   the CONTROL inputs Y may drive (the timbre targets)
//   xyTarget(model, panel) -> jack | null the input Y drives now
//   xyRoom(model, panel) -> { factor, target, text } | null   Y held below its depth by its
//                                          linear target's range (said by the readout)
//   xyPatched(model, panel) -> bool        the pad's Pitch and Gate reach the voice
//   xyCablesAction(model, panel, pairs, label) -> { action } | { reason }   cables, one BATCH
//   xyTargetAction(model, panel, to) -> { action } | { reason }   Y moved to `to`, one BATCH
//   xyPatchOf(model, panel, { name, description }) -> patch        the panel as an XY preset
//   xyPresetPatch(model, panel, recipe) -> patch                    a built-in preset's patch
//   xyPatchAction(model, panel, patch) -> { action } | { reason }   load it, one BATCH
//   xyInsertAction(model, panel, { at }) -> BATCH   the panel's insertion (panel.instantiate)
//                                  with Y cabled into XY_DEFAULT_Y when this insertion adds the
//                                  pad (K183): the default Synth document's Y route, a visible,
//                                  removable cable; one BATCH, one undo entry

import { createPatch, patchParams } from '../studio/patches.js';
import { linkAction, linkOf } from './link.js';
import { panelCables, patchCable, unpatch } from './normals.js';
import { XY_TAB } from './panels/xy.js';
import { NODE_REGISTRY } from '../studio/registry.js';
import { fitFactor } from '../studio/performance-fit.js';

export const XY_CATEGORY = 'xy';
const PITCH_PORTS = ['pitch', 'fm'];
/** What Y drives in the default Synth document (K183): the low-pass cutoff. */
export const XY_DEFAULT_Y = 'lpf.frequency';

/** Built-in XY presets: a panel preset, the scale, the pad's values and the target of Y. */
export const XY_RECIPES = Object.freeze([
  { id: 'xy-lead', base: 'lead', scale: { mode: 'minor-pentatonic', key: 'C' },
    y: 'lpf.frequency', values: [], name: 'XY lead: C minor pentatonic, Y opens the low-pass' },
  { id: 'xy-bass', base: 'bass', scale: { mode: 'dorian', key: 'D' }, y: 'lpf.frequency',
    values: [['xy.octave', 2], ['xy.span', 1]], name: 'XY bass: D Dorian, Y opens the low-pass' },
  { id: 'xy-sweep', base: 'sweep', scale: { mode: 'minor', key: 'A' }, y: 'hpf.frequency',
    values: [], name: 'XY sweep: A natural minor, Y raises the high-pass' },
  { id: 'xy-bell', base: 'ring-bell', scale: { mode: 'major', key: 'E' }, y: 'vco2.tune',
    values: [], name: 'XY bell: E major, Y detunes VCO 2 against the ring' },
].map((r) => Object.freeze(r)));

export const xyScope = (panel) => [...panel.modulesOf(panel.tabs[0].id),
  ...panel.modulesOf(XY_TAB.id)].map((m) => m.id);

export function xyTargets(panel) {
  return panel.modulesOf('panel').flatMap((m) => panel.jacksOf(m.id)
    .filter((j) => j.direction === 'in' && j.type === 'CONTROL' && j.param
      && !PITCH_PORTS.includes(j.port))
    .map((j) => ({ id: j.id, label: `${m.label} ${j.label}` })));
}

const cablesFrom = (model, panel, jack) => panelCables(model, panel).filter((c) => c.from === jack);
export const xyTarget = (model, panel) => (cablesFrom(model, panel, 'xy.y')[0] || {}).to || null;
/**
 * Y held below its depth by its target's range (K183 review N4, project.no-silent-feedback):
 * the factor computeBases gives the Y cable into a linear target (studio/performance-fit.js,
 * from the model and the sources' ranges), with what the readout says; null where Y has its
 * whole depth, drives nothing, or drives a frequency (capped at 0.95 x Nyquist and said by the
 * runtime's frequency-limited diagnostics).
 */
export function xyRoom(model, panel) {
  const to = xyTarget(model, panel);
  if (!to) return null;
  const [mid, port] = to.split('.');
  const res = panel.resolve(model);
  const node = res.get(mid);
  const pd = node ? NODE_REGISTRY.param(node.type, port) : null;
  if (!pd || pd.unit === 'Hz' || typeof node.params[port] !== 'number') return null;
  const byId = new Map([...res].filter(([, n]) => n).map(([m, n]) => [n.id, m]));
  let base = node.params[port];
  const lin = [];
  for (const e of model.graph.edges) {
    const p = e.props || {};
    if (e.to.node !== node.id || e.to.port !== port || p.muted || p.mapping === 'log') continue;
    const from = `${byId.get(e.from.node)}.${e.from.port}`;
    const [lo, hi] = panel.sourceRange(from);
    const t0 = p.polarity === 'unipolar' ? 0 : -p.depth;
    const a = (p.depth - t0) / (hi - lo);
    const c = t0 - a * lo + (p.offset || 0);
    base += c;
    lin.push({ c, up: Math.max(a * lo, a * hi), down: Math.min(a * lo, a * hi),
      fit: from === 'xy.x' || from === 'xy.y' });
  }
  const { k } = fitFactor(lin, base, pd);
  if (k >= 1) return null;
  const m = panel.module(mid);
  const name = `${m.label} ${(m.labels && m.labels[port]) || pd.label}`;
  return { factor: k, target: to, text: k <= 0 ? `Y has no room: ${name} and its other cables `
    + 'already reach the end of its range' : `Y plays ${Math.round(k * 100)} % of its depth: `
    + `${name} and its other cables leave only that much of its range` };
}

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
  const ids = xyScope(panel).map((mid) => res.get(mid)).filter(Boolean).map((n) => n.id);
  return createPatch(model, ids, { name,
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
    if (s.type === 'NODE_ADD') {
      nodes = [...nodes, { id: s.id, type: s.nodeType, params: { ...s.params },
        position: s.position, metadata: { name: s.name, ...(s.panel ? { panel: s.panel } : {}) } }];
    }
    if (s.type === 'EDGE_REMOVE') edges = edges.filter((e) => !s.edgeIds.includes(e.id));
    if (s.type === 'EDGE_ADD') {
      edges = [...edges, { id: s.id || `xycable-${(k += 1)}`, from: s.from, to: s.to,
        props: s.props || {} }];
    }
    if (s.type === 'EDGE_UPDATE') {
      edges = edges.map((e) => (e.id === s.edgeId ? { ...e, props: { ...e.props, ...s.props } }
        : e));
    }
    if (s.type === 'PATCH_REPLACE' && s.onto) { // a preset (presets.js, K066): parameters only
      ({ nodes, edges } = patchParams({ ...model, graph: { ...model.graph, nodes, edges } },
        s.patch, s.onto).model.graph);
    }
    if (s.type === 'NODE_PARAM_SET') {
      const set = s.params || { [s.key]: s.value };
      nodes = nodes.map((n) => (n.id === s.nodeId ? { ...n, params: { ...n.params, ...set } } : n));
    }
  }
  return { ...model, graph: { ...model.graph, nodes, edges } };
}

export function xyPresetPatch(model, panel, recipe) {
  // The scale, Y's target and the values: Y's cable adds to its target's normals (K183), so the
  // keys keep their Pitch and Gate normals and the target keeps its amount knobs.
  const a = linkAction(model, panel, { preset: recipe.base,
    values: [...recipe.values, ['xy.mode', recipe.scale.mode], ['xy.key', recipe.scale.key]],
    cables: [['xy.y', recipe.y]] }, { modules: xyScope(panel) });
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
  const steps = linkAction(model, panel, linkOf(doc, panel, 'init'),
    { modules: xyScope(panel) }).steps;
  const pad = panel.resolve(model).get('xy');
  if (patch.scale && pad) {
    steps.push({ type: 'NODE_PARAM_SET', nodeId: pad.id, params: { ...patch.scale } });
  }
  return { action: { type: 'BATCH', label: `XY preset ${patch.name.split(':')[0]}`, steps } };
}

export function xyInsertAction(model, panel, { at } = {}) {
  const a = panel.instantiate(model, { at });
  if (panel.resolve(model).get('xy')) return a; // the pad was there: its cables are the user's
  const after = afterSteps(model, a.steps);
  if (!panel.resolve(after).get('xy') || xyTarget(after, panel)) return a;
  const r = patchCable(after, panel, 'xy.y', XY_DEFAULT_Y);
  return r.action ? { ...a, steps: [...a.steps, ...r.action.steps] } : a;
}
