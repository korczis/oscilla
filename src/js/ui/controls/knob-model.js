// ui-family: knob model
// The control family's one knob model (plan K058's core, API agreed 2026-11-02; oscilla-21's
// G021-G023, slice S): what a knob, a fader or a switch means, as pure functions of the
// registry's parameter descriptor, apart from how any of them looks. A skin draws on top of it
// (src/js/ui/synth/knob.js is the synth theme's, and re-exports this module, so its importers
// keep their names); slider-model.js adds a fader's travel and press on top of it, never a copy.
// A setpoint (project.no-fake-science): nothing tweens. No listener, no document, no markup and
// no paint: a host calls knobKey and gestureOf from its own listeners (K153 counts them).
//
//   clampValue, toNorm, fromNorm, quantize, defaultValue, stepOption   value mapping
//   originOf                                                           where a value starts
//   valuePositions                                                     each value's position
//   dragValue, pixelsPerRangeFor, wheelValue, knobKey                  gestures -> the next value
//   parseValue                                                         typed entry (Enter)
//   formatValue, ariaAttrs                                             the value as text, ARIA
//   dragAnchor, reanchorDrag, dragAt, dragTo                           a drag from its anchor
//   gestureOf, cancelGesture, GESTURE_IDLE_MS                          one undo entry per gesture
//   choicesOf, optionIndex, idOf, orientationOf, zoomOf, kindOf,       shared with the slider
//   pointOf                                                            model and the skins
//
// The gestures were feel.js's (plan S3): a drag is measured from an anchor, and changing Shift
// mid-drag re-anchors at the current value and pointer, so nothing jumps and the value never
// moves against the hand; a held key (until its keyup), a wheel burst (until GESTURE_IDLE_MS
// without a notch) or a drag is one gesture, one undo entry, and a lost pointerup or keyup never
// merges two; Escape restores the value the gesture started from. Times are event.timeStamp's
// clock (performance.now(), ms).

import { formatFrequencyCompact, formatMs } from '../../core/frequency.js';
import { sig } from '../../core/math.js';
import { validateParamValue } from '../../studio/registry.js';

/**
 * The parameter a control edits: the registry's descriptor, as the node registry spells it.
 * @typedef {object} ControlParam
 * @property {string} [key] the parameter's key (or `id`): names it in errors and ids
 * @property {string} [id]
 * @property {string} [label] its name as shown and announced (else the key)
 * @property {string} [unit] 'Hz', 's', 'dB', 'cents', 'st', 'oct', '%' or any other text
 * @property {number} [min] a number's least value (above 0 on a log scale)
 * @property {number} [max] a number's greatest value, above min
 * @property {number} [step] the value grid, anchored at min; none or 0 is stepless
 * @property {'lin'|'linear'|'log'} [scale] equal differences (the default) or equal ratios
 * @property {*} [default] the value a double-click returns to
 * @property {'number'|'integer'|'enum'|'boolean'} [type] a number unless given
 * @property {Array<[*, string] | [*, string, string]>} [options] an enum's [value, label] pairs,
 *   in order; a third element is the option's short printed legend (a switch's legend where the
 *   label does not fit: 'Minor pent.'), narrower than the label, which stays its accessible name
 */

/** Vertical drag over the whole range of a knob, px; fine (Shift) divides it by FINE_DIV. */
export const DRAG_PX_PER_RANGE = 200;
export const FINE_DIV = 10;
/** The hit area's least side in screen px, at any zoom (the phone gates' 44 px target). */
export const HIT_PX = 44;
/** The knob's sweep: from -135° (minimum) to +135° (maximum), 0° up. */
export const SWEEP_DEG = 270;
/** A log range's key step: 1/LOG_STEPS of the norm range (0.5 %), Shift a tenth; K058's, kept
 *  by dev-53 on 2026-11-02 (the knob checks assume it; a log range spans decades). */
export const LOG_STEPS = 200;
/** One wheel notch, px; a line (deltaMode 1) is WHEEL_LINE_PX px, so a line-mode wheel's
 *  detent of 3 lines is exactly one notch; a page (2) is WHEEL_NOTCH_PX. */
