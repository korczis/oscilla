// A lane's destination and its events as the destination takes them, split from transport.js
// (its 92,000 B source-size cap; no behaviour change). laneDest resolves the AudioParam an
// automation lane on target.node/target.param drives, with the edges' constant offset, the
// parameter's bounds (a detune's below the cents that keep its frequency at 0.95 x Nyquist,
// V272 A7), its mode ('source' where exponential ramps are legal, else 'shift') and its scale;
// a pattern-played oscillator's level is its bus, a low- or high-pass Q is q-lane.js's. It
// returns { code, reason } when the lane cannot play there. fit, clampsAny and fitted turn lane
// events into what that destination takes. transport.js paramFor wraps laneDest (recording the
// reason as unplayed), and its lane records use fit and fitted.
import {
  detuneCeiling, isExponentialLegal, mapEvents, paramBounds,
} from './automation.js';
import { clipTarget } from './clip-targets.js';
import { qLaneDest } from './q-lane.js';
import { LINEAR, clamp } from './transport-ramps.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The destination of a lane on `target` (node `n`, its ready handle `h`):
 * { param, handle, offset, bounds, mode, scale }, or { code, reason } when it cannot play.
 * opts: { model, registry, runtime, ctx, claim (the node's pattern claim, if any),
 * noParameter(name, param) (the reason text for a node with no such AudioParam) }.
 */
export function laneDest(n, h, target, { model, registry, runtime, ctx, claim, noParameter }) {
  const v = clipTarget(n, { kind: 'automation', param: target.param }, registry);
  if (!v.plays) return { code: 'no-parameter', reason: v.reason };
  const def = registry.param(n.type, target.param);
  const offsetOf = (key) => (typeof runtime.baseOffset === 'function'
    ? runtime.baseOffset(target.node, key) : 0);
  const offset = offsetOf(target.param);
  const sr = ctx.sampleRate;
  let bounds = def ? paramBounds(def, sr) : null;
  const fDef = registry.param(n.type, 'frequency');
  if (bounds && def.unit === 'cents' && fDef && fDef.unit === 'Hz') {
    // A detune shifts the node's frequency: lane + offset stays below the cents that keep the
    // frequency's base (or its lane's peak, offsets included) at 0.95 × Nyquist (V272 A7).
    const fLane = model.timeline.automation.find((l) => l.target.node === target.node
      && l.target.param === 'frequency');
    const peak = fLane ? Math.max(...fLane.points.map((p) => p.value)) : -Infinity;
    const ref = Math.min(paramBounds(fDef, sr).max, Math.max(n.params.frequency, peak)
      + offsetOf('frequency'));
    const max = Math.min(bounds.max, detuneCeiling(ref, sr));
    bounds = { min: Math.min(bounds.min, max), max };
  }
  const c = claim;
  if (c && c.handle === h && target.param === 'level') {
    // A pattern-played oscillator: its level is the pattern bus (the voices).
    return { param: c.bus.gain, handle: h, offset, bounds, mode: 'shift', scale: 1 };
  }
  // A low- or high-pass Q (K232): q-lane.js, on the biquad's dB Q.
  const qDest = qLaneDest(def, n.params, h, target.param, { sampleRate: sr,
    centsOf: () => (typeof runtime.baseCents === 'function'
      ? runtime.baseCents(target.node, target.param) : 0) });
  if (qDest) return qDest;
  let t = null;
  try { t = h.modTarget(target.param, 'linear'); } catch (e) { t = null; }
  if (!t || !t.param) {
    return { code: 'no-parameter', reason: (t && t.reason)
      || noParameter(n.metadata.name, target.param) };
  }
  const mode = isExponentialLegal(def) && h.acct
    && typeof ctx.createConstantSource === 'function' ? 'source' : 'shift';
  // The AudioParam's unit per the parameter's (modTarget scale: a Random / Step Modulator's
  // rate in Hz drives playbackRate at 480 / sampleRate), as the static value and edges use it.
  const scale = finite(t.scale) ? t.scale : 1;
  return { param: t.param, handle: h, offset, bounds, mode, scale };
}

/**
 * Lane events as the param gets them. The modulation edges' constant offset (runtime.baseOffset)
 * is part of the base (§103, automation.js combination rule). Mode 'shift' adds it to every
 * value: exact on a parameter whose lanes are step and linear only (an affine map keeps those
 * segments). Mode 'source', a strictly positive domain where exponential ramps are legal,
 * keeps the authored values and sums the offset in through the param's offset source
 * (moveOffset), because a geometric ramp between shifted ends is not the shifted ramp. Either
 * way lane + offset stays inside the parameter's bounds (a detune's: below the cents that
 * keep its frequency at 0.95 × Nyquist). `offset`: the one to fit with.
 */
export function fit(events, dest, offset = dest.offset) {
  const evs = mapEvents(events, dest.map);
  if (!offset && !dest.bounds) return evs;
  return evs.map((e) => {
    const total = e.value + offset;
    const c = dest.bounds ? clamp(total, dest.bounds.min, dest.bounds.max) : total;
    let v = c;
    if (dest.mode === 'source') v = c === total ? e.value : c - offset;
    if (e.method === 'exponentialRampToValueAtTime' && !(v > 0)) {
      return { ...e, method: LINEAR, value: v };
    }
    return v === e.value ? e : { ...e, value: v };
  });
}

/** True when `dest`'s bounds clamp any of the lane's events (debugInfo limitedLanes). */
const clampsAny = (events, dest) => !!dest.bounds && mapEvents(events, dest.map).some((e) => {
  const total = e.value + dest.offset;
  return total > dest.bounds.max || total < dest.bounds.min;
});
/** What a lane's events were fitted with: its offset, mode and bounds (reoffsetLanes). */
export const fitted = (rec, dest) => {
  rec.offset = dest.offset;
  rec.mode = dest.mode;
  rec.max = dest.bounds ? dest.bounds.max : null;
  rec.limited = clampsAny(rec.raw, dest);
};
