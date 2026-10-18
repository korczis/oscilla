// V272 final review, the transport lifecycle findings (src/js/studio/transport.js,
// timeline-compiler.js edit(), measurement-run.js, offline.js, the Envelope / Random / Step
// Modulator adapters): on the real AudioEngine with the recording fake AudioContext
// (sequencer-fake-audio.mjs createFakeAudioEnv), as tests/unit/v31-studio-transport.test.mjs.
//   node --test tests/unit/v272-transport-lifecycle.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { getSchedule, valueAtTime } from '../../src/js/audio/envelope.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { STUDIO_STOP_S } from '../../src/js/studio/compiler.js';
import { createStudioMeasurementRun } from '../../src/js/studio/measurement-run.js';
import { planOfflineRender, renderStudioOffline } from '../../src/js/studio/offline.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioModel } from '../../src/js/studio/schema.js';
import { timelineEnd } from '../../src/js/studio/timeline.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { StudioFakeContext, createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

/** A transport on the store's commit gate, as the Studio workspace wires it. */
function setup(model = templateModel(REFERENCE_TEMPLATE_ID), { onMeasurement = null } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  let transport = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime, engine, store,
    onMeasurement: (ev) => (onMeasurement ? onMeasurement(ev) : null) });
  return { fx, engine, runtime, store, transport, ctx: fx.ctx };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));

/** A gate track on the reference template's Envelope with gate clips at `starts`. */
function gateClips(s, starts, duration) {
  dispatch(s, { type: 'TRACK_ADD', kind: 'event', target: 'env-1', name: 'Gate' });
  const trackId = s.store.getModel().timeline.tracks.at(-1).id;
  for (const start of starts) {
    dispatch(s, { type: 'CLIP_ADD', trackId, kind: 'event', start, duration,
      payload: { action: 'gate' } });
  }
  return trackId;
}

// ---------------------------------------------------------------- B1

test('V272 B1: PLAY before the previous STOP resolved keeps the new playback alive', async () => {
  const s = setup();
  gateClips(s, [0, 0.6, 1.2], 0.4);
  ok(s.transport.start());
  s.fx.advance(0.5);
  const stopping = s.transport.stop(); // not awaited: Space pressed again at once
  const mark = s.ctx.oscillators.length; // the old playback's voices are before it
  const r2 = ok(s.transport.start());
  s.fx.advance(0.02);
  const before = s.transport.debugInfo();
  assert.equal(before.voiceCount, 1, 'the new playback plays its first clip');
  assert.ok(before.gateCount >= 1, 'and gates its envelope');
  const fresh = s.ctx.oscillators.slice(mark).filter((o) => o.startAt !== null);
  assert.ok(fresh.length >= 1);
  s.fx.advance(0.3); // the old stop's fade and cleanup run
  await stopping;
  const after = s.transport.debugInfo();
  assert.equal(after.playing, true);
  assert.equal(after.voiceCount, before.voiceCount, 'the old STOP left the new voices alone');
  assert.equal(after.gateCount, before.gateCount, 'and the new gate records');
  const now = s.ctx.currentTime;
  const cut = fresh.filter((o) => o.stopAt !== null && o.stopAt <= now);
  assert.deepEqual(cut.map((o) => [o.startAt, o.stopAt]), [],
    'no source of the new playback is stopped before its clip ends');
  assert.ok(r2.baseTime > 0);
});

// ---------------------------------------------------------------- B2, B5

