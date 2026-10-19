// E008 (intent engineering-integrity, criterion automation-transforms): one table for every
// parameter the Studio node registry marks `automatable`. Each row states the parameter's unit,
// scale and limits, the AudioParam a lane drives, and the transform from the automation value to
// that AudioParam's value; a lane is played through the real transport (AudioEngine on the
// recording fake context of sequencer-fake-audio.mjs, as tests/unit/v272-studio-automation
// .test.mjs does) at 44.1 and 48 kHz, and what the AudioParam takes (its own schedule plus every
// ConstantSourceNode summed into it) is compared with the row's value at each of its points.
//   node --test tests/unit/studio-automation-transforms.test.mjs
//
// The oracle never comes from the compiler. Every expected value is written here as an analytic
// value: a step at its point, a linear lane at its ends and midpoint (the arithmetic mean), an
// exponential lane at its ends and midpoint (the geometric mean), a frequency clamped to
// 0.95 x Nyquist (sampleRate / 2 x 0.95), cents to a frequency ratio (2^(c / 1200)), dB to gain
// (10^(dB / 20)) on the amplitude display scale, and a control rate in Hz to a playbackRate
// (Hz x 480 / sampleRate: one control value lasts 480 samples at playbackRate 1). The table
// is written against main after the V272 fixes of #197 (plan issue V431):
//   #78   the detune lane schedules the constant cents of log-mapped frequency edges
//         (tests/unit/v431-studio-detune-lane.test.mjs)
//   A7    a detune lane is bounded by the cents that keep its oscillator at 0.95 x Nyquist
//         (automation.js detuneCeiling, transport debugInfo limitedLanes)
//   R-1   a static detune the compiler lowered into that headroom does not shift a detune lane
//   B7    an exponential lane on a strictly positive parameter with a constant edge offset is
//         the lane plus the offset (the offset summed in by a ConstantSourceNode)
//   E016  a Random / Step Modulator rate lane keeps the 480 / sampleRate scale on every write
//         path while playing: an edit, an edge offset change, a bounds clamp it brings, a
//         rebind, removal (hold and glide) and STOP (#213 R-1; rateLaneWhilePlaying)
// A parameter added to the registry without a row fails, and so does a row naming a parameter
// the registry lacks; the mutation tests at the end prove that the comparisons can fail.
//
// A row whose transform the transport gets wrong today carries `defect`: its transform test is
// a node:test TODO (it runs and prints its mismatches, and does not fail the run), and the test
// "every defect marker still describes a mismatch" fails once the defect is fixed, so the
// marker is removed with the fix.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { automationScale } from '../../src/js/studio/automation.js';
import { numberParam } from '../../src/js/studio/nodes/common.js';
import {
  NODE_DEFINITIONS, NODE_REGISTRY, createNodeRegistry,
} from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const RATES = [44100, 48000];

// ---------------------------------------------------------------- analytic values

/** 0.95 x Nyquist: the highest frequency the Studio lets reach an AudioParam. */
const safeMax = (sr) => (sr / 2) * 0.95;
/** The highest storable frequency: 0.95 x Nyquist of 384 kHz. */
const FREQUENCY_MAX = (384000 / 2) * 0.95;
const ratio = (cents) => 2 ** (cents / 1200);
const dbToGain = (db) => 10 ** (db / 20);
const lin = (a, b, k) => a + (b - a) * k;
const geo = (a, b, k) => a * (b / a) ** k;
/** The cents a detune may reach on a frequency f before f x 2^(c / 1200) passes safeMax. */
const ceilingCents = (f, sr) => 1200 * Math.log2(safeMax(sr) / f);
/** A control value lasts 480 samples at playbackRate 1: rate (Hz) -> playbackRate. */
const controlPlaybackRate = (hz, sr) => (hz * 480) / sr;

// ---------------------------------------------------------------- the table

