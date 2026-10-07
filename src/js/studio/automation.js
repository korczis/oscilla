// Studio automation (spec §97-§104; plan V419-V420). Pure: plain data in, plain data out; no
// DOM, no Web Audio objects, no clock. applyAutomation() is the one thin applier: it takes an
// AudioParam-like object (anything with setValueAtTime / linearRampToValueAtTime /
// exponentialRampToValueAtTime / cancelScheduledValues) and is tested with a fake.
//
// Lane (schema.js): { id, target: { node, param }, points: [{ id, time, value, curve }] }, points
// sorted by time. A point's curve says how the value ARRIVES at that point from the previous one,
// which is Web Audio's own convention (a ramp ends at its event time):
//   step         setValueAtTime(value, t)                 jump at t, hold before
//   linear       linearRampToValueAtTime(value, t)        straight line from the previous point
//   exponential  exponentialRampToValueAtTime(value, t)   geometric curve; legal only when the
//                parameter's domain is strictly positive (definition min > 0: frequency, Q,
//                LFO rate) and both end values are > 0 — never to or from zero (§98)
// The first point's curve has no previous point and compiles to setValueAtTime. Before the first
// point the lane holds the first value, after the last point the last value.
//
// Compilation (§99) maps lane positions (timeline seconds) to absolute AudioContext times through
// a `toAudio(position)` function the timeline compiler supplies (pass offsets, frame
// quantisation); the audio clock is the only time authority. A compiled segment starts with an
// anchor setValueAtTime(valueAt(posStart)) and, when cut by a loop end, finishes with a ramp to
// the exact interpolated value at the cut, so a loop pass reproduces the authored curve exactly
// (a sub-segment of a linear or geometric ramp is the same ramp). Values are clamped to the
// parameter range and frequencies to 0.95 × Nyquist of the running context.
//
// Automation vs modulation (§103-§104): automation authors the BASE value over time; modulation
// is continuous control from another node, owned by the modulation edge (depth, polarity,
// mapping, offset) and never simulated by rewriting automation. The combination rule is
//   actual = clamp((base + Σ linear contributions) × 2^(Σ log contributions in octaves))
// with contribution = offset + depth × m', m' = m for bipolar and (m + 1) / 2 for unipolar edges
// (m ∈ [-1, 1] the modulator signal), muted edges contributing nothing, and the clamp being the
// parameter range (frequencies: also 0.95 × Nyquist). combineAutomationAndModulation() is that
// rule as a pure function; the graph runtime realises it with AudioParam summing (base value
// automated on the param, modulator → depth gain → the same param).

import { automationValueAt } from '../sequencer/compiler.js';
import { safeMaximum } from '../sequencer/model.js';
import { AUTOMATION_CURVES, TIMELINE_MAX_S } from './schema.js';
import { clipTarget } from './clip-targets.js';
import { NODE_REGISTRY } from './registry.js';

// ---------------------------------------------------------------- constants

/** AudioParam method per point curve. */
export const AUTOMATION_METHODS = Object.freeze({
  step: 'setValueAtTime',
  linear: 'linearRampToValueAtTime',
  exponential: 'exponentialRampToValueAtTime',
});
const METHOD_TO_RAMP = Object.freeze({ setValueAtTime: 'set', linearRampToValueAtTime: 'linear',
  exponentialRampToValueAtTime: 'exponential' });
/** Floor of the amplitude (dB) display scale; 0 sits at the bottom of the lane. */
export const DB_SCALE_FLOOR = -60;
const AMPLITUDE_KEY = /^(gain|level(\d+|[AB])?)$/;

/** An automation lane that cannot compile (an illegal exponential ramp, an unknown target). */
export class AutomationError extends RangeError {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'AutomationError';
    Object.assign(this, detail);
  }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- parameter domain

/** True when exponential ramps are legal for a parameter: its domain is strictly positive. */
export function isExponentialLegal(paramDef) {
  return !!paramDef && finite(paramDef.min) && paramDef.min > 0;
}

