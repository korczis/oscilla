// V3.1 Studio transport (src/js/studio/transport.js): live timeline playback on the Studio
// runtime, on the real AudioEngine with a recording fake AudioContext whose clock is shared with
// the engine timers (sequencer-fake-audio.mjs createFakeAudioEnv). Spec §93-§104, §180-§185,
// §209-§213, §257.
//   node --test tests/unit/v31-studio-transport.test.mjs
//
// Times are compared EXACTLY where they are whole frames at 48 kHz (the transport anchor, clip
// starts, automation points); 1e-9 where a value is computed from a curve.
// Real rendering (clips audible at their times, the cutoff sweep in the spectrum, leaks) is
// tests/browser/v31-studio-transport.cjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { SCHEDULE_LEAD_S } from '../../src/js/audio/scheduler.js';
import { valueAtTime } from '../../src/js/audio/envelope.js';
import {
  EDGE_S, GAIN_FLOOR, STOP_LEAD_S, STOP_PAD_S, STOP_RAMP_S, automationValueAt,
} from '../../src/js/sequencer/compiler.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { laneValueAt } from '../../src/js/studio/automation.js';
import { ROUTE_FLOOR, STUDIO_XFADE_S } from '../../src/js/studio/compiler.js';
import { createStudioRuntime, studioDivergence } from '../../src/js/studio/runtime.js';
import {
  ESCAPE_PRIORITY, SAFE_HORIZON_S, frameCeil, stopTime,
} from '../../src/js/studio/timeline-compiler.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { TRANSPORT_TEXT, createStudioTransport } from '../../src/js/studio/transport.js';
import { FakeParam, createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const SR = 48000;
const EPS = 1e-9;

function ok(r) {
  assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
  return r;
}

function setup(model = templateModel(REFERENCE_TEMPLATE_ID), opts = {}) {
  const fx = createFakeAudioEnv({ sampleRate: opts.sampleRate || SR,
    holdSupported: !!opts.hold });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true; // see liveAllSources
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const claims = [];
  const measurements = [];
  const transport = createStudioTransport({
    runtime, engine, store,
    onClaimOutput: (d) => {
      claims.push(d);
      return opts.refuse ? false : undefined;
    },
    onMeasurement: (e) => measurements.push(e),
  });
  return { fx, engine, runtime, store, transport, ctx: fx.ctx, claims, measurements };
}

const dispatch = (s, a) => ok(s.store.dispatch(a));
const isFrame = (t) => Math.abs(t * SR - Math.round(t * SR)) < 1e-6;
/** Audio time of timeline position p in pass k of a playback anchored at frame bF. */
const at = (bF, p, k = 0, loopS = 0) => (bF + Math.round(p * SR) + k * Math.round(loopS * SR))
  / SR;

/**
 * Pattern voice carriers: oscillators created by compileSequence (not the graph's own), of
 * `type` (every type when null).
 */
function voiceCarriers(s, type = null) {
  const own = new Set();
  for (const h of s.runtime.nodes.values()) {
    if (h.info && h.info.oscillator) own.add(h.info.oscillator);
  }
  return s.ctx.oscillators.filter((o) => (type === null || o.type === type) && !own.has(o)
    && o.startAt !== null).sort((a, b) => a.startAt - b.startAt);
}

/**
 * Every voice carrier, of any waveform, that sounds from a start in [t0, t1) (H001: a
 * continuation counted by its new waveform alone let an extra voice on the old one pass). A
 * carrier stopped at or before its start (a scheduled voice cancelled unheard) never sounds.
 */
const startedIn = (s, t0, t1 = Infinity) => voiceCarriers(s)
  .filter((o) => o.startAt >= t0 - EPS && o.startAt < t1 - EPS
    && !(o.stopAt !== null && o.stopAt <= o.startAt + EPS));

/** Every node reachable from `node` through connections (AudioParams are leaves). */
function reach(node, seen = new Set()) {
  if (!node || seen.has(node)) return seen;
  seen.add(node);
  for (const d of node.outputs || []) reach(d, seen);
  return seen;
}

const filterFreq = (s) => s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
const callsFrom = (param, t0) => param.calls.filter((c) => c[0] === 'cancelScheduledValues'
  ? c[1] >= t0 - EPS : c[2] >= t0 - EPS);
const near = (a, b, tol = EPS) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
/** The node `k` connections down the first output of `node`. */
const hop = (node, k) => (k > 0 ? hop(node.outputs[0], k - 1) : node);
/** A gain node's scheduled value at `tau` (its value before the first event). */
const gainAt = (g, tau) => automationValueAt(g.gain.events, tau, g.gain.value);

/**
 * The fade gain of continued voice `carrier` (H001): the node after the voice's own chain
 * (carrier -> amp -> envelope -> out -> fade -> the new pattern bus; the old voice `old` has its
 * bus there), never a route of the runtime.
 */
function continuedFade(s, carrier, old, route) {
  const fade = hop(carrier, 4);
  assert.equal(fade.kind, 'gain');
  assert.notEqual(fade, route, 'the fade is not the route');
  assert.ok(![...s.runtime.edges.values()].some((e) => e.gain === fade), 'nor any route');
  assert.ok(!reach(old).has(fade), 'the old voice does not pass the fade');
  assert.notEqual(hop(carrier, 5), hop(old, 4), 'into the new pattern bus, not the old one');
  return fade;
}

/** Through fade x route a voice continued at t0 rises as (tau - t0) / STUDIO_XFADE_S. */
function assertRise(fade, route, t0, tol) {
  for (let i = 0; i <= 20; i += 1) {
    const tau = t0 + (i / 20) * STUDIO_XFADE_S;
    const got = gainAt(fade, tau) * gainAt(route, tau);
    assert.ok(Math.abs(got - i / 20) <= tol, `level ${got} at t0 + ${tau - t0} s, not ${i / 20}`);
  }
  const after = t0 + 2 * STUDIO_XFADE_S;
  near(gainAt(fade, after) * gainAt(route, after), 1, tol);
}

// ---------------------------------------------------------------- Basic Synth (§257)

test('PLAY keeps the first clip when the audio clock moves during start()', () => {
  // A fresh browser context advanced two render quanta between runtime.start() choosing
  // baseTime (hooks.soon()) and the scheduler's first advance (measured in chromium: baseTime
  // 0.021333, first advance at 0.005333): the Tone clip at baseTime was skipped as late.
  const s = setup();
  // The runtime is frozen: a view of it whose start() moves the clock (only, no timers) after
  // choosing baseTime.
  const runtime = Object.create(s.runtime, { start: { value: () => {
    const r = s.runtime.start();
    s.ctx.advance(s.ctx.currentTime + (2 * 128) / SR);
    return r;
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  assert.ok(b - s.ctx.currentTime < SAFE_HORIZON_S, 'the clock is inside the safe horizon');
  assert.equal(transport.debugInfo().skippedLate, 0);
  s.fx.advance(0.2);
  const carriers = voiceCarriers(s, 'sawtooth');
  assert.deepEqual(carriers.map((o) => o.startAt), [at(bF, 0)], 'the Tone voice starts at b');
  // §212: the clip starts where its voice envelope leaves the floor — on the baseTime frame,
  // together with the graph's start ramps (routes 0 → 1, the ADSR attack).
  const env = carriers[0].outputs[0].outputs[0].gain;
  const attack = env.scheduled.findIndex((e) => e.ramp === 'linear' && e.value === 1);
  assert.deepEqual([env.scheduled[attack - 1].t, env.scheduled[attack - 1].value], [b, GAIN_FLOOR]);
  near(env.scheduled[attack].t, b + EDGE_S);
  const route = s.runtime.edges.get('edge-1').gain.gain;
  assert.deepEqual(route.calls.filter((c) => c[2] >= b).slice(0, 2).map((c) => [c[0], c[1], c[2]]),
    [['setValueAtTime', 0, b], ['linearRampToValueAtTime', 1, b + STUDIO_XFADE_S]]);
});

test('PLAY keeps the first clip when the audio clock passes baseTime during start()', () => {
  // CI (webkit, starved runner): the clock passed the anchor itself between runtime.start()
  // choosing baseTime and the first advance — more than the scheduling lead, not two quanta —
  // and the first-window cap (baseTime still ahead) no longer applied: the Tone clip was
  // skipped as late. Nothing was scheduled under that anchor yet, so the first window anchors
  // the playback at the first schedulable time instead, and every clip keeps its offset.
  const s = setup();
  const jump = 0.05; // > SAFE_HORIZON_S and > the lead baseTime carried
  let chosen = null;
  const runtime = Object.create(s.runtime, { start: { value: () => {
    const r = s.runtime.start();
    chosen = r.at;
    s.ctx.advance(s.ctx.currentTime + jump);
    return r;
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  const now = s.ctx.currentTime;
  assert.ok(now > chosen, 'the clock is past the baseTime runtime.start() chose');
  assert.equal(transport.debugInfo().skippedLate, 0, 'no clip skipped as late');
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  const q = 128 / SR;
  assert.equal(b, Math.ceil((now + Math.max(SAFE_HORIZON_S, 2 * q)) / q - 1e-9) * q,
    'anchored one scheduling lead after the clock, on a render quantum');
  assert.ok(isFrame(b));
  assert.deepEqual(transport.debugInfo().decisions.filter((d) => d.decision === 'reanchor')
    .map((d) => [d.from, d.to]), [[chosen, b]]);
  s.fx.advance(0.2);
  const tone = voiceCarriers(s, 'sawtooth');
  assert.deepEqual(tone.map((o) => o.startAt), [at(bF, 0)], 'the Tone voice starts at b');
  const env = tone[0].outputs[0].outputs[0].gain;
  const attack = env.scheduled.findIndex((e) => e.ramp === 'linear' && e.value === 1);
  assert.deepEqual([env.scheduled[attack - 1].t, env.scheduled[attack - 1].value], [b, GAIN_FLOOR]);
  s.fx.advance(1.3);
  assert.deepEqual(voiceCarriers(s, 'sawtooth').map((o) => o.startAt), [at(bF, 0), at(bF, 1)],
    'Tone at b, Sweep at b + 1 s');
  // The cutoff lane is anchored there too (its first point at position 0).
  const cutoff = s.runtime.nodes.get('filter-1').modTarget('frequency', 'linear').param;
  assert.ok(cutoff.calls.some((c) => c[0] === 'setValueAtTime' && c[2] === b), 'lane at b');
  assert.ok(cutoff.calls.every((c) => c[2] === undefined || c[2] < now || c[2] >= b),
    'nothing scheduled between the clock and the anchor');
  // Genuine lateness mid-play still skips (the grid is kept): a stall past the Sweep's start.
  const s2 = setup();
  const r2 = ok(s2.transport.start());
  s2.ctx.advance(r2.baseTime + 1.5); // the clock only: the wake-up timer did not run
  s2.fx.advance(0.01);
  assert.equal(s2.transport.debugInfo().skippedLate, 1, 'the Sweep, late mid-play, is skipped');
  assert.equal(s2.transport.debugInfo().decisions.filter((d) => d.decision === 'reanchor').length,
    0);
});

test('a clip voice compiled after the clock passed its start keeps the clip boundaries', () => {
  // CI (webkit, linux-x64; #261, #262, run 40861009819): the first window's lateness check read
  // the clock before baseTime, then the main thread was late before the Tone's voice was built.
  // compileSequence clamped its start to the clock, so the whole voice moved late, its release
  // overlapped the Sweep's attack at b + 1 s and the boundary had no dip. The voice now keeps
  // its grid and joins it STOP_LEAD_S after the clock, as a stop.
  const s = setup();
  const late = 0.004; // > one render quantum (2.67 ms), < SAFE_HORIZON_S
  let transport = null;
  let jumped = null;
  const real = s.runtime.nodes;
  const nodes = Object.create(real, { get: { value: (id) => {
    const st = transport ? transport.debugInfo() : null;
    // After the first advance (the window is compiled), before its first voice is built.
    if (jumped === null && id === 'osc-1' && st && st.scheduledUntil > st.baseTime) {
      jumped = st.baseTime + late;
      s.ctx.advance(jumped);
    }
    return real.get(id);
  } } });
  const runtime = Object.create(s.runtime, { nodes: { get: () => nodes } });
  transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  assert.equal(jumped, b + late, 'the clock passed the Tone start before its voice was built');
  assert.equal(transport.debugInfo().skippedLate, 0);
  assert.equal(transport.debugInfo().decisions.filter((d) => d.decision === 'reanchor').length, 0);
  const q = 128 / SR;
  const joined = transport.debugInfo().decisions.filter((d) => d.decision === 'joined-late');
  assert.equal(joined.length, 1);
  assert.equal(joined[0].clipId, 'clip-1');
  assert.equal(joined[0].from, at(bF, 0));
  assert.ok(joined[0].to >= jumped + STOP_LEAD_S - EPS
    && joined[0].to < jumped + STOP_LEAD_S + q + 0.2,
    `joined at ${joined[0].to}`);
  near((joined[0].to * SR) / 128, Math.round((joined[0].to * SR) / 128), 1e-6);
  // carrier -> amp -> env -> out (compileSequence); read before the voice ends and disconnects.
  const env = (o) => o.outputs[0].outputs[0].gain.scheduled;
  const [tone] = voiceCarriers(s, 'sawtooth');
  const toneEnv = env(tone);
  const out = tone.outputs[0].outputs[0].outputs[0].gain.scheduled;
  s.fx.advance(1.2);
  const sweep = voiceCarriers(s, 'sawtooth')[1];
  assert.deepEqual([tone.startAt, sweep.startAt], [at(bF, 0), at(bF, 1)],
    'Tone at b (its grid, not the clock), Sweep at b + 1 s');
  // The Tone's release meets the floor on the boundary frame, where the Sweep's attack leaves it.
  const release = toneEnv.filter((e) => e.ramp === 'linear' && e.value === GAIN_FLOOR);
  assert.equal(release.at(-1).t, at(bF, 1), 'the Tone releases to the floor at b + 1 s');
  const attack = env(sweep).findIndex((e) => e.ramp === 'linear' && e.value === 1);
  assert.deepEqual([env(sweep)[attack - 1].t, env(sweep)[attack - 1].value],
    [at(bF, 1), GAIN_FLOOR], 'the Sweep attacks from the floor at b + 1 s');
  near(env(sweep)[attack].t, at(bF, 1) + EDGE_S);
  // The late Tone's output joins its grid with one edge from the floor.
  assert.deepEqual(out.slice(1).map((e) => [e.t, e.value, e.ramp]), [
    [joined[0].to, GAIN_FLOOR, 'set'], [joined[0].to + EDGE_S, 1, 'linear']]);
});

test('a PLAY starved past the graph start never sounds the pattern-played carrier', () => {
  // A main thread that stalls inside PLAY after runtime.start() lets the audio thread render the
  // graph from its crossfade time, routes ramping open, before the transport claims the
  // oscillator (measured in chromium and webkit: the free-running carrier up to +6 dB re the
  // Tone before the re-anchored baseTime). The carrier is therefore built at ROUTE_FLOOR: its
  // schedule as runtime.start() leaves it, which is all the audio thread has during the stall,
  // holds the floor from the graph start on, while its routes open there.
  const s = setup();
  const jump = 0.05; // > SAFE_HORIZON_S: the clock passes the graph start during the stall
  let graph = null;
  const runtime = Object.create(s.runtime, { start: { value: () => {
    const r = s.runtime.start();
    const level = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
    const route = s.runtime.edges.get('edge-1').gain.gain;
    graph = { at: r.at, level: { calls: level.calls.map((c) => [...c]) },
      route: { calls: route.calls.map((c) => [...c]) } };
    s.ctx.advance(s.ctx.currentTime + jump);
    return r;
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  assert.ok(r.baseTime > graph.at, 're-anchored after the graph start');
  const level = levelCurve(graph.level);
  const route = levelCurve(graph.route, 0);
  for (let t = graph.at; t <= graph.at + jump; t += 0.0025) {
    assert.equal(level(t), ROUTE_FLOOR, `carrier at the floor at ${t}`);
  }
  near(route(graph.at + STUDIO_XFADE_S), 1, 1e-9);
  assert.ok(s.runtime.ownedParams().some((o) => o.node === 'osc-1' && o.param === 'level'));
});

test('a PLAY starved past the graph start never sounds a level modulation into the carrier', () => {
  // An LFO on the pattern-played oscillator's level (review D1 of #140): the runtime wired the
  // edge's depth gain straight into the carrier's level AudioParam and ramped it open from the
  // graph start, and only the transport's claim (levelMods) moved it onto the pattern bus, so a
  // stalled PLAY sounded the carrier at the LFO's depth before the first clip. An edge into a
  // parameter claimed with an `initial` value is built unconnected to it; the owner taps it.
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const lfo = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'lfo', position: { x: 0, y: 0 } }));
  const lfoId = lfo.created.nodes[0];
  const e = ok(store.dispatch({ type: 'EDGE_ADD', from: { node: lfoId, port: 'control' },
    to: { node: 'osc-1', port: 'level' } }));
  const edgeId = e.created.edges[0];
  const s = setup(store.getModel());
  const jump = 0.05; // > SAFE_HORIZON_S: the clock passes the graph start during the stall
  let graph = null;
  const runtime = Object.create(s.runtime, { start: { value: () => {
    const r = s.runtime.start();
    const level = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
    const eh = s.runtime.edges.get(edgeId);
    graph = { at: r.at, level, gain: eh.gain, outputs: [...eh.gain.outputs],
      route: { calls: eh.gain.gain.calls.map((c) => [...c]) } };
    s.ctx.advance(s.ctx.currentTime + jump);
    return r;
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  const r = ok(transport.start());
  assert.ok(r.baseTime > graph.at, 're-anchored after the graph start');
  assert.ok(levelCurve(graph.route, 0)(graph.at + STUDIO_XFADE_S) > 0, 'the LFO route opens');
  assert.ok(!graph.outputs.includes(graph.level),
    'at runtime.start() the LFO edge does not reach the carrier level');
  // After the claim: every path from the edge to the carrier level is held at 0 from the graph
  // start on, and the modulation reaches the pattern bus.
  const toLevel = graph.gain.outputs.filter((n) => n.outputs && n.outputs.includes(graph.level));
  assert.ok(!graph.gain.outputs.includes(graph.level), 'no direct route after the claim');
  assert.equal(toLevel.length, 1, 'one tap toward the carrier');
  const tap = levelCurve(toLevel[0].gain, 0);
  for (let t = graph.at; t <= graph.at + jump; t += 0.0025) {
    assert.equal(tap(t), 0, `the carrier tap closed at ${t}`);
  }
  const claim = transport.debugInfo().claims;
  assert.deepEqual(claim, ['osc-1']);
  assert.ok(graph.gain.outputs.some((n) => n !== toLevel[0] && n.outputs
    && n.outputs.some((d) => d instanceof FakeParam && d !== graph.level)),
  'the LFO modulates the pattern bus');
});

test('Basic Synth: Tone and Sweep clips play on the oscillator at exact audio-clock times', () => {
  const s = setup();
  const r = ok(s.transport.start());
  assert.equal(s.claims.length, 1, 'the exclusivity hook fired once');
  assert.deepEqual(s.claims[0], { owner: 'studio', position: 0 });
  assert.equal(s.runtime.state, 'running');
  const b = r.baseTime;
  const bF = Math.round(b * SR);
  assert.ok(isFrame(b), 'whole frame');
  assert.ok(b >= SAFE_HORIZON_S, 'after the engine scheduling lead');
  // The anchor is the runtime's click-free crossfade time (its routes ramp 0 → 1 there).
  const osc = s.runtime.nodes.get('osc-1');
  assert.equal(osc.info.oscillator.startAt, b);
  s.fx.advance(1.5); // the sweep clip is inside the look-ahead window now
  const carriers = voiceCarriers(s, 'sawtooth');
  assert.deepEqual(carriers.map((o) => o.startAt), [at(bF, 0), at(bF, 1)]);
  // A voice ends at startTime + its duration (a float sum) + STOP_PAD_S.
  near(carriers[0].stopAt, at(bF, 1) + STOP_PAD_S);
  near(carriers[1].stopAt, at(bF, 3) + STOP_PAD_S);
  // Tone 220 Hz, then the log sweep 220 → 880 Hz over the clip. The tone voice has ended and
  // cancelled its automation (compileSequence cleanup): what it played is FakeParam.scheduled.
  assert.deepEqual(carriers[0].frequency.events, []);
  assert.deepEqual(carriers[0].frequency.scheduled.filter((e) => e.t >= b).map((e) => [e.t, e.value,
    e.ramp]).slice(0, 1), [[at(bF, 0), 220, 'set']]);
  const sweep = carriers[1].frequency.events.filter((e) => e.t >= at(bF, 1));
  assert.deepEqual([sweep.at(-1).value, sweep.at(-1).ramp], [880, 'exponential']);
  near(sweep.at(-1).t, at(bF, 3)); // the voice's start + the block's end (a float sum)
  assert.equal(sweep[0].value, 220);
  // The oscillator is pattern-played: its free-running carrier is held at the floor...
  const level = osc.modTarget('level', 'linear').param;
  assert.deepEqual(level.calls.at(-1), ['setValueAtTime', ROUTE_FLOOR, 0]);
  assert.deepEqual(s.runtime.ownedParams(), [{ node: 'filter-1', param: 'frequency' },
    { node: 'osc-1', param: 'level' }]);
  // ...and the voices play into a pattern bus feeding the oscillator's route to the Envelope,
  // so they pass ENV → FILTER → MASTER into the engine's safety chain.
  const route = s.runtime.edges.get('edge-1').gain;
  const bus = s.ctx.of('gain').find((g) => g !== osc.outputs.audio && g.outputs.includes(route));
  assert.ok(bus, 'pattern bus');
  assert.equal(bus.gain.events[0].value, 1, 'the oscillator level');
  assert.ok(reach(carriers[1]).has(bus), 'the sounding sweep voice → pattern bus');
  // The tone voice has ended: its nodes are disconnected and out of the engine accounting.
  assert.equal(carriers[0].outputs.length, 0);
  assert.equal(s.engine.nodes.has(carriers[0]), false);
  const downstream = reach(bus);
  assert.ok(downstream.has(s.runtime.nodes.get('env-1').inputs.audio), 'through the ADSR');
  assert.ok(downstream.has(s.runtime.nodes.get('filter-1').inputs.audio), 'through the filter');
  assert.ok(downstream.has(s.engine.master), 'into the master safety chain');
  // Playhead from the audio clock (§94).
  const ph = s.transport.playhead();
  assert.ok(Math.abs(ph.position - (s.ctx.currentTime - b)) < EPS && ph.playing
    && ph.pass === 0);
  assert.deepEqual(s.transport.debugInfo().unplayed, []);
});

test('Basic Synth: cutoff automation reaches the filter frequency AudioParam; no runtime glide',
  () => {
    const s = setup();
    const { baseTime: b } = ok(s.transport.start());
    const bF = Math.round(b * SR);
    const fp = filterFreq(s);
    // Lane: 0 s 500 Hz, 3 s 8 kHz exponential → set at the anchor, the ramp due at once (its
    // segment begins at the anchor).
    assert.deepEqual(callsFrom(fp, b), [['setValueAtTime', 500, b],
      ['exponentialRampToValueAtTime', 8000, at(bF, 3)]]);
    s.fx.advance(0.5);
    // A parameter edit while the lane owns the parameter: the runtime re-applies the node's base
    // (detune, Q) but never glides the owned cutoff.
    const biquad = s.runtime.nodes.get('filter-1').info.stage.node;
    const targets = (p) => p.calls.filter((c) => c[0] === 'setTargetAtTime').length;
    const before = { f: targets(fp), q: targets(biquad.Q), d: targets(biquad.detune) };
    dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1200 });
    const synced = s.transport.sync();
    assert.ok(synced.synced && synced.applied.ok);
    assert.ok(synced.applied.ops.some((o) => o.op === 'node-params' && o.id === 'filter-1'));
    assert.equal(targets(fp), before.f, 'the owned cutoff is not glided');
    assert.ok(targets(biquad.Q) > before.q, 'the other parameters are still applied');
    assert.ok(targets(biquad.detune) > before.d);
    assert.equal(Object.prototype.hasOwnProperty.call(fp, 'setTargetAtTime'), false,
      'the AudioParam methods are restored');
    assert.equal(fp.setTargetAtTime, FakeParam.prototype.setTargetAtTime);
    // The schedule the lane wrote is untouched.
    assert.deepEqual(callsFrom(fp, b), [['setValueAtTime', 500, b],
      ['exponentialRampToValueAtTime', 8000, at(bF, 3)]]);

    // Control: without a transport the same edit glides the cutoff.
    const c = setup();
    ok(c.runtime.apply(c.store.getModel()));
    ok(c.runtime.start());
    const cf = filterFreq(c);
    const n = targets(cf);
    dispatch(c, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 1200 });
    ok(c.runtime.apply(c.store.getModel()));
    assert.equal(targets(cf), n + 1);
    assert.equal(cf.calls.at(-1)[1], 1200);
  });

test('Basic Synth: loop passes repeat the clips and the lane on whole frames without drift', () => {
  const s = setup();
  dispatch(s, { type: 'LOOP_SET', enabled: true, start: 0, end: 3 });
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(4.5);
  const live45 = [s.engine.activeNodeCount, s.engine.activeSourceCount];
  s.fx.advance(3); // the same phase of the next pass
  assert.deepEqual([s.engine.activeNodeCount, s.engine.activeSourceCount], live45,
    'no growth from pass to pass');
  s.fx.advance(4.6);
  const starts = voiceCarriers(s, 'sawtooth').map((o) => o.startAt);
  const expected = [];
  for (let k = 0; k <= 3; k++) expected.push(at(bF, 0, k, 3), at(bF, 1, k, 3));
  assert.deepEqual(starts.slice(0, expected.length), expected);
  for (const t of starts) assert.ok(isFrame(t), `${t} is a whole frame`);
  // Every pass anchors the lane at its start and ramps to the exact value at the loop end.
  const fp = filterFreq(s);
  for (let k = 0; k <= 3; k++) {
    const t0 = at(bF, 0, k, 3);
    assert.ok(fp.calls.some((c) => c[0] === 'setValueAtTime' && c[1] === 500 && c[2] === t0),
      `pass ${k} anchored`);
    assert.ok(fp.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && c[1] === 8000
      && c[2] === at(bF, 0, k + 1, 3)), `pass ${k} ramps to the boundary`);
  }
  const ph = s.transport.playhead();
  assert.equal(ph.pass, Math.floor((s.ctx.currentTime - b) / 3));
  assert.ok(s.transport.debugInfo().loop, 'looping');
  assert.equal(s.transport.debugInfo().skippedLate, 0);
});

test('Basic Synth: an edit during playback reschedules from the safe horizon', () => {
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.6); // the Tone clip sounds; the Sweep clip is scheduled, not started
  const [tone, sweep] = voiceCarriers(s, 'sawtooth');
  assert.equal(sweep.startAt, at(bF, 1));
  const now = s.ctx.currentTime;
  const horizon = frameCeil(now + SAFE_HORIZON_S, SR);
  const fp = filterFreq(s);
  const mark = fp.calls.length;
  dispatch(s, { type: 'CLIP_MOVE', clipId: 'clip-2', start: 1.25 });
  dispatch(s, { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.8 });
  dispatch(s, { type: 'AUTOMATION_POINT_MOVE', laneId: 'lane-1', pointId: 'pt-2', value: 4000 });
  const r = s.transport.sync();
  assert.equal(r.plan.horizon, horizon);
  const decided = Object.fromEntries(r.plan.decisions.map((d) => [d.clipId, d.decision]));
  assert.deepEqual(decided, { 'clip-1': 'retime-end', 'clip-2': 'cancel' });
  // The scheduled sweep voice is discarded unheard, the moved clip is rebuilt after the horizon.
  assert.equal(sweep.stopAt, 0);
  const moved = voiceCarriers(s, 'sawtooth').filter((o) => o !== tone && o !== sweep);
  assert.deepEqual(moved.map((o) => o.startAt), [at(bF, 1.25)]);
  assert.ok(moved[0].startAt >= horizon);
  // The sounding tone is shortened: released at its new end (a compatible live edit).
  near(tone.stopAt, at(bF, 0.8) + STOP_RAMP_S + STOP_PAD_S);
  // The lane holds its exact value at the horizon and continues to the edited point.
  const tail = fp.calls.slice(mark);
  assert.deepEqual(tail[0], ['cancelScheduledValues', horizon]);
  const held = 500 * (8000 / 500) ** ((horizon - b) / (at(bF, 3) - b));
  assert.equal(tail[1][0], 'exponentialRampToValueAtTime');
  assert.ok(Math.abs(tail[1][1] - held) < 1e-6 && tail[1][2] === horizon);
  assert.deepEqual(tail[2].slice(0, 1).concat(tail[2][2]), ['setValueAtTime', horizon]);
  assert.deepEqual(tail.at(-1), ['exponentialRampToValueAtTime', 4000, at(bF, 3)]);
  // A graph edit during playback (a node added) is applied; playback continues.
  s.fx.advance(0.1);
  const gain = dispatch(s, { type: 'NODE_ADD', nodeType: 'gain', position: { x: 0, y: 0 } })
    .created.nodes[0];
  assert.ok(gain);
  const g = s.transport.sync();
  assert.ok(g.applied.ok);
  assert.ok(s.transport.playing);
});

test('Basic Synth: a rebuilt node keeps its lane and its pattern clips (node-replace)', () => {
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.6);
  const oldFilter = s.runtime.nodes.get('filter-1');
  const oldOsc = s.runtime.nodes.get('osc-1');
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'type', value: 'highpass' });
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'waveform', value: 'square' });
  const now = s.ctx.currentTime;
  const horizon = frameCeil(now + SAFE_HORIZON_S, SR);
  const r = s.transport.sync();
  assert.deepEqual(r.applied.ops.filter((o) => o.op === 'node-replace').map((o) => o.id).sort(),
    ['filter-1', 'osc-1']);
  // The new filter's cutoff continues the lane from the horizon with its exact value there.
  const fp = filterFreq(s);
  assert.notEqual(s.runtime.nodes.get('filter-1'), oldFilter);
  const lane = fp.calls.filter((c) => c[0] !== 'setTargetAtTime' && (c[2] ?? c[1]) >= horizon);
  const held = 500 * (8000 / 500) ** ((horizon - b) / (at(bF, 3) - b));
  assert.equal(lane[0][0], 'cancelScheduledValues');
  assert.equal(lane[1][0], 'setValueAtTime');
  assert.ok(Math.abs(lane[1][1] - held) < 1e-6 && lane[1][2] === horizon);
  assert.deepEqual(lane.at(-1), ['exponentialRampToValueAtTime', 8000, at(bF, 3)]);
  // The new oscillator is claimed at once (built silent), the scheduled Sweep clip is rebuilt on
  // it with the new waveform; the old one fades with the runtime's crossfade.
  const osc = s.runtime.nodes.get('osc-1');
  assert.notEqual(osc, oldOsc);
  assert.deepEqual(osc.modTarget('level', 'linear').param.calls.at(-1),
    ['setValueAtTime', ROUTE_FLOOR, now]);
  // The sounding Tone continues on it from the edit (H001, the next test), the Sweep after it.
  const square = startedIn(s, horizon);
  assert.deepEqual(square.map((o) => o.type), ['square', 'square']);
  assert.deepEqual(square.slice(1).map((o) => o.startAt), [at(bF, 1)]);
  assert.ok(square[0].startAt >= horizon && square[0].startAt < at(bF, 1));
  const route = s.runtime.edges.get('edge-1').gain;
  assert.ok(reach(square[1]).has(route), 'into the new route');
  assert.ok(r.plan.decisions.some((d) => d.clipId === 'clip-2' && d.decision === 'cancel'));
  assert.ok(s.transport.debugInfo().decisions.some((d) => d.clipId === 'clip-1'
    && d.reason === 'node-replaced'));
});

test('H001: a waveform edit while a pattern clip sounds continues the clip on the rebuilt '
  + 'oscillator, faded in, with the new waveform; nothing leaks', async () => {
  // The Inspector's Waveform select dispatches NODE_PARAM_SET osc-1 waveform; `waveform` is
  // structural (adapters/nodes.js), so the runtime rebuilds the oscillator and crossfades its
  // routes. The Tone voice sounding into the old node's pattern bus faded out with them, and the
  // oscillator stayed silent until the Sweep clip (G1 dead-controls-9: -107 dB at 0.8 s).
  const s = setup();
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.4); // inside clip-1, Tone 220 Hz from b to b + 1 s
  const tone = voiceCarriers(s, 'sawtooth');
  assert.equal(tone.length, 1);
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'waveform', value: 'square' });
  const now = s.ctx.currentTime;
  const horizon = frameCeil(now + SAFE_HORIZON_S, SR);
  const r = s.transport.sync();
  assert.deepEqual(r.applied.ops.filter((o) => o.op === 'node-replace').map((o) => o.id),
    ['osc-1']);
  const q = 128 / SR;
  const cont = startedIn(s, horizon, at(bF, 1));
  assert.deepEqual(cont.map((o) => o.type), ['square'],
    'the rest of the Tone plays on the new oscillator, one voice');
  const t0 = cont[0].startAt;
  assert.ok(t0 >= horizon && t0 < horizon + 2 * q + EPS, `continued at ${t0} from ${horizon}`);
  near(t0 / q, Math.round(t0 / q), 1e-6);
  // The same clip from where it is: 220 Hz, the envelope at its sustain (not from the floor),
  // and its carrier ends with the clip.
  assert.ok(cont[0].frequency.scheduled.some((e) => e.t === t0 && e.value === 220));
  const env = cont[0].outputs[0].outputs[0].gain.scheduled;
  assert.ok(env.some((e) => e.t === t0 && e.ramp === 'set' && e.value === 1), 'sustain at t0');
  assert.ok(cont[0].stopAt > at(bF, 1) - EPS && cont[0].stopAt < at(bF, 1) + STOP_PAD_S + EPS);
  // Into the new node's pattern bus and its new routes, through the gain continueVoice puts
  // between the voice and the bus (found by its place: the new route ramps 0 -> 1 at t0 too, and
  // a search by ramp found the route when the fade was gone, review of #320 T1), while the old
  // voice's routes fade out.
  const route = s.runtime.edges.get('edge-1').gain;
  assert.ok(reach(cont[0]).has(route), 'into the new route');
  const fade = continuedFade(s, cont[0], tone[0], route);
  assert.ok(!reach(tone[0]).has(route), 'the old voice stays on the old routes');
  // The clock did not move during the sync, so the runtime's crossfade starts at t0: its new
  // route alone fades the voice in, linearly and complementary to the old routes, and the fade
  // gain is silent until t0 and 1 from there (a second 0 -> 1 ramp would make the level E^2, a
  // dip of 5 dB). A t0 after the crossfade time: the next test.
  near(gainAt(route, t0), 0);
  near(gainAt(fade, t0 - 1e-4), 0);
  for (let i = 0; i <= 10; i += 1) near(gainAt(fade, t0 + (i / 10) * STUDIO_XFADE_S), 1);
  assertRise(fade, route, t0, 1e-9);
  assert.ok(s.transport.debugInfo().decisions.some((d) => d.clipId === 'clip-1'
    && d.decision === 'continue' && d.reason === 'node-replaced' && d.at === t0));
  assert.equal(s.store.getModel().graph.nodes.find((n) => n.id === 'osc-1').params.waveform,
    'square', 'the model holds the edit');
  // The Sweep still plays on the new node, and STOP leaves nothing behind.
  s.fx.advance(1.0);
  assert.deepEqual(startedIn(s, horizon).map((o) => [o.type, o.startAt]),
    [['square', t0], ['square', at(bF, 1)]]);
  const done = s.transport.stop();
  s.fx.advance(0.5);
  const counts = await done;
  assert.deepEqual([counts.nodes, counts.sources, counts.engineNodes, counts.engineSources,
    counts.voices], [0, 0, 0, 0, 0]);
  assert.equal(s.ctx.liveAllSources, 0, 'every source of the context has ended');
  assert.equal(s.fx.timers.size, 0, 'no timer left behind');
});

/**
 * The reference template playing, `pre` run before the edit at `editAt` s, then osc-1's
 * waveform set to square and synced: -> { s, b, bF, tone (the sawtooth carriers sounding),
 * horizon, r, cont (the square carriers before the Sweep), decisions (clip-1's) }.
 */
function waveformEdit({ model, editAt = 0.4, transport = null, pre = null, s = setup(model) }) {
  const tr = transport ? transport(s) : s.transport;
  const { baseTime: b } = ok(tr.start());
  const bF = Math.round(b * SR);
  if (pre) pre(s, tr, b);
  s.fx.advanceTo(b + editAt);
  const tone = voiceCarriers(s, 'sawtooth');
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'waveform', value: 'square' });
  const horizon = frameCeil(s.ctx.currentTime + SAFE_HORIZON_S, s.ctx.sampleRate);
  const r = tr.sync();
  const cont = startedIn(s, horizon, b + 1);
  assert.ok(cont.every((o) => o.type === 'square'), `continued as ${cont.map((o) => o.type)}`);
  return { s, tr, b, bF, tone, horizon, r, cont };
}

