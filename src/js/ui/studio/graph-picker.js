// Studio pickers in native <dialog>s (spec §64, §66, §138-§139, §142):
//   - quick add: N or double-click on blank canvas; also create-node-from-cable, then filtered to
//     the node types that accept the cable (§66). Search over name, aliases and category.
//   - accessible connection dialog: the non-drag, non-visual way to connect (keyboard and
//     screen-reader users, §139): pick an output of the node, then one of the inputs that can
//     take it ([Filter 1 / Audio input] [Spectrum 1 / Audio input] ...); the inputs that cannot
//     are listed with their reasons. The choice is ONE EDGE_ADD through the store.
// Focus returns to the node the dialog was opened for (§142).
//
//   createQuickAdd(dialog, svc) -> { open({ at, from }), close(), isOpen() }
//   createConnectDialog(dialog, svc) -> { open(nodeId), close(), isOpen() }
//   createFindNode(dialog, svc) -> { open(), close(), isOpen() }      graph search (§251)
//   svc: { store, registry, editor, announce, openModal(id), closeModal(id) }

import { NODE_REGISTRY } from '../../studio/registry.js';
import { announceAction } from '../../studio/a11y.js';
import { connectableTypes, connectionTargets, nodeOutputs } from './graph-view.js';
import { libraryView } from './library-panel.js';
import { searchAnnouncement, searchNodes } from './graph-search.js';
import { h, replaceChildren } from './graph-dom.js';
import { rovingKeydown } from '../app.js';

function listKeys(e, list, input) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...list.querySelectorAll('button:not([disabled])')];
  const i = all.indexOf(document.activeElement);
  let next = null;
  if (e.key === 'ArrowDown') next = all[i + 1] || (i < 0 ? all[0] : null);
  else next = i > 0 ? all[i - 1] : input;
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

export function createQuickAdd(dialog, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  const title = h('h2', { class: 'osc-dialog-title', id: 'osc-dlg-studio-add-title',
    text: 'Add node' });
  const note = h('p', { class: 'osc-muted osc-dialog-note', 'data-osc': 'studio.add.note' });
  const input = h('input', { class: 'osc-number osc-dialog-input', type: 'search',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search node types',
    placeholder: 'Oscillator, filter, lfo…', 'data-osc': 'studio.add.search' });
  const list = h('div', { class: 'osc-sp-list', 'data-osc': 'studio.add.list' });
  const cancel = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
    'data-osc': 'studio.add.cancel', text: 'Cancel' });
  replaceChildren(dialog, h('div', { class: 'osc-dialog-body' }, [title, note, input, list,
    h('div', { class: 'osc-dialog-actions' }, [cancel])]));
  dialog.setAttribute('aria-labelledby', 'osc-dlg-studio-add-title');
  let ctx = { at: null, from: null };

  const close = () => svc.closeModal(dialog.id);
  cancel.addEventListener('click', close);

  function choose(type) {
    const { at, from } = ctx;
    close();
    svc.editor.addNodeAt(type, at, { connectFrom: from });
  }

  function render() {
    const model = svc.store.getModel();
    const only = ctx.from ? connectableTypes(model, ctx.from, registry) : null;
    const view = libraryView(model, input.value, { registry, onlyTypes: only });
    const items = view.groups.flatMap((g) => g.items);
    replaceChildren(list, items.length ? h('ul', { class: 'osc-sp-items' }, items.map((it) =>
      h('li', {}, [h('button', { type: 'button', class: 'osc-sl-item', 'data-type': it.type,
        'data-osc': 'studio.add.item', disabled: it.disabled, title: it.reason || it.what,
        onClick: () => choose(it.type) }, [
        h('span', { class: 'osc-sl-name', text: it.name }),
        h('span', { class: 'osc-sl-what', text: `${it.categoryLabel} · ${it.what}` }),
      ])]))) : h('p', { class: 'osc-sl-empty', text: 'No node type matches.' }));
    return view;
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = render();
      if (v.first) choose(v.first.type);
    } else listKeys(e, list, input);
  });
  list.addEventListener('keydown', (e) => listKeys(e, list, input));

  return {
    open({ at = null, from = null } = {}) {
      ctx = { at, from };
      input.value = '';
      note.textContent = from
        ? 'Only node types with an input that accepts this cable are listed; the new node is '
          + 'connected to it.'
        : 'Type to search; Enter adds the first match.';
      title.textContent = from ? 'Add a connected node' : 'Add node';
      render();
      svc.openModal(dialog.id);
      setTimeout(() => input.focus(), 0);
    },
    close,
    isOpen: () => dialog.open,
  };
}

