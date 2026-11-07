// K068 (ADR 0086): notes clips PLAY on the audio clock. A notes clip on an event track whose
// target is a Keys node is expanded by the ONE compile path (timeline-compiler.js compilePass ->
// notes.js noteItems / notePlan) into one onset per note, ratchet onset and pass, at baseTime +
// beats x 60 / tempo on whole frames, and the transport plays each through the Keys note path
// (note-player.js -> adapters/instrument.js keys.play) with the Keys Gate's Envelope gated as
// a key gates it. The same expansion runs offline (offline.js runs this transport with the
// render length as its look-ahead). On top of plain playback, the execution fields:
//   swing   a fraction 0-0.75 of grid.stepBeats, delays only notes exactly on an odd grid
//           position; an off-grid note is unmoved
//   r       1-8 equal onsets inside the note, each len / r long
//   slide   no new gate; the Keys pitch glides linearly over the node's Glide (K060)
//   p       a note plays iff noteDraw(grid.seed, pass, index) < p: the same hits live and
//           offline, a new draw on each loop pass
//   tempo   transport.tempo; a tempo change while playing rescales the later onsets
//   tap     tapTempo(taps, now) (transport-view.js, W006's pure model): four taps 500 ms apart
//           set 120 BPM with ONE TRANSPORT_SET (transport-commands.js tap)
// Asserted on StudioFakeContext (tests/unit/sequencer-fake-audio.mjs, one virtual clock with the
// AudioEngine's timers): the scheduled calls on the Keys pitch and on the Envelope's VCA gain,
// their times, their ramps and the node census. Negative cases (AC2): p 0 and 1, ratchet 4 at
// 1/32 at the tempo maximum, a tempo change while playing, STOP with a ratchet pending.
//
// Fails on b7a5c9f7 (the Keys node, #447): the store refuses p, r, slide and grid ('unknown
// field'), the transport lists every notes clip unplayed, and notes.js has no notePlan,
// transport-view.js no tapTempo.
//   node --test tests/unit/studio-steps-playback.test.mjs
// Namespace imports, so that each test fails on its own assertion on the base.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { mulberry32 } from '../../src/js/core/math.js';
import * as actions from '../../src/js/studio/actions.js';
import * as notesModule from '../../src/js/studio/notes.js';
import * as offline from '../../src/js/studio/offline.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import * as templates from '../../src/js/studio/templates/index.js';
import * as transportModule from '../../src/js/studio/transport.js';
import * as commandsModule from '../../src/js/ui/studio/transport-commands.js';
import * as view from '../../src/js/ui/studio/transport-view.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000; // the fake context's rate; every figure below reads ctx.sampleRate
const ADSR = { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.005 };
const oct = (note) => (note - 69) / 12;
const n = (at, note, len = 0.25, vel = 0.8, extra = {}) => ({ at, note, len, vel, ...extra });
const ok = (r, what = '') => {
  assert.ok(r.ok, `${what}${what ? ': ' : ''}${r.reason || JSON.stringify(r.errors)}`);
  return r;
};

/**
 * A Keys -> VCO -> Envelope -> Master Output document through the one store, the Keys Gate on
 * the Envelope's gate, at `tempo`, with one notes clip { notes, grid } on an event track on the
 * Keys node (startBeats 0). -> { st, keys, env, clipId, trackId }
 */
function documentOf({ tempo = 120, notes = [], grid, glide = 0, beats = 4, loop = null,
  keysParams = {} } = {}) {
  const empty = schema.normalizeStudio({ kind: schema.STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = actions.createStudioStore(empty, { idGenerator: actions.createIdGenerator(empty) });
  const add = (nodeType) => ok(st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }), nodeType).created.nodes[0];
  const keys = add('keys');
  const vco = add('vco');
  const env = add('envelope');
  const out = add('master');
  ok(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: keys, params: { glide, ...keysParams } }),
    'keys');
  ok(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: vco, params: { waveform: 'sine' } }), 'vco');
  ok(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: env, params: ADSR }), 'env');
  const edge = (from, to, props) => ok(st.dispatch({ type: 'EDGE_ADD', from, to, props }),
    `${from.node}.${from.port}`);
  edge({ node: keys, port: 'pitch' }, { node: vco, port: 'pitch' },
    { depth: 6, polarity: 'bipolar', mapping: 'linear' });
  edge({ node: keys, port: 'gate' }, { node: env, port: 'gate' });
  edge({ node: vco, port: 'audio' }, { node: env, port: 'audio' });
  edge({ node: env, port: 'audio' }, { node: out, port: 'audio' });
  if (tempo !== 120) ok(st.dispatch({ type: 'TRANSPORT_SET', tempo }), 'tempo');
  const trackId = ok(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }), 'track')
    .created.tracks[0];
  const payload = grid ? { notes, grid } : { notes };
  const clipId = ok(st.dispatch({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
    durationBeats: beats, payload }), 'notes clip').created.clips[0];
  if (loop) ok(st.dispatch({ type: 'LOOP_SET', enabled: true, ...loop }), 'loop');
  return { st, keys, env, clipId, trackId };
}

