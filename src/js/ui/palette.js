// The command palette (plan issue U130, docs/reconstruction/07 section 4.5): ONE search over
// every place, panel, action, template, preset, riff, record and Learn topic, opened by
// Ctrl/Cmd+K (ui/keys/clients.js) and by Enter in the shell's workspace search (ui/shell.js
// navSearchGo). It extends that search: the same fold and the same prefix match (shell.js
// searchWords, queryMatches) over an index DERIVED from the registries, never a hand list:
//
//   place         the workspaces (shell.js WORKSPACE_REGISTRY)
//   action        the navbar's menus' items, read from the page at open (each is the control
//                 the user already has, so its label is the page's Czech label)
//   template      the Studio templates (studio/templates listTemplates)
//   tab, module   the Synth's tabs and panel modules (synth/panels/semi-mono.js), so "lfo"
//                 finds the MG / LFO module beside the LFO node
//   synth-preset  the Synth presets (synth/presets.js PRESETS)
//   preset        the instrument presets (data/presets.js BUILTIN_PRESETS, in Czech through
//                 data/presets-display.js presetShown)
//   riff          the riff library (studio/riffs/library.js RIFFS)
//   learn         the Learn cards (data/learn-display.js LEARN_CARDS_SHOWN)
//   node          the node faces of the UI catalogue (one per Studio node type, ADR 0081)
//   record        the stored experiments, definitions and findings Experiments has listed
//   component     every other declaration of the UI catalogue (ui/catalog/registry.js)
//
// Executing an entry reaches its target through the owner that already has it, never through
// state of its own: a place through setWorkspace (the address follows, ui/navigation.js), a
// template or a record through the one hash dispatcher (the address is assigned and the router
// applies it), a tab, module, preset or riff through the owner's action (synthTab,
// synthPreset, loadPresetFromView, patchLibraryOpen), a node type through the Studio's Add node
// dialog, an action by its own control, a component by showing where it stands (its workspace,
// the dialog or menu holding it, opened by its own opener). The palette holds only what is on
// screen: whether it is open, the query and the active row.
//
//   paletteIndex(sources?) -> [entry]        pure; sources default to the registries
//     entry { id: '<kind>:<key>', kind, key, label, lang, hint, target, w0, w1, w2 }
//     (w0 the label's words, w1 the aliases, w2 the longer text: what the search reads)
//   paletteSearch(index, query) -> [entry]   pure; deterministic: label matches, then alias,
//                                            then text matches, each in kind and index order
//   actionsOfPage(doc) -> [{ hook, label }]  the menus' items of the page
//   recordsOf(cmp) -> [{ kind, id, name }]   what Experiments has listed
//   createPalettePart() -> the component part (paletteShow, paletteClose, paletteRun, ...)
//   bindPaletteKeys is in ui/keys/clients.js (the one key registry).

import { CATALOG } from './catalog/registry.js';
import { hooksOf } from './catalog/define.js';
import { queryMatches, searchWords, WORKSPACE_IDS, WORKSPACE_REGISTRY, GROUP_REGISTRY }
  from './shell.js';
import { focusSafely, openModal } from './dialogs.js';
import { roving } from './keys/roving.js';
import { h, replaceChildren, s as svg } from './studio/graph-dom.js';
import { listTemplates } from '../studio/templates/index.js';
import { NODE_REGISTRY } from '../studio/registry.js';
import { RIFFS } from '../studio/riffs/library.js';
import { PRESETS as SYNTH_PRESETS } from '../synth/presets.js';
import SEMI_MONO from '../synth/panels/semi-mono.js';
import { BUILTIN_PRESETS } from '../data/presets.js';
import { PRESET_CATEGORY_NAMES, presetShown } from '../data/presets-display.js';
import { LEARN_CARDS } from '../data/learn.js';
import { LEARN_CARDS_SHOWN } from '../data/learn-display.js';
import { encodeStudioLink } from '../core/url-state-studio.js';
import { encodeRecordLink } from '../core/url-state-records.js';
import { encodeSynthLink } from '../core/url-state-synth.js';