const continued = (tr, clipId) => tr.debugInfo().decisions.filter((d) => d.clipId === clipId
  && d.decision === 'continue');

async function noLeaks(s, tr) {
  const done = tr.stop();
  s.fx.advance(0.5);
  const counts = await done;
  assert.deepEqual([counts.nodes, counts.sources, counts.engineNodes, counts.engineSources,
    counts.voices], [0, 0, 0, 0, 0]);
  assert.equal(s.ctx.liveAllSources, 0, 'every source of the context has ended');
  assert.equal(s.fx.timers.size, 0, 'no timer left behind');
}

const RENDER_Q = 128;
const RATES = [44100, 48000];

/**
 * A waveform edit at sample rate `sr` whose main thread stalls once runtime.apply has returned
 * (H008): the audio clock moves to stallTo(xfadeAt, q, now) before the transport plans the edit
 * and continues the Tone. xfadeAt: the runtime's crossfade time; q: a render quantum.
 */
function stalledEdit(sr, stallTo) {
  let xfadeAt = null;
  let oldRoute = null;
  let stalledAt = null;
  const view = (s) => createStudioTransport({ engine: s.engine, store: s.store,
    runtime: Object.create(s.runtime, { apply: { value: (...args) => {
      const e = s.runtime.edges.get('edge-1');
      if (!e) return s.runtime.apply(...args); // PLAY: nothing sounds yet
      oldRoute = e.gain;
      const r = s.runtime.apply(...args);
      if (r && r.at !== undefined) xfadeAt = r.at;
      stalledAt = stallTo(xfadeAt, RENDER_Q / sr, s.ctx.currentTime);
      s.ctx.advance(stalledAt);
      return r;
    } } }) });
  const out = waveformEdit({ transport: view, s: setup(undefined, { sampleRate: sr }) });
  assert.ok(oldRoute && xfadeAt !== null, 'the edit went through the runtime');
  assert.equal(out.cont.length, 1, 'the Tone continues, one voice');
  const route = out.s.runtime.edges.get('edge-1').gain;
  assert.notEqual(route, oldRoute, 'the routes were rebuilt');
  const [d] = continued(out.tr, 'clip-1');
  return { ...out, xfadeAt, oldRoute, route, stalledAt, q: RENDER_Q / sr, t0: out.cont[0].startAt,
    decision: d };
}