export function createConnectDialog(dialog, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  const title = h('h2', { class: 'osc-dialog-title', id: 'osc-dlg-studio-connect-title',
    text: 'Connect' });
  const outs = h('div', { class: 'osc-seg osc-sp-outs', role: 'radiogroup',
    'aria-label': 'Output', 'data-osc': 'studio.connect.outputs' });
  const list = h('div', { class: 'osc-sp-list', 'data-osc': 'studio.connect.targets' });
  const rejected = h('details', { class: 'osc-sp-rejected', 'data-osc': 'studio.connect.rejected' });
  const cancel = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
    'data-osc': 'studio.connect.cancel', text: 'Cancel' });
  replaceChildren(dialog, h('div', { class: 'osc-dialog-body' }, [title, outs,
    h('p', { class: 'osc-label', id: 'osc-sp-targets-label', text: 'Connect to' }), list,
    rejected, h('div', { class: 'osc-dialog-actions' }, [cancel])]));
  dialog.setAttribute('aria-labelledby', 'osc-dlg-studio-connect-title');
  let nodeId = null;
  let port = null;

  const close = () => svc.closeModal(dialog.id);
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    if (nodeId) setTimeout(() => svc.editor.focusNode(nodeId), 0);
  });

  function renderTargets() {
    const model = svc.store.getModel();
    const from = { node: nodeId, port };
    const all = connectionTargets(model, from, registry);
    const ok = all.filter((t) => t.allowed);
    const no = all.filter((t) => !t.allowed && t.type === registry.port(
      model.graph.nodes.find((n) => n.id === nodeId).type, port, 'out').type);
    replaceChildren(list, ok.length ? h('ul', { class: 'osc-sp-items',
      'aria-labelledby': 'osc-sp-targets-label' }, ok.map((t) => h('li', {}, [
      h('button', { type: 'button', class: 'osc-sl-item', 'data-osc': 'studio.connect.target',
        'data-node': t.node, 'data-port': t.port, onClick: () => {
          const r = svc.store.dispatch({ type: 'EDGE_ADD', from, to: { node: t.node,
            port: t.port } });
          svc.announce(announceAction(r), { assertive: !r.ok });
          if (r.ok) close();
        } }, [h('span', { class: 'osc-sl-name', text: t.label })]),
    ]))) : h('p', { class: 'osc-sl-empty', text: 'No input in this graph can take this output '
      + 'now. Add a node first (N).' }));
    replaceChildren(rejected, [h('summary', { text: `${no.length} input${no.length === 1 ? ''
      : 's'} of the same signal type cannot take it` }), h('ul', {}, no.map((t) => h('li', {
      text: `${t.label}: ${t.reason.replace(/^Connection rejected: /, '')}` })))]);
    rejected.hidden = !no.length;
  }

  function renderOutputs() {
    const model = svc.store.getModel();
    const o = nodeOutputs(model, nodeId, registry);
    replaceChildren(outs, o.map((x) => h('button', { type: 'button', role: 'radio',
      class: `osc-seg-btn${x.id === port ? ' is-active' : ''}`, 'aria-checked': String(x.id === port),
      tabindex: x.id === port ? '0' : '-1', 'data-osc': 'studio.connect.output',
      'data-port': x.id, text: x.text, onKeydown: (e) => rovingKeydown(e), onClick: () => {
        if (port === x.id) return;
        port = x.id;
        renderOutputs();
        renderTargets();
        const el = outs.querySelector(`[data-port="${CSS.escape(x.id)}"]`);
        if (el) el.focus();
      } })));
    outs.hidden = o.length < 2;
  }

  list.addEventListener('keydown', (e) => listKeys(e, list, null));

  return {
    open(id) {
      const model = svc.store.getModel();
      const n = model.graph.nodes.find((x) => x.id === id);
      const o = n ? nodeOutputs(model, id, registry) : [];
      if (!o.length) {
        svc.announce(n ? `${n.metadata.name} has no output to connect.` : 'Select a node first.');
        return false;
      }
      nodeId = id;
      port = o[0].id;
      title.textContent = `Connect ${n.metadata.name}`;
      renderOutputs();
      renderTargets();
      svc.openModal(dialog.id);
      setTimeout(() => {
        const first = list.querySelector('button') || outs.querySelector('button') || cancel;
        first.focus();
      }, 0);
      return true;
    },
    close,
    isOpen: () => dialog.open,
  };
}

