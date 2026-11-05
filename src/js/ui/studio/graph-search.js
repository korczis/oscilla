// Studio search (spec §30, §64, §66, §250-§251; plans V428, V610). Every Studio search ranks
// with the registry's one ranking (registry.js rankSearch, re-exported here): the quick-add
// dialog and the node library through library-panel.js libraryView (registry.search), the find
// dialog through searchNodes below. Pure: plain data in, plain data out; no dialog carries its
// own matcher. The find dialog is graph-picker.js createFindNode; framing is the graph editor's
// own frameSelection and focusNode (one SELECTION_CHANGE, view state only: nothing undoable,
// nothing dirty, nothing in provenance, §252-§255).
//
//   rankSearch(entries, query) -> [{ entry, rank }]    the one ranking (see registry.js)
//   searchNodes(model, query, { registry, limit }) -> { items, total, query }
//     items: [{ id, name, type, typeLabel, categoryLabel, text, rank }] best match first; the
//     node's name is its name, its type, id, category and the type's aliases are its aliases
//     (so a node named "Filter" comes before every other Filter); an empty query lists every node
//     in model order (the Tab order of the graph, §142). `total` counts all matches before the
//     limit.
//   searchAnnouncement(result, { target }) -> text   target: also name the Enter target
//   rememberRecent(recent, type, max) -> recent   the quick add's recently added types (newest
//     first, at most RECENT_LIMIT): view state of the dialog, never saved.

import { NODE_REGISTRY, rankSearch } from '../../studio/registry.js';
import { CATEGORY_LABELS } from './graph-view.js';

export { rankSearch };

/** Most results the dialog lists (a 100-node graph stays one short list, §145, §250). */
export const SEARCH_LIMIT = 50;
/** Recently added node types the empty quick add lists first (V610). */
export const RECENT_LIMIT = 5;

/** `recent` with `type` in front, without repeats, at most `max` long (view state). */
export function rememberRecent(recent, type, max = RECENT_LIMIT) {
  if (typeof type !== 'string' || !type) return recent;
  return [type, ...recent.filter((t) => t !== type)].slice(0, max);
}

/** Search the nodes of `model` (see the header). Never throws. */
export function searchNodes(model, query, { registry = NODE_REGISTRY, limit = SEARCH_LIMIT } = {}) {
  const entries = model.graph.nodes.map((n) => {
    const def = registry.get(n.type);
    const typeLabel = def ? def.displayName : n.type;
    const categoryLabel = def ? CATEGORY_LABELS[def.category] || def.category : 'Unknown';
    return { names: [n.metadata.name], category: def ? def.category : null,
      aliases: [typeLabel, n.type, n.id, categoryLabel, ...(def ? def.aliases : [])],
      item: { id: n.id, name: n.metadata.name, type: n.type, typeLabel, categoryLabel,
        text: `${n.metadata.name} · ${typeLabel}` } };
  });
  const hits = rankSearch(entries, query);
  const items = hits.slice(0, Math.max(0, limit)).map((x) => ({ ...x.entry.item, rank: x.rank }));
  return { items, total: hits.length, query: String(query ?? '').trim() };
}

/**
 * Live-region text of a search result list (§144: words, never coordinates). target: also name
 * what Enter selects (the find dialog's status line, per keystroke).
 */
export function searchAnnouncement(result, { target = false } = {}) {
  if (!result.total) {
    return result.query ? `No node matches “${result.query}”.` : 'The graph is empty.';
  }
  const more = result.total > result.items.length
    ? `, the first ${result.items.length} listed` : '';
  const enter = target && result.query ? `; Enter selects ${result.items[0].name}` : '';
  return `${result.total} node${result.total === 1 ? '' : 's'} match${result.total === 1 ? 'es'
    : ''}${more}${enter}.`;
}
