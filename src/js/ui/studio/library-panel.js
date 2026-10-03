// Studio node library (spec §29-§30, §63-§64, §66, §193). The library lists the canonical
// registry (src/js/studio/registry.js), grouped by category, searchable over name, aliases and
// category (registry.search, §30). A click inserts the type at the viewport centre; a pointer
// drag drops it where it is released (logical coordinates, §63). Both end in ONE NODE_ADD
// through the editor. The same view drives the quick-add picker (N, double-click, §64) and the
// create-node-from-cable picker (filtered by compatible inputs, §66).
//
//   libraryView(model, query, { registry, onlyTypes }) -> { groups: [{ id, label, items }],
//     count, empty }                                                       pure (unit-tested)
//   mountLibrary(host, svc) -> { render(), focusSearch(), destroy() }       DOM
//     svc: { store, registry, addAtCenter(type), addAtPoint(type, clientX, clientY) -> bool,
//            isOverGraph(clientX, clientY) -> bool }

import { NODE_REGISTRY } from '../../studio/registry.js';
import { CATEGORY_LABELS } from './graph-view.js';
import { h, replaceChildren } from './graph-dom.js';
import { DRAG_THRESHOLD_PX, pastThreshold } from './graph-geometry.js';

/**
 * The library entries for `query` (all when empty), grouped in library order. A type at its
 * instance limit (one Master Output, §187) is listed as unavailable with the reason.
 * opts.onlyTypes: restrict to these types (create-node-from-cable).
 */
export function libraryView(model, query = '', opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const only = opts.onlyTypes ? new Set(opts.onlyTypes) : null;
  const found = registry.search(query || '').filter((d) => !only || only.has(d.type));
  const ranked = new Map(found.map((d, i) => [d.type, i]));
  const counts = new Map();
  for (const n of model.graph.nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
  const searching = !!String(query || '').trim();
  const item = (d) => {
    const full = d.maxInstances != null && (counts.get(d.type) || 0) >= d.maxInstances;
    return {
      type: d.type,
      name: d.displayName,
      category: d.category,
      categoryLabel: CATEGORY_LABELS[d.category] || d.category,
      what: d.help.what,
      disabled: full,
      reason: full ? `A Studio has exactly one ${d.displayName}.` : null,
      live: !!d.capabilities.requiresInputPermission,
    };
  };
  if (searching) {
    // Ranked results in one group: the best match first (Enter adds it).
    const items = found.map(item);
    return { groups: items.length ? [{ id: 'results', label: 'Results', items }] : [],
      count: items.length, empty: !items.length, first: items.find((i) => !i.disabled) || null };
  }
  const groups = registry.categories().map((c) => ({ id: c.id, label: c.label,
    items: c.types.filter((d) => ranked.has(d.type)).map(item) }))
    .filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  return { groups, count: all.length, empty: !all.length,
    first: all.find((i) => !i.disabled) || null };
}

/** Mount the library panel into `host`. */
export function mountLibrary(host, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  let query = '';
  const search = h('input', { class: 'osc-number osc-sl-search', type: 'search',
    placeholder: 'Search nodes', 'aria-label': 'Search the node library', autocomplete: 'off',
    spellcheck: 'false', 'data-osc': 'studio.library.search' });
  const list = h('div', { class: 'osc-sl-list', 'data-osc': 'studio.library.list' });
  const count = h('p', { class: 'osc-sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  replaceChildren(host, [search, count, list]);
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = libraryView(svc.store.getModel(), query, { registry });
      if (v.first) svc.addAtCenter(v.first.type);
    } else if (e.key === 'ArrowDown') {
      const first = list.querySelector('button:not([disabled])');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Pointer drag from an item onto the graph (§63). A press without movement is a click.
  let drag = null;
  function onDown(e, type, btn) {
    if (e.button !== undefined && e.button !== 0) return;
    if (btn.disabled) return;
    drag = { type, btn, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost && !pastThreshold(e.clientX - drag.x, e.clientY - drag.y,
      DRAG_THRESHOLD_PX * 2)) return;
    if (e.pointerType === 'touch' && !drag.ghost) {
      // A touch drag in the list scrolls the list; it never turns into a node drag.
      drag = null;
      return;
    }
    if (!drag.ghost) {
      drag.ghost = h('div', { class: 'osc-sl-ghost', 'aria-hidden': 'true',
        text: registry.get(drag.type).displayName.toUpperCase() });
      document.body.appendChild(drag.ghost);
      try { drag.btn.setPointerCapture(drag.id); } catch (err) { /* not capturable */ }
    }
    drag.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    drag.ghost.classList.toggle('is-over', svc.isOverGraph(e.clientX, e.clientY));
  }
  function finish(e, commit) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (d.ghost) {
      d.ghost.remove();
      d.btn.dataset.dragged = '1'; // the click that follows the drag is not an insert
      if (commit && e) svc.addAtPoint(d.type, e.clientX, e.clientY);
    }
  }
  const up = (e) => finish(e, true);
  const cancel = (e) => finish(e, false);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', () => finish(null, false));

  function render() {
    const view = libraryView(svc.store.getModel(), query, { registry });
    const groups = view.groups.map((g) => h('section', { class: 'osc-sl-group',
      'aria-label': g.label }, [
      h('h5', { class: 'osc-sl-cat', text: g.label }),
      h('ul', { class: 'osc-sl-items' }, g.items.map((it) => {
        const btn = h('button', { type: 'button', class: 'osc-sl-item', 'data-type': it.type,
          'data-osc': 'studio.library.item', disabled: it.disabled,
          title: it.reason || it.what,
          'aria-label': `Add ${it.name}, ${it.categoryLabel.toLowerCase()} node${
            it.reason ? `. ${it.reason}` : ''}` }, [
          h('span', { class: 'osc-sl-name', text: it.name }),
          h('span', { class: 'osc-sl-what', text: it.what }),
        ]);
        btn.addEventListener('pointerdown', (e) => onDown(e, it.type, btn));
        btn.addEventListener('click', () => {
          if (btn.dataset.dragged) {
            delete btn.dataset.dragged;
            return;
          }
          svc.addAtCenter(it.type);
        });
        btn.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const all = [...list.querySelectorAll('button:not([disabled])')];
          const i = all.indexOf(btn);
          const next = e.key === 'ArrowDown' ? all[i + 1] : (i > 0 ? all[i - 1] : search);
          if (next) {
            e.preventDefault();
            next.focus();
          }
        });
        return h('li', {}, [btn]);
      })),
    ]));
    replaceChildren(list, view.empty ? [h('p', { class: 'osc-sl-empty',
      text: `No node matches “${query.trim()}”.` })] : groups);
    count.textContent = query.trim() ? `${view.count} node types` : '';
  }

  render();
  return {
    render,
    focusSearch() { search.focus(); },
    destroy() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      replaceChildren(host, []);
    },
  };
}
