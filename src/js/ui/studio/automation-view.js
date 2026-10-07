// Studio automation lane view helpers (spec §97-§102; plan V420). Pure: plain data in, plain data
// out; no DOM, no Web Audio, no clock. Curves, legality, scales and the editor actions live in
// src/js/studio/automation.js; this module turns them into drawing geometry (an SVG path in the
// lane's own scale — §101: no shared 0-1 chart), words for screen readers and parsed text
// entry, and builds the actions the lane editor dispatches.

import { clipTarget } from '../../studio/clip-targets.js';
import { NODE_REGISTRY } from '../../studio/registry.js';
import {
  automationScale, curveOptions, editPointAction, laneParamDef, laneValueAt, pointProblem,
} from '../../studio/automation.js';
import { TIMELINE_MAX_S } from '../../studio/schema.js';
import { cleanTime } from '../../studio/timeline.js';
import { describeTime, nodeName } from './timeline-view.js';

/** Lane drawing height (px) the editor and the CSS share. */
export const LANE_HEIGHT_PX = 64;
/** Path sampling of curved segments (px between samples). */
export const LANE_SAMPLE_PX = 3;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

const CURVE_LABEL = Object.freeze({ step: 'Step', linear: 'Linear', exponential: 'Exponential' });
const SCALE_LABEL = Object.freeze({ log: 'LOG', db: 'dB', linear: 'LIN', bipolar: 'L–R' });

/** Curve choices of a parameter (§98: exponential only on a strictly positive domain). */
export function curveChoices(paramDef) {
  return curveOptions(paramDef).map((c) => ({ id: c, label: CURVE_LABEL[c] }));
}

/** The lane's parameter definition, scale and names: null when its target is gone. */
export function laneInfo(model, lane, { sampleRate, registry = NODE_REGISTRY } = {}) {
  const def = laneParamDef(model, lane, registry);
  if (!def) return null;
  const scale = automationScale(def, { sampleRate });
  const node = nodeName(model, lane.target.node);
  return { id: lane.id, def, scale, nodeName: node, paramLabel: def.label,
    name: `${node} ${def.label}`, scaleLabel: `${SCALE_LABEL[scale.kind] || scale.kind}`
      + `${scale.unit && scale.kind !== 'db' ? ` ${scale.unit}` : ''}`,
    top: scale.format(scale.max), bottom: scale.format(scale.min) };
}

/** y (px from the top of a lane of `height`) of a value. */
export function valueToY(value, scale, height = LANE_HEIGHT_PX) {
  return round2((1 - scale.toNormalized(value)) * height);
}

/** The value at y px in a lane (top = scale maximum). */
export function yToValue(y, scale, height = LANE_HEIGHT_PX) {
  return scale.fromNormalized(1 - clamp(y / height, 0, 1));
}

/**
 * SVG path (content px) of a lane between `from` and `to` seconds: the held first value before
 * the first point, each segment as the AudioParam renders it (step: hold then jump; linear and
 * exponential: sampled from laneValueAt, so a linear ramp on a log scale is drawn curved, as it
 * sounds), the held last value after the last point. '' without points.
 */
export function lanePath(points, scale, { pxPerSecond, height = LANE_HEIGHT_PX, from = 0,
  to = null, samplePx = LANE_SAMPLE_PX } = {}) {
  if (!points.length || !(pxPerSecond > 0)) return '';
  const end = finite(to) ? to : points[points.length - 1].time;
  const X = (t) => round2(t * pxPerSecond);
  const Y = (v) => valueToY(v, scale, height);
  const parts = [];
  const move = (t, v) => parts.push(`M${X(t)} ${Y(v)}`);
  const line = (t, v) => parts.push(`L${X(t)} ${Y(v)}`);
  const first = points[0];
  move(Math.min(from, first.time), first.value);
  line(first.time, first.value);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.curve === 'step' || b.time - a.time <= 0) {
      line(b.time, a.value);
      line(b.time, b.value);
      continue;
    }
    const n = Math.max(1, Math.ceil((b.time - a.time) * pxPerSecond / samplePx));
    const curved = b.curve === 'exponential' || scale.kind !== 'linear';
    const steps = curved ? n : 1;
    for (let k = 1; k <= steps; k++) {
      const t = a.time + (b.time - a.time) * (k / steps);
      line(t, k === steps ? b.value : laneValueAt([a, b], t));
    }
  }
  const last = points[points.length - 1];
  if (end > last.time) line(end, last.value);
  return parts.join(' ');
}

