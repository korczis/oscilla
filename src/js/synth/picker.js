// Beside the piano (plan K066): what the keys play, the waveform of an oscillator, and the
// quick presets. Pure views of the ONE Studio store and the actions that change it; no DOM.
//
//   instrumentChoices(model, panel, { registry, current }) -> [choice]
//     every node with the notes or hits capability (registry.js playsNotes: the panel's Keys,
//     the engines, a kit once it lands), in graph order, then New Synth voice; choice = { id,
//     name, kind, selected, disabled, reason }
//   routeAction(model, panel, id) -> { action } | { reason }   one history entry: METADATA_SET
//     { noteTarget } (the panel's own Keys clears it: the tab then chooses, Keys on Panel, the
//     chosen engine on Engines); New Synth voice inserts the panel (its BATCH), whose Keys the
//     keys then play; with the panel there it is disabled and says why
//   routedNode(model) -> node | null   the node metadata.noteTarget names, when it plays notes
//   WAVES, waveOf(model, panel, osc) -> wave id, waveAction(model, panel, osc, wave) -> action
//     sine, triangle, saw, square, pulse (the VCO's Wave; its width is the VCO's Pulse width
//     knob) and noise (the Mixer: the oscillator's level to 0, the noise level up), each ONE
//     NODE_PARAM_SET, or ONE BATCH when a wave brings the oscillator's level back

import { NODE_REGISTRY, playsNotes } from '../studio/registry.js';

export const NEW_VOICE = 'new-voice';
export const NEW_VOICE_TAKEN = 'This Studio already holds the Synth panel, and Master Output '
  + 'takes one cable: its Keys and engines are listed above.';
export const WAVES = Object.freeze([['sine', 'Sine'], ['triangle', 'Triangle'],
  ['sawtooth', 'Saw'], ['square', 'Square'], ['pulse', 'Pulse'], ['noise', 'Noise']]
  .map(([id, label]) => Object.freeze({ id, label })));
/** The Mixer input each oscillator of the panel feeds (panels/semi-mono.js normals n5-n7). */
const MIX = Object.freeze({ vco1: 'level1', vco2: 'level2', noise: 'level3' });
const NOISE_LEVEL = 0.7;

export function routedNode(model, registry = NODE_REGISTRY) {
  const id = model.metadata.noteTarget;
  const n = id ? model.graph.nodes.find((x) => x.id === id) : null;
  return n && playsNotes(n.type, registry) ? n : null;
}

export function instrumentChoices(model, panel, { registry = NODE_REGISTRY, current = null } = {}) {
  const out = model.graph.nodes.filter((n) => playsNotes(n.type, registry)).map((n) => ({
    id: n.id, name: n.metadata.name, kind: registry.get(n.type).displayName,
    selected: n.id === current, disabled: false, reason: null }));
  const has = !!panel.resolve(model).get('keys');
  out.push({ id: NEW_VOICE, name: 'New Synth voice', kind: panel.title, selected: false,
    disabled: has, reason: has ? NEW_VOICE_TAKEN : null });
  return out;
}

export function routeAction(model, panel, id, { registry = NODE_REGISTRY } = {}) {
  if (id === NEW_VOICE) {
    if (panel.resolve(model).get('keys')) return { reason: NEW_VOICE_TAKEN };
    return { action: panel.instantiate(model) };
  }
  const n = model.graph.nodes.find((x) => x.id === id);
  if (!n) return { reason: `There is no node "${String(id)}".` };
  if (!playsNotes(n.type, registry)) {
    return { reason: `${n.metadata.name} does not play notes: the keys play a node with the `
      + 'notes or hits capability.' };
  }
  const own = n === panel.resolve(model).get('keys');
  return { action: { type: 'METADATA_SET', noteTarget: own ? null : n.id } };
}

/** The wave the radio group shows for oscillator module `osc` ('' when it is not there). */
export function waveOf(model, panel, osc) {
  const nodes = panel.resolve(model);
  const v = nodes.get(osc);
  const mix = nodes.get('mix');
  if (!v) return '';
  if (mix && mix.params[MIX[osc]] === 0 && mix.params[MIX.noise] > 0) return 'noise';
  return v.params.waveform;
}

export function waveAction(model, panel, osc, wave) {
  const nodes = panel.resolve(model);
  const v = nodes.get(osc);
  const mix = nodes.get('mix');
  if (!v || !WAVES.some((w) => w.id === wave)) return null;
  if (wave === 'noise') {
    if (!mix) return null;
    return { type: 'NODE_PARAM_SET', nodeId: mix.id, params: { [MIX[osc]]: 0,
      [MIX.noise]: Math.max(mix.params[MIX.noise], NOISE_LEVEL) } };
  }
  const set = { type: 'NODE_PARAM_SET', nodeId: v.id, key: 'waveform', value: wave };
  if (!mix || waveOf(model, panel, osc) !== 'noise') return set;
  const init = panel.module('mix').values;
  return { type: 'BATCH', label: `${panel.module(osc).label} ${wave}`, steps: [set,
    { type: 'NODE_PARAM_SET', nodeId: mix.id, params: { [MIX[osc]]: init[MIX[osc]],
      [MIX.noise]: 0 } }] };
}
