// K167: the XY pad's one shared mount (src/js/synth/view/xy-wiring.js mountSynthXy). It wires
// the xy-pad node as the XY tab did (Patch the pad into the voice, the Y target, the presets:
// one BATCH and one undo entry each), and it releases a held gate, with the notes the router
// holds, on transport Stop, on a workspace leave, on the audio owner moving away and on page
// hide, through studio/live-notes.js (transport.live off and all-off). destroy() releases and
// leaves no listener; a second destroy is a no-op; a Stop with nothing held changes nothing.
// No file but xy-wiring.js builds the pad's cables (a grep of src/js). The pad kind is the real
// createXyModel behind a DOM-free mount seam; the transport is the real one on the fake audio
// environment of the sequencer tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  XY_LEAD, XY_TEXT, mountSynthXy, xyPresetAction, xyVoiceAction,
} from '../../src/js/synth/view/xy-wiring.js';
import {
  XY_RECIPES, XY_VOICE, xyCablesAction, xyPatchAction, xyPatched, xyPresetPatch, xyTarget,
  xyTargetAction,
} from '../../src/js/synth/xy.js';
import { createXyModel } from '../../src/js/ui/kinds/xy-pad.js';
import { splitJack } from '../../src/js/synth/panel.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { serializeStudio } from '../../src/js/studio/schema.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

// ---------------------------------------------------------------- DOM-free stand-ins

/** An element: listeners by type, the attributes the mount sets, one child per selector. */
function fakeEl() {
  const on = new Map();
  const kids = new Map();
  return {
    innerHTML: '', textContent: '', hidden: false, value: '', selectedOptions: [{ text: '' }],
    addEventListener(t, fn) { if (!on.has(t)) on.set(t, new Set()); on.get(t).add(fn); },
    removeEventListener(t, fn) { if (on.has(t)) on.get(t).delete(fn); },
    querySelector(sel) {
      if (!kids.has(sel)) kids.set(sel, fakeEl());
      return kids.get(sel);
    },
    fire(t, e = {}) { for (const fn of [...(on.get(t) || [])]) fn(e); },
    listeners: () => [...on.values()].reduce((n, s) => n + s.size, 0),
  };
}

/** The Alpine component as the mount reads it: a root for osc:ui, and $watch('outputOwner'). */
function fakeApp(workspace = 'synth') {
  const root = fakeEl();
  const watches = [];
  return {
    workspace, $root: root,
    $watch(key, fn) { watches.push([key, fn]); },
    leave(to) { root.fire('osc:ui', { detail: { kind: 'mode', key: 'mode', value: to } }); },
    owner(now) { for (const [k, fn] of watches) if (k === 'outputOwner') fn(now); },
    watches,
  };
}

/** The pad kind without a DOM: the real model; destroy ends a held gate as mountXyPad does. */
function padSeam() {
  const seen = [];
  const mountPad = (box, opts) => {
    const model = createXyModel(opts);
    const view = { model, opts, update() {}, destroy() { model.end('hide'); } };
    seen.push(view);
    return view;
  };
  return { mountPad, last: () => seen[seen.length - 1] };
}

/** A jack's friendly name, as synth/ui.js names it ('LPF Cutoff'). */
function jackName(id) {
  const { module, port } = splitJack(String(id));
  const m = PANEL.module(module);
  const j = m && m.jacks.find((x) => x.port === port);
  return m && j ? `${m.label} ${j.label}` : String(id);
}

/** The panel's store, the real transport on the fake engine, live calls recorded. */
function rig({ patch = true } = {}) {
  const st = panelStore();
  if (patch) assert.equal(st.dispatch(xyVoiceAction(st.getModel(), PANEL).action).ok, true);
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const real = createStudioTransport({ runtime, engine, store: st });
  const calls = [];
  const transport = Object.create(real, { live: { value: (id, ev) => {
    calls.push([id, ev.kind]);
    return real.live(id, ev);
  } } });
  const app = fakeApp();
  const pad = padSeam();
  const said = [];
  const host = fakeEl();
  const mount = (opts = {}) => mountSynthXy(host, { store: st, transport, panel: PANEL, app,
    say: (t) => said.push(t), jackName, phone: () => false, mountPad: pad.mountPad, ...opts });
  const padId = PANEL.resolve(st.getModel()).get('xy').id;
  return { st, real, transport, calls, app, pad, said, host, mount, padId, runtime, fx };
}