const freqLane = {
  points: [[0, 100, 'step'], [1, 1600, 'exponential'], [2, 40000, 'linear']],
  checks: (sr) => [[0, 100], [0.5, geo(100, 1600, 0.5)], [1, 1600],
    [1.5, lin(1600, safeMax(sr), 0.5)], [2, safeMax(sr)]],
};
const levelLane = (top) => ({
  points: [[0, dbToGain(-40), 'step'], [1, top, 'linear'], [2, 0, 'linear']],
  checks: () => [[0, dbToGain(-40)], [0.5, lin(dbToGain(-40), top, 0.5)], [1, top],
    [1.5, top / 2], [2, 0]],
});
const rateLane = {
  points: [[0, 0.5, 'step'], [1, 8, 'exponential'], [2, 100, 'linear']],
  checks: () => [[0, 0.5], [0.5, geo(0.5, 8, 0.5)], [1, 8], [1.5, lin(8, 100, 0.5)], [2, 100]],
};
const panLane = {
  points: [[0, -1, 'step'], [1, 1, 'linear'], [2, 0.5, 'linear']],
  checks: () => [[0, -1], [0.5, 0], [1, 1], [1.5, 0.75], [2, 0.5]],
};
const detuneLane = {
  points: [[0, -1200, 'step'], [1, 1200, 'linear'], [2, 0, 'step']],
  checks: () => [[0, -1200], [0.5, 0], [1, 1200], [1.5, 1200], [2, 0]],
};

const osc = (h) => h.info.oscillator;
const biquad = (h) => h.info.stage.node;
const level = (h) => h.outputs.audio.gain;
const mixerLevel = (n) => ({ type: 'mixer', key: `level${n}`, unit: '', scale: 'linear', min: 0,
  max: 1, display: 'db', param: (h) => h.inputs[`in${n}`].gain, ...levelLane(1) });
const split = (key, min) => ({ type: 'stereo-split', key, unit: '', scale: 'linear', min,
  max: 1, display: key.startsWith('pan') ? 'bipolar' : 'db', points: [[0, min, 'step']],
  plays: { code: 'no-parameter', reason: /no single AudioParam/ } });

/** A linear unipolar edge from the template's LFO onto `rate`: a constant offset + depth / 2. */
const rateEdge = (offset) => ({ add: { from: { node: 'lfo-1', port: 'control' }, port: 'rate',
  props: { mapping: 'linear', polarity: 'unipolar', depth: 2, offset } } });
const rateEdgeOf = (m, id) => m.graph.edges.find((e) => e.to.node === id && e.to.port === 'rate');
/** Remove every point of the lane, the one at `last` s last (it removes the lane). */
const removeLane = (last) => (m) => {
  const lane = m.timeline.automation[0];
  const order = [...lane.points.filter((p) => p.time !== last),
    ...lane.points.filter((p) => p.time === last)];
  return order.map((p) => ({ type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id, pointId: p.id }));
};

/**
 * E016 (#213 R-1): a Random / Step Modulator rate lane in Hz on every write path of the
 * transport that scales it to playbackRate (480 / sampleRate) while playing: an edit, an edge
 * offset changed (the offset source glides), an offset that makes the bounds clamp the lane (the
 * re-applied lane), a rebind on a structural edit (`rebuild`: params that rebuild the node),
 * removal (the hold at the horizon, then the glide to the static rate) and STOP (the hold).
 * Each `play` step runs at its position; `hold` is the lane value the AudioParam takes at the
 * horizon the step writes; `checks` follow the last step. The offsets are analytic: a linear
 * unipolar edge of depth 2 adds its offset + 1 Hz.
 */
