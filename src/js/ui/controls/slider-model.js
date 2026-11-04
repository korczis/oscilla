// ui-family: slider model
// The control family's one slider model (oscilla-21's G023, slice S): what a control whose
// handle slides along a travel means, on top of the knob model (knob-model.js) and never a copy
// of it. A fader's cap and a lever switch's handle follow the pointer over their travel, so the
// drag over the whole range is that travel at the zoom, and a press off the handle pages toward
// it. The value mapping, keys, wheel, drag and gestures are the knob model's. No listener, no
// document, no markup and no paint: a skin draws the travel this model measures
// (src/js/ui/synth/knob.js is the synth theme's and re-exports it).
//
//   FADER_TRAVEL, FADER_CAP, travelOf      a fader's travel (FADER_TRAVEL unless given), checked
//   faderPress                             a press: on the cap a relative grab, off it a page
//   switchPositions, leverOf, LEVER_SLOT   a lever switch: its positions and its handle's travel
//   pixelsPerRangeFor                      the drag over the whole range, every kind

import {
  choicesOf, clampValue, idOf, kindOf, knobKey, orientationOf,
  pixelsPerRangeFor as knobPixelsPerRange, pointOf, toNorm, zoomOf,
} from './knob-model.js';

/** A fader's cap travel, graph units: a drag over it at zoom z is FADER_TRAVEL × z px. */
export const FADER_TRAVEL = 64;
/** A fader's cap, graph units: w across the travel, h along it. */
export const FADER_CAP = Object.freeze({ w: 28, h: 14 });
/** A lever switch's slot, graph units: its length and the inset at each end. */
export const LEVER_SLOT = Object.freeze({ h: 28, inset: 2 });
/** A switch has at most this many positions; more options are a knob (a rotary selector). */
const SWITCH_MAX_POSITIONS = 4;

/** A fader's travel: FADER_TRAVEL unless given, at least FADER_CAP.h; any other kind has none. */
export function travelOf(kind, travel) {
  if (travel === undefined || travel === FADER_TRAVEL) return FADER_TRAVEL;
  if (kind !== 'fader') throw new Error(`travel: a ${kind} has none.`);
  if (!(typeof travel === 'number' && travel >= FADER_CAP.h && travel < Infinity)) {
    throw new RangeError(`travel: at least ${FADER_CAP.h} graph units, not ${travel}.`);
  }
  return travel;
}

/** How many positions a switch of `p` has: one per option of an enum (at most
 *  SWITCH_MAX_POSITIONS), two for a boolean. A number is refused: a switch cannot show the
 *  values between its ends, so a number is a knob or a fader. */
export function switchPositions(p) {
  const opts = choicesOf(p);
  if (!opts) {
    throw new Error(`${idOf(p)}: a switch is for an enum or a boolean; draw a number as a knob `
      + 'or a fader.');
  }
  if (opts.length > SWITCH_MAX_POSITIONS) {
    throw new Error(`${idOf(p)}: a switch has at most ${SWITCH_MAX_POSITIONS} positions, not `
      + `${opts.length}; switchSvg draws it as a rotary selector, or draw a knob.`);
  }
  return Math.max(2, opts.length);
}

/** A lever for `n` positions: its height and its travel inside the slot. */
export function leverOf(n) {
  const span = LEVER_SLOT.h - 2 * LEVER_SLOT.inset;
  const h = n <= 2 ? 12 : span / n;
  return { h, travel: span - h };
}

/** The drag, screen px, over a control's whole range at `zoom`: a knob's DRAG_PX_PER_RANGE (the
 *  knob model's answer); a fader's cap (`travel`: faders only) and a switch's lever follow the
 *  pointer: travel × zoom. */
export function pixelsPerRangeFor(kind, zoom = 1, param, { travel } = {}) {
  kindOf(kind, 'pixelsPerRangeFor');
  zoomOf(zoom, 'pixelsPerRangeFor');
  const tr = travelOf(kind, travel);
  if (kind === 'knob') return knobPixelsPerRange(kind, zoom, param);
  if (kind === 'fader') return tr * zoom;
  return leverOf(switchPositions(param)).travel * zoom;
}

/**
 * A press on a fader at `point` (graph units from its centre, page axes): on the cap's span
 * along the travel (FADER_CAP.h) { grab: true } with the value as it is, so the drag anchors
 * there and the cap never jumps to the pointer; elsewhere one page step toward the press, as
 * PageUp or PageDown (knobKey) would, held at the ends. `travel` is the fader's (controlSvg's;
 * FADER_TRAVEL unless given); vertical or horizontal (right is more).
 */
export function faderPress({ value, param, point, orientation = 'vertical',
  travel = FADER_TRAVEL } = {}) {
  const { x, y } = pointOf(point, 'faderPress');
  const along = orientationOf(orientation, 'fader') === 'vertical' ? -y : x;
  travelOf('fader', travel);
  const v = clampValue(value, param);
  const cap = travel * toNorm(v, param) - travel / 2;
  if (Math.abs(along - cap) <= FADER_CAP.h / 2) return { grab: true, value: v };
  const key = along > cap ? 'PageUp' : 'PageDown';
  return { grab: false, value: knobKey({ key }, { value: v, param }) };
}
