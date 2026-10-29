// Route hygiene (link audit 2026-10-29, B3 B4 B5): the one hash dispatcher of
// ui/navigation.js keeps no address that would repeat a notice on every reload. Driven
// through createNavigation with a fake window, as the page drives it: navStart() for a load,
// a hashchange for a link. The browser half is tests/browser/link-integrity.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  badRouteMessage, createNavigation, hashToKeep, routeOfHash,
} from '../../src/js/ui/navigation.js';

const q = (hash) => Object.fromEntries(new URLSearchParams(String(hash).replace(/^#/, '')));

/** A window with an address, a history and the two navigation events. */
function fakeWindow(hash = '') {
  const base = 'file:///oscilla/index.html';
  const on = { popstate: [], hashchange: [] };
  const win = {
    location: {
      href: hash ? `${base}#${hash}` : base,
      get hash() { const i = this.href.indexOf('#'); return i < 0 ? '' : this.href.slice(i); },
      set hash(h) { this.href = `${base}#${String(h).replace(/^#/, '')}`; },
    },
    history: {
      state: null,
      entries: 1,
      pushState(state, _t, url) { this.state = state; this.entries += 1; win.location.href = url; },
      replaceState(state, _t, url) { this.state = state; win.location.href = url; },
    },
    addEventListener(type, fn) { if (on[type]) on[type].push(fn); },
    /** A link followed in the page: a new, unstamped fragment, then hashchange. */
    follow(h) {
      this.history.state = null;
      this.history.entries += 1;
      this.location.hash = h;
      for (const fn of on.hashchange) fn();
    },
  };
  return win;
}

/** The composed component's part the router reads, with the given domains registered. */
function component(win, domains = {}) {
  const watchers = [];
  const cmp = {
    workspace: 'playground',
    mode: 'playground',
    source: 'single',
    notices: [],
    notify(level, title, text) { this.notices.push({ level, title, text }); },
    $watch(key, fn) { if (key === 'workspace') watchers.push(fn); },
    setWorkspace(ws) {
      this.workspace = ws;
      for (const fn of watchers) fn(ws);
    },
    serializeHash: () => 'v=1&m=playground&s=single&f=440&g=0.2',
    ...createNavigation({ win }),
  };
  // The nav methods read `this` as the component, like Object.defineProperties in main.js.
  for (const [name, fn] of Object.entries(domains)) cmp.navRegister(name, (h, o) => fn(cmp, h, o));
  return cmp;
}

test('a definition or finding refused at once, as a link, leaves the address (B3)', () => {
  for (const key of ['def', 'finding']) {
    const win = fakeWindow('');
    // As ui/connections.js recordsOpen does once the lists are loaded: the record is looked up
    // synchronously, found missing, and the address is made to name what is shown (nothing).
    const cmp = component(win, {
      records(c, hash) {
        if (!new URLSearchParams(hash.replace(/^#/, '')).has(key)) return null;
        c.notify('warning', 'not found', key);
        c.navNameRecord(null);
        return true;
      },
    });
    cmp.navStart();
    win.follow(`m=experiments&${key}=not-stored`);
    assert.equal(cmp.workspace, 'experiments', key);
    assert.deepEqual(q(win.location.hash), { m: 'experiments' }, key);
    assert.equal(cmp.notices.length, 1, key);
  }
});

test('a record named while a link is applied is still named after it', () => {
  const win = fakeWindow('');
  const cmp = component(win, {
    records(c, hash) {
      if (!hash.includes('def=')) return null;
      c.navNameRecord({ kind: 'definition', id: 'd-1' });
      return true;
    },
  });
  cmp.navStart();
  win.follow('m=experiments&def=d-1');
  assert.deepEqual(q(win.location.hash), { m: 'experiments', def: 'd-1' });
});

test('an unknown m is refused with one notice and canonicalised, at load and as a link (B4)', () => {
  for (const hash of ['m=bogus', 'm=', 'm=STUDIO', 'm=about&m=learn', `m=${'a'.repeat(5000)}`]) {
    const win = fakeWindow(hash);
    const cmp = component(win);
    cmp.navStart();
    assert.equal(cmp.workspace, 'playground', hash);
    assert.deepEqual(q(win.location.hash), { m: 'playground' }, hash.slice(0, 20));
    assert.equal(cmp.notices.length, 1, hash.slice(0, 20));
    assert.equal(cmp.notices[0].title, 'Page link not applied');
    assert.ok(cmp.notices[0].text.length < 200, 'the notice quotes a long value short');
  }
  // As a link from Measure: no workspace change, and the address names Measure.
  const win = fakeWindow('m=measure');
  const cmp = component(win);
  cmp.navStart();
  assert.equal(cmp.workspace, 'measure');
  win.follow('m=bogus');
  assert.equal(cmp.workspace, 'measure');
  assert.deepEqual(q(win.location.hash), { m: 'measure' });
  assert.equal(cmp.notices.length, 1);
});

test('a repeated m opens its page and is written once, without a notice (B4)', () => {
  const win = fakeWindow('m=measure&m=measure');
  const cmp = component(win);
  cmp.navStart();
  assert.equal(cmp.workspace, 'measure');
  assert.equal(win.location.hash, '#m=measure');
  assert.equal(cmp.notices.length, 0);
  assert.deepEqual(routeOfHash('#m=measure&m=measure'), { workspace: 'measure', owner: 'workspace' });
});

test('a refused m falls through to a record or recipe key that remains', () => {
  assert.deepEqual(routeOfHash('#m=bogus&exp=e-1'),
    { workspace: 'experiments', owner: 'records', badRoute: ['bogus'] });
  assert.match(badRouteMessage(['bogus']), /no OSCILLA page \("bogus"\)/);
  assert.match(badRouteMessage(['about', 'learn']), /more than one page/);
  assert.match(badRouteMessage(['']), /an empty name/);
});

test('an unreadable instrument link leaves the address after its warning (B5)', () => {
  const win = fakeWindow('v=1&x=notbase64!!');
  const cmp = component(win, { instrument: () => false });
  cmp.navStart();
  assert.deepEqual(q(win.location.hash), { m: 'playground' });
  // As a link, the other keys stay.
  win.follow('m=synthesis&v=1&x=bad&f=3');
  assert.deepEqual(q(win.location.hash), { m: 'synthesis' });
});

test('a partly restored instrument link is rewritten to the state restored (B5)', () => {
  const win = fakeWindow('v=1&f=-5&g=99');
  const cmp = component(win, { instrument: () => 'partial' });
  cmp.navStart();
  assert.deepEqual(q(win.location.hash),
    { v: '1', m: 'playground', s: 'single', f: '440', g: '0.2' });
  // A restored link and a link with no configuration are kept as they are.
  assert.equal(hashToKeep('#v=1&f=1000', { instrument: true }, 'playground'), 'v=1&f=1000');
  assert.equal(hashToKeep('#m=learn', { instrument: null }, 'learn'), 'm=learn');
  assert.equal(hashToKeep('#osc-main', {}, 'learn'), 'osc-main');
});
