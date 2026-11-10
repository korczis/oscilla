// K171: the docked keyboard yields to the surface that owns the notes, so a pad is never under
// it, on a phone or at 1536 x 1024 (the owner's screenshot of 2026-11-05). One rule
// (src/js/midi/routes.js dockState) decides the dock's state from the workspace's route (its
// yieldsTo) and the note owner, at every size and pointer; routes.js dockRoom says where the
// pad goes against the dock (whole above it where it fits, its top at the top else); the note
// owner is derived from the claims of the mounted surfaces (the XY pad's mount claims the notes
// while it is mounted, playable from the first touch since K183); src/js/midi/dock-yield.js alone
// applies the rule, and only src/js/midi/keyboard-ui.js mounts it. The on-screen keys are drawn
// by the same rule (routes.js keysShown: wherever the dock is docked, review of #425). The
// handle's key is bound through the one key registry.
//
//   node --test tests/unit/keyboard-dock-yield.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { panelStore } from './synth-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routes = await import('../../src/js/midi/routes.js');
const yieldMod = await import('../../src/js/midi/dock-yield.js').catch(() => ({}));

const SYNTH = () => routes.KEY_ROUTES.synth;

// ---------------------------------------------------------------- the rule, pure

test('the rule: a pad owning the notes folds the dock at every size and pointer', () => {
  assert.equal(typeof routes.dockState, 'function', 'routes.js exports dockState');
  assert.equal(SYNTH().yieldsTo, 'xy-pad', "the Synth's route yields to its XY pad");
  const owners = ['xy-pad', null, 'keys', 'landing-pad'];
  const widths = [0, 320, 375, 390, 767, 767.98, 768, 820, 1024, 1280, 1536, 2560, NaN];
  let n = 0;
  for (const ws of ['synth', 'studio', 'playground', 'measure']) {
    const route = routes.routeOf(ws);
    for (const owner of owners) {
      for (const coarse of [true, false, undefined]) {
        for (const width of widths) {
          for (const userExpanded of [false, true]) {
            // Neither the pointer nor the width enters the rule: the dock never covers the pad.
            const want = ws === 'synth' && owner === 'xy-pad' && !userExpanded
              ? 'collapsed' : 'docked';
            const input = { route, owner, coarse, width, userExpanded };
            assert.equal(routes.dockState(input), want, JSON.stringify(input));
            assert.equal(routes.dockYields(input), ws === 'synth' && owner === 'xy-pad',
              JSON.stringify(input));
            n += 1;
          }
        }
      }
    }
  }
  assert.equal(n, 4 * 4 * 3 * 13 * 2);
});

test('the rule: the keys owning the notes dock it; the desktop and the phone fold alike', () => {
  const route = SYNTH();
  for (const [width, coarse] of [[390, true], [375, true], [1280, false], [1536, false]]) {
    const at = { route, coarse, width };
    assert.equal(routes.dockState({ ...at, owner: 'xy-pad' }), 'collapsed', `${width} px`);
    assert.equal(routes.dockState({ ...at, owner: null }), 'docked', 'the keys own the notes');
    assert.equal(routes.dockState({ ...at, owner: 'xy-pad', userExpanded: true }), 'docked',
      'the user unfolded it');
    // Changing the owner changes the state in one step, both ways.
    assert.equal(routes.dockState({ ...at, owner: 'xy-pad' }), 'collapsed');
    assert.equal(routes.dockState({ ...at, owner: null }), 'docked');
  }
  // Unknown or missing routes and owners never fold the dock; only a true expansion unfolds it.
  for (const bad of [{ route: null, owner: 'xy-pad' }, { owner: 'xy-pad' }, {},
    { route, owner: undefined }, { route: { yieldsTo: undefined }, owner: undefined },
    { route: { yieldsTo: null }, owner: null }]) {
    assert.equal(routes.dockState(bad), 'docked', JSON.stringify(bad));
  }
  assert.equal(routes.dockState(), 'docked');
  assert.equal(routes.dockState({ route, owner: 'xy-pad', userExpanded: 'yes' }), 'collapsed');
  assert.equal(routes.dockYields({ route, owner: 'xy-pad', userExpanded: true }), true,
    'the user expanding it does not end the yield: the handle stays');
});

test('dockRoom: the pad whole above the dock where it fits, its top at the top else', () => {
  assert.equal(typeof routes.dockRoom, 'function', 'routes.js exports dockRoom');
  let n = 0;
  for (const ceil of [0, 56, 120]) {
    for (const gap of [0, 8]) {
      for (const dockTop of [380, 600, 680, 980]) {
        for (const top of [-500, -40, 0, 56, 130, 300, 700, 1200]) {
          for (const h of [0, 120, 300, 420, 560, 900]) {
            const pad = { top, bottom: top + h };
            const r = routes.dockRoom({ pad, dockTop, ceil, gap });
            const { by } = r;
            const floor = dockTop - gap;
            const fits = h <= floor - ceil; // the room holds the whole pad
            const at = JSON.stringify({ pad, dockTop, ceil, gap, fits, by });
            assert.deepEqual(Object.keys(r), ['by'], `one output, the scroll: ${at}`);
            const t = top - by;
            const b = top + h - by;
            if (fits) {
              assert.ok(t >= ceil && b <= floor, `after the scroll the pad is whole: ${at}`);
              const inside = top >= ceil && top + h <= floor;
              if (inside) assert.equal(by, 0, `a pad already whole does not move: ${at}`);
              else assert.ok(t === ceil || b === floor, `the least scroll: ${at}`);
            } else {
              assert.equal(t, ceil, `a pad taller than the room shows its top: ${at}`);
            }
            n += 1;
          }
        }
      }
    }
  }
  assert.equal(n, 3 * 2 * 4 * 8 * 6);
  // The sizes the browser check holds (a 420 px pad under a 56 px bar).
  const desk = (vh) => routes.dockRoom({ pad: { top: 200, bottom: 620 }, dockTop: vh - 60,
    ceil: 56 });
  assert.deepEqual(desk(1024), { by: 0 }, '1536 x 1024: folded, nothing moves');
  assert.deepEqual(desk(720), { by: 0 }, '1280 x 720: folded, nothing moves');
  assert.deepEqual(routes.dockRoom({ pad: { top: 200, bottom: 620 }, dockTop: 500, ceil: 56 }),
    { by: 128 }, 'unfolded where both fit: the pad moves up above the keys');
  assert.deepEqual(routes.dockRoom({ pad: { top: 200, bottom: 620 }, dockTop: 400, ceil: 56 }),
    { by: 144 }, 'unfolded where both do not fit: the pad top at the top');
  for (const bad of [{}, { pad: null, dockTop: 500 }, { pad: { top: 0, bottom: NaN },
    dockTop: 500 }, { pad: { top: 10, bottom: 0 }, dockTop: 500 }, { pad: { top: 0,
    bottom: 10 } }]) {
    assert.deepEqual(routes.dockRoom(bad), { by: 0 }, JSON.stringify(bad));
  }
  assert.deepEqual(routes.dockRoom(), { by: 0 });
});