/** The document on the real AudioEngine, runtime and transport, PLAYing. */
function playing(opts = {}, { lookAheadS = null } = {}) {
  const doc = documentOf(opts);
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const transport = transportModule.createStudioTransport({ runtime, engine, store: doc.st,
    lookAheadS });
  const started = ok(transport.start(), 'PLAY');
  const kh = runtime.nodes.get(doc.keys);
  const eh = runtime.nodes.get(doc.env);
  return { ...doc, fx, engine, runtime, transport, base: started.baseTime,
    pitch: kh.outputs.pitch.offset, gain: eh.outputs.audio.gain };
}

/** The audio time of `beats` into the clip in pass 0 at `tempo`: whole frames from baseTime. */
const at = (rig, beats, tempo = 120) => (Math.round(rig.base * SR)
  + Math.round(beats * (60 / tempo) * SR)) / SR;
const r9 = (x) => Number(x.toFixed(9));
/** A whole frame, to the 1e-9 s the figures are rounded to (5e-5 of a frame at 48 kHz). */
const isFrame = (t) => Math.abs(t * SR - Math.round(t * SR)) < 1e-4;
/** Where each attack of the Envelope's VCA starts: its linear ramp to the peak, less Attack. */
const attacks = (rig) => rig.gain.events.filter((e) => e.ramp === 'linear' && e.value === 1)
  .map((e) => r9(e.t - ADSR.attack)).sort((a, b) => a - b);
/** Where each release ends: an exponential ramp to the floor (a release of Release s). */
const releases = (rig) => rig.gain.events.filter((e) => e.ramp === 'exponential'
  && e.value < 0.001).map((e) => r9(e.t - ADSR.release)).sort((a, b) => a - b);
/** The Keys pitch events from `t0` on, as [method, value, time]. */
const pitchEvents = (rig, t0 = 0) => rig.pitch.events.filter((e) => e.t >= t0 - 1e-9)
  .map((e) => [e.ramp, r9(e.value), r9(e.t)]);
const stopped = async (rig) => {
  const p = rig.transport.stop();
  rig.fx.advance(1);
  await p;
};

// ---------------------------------------------------------------- 1. plain notes

test('K068 a notes clip on a Keys node plays: pitch and gate at baseTime + beats x 60 / tempo, '
  + 'on whole frames; the gate closes at each note end', async () => {
  const rig = playing({ notes: [n(0, 60, 0.5), n(1, 64, 0.5, 1), n(2.5, 67, 1, 0.25)] });
  rig.fx.advance(1.9); // past the last note's end, before the timeline's end stops it
  const want = [0, 1, 2.5].map((b) => r9(at(rig, b)));
  assert.deepEqual(attacks(rig), want, 'one attack per note, at its frame');
  assert.ok(want.every(isFrame), 'every onset is a whole frame');
  assert.deepEqual(releases(rig), [0.5, 1.5, 3.5].map((b) => r9(at(rig, b))),
    'each gate closes at its note end');
  const steps = pitchEvents(rig, rig.base).filter((e) => e[0] === 'set' && e[2] >= want[0]);
  assert.deepEqual(steps, [[ 'set', r9(oct(60)), want[0]], ['set', r9(oct(64)), want[1]],
    ['set', r9(oct(67)), want[2]]], 'the Keys pitch steps to each note at its onset');
  const kh = rig.runtime.nodes.get(rig.keys);
  assert.ok(Math.abs(kh.outputs.velocity.offset.events.at(-1).value - 32 / 127) < 1e-12,
    'velocity 0.25 is delivered as 32 of 127');
  const d = rig.transport.debugInfo();
  assert.deepEqual(d.unplayed, [], 'nothing is reported unplayed');
  const plan = offline.planOfflineRender(rig.st.getModel());
  const row = plan.clips.find((c) => c.id === rig.clipId);
  assert.deepEqual([row.rendered, row.reason], [true, null], 'the offline render plays it too');
  const state = rig.runtime.debugInfo().notes.find((x) => x.id === rig.keys);
  assert.deepEqual(state.onsets.map(r9), want, 'the runtime debugInfo lists the onsets');
  assert.equal(r9(state.interval), r9(want[2] - want[1]), 'and the last onset interval');
  await stopped(rig);
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0 after stop');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0 after stop');
});

