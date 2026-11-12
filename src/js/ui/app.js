// OSCILLA visual shell: the Alpine component that owns UI-only state (workspace mode, tabs,
// segmented choices, menus, collapsed panels, theme). It never touches audio. Every change is
// announced as a bubbling `osc:ui` CustomEvent on the app root so the engine wiring can react
// without reaching into Alpine:
//   root.addEventListener('osc:ui', (e) => { const { kind, key, value } = e.detail; ... });
// kind: 'tab' | 'choice' | 'mode' | 'theme' | 'collapse'.
//
// Integration note: the workspace (nav) state is `workspace`, not `mode`, because the composed
// component (src/js/main.js) also carries the V1 instrument, whose `mode`/`setMode` are the V1
// mode ids (playground/sweep/dual/presets/learn) that the URL `m` key and presets still use.
// The 'mode' event kind keeps its name (detail.value is the workspace id).

import { shortcutHelp } from './shortcuts.js';
import { counterpartOf, showsCounterparts } from './counterparts.js';
import {
  createShell, GROUP_REGISTRY, NAV_GROUPS, navGroupOf, phonePrimaryOf, relatedHref,
  WORKSPACE_IDS, WORKSPACE_LABELS, WORKSPACE_REGISTRY, workspaceOf,
} from './shell.js';
import { pageRelatedOf, relatedText } from './cross-links.js';
import { emptyPredicateHolds } from './empty-states.js';

const THEME_KEY = 'oscilla.v2.theme';
const ANALYSIS_TAB_KEY = 'oscilla.v2.analysisTab';
const ANALYSIS_TABS = ['waveform', 'spectrum', 'spectrogram', 'harmonics', 'signalPath'];
// §73 top level: PLAYGROUND, MEASURE, EXPERIMENTS, ANALYZE, SYNTHESIS, LEARN ("no 14 top-level
// tabs"); V3.1 §198 adds Studio alongside them; About stays the last item (PR #17). ANALYZE and
// SYNTHESIS are the sidebar's collapsible groups whose items are the V2 workspaces (§183: none
// is removed). MODES is the navigation order, groups expanded in place, derived from the one
// registry (shell.js WORKSPACE_REGISTRY, issue F002); Synth is top level after Studio (Q019).
const MODES = WORKSPACE_IDS;
// The document title of each workspace but the Playground, which keeps the product title (the
// page's own <title>): every history entry, tab and screen-reader page title names its page.
// The names are the nav items' labels (the registry's).
const WORKSPACE_TITLES = Object.freeze(Object.fromEntries(WORKSPACE_IDS
  .filter((id) => id !== 'playground').map((id) => [id, WORKSPACE_LABELS[id]])));
const ROVING_ROLES = ['tab', 'radio'];
/** The phone width of src/styles/responsive.css (single column below 768 px). */
export const PHONE_QUERY = '(max-width: 767.98px)';

/** localStorage can be missing or throw (private mode, file:// policies, quota). */
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

/** Resolve the stored theme; dark is the default and the reference. */
export function resolveTheme(stored) {
  return stored === 'light' ? 'light' : 'dark';
}

/** Apply the stored theme before Alpine starts so the first paint is correct. */
export function applyInitialTheme(doc = document) {
  const theme = resolveTheme(storageGet(THEME_KEY));
  doc.documentElement.dataset.theme = theme;
  return theme;
}

/** ?mock=1 paints neutral outlines on renderer hosts (layout comparison only). */
export function applyMockFlag(doc = document, search = window.location.search) {
  const on = new URLSearchParams(search).get('mock') === '1';
  doc.documentElement.classList.toggle('osc-mock', on);
  return on;
}

/** Map a slider value to the CSS fill percentage used by .osc-slider. */
export function sliderFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const v = Number(input.value);
  if (!(max > min) || !Number.isFinite(v)) return '0%';
  const pct = Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  return `${pct.toFixed(2)}%`;
}

/** Keep every .osc-slider's filled track in sync (also for values set by code + 'input'). */
export function syncSliderFill(root = document) {
  root.querySelectorAll('input.osc-slider').forEach((el) => {
    el.style.setProperty('--osc-fill', sliderFill(el));
  });
}

/**
 * Scroll `scroller` along x so `el` is fully visible (WCAG 2.4.11): browsers do not reliably
 * scroll a box to a control reached with Tab that is only partly inside it. align 'start'
 * puts it at the left edge; otherwise the box moves only as far as needed.
 */