/** Let the measurement run's promises settle (its run() is synchronous here). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function measureWith(edit) {
  const runs = [];
  const states = [];
  let mr = null;
  const s = setup(templateModel(MEASUREMENT_TEMPLATE_ID), { onMeasurement: (ev) => mr.hook(ev) });
  mr = createStudioMeasurementRun({
    getModel: () => s.store.getModel(), sampleRate: () => SR, now: () => s.ctx.currentTime,
    run: async (recipe, m, o) => {
      runs.push(o);
      return { ok: true, experimentId: 'x' };
    },
    stopStudio: () => s.transport.stop({ fast: true }), timers: s.fx.env,
    onChange: (v) => states.push(v.state),
  });
  // A 2 s lead-in before the measurement clips (moved last first, so none overlaps).
  for (const c of [...s.store.getModel().timeline.clips].sort((a, b) => b.start - a.start)) {
    dispatch(s, { type: 'CLIP_MOVE', clipId: c.id, start: c.start + 2 });
  }
  const r = ok(s.transport.start());
  while (mr.view.state !== 'pending' && s.ctx.currentTime < r.baseTime + 1.9) s.fx.advance(0.005);
  assert.equal(mr.view.state, 'pending', 'the hand-off is armed before the first clip');
  if (edit) edit(s);
  s.fx.advanceTo(r.baseTime + 2.5);
  await settle();
  return { runs: runs.length, states: states.join('>'), view: mr.view };
}

test('V272 B2: an edit while a Studio measurement hand-off is pending keeps the measurement',
  async () => {
    const plain = await measureWith(null);
    assert.equal(plain.runs, 1);
    const edited = await measureWith((s) => {
      const master = s.store.getModel().graph.nodes.find((n) => n.type === 'master');
      dispatch(s, { type: 'NODE_PARAM_SET', nodeId: master.id, key: 'level',
        value: master.params.level / 2 });
    });
    assert.equal(edited.runs, 1, `the measurement runs (states ${edited.states})`);
    assert.equal(edited.view.state, 'done');
  });

test('V272 B2: a measurement clip moved while its hand-off is pending re-arms it', async () => {
  const moved = await measureWith((s) => {
    const m = s.store.getModel();
    for (const c of [...m.timeline.clips].sort((a, b) => b.start - a.start)) {
      dispatch(s, { type: 'CLIP_MOVE', clipId: c.id, start: c.start + 0.1 });
    }
  });
  assert.equal(moved.runs, 1, `the rescheduled measurement runs (states ${moved.states})`);
});

/** VCA gain of the reference Envelope at position 0.85 s, gates every 0.5 s, `edit` at 0.52 s. */
function envelopeAfter(edit) {
  const s = setup();
  gateClips(s, [0, 0.5, 1.0, 1.5], 0.45);
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advanceTo(b + 0.52); // the second gate is in its attack / decay
  if (edit) edit(s);
  s.fx.advance(0.5);
  const vca = s.runtime.nodes.get('env-1').inputs.audio.gain;
  return { v: valueAtTime(getSchedule(vca), b + 0.85), s };
}

test('V272 B5: an edit that does not touch the timeline leaves the envelope contour alone', () => {
  const plain = envelopeAfter(null);
  assert.ok(Math.abs(plain.v - 0.7) < 1e-6, `sustain without an edit: ${plain.v}`);
  const edited = envelopeAfter((s) => dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1',
    key: 'Q', value: 1.2 }));
  assert.ok(Math.abs(edited.v - 0.7) < 1e-6, `the gate reaches its sustain: ${edited.v}`);
  const decided = edited.s.transport.debugInfo().decisions.map((d) => d.decision);
  assert.ok(!decided.includes('cancel'), `no item is cancelled: ${decided.join(',')}`);
});

// ---------------------------------------------------------------- A3 (and A2 below)

/**
 * A Sequence with four pattern clips (0, 0.5, 1, 1.5 s, 0.25 s each) into `mod`: an Envelope
 * on its audio, or a Random / Step Modulator on a Filter's cutoff; `trigger` adds the
 * Sequence trigger -> gate / clock edge (`muted` as its prop).
 */
function triggerStudio(mod, { trigger = false, muted = false } = {}) {
  const store = createStudioStore(createStudioModel(), { idGenerator: createIdGenerator() });
  const d = (a) => ok(store.dispatch(a));
  const add = (nodeType) => d({ type: 'NODE_ADD', nodeType }).created.nodes[0];
  const edge = (from, fp, to, tp, props) => d({ type: 'EDGE_ADD', from: { node: from, port: fp },
    to: { node: to, port: tp }, ...(props ? { props } : {}) }).created.edges[0];
  const seq = add('sequence');
  const master = add('master');
  let target = null;
  let port = 'gate';
  if (mod === 'envelope') {
    target = add('envelope');
    edge(seq, 'audio', target, 'audio');
    edge(target, 'audio', master, 'audio');
  } else {
    const flt = add('filter');
    target = add(mod);
    port = mod === 'random' ? 'trigger' : 'clock';
    edge(seq, 'audio', flt, 'audio');
    edge(flt, 'audio', master, 'audio');
    edge(target, 'control', flt, 'frequency');
  }
  const triggerEdge = trigger ? edge(seq, 'trigger', target, port, { muted }) : null;
  const tr = d({ type: 'TRACK_ADD', kind: 'event', target: seq }).created.tracks[0];
  for (let i = 0; i < 4; i++) {
    d({ type: 'CLIP_ADD', trackId: tr, kind: 'pattern', start: i * 0.5, duration: 0.25 });
  }
  return { store, target, triggerEdge };
}

