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
//   xySounding(model, panel) -> { octaves } | null   how far the note the voice sounds lies from
//     the pad's own note (xyDegree's, which it plays). Its path to the VCOs is its own Pitch
//     cables where patched, else the keys' pitch, normals included (K183: the pad is one more
//     input of the keys and plays what they play). Each VCO that path reaches
//     shifts it by VCO_SCALES of its footage (8' = 0, 16' = -1, 4' = +1) plus the constant part
//     of its Pitch and FM inputs (the node's params and every cable's offset, the compiler's
//     computeBases). Only the audible VCOs count: those with an audio path to the Output whose
//     mixer levels (the product of the Mixer `levelN` of each input on the way, as compiled; a
//     level that is not a number counts as 1) stay above DB_SCALE_FLOOR (studio/automation.js,
//     -60 dB, the floor of the level scale), so a VCO turned all but off, or heard only through
//     a muted Ring, decides nothing. The note named is the lowest audible VCO's: octave
//     doubling (16' with 8') is heard at its lowest. Null, and the view names the pad's own
//     note ("sends D3") rather than guess, when the Pitch reaches a target that is not a VCO's
//     Pitch or no audible VCO, or an audible VCO's cable does not pass 1.00 oct per octave or
//     its shift is no whole number of octaves (a fifth from FM or Pitch offsets). Tune (cents)
//     is left out: a detune (the XY lead's VCO 2 a fifth up by Tune still names VCO 1's note)
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
import { compileStudio, computeBases } from '../studio/compiler.js';
import { PROVISIONAL_SAMPLE_RATE, safeMaximum } from '../sequencer/model.js';
import { CENTS_PER_OCTAVE } from '../core/music.js';
import { VCO_SCALES } from '../studio/nodes/instrument.js';
import { DB_SCALE_FLOOR } from '../studio/automation.js';
import { linkAction, linkOf } from './link.js';
import { panelCables, patchCable, unpatch } from './normals.js';
import { SOURCE_RANGES, splitJack } from './panel.js';
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


// The plan is compiled for a context that runs (a realtime engine), as the runtime compiles it;
// the sizing needs only the plan, never an AudioContext.
const RUNNING = Object.freeze({ isSupported: () => true });
const sourceRange = (plan, from) => {
  const n = plan.nodes.get(from.node);
  const s = n && SOURCE_RANGES[n.type] && SOURCE_RANGES[n.type][from.port];
  return s ? s.range : [-1, 1]; // compiler.js DEFAULT_RANGE
};

/** computeBases of plan node `pn` over every CONTROL cable into it, as the runtime passes them
 * (gains in parameter units or octaves: scale 1), at 0.95 x Nyquist of `rate`. */
const basesOf = (plan, pn, rate) => computeBases(pn, plan.edgeOrder.map((id) => plan.edges.get(id))
  .filter((e) => e.to.node === pn.id && e.kind === 'control')
  .map((e) => ({ edge: e, handle: { status: e.status, range: sourceRange(plan, e.from),
    scale: 1 } })), { safeMaximum: safeMaximum(rate) });

const LEVEL_FLOOR = 10 ** (DB_SCALE_FLOOR / 20);
/** The loudest mixer-level product of an audio path from node `id` to the Output (0: none). */
function pathLevel(plan, id, seen = new Set()) {
  if (seen.has(id)) return 0;
  const n = plan.nodes.get(id);
  if (!n) return 0;
  if (n.type === 'master') return 1;
  let best = 0;
  for (const e of plan.edges.values()) {
    if (e.kind !== 'audio' || e.from.node !== id || e.props.muted) continue;
    const to = plan.nodes.get(e.to.node);
    const m = to && to.type === 'mixer' && /^in(\d+)$/.exec(e.to.port);
    const lv = m ? Number(to.params[`level${m[1]}`]) : 1;
    const g = Number.isFinite(lv) ? Math.abs(lv) : 1;
    if (g > 0) best = Math.max(best, g * pathLevel(plan, e.to.node, new Set([...seen, id])));
  }
  return best;
}

export function xySounding(model, panel) {
  const keys = panel.resolve(model).get('keys');
  const own = cablesFrom(model, panel, 'xy.pitch');
  const cables = own.length || !keys ? own : model.graph.edges
    .filter((e) => e.from.node === keys.id && e.from.port === 'pitch');
  const plan = cables.length ? compileStudio(model, { engine: RUNNING }) : null;
  const shifts = [];
  for (const c of cables) {
    const edge = plan.edges.get(c.id);
    if (edge && edge.props.muted) continue;
    const pn = edge && plan.nodes.get(edge.to.node);
    if (!pn || pn.type !== 'vco' || edge.to.port !== 'pitch') return null;
    if (pathLevel(plan, pn.id) <= LEVEL_FLOOR) continue; // not heard: it decides nothing
    const cb = basesOf(plan, pn, PROVISIONAL_SAMPLE_RATE);
    if (edge.props.mapping === 'log' || Math.abs(cb.gains.get(edge.id) - 1) > 1e-9) return null;
    const oct = (VCO_SCALES[pn.params.scale] ?? 0) + cb.base.pitch.value + cb.base.fm.value;
    if (Math.abs(oct - Math.round(oct)) > 1e-9) return null;
    shifts.push(Math.round(oct));
  }
  return shifts.length ? { octaves: Math.min(...shifts) } : null;
}

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
  const cb = basesOf(plan, pn, rate); // sized at this context's 0.95 x Nyquist
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
