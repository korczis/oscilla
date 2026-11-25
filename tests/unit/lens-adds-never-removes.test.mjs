// Sonda adds, never removes (plan issue U146, src/js/ui/lens.js and src/js/ui/shell.js): in a
// place whose own analysis panel is shown the Sonda button brings that panel into view instead
// of moving its view into the sheet; the sheet ends above the docked keys and, from lg up,
// reflows the column beside it instead of covering it; and with the sheet open Escape closes it
// first wherever the focus is, the sidebar included. The places are read from the panel's own
// data-osc-modes in src/index.html, the sheet's classes from its markup, the reflow from the
// shell's own binding; each decision has mutation cases that a wrong implementation fails.
//   node --test tests/unit/lens-adds-never-removes.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LENS_PANEL_ID, bindLensKeys, createLensPart, lensInPlace,
} from '../../src/js/ui/lens.js';
import { WORKSPACE_IDS, createShell, shellEscape } from '../../src/js/ui/shell.js';
import { createKeyRegistry } from '../../src/js/ui/keys/registry.js';
import { createKeyDispatcher } from '../../src/js/ui/keys/dispatcher.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

/** The opening tag of the element with `id` in the markup. */
function tagOf(id) {
  const at = HTML.indexOf(`id="${id}"`);
  assert.ok(at > 0, `${id} is in src/index.html`);
  const start = HTML.lastIndexOf('<', at);
  return HTML.slice(start, HTML.indexOf('>', at) + 1);
}
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const PANEL_MODES = attr(tagOf(LENS_PANEL_ID), 'data-osc-modes');

// ------------------------------------------------------------------ 1. which places get the sheet

test('lensInPlace: the places the panel\'s own data-osc-modes lists, every other one gets the '
  + 'sheet', () => {
  assert.ok(PANEL_MODES && PANEL_MODES.trim(), 'the analysis panel names its places');
  const listed = PANEL_MODES.split(/\s+/);
  const inPlace = WORKSPACE_IDS.filter((ws) => lensInPlace(ws, PANEL_MODES));
  assert.deepEqual(inPlace, WORKSPACE_IDS.filter((ws) => listed.includes(ws)),
    'exactly the registry workspaces the markup lists');
  assert.ok(inPlace.length >= 1 && inPlace.length < WORKSPACE_IDS.length,
    'some places show the panel, the rest are served by the sheet');
  for (const ws of ['synth', 'measure', 'studio']) {
    assert.equal(lensInPlace(ws, PANEL_MODES), listed.includes(ws), ws);
  }
  // Mutation cases: a substring, an empty workspace, a missing list, another separator.
  assert.equal(lensInPlace('play', 'playground analyzer'), false, 'a substring is no place');
  assert.equal(lensInPlace('synth', 'synthesis'), false, 'synth is not synthesis');
  assert.equal(lensInPlace('', 'playground'), false);
  assert.equal(lensInPlace(null, 'playground'), false);
  assert.equal(lensInPlace('playground', null), false);
  assert.equal(lensInPlace('playground', undefined), false);
  assert.equal(lensInPlace('analyzer', 'playground  analyzer\nsynthesis'), true,
    'any whitespace separates the list');
});

/** A component double: the lens part over a fake document holding the panel, its view, its
 *  selected tab, the slot and the Sonda buttons. */
function placeComponent(workspace) {
  const byId = new Map();
  const el = (id, extra = {}) => {
    const n = { id, nodeType: 1, parentNode: null, childNodes: [], focused: 0, focusOpts: null,
      dataset: {}, getClientRects: () => [{}],
      focus(o) { n.focused += 1; n.focusOpts = o || null; },
      appendChild(c) { detach(c); c.parentNode = n; n.childNodes.push(c); return c; },
      insertBefore(c, ref) {
        detach(c);
        c.parentNode = n;
        n.childNodes.splice(n.childNodes.indexOf(ref), 0, c);
        return c;
      },
      replaceChild(c, old) {
        detach(c);
        n.childNodes[n.childNodes.indexOf(old)] = c;
        c.parentNode = n;
        old.parentNode = null;
        return old;
      }, ...extra };
    if (id) byId.set(id, n);
    return n;
  };
  const detach = (c) => {
    if (!c.parentNode) return;
    const kids = c.parentNode.childNodes;
    kids.splice(kids.indexOf(c), 1);
    c.parentNode = null;
  };
  const scrolls = [];
  const tab = el('osc-atab-spectrum');
  const panel = el(LENS_PANEL_ID, {
    scrollIntoView(o) { scrolls.push(o); },
    querySelector: (sel) => (/\[role="tab"\]/.test(sel) ? tab : null) });
  panel.dataset.oscModes = PANEL_MODES;
  const view = panel.appendChild(el(null));
  const slot = el('osc-lens-slot');
  const close = el('osc-lens-close');
  const header = el('osc-lens-header');
  globalThis.document = { getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => (sel === `#${LENS_PANEL_ID} [role="tabpanel"]`
      && view.parentNode === panel ? view : null),
    createComment: (data) => ({ nodeType: 8, data, parentNode: null }) };
  const part = createLensPart({ relayout() {} });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  const menus = [];
  Object.assign(cmp, { workspace, tabs: { analysis: 'waveform' }, playback: null,
    synth: { armed: false }, setTab(g, v) { this.tabs[g] = v; },
    closeMenus: () => menus.push(1), $nextTick(fn) { fn(); } });
  return { cmp, panel, view, slot, tab, close, header, scrolls, menus };
}