/** Every AudioParam call and source start / stop a 2.5 s playback of `store` made, in order. */
function scheduleOf(store) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store });
  ok(transport.start());
  const debug = transport.debugInfo(); // while playing (the timeline ends at 1.75 s)
  fx.advance(2.5);
  const log = [];
  for (const n of fx.ctx.created) {
    for (const [k, v] of Object.entries(n)) {
      if (v && Array.isArray(v.calls)) log.push(`${n.kind}.${k}:${JSON.stringify(v.calls)}`);
    }
    if ('startAt' in n) log.push(`${n.kind} start ${n.startAt} stop ${n.stopAt}`);
  }
  return { log: log.join('\n'), debug };
}

test('V272 A3: a muted TRIGGER edge does not gate its Envelope', () => {
  const none = scheduleOf(triggerStudio('envelope').store);
  const live = scheduleOf(triggerStudio('envelope', { trigger: true }).store);
  const muted = scheduleOf(triggerStudio('envelope', { trigger: true, muted: true }).store);
  assert.notEqual(live.log, none.log, 'an unmuted gate edge gates the envelope');
  assert.equal(live.debug.gatedEnvelopes.length, 1);
  assert.deepEqual(muted.debug.gatedEnvelopes, [], 'the timeline does not own the envelope');
  assert.equal(muted.log, none.log, 'a muted gate edge schedules what no edge schedules');
});

test('V272 A3: muting the gate edge during playback stops the gating from the horizon', () => {
  const { store, target, triggerEdge } = triggerStudio('envelope', { trigger: true });
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store });
  const { baseTime: b } = ok(transport.start());
  fx.advance(0.6); // the clips at 1 s and 1.5 s are scheduled, with their gates
  ok(store.dispatch({ type: 'EDGE_UPDATE', edgeId: triggerEdge, props: { muted: true } }));
  ok(transport.sync());
  assert.deepEqual(transport.debugInfo().gatedEnvelopes, [], 'the envelope is open again');
  fx.advance(1);
  const vca = runtime.nodes.get(target).inputs.audio.gain;
  const at = (p) => valueAtTime(getSchedule(vca), b + p);
  assert.ok(Math.abs(at(1.1) - at(1.4)) < 1e-9, `no gate after the clip at 1 s: ${at(1.1)} `
    + `vs ${at(1.4)}`);
});

// ---------------------------------------------------------------- B9

/** The reference Envelope's VCA gain at positions `ps` with gate clips `clips` ([start, dur]). */
function gatesAt(clips, ps) {
  const s = setup();
  dispatch(s, { type: 'TRACK_ADD', kind: 'event', target: 'env-1', name: 'Gate' });
  const trackId = s.store.getModel().timeline.tracks.at(-1).id;
  // A last gate at 20 s keeps the playback (and the envelope's schedule) alive meanwhile.
  for (const [start, duration] of [...clips, [20, 0.5]]) {
    dispatch(s, { type: 'CLIP_ADD', trackId, kind: 'event', start, duration,
      payload: { action: 'gate' } });
  }
  const { baseTime: b } = ok(s.transport.start());
  s.fx.advance(Math.max(...ps) + 0.1);
  const vca = s.runtime.nodes.get('env-1').inputs.audio.gain;
  return ps.map((p) => valueAtTime(getSchedule(vca), b + p));
}

const SUSTAIN = 0.7; // the reference Envelope's sustain (DEFAULT_ADSR)
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('V272 B9: a gate nested in another on one Envelope keeps it open to the outer end', () => {
  const [p15, p21, p35] = gatesAt([[0, 4], [1, 1]], [1.5, 2.1, 3.5]);
  assert.ok(near(p15, SUSTAIN), `inside both gates: ${p15}`);
  assert.ok(near(p21, SUSTAIN), `after the nested gate's end: ${p21}`);
  assert.ok(near(p35, SUSTAIN), `still inside the outer gate: ${p35}`);
});