test('keysShown is the dock rule: keys drawn wherever the dock is docked, never by tab', async () => {
  assert.equal(typeof routes.keysShown, 'function', 'routes.js exports keysShown');
  assert.equal(routes.SURFACE_TAB, undefined, 'no second rule by tab (review of #425, F2)');
  for (const ws of ['synth', 'studio', 'playground', 'measure', undefined]) {
    const route = routes.routeOf(ws);
    for (const owner of ['xy-pad', null, 'keys']) {
      for (const userExpanded of [false, true]) {
        const want = routes.dockState({ route, owner, userExpanded }) === 'docked';
        assert.equal(routes.keysShown({ route, owner, userExpanded }), want,
          JSON.stringify({ ws, owner, userExpanded }));
      }
    }
  }
  assert.equal(routes.keysShown(), true);
  // The keyboard's kbdKeysShown reads it from the owner and the expansion the dock applied (the
  // Studio's armed-only rule kept); the computer keys stay armed in every state.
  const { createKeyboardUi } = await import('../../src/js/midi/keyboard-ui.js');
  const ui = createKeyboardUi({ win: {} });
  const at = (workspace, tab, { owner = null, expanded = false, armed = true,
    decided = true } = {}) => {
    const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(ui));
    c.workspace = workspace;
    c.synth = { tab };
    c.kbdArmed = { ...c.kbdArmed, [workspace]: armed };
    c.kbdNoteOwner = owner;
    c.kbdDockExpanded = expanded;
    c.kbdDockDecided = decided;
    return c;
  };
  assert.equal(at('synth', 'xy').kbdKeysShown, true,
    'XY tab, owner null (no pad owns the notes): the keys are shown, the dock is no inert row');
  assert.equal(at('synth', 'xy', { owner: 'xy-pad' }).kbdKeysShown, false,
    'the pad owns the notes: folded with the dock');
  assert.equal(at('synth', 'xy', { owner: 'xy-pad' }).kbdArmedHere, true,
    'the computer keys still play there');
  assert.equal(at('synth', 'xy', { owner: 'xy-pad', expanded: true }).kbdKeysShown, true,
    'unfolded by the user: the keys are shown and play');
  assert.equal(at('synth', 'panel').kbdKeysShown, true);
  assert.equal(at('playground', 'xy', { owner: 'xy-pad' }).kbdKeysShown, true,
    'a route that never yields');
  assert.equal(at('studio', 'xy').kbdKeysShown, true);
  assert.equal(at('studio', 'xy', { armed: false }).kbdKeysShown, false,
    'the disarmed Studio, as before');
  // K224 F1: before the dock has decided its first state (dock-yield.js has not applied one),
  // no on-screen keys are drawn, so no frame shows them docked over a room that folds them.
  assert.equal(at('studio', 'panel', { decided: false }).kbdKeysShown, false,
    'the Studio keeps room: undecided, no keys drawn');
  // U100: the Synth keeps room on a short phone too, so its keys wait for that decision.
  assert.equal(at('synth', 'panel', { decided: false }).kbdKeysShown, false,
    'the Synth keeps room (U100): undecided, no keys drawn');
  assert.equal(at('playground', 'panel', { decided: false }).kbdKeysShown, true,
    'the Playground keeps no room: its keys draw at once, as before');
});

