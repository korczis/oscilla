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

import { roving } from './keys/roving.js';

/** The workspaces, in navigation order. group: the sidebar group holding it, or none. */
export const WORKSPACE_REGISTRY = Object.freeze([
  { id: 'playground', label: 'Playground', words: 'instrument tone oscillator play hold',
    summary: 'Nástroj na jedné obrazovce: generátor, analýza signálu, analyzátor mikrofonu, '
      + 'řízené měření, sekvencer vzorů a kompaktní Studio.',
    related: [
      { id: 'measure', why: 'Změřte reproduktor, místnost a mikrofon, kterými tón prochází' },
      { id: 'synth', why: 'Hlas s filtry, obálkami a klávesami' },
      { id: 'learn', why: 'Karty pojmů, jejichž ukázky hrají tady' },
    ] },
  { id: 'measure', label: 'Measure', words: 'frequency response sweep impulse room test',
    summary: 'Řízené měření řetězce reproduktoru, místnosti a mikrofonu: frekvenční '
      + 'charakteristika, impulsní odezva a RTA, u každého běhu s hodnocením kvality.',
    related: [
      { id: 'experiments', why: 'Uložte běh jako experiment a porovnejte ho s ostatními' },
      { id: 'studio', why: 'Měřicí sweep jako dokument Studia',
        hash: '&st=measurement-sweep' },
      { id: 'learn', why: 'Vysvětlení logaritmických stupnic a limitů reproduktorů' },
    ] },
  { id: 'experiments', label: 'Experiments', words: 'saved records findings compare history',
    summary: 'Uložená měření jako experimenty: jejich definice, porovnání s referenčním '
      + 'měřením a zjištění, která se na ně odvolávají.',
    related: [
      { id: 'measure', why: 'Spusťte měření, které experiment zaznamená' },
      { id: 'analyzer', why: 'Živé spektrum mikrofonu ještě před kalibrovaným měřením' },
    ] },
  { id: 'analyzer', label: 'Analyzer', group: 'analyze', words: 'spectrum microphone fft rta',
    summary: 'Spektrogram výstupu a analyzátor mikrofonu: živé pohledy, nikoli kalibrované '
      + 'měření.',
    related: [
      { id: 'measure', why: 'Kalibrované RTA a frekvenční charakteristika' },
      { id: 'experiments', why: 'Porovnejte uložené experimenty' },
      { id: 'learn', why: 'Vysvětlení harmonických, vzorkování a aliasingu' },
    ] },
  { id: 'filter', label: 'Filter Lab', group: 'analyze', words: 'lowpass highpass eq curve',
    summary: 'Bikvadratický filtr a odezva, kterou pro něj spočítá prohlížeč; nastavuje se '
      + 'typem, mezní frekvencí a Q.',
    related: [
      { id: 'synth', why: 'Hlas Synthu filtruje, co hrajete na jeho klávesách' },
      { id: 'studio', why: 'Automatizace mezní frekvence v čase jako dokument Studia',
        hash: '&st=filter-automation' },
      { id: 'analyzer', why: 'Spektrum toho, co slyší mikrofon' },
    ] },
  { id: 'compare', label: 'Compare', group: 'analyze', words: 'phase hearing ranges bio',
    summary: 'Analyzátor mikrofonu vedle bioakustických rozsahů slyšení a pohledů '
      + 'na fázi a stereo.',
    related: [
      { id: 'experiments', why: 'Porovnejte uložené experimenty' },
      { id: 'measure', why: 'Kalibrované měření celého řetězce' },
      { id: 'learn', why: 'Vysvětlení rozsahů slyšení a ultrazvuku' },
    ],
    // Compare's own job is the generator against the microphone: entering it selects the
    // microphone panel's Compare tab (page audit, Compare fix 1).
    enter: { 'mic.tab': 'compare' } },
  { id: 'synthesis', label: 'Synthesis', group: 'synthesis',
    words: 'envelope adsr additive harmonics dual binaural',
    summary: 'Aditivní harmonické, obálka ADSR, pohledy na fázi a stereo a duální oscilátor, '
      + 'vedle generátoru a jeho analýzy.',
    related: [
      { id: 'synth', why: 'Obálky a oscilátory hlasu, na který hrajete z kláves' },
      { id: 'studio', why: 'Hlas s obálkou a filtrem jako dokument Studia',
        hash: '&st=subtractive-synth' },
      { id: 'studio', why: 'Zázněje dvou rozladěných tónů jako dokument Studia',
        hash: '&st=stereo-beat' },
    ] },
  { id: 'sequencer', label: 'Sequencer', group: 'synthesis', words: 'pattern steps blocks song',
    summary: 'Blokové sekvence tónů, přeletů, pulzů a modulace vedle kompaktního Studia; '
      + 'krokový sekvencer s pady je v Synthu na záložce Bicí.',
    related: [
      { id: 'synth', why: 'Hlas, kterým noty zahrajete z kláves' },
      { id: 'studio', why: 'Sekvence sweepů jako dokument Studia', hash: '&st=sweep-sequence' },
      { id: 'presets', why: 'Presety vzorů jako výchozí bod' },
    ] },
  { id: 'presets', label: 'Presets', group: 'synthesis', words: 'library load sounds',
    summary: 'Vestavěná i uložená nastavení nástroje a historie toho, co se hrálo.',
    related: [
      { id: 'playground', why: 'Tady načtený preset zazní: tlačítkem Trigger nebo podržením' },
      { id: 'synth', why: 'Synth má vlastní patche' },
      { id: 'synthesis', why: 'Tady hrají presety duálního oscilátoru' },
    ],
    empty: { when: 'presets.noCustom', title: 'Zatím žádné vlastní presety',
      body: 'Nastavte zvuk v Playgroundu a uložte ho tady tlačítkem Uložit aktuální… nebo '
        + 'tlačítkem Uložit preset ve stavové liště.',
      action: { label: 'Otevřít Playground', to: 'playground' } } },
  { id: 'learn', label: 'Learn', words: 'lessons guide acoustics',
    summary: 'Karty pojmů od frekvence po signálovou cestu, většina s ukázkou k přehrání.',
    related: [
      { id: 'analyzer', why: 'Tvary vln, harmonické a aliasing v živém spektru' },
      { id: 'synth', why: 'Modulace, AM a FM na záložce Engines v Synthu' },
      { id: 'measure', why: 'Logaritmické stupnice a reproduktory v reálném měření' },
    ] },
  { id: 'studio', label: 'Studio', words: 'graph nodes cables timeline patch',
    summary: 'Signálový graf, který propojujete kabely, s časovou osou, transportem '
      + 'a automatizací, běžící na Web Audio.',
    related: [
      { id: 'synth', why: 'Dokument Studia hraný z panelu a kláves' },
      { id: 'sequencer', why: 'Blokové sekvence, které se tu otevřou jako vzory' },
      { id: 'filter', why: 'Odezva filtru, kterou automatizují šablony' },
    ] },
  // Synth (K058) is top level after Studio by the owner's decision Q019.
  { id: 'synth', label: 'Synth', words: 'synthesizer engines voices keys midi patch',
    summary: 'Semimodulární monofonní hlas na modelu Studia s patch bayí a ukotvenými '
      + 'klávesami; záložka Engines s hlasy aditivními, FM, AM / ring, wavetable, hard sync '
      + 'a perkusními, záložka XY a záložka Bicí s kroky bicích.',
    related: [
      { id: 'studio', why: 'Tentýž dokument jako graf a časová osa' },
      { id: 'sequencer', why: 'Blokové sekvence tónů a sweepů' },
      { id: 'learn', why: 'Vysvětlení modulace, AM a FM' },
    ] },
  { id: 'about', label: 'About', words: 'credits licence version',
    summary: 'Tato stránka: co je OSCILLA, jak vznikla a co přijde dál.',
    related: [
      { id: 'playground', why: 'Začněte u nástroje' },
      { id: 'learn', why: 'Pojmy, každý s ukázkou' },
      { id: 'measure', why: 'Řízené měření vašeho reproduktoru a místnosti' },
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
