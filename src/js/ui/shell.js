// The Flowbite Pro admin shell (issue F002, ADR 0061): the ONE workspace registry the whole
// navigation is derived from, and the shell's own Alpine part: the sidebar (collapsible to
// icons on desktop, expanding while hovered or focused), the phone drawer behind the hamburger
// with its backdrop, the collapsible groups and the workspace search. Composed into the ONE
// component by app.js (createOscillaUi), like ui/navigation.js. The markup is adapted from the
// Pro admin dashboard's navbar and sidebar (the flowbite-pro reference, sections 2 to 5); the
// dashboard's own sidebar.js is Pro source and stays out: everything here is OSCILLA's code.
//
// Hacking the navigation: a workspace is one row of WORKSPACE_REGISTRY (id, label, icon, group,
// words) and, for its icon, one <symbol id="i-ws-<id>"> of the sprite in src/index.html. The
// order, the groups, the sidebar, the search, the URL route ids (ui/navigation.js), the
// shortcut dialog's names (ui/shortcuts.js), About's workspace list, the page header and the
// README's navigation paragraph all follow from it; there is no second list.
//
// The page fields of a row (lane A wave 3, the API agreed with lane D; all optional, data only):
//   summary  one sentence: what the workspace is for (the page header, About's list).
//   related  [{ id, why, hash? }], at most three: the workspaces it leads on to, in order. id is
//            a registry id, why one short reason, hash an optional route suffix of the target's
//            address (`&st=<template>`): the link is `#m=<id><hash>`, which routeOfHash
//            (ui/navigation.js) must send to <id>. The page header's Related strip renders
//            them; the counterpart and Studio template links written in the panels
//            (ui/counterparts.js PANEL_LINKS) are generated from them.
//   enter    { '<control data-osc>': '<value>' }: applied when the workspace is entered, by
//            the control itself (its own click, or its own change event; ui/app.js applyEnter),
//            never by writing state.
//   phone    { primary: '<panel data-osc-panel>' }: the own panel a phone shows first.
//   empty    { when, title, body, action: { label, to } }: the page's empty state, shown while
//            the predicate `when` (registered by its adapter, ui/empty-states.js) is true;
//            action.to is a registry id.
//
// ui-family: app-shell model

import { roving } from './keys/roving.js';

