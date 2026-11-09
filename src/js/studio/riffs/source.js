// The riffs in the one patch library (K149 with K102): a category of studio/patch-catalog.js,
// so the Synth and the Studio find them in the same dialog, filtered by role and genre. A riff
// has no parameters to apply: its one way in is Insert, riffVoiceAction (expand.js), the riff
// with the voice it was written for, one undo step. The style is said beside the name, so the
// library never presents a riff as anything but original.
//
// Listen auditions it (audition.js) through the Studio's engine; the Studio passes its svc and
// component so Listen is refused by the output-owner table (svc.outputRefusalOf,
// ui/output-owner.js, C024) or first stops the other owners (svc.stopPlayback).
//
//   registerRiffSource(svc?, cmp?)   idempotent: registering again replaces the source

import { registerPatchSource } from '../patch-catalog.js';
import { RIFFS, riffOf } from './library.js';
import { riffVoiceAction } from './expand.js';
import { createRiffAudition } from './audition.js';

export const RIFF_CATEGORY = 'riffs';

/** The audition of the source registered last: a new registration disposes of it, so a
 *  re-mounted Studio leaves no engine listener behind. */
let audition = null;

export function registerRiffSource(svc = {}, cmp = null) {
  if (audition) audition.dispose();
  // Claimed by the engine.play guard (C037, the playback bus); when it refuses, Listen says the
  // sentence of the row of the one output-owner table that holds the output (svc.outputRefusalOf
  // from main.js: a measurement or a microphone level reference, C024).
  const ctl = createRiffAudition({ engine: svc.engine,
    refused: () => {
      const r = cmp && svc.outputRefusalOf ? svc.outputRefusalOf(cmp) : null;
      return r ? r.text : null;
    } });
  audition = ctl;
  registerPatchSource({
    id: RIFF_CATEGORY,
    label: 'Riffs',
    entries: () => RIFFS.map((r) => ({
      id: `riff-${r.id}`, name: r.title, modes: ['insert'],
      tags: [RIFF_CATEGORY, r.role, r.genre],
      detail: `${r.style} · ${r.tempo} BPM · ${r.key} · ${r.bars} bar${r.bars > 1 ? 's' : ''}`,
      patch: { name: r.title, category: RIFF_CATEGORY, riff: r.id, graph: { nodes: [] } },
      audition: { id: r.id, ctl },
    })),
    load: (model, patch, mode) => {
      const riff = riffOf(patch.riff);
      if (!riff) return { reason: `No riff "${String(patch.riff)}" in the library.` };
      if (mode !== 'insert') return { reason: `${riff.title} is a riff: Insert adds it with `
        + 'its voice.' };
      return riffVoiceAction(model, riff);
    },
  });
}
