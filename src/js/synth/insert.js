// The Synth panel's insertion (plan K061, K066): whether the workspace may insert the panel by
// itself, the sentences it says when it does and the one action that inserts it. Split out of
// synth/ui.js, which re-exports SYNTH_TEXT and insertDecision; pure apart from the template it
// compares against.
//
//   insertAction(model, panel, { explicit, unroute }) -> { action, text } | { reason }
//     the panel below the document's nodes with the XY pad's Y cable (xy.js xyInsertAction,
//     K183), one BATCH, and the notice naming the Master feed it takes (SYNTH_TEXT.took);
//     refused without `explicit` where insertDecision refuses; `unroute` clears the keys' route
//     in the same BATCH (New Synth voice: the keys then play its Keys; review S5)
//   feedNames(model, cuts) -> 'name, name'   the nodes whose Master feed the panel takes
//   insertWithPreset(model, panel, presetId) -> { action, text } | { reason }   K225: the
//     panel inserted with a preset's values, one BATCH (the patch library's Insert)

import SEMI_MONO from './panels/semi-mono.js';
import { isSemanticallyEqual } from '../studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../studio/templates/index.js';
import { xyInsertAction } from './xy.js';
import { presetAction } from './presets.js';

export const SYNTH_TEXT = Object.freeze({
  inserted: `Panel ${SEMI_MONO.title} je vložen do dokumentu Studia a hraje do Master Output. `
    + 'Příkaz Zpět ho odebere.',
  /** Master holds one input: inserting the panel takes it from the document's chain. */
  takes: (names) => `Master Output v tomto dokumentu Studia teď dostává signál z: ${names}. `
    + `Vložený panel ${SEMI_MONO.title} tento vstup převezme (příkaz Zpět ho vrátí).`,
  took: (names) => `Panel ${SEMI_MONO.title} je vložen do dokumentu Studia a převzal vstup Master `
    + `Output od: ${names}. Příkaz Zpět panel odebere a vstup vrátí.`,
  /** U108: the phone's one line, worded by oscilla-0b; the source a nominative in parentheses
   *  (a free node label cannot be declined after "od"), dropped when there was none. */
  short: (names) => ({ lead: 'Panel vložen do Studia, převzal vstup Master Output',
    source: names || '', tail: '. Zpět ho odebere.' }),
  notInserted: 'Panel Synthu v tomto dokumentu Studia není: nejdřív stiskněte Vložit.',
  armed: 'Synth připraven: klávesy hrají panel.',
  /** What the keys and the XY pad play, named from the route's node (K183 S6). */
  plays: (name) => `Synth připraven: klávesy a XY pad hrají ${name}.`,
  disarmed: 'Synth vypnut: nezní žádná nota.',
  refused: 'Synth se nepřipravil: výstup patří měření. Nejdřív měření zastavte (Esc).',
  direction: 'Kabel vede z výstupního konektoru do vstupního.',
});

/**
 * Whether opening the workspace (or a note, Arm, a preset, a link) may insert the panel by
 * itself: when that cuts nothing, or when the document is still the untouched reference
 * template the app opens with (no work of the user's to cut; the notice says what it took and
 * Undo gives it back). A document the user has changed whose own chain feeds Master Output
 * gets the panel only from the Insert button. -> { auto, cuts: [edge] }
 */
export function insertDecision(model, panel = SEMI_MONO) {
  const cuts = panel.cutsOf(model);
  if (!cuts.length) return { auto: true, cuts };
  return { auto: isSemanticallyEqual(model, templateModel(REFERENCE_TEMPLATE_ID)), cuts };
}

export function feedNames(model, cuts) {
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  return [...new Set(cuts.map((e) => (byId.get(e.from.node) || { metadata: {} }).metadata.name
    || e.from.node))].join(', ');
}

export function insertAction(model, panel = SEMI_MONO, { explicit = false, unroute = false }
  = {}) {
  const { auto, cuts } = insertDecision(model, panel);
  const names = cuts.length ? feedNames(model, cuts) : '';
  if (!auto && !explicit) {
    return { reason: `${SYNTH_TEXT.notInserted} ${SYNTH_TEXT.takes(names)}` };
  }
  const ys = model.graph.nodes.map((n) => n.position.y);
  const action = xyInsertAction(model, panel, { at: { x: 0,
    y: (ys.length ? Math.max(...ys) : 0) + 240 } }); // K183: the pad's Y cable with it
  if (unroute && model.metadata.noteTarget) {
    action.steps.push({ type: 'METADATA_SET', noteTarget: null });
  }
  return { action, text: names ? SYNTH_TEXT.took(names) : SYNTH_TEXT.inserted,
    short: SYNTH_TEXT.short(names) };
}

/**
 * K225: the panel inserted as the Synth's own Insert does (insertAction, explicit) with preset
 * `presetId`'s values set on it, as ONE BATCH (one history entry). The panel's ids are
 * deterministic (panel.instantiate): the preset's targets (patches.js patchTargets, by
 * metadata.panel) are read from the model with the insert's new nodes projected onto it, so no
 * second store is built (project.studio-model-is-canonical). -> { action, text } | { reason }
 */
export function insertWithPreset(model, panel = SEMI_MONO, presetId = 'init') {
  const ins = insertAction(model, panel, { explicit: true });
  if (!ins.action) return ins;
  const added = ins.action.steps.filter((x) => x.type === 'NODE_ADD').map((x) => ({ id: x.id,
    type: x.nodeType, params: x.params || {}, metadata: { name: x.name, panel: x.panel } }));
  const projected = { ...model, graph: { ...model.graph,
    nodes: [...model.graph.nodes, ...added] } };
  const pre = presetAction(projected, panel, presetId);
  if (!pre.action) return pre;
  const tail = pre.action.type === 'BATCH' ? pre.action.steps : [pre.action];
  return { action: { type: 'BATCH', label: `Vložit ${panel.title}`.slice(0, 64),
    steps: [...ins.action.steps, ...tail] }, text: ins.text, short: ins.short };
}
