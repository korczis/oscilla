// T004 (truth-table row GEN-05): the Dual Oscillator difference readout names the route. Only
// the mono mix sums the two tones into one signal whose amplitude beats at |fA - fB| (claim
// dual-oscillator-beats); a Stereo split carries one steady tone per channel, so any beat is
// acoustic (speakers, depending on position) or perceptual (headphones), and binaural mode
// describes the perceptual phenomenon only (project.no-fake-science).
//   node --test tests/unit/readout-labels-dual-beat.test.mjs
// The three stereo V1 golden cases map back to the V1 text in tests/unit/freeze.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createInstrument } from '../../src/js/core/instrument.js';
import { bannedClaims } from './no-fake-science.test.mjs';

/** A dual instrument at fA/fB on the given route. */
function dualApp(fa, fb, { stereo = false, binaural = false } = {}) {
  const app = createInstrument({ engine: null });
  app.source = 'dual';
  Object.assign(app.dual.a, { freq: fa, detune: 0 });
  Object.assign(app.dual.b, { freq: fb, detune: 0 });
  app.dual.stereo = stereo;
  app.dual.binaural = binaural;
  return app;
}

const MONO_2HZ = 'Δf 2 Hz → amplitude beats at about 2 Hz (one every 500 ms).';
const NO_DIFFERENCE = 'No difference: no beating (the sum depends only on phase).';

test('mono mix, 440/442 Hz: the V1 amplitude-beat text, byte for byte', () => {
  const t = dualApp(440, 442).beatText;
  assert.equal(t, MONO_2HZ);
  assert.match(t, /amplitude beats at about 2 Hz/);
});

test('stereo split, 440/442 Hz: one tone per channel, no amplitude beats in the signal', () => {
  const t = dualApp(440, 442, { stereo: true }).beatText;
  assert.doesNotMatch(t, /amplitude beats/);
  assert.match(t, /one steady tone per channel/);
  assert.match(t, /no beat in the signal/);
  assert.match(t, /speakers/);
  assert.match(t, /acoustically/);
  assert.match(t, /headphones/);
  assert.match(t, /perceptual/);
  assert.match(t, /Δf 2 Hz/);
  assert.match(t, /one every 500 ms/);
});

test('binaural, 440/446 Hz: the perceptual beat only, no amplitude beats', () => {
  const t = dualApp(440, 446, { stereo: true, binaural: true }).beatText;
  assert.doesNotMatch(t, /amplitude beats/);
  assert.match(t, /perceptual/);
  assert.match(t, /binaural beat at about 6 Hz/);
  assert.match(t, /one tone per ear/);
  assert.match(t, /signal itself does not beat/);
  assert.match(t, /one every 167 ms/);
});

test('Δf = 0 keeps "no beating" on every route', () => {
  for (const route of [{}, { stereo: true }, { stereo: true, binaural: true }]) {
    assert.equal(dualApp(440, 440, route).beatText, NO_DIFFERENCE, JSON.stringify(route));
    assert.equal(dualApp(440, 440.004, route).beatText, NO_DIFFERENCE, JSON.stringify(route));
  }
});

test('the route texts make no claim project.no-fake-science bans', () => {
  for (const [fa, fb] of [[440, 442], [440, 446], [440, 480], [100, 900]]) {
    for (const route of [{}, { stereo: true }, { stereo: true, binaural: true }]) {
      const t = dualApp(fa, fb, route).beatText;
      assert.deepEqual(bannedClaims(t), [], `${fa}/${fb} ${JSON.stringify(route)}: ${t}`);
    }
  }
});