export const WHEEL_NOTCH_PX = 100;
export const WHEEL_LINE_PX = 100 / 3;
/** An opposite wheel delta drops the carried rest only from this many px: less is jitter. */
const WHEEL_TURN_PX = 4;
/** A stepless linear range moves 1/KEY_DIVS of itself per key; PageUp/PageDown PAGE_STEPS. */
const KEY_DIVS = 100;
const PAGE_STEPS = 10;
/** A wheel notch: at least 1 % of the norm range (Shift 0.1 %), or one step on a coarser grid
 *  or an integer range of over WHEEL_FLOOR_MAX_STEPS steps (a seed). */
export const WHEEL_STEP = 0.01;
const WHEEL_FLOOR_MAX_STEPS = 1e4;
/** aria-valuenow is the position 0..ARIA_POSITIONS (N003). */
const ARIA_POSITIONS = 1000;
const LINEAR = new Set(['lin', 'linear']);
const BOOL_OPTIONS = Object.freeze([Object.freeze([false, 'Off']), Object.freeze([true, 'On'])]);
/** The kinds of control the family has: a knob turns, a fader and a switch slide. */
const KINDS = Object.freeze(['knob', 'fader', 'switch']);

// ---------------------------------------------------------------- value mapping

/** The parameter's name in errors and ids: its id, else its key, else 'param'. */
export const idOf = (p) => (p ? p.id ?? p.key ?? 'param' : 'param');
const labelOf = (p) => (p && p.label ? p.label : idOf(p));

/** The options of an enum, or Off/On of a boolean; null for a number. */
export function choicesOf(p) {
  if (p && p.type === 'boolean') return BOOL_OPTIONS;
  if (p && p.type === 'enum') {
    if (!Array.isArray(p.options) || p.options.length === 0) {
      throw new Error(`${idOf(p)}: an enum needs at least one option.`);
    }
    return p.options;
  }
  return null;
}

/** The position of `v` among the options; an unknown value reads the default, else the first. */
export function optionIndex(v, p, opts) {
  const i = opts.findIndex((o) => o[0] === v);
  if (i >= 0) return i;
  const d = opts.findIndex((o) => o[0] === p.default);
  return d >= 0 ? d : 0;
}

/** The descriptor's range, checked: finite, max above min, a known scale, log above zero. */
function rangeOf(p) {
  const id = idOf(p);
  const { min, max } = p || {};
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new Error(`${id}: a range needs a finite max above min (min ${min}, max ${max}).`);
  }
  const { scale } = p;
  if (scale !== undefined && !LINEAR.has(scale) && scale !== 'log') {
    throw new Error(`${id}: scale must be 'lin', 'linear' or 'log', not '${scale}'.`);
  }
  if (scale === 'log' && !(min > 0)) {
    throw new Error(`${id}: a log scale needs min > 0 (min is ${min}).`);
  }
  return { min, max, log: scale === 'log' };
}

const unit01 = (t) => (Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t)));
/** Float noise off (0.1 + 0.2 reads 0.3), and no more. */
const clean = (x) => Number(x.toPrecision(12));

/** The value grid: the step, a fine step (a tenth, or 1 for an integer), or 0 for stepless. */
function quantumOf(p, fine) {
  const integer = p.type === 'integer';
  const step = p.step > 0 ? p.step : (integer ? 1 : 0);
  if (!step || !fine) return step;
  return integer ? Math.max(1, Math.round(step / FINE_DIV)) : step / FINE_DIV;
}

/** A log range's grid at `x`: four significant digits (five fine), as K058 kept them. */
const relQuantum = (x, fine) => 10 ** (Math.floor(Math.log10(Math.abs(x))) - (fine ? 4 : 3));

/** The grid at `v`: the step (quantumOf), on a log range the relative grid where that is
 *  coarser or there is no step (S7: never finer than the step; fine a tenth); 0 stepless lin. */
function quantumAt(v, p, fine) {
  const q = quantumOf(p, fine);
  if (!rangeOf(p).log) return q;
  const r = relQuantum(clampValue(v, p), fine);
  return q && q >= r ? q : r;
}

/** `v` held to [min, max]; anything not a number reads min. A choice: a known option, else the
 *  default, else the first. */