/** The lowest old route + continued voice (its fade x its new route) across the seam. */
function seamLow({ oldRoute, route, cont, t0, xfadeAt }) {
  const fade = hop(cont[0], 4);
  let low = Infinity;
  for (let i = 0; i <= 40; i += 1) {
    const tau = Math.min(xfadeAt, t0) + (i / 40) * (Math.abs(t0 - xfadeAt) + 2 * STUDIO_XFADE_S);
    const voice = tau < t0 ? 0 : gainAt(fade, tau) * gainAt(route, tau);
    low = Math.min(low, gainAt(oldRoute, tau) + voice);
  }
  return low;
}

for (const sr of RATES) {
  test(`H008 (${sr} Hz): a main-thread stall after runtime.apply that leaves the crossfade time `
    + 'ahead of the clock continues the voice at the crossfade: no dip, no gap', async () => {
    // Review of #320, R4: the continuation's start was read again (hooks.soon) after apply, so a
    // stall there started the voice late against old routes already fading from the crossfade
    // time: a dip, and silence once the stall passes STUDIO_XFADE_S. Here the clock moves the
    // crossfade lead less two render quanta: the crossfade time stays ahead of it by two.
    const e = stalledEdit(sr, (x, q, now) => now + SCHEDULE_LEAD_S - 2 * q);
    assert.ok(e.xfadeAt >= e.stalledAt + e.q - EPS, `${e.xfadeAt} still ahead of ${e.stalledAt}`);
    // The equal-gain crossfade is whole: the routes alone fade the voice in.
    const low = seamLow(e);
    assert.ok(low > 0.95, `the seam falls to ${low} (continued at ${e.t0}, crossfade from `
      + `${e.xfadeAt})`);
    near(e.t0, e.xfadeAt);
    assertRise(hop(e.cont[0], 4), e.route, e.t0, 0.02);
    assert.deepEqual([e.decision.at, e.decision.resumeFrom], [e.t0, 'crossfade']);
    await noLeaks(e.s, e.tr);
  });

  for (const [name, stallTo] of [
    ['past the crossfade time', (x, q) => x + q],
    ['into the last render quantum before the crossfade time', (x, q) => x - q / 2],
  ]) {
    test(`H008 (${sr} Hz): a stall ${name} continues from the soonest render quantum and fades `
      + 'in from 0 through the open route, never in the past', async () => {
      // The old routes' fade may be rendered already, which no later schedule undoes: the voice
      // continues as soon as it can, and a voice started at its programmed level on the partly
      // or fully open route would step up (a click), its own 0 -> 1 ramp on top of the route's
      // would dip: the level through fade x route rises linearly from 0 at t0 (review of #320,
      // T1 and the double-fade P3).
      const e = stalledEdit(sr, stallTo);
      assert.ok(e.t0 >= e.stalledAt + SCHEDULE_LEAD_S - EPS, `${e.t0} after ${e.stalledAt}`);
      assert.ok(e.t0 > e.xfadeAt + e.q - EPS, `${e.t0} after the crossfade ${e.xfadeAt}`);
      assert.ok(Math.abs(e.t0 / e.q - Math.round(e.t0 / e.q)) < 1e-6, 'on a render quantum');
      near(gainAt(e.route, e.xfadeAt), 0);
      assert.ok(gainAt(e.route, e.t0) > 0.3, 'the route is open at t0');
      const fade = continuedFade(e.s, e.cont[0], e.tone[0], e.route);
      near(gainAt(fade, e.t0), 0);
      assertRise(fade, e.route, e.t0, 0.02);
      assert.deepEqual([e.decision.at, e.decision.resumeFrom], [e.t0, 'soonest']);
      await noLeaks(e.s, e.tr);
    });
  }
}

