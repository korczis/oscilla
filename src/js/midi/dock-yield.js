// The docked keyboard yields to the surface that owns the notes (plan K171): on a phone the
// Synth's dock took about 40 % of the XY tab and hid the pad below the fold. One rule decides the
// dock's state, routes.js dockState, from the workspace's route (its yieldsTo), the note owner,
// the pointer and the width; this module is the only place that applies it, and only
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
//     hidden, held notes are released through the keyboard's own release path, the band the
//     dock covers is measured again (--osc-dock-h) and the owner's surface is brought into view
//     above the handle (reveal).
//
// The user's expansion stays until the owner changes (the owner, not a re-mount of the same
// surface: claims made and dropped within one task settle before the rule is read).

import { dockState, dockYields, routeOf } from './routes.js';

export const NOTES_EVENT = 'osc:notes';
/** The handle's key (bound in ui/keys/clients.js through the one key registry). */
export const DOCK_KEY = 'Alt+KeyK';
const OWNER_NAMES = Object.freeze({ 'xy-pad': 'the XY pad' });
const COARSE = '(pointer: coarse)';

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
 * read()  -> { workspace, coarse, width }
 * apply(state, { yields, why, owner, el, first })   draws a changed state
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
    const input = { route: routeOf(v.workspace), owner, coarse: v.coarse, width: v.width,
      userExpanded: expanded };
    const next = dockState(input);
    const y = dockYields(input);
    if (next === state && y === yields) return state;
    const was = state;
    state = next;
    yields = y;
    if (next === 'collapsed' && was !== 'collapsed') release();
    apply(next, { yields: y, why, owner, el: c ? c.el : null, first: was === null });
    return state;
  }

  function schedule(why) {
    // An owner change outranks a viewport or workspace change in what the state says.
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

/**
 * Bring the owner's surface into view above the folded dock: its scrolling ancestor moves the
 * least that puts the surface's bottom just above the dock's top, or its top at the
 * ancestor's top when the surface is taller than the room left.
 */
export function reveal(win, el, dock, gap = 8) {
  if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return 0;
  const doc = el.ownerDocument;
  let sc = el.parentElement;
  while (sc && sc !== doc.body && !(/(auto|scroll)/.test(win.getComputedStyle(sc).overflowY)
    && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  if (!sc || sc === doc.body) sc = doc.scrollingElement || doc.documentElement;
  const r = el.getBoundingClientRect();
  const floor = dock.getBoundingClientRect().top - gap;
  const ceil = sc === doc.scrollingElement ? 0 : sc.getBoundingClientRect().top;
  let by = r.bottom > floor ? r.bottom - floor : 0;
  if (r.top - by < ceil) by = r.top - ceil;
  if (by) sc.scrollTop += by;
  return by;
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
    band(); // the band the dock covers, measured again before anything is scrolled to
    if (collapsed && info.why !== 'user') reveal(win, info.el, dock);
  }

  const mq = typeof win.matchMedia === 'function' ? win.matchMedia(COARSE) : null;
  const ctl = createDockYield({ release, apply,
    read: () => ({ workspace: cmp.workspace, coarse: !!(mq && mq.matches),
      width: (doc.documentElement && doc.documentElement.clientWidth) || win.innerWidth }) });
  handle.addEventListener('click', () => ctl.toggle());
  for (const d of (LIVE.get(win) || new Map()).values()) ctl.claim(d);
  win.addEventListener(NOTES_EVENT, (e) => ctl.claim(e.detail));
  win.addEventListener('resize', () => ctl.update('viewport'));
  if (mq && typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', () => ctl.update('viewport'));
  }
  if (typeof cmp.$watch === 'function') cmp.$watch('workspace', () => ctl.update('workspace'));
  ctl.update('init');
  return ctl;
}