/** The kinds of entry, in the order the palette lists them, with their Czech names. */
export const PALETTE_KINDS = Object.freeze([
  ['place', 'Pracovní plocha'], ['action', 'Akce'], ['template', 'Šablona Studia'],
  ['tab', 'Záložka Synthu'], ['module', 'Modul Synthu'], ['synth-preset', 'Předvolba Synthu'],
  ['preset', 'Předvolba nástroje'], ['riff', 'Riff'], ['learn', 'Výuka'],
  ['node', 'Uzel Studia'], ['record', 'Záznam'], ['component', 'Ovládací prvek'],
].map(([id, label]) => Object.freeze({ id, label })));
const KIND_ORDER = new Map(PALETTE_KINDS.map((k, i) => [k.id, i]));
export const PALETTE_KIND_LABELS = Object.freeze(Object.fromEntries(PALETTE_KINDS
  .map((k) => [k.id, k.label])));

/** The Czech name of each node category of the Studio registry (shown beside a node type). */
export const NODE_CATEGORY_NAMES = Object.freeze({ SOURCES: 'Zdroje', MODULATION: 'Modulace',
  PROCESSING: 'Zpracování', ANALYSIS: 'Analýza', OUTPUT: 'Výstup', MEASUREMENT: 'Měření' });

/** The Czech name of each catalogue kind (ui/catalog/kinds.js KINDS). */
export const COMPONENT_KIND_NAMES = Object.freeze({ param: 'Parametr', switch: 'Přepínač',
  choice: 'Volba', transport: 'Transport', action: 'Akce', readout: 'Ukazatel',
  empty: 'Prázdný stav', open: 'Odkaz', fullscreen: 'Celá obrazovka', panel: 'Panel',
  workspace: 'Pracovní plocha', 'node-face': 'Uzel Studia', edge: 'Kabely', clip: 'Klip',
  'step-grid': 'Mřížka kroků' });

/** The Czech name of each record kind (core/url-state-records.js RECORD_KINDS). */
export const RECORD_KIND_NAMES = Object.freeze({ experiment: 'Experiment',
  definition: 'Definice', finding: 'Zjištění' });

/** How many rows the list renders at once; the status says how many more were found. */
export const PALETTE_LIMIT = 50;

const words = (...parts) => searchWords(parts.flat().filter(Boolean).join(' '));
const WS_IDS = new Set(WORKSPACE_IDS);

function entry(kind, key, { label, lang = null, hint = '', aliases = [], text = [], target }) {
  return Object.freeze({ id: `${kind}:${key}`, kind, key: String(key), label: String(label),
    lang, hint: hint || PALETTE_KIND_LABELS[kind], target: Object.freeze(target),
    w0: Object.freeze(words(label)), w1: Object.freeze(words(aliases, key)),
    w2: Object.freeze(words(text)) });
}

/** The workspace a catalogue id names by its first segment (`studio.tl.tap` -> studio). */
function workspaceOfId(id) {
  const first = String(id).split(/[.-]/)[0];
  return WS_IDS.has(first) ? first : null;
}

/** The registries the index is derived from (the defaults of paletteIndex). */
export function paletteSources() {
  return {
    workspaces: WORKSPACE_REGISTRY,
    templates: listTemplates(),
    synthTabs: SEMI_MONO.tabs,
    synthModules: SEMI_MONO.modules,
    synthPresets: SYNTH_PRESETS,
    presets: BUILTIN_PRESETS,
    riffs: RIFFS,
    learn: LEARN_CARDS_SHOWN,
    learnSource: LEARN_CARDS,
    catalog: CATALOG.list(),
    nodes: NODE_REGISTRY,
    actions: [],
    records: [],
  };
}