test('K068 offline plays the same onsets as live: one expansion, the render length as look-ahead',
  () => {
    const notes = [n(0, 60), n(0.5, 62), n(1.25, 64, 0.5, 0.8, { r: 2 }),
      n(2, 65, 0.25, 0.8, { p: 0.5 }), n(3, 67, 0.5, 0.8, { p: 0.5 })];
    const grid = { stepBeats: 0.25, swing: 0.33, seed: 99 };
    const live = playing({ notes, grid });
    live.fx.advance(2.5);
    const off = playing({ notes, grid }, { lookAheadS: 3 });
    const rel = (rig) => attacks(rig).map((t) => r9(t - rig.base));
    assert.ok(rel(live).length >= 4, 'the clip plays');
    assert.deepEqual(rel(off), rel(live), 'the offline transport schedules the same onsets');
  });

// ---------------------------------------------------------------- 2. the fields, validated

test('K068 p, r, slide and grid validate, each refused with its own sentence', () => {
  const { st, trackId } = documentOf();
  const add = (notes, grid) => ({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
    durationBeats: 4, payload: grid === undefined ? { notes } : { notes, grid } });
  const g = { stepBeats: 0.25, swing: 0, seed: 1 };
  ok(st.dispatch(add([n(0, 60, 1, 1, { p: 1, r: 8, slide: true })], g)), 'every field at its edge');
  ok(st.dispatch(add([n(0, 60, 1, 1, { p: 0.01, r: 1 })], { stepBeats: 1, swing: 0.75,
    seed: 4294967295 })), 'the other edges');
  const cases = [
    ['p 0', [n(0, 60, 1, 1, { p: 0 })], g, /Nota 1: p je pravděpodobnost, že zazní, číslo větší než 0/],
    ['p 1.5', [n(0, 60, 1, 1, { p: 1.5 })], g, /p je pravděpodobnost, že zazní/],
    ['r 0', [n(0, 60, 1, 1, { r: 0 })], g, /Nota 1: r je počet nástupů, které zahraje, celé číslo od 1 do 8/],
    ['r 9', [n(0, 60, 1, 1, { r: 9 })], g, /r je počet nástupů/],
    ['r 2.5', [n(0, 60, 1, 1, { r: 2.5 })], g, /r je počet nástupů/],
    ['slide false', [n(0, 60, 1, 1, { slide: false })], g, /Nota 1: slide je buď true, nebo se vynechá/],
    ['grid not an object', [n(0, 60)], 4, /Mřížka notového klipu musí být objekt \{ stepBeats, swing, seed \}/],
    ['grid steps', [n(0, 60)], { ...g, steps: 16 }, /Mřížka notového klipu je \{ stepBeats, swing, seed \}; „steps“/],
    ['stepBeats 0', [n(0, 60)], { ...g, stepBeats: 0 }, /stepBeats mřížky musí být počet dob větší než 0/],
    ['swing 0.8', [n(0, 60)], { ...g, swing: 0.8 }, /swing mřížky musí být zlomek stepBeats od 0 do 0\.75/],
    ['swing -0.1', [n(0, 60)], { ...g, swing: -0.1 }, /swing mřížky musí být zlomek/],
    ['seed -1', [n(0, 60)], { ...g, seed: -1 }, /seed mřížky musí být celé číslo od 0 do 4294967295/],
    ['seed 2^32', [n(0, 60)], { ...g, seed: 2 ** 32 }, /seed mřížky musí být celé číslo/],
    ['seed 1.5', [n(0, 60)], { ...g, seed: 1.5 }, /seed mřížky musí být celé číslo/],
    ['grid without seed', [n(0, 60)], { stepBeats: 0.25, swing: 0 }, /seed mřížky musí být celé číslo/],
  ];
  for (const [label, notes, grid, pattern] of cases) {
    const model = st.getModel();
    const depth = st.debugInfo().undoDepth;
    const r = st.dispatch(add(notes, grid));
    assert.equal(r.ok, false, `${label}: refused`);
    assert.match(r.reason, pattern, `${label}: the sentence`);
    assert.equal(st.getModel(), model, `${label}: the model is unchanged`);
    assert.equal(st.debugInfo().undoDepth, depth, `${label}: the history is unchanged`);
  }
});

