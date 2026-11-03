// The Synth panel's insertion (plan K061, K066): whether the workspace may insert the panel by
// itself, and the sentences it says when it does. Split out of synth/ui.js, which re-exports
// both; pure apart from the template it compares against.

import SEMI_MONO from './panels/semi-mono.js';
import { isSemanticallyEqual } from '../studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../studio/templates/index.js';

export const SYNTH_TEXT = Object.freeze({
  inserted: `Inserted the ${SEMI_MONO.title} into the Studio document; it feeds Master Output. `
    + 'Undo removes it.',
  /** Master holds one input: inserting the panel takes it from the document's chain. */
  takes: (names) => `Master Output is fed by ${names} in this Studio document. Inserting the `
    + `${SEMI_MONO.title} takes Master Output from it (Undo gives it back).`,
  took: (names) => `Inserted the ${SEMI_MONO.title} into the Studio document; it took Master `
    + `Output from ${names}. Undo removes the panel and gives it back.`,
  notInserted: 'The Synth panel is not in this Studio document: press Insert first.',
  armed: 'Synth armed: the keys play the panel.',
  disarmed: 'Synth disarmed: no note sounds.',
  refused: 'The Synth did not arm: the output belongs to the measurement. Stop it first (Esc).',
  direction: 'A cable runs from an output jack to an input jack.',
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
