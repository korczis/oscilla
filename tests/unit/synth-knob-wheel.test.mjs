// K205 (K058 criterion 4, re-scoped 2026-11-07 to the shipped wheel; .ai/repo/reviews/420.yaml
// R8): the Synth knob's wheel rule, pinned on the gesture handler (src/js/synth/gestures.js)
// with a fake DOM so it cannot drift. A plain wheel over a knob turns it, focused or not, by
// the wheel step (ui/synth/knob.js wheelValue), takes the event from the page, and a burst of
// notches is one history entry; Ctrl or Cmd with the wheel (the page's pinch zoom) and a
// horizontal swipe leave the value and the history alone and the event to the page.
//   node --test tests/unit/synth-knob-wheel.test.mjs
// Test-only: the rule shipped with #420; this file passes on the merge base. What makes it
// evidence is that each mutation of the rule fails it: dropping the Ctrl/Cmd guard, the
// horizontal guard or the burst timer (measured on 2026-11-09, see tests/README.md).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGestures } from '../../src/js/synth/gestures.js';
import { GESTURE_IDLE_MS } from '../../src/js/ui/synth/feel.js';
import { WHEEL_NOTCH_PX, wheelValue } from '../../src/js/ui/synth/knob.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';

const PARAM = NODE_REGISTRY.param('vco', 'tune'); // -1200..1200 cents, step 1

/** A knob element of the panel as ui.js renders it: data-knob, not focused. */
function knobEl(cid, { disabled = false } = {}) {
  const el = {
    dataset: { knob: cid },
    getAttribute: (a) => (a === 'aria-disabled' ? String(disabled) : null),
    closest: (sel) => (sel === '[data-knob]' ? el : null),
  };
  return el;
}

/** The gesture handler over one knob control, with its value, writes and history recorded. */
function rig(start = 0) {
  const state = { value: start, writes: [], gestures: [], open: 0 };
  const x = { node: 'vco-1', c: { param: PARAM } };
  const g = createGestures({
    controlOf: (cid) => (cid === 'vco.tune' ? x : null),
    valueOf: () => state.value,
    setControl: (cid, v) => { state.writes.push([cid, v]); state.value = v; },
    handle: () => ({
      beginGesture: (label) => { state.open += 1; state.gestures.push(['begin', label]); },
      endGesture: () => { state.open -= 1; state.gestures.push(['end']); },
    }),
    say: () => {},
    label: () => 'VCO Tune',
  });
  return { g, state, el: knobEl('vco.tune') };
}

/** A wheel event over `target`; `prevented` records whether the handler took it from the page. */
function wheelEvent(target, over = {}) {
  const e = { target, deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false,
    shiftKey: false, prevented: false, ...over };
  e.preventDefault = () => { e.prevented = true; };
  return e;
}

test('a plain wheel notch over an unfocused knob turns it by the wheel step and takes the event',
  (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { g, state, el } = rig(0);
    const up = wheelEvent(el, { deltaY: -WHEEL_NOTCH_PX });
    g.wheel(up);
    const want = wheelValue(0, -WHEEL_NOTCH_PX, PARAM).value;
    assert.ok(want > 0, 'a notch up raises the value');
    assert.equal(state.value, want, 'the value moved by the wheel step');
    assert.equal(up.prevented, true, 'the page does not scroll over the knob');
    const down = wheelEvent(el, { deltaY: WHEEL_NOTCH_PX });
    g.wheel(down);
    assert.equal(state.value, 0, 'a notch down brings it back');
  });

test('a burst of notches is one history entry, closed GESTURE_IDLE_MS after its last notch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { g, state, el } = rig(0);
  for (let i = 0; i < 5; i += 1) {
    g.wheel(wheelEvent(el, { deltaY: -WHEEL_NOTCH_PX }));
    t.mock.timers.tick(GESTURE_IDLE_MS - 1); // each notch arrives before the burst would close
  }
  assert.deepEqual(state.gestures, [['begin', 'VCO Tune']], 'one gesture opened, still open');
  assert.equal(state.writes.length, 5, 'five notches, five writes');
  t.mock.timers.tick(1);
  assert.deepEqual(state.gestures, [['begin', 'VCO Tune'], ['end']], 'one entry, closed');
  assert.equal(state.open, 0);
});

test('Ctrl or Cmd with the wheel stays the page\'s pinch: no value, no history, no preventDefault',
  (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const { g, state, el } = rig(100);
      const e = wheelEvent(el, { deltaY: -WHEEL_NOTCH_PX, ...mod });
      g.wheel(e);
      assert.equal(state.value, 100, `${Object.keys(mod)[0]}: the value is unchanged`);
      assert.deepEqual(state.writes, []);
      assert.deepEqual(state.gestures, [], 'no history entry');
      assert.equal(e.prevented, false, 'the event is left to the page (its zoom)');
    }
  });

test('a horizontal swipe over a knob stays the page\'s scroll', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { g, state, el } = rig(100);
  const e = wheelEvent(el, { deltaX: 120, deltaY: 30 });
  g.wheel(e);
  assert.equal(state.value, 100);
  assert.deepEqual(state.gestures, []);
  assert.equal(e.prevented, false);
});

test('a disabled knob leaves the wheel to the page', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { g, state } = rig(100);
  const e = wheelEvent(knobEl('vco.tune', { disabled: true }), { deltaY: -WHEEL_NOTCH_PX });
  g.wheel(e);
  assert.equal(state.value, 100);
  assert.equal(e.prevented, false);
});