test('K068 a slide on a target without a glide parameter is refused with that reason', () => {
  const { st } = documentOf();
  const fm = ok(st.dispatch({ type: 'NODE_ADD', nodeType: 'additive-voice',
    position: { x: 0, y: 0 } })).created.nodes[0];
  const track = ok(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: fm }))
    .created.tracks[0];
  const r = st.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'notes', startBeats: 0,
    durationBeats: 4, payload: { notes: [n(0, 60), n(1, 62, 0.25, 0.8, { slide: true })] } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Nota 2 klouže, ale uzel Additive engine nemá glide, kterým by klouzal.');
});

test('K068 notes without the new fields serialize and hash as before; the fields are hashed', () => {
  for (const t of templates.STUDIO_TEMPLATES) {
    assert.equal(schema.studioHash(templates.templateModel(t.id)), t.studioHash, t.id);
  }
  // A document with a notes clip, built as on b7a5c9f7, keeps the studioHash it had there.
  const m0 = templates.templateModel(templates.REFERENCE_TEMPLATE_ID);
  const st = actions.createStudioStore(m0, { idGenerator: actions.createIdGenerator(m0) });
  const keys = ok(st.dispatch({ type: 'NODE_ADD', nodeType: 'keys', position: { x: 0, y: 0 } }))
    .created.nodes[0];
  const track = ok(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }))
    .created.tracks[0];
  const clipId = ok(st.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'notes', startBeats: 0,
    durationBeats: 4, payload: { notes: [n(0, 60, 1, 0.8), n(1.5, 64, 0.5, 0.5),
      n(2, 67, 2, 1)] } })).created.clips[0];
  const base = st.getModel();
  assert.equal(schema.studioHash(base),
    '9ca60a9d6a456204c21099af04a08c250c6626bfdedb384ca935706068cc5ca0',
    'the studioHash this document has on b7a5c9f7');
  const text = schema.serializeStudio(base);
  assert.ok(!/"(p|r|slide|grid)"/.test(text), 'no absent field is written');
  const before = schema.studioHash(base);
  const changes = [
    ['p', { notes: [n(0, 60, 1, 0.8, { p: 0.5 }), n(1.5, 64, 0.5, 0.5), n(2, 67, 2, 1)] }],
    ['r', { notes: [n(0, 60, 1, 0.8, { r: 2 }), n(1.5, 64, 0.5, 0.5), n(2, 67, 2, 1)] }],
    ['slide', { notes: [n(0, 60, 1, 0.8), n(1.5, 64, 0.5, 0.5), n(2, 67, 2, 1, { slide: true })] }],
    ['grid', { notes: base.timeline.clips.find((c) => c.id === clipId).payload.notes,
      grid: { stepBeats: 0.25, swing: 0, seed: 0 } }],
  ];
  for (const [field, payload] of changes) {
    ok(st.dispatch({ type: 'CLIP_UPDATE', clipId, payload }), field);
    assert.notEqual(schema.studioHash(st.getModel()), before, `${field} is hashed`);
    st.undo();
    assert.equal(schema.studioHash(st.getModel()), before, `undo restores the hash (${field})`);
  }
  const seeded = (seed) => {
    ok(st.dispatch({ type: 'CLIP_UPDATE', clipId, payload: { notes: base.timeline.clips
      .find((c) => c.id === clipId).payload.notes, grid: { stepBeats: 0.25, swing: 0.5, seed } } }));
    const h = schema.studioHash(st.getModel());
    st.undo();
    return h;
  };
  assert.notEqual(seeded(1), seeded(2), 'the seed is hashed');
});

