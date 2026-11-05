// The XY tab's panel state (plan K097): pure functions from the StudioModel and the Synth panel
// to the ONE store action of each change, over normals.js (cables), link.js (whole-panel state)
// and studio/patches.js (presets). No DOM, no Web Audio.
//
// An XY preset is an ordinary Studio patch (patches.js) of the panel's nodes, tagged
// `category: 'xy'` with its `scale` beside the graph, so the one patch library saves, lists,
// exports and imports it like any other patch. The built-in ones are recipes over a panel
// preset (presets.js) that xyPresetPatch turns into that patch on the document's own panel.
// An XY preset is the voice the pad plays: the modules of the Panel and XY tabs (xyScope) and
// the cables between them. Applying one writes those nodes and edges only, as a node preset
// writes its named nodes (K020): the Engines tab's modules and every cable into them keep their
// values, built-in or saved, whatever the patch carries.
//
//   xyScope(panel) -> [module id]          the modules an XY preset holds and writes
//   XY_VOICE                       the cables that let the pad play the voice
//   xyTargets(panel) -> [{ id, label }]   the CONTROL inputs Y may drive (the timbre targets)
//   xyTarget(model, panel) -> jack | null the input Y drives now
//   xyYReading(model, panel, { sampleRate }) -> reading | null   what the target plays at Y (the
//     XY view's value): { jack, param (the panel's), props, others, at(y), limited, cap,
//     sampleRate, provisional }. at(y) is sized by the compiler's own computeBases over every
//     cable into the target's node, at 0.95 x Nyquist of `sampleRate` (the running context's):
//     the base with every cable's constant part, Y's gain as scaled near Nyquist (`limited`: Y's
//     excursion was scaled down, `cap` = caps[port] is what holds it), the other cables' moving
//     part left out. Before a context exists (no sampleRate) it is sized at the provisional
//     44.1 kHz (sequencer/model.js safeMaximum, the rate automation.js paramBounds declares),
//     `provisional` true, and the view names that rate. `others` counts the other unmuted
//     edges into the same input, whose moving part adds to it
//   xyPatched(model, panel) -> bool        the pad's Pitch and Gate reach the voice
//   xyCablesAction(model, panel, pairs, label) -> { action } | { reason }   cables, one BATCH
//   xyTargetAction(model, panel, to) -> { action } | { reason }   Y moved to `to`, one BATCH
//   xyPatchOf(model, panel, { name, description }) -> patch        the panel as an XY preset
//   xyPresetPatch(model, panel, recipe) -> patch                    a built-in preset's patch
//   xyPatchAction(model, panel, patch) -> { action } | { reason }   load it, one BATCH

import { createPatch, patchParams } from '../studio/patches.js';
import { compileStudio, computeBases } from '../studio/compiler.js';
import { PROVISIONAL_SAMPLE_RATE, safeMaximum } from '../sequencer/model.js';
import { CENTS_PER_OCTAVE } from '../core/music.js';
import { linkAction, linkOf } from './link.js';
import { panelCables, patchCable, unpatch } from './normals.js';
import { SOURCE_RANGES, splitJack } from './panel.js';
import { XY_TAB } from './panels/xy.js';

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

// The plan is compiled for a context that runs (a realtime engine), as the runtime compiles it;
// the sizing needs only the plan, never an AudioContext.
const RUNNING = Object.freeze({ isSupported: () => true });
const sourceRange = (plan, from) => {
  const n = plan.nodes.get(from.node);
  const s = n && SOURCE_RANGES[n.type] && SOURCE_RANGES[n.type][from.port];
  return s ? s.range : [-1, 1]; // compiler.js DEFAULT_RANGE
};

export function xyYReading(model, panel, { sampleRate = null } = {}) {
  const c = cablesFrom(model, panel, 'xy.y')[0];
  if (!c) return null;
  const { module, port } = splitJack(c.to);
  const node = panel.resolve(model).get(module);
  const m = panel.module(module);
  const param = m && (m.params || []).find((p) => p.key === port);
  const plan = compileStudio(model, { engine: RUNNING });
  const pn = node && plan.nodes.get(node.id);
  const edge = plan.edges.get(c.id);
  if (!pn || !param || !edge) return null;
  const provisional = !(sampleRate > 0);
  const rate = provisional ? PROVISIONAL_SAMPLE_RATE : sampleRate;
  // Every CONTROL cable into the node, as the runtime passes them (gains in parameter units or
  // octaves: scale 1), sized at this context's 0.95 x Nyquist.
  const incoming = plan.edgeOrder.map((id) => plan.edges.get(id))
    .filter((e) => e.to.node === pn.id && e.kind === 'control')
    .map((e) => ({ edge: e, handle: { status: e.status, range: sourceRange(plan, e.from),
      scale: 1 } }));
  const cb = computeBases(pn, incoming, { safeMaximum: safeMaximum(rate) });
  const b = cb.base[port];
  if (!b) return null; // not a modulatable parameter: no cable sizes it
  const g = cb.gains.get(edge.id) || 0;
  const log = edge.props.mapping === 'log';
  const others = model.graph.edges.filter((e) => e.id !== edge.id && e.to.node === node.id
    && e.to.port === port && !(e.props && e.props.muted)).length;
  return { jack: c.to, param, props: edge.props, others, sampleRate: rate, provisional,
    limited: cb.limited.has(edge.id), cap: cb.caps[port] || null,
    at: (y) => (log ? b.value * 2 ** ((b.cents + CENTS_PER_OCTAVE * g * y) / CENTS_PER_OCTAVE)
      : b.value + g * y) };
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
  const a = linkAction(model, panel, { preset: recipe.base,
    values: [...recipe.values, ['xy.mode', recipe.scale.mode], ['xy.key', recipe.scale.key]],
    cables: [...XY_VOICE, ['xy.y', recipe.y]] }, { modules: xyScope(panel) });
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
