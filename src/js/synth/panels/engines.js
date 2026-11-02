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

export const ENGINE_TAB = Object.freeze({ id: 'engines', label: 'Engines',
  title: 'Synthesis engines',
  description: 'Polyphonic engines, up to 16 voices each, played by the same keys: additive, '
    + 'FM, AM and ring, wavetable, hard sync and percussion. The keys play the engine you '
    + 'choose; every engine sounds through the same output as the panel.' });

export const ENGINE_MODULES = Object.freeze([
  { id: 'additive', label: 'ADDITIVE', node: 'additive-voice' },
  { id: 'fm', label: 'FM', node: 'fm-voice', note: FM_FEEDBACK_BLOCKED },
  { id: 'am', label: 'AM / RING', node: 'am-voice' },
  { id: 'wavetable', label: 'WAVETABLE', node: 'wavetable-voice',
    options: { bank: ['basic', 'formant', 'pulse'] }, init: { attack: 0.02 } },
  { id: 'sync', label: 'HARD SYNC', node: 'wavetable-voice', fixed: { bank: 'sync' },
    init: { morph: 1 } },
  { id: 'perc', label: 'PERCUSSION', node: 'perc-voice' },
].map((m) => Object.freeze({ ...m, tab: ENGINE_TAB.id })));

export const PLUCK_BLOCKED = 'The plucked string needs a short delay loop: a loop in the '
  + 'audio graph, which project.no-silent-feedback v1 refuses, and a delay shorter than one '
  + 'render quantum, which needs an AudioWorklet (owner question Q022, plan K094).';
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