export function clampValue(v, p) {
  const opts = choicesOf(p);
  if (opts) return opts[optionIndex(v, p, opts)][0];
  const { min, max } = rangeOf(p);
  if (typeof v !== 'number' || Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** The value as a position 0..1 along the control (log: equal ratios, equal distances). */
export function toNorm(v, p) {
  const opts = choicesOf(p);
  if (opts) return opts.length < 2 ? 0 : optionIndex(v, p, opts) / (opts.length - 1);
  const { min, max, log } = rangeOf(p);
  const x = clampValue(v, p);
  return log ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min);
}

/** The value at position `n` (0..1, clamped) along the control. */
export function fromNorm(n, p) {
  const opts = choicesOf(p);
  if (opts) return opts[Math.round(unit01(n) * (opts.length - 1))][0];
  const { min, max, log } = rangeOf(p);
  const t = unit01(n);
  if (t === 0) return min;
  if (t === 1) return max;
  return log ? min * (max / min) ** t : min + t * (max - min);
}

/** `v` clamped and snapped to the grid in value space: the step (fine: a tenth), anchored at
 *  min; on a log range four significant digits (fine: five) where coarser or stepless (S7). */
export function quantize(v, p, { fine = false } = {}) {
  if (choicesOf(p)) return clampValue(v, p);
  const { min, log } = rangeOf(p);
  let x = clampValue(v, p);
  const q = quantumOf(p, fine);
  const r = log ? relQuantum(x, fine) : 0;
  if (r && !(q && q >= r)) x = clampValue(Math.round(clean(x / r)) * r, p);
  else if (q) x = clampValue(min + Math.round(clean((x - min) / q)) * q, p);
  return clean(x);
}

/** Where a number's value is measured from: zero on a range across zero (its arc or fill
 *  starts there, with a detent), else min; null for a choice. Skins ask, never test the range. */
export function originOf(p) {
  if (choicesOf(p)) return null;
  const { min, max } = rangeOf(p);
  return min < 0 && max > 0 ? 0 : min;
}

/** The position (0..1) of every value an integer or a choice can take, in order, when it takes 2
 *  to `max` of them (a scale draws one mark per value); else, or for any other number, null. */
export function valuePositions(p, max) {
  const opts = choicesOf(p);
  if (opts) return opts.length >= 2 && opts.length <= max ? opts.map((o) => toNorm(o[0], p)) : null;
  if (p.type !== 'integer') return null;
  const { min, max: top } = rangeOf(p);
  const q = quantumOf(p, false);
  const count = Math.floor(clean((top - min) / q) + 1e-9) + 1;
  if (count < 2 || count > max) return null;
  return Array.from({ length: count }, (_, i) => toNorm(min + i * q, p));
}

/** The value a double-click returns to: the default, else min (a choice: its first option). */
export function defaultValue(p) {
  if (choicesOf(p)) return clampValue(p.default, p);
  const { min } = rangeOf(p);
  return quantize(p.default === undefined || p.default === null ? min : p.default, p);
}

/** The option `dir` places after `v` (before, for a negative dir), held to the ends; an unknown
 *  value counts from the first option. */
export function stepOption(p, v, dir) {
  const opts = choicesOf(p);
  if (!opts) throw new Error(`${idOf(p)}: stepOption needs an enum or a boolean.`);
  const i = opts.findIndex((o) => o[0] === v);
  const j = Math.min(opts.length - 1, Math.max(0, (i < 0 ? 0 : i) + Math.trunc(dir || 0)));
  return opts[j][0];
}

/** `steps` key steps from `value`: the step on a stepped linear range, 1 % of a stepless one,
 *  1/LOG_STEPS of a log one's norm range; fine a tenth; at least one grid unit; a choice
 *  `steps` options. */
function nudge(value, p, steps, fine) {
  if (choicesOf(p)) return stepOption(p, clampValue(value, p), steps);
  const { min, max, log } = rangeOf(p);
  const v = clampValue(value, p);
  const q = quantumAt(v, p, fine);
  const div = fine ? FINE_DIV : 1;
  let next;
  if (!log && q) next = v + steps * q;
  else if (!log) next = v + (steps * (max - min)) / (KEY_DIVS * div);
  else next = fromNorm(toNorm(v, p) + steps / (LOG_STEPS * div), p);
  const out = quantize(next, p, { fine });
  if (q && steps && out === quantize(v, p, { fine })) {
    return quantize(v + Math.sign(steps) * q, p, { fine });
  }
  return out;
}

/** PageUp/PageDown: 10 % of the norm range on the grid (K058), at least one grid unit, as a
 *  key; a choice one option. */
function page(value, p, dir) {
  if (choicesOf(p)) return stepOption(p, clampValue(value, p), dir);
  const v = clampValue(value, p);
  const out = quantize(fromNorm(toNorm(v, p) + dir / PAGE_STEPS, p), p);
  const q = quantumAt(v, p, false);
  if (q && out === quantize(v, p)) return quantize(v + dir * q, p);
  return out;
}

// ---------------------------------------------------------------- the kind, the zoom

/** `kind`, checked: a knob, a fader or a switch (`who` names the caller in the refusal). */
export function kindOf(kind, who) {
  if (!KINDS.includes(kind)) {
    throw new Error(`${who}: kind must be knob, fader or switch, not '${kind}'.`);
  }
  return kind;
}

/** `zoom`, checked: a finite number above 0 (`who` names the caller in the refusal). */
export function zoomOf(zoom, who) {
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`${who}: zoom must be a finite number above 0, not ${zoom}.`);
  }
  return zoom;
}

