// The riffs in the one patch library (K149 with K102): a category of studio/patch-catalog.js,
// so the Synth and the Studio find them in the same dialog, filtered by role and genre. A riff
// has no parameters to apply: its one way in is Insert, riffVoiceAction (expand.js), the riff
// with the voice it was written for, one undo step. The style is said beside the name, so the
// library never presents a riff as anything but original.
//
//   registerRiffSource()   idempotent: registering again replaces the source

import { registerPatchSource } from '../patch-catalog.js';
import { RIFFS, riffOf } from './library.js';
import { riffVoiceAction } from './expand.js';

export const RIFF_CATEGORY = 'riffs';

export function registerRiffSource() {
  registerPatchSource({
    id: RIFF_CATEGORY,
    label: 'Riffs',
    entries: () => RIFFS.map((r) => ({
      id: `riff-${r.id}`, name: r.title, modes: ['insert'],
      tags: [RIFF_CATEGORY, r.role, r.genre],
      detail: `${r.style} · ${r.tempo} BPM · ${r.key} · ${r.bars} bar${r.bars > 1 ? 's' : ''}`,
      patch: { name: r.title, category: RIFF_CATEGORY, riff: r.id, graph: { nodes: [] } },
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
