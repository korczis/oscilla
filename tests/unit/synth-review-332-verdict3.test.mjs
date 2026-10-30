// Review of #332, the verdict on round 3 (oscilla-af, 59a93e1f): what its P2 and P3 findings
// require, on the fake Web Audio context.
//   V1  the index of every edge into a phase operator: the gain between operator m and the
//       phase input of operator k starts at I_m / Φ_k and falls to I_m · sustain / Φ_k, so the
//       shapers cos(Φ_k x), sin(Φ_k x) see the phase deviation I_m · sin θ_m (changing the
//       edge's scale to 0.5 / Φ passed every earlier test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { FM_ALGORITHMS } from '../../src/js/synth/fm-algorithms.js';
import { engineEnv } from './engine-fixture.mjs';

const outputsOf = (n) => n.outputs || [];
const near = (a, b, what, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol,
  `${what}: ${a} is not ${b}`);

/**
 * The FM voice's operator k -> { oscs, out, shapers, phaseIn } by frequency (ratios distinct):
 * a phase operator's two oscillators feed two product gains summed into `out`; its shapers
 * drive the products' gains, and `phaseIn` is the gain (x = φ / Φ) that feeds the shapers.
 */
function operators(ctx, a, hz, p) {
  const ops = new Map();
  for (let k = 1; k <= a.ops; k++) {
    const oscs = ctx.oscillators.filter((o) => Math.abs(o.frequency.calls[0][1]
      - hz * p[`ratio${k}`]) < 1e-9);
    const products = oscs.flatMap(outputsOf).filter((g) => g.kind === 'gain');
    const shapers = ctx.of('waveshaper').filter((sh) => products.some((g) => sh.outputs
      .includes(g.gain)));
    const phaseIn = shapers.length ? ctx.of('gain').find((g) => shapers.every((sh) => g.outputs
      .includes(sh))) : null;
    const out = shapers.length ? outputsOf(products[0])[0] : oscs[0];
    ops.set(k, { oscs, products, shapers, phaseIn, out });
  }
  return ops;
}

test('V1 every edge into a phase operator carries I_m / Φ_k, falling to I_m · sustain / Φ_k', () => {
  const p = { ratio1: 1, ratio2: 2, ratio3: 3, ratio4: 4, index2: 1.3, index3: 0.7,
    index4: 2.1, modSustain: 0.4 };
  // A phase operator is a modulator that is itself modulated (the middle of a stack).
  const stacks = FM_ALGORITHMS.filter((a) => a.edges.some(([m]) => a.edges
    .some(([, t]) => t === m)));
  assert.deepEqual(stacks.map((a) => a.id), ['3-stack', '4-stack'], 'the algorithms with a stack');
  let edges = 0;
  for (const a of stacks) {
    const { ctx, h } = engineEnv('fm-voice', { algorithm: a.id, ...p });
    h.noteOn(0.1, 57, 127);
    const ops = operators(ctx, a, 220, p);
    const modulators = new Set(a.edges.map(([m]) => m));
    for (const [m, k] of a.edges) {
      const to = ops.get(k);
      if (!(modulators.has(k) && to.shapers.length)) continue; // into a carrier: linear FM
      // Φ_k, the sum of its inputs' indices, as the shapers hold it: their last points are
      // cos Φ and sin Φ (float32 curves; Φ < π here).
      const phi = a.edges.filter(([, t]) => t === k).reduce((s, [j]) => s + p[`index${j}`], 0);
      const [cos, sin] = to.shapers.map((sh) => sh.curve);
      near(Math.atan2(sin[sin.length - 1], cos[cos.length - 1]), phi,
        `${a.id}: the shapers of operator ${k} are at Φ`, 1e-6);
      const from = ops.get(m).out;
      const g = ctx.of('gain').find((x) => outputsOf(from).includes(x)
        && x.outputs.includes(to.phaseIn));
      assert.ok(g, `${a.id}: operator ${m} reaches operator ${k}'s phase through one gain`);
      const [set, target] = g.gain.calls;
      assert.equal(set[0], 'setValueAtTime');
      assert.equal(target[0], 'setTargetAtTime');
      // The shapers' argument is Φ_k · x = Φ_k · gain · sin θ_m: the phase deviation I_m.
      near(set[1] * phi, p[`index${m}`], `${a.id}: ${m} -> ${k} phase deviation at the onset`);
      near(target[1] * phi, p[`index${m}`] * p.modSustain,
        `${a.id}: ${m} -> ${k} phase deviation at Index sustain`);
      edges += 1;
    }
  }
  assert.equal(edges, 3, 'one edge into a phase operator in 3-stack, two in 4-stack');
});