function rateLaneWhilePlaying(type, rebuild) {
  const row = { type, key: 'rate', param: (h) => h.outputs.control.playbackRate,
    toAudio: controlPlaybackRate };
  const flat = [[0, 0.5, 'step'], [1, 8, 'step'], [2, 100, 'step']];
  return [
    { ...row, case: 'rate lane edited while playing', ...rateLane,
      play: [{ at: 0.5, edit: (m) => {
        const lane = m.timeline.automation[0];
        return [{ type: 'AUTOMATION_POINT_MOVE', laneId: lane.id,
          pointId: lane.points.find((p) => p.time === 2).id, value: 50 }];
      } }],
      checks: () => [[1, 8], [1.5, lin(8, 50, 0.5)], [2, 50]] },
    { ...row, case: 'rate lane under an edge offset changed while playing', edge: rateEdge(1),
      points: [[0, 1, 'step'], [1, 4, 'exponential'], [2, 10, 'linear']],
      play: [{ at: 0.5, edit: (m, id) => [{ type: 'EDGE_UPDATE', edgeId: rateEdgeOf(m, id).id,
        props: { offset: 3 } }] }],
      checks: () => [[1.5, 7 + 4], [2, 10 + 4]] },
    { ...row, case: 'rate lane the bounds clamp after an edge offset change', edge: rateEdge(1),
      points: [[0, 97, 'step']], limited: true,
      play: [{ at: 0.5, edit: (m, id) => [{ type: 'EDGE_UPDATE', edgeId: rateEdgeOf(m, id).id,
        props: { offset: 4 } }] }],
      checks: () => [[1.5, Math.min(97 + 5, 100)], [2, Math.min(97 + 5, 100)]] },
    { ...row, case: 'rate lane rebound on a structural edit', ...rateLane,
      play: [{ at: 0.5, decision: 'rebind', edit: (m, id) => [{ type: 'NODE_PARAM_SET',
        nodeId: id, params: rebuild }] }],
      checks: () => [[1, 8], [1.5, lin(8, 100, 0.5)], [2, 100]] },
    { ...row, case: 'rate lane removed while playing', node: { rate: 3 }, points: flat,
      play: [{ at: 1.5, edit: removeLane(1), hold: 8 }],
      checks: () => [[2.5, 3], [3, 3]] },
    { ...row, case: 'rate lane held by STOP', points: flat,
      play: [{ at: 1.5, stop: true, hold: 8 }],
      checks: () => [[1.75, 8], [2.5, 8]] },
  ];
}

/**
 * One row per automatable registry parameter, plus the scenario rows of #78, A7, R-1 and B7
 * (`case`). Fields: type, key, unit, scale, min, max (the descriptor); display (the lane's
 * editor scale: log, db, linear, bipolar); node (fresh node params, or `template` with the
 * template node's id); edge (a modulation edge to add or update first); param(handle) -> the
 * Web Audio AudioParam, named structurally; points [[time, value, curve]]; checks(sr) ->
 * [[position, automation value]]; toAudio(value, sr) (default identity); frequency(sr, value)
 * -> the oscillator frequency a detune value gives (cents to ratio); limited (the lane is
 * bounded, A7); plays { code, reason } when the transport does not play the lane.
 */
