// K231: REC on the Synth's pad L. A take of the pad's X and Y is written as automation of the
// pad node's own x and y (the coordinator's option A, 2026-11-10: automation authors the base and
// the modulation stays the edge's, studio/automation.js §103-104), through the one recorder of
// K223 (studio/notes-record.js), one BATCH and one undo entry per take. The x and y parameters
// are elided at their default, so a document without a take serialises and hashes as on the base
// (train T5 91838acb); a touch overrides the lanes while held and the outputs glide back to them
// on release (adapters/instrument.js xyPad).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { clipTarget } from '../../src/js/studio/clip-targets.js';
import {
  PAD_TAKE_RAMP_S, PAD_TAKE_STEP_S, padOf, padTakeAction, padTakeId, recorderOf,
} from '../../src/js/studio/notes-record.js';
import { createPatch, serializePatch } from '../../src/js/studio/patches.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import {
  normalizeStudio, serializeStudio, studioHash, studioHashAt,
} from '../../src/js/studio/schema.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { PAD_RECORD_TEXT, pointsText } from '../../src/js/ui/kinds/record-switch.js';
import { renderStudioOffline } from '../../src/js/studio/offline.js';
import { createFakeAudioEnv, fakeOfflineCtor } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const padL = (m) => PANEL.resolve(m).get('xyl');

// ---------------------------------------------------------------- the hash (condition 1)

test('K231: a Synth panel whose pads were never recorded hashes and serialises as on the base',
  () => {
    // Computed on train T5 91838acb (before x and y existed) from the same panelStore() model.
    const m = panelStore().getModel();
    assert.deepEqual([studioHash(m), studioHashAt(m, 2), studioHashAt(m, 1)], [
      'e26b5ea9862bc260f84b559c7def99dfa42b6d3c51aca907c9e565bb12e4fa19',
      '75d2c19abec1314efd0bf283d9fd6e80015270d2d50e3fc66e052dc1a7d9b5e6',
      'be78cba23e8669bba0d9f12bbedfb1a0e8c4868377afd713162618b1271be454',
    ], 'the hash of every epoch is the base one: no epoch 4');
    assert.equal(sha(serializeStudio(m)),
      '80aab00bdc12dda9f3c23ec16ed98c68f9f1313c3df938bda4a760e7636d0f65', 'the model text');
    const pads = m.graph.nodes.filter((n) => n.type === 'xy-pad');
    assert.equal(sha(serializePatch(createPatch(m, pads.map((n) => n.id), { name: 'pads' }))),
      'd83ec4ae8f213c48f0b930634e015909b6cadb19dd7fc01d05e51596793d99b4', 'the patch text');
    assert.deepEqual(pads.map((n) => [n.params.x, n.params.y]), [[0, 0], [0, 0]],
      'the parameters exist in the running model');
  });

test('K231: a pad x or y off its default is serialised, hashed and loaded back', () => {
  const m = panelStore().getModel();
  const id = padL(m).id;
  const moved = { ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === id
    ? { ...n, params: { ...n.params, x: 0.25 } } : n)) } };
  assert.notEqual(studioHash(moved), studioHash(m));
  const back = normalizeStudio(JSON.parse(serializeStudio(moved)));
  const n = back.graph.nodes.find((x) => x.id === id);
  assert.deepEqual([n.params.x, n.params.y], [0.25, 0], 'x kept, y given back at its default');
  for (const key of ['x', 'y']) {
    const p = NODE_REGISTRY.param('xy-pad', key);
    assert.deepEqual([p.automatable, p.modulatable, p.elide, p.default], [true, false, true, 0]);
  }
  assert.ok(!PANEL.faceOf('xyl').some((c) => c.key === 'x' || c.key === 'y'),
    'no knob on the pad: the pad is their control');
  assert.ok(!PANEL.faceOf('xy').some((c) => c.key === 'x' || c.key === 'y'));
});

// ---------------------------------------------------------------- the take (pure)

/** A touch: on at `t0`, a move every `every` s to `t1` (x rising 0.2 -> 0.6), off at t1. */
const touch = (t0, t1, every = 0.005) => {
  const out = [];
  for (let t = t0; t <= t1 + 1e-9; t += every) {
    const k = (t - t0) / (t1 - t0);
    out.push({ pos: Number(t.toFixed(6)), x: 0.2 + 0.4 * k, y: 0.8 - 0.4 * k });
  }
  return out;
};
const lanesOf = (m, id) => Object.fromEntries(m.timeline.automation
  .filter((l) => l.target.node === id).map((l) => [l.target.param, l.points]));

