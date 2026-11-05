// 21's T2 on Train 6: a choice whose group is disabled (aria-disabled, its reason in
// `${cid}-why`) refused a click but still moved by the arrows, Home, End and the wheel
// (src/js/synth/gestures.js). Its keys now say the reason and change nothing, and the wheel is
// left to the page; an enabled choice still moves.
//
//   node --test tests/unit/synth-gestures-disabled.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGestures } from '../../src/js/synth/gestures.js';

function rig(disabled) {
  const set = [];
  const said = [];
  const group = { getAttribute: (k) => (k === 'aria-disabled' && disabled ? 'true' : null),
    dataset: { style: 'rotary' } };
  const option = { dataset: { option: 'vco1.waveform', v: 'saw' },
    closest: (q) => (q === '[data-option]' ? option
      : q === '[role="radiogroup"]' || q === 'svg[role="radiogroup"]' ? group : null) };
  const param = { type: 'enum', options: [['sine', 'Sine'], ['saw', 'Saw'], ['square', 'Sq']] };
  const x = { node: { id: 'n' }, c: { param, label: 'Wave' } };
  globalThis.document = { getElementById: (id) => (id === 'vco1.waveform-why'
    ? { textContent: 'Patched: the cable sets it.' } : null) };
  const g = createGestures({ controlOf: () => x, valueOf: () => 'saw',
    setControl: (cid, v) => set.push([cid, v]), say: (t) => said.push(t), label: () => 'Wave',
    handle: () => ({ beginGesture() {}, endGesture() {} }) });
  const key = (k) => {
    const e = { key: k, target: option, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    return { handled: g.choiceKey(e, null), e };
  };
  const wheel = () => {
    const e = { target: option, deltaY: 120, deltaMode: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    g.wheel(e);
    return e;
  };
  return { set, said, key, wheel, g };
}

test('a disabled choice says its reason on a key and moves on none; the wheel is the page\'s',
  () => {
    const r = rig(true);
    for (const k of ['ArrowRight', 'ArrowUp', 'Home', 'End']) {
      const { handled, e } = r.key(k);
      assert.equal(handled, true, `${k} is the choice's`);
      assert.equal(e.defaultPrevented, true);
    }
    assert.deepEqual(r.set, [], 'no key moved it');
    assert.deepEqual(r.said, Array(4).fill('Patched: the cable sets it.'));
    const w = r.wheel();
    assert.equal(w.defaultPrevented, false, 'the page scrolls');
    assert.deepEqual(r.set, [], 'the wheel moved nothing');
  });

test('an enabled choice still moves by a key and by the wheel', () => {
  const r = rig(false);
  r.key('ArrowRight');
  assert.deepEqual(r.set, [['vco1.waveform', 'square']]);
  const w = r.wheel();
  assert.equal(w.defaultPrevented, true);
  r.g.flush();
});
