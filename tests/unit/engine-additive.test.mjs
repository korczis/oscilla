// K091: the additive engine. It reuses harmonicSeries for its shapes and buildPeriodicWave for
// the table; the drawbars are its harmonic amplitudes with a tilt in dB per octave; each note
// drops the harmonics above 0.95 × Nyquist of the running context and says how many.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonicSeries } from '../../src/js/audio/additive.js';
import { additivePartials, partialsBelow } from '../../src/js/studio/adapters/engines.js';
import { ADDITIVE_HARMONICS } from '../../src/js/studio/nodes/engines.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { defaults, engineEnv } from './engine-fixture.mjs';

test('drawbars are the harmonic amplitudes; a shape reuses harmonicSeries; tilt in dB/oct', () => {
  const p = { ...defaults('additive-voice'), h1: 1, h2: 0.5, h3: 0, h4: 0.25 };
  const d = additivePartials(p);
  assert.equal(d.length, ADDITIVE_HARMONICS);
  assert.deepEqual(d.slice(0, 4).map((x) => x.gain), [1, 0.5, 0, 0.25]);
  const saw = additivePartials({ ...p, shape: 'sawtooth' });
  assert.deepEqual(saw.map((x) => x.gain), harmonicSeries('sawtooth', 12).map((x) => x.gain));
  const tilted = additivePartials({ ...p, tilt: -6 });
  assert.ok(Math.abs(tilted[1].gain / 0.5 - 10 ** (-6 / 20)) < 1e-12, 'one octave: -6 dB');
  assert.ok(Math.abs(tilted[3].gain / 0.25 - 10 ** (-12 / 20)) < 1e-12, 'two octaves: -12 dB');
});

test('harmonics above 0.95 × Nyquist are dropped and counted, per running rate', () => {
  const all = additivePartials({ ...defaults('additive-voice'), shape: 'sawtooth' });
  const at48 = partialsBelow(all, 3000, 48000); // limit 22 800 Hz: n <= 7
  assert.equal(at48.kept.length, 7);
  assert.equal(at48.dropped, 5);
  const at44 = partialsBelow(all, 3000, 44100); // limit 20 947.5 Hz: n <= 6
  assert.equal(at44.kept.length, 6);
  assert.equal(at44.dropped, 6);
  assert.equal(partialsBelow(all, 100, 44100).dropped, 0);
});

test('the adapter plays one PeriodicWave per note range and reports what it dropped', () => {
  const { ctx, h } = engineEnv('additive-voice', { shape: 'square' });
  assert.equal(h.noteOn(0.1, 60, 100).dropped, 0);
  const r = h.noteOn(0.1, 108, 100); // 4186 Hz: 5 harmonics fit, the square's odd ones above go
  assert.ok(r.dropped > 0);
  assert.equal(h.info.dropped().dropped, r.dropped);
  const [low, high] = ctx.oscillators;
  assert.ok(low.wave && high.wave && low.wave !== high.wave);
  assert.ok(high.wave.imag.length <= 6);
});

test('the drawbars do nothing on a shape, and the face says so', () => {
  const def = NODE_REGISTRY.get('additive-voice');
  assert.match(def.inactive({ shape: 'square' }, 'h3'), /Drawbars/);
  assert.equal(def.inactive({ shape: 'custom' }, 'h3'), null);
  assert.equal(def.inactive({ shape: 'square' }, 'tilt'), null);
  assert.match(def.facts({}), /0\.95|Nyquist/);
});
