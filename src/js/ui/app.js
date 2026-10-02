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

const THEME_KEY = 'oscilla.v2.theme';
const ANALYSIS_TAB_KEY = 'oscilla.v2.analysisTab';
const ANALYSIS_TABS = ['waveform', 'spectrum', 'spectrogram', 'harmonics', 'signalPath'];
const MODES = [
  'playground', 'sequencer', 'analyzer', 'filter', 'synthesis', 'compare', 'learn', 'presets',
];
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
      });
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
    setWorkspace(mode) {
      if (!MODES.includes(mode)) return;
      this.workspace = mode;
      this.emit('mode', 'mode', mode);
      this.$nextTick(() => this.focusWorkspace(mode));
    },
    focusWorkspace(mode) {
      const panels = [...this.$root.querySelectorAll('[data-osc-modes]')];
      panels.forEach((p) => {
        const on = mode !== 'playground' && p.dataset.oscModes.split(/\s+/).includes(mode);
        p.classList.toggle('is-focused', on && p.classList.contains('osc-panel'));
      });
      if (mode === 'playground') return;
      const target = panels.find((p) => p.dataset.oscModes.split(/\s+/).includes(mode)
        && p.offsetParent !== null && !p.matches('.osc-p-source, .osc-p-analysis'));
      if (target) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      }
    },
    navItem(mode) {
      return {
        ':class'() { return { 'is-active': this.workspace === mode }; },
        ':aria-current'() { return this.workspace === mode ? 'page' : false; },
        '@click'(e) { e.preventDefault(); this.setWorkspace(mode); },
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