/** The orientation, checked: vertical (the default) or, for a fader alone, horizontal. */
export function orientationOf(o = 'vertical', kind = 'fader') {
  if (o !== 'vertical' && (o !== 'horizontal' || kind !== 'fader')) {
    throw new Error(`orientation: a ${kind} is vertical${kind === 'fader' ? ' or horizontal'
      : ''}, not '${o}'.`);
  }
  return o;
}

// ---------------------------------------------------------------- gestures

/**
 * The value after a vertical drag of `dy` px (pointer y now minus at the press; up, negative,
 * increases), from the start value, so a drag accumulates no rounding. The whole range is
 * `pixelsPerRange` px (pixelsPerRangeFor keeps a fader's cap under the finger); fine is a tenth.
 */
export function dragValue(startValue, dy, p, { fine = false,
  pixelsPerRange = DRAG_PX_PER_RANGE } = {}) {
  if (!(Number.isFinite(pixelsPerRange) && pixelsPerRange > 0)) {
    throw new RangeError(`dragValue: pixelsPerRange must be above 0, not ${pixelsPerRange}.`);
  }
  const d = Number.isFinite(dy) ? dy : 0;
  const n = toNorm(startValue, p) - (d / pixelsPerRange) / (fine ? FINE_DIV : 1);
  return quantize(fromNorm(n, p), p, { fine });
}

/**
 * The drag, screen px, over a knob's whole range at `zoom`: DRAG_PX_PER_RANGE at any zoom and
 * any size, since a knob turns and its drag is no distance on the drawing. A fader's cap and a
 * switch's lever follow the pointer over their travel instead: slider-model.js's
 * pixelsPerRangeFor answers for every kind and comes here for a knob.
 */
export function pixelsPerRangeFor(kind, zoom = 1, param, { travel } = {}) {
  if (kind !== 'knob') {
    throw new Error(`pixelsPerRangeFor: a ${kind}'s travel is slider-model.js's; `
      + 'this one answers for a knob.');
  }
  zoomOf(zoom, 'pixelsPerRangeFor');
  if (travel !== undefined) throw new Error('travel: a knob has none.');
  return DRAG_PX_PER_RANGE;
}

/**
 * The value after a wheel event, and the px carried to the next: deltaY × (deltaMode 1:
 * WHEEL_LINE_PX, 2: WHEEL_NOTCH_PX, else 1) plus `rest`; each WHEEL_NOTCH_PX is a notch (up,
 * deltaY < 0, increases), so a 3-line detent is one. The rest drops on a turn back of
 * WHEEL_TURN_PX or more (less is jitter) and at an end stop, so the first notch back moves;
 * under a notch the value is only clamped. A notch is a key step, WHEEL_STEP of the norm range
 * (fine a tenth; the grid point past it if the nearest is short) measured from the start's own
 * grid point (ERG-15: 0.511 up is 0.52), so from a value off the grid it can move less than
 * WHEEL_STEP (0.5149 up is 0.52) and never lands a grid unit past the notch; one step on an
 * integer range of over 10 000 steps (a seed); a choice an option. Arrow keys are exempt.
 */
