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

const THEME_KEY = 'oscilla.v2.theme';
const ANALYSIS_TAB_KEY = 'oscilla.v2.analysisTab';
const ANALYSIS_TABS = ['waveform', 'spectrum', 'spectrogram', 'harmonics', 'signalPath'];
// §73 top level: PLAYGROUND, MEASURE, EXPERIMENTS, ANALYZE, SYNTHESIS, LEARN ("no 14 top-level
// tabs"); V3.1 §198 adds Studio alongside them; About stays the last item (PR #17). ANALYZE and
// SYNTHESIS are disclosure groups whose items are the V2 workspaces (§183: none is removed).
// MODES is the navigation order, groups expanded in place.
const NAV_GROUPS = Object.freeze({
  analyze: Object.freeze(['analyzer', 'filter', 'compare']),
  synthesis: Object.freeze(['synthesis', 'sequencer', 'presets']),
});
const MODES = [
  'playground', 'measure', 'experiments', ...NAV_GROUPS.analyze, ...NAV_GROUPS.synthesis,
  'learn', 'studio', 'about',
];
const WORKSPACE_TITLES = { about: 'About' };
const ROVING_ROLES = ['tab', 'radio'];

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
 * Scroll the nav strip so `tab` is fully visible. align 'start' puts it at the left edge (the
 * workspace just chosen); otherwise the strip moves only as far as needed.
 */
