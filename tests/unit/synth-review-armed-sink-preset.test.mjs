// oscilla-21's retroactive review of src/js/synth, three findings:
//   S1  synth.armed was a copy written only by the Synth's own paths, so a Stop made outside the
//       Synth (Studio Stop, a measurement taking the output) left the Arm button reading Disarm,
//       and synthDisarm() returned early without clearing it. It now follows the transport's
//       'state' event, and the early return clears it.
//   S2  a MIDI or keyboard note-off was routed at release time (src/js/midi/ui.js route), so a
//       Playground note held across a switch to the Synth sent its note-off to the Synth and
//       kept sounding. The note layer now releases a key where its note-on sounded.
//   S6  an XY preset went through linkAction with { all: true } and reset the Engines tab. It
//       now writes only the Panel and XY tab modules (xy.js xyScope) and the cables between them.
// The transport is the real one on the fake audio environment of the sequencer tests; the Synth
// part is the real createSynthUi with no DOM (document answers no element).
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { XY_RECIPES, xyPatchAction, xyPatchOf } from '../../src/js/synth/xy.js';
import { xyPresetAction } from '../../src/js/synth/view/xy-wiring.js';
import { panelCables, patchCable } from '../../src/js/synth/normals.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { serializeStudio } from '../../src/js/studio/schema.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';
import { createOutputBus } from '../../src/js/core/output-bus.js';

// ---------------------------------------------------------------- S1: armed follows the transport

/** The Synth part on the real transport, mounted as Alpine would (no DOM). */
function synthRig() {
  globalThis.document ??= { querySelector: () => null, getElementById: () => null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame ??= () => 0;
  const st = panelStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: st });
  const handle = Object.create(st, { subscribe: { value: () => () => {} } });
  const part = createSynthUi({ get: () => ({ handle, transport }) });
  const watches = [];
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {},
    $watch(key, fn) { watches.push([key, fn]); } });
  cmp.synthInit();
  // A workspace change as main.js makes it: the playback bus's leave policy (C053), then the
  // part's own watchers.
  const bus = createOutputBus({ app: () => cmp, sequencer: () => null });
  const go = (ws) => {
    const old = cmp.workspace;
    cmp.workspace = ws;
    bus.leave(old, ws);
    for (const [k, fn] of watches) if (k === 'workspace') fn(ws, old);
  };
  return { cmp, transport, fx, go };
}

test('S1: a transport Stop made outside the Synth clears synth.armed; Arm then arms again', () => {
  const { cmp, transport, fx, go } = synthRig();
  assert.equal(cmp.synthArm(), true, 'Arm in the Synth');
  assert.equal(cmp.synth.armed, true);
  go('studio'); // the Synth disarms on leaving; the Studio plays, then Stop
  assert.equal(transport.armed, false);
  go('synth');
  assert.equal(cmp.synthArm(), true);
  transport.stop({ fast: true }); // Studio Stop: the Studio's own call on the one transport
  fx.advance(1);
  assert.equal(transport.armed, false);
  assert.equal(cmp.synth.armed, false, 'the button reads Arm after a Stop made elsewhere');
  assert.equal(cmp.synthArm(), true, 'and Arm arms');
  assert.equal(cmp.synth.armed, true);
  assert.equal(transport.armed, true);
  cmp.synthDisarm();
  fx.advance(1);
  assert.equal(cmp.synth.armed, false);
});

test('S1: synthDisarm with the transport not armed clears a stale armed copy', async () => {
  const { cmp, transport } = synthRig();
  cmp.synth.armed = true; // a copy left armed (a stop whose event this part never heard)
  assert.equal(transport.armed, false);
  assert.equal(await cmp.synthDisarm(), null);
  assert.equal(cmp.synth.armed, false, 'Disarm on an unarmed transport shows Arm');
});

// ---------------------------------------------------------------- S2: note-off where it sounded

/** The note layer with a recording engine and a Synth sink chosen by the workspace. */
function notesRig() {
  const calls = [];
  const engine = {
    noteOn: (key) => { calls.push(['engine', 'on', key]); return { ok: true }; },
    noteOff: (key) => { calls.push(['engine', 'off', key]); return true; },
    notesOff: () => 0,
    resume() {},
  };
  const sink = {
    noteOn: (note) => { calls.push(['synth', 'on', note]); return { ok: true }; },
    noteOff: (note) => { calls.push(['synth', 'off', note]); return true; },
    allOff: () => 0,
  };
  const app = { workspace: 'playground' };
  const notes = createMidiNotes({ engine, settings: () => ({ a4: 440, continuous: true }),
    route: () => (app.workspace === 'synth' ? sink : null) });
  return { calls, app, notes };
}

test('S2: a Playground note held into the Synth workspace is released on the Playground', () => {
  const { calls, app, notes } = notesRig();
  notes.handle([0x90, 60, 100], 1); // MIDI note-on in the Playground
  app.workspace = 'synth';
  notes.handle([0x80, 60, 0], 1); // its note-off after the switch
  assert.deepEqual(calls, [['engine', 'on', '1:0:60'], ['engine', 'off', '1:0:60']],
    'the note-off reaches the Playground voice, not the Synth');
  calls.length = 0;
  notes.noteOn(62, 90, 'kbd-a'); // the on-screen keys, the same layer
  app.workspace = 'playground';
  notes.noteOff(62, 'kbd-a');
  assert.deepEqual(calls, [['synth', 'on', 62], ['synth', 'off', 62]],
    'a Synth note held across the switch back is released by the Synth');
  calls.length = 0;
  notes.noteOff(64, 'kbd-a'); // a key that never sounded here: where it would sound now
  assert.deepEqual(calls, [['engine', 'off', 'kbd-a:0:64']]);
});