const ROWS = [
  { type: 'oscillator', key: 'frequency', unit: 'Hz', scale: 'log', min: 1, max: FREQUENCY_MAX,
    display: 'log', param: (h) => osc(h).frequency, ...freqLane },
  { type: 'oscillator', key: 'detune', unit: 'cents', scale: 'linear', min: -1200, max: 1200,
    display: 'linear', param: (h) => osc(h).detune, ...detuneLane,
    frequency: (sr, c) => 440 * ratio(c) },
  { type: 'oscillator', key: 'level', unit: '', scale: 'linear', min: 0, max: 1,
    display: 'db', param: level, ...levelLane(1) },
  { type: 'noise', key: 'level', unit: '', scale: 'linear', min: 0, max: 1, display: 'db',
    param: level, ...levelLane(1) },
  { type: 'sequence', key: 'level', unit: '', scale: 'linear', min: 0, max: 1, display: 'db',
    param: level, ...levelLane(1) },
  { type: 'lfo', key: 'rate', unit: 'Hz', scale: 'log', min: 0.01, max: 100, display: 'log',
    param: (h) => osc(h).frequency, ...rateLane },
  { type: 'random', key: 'rate', unit: 'Hz', scale: 'log', min: 0.01, max: 100, display: 'log',
    param: (h) => h.outputs.control.playbackRate, toAudio: controlPlaybackRate, ...rateLane },
  { type: 'step-modulator', key: 'rate', unit: 'Hz', scale: 'log', min: 0.01, max: 100,
    display: 'log', param: (h) => h.outputs.control.playbackRate,
    toAudio: controlPlaybackRate, ...rateLane },
  { type: 'gain', key: 'gain', unit: '', scale: 'linear', min: 0, max: 2, display: 'db',
    param: level, ...levelLane(2) },
  { type: 'filter', key: 'frequency', unit: 'Hz', scale: 'log', min: 10, max: FREQUENCY_MAX,
    display: 'log', param: (h) => biquad(h).frequency, ...freqLane },
  // A band-pass Q AudioParam is the linear Q (a low-/high-pass one is in dB and plays no lane).
  { type: 'filter', key: 'Q', unit: '', scale: 'log', min: 0.0001, max: 1000, display: 'log',
    node: { type: 'bandpass' }, param: (h) => biquad(h).Q, ...rateLane },
  // A peaking gain AudioParam is in dB, as the parameter is.
  { type: 'filter', key: 'gain', unit: 'dB', scale: 'linear', min: -40, max: 40,
    display: 'linear', node: { type: 'peaking' }, param: (h) => biquad(h).gain,
    points: [[0, -24, 'step'], [1, 12, 'linear'], [2, 40, 'linear']],
    checks: () => [[0, -24], [0.5, -6], [1, 12], [1.5, 26], [2, 40]] },
  { type: 'pan', key: 'pan', unit: '', scale: 'linear', min: -1, max: 1, display: 'bipolar',
    param: (h) => h.outputs.audio.pan, ...panLane },
  split('panA', -1), split('panB', -1), split('levelA', 0), split('levelB', 0),
  mixerLevel(1), mixerLevel(2), mixerLevel(3), mixerLevel(4),

  // #78: a log-mapped frequency edge with a constant +1 octave offset puts 1200 constant cents
  // on the detune AudioParam; the detune lane keeps them (lane + 1200 ct, frequency x 2).
  { case: '#78 detune lane over a log-edge offset of +1 octave', type: 'oscillator',
    key: 'detune', param: (h) => osc(h).detune,
    edge: { add: { from: { node: 'lfo-1', port: 'control' }, port: 'frequency',
      props: { mapping: 'log', polarity: 'bipolar', depth: 1, offset: 1 } } },
    points: [[0, -600, 'step'], [1, 0, 'linear']],
    checks: () => [[0, -600 + 1200], [0.5, -300 + 1200], [1, 1200]],
    frequency: (sr, c) => 440 * ratio(c) },
  // A7 and R-1: a 12 kHz oscillator whose static detune (+1200 ct) the compiler lowers into the
  // headroom; the lane plays its own values, and its last point (+1200 ct) is bounded at the
  // ceiling, so the oscillator reaches exactly 0.95 x Nyquist.
  { case: 'A7/R-1 detune lane over a clamped static detune', type: 'oscillator', key: 'detune',
    node: { frequency: 12000, detune: 1200 }, param: (h) => osc(h).detune,
    points: [[0, -600, 'step'], [1, 600, 'linear'], [2, 1200, 'linear']],
    checks: (sr) => [[0, -600], [0.5, 0], [1, 600], [1.5, lin(600, ceilingCents(12000, sr), 0.5)],
      [2, ceilingCents(12000, sr)]],
    frequency: (sr, c) => 12000 * ratio(c), limited: true },
  // B7: the template's cutoff with its LFO edge linear and unipolar (depth 200, offset 3000: a
  // constant 3100 Hz) under an exponential lane: the AudioParam takes the lane plus 3100 Hz.
  { case: 'B7 exponential cutoff lane plus a constant edge offset', type: 'filter',
    key: 'frequency', node: { template: 'filter-1' }, param: (h) => biquad(h).frequency,
    edge: { update: 'edge-4', props: { mapping: 'linear', polarity: 'unipolar', depth: 200,
      offset: 3000 } },
    points: [[0, 500, 'step'], [2, 8000, 'exponential']],
    checks: () => [[0, 500 + 3100], [1, geo(500, 8000, 0.5) + 3100], [2, 8000 + 3100]] },
  // A Random's rate lane over a linear unipolar edge (depth 2, offset 1: a constant 2 Hz): the
  // lane plus 2 Hz, in Hz, reaches playbackRate at 480 / sampleRate, offset source included.
  { case: 'rate lane plus a constant edge offset', type: 'random', key: 'rate',
    param: (h) => h.outputs.control.playbackRate, toAudio: controlPlaybackRate,
    edge: { add: { from: { node: 'lfo-1', port: 'control' }, port: 'rate',
      props: { mapping: 'linear', polarity: 'unipolar', depth: 2, offset: 1 } } },
    points: [[0, 1, 'step'], [1, 4, 'exponential'], [2, 10, 'linear']],
    checks: () => [[0, 1 + 2], [0.5, geo(1, 4, 0.5) + 2], [1, 4 + 2], [1.5, 7 + 2],
      [2, 10 + 2]] },
  ...rateLaneWhilePlaying('random', { seed: 7 }),
  ...rateLaneWhilePlaying('step-modulator', { playback: 'once' }),
];