/** Curves a parameter's points may use (§98). */
export function curveOptions(paramDef) {
  return AUTOMATION_CURVES.filter((c) => c !== 'exponential' || isExponentialLegal(paramDef));
}

/**
 * Value bounds of a parameter on a running context: its definition range, frequencies (unit Hz)
 * also capped at 0.95 × Nyquist of `sampleRate` (sequencer safeMaximum; 44.1 kHz before a
 * context exists).
 */
export function paramBounds(paramDef, sampleRate) {
  let min = finite(paramDef.min) ? paramDef.min : -Number.MAX_VALUE;
  let max = finite(paramDef.max) ? paramDef.max : Number.MAX_VALUE;
  if (paramDef.unit === 'Hz') max = Math.min(max, safeMaximum(sampleRate));
  if (max < min) max = min;
  return { min, max };
}

/**
 * Why a point cannot follow `prev` on a parameter (null when it can): exponential needs a
 * strictly positive domain and positive values at both ends (§98).
 */
export function pointProblem(paramDef, prev, point) {
  if (!point || !finite(point.time) || point.time < 0) return 'Time must be 0 s or later.';
  if (!finite(point.value)) return 'Value must be a finite number.';
  if (!AUTOMATION_CURVES.includes(point.curve)) {
    return `Curve must be one of ${AUTOMATION_CURVES.join(', ')}.`;
  }
  if (point.curve === 'exponential') {
    if (!isExponentialLegal(paramDef)) {
      return `${paramDef ? paramDef.label : 'This parameter'} can reach zero or below, so it `
        + 'cannot use an exponential ramp; use a linear ramp.';
    }
    if (!(point.value > 0) || (prev && !(prev.value > 0))) {
      return 'An exponential ramp needs positive values at both ends (never to or from zero).';
    }
  }
  if (prev && point.time < prev.time) return 'Automation points must be sorted by time.';
  return null;
}

/** Every problem of a lane's points: [{ index, pointId, message }]. */
export function validateLanePoints(points, paramDef) {
  const out = [];
  points.forEach((p, i) => {
    const why = pointProblem(paramDef, i ? points[i - 1] : null, p);
    if (why) out.push({ index: i, pointId: p.id, message: why });
  });
  return out;
}

// ---------------------------------------------------------------- value of a lane

/**
 * Authored value of a lane at timeline time t (null without points): holds the first value
 * before the first point and the last after the last; between points the later point's curve
 * decides (step holds, linear interpolates, exponential interpolates geometrically). Several
 * points at one time: the last one applies from that time on.
 */
export function laneValueAt(points, t) {
  if (!points.length) return null;
  if (t < points[0].time) return points[0].value;
  let i = 0;
  while (i + 1 < points.length && points[i + 1].time <= t) i++;
  const a = points[i];
  const b = points[i + 1];
  if (!b) return a.value;
  const k = (t - a.time) / (b.time - a.time);
  if (b.curve === 'linear') return a.value + (b.value - a.value) * k;
  if (b.curve === 'exponential' && a.value > 0 && b.value > 0) {
    return a.value * Math.pow(b.value / a.value, k);
  }
  return a.value;
}

// ---------------------------------------------------------------- compiler (§99)

/**
 * Compile a lane segment to AudioParam events at absolute audio times.
 *   compileLaneEvents(points, { paramDef, sampleRate, posStart = 0, posEnd = Infinity,
 *     toAudio = (pos) => pos, baseTime })
 * `toAudio(position)` maps a timeline position to an AudioContext time (baseTime + position
 * when only `baseTime` is given). Returns [{ method, value, time, position, pointId,
 * boundary? }] in scheduling order: the anchor setValueAtTime at posStart, every point strictly
 * inside (posStart, posEnd), and — when a ramp crosses posEnd — a boundary ramp to the exact
 * value at posEnd. Throws AutomationError for an illegal exponential ramp.
 */