/** The palette's entries, derived from `sources` (paletteSources plus actions and records). */
export function paletteIndex(given = {}) {
  const s = { ...paletteSources(), ...given };
  const out = [];
  for (const w of s.workspaces) {
    const group = w.group && GROUP_REGISTRY[w.group] ? GROUP_REGISTRY[w.group].label : '';
    // A place's English words (the registry's `words`) find it as its label does: the
    // navigation is the palette's first kind, and "seq" or "filter" still lead to the page.
    const e = entry('place', w.id, { label: w.label, lang: w.lang || null,
      hint: group ? `${PALETTE_KIND_LABELS.place} · ${group}` : '',
      aliases: [group, w.group], text: [w.summary], target: { route: w.id } });
    out.push(Object.freeze({ ...e, w0: Object.freeze(words(w.label, w.words)) }));
  }
  for (const a of s.actions) {
    out.push(entry('action', a.hook, { label: a.label, aliases: [a.hook.split('.')],
      target: { click: a.hook } }));
  }
  for (const t of s.templates) {
    out.push(entry('template', t.id, { label: t.title, lang: 'en',
      aliases: [t.category, 'template', 'šablona', 'studio'], text: [t.learn && t.learn.summary],
      target: { href: `#${encodeStudioLink({ templateId: t.id })}` } }));
  }
  for (const t of s.synthTabs) {
    out.push(entry('tab', t.id, { label: `Synth: ${t.label}`,
      aliases: [t.title, 'tab', 'záložka'], text: [t.description],
      target: { href: `#${encodeSynthLink({ tab: t.id })}`, synthTab: t.id } }));
  }
  const tabLabel = new Map(s.synthTabs.map((t) => [t.id, t.label]));
  for (const m of s.synthModules) {
    const def = s.nodes.get(m.node);
    const tab = m.tab || (s.synthTabs[0] && s.synthTabs[0].id);
    out.push(entry('module', m.id, { label: m.label,
      hint: `${PALETTE_KIND_LABELS.module} · ${tabLabel.get(tab) || tab}`,
      aliases: [m.node, def && def.displayName, def && def.aliases, 'synth', 'modul', 'module'],
      text: [def && def.help && def.help.what],
      // The Synth link names the tab and, on the Engines tab, the engine shown (yt, ye).
      target: { href: `#${encodeSynthLink({ tab, engine: m.id })}`, module: m.id, tab } }));
  }
  for (const p of s.synthPresets) {
    out.push(entry('synth-preset', p.id, { label: p.title,
      aliases: [p.tab, p.engine, 'synth', 'preset', 'předvolba'],
      target: { synthPreset: p.id } }));
  }
  for (const raw of s.presets) {
    const p = presetShown(raw);
    const cat = PRESET_CATEGORY_NAMES[raw.cat] || raw.cat;
    out.push(entry('preset', raw.id, { label: p.name,
      hint: `${PALETTE_KIND_LABELS.preset} · ${cat}`,
      aliases: [raw.name, cat, raw.cat, 'preset', 'předvolba'], text: [p.desc, raw.desc],
      target: { preset: raw.id } }));
  }
  for (const r of s.riffs) {
    out.push(entry('riff', r.id, { label: r.title, lang: 'en',
      hint: `${PALETTE_KIND_LABELS.riff} · ${r.genre}`,
      aliases: [r.genre, r.role, r.key, 'riff'], text: [r.style],
      target: { riff: r.id, query: r.title } }));
  }
  const english = new Map((s.learnSource || []).map((c) => [c.id, c]));
  for (const c of s.learn) {
    const en = english.get(c.id);
    out.push(entry('learn', c.id, { label: c.title,
      aliases: [en && en.title, 'learn', 'výuka', 'lekce'], text: [c.body],
      target: { learn: c.id } }));
  }
  for (const d of s.catalog) {
    if (d.kind !== 'node-face') continue;
    const type = d.id.slice('studio.node.'.length);
    const def = s.nodes.get(type);
    const cat = def ? NODE_CATEGORY_NAMES[def.category] || def.category : '';
    out.push(entry('node', type, { label: d.label,
      hint: cat ? `${PALETTE_KIND_LABELS.node} · ${cat}` : '',
      aliases: [type, def && def.aliases, cat, def && def.category, 'node', 'uzel', 'studio'],
      text: [d.docs], target: { node: type, name: d.label } }));
  }
  for (const r of s.records) {
    out.push(entry('record', `${r.kind}:${r.id}`, { label: r.name || r.id,
      hint: `${PALETTE_KIND_LABELS.record} · ${RECORD_KIND_NAMES[r.kind] || r.kind}`,
      aliases: [r.kind, RECORD_KIND_NAMES[r.kind]],
      target: { href: `#${encodeRecordLink({ kind: r.kind, id: r.id })}` } }));
  }
  for (const d of s.catalog) {
    if (d.kind === 'node-face') continue;
    const parents = [];
    const byId = (id) => s.catalog.find((x) => x.id === id) || {};
    for (let p = d.in; p && !parents.includes(p); p = byId(p).in) parents.push(p);
    out.push(entry('component', d.id, { label: d.label,
      hint: `${PALETTE_KIND_LABELS.component} · ${COMPONENT_KIND_NAMES[d.kind] || d.kind}`,
      aliases: [d.id.split(/[.-]/), d.kind, COMPONENT_KIND_NAMES[d.kind]], text: [d.docs],
      // Its opener, or the opener of the container it stands in (the patch library's fields
      // open with the library: library.openedBy).
      target: { reveal: hooksOf(d), parents,
        openedBy: [d, ...parents.map(byId)].flatMap((x) => (x.links && x.links.openedBy) || []),
        fallback: workspaceOfId(d.id) } }));
  }
  return out;
}