// ---------------------------------------------------------------- 3. the pure parts

test('K068 mulberry32 is the pure seeded generator: pinned values, repeatable, in [0, 1)', () => {
  const a = mulberry32(0);
  assert.deepEqual([a(), a(), a()], [0.26642920868471265, 0.0003297457005828619,
    0.2232720274478197]);
  assert.equal(mulberry32(12345)(), 0.9797282677609473);
  const b = mulberry32(7);
  const c = mulberry32(7);
  for (let i = 0; i < 1000; i += 1) {
    const x = b();
    assert.equal(x, c(), 'the same seed repeats');
    assert.ok(x >= 0 && x < 1, 'in [0, 1)');
  }
  const mix = (s, pass, i) => (s ^ Math.imul(pass + 1, notesModule.DRAW_PASS_MUL)
    ^ Math.imul(i + 1, notesModule.DRAW_INDEX_MUL)) >>> 0;
  assert.equal(notesModule.noteDraw(5, 2, 3), mulberry32(mix(5, 2, 3))(),
    'noteDraw(seed, pass, index) = mulberry32 of the seed mixed with pass and index');
  assert.notEqual(notesModule.noteDraw(5, 2, 3), notesModule.noteDraw(5, 3, 2),
    'the draw is not symmetric in pass and index');
  assert.notEqual(notesModule.noteDraw(9, 0, 0), notesModule.noteDraw(9, 1, 1),
    'pass equal to index does not cancel back to the bare seed');
  const firstPass = new Set(Array.from({ length: 64 }, (_, i) => notesModule.noteDraw(7, 0, i)));
  assert.equal(firstPass.size, 64, 'the 64 notes of one pass draw 64 different values');
  const grid16 = new Set(Array.from({ length: 256 },
    (_, k) => notesModule.noteDraw(7, Math.floor(k / 16), k % 16)));
  assert.equal(grid16.size, 256,
    'passes 0-15 x indices 0-15 draw pairwise distinct values (instrument-kinds critique)');
  const draw = notesModule.noteDraw(4294967295, 1, 0);
  assert.ok(draw >= 0 && draw < 1, 'a uint32 seed stays unsigned and the draw in [0, 1)');
});

test('K068 notePlan: swing only on odd grid positions, ratchet, slide and the cut', () => {
  const grid = { stepBeats: 0.25, swing: 0.33, seed: 0 };
  const plan = notesModule.notePlan({ grid, notes: [n(0, 60), n(0.25, 61), n(0.5, 62),
    n(0.75, 63), n(0.3, 64), n(1.25, 65), n(2, 66, 0.75, 0.8, { r: 3 })] });
  const starts = plan.map((o) => [o.note, r9(o.start)]);
  assert.deepEqual(starts, [[60, 0], [64, 0.3], [61, r9(0.25 + 0.0825)], [62, 0.5],
    [63, r9(0.75 + 0.0825)], [65, r9(1.25 + 0.0825)], [66, 2], [66, 2.25], [66, 2.5]],
  'odd positions 0.25, 0.75, 1.25 swing by 0.33 x 0.25; 0.3 (off the grid) is unmoved');
  assert.deepEqual(plan.filter((o) => o.note === 66).map((o) => r9(o.end - o.start)),
    [0.25, 0.25, 0.25], 'r 3: three equal onsets of len / 3');
  const slide = notesModule.notePlan({ notes: [n(0, 60, 1), n(1, 67, 1, 0.8, { slide: true }),
    n(3, 69, 0.5, 0.8, { slide: true })] });
  assert.deepEqual(slide.map((o) => [o.note, o.gate, o.slide, r9(o.gateEnd)]),
    [[60, true, false, 2], [67, false, true, 2], [69, true, false, 3.5]],
  'a slide touching a sounding note opens no gate and extends it; one after a gap plays plain');
  const cut = notesModule.notePlan({ notes: [n(0, 60, 2, 0.8, { r: 4 })] }, { cutBeats: 1.2 });
  assert.deepEqual(cut.map((o) => [r9(o.start), r9(o.end)]), [[0, 0.5], [0.5, 1], [1, 1.2]],
    'a loop end cuts the ratchet: onsets after it are dropped, one across it ends there');
  assert.equal(notesModule.noteVelocity(0.001), 1, 'velocity never below 1');
  assert.equal(notesModule.noteVelocity(1), 127);
});

