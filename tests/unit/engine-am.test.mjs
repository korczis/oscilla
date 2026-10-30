// K121 (proposed): the AM and ring engine. It shares the Synth panel's ring law (adapters/
// instrument.js ringLaw) per voice; ring is c·m (the carrier suppressed), AM c·(1 − d/2 + d/2·m)
// with the carrier at 1 − d/2 and each sideband at d/4, which a DFT of the law confirms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ringLaw } from '../../src/js/studio/adapters/instrument.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { engineEnv, hasCycle } from './engine-fixture.mjs';

/** Amplitude of the line at bin k of x(t) = c(t)·(base + scale·m(t)) over one second. */
function line(law, fc, fm, k, N = 4096) {
  let re = 0;
  let im = 0;
  for (let j = 0; j < N; j++) {
    const t = j / N;
    const x = Math.cos(2 * Math.PI * fc * t) * (law.base + law.scale * Math.cos(2 * Math.PI * fm
      * t));
    re += x * Math.cos(2 * Math.PI * k * t);
    im += x * Math.sin(2 * Math.PI * k * t);
  }
  return (2 * Math.hypot(re, im)) / N;
}

test('ring suppresses the carrier; AM keeps it at 1 − d/2 with sidebands at d/4', () => {
  const ring = ringLaw('ring', 1);
  assert.ok(line(ring, 100, 30, 100) < 1e-9);
  assert.ok(Math.abs(line(ring, 100, 30, 70) - 0.5) < 1e-9);
  assert.ok(Math.abs(line(ring, 100, 30, 130) - 0.5) < 1e-9);
  for (const d of [0.4, 1]) {
    const am = ringLaw('am', d);
    assert.ok(Math.abs(line(am, 100, 30, 100) - (1 - d / 2)) < 1e-9, `d ${d} carrier`);
    assert.ok(Math.abs(line(am, 100, 30, 130) - d / 4) < 1e-9, `d ${d} sideband`);
  }
  const facts = NODE_REGISTRY.get('am-voice').facts;
  assert.match(facts({ mode: 'am', depth: 1 }), /carrier at 0\.50 and each sideband at 0\.25/);
  assert.match(facts({ mode: 'ring', depth: 1 }), /suppressed/);
});

test('the adapter: per voice, the modulator drives the carrier amplifier through the law', () => {
  const { ctx, h } = engineEnv('am-voice', { mode: 'am', depth: 0.6, ratio: 1.5 });
  h.noteOn(0.1, 69, 100);
  const [car, mod] = ctx.oscillators;
  assert.equal(car.frequency.calls[0][1], 440);
  assert.equal(mod.frequency.calls[0][1], 660);
  const vca = ctx.of('gain').find((g) => car.outputs.includes(g));
  const scale = ctx.of('gain').find((g) => mod.outputs.includes(g));
  assert.ok(scale.outputs.includes(vca.gain));
  assert.equal(vca.gain.calls[0][1], 1 - 0.3);
  assert.equal(scale.gain.calls[0][1], 0.3);
  assert.equal(hasCycle(ctx), false);
  assert.match(NODE_REGISTRY.get('am-voice').inactive({ mode: 'ring' }, 'depth'), /AM/);
});