test('S2: a note-on velocity 0 is the note-off of the key, released where it sounded', () => {
  const { calls, app, notes } = notesRig();
  app.workspace = 'synth';
  notes.handle([0x91, 48, 80], 2);
  app.workspace = 'playground';
  notes.handle([0x91, 48, 0], 2);
  assert.deepEqual(calls, [['synth', 'on', 48], ['synth', 'off', 48]]);
});

// ---------------------------------------------------------------- S6: an XY preset's scope

const ENGINES = PANEL.modulesOf('engines').map((m) => m.id);
const VOICE = new Set([...PANEL.modulesOf('panel'), ...PANEL.modulesOf('xy')].map((m) => m.id));

/** Every engine's first knob set off its preset value, one dispatch each. */
function tweakEngines(st) {
  const set = {};
  for (const mid of ENGINES) {
    const node = PANEL.resolve(st.getModel()).get(mid);
    const c = PANEL.faceOf(mid).find((x) => x.kind === 'knob');
    const { min, max } = c.param;
    const v = Number(((node.params[c.key] + (min + max) / 2) / 2 + c.param.step * 3)
      .toFixed(2));
    assert.notEqual(v, node.params[c.key], `${mid}.${c.key} changes`);
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: node.id, key: c.key, value: v })
      .ok, true, `${mid}.${c.key}`);
    set[mid] = { key: c.key, value: v };
  }
  return set;
}

const byModule = (m) => new Map([...PANEL.resolve(m)].filter(([, n]) => n)
  .map(([mid, n]) => [mid, n]));
const moduleOfNode = (m) => new Map([...byModule(m)].map(([mid, n]) => [n.id, mid]));
const edgeKey = (e) => `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`
  + JSON.stringify(e.props);

test('S6: an XY preset leaves every engine as set and writes only its voice, one undo entry',
  () => {
    for (const recipe of XY_RECIPES) {
      const st = panelStore();
      const set = tweakEngines(st);
      const m0 = st.getModel();
      const a = xyPresetAction(m0, PANEL, recipe.id); // the XY tab's path (xy-wiring.js)
      assert.equal(a.action && a.action.type, 'BATCH', recipe.id);
      assert.equal(st.dispatch(a.action).ok, true, recipe.id);
      const m1 = st.getModel();
      const before = byModule(m0);
      for (const [mid, n] of byModule(m1)) {
        if (VOICE.has(mid)) continue;
        assert.deepEqual(n.params, before.get(mid).params, `${recipe.id}: ${mid} unchanged`);
      }
      for (const mid of ENGINES) {
        const { key, value } = set[mid];
        assert.equal(byModule(m1).get(mid).params[key], value, `${recipe.id}: ${mid}.${key}`);
      }
      // Every edge added or removed (or with new props) lies inside the voice.
      const k0 = new Set(m0.graph.edges.map(edgeKey));
      const k1 = new Set(m1.graph.edges.map(edgeKey));
      const mods = new Map([...moduleOfNode(m0), ...moduleOfNode(m1)]);
      const changed = [...m0.graph.edges.filter((e) => !k1.has(edgeKey(e))),
        ...m1.graph.edges.filter((e) => !k0.has(edgeKey(e)))];
      assert.ok(changed.length > 0, `${recipe.id} patches something`);
      for (const e of changed) {
        assert.ok(VOICE.has(mods.get(e.from.node)) && VOICE.has(mods.get(e.to.node)),
          `${recipe.id}: edge ${edgeKey(e)} is the voice's`);
      }
      st.undo();
      assert.equal(serializeStudio(st.getModel()), serializeStudio(m0), `${recipe.id}: one undo`);
    }
  });

test('S6: a saved XY preset holds the voice only, and loading one never writes an engine', () => {
  const st = panelStore();
  tweakEngines(st);
  const patch = xyPatchOf(st.getModel(), PANEL, { name: 'Mine' });
  const held = new Set(patch.graph.nodes.map((n) => moduleOfNode(st.getModel()).get(n.id)));
  assert.deepEqual([...held].filter((mid) => !VOICE.has(mid)), [], 'no engine in the patch');
  // A patch saved before this fix carries the engines: they are not written either.
  const other = panelStore();
  const legacy = { ...patch, graph: { ...patch.graph, nodes: [...patch.graph.nodes,
    ...ENGINES.map((mid) => byModule(st.getModel()).get(mid))] } };
  const m0 = other.getModel();
  assert.equal(other.dispatch(xyPatchAction(m0, PANEL, legacy).action).ok, true);
  for (const mid of ENGINES) {
    assert.deepEqual(byModule(other.getModel()).get(mid).params, byModule(m0).get(mid).params,
      mid);
  }
});

test('S6: a cable into an engine survives an XY preset; the voice\'s cables are replaced', () => {
  const st = panelStore();
  const r = patchCable(st.getModel(), PANEL, 'vco1.audio', 'fm.thru');
  assert.ok(r.action, r.reason);
  assert.equal(st.dispatch(r.action).ok, true);
  const into = (m) => panelCables(m, PANEL).filter((c) => c.to === 'fm.thru')
    .map((c) => c.from);
  assert.deepEqual(into(st.getModel()), ['vco1.audio']);
  assert.equal(st.dispatch(xyPresetAction(st.getModel(), PANEL, 'xy-lead').action).ok, true);
  assert.deepEqual(into(st.getModel()), ['vco1.audio'], 'the engine\'s cable is kept');
  assert.ok(panelCables(st.getModel(), PANEL).some((c) => c.from === 'xy.y'
    && c.to === 'lpf.frequency'), 'the recipe\'s Y cable is patched');
});
