// R2-T5-1 (oscilla-c3's review of train T5, P1): on a phone a control of the Synth's face that
// is scrolled into view (centred, focused, a section chip's plate) landed under the sticky
// "Sekce Synthu" nav: webkit's iphone.cjs reach-synth counted 96 covered controls on T5 (81 on
// main, every one under the nav or its chips). One rule fixes it: the nav's height is one token,
// --osc-synth-nav-h, which the Synth's scroller (<main>) keeps clear at its top as scroll
// padding, as it keeps the docked keys' --osc-dock-h at its bottom; and the nav sticks only where
// a row of the face fits between it and the dock (an iPhone SE has 20 px there with the Panel's
// keys docked), else it scrolls with the face and the token is 0. Asserted on the pure rule
// (synth/nav-room.js navRoomOf) and on the shell's one binding; the page proof is iphone.cjs.
//   node --test tests/unit/synth-nav-room.test.mjs
// Fails on 192a21fa: there is no navRoomOf, and #osc-main keeps no room for the nav.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as ui from '../../src/js/synth/nav-room.js';

const room = ui;

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('R2-T5-1 the nav sticks where a 44 px row fits under it, its height the token', () => {
  assert.equal(ui.NAV_ROW_PX, 44 + 8);
  // iPhone 13 (WebKit, measured): the scroller 370 px, the nav 60, the Panel's docked keys 201
  assert.deepEqual(ui.navRoomOf({ mainH: 370, navH: 60, dockH: 201 }),
    { sticks: true, token: 60 });
  // iPhone SE (measured): 274, 60 and 256: 20 px would be left, so the nav scrolls with the face
  assert.deepEqual(ui.navRoomOf({ mainH: 274, navH: 60, dockH: 256 }),
    { sticks: false, token: 0 });
  // the line: exactly one row and its gap still sticks; a pixel less does not
  assert.equal(ui.navRoomOf({ mainH: 60 + 52, navH: 60 }).sticks, true);
  assert.equal(ui.navRoomOf({ mainH: 60 + 51, navH: 60 }).sticks, false);
  // a desktop window, the keys folded or not fixed (dockH 0)
  assert.deepEqual(ui.navRoomOf({ mainH: 900, navH: 60, dockH: 0 }), { sticks: true, token: 60 });
});

test('R2-T5-1 no nav shown, or no scroller measured, keeps no room', () => {
  assert.deepEqual(ui.navRoomOf({ mainH: 900, navH: 0 }), { sticks: false, token: 0 },
    'the panel face from xl hides the nav');
  assert.deepEqual(ui.navRoomOf({ mainH: NaN, navH: 60 }), { sticks: false, token: 0 });
  assert.deepEqual(ui.navRoomOf(), { sticks: false, token: 0 });
});

test('R2-T5-1 the Synth\'s scroller keeps the one token clear at its top, as it keeps the dock '
  + 'at its bottom', () => {
  const main = read('src/index.html').match(/<main [^>]*id="osc-main"[^>]*>/);
  assert.ok(main, '#osc-main');
  assert.match(main[0], /scroll-pb-\[var\(--osc-dock-h,0px\)\]/);
  assert.match(main[0], /workspace === 'synth' && '[^']*scroll-pt-\[var\(--osc-synth-nav-h,0px\)\]/,
    'on the Synth, the nav\'s token as scroll padding');
  // one token, set in one place: the Synth's own measure of its nav
  const sets = ['src/js/synth/ui.js', 'src/js/synth/nav-room.js']
    .flatMap((f) => [...read(f).matchAll(/setProperty\('--osc-synth-nav-h'/g)].map(() => f));
  assert.deepEqual(sets, ['src/js/synth/nav-room.js']);
  // and no per-control margin beside it (one rule, not a fix per control)
  assert.doesNotMatch(read('src/js/synth/ui.js'), /scroll-mt-/);
});

/** A page as applyNavRoom reads it: the Synth's host with its nav, <main> and the fixed dock. */
function page({ mainH = 274, navH = 60, vh = 568, dockTop }) {
  const listeners = {};
  const classes = new Set(['sticky']);
  const props = {};
  const nav = { getClientRects: () => [1], getBoundingClientRect: () => ({ height: navH }),
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  const keys = { top: dockTop, getBoundingClientRect() { return { top: this.top }; } };
  const doc = { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } },
    querySelector: (sel) => (sel === '[data-osc="keyboard"]' ? keys : null) };
  const win = { document: doc, innerHeight: vh, getComputedStyle: () => ({ position: 'fixed' }),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    send: (detail) => (listeners['osc:dock'] || []).forEach((f) => f({ detail })) };
  const el = { querySelector: () => nav, closest: () => ({ clientHeight: mainH }) };
  return { win, el, keys, classes, props };
}

test('C1-R2T51-2 a fold never re-sticks the nav over what it brought into view', () => {
  // iPhone SE: the keys docked take 256 px; folded to their handle, 44
  const p = page({ dockTop: 568 - 256 });
  let judged = 0;
  room.watchNavRoom(p.win, () => { judged += 1; room.applyNavRoom(p.el, p.win); });
  p.win.send({ state: 'docked', band: 256 });
  assert.deepEqual([p.classes.has('sticky'), p.props['--osc-synth-nav-h']], [false, '0px']);
  // the fold frees 212 px, but the nav is judged against the docked band: it stays as it was
  p.keys.top = 568 - 44;
  p.win.send({ state: 'collapsed', band: 256 });
  assert.equal(judged, 2);
  assert.deepEqual([p.classes.has('sticky'), p.props['--osc-synth-nav-h']], [false, '0px'],
    'folded: still not sticky, no scroll padding');
  // iPhone 13: room for a row under the nav with the keys docked: it sticks, folded or not
  const q = page({ mainH: 370, vh: 664, dockTop: 664 - 201 });
  room.watchNavRoom(q.win, () => room.applyNavRoom(q.el, q.win));
  q.win.send({ state: 'docked', band: 201 });
  assert.deepEqual([q.classes.has('sticky'), q.props['--osc-synth-nav-h']], [true, '60px']);
  q.keys.top = 664 - 44;
  q.win.send({ state: 'collapsed', band: 201 });
  assert.deepEqual([q.classes.has('sticky'), q.props['--osc-synth-nav-h']], [true, '60px']);
  // no page (a node rig): nothing is measured or set
  assert.deepEqual(room.applyNavRoom(null, {}), { sticks: false, token: 0 });
});