const DESCRIPTORS = ROWS.filter((r) => !r.case);
const rowId = (r) => `${r.type}.${r.key}`;
const rowLabel = (r) => (r.case ? `${rowId(r)} (${r.case})` : rowId(r));

// ---------------------------------------------------------------- coverage

/** The automatable parameters of `registry` as type.key. */
function automatableIds(registry) {
  return registry.list().flatMap((def) => def.params.filter((p) => p.automatable)
    .map((p) => `${def.type}.${p.key}`));
}

/** Registry parameters without a descriptor row, and rows the registry lacks. */
function coverageProblems(registry, rows) {
  const want = new Set(automatableIds(registry));
  const have = rows.filter((r) => !r.case).map(rowId);
  const problems = [];
  for (const id of want) if (!have.includes(id)) problems.push(`${id}: no row`);
  for (const id of new Set(have)) {
    if (!want.has(id)) problems.push(`${id}: a row the registry does not mark automatable`);
    if (have.filter((x) => x === id).length > 1) problems.push(`${id}: more than one row`);
  }
  for (const r of rows.filter((x) => x.case)) {
    if (!want.has(rowId(r))) problems.push(`${rowLabel(r)}: a case the registry lacks`);
  }
  return problems;
}

/** Where a row's descriptor differs from the registry's parameter definition. */
function descriptorProblems(registry, row) {
  const def = registry.param(row.type, row.key);
  if (!def) return [`${rowId(row)}: not in the registry`];
  const out = [];
  for (const f of ['unit', 'scale', 'min', 'max']) {
    if (def[f] !== row[f]) out.push(`${rowId(row)} ${f}: registry ${def[f]}, row ${row[f]}`);
  }
  if (!def.automatable) out.push(`${rowId(row)}: not automatable`);
  return out;
}

// ---------------------------------------------------------------- the transport

/** A FakeParam's own value at t (set, linear, exponential and setTargetAtTime events). */
function ownValueAt(p, t) {
  const ev = p.events.map((e, i) => ({ ...e, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  let v = p.defaultValue;
  let t0 = 0;
  let target = null;
  const at = (x) => (target ? target.value + (v - target.value) * Math.exp(-(x - t0)
    / target.tau) : v);
  for (const e of ev) {
    if (e.t > t) {
      if (e.ramp === 'linear' || e.ramp === 'exponential') {
        const a = at(t0);
        const k = (t - t0) / (e.t - t0);
        if (e.ramp === 'linear') return a + (e.value - a) * k;
        return a * e.value > 0 ? a * (e.value / a) ** k : a;
      }
      break;
    }
    const now = at(e.t);
    if (e.ramp === 'target') {
      v = now;
      target = e;
    } else {
      v = e.value;
      target = null;
    }
    t0 = e.t;
  }
  return at(t);
}

/** What an AudioParam takes at t: its own schedule plus the constant sources summed into it. */
function actualAt(ctx, p, t) {
  let v = ownValueAt(p, t);
  for (const n of ctx.created) {
    if (n.kind !== 'constant-source' || !n.outputs.includes(p)) continue;
    if (n.startAt === null || n.startAt > t || (n.stopAt !== null && n.stopAt <= t)) continue;
    v += ownValueAt(n.offset, t);
  }
  return v;
}

function ok(r, what) {
  assert.ok(r.ok, `${what}: ${r.reason || JSON.stringify(r.errors)}`);
  return r;
}

/** The reference template without its lane, the row's node and lane added. */
function rowModel(row) {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const base = { ...m, timeline: { ...m.timeline, automation: [] } };
  const store = createStudioStore(base, { idGenerator: createIdGenerator(base) });
  let id;
  if (row.node && row.node.template) {
    id = row.node.template;
  } else {
    id = ok(store.dispatch({ type: 'NODE_ADD', nodeType: row.type, position: { x: 0, y: 0 } }),
      `add ${row.type}`).created.nodes[0];
    const params = row.node ? { ...row.node } : null;
    if (params) ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, params }), 'params');
  }
  if (row.edge && row.edge.add) {
    ok(store.dispatch({ type: 'EDGE_ADD', from: row.edge.add.from,
      to: { node: id, port: row.edge.add.port }, props: row.edge.add.props }), 'edge');
  }
  if (row.edge && row.edge.update) {
    ok(store.dispatch({ type: 'EDGE_UPDATE', edgeId: row.edge.update, props: row.edge.props }),
      'edge');
  }
  for (const [time, value, curve] of row.points) {
    ok(store.dispatch({ type: 'AUTOMATION_POINT_ADD', target: { node: id, param: row.key },
      time, value, curve }), `point ${value} at ${time} s`);
  }
  return { model: store.getModel(), id };
}

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/**
 * Play the row's lane at `sr` and compare the AudioParam with the row at each point: a list of
 * mismatches (empty when the transport realises the row).
 */
