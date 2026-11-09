// K167: the XY pad's one shared mount (src/js/synth/view/xy-wiring.js mountSynthXy). It wires
// the xy-pad node as the XY tab did (the Y target, the presets: one BATCH and one undo entry
// each), and it releases a held gate, with the notes the router holds, on transport Stop, on a
// workspace leave, on the audio owner moving away and on page hide, through studio/live-notes.js
// (transport.live off and all-off). destroy() releases and leaves no listener; a second destroy
// is a no-op; a Stop with nothing held changes nothing. No file but xy-wiring.js builds the
// pad's cables (a grep of src/js), xy.js xyInsertAction aside. The pad kind is the real
// createXyModel behind a DOM-free mount seam; the transport is the real one on the fake audio
// environment of the sequencer tests.
// K183 (option B): the pad is one more note input of the keys: a touch is notes.noteOn(scale
// note, velocity, 'kbd-xy'), a move into another cell notes.legato, every release path
// notes.noteOff; it mounts enabled with no Patch button (K167's phone first action superseded),
// and a touch on a suspended context says "Tap once to start audio" and replays the held note
// once audio runs. The notes path is the real one (midi/notes.js over synth/notes-sink.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import * as wiring from '../../src/js/synth/view/xy-wiring.js';
import * as xy from '../../src/js/synth/xy.js';
import { createXyModel } from '../../src/js/ui/kinds/xy-pad.js';
import { xyDegree } from '../../src/js/studio/nodes/instrument.js';
import { NOTE_NAMES, SCALE_MODES, midiToName } from '../../src/js/core/music.js';
import { DB_SCALE_FLOOR } from '../../src/js/studio/automation.js';
import { compileStudio, computeBases, limitBoundText } from '../../src/js/studio/compiler.js';
import { safeMaximum } from '../../src/js/sequencer/model.js';
import { knobModel } from '../../src/js/synth/view/knob.js';
import { xyYReading } from '../../src/js/synth/xy.js';
import { SOURCE_RANGES, splitJack } from '../../src/js/synth/panel.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { serializeStudio } from '../../src/js/studio/schema.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { createSynthNotes } from '../../src/js/synth/notes-sink.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';

// Namespace imports: on a tree without K183's exports each test fails on its own.
const { XY_TEXT, mountSynthXy, xyPresetAction, xyVelocity } = wiring;
const { XY_RECIPES, xyPatchAction, xyPatched, xyPresetPatch, xyTarget, xyTargetAction } = xy;
const SOURCE = 'kbd-xy';

/** The default Synth document: the reference template with the panel as the Synth inserts it. */
function defaultStore() {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  assert.equal(typeof xy.xyInsertAction, 'function', 'xy.js xyInsertAction (K183)');
  const r = st.dispatch(xy.xyInsertAction(st.getModel(), PANEL, { at: { x: 0, y: 600 } }));
  assert.equal(r.ok, true, r.reason);
  return st;
}
/** A document with pad R's Y cabled into LPF Cutoff, as K183's default was before K220. */
function cabledStore() {
  const st = defaultStore();
  const r = st.dispatch(xyTargetAction(st.getModel(), PANEL, 'lpf.frequency').action);
  assert.equal(r.ok, true, r.reason);
  return st;
}

// ---------------------------------------------------------------- DOM-free stand-ins

