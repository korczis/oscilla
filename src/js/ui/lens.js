// Sonda (the observed lens): a sheet that shows, from any workspace, what actually sounds now.
//
// Every player reaches the one master chain (engine.master -> limiter -> trim -> ceiling ->
// analyser -> destination, audio/audio-engine.js), and what sounds is already derived:
// soundingOwner(cmp) (core/output-bus.js, C069). The sheet names that owner and shows only the
// views that READ the output analyser: the waveform, the spectrum and the spectrogram of the
// digital output after the ceiling. Computed views (Harmonics, the Signal Path, a filter
// response, phase) are never offered here (rule project.no-fake-science, ADR 0063 decision 2);
// for the instrument the sheet only says where they are, and that they are computed.
//
// The sheet mounts no chart of its own: it reparents the analysis panel's one view element (its
// tabpanel, with its three chart hosts and their live instances) into its slot while open and
// puts it back when closed, so the analyser is read once per frame as before. No
// AudioNode is made (rule project.audio-engine-discipline).
//
//   lensSubject({ owner, synthArmed }) -> { id, label, idle }       pure
//   lensViews(subject)                 -> { views, marker, computedNote }  pure
//   lensMarkerShown(owner, synthArmed) -> boolean (allocation-free; the Spectrum reads it per frame)
//   createLensPart({ relayout })       -> the component part (lensOpen, lensShow, lensClose, ...)
//   bindLensKeys({ keys, cmp })        -> unbind: Escape closes an open sheet before the page's
//                                         Escape (it never also stops the sound)
// The open state is UI-only: it is no canonical state and travels in no link.

import { OWNER, soundingOwner } from '../core/output-bus.js';
import { WORKSPACE_LABELS } from './shell.js';

export const LENS_IDLE = 'Nic nehraje';
export const LENS_CAPTION = 'Pozorovaný digitální výstup po omezovači, relativní dBFS';
export const LENS_IDLE_NOTE = 'Výstup je tichý: Sonda nekreslí žádnou stopu, dokud něco nezazní.';
export const LENS_COMPUTED_NOTE = 'Harmonické a signálová cesta se počítají z nastavení '
  + 'generátoru, ne z výstupu, a proto je Sonda neukazuje; najdete je v panelu Analýza.';
/** The observed views, in the analysis panel's tab order: each reads the output analyser. */
export const LENS_VIEWS = Object.freeze(['waveform', 'spectrum', 'spectrogram']);
export const LENS_VIEW_LABELS = Object.freeze({ waveform: 'Průběh', spectrum: 'Spektrum',
  spectrogram: 'Spektrogram' });
/** The view the sheet opens on when the panel's tab is a computed one. */
export const LENS_DEFAULT_VIEW = 'spectrum';
const SYNTH = 'synth';

/**
 * The subject's Czech name per sounding owner: the workspace registry's label where the owner is
 * a workspace's player, else its own name. The reference capture keeps the output silent and is
 * never a sounding owner (soundingOwner), so it has none.
 */
const SUBJECT_LABELS = Object.freeze({
  [OWNER.measurement]: WORKSPACE_LABELS.measure,
  [OWNER.instrument]: 'Generátor',
  [OWNER.audition]: 'Ukázka riffu',
  [OWNER.sequencer]: WORKSPACE_LABELS.sequencer,
  [OWNER.studio]: WORKSPACE_LABELS.studio,
  [OWNER.notes]: 'Noty z klávesnice',
  [SYNTH]: WORKSPACE_LABELS.synth,
});

/** The owners whose requested frequency the Spectrum's marker knows (requestedFrequencyFor). */
const MARKED = new Set([OWNER.instrument, OWNER.sequencer]);

/**
 * What the sheet is about: the sounding owner, named. An armed Synth run is the Studio
 * transport's (output-bus.js: the Synth is no owner of its own), so it is named Synth while the
 * Synth panel is armed. null owner: idle, 'Nic nehraje'.
 */
export function lensSubject({ owner = null, synthArmed = false } = {}) {
  if (!owner) return Object.freeze({ id: null, label: LENS_IDLE, text: LENS_IDLE, idle: true });
  const id = owner === OWNER.studio && synthArmed ? SYNTH : owner;
  const label = SUBJECT_LABELS[id] || 'Neurčený zdroj';
  return Object.freeze({ id, label, text: `Zní: ${label}`, idle: false });
}

/** The labels the sheet knows, per subject id (for the tests: every sounding owner has one). */
export const LENS_SUBJECT_LABELS = SUBJECT_LABELS;

/**
 * What the sheet offers for a subject: the observed views (none while idle: no trace is
 * claimed of silence), whether the Spectrum may mark a requested frequency, and the one note
 * about computed views (the instrument's only).
 */
export function lensViews(subject) {
  const s = subject || lensSubject();
  if (s.idle) return Object.freeze({ views: Object.freeze([]), marker: false, computedNote: null });
  return Object.freeze({ views: LENS_VIEWS, marker: MARKED.has(s.id),
    computedNote: s.id === OWNER.instrument ? LENS_COMPUTED_NOTE : null });
}

/** lensViews(lensSubject(...)).marker without allocating (read every frame). */
export function lensMarkerShown(owner) {
  return MARKED.has(owner);
}

/** The view the sheet shows for the panel's tab: the tab when observed, else the default. */
export function lensViewFor(tab) {
  return LENS_VIEWS.includes(tab) ? tab : LENS_DEFAULT_VIEW;
}