test("the pad's height follows the room: 100dvh less the chrome and the dock's band", () => {
  const src = readFileSync(path.join(ROOT, 'src/js/ui/kinds/xy-pad.js'), 'utf8');
  assert.ok(src.includes(
    "'max-h-[calc(100dvh_-_var(--osc-chrome-h,0px)_-_var(--osc-dock-h,0px)_-_0.5rem)]'"),
  'one class string the build scans: the room above the dock caps the pad');
  assert.match(src, /'h-56 min-h-24 sm:h-72 '/, 'its size where the room allows, 6rem at least');
  const dy = readFileSync(path.join(ROOT, 'src/js/midi/dock-yield.js'), 'utf8');
  assert.match(dy, /setProperty\('--osc-chrome-h'/, 'dock-yield.js measures the chrome');
  // roomTop: the scroller's top, below a bar stuck there over the pad's column, where pinned.
  const box = (top, bottom, left = 0, right = 390) => ({ top, bottom, left, right,
    height: bottom - top });
  const bar = { b: box(385, 445), cs: { position: 'sticky', top: '0px' } };
  const side = { b: box(378, 1944, 1111, 1511), cs: { position: 'sticky', top: '16px' } };
  const doc = { body: {}, scrollingElement: {}, documentElement: {} };
  const main = { getBoundingClientRect: () => box(240, 787), scrollHeight: 2000,
    clientHeight: 547, parentElement: doc.body,
    querySelectorAll: () => [bar, side].map((x) => ({ getBoundingClientRect: () => x.b,
      contains: () => false, cs: x.cs })) };
  const el = { isConnected: true, ownerDocument: doc, parentElement: main,
    getBoundingClientRect: () => box(493, 717, 36, 354) };
  const win = { getComputedStyle: (e) => (e === main ? { overflowY: 'auto' }
    : e.cs || { overflowY: 'visible' }) };
  assert.equal(yieldMod.roomTop(win, el), 300, 'the main at 240 px, its 60 px chip bar pinned');
  side.b = box(378, 1944, 0, 390); // a bar over the pad's column counts, a side bay does not
  assert.equal(yieldMod.roomTop(win, el), 240 + 16 + 1566);
  assert.equal(yieldMod.roomTop(win, null), 0);
});

// ---------------------------------------------------------------- the state machine

/** The dock's machine with a hand-run task queue and a viewport the test sets. */
function rig(view = {}) {
  const v = { workspace: 'synth', coarse: true, width: 390, ...view };
  const queue = [];
  const applied = [];
  let releases = 0;
  const ctl = yieldMod.createDockYield({ read: () => ({ ...v }),
    apply: (state, info) => applied.push({ state, ...info }),
    release: () => { releases += 1; return 1; },
    defer: (fn) => queue.push(fn) });
  const flush = () => { while (queue.length) queue.shift()(); };
  return { v, ctl, flush, applied, releases: () => releases };
}
const PAD = { id: 'synth-xy-1', owner: 'xy-pad', home: 'synth', el: { pad: true } };

test('a pad claiming the notes folds the dock once; held notes are released on the fold', () => {
  assert.equal(typeof yieldMod.createDockYield, 'function', 'midi/dock-yield.js');
  const r = rig();
  r.ctl.update('init');
  r.flush();
  assert.equal(r.ctl.state, 'docked');
  assert.equal(r.releases(), 0, 'docking releases nothing');
  r.ctl.claim(PAD);
  assert.equal(r.ctl.state, 'docked', 'claims settle at the end of the task');
  r.flush();
  assert.equal(r.ctl.state, 'collapsed');
  assert.equal(r.ctl.owner, 'xy-pad');
  assert.equal(r.releases(), 1, 'the fold released what the keys held');
  const last = r.applied.at(-1);
  assert.deepEqual([last.state, last.yields, last.why, last.el], ['collapsed', true, 'owner',
    PAD.el], 'the owner\'s surface is handed over to be brought into view');
  // A re-mount of the same surface (a panel re-render) drops and makes the claim in one task.
  const n = r.applied.length;
  r.ctl.claim({ id: PAD.id, owner: null });
  r.ctl.claim({ ...PAD, id: 'synth-xy-2' });
  r.flush();
  assert.equal(r.applied.length, n, 'nothing changes on a re-mount');
  assert.equal(r.releases(), 1, 'and nothing is released again');
});

test('a dock the user expanded stays expanded until the owner changes', () => {
  const r = rig();
  r.ctl.claim(PAD);
  r.flush();
  assert.equal(r.ctl.toggle(), true);
  assert.equal(r.ctl.state, 'docked');
  assert.equal(r.ctl.yields, true, 'the handle stays, to fold it again');
  assert.equal(r.applied.at(-1).why, 'user');
  // A viewport change, a re-mount of the same pad: still expanded.
  r.v.width = 380;
  r.ctl.update('viewport');
  r.ctl.claim({ id: PAD.id, owner: null });
  r.ctl.claim({ ...PAD, id: 'synth-xy-3' });
  r.flush();
  assert.equal(r.ctl.state, 'docked', 'the expansion holds while the owner is the same');
  // The owner changes (the pad unpatched: its claim dropped), then the pad owns them again.
  r.ctl.claim({ id: 'synth-xy-3', owner: null });
  r.flush();
  assert.equal(r.ctl.owner, null);
  assert.equal(r.ctl.yields, false);
  r.ctl.claim({ ...PAD, id: 'synth-xy-4' });
  r.flush();
  assert.equal(r.ctl.state, 'collapsed', 'a new owner folds the dock again');
  assert.equal(r.releases(), 2);
  // Folding by the handle releases too; the toggle is refused where the dock does not yield.
  r.ctl.toggle();
  assert.equal(r.ctl.state, 'docked');
  r.ctl.toggle();
  assert.equal(r.ctl.state, 'collapsed');
  assert.equal(r.releases(), 3, 'folding by the handle releases what the keys held');
  r.ctl.claim({ id: 'synth-xy-4', owner: null });
  r.flush();
  assert.equal(r.ctl.toggle(), false, 'no handle where the keys own the notes');
  assert.equal(r.ctl.state, 'docked');
});

test('the pad folds the dock at every size; another workspace or home keeps it', () => {
  for (const [view, why] of [[{ coarse: false, width: 1536 }, 'a fine pointer at 1536 px'],
    [{ coarse: false, width: 1280 }, 'a fine pointer at 1280 px'],
    [{ width: 1024 }, 'a coarse pointer at 1024 px'], [{ width: 375 }, 'the SE size']]) {
    const r = rig(view);
    r.ctl.claim(PAD);
    r.flush();
    assert.equal(r.ctl.state, 'collapsed', why);
    assert.equal(r.ctl.yields, true, `${why}: the handle is shown`);
    assert.equal(r.releases(), 1, why);
  }
  for (const [view, why] of [[{ workspace: 'studio' }, 'the Studio'],
    [{ workspace: 'playground' }, 'the Playground']]) {
    const r = rig(view);
    r.ctl.claim(PAD);
    r.flush();
    assert.equal(r.ctl.state, 'docked', why);
    assert.equal(r.releases(), 0, why);
  }
  const r = rig();
  r.ctl.claim({ ...PAD, home: 'landing' }); // the landing's mount owns the landing's notes
  r.flush();
  assert.equal(r.ctl.state, 'docked', "a pad of another home does not fold the Synth's dock");
  // Leaving the Synth while its pad owns the notes: docked there, folded again on return.
  const s = rig();
  s.ctl.claim(PAD);
  s.flush();
  s.v.workspace = 'studio';
  s.ctl.update('workspace');
  s.flush();
  assert.equal(s.ctl.state, 'docked');
  s.v.workspace = 'synth';
  s.ctl.update('workspace');
  s.flush();
  assert.equal(s.ctl.state, 'collapsed');
});

/** A DOM just big enough for mountDockYield: the dock's top follows its state. */
function fakeDom({ vh = 1024, folded = vh - 60, unfolded = vh - 400, pad = [200, 620] } = {}) {
  const page = { scrollTop: 0 };
  const listeners = {};
  const win = { innerHeight: vh, CustomEvent: class {}, getComputedStyle: () => ({
    overflowY: 'visible', position: 'fixed' }), addEventListener: (t, f) => {
    (listeners[t] = listeners[t] || []).push(f); } };
  const doc = { body: {}, scrollingElement: page, documentElement: page, activeElement: null };
  const el = (tag) => {
    const attrs = new Map();
    const node = { tag, hidden: false, children: [], className: '', innerHTML: '',
      textContent: '', classList: { toggle() {} }, ownerDocument: doc, isConnected: true,
      setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null,
      hasAttribute: (k) => attrs.has(k), addEventListener: (t, f) => { node[`on${t}`] = f; },
      querySelector: () => null, focus() {}, contains: (x) => node.children.includes(x),
      prepend: (...xs) => node.children.unshift(...xs), getBoundingClientRect: () => ({}) };
    return node;
  };
  doc.createElement = el;
  const dock = el('div');
  dock.children.push(el('div')); // the keys
  dock.getBoundingClientRect = () => ({ top: dock.getAttribute('data-dock-state') === 'collapsed'
    ? folded : unfolded });
  const surface = el('div');
  surface.parentElement = doc.body;
  surface.getBoundingClientRect = () => ({ top: pad[0] - page.scrollTop,
    bottom: pad[1] - page.scrollTop });
  return { win, doc, dock, surface, page, listeners };
}

test('unfolded by the user, the pad goes above the keys; folded, nothing moves', async () => {
  for (const [vh, unfolded, want, why] of [
    [1024, 1024 - 360, 0, '1536 x 1024: the pad and the keys both fit, the pad already above'],
    [720, 720 - 260, 168, '1280 x 720: both fit once the pad moves up above the keys'],
    [844, 844 - 480, 200, '390 x 844: they do not fit, the pad top goes to the top']]) {
    const d = fakeDom({ vh, unfolded, pad: [200, 620] });
    const cmp = { workspace: 'synth' };
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp, dock: d.dock,
      release: () => 0 });
    ctl.claim({ ...PAD, el: d.surface });
    ctl.update('init');
    await Promise.resolve(); // the claims settle
    assert.equal(ctl.state, 'collapsed', why);
    assert.equal(d.page.scrollTop, 0, `${why}: folded, the pad is whole above the handle`);
    assert.equal(ctl.toggle(), true);
    assert.equal(ctl.state, 'docked');
    assert.equal(d.page.scrollTop, want, why);
    const r = d.surface.getBoundingClientRect();
    if (r.bottom - r.top <= unfolded - 8) assert.ok(r.bottom <= unfolded - 8, `${why}: the keys do not cover it`);
    else assert.equal(r.top, 0, why);
    assert.equal(ctl.toggle(), true);
    assert.equal(ctl.state, 'collapsed');
    assert.equal(d.page.scrollTop, want, `${why}: a fold by the user moves nothing`);
  }
});