function transformMismatches(row, sr) {
  const { model, id } = rowModel(row);
  let transport = null;
  // The workspace's commit gate: while playing, the transport admits an edit first.
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  const fx = createFakeAudioEnv({ sampleRate: sr });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  transport = createStudioTransport({ runtime, engine, store });
  const started = ok(transport.start(), 'PLAY');
  const out = [];
  try {
    const lane = store.getModel().timeline.automation[0];
    const un = transport.debugInfo().unplayed.find((u) => u.id === lane.id);
    if (row.plays) {
      if (!un) out.push('the lane plays, the row says it does not');
      else {
        if (un.code !== row.plays.code) out.push(`unplayed code ${un.code}`);
        if (!row.plays.reason.test(un.reason)) out.push(`unplayed reason "${un.reason}"`);
      }
      return out;
    }
    if (un) return [`the lane is not played: ${un.code} ${un.reason}`];
    const toAudio = row.toAudio || ((v) => v);
    let h = runtime.nodes.get(id);
    for (const step of row.play || []) {
      fx.advanceTo(started.baseTime + step.at);
      const before = row.param(h);
      const n0 = before.calls.length;
      if (step.edit) {
        for (const a of step.edit(store.getModel(), id)) ok(store.dispatch(a), a.type);
      }
      if (step.stop) transport.stop().catch(() => {});
      if (step.decision && !transport.debugInfo().decisions
        .some((d) => d.decision === step.decision && d.key === lane.id)) {
        out.push(`${step.at} s: no ${step.decision} decision for the lane`);
      }
      h = runtime.nodes.get(id) || h;
      if (step.hold === undefined) continue;
      // The horizon: the time of the last value the step wrote on the AudioParam.
      const set = before.calls.slice(n0).filter((c) => c[0] === 'setValueAtTime').pop();
      if (!set) {
        out.push(`${step.at} s: no hold written`);
        continue;
      }
      const got = actualAt(fx.ctx, before, set[2]);
      const want = toAudio(step.hold, sr);
      if (!near(got, want)) out.push(`${step.at} s: hold ${got}, row ${want}`);
    }
    const p = row.param(h);
    const oscFreq = row.frequency ? osc(h).frequency : null;
    for (const [pos, value] of row.checks(sr)) {
      const t = started.baseTime + pos;
      fx.advanceTo(t);
      const got = actualAt(fx.ctx, p, t);
      const want = toAudio(value, sr);
      if (!near(got, want)) out.push(`${pos} s: AudioParam ${got}, row ${want}`);
      if (oscFreq) {
        const f = ownValueAt(oscFreq, t) * ratio(got);
        const wantF = row.frequency(sr, value);
        if (!near(f, wantF)) out.push(`${pos} s: frequency ${f} Hz, row ${wantF} Hz`);
        if (f > safeMax(sr) * (1 + 1e-9)) out.push(`${pos} s: ${f} Hz above 0.95 x Nyquist`);
      }
    }
    const limited = transport.debugInfo().limitedLanes
      .some((l) => l.node === id && l.param === row.key);
    if (limited !== !!row.limited) out.push(`limitedLanes ${limited ? 'lists' : 'omits'} it`);
  } finally {
    transport.stop({ fast: true });
  }
  return out;
}