/**
 * A waveform edit at sample rate `sr` whose stall after runtime.apply moves the performance clock
 * (engine._rendered, hooks.soon) by perfStall(xfadeAt, q, currentTime) seconds while currentTime
 * stands still, as Firefox's does within a task (V249; C1-H008-1, oscilla-c1's probe).
 */
function frozenClockEdit(sr, perfStall) {
  let extra = 0;
  let rendered = null;
  const view = (s) => {
    s.fx.env.performance = { now: () => s.ctx.currentTime * 1000 + extra };
    return createStudioTransport({ engine: s.engine, store: s.store,
      runtime: Object.create(s.runtime, { apply: { value: (...args) => {
        if (!s.runtime.edges.get('edge-1')) return s.runtime.apply(...args); // PLAY
        const r = s.runtime.apply(...args);
        s.engine._observeClock(s.ctx); // a reading at the frozen currentTime
        extra += perfStall(r.at, RENDER_Q / sr, s.ctx.currentTime) * 1000;
        rendered = s.engine._rendered(s.ctx);
        return { ...r, frozenAt: s.ctx.currentTime };
      } } }) });
  };
  const out = waveformEdit({ transport: view, s: setup(undefined, { sampleRate: sr }) });
  assert.equal(out.cont.length, 1, 'the Tone continues, one voice');
  const [d] = continued(out.tr, 'clip-1');
  return { ...out, rendered, t0: out.cont[0].startAt, decision: d };
}

