// K104 armed monitoring on the real transport and runtime (fake Web Audio): live notes sound
// while the transport is stopped, and the owner's decision of 2026-11-03 ('STOP keeps it armed
// (Recommended)'): a user STOP of an armed run stops the timeline and leaves the keys armed and
// sounding on the same runtime, while every other stop (disarm, Escape, page hide, another owner
// taking the output) disarms and returns the node census to 0.
//   - arming claims the output once and starts the runtime; a note while armed and stopped
//     gates the Keys-gated envelopes
//   - disarm, Escape and the hide stop release every note and leave a census of 0
//   - arming while the Playground plays stops it through claimStudioOutput's release path
//   - PLAY while armed and STOP keep one runtime; STOP leaves the keys armed, a note after it
//     still gates; a STOP of a run that was never armed stops it
//   - the Studio transport commands: PLAY while armed starts the timeline, STOP re-arms
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { claimStudioOutput } from '../../src/js/ui/studio/workspace.js';
import { createTransportCommands } from '../../src/js/ui/studio/transport-commands.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const CENSUS_0 = { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 };

/** The panel's document on the real runtime and transport; every claim and start counted. */
function setup({ onClaimOutput } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: 44100 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const real = createStudioRuntime({ engine });
  const starts = [];
  // The runtime is frozen: the transport gets a view of it whose start() is counted.
  const runtime = Object.create(real, { start: { value: (...a) => {
    starts.push(fx.ctx ? fx.ctx.currentTime : 0);
    return real.start(...a);
  } } });
  const model = panelStore().getModel();
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const claims = [];
  const transport = createStudioTransport({ runtime, engine, store,
    onClaimOutput: (info) => {
      claims.push(info.owner);
      return onClaimOutput ? onClaimOutput(info) : true;
    } });
  const ids = PANEL.resolve(model);
  const keys = ids.get('keys').id;
  const eg1 = ids.get('eg1').id;
  return { fx, engine, runtime, store, transport, claims, starts, keys, eg1 };
}

/** Record every gate opened on the envelope `id` of the running graph. */
function gatesOf(s, id) {
  const h = s.runtime.nodes.get(id);
  assert.ok(h && typeof h.gate === 'function', `envelope ${id} is running`);
  const opened = [];
  const gate = h.gate.bind(h);
  h.gate = (at, dur, ...rest) => { opened.push(at); return gate(at, dur, ...rest); };
  return opened;
}

/** Stop's promise once the fake clock passed the runtime's cleanup. */
async function settled(s, p) {
  s.fx.advance(1);
  return p;
}

test('arming claims the output once and starts the runtime; a stopped, armed note gates', () => {
  const s = setup();
  const r = s.transport.arm();
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(s.claims, ['studio'], 'one output claim, as Studio PLAY makes it');
  assert.equal(s.starts.length, 1, 'the runtime started once');
  assert.equal(s.runtime.state, 'running');
  assert.equal(s.transport.armed, true);
  const opened = gatesOf(s, s.eg1);
  const on = s.transport.live(s.keys, { kind: 'on', note: 60, velocity: 1 });
  assert.equal(on.ok, true, on.reason);
  assert.equal(opened.length, 1, 'the note gates EG 1 while the timeline is stopped');
  assert.deepEqual(s.transport.heldNotes(), [60]);
});

for (const [name, leave] of [
  ['disarm', (s) => s.transport.disarm()],
  ['Escape', (s) => { s.transport.escape({}); return s.transport.stop({ fast: true }); }],
  ['the page hide stop', (s) => s.transport.stop({ fast: true })],
  ['another owner taking the output (a plain STOP)', (s) => s.transport.stop()],
]) {
  test(`${name} releases every held note and leaves a node census of 0`, async () => {
    const s = setup();
    assert.equal(s.transport.arm().ok, true);
    s.transport.live(s.keys, { kind: 'on', note: 60, velocity: 1 });
    s.transport.live(s.keys, { kind: 'on', note: 64, velocity: 1 });
    const counts = await settled(s, leave(s));
    assert.equal(s.transport.armed, false, `${name} disarms`);
    assert.equal(s.transport.playing, false);
    assert.deepEqual(s.transport.heldNotes(), [], 'no note hangs');
    assert.equal(s.runtime.state, 'idle');
    const { voices, ...rest } = counts || {};
    assert.deepEqual(rest, CENSUS_0, `${name}: census 0`);
  });
}

test('arming while the Playground plays stops it through the output owner\'s release path', () => {
  const stops = [];
  const cmp = { playing: true };
  const svc = { outputRefusalOf: () => null,
    stopPlayback: (c) => { stops.push(c.playing); c.playing = false; } };
  const s = setup({ onClaimOutput: () => claimStudioOutput(cmp, svc, () => {}) });
  assert.equal(s.transport.arm().ok, true);
  assert.deepEqual(stops, [true], 'the playing Playground was stopped once, before the Studio');
  assert.equal(cmp.playing, false);
  assert.equal(s.transport.armed, true);
});

test('a measurement holding the output refuses the arm and starts nothing', () => {
  const cmp = {};
  const svc = { outputRefusalOf: () => ({ text: 'measuring' }), stopPlayback: () => {
    throw new Error('nothing yields to a refused claim');
  } };
  const said = [];
  const s = setup({ onClaimOutput: () => claimStudioOutput(cmp, svc, (t) => said.push(t)) });
  const r = s.transport.arm();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'claim-refused');
  assert.equal(s.transport.armed, false);
  assert.equal(s.starts.length, 0);
  assert.deepEqual(said, ['measuring']);
});