// ---------------------------------------------------------------- tests

test('E008: every automatable registry parameter has exactly one row, and every row a parameter',
  () => {
    assert.deepEqual(coverageProblems(NODE_REGISTRY, ROWS), []);
  });

for (const row of DESCRIPTORS) {
  test(`E008 ${rowId(row)}: unit, scale, limits and lane scale`, () => {
    assert.deepEqual(descriptorProblems(NODE_REGISTRY, row), []);
    const def = NODE_REGISTRY.param(row.type, row.key);
    for (const sr of RATES) {
      const scale = automationScale(def, { sampleRate: sr });
      assert.equal(scale.kind, row.display, `${rowId(row)} display scale at ${sr} Hz`);
      if (row.display === 'db') {
        // dB to gain: -12 dB sits where (-12 - floor) / (top - floor) puts it, floor -60 dB.
        const n = (-12 + 60) / (20 * Math.log10(row.max) + 60);
        assert.ok(near(scale.fromNormalized(n), dbToGain(-12)), `${rowId(row)} -12 dB`);
        assert.ok(near(scale.toNormalized(dbToGain(-12)), n), `${rowId(row)} gain of -12 dB`);
      }
      if (row.display === 'log') {
        // The geometric mean of the display range sits at the middle of the lane.
        assert.ok(near(scale.toNormalized(Math.sqrt(scale.min * scale.max)), 0.5),
          `${rowId(row)} geometric midpoint`);
        if (row.unit === 'Hz' && row.max > 100) {
          assert.ok(scale.max <= safeMax(sr), `${rowId(row)} display below 0.95 x Nyquist`);
        }
      }
    }
  });
}

for (const row of ROWS) {
  for (const sr of RATES) {
    test(`E008 ${rowLabel(row)} at ${sr} Hz: the AudioParam takes the row's value at each point`,
      { todo: row.defect || false }, () => {
        assert.deepEqual(transformMismatches(row, sr), []);
      });
  }
}

test('E008: every defect marker still describes a mismatch (remove it with the fix)', () => {
  for (const row of ROWS.filter((r) => r.defect)) {
    for (const sr of RATES) {
      assert.notDeepEqual(transformMismatches(row, sr), [],
        `${rowLabel(row)} at ${sr} Hz now matches its row: remove its defect marker`);
    }
  }
});

test('rate lane on a Random / Step Modulator plays its value in Hz (E008 defect)', () => {
  // Strict whatever the rows' markers say: the playbackRate a rate lane schedules is the lane's
  // value in Hz x 480 / sampleRate, as the static rate and a linear rate edge are.
  for (const type of ['random', 'step-modulator']) {
    const row = { ...ROWS.find((r) => !r.case && r.type === type && r.key === 'rate'),
      defect: undefined };
    assert.equal(row.toAudio, controlPlaybackRate);
    for (const sr of RATES) {
      assert.equal(controlPlaybackRate(8, sr), (8 * 480) / sr);
      assert.deepEqual(transformMismatches(row, sr), [], `${type}.rate at ${sr} Hz`);
    }
  }
});

test('E008: the table covers a detune lane over a clamped static detune at 44.1 and 48 kHz',
  () => {
    const row = ROWS.find((r) => r.type === 'oscillator' && r.key === 'detune' && r.node
      && r.node.detune > ceilingCents(r.node.frequency, 48000));
    assert.ok(row, 'a detune row whose static detune is above its ceiling (V272 R-1)');
    assert.ok(row.limited && !row.defect, 'checked strictly, and bounded at the ceiling (A7)');
    assert.deepEqual(RATES, [44100, 48000]);
  });

