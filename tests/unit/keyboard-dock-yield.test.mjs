// K171: the docked keyboard yields to the surface that owns the notes, so a pad is never under
// it on a phone. One rule (src/js/midi/routes.js dockState) decides the dock's state from the
// workspace's route (its yieldsTo), the note owner, the pointer and the width; the note owner is
// derived from the claims of the mounted surfaces (the XY pad's mount claims the notes while it
// is patched into the voice); src/js/midi/dock-yield.js alone applies the rule, and only
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

test('the rule: a pad owning the notes on a coarse pointer under 768 px folds the dock', () => {
  assert.equal(typeof routes.dockState, 'function', 'routes.js exports dockState');
  assert.equal(SYNTH().yieldsTo, 'xy-pad', "the Synth's route yields to its XY pad");
  const owners = ['xy-pad', null, 'keys', 'landing-pad'];
  const widths = [0, 320, 375, 390, 767, 767.98, 768, 820, 1024, 1536];
  let n = 0;
  for (const ws of ['synth', 'studio', 'playground', 'measure']) {
    const route = routes.routeOf(ws);
    for (const owner of owners) {
      for (const coarse of [true, false]) {
        for (const width of widths) {
          for (const userExpanded of [false, true]) {
            const want = ws === 'synth' && owner === 'xy-pad' && coarse && width < 768
              && !userExpanded ? 'collapsed' : 'docked';
            assert.equal(routes.dockState({ route, owner, coarse, width, userExpanded }), want,
              JSON.stringify({ ws, owner, coarse, width, userExpanded }));
            n += 1;
          }
        }
      }
    }
  }
  assert.equal(n, 4 * 4 * 2 * 10 * 2);
});

test('the rule: the keys owning the notes, a fine pointer or a wider screen dock it', () => {
  const route = SYNTH();
  const phone = { route, coarse: true, width: 390 };
  assert.equal(routes.dockState({ ...phone, owner: 'xy-pad' }), 'collapsed');
  assert.equal(routes.dockState({ ...phone, owner: null }), 'docked', 'the keys own the notes');
  assert.equal(routes.dockState({ ...phone, owner: 'xy-pad', coarse: false }), 'docked');
  assert.equal(routes.dockState({ ...phone, owner: 'xy-pad', width: 768 }), 'docked');
  // Changing the owner changes the state in one step, both ways.
  assert.equal(routes.dockState({ ...phone, owner: 'xy-pad' }), 'collapsed');
  assert.equal(routes.dockState({ ...phone, owner: null }), 'docked');
  // Unknown or missing inputs never fold the dock.
  for (const bad of [{ ...phone, owner: 'xy-pad', width: NaN }, { ...phone, owner: 'xy-pad',
    coarse: 'yes' }, { ...phone, owner: 'xy-pad', route: null }, { coarse: true, width: 390,
    owner: 'xy-pad' }, { ...phone, owner: undefined, route: { yieldsTo: undefined } }]) {
    assert.equal(routes.dockState(bad), 'docked', JSON.stringify(bad));
  }
  assert.equal(routes.dockYields({ ...phone, owner: 'xy-pad' }), true);
  assert.equal(routes.dockYields({ ...phone, owner: 'xy-pad', userExpanded: true }), true,
    'the user expanding it does not end the yield: the handle stays');
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

test('a fine pointer, a wide screen, another workspace or another home keep the dock', () => {
  for (const [view, why] of [[{ coarse: false }, 'a fine pointer'],
    [{ width: 1024 }, 'a wide screen'], [{ workspace: 'studio' }, 'the Studio'],
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