export function keepInScrollerView(el, scroller, align = 'nearest') {
  if (!el || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  const t = el.getBoundingClientRect();
  const n = scroller.getBoundingClientRect();
  const pad = 8;
  if (align === 'start') {
    if (t.left < n.left || t.right > n.right) scroller.scrollLeft += t.left - n.left - pad;
  } else if (t.left < n.left + pad) scroller.scrollLeft -= n.left + pad - t.left;
  else if (t.right > n.right - pad) scroller.scrollLeft += t.right - (n.right - pad);
}

/** Arrow/Home/End navigation among sibling tabs or radios; selection follows focus. */
export function rovingKeydown(event) {
  const el = event.currentTarget;
  const role = el.getAttribute('role');
  if (!ROVING_ROLES.includes(role)) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = [...el.parentElement.querySelectorAll(`:scope > [role="${role}"]`)];
  const i = items.indexOf(el);
  let next = i;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (i - 1 + items.length) % items.length;
  } else next = (i + 1) % items.length;
  event.preventDefault();
  items[next].focus();
  items[next].click();
}

/** The Alpine component definition (plain object factory, testable without Alpine). */
export const WORKSPACES = MODES;
export { NAV_GROUPS, navGroupOf };

/**
 * The navigation's top level in order, derived from WORKSPACES and NAV_GROUPS: a top-level
 * workspace as `nav.<id>`, a group once, at its first workspace, as `nav-group.<group>`. Synth
 * is top level after Studio by the owner's decision Q019.
 */
export function navTopLevel() {
  const out = [];
  for (const ws of WORKSPACES) {
    const g = navGroupOf(ws);
    const id = g ? `nav-group.${g}` : `nav.${ws}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The heading of a workspace: the heading its own view is labelled by (MEASURE, STUDIO, …), the
 * title of the visually first of its panels on the Playground grid (Analyzer, Filter Lab, …),
 * or the page heading for the Playground. A panel a workspace lists first in data-osc-modes is
 * its own and is preferred over one it shares with the workspace listed before it (Compare's
 * Phase panel before the Analyzer's microphone panel, which Compare also shows). null when none
 * is shown.
 */
export function workspaceHeading(root, mode) {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  const labelOf = (el) => {
    if (!el) return null;
    const id = el.getAttribute('aria-labelledby');
    return (id && root.querySelector(`#${id}`)) || el.querySelector('h2, h3');
  };
  if (mode === 'playground') return root.querySelector('#osc-main > h1');
  const own = [...root.querySelectorAll('[data-osc-modes]')]
    .filter((p) => p.dataset.oscModes.split(/\s+/).includes(mode));
  // A full-width view: by its class, or a Pro view by its data-osc hook (the Synth view, #329).
  const view = own.find((p) => (p.classList.contains('osc-view')
    || p.dataset.osc === `${mode}-view`) && shown(p));
  if (view) return labelOf(view);
  const panels = own.filter((p) => p.classList.contains('osc-panel') && shown(p)
    && !p.matches('.osc-p-source, .osc-p-analysis'))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  const home = panels.find((p) => p.dataset.oscModes.split(/\s+/)[0] === mode);
  return labelOf(home || panels[0]);
}

/**
 * Mark the panels of workspace `mode`: every panel whose data-osc-modes lists it gets the
 * focused class, every other loses it; on the Playground none has it. Below 1536 px the class
 * also decides which panels a workspace shows (responsive.css), so it is set in the same step
 * as the workspace, a deep link's load included (ui/navigation.js), before the first paint.
 * `panels` are the elements carrying data-osc-modes (views among them are never marked).
 */
export function markWorkspacePanels(panels, mode, primary = phonePrimaryOf(mode)) {
  for (const p of panels) {
    const on = mode !== 'playground' && p.dataset.oscModes.split(/\s+/).includes(mode);
    p.classList.toggle('is-focused', on && p.classList.contains('osc-panel'));
    // The registry's phone.primary: that own panel leads the workspace on a phone.
    p.classList.toggle('max-md:order-first', on && !!primary && p.dataset.oscPanel === primary);
  }
}

/**
 * Apply a workspace's `enter` (ui/shell.js): { '<data-osc>': '<value>' }. Each entry goes
 * through the control itself, never through state: a choice (a tab, radio or button carrying
 * data-value) is clicked unless it is already selected, a field (select, input, textarea) gets
 * the value and its own input and change events. Returns the hooks applied (a hook with no
 * such control is skipped).
 */