// C1-R2T51-1: a reader of the dock's state (the Synth's section nav, synth/ui.js navRoom) hears
// each applied state through onDockChange, so no module but this one names the state attribute.
test('each applied dock state is sent to onDockChange subscribers; unsubscribing stops it',
  async () => {
    const d = fakeDom({ vh: 720, pad: [200, 620] });
    d.win.CustomEvent = class { constructor(type, init) { this.type = type;
      this.detail = init && init.detail; } };
    d.win.dispatchEvent = (e) => { for (const f of d.listeners[e.type] || []) f(e); return true; };
    d.win.removeEventListener = (t, f) => {
      d.listeners[t] = (d.listeners[t] || []).filter((x) => x !== f); };
    // the page header the Synth's route keeps room under, so the docked band is measured
    const header = { getBoundingClientRect: () => ({ top: 0, bottom: 100, width: 390 }) };
    d.doc.querySelector = (sel) => (sel === '[data-osc="page.header"]' ? header : null);
    const heard = [];
    const off = yieldMod.onDockChange(d.win, (x) => heard.push(x));
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' },
      dock: d.dock, release: () => 0 });
    ctl.claim({ ...PAD, el: d.surface });
    ctl.update('init');
    await Promise.resolve();
    assert.equal(ctl.state, 'collapsed');
    // band: the height the keys take docked, measured docked and kept while folded (400 here)
    assert.deepEqual(heard.at(-1), { state: 'collapsed', yields: true, foldable: true, band: 400 });
    assert.equal(ctl.toggle(), true);
    assert.deepEqual(heard.at(-1), { state: 'docked', yields: true, foldable: true, band: 400 });
    const n = heard.length;
    off();
    assert.equal(ctl.toggle(), true);
    assert.equal(heard.length, n, 'unsubscribed: nothing more');
    assert.equal(yieldMod.DOCK_EVENT, 'osc:dock');
    // no window: a no-op that still returns an unsubscribe
    assert.equal(typeof yieldMod.onDockChange(null, () => {}), 'function');
  });