export function wheelValue(value, deltaY, p, { fine = false, deltaMode = 0, rest = 0 } = {}) {
  const scale = deltaMode === 1 ? WHEEL_LINE_PX : (deltaMode === 2 ? WHEEL_NOTCH_PX : 1);
  const d = Number.isFinite(deltaY) ? deltaY * scale : 0;
  let carried = Number.isFinite(rest) ? rest : 0;
  if (carried !== 0 && Math.sign(d) === -Math.sign(carried) && Math.abs(d) >= WHEEL_TURN_PX) {
    carried = 0;
  }
  const px = d + carried;
  // Lines of 100/3 px sum with float error: within 1e-9 of a notch is one, of nothing none.
  const n = px / WHEEL_NOTCH_PX;
  const notches = Math.trunc(n + Math.sign(n) * 1e-9);
  const raw = px - notches * WHEEL_NOTCH_PX;
  const left = Math.abs(raw) < 1e-6 ? 0 : clean(raw);
  const v0 = clampValue(value, p);
  const dir = -Math.sign(px);
  const held = (v) => (dir > 0 && toNorm(v, p) >= 1) || (dir < 0 && toNorm(v, p) <= 0);
  const out = (v) => ({ value: v, rest: left === 0 || held(v) ? 0 : left });
  if (notches === 0) return out(v0);
  const steps = -notches;
  if (choicesOf(p)) return out(nudge(v0, p, steps, fine));
  let next = nudge(v0, p, steps, fine);
  const { min, max } = rangeOf(p);
  const identifier = p.type === 'integer'
    && (max - min) / (quantumOf(p, false) || 1) > WHEEL_FLOOR_MAX_STEPS;
  const floor = WHEEL_STEP / (fine ? FINE_DIV : 1);
  // ERG-15: the floor is measured from the start on the grid, so a notch from a fine value is
  // one notch from it, then quantised (0.511 up is 0.52), never a grid unit past it (0.53).
  const n0 = toNorm(quantize(v0, p, { fine }), p);
  const short = (v) => Math.abs(toNorm(v, p) - n0) < Math.abs(steps) * floor - 1e-12;
  if (!identifier && short(next)) {
    next = quantize(fromNorm(n0 + steps * floor, p), p, { fine });
    for (let i = 0; i < 4 && short(next) && !held(next); i++) {
      next = quantize(next + Math.sign(steps) * quantumAt(next, p, fine), p, { fine });
    }
  }
  return out(next);
}

/**
 * The answer to a key event, for the host's own listener: ArrowUp/Right +step, ArrowDown/Left
 * -step (Shift or `fine`: a tenth, an integer's least step; a choice: the next or previous
 * option); PageUp/PageDown 10 % (a choice: one option); Home min, End max; Enter { edit: true }
 * on a number (typed entry, parseValue), a boolean's other state, nothing on an enum; else, or
 * with Ctrl, Meta or Alt, null. Delete, Backspace, Space and Escape are the page's (K153).
 */
export function knobKey(e, { value, param, fine = false } = {}) {
  if (!e || typeof e.key !== 'string') return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const f = Boolean(fine) || Boolean(e.shiftKey);
  const opts = choicesOf(param);
  switch (e.key) {
    case 'ArrowUp': case 'ArrowRight': return nudge(value, param, 1, f);
    case 'ArrowDown': case 'ArrowLeft': return nudge(value, param, -1, f);
    case 'PageUp': return page(value, param, 1);
    case 'PageDown': return page(value, param, -1);
    case 'Home': return opts ? opts[0][0] : rangeOf(param).min;
    case 'End': return opts ? opts[opts.length - 1][0] : rangeOf(param).max;
    case 'Enter':
      if (!opts) return { edit: true };
      return param.type === 'boolean' ? !clampValue(value, param) : null;
    default: return null;
  }
}

