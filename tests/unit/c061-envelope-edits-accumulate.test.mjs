// C061: the Studio Envelope node accumulates its live edits. The runtime hands update() only the
// keys that changed (runtime.js node-params), so the adapter must merge each change into the
// parameters it keeps; rebuilding from the creation parameters plus the latest change lost
// every earlier edit (attack 1.5 s, then decay 0.7 s: the next gate played the creation attack).
// On the fake audio context (engine-fixture.mjs builds the adapter as the compiler does):
//   - update({attack: 1.5}), update({decay: 0.7}), gate: the attack ramps over 1.5 s and the
//     decay over 0.7 s;
//   - sustain and release after two or more updates reach the gate and its release;
//   - an update of one key leaves every other edited key as last set.
//   node --test tests/unit/c061-envelope-edits-accumulate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENVELOPE_FLOOR, getSchedule } from '../../src/js/audio/envelope.js';
import { engineEnv } from './engine-fixture.mjs';

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b}`);

/** The envelope's gain params (VCA gain, contour offset when the context has one). */
function envParams(h) {
  const out = [h.inputs.audio.gain];
  if (h.outputs.control) out.push(h.outputs.control.offset);
  return out;
}

/** The attack peak, the decay end and the release floor a gate at t scheduled on a param. */
function gateSegments(param, t) {
  const ev = getSchedule(param).filter((e) => e.time > t);
  const attack = ev.find((e) => e.kind === 'linear' && e.value === 1);
  const decay = ev.find((e) => e.kind === 'exp' && attack && e.time > attack.time);
  const release = ev.find((e) => e.kind === 'exp' && decay && e.time > decay.time
    && e.value === ENVELOPE_FLOOR);
  return { attack, decay, release };
}

test('C061: attack 1.5 s then decay 0.7 s: the next gate plays both edits', () => {
  const { h } = engineEnv('envelope');
  h.update({ attack: 1.5 }, new Set(), {});
  h.update({ decay: 0.7 }, new Set(), {});
  const t = 10;
  h.gate(t);
  for (const p of envParams(h)) {
    const { attack, decay } = gateSegments(p, t);
    assert.ok(attack && decay, 'the gate schedules an attack and a decay');
    close(attack.time - t, 1.5, 'the attack ramps over the edited 1.5 s');
    close(decay.time - attack.time, 0.7, 'the decay ramps over the edited 0.7 s');
  }
  assert.equal(h.info.adsr().a, 1.5);
  assert.equal(h.info.adsr().d, 0.7);
});

test('C061: sustain and release after several updates reach the gate and its release', () => {
  const { h } = engineEnv('envelope');
  h.update({ attack: 0.4 }, new Set(), {});
  h.update({ sustain: 0.3 }, new Set(), {});
  h.update({ release: 0.9 }, new Set(), {});
  h.update({ decay: 0.25 }, new Set(), {});
  const t = 20;
  const dur = 2;
  h.gate(t, dur);
  for (const p of envParams(h)) {
    const { attack, decay, release } = gateSegments(p, t);
    assert.ok(attack && decay && release, 'attack, decay and release are scheduled');
    close(attack.time - t, 0.4, 'attack');
    close(decay.time - attack.time, 0.25, 'decay');
    close(decay.value, 0.3, 'the decay ends at the edited sustain');
    close(release.time - (t + dur), 0.9, 'the release lasts the edited 0.9 s');
  }
  assert.deepEqual(h.info.adsr(), { a: 0.4, d: 0.25, s: 0.3, r: 0.9 });
});

test('C061: an update of one key leaves every other edited key as last set', () => {
  const { h, params } = engineEnv('envelope');
  const creation = { ...params };
  h.update({ attack: 1.5 }, new Set(), {});
  h.update({ decay: 0.7 }, new Set(), {});
  h.update({ sustain: 0.2 }, new Set(), {});
  h.update({ release: 1.1 }, new Set(), {});
  h.update({ attack: 0.05 }, new Set(), {});
  assert.deepEqual(h.info.adsr(), { a: 0.05, d: 0.7, s: 0.2, r: 1.1 });
  h.update({ sustain: 0.6 }, new Set(), {});
  assert.deepEqual(h.info.adsr(), { a: 0.05, d: 0.7, s: 0.6, r: 1.1 });
  // A release (timeline hook) uses the kept release too.
  const t = 30;
  h.gate(t);
  h.release(t + 1);
  for (const p of envParams(h)) {
    const tail = getSchedule(p).filter((e) => e.time > t + 1);
    const floor = tail.find((e) => e.kind === 'exp' && e.value === ENVELOPE_FLOOR);
    assert.ok(floor, 'the release ramps to the floor');
    close(floor.time - (t + 1), 1.1, 'the release lasts the edited 1.1 s');
  }
  assert.deepEqual(params, creation, 'the creation parameters object is not mutated');
});