test('K068 tapTempo: the mean of the last four taps within 2 s each, clamped to the range', () => {
  assert.equal(view.TAP_COUNT, 4);
  let s = { taps: [] };
  for (const t of [1000, 1500, 2000]) {
    s = view.tapTempo(s.taps, t);
    assert.equal(s.bpm, null, `${s.taps.length} taps set nothing yet`);
  }
  s = view.tapTempo(s.taps, 2500);
  assert.deepEqual([s.bpm, s.clamped, s.taps], [120, false, [1000, 1500, 2000, 2500]],
    'four taps 500 ms apart: 120 BPM');
  assert.deepEqual(view.tapTempo([1000, 1500, 2000, 2500], 3100).taps, [1500, 2000, 2500, 3100],
    'the series keeps its last four');
  assert.deepEqual(view.tapTempo([1000, 1500, 2000], 4001).taps, [4001],
    'a tap more than 2 s after the previous one starts a new series');
  assert.deepEqual(view.tapTempo([1000, 1500, 2000], 1900).taps, [1900], 'and one not after it');
  const fast = view.tapTempo([0, 100, 200], 300);
  assert.deepEqual([fast.bpm, fast.clamped], [schema.TEMPO_RANGE[1], true], 'clamped at 300');
  const slow = view.tapTempo([0, 1900, 3800], 5700);
  assert.deepEqual([slow.bpm, slow.clamped], [31.6, false], 'slow taps, to 0.1 BPM');
  const low = view.tapTempo([0, 1, 2], 3, [100, 200]);
  assert.equal(low.bpm, 200, 'the range is a parameter');
});

test('K068 the Tap command: one TRANSPORT_SET per tap series, one undo entry', () => {
  const { st } = documentOf();
  const said = [];
  const cmd = commandsModule.createTransportCommands({ store: st, announce: (t) => said.push(t),
    transport: { playing: false, playhead: () => ({ position: 0 }) } });
  const depth = st.debugInfo().undoDepth;
  for (const t of [100, 600, 1100]) assert.equal(cmd.tap(t).bpm, null);
  assert.equal(cmd.tapCount(), 3);
  assert.equal(st.debugInfo().undoDepth, depth, 'no dispatch before the fourth tap');
  const r = cmd.tap(1600);
  assert.deepEqual([r.ok, r.bpm, st.getModel().transport.tempo], [true, 120, 120]);
  ok(st.dispatch({ type: 'TRANSPORT_SET', tempo: 90 }));
  const d1 = st.debugInfo().undoDepth;
  for (const t of [5000, 5250, 5500, 5750]) cmd.tap(t);
  assert.equal(st.getModel().transport.tempo, 240);
  assert.equal(st.debugInfo().undoDepth, d1 + 1, 'the series is one undo entry');
  assert.equal(cmd.tapCount(), 0, 'the fourth tap ends the series');
  st.undo();
  assert.equal(st.getModel().transport.tempo, 90, 'undo restores the tempo before the series');
  assert.deepEqual(said.slice(-1), ['Tempo 240 BPM z 4 ťuknutí']);
  assert.ok(said.includes('Tap 2 of 4'));
});

// ---------------------------------------------------------------- 4. the execution, played

test('K068 swing delays only notes exactly on an odd grid position, at 120 and 97 BPM', async () => {
  for (const tempo of [120, 97]) {
    for (const swing of [0, 0.33]) {
      // 1.1 is off the grid. Every note ends before the next starts, swung or not, so that no
      // two gates merge into one (overlapping gates are one gate, V272 B9).
      const notes = [n(0, 60, 0.15), n(0.25, 62, 0.15), n(0.5, 64, 0.15), n(0.75, 65, 0.15),
        n(1.1, 67, 0.1), n(1.25, 69, 0.15)];
      const rig = playing({ tempo, notes, grid: { stepBeats: 0.25, swing, seed: 0 } });
      rig.fx.advance(1.5);
      const d = swing * 0.25;
      const want = [0, 0.25 + d, 0.5, 0.75 + d, 1.1, 1.25 + d].map((b) => r9(at(rig, b, tempo)));
      assert.deepEqual(attacks(rig), want, `${tempo} BPM, swing ${swing}`);
      assert.ok(want.every(isFrame), 'whole frames');
      await stopped(rig);
    }
  }
});

