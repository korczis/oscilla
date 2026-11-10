// The Studio transport's ramp maths (pure), split from transport.js (the source-size budget,
// K222 on the T4 base; no behaviour change): a transport segment's value and the ramp a hold
// cuts, the fade gain of a pattern voice continued on a rebuilt node and where it continues
// (continueAt, H008). transport.js imports them and re-exports fadeCurve and FADE_KNOTS, where
// its callers and tests have read them.

import { SCHEDULE_LEAD_S } from '../audio/scheduler.js';
import { STUDIO_XFADE_S } from './compiler.js';

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A linear segment { t0, v0, t1, v1 } at time t: v0 before t0, v1 from t1. */
export const segValue = (g, t) => (t >= g.t1 || !(g.t1 > g.t0) ? g.v1
  : g.v0 + (g.v1 - g.v0) * clamp((t - g.t0) / (g.t1 - g.t0), 0, 1));
export const LINEAR = 'linearRampToValueAtTime';
/**
 * The ramp a hold at t cuts on a param whose last transport segment is `g`: the segment itself
 * while it runs (or ends at t), or the ramp re-ended at t when `g` starts there from a hold.
 */
export const segRamp = (g, t) => (g.t0 < t && t <= g.t1 ? LINEAR : (g.t0 === t && g.reEnd) || null);
/** The ramp a hold at t cuts on compiled automation `events` (timeline-compiler holdEvents). */
export function rampAcross(events, t) {
  let next = null;
  for (const e of events) if (e.time >= t && (!next || e.time < next.time)) next = e;
  return next && next.method !== 'setValueAtTime' ? next.method : null;
}

/** Segments of a continued voice's fade gain (fadeCurve). */
export const FADE_KNOTS = 8;

/**
 * The fade gain of a pattern voice continued on a rebuilt node from `t0` (H001,
 * continueVoice), as [[time, gain], ...] from t0 to t0 + xfadeS, linear between the knots. The
 * voice should rise as E = (tau - t0) / xfadeS. The new node's routes already ramp 0 -> 1 over
 * [rampAt, rampAt + xfadeS] (the runtime's crossfade, equal-gain against the old routes), so the
 * gain is E / route: 1 when t0 is the crossfade time (the routes alone fade the voice in, and a
 * second ramp on top would dip the crossfade to E^2), 0 at a later t0 the routes are already
 * open by. With no route ramp (rampAt null) it is E.
 */
export function fadeCurve(t0, rampAt, xfadeS = STUDIO_XFADE_S) {
  const route = (tau) => (rampAt === null ? 1 : clamp((tau - rampAt) / xfadeS, 0, 1));
  const out = [];
  for (let i = 0; i <= FADE_KNOTS; i += 1) {
    const tau = t0 + (i * xfadeS) / FADE_KNOTS;
    const r = route(tau);
    out.push([tau, r <= 1e-6 ? 1 : Math.min(1, i / FADE_KNOTS / r)]);
  }
  return out;
}

/**
 * Where a sounding voice continues on a node the runtime rebuilt (H008, transport applyEdit):
 * at the runtime's crossfade time `rampAt`, where its old routes start to fade, while that is at
 * least a render quantum `q` past the time the audio has rendered. No time read after apply moves
 * it then, so a main-thread stall between apply and the continuation keeps the equal-gain
 * crossfade whole instead of starting the voice late against routes already fading (review of
 * #320, R4). The rendered time is the one `soon` (hooks.soon(), read after the stall) is built
 * on, soon - max(SCHEDULE_LEAD_S, 2q) (rounded up to a quantum), not currentTime: Firefox's
 * stands still within a task (V249), and a stall is one long task (C1-H008-1). Closer to it or
 * past it the old routes' fade may be rendered, which no later schedule undoes: the voice
 * continues at `soonest` (the soonest render quantum at or after the edit's horizon) and fades
 * in through the open route (fadeCurve), as it does with no route ramp (rampAt null). A stall
 * longer than the lead less a quantum still leaves that gap (H009). Never before `startTime`.
 * -> { at, from: 'crossfade' | 'soonest' }
 */
export function continueAt({ rampAt, soon, soonest, q, startTime }) {
  const rendered = soon - Math.max(SCHEDULE_LEAD_S, 2 * q);
  const from = rampAt !== null && rampAt >= rendered + q - 1e-9 ? 'crossfade' : 'soonest';
  return { at: Math.max(from === 'crossfade' ? rampAt : soonest, startTime), from };
}
