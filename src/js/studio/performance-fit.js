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
    const range = `(${p.min} to ${p.max})`;
    const pct = `plays ${Math.round(factor * 100)} % of its depth`;
    let why;
    if (by === 'nyquist') {
      why = factor <= 0 ? `has no room: the frequency already reaches ${nyq}`
        : `${pct}: held at or below ${nyq}, all the room the frequency leaves`;
    } else {
      why = factor <= 0 ? 'has no room: the base and the other cables already reach the ends '
        + `of its range ${range}` : `${pct}: the base and the other cables leave only that much `
        + `of its range ${range}`;
    }
    out.push({ ...studioDiagnostic('runtime', 'performance-limited', `${src} into `
      + `${planNode.name} ${p.label} ${why}.`, { kind: 'edge', id }),
    details: { node: planNode.id, param: key, edge: id, factor, by, min: p.min, max: p.max } });
  }
  return out;
}
