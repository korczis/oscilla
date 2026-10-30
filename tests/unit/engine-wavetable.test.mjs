// K092 and K089 (part): the wavetable engine. The morph weights are equal-power (Σ w² = 1); the
// banks hold four tables each; the hard-sync table is the closed-form Fourier series of a synced
// saw (ratio 1 is the saw, an integer ratio r has energy only at multiples of r, and it matches a
// time-domain DFT); morph is one audio-rate input driving four shapers into every voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonicSeries, syncedSawSeries } from '../../src/js/audio/additive.js';
import {
  MORPH_MAX, WAVETABLE_BANKS, morphCurve, morphText, morphWeight,
} from '../../src/js/synth/wavetables.js';
import { engineEnv, hasCycle } from './engine-fixture.mjs';

test('morph weights are equal-power: Σ w² = 1 over [0, 3], and at the curve points', () => {
  for (let m = 0; m <= MORPH_MAX + 1e-9; m += 0.01) {
    const s = [0, 1, 2, 3].reduce((a, i) => a + morphWeight(i, m) ** 2, 0);
    assert.ok(Math.abs(s - 1) < 1e-6, `m ${m}: ${s}`);
  }
  const curves = [0, 1, 2, 3].map((i) => morphCurve(i));
  for (let k = 0; k < curves[0].length; k++) {
    const s = curves.reduce((a, c) => a + c[k] ** 2, 0);
    assert.ok(Math.abs(s - 1) < 1e-6, `point ${k}`);
  }
  assert.equal(morphWeight(2, 2), 1);
  assert.match(morphText('basic', 0.5), /Sine 71 % · Triangle 71 %/);
});

test('every bank holds four tables of partials', () => {
  for (const [id, b] of Object.entries(WAVETABLE_BANKS)) {
    const tables = b.partials();
    assert.equal(tables.length, 4, id);
    assert.equal(b.tables.length, 4, id);
    for (const t of tables) assert.ok(t.some((p) => p.gain > 0) && t.every((p) => p.n >= 1), id);
  }
});

test('syncedSawSeries(1) is the saw; an integer ratio has energy only at its multiples', () => {
  const s = syncedSawSeries(1, 32);
  const saw = harmonicSeries('sawtooth', 32);
  for (let i = 0; i < 32; i++) {
    assert.ok(Math.abs(s[i].gain - saw[i].gain) < 1e-12, `gain ${i + 1}`);
    assert.ok(Math.abs(Math.cos(s[i].phase) - Math.cos(saw[i].phase)) < 1e-9, `phase ${i + 1}`);
  }
  for (const r of [2, 3]) {
    for (const p of syncedSawSeries(r, 48)) {
      if (p.n % r) assert.ok(p.gain < 1e-9, `r ${r}: harmonic ${p.n} is ${p.gain}`);
      else assert.ok(p.gain > 1e-3, `r ${r}: harmonic ${p.n} sounds`);
    }
  }
});

test('the closed form matches a time-domain DFT of the synced saw within 1e-3', () => {
  const N = 16384;
  for (const r of [1.5, 3, 4.5]) {
    const P = syncedSawSeries(r, 40);
    for (const p of P) {
      let re = 0;
      let im = 0;
      for (let j = 0; j < N; j++) {
        const x = j / N;
        const f = 2 * ((r * x + 0.5) % 1) - 1;
        re += f * Math.cos(2 * Math.PI * p.n * x);
        im += f * Math.sin(2 * Math.PI * p.n * x);
      }
      const g = Math.hypot((2 * re) / N, (2 * im) / N);
      assert.ok(Math.abs(g - p.gain) < 1e-3, `r ${r} n ${p.n}: ${g} vs ${p.gain}`);
    }
  }
});

test('the adapter: morph is an audio-rate input through four shapers into each voice', () => {
  const { ctx, h } = engineEnv('wavetable-voice', { morph: 1.5 });
  const t = h.modTarget('morph', 'linear');
  assert.ok(t.param, 'morph is modulatable');
  assert.match(h.modTarget('morph', 'log').reason, /logarithmic/);
  const shapers = ctx.of('waveshaper');
  assert.equal(shapers.length, 4);
  h.noteOn(0.1, 60, 100);
  h.noteOn(0.1, 64, 100);
  const voiceGains = ctx.of('gain').filter((g) => shapers.some((s) => s.outputs.includes(g.gain)));
  assert.equal(voiceGains.length, 8, 'four table gains per voice');
  assert.equal(ctx.oscillators.filter((o) => o.wave).length, 8);
  assert.equal(hasCycle(ctx), false);
  h.allOff(0.2, true);
  ctx.advance(3);
  for (const s of shapers) assert.equal(s.outputs.length, 0, 'ended voices are let go');
});