for (const sr of RATES) {
  test(`C1-H008-1 (${sr} Hz): with currentTime standing still, a stall past the crossfade time `
    + 'continues from the soonest quantum after what is rendered, never in the past', async () => {
    const e = frozenClockEdit(sr, (x, q, ct) => x - ct + q);
    assert.ok(e.rendered > e.s.ctx.currentTime, 'the performance clock moved, currentTime not');
    assert.ok(e.t0 >= e.rendered, `continued at ${e.t0}, already rendered to ${e.rendered}`);
    assert.equal(e.decision.resumeFrom, 'soonest');
    await noLeaks(e.s, e.tr);
  });

  test(`C1-H008-1 (${sr} Hz): with currentTime standing still, a stall under the lead less a `
    + 'quantum still continues at the crossfade time', async () => {
    const e = frozenClockEdit(sr, (x, q) => SCHEDULE_LEAD_S - 2 * q);
    assert.ok(e.t0 >= e.rendered + RENDER_Q / sr - EPS, `${e.t0} ahead of ${e.rendered}`);
    assert.equal(e.decision.resumeFrom, 'crossfade');
    assert.equal(e.decision.at, e.t0);
    await noLeaks(e.s, e.tr);
  });
}

test('C1-H001-2: a prepare that takes longer than the crossfade leaves no silent seam: the old '
  + 'routes fade from where the continuation starts', async () => {
  // CI run 42713534778 (firefox, a 2-core runner): building the rebuilt oscillator took about
  // 30 ms of audio time. runtime.apply had read its crossfade time before it, so the old routes
  // faded out over [xfadeAt, xfadeAt + 20 ms] and the Tone continued only at the transport's
  // horizon read after apply, 32 ms later: -106.8 dB between them. Here the first oscillator
  // built inside apply (the prepare) moves the audio clock PREPARE_S.
  const PREPARE_S = 0.04;
  let xfadeAt = null;
  let oldRoute = null;
  const view = (s) => {
    let armed = false;
    const osc = s.engine._osc.bind(s.engine);
    s.engine._osc = (...args) => {
      if (armed) {
        armed = false;
        s.ctx.advance(s.ctx.currentTime + PREPARE_S);
      }
      return osc(...args);
    };
    return createStudioTransport({ engine: s.engine, store: s.store,
      runtime: Object.create(s.runtime, { apply: { value: (...args) => {
        const e = s.runtime.edges.get('edge-1');
        if (!e) return s.runtime.apply(...args); // PLAY: nothing sounds yet
        oldRoute = e.gain;
        armed = true;
        const r = s.runtime.apply(...args);
        armed = false;
        if (r && r.at !== undefined) xfadeAt = r.at;
        return r;
      } } }) });
  };
  const { s, tr, cont } = waveformEdit({ transport: view });
  assert.ok(oldRoute && xfadeAt !== null, 'the edit went through the runtime');
  assert.equal(cont.length, 1, 'the Tone continues, one voice');
  const t0 = cont[0].startAt;
  const route = s.runtime.edges.get('edge-1').gain;
  assert.notEqual(route, oldRoute, 'the routes were rebuilt');
  // The old route still sounds where the continuation starts, and the sum of the old route and
  // the continued voice (its fade x its new route) never falls to silence across the seam.
  assert.ok(gainAt(oldRoute, t0) > 0.5, `old route ${gainAt(oldRoute, t0)} at t0 ${t0}, `
    + `crossfade from ${xfadeAt}`);
  const fade = hop(cont[0], 4);
  let low = Infinity;
  for (let i = 0; i <= 40; i += 1) {
    const tau = Math.min(xfadeAt, t0) + (i / 40) * (Math.abs(t0 - xfadeAt) + 2 * STUDIO_XFADE_S);
    const voice = tau < t0 ? 0 : gainAt(fade, tau) * gainAt(route, tau);
    low = Math.min(low, gainAt(oldRoute, tau) + voice);
  }
  assert.ok(low > 0.5, `the seam falls to ${low}`);
  await noLeaks(s, tr);
});

test('H001: every voice sounding into the rebuilt oscillator continues, each its own clip',
  async () => {
  // Two pattern clips on two tracks play into osc-1 at once (review of #320, T3: continuing
  // only the first voice passed every test).
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  model.timeline.tracks.push({ id: 'track-2', kind: 'event', name: 'Second', target: 'osc-1' });
  model.timeline.clips.push({ id: 'clip-3', trackId: 'track-2', kind: 'pattern', start: 0,
    duration: 1, target: null, payload: { blockType: 'tone', params: { freq: 330 } } });
  const { s, tr, tone, horizon, cont } = waveformEdit({ model });
  assert.equal(tone.length, 2, 'two voices sounding before the edit');
  assert.equal(cont.length, 2, 'both continue on the new oscillator');
  const t0 = cont[0].startAt;
  assert.ok(t0 >= horizon && t0 < horizon + 2 * (128 / SR) + EPS);
  assert.deepEqual(cont.map((o) => o.startAt), [t0, t0]);
  const freqs = cont.map((o) => o.frequency.scheduled.find((e) => e.t === t0).value).sort();
  assert.deepEqual(freqs, [220, 330]);
  assert.deepEqual(['clip-1', 'clip-3'].map((id) => continued(tr, id).length), [1, 1]);
  await noLeaks(s, tr);
});

test('H001: a sounding clip shortened earlier in the playback continues to its new end on a '
  + 'waveform edit', async () => {
  // CLIP_RESIZE first (retime-end: the voice is stopping at its new end, and the scheduler
  // decides retime-end again on every later edit), then the waveform edit: the clip was silent
  // until its shortened end (review of #320, A2).
  const { s, tr, bF, horizon, cont } = waveformEdit({ editAt: 0.58, pre: (fs, t, b) => {
    fs.fx.advanceTo(b + 0.2);
    dispatch(fs, { type: 'CLIP_RESIZE', clipId: 'clip-1', duration: 0.8 });
    t.sync();
  } });
  const end = at(bF, 0.8);
  assert.equal(cont.length, 1, 'the rest of the shortened Tone plays on the new oscillator');
  const t0 = cont[0].startAt;
  assert.ok(t0 >= horizon && t0 < horizon + 2 * (128 / SR) + EPS);
  near(cont[0].stopAt, end + STOP_RAMP_S + STOP_PAD_S, 1e-9);
  // Its output fades at the new end, as the shortened voice did.
  const out = hop(cont[0], 3);
  assert.deepEqual(out.gain.events.slice(-2).map((e) => [e.ramp, e.value]),
    [['set', 1], ['linear', GAIN_FLOOR]]);
  near(out.gain.events.at(-2).t, end);
  assert.deepEqual(continued(tr, 'clip-1').map((d) => d.at), [t0]);
  // A later edit (the scheduler decides retime-end again) still finds it to its end.
  s.fx.advance(0.05);
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'waveform', value: 'triangle' });
  const h2 = frameCeil(s.ctx.currentTime + SAFE_HORIZON_S, SR);
  tr.sync();
  const tri = startedIn(s, h2, end);
  assert.deepEqual(tri.map((o) => o.type), ['triangle']);
  near(tri[0].stopAt, end + STOP_RAMP_S + STOP_PAD_S, 1e-9);
  await noLeaks(s, tr);
});

test('H001: an edit inside the last crossfade of a clip does not continue it', async () => {
  // A continuation shorter than STUDIO_XFADE_S would only start a fade-in to cut it.
  const editAt = 1 - STUDIO_XFADE_S - SAFE_HORIZON_S + 0.002;
  const { s, tr, bF, tone, cont } = waveformEdit({ editAt });
  assert.equal(tone.filter((o) => o.startAt < at(bF, 1)).length, 1, 'the Tone sounds at the edit');
  assert.equal(cont.length, 0);
  assert.equal(continued(tr, 'clip-1').length, 0);
  await noLeaks(s, tr);
});

