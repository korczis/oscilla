// The Synth bay's jack verdicts (src/js/synth/jack-verdicts.js jackOf, portOf, verdictsFor; rule
// project.typed-ports): from a jack, every jack of the other direction gets { ok, reason } (no
// verdict for jacks of the same direction); a jack of the same module is refused with its
// sentence, a type the port validator refuses gives the validator's sentence, a cable the panel
// itself refuses (normals.js jackReason) gives the panel's sentence, and the verdict is the same
// whichever end the cable starts from. On the semi-mono panel inserted into the reference
// template (tests/unit/synth-fixture.mjs).
//   node --test tests/unit/synth-jack-verdicts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { jackOf, portOf, verdictsFor } from '../../src/js/synth/jack-verdicts.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { panelStore } from './synth-fixture.mjs';

const SELF = 'Modul nelze propojit sám se sebou.';
const model = () => panelStore().getModel();
const verdicts = (id, m = model()) => verdictsFor(m, PANEL, NODE_REGISTRY, id);
const okKeys = (v) => [...v].filter(([, x]) => x.ok).map(([k]) => k);

test('jackOf finds a jack by its key, a port named for both directions apart; else null', () => {
  const out = jackOf(PANEL, 'vco1.audio:out');
  assert.equal(out.direction, 'out');
  assert.equal(out.module, 'vco1');
  assert.equal(out.port, 'audio');
  assert.equal(jackOf(PANEL, 'lpf.audio:in').direction, 'in');
  assert.equal(jackOf(PANEL, 'lpf.audio:out').direction, 'out');
  assert.equal(jackOf(PANEL, 'vco1.nope:out'), null);
  assert.equal(jackOf(PANEL, 'nope.audio:out'), null);
});

test('portOf is the registry port of the module\'s node type', () => {
  const j = jackOf(PANEL, 'lpf.frequency:in');
  const p = portOf(PANEL, NODE_REGISTRY, j);
  assert.equal(p, NODE_REGISTRY.port(PANEL.module('lpf').node, 'frequency', 'in'));
  assert.equal(p.role, 'PARAMETER');
});

test('an unknown jack has no verdicts; a known one judges every jack of the other direction',
  () => {
    assert.equal(verdicts('nope.x:in').size, 0);
    const v = verdicts('vco1.audio:out');
    const inputs = PANEL.modules.flatMap((m) => PANEL.jacksOf(m.id))
      .filter((j) => j.direction === 'in').map((j) => j.key);
    assert.deepEqual([...v.keys()].sort(), [...inputs].sort());
    assert.ok(![...v.keys()].some((k) => k.endsWith(':out')));
  });

test('a jack of the same module is refused; the types decide the rest', () => {
  const v = verdicts('vco1.audio:out');
  for (const k of ['vco1.tune:in', 'vco1.pitch:in', 'vco1.fm:in']) {
    assert.deepEqual(v.get(k), { ok: false, reason: SELF }, k);
  }
  // Audio into a signal input is allowed; into a control or trigger input it is not.
  assert.deepEqual(v.get('lpf.audio:in'), { ok: true, reason: null });
  assert.deepEqual(v.get('out.audio:in'), { ok: true, reason: null });
  assert.equal(v.get('lpf.frequency:in').ok, false);
  assert.match(v.get('lpf.frequency:in').reason, /^Audio output cannot connect to a control input/);
  assert.equal(v.get('eg1.gate:in').reason, 'Audio output cannot connect to a trigger input.');
});

test('a gate output reaches only the trigger inputs', () => {
  assert.deepEqual(okKeys(verdicts('keys.gate:out')).sort(),
    ['eg1.gate:in', 'eg2.gate:in', 'mg.reset:in', 'sh.trigger:in']);
});

test('a cable the panel refuses carries the panel\'s sentence, from either end', () => {
  const m = model();
  const fromOut = verdicts('eg1.control:out', m).get('sh.rate:in');
  assert.equal(fromOut.ok, false);
  assert.match(fromOut.reason, /^S&H Rychlost nemá účinek, dokud je zapojený Clock/);
  const fromIn = verdicts('sh.rate:in', m).get('eg1.control:out');
  assert.deepEqual(fromIn, fromOut, 'the same verdict whichever end the cable starts from');
  // A control output's other control inputs are open.
  assert.deepEqual(verdicts('eg1.control:out', m).get('lpf.frequency:in'), { ok: true,
    reason: null });
});

test('from an input, the outputs that may feed it', () => {
  const ok = okKeys(verdicts('out.audio:in'));
  assert.ok(ok.includes('vco1.audio:out') && ok.includes('lpf.audio:out'));
  assert.ok(ok.every((k) => k.endsWith(':out')));
  assert.equal(verdicts('out.audio:in').get('eg1.control:out').ok, false);
});