test('in a place that shows the panel the Sonda button brings it into view and leaves its view '
  + 'there', () => {
  const listed = PANEL_MODES.split(/\s+/).filter((ws) => WORKSPACE_IDS.includes(ws));
  for (const ws of listed) {
    const { cmp, panel, view, tab, close, scrolls, menus } = placeComponent(ws);
    assert.equal(cmp.lensInPlace, true, ws);
    assert.equal(cmp.lensControls, LENS_PANEL_ID, `${ws}: the button controls the panel`);
    assert.equal(cmp.lensExpanded, null, `${ws}: no sheet, no aria-expanded`);
    cmp.lensToggle();
    assert.equal(cmp.lensOpen, false, `${ws}: the sheet stays closed`);
    assert.equal(view.parentNode, panel, `${ws}: the view stays in the panel (no placeholder)`);
    assert.equal(scrolls.length, 1, `${ws}: the panel is brought into view`);
    assert.equal(tab.focused, 1, `${ws}: its view tab takes the focus`);
    assert.deepEqual(tab.focusOpts, { preventScroll: true });
    assert.equal(close.focused, 0);
    assert.equal(menus.length, 1, `${ws}: the phone's Akce menu closes`);
  }
});

test('elsewhere the sheet opens as before, and entering the panel\'s place closes it', () => {
  const { cmp, panel, view, slot, header, close } = placeComponent('synth');
  assert.equal(cmp.lensInPlace, false);
  assert.equal(cmp.lensControls, 'osc-lens');
  assert.equal(cmp.lensExpanded, 'false');
  cmp.lensToggle();
  assert.equal(cmp.lensOpen, true);
  assert.equal(cmp.lensExpanded, 'true');
  assert.equal(view.parentNode, slot, 'the one view moves into the sheet');
  assert.equal(close.focused, 1);
  cmp.lensFollowPlace(); // still the Synth: stays open
  assert.equal(cmp.lensOpen, true);
  cmp.workspace = PANEL_MODES.split(/\s+/)[0];
  cmp.lensFollowPlace();
  assert.equal(cmp.lensOpen, false, 'the panel\'s place takes its view back');
  assert.equal(view.parentNode, panel);
  assert.equal(header.focused, 0, 'a navigation keeps its own focus');
  // Mutation case: without the panel in the document nothing is in place (the sheet serves).
  const lost = placeComponent('playground');
  globalThis.document = { ...globalThis.document, getElementById: () => null };
  assert.equal(lost.cmp.lensInPlace, false);
});

// ----------------------------------------------------- 2 + 3. sheet offset from the dock, reflow

const SHEET = attr(tagOf('osc-lens'), 'class');
/** The reflow class the shell binds on the workspace column while the sheet is open. */
function reflowClasses(lensOpen) {
  const shell = createShell({ get: () => null, set() {} });
  const cls = shell.shellContent()[':class'].call({ lensOpen, sidebarCollapsed: false });
  return Object.keys(cls).filter((k) => cls[k]);
}

/** What is wrong with a sheet's class list against the reflow classes of the column. */
function sheetProblems(cls, reflow) {
  const tokens = cls.split(/\s+/);
  const out = [];
  const dock = 'var(--osc-dock-h,0px)';
  if (!tokens.includes(`bottom-[${dock}]`)) out.push('below lg the sheet ends above the dock');
  if (tokens.includes('bottom-0')) out.push('bottom-0 covers the docked keys');
  if (!tokens.includes(`lg:bottom-[max(${dock},var(--osc-statusbar-h))]`)) {
    out.push('from lg the sheet ends above the dock and the status bar');
  }
  const cap = tokens.find((t) => t.startsWith('max-h-['));
  if (!cap || !cap.includes(dock) || !cap.includes('60vh')) {
    out.push('the bottom sheet\'s height is capped by 60vh and by the room above the dock');
  }
  const width = /^lg:w-\[(\d+)px\]$/;
  const w = tokens.map((t) => width.exec(t)).find(Boolean);
  const r = reflow.map((t) => /mr-\[(\d+)px\]$/.exec(t)).find(Boolean);
  if (!w) out.push('the side sheet has a width of its own');
  if (!r) out.push('the column reflows while the sheet is open');
  if (w && r && w[1] !== r[1]) out.push(`reflow ${r[1]} px is not the sheet's ${w[1]} px`);
  if (r && !reflow.some((t) => t.startsWith('lg:') && t.includes(':not(footer)'))) {
    out.push('the reflow is from lg up and leaves the status bar its width');
  }
  return out;
}

