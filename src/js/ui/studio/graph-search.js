// Studio graph search (spec §250-§251; plan V428): find a node of the CURRENT graph by its name,
// its type (id, display name, aliases) or its category, and frame it. Pure: plain data in, plain
// data out; the dialog is graph-picker.js createFindNode, the framing the graph editor's own
// frameSelection and focusNode (one SELECTION_CHANGE, view state only: nothing undoable, nothing
// dirty, nothing in provenance, §252-§255).
//
//   searchNodes(model, query, { registry, limit }) -> { items, total, query }
//     items: [{ id, name, type, typeLabel, categoryLabel, text, rank }] best match first, then
//     model order (the Tab order of the graph, §142); an empty query lists every node in model
//     order. Every whitespace-separated term must match one field (AND); `rank` is the best field
//     of the weakest term (0 exact name, 1 name prefix, 2 a word of the name starts with it,
//     3 type or category prefix, 4 substring anywhere). `total` counts all matches before the
//     limit.

import { NODE_REGISTRY } from '../../studio/registry.js';
import { CATEGORY_LABELS } from './graph-view.js';

/** Most results the dialog lists (a 100-node graph stays one short list, §145, §250). */
export const SEARCH_LIMIT = 50;

const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .trim();

function termRank(term, f) {
  if (f.name === term) return 0;
  if (f.name.startsWith(term)) return 1;
  if (f.words.some((w) => w.startsWith(term))) return 2;
  if (f.typeWords.some((w) => w.startsWith(term))) return 3;
  if (f.all.includes(term)) return 4;
  return null;
}

/** Search the nodes of `model` (see the header). Never throws. */
export function searchNodes(model, query, { registry = NODE_REGISTRY, limit = SEARCH_LIMIT } = {}) {
  const q = norm(query);
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const hits = [];
  model.graph.nodes.forEach((n, order) => {
    const def = registry.get(n.type);
    const typeLabel = def ? def.displayName : n.type;
    const categoryLabel = def ? CATEGORY_LABELS[def.category] || def.category : 'Unknown';
    const name = norm(n.metadata.name);
    const typeText = [n.type, typeLabel, categoryLabel, ...(def && def.aliases ? def.aliases : [])]
      .map(norm);
    const f = {
      name,
      words: name.split(/[\s\-_/·.]+/).filter(Boolean),
      typeWords: typeText.flatMap((t) => [t, ...t.split(/[\s\-_/·.]+/)]).filter(Boolean),
      all: [name, norm(n.id), ...typeText].join(' '),
    };
    let rank = 0;
    for (const t of terms) {
      const r = termRank(t, f);
      if (r === null) return;
      rank = Math.max(rank, r);
    }
    hits.push({ id: n.id, name: n.metadata.name, type: n.type, typeLabel, categoryLabel,
      text: `${n.metadata.name} · ${typeLabel}`, rank, order });
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const items = hits.slice(0, Math.max(0, limit)).map(({ order, ...rest }) => rest);
  return { items, total: hits.length, query: q };
}

/** Live-region text of a search result list (§144: words, never coordinates). */
export function searchAnnouncement(result) {
  if (!result.total) {
    return result.query ? `No node matches “${result.query}”.` : 'The graph is empty.';
  }
  const more = result.total > result.items.length
    ? `, the first ${result.items.length} listed` : '';
  return `${result.total} node${result.total === 1 ? '' : 's'} match${result.total === 1 ? 'es'
    : ''}${more}.`;
}
