// The docked keyboard yields to the surface that owns the notes (plan K171): on a phone the
// Synth's dock took about 40 % of the XY tab and hid the pad below the fold, and at 1536 x 1024
// it covered the pad's lower part (the owner's screenshot of 2026-11-05). One rule decides the
// dock's state at every size, routes.js dockState, from the workspace's route (its yieldsTo) and
// the note owner; this module is the only place that applies it, and only
// midi/keyboard-ui.js mounts it. No surface sets the dock's state: a surface's mount says only
// whether it owns the notes (claimNotes), and the owner is derived from those claims.
//
//   claimNotes(win, { id, owner, home, el })   a mount owns the notes of its home workspace
//                                              (owner 'xy-pad') or no longer does (owner null)
//   createDockYield({ read, apply, release, defer }) -> { claim, update, toggle, state,
//     yields, owner }   the DOM-free state machine (tests/unit/keyboard-dock-yield.test.mjs)
//   mountDockYield({ win, doc, cmp, dock, band, release, buttonClass }) -> the same, drawn:
//     a one-line handle (data-osc="keyboard.handle", aria-expanded) and a status line, both
//     made here so src/index.html carries nothing; folded, every other child of the dock is
//     hidden, the keys' held notes are released (the keyboard's fold release: its own inputs,
//     never the pad's), the component's kbdNoteOwner and kbdDockExpanded are set (its
//     kbdKeysShown reads them through routes.js keysShown), the band the
//     dock covers is measured again (--osc-dock-h) and the owner's surface is brought into view
//     above the handle (reveal); unfolded by the user, the surface is brought above the dock
//     where it fits there whole (routes.js dockRoom), else its top to the top of the room. A
//     resize or a rotation, and the dock's own size settling, measure again and, while the dock
//     yields, re-place the surface the same way.
//
// The user's expansion stays until the owner changes (the owner, not a re-mount of the same
// surface: claims made and dropped within one task settle before the rule is read). A re-mount
// that hands over a new surface element while the dock yields places that element as a state
// change does (`replace`): a re-render can move its scroller (Firefox shifts it by the content
// the re-mount rebuilt above the pad). A resize, a rotation or the dock's own size settling
// re-places the surface only where the dock now covers it (dockCovers), and nothing is ever
// placed from a surface with no box (a hidden face, a closed tab: an empty rect).

import { dockRoom, dockState, dockYields, routeOf } from './routes.js';

export const NOTES_EVENT = 'osc:notes';
/** The handle's key (bound in ui/keys/clients.js through the one key registry). */
export const DOCK_KEY = 'Alt+KeyK';
const OWNER_NAMES = Object.freeze({ 'xy-pad': 'the XY pad' });

const LIVE = new WeakMap(); // window -> Map(mount id -> claim): a dock mounted later reads them

/** A mount says whether it owns the notes of its home workspace; false without a window. */
export function claimNotes(win, { id, owner = null, home = null, el = null } = {}) {
  if (!win || typeof win.dispatchEvent !== 'function' || typeof win.CustomEvent !== 'function'
    || !id) return false;
  const detail = { id, owner, home, el };
  if (!LIVE.has(win)) LIVE.set(win, new Map());
  if (owner) LIVE.get(win).set(id, detail); else LIVE.get(win).delete(id);
  win.dispatchEvent(new win.CustomEvent(NOTES_EVENT, { detail }));
  return true;
}

/** What the status line says of a state (said politely, once per change). */
export function dockSentence(state, { yields, owner, why }) {
  const who = OWNER_NAMES[owner] || owner;
  if (state === 'collapsed') {
    return `The keyboard folds to its handle while ${who} plays the notes: Alt+K or the `
      + 'handle shows it.';
  }
  if (yields) return 'The keyboard is shown under the pad: Alt+K or the handle folds it.';
  return why === 'owner' ? 'The keyboard is docked: the keys play the notes.' : '';
}

/**
 * read()  -> { workspace }
 * apply(state, { yields, why, owner, expanded, el })   draws a changed state (expanded: the
 *   user's expansion, which keysShown reads with the owner)
 * release()  lets go of every note the keys hold
 * defer(fn)  runs fn once the current task's claims settle (default queueMicrotask)
 */