test('Basic Synth: STOP releases everything, holds automation, leaves the model; no leaks',
  async () => {
    const s = setup();
    const { baseTime: b } = ok(s.transport.start());
    const bF = Math.round(b * SR);
    s.fx.advance(1.5); // inside the sweep clip
    const revision = s.store.getRevision();
    const model = s.store.getModel();
    const fp = filterFreq(s);
    const sweep = voiceCarriers(s, 'sawtooth')[1];
    const now = s.ctx.currentTime;
    const atStop = stopTime(now, SR);
    const mark = fp.calls.length;
    const done = s.transport.stop();
    assert.equal(s.transport.playing, false);
    // Sounding voices are released at the STOP time: the engine's release time (hooks.soon), on
    // a render quantum; the voice's output gain is faded over STOP_RAMP_S and its frequency
    // schedule is not edited while it sounds.
    assert.equal(atStop, s.engine._soon(s.ctx));
    assert.ok(atStop >= now + STOP_LEAD_S);
    const sweepCalls = sweep.frequency.calls.length;
    assert.equal(sweep.stopAt, atStop + STOP_RAMP_S + STOP_PAD_S);
    assert.equal(sweep.frequency.calls.length, sweepCalls);
    const voiceOut = [...reach(sweep)].find((n) => n.kind === 'gain'
      && n.gain.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[2] === atStop
        + STOP_RAMP_S));
    assert.ok(voiceOut, 'the voice output fades from the STOP time');
    assert.deepEqual(voiceOut.gain.events.slice(-2).map((e) => [e.ramp, e.value, e.t]),
      [['set', 1, atStop], ['linear', GAIN_FLOOR, atStop + STOP_RAMP_S]]);
    // Every lane is held at its exact value at the STOP time.
    const held = 500 * (8000 / 500) ** ((atStop - b) / (at(bF, 3) - b));
    const tail = fp.calls.slice(mark);
    assert.deepEqual(tail[0], ['cancelScheduledValues', atStop]);
    assert.ok(Math.abs(tail.at(-1)[1] - held) < 1e-6);
    assert.deepEqual([tail.at(-1)[0], tail.at(-1)[2]], ['setValueAtTime', atStop]);
    s.fx.advance(0.5);
    const counts = await done;
    assert.deepEqual([counts.nodes, counts.sources, counts.engineNodes, counts.engineSources,
      counts.voices], [0, 0, 0, 0, 0]);
    const d = s.runtime.debugInfo();
    assert.equal(d.runtimeSourceCount, 0);
    assert.equal(d.runtimeNodeCount, 0);
    assert.equal(s.ctx.liveAllSources, 0, 'every source of the context has ended');
    assert.equal(s.fx.timers.size, 0, 'no timer left behind');
    assert.deepEqual(d.ownedParams, [], 'the runtime owns its parameters again');
    // The model is untouched; the playhead returns to where playback started (§184).
    assert.equal(s.store.getRevision(), revision);
    assert.equal(s.store.getModel(), model);
    assert.deepEqual(s.transport.playhead(), { position: 0, pass: 0, playing: false });
    // PLAY → STOP → PLAY repeats without growth.
    for (let i = 0; i < 3; i++) {
      ok(s.transport.start());
      s.fx.advance(1.2);
      const p = s.transport.stop();
      s.fx.advance(0.5);
      const c = await p;
      assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
    }
    assert.equal(s.ctx.liveAllSources, 0);
  });

test('the timeline ends by itself: the transport stops and releases the Studio output',
  async () => {
    const s = setup();
    const events = [];
    s.transport.on((type, detail) => events.push([type, detail && detail.reason]));
    ok(s.transport.start({ position: 2 }));
    s.fx.advance(2);
    assert.equal(s.transport.playing, false);
    assert.ok(events.some(([t]) => t === 'ended'));
    s.fx.advance(0.5);
    const c = await s.transport.stop();
    assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
    assert.equal(s.transport.playhead().position, 2, 'back at the play start');
  });

// ---------------------------------------------------------------- exclusivity, Escape, RETURN

test('exclusivity: onClaimOutput fires before PLAY and can refuse it', () => {
  const s = setup(undefined, { refuse: true });
  const r = s.transport.start();
  assert.equal(r.ok, false);
  assert.equal(r.reason, TRANSPORT_TEXT.claimRefused);
  assert.equal(s.claims.length, 1);
  assert.equal(s.runtime.state, 'idle');
  assert.equal(s.engine.activeNodeCount, 0, 'nothing was built');
  const t = setup();
  ok(t.transport.start());
  ok(t.transport.start()); // already playing: no second claim
  assert.equal(t.claims.length, 1);
});

test('Escape: transient UI first, then stop-audio (fast); RETURN relocates to 0', async () => {
  const s = setup();
  ok(s.transport.start({ position: 1 }));
  assert.deepEqual(ESCAPE_PRIORITY, ['cancel-gesture', 'close-popup', 'cancel-selection-mode',
    'stop-audio']);
  assert.equal(s.transport.escape({ gesture: true, popup: true }), 'cancel-gesture');
  assert.equal(s.transport.escape({ popup: true }), 'close-popup');
  assert.equal(s.transport.escape({ selectionMode: true }), 'cancel-selection-mode');
  assert.equal(s.transport.playing, true, 'transient UI does not stop audio');
  s.fx.advance(0.3);
  const ph = s.transport.returnToStart();
  assert.equal(s.transport.playing, true);
  assert.ok(ph.position < 0.05, 'relocated to the start');
  const b = s.transport.debugInfo().baseTime;
  s.fx.advance(0.5);
  const tone = voiceCarriers(s, 'sawtooth').filter((o) => o.startAt >= b);
  assert.equal(tone[0].startAt, b, 'the Tone clip plays again from 0');
  assert.equal(s.transport.escape({}), 'stop-audio');
  assert.equal(s.transport.playing, false);
  assert.equal(s.transport.escape({}), null, 'nothing left to stop');
  s.fx.advance(0.3);
  const c = await s.transport.stop();
  assert.deepEqual([c.engineNodes, c.engineSources], [0, 0]);
});

// ---------------------------------------------------------------- other clip kinds

test('Sequence target: voices play into the Sequence bus; its TRIGGER gates the Envelope', () => {
  const store = createStudioStore(null, { idGenerator: createIdGenerator() });
  const d = (a) => ok(store.dispatch(a));
  const seq = d({ type: 'NODE_ADD', nodeType: 'sequence' }).created.nodes[0];
  const env = d({ type: 'NODE_ADD', nodeType: 'envelope' }).created.nodes[0];
  const master = d({ type: 'NODE_ADD', nodeType: 'master' }).created.nodes[0];
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'audio' }, to: { node: env, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: env, port: 'audio' }, to: { node: master, port: 'audio' } });
  d({ type: 'EDGE_ADD', from: { node: seq, port: 'trigger' }, to: { node: env, port: 'gate' } });
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: seq }).created.tracks[0];
  d({ type: 'CLIP_ADD', trackId: track, start: 0.5, duration: 1,
    payload: { blockType: 'tone', params: { freq: 440 } } });
  const s = setup(store.getModel());
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(0.2);
  const [carrier] = voiceCarriers(s, 'sine');
  assert.equal(carrier.startAt, at(bF, 0.5));
  const h = s.runtime.nodes.get(seq);
  assert.ok(reach(carrier).has(h.info.destination), 'into the Sequence bus');
  // The Envelope is owned by the timeline: closed at PLAY, gated at the clip start.
  const vca = s.runtime.nodes.get(env).inputs.audio.gain;
  const setAt = vca.calls.filter((c) => c[2] === at(bF, 0.5));
  assert.ok(setAt.some((c) => c[0] === 'setValueAtTime'), 'gate on at the clip start');
  assert.ok(vca.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1
    && Math.abs(c[2] - (at(bF, 0.5) + 0.01)) < EPS), 'attack');
  assert.ok(vca.calls.some((c) => c[0] === 'exponentialRampToValueAtTime'
    && c[2] > at(bF, 1.5) - EPS), 'released after the clip');
  assert.deepEqual(s.transport.debugInfo().gatedEnvelopes, [env]);
});

test('gate event clips gate their Envelope; unsupported clips are listed with a reason', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const d = (a) => ok(store.dispatch(a));
  const track = d({ type: 'TRACK_ADD', kind: 'event', target: 'env-1' }).created.tracks[0];
  d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.25, duration: 0.5,
    payload: { action: 'gate' } });
  // K023: a trigger on the Envelope plays (a pulse inside the gate: the union is unchanged);
  // the unsupported example is now a gate on Random, which only a trigger clocks.
  d({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5, duration: 0.1,
    payload: { action: 'trigger' } });
  const rnd = d({ type: 'NODE_ADD', nodeType: 'random', position: { x: 0, y: 0 } })
    .created.nodes[0];
  const rTrack = d({ type: 'TRACK_ADD', kind: 'event', target: rnd }).created.tracks[0];
  const trig = d({ type: 'CLIP_ADD', trackId: rTrack, kind: 'event', start: 0.5, duration: 0.1,
    payload: { action: 'gate' } }).created.clips[0];
  const s = setup(store.getModel());
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  const vca = s.runtime.nodes.get('env-1').inputs.audio.gain;
  assert.ok(vca.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1
    && Math.abs(c[2] - (at(bF, 0.25) + 0.01)) < EPS), 'gate at 0.25 s');
  assert.ok(vca.calls.some((c) => c[0] === 'exponentialRampToValueAtTime'
    && Math.abs(c[2] - (at(bF, 0.75) + 0.2)) < EPS), 'released at 0.75 s over R');
  assert.deepEqual(s.transport.debugInfo().unplayed, [{ id: trig, code: 'event-target',
    reason: TRANSPORT_TEXT.eventTarget('Random 1') }]);
});

test('measurement clips are handed to the measurement callback as plain data', async () => {
  const s = setup(templateModel(MEASUREMENT_TEMPLATE_ID));
  const { baseTime: b } = ok(s.transport.start());
  const bF = Math.round(b * SR);
  s.fx.advance(1.2);
  const scheduled = s.measurements.filter((e) => e.type === 'schedule');
  assert.deepEqual(scheduled.map((e) => [e.clipId, e.action, e.startTime]), [
    ['clip-1', 'noise-check', at(bF, 0)],
    ['clip-2', 'pre-roll', at(bF, 1)],
    ['clip-6', 'capture', at(bF, 1)],
    ['clip-3', 'stimulus', at(bF, 1.5)],
  ]);
  for (const e of scheduled) {
    assert.deepEqual(JSON.parse(JSON.stringify(e)), e, 'plain, serializable data');
  }
  assert.equal(scheduled.find((e) => e.clipId === 'clip-1').target, 'mic-1');
  const done = s.transport.stop();
  assert.deepEqual(s.measurements.at(-1).type, 'stop');
  s.fx.advance(0.5);
  await done;
});

// ---------------------------------------------------------------- claim / release continuity

/**
 * A FakeParam's automation as a browser holds it, replayed from its calls: cancelScheduledValues
 * drops the events at or after t; cancelAndHoldAtTime (Web Audio spec) re-ends a ramp in progress
 * at t with the value it has there and drops the later events (it inserts nothing when t lies
 * after the last event). setTargetAtTime only precedes PLAY on these params: taken as a set.
 */
function browserEvents(param, initial) {
  const kinds = { setValueAtTime: 'set', setTargetAtTime: 'set',
    linearRampToValueAtTime: 'linear', exponentialRampToValueAtTime: 'exp' };
  let ev = [];
  const sorted = () => ev.map((e, i) => ({ ...e, i })).sort((a, b) => a.time - b.time || a.i - b.i)
    .map(({ kind, time, value }) => ({ kind, time, value }));
  for (const [m, a, b] of param.calls) {
    if (m === 'cancelScheduledValues') {
      ev = ev.filter((e) => e.time < a);
    } else if (m === 'cancelAndHoldAtTime') {
      const all = sorted();
      const v = valueAtTime(all, a, initial);
      const next = all.find((e) => e.time > a);
      ev = all.filter((e) => e.time <= a);
      if (next && next.kind !== 'set') ev.push({ kind: next.kind, time: a, value: v });
    } else {
      ev.push({ kind: kinds[m], time: b, value: a });
    }
  }
  return sorted();
}

/** The carrier level at any time, as the browser plays the param's automation. */
function levelCurve(param, initial = 1) {
  const ev = browserEvents(param, initial);
  return (t) => valueAtTime(ev, t, initial);
}