/**
 * The registry items that do not have exactly one entry in `index` (each as the entry id it
 * should have): [] when the index covers every source. What the unit test holds the index to.
 */
export function paletteMissing(index, given = {}) {
  const s = { ...paletteSources(), ...given };
  const want = [
    ...s.workspaces.map((w) => `place:${w.id}`),
    ...s.templates.map((t) => `template:${t.id}`),
    ...s.synthTabs.map((t) => `tab:${t.id}`),
    ...s.synthModules.map((m) => `module:${m.id}`),
    ...s.synthPresets.map((p) => `synth-preset:${p.id}`),
    ...s.presets.map((p) => `preset:${p.id}`),
    ...s.riffs.map((r) => `riff:${r.id}`),
    ...s.learn.map((c) => `learn:${c.id}`),
    ...s.catalog.map((d) => (d.kind === 'node-face' ? `node:${d.id.slice('studio.node.'.length)}`
      : `component:${d.id}`)),
    ...s.actions.map((a) => `action:${a.hook}`),
    ...s.records.map((r) => ['record', r.kind, r.id].join(':')),
  ];
  const have = new Map();
  for (const e of index) have.set(e.id, (have.get(e.id) || 0) + 1);
  return want.filter((id) => have.get(id) !== 1);
}

/** The lowest tier (0 label, 1 alias, 2 text) at which every word of the query matches. */
export function matchTier(e, query) {
  const parts = searchWords(query);
  if (!parts.length) return 0;
  let tier = 0;
  for (const part of parts) {
    if (queryMatches(e.w0, part)) continue;
    if (queryMatches(e.w1, part)) tier = Math.max(tier, 1);
    else if (queryMatches(e.w2, part)) tier = 2;
    else return -1;
  }
  return tier;
}

/** The entries `query` finds, ordered by tier, then kind, then index order. Deterministic. */
export function paletteSearch(index, query) {
  const found = [];
  index.forEach((e, i) => {
    const tier = matchTier(e, query);
    if (tier >= 0) found.push({ e, i, tier });
  });
  found.sort((a, b) => a.tier - b.tier || KIND_ORDER.get(a.e.kind) - KIND_ORDER.get(b.e.kind)
    || a.i - b.i);
  return found.map((x) => x.e);
}

/** The status line of a search: how many it found and how many the list shows. */
export function paletteStatus(n, shown = Math.min(n, PALETTE_LIMIT)) {
  if (!n) return 'Nic nenalezeno.';
  const noun = n === 1 ? 'výsledek' : n >= 2 && n <= 4 ? 'výsledky' : 'výsledků';
  return shown < n ? `${n} ${noun}, zobrazeno prvních ${shown}; upřesněte hledání.`
    : `${n} ${noun}; Enter otevře vybraný.`;
}

/** The navbar's menus' items (More, Export): [{ hook, label }], each hook once. The menus of a
 *  workspace's own panels are not actions of the page: their controls are catalogue entries. */
export function actionsOfPage(doc = document) {
  const out = [];
  const seen = new Set();
  const items = '[role="banner"] [data-osc-menu-panel] [role^="menuitem"][data-osc]';
  for (const el of doc.querySelectorAll(items)) {
    const hook = el.getAttribute('data-osc');
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ')
      .trim();
    if (!hook || !label || seen.has(hook)) continue;
    seen.add(hook);
    out.push({ hook, label });
  }
  return out;
}

