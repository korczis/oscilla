// Review of #332, the verdict on round 3 (oscilla-af, 59a93e1f): what its P2 and P3 findings
// require, on the fake Web Audio context.
//   V1  the index of every edge into a phase operator: the gain between operator m and the
//       phase input of operator k starts at I_m / Φ_k and falls to I_m · sustain / Φ_k, so the
//       shapers cos(Φ_k x), sin(Φ_k x) see the phase deviation I_m · sin θ_m (changing the
//       edge's scale to 0.5 / Φ passed every earlier test)
//   V5  a note-on that takes no voice (it sounds nothing) does not enter the held list
//   V6  AM at Depth 0 is the carrier alone: no product term, so the face states no DC
//   V7  the reason a voice's DC stays is a true one: at the DC settings a high-pass would lower
//       the peak; it is kept out of every voice because it raises others (a square at E2)
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

// ------------------------------------------------------------------ V5 the held list

test('V5 a note that sounds nothing does not enter the held list', async () => {
  const { createLiveNotes } = await import('../../src/js/studio/live-notes.js');
  const calls = [];
  const engine = { // a polyphonic engine handle: notes at or above 100 take no voice
    noteOn(at, note) {
      calls.push(['on', note]);
      return note >= 100 ? { slot: null, stolen: false, retrigger: false, dropped: 2 }
        : { slot: 0, stolen: false, retrigger: false, dropped: 0 };
    },
    noteOff: (at, note) => calls.push(['off', note]),
    allOff: () => 0,
  };
  const live = createLiveNotes({ getModel: () => ({ graph: { nodes: [], edges: [] } }),
    handleOf: (id) => (id === 'fm-1' ? engine : null) });
  const loud = live.event('fm-1', { kind: 'on', note: 60, at: 0 });
  assert.equal(loud.silent, false);
  const quiet = live.event('fm-1', { kind: 'on', note: 120, at: 0 });
  assert.equal(quiet.silent, true, 'the result says it sounds nothing');
  assert.equal(quiet.dropped, 2, 'and how many operators the limit left out');
  assert.deepEqual(live.held(), [60], 'only the sounding note is held');
  assert.equal(quiet.held, 1);
  assert.equal(live.event('fm-1', { kind: 'off', note: 120, at: 1 }).held, 1);
  assert.equal(live.allOff(2), 1, 'all-off counts the held notes that sound');
  assert.deepEqual(calls, [['on', 60], ['on', 120], ['off', 120]], 'every event reached it');
});

// ------------------------------------------------------------------ V6 AM at Depth 0

test('V6 AM at Depth 0 states no DC: the carrier alone has no product term', async () => {
  const { amDcText } = await import('../../src/js/studio/nodes/engines.js');
  const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
  const facts = NODE_REGISTRY.get('am-voice').facts;
  for (const [carrier, modulator, ratio] of [['sine', 'sine', 1], ['sawtooth', 'sawtooth', 1.5],
    ['square', 'sine', 3]]) {
    const p = { carrier, modulator, ratio, mode: 'am' };
    assert.equal(amDcText({ ...p, depth: 0 }), null, `${carrier} x ${modulator} at ${ratio}`);
    assert.doesNotMatch(facts({ ...p, depth: 0 }), /DC/);
    assert.match(amDcText({ ...p, depth: 0.5 }), /DC/, 'any depth above 0 has the mean');
    assert.match(amDcText({ ...p, mode: 'ring', depth: 0 }), /DC/,
      'ring is the full product whatever Depth says');
  }
});

// ------------------------------------------------------------------ V7 why the DC stays

/** Steady-state peak after a second-order (two one-pole) high-pass at fc, relative to before. */
function highPassPeakRatio(x, fc, sr) {
  const a = 1 / (1 + (2 * Math.PI * fc) / sr);
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(y.length);
    let py = 0;
    let px = 0;
    for (let i = 0; i < y.length; i++) {
      py = a * (py + y[i] - px);
      px = y[i];
      out[i] = py;
    }
    y = out;
  }
  const peak = (v) => v.subarray(v.length >> 1).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  return peak(y) / peak(Float64Array.from(x));
}

test('V7 the reason the DC stays is true: a high-pass lowers these voices, raises a square', async () => {
  const { amDcText } = await import('../../src/js/studio/nodes/engines.js');
  const { NODE_REGISTRY } = await import('../../src/js/studio/registry.js');
  const fs = await import('node:fs');
  const docs = fs.readFileSync(new URL('../../docs/synth.md', import.meta.url), 'utf8');
  const sines = { carrier: 'sine', modulator: 'sine', ratio: 1 };
  const texts = [amDcText({ ...sines, mode: 'ring', depth: 1 }),
    amDcText({ ...sines, mode: 'am', depth: 1 }),
    amDcText({ carrier: 'square', modulator: 'sine', mode: 'ring', depth: 1, ratio: 3 }),
    NODE_REGISTRY.get('am-voice').help.constraints, NODE_REGISTRY.get('fm-voice').help.constraints,
    docs];
  for (const t of texts) {
    assert.doesNotMatch(t, /a high-pass would raise the voice's peak/, 'the false reason is gone');
    assert.match(t, /no high-pass follows a voice/);
    assert.match(t, /square at E2/, 'the reason names a setting where it holds');
  }
  // The facts behind it (48 kHz, 1.5 s, the second half judged).
  const sr = 48000; // the rate of these computed signals
  const n = Math.round(1.5 * sr);
  const sig = (fn) => Float64Array.from({ length: n }, (_, i) => fn(i / sr));
  const w = (f, t) => 2 * Math.PI * f * t;
  const e2 = 82.4069;
  const square = sig((t) => {
    let s = 0;
    for (let k = 1; k * e2 < sr / 2; k += 2) s += Math.sin(w(k * e2, t)) / k;
    return (4 / Math.PI) * s;
  });
  const ring = sig((t) => Math.sin(w(220, t)) ** 2);
  const am = sig((t) => Math.sin(w(220, t)) * (0.5 + 0.5 * Math.sin(w(220, t))));
  for (const fc of [5, 20]) {
    assert.ok(highPassPeakRatio(square, fc, sr) > 1.1, `a square at E2 rises at ${fc} Hz`);
    assert.ok(highPassPeakRatio(ring, fc, sr) < 0.55, `ring of sines at ratio 1 falls at ${fc} Hz`);
    assert.ok(highPassPeakRatio(am, fc, sr) < 0.8, `AM of sines at ratio 1 falls at ${fc} Hz`);
  }
});