export function createDockYield({ read, apply, release = () => 0, defer = queueMicrotask }) {
  const claims = new Map(); // mount id -> { owner, home, el }
  let state = null;
  let yields = false;
  let owner = null;
  let expanded = false; // the user's expansion, until the owner changes
  let pending = null; // the reason of a scheduled evaluation
  let surface = null; // the owner's surface element as last applied

  const ownerOf = (ws) => {
    let found = null;
    for (const c of claims.values()) if (c.home === ws && c.owner) found = c;
    return found;
  };

  function evaluate(why) {
    pending = null;
    const v = read();
    const c = ownerOf(v.workspace);
    const now = c ? c.owner : null;
    if (now !== owner) {
      owner = now;
      expanded = false;
    }
    const input = { route: routeOf(v.workspace), owner, userExpanded: expanded };
    const next = dockState(input);
    const y = dockYields(input);
    const el = c ? c.el : null;
    // The same state with a new surface (a re-mount while the dock yields): placed again.
    const replace = next === state && y === yields && y && !!el && el !== surface;
    if (next === state && y === yields && !replace) return state;
    const was = state;
    state = next;
    yields = y;
    surface = el;
    if (next === 'collapsed' && was !== 'collapsed') release();
    apply(next, { yields: y, why, owner, expanded, el, replace });
    return state;
  }

  function schedule(why) {
    // An owner change outranks a workspace change in what the state says.
    if (pending) {
      if (why === 'owner') pending = why;
      return;
    }
    pending = why;
    defer(() => evaluate(pending));
  }

  return {
    claim(d) {
      if (!d || !d.id) return;
      if (d.owner) claims.set(d.id, { owner: d.owner, home: d.home, el: d.el || null });
      else claims.delete(d.id);
      schedule('owner');
    },
    update(why = 'viewport') {
      schedule(why);
    },
    /** The handle: expand a folded dock, fold an expanded one; false where it does not yield. */
    toggle() {
      if (pending) evaluate(pending);
      if (!yields) return false;
      expanded = state === 'collapsed';
      evaluate('user');
      return true;
    },
    get state() { return state; },
    get yields() { return yields; },
    get owner() { return owner; },
  };
}

const CHEVRON = '<svg class="h-3 w-3 shrink-0 transition-transform" aria-hidden="true" '
  + 'xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 10 6"><path stroke="currentColor" '
  + 'stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 5 4-4 4 4"/></svg>';