test('PLAY while armed and STOP keep one runtime; STOP leaves the keys armed and sounding', async () => {
  const s = setup();
  assert.equal(s.transport.arm().ok, true);
  const runtimeNodes = s.runtime.nodes;
  const played = s.transport.start({ position: 0 });
  assert.equal(played.ok, true, played.reason);
  assert.equal(s.transport.armed, false, 'PLAY plays the whole document');
  assert.equal(s.transport.playing, true);
  s.fx.advance(0.3);
  const stopped = await settled(s, s.transport.stop({ keepArmed: true }));
  assert.ok(stopped, 'STOP resolves');
  assert.equal(s.transport.armed, true, 'STOP after PLAY from armed leaves the keys armed');
  assert.equal(s.runtime.state, 'running', 'the runtime keeps running');
  assert.equal(s.starts.length, 1, 'one runtime start for arm, PLAY and STOP');
  assert.equal(s.runtime.nodes, runtimeNodes);
  assert.equal(s.transport.playhead().playing, false, 'the timeline is stopped');
  const opened = gatesOf(s, s.eg1);
  const on = s.transport.live(s.keys, { kind: 'on', note: 62, velocity: 1 });
  assert.equal(on.ok, true, on.reason);
  assert.equal(opened.length, 1, 'a note after STOP still gates EG 1');
  // And the second STOP of an armed run keeps it armed too; disarm still ends it at census 0.
  await settled(s, s.transport.stop({ keepArmed: true }));
  assert.equal(s.transport.armed, true);
  const counts = await settled(s, s.transport.disarm());
  const { voices, ...rest } = counts;
  assert.deepEqual(rest, CENSUS_0);
  assert.deepEqual(s.transport.heldNotes(), []);
});

test('STOP keeps only an armed run: a PLAY that was never armed stops whole', async () => {
  const s = setup();
  assert.equal(s.transport.start({ position: 0 }).ok, true);
  const counts = await settled(s, s.transport.stop({ keepArmed: true }));
  assert.equal(s.transport.armed, false);
  assert.equal(s.transport.playing, false);
  const { voices, ...rest } = counts;
  assert.deepEqual(rest, CENSUS_0);
});

test('the Studio transport commands: PLAY while armed starts the timeline, STOP re-arms', async () => {
  const s = setup();
  const said = [];
  const cmd = createTransportCommands({ store: s.store, transport: s.transport,
    announce: (t) => said.push(t) });
  assert.equal(s.transport.arm().ok, true);
  const r = cmd.playStop();
  assert.equal(r && r.ok, true, 'Space while armed is PLAY');
  assert.equal(s.transport.armed, false);
  assert.equal(s.transport.playing, true);
  await settled(s, cmd.playStop());
  assert.equal(s.transport.armed, true, 'Space while playing from armed is STOP, keys still armed');
  assert.equal(s.starts.length, 1);
});

// Review of #500 (oscilla-c1, R1-R3): a Sequence's trigger clocks a Step Modulator; four pattern
// clips at 0, 0.5, 1 and 1.5 s.
function clocked() {
  const store = createStudioStore(createStudioModel(), { idGenerator: createIdGenerator() });
  const d = (a) => {
    const r = store.dispatch(a);
    assert.equal(r.ok, true, r.reason);
    return r;
  };
  const add = (t) => d({ type: 'NODE_ADD', nodeType: t }).created.nodes[0];
  const edge = (f, fp, t, tp) => d({ type: 'EDGE_ADD', from: { node: f, port: fp },
    to: { node: t, port: tp } });
  const seq = add('sequence');
  const master = add('master');
  const flt = add('filter');
  const target = add('step-modulator');
  edge(seq, 'audio', flt, 'audio');
  edge(flt, 'audio', master, 'audio');
  edge(target, 'control', flt, 'frequency');
  edge(seq, 'trigger', target, 'clock');
  const tr = d({ type: 'TRACK_ADD', kind: 'event', target: seq }).created.tracks[0];
  for (let i = 0; i < 4; i++) {
    d({ type: 'CLIP_ADD', trackId: tr, kind: 'pattern', start: i * 0.5, duration: 0.25 });
  }
  const fx = createFakeAudioEnv({ sampleRate: 44100 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store });
  const steps = store.getModel().graph.nodes.find((n) => n.id === target).params.steps;
  return { fx, runtime, transport, target, steps };
}

for (const mode of ['never armed', 'armed']) {
  test(`${mode}: after STOP the next PLAY counts clock triggers from step 0`, async () => {
    const s = clocked();
    if (mode === 'armed') assert.equal(s.transport.arm().ok, true);
    assert.equal(s.transport.start({ position: 0 }).ok, true);
    s.fx.advance(1.3); // triggers at 0, 0.5 and 1 s passed
    await settled(s, s.transport.stop({ keepArmed: true }));
    assert.equal(s.transport.armed, mode === 'armed');
    const r = s.transport.start({ position: 0 });
    assert.equal(r.ok, true, r.reason);
    s.fx.advance(0.3);
    const offset = s.runtime.nodes.get(s.target).outputs.control.offset;
    const sets = offset.calls.filter((c) => c[0] === 'setValueAtTime' && c[2] >= r.baseTime - 1e-9)
      .map((c) => c[1]);
    assert.equal(sets[0], s.steps[0], 'the first trigger of the second PLAY is step 0');
  });
}

test('the timeline\'s end of a run that began armed leaves the keys armed', () => {
  const s = clocked();
  assert.equal(s.transport.arm().ok, true);
  assert.equal(s.transport.start({ position: 0 }).ok, true);
  s.fx.advance(3); // the last clip ends at 1.75 s
  assert.equal(s.transport.armed, true, 'armed after the end');
  assert.equal(s.transport.playhead().playing, false, 'the timeline ended');
  assert.deepEqual(s.transport.debugInfo().unplayed, [], 'nothing of the timeline is listed');
  assert.equal(s.runtime.state, 'running');
});
