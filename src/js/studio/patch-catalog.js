// The one patch library (plan K102): every factory and saved patch of every instrument, tagged,
// in ONE catalog that the Synth workspace and the Studio browse through the same dialog
// (ui/patch-browser.js). Every entry is a patch of the patches.js shape, so there is one record
// and three ways in: Apply (PATCH_REPLACE { onto }, parameters only), Insert (PATCH_INSERT,
// new nodes; the keys then play the first node that plays notes) and Replace graph
// (PATCH_REPLACE, the whole graph). Pure: no DOM.
//
// Sources, in this order: the Synth's panel and engine presets (synth/presets.js), the curated
// node presets (node-presets.js), the synthesis templates as whole-graph patches
// (templates/index.js), every source registered through registerPatchSource (the XY pad's
// presets, K097, register here), then the person's saved patches (library.js patches()).
//
//   registerPatchSource({ id, label, entries: () => [entry] })   a category of its own
//   catalogEntries({ user }) -> [entry]
//     entry = { id, name, instrument, instrumentLabel, tags: [tag], source: 'factory' | 'user',
//               modes: ['apply' | 'insert' | 'replace'], patch }
//   browseView(entries, model, { instrument, tag, query, target }) -> { instruments: [{ id,
//     label, count }], tags: [{ id, count }], items: [entry + { inUse, applicable, reason }] }
//     filters are exact (instrument id, tag id); `query` matches the name, case-insensitive
//   entryAction(model, entry, mode, { target }) -> { action } | { reason }

import { NODE_REGISTRY, playsNotes } from './registry.js';
import { canonicalJson } from '../experiments/canonical-json.js';
import { createPatch, patchTargets } from './patches.js';
import { FACTORY_NODE_PRESETS, nodePresetPatch, singleNodeType } from './node-presets.js';
import { STUDIO_TEMPLATES, templateModel } from './templates/index.js';
import SEMI_MONO from '../synth/panels/semi-mono.js';
import { PRESETS, presetPatch } from '../synth/presets.js';

export const GRAPH = 'graph';
const SOURCES = [];

/** Add a category of entries (the XY pad's presets, K097); its entries are read lazily. */
export function registerPatchSource(source) {
  if (!source || typeof source.entries !== 'function' || !/^[a-z][a-z0-9-]{0,31}$/
    .test(source.id || '')) throw new TypeError('registerPatchSource: { id, entries() }');
  const i = SOURCES.findIndex((s) => s.id === source.id);
  if (i >= 0) SOURCES.splice(i, 1);
  SOURCES.push(Object.freeze({ ...source }));
}

const typeLabel = (type) => (NODE_REGISTRY.get(type) || {}).displayName || type;
let factory = null;

function factoryEntries() {
  if (factory) return factory;
  const out = [];
  for (const p of PRESETS) {
    const m = p.engine ? SEMI_MONO.module(p.engine) : null;
    const node = m ? m.node : null;
    const name = p.title.split(':')[0];
    let patch = presetPatch(SEMI_MONO, p.id);
    if (m) { // an inserted engine is named by its sound; Apply still finds the panel's module
      const [n] = patch.graph.nodes;
      patch = { ...patch, graph: { ...patch.graph, nodes: [{ ...n, metadata: { ...n.metadata,
        name } }] } };
    }
    out.push({ id: `synth-${p.id}`, name, source: 'factory',
      instrument: m ? node : SEMI_MONO.id, instrumentLabel: m ? typeLabel(node) : 'Synth panel',
      tags: m ? ['engine', 'preset', ...(p.id === 'kit' ? ['kit'] : [])] : ['panel', 'preset'],
      modes: m ? ['apply', 'insert'] : ['apply'], patch });
  }
  for (const [type, list] of Object.entries(FACTORY_NODE_PRESETS)) {
    for (const p of list) {
      out.push({ id: `node-${type}-${p.id}`, name: p.name, source: 'factory', instrument: type,
        instrumentLabel: typeLabel(type), tags: ['node', 'preset'], modes: ['apply', 'insert'],
        patch: nodePresetPatch(type, p) });
    }
  }
  for (const t of STUDIO_TEMPLATES.filter((x) => x.category === 'synthesis')) {
    const m = templateModel(t.id);
    out.push({ id: `template-${t.id}`, name: t.title, source: 'factory', instrument: GRAPH,
      instrumentLabel: 'Whole graph', tags: ['template'], modes: ['insert', 'replace'],
      patch: createPatch(m, m.graph.nodes.map((n) => n.id), { name: t.title,
        description: t.learn.summary }) });
  }
  factory = out;
  return out;
}

