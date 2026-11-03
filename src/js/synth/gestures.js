// The Synth panel's knob and choice gestures (F013 W1b, p2's real-browser review of 2026-11-03):
// the hand's side of a control, on the synth-theme layer's pure feel (ui/synth/feel.js) and
// knob arithmetic (ui/synth/knob.js), so ui.js only routes events. What it guarantees:
//   - a drag is measured from an anchor, and pressing or releasing Shift mid-drag re-anchors
//     where the value is, so nothing jumps (reanchorDrag);
//   - the wheel turns the knob under the pointer (1 % a notch, 0.1 % with Shift; wheelValue keeps
//     the remainder) or steps the choice under it once a notch, and the page does not scroll
//     there; a burst is one undo entry, ended GESTURE_IDLE_MS after its last notch;
//   - arrows, Home and End move a choice, and focus stays on the checked option;
//   - a knob's ARIA value is its 0..1000 position (N003, ariaAttrs), never the raw value;
//   - a choice whose group is disabled refuses a click with its reason.
//
//   createGestures({ controlOf, valueOf, setControl, handle, say, label }) ->
//     { press(cid, control, event) -> knob, drag(knob, event), wheel(event),
//       choiceKey(event, host) -> handled, aria(el, value, param, text), refused(el, cid) }

import { ariaAttrs, WHEEL_LINE_PX, WHEEL_NOTCH_PX, wheelValue } from '../ui/synth/knob.js';
import { dragAnchor, dragAt, GESTURE_IDLE_MS, reanchorDrag } from '../ui/synth/feel.js';
import { stepOption } from './view/knob.js';

const CHOICE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const ARIA = ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'];

export function createGestures({ controlOf, valueOf, setControl, handle, say, label }) {
  let burst = null;

  function press(cid, x, e) {
    return { cid, param: x.c.param, el: e.target.closest('[data-knob]'), moved: false,
      anchor: dragAnchor(valueOf(x), { x: e.clientX, y: e.clientY }, { fine: e.shiftKey }) };
  }

  function drag(knob, e) {
    const x = controlOf(knob.cid);
    if (!x) return;
    const at = { x: e.clientX, y: e.clientY };
    knob.anchor = reanchorDrag(knob.anchor, { value: valueOf(x), ...at, fine: e.shiftKey });
    const v = dragAt(knob.anchor, at, knob.param);
    if (v !== valueOf(x)) {
      knob.moved = true;
      setControl(knob.cid, v);
    }
  }

  function wheel(e) {
    const k = e.target.closest && e.target.closest('[data-knob]');
    const o = !k && e.target.closest && e.target.closest('[data-option]');
    const cid = k ? k.dataset.knob : o && o.dataset.option;
    const x = cid && controlOf(cid);
    if (!x || !x.node || (k && k.getAttribute('aria-disabled') === 'true')) return;
    e.preventDefault();
    if (!burst || burst.cid !== cid) {
      if (burst) { clearTimeout(burst.timer); handle().endGesture(); }
      burst = { cid, rest: 0, timer: 0 };
      handle().beginGesture(label(x));
    }
    clearTimeout(burst.timer);
    burst.timer = setTimeout(() => { burst = null; handle().endGesture(); }, GESTURE_IDLE_MS);
    if (k) {
      const r = wheelValue(valueOf(x), e.deltaY, x.c.param, { fine: e.shiftKey,
        deltaMode: e.deltaMode, rest: burst.rest });
      burst.rest = r.rest;
      if (r.value !== valueOf(x)) setControl(cid, r.value);
      return;
    }
    burst.rest += e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX
      : e.deltaMode === 2 ? WHEEL_NOTCH_PX : 1);
    while (Math.abs(burst.rest) >= WHEEL_NOTCH_PX) {
      const dir = burst.rest > 0 ? 1 : -1;
      burst.rest -= dir * WHEEL_NOTCH_PX;
      setControl(cid, stepOption(x.c.param, valueOf(x), -dir));
    }
  }

  function choiceKey(e, host) {
    const o = e.target.closest && e.target.closest('[data-option]');
    if (!o || !CHOICE_KEYS.has(e.key)) return false;
    const x = controlOf(o.dataset.option);
    if (!x) return false;
    e.preventDefault();
    const opts = x.c.param.options;
    // A toggle and a slide draw option 0 at the bottom and their radios run top to bottom
    // (view/face.js), so the keys move as drawn (review of W1c, finding 1): ArrowUp +1,
    // ArrowDown -1, Home and End the first and last radio in DOM order.
    const style = o.closest('svg[role="radiogroup"]')?.dataset.style;
    const drawn = style === 'toggle' || style === 'slide';
    const radios = drawn && [...o.closest('svg').querySelectorAll(
      `[data-option="${o.dataset.option}"]`)];
    const at = (r) => opts.find((p) => String(p[0]) === r.dataset.v)[0];
    const dir = e.key === 'ArrowLeft' || e.key === (drawn ? 'ArrowDown' : 'ArrowUp') ? -1 : 1;
    setControl(o.dataset.option, e.key === 'Home' ? (drawn ? at(radios[0]) : opts[0][0])
      : e.key === 'End' ? (drawn ? at(radios[radios.length - 1]) : opts[opts.length - 1][0])
        : stepOption(x.c.param, valueOf(x), dir));
    const again = host && host.querySelector(`[data-option="${o.dataset.option}"]`
      + '[aria-checked="true"]');
    if (again) again.focus({ preventScroll: true });
    return true;
  }

  function aria(el, value, param, text) {
    const a = ariaAttrs(value, param, () => text);
    for (const k of ARIA) el.setAttribute(k, String(a[k]));
  }

  function refused(el, cid) {
    const group = el.closest('[role="radiogroup"]');
    if (!group || group.getAttribute('aria-disabled') !== 'true') return false;
    const why = document.getElementById(`${cid}-why`);
    say(why ? why.textContent : 'This control is disabled.');
    return true;
  }

  return { press, drag, wheel, choiceKey, aria, refused };
}
