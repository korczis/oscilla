// R2-T5-1 (oscilla-c3's review of train T5, P1): the room the Synth's sticky section nav keeps.
// On a phone a control scrolled into view (centred, focused, a section chip's plate) landed under
// the sticky "Sekce Synthu" nav. One rule from one token: the nav's height is --osc-synth-nav-h on
// the root, set here alone, which the app's <main> keeps clear at its top on the Synth
// (src/index.html scroll-pt, beside its scroll-pb of the docked keys' --osc-dock-h). The nav
// sticks only where a row of the face (NAV_ROW_PX) fits between it and the dock; on a phone
// shorter than that (an iPhone SE: 20 px between the nav and the Panel's docked keys) it scrolls
// with the face and the token is 0px, as where the nav is hidden (the panel face from xl).
//
//   navRoomOf({ mainH, navH, dockH }) -> { sticks, token }   pure (tests/unit/synth-nav-room)
//   applyNavRoom(el, win)   measures the nav of the Synth's host `el` and applies the rule
//   watchNavRoom(win, judge)   judges again, at once, on the dock's resize and on each state
//     midi/dock-yield.js applies (onDockChange: the state is that module's alone, C1-R2T51-1),
//     so the nav and the dock never disagree for a frame; the nav's class never resizes the dock
//
// The nav is judged against the band the keys take DOCKED (C1-R2T51-2), which dock-yield.js
// measures while docked and keeps while folded: a fold frees room, but re-sticking the nav then
// would cover the top of the surface the fold just brought into view (the XY pad on an iPhone SE,
// xy-pad.cjs x-dock-yields), so neither a fold nor an unfold changes whether the nav sticks; a
// resize or another face can.

import { onDockChange } from '../midi/dock-yield.js';

/** The room below the nav it keeps sticking for: a 44 px row and a gap. */
export const NAV_ROW_PX = 44 + 8;

/**
 * Whether the nav sticks over its scroller (mainH tall, the docked keys covering dockH of it)
 * and the token the scroller then keeps clear at its top: the nav's height where a row fits
 * between it and the dock, else 0. No nav, or no scroller measured: 0.
 */
export function navRoomOf({ mainH, navH, dockH = 0 } = {}) {
  if (!(navH > 0) || !Number.isFinite(mainH)) return { sticks: false, token: 0 };
  const sticks = mainH - navH - (dockH > 0 ? dockH : 0) >= NAV_ROW_PX;
  return { sticks, token: sticks ? navH : 0 };
}

/** The keyboard dock: the band it covers as midi/keyboard-ui.js measures --osc-dock-h. */
const dockOf = (doc) => doc.querySelector('[data-osc="keyboard"]');
/** window -> the band the keys take docked, as dock-yield.js last reported it. */
const DOCKED = new WeakMap();

export function applyNavRoom(el, win = globalThis.window) {
  const doc = win && win.document;
  if (!doc) return { sticks: false, token: 0 }; // no page (a node rig): nothing to measure
  const root = doc.documentElement;
  const nav = el && el.querySelector(':scope > nav[aria-label]');
  const navH = nav && nav.getClientRects().length
    ? Math.ceil(nav.getBoundingClientRect().height) : 0;
  const main = el && el.closest('main'); // the Synth's scroller
  const keys = dockOf(doc);
  const top = keys && win.getComputedStyle(keys).position === 'fixed'
    ? keys.getBoundingClientRect().top : 0;
  const now = top > 0 ? Math.ceil(win.innerHeight - top) : 0;
  const room = navRoomOf({ mainH: main ? main.clientHeight : NaN, navH,
    dockH: top > 0 ? Math.max(now, DOCKED.get(win) || 0) : 0 });
  if (nav && navH) nav.classList.toggle('sticky', room.sticks);
  if (root && root.style) root.style.setProperty('--osc-synth-nav-h', `${room.token}px`);
  return room;
}

export function watchNavRoom(win, judge) {
  const keys = win && win.document ? dockOf(win.document) : null;
  if (keys && typeof win.ResizeObserver === 'function') new win.ResizeObserver(judge).observe(keys);
  return onDockChange(win, (d) => {
    if (d && d.band > 0) DOCKED.set(win, d.band);
    judge();
  });
}
