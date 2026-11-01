// The UI catalogue registry (plan issue G001, ADR 0081 decision 1): every declaration of
// decl/*.js, imported statically so the build bundles it once a runtime module imports the
// registry, plus one node-face entry per node type of the Studio node registry, derived and
// never declared by hand. Pure: no DOM, no state, no subscription.
//
//   CATALOG                                 the catalogue of the declarations below
//   createCatalog(decls, nodeRegistry?) -> catalogue   (throws on a duplicate id or hook)
//   catalogue.get(id) -> decl | null        catalogue.has(id), catalogue.list()
//   catalogue.covers(hook) -> boolean       an id, a listed hook or an expanded pattern hook
//   catalogue.hooks() -> [hook]             every concrete hook, sorted
//   catalogue.nodeFaces() -> [decl]         the derived node faces, in registry order
//   nodeFaceOf(def) -> decl                 the face of one node definition (id studio.node.<type>)

import { NODE_REGISTRY } from '../../studio/registry.js';
import { defineComponent, hooksOf } from './define.js';
import filterLab from './decl/filter-lab.js';
import mic from './decl/mic.js';
import navigation from './decl/navigation.js';
import records from './decl/records.js';
import studioCompact from './decl/studio-compact.js';
import studioGraph from './decl/studio-graph.js';
import studioInspector from './decl/studio-inspector.js';
import studioPatches from './decl/studio-patches.js';
import studioTimeline from './decl/studio-timeline.js';
import studioTransport from './decl/studio-transport.js';

export const DECLARATIONS = Object.freeze([...studioTransport, ...studioTimeline,
  ...studioCompact, ...filterLab, ...mic, ...navigation, ...records, ...studioGraph,
  ...studioPatches, ...studioInspector]);

/** The node face of a node definition: its name, its help sentence, the model as its state. */
export function nodeFaceOf(def) {
  return defineComponent({
    id: `studio.node.${def.type}`,
    kind: 'node-face',
    label: def.displayName,
    docs: def.help.what,
    state: 'studio.model',
  }, { derived: true });
}

/** A catalogue of `decls` (defined, or raw and defined here) and the faces of `nodeRegistry`. */
export function createCatalog(decls, nodeRegistry = NODE_REGISTRY) {
  const faces = nodeRegistry.list().map(nodeFaceOf);
  const byId = new Map();
  const byHook = new Map();
  for (const raw of [...decls, ...faces]) {
    const d = Object.isFrozen(raw) ? raw : defineComponent(raw);
    if (byId.has(d.id) || byHook.has(d.id)) throw new Error(`catalogue: duplicate id ${d.id}`);
    byId.set(d.id, d);
    for (const h of hooksOf(d)) {
      if (byHook.has(h) || (byId.has(h) && h !== d.id)) {
        throw new Error(`catalogue: hook ${h} is declared twice (${d.id})`);
      }
      byHook.set(h, d.id);
    }
  }
  const list = Object.freeze([...byId.values()]);
  const hooks = Object.freeze([...byHook.keys()].sort());
  return Object.freeze({
    get: (id) => byId.get(id) || null,
    has: (id) => byId.has(id),
    list: () => list,
    covers: (hook) => byId.has(hook) || byHook.has(hook),
    hooks: () => hooks,
    nodeFaces: () => Object.freeze(list.filter((d) => d.kind === 'node-face')),
  });
}

export const CATALOG = createCatalog(DECLARATIONS);
