// The shared synth-theme layer's hanging cord (plan F013; split from cable.js, which re-exports
// its constants): pure geometry of a patch cord hanging from a to b under gravity, one cubic
// whose ends are exactly a and b and whose middle hangs `sag` below the chord's midpoint. A
// cord steeper than its sag bellies sideways (JC-14), so a long vertical run hangs like a real
// cable and is never a straight elastic line. Draws nothing and imports nothing.
//
//   CABLE_MIN_SAG, CABLE_MAX_SAG, CABLE_SLACK, CABLE_BOW   the hang's bounds and shape
//   sagRoom(a, b, bottom)              the most sag that keeps the cord above `bottom`
//   bottomOf(box)                      a viewBox's bottom edge, Infinity without one
//   hangingSag(a, b, slack, box, sag)  the sag a cord hangs at
//   controls(a, b, slack, box, sag)    the hanging cubic's two control points

/** The least a cable hangs below its chord's midpoint, graph units, however short (S8: 12); also
 *  the least a vertical run of twice that or more bellies sideways (JC-14). */
export const CABLE_MIN_SAG = 20;
/** The most a cable hangs below its chord's midpoint, graph units, however long (S8: 60). */
export const CABLE_MAX_SAG = 90;
/** The default slack, the sag as a part of the distance: a level 300 hangs 90 (S8: 0.25). */
export const CABLE_SLACK = 0.3;
/** A near-vertical cable's sideways belly (to +x) at its middle, as a part of min(sag, rise)
 *  (JC-14; S8: 0.3). */
export const CABLE_BOW = 0.5;

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};

/**
 * The most sag that keeps the curve above `bottom`. Below the chord the cubic is
 * y(t) = a.y + dy t + 4 sag t (1 - t); while |dy| <= 4 sag its lowest point is
 * mid + sag + dy² / (16 sag), so the largest sag with that at most bottom is
 * (R + √(R² - dy²/4)) / 2, R = bottom - mid. With an end at or below the bottom, the sag that
 * puts the lowest point on the lower end, |dy| / 4, so the cable never hangs below its end.
 */
export function sagRoom(a, b, bottom) {
  const dy = b.y - a.y;
  const r = bottom - (a.y + b.y) / 2;
  const half = Math.abs(dy) / 2;
  if (r <= half) return half / 2;
  return (r + Math.sqrt(r * r - half * half)) / 2;
}

/** The bottom edge of a viewBox { x, y, width, height }, or Infinity without one. */
export function bottomOf(box) {
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
export function hangingSag(a, b, slack, box, told) {
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

/**
 * The two control points of the hanging cubic from a to b: a third of the way along the chord,
 * lowered by 4/3 of the sag, so the middle hangs `sag` below the chord's midpoint. A cord steeper
 * than its sag bellies sideways, always to the right (+x), by CABLE_BOW of min(sag, rise) at its
 * middle, and never by less than CABLE_MIN_SAG, or half the rise when that is less (JC-14): a long
 * vertical run hangs as a cable does and coincident ends only droop. The belly fades to nothing
 * as the cord leans to |dx| = sag. One fixed side keeps the curve continuous as an end is dragged
 * across the vertical (a side taken from the sign of dx would jump there, where the belly is
 * largest), and it does not depend on the order of a and b, so reversed ends draw the same curve.
 */
export function controls(a, b, slack, box, told) {
  const sag = hangingSag(a, b, slack, box, told);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const h = (sag * 4) / 3;
  const lean = Math.abs(dx);
  const rise = Math.abs(dy);
  const belly = Math.max(CABLE_BOW * Math.min(sag, rise), Math.min(CABLE_MIN_SAG, rise / 2));
  const bow = lean < sag && sag > 0 ? belly * (1 - lean / sag) * (4 / 3) : 0;
  return [
    { x: num((2 * a.x + b.x) / 3 + bow), y: num((2 * a.y + b.y) / 3 + h) },
    { x: num((a.x + 2 * b.x) / 3 + bow), y: num((a.y + 2 * b.y) / 3 + h) },
  ];
}