/** The stored records Experiments has listed (its experiments, definitions and findings). */
export function recordsOf(cmp) {
  const exps = (cmp && cmp.exps) || {};
  const fnd = (cmp && cmp.fnd) || {};
  return [
    ...(exps.rows || []).map((r) => ({ kind: 'experiment', id: r.id, name: r.name })),
    ...(exps.defs || []).map((d) => ({ kind: 'definition', id: d.id, name: d.name })),
    ...(fnd.rows || []).map((r) => ({ kind: 'finding', id: r.id, name: r.statement })),
  ].filter((r) => r.id);
}

// The Pro modal's classes (the reference's modal and dropdown rows), written out in full so
// the build's Tailwind scan compiles them.
export const PALETTE_CLASSES = Object.freeze({
  // The root's Pro modal structure (bg-white rounded-lg shadow dark:bg-gray-800) is written in
  // src/index.html, where the Flowbite Pro record reads it; these complete it.
  dialog: 'w-[calc(100%-1rem)] max-w-2xl p-0 mx-auto mt-2 md:mt-[10vh] overflow-hidden '
    + 'text-gray-900 border border-solid border-gray-200 backdrop:bg-gray-900/50 '
    + 'dark:border-gray-700 dark:text-white',
  head: 'flex items-center gap-2 p-3 border-0 border-b border-solid border-gray-200 '
    + 'dark:border-gray-700',
  input: 'block w-full h-11 p-2.5 pl-10 text-base md:text-sm text-gray-900 bg-gray-50 border '
    + 'border-solid border-gray-300 rounded-lg focus:outline-none focus:ring-2 '
    + 'focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 '
    + 'dark:text-white',
  icon: 'absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-500 '
    + 'dark:text-gray-400',
  close: 'inline-flex items-center justify-center shrink-0 w-11 h-11 text-gray-500 rounded-lg '
    + 'hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 '
    + 'focus-visible:ring-primary-300 dark:text-gray-300 dark:hover:bg-gray-700 '
    + 'dark:hover:text-white',
  list: 'max-h-[60vh] md:max-h-96 overflow-y-auto py-1 m-0 list-none',
  option: 'flex items-center gap-3 px-4 py-2 min-h-11 text-sm text-gray-700 cursor-pointer '
    + 'hover:bg-gray-100 aria-selected:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 '
    + 'dark:aria-selected:bg-gray-700',
  label: 'flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-white',
  badge: 'shrink-0 px-2.5 py-0.5 text-xs font-medium rounded text-primary-800 bg-primary-100 '
    + 'dark:bg-primary-900 dark:text-primary-300',
  foot: 'flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-gray-600 '
    + 'border-0 border-t border-solid border-gray-200 dark:text-gray-300 dark:border-gray-700',
});

export const PALETTE_DIALOG_ID = 'osc-dlg-palette';
const INPUT_ID = 'palette-input';
const LIST_ID = 'palette-list';
const STATUS_ID = 'palette-status';
const optionId = (i) => `palette-opt-${i}`;
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

const icon = (id) => svg('svg', { class: 'w-5 h-5', 'aria-hidden': 'true' },
  [svg('use', { href: `#${id}` })]);
/** The selector of the elements carrying a catalogue hook (a declared one, never built here). */
const hookSelector = (hook) => `[data-osc=${JSON.stringify(String(hook))}]`;
/** Laid out with a box (an empty 0 x 0 container is not shown: nothing there takes focus). */
const shownEl = (el) => {
  const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
  return !!r && (r.width > 0 || r.height > 0);
};
/** The element of the first of `hooks` on the page, a shown one first. */
function elementOf(doc, hooks) {
  for (const hook of hooks) {
    const all = [...doc.querySelectorAll(hookSelector(hook))];
    const el = all.find(shownEl) || all[0];
    if (el) return el;
  }
  return null;
}

/**
 * Run `fn(el)` once `get()` returns an element that is shown, trying for up to a second (a
 * route, a dialog or a list renders on its owner's next tick); `miss()` when it never is.
 */