test('what the status line says of each state', () => {
  assert.match(yieldMod.dockSentence('collapsed', { yields: true, owner: 'xy-pad' }),
    /složí do úchytu, zatímco noty hraje XY pad: Alt\+K nebo úchyt ji zobrazí/);
  assert.match(yieldMod.dockSentence('docked', { yields: true, owner: 'xy-pad' }),
    /zobrazená pod padem/);
  assert.equal(yieldMod.dockSentence('docked', { yields: false, why: 'viewport' }), '');
});

// ---------------------------------------------------------------- the owner, derived

/** A window that records the events dispatched on it. */
function fakeWin() {
  const seen = [];
  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  }
  return { seen, CustomEvent, dispatchEvent(e) { seen.push(e); return true; } };
}
function fakeEl(win) {
  const kids = new Map();
  return {
    ownerDocument: { defaultView: win },
    setAttribute() {}, hasAttribute: () => false, removeAttribute() {},
    innerHTML: '', textContent: '', hidden: false, value: '', selectedOptions: [{ text: '' }],
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (!kids.has(sel)) kids.set(sel, fakeEl(win));
      return kids.get(sel);
    },
  };
}

test('the XY mount claims the notes while the pad is mounted, then drops it', async () => {
  const { mountSynthXy } = await import('../../src/js/synth/view/xy-wiring.js');
  const mountPad = () => ({ model: { gated: false, end() {} }, destroy() {} });
  // K183: the pad is playable from the first touch, so a mounted pad owns the notes; a
  // document whose XY pad was removed mounts none and claims nothing.
  for (const present of [true, false]) {
    const st = panelStore();
    if (!present) {
      const id = PANEL.resolve(st.getModel()).get('xy').id;
      assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeId: id }).ok, true);
    }
    const win = fakeWin();
    const host = fakeEl(win);
    const m = mountSynthXy(host, { store: st, panel: PANEL, mountPad });
    const claims = win.seen.filter((e) => e.type === yieldMod.NOTES_EVENT);
    assert.equal(m.notes, present ? 'xy-pad' : null);
    assert.deepEqual(claims.map((e) => [e.detail.owner, e.detail.home]),
      present ? [['xy-pad', 'synth']] : [], present ? 'mounted: claimed' : 'no pad: no claim');
    if (present) assert.ok(claims[0].detail.el, "the claim names the pad's surface");
    m.destroy();
    m.destroy();
    const after = win.seen.filter((e) => e.type === yieldMod.NOTES_EVENT);
    assert.equal(m.notes, null);
    assert.deepEqual(after.map((e) => e.detail.owner), present ? ['xy-pad', null] : [],
      'destroy drops the claim once');
  }
});

test('the dock tells the keyboard its owner and expansion; a resize re-places the pad',
  async () => {
    const d = fakeDom({ vh: 720, unfolded: 720 - 260, pad: [200, 620] });
    const seen = []; // the dock's ResizeObserver callbacks
    d.win.ResizeObserver = class { constructor(fn) { seen.push(fn); } observe() {} };
    const cmp = { workspace: 'synth', kbdNoteOwner: null, kbdDockExpanded: false };
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp, dock: d.dock,
      release: () => 0 });
    ctl.claim({ ...PAD, el: d.surface });
    ctl.update('init');
    await Promise.resolve();
    assert.deepEqual([cmp.kbdNoteOwner, cmp.kbdDockExpanded], ['xy-pad', false]);
    ctl.toggle();
    assert.deepEqual([cmp.kbdNoteOwner, cmp.kbdDockExpanded], ['xy-pad', true]);
    const placed = d.page.scrollTop;
    assert.equal(placed, 168, 'unfolded: the pad above the keys');
    // A rotation moves the page under the pad: the resize places it against the dock again.
    d.page.scrollTop = 0;
    for (const f of d.listeners.resize || []) f();
    assert.equal(d.page.scrollTop, placed, 'a resize re-places the pad while the dock yields');
    // The dock's own size settling later (the keys laid out after the redraw) re-places it too.
    d.page.scrollTop = 0;
    assert.equal(seen.length, 1, 'the dock is observed');
    seen[0]();
    assert.equal(d.page.scrollTop, placed, 'the dock settling re-places the pad');
    ctl.claim({ id: PAD.id, owner: null });
    await Promise.resolve();
    assert.deepEqual([cmp.kbdNoteOwner, cmp.kbdDockExpanded], [null, false]);
    d.page.scrollTop = 0;
    for (const f of d.listeners.resize || []) f();
    assert.equal(d.page.scrollTop, 0, 'where it does not yield, a resize moves nothing');
    seen[0]();
    assert.equal(d.page.scrollTop, 0, 'nor does the dock settling');
  });

// ---------------------------------------------------------------- the handle's key

