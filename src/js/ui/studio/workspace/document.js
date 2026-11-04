// STUDIO workspace (src/js/ui/studio/workspace.js), document and session: what the workspace
// says (the live regions, inside a modal dialog too), the document behind the store handle
// (open, a deleted record detached, the view state), undo and redo with focus kept, the
// templates, and what a reload would lose.

import { createDirtyTracker } from '../../../studio/library.js';
import { announceRedo, announceUndo } from '../../../studio/a11y.js';
import { templateModel } from '../../../studio/templates/index.js';
import { openModal, closeModal } from '../../dialogs.js';

/** The key of studioWhatWouldBeLost's unsaved-changes entry (the voice guard selects it). */
export const UNSAVED_CHANGES_KEY = 'unsaved-changes';
/** That entry's label for a document titled `title`. */
export const unsavedChangesLabel = (title) => `Unsaved changes to ${
  title || 'the Studio document'}`;

/** First keyboard-reachable control inside a pane. */
const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + '[tabindex="0"]';

/** The timeline or Inspector pane that holds focus, else null (studioKeepFocus). */
function focusedPane() {
  const a = document.activeElement;
  return a && a.closest ? a.closest('.osc-st-timeline, .osc-st-inspector') : null;
}

/** True when `d` is an open modal <dialog> (showModal; the page outside it is inert). */
function isModal(d) {
  try {
    return d.matches(':modal');
  } catch (e) {
    return d.getAttribute('aria-modal') === 'true'; // a browser without :modal
  }
}

/** The modal dialog announcements must be said in: the one holding focus, else the last. */
function topModalDialog() {
  const open = [...document.querySelectorAll('dialog[open]')].filter(isModal);
  if (!open.length) return null;
  const a = document.activeElement;
  return open.find((d) => d.contains(a)) || open[open.length - 1];
}

/**
 * The polite and assertive live regions inside `dlg` (V272 C4): made once per dialog, kept
 * while its content is rebuilt elsewhere. -> { live, alert, made }
 */
export function dialogRegions(dlg) {
  let live = dlg.querySelector(':scope > [data-osc="studio.dlg.live"]');
  let alert = dlg.querySelector(':scope > [data-osc="studio.dlg.alert"]');
  const made = !live || !alert;
  if (!live) {
    live = document.createElement('p');
    live.className = 'osc-sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.dataset.osc = 'studio.dlg.live';
    dlg.append(live);
  }
  if (!alert) {
    alert = document.createElement('p');
    alert.className = 'osc-sr-only';
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-atomic', 'true');
    alert.dataset.osc = 'studio.dlg.alert';
    dlg.append(alert);
  }
  return { live, alert, made };
}

/** Say `text` in `dlg`; a region made just now is filled a moment later, so it is heard. */
function sayInDialog(dlg, text, assertive) {
  const r = dialogRegions(dlg);
  const el = assertive ? r.alert : r.live;
  if (r.made) setTimeout(() => { el.textContent = text; }, 30);
  else el.textContent = text;
}

/**
 * The document and session functions over `ctx` (`ops` holds those of the other parts), and
 * their members of the component. -> { ops, part }
 */
