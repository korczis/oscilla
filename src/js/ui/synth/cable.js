// The shared synth-theme layer's patch cable (plan F013; the seam agreed on 2026-11-02): pure
// string renderers for one cable and one plug, from two points in the caller's coordinates (the
// bay's or a graph's), so a node drag recomputes only its own edges and nothing reads a layout. The
// signal type is the dash pattern, never colour alone, and a dash keeps its gaps at every width
// (butt caps); a refused cable is marked by a shape as well as the refuse colour. The colour is
// the caller's palette token (tokens.cable.palette[sourceModule % 6]); every other paint is a
// token too (project.visual-identity-lock v3), and every shape sets its own stroke. No number
// here sets an opacity, an alpha or a shadow (v4): the sheen's and the shadow's intensities are
// the hw-sheen and hw-shadow Tailwind keys (classes opacity-hw-sheen and opacity-hw-shadow), and
// the hit path is hidden rather than transparent. Imports only the plug (plug.js, whose
// plugSvg and plugState it re-exports), so its refused cross keeps clear of the room a plug
// takes, or is left to a refused plug the caller names (`plug`). S8 (the SYN review of W1, V1
// and V2): a cord's weight, rim, sheen and hang, its plugs (`plugs`), and clearLabels.
//
//   CABLE_DASH                              the pattern of each signal type
//   cableCurve(a, b, { slack, box, tangents, sag })
//                                           'M … C …', a hanging cable from a to b, or with
//                                           tangents a graph edge along its two ports
//   cableSag(a, b, { slack, box })          the sag a hanging cable rests at
//   cableDirections(a, b, { slack, box, tangents, sag })
//                                           { from, to }: the way the cable leaves each plug
//   settle(previous, { from, to }, dt, { slack, box, reducedMotion })
//                                           one frame of a dropped or moved cable settling
//   cableParts({ id, from, to, type, colour, state, tokens, slack, box, tangents, sag, zoom,
//     sheen, dash, port, cross, plug })
//                                           [{ key, tag, attrs, parent }], for setAttribute
//   partsSvg(parts)                         the markup of those records
//   cableSvg(spec)                          '<g data-cable="id">…</g>', partsSvg(cableParts()),
//                                           and both plugs when `plugs`
//   clearLabels(from, to, labels, { slack, box, width, skip })
//                                           { slack, sag, clear, crossed }: the slack that
//                                           hides the fewest labels (skip: its own jacks')
//   plugSvg({ at, colour, tokens, state, direction })
//                                           a plug, seated, held or refused, taking no pointer
//                                           (plug.js)
//   plugState(state)                        { held, refused } of a plug state (plug.js)

import { PLUG, plugState, plugSvg } from './plug.js';

export { PLUG, plugState, plugSvg } from './plug.js';

/** The dash pattern per signal type (PORT_VISUALS: solid, dashed, pulse, dash-dot). */
export const CABLE_DASH = Object.freeze({
  AUDIO: null, CONTROL: '9 6', TRIGGER: '2 6', ANALYSIS: '6 3 2 3',
});
/** A refused connection of a solid type still shows by pattern, not by colour alone. */
export const REFUSED_DASH = '4 4';
/** The least a cable hangs below its chord's midpoint, graph units, however short (S8: 12). */
export const CABLE_MIN_SAG = 20;
/** The most a cable hangs below its chord's midpoint, graph units, however long (S8: 60). */
export const CABLE_MAX_SAG = 90;
/** The default slack, the sag as a part of the distance: a level 300 hangs 90 (S8: 0.25). */
export const CABLE_SLACK = 0.3;
/** The stroke at rest (S8): in its rim 7.5, 0.29 of the jack ring (JACK_R 13) across, and in
 *  every state narrower than its plug's 10.5, as a real cord is. */
export const CABLE_WIDTH = 6;
/** The darker rim on each side of the stroke (S8). */
export const CABLE_EDGE = 0.75;
/** The hit path's width in screen px at every zoom (vector-effect="non-scaling-stroke"). */
export const CABLE_HIT_PX = 44;
/** A near-vertical cable's sideways bow (to +x) at its middle, as a part of min(sag, rise). */
export const CABLE_BOW = 0.3;
/** The port-tangent mode's reach, graph units: the least a cable runs straight out of a port
 *  before it turns, and the shortest blend from the forward curve into the full loop. */
export const CABLE_REACH = 40;
/** The most a port-tangent cable runs straight out of a port, graph units. */
const REACH_MAX = 120;
/** A forward port-tangent cable's handle as a part of the distance between its ends. */
const REACH_PART = 0.4;
/** Half the arm of the refused cross, graph units, and its stroke width. */
const CROSS = Object.freeze({ arm: 5, width: 2, under: 4.5 });
/** How far back from the target end the refused cross sits, graph units: the room a plug takes
 *  seated or held (PLUG.room, 7.75) plus the cross's reach (arm × √2 and half its underlay) and
 *  1, so the cross never covers the plug nor the plug's own refused cross. */
