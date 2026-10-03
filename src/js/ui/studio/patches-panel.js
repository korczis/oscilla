// Studio projects and patches UI (spec §111-§115, §154-§158, §238-§239; plan V426 UI). Thin DOM
// over src/js/studio/library.js and patches.js: local save/load through the EXISTING experiment
// store (IndexedDB, or its memory store on file:// with an explicit note), file export/import of
// `.oscilla-studio.json` / `.oscilla-patch.json`, insert or replace with explicit intent (§114),
// and no silent overwrite of a saved patch (§155). Untrusted files go through the full import
// pipeline (importStudioFile: size cap, structural scan, strict schema, validation) and are
// rendered with textContent only.
//
//   STUDIO_STORE_FALLBACK_TEXT
//   recordId(prefix, title, existingIds, keepId?) -> id     pure (unit-tested)
//   savedListView(summaries, now?) -> [{ id, kind, kindLabel, name, when }]
//   mountPatches(dialogs, svc) -> { openLibrary(), openSavePatch(nodeIds), refresh() }
//     dialogs: { library: <dialog>, savePatch: <dialog> }
//     svc: { store, library() -> Promise<library>, persistent() -> bool, announce,
//            openProject({ model, summary }), downloadFile({ name, type, text }),
//            openModal(id), closeModal(id) }

import { ID_PATTERN } from '../../experiments/schema.js';
import { createPatch } from '../../studio/patches.js';
import { exportPatchFile, fileSlug } from '../../studio/library.js';
import { announceAction } from '../../studio/a11y.js';
import { h, replaceChildren } from './graph-dom.js';

export const STUDIO_STORE_FALLBACK_TEXT = 'Studio projects and patches are kept in memory for '
  + 'this page view only: this browser does not allow IndexedDB here (for example on file://). '
  + 'Export the project as .oscilla-studio.json to keep it.';

/**
 * A record id for a new save: `<prefix>-<slug>`, numbered (-2, -3, ...) past ids already used;
 * `keepId` (the document's own id) is returned as is when it is valid.
 */
