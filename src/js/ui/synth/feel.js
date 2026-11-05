// The synth-theme layer's control feel (plan K058, slice S3 "knob and fader feel"): how a host
// turns pointer, key and wheel events into values and undo entries for knob.js's controls, as
// pure functions. Split from knob.js, which holds the value mapping and the drawing, so each
// stays inside the 40 000-byte source budget; this module imports from knob.js and never the
// other way. It adds no listener and reads no document: the host calls it from its own
// delegated listeners (K153 counts key listeners; this slice adds none).
//
//   dragAnchor, reanchorDrag, dragAt   a drag measured from an anchor; changing Shift mid-drag
//                                      re-anchors at the current value and pointer, so nothing
//                                      jumps, and the value never moves against the hand; the
//                                      anchor knows its kind, so only a fader drags horizontally
//   faderPress                         a press on a fader: on its cap a relative grab (it never
//                                      jumps to the pointer), on its slot one page step toward
//                                      the press; vertical or horizontal (right is more)
//   gestureOf, GESTURE_IDLE_MS         a held key (until its keyup), a wheel burst (until 400 ms
//                                      without a notch) or a drag is one gesture: one undo entry;
//                                      a lost pointerup or keyup never merges two gestures
//   cancelGesture                      Escape's contract: the value captured at gesture start
//
// Times are event.timeStamp's clock (performance.now(), ms): the host's idle tick stamps itself
// with performance.now(), and an idle tick or a wheel notch without a finite time is refused.
//
// The wheel step itself (1 % of the norm range per notch, Shift 0.1 %, with the carried rest)
// is knob.js's wheelValue and WHEEL_STEP.

import {
  clampValue, toNorm, dragValue, knobKey, controlBox, DRAG_PX_PER_RANGE, FADER_TRAVEL, FADER_CAP,
} from './knob.js';

function pointOf(pt, who) {
  const { x, y } = pt || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`${who}: a point needs a finite x and y, not (${x}, ${y}).`);
  }
  return { x, y };
}

/** The orientation, checked as controlSvg checks it: horizontal for a fader alone. */
const orientationOf = (o, kind = 'fader') => (controlBox(kind, o) === controlBox(kind)
  ? 'vertical' : 'horizontal');

/** Where a drag is measured from: the value and the pointer at the press (or at the last change
 *  of Shift), whether it is fine, the control's kind (knob, fader or switch; a knob unless
 *  given) and its orientation (horizontal, a fader's alone: right is more). */
export function dragAnchor(value, point, { fine = false, orientation = 'vertical',
  kind = 'knob' } = {}) {
  return Object.freeze({ value, ...pointOf(point, 'dragAnchor'), fine: Boolean(fine), kind,
    orientation: orientationOf(orientation, kind) });
}

/** The anchor after the host saw Shift (`fine`) with the current value and pointer: the same
 *  anchor while Shift is unchanged, else a new one there, so pressing or releasing Shift
 *  mid-drag moves nothing and the drag goes on from the value shown. */
export function reanchorDrag(anchor, { value, x, y, fine = false } = {}) {
  if (Boolean(fine) === anchor.fine) return anchor;
  return dragAnchor(value, { x, y }, { fine, orientation: anchor.orientation,
    kind: anchor.kind });
}

/** The value with the pointer at `point`: dragValue from the anchor (pixelsPerRangeFor gives a
 *  fader's), never against the hand (a coarse grid after a fine value holds it until the grid
 *  point ahead), and nothing without a move. */
export function dragAt(anchor, point, p, { pixelsPerRange = DRAG_PX_PER_RANGE } = {}) {
  const { x, y } = pointOf(point, 'dragAt');
  const d = anchor.orientation === 'horizontal' ? anchor.x - x : y - anchor.y;
  const next = dragValue(anchor.value, d, p, { fine: anchor.fine, pixelsPerRange });
  const v0 = clampValue(anchor.value, p);
  const moved = toNorm(next, p) - toNorm(v0, p);
  return d === 0 || Math.sign(moved) === Math.sign(d) ? v0 : next;
}

/**
 * A press on a fader at `point` (graph units from its centre, page axes): on the cap's span
 * along the travel (FADER_CAP.h) { grab: true } with the value as it is, so the drag anchors
 * there and the cap never jumps to the pointer; elsewhere one page step toward the press, as
 * PageUp or PageDown (knobKey) would, held at the ends. `travel` is the fader's (controlSvg's;
 * FADER_TRAVEL unless given).
 */
