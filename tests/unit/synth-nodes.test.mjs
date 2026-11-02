// K059, K060 (part): the Synth panel's node types Keys, VCO and Ring (src/js/studio/nodes/
// instrument.js, adapters/instrument.js), the pulse series (audio/additive.js pulseSeries) and
// the VCO's pitch clip, which keeps a keyboard's pitch exact and at or below 0.95 x Nyquist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE_REGISTRY, validateNodeDefinition } from '../../src/js/studio/registry.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import instrument, { KEYS_PITCH_RANGE, VCO_SCALES } from '../../src/js/studio/nodes/instrument.js';
import { pulseSeries } from '../../src/js/audio/additive.js';
import {
  PITCH_CLIP_POINTS, PITCH_SPAN_OCT, pitchCeilingOct, pitchClipCurve, ringLaw, vcoBaseHz,
} from '../../src/js/studio/adapters/instrument.js';
import { STUDIO_TEMPLATES, templateModel } from '../../src/js/studio/templates/index.js';
import { studioHash } from '../../src/js/studio/schema.js';

test('keys, vco and ring are registry types that validate, with adapters of their key', () => {
  for (const def of instrument) {
    assert.deepEqual(validateNodeDefinition(def), [], def.type);
    const reg = NODE_REGISTRY.get(def.type);
    assert.ok(reg, def.type);
    assert.equal(NODE_ADAPTERS[def.type].compiler, reg.compiler, def.type);
  }
  assert.equal(NODE_REGISTRY.get('keys').capabilities.notes, true);
});

test('Keys outputs pitch CONTROL [-6, 6] octaves, gate TRIGGER and velocity CONTROL', () => {
  const out = NODE_REGISTRY.ports('keys', 'out').map((p) => [p.id, p.type]);
  assert.deepEqual(out, [['pitch', 'CONTROL'], ['gate', 'TRIGGER'], ['velocity', 'CONTROL']]);
  assert.deepEqual([...KEYS_PITCH_RANGE], [-6, 6]);
  const vin = NODE_REGISTRY.ports('vco', 'in').map((p) => [p.id, p.type, p.param.mapping]);
  assert.deepEqual(vin, [['tune', 'CONTROL', 'linear'], ['pitch', 'CONTROL', 'linear'],
    ['fm', 'CONTROL', 'linear']], 'linear octave inputs: no frequency down-scaling');
});

test("VCO scale is footage to octaves against A4 at 8'", () => {
  assert.deepEqual({ ...VCO_SCALES }, { 32: -2, 16: -1, 8: 0, 4: 1 });
  assert.equal(vcoBaseHz('8'), 440);
  assert.equal(vcoBaseHz('16'), 220);
  assert.equal(vcoBaseHz('32'), 110);
  assert.equal(vcoBaseHz('4'), 880);
});

test('pulseSeries(w) is 2 sin(n pi w) / (n pi): the square at 50 %, every 4th null at 25 %', () => {
  for (const w of [0.05, 0.25, 0.5, 0.95]) {
    for (const p of pulseSeries(w, 64)) {
      assert.ok(Math.abs(p.gain - (2 * Math.sin(p.n * Math.PI * w)) / (p.n * Math.PI)) < 1e-9);
    }
  }
  const q = pulseSeries(0.25, 16);
  for (const n of [4, 8, 12, 16]) assert.ok(Math.abs(q[n - 1].gain) < 1e-12, `n=${n}`);
  const sq = pulseSeries(0.5, 16);
  for (const n of [2, 4, 6]) assert.ok(Math.abs(sq[n - 1].gain) < 1e-12);
});

test('the pitch clip is the identity below its knee and never above 0.95 x Nyquist', () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const scale of Object.keys(VCO_SCALES)) {
      const base = vcoBaseHz(scale);
      const curve = pitchClipCurve(pitchCeilingOct(base, rate));
      assert.equal(curve.length, PITCH_CLIP_POINTS);
      const mid = (PITCH_CLIP_POINTS - 1) / 2;
      const top = Math.max(...curve);
      // note 127 at 4' with tune +1200: pitch (127 - 69) / 12 + 1 octaves, saturating the clip.
      const ask = Math.min(1, ((127 - 69) / 12 + 1) / PITCH_SPAN_OCT);
      const i = Math.round((ask + 1) * mid);
      const f = base * 2 ** (curve[i] * PITCH_SPAN_OCT);
      assert.ok(f <= 0.95 * rate / 2 + 1e-6, `${rate} ${scale}: ${f}`);
      assert.ok(base * 2 ** (top * PITCH_SPAN_OCT) <= 0.95 * rate / 2 + 1e-6);
      for (let k = 0; k < PITCH_CLIP_POINTS; k += 97) {
        const x = (k - mid) / mid;
        if (x <= top) assert.equal(curve[k], Math.fround(x), 'identity below the knee');
      }
    }
  }
});

test('ring and AM laws: c.m, and c.(1 - d/2 + d/2.m)', () => {
  assert.deepEqual(ringLaw('ring', 0.3), { base: 0, scale: 1 });
  assert.deepEqual(ringLaw('am', 1), { base: 0.5, scale: 0.5 });
  assert.deepEqual(ringLaw('am', 0), { base: 1, scale: 0 });
});

test('new types leave every pinned template hash as it was', () => {
  for (const t of STUDIO_TEMPLATES) assert.equal(studioHash(templateModel(t.id)), t.studioHash);
});
