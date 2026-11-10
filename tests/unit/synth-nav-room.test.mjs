// R2-T5-1 (oscilla-c3's review of train T5, P1): on a phone a control of the Synth's face that
// is scrolled into view (centred, focused, a section chip's plate) landed under the sticky
// "Sekce Synthu" nav: webkit's iphone.cjs reach-synth counted 96 covered controls on T5 (81 on
// main, every one under the nav or its chips). One rule fixes it: the nav's height is one token,
// --osc-synth-nav-h, which the Synth's scroller (#osc-main) keeps clear at its top as scroll
// padding, as it keeps the docked keys' --osc-dock-h at its bottom; and the nav sticks only where
// a row of the face fits between it and the dock (an iPhone SE has 20 px there with the Panel's
// keys docked), else it scrolls with the face and the token is 0. Asserted on the pure rule
// (synth/ui.js navRoomOf) and on the shell's one binding; the page proof is iphone.cjs.
//   node --test tests/unit/synth-nav-room.test.mjs
// Fails on 192a21fa: there is no navRoomOf, and #osc-main keeps no room for the nav.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as ui from '../../src/js/synth/ui.js';

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
  const sets = [...read('src/js/synth/ui.js').matchAll(/setProperty\('--osc-synth-nav-h'/g)];
  assert.equal(sets.length, 1);
  // and no per-control margin beside it (one rule, not a fix per control)
  assert.doesNotMatch(read('src/js/synth/ui.js'), /scroll-mt-/);
});