export function recordId(prefix, title, existingIds = [], keepId = null) {
  if (keepId && ID_PATTERN.test(keepId)) return keepId;
  const used = new Set(existingIds);
  const base = `${prefix}-${fileSlug(title, prefix === 'patch' ? 'patch' : 'studio')}`
    .slice(0, 100);
  if (!used.has(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${existingIds.length + 1}`;
}

/** List rows of saved records, newest first as the store returns them. */
export function savedListView(summaries) {
  return (summaries || []).map((r) => ({
    id: r.id,
    kind: r.kind === 'oscilla-patch' ? 'patch' : 'project',
    kindLabel: r.kind === 'oscilla-patch' ? 'Patch' : 'Project',
    name: r.name,
    when: typeof r.savedAt === 'string' ? r.savedAt.replace('T', ' ').slice(0, 16) : '',
  }));
}

export function mountPatches(dialogs, svc) {
  // ---------------------------------------------------------------- library dialog
  const libDlg = dialogs.library;
  const note = h('p', { class: 'osc-muted osc-dialog-note', 'data-osc': 'studio.library.note' });
  const list = h('div', { class: 'osc-sp-list osc-sp-saved', 'data-osc': 'studio.saved.list' });
  const status = h('p', { class: 'osc-pp-error', role: 'alert', 'data-osc': 'studio.saved.error',
    hidden: true });
  const close = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary', text: 'Close',
    'data-osc': 'studio.saved.close', onClick: () => svc.closeModal(libDlg.id) });
  replaceChildren(libDlg, h('div', { class: 'osc-dialog-body' }, [
    h('h2', { class: 'osc-dialog-title', id: 'osc-dlg-studio-lib-title',
      text: 'Projects and patches' }),
    note, status, list,
    h('div', { class: 'osc-dialog-actions' }, [close]),
  ]));
  libDlg.setAttribute('aria-labelledby', 'osc-dlg-studio-lib-title');
  let confirmDelete = null;

  const fail = (err) => {
    const text = (err && err.message) || String(err);
    status.textContent = text;
    status.hidden = false;
    svc.announce(text, { assertive: true });
  };

  async function refresh() {
    status.hidden = true;
    note.textContent = svc.persistent() ? 'Saved in this browser (IndexedDB). Nothing leaves it '
      + 'unless you export a file.' : STUDIO_STORE_FALLBACK_TEXT;
    let rows = [];
    try {
      const lib = await svc.library();
      rows = savedListView(await lib.list());
    } catch (e) {
      fail(e);
    }
    const btn = (text, osc, fn) => h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
      'data-osc': osc, text, onClick: fn });
    replaceChildren(list, rows.length ? h('ul', { class: 'osc-sp-items' }, rows.map((r) =>
      h('li', { class: 'osc-sp-row', 'data-id': r.id, 'data-kind': r.kind }, [
        h('div', { class: 'osc-sp-meta' }, [
          h('span', { class: 'osc-sl-name', text: r.name }),
          h('span', { class: 'osc-sl-what osc-num', text: `${r.kindLabel} · ${r.when}` }),
        ]),
        h('div', { class: 'osc-sp-acts' }, r.kind === 'project' ? [
          btn('Open', 'studio.saved.open', () => openProject(r.id)),
          btn(confirmDelete === r.id ? 'Confirm delete' : 'Delete', 'studio.saved.delete',
            () => remove(r.id)),
        ] : [
          btn('Insert', 'studio.saved.insert', () => applyPatch(r.id, 'insert')),
          btn('Replace graph', 'studio.saved.replace', () => applyPatch(r.id, 'replace')),
          btn('Export', 'studio.saved.export', () => exportPatch(r.id)),
          btn(confirmDelete === r.id ? 'Confirm delete' : 'Delete', 'studio.saved.delete',
            () => remove(r.id)),
        ]),
      ]))) : h('p', { class: 'osc-sl-empty', text: 'Nothing saved yet. Save the project from the '
      + 'toolbar, or select nodes and choose Save as patch.' }));
  }

  async function openProject(id) {
    try {
      const lib = await svc.library();
      const r = await lib.loadProject(id);
      if (!r) throw new Error('That project is no longer saved.');
      svc.closeModal(libDlg.id);
      svc.openProject(r);
    } catch (e) {
      fail(e);
    }
  }

  async function applyPatch(id, mode) {
    try {
      const lib = await svc.library();
      const r = await lib.loadPatch(id);
      if (!r) throw new Error('That patch is no longer saved.');
      const res = svc.store.dispatch({ type: mode === 'replace' ? 'PATCH_REPLACE'
        : 'PATCH_INSERT', patch: r.patch });
      svc.announce(announceAction(res), { assertive: !res.ok });
      if (!res.ok) throw new Error(res.reason);
      svc.closeModal(libDlg.id);
    } catch (e) {
      fail(e);
    }
  }

  async function exportPatch(id) {
    try {
      const lib = await svc.library();
      const r = await lib.loadPatch(id);
      if (!r) throw new Error('That patch is no longer saved.');
      svc.downloadFile(exportPatchFile(r.patch));
      svc.announce(`Exported patch ${r.patch.name}`);
    } catch (e) {
      fail(e);
    }
  }

  async function remove(id) {
    if (confirmDelete !== id) {
      confirmDelete = id;
      await refresh();
      const b = list.querySelector(`[data-id="${CSS.escape(id)}"] [data-osc="studio.saved.delete"]`);
      if (b) b.focus();
      return;
    }
    confirmDelete = null;
    try {
      const lib = await svc.library();
      await lib.remove(id);
      svc.announce('Deleted the saved record');
    } catch (e) {
      fail(e);
    }
    await refresh();
    const first = list.querySelector('button') || close;
    first.focus();
  }

  // ---------------------------------------------------------------- save patch dialog
  const spDlg = dialogs.savePatch;
  const nameInput = h('input', { class: 'osc-number osc-dialog-input', id: 'osc-sp-name',
    type: 'text', maxlength: '64', autocomplete: 'off', 'data-osc': 'studio.patch.name' });
  const descInput = h('input', { class: 'osc-number osc-dialog-input', id: 'osc-sp-desc',
    type: 'text', maxlength: '200', autocomplete: 'off', 'data-osc': 'studio.patch.description' });
  const replaceBox = h('input', { type: 'checkbox', id: 'osc-sp-replace',
    'data-osc': 'studio.patch.replace' });
  const replaceRow = h('label', { class: 'osc-sp-check', for: 'osc-sp-replace', hidden: true }, [
    replaceBox, h('span', { text: ' Replace the saved patch with this name' })]);
  const spInfo = h('p', { class: 'osc-muted osc-dialog-note', 'data-osc': 'studio.patch.info' });
  const spError = h('p', { class: 'osc-pp-error', role: 'alert', hidden: true,
    'data-osc': 'studio.patch.error' });
  const exportBtn = h('button', { type: 'button', class: 'osc-btn osc-btn-secondary',
    'data-osc': 'studio.patch.export', text: 'Export file' });
  const saveBtn = h('button', { type: 'submit', class: 'osc-btn osc-btn-primary',
    'data-osc': 'studio.patch.save', text: 'Save patch' });
  const form = h('form', { method: 'dialog', class: 'osc-dialog-body' }, [
    h('h2', { class: 'osc-dialog-title', id: 'osc-dlg-studio-patch-title', text: 'Save as patch' }),
    spInfo,
    h('label', { class: 'osc-label', for: 'osc-sp-name', text: 'Name' }), nameInput,
    h('label', { class: 'osc-label', for: 'osc-sp-desc', text: 'Description (optional)' }),
    descInput, replaceRow, spError,
    h('div', { class: 'osc-dialog-actions' }, [
      h('button', { type: 'button', class: 'osc-btn osc-btn-secondary', text: 'Cancel',
        onClick: () => svc.closeModal(spDlg.id) }), exportBtn, saveBtn]),
  ]);
  replaceChildren(spDlg, form);
  spDlg.setAttribute('aria-labelledby', 'osc-dlg-studio-patch-title');
  let patchNodes = [];

  function buildPatch() {
    const name = nameInput.value.trim();
    if (!name) throw new Error('A patch needs a name.');
    return createPatch(svc.store.getModel(), patchNodes, { name,
      description: descInput.value.trim() });
  }

  function spFail(e) {
    const text = (e && e.message) || String(e);
    spError.textContent = text;
    spError.hidden = false;
    svc.announce(text, { assertive: true });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    spError.hidden = true;
    try {
      const patch = buildPatch();
      const lib = await svc.library();
      const existing = (await lib.list({ kind: 'oscilla-patch' })).map((r) => r.id);
      const id = recordId('patch', patch.name, []);
      const exists = existing.includes(id);
      if (exists && !replaceBox.checked) {
        replaceRow.hidden = false;
        throw new Error(`A patch “${patch.name}” is already saved. Tick “Replace” to overwrite `
          + 'it, or choose another name.');
      }
      await lib.savePatch(patch, { id, now: new Date(), overwrite: exists && replaceBox.checked });
      svc.announce(`Saved patch ${patch.name}${svc.persistent() ? '' : ' (this page view only)'}`);
      svc.closeModal(spDlg.id);
    } catch (err) {
      spFail(err);
    }
  });
  exportBtn.addEventListener('click', () => {
    spError.hidden = true;
    try {
      const patch = buildPatch();
      svc.downloadFile(exportPatchFile(patch));
      svc.announce(`Exported patch ${patch.name}`);
    } catch (err) {
      spFail(err);
    }
  });
  nameInput.addEventListener('input', () => {
    replaceRow.hidden = true;
    replaceBox.checked = false;
  });

  return {
    async openLibrary() {
      confirmDelete = null;
      svc.openModal(libDlg.id);
      await refresh();
      const first = list.querySelector('button') || close;
      first.focus();
    },
    openSavePatch(nodeIds) {
      const m = svc.store.getModel();
      patchNodes = nodeIds.filter((id) => m.graph.nodes.some((n) => n.id === id));
      if (!patchNodes.length) {
        svc.announce('Select the nodes to save as a patch.');
        return false;
      }
      const names = patchNodes.map((id) => m.graph.nodes.find((n) => n.id === id).metadata.name);
      nameInput.value = patchNodes.length === 1 ? names[0] : `${names[0]} chain`;
      descInput.value = '';
      replaceRow.hidden = true;
      replaceBox.checked = false;
      spError.hidden = true;
      spInfo.textContent = `${patchNodes.length} node${patchNodes.length === 1 ? '' : 's'} (${
        names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}), the connections between `
        + 'them and their automation lanes. No timeline clips.';
      svc.openModal(spDlg.id);
      setTimeout(() => nameInput.select(), 0);
      return true;
    },
    refresh,
  };
}