test('K231: a take is one BATCH of both lanes: a ramp from the lane in, the touch, a ramp out',
  () => {
    const st = panelStore();
    const id = padL(st.getModel()).id;
    const a = padTakeAction(st.getModel(), id, [touch(1, 1.2)]);
    assert.equal(a.type, 'BATCH');
    assert.equal(st.dispatch(a).ok, true);
    const lanes = lanesOf(st.getModel(), id);
    for (const key of ['x', 'y']) {
      const pts = lanes[key];
      assert.ok(pts, `a lane of ${key}`);
      assert.deepEqual([pts[0].time, pts[0].value], [1, 0], 'from the lane (the rest, 0)');
      assert.ok(Math.abs(pts[1].time - (1 + PAD_TAKE_RAMP_S)) < 1e-9, 'the ramp in');
      const end = pts[pts.length - 1];
      assert.deepEqual(end.value, 0, 'back to the rest');
      assert.ok(Math.abs(end.time - (pts[pts.length - 2].time + PAD_TAKE_RAMP_S)) < 1e-9);
      assert.ok(pts.every((p) => p.curve === 'linear'), 'no step on what the pad feeds');
      // Thinned on the audio clock: 41 moves over 0.2 s keep one per PAD_TAKE_STEP_S at most.
      const inner = pts.slice(1, -1);
      assert.ok(inner.length <= Math.ceil(0.2 / PAD_TAKE_STEP_S) + 1, `${inner.length} points`);
      // Each kept point PAD_TAKE_STEP_S after the last; the touch's own last value is kept too.
      for (let i = 1; i < inner.length - 1; i += 1) {
        assert.ok(inner[i].time - inner[i - 1].time >= PAD_TAKE_STEP_S - 1e-9);
      }
    }
    assert.ok(Math.abs(lanes.x[lanes.x.length - 2].value - 0.6) < 1e-9, 'the last X is kept');
    assert.equal(st.undo().ok, true);
    assert.deepEqual(lanesOf(st.getModel(), id), {}, 'one undo entry takes the whole take back');
  });

test('K231: a re-take replaces its span on each lane and keeps the rest of the lane', () => {
  const st = panelStore();
  const id = padL(st.getModel()).id;
  assert.equal(st.dispatch(padTakeAction(st.getModel(), id, [touch(1, 1.2)])).ok, true);
  assert.equal(st.dispatch(padTakeAction(st.getModel(), id, [touch(2, 2.1)])).ok, true);
  const before = lanesOf(st.getModel(), id).x;
  assert.equal(st.dispatch(padTakeAction(st.getModel(), id, [touch(1.1, 1.14)])).ok, true);
  const after = lanesOf(st.getModel(), id).x;
  const fresh = after.filter((p) => !before.some((b) => b.id === p.id));
  const span = [fresh[0].time, fresh[fresh.length - 1].time];
  assert.equal(span[0], 1.1);
  const outside = (pts) => pts.filter((p) => p.time < span[0] || p.time > span[1] + 1e-9)
    .map((p) => [p.id, p.time, p.value]);
  assert.deepEqual(outside(after), outside(before), 'every point outside the span is kept');
  const inside = after.filter((p) => p.time >= span[0] && p.time <= span[1] + 1e-9);
  assert.ok(inside.every((p) => !before.some((b) => b.id === p.id)), 'the span is the new take');
  // The re-take starts from the old take's value there, not from the rest: no step.
  const was = before.filter((p) => p.time <= 1.1).at(-1);
  const next = before.find((p) => p.time > 1.1);
  const expected = was.value + (next.value - was.value) * ((1.1 - was.time)
    / (next.time - was.time));
  assert.ok(Math.abs(inside[0].value - expected) < 1e-6, `${inside[0].value} vs ${expected}`);
});

// ---------------------------------------------------------------- the recorder (one path)