export function faderPress({ value, param, point, orientation = 'vertical',
  travel = FADER_TRAVEL } = {}) {
  const { x, y } = pointOf(point, 'faderPress');
  const along = orientationOf(orientation) === 'vertical' ? -y : x;
  controlBox('fader', orientation, { travel });
  const v = clampValue(value, param);
  const cap = travel * toNorm(v, param) - travel / 2;
  if (Math.abs(along - cap) <= FADER_CAP.h / 2) return { grab: true, value: v };
  const key = along > cap ? 'PageUp' : 'PageDown';
  return { grab: false, value: knobKey({ key }, { value: v, param }) };
}

/** A wheel burst ends after this many ms without a notch. */
export const GESTURE_IDLE_MS = 400;
/** knobKey's value keys: each held one autorepeats into one gesture. */
const RUN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp',
  'PageDown', 'Home', 'End']);
const gesture = (kind, from, at, key) => Object.freeze(key ? { kind, key, from, at }
  : { kind, from, at });
/** What a gesture may start from: a finite number, an option or a boolean. */
const isValue = (v) => Number.isFinite(v) || typeof v === 'boolean'
  || (typeof v === 'string' && v !== '');
/** The events whose time decides a wheel burst. */
const TIMED = new Set(['wheel', 'idle']);

/**
 * One undo entry per gesture. The host passes each event with the live gesture (`last`, null at
 * first) and the value before the event changes it; it records an entry for the gesture in
 * `end` (from end.from to the value now) unless `cancel`, and keeps `gesture` for the next call.
 * A held value key (keydown with repeat: true) is one gesture until its keyup or a blur; a
 * fresh keydown of it (repeat: false, after a keyup that never came) is a new one. A wheel burst
 * is one until GESTURE_IDLE_MS pass without a notch (the host's timer sends { type: 'idle',
 * timeStamp: performance.now() }; a wheel or idle event without a finite timeStamp throws).
 * pointerdown to pointerup, pointercancel or lostpointercapture is one drag, which owns the
 * control until it ends; a pointerdown inside it (its pointerup was lost) ends it and begins a
 * new one. A new gesture ends the live one, and begins only from a `value` (a finite number, an
 * option or a boolean; anything else throws, so Escape never restores nothing). Escape ends a
 * live gesture with `cancel` (cancelGesture gives the value to restore); with none it stays the
 * page's. Any other event changes nothing. Returns { begin, end, cancel, gesture }.
 */
export function gestureOf(event, last, { value } = {}) {
  const e = event || {};
  if (TIMED.has(e.type) && !Number.isFinite(e.timeStamp)) {
    throw new TypeError(`gestureOf: a ${e.type} event needs a finite timeStamp `
      + `(performance.now()), not ${e.timeStamp}.`);
  }
  const live = last && last.kind ? last : null;
  const t = Number.isFinite(e.timeStamp) ? e.timeStamp : (live ? live.at : 0);
  const out = (begin, end, now, cancel = false) => ({ begin, end, cancel, gesture: now });
  const escape = e.type === 'keydown' && e.key === 'Escape';
  const idle = live && live.kind === 'wheel' && t - live.at >= GESTURE_IDLE_MS ? live : null;
  const cur = idle ? null : live;
  const start = (kind, key) => {
    if (!isValue(value)) {
      throw new TypeError(`gestureOf: a ${kind} gesture begins from the value now (a finite `
        + `number, an option or a boolean), not ${String(value)}.`);
    }
    const g = gesture(kind, value, t, key);
    return out(g, cur || idle, g);
  };
  if (live && live.kind === 'drag') {
    if (e.type === 'pointerdown') return start('drag');
    if (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'lostpointercapture'
      || escape) return out(null, live, null, escape);
    return out(null, null, e.type === 'pointermove' ? gesture('drag', live.from, t) : live);
  }
  if (escape && cur) return out(null, cur, null, true);
  if (e.type === 'pointerdown') return start('drag');
  if (e.type === 'wheel') {
    return cur && cur.kind === 'wheel' ? out(null, null, gesture('wheel', cur.from, t))
      : start('wheel');
  }
  if (e.type === 'keydown' && RUN_KEYS.has(e.key)) {
    return cur && cur.kind === 'keys' && cur.key === e.key && e.repeat !== false
      ? out(null, null, gesture('keys', cur.from, t, e.key)) : start('keys', e.key);
  }
  if (cur && (e.type === 'blur' || (e.type === 'keyup' && cur.kind === 'keys'
    && e.key === cur.key))) return out(null, cur, null);
  return out(null, idle, idle ? null : cur);
}

/** Escape's contract: the value the gesture started from (null without a gesture). */
export const cancelGesture = (g) => (g && 'from' in g ? g.from : null);