export function keepNavTabInView(tab, align = 'nearest') {
  const nav = tab.closest('.osc-nav');
  if (!nav || nav.scrollWidth <= nav.clientWidth) return;
  const t = tab.getBoundingClientRect();
  const n = nav.getBoundingClientRect();
  const pad = 8;
  if (align === 'start') {
    if (t.left < n.left || t.right > n.right) nav.scrollLeft += t.left - n.left - pad;
  } else if (t.left < n.left + pad) nav.scrollLeft -= n.left + pad - t.left;
  else if (t.right > n.right - pad) nav.scrollLeft += t.right - (n.right - pad);
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
export { NAV_GROUPS };

/** The navigation group holding a workspace, or null for a top-level workspace. */
export function navGroupOf(mode) {
  return Object.keys(NAV_GROUPS).find((g) => NAV_GROUPS[g].includes(mode)) || null;
}

/**
 * Place a group's dropdown under its button. The panel is position: fixed because the nav strip
 * scrolls (overflow-x), which would clip an absolutely positioned child; it stays in the viewport.
 */
export function placeNavPanel(button, panel, win = window) {
  const b = button.getBoundingClientRect();
  const gutter = 8;
  const w = panel.offsetWidth;
  const left = Math.max(gutter, Math.min(b.left, win.innerWidth - w - gutter));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(b.bottom - 6)}px`;
}

/**
 * The heading of a workspace: the heading its own view is labelled by (MEASURE, STUDIO, …), the
 * title of the visually first of its panels on the Playground grid (Analyzer, Filter Lab, …),
 * or the page heading for the Playground. null when none is shown.
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
  const view = own.find((p) => p.classList.contains('osc-view') && shown(p));
  if (view) return labelOf(view);
  const panel = own.filter((p) => p.classList.contains('osc-panel') && shown(p)
    && !p.matches('.osc-p-source, .osc-p-analysis'))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      || a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
  return labelOf(panel);
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

/** Document title for a workspace: the product title, or `OSCILLA · <page>` for a page-like one. */
export function workspaceTitle(mode, base) {
  return WORKSPACE_TITLES[mode] ? `OSCILLA · ${WORKSPACE_TITLES[mode]}` : base;
}

export function createOscillaUi({ storedAnalysisTab = storageGet(ANALYSIS_TAB_KEY) } = {}) {
  return {
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
    menus: { overflow: false, export: false, addBlock: false, actions: false },
    navOpen: null,
    collapsed: { device: false, phase: false, bio: false },

    init() {
      this.theme = resolveTheme(document.documentElement.dataset.theme);
      applyMockFlag();
      syncSliderFill(this.$root);
      this.$root.addEventListener('input', (e) => {
        if (e.target.matches && e.target.matches('input.osc-slider')) {
          e.target.style.setProperty('--osc-fill', sliderFill(e.target));
        }
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.osc-menu-anchor, .osc-sb-actions-wrap')) this.closeMenus();
        if (this.navOpen && !e.target.closest('.osc-nav-group')) this.closeNavGroup();
      });
      // The open group's dropdown follows its button; a resize closes it.
      const nav = this.$root.querySelector('.osc-nav');
      const follow = () => { if (this.navOpen) this.placeNavGroup(this.navOpen); };
      if (nav) nav.addEventListener('scroll', follow, { passive: true });
      window.addEventListener('scroll', follow, { passive: true });
      window.addEventListener('resize', () => this.closeNavGroup());
      // Below 1280 px the nav scrolls in its own strip; browsers do not reliably scroll that strip
      // to a tab reached with Tab / Shift+Tab, so bring it fully into view (WCAG 2.4.11).
      this.$root.addEventListener('focusin', (e) => {
        const tab = e.target && e.target.closest ? e.target.closest('.osc-nav .osc-tab') : null;
        if (tab) keepNavTabInView(tab);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.navOpen) {
          this.closeNavGroup(true);
          return;
        }
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
      this.workspace = mode;
      this.emit('mode', 'mode', mode);
      this.$nextTick(() => {
        this.focusWorkspace(mode);
        if (focusHeading) focusWorkspaceHeading(this.$root, mode);
      });
    },
    focusWorkspace(mode) {
      // Below 1280 px the nav scrolls in its own strip: keep the active top-level entry (the
      // workspace's tab, or its group's button) in view; it may have been chosen elsewhere,
      // e.g. About from the overflow menu.
      const tab = this.$root.querySelector('.osc-nav .osc-tab.is-active');
      if (tab && tab.parentElement.offsetParent !== null) keepNavTabInView(tab, 'start');
      const panels = [...this.$root.querySelectorAll('[data-osc-modes]')];
      panels.forEach((p) => {
        const on = mode !== 'playground' && p.dataset.oscModes.split(/\s+/).includes(mode);
        p.classList.toggle('is-focused', on && p.classList.contains('osc-panel'));
      });
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = reduce ? 'auto' : 'smooth';
      // 768-1279 px shows every panel in two columns (no focus layout): the nav brings the
      // workspace's first panel to the top and rings its panels (CSS .is-focused).
      const tablet = window.matchMedia('(min-width: 768px) and (max-width: 1279.98px)').matches;
      if (mode === 'playground') {
        if (tablet) {
          const main = this.$root.querySelector('.osc-main');
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
    /** What the one Keyboard shortcuts dialog lists in the workspace in view (ADR 0050). */
    keyHelp() {
      return shortcutHelp(this.workspace);
    },
    navItem(mode) {
      return {
        ':class'() { return { 'is-active': this.workspace === mode }; },
        ':aria-current'() { return this.workspace === mode ? 'page' : false; },
        '@click'(e) {
          // The href is the workspace's address (#m=<id>): a modified click opens it in a new
          // tab or window, as the browser does with any link.
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          const group = navGroupOf(mode);
          this.setWorkspace(mode);
          // The item is now hidden: focus returns to its group's button, never to <body>.
          if (group && this.navOpen === group) this.closeNavGroup(true);
        },
      };
    },

    // ---- navigation groups (disclosure: a button with aria-expanded and a list of links) ----
    navGroupButtonEl(group) {
      return this.$root.querySelector(`[data-osc="nav-group.${group}"]`);
    },
    placeNavGroup(group) {
      const btn = this.navGroupButtonEl(group);
      const panel = this.$root.querySelector(`[data-osc-nav-panel="${group}"]`);
      if (btn && panel && !panel.hidden) placeNavPanel(btn, panel);
    },
    navGroupItems(group) {
      const panel = this.$root.querySelector(`[data-osc-nav-panel="${group}"]`);
      return panel ? [...panel.querySelectorAll('a[href]')] : [];
    },
    openNavGroup(group, focus = null) {
      this.closeMenus();
      this.navOpen = group;
      this.$nextTick(() => {
        this.placeNavGroup(group);
        const items = this.navGroupItems(group);
        if (!items.length || !focus) return;
        const current = items.find((a) => a.classList.contains('is-active'));
        const target = focus === 'last' ? items.at(-1) : focus === 'first' ? items[0]
          : (current || items[0]);
        target.focus();
      });
    },
    closeNavGroup(refocus = false) {
      const group = this.navOpen;
      if (!group) return;
      this.navOpen = null;
      if (refocus) {
        const btn = this.navGroupButtonEl(group);
        if (btn) btn.focus();
      }
    },
    navGroup(group) {
      return {
        ':class'() { return { 'is-open': this.navOpen === group }; },
        // Focus moving to another control closes the group (a click on the page is handled by
        // the document listener; relatedTarget is null when focus drops, e.g. WebKit clicks).
        '@focusout'(e) {
          const to = e.relatedTarget;
          if (this.navOpen === group && to && !e.currentTarget.contains(to)) this.navOpen = null;
        },
      };
    },
    navGroupButton(group) {
      return {
        ':class'() { return { 'is-active': navGroupOf(this.workspace) === group }; },
        ':aria-current'() { return navGroupOf(this.workspace) === group ? 'true' : false; },
        ':aria-expanded'() { return String(this.navOpen === group); },
        '@click'() {
          if (this.navOpen === group) this.closeNavGroup();
          else this.openNavGroup(group);
        },
        '@keydown'(e) {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          this.openNavGroup(group, e.key === 'ArrowUp' ? 'last' : 'current');
        },
      };
    },
    navGroupPanel(group) {
      return {
        'data-osc-nav-panel': group,
        ':hidden'() { return this.navOpen !== group; },
        // Arrows/Home/End move among the group's links; Tab leaves in document order.
        '@keydown'(e) {
          const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
          if (!keys.includes(e.key)) return;
          const items = this.navGroupItems(group);
          if (!items.length) return;
          e.preventDefault();
          const i = items.indexOf(document.activeElement);
          let n = 0;
          if (e.key === 'End') n = items.length - 1;
          else if (e.key === 'ArrowDown') n = (i + 1) % items.length;
          else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
          items[n].focus();
        },
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