export function compileLaneEvents(points, opts = {}) {
  const { paramDef = null, sampleRate } = opts;
  const posStart = finite(opts.posStart) ? opts.posStart : 0;
  const posEnd = finite(opts.posEnd) ? opts.posEnd : Infinity;
  const base = finite(opts.baseTime) ? opts.baseTime : 0;
  const toAudio = typeof opts.toAudio === 'function' ? opts.toAudio : (pos) => base + pos;
  if (!points.length || !(posEnd > posStart)) return [];
  const problems = validateLanePoints(points, paramDef);
  if (problems.length) {
    throw new AutomationError(problems[0].message, { pointId: problems[0].pointId });
  }
  const bounds = paramDef ? paramBounds(paramDef, sampleRate) : null;
  const fit = (v) => (bounds ? clamp(v, bounds.min, bounds.max) : v);
  const events = [];
  let anchorPoint = null;
  for (const p of points) if (p.time <= posStart) anchorPoint = p;
  events.push({ method: 'setValueAtTime', value: fit(laneValueAt(points, posStart)),
    time: toAudio(posStart), position: posStart,
    pointId: anchorPoint && anchorPoint.time === posStart ? anchorPoint.id : null });
  let prev = null;
  for (const p of points) {
    if (p.time <= posStart) {
      prev = p;
      continue;
    }
    if (p.time >= posEnd) {
      if (prev && p.curve !== 'step') {
        events.push({ method: AUTOMATION_METHODS[p.curve], value: fit(laneValueAt(points,
          posEnd)), time: toAudio(posEnd), position: posEnd, pointId: null, boundary: true });
      }
      break;
    }
    events.push({ method: AUTOMATION_METHODS[p.curve], value: fit(p.value), time: toAudio(p.time),
      position: p.time, pointId: p.id });
    prev = p;
  }
  return events;
}

/**
 * Compile every lane of a model from timeline position 0 onto an audio clock base time (no loop;
 * the timeline compiler handles passes): [{ laneId, target: { node, param }, events }].
 */
export function compileAutomation(model, { baseTime = 0, sampleRate, registry = NODE_REGISTRY }
  = {}) {
  return model.timeline.automation.map((lane) => ({
    laneId: lane.id,
    target: { ...lane.target },
    events: compileLaneEvents(lane.points, { paramDef: laneParamDef(model, lane, registry),
      sampleRate, baseTime }),
  }));
}

/** The parameter definition a lane automates (null when the node or parameter is unknown). */
export function laneParamDef(model, lane, registry = NODE_REGISTRY) {
  const node = model.graph.nodes.find((n) => n.id === lane.target.node);
  return node ? registry.param(node.type, lane.target.param) || null : null;
}

/** Events in the sequencer's { t, value, ramp } form (for automationValueAt). */
export function toRampEvents(events) {
  return events.map((e) => ({ t: e.time, value: e.value, ramp: METHOD_TO_RAMP[e.method] }));
}

/** Value of a compiled event list at audio time t (Web Audio semantics), or `defaultValue`. */
export function scheduledValueAt(events, t, defaultValue = null) {
  return automationValueAt(toRampEvents(events), t, defaultValue);
}

// ---------------------------------------------------------------- thin applier

/**
 * Apply compiled events to an AudioParam-like object, in order. opts: { cancelFrom } first
 * cancels everything scheduled at or after that time (cancelScheduledValues). Exponential
 * events with a non-positive value are refused (never reach the param). Returns the number of
 * calls made.
 */
export function applyAutomation(paramLike, events, opts = {}) {
  if (!paramLike) throw new TypeError('applyAutomation: an AudioParam-like target is required');
  let calls = 0;
  if (finite(opts.cancelFrom)) {
    paramLike.cancelScheduledValues(opts.cancelFrom);
    calls++;
  }
  for (const e of events) {
    if (!METHOD_TO_RAMP[e.method]) throw new AutomationError(`Unknown method ${String(e.method)}`);
    if (!finite(e.value) || !finite(e.time) || e.time < 0) {
      throw new AutomationError(`Invalid automation event ${e.value} at ${e.time}`);
    }
    if (e.method === 'exponentialRampToValueAtTime' && !(e.value > 0)) {
      throw new AutomationError('An exponential ramp never goes to or from zero.');
    }
    paramLike[e.method](e.value, e.time);
    calls++;
  }
  return calls;
}