/** "2.00 kHz", "−6.0 dB", "L 50 %": a value in the lane's own unit. */
export function formatPointValue(value, scale) {
  return scale.format(value);
}

/**
 * The screen-reader label of a point (§143): lane, index, time, value in the lane's unit, curve.
 */
export function pointAria(info, point, index, count, transport, { selected = false } = {}) {
  return `${info.name} point ${index + 1} of ${count}: ${describeTime(point.time, transport)}, `
    + `${info.scale.format(point.value)}, ${index === 0 ? 'start' : (CURVE_LABEL[point.curve]
      || point.curve).toLowerCase()}${selected ? ', selected' : ''}`;
}

/** "Filter 1 Cutoff, logarithmic Hz lane, 3 points" for the lane row. */
export function laneAria(info, lane) {
  const kind = { log: 'logarithmic', db: 'decibel', linear: 'linear', bipolar: 'pan' }[
    info.scale.kind] || info.scale.kind;
  const n = lane.points.length;
  return `${info.name} automation, ${kind} scale, ${n} point${n === 1 ? '' : 's'}`;
}

const NUM = String.raw`([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)`;

/**
 * Parse a value typed in the lane's unit (§100 keyboard numeric entry); null when it is not one.
 *   log / linear  "2000", "2k", "2 kHz", "2000 Hz", "1.5 s", "-3 dB" (unit dB parameters)
 *   db            "-6", "-6 dB" (decibels), "-inf" / "−∞" (silence), "x0.5" (linear amplitude)
 *   bipolar       "C", "L 50", "R 25 %", or a number in −1..1
 */
export function parseValueText(text, scale) {
  const s = String(text ?? '').trim().replace(/−/g, '-');
  if (!s) return null;
  if (scale.kind === 'bipolar') {
    if (/^c(entre|enter)?$/i.test(s)) return 0;
    const lr = new RegExp(`^([lr])\\s*${NUM}\\s*%?$`, 'i').exec(s);
    if (lr) {
      const v = Number(lr[2]) / 100;
      return finite(v) ? (lr[1].toLowerCase() === 'l' ? -Math.abs(v) : Math.abs(v)) : null;
    }
    const n = new RegExp(`^${NUM}$`).exec(s);
    return n && finite(Number(n[1])) ? Number(n[1]) : null;
  }
  if (scale.kind === 'db') {
    if (/^-?(inf|infinity|∞)(\s*db)?$/i.test(s)) return 0;
    const x = new RegExp(`^[x×]\\s*${NUM}$`, 'i').exec(s);
    if (x) return finite(Number(x[1])) ? Number(x[1]) : null;
    const d = new RegExp(`^${NUM}\\s*(db)?$`, 'i').exec(s);
    if (!d || !finite(Number(d[1]))) return null;
    return Math.pow(10, Number(d[1]) / 20);
  }
  const m = new RegExp(`^${NUM}\\s*(k|m)?\\s*([a-z%]*)$`, 'i').exec(s);
  if (!m || !finite(Number(m[1]))) return null;
  const unit = m[3] || '';
  const prefix = m[2] ? m[2] : '';
  // "m" alone after a number is a unit only for "ms"; "k" is kilo.
  let k = 1;
  if (/^k$/i.test(prefix)) k = 1000;
  else if (prefix === 'm' && /^s$/i.test(unit)) k = 0.001;
  else if (prefix) return null;
  if (unit && scale.unit && unit.toLowerCase() !== scale.unit.toLowerCase()
    && !(unit.toLowerCase() === 's' && scale.unit === 's')) return null;
  return Number(m[1]) * k;
}