const CROSS_BACK = PLUG.room + CROSS.arm * Math.SQRT2 + CROSS.under / 2 + 1;
/** The sheen's offset up and left, screen px. */
const SHEEN_PX = 0.7;
/** The shadow underlay's drop, screen px: at rest, and lifted while the cable is dragged. */
const SHADOW_PX = Object.freeze({ rest: 1, lifted: 3 });
/** How much wider than the stroke the shadow underlay is, graph units. */
const SHADOW_SPREAD = 3;
/** The intensity class of the sheen: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The intensity class of the soft shadow: the hw-shadow key of tailwind.config.cjs. */
const SHADOW_CLASS = 'opacity-hw-shadow';
/** The stroke at rest, hovered and selected: in the rim 7.5, 8.75 and 10. */
const WIDTH = Object.freeze({ base: CABLE_WIDTH, hover: 7.25, selected: 8.5 });

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The most sag that keeps the curve above `bottom`. Below the chord the cubic is
 * y(t) = a.y + dy t + 4 sag t (1 - t); while |dy| <= 4 sag its lowest point is
 * mid + sag + dy² / (16 sag), so the largest sag with that at most bottom is
 * (R + √(R² - dy²/4)) / 2, R = bottom - mid. With an end at or below the bottom, the sag that
 * puts the lowest point on the lower end, |dy| / 4, so the cable never hangs below its end.
 */
function sagRoom(a, b, bottom) {
  const dy = b.y - a.y;
  const r = bottom - (a.y + b.y) / 2;
  const half = Math.abs(dy) / 2;
  if (r <= half) return half / 2;
  return (r + Math.sqrt(r * r - half * half)) / 2;
}

/** The bottom edge of a viewBox { x, y, width, height }, or Infinity without one. */
function bottomOf(box) {
  if (box === undefined || box === null) return Infinity;
  const ok = ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(box[k]));
  if (!ok || box.height < 0) {
    throw new RangeError('cableCurve: box must be a viewBox { x, y, width, height } of finite '
      + 'numbers with a height of 0 or more.');
  }
  return box.y + box.height;
}

/** The sag of the hanging cable from a to b: `told` if given, else slack × the distance in
 *  [CABLE_MIN_SAG, CABLE_MAX_SAG]; either way at most the room above the box's bottom. */
function hangingSag(a, b, slack, box, told) {
  if (!finite(a) || !finite(b)) throw new TypeError('cableCurve: a and b need finite x and y.');
  if (!(Number.isFinite(slack) && slack >= 0)) {
    throw new RangeError(`cableCurve: slack must be a finite number of 0 or more, not ${slack}.`);
  }
  if (told !== undefined && !(typeof told === 'number' && Number.isFinite(told) && told >= 0)) {
    throw new RangeError(`cableCurve: sag must be a finite number of 0 or more, not ${told}.`);
  }
  const room = sagRoom(a, b, bottomOf(box));
  const want = told !== undefined ? told
    : Math.min(CABLE_MAX_SAG, Math.max(CABLE_MIN_SAG, slack * Math.hypot(b.x - a.x, b.y - a.y)));
  return Math.max(0, Math.min(want, room));
}

/** The two control points of the hanging cubic from a to b (see cableCurve). */
function controls(a, b, slack, box, told) {
  const sag = hangingSag(a, b, slack, box, told);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const h = (sag * 4) / 3;
  // A near-vertical cable bows sideways, always to the right (+x), so it still reads as
  // hanging; the bow fades to nothing as the cable leans to |dx| = sag. One fixed side keeps the
  // curve continuous as an end is dragged across the vertical (a side taken from the sign of dx
  // would jump from one side to the other there, where the bow is largest), and it does not
  // depend on the order of a and b, so reversed ends draw the same curve.
  const lean = Math.abs(dx);
  const bow = lean < sag && sag > 0
    ? CABLE_BOW * Math.min(sag, Math.abs(dy)) * (1 - lean / sag) * (4 / 3) : 0;
  return [
    { x: num((2 * a.x + b.x) / 3 + bow), y: num((2 * a.y + b.y) / 3 + h) },
    { x: num((a.x + 2 * b.x) / 3 + bow), y: num((a.y + 2 * b.y) / 3 + h) },
  ];
}

const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
const along = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });

/** A port's direction as a unit vector, or a TypeError naming the tangent. */
function unit(v, end) {
  const ok = v !== null && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y)
    && Math.hypot(v.x, v.y) > 0;
  if (!ok) {
    throw new TypeError(`cableCurve: tangents.${end} must be a direction { x, y } of finite `
      + 'numbers, not zero.');
  }
  const n = Math.hypot(v.x, v.y);
  return { x: v.x / n, y: v.y / n };
}

/** de Casteljau: one cubic split at t = 1/2 into two. */
function halves([p0, p1, p2, p3]) {
  const a = lerp(p0, p1, 0.5);
  const b = lerp(p1, p2, 0.5);
  const c = lerp(p2, p3, 0.5);
  const d = lerp(a, b, 0.5);
  const e = lerp(b, c, 0.5);
  const m = lerp(d, e, 0.5);
  return [[p0, a, d, m], [m, e, c, p3]];
}