/** The workspaces, in navigation order. group: the sidebar group holding it, or none. */
export const WORKSPACE_REGISTRY = Object.freeze([
  { id: 'playground', label: 'Playground', words: 'instrument tone oscillator play hold',
    summary: 'The instrument on one screen: generator, waveform, spectrum, spectrogram, '
      + 'microphone analyzer, pattern sequencer and the labs.',
    related: [
      { id: 'measure', why: 'Measure the speaker, room and microphone the tone plays through' },
      { id: 'synth', why: 'A voice with filters, envelopes and keys' },
      { id: 'learn', why: 'Concept cards whose demos play here' },
    ] },
  { id: 'measure', label: 'Measure', words: 'frequency response sweep impulse room test',
    summary: 'A guided measurement of the speaker, room and microphone chain: frequency '
      + 'response, impulse response and RTA, each run rated for quality.',
    related: [
      { id: 'experiments', why: 'Keep a run as an experiment and compare it with others' },
      { id: 'studio', why: 'The measurement sweep as a Studio document',
        hash: '&st=measurement-sweep' },
      { id: 'learn', why: 'Logarithmic scales and speaker limits explained' },
    ] },
  { id: 'experiments', label: 'Experiments', words: 'saved records findings compare history',
    summary: 'Saved measurements as experiments: their definitions, a comparison against a '
      + 'baseline, and the findings that cite them.',
    related: [
      { id: 'measure', why: 'Run the measurement an experiment records' },
      { id: 'analyzer', why: 'A live microphone spectrum, before a calibrated run' },
    ] },
  { id: 'analyzer', label: 'Analyzer', group: 'analyze', words: 'spectrum microphone fft rta',
    summary: 'The microphone\'s live spectrum and spectrogram: a live view, not a calibrated '
      + 'measurement.',
    related: [
      { id: 'measure', why: 'A calibrated RTA and frequency response' },
      { id: 'experiments', why: 'Compare saved experiments' },
      { id: 'learn', why: 'Harmonics, sampling and aliasing explained' },
    ] },
  { id: 'filter', label: 'Filter Lab', group: 'analyze', words: 'lowpass highpass eq curve',
    summary: 'A biquad filter and the response the browser computes for it, set by type, '
      + 'cutoff and Q.',
    related: [
      { id: 'synth', why: 'The Synth\'s voice filters what you play on its keys' },
      { id: 'studio', why: 'A cutoff automated over time, as a Studio document',
        hash: '&st=filter-automation' },
      { id: 'analyzer', why: 'The spectrum of what the microphone hears' },
    ] },
  { id: 'compare', label: 'Compare', group: 'analyze', words: 'phase hearing ranges bio',
    summary: 'The microphone analyzer beside the bioacoustics hearing ranges and the phase and '
      + 'stereo views.',
    related: [
      { id: 'experiments', why: 'Compare saved experiments' },
      { id: 'measure', why: 'A calibrated measurement of the chain' },
      { id: 'learn', why: 'Hearing ranges and ultrasound explained' },
    ],
    // Compare's own job is the generator against the microphone: entering it selects the
    // microphone panel's Compare tab (page audit, Compare fix 1).
    enter: { 'mic.tab': 'compare' } },
  { id: 'synthesis', label: 'Synthesis', group: 'synthesis',
    words: 'envelope adsr additive harmonics dual binaural',
    summary: 'Additive harmonics, the ADSR envelope, the phase and stereo views and the dual '
      + 'oscillator, beside the generator and its analysis.',
    related: [
      { id: 'synth', why: 'Envelopes and oscillators on a voice you play from keys' },
      { id: 'studio', why: 'An enveloped, filtered voice as a Studio document',
        hash: '&st=subtractive-synth' },
      { id: 'studio', why: 'Two detuned tones beating, as a Studio document',
        hash: '&st=stereo-beat' },
    ] },
  { id: 'sequencer', label: 'Sequencer', group: 'synthesis', words: 'pattern steps blocks song',
    summary: 'Block sequences of tones, sweeps, pulses and modulation, beside the compact '
      + 'Studio.',
    related: [
      { id: 'synth', why: 'A voice to play the notes from keys' },
      { id: 'studio', why: 'A sweep sequence as a Studio document', hash: '&st=sweep-sequence' },
      { id: 'presets', why: 'Pattern presets to start from' },
    ] },
  { id: 'presets', label: 'Presets', group: 'synthesis', words: 'library load sounds',
    summary: 'Built-in and saved instrument settings, and the history of what was played.',
    related: [
      { id: 'playground', why: 'Where a loaded preset plays: TRIGGER or hold to play' },
      { id: 'synth', why: 'The Synth keeps its own patches' },
      { id: 'synthesis', why: 'Where the dual-oscillator presets play' },
    ],
    empty: { when: 'presets.noCustom', title: 'No custom presets yet',
      body: 'Set a sound in the Playground, then keep it with Save current… here or Save '
        + 'Preset in the status bar.',
      action: { label: 'Open the Playground', to: 'playground' } } },
  { id: 'learn', label: 'Learn', words: 'lessons guide acoustics',
    summary: 'Concept cards from frequency to speaker limitations, most with a demo to play.',
    related: [
      { id: 'analyzer', why: 'Waveforms, harmonics and aliasing in a live spectrum' },
      { id: 'synth', why: 'Modulation, AM and FM on the Synth\'s engines' },
      { id: 'measure', why: 'Logarithmic scales and speakers, measured' },
    ] },
  { id: 'studio', label: 'Studio', words: 'graph nodes cables timeline patch',
    summary: 'A signal graph you patch, with a timeline, transport and automation, run on Web '
      + 'Audio.',
    related: [
      { id: 'synth', why: 'A Studio document played from a panel and keys' },
      { id: 'sequencer', why: 'Block sequences that open here as patterns' },
      { id: 'filter', why: 'The filter response the templates automate' },
    ] },
  // Synth (K058) is top level after Studio by the owner's decision Q019.
  { id: 'synth', label: 'Synth', words: 'synthesizer engines voices keys midi patch',
    summary: 'A semi-modular mono voice on the Studio model with a patch bay and docked keys, '
      + 'and an Engines tab of additive, FM, AM and ring, wavetable, hard-sync and percussion '
      + 'voices.',
    related: [
      { id: 'studio', why: 'The same document as a graph and a timeline' },
      { id: 'sequencer', why: 'Block sequences of tones and sweeps' },
      { id: 'learn', why: 'Modulation, AM and FM explained' },
    ] },
  { id: 'about', label: 'About', words: 'credits licence version',
    summary: 'This page: what OSCILLA is, how it got here and what comes next.',
    related: [
      { id: 'playground', why: 'Start with the instrument' },
      { id: 'learn', why: 'The concepts, each with a demo' },
      { id: 'measure', why: 'A guided measurement of your speaker and room' },
    ] },
].map((w) => Object.freeze({ ...w, icon: `i-ws-${w.id}`,
  ...(w.related ? { related: Object.freeze(w.related.map((r) => Object.freeze({ ...r }))) } : {}),
})));