test('K068 a ratchet plays r equal onsets inside the note', async () => {
  const rig = playing({ notes: [n(1, 60, 0.75, 0.8, { r: 3 })] });
  rig.fx.advance(1.5);
  assert.deepEqual(attacks(rig), [1, 1.25, 1.5].map((b) => r9(at(rig, b))), 'three onsets');
  assert.deepEqual(releases(rig), [r9(at(rig, 1.75))], 'and the last closes at the note end');
  await stopped(rig);
});

test('K068 a slide opens no new gate and glides the Keys pitch linearly over its Glide', async () => {
  const rig = playing({ glide: 0.05, notes: [n(0, 60, 1), n(1, 67, 1, 0.8, { slide: true }),
    n(3, 72, 0.5, 0.8, { slide: true })] });
  rig.fx.advance(2);
  const t1 = r9(at(rig, 1));
  assert.deepEqual(attacks(rig), [r9(at(rig, 0)), r9(at(rig, 3))],
    'one gate for the slide pair; the slide after a gap opens its own');
  assert.deepEqual(releases(rig), [r9(at(rig, 2)), r9(at(rig, 3.5))], 'the pair closes at 2');
  const ev = pitchEvents(rig, t1);
  assert.deepEqual(ev.slice(0, 2), [['set', r9(oct(60)), t1],
    ['linear', r9(oct(67)), r9(t1 + 0.05)]], 'held at the slide, a linear ramp over Glide');
  assert.deepEqual(ev[2], ['set', r9(oct(72)), r9(at(rig, 3))], 'the plain slide steps');
  await stopped(rig);
});

test('K068 p: a note plays iff noteDraw(seed, pass, index) < p, drawn anew each pass', async () => {
  const seed = 2026;
  const notes = Array.from({ length: 8 }, (_, i) => n(i * 0.5, 60 + i, 0.25, 0.8, { p: 0.5 }));
  const rig = playing({ notes, grid: { stepBeats: 0.5, swing: 0, seed }, beats: 4,
    loop: { start: 0, end: 2 } });
  rig.fx.advance(5.5);
  const hits = (pass) => notes.map((_, i) => i)
    .filter((i) => notesModule.noteDraw(seed, pass, i) < 0.5);
  const passStart = (k) => rig.base + k * 2;
  const got = (k) => attacks(rig).filter((t) => t >= passStart(k) - 1e-9
    && t < passStart(k + 1) - 1e-9).map((t) => Math.round((t - passStart(k)) / 0.25) || 0);
  for (const k of [0, 1, 2]) assert.deepEqual(got(k), hits(k), `pass ${k} plays its own draws`);
  assert.notDeepEqual(hits(0), hits(1), 'the draws differ between passes');
  await stopped(rig);
});

// ---------------------------------------------------------------- 5. negative cases (AC2)