export function catalogEntries({ user = [] } = {}) {
  const extra = SOURCES.flatMap((s) => s.entries().map((e) => ({ source: 'factory',
    tags: [s.id], ...e })));
  const mine = user.map((u) => {
    const type = singleNodeType(u.patch);
    return { id: `user-${u.id}`, name: u.patch.name, source: 'user',
      instrument: type || GRAPH, instrumentLabel: type ? typeLabel(type) : 'Whole graph',
      tags: ['saved'], modes: type ? ['apply', 'insert'] : ['insert', 'replace'],
      patch: u.patch };
  });
  return [...factoryEntries(), ...extra, ...mine];
}

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Whether the model holds the patch's sound: each patch node's parameters on a node of it. */
const inUse = (model, entry) => entry.patch.graph.nodes.every((src) => model.graph.nodes
  .some((n) => n.type === src.type && same({ ...n.params, ...src.params }, n.params)));

function applyReason(model, entry, target) {
  if (!entry.modes.includes('apply')) return null;
  const { onto } = patchTargets(model, entry.patch, { target });
  if (Object.keys(onto).length) return null;
  if (entry.instrument === SEMI_MONO.id) {
    return 'This Studio has no Synth panel: open the Synth, or Insert the panel there first.';
  }
  const several = model.graph.nodes.filter((n) => n.type === entry.instrument).length > 1;
  return several ? `This Studio has several ${entry.instrumentLabel} nodes: select the one to `
    + 'set, or Insert a new one.' : `This Studio has no ${entry.instrumentLabel}: Insert adds `
    + 'one with this sound.';
}

export function browseView(entries, model, { instrument = '', tag = '', query = '',
  target = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const count = (list, key) => {
    const m = new Map();
    for (const e of list) for (const k of [].concat(key(e))) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const labels = new Map(entries.map((e) => [e.instrument, e.instrumentLabel]));
  const instruments = [...count(entries, (e) => e.instrument)].map(([id, n]) => ({ id,
    label: labels.get(id), count: n }));
  const tags = [...count(entries, (e) => e.tags)].map(([id, n]) => ({ id, count: n }));
  const items = entries.filter((e) => (!instrument || e.instrument === instrument)
    && (!tag || e.tags.includes(tag)) && (!q || e.name.toLowerCase().includes(q)))
    .map((e) => {
      const reason = applyReason(model, e, target);
      return { ...e, inUse: inUse(model, e), applicable: e.modes.includes('apply') && !reason,
        reason };
    });
  return { instruments, tags, items };
}

export function entryAction(model, entry, mode, { target = null } = {}) {
  if (!entry.modes.includes(mode)) return { reason: `${entry.name} cannot be loaded that way.` };
  if (mode === 'apply') {
    const reason = applyReason(model, entry, target);
    if (reason) return { reason };
    const { onto } = patchTargets(model, entry.patch, { target });
    return { action: { type: 'PATCH_REPLACE', patch: entry.patch, onto,
      label: `Preset ${entry.name}`.slice(0, 64) } };
  }
  if (mode === 'replace') return { action: { type: 'PATCH_REPLACE', patch: entry.patch } };
  const notes = entry.patch.graph.nodes.find((n) => playsNotes(n.type));
  return { action: { type: 'PATCH_INSERT', patch: entry.patch,
    ...(notes ? { route: notes.id } : {}) } };
}