/**
 * Find node (spec §250-§251; plan V428): `/` or the graph's Find button. A search field over the
 * nodes of the current graph (graph-search.js: name, type, aliases, category) and the list of
 * matches; Enter or a click selects the node, frames it (editor.frameSelection) and focuses it
 * (editor.focusNode). Escape or Cancel returns focus to where the search was opened from.
 *   createFindNode(dialog, svc) -> { open(), close(), isOpen() }
 *   svc as the other pickers, plus reveal(nodeId): show the graph and frame / focus the node
 */
export function createFindNode(dialog, svc) {
  const registry = svc.registry || NODE_REGISTRY;
  const title = h('h2', { class: 'osc-dialog-title', id: 'osc-dlg-studio-find-title',
    text: 'Find node' });
  const input = h('input', { class: 'osc-number osc-dialog-input', type: 'search',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find a node by name or type',
    placeholder: 'Name or type: filter, lfo 1, master…', 'data-osc': 'studio.find.search',
    'aria-describedby': 'osc-dlg-studio-find-status' });
  const status = h('p', { class: 'osc-muted osc-dialog-note', id: 'osc-dlg-studio-find-status',
    role: 'status', 'aria-live': 'polite', 'data-osc': 'studio.find.status' });
  const list = h('div', { class: 'osc-sp-list', 'data-osc': 'studio.find.list' });
  const cancel = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
    'data-osc': 'studio.find.cancel', text: 'Cancel' });
  replaceChildren(dialog, h('div', { class: 'osc-dialog-body' }, [title, input, status, list,
    h('div', { class: 'osc-dialog-actions' }, [cancel])]));
  dialog.setAttribute('aria-labelledby', 'osc-dlg-studio-find-title');
  let opener = null;
  let chosen = false;

  const close = () => svc.closeModal(dialog.id);
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    if (chosen || !opener || !opener.isConnected) return;
    const el = opener;
    setTimeout(() => el.focus({ preventScroll: true }), 0);
  });

  function choose(id) {
    chosen = true;
    close();
    svc.reveal(id);
  }

  function render() {
    const r = searchNodes(svc.store.getModel(), input.value, { registry });
    replaceChildren(list, r.items.length ? h('ul', { class: 'osc-sp-items' }, r.items.map((it) =>
      h('li', {}, [h('button', { type: 'button', class: 'osc-sl-item', 'data-node': it.id,
        'data-osc': 'studio.find.item', onClick: () => choose(it.id) }, [
        h('span', { class: 'osc-sl-name', text: it.name }),
        h('span', { class: 'osc-sl-what', text: `${it.typeLabel} · ${it.categoryLabel}` }),
      ])]))) : h('p', { class: 'osc-sl-empty', text: 'No node matches.' }));
    status.textContent = searchAnnouncement(r);
    return r;
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = render();
      if (r.items.length) choose(r.items[0].id);
      else svc.announce(searchAnnouncement(r), { assertive: true });
    } else if (e.key === 'Escape') {
      // A search field would only clear itself: Escape closes the search, and nothing else
      // (the Studio and the instrument never see it, so no audio stops).
      e.preventDefault();
      e.stopPropagation();
      close();
    } else listKeys(e, list, input);
  });
  list.addEventListener('keydown', (e) => listKeys(e, list, input));

  return {
    open() {
      opener = document.activeElement instanceof HTMLElement
        && document.activeElement !== document.body ? document.activeElement : null;
      chosen = false;
      input.value = '';
      render();
      svc.openModal(dialog.id);
      setTimeout(() => input.focus(), 0);
    },
    close,
    isOpen: () => dialog.open,
  };
}
