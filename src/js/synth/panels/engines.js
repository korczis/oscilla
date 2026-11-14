// The Engines tab of the Synth (plan K090-K092, K121-K123): the polyphonic engines as module
// entries of the Synth panel declaration (panels/semi-mono.js composes them), so their faces,
// jacks, links, presets and Restore module come from the same generated code as the panel's.
// Adding an engine is one entry here; its Chain normal is derived (enginesChain).
//
// The Master Output takes one cable, so the instruments share it through a chain: the panel's
// amplifier feeds the first engine's Chain input, each engine's output the next one's, and the
// last engine feeds the Output. An engine passes its Chain input through unchanged and adds its
// own voices, so every instrument sounds through the one output with no mixer to manage.
//
// ENGINE_BLOCKED lists engines the picker shows disabled, each with the reason it cannot be
// offered yet (project.no-inert-surfaces (b)).

import { FM_FEEDBACK_BLOCKED } from '../fm-algorithms.js';
import { MAX_VOICES } from '../voice-pool.js';
import { PERC_VOICES, PERC_VOICE_PARAMS, percParamKey } from '../perc-recipes.js';

/** The percussion engine's per-voice parameters (K071): edited per row in the Drums tab's sound
 *  editor and in the Studio, not as 40 knobs on the engine's face. */
const PERC_ROW_KEYS = Object.freeze(Object.keys(PERC_VOICES).flatMap((id) => PERC_VOICE_PARAMS
  .map((name) => percParamKey(id, name))));

export const ENGINE_TAB = Object.freeze({ id: 'engines', label: 'Enginy',
  title: 'Syntézní enginy',
  description: `Polyfonní enginy, každý až s ${MAX_VOICES} hlasy, hrají ze stejných kláves: `
    + 'aditivní, FM, AM a kruhová modulace, wavetable, hard sync a perkuse. Klávesy hrají '
    + 'engine, který zvolíte; každý engine zní stejným výstupem jako panel.' });

export const ENGINE_MODULES = Object.freeze([
  { id: 'additive', label: 'ADDITIVE', node: 'additive-voice' },
  { id: 'fm', label: 'FM', node: 'fm-voice', note: FM_FEEDBACK_BLOCKED },
  { id: 'am', label: 'AM / RING', node: 'am-voice' },
  { id: 'wavetable', label: 'WAVETABLE', node: 'wavetable-voice',
    options: { bank: ['basic', 'formant', 'pulse'] }, init: { attack: 0.02 } },
  { id: 'sync', label: 'HARD SYNC', node: 'wavetable-voice', fixed: { bank: 'sync' },
    init: { morph: 1 } },
  { id: 'perc', label: 'PERCUSSION', node: 'perc-voice', studio: PERC_ROW_KEYS },
].map((m) => Object.freeze({ ...m, tab: ENGINE_TAB.id })));

export const PLUCK_BLOCKED = 'Drnkaná struna potřebuje krátkou zpožďovací smyčku: smyčku ve '
  + 'zvukovém grafu, kterou project.no-silent-feedback v1 odmítá, a zpoždění kratší než jedno '
  + 'renderovací kvantum, které vyžaduje AudioWorklet (otázka vlastníka Q022, plán K094).';
export const ENGINE_BLOCKED = Object.freeze([
  Object.freeze({ id: 'pluck', label: 'PLUCKED STRING', reason: PLUCK_BLOCKED }),
  Object.freeze({ id: 'fm-feedback', label: 'FM FEEDBACK', reason: FM_FEEDBACK_BLOCKED }),
]);

/**
 * The chain normals: `from` (an output jack) into the first engine's Chain, each engine into
 * the next one, the last into `to`. Ids e1, e2, ... in engine order.
 */
export function enginesChain(from, to, modules = ENGINE_MODULES) {
  const sources = [from, ...modules.map((m) => `${m.id}.audio`)];
  const targets = [...modules.map((m) => `${m.id}.thru`), to];
  return targets.map((t, i) => [`e${i + 1}`, sources[i], t]);
}