/**
 * Hold a param at time `at` (STOP, §184; rebuild from a horizon, §183): with
 * cancelAndHoldAtTime the browser holds natively; otherwise the exact value at `at` is computed
 * from the scheduled events, the schedule is cancelled from `at` and the value pinned with
 * setValueAtTime, so no ramp snaps back. Returns the held value.
 */
export function holdAutomation(paramLike, scheduled, at, defaultValue = null) {
  const v = scheduledValueAt(scheduled, at, defaultValue);
  if (typeof paramLike.cancelAndHoldAtTime === 'function') {
    paramLike.cancelAndHoldAtTime(at);
    return v;
  }
  let next = null;
  for (const e of scheduled) if (e.time >= at && (!next || e.time < next.time)) next = e;
  paramLike.cancelScheduledValues(at);
  if (v !== null) {
    if (next && next.method === 'linearRampToValueAtTime') {
      paramLike.linearRampToValueAtTime(v, at);
    } else if (next && next.method === 'exponentialRampToValueAtTime' && v > 0) {
      paramLike.exponentialRampToValueAtTime(v, at);
    }
    paramLike.setValueAtTime(v, at);
  }
  return v;
}

// ---------------------------------------------------------------- automation vs modulation (§103)

function shaped(signal, polarity) {
  const m = clamp(finite(signal) ? signal : 0, -1, 1);
  return polarity === 'unipolar' ? (m + 1) / 2 : m;
}

/**
 * actual = clamp((base + Σ linear) × 2^(Σ log octaves)) — see the header.
 *   combineAutomationAndModulation({ base, modulations: [{ signal, props }], paramDef,
 *     sampleRate }) -> { value, unclamped, clamped }
 * props are the modulation edge's { muted, depth, polarity, mapping, offset } (ports.js).
 */
export function combineAutomationAndModulation({ base, modulations = [], paramDef = null,
  sampleRate } = {}) {
  let linear = 0;
  let octaves = 0;
  for (const m of modulations) {
    const p = (m && m.props) || {};
    if (p.muted) continue;
    const c = (finite(p.offset) ? p.offset : 0)
      + (finite(p.depth) ? p.depth : 0) * shaped(m.signal, p.polarity);
    if (p.mapping === 'log') octaves += c;
    else linear += c;
  }
  const unclamped = (base + linear) * Math.pow(2, octaves);
  if (!paramDef) return { value: unclamped, unclamped, clamped: false };
  const b = paramBounds(paramDef, sampleRate);
  const value = clamp(unclamped, b.min, b.max);
  return { value, unclamped, clamped: value !== unclamped };
}

/** The [lowest, highest] actual value the modulations can reach around `base` (signal ±1). */
export function modulationRange({ base, modulations = [], paramDef = null, sampleRate } = {}) {
  const corners = [[]];
  for (const m of modulations) {
    const next = [];
    for (const c of corners) for (const s of [-1, 1]) next.push([...c, { ...m, signal: s }]);
    corners.splice(0, corners.length, ...next.slice(0, 1024));
  }
  const values = corners.map((mods) => combineAutomationAndModulation({ base, modulations: mods,
    paramDef, sampleRate }).value);
  return [Math.min(...values), Math.max(...values)];
}

// ---------------------------------------------------------------- editor scales (§101)

const siFormat = (v) => {
  const a = Math.abs(v);
  if (a >= 1000) return `${Number((v / 1000).toPrecision(3))} kHz`;
  return `${Number(v.toPrecision(3))} Hz`;
};