/** Touch the pad: the gate opens, the transport arms, the router holds the pad's note. */
function hold(r, m) {
  const v = m.view;
  assert.equal(v.model.down(1, 0.5, 0.5), true);
  assert.equal(v.model.gated, true);
  assert.equal(r.real.playing, true, 'the first touch armed the transport');
  assert.equal(r.real.heldNotes().length, 1, 'the router holds the pad note');
}
/** STOP, then the fake audio clock runs on until the runtime has released everything. */
function stopNow(r) {
  r.real.stop({ fast: true });
  r.fx.advance(1);
}
const released = (r, kinds) => r.calls.filter(([id, k]) => id === r.padId && kinds.includes(k));

// ---------------------------------------------------------------- the wiring

test('Patch the pad into the voice: the XY tab\'s cables, one BATCH, one undo entry', () => {
  const r = rig({ patch: false });
  const want = panelStore();
  const m0 = want.getModel();
  assert.equal(want.dispatch(xyCablesAction(m0, PANEL, [...XY_VOICE, ['xy.y', 'lpf.frequency']])
    .action).ok, true);
  const m = r.mount();
  assert.equal(m.view.opts.disabled, XY_TEXT.unpatched, 'unpatched: the pad says why');
  const depth = r.st.debugInfo().undoDepth;
  r.host.querySelector('[data-xy-controls]').querySelector('[data-xy-voice]').fire('click');
  assert.equal(r.st.debugInfo().undoDepth, depth + 1, 'one undo entry');
  assert.equal(serializeStudio(r.st.getModel()), serializeStudio(want.getModel()),
    'the same nodes and edges as the XY tab made');
  assert.equal(r.said.at(-1), XY_TEXT.voiced);
  r.st.undo();
  assert.equal(xyPatched(r.st.getModel(), PANEL), false, 'one undo removes every cable');
  m.destroy();
});

test('the Y target and the presets: the XY tab\'s BATCH, one undo entry each', () => {
  const r = rig();
  const m = r.mount();
  const sel = r.host.querySelector('[data-xy-controls]').querySelector(
    '[data-osc="synth.xy.target"]');
  const want = xyTargetAction(r.st.getModel(), PANEL, 'hpf.frequency').action;
  const depth = r.st.debugInfo().undoDepth;
  sel.value = 'hpf.frequency';
  sel.selectedOptions = [{ text: 'HPF Cutoff' }];
  sel.fire('change');
  assert.equal(r.st.debugInfo().undoDepth, depth + 1);
  assert.equal(xyTarget(r.st.getModel(), PANEL), 'hpf.frequency');
  assert.equal(r.said.at(-1), 'Y drives HPF Cutoff.');
  assert.equal(want.type, 'BATCH');
  const st = panelStore();
  for (const recipe of XY_RECIPES) {
    assert.deepEqual(xyPresetAction(st.getModel(), PANEL, recipe.id),
      xyPatchAction(st.getModel(), PANEL, xyPresetPatch(st.getModel(), PANEL, recipe)),
      `${recipe.id}: the presets path is xy.js's, one BATCH`);
  }
  assert.match(xyPresetAction(st.getModel(), PANEL, 'nope').reason, /no XY preset/);
  m.destroy();
});

// ---------------------------------------------------------------- the release paths

