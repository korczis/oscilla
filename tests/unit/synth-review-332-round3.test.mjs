// Review of #332, round 3 (K090, K121): what the engines must do, on the fake Web Audio context
// (the measured pitch is tests/browser/synth-engines.cjs o-pitch, from A0 to A4).
//   P2  the FM stack's DC block rang at bass notes (±50-230 cents for 0.2-0.5 s): a modulator
//       that is itself modulated is a phase operator instead (round 2's P1 test holds its
//       structure); its shaper curves are cos(Φ x) and sin(Φ x) with x = 0 a curve point, and
//       the help and the face say what it is, not a DC block
//   P3  the ring and AM face states the DC of coinciding lines at the settings that have it,
//       on the plate (the facts), not only in the help
import test from 'node:test';
import assert from 'node:assert/strict';
import { FM_PHASE_CURVE_POINTS, phaseCurve } from '../../src/js/studio/adapters/engines.js';
import { amDcText } from '../../src/js/studio/nodes/engines.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import fs from 'node:fs';

test('P2 the phase curves: cos(Φ x) and sin(Φ x) on an odd grid, exact at x = 0', () => {
  assert.equal(FM_PHASE_CURVE_POINTS % 2, 1);
  for (const phi of [0.5, 2, 10]) {
    const c = phaseCurve(Math.cos, phi);
    const s = phaseCurve(Math.sin, phi);
    const mid = (c.length - 1) / 2;
    assert.equal(c[mid], 1);
    assert.equal(s[mid], 0);
    for (const i of [0, 1, mid - 7, c.length - 1]) {
      const x = (2 * i - (c.length - 1)) / (c.length - 1);
      assert.ok(Math.abs(c[i] - Math.cos(phi * x)) < 1e-6, `cos at ${i}`);
      assert.ok(Math.abs(s[i] + s[c.length - 1 - i]) < 1e-7, `sin odd at ${i}`);
    }
  }
});

test('P2 the FM help, face and docs name the phase operator, not a DC block', () => {
  const def = NODE_REGISTRY.get('fm-voice');
  const docs = fs.readFileSync(new URL('../../docs/synth.md', import.meta.url), 'utf8');
  for (const text of [def.help.constraints, docs]) {
    assert.doesNotMatch(text, /DC block/);
    assert.match(text, /phase-modulated by its inputs/);
    assert.match(text, /within 5 cents from 50 ms after it/);
  }
  assert.match(def.facts({ algorithm: '4-stack' }), /no 0 Hz line and holds the pitch/);
  assert.doesNotMatch(def.facts({ algorithm: '4-three' }), /0 Hz/);
});

test('P3 the ring and AM plate states the DC of coinciding lines', () => {
  const facts = NODE_REGISTRY.get('am-voice').facts;
  const sines = { carrier: 'sine', modulator: 'sine', depth: 1 };
  assert.match(facts({ ...sines, mode: 'ring', ratio: 1 }),
    /DC: at ratio 1 the two sines coincide, so the product has a mean of half the voice's peak/);
  assert.match(facts({ ...sines, mode: 'am', ratio: 1, depth: 0.6 }), /mean of 0\.15 of the/);
  assert.match(facts({ ...sines, mode: 'ring', ratio: 1 }), /not removed: a high-pass/);
  assert.equal(amDcText({ ...sines, mode: 'ring', ratio: 1.25 }), null);
  assert.equal(amDcText({ ...sines, mode: 'ring', ratio: 2 }), null);
  // a square has odd harmonics: its 3rd meets a sine modulator at ratio 3, nothing at ratio 2
  const sq = { carrier: 'square', modulator: 'sine', mode: 'ring', depth: 1 };
  assert.match(amDcText({ ...sq, ratio: 3 }), /harmonic 3 of the carrier and harmonic 1 of the/);
  assert.equal(amDcText({ ...sq, ratio: 2 }), null);
  // a saw has every harmonic: ratio 1.5 puts its 3rd on the modulator's 2nd
  assert.match(amDcText({ carrier: 'sawtooth', modulator: 'sawtooth', mode: 'am', depth: 1,
    ratio: 1.5 }), /harmonic 3 of the carrier and harmonic 2 of the modulator/);
  assert.equal(amDcText({ carrier: 'sine', modulator: 'square', mode: 'ring', depth: 1,
    ratio: 0.5 }), null);
  assert.match(amDcText({ carrier: 'sine', modulator: 'sawtooth', mode: 'ring', depth: 1,
    ratio: 0.5 }), /harmonic 1 of the carrier and harmonic 2 of the modulator/);
});