test('V272 B9: overlapping gates on one Envelope release at the later end', () => {
  const [p1, p15, p25, p35] = gatesAt([[0, 2], [1, 2]], [1.005, 1.5, 2.5, 3.5]);
  assert.ok(near(p1, SUSTAIN), `one gate (their union): no retrigger at 1 s: ${p1}`);
  assert.ok(near(p15, SUSTAIN) && near(p25, SUSTAIN), `open from 0 to 3 s: ${p15}, ${p25}`);
  assert.ok(p35 < 0.05, `released after 3 s: ${p35}`);
  // Touching gates stay two gates: the second retriggers at the first's end.
  const [t05, t09] = gatesAt([[0, 0.5], [0.5, 0.5]], [0.505, 0.9]);
  assert.ok(t05 > SUSTAIN, `the second gate's attack at 0.5 s: ${t05}`);
  assert.ok(near(t09, SUSTAIN), `then its sustain: ${t09}`);
});

// ---------------------------------------------------------------- B11

function fakeOfflineCtor(made) {
  return class extends StudioFakeContext {
    constructor({ numberOfChannels, length, sampleRate }) {
      super({ sampleRate, state: 'suspended' });
      this.numberOfChannels = numberOfChannels;
      this.length = length;
      made.push(this);
    }

    startRendering() {
      return Promise.resolve(this.createBuffer(this.numberOfChannels, this.length,
        this.sampleRate));
    }
  };
}

test('V272 B11: the default offline render keeps the end of the last clip', async () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const made = [];
  const r = await renderStudioOffline(model, { sampleRate: SR,
    OfflineAudioContext: fakeOfflineCtor(made) });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const ctx = made[0];
  const bufferEnd = ctx.length / ctx.sampleRate;
  const lastEnd = r.startTime + timelineEnd(model); // the last clip's end on the audio clock
  const master = ctx.created.find((n) => n.kind === 'gain' && n.outputs.includes(ctx.destination));
  const fade = master.gain.calls.find((c) => c[0] === 'setValueAtTime');
  assert.ok(lastEnd <= fade[2] + 1e-9, `the output fade (${fade[2]} s) starts after the last `
    + `clip's end (${lastEnd} s)`);
  assert.ok(bufferEnd >= lastEnd + STUDIO_STOP_S - 1e-9, `buffer ${bufferEnd} s`);
  // The plan says how long the default render is: the timeline, its start time and the fade.
  const plan = planOfflineRender(model);
  assert.ok(plan.duration >= r.startTime + timelineEnd(model) + STUDIO_STOP_S - 1e-9);
  assert.equal(plan.duration, r.plan.duration);
  // An explicit duration is the buffer length, as before.
  const two = [];
  ok(await renderStudioOffline(model, { duration: 2, sampleRate: SR,
    OfflineAudioContext: fakeOfflineCtor(two) }));
  assert.equal(two[0].length, 2 * SR);
});

// ---------------------------------------------------------------- A2

test('V272 A2: a clock edge into Random / Step Modulator changes what plays', () => {
  for (const mod of ['random', 'step-modulator']) {
    const free = scheduleOf(triggerStudio(mod).store).log;
    const clocked = scheduleOf(triggerStudio(mod, { trigger: true }).store).log;
    const muted = scheduleOf(triggerStudio(mod, { trigger: true, muted: true }).store).log;
    assert.notEqual(clocked, free, `${mod}: the clock edge is read`);
    assert.equal(muted, free, `${mod}: a muted clock edge is no clock (A3)`);
  }
});

test('V272 A2: a clocked Step Modulator outputs step k at the k-th trigger', () => {
  const { store, target } = triggerStudio('step-modulator', { trigger: true });
  const steps = store.getModel().graph.nodes.find((n) => n.id === target).params.steps;
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init());
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store });
  const { baseTime: b } = ok(transport.start());
  fx.advance(1.2);
  const out = runtime.nodes.get(target).outputs.control;
  const sets = out.offset.calls.filter((c) => c[0] === 'setValueAtTime' && c[2] >= b - 1e-9)
    .map((c) => [c[1], c[2]]);
  // The Sequence's clips start at 0, 0.5, 1 and 1.5 s: one trigger each.
  const bF = Math.round(b * SR);
  assert.deepEqual(sets, [0, 1, 2, 3].map((k) => [steps[k], (bF + k * 0.5 * SR) / SR]));
});
