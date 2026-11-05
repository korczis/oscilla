// K171: the docked keyboard yields to the surface that owns the notes, so a pad is never under
// it, on a phone or at 1536 x 1024 (the owner's screenshot of 2026-11-05). One rule
// (src/js/midi/routes.js dockState) decides the dock's state from the workspace's route (its
// yieldsTo) and the note owner, at every size and pointer; routes.js dockRoom says where the
// pad goes against the dock (whole above it where it fits, its top at the top else); the note
// owner is derived from the claims of the mounted surfaces (the XY pad's mount claims the notes
// while it is patched into the voice); src/js/midi/dock-yield.js alone applies the rule, and only
// src/js/midi/keyboard-ui.js mounts it. The handle's key is bound through the one key registry.
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
            const { fits, by } = routes.dockRoom({ pad, dockTop, ceil, gap });
            const floor = dockTop - gap;
            const at = JSON.stringify({ pad, dockTop, ceil, gap, fits, by });
            assert.equal(fits, h <= floor - ceil, `fits iff the room holds the pad: ${at}`);
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
  assert.deepEqual(desk(1024), { fits: true, by: 0 }, '1536 x 1024: folded, nothing moves');
  assert.deepEqual(desk(720), { fits: true, by: 0 }, '1280 x 720: folded, nothing moves');
  assert.deepEqual(routes.dockRoom({ pad: { top: 200, bottom: 620 }, dockTop: 500, ceil: 56 }),
    { fits: true, by: 128 }, 'unfolded where both fit: the pad moves up above the keys');
  assert.deepEqual(routes.dockRoom({ pad: { top: 200, bottom: 620 }, dockTop: 400, ceil: 56 }),
    { fits: false, by: 144 }, 'unfolded where both do not fit: the pad top at the top');
  for (const bad of [{}, { pad: null, dockTop: 500 }, { pad: { top: 0, bottom: NaN },
    dockTop: 500 }, { pad: { top: 10, bottom: 0 }, dockTop: 500 }, { pad: { top: 0,
    bottom: 10 } }]) {
    assert.deepEqual(routes.dockRoom(bad), { fits: false, by: 0 }, JSON.stringify(bad));
  }
  assert.deepEqual(routes.dockRoom(), { fits: false, by: 0 });
});

test('keysShown: no on-screen keys on the tab of the surface the dock yields to', async () => {
  assert.equal(typeof routes.keysShown, 'function', 'routes.js exports keysShown');
  assert.equal(routes.SURFACE_TAB[SYNTH().yieldsTo], 'xy', 'the XY pad is drawn on its XY tab');
  for (const workspace of ['synth', 'studio', 'playground', 'measure', undefined]) {
    for (const tab of ['xy', 'panel', 'sound', undefined, null]) {
      const want = !(workspace === 'synth' && tab === 'xy');
      assert.equal(routes.keysShown({ workspace, tab }), want, JSON.stringify({ workspace, tab }));
    }
  }
  assert.equal(routes.keysShown(), true);
  // The keyboard's kbdKeysShown reads it (the Studio's armed-only rule kept); the computer keys
  // stay armed: only the drawing goes.
  const { createKeyboardUi } = await import('../../src/js/midi/keyboard-ui.js');
  const ui = createKeyboardUi({ win: {} });
  const at = (workspace, tab, armed = true) => {
    const c = Object.defineProperties({}, Object.getOwnPropertyDescriptors(ui));
    c.workspace = workspace;
    c.synth = { tab };
    c.kbdArmed = { ...c.kbdArmed, [workspace]: armed };
    return c;
  };
  assert.equal(at('synth', 'xy').kbdKeysShown, false, "the Synth's XY tab draws no keys");
  assert.equal(at('synth', 'xy').kbdArmedHere, true, 'the computer keys still play there');
  assert.equal(at('synth', 'panel').kbdKeysShown, true);
  assert.equal(at('playground', 'xy').kbdKeysShown, true);
  assert.equal(at('studio', 'xy').kbdKeysShown, true);
  assert.equal(at('studio', 'xy', false).kbdKeysShown, false, 'the disarmed Studio, as before');
});

test("the pad's height follows the room: 100dvh less the chrome and the dock's band", () => {
  const src = readFileSync(path.join(ROOT, 'src/js/ui/kinds/xy-pad.js'), 'utf8');
  assert.ok(src.includes(
    "'max-h-[calc(100dvh_-_var(--osc-chrome-h,0px)_-_var(--osc-dock-h,0px)_-_0.5rem)]'"),
  'one class string the build scans: the room above the dock caps the pad');
  assert.match(src, /'h-56 min-h-32 sm:h-72 '/, 'its size where the room allows, 8rem at least');
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
    const room = routes.dockRoom({ pad: r, dockTop: unfolded, ceil: 0 });
    if (room.fits) assert.ok(r.bottom <= unfolded - 8, `${why}: the keys do not cover it`);
    else assert.equal(r.top, 0, why);
    assert.equal(ctl.toggle(), true);
    assert.equal(ctl.state, 'collapsed');
    assert.equal(d.page.scrollTop, want, `${why}: a fold by the user moves nothing`);
  }
});

test('what the status line says of each state', () => {
  assert.match(yieldMod.dockSentence('collapsed', { yields: true, owner: 'xy-pad' }),
    /folds to its handle while the XY pad plays the notes: Alt\+K or the handle shows it/);
  assert.match(yieldMod.dockSentence('docked', { yields: true, owner: 'xy-pad' }),
    /shown under the pad/);
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

test('the XY mount claims the notes while it is patched into the voice, then drops it', async () => {
  const { mountSynthXy, xyVoiceAction } = await import('../../src/js/synth/view/xy-wiring.js');
  const mountPad = () => ({ model: { gated: false, end() {} }, destroy() {} });
  for (const patched of [true, false]) {
    const st = panelStore();
    if (patched) assert.equal(st.dispatch(xyVoiceAction(st.getModel(), PANEL).action).ok, true);
    const win = fakeWin();
    const host = fakeEl(win);
    const m = mountSynthXy(host, { store: st, panel: PANEL, phone: () => true, mountPad });
    const claims = win.seen.filter((e) => e.type === yieldMod.NOTES_EVENT);
    assert.equal(m.notes, patched ? 'xy-pad' : null);
    assert.deepEqual(claims.map((e) => [e.detail.owner, e.detail.home]),
      patched ? [['xy-pad', 'synth']] : [], patched ? 'patched: claimed' : 'unpatched: no claim');
    if (patched) assert.ok(claims[0].detail.el, "the claim names the pad's surface");
    m.destroy();
    m.destroy();
    const after = win.seen.filter((e) => e.type === yieldMod.NOTES_EVENT);
    assert.equal(m.notes, null);
    assert.deepEqual(after.map((e) => e.detail.owner), patched ? ['xy-pad', null] : [],
      'destroy drops the claim once');
  }
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
  assert.match(src['src/js/midi/keyboard-ui.js'], /mountDockYield\(\{[^}]*release: kbdRelease/,
    'the fold releases through the keyboard\'s own release path');
  assert.deepEqual(having(/\bclaimNotes\s*\(/), [own, 'src/js/synth/view/xy-wiring.js'],
    'the XY mount is the one surface that claims the notes');
  assert.deepEqual(having(/keyboard\.handle/), [own], 'the handle is made in dock-yield.js');
  // The dock's folded children are hidden only there; the markup carries no dock state.
  assert.doesNotMatch(src['src/index.html'], /kbdDockYields|kbdDockToggle|data-dock-keep/);
});