/**
 * The port-tangent cubics from a to b (see cableCurve), always two. Forward: one cubic whose
 * handles run along each port, REACH_PART of the distance (1 to REACH_MAX), split at its middle.
 * Behind (the target behind the source's direction and the source behind the target's): a loop
 * out along the source port, round below both ends (on the side of the source port's normal
 * pointing down the screen, +x for a vertical port, so swapped ends keep the side) by its reach
 * (half how far behind, CABLE_REACH to REACH_MAX), back across at the middle and in along the
 * target port. Its handles grow with how far behind (a third at the middle, an eighth at each
 * end, at least the reach), so a long feedback run stays a wide U and never hooks over its
 * target's plug. Between the two the split forward curve blends into the loop point by point (a
 * smoothstep of how far behind) over CABLE_REACH or half the widest gap between their control
 * points, whichever is longer, so a drag never jumps the cable and moves no point much more
 * than 3 units per unit at any height. Each blend is a positive mix of two curves with the ends'
 * tangents and joins, so it keeps them.
 *
 * For opposite ports (to = -from, Studio's facing edges) the ramp ends by CABLE_REACH plus half
 * the offset across the source port, and the loop past it never crosses itself and stays
 * CABLE_MIN_SAG clear of both ends; within the ramp it may pass over an end's plug (a curve
 * reaching the port from one side turning into one reaching it from the other), slowly, about
 * 0.3 of the offset behind. For other pairs only the ends' directions are kept: the loop's side
 * comes from the source port alone, and reversed ends need not draw the same curve.
 */
function tangentSegments(a, b, tangents) {
  if (tangents === null || typeof tangents !== 'object') {
    throw new TypeError('cableCurve: tangents must be { from, to }, the two ports\' directions.');
  }
  const f = unit(tangents.from, 'from');
  const g = unit(tangents.to, 'to');
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = Math.min(REACH_MAX, Math.max(1, REACH_PART * Math.hypot(dx, dy)));
  const forward = [a, along(a, f, reach), along(b, g, reach), b];
  const p = dx * f.x + dy * f.y;
  const behind = Math.min(-p, dx * g.x + dy * g.y);
  if (!(behind > 0)) return halves(forward);
  let n = { x: -f.y, y: f.x };
  if (n.y < 0 || (n.y === 0 && n.x < 0)) n = { x: -n.x, y: -n.y };
  const q = dx * n.x + dy * n.y;
  const r = Math.min(REACH_MAX, Math.max(CABLE_REACH, -p / 2));
  const m = along(along(a, f, p / 2), n, Math.max(0, q) + r);
  const hm = Math.max(r, -p / 3);
  const he = Math.max(r, -p / 8);
  const loop = [[a, along(a, f, he), along(m, f, hm), m],
    [m, along(m, f, -hm), along(b, g, he), b]];
  const near = halves(forward);
  let gap = 0;
  near.forEach((seg, i) => seg.forEach((pt, j) => {
    gap = Math.max(gap, Math.hypot(loop[i][j].x - pt.x, loop[i][j].y - pt.y));
  }));
  const s = Math.min(1, behind / Math.max(CABLE_REACH, gap / 2));
  const k = s * s * (3 - 2 * s);
  return near.map((seg, i) => seg.map((pt, j) => lerp(pt, loop[i][j], k)));
}

/** The cubics of a cable from a to b: the hanging one, or the port-tangent ones. */
function cubics(a, b, { slack = CABLE_SLACK, box, tangents, sag } = {}) {
  if (tangents === undefined) {
    const [c1, c2] = controls(a, b, slack, box, sag);
    return [[a, c1, c2, b]];
  }
  if (!finite(a) || !finite(b)) throw new TypeError('cableCurve: a and b need finite x and y.');
  if (sag !== undefined || (box !== undefined && box !== null)) {
    throw new TypeError(`cableCurve: ${sag !== undefined ? 'sag' : 'box'} belongs to the hanging `
      + 'mode; a port-tangent edge (tangents) takes neither sag nor box.');
  }
  return tangentSegments(a, b, tangents).map((seg, i, all) => seg.map((pt, j) => (
    (i === 0 && j === 0) || (i === all.length - 1 && j === 3) ? pt
      : { x: num(pt.x), y: num(pt.y) })));
}

/**
 * A cable from a to b. By default it hangs, as one cubic: the ends exactly a and b, both
 * control points a third of the way along the chord and lowered by 4/3 of the sag, so the
 * curve's middle hangs `sag` below the chord's midpoint, down the screen. The sag is slack ×
 * the distance in [CABLE_MIN_SAG, CABLE_MAX_SAG], lessened so the curve never hangs below the
 * bottom of a viewBox `box` (the box wins over the minimum, down to straight). A cable steeper
 * than its sag bows sideways (CABLE_BOW), so a vertical one still hangs. Reversed ends draw the
 * same curve; a == b is a finite droop. A given `sag` (finite, 0 or more; a frame of settle) is
 * drawn instead of the slack's, the box still winning.
 *
 * With `tangents: { from, to }`, each the way its port faces out of its node (an output on a
 * right edge to an input on a left edge: { from: { x: 1, y: 0 }, to: { x: -1, y: 0 } }; any
 * length but zero), it is a graph edge: it leaves along `from` and enters against `to` within
 * 1 degree, and a target behind its source is a smooth loop of two cubics, which for opposite
 * ports goes round below both ends and clear of them, reversible (see tangentSegments). `box`
 * and `sag` are refused beside `tangents` (a TypeError); `slack` is ignored there.
 */
