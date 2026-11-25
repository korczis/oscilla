// Escape with a header menu open (More, Export, …) closes the menu and gives focus back to its
// button, and nothing else: the page's Escape (the playback bus's stopAll, 'page.escape' in
// src/js/ui/keys/clients.js) never sees that press, so the sound plays on. A second Escape, with
// no menu open, keeps its global meaning and stops the sound.
//
// The component's own init() binds the menu listener on a fake document and the real key
// dispatcher listens on a fake window, as main.js attaches it; a press bubbles as the browser's
// does: the document's listeners first, then the window's unless one stopped propagation.
//
//   node --test tests/unit/menu-escape.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOscillaUi } from '../../src/js/ui/app.js';
import { createKeyRegistry } from '../../src/js/ui/keys/registry.js';
import { createKeyDispatcher } from '../../src/js/ui/keys/dispatcher.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';

/** A target that records its listeners per type. */
const target = (extra = {}) => {
  const on = {};
  return {
    on,
    addEventListener(type, fn) { (on[type] ||= []).push(fn); },
    removeEventListener(type, fn) { on[type] = (on[type] || []).filter((f) => f !== fn); },
    ...extra,
  };
};

function page() {
  const focus = { el: null };
  const button = (name) => ({ tagName: 'BUTTON', name, getAttribute: () => null,
    closest: () => null, focus() { focus.el = this; } });
  const buttons = { overflow: button('overflow'), export: button('export') };
  const item = { tagName: 'BUTTON', getAttribute: (a) => (a === 'role' ? 'menuitem' : null),
    closest: () => null, focus() { focus.el = this; } };
  const doc = target({
    documentElement: { dataset: { theme: 'dark' }, classList: { toggle() {} } },
    body: { tagName: 'BODY' },
    hidden: false,
    get activeElement() { return focus.el; },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const win = target({ location: { search: '' },
    matchMedia: () => ({ matches: true, addEventListener() {} }) });
  const root = target({
    querySelector: (sel) => {
      const m = /data-osc-menu-button="([^"]+)"/.exec(sel);
      return m ? buttons[m[1]] || null : null;
    },
    querySelectorAll: () => [],
  });
  return { doc, win, root, item, buttons, focus };
}

function setUp() {
  const p = page();
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = p.doc;
  globalThis.window = p.win;
  const ui = createOscillaUi({ storedAnalysisTab: 'waveform' });
  Object.assign(ui, { $root: p.root, $watch() {}, $nextTick(fn) { fn(); } });
  ui.init();
  const stops = [];
  const keys = createKeyRegistry();
  bindPageKeys({ keys, cmp: ui, stopSequencer() {}, stopAll: (why) => stops.push(why) });
  const detach = createKeyDispatcher({ registry: keys,
    context: () => ({ workspace: 'playground', view: null }) }).attach(p.doc, p.win);
  const restore = () => {
    detach();
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    if (saved.window === undefined) delete globalThis.window;
  };
  /** One key press from the focused element, bubbling document -> window, then its release. */
  const press = (key) => {
    const ev = (type) => ({ type, key, code: key, repeat: false, isComposing: false,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      target: p.focus.el || p.doc.body, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; } });
    const bubble = (e) => {
      for (const fn of p.doc.on[e.type] || []) fn(e);
      if (e.stopped) return e;
      for (const fn of p.win.on[e.type] || []) fn(e);
      return e;
    };
    const down = bubble(ev('keydown'));
    bubble(ev('keyup'));
    return down;
  };
  return { ui, p, stops, press, restore };
}

test('Escape with the More menu open closes it, refocuses its button and keeps the sound', () => {
  const { ui, p, stops, press, restore } = setUp();
  try {
    ui.menus.overflow = true;
    p.focus.el = p.item; // the menu's first item, as menuButton() focuses it
    const e = press('Escape');
    assert.deepEqual(Object.values(ui.menus).filter(Boolean), [], 'every menu is closed');
    assert.equal(p.focus.el, p.buttons.overflow, 'focus is back on the More button');
    assert.deepEqual(stops, [], 'the page Escape (stopAll) did not run: the sound plays on');
    assert.equal(e.stopped, true, 'the menu consumed the key');
    assert.equal(e.defaultPrevented, true);
    // The second Escape has no menu to close: it is the page's again and stops everything.
    press('Escape');
    assert.deepEqual(stops, ['escape'], 'Escape with no menu open stops all sound');
  } finally {
    restore();
  }
});

test('Escape in the Export menu is the menu\'s too; with no menu open it passes untouched', () => {
  const { ui, p, stops, press, restore } = setUp();
  try {
    ui.menus.export = true;
    p.focus.el = p.item;
    press('Escape');
    assert.equal(ui.menus.export, false);
    assert.equal(p.focus.el, p.buttons.export);
    assert.deepEqual(stops, []);
    // A menu handler that sees another key, or Escape with nothing open, consumes nothing.
    const other = { key: 'ArrowDown', preventDefault() { assert.fail('prevented'); },
      stopPropagation() { assert.fail('stopped'); } };
    assert.equal(ui.menuEscape(other), false);
    const idle = { key: 'Escape', preventDefault() { assert.fail('prevented'); },
      stopPropagation() { assert.fail('stopped'); } };
    assert.equal(ui.menuEscape(idle), false);
  } finally {
    restore();
  }
});