export function applyEnter(root, enter) {
  const applied = [];
  for (const [osc, value] of Object.entries(enter || {})) {
    const els = [...root.querySelectorAll(`[data-osc="${osc}"]`)];
    const choice = els.find((el) => el.dataset && el.dataset.value === value);
    if (choice) {
      const on = ['aria-selected', 'aria-checked', 'aria-pressed']
        .some((a) => choice.getAttribute(a) === 'true');
      if (!on) choice.click();
      applied.push(osc);
      continue;
    }
    const field = els.find((el) => /^(SELECT|INPUT|TEXTAREA)$/.test(el.tagName));
    if (field) {
      if (field.value !== value) {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applied.push(osc);
    }
  }
  return applied;
}

/**
 * Move focus to the workspace heading (a navigation the user did not make on a control: Back,
 * Forward, a link). It is focusable only by script (tabindex -1) and never steals focus from an
 * open dialog; the workspace is already scrolled into view, so the focus does not scroll.
 */
export function focusWorkspaceHeading(root, mode) {
  if (document.querySelector('dialog[open]')) return false;
  const h = workspaceHeading(root, mode);
  if (!h) return false;
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
  return document.activeElement === h;
}

/**
 * The skip link's label (H004 B7): it targets the main region, which holds the workspace shown,
 * and names that workspace, never "the instrument" in a workspace that is not one.
 */
export function skipLinkLabel(mode) {
  const name = WORKSPACE_LABELS[mode] || WORKSPACE_LABELS.playground;
  return `Skip to main content: ${name}`;
}

/**
 * Re-label the skip link, the link to the main region (it sits before the component root,
 * outside Alpine's reach).
 */
export function syncSkipLink(doc, mode) {
  const main = doc.querySelector('main');
  const el = main && main.id ? doc.querySelector(`a[href="#${main.id}"]`) : null;
  if (el) el.textContent = skipLinkLabel(mode);
}

/** Document title for a workspace: `OSCILLA · <page>`, or the product title for the Playground. */
export function workspaceTitle(mode, base) {
  return WORKSPACE_TITLES[mode] ? `OSCILLA · ${WORKSPACE_TITLES[mode]}` : base;
}

export function createOscillaUi({ storedAnalysisTab = storageGet(ANALYSIS_TAB_KEY) } = {}) {
  const ui = {
    workspace: 'playground',
    theme: 'dark',
    tabs: {
      analysis: ANALYSIS_TABS.includes(storedAnalysisTab) ? storedAnalysisTab : 'waveform',
      mic: 'live',
      phase: 'phase',
      bio: 'ranges',
    },
    sourceKind: 'oscillator',
    waveform: 'sine',
    inputMode: 'frequency',
    specScale: 'log',
    filterType: 'lowpass',
    stereoRoute: 'mono',
    dualRoute: 'mono',
    menus: { overflow: false, export: false, addBlock: false, actions: false, related: false,
      seqOpen: false, filterOpen: false },
    collapsed: { device: false, phase: false, bio: false },

    init() {
      this.theme = resolveTheme(document.documentElement.dataset.theme);
      applyMockFlag();
      syncSliderFill(this.$root);
      this.$watch('workspace', (ws) => syncSkipLink(document, ws));
      syncSkipLink(document, this.workspace);
      this.$root.addEventListener('input', (e) => {
        if (e.target.matches && e.target.matches('input.osc-slider')) {
          e.target.style.setProperty('--osc-fill', sliderFill(e.target));
        }
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.osc-menu-anchor, [data-osc-menu-anchor], .osc-sb-actions-wrap')) {
          this.closeMenus();
        }
      });
      this.shellInit();
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && Object.values(this.menus).some(Boolean)) {
          const open = Object.keys(this.menus).find((k) => this.menus[k]);
          this.closeMenus();
          const btn = this.$root.querySelector(`[data-osc-menu-button="${open}"]`);
          if (btn) btn.focus();
        }
      });
    },

    emit(kind, key, value) {
      this.$root.dispatchEvent(new CustomEvent('osc:ui', {
        bubbles: true,
        detail: { kind, key, value },
      }));
    },

    // ---- tabs (role=tab) ----
    setTab(group, value) {
      if (this.tabs[group] === value) return;
      this.tabs[group] = value;
      if (group === 'analysis') storageSet(ANALYSIS_TAB_KEY, value);
      this.emit('tab', group, value);
    },
    tab(group, value) {
      return {
        ':class'() { return { 'is-active': this.tabs[group] === value }; },
        ':aria-selected'() { return String(this.tabs[group] === value); },
        ':tabindex'() { return this.tabs[group] === value ? 0 : -1; },
        '@click'() { this.setTab(group, value); },
        '@keydown'(e) { rovingKeydown(e); },
      };
    },

    // ---- segmented choices (role=radio) ----
    setChoice(key, value) {
      if (this[key] === value) return;
      this[key] = value;
      this.emit('choice', key, value);
    },
    choice(key, value) {
      return {
        ':class'() { return { 'is-active': this[key] === value }; },
        ':aria-checked'() { return String(this[key] === value); },
        ':tabindex'() { return this[key] === value ? 0 : -1; },
        '@click'() { this.setChoice(key, value); },
        '@keydown'(e) { rovingKeydown(e); },
      };
    },

    // ---- workspace navigation ----
    /**
     * Switch workspace. The address follows (ui/navigation.js: one history entry per switch).
     * focusHeading: focus moves to the workspace heading (Back / Forward, a link), where a nav
     * click leaves it on the control that was pressed.
     */
    setWorkspace(mode, { focusHeading = false } = {}) {
      if (!MODES.includes(mode)) return;
      const entered = this.workspace !== mode;
      // The root, read now: a control rendered by an x-for (the page header's Related links)
      // is replaced as the workspace changes, and Alpine resolves $root from the element that
      // called, so read later from a detached element it is undefined.
      const root = this.$root;
      this.workspace = mode;
      // Below 1536 px the mark decides which panels show: set it in this step, so the heading
      // the microtask below focuses is already shown.
      this.markWorkspace(mode, root);
      this.emit('mode', 'mode', mode);
      // The heading takes focus within this task: a microtask queued after the change above
      // runs once Alpine has applied it (its effects flush in an earlier microtask) and before
      // any timer or frame. A drawer entry hides itself as the drawer closes; with the focus
      // only in $nextTick (a timer), focus rested on <body> in between (review #330 F4). The
      // timer tries again when the heading was not shown yet.
      let moved = false;
      if (focusHeading) {
        queueMicrotask(() => { moved = focusWorkspaceHeading(root, mode); });
      }
      this.$nextTick(() => {
        if (entered) this.enterWorkspace(mode, root);
        this.focusWorkspace(mode, root);
        if (focusHeading && !moved) focusWorkspaceHeading(root, mode);
      });
    },
    /** enterWorkspace once Alpine has bound the controls (a deep link's load). */
    enterWorkspaceSoon(mode) {
      const root = this.$root;
      this.$nextTick(() => { if (this.workspace === mode) this.enterWorkspace(mode, root); });
    },
    /** Apply the registry's `enter` of workspace `mode` through its controls (applyEnter). */
    enterWorkspace(mode, root = this.$root) {
      const w = workspaceOf(mode);
      return w && w.enter ? applyEnter(root, w.enter) : [];
    },
    /** Mark the panels of `mode` (markWorkspacePanels) without moving focus or scrolling. */
    markWorkspace(mode, root = this.$root) {
      markWorkspacePanels(root.querySelectorAll('[data-osc-modes]'), mode);
    },
    focusWorkspace(mode, root = this.$root) {
      const panels = [...root.querySelectorAll('[data-osc-modes]')];
      markWorkspacePanels(panels, mode);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = reduce ? 'auto' : 'smooth';
      // 768-1535 px of window (the lab beside the sidebar) shows a workspace's own panels first
      // in two columns (responsive.css): the nav brings the first of them to the top and rings
      // them (CSS .is-focused).
      const tablet = window.matchMedia('(min-width: 768px) and (max-width: 1535.98px)').matches;
      if (mode === 'playground') {
        if (tablet) {
          const main = root.querySelector('.osc-main');
          if (main && main.scrollTop > 0) main.scrollTo({ top: 0, behavior });
        }
        return;
      }
      // The visually first of the workspace's own panels (CSS order differs from DOM order).
      const target = panels.filter((p) => p.dataset.oscModes.split(/\s+/).includes(mode)
        && p.offsetParent !== null && !p.matches('.osc-p-source, .osc-p-analysis'))
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (target) target.scrollIntoView({ block: tablet ? 'start' : 'nearest', behavior });
    },
    /**
     * A disclosure of Source & Pattern (the six frequency steps, Mode) folds on a phone and is
     * open from 768 px, where its summary is not shown (P002, Q004 option A); it follows the
     * width. Without matchMedia it stays as the markup has it (open).
     */
    foldOnPhone(el) {
      const mq = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(PHONE_QUERY) : null;
      if (!mq) return;
      const sync = () => { el.open = !mq.matches; };
      sync();
      if (mq.addEventListener) mq.addEventListener('change', sync);
    },
    /** What the one Keyboard shortcuts dialog lists in the workspace in view (ADR 0050). */
    keyHelp() {
      return shortcutHelp(this.workspace);
    },
    /** The page header's names for the workspace in view (the registry's labels). */
    workspaceLabel() {
      return WORKSPACE_LABELS[this.workspace] || '';
    },
    workspaceGroupLabel() {
      const g = navGroupOf(this.workspace);
      return g ? GROUP_REGISTRY[g].label : '';
    },
    /** About's workspace list: every workspace of the registry, in navigation order. */
    aboutWorkspaces() {
      return WORKSPACE_REGISTRY;
    },
    /** The page header's one-sentence summary of the workspace in view (the registry's). */
    workspaceSummary() {
      const w = workspaceOf(this.workspace);
      return (w && w.summary) || '';
    },
    /**
     * The page header's Related links: the registry's related entries of the workspace in view,
     * less the routes its content already links to (cross-links.js pageRelatedOf: a target
     * appears once per screen), each { key, id, why, href, text }.
     */
    workspaceRelated() {
      return pageRelatedOf(this.workspace).slice(0, 3).map((r, i) => ({
        key: `${this.workspace}:${i}`, id: r.id, why: r.why, href: relatedHref(r),
        text: relatedText(r) }));
    },
    /**
     * A Related link: its href is the target's address, so a modified click opens it as the
     * browser does; a plain click on a workspace address switches through the component and
     * moves focus to the workspace heading, as a counterpart link does. An address with a route
     * suffix (a Studio template) is left to the router, which applies it.
     */
    relatedLink(link) {
      return {
        '@click'(e) {
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (link.href !== `#m=${link.id}`) return;
          e.preventDefault();
          this.closeMenus();
          this.setWorkspace(link.id, { focusHeading: true });
        },
      };
    },
    /** The registry's empty state of workspace `ws`, or null. */
    emptyOf(ws) {
      const w = workspaceOf(ws);
      return (w && w.empty) || null;
    },
    /** True while `ws` is in view and its empty state's predicate holds (ui/empty-states.js). */
    emptyShown(ws) {
      const e = this.emptyOf(ws);
      return !!e && this.workspace === ws && emptyPredicateHolds(e.when, this);
    },
    /** The empty state's action: a link to its workspace, switched as a Related link is. */
    emptyAction(ws) {
      const e = this.emptyOf(ws);
      const to = e && e.action ? e.action.to : null;
      // data-osc-link: page.emptyAction
      return to ? this.relatedLink({ id: to, href: `#m=${to}` }) : {};
    },
    /**
     * The logo goes home (H004 B6): its href is the Playground's address, and a plain click
     * switches there through the router; a modified click is the browser's. It is a link, not a
     * nav item, so focus moves to the Playground heading as any #m= link moves it (U010).
     */
    homeLink() {
      return {
        '@click'(e) {
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.setWorkspace('playground', { focusHeading: true });
        },
      };
    },
    /** A sidebar link to a workspace; nested: inside a group's list. */
    navItem(mode, nested = false) {
      return {
        // The active workspace holds the Pro hover colour (the reference, section 4).
        ':class'() {
          return { 'bg-gray-100 dark:bg-gray-700': this.workspace === mode,
            'lg:pl-2.5': nested && this.sidebarIcons };
        },
        ':aria-current'() { return this.workspace === mode ? 'page' : false; },
        '@click'(e) {
          // The href is the workspace's address (#m=<id>): a modified click opens it in a new
          // tab or window, as the browser does with any link.
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.navQuery = '';
          // On a phone the drawer closes over the workspace chosen and focus moves to its
          // heading; on a desktop it stays on the link that was pressed.
          const fromDrawer = this.drawerOpen;
          if (fromDrawer) this.closeDrawer();
          this.setWorkspace(mode, { focusHeading: fromDrawer });
        },
      };
    },
    /** The page header's root crumb: the Playground, the default workspace. */
    crumbHome() {
      return {
        '@click'(e) {
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.setWorkspace('playground', { focusHeading: true });
        },
      };
    },

    /**
     * A counterpart link (ui/counterparts.js): its href, written in src/index.html, is the
     * workspace's address (counterpartHref); a plain click opens the workspace, selects its
     * MEASURE result tab and moves focus to the workspace heading.
     */
    counterpartLink(id) {
      const c = counterpartOf(id);
      return {
        '@click'(e) {
          if (!c || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.setWorkspace(c.workspace, { focusHeading: true });
          if (c.measureTab) this.measureSetTab(c.measureTab);
        },
      };
    },
    /** True when the workspace in view shows the counterpart links. */
    counterpartsShown() {
      return showsCounterparts(this.workspace);
    },

    // ---- sidebar groups (a Pro collapse: a button with aria-expanded and its list) ----
    navGroupButton(group) {
      return {
        // While collapsed, the group's button holds the active colour of the workspace inside.
        ':class'() {
          return { 'bg-gray-100 dark:bg-gray-700': navGroupOf(this.workspace) === group
            && !this.navGroupShown(group) };
        },
        ':aria-current'() { return navGroupOf(this.workspace) === group ? 'true' : false; },
        ':aria-expanded'() { return String(this.navGroupShown(group)); },
        '@click'() { this.toggleNavGroup(group); },
      };
    },
    navGroupPanel(group) {
      return {
        'data-osc-nav-panel': group,
        ':hidden'() { return !this.navGroupShown(group); },
      };
    },

    // ---- menus ----
    closeMenus() {
      Object.keys(this.menus).forEach((k) => { this.menus[k] = false; });
    },
    menuButton(name) {
      return {
        'data-osc-menu-button': name,
        ':aria-expanded'() { return String(this.menus[name]); },
        '@click'() {
          const next = !this.menus[name];
          this.closeMenus();
          this.menus[name] = next;
          if (next) {
            this.$nextTick(() => {
              const panel = this.$root.querySelector(`[data-osc-menu-panel="${name}"]`);
              const first = panel && [...panel.querySelectorAll('button, [href]')]
                .find((el) => el.offsetParent !== null);
              if (first) first.focus();
            });
          }
        },
      };
    },
    menuPanel(name) {
      return {
        'data-osc-menu-panel': name,
        // ARIA menu keys: arrows/Home/End move among the VISIBLE items (hidden ones skipped).
        '@keydown'(e) {
          const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
          if (!keys.includes(e.key)) return;
          const items = [...e.currentTarget.querySelectorAll('[role^="menuitem"]')]
            .filter((el) => el.offsetParent !== null && !el.disabled);
          if (!items.length) return;
          e.preventDefault();
          const i = items.indexOf(document.activeElement);
          let n = 0;
          if (e.key === 'End') n = items.length - 1;
          else if (e.key === 'ArrowDown') n = (i + 1) % items.length;
          else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
          items[n].focus();
        },
        ':hidden'() { return !this.menus[name]; },
        '@click'(e) {
          if (!e.target.closest('[role^="menuitem"]')) return;
          this.closeMenus();
          // The item is now hidden: give focus back to the menu button unless the item moved
          // it (a dialog opened, a file picker, …). Focus must never drop to <body>.
          this.$nextTick(() => {
            const a = document.activeElement;
            if (a && a !== document.body && !a.closest('[data-osc-menu-panel]')) return;
            const btn = this.$root.querySelector(`[data-osc-menu-button="${name}"]`);
            if (btn) btn.focus();
          });
        },
      };
    },

    // ---- collapsible panels ----
    collapseButton(name) {
      return {
        ':aria-expanded'() { return String(!this.collapsed[name]); },
        '@click'() {
          this.collapsed[name] = !this.collapsed[name];
          this.emit('collapse', name, this.collapsed[name]);
        },
      };
    },

    // ---- theme ----
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      storageSet(THEME_KEY, this.theme);
      this.emit('theme', 'theme', this.theme);
    },
  };
  // The shell part (sidebar, drawer, groups, search); merged by descriptor so its getter stays
  // a getter (main.js composes the same way).
  Object.defineProperties(ui, Object.getOwnPropertyDescriptors(createShell()));
  return ui;
}

/**
 * Register the shell component. Call before Alpine.start():
 *   import Alpine from 'alpinejs';
 *   import { registerOscillaUi } from './ui/app.js';
 *   registerOscillaUi(Alpine); Alpine.start();
 * options.compose(ui) -> component: lets the integration merge the shell state with the
 * instrument into one component (main.js); default: the shell alone.
 */
export function registerOscillaUi(Alpine, { compose } = {}) {
  applyInitialTheme();
  Alpine.data('oscilla', () => (compose ? compose(createOscillaUi()) : createOscillaUi()));
}