function fakeTransport() {
  const fns = [];
  return {
    on(fn) { fns.push(fn); return () => {}; },
    emit(type, d) { for (const fn of fns) fn(type, d); },
  };
}
const playing = (pos) => ({ position: pos, playing: true });
const play = (t, id, list) => {
  list.forEach((q, i) => t.emit('live', { id, ev: { kind: i ? 'move' : 'on', x: q.x, y: q.y },
    r: { ok: true }, ph: playing(q.pos) }));
  const z = list[list.length - 1];
  t.emit('live', { id, ev: { kind: 'off', x: z.x, y: z.y }, r: { ok: true },
    ph: playing(z.pos) });
};

test('K231: armed for pad L, the transport\'s one recorder writes its touches at the playhead '
  + 'in one undo entry; undo and redo restore the exact model', () => {
  const st = panelStore();
  const id = padL(st.getModel()).id;
  const t = fakeTransport();
  const rec = recorderOf(t, st);
  const events = [];
  rec.on((e) => events.push(e));
  const start = serializeStudio(st.getModel());
  assert.equal(padOf(padTakeId(id)), id);
  rec.arm(padTakeId(id));
  play(t, 'semi-mono-1-xy', touch(0.5, 0.6)); // pad R: not the armed pad
  play(t, id, touch(1, 1.2));
  assert.ok(rec.pending > 2, `${rec.pending} points pending`);
  const r = rec.disarm();
  assert.equal(r.ok, true);
  const taken = serializeStudio(st.getModel());
  const lanes = lanesOf(st.getModel(), id);
  assert.deepEqual(Object.keys(lanes).sort(), ['x', 'y']);
  assert.ok(lanes.x.every((p) => p.time >= 1 && p.time <= 1.2 + 2 * PAD_TAKE_RAMP_S),
    'only the armed pad\'s touch, at the playhead\'s positions');
  const n = events.find((e) => e.type === 'take').n;
  assert.deepEqual(events.map((e) => e.type), ['arm', 'take', 'disarm']);
  assert.deepEqual(events[1], { type: 'take', n, reason: 'disarm', kind: 'pad' });
  assert.equal(st.undo().ok, true);
  assert.equal(serializeStudio(st.getModel()), start, 'one undo entry');
  assert.equal(st.redo().ok, true);
  assert.equal(serializeStudio(st.getModel()), taken);
  assert.equal(PAD_RECORD_TEXT.written(n), `Záznam zapsán: ${pointsText(n)} automatizace, `
    + 'jedna úprava.');
});

test('K231: REC off writes nothing; a touch while the timeline does not play is refused and '
  + 'writes nothing; a stop writes the take', () => {
  const st = panelStore();
  const id = padL(st.getModel()).id;
  const t = fakeTransport();
  const rec = recorderOf(t, st);
  const events = [];
  rec.on((e) => events.push(e));
  const rev = st.getRevision();
  play(t, id, touch(1, 1.1)); // not armed
  assert.equal(st.getRevision(), rev, 'REC off writes nothing');
  rec.arm(padTakeId(id));
  t.emit('live', { id, ev: { kind: 'on', x: 0.5, y: 0.5 }, r: { ok: true }, ph: null });
  t.emit('live', { id, ev: { kind: 'off', x: 0.5, y: 0.5 }, r: { ok: true }, ph: null });
  assert.deepEqual(events.map((e) => e.type), ['arm', 'refused']);
  assert.equal(PAD_RECORD_TEXT.refused,
    'Pad se nahrává jen při přehrávání: stiskněte Přehrát.');
  play(t, id, touch(2, 2.1));
  t.emit('state', { playing: false });
  assert.equal(st.getRevision(), rev + 1, 'the stop wrote the take, one entry');
  assert.equal(events.at(-1).reason, 'stop');
  assert.equal(rec.disarm(), null, 'nothing left after the stop');
});

test('K231: a take over a loop wrap is two segments, the later pass winning its span', () => {
  const st = panelStore();
  const id = padL(st.getModel()).id;
  const t = fakeTransport();
  const rec = recorderOf(t, st);
  rec.arm(padTakeId(id));
  const list = [...touch(3.9, 4), ...touch(0, 0.1)];
  list.forEach((q, i) => t.emit('live', { id, ev: { kind: i ? 'move' : 'on', x: q.x, y: q.y },
    r: { ok: true }, ph: playing(q.pos) }));
  t.emit('live', { id, ev: { kind: 'off', x: 0, y: 0 }, r: { ok: true }, ph: playing(0.1) });
  assert.equal(rec.disarm().ok, true);
  const x = lanesOf(st.getModel(), id).x;
  assert.ok(x.some((p) => p.time < 0.2) && x.some((p) => p.time > 3.8), 'both passes');
  assert.ok(!x.some((p) => p.time > 0.3 && p.time < 3.85), 'nothing between them');
});