/** Assert the carrier level has no step at t (the value just before t is the value at t). */
function continuousAt(param, t, label) {
  const v = levelCurve(param);
  const before = v(t - 1e-9);
  const atT = v(t);
  assert.ok(Math.abs(before - atT) <= 1e-6, `${label}: ${before} just before ${t}, ${atT} at it`);
  return atT;
}

const sourceClip = (s) => dispatch(s, { type: 'CLIP_ADD', trackId: 'track-1', kind: 'pattern',
  start: 30, duration: 1, payload: { blockType: 'tone', params: { freq: 330 } } })
  .created.clips[0];

/** The time of the transport's last setValueAtTime on the level (its claim or release time). */
const lastSetAt = (param) => param.calls.filter((c) => c[0] === 'setValueAtTime').at(-1)[2];

/**
 * Basic Synth playing; its pattern clips removed (the oscillator is released, free-running at
 * its level 1), then a clip added: the sounding oscillator is claimed at fadeAt (level →
 * ROUTE_FLOOR over STUDIO_XFADE_S).
 */
function claimedSounding(hold) {
  const s = setup(templateModel(REFERENCE_TEMPLATE_ID), { hold });
  ok(s.transport.start());
  s.fx.advance(0.1);
  dispatch(s, { type: 'CLIP_REMOVE', clipId: 'clip-1' });
  dispatch(s, { type: 'CLIP_REMOVE', clipId: 'clip-2' });
  s.transport.sync();
  s.fx.advance(0.1);
  assert.deepEqual(s.transport.debugInfo().claims, []);
  const param = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
  const clip = sourceClip(s);
  s.transport.sync();
  assert.deepEqual(s.transport.debugInfo().claims, ['osc-1']);
  const fadeAt = lastSetAt(param);
  assert.ok(fadeAt > s.ctx.currentTime, 'a sounding oscillator fades from hooks.soon()');
  return { s, param, clip, fadeAt };
}

const OFFSETS = [0, 0.005, 0.01, 0.015, STUDIO_XFADE_S, 0.03];

for (const hold of [false, true]) {
  const how = hold ? 'cancelAndHoldAtTime' : 'cancelScheduledValues';

  test(`pattern oscillator: a release inside the claim's fade holds its value (${how})`, () => {
    for (const d of OFFSETS) {
      const { s, param, clip, fadeAt } = claimedSounding(hold);
      const fade = (t) => 1 + (ROUTE_FLOOR - 1) * Math.min(1, Math.max(0, t - fadeAt)
        / STUDIO_XFADE_S);
      if (d) s.fx.advance(d);
      dispatch(s, { type: 'CLIP_REMOVE', clipId: clip });
      s.transport.sync();
      assert.deepEqual(s.transport.debugInfo().claims, []);
      const rel = lastSetAt(param);
      assert.ok(rel >= fadeAt, `released at ${rel}`);
      const held = continuousAt(param, rel, `release ${d} s after the claim`);
      near(held, fade(rel), 1e-6);
      // Up to the release the level follows the claim's fade, then returns to 1 over the
      // crossfade.
      const v = levelCurve(param);
      near(v((fadeAt + rel) / 2), fade((fadeAt + rel) / 2), 1e-6);
      near(v(rel + STUDIO_XFADE_S), 1, 1e-9);
    }
  });

  test(`pattern oscillator: a claim inside a release ramp holds the ramp's value (${how})`, () => {
    for (const d of OFFSETS) {
      const { s, param, clip } = claimedSounding(hold);
      s.fx.advance(0.1); // the claim's fade has ended: the carrier is at the floor
      dispatch(s, { type: 'CLIP_REMOVE', clipId: clip });
      s.transport.sync();
      const rel = lastSetAt(param);
      const ramp = (t) => ROUTE_FLOOR + (1 - ROUTE_FLOOR) * Math.min(1, Math.max(0, t - rel)
        / STUDIO_XFADE_S);
      if (d) s.fx.advance(d);
      sourceClip(s);
      s.transport.sync();
      assert.deepEqual(s.transport.debugInfo().claims, ['osc-1']);
      const fadeAt = lastSetAt(param);
      assert.ok(fadeAt >= rel, `claimed at ${fadeAt}`);
      const held = continuousAt(param, fadeAt, `claim ${d} s after the release`);
      near(held, ramp(fadeAt), 1e-6);
      const v = levelCurve(param);
      near(v((rel + fadeAt) / 2), ramp((rel + fadeAt) / 2), 1e-6);
      near(v(fadeAt + STUDIO_XFADE_S), ROUTE_FLOOR, 1e-9);
      // Released again at once (the same hold time): both holds stay continuous.
      dispatch(s, { type: 'CLIP_REMOVE', clipId: s.store.getModel().timeline.clips.at(-1).id });
      s.transport.sync();
      assert.deepEqual(s.transport.debugInfo().claims, []);
      assert.equal(lastSetAt(param), fadeAt);
      near(continuousAt(param, fadeAt, `release with the claim ${d} s after a release`),
        ramp(fadeAt), 1e-6);
      continuousAt(param, rel, 'the first release');
      near(levelCurve(param)((rel + fadeAt) / 2), ramp((rel + fadeAt) / 2), 1e-6);
    }
  });
}

// ------------------------------------------- claim / release continuity with a level lane

/** A linear automation lane on osc-1 level: down 1 → 0.2 over 1.5 s, back up to 0.9 at 3 s. */
const LEVEL_POINTS = [
  { id: 'pt-11', time: 0, value: 1, curve: 'linear' },
  { id: 'pt-12', time: 1.5, value: 0.2, curve: 'linear' },
  { id: 'pt-13', time: 3, value: 0.9, curve: 'linear' },
];

function levelLaneModel() {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  return { ...m, timeline: { ...m.timeline, automation: [...m.timeline.automation,
    { id: 'lane-11', target: { node: 'osc-1', param: 'level' }, points: LEVEL_POINTS }] } };
}

/** The time of the first cancel among the param's calls from index n (a claim's or release's). */
const holdSince = (param, n) => param.calls.slice(n)
  .find((c) => c[0] === 'cancelScheduledValues' || c[0] === 'cancelAndHoldAtTime')[1];

/** Assert the carrier level has no step at any of its scheduled event times from t0 on. */
function continuousFrom(param, t0, label) {
  for (const e of browserEvents(param, 1)) {
    if (e.time >= t0) continuousAt(param, e.time, `${label}, event at ${e.time}`);
  }
}

/** Run `act` and sync: the hold time of the claim or release it causes on the carrier. */
function syncHold(s, param, act) {
  const n = param.calls.length;
  act();
  s.transport.sync();
  return holdSince(param, n);
}

/**
 * Basic Synth with the level lane, playing: osc-1 is pattern-played (its lane drives the pattern
 * bus); its clips removed, it is released at `rel` and the lane drives its carrier.
 */
function releasedWithLane(hold) {
  const s = setup(levelLaneModel(), { hold });
  const b = ok(s.transport.start()).baseTime;
  const lane = (t) => laneValueAt(LEVEL_POINTS, t - b);
  s.fx.advance(0.1);
  assert.deepEqual(s.transport.debugInfo().claims, ['osc-1']);
  const param = s.runtime.nodes.get('osc-1').modTarget('level', 'linear').param;
  const t0 = s.ctx.currentTime; // nothing after it is rendered yet
  const rel = syncHold(s, param, () => {
    dispatch(s, { type: 'CLIP_REMOVE', clipId: 'clip-1' });
    dispatch(s, { type: 'CLIP_REMOVE', clipId: 'clip-2' });
  });
  assert.deepEqual(s.transport.debugInfo().claims, []);
  return { s, param, lane, rel, t0 };
}

const LANE_OFFSETS = [...OFFSETS, 0.05, 0.2];

for (const hold of [false, true]) {
  const how = hold ? 'cancelAndHoldAtTime' : 'cancelScheduledValues';

  test(`pattern oscillator: a release returns the carrier to its level lane (${how})`, () => {
    const { s, param, lane, rel, t0 } = releasedWithLane(hold);
    continuousFrom(param, t0, 'release');
    const v = levelCurve(param);
    near(v(rel), ROUTE_FLOOR, 1e-6);
    // The crossfade ends on the lane; the lane then drives the carrier.
    for (const t of [rel + STUDIO_XFADE_S, rel + 0.05, rel + 0.3, rel + 0.8]) {
      near(v(t), lane(t), 1e-6);
    }
    s.fx.advance(1);
    continuousFrom(param, t0, 'release, a second later');
    near(levelCurve(param)(rel + 1.05), lane(rel + 1.05), 1e-6);
  });

  test(`pattern oscillator: a claim inside a level lane ramp starts from the lane (${how})`, () => {
    for (const d of LANE_OFFSETS) {
      const { s, param, lane, rel, t0 } = releasedWithLane(hold);
      if (d) s.fx.advance(d);
      const fadeAt = syncHold(s, param, () => sourceClip(s));
      assert.deepEqual(s.transport.debugInfo().claims, ['osc-1']);
      assert.ok(fadeAt >= rel, `claimed at ${fadeAt}`);
      // Inside the release crossfade the claim holds that ramp's value; after it, the lane's.
      const end = rel + STUDIO_XFADE_S;
      const before = fadeAt < end
        ? ROUTE_FLOOR + (lane(end) - ROUTE_FLOOR) * (fadeAt - rel) / STUDIO_XFADE_S
        : lane(fadeAt);
      near(continuousAt(param, fadeAt, `claim ${d} s after the release`), before, 1e-6);
      continuousFrom(param, t0, `claim ${d} s after the release`);
      const v = levelCurve(param);
      near(v(fadeAt + STUDIO_XFADE_S), ROUTE_FLOOR, 1e-9);
      near(v(fadeAt + 0.5), ROUTE_FLOOR, 1e-9);
    }
  });

  test(`pattern oscillator: a release inside a level lane ramp continues it (${how})`, () => {
    for (const d of LANE_OFFSETS) {
      const { s, param, lane } = releasedWithLane(hold);
      s.fx.advance(0.1);
      let clip;
      const t0 = s.ctx.currentTime;
      const fadeAt = syncHold(s, param, () => { clip = sourceClip(s); });
      assert.deepEqual(s.transport.debugInfo().claims, ['osc-1']);
      near(levelCurve(param)(fadeAt), lane(fadeAt), 1e-6);
      if (d) s.fx.advance(d);
      const rel = syncHold(s, param, () => dispatch(s, { type: 'CLIP_REMOVE', clipId: clip }));
      assert.deepEqual(s.transport.debugInfo().claims, []);
      const fade = (t) => lane(fadeAt) + (ROUTE_FLOOR - lane(fadeAt))
        * Math.min(1, Math.max(0, t - fadeAt) / STUDIO_XFADE_S);
      near(continuousAt(param, rel, `release ${d} s after the claim`), fade(rel), 1e-6);
      continuousFrom(param, t0, `release ${d} s after the claim`);
      const v = levelCurve(param);
      for (const t of [rel + STUDIO_XFADE_S, rel + 0.1, rel + 0.6]) near(v(t), lane(t), 1e-6);
    }
  });
}

