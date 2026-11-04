// STUDIO workspace (src/js/ui/studio/workspace.js), the Playground voice opened in the Studio
// (plan V605; intent studio-completion, voice-opens-in-studio).
//
// The Signal Path's "Open in Studio" (src/index.html, data-osc="analysis.openInStudio") builds
// the document from the Playground's own state (svc.playgroundVoice: what the Signal Path draws
// from, main.js) through src/js/studio/playground-voice-open.js, and opens it as a new, unsaved
// document: a copy, so the Playground keeps its voice and the Studio's unsaved-work guard
// (studioWhatWouldBeLost, ui/unsaved.js) covers the copy until it is saved or exported. One
// action: the workspace switches to Studio with focus on its heading; Back returns to the
// workspace it came from (navigation.js studioBack). Nothing plays until Play.
//
// A configuration the Studio cannot sound the same is refused with its reason, shown and
// announced (a warning notice, role=alert), and nothing changes. Unsaved Studio work is never
// replaced silently: a modal (Flowbite Pro's pop-up modal, built here on first use) names what
// would be lost and asks; Keep leaves everything as it was, Replace opens the copy.

import { playgroundVoiceDocument } from '../../../studio/playground-voice-open.js';
import { openModal, closeModal, watchDialogs } from '../../dialogs.js';

export const VOICE_DIALOG_ID = 'studio-voice-guard';

const BTN = 'rounded-lg px-5 py-2.5 text-center text-sm font-medium focus:outline-none '
  + 'focus:ring-4 [@media(pointer:coarse)]:min-h-11';

/**
 * The guard dialog, built once (Flowbite Pro pop-up modal markup on a native <dialog>); its
 * buttons call on.replace() and on.keep(), closing ends the question (on.close()).
 */
function guardDialog(on) {
  let dlg = document.getElementById(VOICE_DIALOG_ID);
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = VOICE_DIALOG_ID;
  dlg.setAttribute('data-oscilla-modal', '');
  dlg.setAttribute('aria-labelledby', `${VOICE_DIALOG_ID}-title`);
  dlg.setAttribute('aria-describedby', `${VOICE_DIALOG_ID}-text`);
  dlg.className = 'w-full max-w-md rounded-lg border-0 bg-white p-0 shadow-sm '
    + 'backdrop:bg-gray-900/50 dark:bg-gray-700';
  const box = document.createElement('div');
  box.className = 'p-4 text-center md:p-5';
  const title = document.createElement('h2');
  title.id = `${VOICE_DIALOG_ID}-title`;
  title.className = 'mb-3 text-lg font-semibold text-gray-900 dark:text-white';
  title.textContent = 'Replace the unsaved Studio work?';
  const text = document.createElement('p');
  text.id = `${VOICE_DIALOG_ID}-text`;
  text.className = 'mb-2 text-sm text-gray-500 dark:text-gray-400';
  text.textContent = 'The Playground voice opens as a new Studio document and replaces the one '
    + 'open now. This would be lost:';
  const list = document.createElement('ul');
  list.dataset.osc = 'studio.voice.lost';
  list.className = 'mb-5 list-inside list-disc text-sm text-gray-900 dark:text-white';
  const replace = document.createElement('button');
  replace.type = 'button';
  replace.dataset.osc = 'studio.voice.replace';
  replace.className = `${BTN} bg-red-600 text-white hover:bg-red-800 focus:ring-red-300 `
    + 'dark:focus:ring-red-800';
  replace.textContent = 'Replace it';
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.dataset.osc = 'studio.voice.keep';
  keep.autofocus = true;
  keep.className = `${BTN} me-3 border border-solid border-gray-200 bg-white text-gray-900 `
    + 'hover:bg-gray-100 hover:text-primary-700 focus:ring-gray-100 dark:border-gray-600 '
    + 'dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white '
    + 'dark:focus:ring-gray-700';
  keep.textContent = 'Keep the Studio work';
  replace.addEventListener('click', () => on.replace());
  keep.addEventListener('click', () => on.keep());
  // A close event is queued: one that arrives after the dialog opened again ends nothing.
  dlg.addEventListener('close', () => { if (!dlg.open) on.close(); });
  box.append(title, text, list, keep, replace); // Keep first: the focused, safe answer
  dlg.append(box);
  const host = document.createElement('div');
  host.append(dlg);
  document.body.append(host);
  watchDialogs(host);
  return dlg;
}

/**
 * The voice functions over `ctx` (`ops` holds those of the other parts), and their members of
 * the component. -> { ops, part }
 */
export function createWorkspaceVoice(ctx, svc, ops) {
  let pending = null; // { cmp, model }: the document the guard dialog asks about
  const answers = {
    replace() {
      const p = pending;
      pending = null;
      closeModal(VOICE_DIALOG_ID);
      if (p) openCopy(p.cmp, p.model);
    },
    keep() {
      pending = null;
      closeModal(VOICE_DIALOG_ID);
      ops.announce('The Studio work was kept; the voice was not opened.');
    },
    close() { pending = null; },
  };

  /** Open `model` as the new, unsaved Studio document and go there. */
  function openCopy(cmp, model) {
    ops.openDocument(model, { reason: 'import' });
    ctx.dirty.markUnsaved(); // a copy that exists nowhere else until it is saved or exported
    ops.refreshState();
    cmp.setWorkspace('studio', { focusHeading: true });
    const n = model.graph.nodes.length;
    const c = model.timeline.clips.length;
    const what = `${n} nodes${c ? `, ${c} gate clip${c === 1 ? '' : 's'}` : ''}`;
    cmp.notify('info', 'Playground voice opened in Studio', `${what}: an unsaved copy, the `
      + 'Playground keeps its own. Nothing plays until you press Play.');
    ops.announce(`Opened the Playground voice in Studio: ${what}, unsaved`);
    return { ok: true, nodes: n, clips: c };
  }

  const part = {
    /** "Open in Studio" on the Signal Path (see the header). -> { ok, ... } */
    studioOpenVoice() {
      const input = typeof svc.playgroundVoice === 'function' ? svc.playgroundVoice() : null;
      const r = playgroundVoiceDocument(input || {});
      if (!r.ok) {
        this.notify('warning', 'Voice not opened in Studio', `${r.reason} Nothing was changed.`);
        return { ok: false, code: r.code, reason: r.reason };
      }
      if (ctx.dirty && ctx.dirty.isDirty(ctx.handle.getModel())) {
        const dlg = guardDialog(answers);
        pending = { cmp: this, model: r.model };
        const list = dlg.querySelector('[data-osc="studio.voice.lost"]');
        list.replaceChildren(...this.studioWhatWouldBeLost().slice(0, 1).map((x) => {
          const li = document.createElement('li');
          li.textContent = x.label;
          return li;
        }));
        openModal(VOICE_DIALOG_ID);
        return { ok: false, code: 'unsaved', asking: true };
      }
      return openCopy(this, r.model);
    },
  };
  return { ops: {}, part };
}