// ---------------------------------------------------------------- typed entry

const NUMBER_TEXT = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(k)?\s*(.*)$/i;

const SPACES = /[    ]+/;

/**
 * Typed text made plain, or why it is refused: a leading U+2212 or en dash is '-'; a space
 * (thin, narrow or normal) groups thousands only as 1-3 digits then threes (4 294 967 295), else
 * malformed; one comma and no dot is the decimal mark (the owner's 1,5), but where it could
 * group thousands (1-3 digits not led by 0, then three) "1,000" is refused as ambiguous.
 */
function plainNumber(raw) {
  const t = raw.replace(/^[−–]/, '-').replace(/−/g, '-');
  const m = /^([-+]?)([\d.,][\d.,    ]*)(.*)$/.exec(t);
  if (!m) return { text: t };
  const [, sign, body, tail] = m;
  const head = body.replace(/[    ]+$/, '');
  const unitGap = body.slice(head.length);
  let num = head;
  if (SPACES.test(num)) {
    const groups = num.split(SPACES);
    const last = groups.length - 1;
    const ok = /^\d{1,3}$/.test(groups[0])
      && groups.slice(1).every((g, i) => (i + 1 === last ? /^\d{3}(?:[.,]\d+)?$/ : /^\d{3}$/)
        .test(g));
    if (!ok) {
      return { error: `"${raw.slice(0, 24)}" is malformed: group thousands by three `
        + '(1 000 000) or write the digits together.' };
    }
    num = groups.join('');
  }
  const commas = (num.match(/,/g) || []).length;
  if (commas > 0) {
    if (commas > 1 || num.includes('.')) {
      return { error: `"${raw.slice(0, 24)}" is not a number: use one decimal mark.` };
    }
    if (/^[1-9]\d{0,2},\d{3}$/.test(num)) {
      const [whole, part] = num.split(',');
      return { error: `"${raw.slice(0, 24)}" is ambiguous: write ${whole}${part} or `
        + `${whole}.${part.replace(/0+$/, '') || '0'}.` };
    }
    num = num.replace(',', '.');
  }
  return { text: `${sign}${num}${unitGap}${tail}` };
}

/** The units a typed value may carry for `p`, each with its factor to the parameter's unit. */
function unitsFor(p) {
  const u = String(p.unit || '').toLowerCase();
  const table = { '': 1 };
  if (u === 'hz') Object.assign(table, { hz: 1 });
  else if (u === 's') Object.assign(table, { s: 1, ms: 0.001 });
  else if (u === 'cents') Object.assign(table, { cents: 1, cent: 1, ct: 1 });
  else if (u) table[u] = 1;
  return table;
}

/**
 * Typed text read for `p`: a number with an optional k and unit (440, 2.5 kHz, 1k, 250 ms,
 * +12 st, -6 dB) checked by the registry's validateParamValue, an integer rounded; a choice by
 * label or value (Saw, sawtooth, On). { ok: true, value } or { ok: false, reason }.
 */
export function parseValue(text, p) {
  const raw = String(text ?? '').trim();
  const opts = choicesOf(p);
  if (opts) {
    const low = raw.toLowerCase();
    if (p.type === 'boolean' && (low === '1' || low === '0')) {
      return { ok: true, value: low === '1' };
    }
    const hit = opts.find(([v, label]) => String(label).toLowerCase() === low
      || String(v).toLowerCase() === low);
    return hit ? { ok: true, value: hit[0] }
      : { ok: false, reason: `${labelOf(p)} must be one of ${opts.map((o) => o[1]).join(', ')}.` };
  }
  const plain = plainNumber(raw);
  if (plain.error) return { ok: false, reason: plain.error };
  const m = NUMBER_TEXT.exec(plain.text);
  if (!m) return { ok: false, reason: `"${raw.slice(0, 24)}" is not a number.` };
  const units = unitsFor(p);
  const unit = m[3].trim().toLowerCase();
  const kAllowed = unit === '' || unit === 'hz';
  if (!Object.hasOwn(units, unit) || (m[2] && !kAllowed)) {
    return { ok: false, reason: `Unknown unit "${(m[2] || '') + m[3].trim()}" for ${labelOf(p)}`
      + `${p.unit ? ` (${p.unit})` : ''}.` };
  }
  let v = Number(m[1]) * (m[2] ? 1000 : 1) * units[unit];
  if (p.type === 'integer') v = Math.round(v);
  if (!Number.isFinite(v)) return { ok: false, reason: `"${raw.slice(0, 24)}" is not a number.` };
  const why = validateParamValue({ type: p.type === 'integer' ? 'integer' : 'number',
    min: p.min, max: p.max }, v);
  if (why) return { ok: false, reason: `${labelOf(p)} ${why}.` };
  // Stored as the readout shows it: the fine grid, or a stepless range's shown decimals.
  let stored = quantize(v, p, { fine: true });
  if (!quantumAt(stored, p, true)) {
    stored = clampValue(Number(stored.toFixed(fineDecimals(stored, p))), p);
  }
  return { ok: true, value: clean(stored) };
}