test('K068 AC2 p 0 is refused; p 1 plays every note', async () => {
  const { st, trackId } = documentOf();
  const r = st.dispatch({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
    durationBeats: 4, payload: { notes: [n(0, 60, 0.25, 0.8, { p: 0 })] } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'Nota 1: p je pravděpodobnost, že zazní, číslo větší než 0 a nejvýš 1.');
  const notes = Array.from({ length: 8 }, (_, i) => n(i * 0.25, 60 + i, 0.25, 0.8, { p: 1 }));
  const rig = playing({ notes, grid: { stepBeats: 0.25, swing: 0, seed: 1 } });
  rig.fx.advance(1.5);
  assert.deepEqual(attacks(rig), notes.map((x) => r9(at(rig, x.at))), 'every note plays');
  await stopped(rig);
});

test('K068 AC2 ratchet 4 at 1/32 at the tempo maximum: four onsets 300 frames apart', async () => {
  const max = schema.TEMPO_RANGE[1];
  const rig = playing({ tempo: max, notes: [n(1, 60, 0.125, 0.8, { r: 4 })] });
  rig.fx.advance(0.6);
  const got = attacks(rig);
  const want = [0, 1, 2, 3].map((j) => r9(at(rig, 1 + j * 0.03125, max)));
  assert.deepEqual(got, want, 'each onset at its frame');
  assert.deepEqual(got.slice(1).map((t, i) => Math.round((t - got[i]) * SR)), [300, 300, 300],
    '6.25 ms = 300 frames at 48 kHz between onsets');
  assert.ok(got.every(isFrame));
  assert.deepEqual(releases(rig), [r9(at(rig, 1.125, max))], 'one release, at the note end');
  await stopped(rig);
});

test('K068 AC2 a tempo change while playing rescales the onsets after the edit horizon',
  async () => {
    const notes = Array.from({ length: 16 }, (_, i) => n(i * 0.25, 60, 0.125));
    const rig = playing({ notes });
    rig.fx.advance(0.6);
    const changeAt = rig.fx.ctx.currentTime;
    ok(rig.st.dispatch({ type: 'TRANSPORT_SET', tempo: 60 }), 'tempo 60');
    rig.transport.sync();
    rig.fx.advance(3.5);
    const all = attacks(rig);
    const before = all.filter((t) => t < changeAt);
    const after = all.filter((t) => t > changeAt + 0.1);
    assert.deepEqual(before, [0, 0.25, 0.5, 0.75, 1].map((b) => r9(at(rig, b)))
      .filter((t) => t < changeAt), 'the onsets before the change at 120 BPM (0.125 s apart)');
    assert.ok(after.length >= 4, 'it plays on');
    for (const t of after) {
      const beats = (t - rig.base) / 1; // 60 BPM: one beat per second from the clip start
      assert.ok(Math.abs(beats * 4 - Math.round(beats * 4)) < 1e-6, `${t} on the 60 BPM grid`);
    }
    assert.deepEqual(after.slice(1).map((t, i) => r9(t - after[i])),
      after.slice(1).map(() => 0.25), 'the later onsets are 0.25 s apart: rescaled');
    await stopped(rig);
  });

test('K068 AC2 STOP with a ratchet pending: no later onset, the pitch held, census 0', async () => {
  const rig = playing({ notes: [n(0, 60, 0.25), n(1, 64, 2, 0.8, { r: 8 }), n(3.5, 67, 0.5)] });
  rig.fx.advance(0.6); // inside the ratchet: its onsets are 0.125 s apart from 0.5 s
  const p = rig.transport.stop();
  const stopAt = rig.transport.debugInfo().decisions.findLast((d) => d.decision === 'stop').at;
  assert.ok(attacks(rig).every((t) => t <= stopAt), 'no attack is left after the stop');
  assert.ok(attacks(rig).length >= 2, 'the ratchet had started');
  assert.ok(rig.pitch.events.every((e) => e.t <= stopAt + 1e-9), 'no pitch is due after it');
  const last = rig.pitch.events.at(-1);
  assert.deepEqual([last.ramp, r9(last.t), last.value], ['set', r9(stopAt), oct(64)],
    'the Keys pitch is held at the stop');
  rig.fx.advance(1);
  await p;
  assert.equal(rig.engine.activeNodeCount, 0, 'engine node census 0');
  assert.equal(rig.engine.activeSourceCount, 0, 'engine source census 0');
  assert.equal(rig.runtime.debugInfo().runtimeNodeCount, 0, 'runtime census 0');
  assert.equal(rig.transport.debugInfo().noteCount, 0, 'no note record is left');
});

test('K068 the transport reports the step under the playhead of a clip with a grid', async () => {
  const rig = playing({ notes: [n(0, 60)], grid: { stepBeats: 0.25, swing: 0, seed: 0 } });
  rig.fx.advanceTo(rig.base + 0.3); // 0.3 s at 120 BPM = beat 0.6 = step 2
  const s = rig.transport.debugInfo().steps;
  assert.deepEqual(s.map((x) => [x.clipId, x.step]), [[rig.clipId, 2]]);
  assert.equal(s[0].position, rig.transport.playhead().position, 'from transport.playhead()');
  await stopped(rig);
});