export function cableCurve(a, b, { slack = CABLE_SLACK, box, tangents, sag } = {}) {
  const segs = cubics(a, b, { slack, box, tangents, sag });
  return `M ${a.x} ${a.y}`
    + segs.map(([, c1, c2, e]) => ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`).join('');
}

/**
 * The point of a cable that lies CROSS_BACK from its end b, walking back from b: the first
 * sample (1/64 steps of each cubic) that far away, refined by bisection. A cable too short to
 * reach that far takes its point farthest from b.
 */
function nearTarget(a, b, how) {
  const segs = cubics(a, b, how);
  const p = (t) => {
    const i = Math.min(segs.length - 1, Math.floor(t));
    const [p0, c1, c2, p3] = segs[i];
    const s = t - i;
    const u = 1 - s;
    const f = (k) => u * u * u * p0[k] + 3 * u * u * s * c1[k] + 3 * u * s * s * c2[k]
      + s * s * s * p3[k];
    return { x: f('x'), y: f('y') };
  };
  const away = (t) => {
    const q = p(t);
    return Math.hypot(q.x - b.x, q.y - b.y);
  };
  const STEPS = 64 * segs.length;
  const end = segs.length;
  let best = end;
  for (let i = STEPS - 1; i >= 0; i--) {
    const t = (i * end) / STEPS;
    if (away(t) >= CROSS_BACK) {
      let lo = t;
      let hi = ((i + 1) * end) / STEPS;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        if (away(m) >= CROSS_BACK) lo = m; else hi = m;
      }
      const q = p(lo);
      return { x: num(q.x), y: num(q.y) };
    }
    if (away(t) > away(best)) best = t;
  }
  const q = p(best);
  return { x: num(q.x), y: num(q.y) };
}

/** The unit vector from p toward q, or null when they coincide. */
function toward(p, q) {
  const l = Math.hypot(q.x - p.x, q.y - p.y);
  return l > 1e-9 ? { x: (q.x - p.x) / l, y: (q.y - p.y) / l } : null;
}

/**
 * The way a cable from a to b leaves each of its plugs, as unit vectors { from, to }: from a
 * toward its curve's first control point (the next that differs from a), and from b toward its
 * last; so along the ports with `tangents` (from, and to, each the way its port faces), and
 * down into the sag when it hangs. Pass each to plugSvg as its direction. Coincident ends (and
 * every control point on them) leave downward. The options are cableCurve's.
 */
export function cableDirections(a, b, how = {}) {
  const segs = cubics(a, b, how);
  const [p0, c1, c2, p3] = segs[0];
  const [q0, d1, d2, q3] = segs[segs.length - 1];
  const down = Object.freeze({ x: 0, y: 1 });
  const from = toward(p0, c1) || toward(p0, c2) || toward(p0, p3) || down;
  const to = toward(q3, d2) || toward(q3, d1) || toward(q3, q0) || down;
  return Object.freeze({ from: Object.freeze(from), to: Object.freeze(to) });
}

/** The sag a hanging cable from a to b comes to rest at: the one cableCurve draws. */
export function cableSag(a, b, { slack = CABLE_SLACK, box } = {}) {
  return hangingSag(a, b, slack, box);
}

/** How long a dropped or moved cable takes at most to come to rest, ms. */
export const SETTLE_MS = 400;
/** The swing: the undamped angular frequency (rad/s) and the damping ratio. Under-damped, so a
 *  cable swings past its rest once by 4.6 % of the drop; the next swing back is 0.2 %, under
 *  SETTLE_EPS for any sag this module draws. The largest drop (90, S8: 110 to 20 or 0 to
 *  90) rests by 334 ms (367 at 30 frames a second), inside SETTLE_MS. */
const SWING = Object.freeze({ omega: 24, zeta: 0.7 });
/** At rest: within this of the rest sag (graph units), moving slower than SETTLE_SPEED. */
const SETTLE_EPS = 0.5;
const SETTLE_SPEED = 6;

/**
 * One frame of a cable settling, pure: from the previous frame's state { from, to, sag,
 * velocity } (sag in graph units, velocity in units per second; undefined for none) and the
 * ends now ({ from, to }) after dt ms, the frozen state for this frame: { from, to, sag,
 * velocity, rest, settled }. The cable's middle keeps its place when the ends move (its sag
 * grows by as much as the chord's middle rose), then swings toward cableSag of the new ends as a
 * damped spring (SWING, stepped exactly, so the frame rate does not change the motion), and
 * lands exactly on its rest once within SETTLE_EPS and slower than SETTLE_SPEED: a dropped or
 * moved cable overshoots at most once and settles within SETTLE_MS. The sag stays in 0 to
 * CABLE_MAX_SAG + CABLE_MIN_SAG and the room above the box's bottom (a stop there kills the
 * velocity). With no previous frame the cable is at rest. Draw it with cableCurve(from, to,
 * { sag }).
 *
 * `reducedMotion` lands at the rest at once. This module schedules no frame and reads no media
 * query: the module that drives the frames checks prefers-reduced-motion itself, in its own
 * file (project.visual-identity-lock v4), and passes the answer here.
 */
export function settle(previous, ends, dt, { slack = CABLE_SLACK, box,
  reducedMotion = false } = {}) {
  if (!ends || !finite(ends.from) || !finite(ends.to)) {
    throw new TypeError('settle: the ends need { from, to } with finite x and y.');
  }
  if (!(typeof dt === 'number' && Number.isFinite(dt) && dt >= 0)) {
    throw new RangeError(`settle: dt must be a finite number of ms, 0 or more, not ${dt}.`);
  }
  const { from, to } = ends;
  const rest = cableSag(from, to, { slack, box });
  const done = (sag, velocity, settled) => Object.freeze({ from, to, sag, velocity, rest,
    settled });
  if (previous === undefined || previous === null || reducedMotion) return done(rest, 0, true);
  const was = previous;
  if (!finite(was.from) || !finite(was.to)) {
    throw new TypeError('settle: the previous frame needs { from, to } with finite x and y.');
  }
  const sag0 = was.sag === undefined ? cableSag(was.from, was.to, { slack, box }) : was.sag;
  const v0 = was.velocity === undefined ? 0 : was.velocity;
  if (!(typeof sag0 === 'number' && Number.isFinite(sag0))
    || !(typeof v0 === 'number' && Number.isFinite(v0))) {
    throw new RangeError('settle: the previous sag and velocity must be finite numbers.');
  }
  const top = Math.min(CABLE_MAX_SAG + CABLE_MIN_SAG, Math.max(0,
    sagRoom(from, to, bottomOf(box))));
  const rose = (was.from.y + was.to.y - from.y - to.y) / 2;
  const x0 = Math.max(0, Math.min(top, sag0 + rose)) - rest;
  const { omega: w, zeta: z } = SWING;
  const wd = w * Math.sqrt(1 - z * z);
  const t = dt / 1000;
  const e = Math.exp(-z * w * t);
  const c = Math.cos(wd * t);
  const s = Math.sin(wd * t);
  let sag = rest + e * (x0 * c + ((v0 + z * w * x0) / wd) * s);
  let velocity = e * (v0 * c - ((z * w * v0 + w * w * x0) / wd) * s);
  if (sag <= 0 || sag >= top) {
    sag = Math.max(0, Math.min(top, sag));
    velocity = 0;
  }
  if (Math.abs(sag - rest) < SETTLE_EPS && Math.abs(velocity) < SETTLE_SPEED) {
    return done(rest, 0, true);
  }
  return done(sag, velocity, false);
}

/** The WCAG luminance of a token value written in hex (tokens.css), else NaN (var(), …). */
function luminanceOf(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return NaN;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The rim's ink (S8): the darker of cable.shadow and cable.sheen (dark --osc-bg, light
 *  --osc-text; each palette colour 3:1 on it), else cable.shadow. A choice of token only. */
function edgeInk(tokens) {
  const { shadow, sheen } = tokens.cable;
  const ls = luminanceOf(shadow);
  const lt = luminanceOf(sheen);
  if (sheen && Number.isFinite(ls) && Number.isFinite(lt) && lt < ls) return sheen;
  return shadow || 'currentColor';
}

function needTokens(tokens, who) {
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError(`${who} needs the synth tokens (synthTokens(el)).`);
  }
}

/** A dash pattern as SVG reads one: numbers of 0 or more, spaced or comma separated. */
const DASH_RX = /^\d*\.?\d+(?:(?:\s*,\s*|\s+)\d*\.?\d+)*$/;
/** A port shape's name (PORT_KINDS): a lowercase word, as the port glyph names it. */
const PORT_RX = /^[a-z][a-z0-9-]{0,31}$/;

/** The dash of a cable: the caller's (a CABLE_KINDS declaration), else CABLE_DASH[type]. */
function dashOf(type, dash, who) {
  if (dash === undefined) {
    if (!Object.hasOwn(CABLE_DASH, type)) {
      throw new Error(`${who}: type must be AUDIO, CONTROL, TRIGGER or ANALYSIS, not '${type}', `
        + 'unless its dash is passed.');
    }
    return CABLE_DASH[type];
  }
  if (typeof type !== 'string' || type === '') {
    throw new TypeError(`${who}: type must be the signal's kind name, not '${type}'.`);
  }
  if (dash === null) return null;
  const ok = typeof dash === 'string' && DASH_RX.test(dash.trim())
    && dash.split(/[\s,]+/).filter(Boolean).reduce((a, x) => a + Number(x), 0) > 0;
  if (!ok) {
    throw new TypeError(`${who}: dash must be null (solid) or an SVG dash pattern of numbers `
      + `of 0 or more, not all 0, not ${JSON.stringify(dash)}.`);
  }
  return dash;
}