test("the handle's key is bound through the key registry, live where the dock yields", async () => {
  const { bindPageKeys, pageKeyContext } = await import('../../src/js/ui/keys/clients.js');
  const reg = await import('../../src/js/ui/keys/registry.js');
  const dis = await import('../../src/js/ui/keys/dispatcher.js');
  let toggles = 0;
  const cmp = { workspace: 'synth', synth: { tab: 'xy' }, kbdDockYields: false,
    kbdDockToggle: () => { toggles += 1; return true; }, measureAbort() {}, onKeyDown() {},
    onKeyUp() {} };
  const keys = reg.createKeyRegistry();
  bindPageKeys({ keys, cmp, stopSequencer() {} });
  const b = keys.list().find((x) => x.id === 'keys.dock');
  assert.ok(b, 'keys.dock is bound');
  assert.deepEqual(b.keys, ['Alt+KeyK']);
  const d = dis.createKeyDispatcher({ registry: keys, context: () => pageKeyContext(cmp),
    doc: { activeElement: null, body: {}, querySelector: () => null } });
  const ev = () => ({ code: 'KeyK', key: 'k', altKey: true, ctrlKey: false, metaKey: false,
    shiftKey: false, repeat: false, preventDefault() {} });
  assert.equal(d.keydown(ev()), false, 'not bound where the dock does not yield');
  assert.equal(toggles, 0);
  cmp.kbdDockYields = true;
  assert.equal(d.keydown(ev()), true);
  d.keyup(ev());
  assert.equal(toggles, 1, 'Alt+K toggles the dock where it yields');
});

// ---------------------------------------------------------------- one place applies the rule

test('no surface sets the dock state: dock-yield.js alone applies the rule', () => {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src/js'));
  const rel = (f) => path.relative(ROOT, f);
  const src = Object.fromEntries(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));
  src['src/index.html'] = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  const having = (re) => Object.keys(src).filter((f) => re.test(src[f])).sort();
  const own = 'src/js/midi/dock-yield.js';
  assert.deepEqual(having(/\bdockState\s*\(/), [own, 'src/js/midi/routes.js'],
    'the rule is defined in routes.js and applied in dock-yield.js only');
  assert.deepEqual(having(/data-dock-state/), [own], 'only dock-yield.js writes the state');
  assert.deepEqual(having(/['"]osc:notes['"]/), [own], 'surfaces claim through claimNotes');
  assert.deepEqual(having(/\bmountDockYield\b/), [own, 'src/js/midi/keyboard-ui.js'],
    'keyboard-ui.js is the one call site');
  assert.match(src['src/js/midi/keyboard-ui.js'],
    /mountDockYield\(\{[^}]*release: kbdReleaseKeys \}/,
    'the fold releases the keys\' own notes (kbdReleaseKeys), never the pad\'s');
  assert.match(src['src/js/midi/keyboard-ui.js'],
    /const kbdReleaseKeys = \(\) => \(kb \? kb\.releaseAll\(\) : 0\);/,
    'the keys-only release lets go of the keys\' own inputs only');
  assert.deepEqual(having(/\bclaimNotes\s*\(/), [own, 'src/js/synth/view/xy-wiring.js'],
    'the XY mount is the one surface that claims the notes');
  // The catalogue declares the hook (src/js/ui/catalog/decl/keyboard.js, G001) and makes none.
  assert.deepEqual(having(/keyboard\.handle/).filter((f) => !f.startsWith('src/js/ui/catalog/')),
    [own], 'the handle is made in dock-yield.js');
  // The dock's folded children are hidden only there; the markup carries no dock state.
  assert.doesNotMatch(src['src/index.html'], /kbdDockYields|kbdDockToggle|data-dock-keep/);
});

// ---------------------------------------------------------------- placement (review of #425)

test('a re-mount handing over a new surface while the dock yields places that surface',
  async () => {
    // Firefox moved the scroller by the content an XY re-mount rebuilt above the pad (the pad
    // at -227 px at 1280 x 720): the new surface is placed as a state change places it.
    const d = fakeDom({ vh: 720, pad: [200, 620] });
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' },
      dock: d.dock, release: () => 0 });
    ctl.claim({ ...PAD, el: d.surface });
    ctl.update('init');
    await Promise.resolve();
    assert.equal(d.page.scrollTop, 0, 'whole above the folded dock: nothing moves');
    const again = { ...d.surface }; // the re-mounted surface, the same box
    again.getBoundingClientRect = d.surface.getBoundingClientRect;
    d.page.scrollTop = 540; // what the re-render did to the scroller
    ctl.claim({ id: PAD.id, owner: null });
    ctl.claim({ ...PAD, id: 'synth-xy-2', el: again });
    await Promise.resolve();
    assert.equal(ctl.state, 'collapsed');
    assert.equal(d.page.scrollTop, 200, 'the new surface is placed: its top at the top');
  });

test('a resize or the dock settling re-places the pad only where the dock covers it (R6)',
  async () => {
    const d = fakeDom({ vh: 1024, pad: [200, 620] });
    const seen = [];
    d.win.ResizeObserver = class { constructor(fn) { seen.push(fn); } observe() {} };
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' },
      dock: d.dock, release: () => 0 });
    ctl.claim({ ...PAD, el: d.surface });
    ctl.update('init');
    await Promise.resolve();
    assert.equal(ctl.yields, true);
    // The user scrolled the pad partly above the view: the folded dock covers none of it.
    d.page.scrollTop = 300;
    for (const f of d.listeners.resize || []) f();
    assert.equal(d.page.scrollTop, 300, 'a resize with the pad clear of the dock moves nothing');
    seen[0]();
    assert.equal(d.page.scrollTop, 300, 'nor does the dock settling');
    // Scrolled so the folded dock (top 964) covers the pad's bottom: placed above it.
    d.page.scrollTop = -400;
    for (const f of d.listeners.resize || []) f();
    assert.equal(d.page.scrollTop, -400 + (1020 - 956), 'covered: the pad is placed above it');
  });

