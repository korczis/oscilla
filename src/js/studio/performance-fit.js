// A performance output's cables (the XY pad's X and Y, an edge handle's `fit`, K183) sweep a
// linear parameter inside its declared range: a hand on a pad moves a control, it never pushes
// one past its range. compiler.js computeBases scales each such cable, its excursion and its
// constant part (a bipolar cable's or an offset's), by one factor, to the room the base and
// the other cables leave above and below; the other cables keep theirs (their excess is
// reported as `exceeds`, §242). A factor under 1 is said, never silent (project.no-silent-
// feedback): fitLimits makes its `performance-limited` diagnostics, synth/xy.js xyRoom the
// pad's readout.
//
//   fitFactor(lin, base, { min, max }) -> { k: 0..1, shift }
//     lin: the parameter's linear cables [{ up, down, c, fit }]: each one's excursion around
//       its constant part c (in the parameter's unit; the caller scales the others' already);
//     base: the parameter's base with every cable's constant part; shift: what the scaled
//     constant parts move the base by ((k - 1) x their sum)
//   fitCables(lin, k, b, p, key, isFreq, { top, room }, lower, cb) -> { kOf(x), up }
//     computeBases' fit of one parameter: fitFactor over its linear cables (the others at the
//     Nyquist k), the constants moving the base `b` by the range factor, a raise never past
//     `top` (the static a detune's Nyquist room was sized for) plus what is left of `room`
//     (that room in cents) after the cables' final sweep (the shift raised a bipolar cable's
//     detune above 0.95 x Nyquist: review of PR 428, R-K; the pre-fit static alone as the
//     ceiling cut a fitted static to 0 at any frequency: train review RK-2; `lower` records
//     the cut); each fitted cable marked in cb.limited, cb.scaled and cb.fitted with the
//     factor that won
//   fitLimits(planNode, cb, { edges, nodes }) -> [Diagnostic]   one per fitted cable held
//     below its depth (cb.fitted: Map<edge id, { factor, key, by }>), worded by the factor that
//     won (`by`): 'range' (fitFactor) or 'nyquist' (computeBases' 0.95 x Nyquist headroom, an
//     Oscillator's detune near the top: its range had room, review of #428 NF1)

import { studioDiagnostic } from './validate.js';
import { SAFE_NYQUIST_FACTOR_TEXT } from '../core/constants.js';

const sum = (xs, f) => xs.reduce((t, x) => t + x[f], 0);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function fitFactor(lin, base, { min, max }) {
  const fit = lin.filter((x) => x.fit);
  if (!fit.length) return { k: 1, shift: 0 };
  const rest = lin.filter((x) => !x.fit);
  const c = sum(fit, 'c');
  const bare = base - c; // the base without the fitted cables' constant parts
  const top = c + sum(fit, 'up'); // the fitted cables at their highest, constants included
  const low = c + sum(fit, 'down'); // and at their lowest
  const above = max - (bare + sum(rest, 'up'));
  const below = bare + sum(rest, 'down') - min;
  const k = Math.min(top > 0 ? clamp01(above / top) : 1, low < 0 ? clamp01(below / -low) : 1);
  return { k, shift: (k - 1) * c };
}

export function fitCables(lin, k, b, p, key, isFreq, { top, room }, lower,
  { limited, scaled, fitted }) {
  // The constant part is scaled by the range factor, not by min(k, fit.k) (review of PR 428,
  // R-K): the Nyquist k sizes the sweep above the static (constants included); scaling a
  // negative constant by the smaller k raised the static past that room (played above
  // 0.95 x Nyquist), and a positive one lost the room it was given. The raise is held at `top`
  // plus the Nyquist room the cables' final sweep leaves (RK-2: `top` alone, the pre-fit static
  // clipped at 0, cut a bipolar cable's fitted static to 0 at 440 Hz as at 20 kHz).
  const fit = isFreq ? { k: 1, shift: 0 } : fitFactor(lin.map((x) => (x.fit ? x
    : { ...x, up: x.up * k, down: x.down * k })), b.value, p);
  const kOf = (x) => (x.fit ? Math.min(k, fit.k) : k);
  if (fit.k < 1) {
    b.value += fit.shift;
    const upFinal = lin.reduce((t, x) => t + x.up * kOf(x), 0);
    const ceiling = top + Math.max(0, room - upFinal);
    if (b.value + b.cents > ceiling) lower(key, ceiling - b.cents);
    for (const x of lin) if (x.fit) { limited.add(x.id); scaled.set(x.id, kOf(x)); }
  }
  const by = fit.k > k ? 'nyquist' : 'range'; // the factor that won (fitLimits words it)
  for (const x of lin) if (x.fit) fitted.set(x.id, { factor: kOf(x), key, by });
  return { kOf, up: lin.reduce((t, x) => t + x.up * kOf(x), 0) };
}

export function fitLimits(planNode, cb, { edges, nodes } = {}) {
  const out = [];
  if (!planNode || !cb || !cb.fitted) return out;
  for (const [id, { factor, key, by = 'range' }] of cb.fitted) {
    if (factor >= 1) continue;
    const e = edges && edges.get(id);
    const p = planNode.def.params.find((x) => x.key === key);
    if (!e || !p) continue;
    const from = nodes && nodes.get(e.from.node);
    const src = `${from ? from.name : e.from.node} ${e.from.port.toUpperCase()}`;
    const nyq = `${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist`;
    const range = `(${p.min} až ${p.max})`;
    const pct = `hraje ${Math.round(factor * 100)} % své hloubky`;
    let why;
    if (by === 'nyquist') {
      why = factor <= 0 ? `nemá místo: frekvence už dosahuje ${nyq}`
        : `${pct}: drží se na ${nyq} nebo pod ním, víc místa frekvence nenechává`;
    } else {
      why = factor <= 0 ? 'nemá místo: základ a ostatní kabely už dosahují obou konců '
        + `rozsahu ${range}` : `${pct}: základ a ostatní kabely nechávají jen tolik `
        + `z rozsahu ${range}`;
    }
    out.push({ ...studioDiagnostic('runtime', 'performance-limited', `Kabel ${src} → `
      + `${planNode.name} ${p.label} ${why}.`, { kind: 'edge', id }),
    details: { node: planNode.id, param: key, edge: id, factor, by, min: p.min, max: p.max } });
  }
  return out;
}