/**
 * The AUTOMATION_POINT_ADD of adding a point to a lane at `time` (double-click, tap, or the
 * keyboard's "add at playhead"): value = the lane's own value there (or `value`), curve linear
 * — or step when a linear ramp would not be legal (never exponential by default). Returns
 * { ok, action } or { ok: false, reason }.
 */
export function addPointAction(model, laneId, time, { value = null, registry = NODE_REGISTRY,
  sampleRate } = {}) {
  const lane = model.timeline.automation.find((l) => l.id === laneId);
  if (!lane) return { ok: false, reason: 'There is no such automation lane.' };
  const def = laneParamDef(model, lane, registry);
  if (!def) return { ok: false, reason: 'The automated parameter no longer exists.' };
  const t = cleanTime(clamp(finite(time) ? time : 0, 0, TIMELINE_MAX_S));
  let v = finite(value) ? value : laneValueAt(lane.points, t);
  const scale = automationScale(def, { sampleRate });
  if (!finite(v)) v = scale.min;
  v = clamp(v, def.min ?? -Infinity, def.max ?? Infinity);
  const prev = [...lane.points].filter((p) => p.time <= t).pop() || null;
  const point = { time: t, value: v, curve: 'linear' };
  const why = pointProblem(def, prev, point);
  if (why) return { ok: false, reason: why };
  return { ok: true, action: { type: 'AUTOMATION_POINT_ADD', target: { ...lane.target }, time: t,
    value: v, curve: 'linear' } };
}

/**
 * A point drag / field edit as editPointAction (value clamped, illegal exponential refused);
 * convenience re-export with the lane's sample rate.
 */
export function pointEdit(model, laneId, pointId, patch, opts = {}) {
  return editPointAction(model, laneId, pointId, patch, opts);
}

/**
 * A fine keyboard nudge (Shift, §100): a thousandth of the lane scale for the value, 1 ms for
 * the time. The coarse steps are automation.js nudgePointAction.
 */
export function fineNudge(model, laneId, pointId, { dValue = 0, dTime = 0, sampleRate,
  registry = NODE_REGISTRY } = {}) {
  const lane = model.timeline.automation.find((l) => l.id === laneId);
  const pt = lane && lane.points.find((p) => p.id === pointId);
  if (!pt) return { ok: false, reason: 'There is no such automation point.' };
  const def = laneParamDef(model, lane, registry);
  let value = pt.value;
  if (dValue && def) {
    const scale = automationScale(def, { sampleRate });
    value = scale.fromNormalized(scale.toNormalized(pt.value) + Math.sign(dValue) * 0.001);
  }
  const time = pt.time + Math.sign(dTime) * 0.001;
  return editPointAction(model, laneId, pointId, { time, value }, { sampleRate, registry });
}

/**
 * Parameters a lane plays on, per node, for the "Automate" form: [{ id, name, params: [...] }]
 * (clip-targets.js, R7: a parameter the store would hold but the transport not play is left out).
 */
export function automatableTargets(model, registry = NODE_REGISTRY) {
  const out = [];
  for (const n of model.graph.nodes) {
    const def = registry.get(n.type);
    const params = def ? def.params
      .filter((p) => clipTarget(n, { kind: 'automation', param: p.key }, registry).plays)
      .map((p) => ({ key: p.key, label: p.label,
        laned: model.timeline.automation.some((l) => l.target.node === n.id
          && l.target.param === p.key) })) : [];
    if (params.length) out.push({ id: n.id, name: n.metadata.name, params });
  }
  return out;
}

/** The point id order of a lane (sorted by time): for focus after a delete. */
export function pointNeighbour(lane, pointId) {
  const i = lane.points.findIndex((p) => p.id === pointId);
  if (i < 0) return null;
  const next = lane.points[i + 1] || lane.points[i - 1] || null;
  return next ? next.id : null;
}