/** The sidebar groups, in the order their first workspace appears. */
export const GROUP_REGISTRY = Object.freeze({
  analyze: Object.freeze({ label: 'Analyze', icon: 'i-ws-analyze' }),
  synthesis: Object.freeze({ label: 'Synthesis', icon: 'i-ws-synthesis-group' }),
});

/** Workspace ids in navigation order (the URL `m` values). */
export const WORKSPACE_IDS = Object.freeze(WORKSPACE_REGISTRY.map((w) => w.id));

/** group id -> its workspace ids, in order. */
export const NAV_GROUPS = Object.freeze(Object.fromEntries(Object.keys(GROUP_REGISTRY)
  .map((g) => [g, Object.freeze(WORKSPACE_IDS.filter((id) => byId(id).group === g))])));

/** id -> label, for every workspace. */
export const WORKSPACE_LABELS = Object.freeze(Object.fromEntries(WORKSPACE_REGISTRY
  .map((w) => [w.id, w.label])));

function byId(id) {
  return WORKSPACE_REGISTRY.find((w) => w.id === id);
}

/** A workspace's registry row, or null. */
export function workspaceOf(id) {
  return byId(id) || null;
}

/** The related entries of a workspace, in order ([] for none). */
export function relatedOf(id) {
  const w = byId(id);
  return (w && w.related) || [];
}

/** A related entry's key: its target and route suffix (`studio&st=filter-automation`). */
export function relatedRef(r) {
  return `${r.id}${r.hash || ''}`;
}

/** A related entry's address: the target's route plus its suffix (`#m=studio&st=...`). */
export function relatedHref(r) {
  return `#m=${relatedRef(r)}`;
}

/** The own panel (data-osc-panel) a phone shows first in a workspace, or null. */
export function phonePrimaryOf(id) {
  const w = byId(id);
  return (w && w.phone && w.phone.primary) || null;
}

/**
 * The sidebar's entries, in order: a workspace on its own, or a group (at the place of its first
 * workspace) holding its workspaces. What the sidebar's x-for renders.
 */
export function navTree(registry = WORKSPACE_REGISTRY, groups = GROUP_REGISTRY) {
  const tree = [];
  for (const w of registry) {
    if (!w.group) {
      tree.push({ kind: 'item', ...w });
      continue;
    }
    let g = tree.find((e) => e.kind === 'group' && e.id === w.group);
    if (!g) {
      g = { kind: 'group', id: w.group, ...groups[w.group], items: [] };
      tree.push(g);
    }
    g.items.push({ kind: 'item', ...w });
  }
  return tree;
}

export const NAV_TREE = Object.freeze(navTree());

/** The group holding a workspace, or null for a top-level one. */
export function navGroupOf(id) {
  const w = byId(id);
  return (w && w.group) || null;
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim();

/** Does workspace `id` match the search `query`? Every word must start a word of it. */
export function navMatches(id, query) {
  const q = fold(query);
  if (!q) return true;
  const w = byId(id);
  if (!w) return false;
  const group = w.group ? GROUP_REGISTRY[w.group].label : '';
  const words = fold(`${w.label} ${group} ${w.id} ${w.words || ''}`).split(/[^a-z0-9]+/);
  return q.split(/\s+/).every((part) => words.some((word) => word.startsWith(part)));
}

/** The workspace ids a query finds, in navigation order. */
export function navSearch(query) {
  return WORKSPACE_IDS.filter((id) => navMatches(id, query));
}

export const SIDEBAR_KEY = 'oscilla.v2.sidebar';
export const NAV_GROUPS_KEY = 'oscilla.v2.navGroups';
/** The width from which the sidebar is a column beside the workspace (Tailwind's lg). */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** The stored sidebar choice: 'icons' (collapsed) or 'open' (the default). */
export function resolveSidebar(stored) {
  return stored === 'icons' ? 'icons' : 'open';
}

/** The stored group state: every group expanded unless the user collapsed it. */
export function resolveNavGroups(stored) {
  let parsed = null;
  try {
    parsed = JSON.parse(stored || 'null');
  } catch {
    parsed = null;
  }
  return Object.fromEntries(Object.keys(GROUP_REGISTRY)
    .map((g) => [g, !(parsed && typeof parsed === 'object' && parsed[g] === false)]));
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is a convenience; ignore.
  }
}