/** The port shapes of a cable's two ends as root attributes, or none when none is passed. */
function portAttrs(port, who) {
  if (port === undefined) return {};
  const pair = typeof port === 'string' ? { from: port, to: port } : port;
  const ok = pair !== null && typeof pair === 'object'
    && [pair.from, pair.to].every((x) => typeof x === 'string' && PORT_RX.test(x));
  if (!ok) {
    throw new TypeError(`${who}: port must be a shape name or { from, to } of shape names `
      + `(a lowercase word), not ${JSON.stringify(port)}.`);
  }
  return { 'data-port-from': pair.from, 'data-port-to': pair.to };
}

/** One frozen part record. */
const part = (key, tag, parent, attrs) => Object.freeze({ key, tag, parent,
  attrs: Object.freeze(attrs) });
const str = (x) => String(x);

/**
 * One cable as attribute records for a keyed setAttribute editor (no markup): a frozen list of
 * { key, tag, attrs, parent } in document and paint order, parents first, values raw strings.
 * `key` names the part whatever the ends, zoom or state ('cable', 'shadow', 'main', 'hit',
 * 'edge', 'stroke'; then 'cross', 'cross-under-0', 'cross-under-1', 'cross-0', 'cross-1' when
 * refused, unless cross is false or the target plug is refused; then 'sheen' unless sheen is
 * false), so an editor keyed by (cable id, key) only adds or removes the cross and the sheen.
 * It does setAttribute for each attribute a record carries, removeAttribute for each one it no
 * longer carries (un-refusing a solid AUDIO cable drops data-refused and stroke-dasharray; one
 * that only sets leaves it dashed and refused), and parent.insertBefore(new part, the next drawn
 * part of its parent; appended when none), so a cross goes under a drawn sheen, as painted.
 * cableSvg serialises exactly this list.
 *
 * The parts: a soft shadow (tokens.cable.shadow at hw-shadow, SHADOW_CLASS, SHADOW_SPREAD wider,
 * SHADOW_PX.rest screen px down, .lifted while dragging); the main group, the only part taking
 * the pointer (a hit path CABLE_HIT_PX screen px wide at every zoom by vector-effect=
 * "non-scaling-stroke", visibility="hidden", hit through pointer-events="stroke"; the opaque rim
 * (edgeInk), CABLE_EDGE wider each side, dashed and capped as the stroke; the stroke in the
 * caller's colour, dashed by kind); then the sheen (tokens.cable.sheen at hw-sheen). Hover and
 * selection thicken stroke and rim; a dashed stroke has butt caps so its gaps stay open at any
 * width, a solid one round. Refused paints the stroke tokens.jack.refuse, dashed (a solid kind
 * REFUSED_DASH), marks data-refused and draws a cross on the curve CROSS_BACK from the target,
 * clear of the plug's room at both ends of a cable 44 or more long (a shorter one takes its point
 * farthest from the target): a shape, not a colour alone. `plug` is the target plug's state
 * (plugState; a misspelt one refused): a refused plug draws its own cross, so the cable leaves
 * its out (dash and data-refused stay) and `cross: true` beside it is a RangeError; `cross:
 * false` leaves it out too. `zoom` turns the screen-px offsets into graph units; `slack`, `box`,
 * `tangents` and `sag` are cableCurve's. `dash` (a CABLE_KINDS pattern, null for solid) wins
 * over CABLE_DASH[type], and with it `type` may name any kind; `port` (a PORT_KINDS shape name,
 * or { from, to }) is recorded as data-port-from and data-port-to. Neither passed, the parts are
 * as before them.
 */
