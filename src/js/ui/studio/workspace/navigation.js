// STUDIO workspace (src/js/ui/studio/workspace.js), navigation: the subviews, Expand and Back,
// the deep link and browser fullscreen.
//
// Deep link (§199-§200; plan V422): `#m=studio[&st=<template id>][&sv=<subview>]`
// (core/url-state-studio.js). A link read at load or as a new hash reaches studioApplyLinkHash
// through the one hash dispatcher (ui/navigation.js, which also opens the workspace: Studio keys
// take precedence, ADR 0045); it is validated like an import and refused whole with a readable
// message; it opens the subview and a shipped template, never starts playback, and never replaces a
// document with unsaved changes (the Templates dialog and its "unsaved changes" note open
// instead, the usual explicit Open). Copy link writes the current view: the template id only
// while the document is that template unmodified, otherwise the workspace and subview alone.
//
// Browser fullscreen (§133-§135; plan V422): an optional FULLSCREEN command on the workspace
// element (#osc-view-studio), feature-detected (fullscreenSupport); the maximized workspace never
// depends on it. While fullscreen, Escape belongs to the browser (it exits fullscreen); leaving
// the Studio workspace exits it too.

import { getTemplate, templateModel } from '../../../studio/templates/index.js';
import { decodeStudioLink, encodeStudioLink } from '../../../core/url-state-studio.js';
import { openModal } from '../../dialogs.js';
import { studioBackTarget, workspacePhrase } from '../../cross-links.js';
import { WORKSPACE_LABELS } from '../../shortcuts.js';

export const STUDIO_SUBVIEWS = Object.freeze(['graph', 'timeline', 'inspector']);
/** Why browser fullscreen is not offered (the button stays, aria-disabled, with this reason). */
export const FULLSCREEN_UNSUPPORTED = 'This browser does not offer fullscreen for part of a page '
  + '(Safari on iPhone, for example). Studio already fills the window.';
export const FULLSCREEN_BLOCKED = 'Fullscreen is turned off here (an embedding page or a browser '
  + 'setting). Studio already fills the window.';

/**
 * Whether a deferred focus (Expand's, the frame after its switch) must leave focus alone: the
 * user moved it to `active`, a connected element that is neither `body` nor `from`, the element
 * focused when the deferral began (#417 webkit, P8). Pure: elements in, a boolean out.
 */
export function focusMovedSince(active, from, body) {
  return !!(active && active !== body && active !== from && active.isConnected);
}

/**
 * Whether `el` can go fullscreen in `doc` (standard or WebKit-prefixed API): { available,
 * reason } — reason is '' when available.
 */
export function fullscreenSupport(doc, el) {
  const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!doc || typeof req !== 'function') {
    return { available: false, reason: FULLSCREEN_UNSUPPORTED };
  }
  const enabled = doc.fullscreenEnabled !== undefined ? doc.fullscreenEnabled
    : doc.webkitFullscreenEnabled;
  if (enabled === false) return { available: false, reason: FULLSCREEN_BLOCKED };
  return { available: true, reason: '' };
}

/** The element shown fullscreen in `doc`, or null. */
export function fullscreenElementOf(doc) {
  return (doc && (doc.fullscreenElement || doc.webkitFullscreenElement)) || null;
}

/**
 * The view a Studio link writes (plain data): the template id only while the document is that
 * shipped template unmodified (`templateUnmodified`), else null; the subview always.
 * { templateId, templateTitle, subview, hash, note }.
 */
export function studioLinkView({ templateId = null, templateUnmodified = false,
  subview = 'graph', title = '' } = {}) {
  const t = templateId && templateUnmodified ? getTemplate(templateId) : null;
  const sv = STUDIO_SUBVIEWS.includes(subview) ? subview : 'graph';
  const hash = encodeStudioLink({ templateId: t ? t.id : null, subview: sv });
  const view = sv.charAt(0).toUpperCase() + sv.slice(1);
  const doc = title ? `“${title}”` : 'this document';
  const note = t ? `The link opens Studio with the template ${t.title} in the ${view} view. `
    + 'Nothing plays until Play.'
    : `The link opens the Studio workspace in the ${view} view only: ${doc} is not an `
      + 'unmodified template, so it is not in the link. Save it or export a project file to '
      + 'share it.';
  return { templateId: t ? t.id : null, templateTitle: t ? t.title : '', subview: sv, hash, note };
}