/** The focusable entries of the sidebar's navigation, in order (shown ones only). */
function sidebarEntries(root) {
  const nav = root.querySelector('#osc-nav');
  if (!nav) return [];
  return [...nav.querySelectorAll('a[href], button')].filter((el) => el.getClientRects().length);
}

/**
 * What Escape does in the shell's widgets (a pure decision, applied by createShell):
 *   'clear'     a workspace search holding a query empties it (the drawer stays open);
 *   'close'     anywhere else in the open phone drawer, the drawer closes and focus returns to
 *               the menu button;
 *   'collapse'  in an expanded group's list on the desktop sidebar, the group collapses and
 *               focus returns to its button;
 *   null        not the shell's: the key goes on to the page.
 * search: the key came from a workspace search field; query: its text; inGroup: the focus is
 * inside a group's list.
 */
export function shellEscape({ search = false, query = '', drawerOpen = false, inGroup = false }) {
  if (search && query) return 'clear';
  if (drawerOpen) return 'close';
  if (!search && inGroup) return 'collapse';
  return null;
}

let detachShellKeys = [];

/**
 * The shell part. Its state is UI-only (never audio) and every change it makes to what is shown
 * goes through Alpine bindings in src/index.html; the classes those bindings name are Tailwind
 * classes, written out here in full so the build's content scan compiles them.
 */