/** An element: listeners by type, the attributes the mount sets, one child per selector. */
function fakeEl() {
  const on = new Map();
  const kids = new Map();
  const attrs = new Map();
  return {
    setAttribute(k, v) { attrs.set(k, String(v)); },
    hasAttribute: (k) => attrs.has(k),
    removeAttribute(k) { attrs.delete(k); },
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

/** The Alpine component as the mount reads it: a root for osc:ui, $watch, the audio state. */
function fakeApp(workspace = 'synth', audioState = 'running') {
  const root = fakeEl();
  const watches = [];
  const app = {
    workspace, $root: root, audioState,
    $watch(key, fn) { watches.push([key, fn]); },
    leave(to) { root.fire('osc:ui', { detail: { kind: 'mode', key: 'mode', value: to } }); },
    owner(now) { for (const [k, fn] of watches) if (k === 'outputOwner') fn(now); },
    audio(now) {
      app.audioState = now;
      for (const [k, fn] of watches) if (k === 'audioState') fn(now);
    },
    watches,
  };
  return app;
}

/** The pad kind without a DOM: the real model; destroy ends a held gate as mountXyPad does. */
function padSeam() {
  const seen = [];
  const reasons = []; // why each gate closed, as the kind reports it to onGate
  const mountPad = (box, opts) => {
    const model = createXyModel({ ...opts, onGate: (open, v, why) => {
      if (!open) reasons.push(why);
      opts.onGate(open, v, why);
    } });
    const view = { model, opts, update() {}, destroy() { model.end('hide'); } };
    seen.push(view);
    return view;
  };
  return { mountPad, reasons, last: () => seen[seen.length - 1] };
}

/** A jack's friendly name, as synth/ui.js names it ('LPF Cutoff'). */
function jackName(id) {
  const { module, port } = splitJack(String(id));
  const m = PANEL.module(module);
  const j = m && m.jacks.find((x) => x.port === port);
  return m && j ? `${m.label} ${j.label}` : String(id);
}

/**
 * The default Synth document, the real transport on the fake engine (live calls recorded), and
 * the keys' real note layer (midi/notes.js routed to synth/notes-sink.js) as the pad's input,
 * its calls recorded: [kind, ...args].
 */
function rig({ audioState = 'running', store = defaultStore, sampleRate = 48000 } = {}) {
  const st = store();
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const real = createStudioTransport({ runtime, engine, store: st });
  const calls = [];
  const transport = Object.create(real, { live: { value: (id, ev) => {
    calls.push([id, ev.kind]);
    return real.live(id, ev);
  } } });
  const said = [];
  const nodes = () => PANEL.resolve(st.getModel());
  const sink = createSynthNotes({ get: () => ({ transport, handle: st }),
    transport: () => transport, ensurePanel: () => true, cmp: () => null, say: (t) => said.push(t),
    played: () => nodes().get('keys'), playedModule: () => 'keys', present: () => true, nodes,
    panel: PANEL, ENGINE_IDS: [], syncArmed: () => {} });
  const layer = createMidiNotes({ engine: null, route: () => sink });
  const noted = [];
  let releases = null; // the keys' forced release the pad registered (kbdPad)
  const input = {
    noteOn: (n, v, src) => { noted.push(['on', n, v, src]); return layer.noteOn(n, v, src); },
    noteOff: (n, src) => { noted.push(['off', n, src]); return layer.noteOff(n, src); },
    legato: (a, b, src) => { noted.push(['legato', a, b, src]); return layer.legato(a, b, src); },
    velocity: () => 90, // the keys' velocity, which the pad no longer follows (K220)
    off: () => { releases = null; },
  };
  const app = fakeApp('synth', audioState);
  app.kbdPad = (release) => { releases = release; return input; };
  const pad = padSeam();
  const host = fakeEl();
  const mount = (opts = {}) => mountSynthXy(host, { store: st, transport, panel: PANEL, app,
    say: (t) => said.push(t), jackName, mountPad: pad.mountPad, ...opts });
  const padId = nodes().get('xy').id;
  const keysId = nodes().get('keys').id;
  return { st, real, transport, calls, app, pad, said, host, mount, padId, keysId, runtime, fx,
    layer, noted, input, forced: (why) => releases(why), registered: () => !!releases, engine };
}

/** Touch the pad: the gate opens, the transport arms, the Keys node holds the pad's note. */
function hold(r, m) {
  const v = m.view;
  assert.equal(v.model.down(1, 0.5, 0.5), true);
  assert.equal(v.model.gated, true);
  assert.equal(r.real.playing, true, 'the first touch armed the transport');
  const n = r.noted.filter((c) => c[0] === 'on').at(-1);
  assert.ok(n && n[3] === SOURCE, 'the touch is a note of the keys\' layer, source kbd-xy');
  assert.ok(r.real.heldNotes().includes(n[1]), 'the Keys node holds the pad note');
}
/** The pad let go of everything: its note-off sent, nothing held by the router or the layer. */
function letGo(r, what) {
  const on = r.noted.filter((c) => c[0] === 'on').at(-1);
  const off = r.noted.filter((c) => c[0] === 'off').at(-1);
  assert.ok(off && off[1] === on[1] && off[2] === SOURCE, `${what}: the pad's note-off`);
  assert.deepEqual(r.real.heldNotes(), [], `${what}: nothing held`);
  assert.equal(r.layer.releaseInput('xy'), 0, `${what}: the layer holds no xy note`);
}
/** STOP, then the fake audio clock runs on until the runtime has released everything. */
function stopNow(r) {
  r.real.stop({ fast: true });
  r.fx.advance(1);
}
const released = (r, kinds) => r.calls.filter(([id, k]) => id === r.padId && kinds.includes(k));

// ---------------------------------------------------------------- the wiring

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

// ---------------------------------------------------------------- the notes path (K183)

test('a touch presses the scale note as kbd-xy, a move into another cell is legato, the lift '
  + 'its note-off', () => {
  const r = rig();
  const m = r.mount();
  const p = PANEL.resolve(r.st.getModel()).get('xy').params;
  const steps = xyDegree(1, p).steps;
  const noteAt = (i) => xyDegree((i + 0.5) / steps, p).note; // the node's own quantisation
  assert.equal(m.view.opts.disabled, null, 'enabled from the first open (K183)');
  m.view.model.down(1, 0.5 / steps, 0.5); // the first cell
  // K220: Y is the touch's velocity (1-127), never the keys' 90.
  assert.equal(typeof xyVelocity, 'function', 'xy-wiring.js xyVelocity (K220)');
  assert.deepEqual([xyVelocity(0), xyVelocity(0.5), xyVelocity(1)], [1, 64, 127]);
  assert.deepEqual(r.noted, [['on', noteAt(0), 64, SOURCE]], 'Y 0.5 is velocity 64, kbd-xy');
  assert.equal(r.real.playing, true);
  assert.ok(r.real.heldNotes().includes(noteAt(0)), 'the Keys node holds the note');
  m.view.model.move(1, 0.6 / steps, 0.7); // the same cell: Y only, no note change
  assert.equal(r.noted.length, 1);
  m.view.model.move(1, 6.5 / steps, 0.7); // the seventh cell
  assert.deepEqual(r.noted.at(-1), ['legato', noteAt(0), noteAt(6), SOURCE]);
  const keysHeld = r.real.heldNotes();
  assert.ok(keysHeld.includes(noteAt(6)) && !keysHeld.includes(noteAt(0)),
    'the Keys node holds the new note only');
  const gates = r.calls.filter(([id, k]) => id === r.keysId && k === 'on').length;
  assert.equal(gates, 1, 'the legato sent no second note-on to the Keys node (no new gate)');
  m.view.model.up(1);
  assert.deepEqual(r.noted.at(-1), ['off', noteAt(6), SOURCE]);
  assert.deepEqual(r.real.heldNotes(), []);
  m.destroy();
  stopNow(r);
});

test('a computer key and a pad touch both sound: one Keys node, last-note priority', () => {
  const r = rig();
  const m = r.mount();
  const keyNote = 72; // C5: above the pad's middle cell (C4)
  assert.equal(r.real.arm().ok, true);
  const k = r.layer.noteOn(keyNote, 100, 'kbd-key');
  assert.equal(k.ok, true, 'a computer key sounds: the Keys normals are intact');
  assert.equal(k.top, keyNote);
  m.view.model.down(1, 0.5, 0.5);
  const padNote = r.noted.at(-1)[1];
  assert.notEqual(padNote, keyNote);
  assert.ok([keyNote, padNote].every((n) => r.real.heldNotes().includes(n)), 'both held');
  const top = r.real.live(r.keysId, { kind: 'legato', from: padNote, note: padNote });
  assert.equal(top.top, padNote, 'the last pressed, the pad\'s, sounds');
  m.view.model.up(1);
  assert.deepEqual(r.real.heldNotes(), [keyNote], 'the key\'s note returns, still held');
  assert.equal(r.calls.filter(([id, kd]) => id === r.keysId && kd === 'off').length, 1);
  r.layer.noteOff(keyNote, 'kbd-key');
  assert.deepEqual(r.real.heldNotes(), []);
  m.destroy();
  stopNow(r);
});

// ---------------------------------------------------------------- the release paths

test('transport Stop releases a held gate and its notes; the pad is free for the next touch',
  () => {
    const r = rig();
    const m = r.mount();
    hold(r, m);
    stopNow(r);
    assert.equal(m.view.model.gated, false, 'Stop closed the pad\'s gate');
    letGo(r, 'Stop');
    assert.equal(r.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0');
    r.app.owner(null); // the outputOwner change that follows the Stop
    assert.deepEqual(r.pad.reasons, ['stop'], 'the Stop released it, never \'owner\'');
    assert.equal(m.view.model.down(2, 0.2, 0.5), true);
    assert.equal(r.real.playing, true, 'the next touch arms again and plays');
    assert.ok(r.real.heldNotes().length >= 1);
    r.app.owner(null); // no owner while held: released as the Stop's
    assert.deepEqual(r.pad.reasons, ['stop', 'stop']);
    letGo(r, 'no owner');
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
  letGo(r, 'leave');
  assert.deepEqual(released(r, ['off', 'all-off']).map((c) => c[1]), ['off', 'all-off']);
  m.destroy();
  stopNow(r);
});

test('the audio owner moving away from the instrument releases it; the Studio keeping it not',
  () => {
    const r = rig();
    const m = r.mount();
    hold(r, m);
    const watching = (key) => r.app.watches.filter(([k]) => k === key).length;
    assert.equal(watching('outputOwner'), 1);
    r.app.owner('studio');
    assert.equal(m.view.model.gated, true, 'the panel still owns the output');
    r.app.owner('sequencer');
    assert.equal(m.view.model.gated, false);
    letGo(r, 'owner');
    assert.deepEqual(r.pad.reasons, ['owner'], 'released as owner');
    assert.ok(released(r, ['all-off']).length >= 1, 'through the router\'s all-off');
    m.destroy();
    const again = r.mount();
    assert.deepEqual([watching('outputOwner'), watching('audioState')], [1, 1],
      'one $watch per app and key, never one per mount');
    again.destroy();
    stopNow(r);
  });

test('page hide, blur and Escape (the pad kind\'s own listeners) release the pad\'s note', () => {
  for (const why of ['hide', 'blur', 'escape']) {
    const r = rig();
    const m = r.mount();
    hold(r, m);
    r.calls.length = 0;
    m.view.model.end(why); // what mountXyPad's pagehide, blur and Escape listeners do
    letGo(r, why);
    assert.deepEqual(released(r, ['off', 'all-off']).map((c) => c[1]), ['off', 'all-off'], why);
    m.destroy();
    stopNow(r);
  }
});

test('the keys\' forced releases (kbdPad: blur, hide, Escape, a switch, a disarm) close the '
  + 'pad\'s gate; destroy unregisters it', () => {
  const r = rig();
  const m = r.mount();
  assert.equal(r.registered(), true, 'the mount registered its release with the keys');
  hold(r, m);
  assert.equal(r.forced('keys'), 1, 'one gate released');
  assert.equal(m.view.model.gated, false);
  letGo(r, 'the keys\' forced release');
  assert.deepEqual(r.pad.reasons, ['keys']);
  m.destroy();
  assert.equal(r.registered(), false, 'destroy unregisters the pad from the keys');
  stopNow(r);
  // The first touch's own arm claims the output, and the claim releases the keys (main.js
  // stopPlayback -> midiAllOff -> kbdReleaseAll): that release never closes the touch's gate.
  const c = rig();
  const own = c.mount({ arm: () => { c.forced('keys'); return c.transport.arm(); } });
  own.view.model.down(1, 0.5, 0.5);
  assert.equal(own.view.model.gated, true, 'the gate stays open through its own arm');
  assert.ok(c.real.heldNotes().includes(c.noted.at(-1)[1]), 'and its note sounds');
  assert.equal(c.forced('keys'), 1, 'a later forced release closes it');
  letGo(c, 'after the arm');
  own.destroy();
  stopNow(c);
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
  assert.deepEqual(r.noted, [], 'no note');
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
  letGo(r, 'destroy');
  assert.equal(r.app.$root.listeners(), 0, 'no osc:ui listener');
  assert.equal(controls.querySelector('[data-osc="synth.xy.target"]').listeners(), 0);
  r.calls.length = 0;
  r.noted.length = 0;
  r.app.owner('sequencer');
  r.app.leave('studio');
  r.app.audio('running');
  m.destroy();
  assert.deepEqual(r.calls, [], 'a destroyed mount hears nothing and a second destroy is a no-op');
  assert.deepEqual(r.noted, []);
  assert.equal(m.release('stop'), 0);
  const playing = r.real.playing;
  stopNow(r);
  assert.equal(playing, true, 'the transport was still armed: the Stop event reached no mount');
});

// ---------------------------------------------------------------- first open (K183)

test('first open edits nothing and plays at once: enabled, no Patch button, its default '
  + 'stated (K183 supersedes K167\'s phone first action)', () => {
  const r = rig();
  const rev = r.st.getRevision();
  const depth = r.st.debugInfo().undoDepth;
  const before = serializeStudio(r.st.getModel());
  const m = r.mount();
  assert.equal(r.st.getRevision(), rev, 'opening the tab dispatches nothing');
  assert.equal(r.st.debugInfo().undoDepth, depth, 'no history entry');
  assert.equal(serializeStudio(r.st.getModel()), before, 'the document is unchanged');
  assert.equal(m.view.opts.disabled, null);
  const controls = r.host.querySelector('[data-xy-controls]');
  assert.doesNotMatch(controls.innerHTML, /data-xy-voice|Patch the pad/, 'no Patch button');
  assert.doesNotMatch(r.host.innerHTML, /data-xy-first="" [^>]*hidden/, 'the line is shown');
  const stated = r.host.querySelector('[data-xy-default]').textContent;
  // The panel's VCOs sit at 16' and 8', both in the mix: the range starts at the 16' note heard
  // (S3), reached through the keys' pitch normals the pad plays (K183).
  assert.match(stated,
    /^Výchozí: C Minor pentatonic, 2 oct od C2; pad hraje to, co hrají klávesy; /i);
  // K220: no Y cable by default; Y is the touch's velocity (pad L owns the filters).
  assert.ok(stated.endsWith(XY_TEXT.free), stated);
  assert.match(XY_TEXT.free, /^Y je síla úhozu/);
  const first = r.host.querySelector('[data-xy-first]');
  assert.equal(first.textContent, XY_TEXT.first);
  assert.equal(m.view.opts.describedBy.length, 1, 'the line describes the pad');
  assert.match(r.host.innerHTML, new RegExp(`id="${m.view.opts.describedBy[0]}"`));
  assert.equal(r.real.playing, false, 'nothing armed, nothing sounds before a touch');
  assert.deepEqual(r.noted, []);
  assert.deepEqual(r.calls.filter((c) => c[1] !== 'move'), []);
  assert.equal(xyPatched(r.st.getModel(), PANEL), false, 'no Pitch or Gate cable is needed');
  m.view.model.down(1, 0.5, 0.5);
  assert.equal(r.noted.length, 1, 'the first touch plays a note');
  m.view.model.up(1);
  m.destroy();
  stopNow(r);
});

test('without the Y cable the pad plays its notes and says why Y drives nothing', () => {
  const r = rig({ store: cabledStore });
  assert.equal(xyTarget(r.st.getModel(), PANEL), 'lpf.frequency');
  assert.equal(r.st.dispatch(xyTargetAction(r.st.getModel(), PANEL, null).action).ok, true);
  assert.equal(xyTarget(r.st.getModel(), PANEL), null);
  const m = r.mount();
  assert.match(r.host.querySelector('[data-xy-default]').textContent,
    new RegExp(XY_TEXT.free.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(typeof XY_TEXT.free, 'string');
  m.view.model.down(1, 0.5, 0.5);
  assert.equal(r.noted.at(-1)[0], 'on', 'pitch only: the note still plays');
  assert.ok(r.real.heldNotes().includes(r.noted.at(-1)[1]));
  m.view.model.up(1);
  m.destroy();
  stopNow(r);
});

test('the cold first touch: a suspended context says "Tap once to start audio"; once audio '
  + 'runs a note still held is played again', () => {
  const r = rig({ audioState: 'suspended' });
  const m = r.mount();
  const first = r.host.querySelector('[data-xy-first]');
  m.view.model.down(1, 0.5, 0.5);
  assert.equal(first.textContent, XY_TEXT.cold);
  assert.equal(XY_TEXT.cold, 'Tap once to start audio.');
  const note = r.noted.at(-1)[1];
  r.app.audio('suspended');
  assert.equal(r.noted.length, 1, 'nothing replays while the context is suspended');
  r.app.audio('running'); // the unlock, within this gesture or the next
  assert.deepEqual(r.noted.at(-1), ['on', note, xyVelocity(0.5), SOURCE],
    'the held note is played again, at its touch\'s velocity');
  assert.equal(first.textContent, XY_TEXT.first, 'the line says the pad plays');
  assert.ok(r.real.heldNotes().includes(note));
  m.view.model.up(1);
  letGo(r, 'the lift after the unlock');
  // A cold touch lifted before the unlock replays nothing.
  r.app.audioState = 'suspended';
  m.view.model.down(2, 0.5, 0.5);
  assert.equal(first.textContent, XY_TEXT.cold);
  m.view.model.up(2);
  const n = r.noted.length;
  r.app.audio('running');
  assert.equal(r.noted.length, n, 'no note replays once the touch has lifted');
  assert.equal(first.textContent, XY_TEXT.first);
  m.destroy();
  stopNow(r);
});

test('a refused arm is never a silent touch: said, shown on the pad\'s line, gate closed', () => {
  const r = rig();
  const why = 'The output belongs to the measurement: stop it (Esc) before playing.';
  let answer = { ok: false, reason: why };
  const m = r.mount({ arm: () => answer, say: (t, assertive) => r.said.push([t, assertive]) });
  assert.equal(m.view.model.down(1, 0.5, 0.5), true);
  assert.deepEqual(r.said.at(-1), [why, true], 'said assertively');
  const first = r.host.querySelector('[data-xy-first]');
  assert.equal(first.textContent, why, 'shown on the line that describes the pad');
  assert.equal(first.hidden, false);
  assert.equal(m.view.model.gated, false, 'the refused touch holds no gate');
  assert.equal(r.real.playing, false);
  assert.deepEqual(r.real.heldNotes(), []);
  assert.deepEqual(r.noted, [], 'a refused touch plays no note');
  assert.deepEqual(r.pad.reasons, ['refused']);
  m.view.model.up(1);
  const n = r.said.length;
  answer = { ok: false, reason: why, said: true }; // the arm said it itself: not twice
  m.view.model.down(2, 0.5, 0.5);
  assert.equal(r.said.length, n);
  answer = false; // no reason given: the mount's own sentence
  m.view.model.up(2);
  m.view.model.down(3, 0.5, 0.5);
  assert.deepEqual(r.said.at(-1), [XY_TEXT.refused, true]);
  m.view.model.up(3);
  answer = true;
  r.transport.arm();
  m.view.model.down(4, 0.5, 0.5);
  assert.equal(first.textContent, XY_TEXT.first, 'a touch that plays restores the first action');
  assert.ok(r.real.heldNotes().length >= 1);
  m.destroy();
  stopNow(r);
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

// ---------------------------------------------------------------- the view's data (S3)

/** The pad's node with its scale set to `scale` (one NODE_PARAM_SET), then mounted. */
function scaled(r, scale) {
  const id = PANEL.resolve(r.st.getModel()).get('xy').id;
  assert.equal(r.st.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, params: scale }).ok, true);
  return r.mount();
}

test('each cell is named by the note the runtime plays there, for every scale, key and span',
  () => {
    const SCALES = [
      { mode: 'minor-pentatonic', key: 'C', octave: 3, span: 2 },
      { mode: 'dorian', key: 'D', octave: 2, span: 1 },
      { mode: 'major', key: 'F#', octave: 4, span: 3 },
      { mode: 'chromatic', key: 'A#', octave: 1, span: 1 },
      { mode: 'locrian', key: 'B', octave: 5, span: 4 },
    ];
    for (const sc of SCALES) {
      const r = rig();
      const m = scaled(r, sc);
      const { opts, model } = m.view;
      const steps = sc.span * SCALE_MODES[sc.mode].length + 1;
      assert.equal(opts.cells.length, steps, `${sc.mode}: one cell per step`);
      const h = r.runtime.nodes;
      for (let i = 0; i < steps; i++) {
        const fx = (i + 0.5) / steps;
        if (i === 0) assert.equal(model.down(1, fx, 0.5), true);
        else assert.equal(model.move(1, fx, 0.5), true);
        assert.equal(model.value.x, i);
        // What the runtime's pad handle plays for the x the mount sent.
        const ev = h.get(r.padId).outputs.pitch.offset.events;
        const pitch = ev[ev.length - 1].value; // the last step set on the pitch AudioParam
        const played = midiToName(69 + 12 * pitch);
        const what = `${sc.key} ${sc.mode} span ${sc.span} cell ${i}`;
        // The panel's VCOs at 16' and 8', both in the mix: the note heard is VCO 1's, the lower.
        const heard = vcoNote(r, 'vco1', pitch);
        assert.equal(heard, midiToName(69 + 12 * pitch - 12), `${what}: 16' is an octave down`);
        assert.equal(opts.readout.x(i), heard, `${what}: the ring's note`);
        assert.ok(model.text('x').startsWith(`${heard}, degree `), `${what}: X's aria-valuetext`);
        const c = opts.cells[i];
        assert.equal(c.label, steps <= 15 || c.root ? heard
          : NOTE_NAMES[NOTE_NAMES.indexOf(played.replace(/-?\d+$/, ''))], `${what}: its label`);
        assert.equal(c.root, played.replace(/-?\d+$/, '') === sc.key, `${what}: root`);
      }
      model.up(1);
      m.destroy();
      stopNow(r);
    }
  });

const lastOf = (prm) => (prm.events.length ? prm.events[prm.events.length - 1].value
  : prm.value);
/** The note panel VCO `mid` sounds on the running graph for the pad's Pitch `pitch` (octaves):
 *  its oscillator's frequency x 2^(its pitch cable's gain x pitch), named. The cable is the
 *  pad's own Pitch where patched, else the keys' pitch normal the pad plays through (K183). */
function vcoNote(r, mid, pitch) {
  const id = PANEL.resolve(r.st.getModel()).get(mid).id;
  const edges = r.st.getModel().graph.edges.filter((x) => x.from.port === 'pitch'
    && x.to.node === id);
  const e = edges.find((x) => x.from.node === r.padId)
    || edges.find((x) => x.from.node === r.keysId);
  const osc = r.runtime.nodes.get(id).outputs.audio;
  const g = lastOf(r.runtime.edges.get(e.id).gain.gain);
  return midiToName(69 + 12 * Math.log2((lastOf(osc.frequency) * 2 ** (g * pitch)) / 440));
}

/**
 * A preset (panel values, then `edit` on the store) touched at a cell: the note each panel VCO
 * sounds on the running graph (vcoNote) and the mount's texts for that cell.
 */
function heardAt(id, values = {}, edit = null) {
  const r = rig({ patch: false });
  assert.equal(r.st.dispatch(xyPresetAction(r.st.getModel(), PANEL, id).action).ok, true);
  const res = PANEL.resolve(r.st.getModel());
  for (const [jack, value] of Object.entries(values)) {
    const [mod, key] = jack.split('.');
    assert.equal(r.st.dispatch({ type: 'NODE_PARAM_SET', nodeId: res.get(mod).id, key, value })
      .ok, true);
  }
  if (edit) edit(r, res);
  const m = r.mount();
  hold(r, m);
  const i = m.view.model.value.x;
  const pitch = lastOf(r.runtime.nodes.get(r.padId).outputs.pitch.offset); // the pad's Pitch
  const out = { sent: midiToName(69 + 12 * pitch), vco1: vcoNote(r, 'vco1', pitch),
    vco2: vcoNote(r, 'vco2', pitch), ring: m.view.opts.readout.x(i),
    aria: m.view.model.text('x'), stated: r.host.querySelector('[data-xy-default]').textContent };
  m.view.model.up(1);
  m.destroy();
  stopNow(r);
  return out;
}
/** Whether note name `b` is one octave under `a` ("C3", "C2"). */
const octaveUnder = (a, b) => {
  const [, na, oa] = /^([A-G]#?)(-?\d+)$/.exec(a);
  const [, nb, ob] = /^([A-G]#?)(-?\d+)$/.exec(b);
  return na === nb && Number(ob) === Number(oa) - 1;
};
/** The ring and X's aria-valuetext name `note`. */
function names(v, note, what) {
  assert.equal(v.ring, note, `${what}: the ring`);
  assert.ok(v.aria.startsWith(`${note}, degree `), `${what}: ${v.aria}`);
}

test('XY bass names the note heard: both VCOs at 16\', an octave under the pad\'s Pitch', () => {
  const v = heardAt('xy-bass');
  assert.equal(v.vco1, v.vco2, 'both VCOs sound one note');
  assert.ok(octaveUnder(v.sent, v.vco1), "16' sounds an octave under the pad's Pitch");
  names(v, v.vco1, 'XY bass');
  assert.match(v.stated, /, 1 oct od D1;/, 'the range from the note heard (pad D2)');
});

test('XY lead names the note heard: both VCOs at 8\', the pad\'s own note (as before)', () => {
  const v = heardAt('xy-lead');
  assert.deepEqual([v.vco1, v.vco2], [v.sent, v.sent]);
  names(v, v.sent, 'XY lead');
  assert.match(v.stated, /, 2 oct od C3;/);
});

test('XY sweep as built (16\' and 8\', both in the mix) names the 16\' note, the lower', () => {
  const v = heardAt('xy-sweep');
  assert.ok(octaveUnder(v.vco2, v.vco1), "VCO 1 at 16' an octave under VCO 2 at 8'");
  names(v, v.vco1, 'XY sweep');
});

test('XY bell as built (4\' and 8\', VCO 2 heard through the Ring) names the 8\' note', () => {
  const v = heardAt('xy-bell');
  assert.ok(octaveUnder(v.vco1, v.vco2), "VCO 2 at 8' an octave under VCO 1 at 4'");
  names(v, v.vco2, 'XY bell');
});

test('XY bell with VCO 2 out of the mix (its Mixer and Ring levels 0) names the 4\' note', () => {
  // As built VCO 2's own Mixer level is 0 already; it is heard through the Ring (level 4).
  const v = heardAt('xy-bell', { 'mix.level2': 0, 'mix.level4': 0 });
  assert.ok(octaveUnder(v.vco1, v.vco2));
  names(v, v.vco1, "XY bell, VCO 2 silent: VCO 1's 4'");
});

test('XY bell with both VCOs at 4\' names the note heard: an octave above the pad\'s Pitch', () => {
  const v = heardAt('xy-bell', { 'vco2.scale': '4' });
  assert.equal(v.vco1, v.vco2);
  assert.ok(octaveUnder(v.vco1, v.sent), "4' sounds an octave above the pad's Pitch");
  names(v, v.vco1, "XY bell at 4'");
});

test('a 16\' VCO below the level floor beside an 8\' VCO: the 8\' note decides', () => {
  // VCO 1 at 16' with its Mixer level at -66 dB, under DB_SCALE_FLOOR (-60 dB); VCO 2 at 8'.
  assert.ok(20 * Math.log10(0.0005) < DB_SCALE_FLOOR);
  const v = heardAt('xy-sweep', { 'mix.level1': 0.0005 });
  assert.ok(octaveUnder(v.vco2, v.vco1));
  names(v, v.vco2, "VCO 1 all but off: VCO 2's 8'");
});

test('audible VCOs a fifth apart (an FM offset): the pad names the note it sends, no guess', () => {
  // XY lead (both 8'), VCO 2's FM input offset by 7/12 oct by its MG cable's constant part.
  const v = heardAt('xy-lead', {}, (r, res) => {
    const vco2 = res.get('vco2').id;
    const e = r.st.getModel().graph.edges.find((x) => x.to.node === vco2 && x.to.port === 'fm'
      && x.from.node === res.get('mg').id);
    assert.equal(r.st.dispatch({ type: 'EDGE_UPDATE', edgeId: e.id,
      props: { offset: 7 / 12 } }).ok, true);
  });
  names(v, `sends ${v.sent}`, 'a fifth apart');
  assert.match(v.stated, /\(nota, kterou pad posílá\);/, v.stated);
});

test('Y reads what its target plays: the compiler\'s own sizing at the context\'s Nyquist', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const recipe of XY_RECIPES) {
      const r = rig({ patch: false, sampleRate });
      assert.equal(r.st.dispatch(xyPresetAction(r.st.getModel(), PANEL, recipe.id).action).ok,
        true);
      const m = r.mount({ sampleRate: () => r.engine.sampleRate });
      const { opts } = m.view;
      const doc = r.st.getModel();
      const rd = xyYReading(doc, PANEL, { sampleRate });
      assert.equal(rd.jack, recipe.y);
      assert.equal(rd.sampleRate, sampleRate);
      // The compiler's sizing of the target's base and of Y's edge with every cable into the
      // node and the real 0.95 x Nyquist of the context, at every y.
      const node = PANEL.resolve(doc).get(rd.jack.split('.')[0]);
      const plan = compileStudio(doc, { engine: r.engine });
      const port = rd.jack.split('.')[1];
      const incoming = plan.edgeOrder.map((id) => plan.edges.get(id))
        .filter((e) => e.to.node === node.id && e.kind === 'control')
        .map((e) => ({ edge: e, handle: { status: e.status, scale: 1,
          range: (SOURCE_RANGES[plan.nodes.get(e.from.node).type] || {})[e.from.port]
            ? SOURCE_RANGES[plan.nodes.get(e.from.node).type][e.from.port].range : [-1, 1] } }));
      const edge = incoming.find((x) => x.edge.from.port === 'y').edge;
      const cb = computeBases(plan.nodes.get(node.id), incoming,
        { safeMaximum: safeMaximum(sampleRate) });
      const b = cb.base[port];
      const g = cb.gains.get(edge.id);
      const k = knobModel(rd.param);
      const name = jackName(recipe.y);
      const held = cb.limited.has(edge.id);
      assert.equal(rd.limited, held, `${recipe.id} at ${sampleRate}: limited`);
      for (const y of [0, 0.25, 0.5, 0.8, 1]) {
        const want = rd.props.mapping === 'log'
          ? b.value * 2 ** ((b.cents + 1200 * g * y) / 1200) : b.value + g * y;
        assert.ok(Math.abs(rd.at(y) - want) <= 1e-9 * Math.max(1, Math.abs(want)),
          `${recipe.id} y ${y}: ${rd.at(y)} vs the compiler's ${want}`);
        const past = want > rd.param.max || want < rd.param.min ? 'mimo rozsah' : '';
        const notes = [past, held ? 'drženo' : ''].filter(Boolean).join(', ');
        assert.equal(opts.readout.y(y), `${name} ${k.text(want)}${notes ? ` (${notes})` : ''}`,
          `${recipe.id}: the ring's value`);
        assert.ok(opts.text.y(y).includes(`% to ${name}: ${k.text(want)}`),
          `${recipe.id}: Y's aria-valuetext ${opts.text.y(y)}`);
      }
      assert.deepEqual(opts.readout.yEnds(), [k.text(rd.at(0)), k.text(rd.at(1))], 'the Y ends');
      m.destroy();
    }
  }
});

/** Y's aria-valuetext without its closing count of the other cables into the target. */
const noOthers = (t) => t.replace(/, a do něj vede ještě \d+ kabel(?:y|ů)?$/, '');

test('the Y value equals what the running graph plays at 44.1 and 48 kHz, held near Nyquist',
  () => {
    const last = (p) => (p.events.length ? p.events[p.events.length - 1].value : p.value);
    // A log target whose cable asks past 0.95 x Nyquist: LPF Cutoff at 6 kHz (XY lead, two
    // octaves up), HPF Cutoff at 20 kHz (XY sweep).
    const CASES = [['xy-lead', 6000], ['xy-sweep', 20000]];
    const seen = {};
    for (const sampleRate of [44100, 48000]) {
      for (const [id, hz] of CASES) {
        const r = rig({ patch: false, sampleRate });
        const recipe = XY_RECIPES.find((x) => x.id === id);
        assert.equal(r.st.dispatch(xyPresetAction(r.st.getModel(), PANEL, id).action).ok, true);
        const [mod, port] = recipe.y.split('.');
        const nodeId = PANEL.resolve(r.st.getModel()).get(mod).id;
        assert.equal(r.st.dispatch({ type: 'NODE_PARAM_SET', nodeId, key: port, value: hz }).ok,
          true);
        const m = r.mount({ sampleRate: () => r.engine.sampleRate });
        hold(r, m); // the first touch arms: the runtime plays the document at `sampleRate`
        const doc = r.st.getModel();
        const padR = PANEL.resolve(doc).get('xy').id; // pad L's Y is normalled into HPF (K220)
        const yEdge = doc.graph.edges.find((e) => e.from.node === padR && e.from.port === 'y'
          && e.to.node === nodeId);
        const eh = r.runtime.edges.get(yEdge.id);
        assert.equal(eh.status, 'active');
        // Y's depth gain feeds the biquad's detune (cents per unit of Y): what plays at y.
        const bq = r.fx.ctx.created.find((n) => n.kind === 'biquad'
          && n.detune === eh.gain.outputs[0]);
        assert.ok(bq, 'the target biquad');
        const g = last(eh.gain.gain);
        const played = (y) => last(bq.frequency) * 2 ** ((last(bq.detune) + g * y) / 1200);
        const rd = xyYReading(doc, PANEL, { sampleRate });
        const k = knobModel(rd.param);
        const name = jackName(recipe.y);
        const what = `${id} at ${hz} Hz, ${sampleRate} Hz`;
        for (const y of [0, 0.25, 0.5, 0.8, 1]) { // first the number: shown = played
          const want = played(y);
          assert.ok(Math.abs(rd.at(y) - want) <= 1e-6 * want,
            `${what} y ${y}: shown ${rd.at(y)}, played ${want}`);
          assert.ok(want <= safeMaximum(sampleRate) * (1 + 1e-12), `${what}: at most 0.95 x Nyq`);
        }
        assert.equal(rd.limited, true, `${what}: Y's excursion is scaled to fit`);
        for (const y of [0, 0.25, 0.5, 0.8, 1]) { // then the text that says so
          const want = played(y);
          const past = want > rd.param.max ? 'mimo rozsah, ' : '';
          assert.equal(m.view.opts.readout.y(y), `${name} ${k.text(want)} (${past}drženo)`);
          // The default document's LPF normals (MG, EG 2) are the other cables it names (K183).
          assert.ok(noOthers(m.view.opts.text.y(y)).endsWith(`: ${k.text(want)}${past
            ? ' (mimo rozsah)' : ''}, drženo nejvýš na `
            + `${limitBoundText({ cap: safeMaximum(sampleRate), bound: 'nyquist', sampleRate })}`),
          `${what}: Y's aria-valuetext ${m.view.opts.text.y(y)}`);
        }
        const end = (v) => `${k.text(v)}${v > rd.param.max ? ' (mimo rozsah)' : ''}`;
        assert.deepEqual(m.view.opts.readout.yEnds(), [end(played(0)), end(played(1))]);
        seen[`${id}@${sampleRate}`] = rd.at(0.5);
        m.view.model.up(1);
        m.destroy();
        stopNow(r);
      }
    }
    // The rate matters: the same document plays (and reads) higher at 48 kHz.
    assert.ok(seen['xy-lead@48000'] > seen['xy-lead@44100']);
    // On the default Synth document (K183) LPF Cutoff also takes the MG and EG 2 normals and,
    // since K220, pad L's X normal (2 octaves), whose excursion shares the Nyquist headroom: Y
    // at 50 % plays 7.53 kHz there (8.58 kHz before K220, 11.21 kHz on the pad view's rig
    // before K183, panelStore with the Pitch and Gate patched); shown = played is asserted
    // above at every y.
    assert.ok(Math.abs(seen['xy-lead@44100'] - 7531.39) < 0.01, `${seen['xy-lead@44100']}`);
  });

test('before a context exists, Y is sized at the provisional 44.1 kHz and says so', () => {
  const r = rig({ patch: false });
  assert.equal(r.st.dispatch(xyPresetAction(r.st.getModel(), PANEL, 'xy-lead').action).ok, true);
  const nodeId = PANEL.resolve(r.st.getModel()).get('lpf').id;
  r.st.dispatch({ type: 'NODE_PARAM_SET', nodeId, key: 'frequency', value: 6000 });
  const m = r.mount(); // no sampleRate: the default host has no context
  const rd = xyYReading(r.st.getModel(), PANEL);
  assert.equal(rd.provisional, true);
  assert.equal(rd.sampleRate, 44100);
  const at44 = xyYReading(r.st.getModel(), PANEL, { sampleRate: 44100 });
  assert.equal(at44.provisional, false);
  for (const y of [0, 0.5, 1]) assert.equal(rd.at(y), at44.at(y), `y ${y}`);
  assert.ok(noOthers(m.view.opts.text.y(1))
    .endsWith('0.95 × Nyquist at 44.1 kHz, do spuštění zvuku'),
    m.view.opts.text.y(1));
  m.destroy();
});

test('the readout line sits above the pad; Y driving nothing reads no value', () => {
  const r = rig();
  const m = r.mount();
  const html = r.host.innerHTML;
  assert.ok(html.indexOf('data-osc="synth.xy.readout"') < html.indexOf('data-osc="synth.xy.pad"'),
    'the readout above the pad, clear of the docked keyboard');
  m.destroy();
  assert.equal(xyTarget(r.st.getModel(), PANEL), null, 'no Y cable by default (K220)');
  const n = r.mount();
  assert.equal(n.view.opts.readout.y(0.5), null);
  assert.equal(n.view.opts.readout.yEnds, null);
  assert.equal(n.view.opts.text.y(0.5), '50 %: síla úhozu 64', 'Y is the velocity (K220)');
  n.destroy();
});

test('NF5: a re-mount starts the cursor at Y 0, the rest the node is at, wherever X was', () => {
  // The cursor (CURSORS, per store) keeps where the arrows moved it; the node hears nothing
  // until a touch, so a re-mount (a panel re-render) shows Y at the node's rest, 0.
  const r = rig();
  const m1 = r.mount();
  for (let i = 0; i < 70; i += 1) m1.view.model.key('ArrowUp'); // no touch: the cursor alone
  m1.view.model.key('ArrowRight');
  const x = m1.view.model.value.x;
  assert.ok(m1.view.model.value.y > 0.6);
  m1.destroy();
  const m2 = r.mount();
  assert.equal(m2.view.model.value.y, 0, 'the re-mounted cursor is at Y 0');
  assert.equal(m2.view.model.value.x, x, 'X stays where it was');
  m2.destroy();
  stopNow(r);
});