/** The analysis panel's view: its tabpanel, found in the panel before the first move. */
const VIEW_SELECTOR = '#osc-panel-analysis [role="tabpanel"]';
const SLOT_ID = 'osc-lens-slot';
const TOGGLE_ID = 'osc-lens-toggle';
const CLOSE_ID = 'osc-lens-close';
/** The status bar's Akce button: on a phone the Sonda button waits in its menu. */
const MENU_ID = 'osc-sb-actions-toggle';
let moved = null; // { view, home }: the view in the slot and the comment holding its place

/**
 * Move the analysis view into the sheet's slot (home: a comment left where it stood) or back.
 * Returns whether it moved. A move inside one document keeps the chart instances and Alpine's
 * bindings (Alpine skips a node removed and added in the same mutation batch).
 */
export function reparentView(doc, into) {
  const slot = doc.getElementById(SLOT_ID);
  if (!slot) return false;
  if (into) {
    const view = moved ? null : doc.querySelector(VIEW_SELECTOR);
    if (!view) return false;
    const home = doc.createComment('lens-home');
    view.parentNode.insertBefore(home, view);
    slot.appendChild(view);
    moved = { view, home };
    return true;
  }
  if (!moved || moved.view.parentNode !== slot || !moved.home.parentNode) return false;
  moved.home.parentNode.replaceChild(moved.view, moved.home);
  moved = null;
  return true;
}

/** The Pro button group's classes of view `v` at index `i` (the pressed one primary). */
export function lensViewClass(v, i, current, n = LENS_VIEWS.length) {
  return [i === 0 ? 'rounded-s-lg' : '-ms-px', i === n - 1 ? 'rounded-e-lg' : '',
    v === current ? 'bg-primary-700 text-white border-primary-700 dark:border-primary-700'
      : 'bg-white text-gray-900 hover:bg-gray-100 dark:bg-gray-800 dark:text-white '
        + 'dark:hover:bg-gray-700'].filter(Boolean).join(' ');
}

/** The component part: the sheet's UI-only state and its actions. */
export function createLensPart({ relayout = () => {} } = {}) {
  return {
    lensOpen: false,
    lensText: Object.freeze({ caption: LENS_CAPTION, idleNote: LENS_IDLE_NOTE }),
    lensViewLabel: (v) => LENS_VIEW_LABELS[v] || v,
    lensViewClass(v, i) { return lensViewClass(v, i, this.lensView); },
    get lensSubject() {
      return lensSubject({ owner: soundingOwner(this),
        synthArmed: !!(this.synth && this.synth.armed) });
    },
    get lensViews() { return lensViews(this.lensSubject); },
    get lensView() { return lensViewFor(this.tabs && this.tabs.analysis); },
    lensToggle() {
      if (this.lensOpen) this.lensClose();
      else this.lensShow();
    },
    lensShow() {
      if (this.lensOpen) return;
      // A computed tab (Harmonics, the Signal Path) is not shown here: the observed default.
      if (this.tabs && this.tabs.analysis !== this.lensView) this.setTab('analysis', this.lensView);
      reparentView(document, true);
      if (typeof this.closeMenus === 'function') this.closeMenus(); // the phone's Akce menu
      this.lensOpen = true;
      this.$nextTick(() => {
        relayout();
        const close = document.getElementById(CLOSE_ID);
        if (close) close.focus();
      });
    },
    lensSelect(view) {
      if (LENS_VIEWS.includes(view)) this.setTab('analysis', view);
    },
    /**
     * Close; focus returns to the status bar's Sonda button (on a phone, where it waits in the
     * closed Akce menu, to the Akce button) unless `focus` is false.
     */
    lensClose({ focus = true } = {}) {
      if (!this.lensOpen) return;
      this.lensOpen = false;
      reparentView(document, false);
      this.$nextTick(() => {
        relayout();
        if (!focus) return;
        // The Sonda button, or the Akce button whose closed menu holds it on a phone.
        const toggle = document.getElementById(TOGGLE_ID);
        const shown = toggle && (!toggle.getClientRects || toggle.getClientRects().length > 0);
        const target = shown ? toggle : document.getElementById(MENU_ID);
        if (target) target.focus();
      });
    },
    /**
     * Escape with the sheet open closes it, gives focus back to the Sonda button and consumes
     * the key, as the header menus' menuEscape does (ui/app.js): the page's Escape (stopAll)
     * never runs with it, so the sound plays on. Closed, the key passes untouched. Returns
     * true when the key was consumed.
     */
    lensEscape(e) {
      if (!this.lensOpen || !e || e.key !== 'Escape') return false;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      this.lensClose();
      return true;
    },
    /** The panel chose a computed tab while the view was here: the panel takes it back. */
    lensFollowTab(tab) {
      if (this.lensOpen && !LENS_VIEWS.includes(tab)) this.lensClose({ focus: false });
    },
  };
}

/**
 * Escape closes an open sheet first. Bound in every workspace for each focus but a modal
 * dialog's, more specific than the page's Escape (workspace '*', focus '*'), so the registry
 * gives it the key while the sheet is open, and the page's stop never runs with it.
 */
export function bindLensKeys({ keys, cmp }) {
  const offs = ['none', 'text', 'piano'].map((focus) => keys.bind({
    id: `lens.escape.${focus}`, keys: ['Escape'], scope: { workspace: '*', focus },
    group: 'Page', label: 'Zavřít Sondu (zvuk hraje dál)',
    when: () => !!cmp.lensOpen, run: (e) => cmp.lensEscape(e) }));
  return () => offs.forEach((off) => off());
}
