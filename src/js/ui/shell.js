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
// shortcut dialog's names (ui/shortcuts.js) and the README's navigation paragraph all follow
// from it; there is no second list.

/** The workspaces, in navigation order. group: the sidebar group holding it, or none. */
export const WORKSPACE_REGISTRY = Object.freeze([
  { id: 'playground', label: 'Playground', words: 'instrument tone oscillator play hold' },
  { id: 'measure', label: 'Measure', words: 'frequency response sweep impulse room test' },
  { id: 'experiments', label: 'Experiments', words: 'saved records findings compare history' },
  { id: 'analyzer', label: 'Analyzer', group: 'analyze', words: 'spectrum microphone fft rta' },
  { id: 'filter', label: 'Filter Lab', group: 'analyze', words: 'lowpass highpass eq curve' },
  { id: 'compare', label: 'Compare', group: 'analyze', words: 'phase hearing ranges bio' },
  { id: 'synthesis', label: 'Synthesis', group: 'synthesis',
    words: 'envelope adsr additive harmonics dual binaural' },
  { id: 'sequencer', label: 'Sequencer', group: 'synthesis', words: 'pattern steps blocks song' },
  { id: 'presets', label: 'Presets', group: 'synthesis', words: 'library load sounds' },
  { id: 'learn', label: 'Learn', words: 'lessons guide acoustics' },
  { id: 'studio', label: 'Studio', words: 'graph nodes cables timeline patch' },
  { id: 'about', label: 'About', words: 'credits licence version' },
].map((w) => Object.freeze({ ...w, icon: `i-ws-${w.id}` })));

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
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !this.drawerOpen || document.querySelector('dialog[open]')) {
          return;
        }
        e.preventDefault();
        this.closeDrawer(true);
      });
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
        '@keydown'(e) { this.sidebarKeydown(e); },
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
    navSearchKeydown(e) {
      if (e.key === 'Escape' && this.navQuery) {
        e.preventDefault();
        e.stopPropagation();
        this.navQuery = '';
      } else if (e.key === 'ArrowDown') {
        const [first] = sidebarEntries(this.$root);
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    },

    // ---- keyboard in the sidebar: the arrows walk its entries, Escape steps back ----
    sidebarKeydown(e) {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      const entries = sidebarEntries(this.$root);
      const i = entries.indexOf(document.activeElement);
      if (keys.includes(e.key) && i >= 0) {
        e.preventDefault();
        let n = 0;
        if (e.key === 'End') n = entries.length - 1;
        else if (e.key === 'ArrowDown') n = (i + 1) % entries.length;
        else if (e.key === 'ArrowUp') n = (i - 1 + entries.length) % entries.length;
        entries[n].focus();
        return;
      }
      if (e.key !== 'Escape' || this.drawerOpen) return;
      // In an expanded group's list, Escape collapses the group and focus returns to its button.
      const list = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('[data-osc-nav-panel]') : null;
      if (!list) return;
      e.preventDefault();
      const group = list.dataset.oscNavPanel;
      this.toggleNavGroup(group, false);
      const btn = this.$root.querySelector(`[data-osc="nav-group.${group}"]`);
      if (btn) btn.focus();
    },
  };
}