test('nothing is placed from a surface with no box, and a hidden pad claims nothing (R7)',
  async () => {
    const d = fakeDom({ vh: 720, pad: [200, 620] });
    d.surface.getBoundingClientRect = () => ({ top: -100, bottom: -100, width: 0, height: 0 });
    assert.equal(yieldMod.reveal(d.win, d.surface, d.dock), 0, 'reveal on an empty rect: 0');
    assert.equal(d.page.scrollTop, 0);
    assert.equal(yieldMod.hasBox({ top: 0, bottom: 10, width: 0 }), false, 'no width: no box');
    assert.equal(yieldMod.hasBox({ top: 0, bottom: 10, width: 4 }), true);
    // The XY mount: a surface hidden at mount (a face below xl) claims the notes only once it
    // is shown, and drops the claim when it is hidden again.
    const { mountSynthXy } = await import('../../src/js/synth/view/xy-wiring.js');
    const mountPad = () => ({ model: { gated: false, end() {} }, destroy() {} });
    const win = fakeWin();
    let observed = null;
    win.ResizeObserver = class {
      constructor(fn) { observed = fn; }
      observe() {}
      disconnect() { observed = null; }
    };
    const host = fakeEl(win);
    let box = { top: 0, bottom: 0, width: 0, height: 0 };
    const surface = host.querySelector('[data-osc="synth.xy.pad"]').querySelector('[data-xy-surface]');
    surface.getBoundingClientRect = () => box;
    const m = mountSynthXy(host, { store: panelStore(), panel: PANEL, mountPad });
    const claims = () => win.seen.filter((e) => e.type === yieldMod.NOTES_EVENT)
      .map((e) => e.detail.owner);
    assert.deepEqual(claims(), [], 'hidden at mount: no claim');
    assert.equal(m.notes, null);
    box = { top: 100, bottom: 388, width: 300, height: 288 };
    observed();
    assert.deepEqual(claims(), ['xy-pad'], 'shown: claimed');
    assert.equal(m.notes, 'xy-pad');
    box = { top: 0, bottom: 0, width: 0, height: 0 };
    observed();
    assert.deepEqual(claims(), ['xy-pad', null], 'hidden again: dropped');
    m.destroy();
    assert.deepEqual(claims(), ['xy-pad', null], 'destroy drops nothing more');
    assert.equal(observed, null, 'the observer is disconnected');
  });

test("a press on the dock's handle takes no focus, so a held pad keeps its gate (R8)", () => {
  const d = fakeDom();
  yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' }, dock: d.dock,
    release: () => 0 });
  const handle = d.dock.children.find((c) => c.getAttribute('data-osc') === 'keyboard.handle');
  assert.ok(handle, 'the handle is made');
  const status = d.dock.children.find((c) => c.getAttribute('data-osc')
    === 'keyboard.dock-status');
  assert.ok(status, 'the status line is made beside it');
  assert.equal(status.getAttribute('role'), 'status', 'it is a live status line');
  assert.equal(typeof handle.onmousedown, 'function', 'the handle listens to its mousedown');
  let prevented = false;
  handle.onmousedown({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'its mousedown moves no focus off the pad');
  assert.equal(handle.onpointerdown, undefined,
    "the pointerdown is left alone: preventing it would cancel WebKit's tap click");
  assert.equal(typeof handle.onclick, 'function', 'the click still toggles the dock');
});

// #444: the Studio, armed (Q105), keeps its toolbar and editor room; where the docked keys would
// take it, the dock starts folded and its handle shows, toggles, and the user's expansion holds
// for the session (a resize does not undo it); no surface is handed over to be placed.
test('#444: a short Studio folds the dock to its handle; the handle unfolds it and that holds',
  () => {
  const short = { viewH: 667, band: 308, toolbarBottom: 572, stacked: true };
  const tall = { viewH: 1024, band: 295, toolbarBottom: 295, stacked: false };
  const r = rig({ workspace: 'studio', room: short });
  r.ctl.update('init');
  r.flush();
  assert.equal(r.ctl.state, 'collapsed', 'the keys would take the toolbar: folded');
  assert.equal(r.ctl.foldable, true, 'the handle shows');
  assert.equal(r.ctl.yields, false, 'no surface owns the notes');
  const first = r.applied.at(-1);
  assert.deepEqual([first.state, first.foldable, first.yields, first.el],
    ['collapsed', true, false, null], 'nothing is placed against the dock');
  assert.equal(r.ctl.toggle(), true, 'the handle unfolds it');
  assert.equal(r.ctl.state, 'docked');
  r.v.room = { ...short, viewH: 640 };
  r.ctl.update('viewport');
  r.flush();
  assert.equal(r.ctl.state, 'docked', 'the user\'s expansion holds across a resize');
  assert.equal(r.ctl.toggle(), true, 'and folds it again');
  assert.equal(r.ctl.state, 'collapsed');
  // A tall Studio docks the keys; the handle does not show there.
  const t = rig({ workspace: 'studio', room: tall });
  t.ctl.update('init');
  t.flush();
  assert.equal(t.ctl.state, 'docked');
  assert.equal(t.ctl.foldable, false);
  assert.equal(t.ctl.toggle(), false, 'nothing to toggle where the keys fit');
  // No measured room (the toolbar not shown yet, the band not measured): docked.
  const n = rig({ workspace: 'studio', room: null });
  n.ctl.update('init');
  n.flush();
  assert.equal(n.ctl.state, 'docked');
});