function logTicks(lo, hi) {
  const out = [];
  for (let d = Math.pow(10, Math.floor(Math.log10(lo))); d <= hi; d *= 10) {
    for (const m of [1, 2, 5]) {
      const v = Number((d * m).toPrecision(6));
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/**
 * The value scale of a lane (§101): { kind, unit, min, max, toNormalized(v) -> 0..1,
 * fromNormalized(n) -> value, format(v), ticks() -> [{ value, label }] }.
 *   log      frequency (Hz) and other logarithmic parameters (Q, LFO rate): display range is the
 *            definition's softRange (else its range), frequencies capped at 0.95 × Nyquist
 *   db       linear amplitude (gain, level): shown in dB, DB_SCALE_FLOOR at the bottom, 0 = −∞
 *   linear   dB-valued parameters (filter gain, unit dB) and everything else
 *   bipolar  pan −1..1, centre in the middle
 * No shared 0-1 chart: each kind keeps the parameter's own unit.
 */
export function automationScale(paramDef, { sampleRate } = {}) {
  const b = paramBounds(paramDef, sampleRate);
  const soft = paramDef.softRange;
  const unit = paramDef.unit || '';
  if (paramDef.scale === 'log' && b.min > 0) {
    const lo = Math.max(b.min, soft ? soft[0] : b.min);
    const hi = Math.min(b.max, soft ? soft[1] : b.max);
    const ln = Math.log(hi / lo);
    const fmt = unit === 'Hz' ? siFormat : (v) => `${Number(v.toPrecision(3))}${unit ? ` ${unit}`
      : ''}`;
    return { kind: 'log', unit, min: lo, max: hi,
      toNormalized: (v) => (v > 0 ? clamp(Math.log(v / lo) / ln, 0, 1) : 0),
      fromNormalized: (n) => lo * Math.exp(clamp(n, 0, 1) * ln),
      format: fmt,
      ticks: () => logTicks(lo, hi).map((v) => ({ value: v, label: fmt(v) })) };
  }
  if (unit === '' && b.min === 0 && AMPLITUDE_KEY.test(paramDef.key)) {
    const top = 20 * Math.log10(b.max);
    const span = top - DB_SCALE_FLOOR;
    const fmt = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '−∞ dB');
    return { kind: 'db', unit: 'dB', min: 0, max: b.max,
      toNormalized: (v) => (v > 0 ? clamp((20 * Math.log10(v) - DB_SCALE_FLOOR) / span, 0, 1) : 0),
      fromNormalized: (n) => (n <= 0 ? 0 : Math.min(b.max,
        Math.pow(10, (DB_SCALE_FLOOR + clamp(n, 0, 1) * span) / 20))),
      format: fmt,
      ticks: () => {
        const out = [{ value: 0, label: '−∞ dB' }];
        for (let db = DB_SCALE_FLOOR + 12; db <= top + 1e-9; db += 12) {
          out.push({ value: Math.pow(10, db / 20), label: `${db} dB` });
        }
        return out;
      } };
  }
  const lo = soft ? Math.max(b.min, soft[0]) : b.min;
  const hi = soft ? Math.min(b.max, soft[1]) : b.max;
  const linear = (kind, fmt) => ({ kind, unit, min: lo, max: hi,
    toNormalized: (v) => (hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0),
    fromNormalized: (n) => lo + clamp(n, 0, 1) * (hi - lo),
    format: fmt,
    ticks: () => [0, 0.25, 0.5, 0.75, 1].map((n) => {
      const v = lo + n * (hi - lo);
      return { value: v, label: fmt(v) };
    }) });
  if (paramDef.key === 'pan' || /^pan[AB]$/.test(paramDef.key)) {
    return linear('bipolar', (v) => (Math.abs(v) < 0.005 ? 'C'
      : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)} %`));
  }
  if (unit === 'dB') {
    return linear('linear', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);
  }
  return linear('linear', (v) => `${Number(v.toPrecision(3))}${unit ? ` ${unit}` : ''}`);
}

// ---------------------------------------------------------------- editor actions (§100, §102)

/**
 * A lane point from lane coordinates: x, y in px inside a lane of `height` px whose time axis is
 * pxPerSecond with scrollX px scrolled; y = 0 is the top (maximum). Returns { time, value }.
 */
export function pointAtLaneCoordinates({ x, y, height, pxPerSecond, scrollX = 0 }, scale) {
  const time = clamp((x + scrollX) / pxPerSecond, 0, TIMELINE_MAX_S);
  const value = scale.fromNormalized(1 - clamp(y / height, 0, 1));
  return { time, value };
}

/** Default curve of a new point: linear (exponential is never the default). */
export function defaultCurve() {
  return 'linear';
}

/**
 * The action that AUTOMATE in the Inspector (§102) triggers: reveal the existing lane, or create
 * it with one point holding the parameter's current value at `time`. Returns { reveal: laneId }
 * or { action } or { reason } when no lane on the parameter would play (clip-targets.js).
 */
export function automateParameter(model, nodeId, param, time = 0, registry = NODE_REGISTRY) {
  const node = model.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return { reason: `There is no node "${String(nodeId)}".` };
  const lane = model.timeline.automation.find((l) => l.target.node === nodeId
    && l.target.param === param);
  if (lane) return { reveal: lane.id };
  // A new lane only where the transport plays it (clip-targets.js, R7).
  const v = clipTarget(node, { kind: 'automation', param }, registry);
  if (!v.plays) return { reason: v.reason };
  return { action: { type: 'AUTOMATION_POINT_ADD', target: { node: nodeId, param }, time,
    value: node.params[param], curve: 'linear' } };
}

/**
 * Point edit (drag / keyboard, §100): AUTOMATION_POINT_MOVE with the value clamped to the
 * parameter range and the time to the timeline. A curve change to an illegal exponential is
 * refused with a reason (the store would reject it too).
 */
export function editPointAction(model, laneId, pointId, patch, { sampleRate,
  registry = NODE_REGISTRY } = {}) {
  const lane = model.timeline.automation.find((l) => l.id === laneId);
  if (!lane) return { ok: false, reason: `There is no automation lane "${String(laneId)}".` };
  const i = lane.points.findIndex((p) => p.id === pointId);
  if (i < 0) return { ok: false, reason: `There is no automation point "${String(pointId)}".` };
  const def = laneParamDef(model, lane, registry);
  const pt = lane.points[i];
  const next = { ...pt };
  if (finite(patch.time)) next.time = clamp(patch.time, 0, TIMELINE_MAX_S);
  if (finite(patch.value)) {
    const b = def ? paramBounds(def, sampleRate) : { min: -Infinity, max: Infinity };
    next.value = clamp(patch.value, b.min, b.max);
  }
  if (patch.curve !== undefined) next.curve = patch.curve;
  const others = lane.points.filter((p) => p !== pt);
  const sorted = [...others, next].sort((a, b) => a.time - b.time);
  const problems = validateLanePoints(sorted, def);
  if (problems.length) return { ok: false, reason: problems[0].message };
  const action = { type: 'AUTOMATION_POINT_MOVE', laneId, pointId };
  if (next.time !== pt.time) action.time = next.time;
  if (next.value !== pt.value) action.value = next.value;
  if (next.curve !== pt.curve) action.curve = next.curve;
  return { ok: true, action: Object.keys(action).length > 3 ? action : null };
}

/**
 * Keyboard alternative to dragging a point (§100): one step = 1/100 of the lane scale's height
 * for the value (×10 with `large`), `timeStepS` (default 0.01 s) for the time.
 */
export function nudgePointAction(model, laneId, pointId, { dValue = 0, dTime = 0, large = false,
  timeStepS = 0.01, sampleRate, registry = NODE_REGISTRY } = {}) {
  const lane = model.timeline.automation.find((l) => l.id === laneId);
  const pt = lane && lane.points.find((p) => p.id === pointId);
  if (!pt) return { ok: false, reason: 'There is no such automation point.' };
  const def = laneParamDef(model, lane, registry);
  const k = large ? 10 : 1;
  let value = pt.value;
  if (dValue && def) {
    const scale = automationScale(def, { sampleRate });
    value = scale.fromNormalized(scale.toNormalized(pt.value) + Math.sign(dValue) * 0.01 * k);
  }
  const time = pt.time + Math.sign(dTime) * timeStepS * k;
  return editPointAction(model, laneId, pointId, { time, value }, { sampleRate, registry });
}