// ---------------------------------------------------------------- touch over lane (2)

function runtimeAt(sampleRate) {
  const fx = createFakeAudioEnv({ sampleRate });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { ...fx, runtime: createStudioRuntime({ engine }) };
}
/**
 * A fake AudioParam's value at t from its set and target events, as Web Audio computes a
 * setTargetAtTime (v -> target with time constant tau from its start); these pad params hold
 * no other kind (automationValueAt reads a target as reached at once).
 */
function at(p, t) {
  let v = p.value;
  let from = 0;
  let target = null;
  const now = (time) => (target ? target.value + (v - target.value)
    * Math.exp(-(time - from) / target.tau) : v);
  for (const e of [...p.events].sort((a, b) => a.t - b.t)) {
    if (e.t > t) break;
    assert.ok(e.ramp === 'set' || e.ramp === 'target', `a ${e.ramp} event`);
    v = e.ramp === 'set' ? e.value : now(e.t);
    from = e.t;
    target = e.ramp === 'target' ? { value: e.value, tau: e.tau } : null;
  }
  return now(t);
}

for (const sr of [44100, 48000]) {
  test(`K231 (${sr} Hz): a touch overrides pad L's lane while held and the output glides back `
    + 'to the lane on release, never a step', async () => {
    const st = panelStore();
    const id = padL(st.getModel()).id;
    const s = runtimeAt(sr);
    assert.equal(s.runtime.apply(liveModel(st.getModel())).ok, true);
    assert.equal(s.runtime.start().ok, true);
    const h = s.runtime.nodes.get(id);
    const lane = h.modTarget('x', 'linear').param;
    assert.equal(lane, h.info.rests.x.offset, 'a lane of x drives the rest source');
    lane.setValueAtTime(0.7, 0.5); // a lane holding 0.7 from 0.5 s
    const out = (t) => at(h.outputs.x.offset, t) + at(h.info.gates.x.gain, t) * at(lane, t);
    h.move(1, 0.2, 0.9);
    h.rest(1.5);
    assert.ok(Math.abs(out(0.9) - 0.7) < 1e-9, 'untouched: the lane');
    assert.ok(Math.abs(out(1.45) - 0.2) < 1e-6, `held: the touch (${out(1.45)})`);
    assert.ok(Math.abs(out(1.95) - 0.7) < 1e-6, `released: the lane again (${out(1.95)})`);
    let step = 0;
    for (let f = Math.round(0.9 * sr); f < Math.round(2 * sr); f += 1) {
      step = Math.max(step, Math.abs(out((f + 1) / sr) - out(f / sr)));
    }
    // The glide (τ 15 ms) moves at most |Δ| / τ per second: 0.5 / 0.015 s, under 1/1000 a frame.
    assert.ok(step < 1e-3, `largest change in one frame ${step}`);
    s.advance(2.2);
    const done = s.runtime.stop();
    s.advance(2.5);
    assert.deepEqual(await done, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
  });
}

// ---------------------------------------------------------------- replay through the edges (4)

test('K231: a take stays the pad\'s own after a re-patch, and its lanes still play', () => {
  const st = panelStore();
  const id = padL(st.getModel()).id;
  assert.equal(st.dispatch(padTakeAction(st.getModel(), id, [touch(1, 1.2)])).ok, true);
  const lanes = st.getModel().timeline.automation.filter((l) => l.target.node === id);
  const edges = st.getModel().graph.edges.filter((e) => e.from.node === id);
  assert.ok(edges.length >= 2, 'pad L feeds its normals');
  for (const e of edges) {
    assert.equal(st.dispatch({ type: 'EDGE_REMOVE', edgeId: e.id }).ok, true);
  }
  const m = st.getModel();
  assert.deepEqual(m.timeline.automation.filter((l) => l.target.node === id), lanes,
    'the lanes target the pad, not what it fed');
  const node = m.graph.nodes.find((n) => n.id === id);
  for (const key of ['x', 'y']) {
    assert.equal(clipTarget(node, { kind: 'automation', param: key }, NODE_REGISTRY).plays, true);
  }
});

/** Every AudioParam a fake source reaches through its outputs (node to node, into params). */
function reached(source) {
  const params = new Set();
  const seen = new Set();
  const walk = (n) => {
    if (!n || seen.has(n)) return;
    seen.add(n);
    for (const d of n.outputs || []) {
      if (Array.isArray(d.events)) params.add(d); else walk(d);
    }
  };
  walk(source);
  return params;
}

test('K231: after a re-patch the take moves the new target (pad L x into the HPF cutoff)',
  async () => {
  const st = panelStore();
  const m0 = st.getModel();
  const id = padL(m0).id;
  const r = PANEL.resolve(m0);
  const lpf = r.get('lpf').id;
  const hpf = r.get('hpf').id;
  assert.equal(st.dispatch(padTakeAction(m0, id, [touch(1, 1.2)])).ok, true);
  const xEdge = st.getModel().graph.edges.find((e) => e.from.node === id && e.from.port === 'x');
  assert.equal(xEdge.to.node, lpf, 'the normal: x into the LPF cutoff');
  assert.equal(st.dispatch({ type: 'BATCH', label: 're-patch', steps: [
    { type: 'EDGE_REMOVE', edgeId: xEdge.id },
    { type: 'EDGE_ADD', from: { node: id, port: 'x' }, to: { node: hpf, port: 'frequency' },
      props: xEdge.props }] }).ok, true);
  const s = runtimeAt(48000);
  assert.equal(s.runtime.apply(liveModel(st.getModel())).ok, true);
  assert.equal(s.runtime.start().ok, true);
  const h = s.runtime.nodes.get(id);
  const lane = h.modTarget('x', 'linear').param;
  assert.equal(lane, h.info.rests.x.offset, 'the take\'s x lane drives the pad\'s rest source');
  // The rest source (the lane's) feeds pad output x through its gate; that output feeds the
  // cable's target.
  assert.ok(reached(h.info.rests.x).has(h.outputs.x.offset), 'the lane reaches pad output x');
  const to = reached(h.outputs.x);
  const cutoff = (n) => s.runtime.nodes.get(n).modTarget('frequency', 'log').param;
  assert.ok(to.has(cutoff(hpf)), 'pad output x reaches the HPF cutoff, the new target');
  assert.ok(!to.has(cutoff(lpf)), 'and no longer the LPF cutoff');
  const done = s.runtime.stop();
  s.advance(1);
  assert.deepEqual(await done, { nodes: 0, sources: 0, engineNodes: 0, engineSources: 0 });
});

for (const sampleRate of [44100, 48000]) {
  test(`K231 (${sampleRate} Hz): the offline render plays a take's lanes on the pad`, async () => {
    const st = panelStore();
    const id = padL(st.getModel()).id;
    assert.equal(st.dispatch(padTakeAction(st.getModel(), id, [touch(1, 1.2)])).ok, true);
    const m = st.getModel();
    const lanes = m.timeline.automation.filter((l) => l.target.node === id);
    assert.equal(lanes.length, 2);
    const made = [];
    const out = await renderStudioOffline(m, { sampleRate,
      OfflineAudioContext: fakeOfflineCtor(made) });
    assert.ok(out.ok, JSON.stringify(out.errors));
    const ids = new Set(lanes.map((l) => l.id));
    assert.deepEqual(out.debug.transport.unplayed.filter((u) => ids.has(u.id)), [],
      'neither lane is unplayed');
    const ctx = made[0];
    const offsets = ctx.of('constant-source').map((c) => c.offset);
    for (const l of lanes) {
      const p = l.points[1]; // the ramp in, to the touch's first value
      // On the render's frame grid: within one frame of the point's time.
      const hit = offsets.find((o) => o.events.some((e) => e.ramp === 'linear'
        && Math.abs(e.t - (out.startTime + p.time)) <= 1 / sampleRate
        && Math.abs(e.value - p.value) < 1e-6));
      assert.ok(hit, `the ${l.target.param} lane ramps a pad source to ${p.value} at ${p.time} s`);
    }
  });
}