test('transport Stop releases a held gate and its notes; the pad is free for the next touch',
  () => {
    const r = rig();
    const m = r.mount();
    hold(r, m);
    stopNow(r);
    assert.equal(m.view.model.gated, false, 'Stop closed the pad\'s gate');
    assert.deepEqual(r.real.heldNotes(), []);
    assert.equal(r.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0');
    assert.equal(m.view.model.down(2, 0.2, 0.5), true);
    assert.equal(r.real.playing, true, 'the next touch arms again and plays');
    assert.equal(r.real.heldNotes().length, 1);
    m.destroy();
    stopNow(r);
  });

test('a workspace leave releases through the router before the Synth disarms', () => {
  const r = rig();
  const m = r.mount();
  hold(r, m);
  r.calls.length = 0;
  r.app.leave('synth'); // the same workspace: nothing
  assert.equal(m.view.model.gated, true);
  r.app.leave('studio');
  assert.equal(m.view.model.gated, false);
  assert.deepEqual(r.real.heldNotes(), [], 'the router released the note');
  assert.deepEqual(released(r, ['off', 'all-off']).map((c) => c[1]), ['off', 'all-off']);
  m.destroy();
  stopNow(r);
});

test('the audio owner moving away from the instrument releases it; the Studio keeping it not',
  () => {
    const r = rig();
    const m = r.mount();
    hold(r, m);
    assert.equal(r.app.watches.filter(([k]) => k === 'outputOwner').length, 1);
    r.app.owner('studio');
    assert.equal(m.view.model.gated, true, 'the panel still owns the output');
    r.app.owner('sequencer');
    assert.equal(m.view.model.gated, false);
    assert.deepEqual(r.real.heldNotes(), []);
    assert.ok(released(r, ['all-off']).length >= 1, 'through the router\'s all-off');
    m.destroy();
    const again = r.mount();
    assert.equal(r.app.watches.length, 1, 'one $watch per app, never one per mount');
    again.destroy();
    stopNow(r);
  });

test('page hide (the pad kind\'s own listener) releases through the router', () => {
  const r = rig();
  const m = r.mount();
  hold(r, m);
  r.calls.length = 0;
  m.view.model.end('hide'); // what mountXyPad's pagehide and visibilitychange listeners do
  assert.deepEqual(r.real.heldNotes(), []);
  assert.deepEqual(released(r, ['off', 'all-off']).map((c) => c[1]), ['off', 'all-off']);
  m.destroy();
  stopNow(r);
});

test('a lost note-off never leaves a voice held: release() runs the router\'s all-off',
  () => {
    const r = rig();
    const m = r.mount();
    assert.equal(r.transport.arm().ok, true);
    // A note the router holds while the view's gate is closed (its note-off was lost).
    r.real.live(r.padId, { kind: 'on', x: 0.5, y: 0.5 });
    assert.equal(m.view.model.gated, false);
    assert.equal(r.real.heldNotes().length, 1, 'the router holds a note the view does not');
    r.calls.length = 0;
    m.release('leave');
    assert.deepEqual(r.real.heldNotes(), [], 'released');
    assert.deepEqual(released(r, ['all-off']).map((c) => c[1]), ['all-off']);
    m.destroy();
    stopNow(r);
  });

test('a Stop while nothing is held changes nothing', () => {
  const r = rig();
  const m = r.mount();
  assert.equal(r.transport.arm().ok, true);
  const rev = r.st.getRevision();
  const said = r.said.length;
  r.calls.length = 0;
  stopNow(r);
  assert.equal(m.view.model.gated, false);
  assert.deepEqual(r.calls, [], 'no live event');
  assert.equal(r.st.getRevision(), rev, 'the document is unchanged');
  assert.equal(r.said.length, said, 'nothing is said');
  assert.equal(m.release('stop'), 0);
  m.destroy();
});

test('destroy() releases and leaves no listener; a second destroy is a no-op', () => {
  const r = rig();
  const m = r.mount();
  hold(r, m);
  const controls = r.host.querySelector('[data-xy-controls]');
  assert.ok(r.app.$root.listeners() >= 1, 'the leave listener');
  assert.ok(controls.querySelector('[data-osc="synth.xy.target"]').listeners() >= 1);
  m.destroy();
  assert.deepEqual(r.real.heldNotes(), [], 'destroy released the held note');
  assert.equal(r.app.$root.listeners(), 0, 'no osc:ui listener');
  assert.equal(controls.querySelector('[data-osc="synth.xy.target"]').listeners(), 0);
  r.calls.length = 0;
  r.app.owner('sequencer');
  r.app.leave('studio');
  m.destroy();
  assert.deepEqual(r.calls, [], 'a destroyed mount hears nothing and a second destroy is a no-op');
  assert.equal(m.release('stop'), 0);
  const playing = r.real.playing;
  stopNow(r);
  assert.equal(playing, true, 'the transport was still armed: the Stop event reached no mount');
});

// ---------------------------------------------------------------- phone first open

test('phone first open: the XY lead default, stated, one first action, nothing armed', () => {
  const r = rig({ patch: false });
  const depth = r.st.debugInfo().undoDepth;
  const m = r.mount({ phone: () => true });
  assert.equal(xyPatched(r.st.getModel(), PANEL), true, 'playable at once');
  assert.equal(xyTarget(r.st.getModel(), PANEL), XY_LEAD.y);
  assert.equal(r.st.debugInfo().undoDepth, depth + 1, 'one undo entry');
  const pad = PANEL.resolve(r.st.getModel()).get('xy').params;
  assert.deepEqual([pad.mode, pad.key], [XY_LEAD.scale.mode, XY_LEAD.scale.key]);
  assert.equal(m.view.opts.disabled, null);
  const stated = r.host.querySelector('[data-xy-default]').textContent;
  assert.match(stated, /^Default: C Minor pentatonic over 2 oct from C3; Y drives LPF Cutoff/i);
  assert.match(stated, /the XY lead's scale and target/);
  const first = r.host.querySelector('[data-xy-first]');
  assert.equal(first.textContent, XY_TEXT.first);
  assert.equal(first.hidden, false);
  assert.equal(m.view.opts.describedBy.length, 1, 'the first action describes the pad');
  assert.match(r.host.innerHTML, new RegExp(`id="${m.view.opts.describedBy[0]}"`));
  assert.equal(r.real.playing, false, 'nothing armed, nothing sounds before a touch');
  assert.deepEqual(r.calls.filter((c) => c[1] !== 'move'), []);
  m.destroy();
  r.st.undo();
  const again = r.mount({ phone: () => true });
  assert.equal(xyPatched(r.st.getModel(), PANEL), false, 'once per store: an undo stays undone');
  assert.equal(again.view.opts.disabled, XY_TEXT.unpatched);
  assert.deepEqual(again.view.opts.describedBy, [], 'no first action on a disabled pad');
  assert.match(r.host.innerHTML, /data-xy-first="" hidden/, 'rendered hidden until playable');
  again.destroy();
});

test('desktop first open: an unpatched pad stays unpatched and says why', () => {
  const r = rig({ patch: false });
  const m = r.mount();
  assert.equal(xyPatched(r.st.getModel(), PANEL), false);
  assert.equal(m.view.opts.disabled, XY_TEXT.unpatched);
  assert.deepEqual(m.view.opts.describedBy, []);
  m.destroy();
});

// ---------------------------------------------------------------- one wiring

const ROOT = new URL('../../', import.meta.url).pathname;
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
});