test('the sheet ends above the docked keys, and from lg its width is the column\'s reflow', () => {
  assert.deepEqual(sheetProblems(SHEET, reflowClasses(true)), []);
  assert.equal(reflowClasses(false).some((t) => /mr-\[/.test(t)), false,
    'closed: the column keeps its width');
  // Mutation cases: each one is caught.
  const swap = (from, to) => SHEET.replace(from, to);
  const mutants = {
    'covers the keys': swap('bottom-[var(--osc-dock-h,0px)]', 'bottom-0'),
    'lg ends on the status bar only': swap(
      'lg:bottom-[max(var(--osc-dock-h,0px),var(--osc-statusbar-h))]',
      'lg:bottom-[var(--osc-statusbar-h)]'),
    'height uncapped by the dock': SHEET.replace(/max-h-\[[^\s]*\]/, 'max-h-[60vh]'),
    'another width': swap('lg:w-[420px]', 'lg:w-[400px]'),
  };
  for (const [name, cls] of Object.entries(mutants)) {
    assert.notEqual(cls, SHEET, `${name}: the mutation applies`);
    assert.ok(sheetProblems(cls, reflowClasses(true)).length > 0, name);
  }
  assert.ok(sheetProblems(SHEET, []).length > 0, 'no reflow is caught');
  assert.ok(sheetProblems(SHEET, ['lg:pr-[420px]']).length > 0,
    'a reflow that narrows the status bar too is caught');
});

// -------------------------------------------------------------- 4. Escape precedence with shell

test('shellEscape: an open sheet passes the key on before any shell meaning', () => {
  const combos = [];
  for (const search of [false, true]) {
    for (const query of ['', 'fil']) {
      for (const drawerOpen of [false, true]) {
        for (const inGroup of [false, true]) combos.push({ search, query, drawerOpen, inGroup });
      }
    }
  }
  for (const c of combos) {
    assert.equal(shellEscape({ ...c, lensOpen: true }), null, JSON.stringify(c));
  }
  // Closed: each meaning is kept (the next Escape after the sheet's).
  assert.equal(shellEscape({ inGroup: true, lensOpen: false }), 'collapse');
  assert.equal(shellEscape({ drawerOpen: true, lensOpen: false }), 'close');
  assert.equal(shellEscape({ search: true, query: 'fil', lensOpen: false }), 'clear');
  assert.equal(shellEscape({ lensOpen: false }), null);
});

test('Escape from a sidebar item with the sheet open: the shell passes, the registry gives it to '
  + 'the sheet, the group stays expanded and the sound plays on; then the shell\'s again', () => {
  const { cmp } = placeComponent('filter');
  const stops = [];
  cmp.navExpanded = { analyze: true };
  cmp.lensShow();
  assert.equal(cmp.lensOpen, true);
  const keys = createKeyRegistry();
  bindPageKeys({ keys, cmp, stopSequencer() {}, stopAll: (why) => stops.push(why) });
  bindLensKeys({ keys, cmp });
  const link = { tagName: 'A', getAttribute: () => null, closest: () => null };
  const doc = { activeElement: link, body: {}, querySelector: () => null };
  const dispatcher = createKeyDispatcher({ registry: keys, doc,
    context: () => ({ workspace: 'filter' }) });
  // What the sidebar's roving listener does first (shell.js shellKeys): shellEscape decides.
  const sidebarEscape = (e) => {
    const what = shellEscape({ inGroup: true, lensOpen: !!cmp.lensOpen });
    if (what === 'collapse') cmp.navExpanded = { analyze: false };
    if (what !== null) { e.stopped = true; return; }
    dispatcher.keydown(e);
    dispatcher.keyup(e);
  };
  const press = () => {
    const e = { key: 'Escape', code: 'Escape', target: link, stopped: false,
      preventDefault() {}, stopPropagation() { this.stopped = true; } };
    sidebarEscape(e);
    return e;
  };
  const first = press();
  assert.equal(cmp.lensOpen, false, 'the first Escape closes the sheet');
  assert.equal(first.stopped, true, 'and is consumed');
  assert.deepEqual(cmp.navExpanded, { analyze: true }, 'the nav group stays expanded');
  assert.deepEqual(stops, [], 'the sound plays on');
  press();
  assert.deepEqual(cmp.navExpanded, { analyze: false },
    'closed: the next Escape is the shell\'s again (the group collapses)');
  assert.deepEqual(stops, []);
});