export function createWorkspaceDocument(ctx, svc, ops) {
  const { registry } = ctx;

  function announce(text, { assertive = false } = {}) {
    if (!text || !ctx.cmp) return;
    const s = ctx.cmp.studio;
    // Repeating the same sentence must be announced again: alternate an invisible suffix.
    let said;
    if (assertive) {
      ctx.alertToggle = !ctx.alertToggle;
      said = `${text}${ctx.alertToggle ? '​' : ''}`;
      s.alert = said;
    } else {
      ctx.liveToggle = !ctx.liveToggle;
      said = `${text}${ctx.liveToggle ? '​' : ''}`;
      s.live = said;
    }
    // An open modal dialog makes the rest of the page inert, the regions above included: the
    // sentence is said inside the top-most one too (V272 C4, WCAG status messages).
    const dlg = topModalDialog();
    if (dlg) sayInDialog(dlg, said, assertive);
  }

  function refreshState() {
    const cmp = ctx.cmp;
    const h = ctx.handle;
    if (!cmp || !h) return;
    const model = h.getModel();
    const s = cmp.studio;
    const set = (k, v) => { if (s[k] !== v) s[k] = v; };
    set('title', model.metadata.title);
    set('dirty', ctx.dirty ? ctx.dirty.isDirty(model) : false);
    set('canUndo', h.canUndo());
    set('canRedo', h.canRedo());
    set('undoLabel', h.undoLabel() || '');
    set('redoLabel', h.redoLabel() || '');
    set('loop', !!model.timeline.loop.enabled);
    set('counts', `${model.graph.nodes.length} nodes · ${model.graph.edges.length} connections`);
  }

  function limitSignature(model) {
    return model.graph.nodes.filter((n) => {
      const d = registry.get(n.type);
      return d && d.maxInstances != null;
    }).map((n) => n.type).sort().join(',');
  }

  function onStoreChange(ev) {
    if (!ctx.mounted) return;
    if (ev.type === 'view') return; // the editor applied its own view already
    const model = ctx.handle.getModel();
    if (ev.type === 'model') {
      if (ctx.transport) ctx.transport.sync();
      ops.recompile(model); // after sync: the status shows what the runtime now runs
      const sig = limitSignature(model);
      if (sig !== ctx.limitSig && ctx.library) {
        ctx.limitSig = sig;
        ctx.library.render();
      }
    }
    if (ctx.editor) ctx.editor.render();
    if (ctx.inspector) ctx.inspector.render();
    if (ctx.compact) ctx.compact.render();
    refreshState();
  }

  // ---------------------------------------------------------------- documents
  function openDocument(model, { reason, projectId = null, templateId = null } = {}) {
    if (ctx.transport && ctx.transport.playing) ops.stopStudio({ fast: true });
    ctx.handle.replace(model, reason);
    if (ctx.cmp) ctx.cmp.studio.warning = '';
    ctx.dirty = createDirtyTracker(ctx.handle.getModel());
    ctx.projectId = projectId;
    ctx.templateId = templateId;
    ctx.templateBaseline = templateId ? createDirtyTracker(ctx.handle.getModel()) : null;
    if (ctx.editor) requestAnimationFrame(() => ctx.editor.frameAll());
    refreshState();
  }

  /**
   * A saved record was deleted. When it is the open project, the document is detached: no
   * project id, and unsaved (dirty) since no saved copy is left, so a template, a link or an
   * open asks before replacing it. -> the announcement, or null for another record.
   */
  function detachDeleted(id) {
    if (!id || id !== ctx.projectId) return null;
    ctx.projectId = null;
    if (ctx.dirty) ctx.dirty.markUnsaved();
    refreshState();
    return 'The open project was deleted from this browser; the graph is still open, unsaved.';
  }

  const part = {
    studioUndo() {
      if (ctx.editor) ctx.editor.endNudge();
      const pane = focusedPane();
      const r = ctx.handle.undo();
      announce(announceUndo(r));
      this.studioKeepFocus(pane);
    },

    studioRedo() {
      const pane = focusedPane();
      const r = ctx.handle.redo();
      announce(announceRedo(r));
      this.studioKeepFocus(pane);
    },

    /**
     * Never leave focus on <body> (§142; V431 U3, U4): undo / redo may remove the focused node,
     * clip or point, and the toolbar Undo / Redo button disables itself under focus. After the
     * render, a lost focus goes to the first control of the timeline or Inspector pane that
     * held it (when shown), else the graph canvas when shown, else the active subview tab.
     */
    studioKeepFocus(pane = null) {
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (this.workspace !== 'studio' || (a && a !== document.body && a.isConnected
          && !a.disabled)) return;
        const first = pane && pane.isConnected && pane.getClientRects().length
          ? pane.querySelector(TABBABLE) : null;
        if (first) {
          first.focus({ preventScroll: true });
          return;
        }
        const vp = document.querySelector('[data-osc="studio.graph.viewport"]');
        if (ctx.editor && vp && vp.getClientRects().length) {
          ctx.editor.focusViewport();
          return;
        }
        const tab = document.querySelector(`[data-osc="studio.subview"][data-value="${
          this.studio.subview}"]`);
        if (tab && tab.getClientRects().length) tab.focus({ preventScroll: true });
      });
    },

    studioOpenTemplates() {
      this.studio.linkPending = '';
      openModal('osc-dlg-studio-templates');
    },

    studioLoadTemplate(id) {
      let model;
      try {
        model = templateModel(id);
      } catch (e) {
        announce(e.message, { assertive: true });
        return false;
      }
      closeModal('osc-dlg-studio-templates');
      this.studio.linkPending = '';
      openDocument(model, { reason: 'template', templateId: id });
      announce(`Opened template ${model.metadata.title}`);
      return true;
    },

    /**
     * What a reload or a closed tab would lose here (ui/unsaved.js): unsaved changes, and the
     * projects and patches a memory-only library holds (no IndexedDB here).
     */
    studioWhatWouldBeLost() {
      const lost = [];
      if (this.studio.dirty) {
        lost.push({ domain: 'studio', key: UNSAVED_CHANGES_KEY,
          label: unsavedChangesLabel(this.studio.title) });
      }
      const n = this.studio.memoryHeld;
      if (!this.studio.persistent && n > 0) {
        lost.push({ domain: 'studio', key: 'memory-only',
          label: `${n} Studio project${n === 1 ? '' : 's'} or `
            + `patch${n === 1 ? '' : 'es'} kept in page memory only` });
      }
      return lost;
    },
  };
  return { ops: { announce, refreshState, limitSignature, onStoreChange, openDocument,
    detachDeleted }, part };
}