let runs = 0; // the palette's runs: a later run cancels what an earlier one still waits for
function whenShown(get, fn, miss = () => {}, run = runs, tries = 20) {
  if (run !== runs) return;
  const el = get();
  if (shownEl(el)) fn(el);
  else if (tries > 0) setTimeout(() => whenShown(get, fn, miss, run, tries - 1), 50);
  else miss();
}

/** Focus `el` where it stands: a control itself, anything else made focusable by script. */
function focusThere(el) {
  if (!el) return false;
  if (!el.matches(FOCUSABLE) || el.disabled) {
    const inner = [...el.querySelectorAll(FOCUSABLE)].find((x) => shownEl(x) && !x.disabled);
    if (inner) el = inner;
    else if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  }
  el.scrollIntoView({ block: 'nearest' });
  el.focus({ preventScroll: true });
  return el.ownerDocument.activeElement === el;
}

/** The component part: the palette's UI-only state (open, query, active row) and its actions. */
export function createPalettePart() {
  let ui = null; // { dialog, input, list, status } once built
  let opener = null;
  let index = null;
  let results = [];
  return {
    paletteOpen: false,
    paletteQuery: '',
    paletteActive: 0,

    /** Build the palette into its empty dialog of src/index.html, once. */
    paletteInit(doc = typeof document === 'undefined' ? null : document) {
      if (!doc || typeof doc.getElementById !== 'function') return;
      const dialog = doc.getElementById(PALETTE_DIALOG_ID);
      if (!dialog || ui) return;
      const C = PALETTE_CLASSES;
      dialog.classList.add(...C.dialog.split(' '));
      dialog.setAttribute('aria-labelledby', 'palette-title');
      const input = h('input', { type: 'text', id: INPUT_ID, 'data-osc': 'palette.input',
        class: C.input, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': LIST_ID,
        'aria-autocomplete': 'list', 'aria-describedby': STATUS_ID, autocomplete: 'off',
        spellcheck: 'false', enterkeyhint: 'go',
        onInput: () => { this.paletteQuery = input.value; this.paletteActive = 0;
          this.paletteRender(); } });
      const list = h('ul', { id: LIST_ID, role: 'listbox', 'aria-label': 'Výsledky',
        'data-osc': 'palette.list', class: C.list,
        onClick: (e) => {
          const li = e.target.closest('[role="option"]');
          if (li) this.paletteRun(results[Number(li.dataset.index)]);
        },
        onMousemove: (e) => {
          const li = e.target.closest('[role="option"]');
          if (li && Number(li.dataset.index) !== this.paletteActive) {
            this.paletteActive = Number(li.dataset.index);
            this.paletteMark();
          }
        } });
      const status = h('p', { id: STATUS_ID, role: 'status', 'aria-live': 'polite',
        class: 'text-xs' });
      const form = h('form', { role: 'search', class: 'relative flex-1',
        onSubmit: (e) => { e.preventDefault(); this.paletteGo(); } }, [
        h('label', { for: INPUT_ID, class: 'sr-only', text: 'Hledat v celé aplikaci' }),
        h('div', { class: C.icon, 'aria-hidden': 'true' }, [icon('s-search')]),
        input]);
      replaceChildren(dialog, [
        h('h2', { id: 'palette-title', class: 'sr-only', text: 'Paleta příkazů' }),
        h('div', { class: C.head }, [form,
          h('button', { type: 'button', class: C.close, 'aria-label': 'Zavřít paletu',
            onClick: () => this.paletteClose() }, [icon('i-close')])]),
        list,
        h('div', { class: C.foot }, [status,
          h('span', { 'aria-hidden': 'true',
            text: '↑ ↓ výběr · Enter otevře · Esc zavře' })]),
      ]);
      // A close by the backdrop (dialogs.js watchDialogs); the event comes a task later, so a
      // palette opened again since keeps its state.
      dialog.addEventListener('close', () => { if (!dialog.open) this.paletteOpen = false; });
      // Arrows, Home and End move the active row while the input keeps focus (a combobox,
      // aria-activedescendant); Escape closes the palette and is consumed, so the page's
      // Escape (stopAll) never runs with it and the sound plays on.
      roving(dialog, { count: () => Math.min(results.length, PALETTE_LIMIT),
        index: () => this.paletteActive, homeEndInText: true, wrap: true,
        move: (i) => { this.paletteActive = i; this.paletteMark(); },
        escape: () => { this.paletteClose(); return true; } });
      ui = { dialog, input, list, status };
    },

    /** Open the palette with `query` (the shell search's text), focus in its input. */
    paletteShow({ query = '' } = {}) {
      if (!ui) this.paletteInit();
      if (!ui) return false;
      if (typeof this.closeMenus === 'function') this.closeMenus();
      const a = document.activeElement;
      const outside = a && a !== document.body && !ui.dialog.contains(a);
      if (!this.paletteOpen) opener = outside ? a : null;
      index = paletteIndex({ actions: actionsOfPage(document), records: recordsOf(this) });
      this.paletteQuery = String(query || '');
      ui.input.value = this.paletteQuery;
      this.paletteActive = 0;
      this.paletteRender();
      if (!ui.dialog.open) openModal(PALETTE_DIALOG_ID);
      this.paletteOpen = true;
      ui.input.focus();
      ui.input.select();
      return true;
    },
    /** Close; focus goes back to where it was when the palette opened, unless `focus` false. */
    paletteClose({ focus = true } = {}) {
      if (!ui || !ui.dialog.open) {
        this.paletteOpen = false;
        return;
      }
      ui.dialog.removeAttribute('aria-modal');
      ui.dialog.close();
      this.paletteOpen = false;
      if (focus) focusSafely(opener);
    },
    paletteToggle() {
      if (this.paletteOpen) this.paletteClose();
      else this.paletteShow();
    },
    /** The entries the query finds now (the whole list; the dialog renders PALETTE_LIMIT). */
    paletteResults() {
      if (!index) {
        index = paletteIndex({ actions: actionsOfPage(document), records: recordsOf(this) });
      }
      return paletteSearch(index, this.paletteQuery);
    },
    paletteRender() {
      results = this.paletteResults();
      if (!ui) return;
      const n = Math.min(results.length, PALETTE_LIMIT);
      if (this.paletteActive >= n) this.paletteActive = 0;
      replaceChildren(ui.list, results.slice(0, n).map((e, i) => h('li', {
        role: 'option', id: optionId(i), 'data-index': i, 'data-entry': e.id,
        'aria-selected': String(i === this.paletteActive), class: PALETTE_CLASSES.option }, [
        h('span', { class: PALETTE_CLASSES.label, lang: e.lang, text: e.label }),
        h('span', { class: PALETTE_CLASSES.badge, text: e.hint })])));
      ui.status.textContent = paletteStatus(results.length, n);
      this.paletteMark();
    },
    /** Mark the active row (aria-selected, aria-activedescendant) and keep it in view. */
    paletteMark() {
      if (!ui) return;
      const opts = ui.list.querySelectorAll('[role="option"]');
      opts.forEach((li, i) => li.setAttribute('aria-selected', String(i === this.paletteActive)));
      const on = opts[this.paletteActive];
      if (on) {
        ui.input.setAttribute('aria-activedescendant', on.id);
        on.scrollIntoView({ block: 'nearest' });
      } else ui.input.removeAttribute('aria-activedescendant');
    },
    /** Enter: run the active row. */
    paletteGo() {
      const e = results[this.paletteActive];
      if (e) this.paletteRun(e);
    },
    /** The entry of `id` in the index as the palette holds it now (the link-walk's seam). */
    paletteEntry(id) {
      if (!index) this.paletteResults();
      return index.find((e) => e.id === id) || null;
    },

    /**
     * Run `entry`: the palette closes (focus back where it was), then the entry's owner takes
     * it to its target. Returns what it did: 'route', 'link', 'action', 'shown', 'absent'.
     */
    paletteRun(entry) {
      if (!entry) return null;
      runs += 1;
      const t = entry.target;
      this.paletteClose();
      const later = (fn) => this.$nextTick(fn);
      if (t.route) {
        this.setWorkspace(t.route, { focusHeading: true });
        return 'route';
      }
      if (t.href) {
        // The one hash dispatcher (ui/navigation.js) applies the address, as a followed link;
        // a Synth tab or module is then shown by the Synth's own tab action and focused.
        const after = () => {
          if (!t.synthTab && !t.module) return;
          if (typeof this.synthTab === 'function') this.synthTab(t.synthTab || t.tab);
          if (t.module) {
            whenShown(() => document.querySelector(`[data-module="${t.module}"]`), focusThere);
          }
        };
        if (window.location.hash === t.href) later(after);
        else {
          window.addEventListener('hashchange', () => later(after), { once: true });
          window.location.hash = t.href.slice(1); // data-osc-link: palette
        }
        return 'link';
      }
      if (t.click) {
        const el = elementOf(document, [t.click]);
        if (el) el.click();
        return el ? 'action' : 'absent';
      }
      if (t.synthPreset) {
        this.setWorkspace('synth');
        later(() => {
          if (typeof this.synthPreset === 'function') this.synthPreset(t.synthPreset);
        });
        return 'action';
      }
      if (t.preset) {
        const p = BUILTIN_PRESETS.find((x) => x.id === t.preset);
        this.setWorkspace('presets');
        if (p && typeof this.loadPresetFromView === 'function') {
          this.loadPresetFromView(presetShown(p));
        }
        return 'action';
      }
      if (t.riff) {
        if (typeof this.patchLibraryOpen === 'function') this.patchLibraryOpen({ query: t.query });
        return 'action';
      }
      if (t.learn) {
        this.setWorkspace('learn');
        this.learnTopic = t.learn;
        whenShown(() => document.querySelector(`[data-topic="${t.learn}"] h3`), focusThere);
        return 'action';
      }
      if (t.node) {
        this.setWorkspace('studio');
        later(() => {
          if (typeof this.studioAddNode !== 'function') return;
          this.studioAddNode();
          // The Add node dialog's own search, through the control (its input event).
          const search = document.querySelector('[data-osc="studio.add.search"]');
          if (search) {
            search.value = t.name;
            search.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        return 'action';
      }
      if (t.reveal) return this.paletteReveal(entry);
      return null;
    },

    /**
     * Show a catalogue component where it stands: its workspace (data-osc-modes), the dialog
     * holding it (opened by its declared opener, else as a plain modal), the menu holding it;
     * then focus it. A component the page has not built yet (a state that creates it) leads to
     * its nearest declared container, else to the workspace its id names, and says so.
     */
    paletteReveal(entry) {
      const t = entry.target;
      const el = elementOf(document, t.reveal) || elementOf(document, t.parents);
      if (!el) {
        if (t.fallback && t.fallback !== this.workspace) this.setWorkspace(t.fallback);
        this.announceText = `${entry.label}: tento prvek stránka ukáže až ve stavu, který ho `
          + 'vytvoří.';
        return 'absent';
      }
      const dlg = el.closest('dialog');
      if (dlg && dlg.id === PALETTE_DIALOG_ID) {
        this.paletteShow();
        return 'shown';
      }
      if (dlg && !dlg.open) {
        const by = elementOf(document, t.openedBy);
        if (by) by.click();
        else if (!dlg.hasAttribute('data-osc-studio-dialog')) openModal(dlg.id);
      } else if (!dlg) {
        const home = el.closest('[data-osc-modes]');
        const modes = home ? home.dataset.oscModes.split(/\s+/) : [];
        if (modes.length && !modes.includes(this.workspace) && WS_IDS.has(modes[0])) {
          this.setWorkspace(modes[0]);
        }
        const menu = el.closest('[data-osc-menu-panel]');
        if (menu && this.menus && menu.dataset.oscMenuPanel in this.menus) {
          this.menus[menu.dataset.oscMenuPanel] = true;
        }
      }
      // The workspace, dialog or menu shows it on Alpine's next render, or once its own owner
      // has rendered (a list read when its workspace is entered): focus it then.
      whenShown(() => (el.isConnected ? el : elementOf(document, t.reveal)), focusThere, () => {
        this.announceText = `${entry.label}: na této obrazovce teď není vidět.`;
      });
      return 'shown';
    },
  };
}