/**
 * The navigation functions over `ctx` (`ops` holds those of the other parts), and their
 * members of the component. -> { ops, part }
 */
export function createWorkspaceNavigation(ctx, svc, ops) {
  /** Leave browser fullscreen when the Studio workspace is what is fullscreen. */
  async function exitFullscreen() {
    const el = fullscreenElementOf(document);
    if (!el || el !== ops.viewEl()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      if (exit) await exit.call(document);
    } catch (e) { /* already left */ }
  }

  const part = {
    studioSetSubview(v) {
      if (!STUDIO_SUBVIEWS.includes(v)) return;
      this.studio.subview = v;
      if (v === 'graph' && ctx.editor) requestAnimationFrame(() => ctx.editor.onShow());
    },

    studioSubview(v) {
      return {
        ':class'() { return { 'is-active': this.studio.subview === v }; },
        ':aria-selected'() { return String(this.studio.subview === v); },
        ':tabindex'() { return this.studio.subview === v ? 0 : -1; },
        '@click'() { this.studioSetSubview(v); },
        '@keydown'(e) {
          const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const i = STUDIO_SUBVIEWS.indexOf(this.studio.subview);
          let n = i;
          if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = STUDIO_SUBVIEWS.length - 1;
          else n = (i + (e.key === 'ArrowRight' ? 1 : -1) + STUDIO_SUBVIEWS.length)
            % STUDIO_SUBVIEWS.length;
          this.studioSetSubview(STUDIO_SUBVIEWS[n]);
          this.$nextTick(() => {
            const el = document.querySelector(`[data-osc="studio.subview"][data-value="${
              STUDIO_SUBVIEWS[n]}"]`);
            if (el) el.focus();
          });
        },
      };
    },

    /** EXPAND STUDIO (§130): the full workspace on the identical state. */
    studioExpand(nodeId = null) {
      // Focus where Expand was activated: the deferred focus below goes to the graph only while
      // focus is still there (or lost to <body>). A control the user moved to before that frame
      // (a fast Tab to Back, a screen reader's jump) keeps it (#417 webkit, P8).
      const from = document.activeElement;
      this.setWorkspace('studio');
      if (nodeId) {
        ctx.handle.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: [nodeId] } });
      }
      requestAnimationFrame(() => {
        if (!ctx.editor) return;
        ctx.editor.onShow();
        if (nodeId) ctx.editor.frameSelection();
        if (focusMovedSince(document.activeElement, from, document.body)) return;
        if (nodeId) ctx.editor.focusNode(nodeId);
        else ctx.editor.focusViewport();
      });
    },

    /** "Back to the Sequencer": the Studio's Back button's name; its label is the workspace's. */
    studioBackText() {
      return `Back to ${workspacePhrase(studioBackTarget(this.studio.backTo))}`;
    },
    studioBackLabel() {
      return WORKSPACE_LABELS[studioBackTarget(this.studio.backTo)];
    },

    studioBack() {
      this.setWorkspace(studioBackTarget(this.studio.backTo));
      // The button that had focus is now hidden: focus the compact Studio's Expand (the way
      // back) where it is shown, else the workspace's tab, never <body> (WCAG 2.4.3; V431 U6).
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.getClientRects().length) return;
        const to = [document.querySelector('[data-osc="studio.compact.expand"]'),
          document.querySelector('.osc-nav .osc-tab.is-active')]
          .find((el) => el && el.getClientRects().length);
        if (to) to.focus({ preventScroll: true });
      });
    },

    // ------------------------------------------------------------ deep link (V422, §199)
    /** The view a Studio link carries now (studioLinkView). */
    studioLinkView() {
      const model = ctx.handle.getModel();
      return studioLinkView({ templateId: ctx.templateId,
        templateUnmodified: !!(ctx.templateBaseline && !ctx.templateBaseline.isDirty(model)),
        subview: this.studio.subview, title: model.metadata.title });
    },

    /** This page's URL with the Studio view as its whole hash. */
    studioLinkUrl() {
      const loc = typeof window !== 'undefined' ? window.location : null;
      return loc ? `${loc.href.split('#')[0]}#${this.studioLinkView().hash}` : null;
    },

    /** Copy link: the address bar and the clipboard (a dialog when there is no clipboard). */
    async studioCopyLink() {
      const view = this.studioLinkView();
      const url = this.studioLinkUrl();
      if (!url) return null;
      try {
        window.history.replaceState(window.history.state, '', url);
      } catch (e) { /* file:// in some */ }
      this.studio.link = url;
      this.studio.linkNote = view.note;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext !== false) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch (e) {
        copied = false;
      }
      if (copied) {
        ops.announce(`Link copied. ${view.note}`);
        this.notify('success', 'Studio link copied', view.note);
      } else openModal('osc-dlg-studio-link');
      return { url, copied, ...view };
    },

    /**
     * Apply a Studio link from a location hash (§199): validated like an import, refused whole
     * with a message when invalid, never starts playback, never replaces unsaved changes.
     * Returns true (applied, perhaps waiting for an explicit Open), false (refused) or null (no
     * Studio link in the hash). The hash dispatcher (ui/navigation.js) opens the workspace
     * unless this refuses.
     */
    studioApplyLinkHash(hash) {
      const r = decodeStudioLink(hash);
      if (r === null) return null;
      if (!r.ok) {
        const why = r.errors.slice(0, 3).join('; ');
        this.notify('warning', 'Studio link not applied', `${why}. Nothing was changed.`);
        ops.announce(`Studio link not applied: ${why}`, { assertive: true });
        return false;
      }
      if (r.subview) this.studioSetSubview(r.subview);
      const view = r.subview ? `${r.subview.charAt(0).toUpperCase()}${r.subview.slice(1)} view`
        : 'Studio';
      if (!r.templateId) {
        this.notify('info', 'Studio opened from the link', `${view}. Nothing plays until you press `
          + 'Play.');
        return true;
      }
      const model = ctx.handle.getModel();
      const t = getTemplate(r.templateId);
      const already = ctx.templateId === r.templateId && ctx.templateBaseline
        && !ctx.templateBaseline.isDirty(model);
      if (already) {
        this.notify('info', 'Studio opened from the link', `${t.title} is already open (${view}). `
          + 'Nothing plays until you press Play.');
        return true;
      }
      if (ctx.dirty && ctx.dirty.isDirty(model)) {
        // No silent overwrite: the Templates dialog says what would be lost; Open is explicit.
        this.studio.linkPending = t.title;
        openModal('osc-dlg-studio-templates');
        this.notify('warning', 'Studio link waits for you', `The link opens the template `
          + `${t.title}, but this Studio has unsaved changes. Choose Open on ${t.title} to replace `
          + 'it, or save or export first.');
        ops.announce(`The link opens ${t.title}; this Studio has unsaved changes, so it was not `
          + 'replaced.', { assertive: true });
        return true;
      }
      ops.openDocument(templateModel(r.templateId), { reason: 'link', templateId: r.templateId });
      this.notify('info', 'Studio opened from the link', `Template ${t.title}, ${view}. Nothing `
        + 'plays until you press Play.');
      ops.announce(`Opened template ${t.title} from the link`);
      return true;
    },

    // ------------------------------------------------------------ fullscreen (V422, §134)
    /** Browser fullscreen on the workspace element, or out of it. Resolves the new state. */
    async studioToggleFullscreen() {
      const view = ops.viewEl();
      const fs = fullscreenSupport(document, view);
      if (!fs.available) {
        ops.announce(fs.reason, { assertive: true });
        this.notify('info', 'Fullscreen not available', fs.reason);
        return false;
      }
      if (fullscreenElementOf(document) === view) {
        await exitFullscreen();
        return false;
      }
      try {
        const req = view.requestFullscreen || view.webkitRequestFullscreen;
        await req.call(view);
        return true;
      } catch (e) {
        const msg = `Fullscreen was refused by the browser${e && e.message ? `: ${e.message}`
          : ''}. Studio stays in the window.`;
        ops.announce(msg, { assertive: true });
        this.notify('info', 'Fullscreen not available', msg);
        return false;
      }
    },
  };
  return { ops: { exitFullscreen }, part };
}