// #444 (webkit v31-studio-links: "ResizeObserver loop completed with undelivered notifications"):
// the room is judged again once the dock settles, but never inside the observer's callback, where
// a fold resizes the dock it observes; the callback only asks for one animation frame (coalesced)
// and the judgement runs there.
test('#444: the dock settling judges the room in the next frame, once, never in the callback',
  async () => {
    const d = fakeDom({ vh: 1024, pad: [200, 620] });
    const seen = [];
    const frames = [];
    d.win.ResizeObserver = class { constructor(fn) { seen.push(fn); } observe() {} };
    d.win.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    const updates = [];
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' },
      dock: d.dock, release: () => 0 });
    const update = ctl.update.bind(ctl);
    ctl.update = (why) => { updates.push(why); return update(why); };
    await Promise.resolve();
    const before = updates.length;
    seen[0]();
    seen[0]();
    assert.equal(updates.length, before, 'no judgement inside the observer callback');
    assert.equal(frames.length, 1, 'one frame asked for, however many callbacks');
    frames.shift()();
    assert.deepEqual(updates.slice(before), ['viewport'], 'judged once, in the frame');
    seen[0]();
    assert.equal(frames.length, 1, 'a later settling asks for a new frame');
  });

// K224 F1: the dock's first decision is what lets the keys draw (kbdDockDecided), set by the
// first state the dock applies.
test('K224 F1: the first state the dock applies marks it decided', async () => {
  const d = fakeDom({ vh: 1024 });
  const cmp = { workspace: 'synth' };
  const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp, dock: d.dock,
    release: () => 0 });
  assert.notEqual(cmp.kbdDockDecided, true, 'not before the first evaluation');
  ctl.update('init');
  await Promise.resolve();
  assert.equal(cmp.kbdDockDecided, true);
});

// K224 K-2: with no requestAnimationFrame the dock settling still judges the room once, out of
// the observer callback, through a zero timeout.
test('K224 K-2: no requestAnimationFrame: the room is judged by a zero timeout, once', async () => {
  const d = fakeDom({ vh: 1024 });
  const seen = [];
  const timers = [];
  d.win.ResizeObserver = class { constructor(fn) { seen.push(fn); } observe() {} };
  d.win.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'synth' },
    dock: d.dock, release: () => 0 });
  const updates = [];
  const update = ctl.update.bind(ctl);
  ctl.update = (why) => { updates.push(why); return update(why); };
  seen[0]();
  seen[0]();
  assert.equal(updates.length, 0, 'not inside the callback');
  assert.deepEqual(timers.map(([, ms]) => ms), [0], 'one zero timeout');
  timers.shift()[0]();
  assert.deepEqual(updates, ['viewport']);
});

// K224 F2: a width change while folded judges the room from the band the keys take docked at
// the new width, measured by showing the folded children within one synchronous read (no frame
// paints them), not from the band last measured docked.
test('K224 F2: folded, a width change re-measures the docked band without showing the keys',
  async () => {
    // 1280 x 940: the docked keys take 295 px (two rows), 940 - 295 < 298 + 360: folded. At 1600
    // wide the same keys take 240 px (one row less), 940 - 240 >= 658: they fit, so they unfold;
    // judged from the stale 295 px they would stay folded.
    const d = fakeDom({ vh: 940 });
    const band = () => (d.win.innerWidth >= 1600 ? 240 : 295);
    const keys = d.dock.children[0];
    let shownTops = 0; // reads of the docked top while the keys were shown by the measurement
    d.dock.getBoundingClientRect = () => {
      if (keys.hidden) return { top: 940 - 61 };
      if (d.dock.getAttribute('data-dock-state') === 'collapsed') shownTops += 1;
      return { top: 940 - band() };
    };
    d.win.innerWidth = 1280;
    const bar = { getBoundingClientRect: () => ({ top: 212, bottom: 298, width: 1000 }) };
    d.doc.querySelector = (sel) => (sel === '[data-osc="studio.bar"]' ? bar : null);
    const cmp = { workspace: 'studio' };
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp, dock: d.dock,
      release: () => 0 });
    ctl.update('init');
    await Promise.resolve();
    assert.equal(ctl.state, 'collapsed', '1280 x 940: the keys would take the editor');
    assert.equal(keys.hidden, true);
    d.win.innerWidth = 1600;
    for (const f of d.listeners.resize || []) f();
    await Promise.resolve();
    assert.equal(shownTops, 1, 'measured once with the keys shown inside one synchronous read');
    assert.equal(ctl.state, 'docked', 'judged from the band re-measured at the new width');
    assert.equal(keys.hidden, false, 'unfolded where they now fit');
  });

// #444 CI (webkit, 1024x768 Studio squashed by 11 px): the room was judged only when the
// workspace changed, and where that judgement ran before the Studio's toolbar was laid out it
// read no room, docked, and nothing judged it again (the dock's size did not change). The
// dock's observer also watches the toolbar each route keeps room under, so its first layout
// (and any later resize) asks for the room to be judged in the next frame.
test('#444: the toolbar a route keeps room under is observed; its layout judges the room again',
  async () => {
    const d = fakeDom({ vh: 768 });
    const bar = { tag: 'header',
      getBoundingClientRect: () => ({ top: 230, bottom: 316, width: 900 }) };
    d.doc.querySelector = (sel) => (sel === '[data-osc="studio.bar"]' ? bar : null);
    const observed = [];
    const seen = [];
    const frames = [];
    d.win.ResizeObserver = class {
      constructor(fn) { seen.push(fn); }
      observe(el) { observed.push(el); }
    };
    d.win.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    const ctl = yieldMod.mountDockYield({ win: d.win, doc: d.doc, cmp: { workspace: 'studio' },
      dock: d.dock, release: () => 0 });
    assert.ok(observed.includes(d.dock), 'the dock is observed');
    assert.ok(observed.includes(bar), 'the Studio toolbar is observed');
    const updates = [];
    const update = ctl.update.bind(ctl);
    ctl.update = (why) => { updates.push(why); return update(why); };
    seen[0]([{ target: bar }]);
    assert.equal(frames.length, 1, 'the toolbar\'s layout asks for one frame');
    frames.shift()();
    assert.deepEqual(updates, ['viewport'], 'and the room is judged there');
  });