test('one wiring: no file but xy-wiring.js builds the pad\'s cables; the XY tab mounts it', () => {
  const files = walk('src/js').filter((p) => p.endsWith('.js'));
  const code = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const DEF = 'src/js/synth/xy.js';
  const WIRING = 'src/js/synth/view/xy-wiring.js';
  // The pad's own cables (Patch the pad into the voice, the Y target): xy-wiring.js only.
  const cables = /\b(xyCablesAction|xyTargetAction|XY_VOICE)\b/;
  assert.deepEqual(files.filter((p) => p !== DEF && cables.test(code(p))), [WIRING]);
  // A preset's BATCH: xy-wiring.js, and the patch catalog's source that lists and loads whole
  // patches (synth/library.js), never a view.
  const presets = /\b(xyPatchAction|xyPresetPatch)\b/;
  assert.deepEqual(files.filter((p) => p !== DEF && presets.test(code(p))).sort(),
    ['src/js/synth/library.js', WIRING]);
  assert.deepEqual(files.filter((p) => p !== 'src/js/ui/kinds/xy-pad.js'
    && /\bmountXyPad\b/.test(code(p))), [WIRING], 'one mount of the pad kind');
  const tab = code('src/js/synth/view/xy-tab.js');
  assert.match(tab, /mountSynthXy\(/);
  assert.doesNotMatch(tab, /addEventListener|\.live\(|xyDegree/, 'the XY tab wires nothing');
  assert.doesNotMatch(code(WIRING), /window\.addEventListener|keys\.bind/,
    'no window listener and no key binding of its own');
});