// ---------------------------------------------------------------- K169: a PLAY refused while armed

async function stopFast(s, transport) {
  const stopped = transport.stop({ fast: true });
  s.fx.advance(0.5);
  await stopped;
}

/**
 * The reference template with the Synth panel, armed as the Synth keys arm it, on a store whose
 * commit gate is transport.admit (the workspace's). `fault` makes the next PLAY fail after it left
 * the armed run: 'apply' (the document's new oscillator cannot be built: a prepare refusal),
 * 'claim' (onClaimOutput refuses), 'hook' (debugRefuseNextPlay), 'throw' (setOwnedParams throws).
 */
function armedSetup() {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const real = createStudioRuntime({ engine });
  const faults = { claim: false, owned: false };
  const runtime = Object.create(real, { setOwnedParams: { value: (...a) => {
    if (faults.owned) {
      faults.owned = false;
      throw new Error('injected setOwnedParams');
    }
    return real.setOwnedParams(...a);
  } } });
  const model = panelStore().getModel();
  let transport = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => transport.admit(next, info) });
  const events = [];
  transport = createStudioTransport({ runtime, engine, store, testContext: () => true,
    onClaimOutput: () => {
      if (!faults.claim) return undefined;
      faults.claim = false; // refused once
      return false;
    } });
  transport.on((type, detail) => events.push([type, detail]));
  ok(transport.arm());
  assert.equal(transport.armed, true);
  assert.equal(real.state, 'running');
  events.length = 0;
  return { fx, engine, runtime: real, store, transport, ctx: fx.ctx, faults, events };
}

function injectPlayFault(s, fault) {
  if (fault === 'claim') s.faults.claim = true;
  else if (fault === 'hook') assert.equal(s.transport.debugRefuseNextPlay(), true);
  else if (fault === 'throw') s.faults.owned = true;
  else if (fault === 'apply') {
    const orig = s.ctx.createOscillator;
    s.ctx.createOscillator = function injected() {
      s.ctx.createOscillator = orig;
      throw new Error('injected oscillator');
    };
  }
}

const K169_FAULTS = {
  apply: { phase: 'apply', code: 'play-refused' },
  claim: { phase: 'claim', code: 'claim-refused', reason: TRANSPORT_TEXT.claimRefused },
  hook: { phase: 'claim', code: 'claim-refused', reason: TRANSPORT_TEXT.claimRefused },
  throw: { phase: 'apply', code: 'play-refused', reason: 'injected setOwnedParams' },
};

for (const [fault, want] of Object.entries(K169_FAULTS)) {
  test(`K169: a PLAY refused while armed (${fault}) stops the runtime and says so; the next edit `
    + 'is not stranded', async () => {
    const s = armedSetup();
    s.fx.advance(0.1);
    injectPlayFault(s, fault);
    const r = s.transport.start();
    assert.equal(r.ok, false, 'PLAY is refused');
    assert.deepEqual([r.phase, r.code], [want.phase, want.code]);
    if (want.reason) assert.equal(r.reason, want.reason);
    // The runtime no longer runs the armed graph under a stopped transport.
    assert.equal(s.transport.playing, false);
    assert.equal(s.transport.armed, false);
    assert.equal(s.runtime.state, 'idle', 'the armed run is stopped');
    assert.deepEqual(s.events.filter(([t]) => t === 'state').map(([, d]) => d),
      [{ playing: false, reason: 'play-refused' }], 'one state event says why');
    const e = s.transport.debugInfo().lastError;
    assert.deepEqual([e.code, e.phase], [want.code, want.phase], 'lastError keeps the refusal');
    // An edit after it: admitted as stopped, and the divergence says nothing is applied.
    ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency',
      value: 900 }));
    s.fx.advance(0.5);
    const v = studioDivergence({ model: s.store.getModel(), revision: s.store.getRevision() },
      s.runtime);
    assert.equal(v.state, 'not-applied', 'not behind');
    const c = await s.transport.stop();
    assert.deepEqual([c.engineNodes, c.engineSources], [0, 0], 'census 0');
    // PLAY works again from there, on the edited document.
    ok(s.transport.start());
    assert.equal(s.runtime.applied().revision, s.store.getRevision());
    const stopped = s.transport.stop({ fast: true });
    s.fx.advance(0.5);
    await stopped;
  });
}

test('K169: a PLAY refused while not armed is unchanged (no state event, the error thrown as '
  + 'before)', () => {
  for (const fault of ['claim', 'hook', 'apply', 'throw']) {
    const s = armedSetup();
    s.fx.advance(0.1);
    s.transport.stop({ fast: true });
    s.fx.advance(0.5);
    assert.equal(s.runtime.state, 'idle');
    s.events.length = 0;
    injectPlayFault(s, fault);
    if (fault === 'throw') {
      assert.throws(() => s.transport.start(), /injected setOwnedParams/);
    } else {
      const r = s.transport.start();
      assert.equal(r.ok, false, fault);
      assert.equal(r.code, K169_FAULTS[fault].code);
    }
    assert.equal(s.transport.playing, false);
    assert.equal(s.runtime.state, 'idle', `${fault}: nothing started`);
    assert.deepEqual(s.events.filter(([t]) => t === 'state'), [], `${fault}: no state event`);
  }
});

test('K169: debugRefuseNextPlay is an Inject hook: outside TEST CONTEXT it refuses and changes '
  + 'nothing (ADR 0052)', async () => {
  const outside = [undefined, () => false, () => 'yes', () => { throw new Error('x'); }];
  for (const testContext of outside) {
    const s = setup();
    const transport = createStudioTransport({ runtime: s.runtime, engine: s.engine,
      store: s.store, ...(testContext ? { testContext } : {}) });
    assert.equal(transport.debugRefuseNextPlay(), false, 'refused outside TEST CONTEXT');
    ok(transport.start()); // the next PLAY is not refused
    const stopped = transport.stop({ fast: true });
    s.fx.advance(0.5);
    await stopped;
  }
  const s = setup();
  const transport = createStudioTransport({ runtime: s.runtime, engine: s.engine,
    store: s.store, testContext: () => true });
  assert.equal(transport.debugRefuseNextPlay(), true, 'in TEST CONTEXT');
  assert.equal(transport.start().code, 'claim-refused');
  ok(transport.start()); // once
  transport.stop({ fast: true });
  s.fx.advance(0.5);
});

// 98's R1 on #413: a hook armed in TEST CONTEXT and left pending when it ended never refuses a
// real PLAY; it is dropped, not kept for the next TEST CONTEXT either.
test('K169: a pending debugRefuseNextPlay is dropped once TEST CONTEXT ends', async () => {
  const s = setup();
  let inside = true;
  const transport = createStudioTransport({ runtime: s.runtime, engine: s.engine,
    store: s.store, testContext: () => inside });
  assert.equal(transport.debugRefuseNextPlay(), true, 'armed in TEST CONTEXT');
  inside = false;
  ok(transport.start()); // a real PLAY outside it is not refused
  await stopFast(s, transport);
  inside = true;
  ok(transport.start()); // and the dropped hook does not come back
  await stopFast(s, transport);
});

test('K169 review R2: a STOP whose release of the owned parameters throws still stops and says '
  + 'so', async () => {
  for (const held of [false, true]) {
    const s = setup();
    let throwNext = false;
    const runtime = Object.create(s.runtime, { setOwnedParams: { value: (...a) => {
      if (throwNext) {
        throwNext = false;
        throw new Error('injected release');
      }
      return s.runtime.setOwnedParams(...a);
    } } });
    const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
    ok(transport.start());
    s.fx.advance(0.1);
    if (held) {
      // A refusal already in lastError (a refused sync) is kept; the stop failure is still said.
      const apply = runtime.apply;
      Object.defineProperty(runtime, 'apply', { value: () => ({ ok: false, phase: 'prepare',
        errors: [{ message: 'refused edit', entity: null }] }), configurable: true });
      dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 900 });
      assert.equal(transport.sync().ok, false);
      Object.defineProperty(runtime, 'apply', { value: apply, configurable: true });
      assert.equal(transport.debugInfo().lastError.code, 'sync-refused');
    }
    throwNext = true;
    const stopped = transport.stop({ fast: true });
    assert.equal(transport.playing, false);
    s.fx.advance(0.5);
    const c = await stopped;
    assert.deepEqual([c.engineNodes, c.engineSources], [0, 0], 'the runtime stopped anyway');
    const info = transport.debugInfo();
    assert.ok(info.diagnostics.some((d) => d.code === 'stop-failed'
      && /injected release/.test(d.message)), 'a stop-failed diagnostic');
    assert.equal(info.lastError.code, held ? 'sync-refused' : 'stop-failed',
      held ? 'the earlier refusal is kept' : 'lastError says so');
    if (!held) assert.equal(info.lastError.phase, 'stop');
  }
});

test('K169: a successful PLAY after arm promotes the armed run without a gap', () => {
  const s = armedSetup();
  s.fx.advance(0.1);
  const states = [];
  const off = s.runtime.on((type, d) => { if (type === 'state') states.push(d); });
  const keys = [...s.runtime.nodes.keys()];
  const kept = keys.map((id) => s.runtime.nodes.get(id));
  const r = ok(s.transport.start());
  off();
  assert.equal(s.transport.playing, true);
  assert.equal(s.transport.armed, false);
  assert.deepEqual(states, [], 'the runtime never stopped');
  assert.deepEqual(s.events.filter(([t]) => t === 'state').map(([, d]) => d),
    [{ playing: true }], 'no stop in between');
  assert.deepEqual(keys.map((id) => s.runtime.nodes.get(id)), kept,
    'the armed nodes keep sounding');
  assert.equal(s.runtime.applied().revision, r.revision);
  assert.equal(s.transport.debugInfo().lastError, null);
});

test('K169: an apply that throws in sync is retried at the next wake-up', () => {
  const s = setup();
  let throwNext = false;
  const runtime = Object.create(s.runtime, { apply: { value: (...a) => {
    if (throwNext) {
      throwNext = false;
      throw new Error('injected apply');
    }
    return s.runtime.apply(...a);
  } } });
  const transport = createStudioTransport({ runtime, engine: s.engine, store: s.store });
  ok(transport.start());
  s.fx.advance(0.1);
  dispatch(s, { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency', value: 900 });
  const rev = s.store.getRevision();
  throwNext = true;
  assert.throws(() => transport.sync(), /injected apply/);
  assert.notEqual(s.runtime.applied().revision, rev, 'not applied yet');
  s.fx.advance(0.5); // the wake-ups
  assert.equal(s.runtime.applied().revision, rev, 'the wake-up applied it');
  assert.equal(studioDivergence({ model: s.store.getModel(), revision: rev }, s.runtime).state,
    'in-sync');
  transport.stop({ fast: true });
});