// ---------------------------------------------------------------- text and ARIA

/** A number's shortest text's decimals (1e-7: 7). */
function decimalsIn(x) {
  const s = String(x);
  const exp = /^-?([\d.]+)e([-+])(\d+)$/.exec(s);
  if (exp) {
    if (exp[2] === '+') return 0;
    const dot = exp[1].indexOf('.');
    return Number(exp[3]) + (dot < 0 ? 0 : exp[1].length - dot - 1);
  }
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** The most decimals worth showing at `v`: the fine step's, or for a stepless range those that
 *  resolve one fine key step there. */
function fineDecimals(v, p) {
  const fine = quantumAt(v, p, true);
  if (fine) return decimalsIn(clean(fine));
  const { min, max, log } = rangeOf(p);
  const res = log ? Math.abs(v) * ((max / min) ** (1 / (LOG_STEPS * FINE_DIV)) - 1)
    : (max - min) / (KEY_DIVS * FINE_DIV);
  if (!(res > 0 && Number.isFinite(res))) return 2;
  return Math.min(12, Math.max(0, Math.ceil(-Math.log10(res))));
}

/** The decimals the value's own grid has, capped at the fine step's. */
const ownDecimals = (v, p) => Math.min(decimalsIn(clean(v)), fineDecimals(v, p));

/** The significant digits of |v| at `d` decimals (at least 3, the units module's default). */
function digitsAt(v, d) {
  const s = Math.abs(v).toFixed(d).replace('.', '').replace(/^0+/, '');
  return Math.max(3, s.length);
}

const fixed = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
const signed = (text) => (Number(text) > 0 ? `+${text}` : text);

/** A time in seconds: the units module's text, with more digits only where the grid needs them. */
function timeText(v, d) {
  const digits = digitsAt(v, d);
  if (digits <= 3) return formatMs(v * 1000);
  return v < 1 ? `${sig(v * 1000, digits)} ms` : `${sig(v, digits)} s`;
}

/**
 * The value with its unit, shown and announced: frequencies and times through core/frequency.js;
 * cents, semitones, octaves signed (+5 ct, +12 st, +0.50 oct). The decimals are the step's or
 * the value's own grid's, capped at the fine step's, so a fine move shows (50.1 %) and none
 * shows more than its step needs (S7: 1 dB steps read -80 dB). A choice shows its label.
 */
export function formatValue(v, p) {
  const opts = choicesOf(p);
  if (opts) {
    const o = opts.find((x) => x[0] === v);
    return o ? String(o[1]) : String(v);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const own = ownDecimals(v, p);
  if (p.unit === 'Hz') return formatFrequencyCompact(v, digitsAt(v, own));
  if (p.unit === 's') return timeText(v, own);
  // The least decimals: the grid's at v (the step's), at most 2 without a step.
  const g = quantumAt(v, p, false);
  const base = Math.min(g ? decimalsIn(clean(g)) : 2, quantumOf(p, false) ? 15 : 2);
  let d = Math.max(base, own);
  // A value that rounds to zero reads as zero itself does (0 ct, never 0.0 ct).
  if (Number(fixed(v, d)) === 0) d = base;
  const text = fixed(v, d);
  switch (p.unit) {
    case 'cents': return `${signed(text)} ct`;
    case 'st': return `${signed(text)} st`;
    case 'oct': return `${signed(text)} oct`;
    case 'dB': return `${text} dB`;
    default: return p.unit ? `${text} ${p.unit}` : text;
  }
}

/** The spellings a text may end in for `p`'s unit; the first is the one this model writes. */
const unitSpellings = (unit) => (unit === 'cents' ? ['ct', 'cents'] : [unit]);

/** Whether `text` ends in `unit` (or a k/m/µ-prefixed `unit`) after a digit, space or start. */
function endsWithUnit(text, unit) {
  return unitSpellings(unit).some((spelling) => {
    const u = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\d\\s.])(?:[kmµu])?${u}$`).test(text.trim());
  });
}

/**
 * N003's controlAttrs shape (dev-53, 2026-11-02): role slider, valuemin 0, valuemax 1000,
 * valuenow round(toNorm(value) × 1000) (log in its log domain; a choice its option's position);
 * valuetext the value with its unit, true beyond the range (only the position clamps).
 * `format(v, param)` overrides the text, the unit added if it lacks it. A non-number reads min.
 */
export function ariaAttrs(value, p, format) {
  const opts = choicesOf(p);
  let v;
  if (opts) v = clampValue(value, p);
  else v = typeof value === 'number' && Number.isFinite(value) ? value : clampValue(value, p);
  const custom = typeof format === 'function';
  let text = custom ? String(format(v, p)) : formatValue(v, p);
  // A number's own text carries its unit; a custom text or an enum label gets it when it lacks it.
  if ((custom || (opts && p.type === 'enum')) && p.unit && !endsWithUnit(text, p.unit)) {
    text = `${text} ${unitSpellings(p.unit)[0]}`;
  }
  return { role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': ARIA_POSITIONS,
    'aria-valuenow': Math.round(toNorm(v, p) * ARIA_POSITIONS), 'aria-valuetext': text };
}

// ---------------------------------------------------------------- a drag from its anchor

/** `pt`, checked: a finite x and y (`who` names the caller in the refusal). */
export function pointOf(pt, who) {
  const { x, y } = pt || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`${who}: a point needs a finite x and y, not (${x}, ${y}).`);
  }
  return { x, y };
}

/** Where a drag is measured from: the value and the pointer at the press (or at the last change
 *  of Shift), whether it is fine, the control's kind (knob, fader or switch; a knob unless
 *  given) and its orientation (horizontal, a fader's alone: right is more). */
export function dragAnchor(value, point, { fine = false, orientation = 'vertical',
  kind = 'knob' } = {}) {
  return Object.freeze({ value, ...pointOf(point, 'dragAnchor'), fine: Boolean(fine), kind,
    orientation: orientationOf(orientation, kindOf(kind, 'dragAnchor')) });
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
 * A move of a drag (ERG-14): `{ value, anchor }`, the value dragAt gives with the pointer at
 * `point`, and the anchor the next move is measured from. Where the value stands at an end of
 * the range with the pointer pushing past it, the anchor moves there (that end, this point, the
 * same fine, kind and orientation), so an overshoot leaves no dead zone: the first move back
 * moves the value. Anywhere else the anchor is kept, the same object. A host keeps the returned
 * anchor for its next move; reanchorDrag still answers a change of Shift.
 */
export function dragTo(anchor, point, p, { pixelsPerRange = DRAG_PX_PER_RANGE } = {}) {
  const value = dragAt(anchor, point, p, { pixelsPerRange });
  const { x, y } = pointOf(point, 'dragTo');
  const d = anchor.orientation === 'horizontal' ? anchor.x - x : y - anchor.y;
  const n = toNorm(value, p);
  const past = (n >= 1 && d < 0) || (n <= 0 && d > 0);
  return Object.freeze({ value, anchor: past ? dragAnchor(value, { x, y }, { fine: anchor.fine,
    orientation: anchor.orientation, kind: anchor.kind }) : anchor });
}

// ---------------------------------------------------------------- one undo entry per gesture

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