export function createShell({ get = storageGet, set = storageSet } = {}) {
  return {
    drawerOpen: false,
    sidebarCollapsed: resolveSidebar(get(SIDEBAR_KEY)) === 'icons',
    sidebarPeek: false,
    navExpanded: resolveNavGroups(get(NAV_GROUPS_KEY)),
    navQuery: '',
    navTree: NAV_TREE,

    /** The sidebar shows icons only (collapsed and not peeked at). */
    get sidebarIcons() {
      return this.sidebarCollapsed && !this.sidebarPeek;
    },

    shellInit() {
      const desktop = window.matchMedia(DESKTOP_QUERY);
      const leaveDrawer = () => { if (desktop.matches && this.drawerOpen) this.closeDrawer(); };
      if (desktop.addEventListener) desktop.addEventListener('change', leaveDrawer);
      this.shellKeys();
    },

    /**
     * The shell's keys, through the one widget key helper (ui/keys/roving.js, K153): in the
     * sidebar's list ArrowUp and ArrowDown walk the shown entries, wrapping, Home and End go to
     * the first and last; in either workspace search ArrowDown moves into the list; Escape is
     * shellEscape's everywhere in them (it closes the drawer from inside it, as the page-level
     * listener did). Attached once per page (a second call detaches the first).
     */
    shellKeys() {
      for (const d of detachShellKeys) d();
      detachShellKeys = [];
      const root = this.$root;
      const entries = () => sidebarEntries(root);
      const escape = (e) => {
        const t = e.target;
        const search = !!(t && t.matches && t.matches('input[type="search"]'));
        const list = t && t.closest ? t.closest('[data-osc-nav-panel]') : null;
        const what = shellEscape({ search, query: this.navQuery, drawerOpen: this.drawerOpen,
          inGroup: !!list });
        if (what === 'clear') this.navQuery = '';
        else if (what === 'close') this.closeDrawer(true);
        else if (what === 'collapse') {
          const group = list.dataset.oscNavPanel;
          this.toggleNavGroup(group, false);
          const btn = root.querySelector(`[data-osc="nav-group.${group}"]`);
          if (btn) btn.focus();
        }
        return what !== null;
      };
      // The entries: the arrows walk them, wrapping; Home and End.
      const list = root.querySelector('#osc-nav');
      if (list) {
        detachShellKeys.push(roving(list, { count: () => entries().length,
          index: () => entries().indexOf(document.activeElement),
          move: (i) => { const el = entries()[i]; if (el) el.focus(); },
          orientation: 'vertical', wrap: true, escape }));
      }
      // The navbar holds the drawer's own button: Escape there closes the open drawer too, as
      // the page-level listener did (no items: its arrows stay the controls').
      const bar = root.querySelector('[role="banner"]');
      if (bar) {
        detachShellKeys.push(roving(bar, { count: () => 0, index: () => -1, move() {},
          escape }));
      }
      // Each search is item 0 before the entries: ArrowDown enters the list, every other key
      // but Escape stays the field's (roving leaves a text field Home, End and letters).
      for (const input of root.querySelectorAll('#osc-nav-search, #osc-nav-search-drawer')) {
        detachShellKeys.push(roving(input.parentElement, {
          count: () => entries().length + 1,
          index: () => (document.activeElement === input ? 0 : -1),
          move: (i) => { const el = i > 0 ? entries()[i - 1] : null; if (el) el.focus(); },
          orientation: 'vertical', wrap: false, escape }));
      }
    },

    // ---- phone drawer ----
    openDrawer() {
      this.closeMenus();
      this.drawerOpen = true;
      this.$nextTick(() => {
        const current = this.$root.querySelector('#osc-nav [aria-current="page"]');
        const first = current && current.getClientRects().length ? current
          : sidebarEntries(this.$root)[0];
        if (first) first.focus({ preventScroll: true });
      });
    },
    closeDrawer(refocus = false) {
      if (!this.drawerOpen) return;
      this.drawerOpen = false;
      this.navQuery = '';
      if (refocus) {
        const btn = this.$root.querySelector('[data-osc="header.menu"]');
        if (btn) btn.focus();
      }
    },
    toggleDrawer() {
      if (this.drawerOpen) this.closeDrawer();
      else this.openDrawer();
    },

    // ---- desktop sidebar: open, or collapsed to icons (persisted) ----
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.sidebarPeek = false;
      set(SIDEBAR_KEY, this.sidebarCollapsed ? 'icons' : 'open');
      this.emit('collapse', 'sidebar', this.sidebarCollapsed);
    },
    /** While collapsed, the sidebar expands over the workspace under the pointer or focus. */
    sidebarPeekOn() {
      if (this.sidebarCollapsed) this.sidebarPeek = true;
    },
    sidebarPeekOff(e) {
      const to = e && e.relatedTarget;
      if (to && e.currentTarget && e.currentTarget.contains(to)) return;
      if (e && e.type === 'mouseleave' && e.currentTarget
        && e.currentTarget.contains(document.activeElement)) return;
      this.sidebarPeek = false;
    },
    sidebar() {
      return {
        ':class'() {
          return {
            flex: this.drawerOpen,
            hidden: !this.drawerOpen,
            'lg:w-16': this.sidebarIcons,
            'lg:shadow-lg': this.sidebarCollapsed && this.sidebarPeek,
          };
        },
        '@mouseenter'() { this.sidebarPeekOn(); },
        '@mouseleave'(e) { this.sidebarPeekOff(e); },
        '@focusin'() { this.sidebarPeekOn(); },
        '@focusout'(e) { this.sidebarPeekOff(e); },
      };
    },
    /** A label of the sidebar: visually hidden (still named) while it shows icons only. */
    sidebarLabel() {
      return { ':class'() { return { 'lg:sr-only': this.sidebarIcons }; } };
    },
    /**
     * The workspace column keeps its margin while the sidebar peeks over it, and is inert while
     * the phone drawer is open: the backdrop covers it, so neither Tab nor a screen reader may
     * reach it (the navbar stays live; its menu button closes the drawer). The dialogs sit
     * outside the column, so one opened from the navbar is not caught by it.
     */
    shellContent() {
      return {
        ':class'() {
          return { 'lg:ml-16': this.sidebarCollapsed, 'lg:ml-64': !this.sidebarCollapsed };
        },
        ':inert'() { return this.drawerOpen; },
      };
    },

    // ---- groups (Pro collapse: a button with aria-expanded and its list) ----
    toggleNavGroup(group, open = !this.navExpanded[group]) {
      this.navExpanded = { ...this.navExpanded, [group]: open };
      set(NAV_GROUPS_KEY, JSON.stringify(this.navExpanded));
    },
    navGroupShown(group) {
      return !!this.navExpanded[group] || !!this.navQuery.trim();
    },

    // ---- workspace search ----
    navShown(id) {
      return navMatches(id, this.navQuery);
    },
    navGroupMatches(group) {
      return NAV_GROUPS[group].some((id) => navMatches(id, this.navQuery));
    },
    navSearchResults() {
      return navSearch(this.navQuery);
    },
    /** Enter in the search opens the first workspace it finds. */
    navSearchGo() {
      const [first] = navSearch(this.navQuery);
      if (!first) return;
      this.navQuery = '';
      if (this.drawerOpen) this.closeDrawer();
      this.setWorkspace(first, { focusHeading: true });
    },
  };
}
