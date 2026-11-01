// The Synth's instruments in the one patch library (plan K102 with K097): the XY pad's presets
// as a category of studio/patch-catalog.js. The built-ins are made on the document's own panel
// (xy.js xyPresetPatch), a saved XY preset is an ordinary patch with category 'xy', and every
// one loads through xy.js xyPatchAction, one BATCH. Nothing here is a second store.
//
//   registerSynthSources()   idempotent: registering again replaces the source

import { registerPatchSource } from '../studio/patch-catalog.js';
import SEMI_MONO from './panels/semi-mono.js';
import { XY_CATEGORY, XY_RECIPES, xyPatchAction, xyPatchOf, xyPresetPatch } from './xy.js';

export function registerSynthSources(panel = SEMI_MONO) {
  registerPatchSource({
    id: XY_CATEGORY,
    label: 'XY pad',
    entries: (model) => (model && panel.resolve(model).get('xy') ? XY_RECIPES.map((r) => ({
      id: r.id, name: r.name.split(':')[0], modes: ['apply'],
      patch: xyPresetPatch(model, panel, r) })) : []),
    load: (model, patch) => xyPatchAction(model, panel, patch),
    capture: (model, name) => xyPatchOf(model, panel, { name }),
  });
}
