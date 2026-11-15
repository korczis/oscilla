// Node presets (plan K020): every node type offers factory presets, and the person's saved
// single-node patches of that type, in one Pro dropdown. A node preset IS a one-node patch, the
// shape of src/js/studio/patches.js (no second preset store): the factory ones are data here
// (and, for the engines, the Synth's engine presets of src/js/synth/presets.js, reused), the
// person's are the patches saved through studio/library.js. Applying one is PATCH_REPLACE
// { onto } (patches.js patchParams): the node's parameters only, one undo entry, every edge
// kept. Preset names name sounds, never products (D1). Pure: no DOM.
//
//   FACTORY_NODE_PRESETS          { [type]: [{ id, name, values }] }   curated, partial values
//   nodePresetPatch(type, preset) -> patch            values over the type's defaults (cached)
//   nodePresets(type, { user }) -> [entry]   'Default' (the registry's defaults) first, then the
//     curated and the engine presets, then `user` patches of exactly one node of `type`;
//     entry = { id, name, source: 'factory' | 'user', patch }
//   nodePresetAction(model, nodeId, entry) -> { action } | { reason }
//   singleNodeType(patch) -> type | null

import { NODE_REGISTRY } from './registry.js';
import { PATCH_KIND, PATCH_SCHEMA_VERSION } from './patches.js';
import { STUDIO_SCHEMA_VERSION } from './schema.js';
import SEMI_MONO from '../synth/panels/semi-mono.js';
import { PRESETS, presetPatch } from '../synth/presets.js';

export const FACTORY_NODE_PRESETS = Object.freeze({
  vco: [
    { id: 'sub-saw', name: 'Hluboká pila', values: { waveform: 'sawtooth', scale: '32' } },
    { id: 'hollow', name: 'Dutý obdélník', values: { waveform: 'square', scale: '8' } },
    { id: 'thin-pulse', name: 'Úzký puls', values: { waveform: 'pulse', width: 20 } },
    { id: 'soft-sine', name: 'Měkký sinus', values: { waveform: 'sine', scale: '8' } },
  ],
  filter: [
    { id: 'dark', name: 'Tmavá dolní propust', values: { type: 'lowpass', frequency: 400,
      Q: 0.7 } },
    { id: 'bright', name: 'Jasná dolní propust', values: { type: 'lowpass', frequency: 4000,
      Q: 0.7 } },
    { id: 'resonant', name: 'Rezonanční špička', values: { type: 'lowpass', frequency: 900,
      Q: 12 } },
    { id: 'thin', name: 'Tenká horní propust', values: { type: 'highpass', frequency: 600,
      Q: 0.7 } },
  ],
  envelope: [
    { id: 'pluck', name: 'Drnknutí', values: { attack: 0.002, decay: 0.18, sustain: 0,
      release: 0.12 } },
    { id: 'pad', name: 'Pomalý pad', values: { attack: 0.8, decay: 0.6, sustain: 0.8,
      release: 1.5 } },
    { id: 'gate', name: 'Varhanní brána', values: { attack: 0.005, decay: 0.01, sustain: 1,
      release: 0.02 } },
  ],
  lfo: [
    { id: 'vibrato', name: 'Jemné vibrato', values: { shape: 'sine', rate: 5.5 } },
    { id: 'drift', name: 'Pomalé kolísání', values: { shape: 'triangle', rate: 0.2 } },
  ],
  noise: [
    { id: 'rain', name: 'Růžový závoj', values: { color: 'pink', level: 0.5 } },
    { id: 'rumble', name: 'Hnědé dunění', values: { color: 'brown', level: 0.6 } },
  ],
});

const DEFAULT = Object.freeze({ id: 'default', name: 'Výchozí', values: {} });
const cache = new Map();

export function nodePresetPatch(type, preset) {
  const key = `${type}/${preset.id}`;
  if (cache.has(key)) return cache.get(key);
  const def = NODE_REGISTRY.get(type);
  const params = {};
  for (const p of def.params) params[p.key] = p.default;
  const patch = Object.freeze({ kind: PATCH_KIND, schemaVersion: PATCH_SCHEMA_VERSION,
    studioSchemaVersion: STUDIO_SCHEMA_VERSION, name: preset.name, description: '',
    graph: { nodes: [{ id: 'n', type, position: { x: 0, y: 0 }, params: { ...params,
      ...preset.values }, metadata: { name: def.displayName } }], edges: [] },
    automation: [] });
  cache.set(key, patch);
  return patch;
}

/** The type of a patch of exactly one node, else null. */
export const singleNodeType = (patch) => (patch && patch.graph && patch.graph.nodes.length === 1
  ? patch.graph.nodes[0].type : null);

/** The Synth's engine presets for an engine type, as the one-node patches they already are. */
function enginePresets(type) {
  return PRESETS.filter((p) => p.engine && SEMI_MONO.module(p.engine).node === type
    && !SEMI_MONO.module(p.engine).fixed).map((p) => ({ id: `engine-${p.id}`,
    name: p.title.split(':')[0], source: 'factory', patch: presetPatch(SEMI_MONO, p.id) }));
}

export function nodePresets(type, { user = [] } = {}) {
  if (!NODE_REGISTRY.get(type)) return [];
  const factory = [DEFAULT, ...(FACTORY_NODE_PRESETS[type] || [])].map((p) => ({
    id: p.id, name: p.name, source: 'factory', patch: nodePresetPatch(type, p) }));
  const mine = user.filter((u) => singleNodeType(u.patch) === type).map((u) => ({
    id: `user-${u.id}`, name: u.patch.name, source: 'user', patch: u.patch }));
  return [...factory, ...enginePresets(type), ...mine];
}

export function nodePresetAction(model, nodeId, entry) {
  const node = model.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return { reason: `Uzel „${String(nodeId)}“ neexistuje.` };
  if (singleNodeType(entry.patch) !== node.type) {
    return { reason: `${entry.name} je předvolba pro jiný typ uzlu.` };
  }
  return { action: { type: 'PATCH_REPLACE', patch: entry.patch,
    onto: { [entry.patch.graph.nodes[0].id]: node.id },
    label: `Předvolba ${entry.name} pro ${node.metadata.name}`.slice(0, 64) } };
}
