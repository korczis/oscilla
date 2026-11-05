// A performance output's cables (the XY pad's X and Y, an edge handle's `fit`, K183) sweep a
// linear parameter inside its declared range: a hand on a pad moves a control, it never pushes
// one past its range. compiler.js computeBases scales their excursion by this one factor, to
// the room the base and the other cables leave above (and below); the other cables keep theirs
// (their excess is reported as `exceeds`, §242).
//
//   fitFactor(lin, base, { min, max }) -> 0..1, 1 when nothing needs scaling
//     lin: the parameter's linear cables [{ up, down, fit }] (their excursion in its unit)

const sum = (xs, f) => xs.reduce((t, x) => t + x[f], 0);

export function fitFactor(lin, base, { min, max }) {
  const fit = lin.filter((x) => x.fit);
  if (!fit.length) return 1;
  const rest = lin.filter((x) => !x.fit);
  const up = sum(fit, 'up');
  const down = sum(fit, 'down');
  const above = max - (base + sum(rest, 'up'));
  const below = base + sum(rest, 'down') - min;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  return Math.min(up > 0 ? clamp01(above / up) : 1, down < 0 ? clamp01(below / -down) : 1);
}