/** The scrolling ancestor of el (the page's scrolling element when none scrolls). */
function scrollerOf(win, el) {
  const doc = el.ownerDocument;
  let sc = el.parentElement;
  while (sc && sc !== doc.body && !(/(auto|scroll)/.test(win.getComputedStyle(sc).overflowY)
    && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  return !sc || sc === doc.body ? doc.scrollingElement || doc.documentElement : sc;
}

/**
 * The top of the room el can be scrolled to (viewport px): its scrolling ancestor's top, below
 * every bar stuck to that top over el's column (the Synth's chip bar on a phone), where such a
 * bar is pinned (its own top offset), not where it is now.
 */
export function roomTop(win, el) {
  if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return 0;
  const doc = el.ownerDocument;
  const sc = scrollerOf(win, el);
  const ceil = sc === doc.scrollingElement || sc === doc.documentElement ? 0
    : sc.getBoundingClientRect().top;
  if (typeof sc.querySelectorAll !== 'function') return ceil;
  const r = el.getBoundingClientRect();
  let top = ceil;
  for (const bar of sc.querySelectorAll('.sticky')) {
    const cs = win.getComputedStyle(bar);
    const b = bar.getBoundingClientRect();
    const at = parseFloat(cs.top);
    if (cs.position !== 'sticky' || !Number.isFinite(at) || bar.contains(el) || b.height <= 0
      || b.right <= r.left || b.left >= r.right) continue;
    top = Math.max(top, ceil + at + b.height);
  }
  return top;
}

/**
 * Bring the owner's surface into view above the dock, folded or unfolded: its scrolling
 * ancestor moves by routes.js dockRoom, the least that puts the surface's bottom just above the
 * dock's top, or its top at the top of the room (roomTop) when it is taller than the room left.
 */
export function reveal(win, el, dock, gap = 8) {
  if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return 0;
  const r = el.getBoundingClientRect();
  if (!hasBox(r)) return 0; // a surface not shown: nothing to bring into view
  const sc = scrollerOf(win, el);
  const ceil = roomTop(win, el);
  const { by } = dockRoom({ pad: { top: r.top, bottom: r.bottom },
    dockTop: dock.getBoundingClientRect().top, ceil, gap });
  if (by) sc.scrollTop += by;
  return by;
}

/** Whether rect r is a box on screen: a height, and a width where the rect names one. */
export const hasBox = (r) => !!r && r.bottom > r.top && !(Number.isFinite(r.width) && r.width <= 0);

/** Whether the dock's top is above the bottom of el's box (the dock covers part of it). */
export function dockCovers(el, dock, gap = 8) {
  if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return false;
  const r = el.getBoundingClientRect();
  return hasBox(r) && r.bottom > dock.getBoundingClientRect().top - gap;
}

/** The dock drawn: its handle, its status line, its folded children. */
export function mountDockYield({ win, doc, cmp, dock, band = () => {}, release,
  buttonClass = '' }) {
  if (!dock || !doc || typeof doc.createElement !== 'function') return null;
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.hidden = true;
  handle.setAttribute('data-osc', 'keyboard.handle');
  handle.setAttribute('data-dock-keep', '');
  handle.setAttribute('aria-expanded', 'true');
  handle.setAttribute('aria-controls', dock.id || 'osc-keyboard');
  handle.setAttribute('aria-keyshortcuts', 'Alt+K');
  handle.className = `${buttonClass} w-full gap-2`;
  handle.innerHTML = `<span>Keyboard</span>${CHEVRON}`;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('data-osc', 'keyboard.dock-status');
  status.setAttribute('data-dock-keep', '');
  status.className = 'sr-only';
  dock.prepend(handle, status);
  const folded = new Set();
  let surface = null; // the owner's surface, while one owns the notes
  // The app chrome above the owner's surface as --osc-chrome-h on the root (the pad kind sizes
  // its height from it and --osc-dock-h); measured again on every state change and resize.
  const chrome = (el = surface) => {
    surface = el;
    const root = doc.documentElement;
    if (!el || !root || !root.style || typeof root.style.setProperty !== 'function') return;
    root.style.setProperty('--osc-chrome-h', `${Math.max(0, Math.ceil(roomTop(win, el)))}px`);
  };

  function apply(state, info) {
    const collapsed = state === 'collapsed';
    dock.setAttribute('data-dock-state', state);
    handle.hidden = !info.yields;
    handle.setAttribute('aria-expanded', String(!collapsed));
    const svg = handle.querySelector('svg');
    if (svg) svg.classList.toggle('rotate-180', !collapsed);
    const focusIn = dock.contains(doc.activeElement) && doc.activeElement !== handle;
    for (const el of [...dock.children]) {
      if (el.hasAttribute('data-dock-keep')) continue;
      if (collapsed && !el.hidden) {
        el.hidden = true;
        folded.add(el);
      } else if (!collapsed && folded.has(el)) {
        el.hidden = false;
        folded.delete(el);
      }
    }
    if (collapsed && focusIn) handle.focus();
    status.textContent = dockSentence(state, info);
    // What the keyboard's kbdKeysShown reads (routes.js keysShown), on the reactive component.
    if (cmp) {
      cmp.kbdNoteOwner = info.owner || null;
      cmp.kbdDockExpanded = !!info.expanded;
    }
    // As the dock stands now and once the component has drawn what the state shows (the keys
    // come back through kbdKeysShown, an Alpine effect after this call): the band the dock
    // covers, measured again before anything is scrolled to, and the app chrome above the
    // owner's surface (the pad's height follows it). Folded by the owner, or unfolded by the
    // user: the pad above the dock (a fold by the user only uncovers more of the page, and
    // moves nothing).
    const place = () => {
      band();
      chrome(info.el);
      const moved = collapsed ? info.why !== 'user' : info.why === 'user';
      if (info.yields && (info.replace || moved)) {
        reveal(win, info.el, dock);
      }
    };
    place(); // now, as the dock's own children stand
    // and again once the component has drawn (an Alpine nextTick can be held while it starts).
    if (cmp && typeof cmp.$nextTick === 'function') cmp.$nextTick(place);
  }

  const ctl = createDockYield({ release, apply, read: () => ({ workspace: cmp.workspace }) });
  // A press on the handle never takes the focus (review of #425, R8): a second finger tapping it
  // while the pad holds a note would blur the pad's group, whose focusout ends the gate
  // (ui/kinds/xy-pad.js). The focus moves on the press's mousedown (a tap's compatibility
  // mousedown too), so that is what is prevented: preventing the pointerdown would also cancel
  // a tap's click in WebKit. The click still toggles, and Tab still reaches the handle.
  handle.addEventListener('mousedown', (e) => e.preventDefault());
  handle.addEventListener('click', () => ctl.toggle());
  for (const d of (LIVE.get(win) || new Map()).values()) ctl.claim(d);
  win.addEventListener(NOTES_EVENT, (e) => ctl.claim(e.detail));
  // A resize or a rotation: the chrome measured again and, while the dock yields and covers the
  // owner's surface, the surface re-placed against the dock (folded or unfolded).
  const replace = () => {
    if (ctl.yields && surface && dockCovers(surface, dock)) reveal(win, surface, dock);
  };
  win.addEventListener('resize', () => {
    band();
    chrome();
    replace();
  });
  // The dock's own size settles after a state change (the keys' canvas is laid out after the
  // component draws it, later in WebKit): where it then covers the pad, the pad is placed
  // against the dock as it now stands.
  if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(replace).observe(dock);
  if (typeof cmp.$watch === 'function') cmp.$watch('workspace', () => ctl.update('workspace'));
  ctl.update('init');
  return ctl;
}
