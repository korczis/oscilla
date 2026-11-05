// The shared synth-theme layer's walk along a cord (plan F013; split from cable.js, which uses
// it): pure geometry over a cord's cubics [[p0, c1, c2, p3], ...] in the caller's coordinates.
// Draws nothing and imports nothing.
//
//   awayFrom(segs, fars, fromEnd)   the points of the cord at each of the ascending distances
//                                   `fars` from an end, in one walk in from it
//   beside(segs, ds)                for each d of ds, path data of the cord moved d across
//                                   itself, toward the light (above and left) when d > 0

/** A coordinate to 1e-6 (never -0), without a string round trip. */
const num = (x) => Math.round(x * 1e6) / 1e6 || 0;
/** A stripe's coordinate to 1e-3, its number short to write: a stripe is drawn, never judged. */
const near = (x) => Math.round(x * 1e3) / 1e3 || 0;
const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });

/**
 * The points of the cubics `segs` that lie each of `fars` (ascending) from an end (`fromEnd`:
 * the first, else the last), walking in from that end in one walk: for each distance the first
 * sample (1/64 steps of each cubic) that far away, refined by regula falsi (Illinois) to 1e-9 of
 * the distance, else to its bracket. A distance the cord never reaches takes its point farthest
 * from that end. The first sample as far as a greater distance comes no sooner than a lesser
 * one's, so the walk goes on from where the last distance was found.
 */
export function awayFrom(segs, fars, fromEnd = false) {
  const end = segs.length;
  // t counts in from the end judged (t = end is that end), so one walk serves both ends.
  const p = (t) => {
    const v = fromEnd ? end - t : t;
    const i = Math.max(0, Math.min(end - 1, Math.floor(v)));
    const [p0, c1, c2, p3] = segs[i];
    const s = v - i;
    const u = 1 - s;
    const k0 = u * u * u;
    const k1 = 3 * u * u * s;
    const k2 = 3 * u * s * s;
    const k3 = s * s * s;
    return { x: k0 * p0.x + k1 * c1.x + k2 * c2.x + k3 * p3.x,
      y: k0 * p0.y + k1 * c1.y + k2 * c2.y + k3 * p3.y };
  };
  const b = p(end);
  const away = (t) => {
    const q = p(t);
    return Math.hypot(q.x - b.x, q.y - b.y);
  };
  const STEPS = 64 * end;
  const done = (t) => {
    const q = p(t);
    return { x: num(q.x), y: num(q.y) };
  };
  /** The point `far` away between t (at least that far) and hi (nearer), at gap - far. */
  const refine = (t, at, hi, ahi, far) => {
    let lo = t;
    let glo = at - far;
    let up = hi;
    let ghi = ahi - far;
    let side = 0;
    for (let k = 0; k < 60; k++) {
      const m = (lo * ghi - up * glo) / (ghi - glo);
      const g = away(m) - far;
      if (Math.abs(g) < 1e-9 || !(m > lo && m < up)) return done(Math.abs(g) < 1e-9 ? m : lo);
      if (g > 0) {
        lo = m;
        glo = g;
        if (side === 1) ghi /= 2;
        side = 1;
      } else {
        up = m;
        ghi = g;
        if (side === -1) glo /= 2;
        side = -1;
      }
    }
    return done(lo);
  };
  const out = [];
  let best = end;
  let bestAway = 0;
  let hi = end;
  let ahi = 0;
  for (let i = STEPS - 1; i >= 0 && out.length < fars.length; i--) {
    const t = (i * end) / STEPS;
    const at = away(t);
    while (out.length < fars.length && at >= fars[out.length]) {
      out.push(refine(t, at, hi, ahi, fars[out.length]));
    }
    if (at > bestAway) {
      best = t;
      bestAway = at;
    }
    hi = t;
    ahi = at;
  }
  while (out.length < fars.length) out.push(done(best));
  return out;
}

/** The unit normal on the left of the way from a to b (y down: (t.y, -t.x)), or null. */
function leftOf(a, b) {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: y / l, y: -x / l } : null;
}
const UP = Object.freeze({ x: 0, y: -1 });
/** A cubic's left normal at its start (or end), from the first handle that leaves the point. */
const normal = ([p0, c1, c2, p3], atEnd) => (atEnd
  ? leftOf(c2, p3) || leftOf(c1, p3) || leftOf(p0, p3)
  : leftOf(p0, c1) || leftOf(p0, c2) || leftOf(p0, p3)) || UP;

/** de Casteljau: a cubic split at t = 1/2 into two. */
function halves([p0, c1, c2, p3]) {
  const a = lerp(p0, c1, 0.5);
  const b = lerp(c1, c2, 0.5);
  const c = lerp(c2, p3, 0.5);
  const e = lerp(a, b, 0.5);
  const f = lerp(b, c, 0.5);
  const m = lerp(e, f, 0.5);
  return [[p0, a, e, m], [m, f, c, p3]];
}

/** Where the line through p along u meets the one through q along v, or null if they never
 *  meet within `room` of `near` (near parallel, or a turn too sharp to offset by a corner). */
function meet(p, u, q, v, near, room) {
  const det = u.x * v.y - u.y * v.x;
  if (det === 0) return null;
  const s = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  const m = { x: p.x + s * u.x, y: p.y + s * u.y };
  return Math.hypot(m.x - near.x, m.y - near.y) <= room ? m : null;
}

/**
 * For each d of `ds`, the path data (M, then C) of the cord `segs` moved d across itself (JC-13;
 * review of 11-05): toward the light, from above and the left, when d > 0, away from it when
 * d < 0. Each cubic is split at its middle and each half's control polygon moved leg by leg
 * (Tiller and Hanson: its ends along their own normals, each handle to where its two moved legs
 * meet), so the stripe keeps beside the cord on every stretch, a 45° one included. The side is
 * taken once, from the normal at the cord's middle, so it never flips along the cord: the light's
 * side is the one that normal faces, or its opposite (a cord running along the light, down and
 * right, takes the upper right).
 */
export function beside(segs, ds) {
  const hs = [];
  for (const s of segs) hs.push(...halves(s));
  const mid = normal(hs[hs.length >> 1], false);
  const side = -mid.x - mid.y >= 0 ? 1 : -1;
  const out = ds.map(() => '');
  for (const h of hs) {
    const [p0, c1, c2, p3] = h;
    const na = normal(h, false);
    const nc = normal(h, true);
    const nb = leftOf(c1, c2);
    const ua = { x: -na.y, y: na.x };
    const uc = { x: -nc.y, y: nc.x };
    ds.forEach((d, i) => {
      const k = side * d;
      const at = (pt, n) => ({ x: pt.x + k * n.x, y: pt.y + k * n.y });
      const [q0, q3] = [at(p0, na), at(p3, nc)];
      const b = nb && at(c1, nb);
      const room = 3 * Math.abs(k);
      const q1 = (b && meet(q0, ua, b, { x: -nb.y, y: nb.x }, at(c1, na), room)) || at(c1, na);
      const q2 = (b && meet(b, { x: -nb.y, y: nb.x }, q3, uc, at(c2, nc), room)) || at(c2, nc);
      if (!out[i]) out[i] = `M ${near(q0.x)} ${near(q0.y)}`;
      out[i] += ` C ${near(q1.x)} ${near(q1.y)} ${near(q2.x)} ${near(q2.y)} ${near(q3.x)} `
        + `${near(q3.y)}`;
    });
  }
  return out;
}