// ---------------------------------------------------------------- mutations

test('mutation: a registry parameter without a row fails coverage', () => {
  const without = ROWS.filter((r) => !(r.type === 'pan' && r.key === 'pan'));
  assert.deepEqual(coverageProblems(NODE_REGISTRY, without), ['pan.pan: no row']);
  const defs = NODE_DEFINITIONS.map((d) => (d.type !== 'gain' ? d : { ...d,
    params: [...d.params, numberParam('drive', 'Drive', { min: 0, max: 1, default: 0,
      automatable: true })] }));
  assert.deepEqual(coverageProblems(createNodeRegistry(defs), ROWS), ['gain.drive: no row']);
});

test('mutation: a row naming a parameter the registry lacks fails coverage', () => {
  const extra = [...ROWS, { type: 'oscillator', key: 'phase', unit: '', scale: 'linear' }];
  assert.deepEqual(coverageProblems(NODE_REGISTRY, extra),
    ['oscillator.phase: a row the registry does not mark automatable']);
  const fixed = [...ROWS, { type: 'noise', key: 'color' }];
  assert.deepEqual(coverageProblems(NODE_REGISTRY, fixed),
    ['noise.color: a row the registry does not mark automatable']);
});

test('mutation: a descriptor that differs from the registry fails', () => {
  const row = DESCRIPTORS.find((r) => rowId(r) === 'filter.frequency');
  assert.deepEqual(descriptorProblems(NODE_REGISTRY, { ...row, unit: 'cents', min: 20 }),
    ['filter.frequency unit: registry Hz, row cents', 'filter.frequency min: registry 10, row 20']);
});

test('mutation: an AudioParam value that differs from the row at one point fails', () => {
  const row = ROWS.find((r) => r.case && r.case.startsWith('A7/R-1'));
  for (const sr of RATES) {
    // One cent off at the bounded end only (the clamp at 0.95 x Nyquist).
    const off = { ...row, checks: (s) => row.checks(s).map(([pos, v]) => [pos,
      pos === 2 ? v - 1 : v]) };
    const m = transformMismatches(off, sr);
    assert.equal(m.filter((x) => x.startsWith('2 s: AudioParam')).length, 1, m.join('; '));
    assert.ok(m.every((x) => x.startsWith('2 s:')), m.join('; '));
  }
  const pan = ROWS.find((r) => rowId(r) === 'pan.pan');
  const scaled = { ...pan, toAudio: (v) => v * 1.01 };
  assert.ok(transformMismatches(scaled, 48000).length >= 4, 'a 1 % transform error');
  const b7 = ROWS.find((r) => r.case && r.case.startsWith('B7'));
  const noOffset = { ...b7, checks: () => b7.checks().map(([pos, v]) => [pos, v - 3100]) };
  assert.equal(transformMismatches(noOffset, 48000).length, 3, 'the edge offset left out');
});

test('mutation: a rate lane hold or decision that differs from the row fails (E016)', () => {
  const removed = ROWS.find((r) => r.type === 'random' && r.case === 'rate lane removed while '
    + 'playing');
  const stopped = ROWS.find((r) => r.type === 'step-modulator' && r.case === 'rate lane held '
    + 'by STOP');
  const rebound = ROWS.find((r) => r.type === 'random' && r.case === 'rate lane rebound on a '
    + 'structural edit');
  for (const sr of RATES) {
    for (const row of [removed, stopped]) {
      const off = { ...row, play: row.play.map((s) => ({ ...s, hold: s.hold + 1 })) };
      const m = transformMismatches(off, sr);
      assert.equal(m.length, 1, `${rowLabel(row)}: ${m.join('; ')}`);
      assert.ok(m[0].startsWith('1.5 s: hold ') && m[0].endsWith(`row ${
        controlPlaybackRate(9, sr)}`), m[0]);
    }
    const never = { ...rebound, play: rebound.play.map((s) => ({ ...s, decision: 'locate' })) };
    assert.deepEqual(transformMismatches(never, sr), ['0.5 s: no locate decision for the lane']);
  }
});