export function cableParts({ id, from, to, type, colour, state = {}, tokens, slack = CABLE_SLACK,
  box, tangents, sag, zoom = 1, sheen = true, dash, port, cross, plug } = {}) {
  const who = 'cableParts';
  needTokens(tokens, who);
  if (cross !== undefined && typeof cross !== 'boolean') {
    throw new TypeError(`${who}: cross must be true or false, not ${JSON.stringify(cross)}.`);
  }
  const plugRefused = plugState(plug, who, 'plug').refused;
  if (plugRefused && cross === true && state && state.refused) {
    throw new RangeError(`${who}: the target plug is refused and draws its own cross; a cross `
      + 'on the cable as well would mark one refusal twice (leave cross out).');
  }
  const crossed = cross === undefined ? !plugRefused : cross;
  const pattern0 = dashOf(type, dash, who);
  const ports = portAttrs(port, who);
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`${who}: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const st = state || {};
  const d = cableCurve(from, to, { slack, box, tangents, sag });
  const w = st.selected ? WIDTH.selected : (st.hover ? WIDTH.hover : WIDTH.base);
  const paint = st.refused ? tokens.jack.refuse : (colour || 'currentColor');
  const pattern = st.refused ? (pattern0 || REFUSED_DASH) : pattern0;
  const dashed = pattern ? { 'stroke-dasharray': pattern } : {};
  const cap = pattern ? 'butt' : 'round';
  const drop = num((st.dragging ? SHADOW_PX.lifted : SHADOW_PX.rest) / zoom);
  const off = num(-SHEEN_PX / zoom);
  const parts = [
    part('cable', 'g', null, { 'data-cable': str(id), ...(st.refused ? { 'data-refused': '' }
      : {}), ...ports, 'pointer-events': 'none' }),
    part('shadow', 'path', 'cable', { 'data-shadow': '', class: SHADOW_CLASS, d, fill: 'none',
      stroke: tokens.cable.shadow, 'stroke-width': str(num(w + SHADOW_SPREAD)),
      'stroke-linecap': 'round', transform: `translate(0 ${drop})` }),
    part('main', 'g', 'cable', { 'data-main': '', 'pointer-events': 'stroke' }),
    part('hit', 'path', 'main', { 'data-hit': '', d, fill: 'none', stroke: 'currentColor',
      visibility: 'hidden', 'stroke-width': str(CABLE_HIT_PX),
      'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }),
    part('edge', 'path', 'main', { 'data-edge': '', d, fill: 'none', stroke: edgeInk(tokens),
      'stroke-width': str(num(w + 2 * CABLE_EDGE)), 'stroke-linecap': cap, ...dashed }),
    part('stroke', 'path', 'main', { 'data-stroke': '', d, fill: 'none', stroke: paint,
      'stroke-width': str(w), 'stroke-linecap': cap, ...dashed }),
  ];
  if (st.refused && crossed) {
    const m = nearTarget(from, to, { slack, box, tangents, sag });
    const r = CROSS.arm;
    const arms = [[m.x - r, m.y - r, m.x + r, m.y + r], [m.x - r, m.y + r, m.x + r, m.y - r]]
      .map((l) => l.map(num));
    const line = (key, [x1, y1, x2, y2], stroke, width) => part(key, 'line', 'cross', {
      x1: str(x1), y1: str(y1), x2: str(x2), y2: str(y2), stroke, 'stroke-width': str(width),
      'stroke-linecap': 'round' });
    parts.push(part('cross', 'g', 'cable', { 'data-cross': '', 'pointer-events': 'none' }),
      ...arms.map((l, i) => line(`cross-under-${i}`, l, tokens.cable.shadow, CROSS.under)),
      ...arms.map((l, i) => line(`cross-${i}`, l, tokens.jack.refuse, CROSS.width)));
  }
  if (sheen) {
    parts.push(part('sheen', 'path', 'cable', { 'data-sheen': '', class: SHEEN_CLASS, d,
      fill: 'none', stroke: tokens.cable.sheen || 'currentColor',
      'stroke-width': str(num(w * 0.3)), 'stroke-linecap': cap, ...dashed,
      transform: `translate(${off} ${off})`, 'pointer-events': 'none' }));
  }
  return Object.freeze(parts);
}

/**
 * Markup from part records (cableParts): each part's attributes in their order, escaped; a
 * part with children opens and closes around them, one without closes itself.
 */
export function partsSvg(parts) {
  const kids = new Map();
  for (const p of parts) {
    if (!kids.has(p.parent)) kids.set(p.parent, []);
    kids.get(p.parent).push(p);
  }
  const one = (p) => {
    const attrs = Object.entries(p.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const inner = kids.get(p.key) || [];
    return inner.length ? `<${p.tag}${attrs}>${inner.map(one).join('')}</${p.tag}>`
      : `<${p.tag}${attrs}/>`;
  };
  return (kids.get(null) || []).map(one).join('');
}

/**
 * One cable as '<g data-cable="id">…</g>': partsSvg(cableParts(spec)); with `plugs: true` (S8)
 * the group ends with both plugs (plugSvg), seated at `from` and at `to` in the `plug` state,
 * in `colour`, each boot turned the way the cable leaves it (cableDirections). A caller drawing
 * plugs in a layer of its own, above its jacks, leaves `plugs` out.
 */
export function cableSvg(spec = {}) {
  const { plugs = false } = spec;
  if (typeof plugs !== 'boolean') {
    throw new TypeError(`cableSvg: plugs must be true or false, not ${JSON.stringify(plugs)}.`);
  }
  try {
    const markup = partsSvg(cableParts(spec));
    if (!plugs) return markup;
    const { from, to, colour, tokens, slack = CABLE_SLACK, box, tangents, sag, plug } = spec;
    const dirs = cableDirections(from, to, { slack, box, tangents, sag });
    const ends = plugSvg({ at: from, colour, tokens, direction: dirs.from })
      + plugSvg({ at: to, colour, tokens, state: plug, direction: dirs.to });
    return `${markup.slice(0, -'</g>'.length)}${ends}</g>`;
  } catch (e) {
    // An error says the function the caller called, not the helper that found it.
    e.message = e.message.replace(/^(cableParts|cableCurve):/, 'cableSvg:');
    throw e;
  }
}

/** A label box { x, y, width, height } of finite numbers, width and height 0 or more. */
function labelRect(r) {
  const ok = r !== null && typeof r === 'object' && r.width >= 0 && r.height >= 0
    && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k]));
  if (!ok) {
    throw new TypeError('clearLabels: labels must be an array of label boxes { x, y, width, '
      + `height }, finite, width and height 0 or more, not ${JSON.stringify(r)}.`);
  }
  return r;
}

/** How far the polyline judged may stray from the cubic; the pad grows by it. */
const FLAT = 0.125;
const toBox = (x, y, r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width),
  Math.max(r.y - y, 0, y - r.y - r.height));
/** The bounds { x0, x1, y0, y1 } of points, grown by g. */
const bounds = (ps, g = 0) => ({ x0: Math.min(...ps.map((p) => p.x)) - g, x1: Math.max(...ps
  .map((p) => p.x)) + g, y0: Math.min(...ps.map((p) => p.y)) - g, y1: Math.max(...ps
  .map((p) => p.y)) + g });
const meets = (h, r) => r.x <= h.x1 && r.x + r.width >= h.x0 && r.y <= h.y1
  && r.y + r.height >= h.y0;

/** Whether the segment p–q passes nearer than `near` to the box r: it enters r (no axis of
 *  r's or of its normal separates them), or an end is near r, or a corner of r near it. */
function segmentNear(p, q, r, near) {
  if (!meets(bounds([p, q], near), r)) return false;
  const c = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height]].map(([x, y]) => ({ x, y }));
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const side = c.map((k) => Math.sign(dx * (k.y - p.y) - dy * (k.x - p.x)));
  if (meets(bounds([p, q]), r) && Math.abs(side.reduce((s, v) => s + v, 0)) < 4) return true;
  const l2 = dx * dx + dy * dy || 1;
  return toBox(p.x, p.y, r) < near || toBox(q.x, q.y, r) < near || c.some((k) => {
    const t = Math.max(0, Math.min(1, ((k.x - p.x) * dx + (k.y - p.y) * dy) / l2));
    return Math.hypot(k.x - p.x - t * dx, k.y - p.y - t * dy) < near;
  });
}

/** The labels (indices of `which`, in order, at most `limit`) the hanging cable from a to b at
 *  `sag` passes nearer than `pad` to: judged on a polyline within FLAT of the cubic (h²/8 of
 *  its largest second derivative), only where a label meets its control points' bounds. */
function crossings(a, b, sag, box, rects, which, pad, limit) {
  const ps = [a, ...controls(a, b, CABLE_SLACK, box, sag), b];
  const h = bounds(ps, pad + FLAT);
  const d2 = (k) => 6 * Math.max(...[0, 1].map((i) => Math.abs(ps[i][k] - 2 * ps[i + 1][k]
    + ps[i + 2][k])));
  const n = Math.max(4, Math.ceil(Math.sqrt(Math.hypot(d2('x'), d2('y')) / (8 * FLAT))));
  let line;
  const hit = [];
  for (const j of which) {
    if (hit.length >= limit) break;
    if (!meets(h, rects[j])) continue;
    line = line || Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const w = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
      return { x: w.reduce((s, k, m) => s + k * ps[m].x, 0),
        y: w.reduce((s, k, m) => s + k * ps[m].y, 0) };
    });
    if (line.some((p, i) => i && segmentNear(line[i - 1], p, rects[j], pad + FLAT))) hit.push(j);
  }
  return hit;
}

/**
 * Lifts a hanging cable off the labels it would hide (S8; pure): a cable may hang over a panel,
 * not over a label a little more sag avoids. Judged as cableCurve hangs it (`slack`, `box`),
 * half its `width` kept clear of each label box ({ x, y, width, height }). The sag rises a unit
 * at a time from its rest, up to CABLE_MAX_SAG and the box, and the sag crossing the fewest
 * labels wins, the least on a tie (the rest and its `slack` when none crosses fewer): a label
 * more sag clears is cleared even beside one it cannot (a shallow box; coincident ends). The
 * cable's own jacks' labels, which it leaves through at any sag, belong in `skip` (indices),
 * neither judged nor reported. Frozen { slack, sag, clear, crossed }: the hang returned
 * (cableSag(from, to, { slack, box }) is its sag), `crossed` the labels' indices it still
 * crosses, `clear` when none. `tangents` is refused: an edge does not hang.
 */
export function clearLabels(from, to, labels, { slack = CABLE_SLACK, box, tangents,
  width = CABLE_WIDTH + 2 * CABLE_EDGE, skip = [] } = {}) {
  if (tangents !== undefined) {
    throw new TypeError('clearLabels judges a hanging cable; an edge with tangents does not.');
  }
  const rects = Array.isArray(labels) ? labels.map(labelRect) : [labelRect(labels)];
  if (!(Number.isFinite(width) && width > 0)) {
    throw new RangeError(`clearLabels: width must be a finite number above 0, not ${width}.`);
  }
  if (!(Array.isArray(skip) && skip.every((i) => Number.isInteger(i) && i >= 0
    && i < rects.length))) {
    throw new TypeError(`clearLabels: skip must be an array of label indices, not ${
      JSON.stringify(skip)}.`);
  }
  const done = (k, sag, crossed) => Object.freeze({ slack: k, sag, clear: !crossed.length,
    crossed: Object.freeze(crossed) });
  try {
    const rest = hangingSag(from, to, slack, box);
    const pad = width / 2;
    const which = rects.map((_, j) => j).filter((j) => !skip.includes(j));
    let best = { sag: rest, crossed: crossings(from, to, rest, box, rects, which, pad, 1 / 0) };
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    if (!best.crossed.length || !(span > 0)) return done(slack, rest, best.crossed);
    const top = Math.min(CABLE_MAX_SAG, sagRoom(from, to, bottomOf(box)));
    // Every hang between the rest and the top has its control points inside those two hangs'
    // bounds (the drop and the bow grow with the sag): only labels there are judged.
    const reach = bounds([rest, top].flatMap((s) => controls(from, to, CABLE_SLACK, box, s))
      .concat(from, to), pad + FLAT);
    const near = which.filter((j) => meets(reach, rects[j]));
    for (let s = rest + 1; s < top + 1 && best.crossed.length; s += 1) {
      const sag = Math.min(s, top);
      const crossed = crossings(from, to, sag, box, rects, near, pad, best.crossed.length);
      if (crossed.length < best.crossed.length) best = { sag, crossed };
    }
    if (best.sag === rest) return done(slack, rest, best.crossed);
    return done(best.sag / span, hangingSag(from, to, best.sag / span, box), best.crossed);
  } catch (e) {
    e.message = e.message.replace(/^cableCurve:/, 'clearLabels:');
    throw e;
  }
}
