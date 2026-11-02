// The peeper's model (owner order 2026-11-02 (c), plan: see the PR): an oscilloscope-like view
// of one tap point of the signal, on every page. Pure: it holds the view state and the probe
// lease and never touches the DOM, the URL or audio. The tap list is the probe's points(),
// derived by the probe from the port declarations, never placed per page.
//
//   PEEPER_KEY, PEEPER_WINDOWS_MS, DEFAULT_TAP
//   resolvePeeperPrefs(raw) -> { pinned, tap, windowMs }   from the stored JSON (or defaults)
//   pointFor(points, target) -> point id | null            a target: an id, { id }, { nodeId },
//                                                          { edgeId }
//   createPeeper({ probe, load, save }) -> peeper
//     state() -> { open, pinned, tap, windowMs, collapsed, reason, playing, hidden }
//     points(), open(target?), close(), toggle(), pin(on), collapse(on), switchTap(id),
//     stepWindow(), route(workspace), transport(playing), visibility(hidden), read(buf)
//
// The lease: held only while the peeper is open and expanded, the output plays and the page is
// visible; anything else releases it (probe.active() is 0/0 after Stop, a close or a hide) and
// the reason says why nothing is drawn. A route change keeps a pinned peeper open and retargets
// its lease; an unpinned one closes. Pinning is view state: it is kept in local storage
// (PEEPER_KEY, like the sidebar), never in the history or the hash.

export const PEEPER_KEY = 'oscilla.peeper';
export const PEEPER_WINDOWS_MS = Object.freeze([5, 10, 20, 50]);
export const DEFAULT_TAP = 'output:master';
const DEFAULT_WINDOW = 20;

/** The stored preferences (a JSON string, or null), resolved to valid values. */
export function resolvePeeperPrefs(raw) {
  let v = null;
  try { v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
  const o = v && typeof v === 'object' ? v : {};
  return {
    pinned: o.pinned === true,
    tap: typeof o.tap === 'string' && o.tap ? o.tap : DEFAULT_TAP,
    windowMs: PEEPER_WINDOWS_MS.includes(o.windowMs) ? o.windowMs : DEFAULT_WINDOW,
  };
}

/** The point a target names in `points`, or null. */
export function pointFor(points, target) {
  if (!target) return null;
  const t = typeof target === 'string' ? { id: target } : target;
  const hit = points.find((p) => (t.id && p.id === t.id) || (t.nodeId && p.nodeId === t.nodeId)
    || (t.edgeId && p.edgeId === t.edgeId));
  return hit ? hit.id : null;
}

export function createPeeper({ probe, load = () => null, save = () => {} }) {
  const prefs = resolvePeeperPrefs(load());
  const st = { open: false, pinned: prefs.pinned, tap: prefs.tap, windowMs: prefs.windowMs,
    collapsed: false, playing: false, hidden: false };
  let lease = null;
  const persist = () => save(JSON.stringify({ pinned: st.pinned, tap: st.tap,
    windowMs: st.windowMs }));
  const valid = (id) => pointFor(probe.points(), id) || pointFor(probe.points(), DEFAULT_TAP)
    || (probe.points()[0] ? probe.points()[0].id : null);
  const wanted = () => st.open && !st.collapsed && st.playing && !st.hidden;

  function release() {
    if (lease) lease.release();
    lease = null;
  }
  function sync() {
    if (!wanted()) { release(); return; }
    st.tap = valid(st.tap);
    if (!st.tap) return;
    if (!lease) lease = probe.tap(st.tap, { windowMs: st.windowMs });
    else lease.retarget(st.tap);
  }
  function reason() {
    if (!st.open) return 'closed';
    if (st.collapsed) return 'collapsed';
    if (st.hidden) return 'hidden';
    if (!st.playing) return 'stopped';
    return '';
  }

  const api = {
    state: () => ({ ...st, reason: reason() }),
    points: () => probe.points(),
    open(target) {
      const id = target ? pointFor(probe.points(), target) : null;
      if (id && id !== st.tap) { st.tap = id; persist(); }
      st.open = true;
      st.collapsed = false;
      sync();
      return st.tap;
    },
    close() {
      st.open = false;
      release();
    },
    toggle() {
      if (st.open) api.close(); else api.open();
      return st.open;
    },
    pin(on = !st.pinned) {
      st.pinned = !!on;
      persist();
      return st.pinned;
    },
    collapse(on = !st.collapsed) {
      st.collapsed = !!on;
      sync();
      return st.collapsed;
    },
    switchTap(id) {
      const next = pointFor(probe.points(), id);
      if (!next) return false;
      st.tap = next;
      persist();
      if (lease) lease.retarget(next); else sync();
      return true;
    },
    stepWindow() {
      const i = PEEPER_WINDOWS_MS.indexOf(st.windowMs);
      st.windowMs = PEEPER_WINDOWS_MS[(i + 1) % PEEPER_WINDOWS_MS.length];
      persist();
      release(); // the window is chosen when the tap is made
      sync();
      return st.windowMs;
    },
    /** A route change: a pinned peeper stays and retargets its lease; else it closes. */
    route() {
      if (!st.open) return;
      if (!st.pinned) { api.close(); return; }
      st.tap = valid(st.tap);
      if (lease && st.tap) lease.retarget(st.tap); else sync();
    },
    transport(playing) {
      st.playing = !!playing;
      sync();
    },
    visibility(hidden) {
      st.hidden = !!hidden;
      sync();
    },
    /** The probe's reading, or { live: false, reason } when nothing is tapped. */
    read(buf) {
      if (!lease) return { live: false, reason: reason() || 'stopped' };
      return lease.read(buf);
    },
    /** For tests: whether a lease is held. */
    leased: () => !!lease,
  };
  if (st.pinned) st.open = true; // a pinned peeper comes back with the page
  return api;
}
