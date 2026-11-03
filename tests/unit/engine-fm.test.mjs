// K090: the FM engine. Every algorithm is a DAG of 2-4 operators with at least one carrier; a
// modulator moves its target's frequency by Δf = I · f_mod Hz; there is no feedback parameter and
// the face says why (project.no-silent-feedback v1, Q022); an operator above 0.95 × Nyquist is
// left out of the note and counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FM_ALGORITHMS, FM_FEEDBACK_BLOCKED, operatorOrder, operatorRole,
} from '../../src/js/synth/fm-algorithms.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { engineEnv } from './engine-fixture.mjs';

test('every algorithm is a DAG of 2 to 4 operators with a carrier, in a modulators-first order', () => {
  assert.ok(FM_ALGORITHMS.length >= 6);
  for (const a of FM_ALGORITHMS) {
    assert.ok(a.ops >= 2 && a.ops <= 4, a.id);
    assert.ok(a.carriers.length >= 1, a.id);
    const order = operatorOrder(a.id);
    assert.equal(order.length, a.ops, a.id);
    for (const [m, t] of a.edges) {
      assert.ok(m <= a.ops && t <= a.ops && m !== t, `${a.id} ${m}->${t}`);
      assert.ok(order.indexOf(m) < order.indexOf(t), `${a.id}: ${m} before ${t}`);
      assert.ok(!a.carriers.includes(m), `${a.id}: a carrier modulates nothing`);
    }
  }
  assert.equal(operatorRole('2-op', 1), 'carrier');
  assert.equal(operatorRole('2-op', 2), 'modulator');
  assert.equal(operatorRole('2-op', 3), 'unused');
});

test('Δf = I · f_mod: the modulator drives the carrier frequency through a gain of I · f_mod', () => {
  const { ctx, h } = engineEnv('fm-voice', { algorithm: '2-op', ratio1: 1, ratio2: 2,
    index2: 2, modSustain: 1 });
  h.noteOn(0.1, 69, 100);
  const [carrier, modulator] = ctx.oscillators;
  assert.equal(carrier.frequency.calls[0][1], 440);
  assert.equal(modulator.frequency.calls[0][1], 880);
  const idx = ctx.of('gain').find((g) => g.outputs.includes(carrier.frequency));
  assert.ok(idx && modulator.outputs.includes(idx), 'modulator -> index gain -> carrier.frequency');
  assert.equal(idx.gain.calls[0][1], 2 * 880, 'I · f_mod Hz');
  assert.equal(idx.gain.calls[1][0], 'setTargetAtTime');
  assert.equal(idx.gain.calls[1][1], 2 * 880, 'Index sustain 1 holds the index');
});

test('no feedback parameter; the blocked sentence names the rule and Q022', () => {
  const def = NODE_REGISTRY.get('fm-voice');
  assert.ok(!def.params.some((p) => /feedback/i.test(p.key)));
  assert.match(FM_FEEDBACK_BLOCKED, /project\.no-silent-feedback/);
  assert.match(FM_FEEDBACK_BLOCKED, /Q022/);
  assert.match(def.help.constraints, /no-silent-feedback/);
});

test('the face says which operator knobs act at this algorithm', () => {
  const def = NODE_REGISTRY.get('fm-voice');
  const p = { algorithm: '2-op' };
  assert.match(def.inactive(p, 'index1'), /carrier/);
  assert.match(def.inactive(p, 'level2'), /modulator/);
  assert.match(def.inactive(p, 'ratio3'), /not used/);
  assert.equal(def.inactive(p, 'ratio2'), null);
  assert.equal(def.inactive({ algorithm: '4-parallel' }, 'level4'), null);
});

test('an operator above 0.95 × Nyquist is left out of the note and counted', () => {
  const { ctx, h } = engineEnv('fm-voice', { algorithm: '2-op', ratio2: 16 }, { sampleRate: 44100 });
  const r = h.noteOn(0.1, 96, 100); // 2093 Hz: the modulator at 33.5 kHz
  assert.equal(r.dropped, 1);
  assert.equal(ctx.oscillators.length, 1);
  assert.ok(ctx.oscillators[0].frequency.calls[0][1] <= 0.95 * 22050);
});
