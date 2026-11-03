// The synth-theme layer's control core (plan K058; control API agreed 2026-11-02): a knob,
// fader and switch as pure functions. Values come only from the registry's parameter descriptor
// ({ key or id, label, unit, min, max, step, scale: 'lin' | 'linear' | 'log', default, type:
// 'number' | 'integer' | 'enum' | 'boolean', options }); the control holds no parameter's
// constant. An enum or boolean is a row of positions (a switch draws up to four; a number is
// never a switch). The value is a setpoint (project.no-fake-science): nothing tweens it. No
// listener, no document: a host calls knobKey from its own delegated listener (K153 counts key
// listeners) and draws controlSvg in an HTML panel or an SVG graph at any zoom; ariaAttrs is
// N003's controlAttrs shape (aria-valuenow a 0..1000 position). Colours are tokens passed in
// (tokens.js; project.visual-identity-lock v3) and no number sets an opacity, alpha or shadow
// (v4): the cap highlight is class opacity-hw-sheen, the cap shadow opacity-hw-shadow.
// The feel (plan S3) is feel.js: drag anchors that re-anchor when Shift changes, the fader
// press, one gesture (one undo entry) per held key, wheel burst or drag, and Escape's cancel.
// Here: a wheel notch is WHEEL_STEP, 1 % of the norm range (Shift 0.1 %), with the carried
// rest; a fader turns horizontal (orientation, controlBox) with a 28 × 14 cap (FADER_CAP).
//
//   clampValue, toNorm, fromNorm, quantize, defaultValue, stepOption   value mapping
//   dragValue, pixelsPerRangeFor, wheelValue, knobKey                  gestures -> the next value
//   parseValue                                                         typed entry (Enter)
//   formatValue, ariaAttrs                                             the value as text, ARIA
//   controlSvg, controlBox, CONTROL_BOX, FADER_CAP                     the drawing, an SVG <g>

import { formatFrequencyCompact, formatMs } from '../../core/frequency.js';
import { sig } from '../../core/math.js';
import { validateParamValue } from '../../studio/registry.js';

/** Vertical drag over the whole range of a knob, px; fine (Shift) divides it by FINE_DIV. */
export const DRAG_PX_PER_RANGE = 200;
export const FINE_DIV = 10;
/** The hit area's least side in screen px, at any zoom (the phone gates' 44 px target). */
export const HIT_PX = 44;
/** The knob's sweep: from -135° (minimum) to +135° (maximum), 0° up. */
export const SWEEP_DEG = 270;
/** A fader's cap travel, graph units: a drag over it at zoom z is FADER_TRAVEL × z px. */
export const FADER_TRAVEL = 64;
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
/** A wheel notch: 1 % of the norm range (Shift: 0.1 %), or one step where the grid is coarser;
 *  an integer range of over WHEEL_FLOOR_MAX_STEPS steps (a seed, an identifier) steps by one. */
export const WHEEL_STEP = 0.01;
const WHEEL_FLOOR_MAX_STEPS = 1e4;
/** A switch draws at most this many positions; more options are a knob (a rotary selector). */
const SWITCH_MAX_POSITIONS = 4;
/** The ARIA position's range: aria-valuenow is the position 0..ARIA_POSITIONS (N003). */
const ARIA_POSITIONS = 1000;
const LINEAR = new Set(['lin', 'linear']);
const BOOL_OPTIONS = Object.freeze([Object.freeze([false, 'Off']), Object.freeze([true, 'On'])]);

// ---------------------------------------------------------------- value mapping

const idOf = (p) => (p ? p.id ?? p.key ?? 'param' : 'param');
const labelOf = (p) => (p && p.label ? p.label : idOf(p));

/** The options of an enum, or Off/On of a boolean; null for a number. */
function choicesOf(p) {
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
function optionIndex(v, p, opts) {
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

/** A log range's grid at `x`: four significant digits (five fine), as K058 kept them, so the
 *  bottom of a range spanning decades is as fine as its top. */
const relQuantum = (x, fine) => 10 ** (Math.floor(Math.log10(Math.abs(x))) - (fine ? 4 : 3));

/** The grid at `v`: a log range's relative grid where it is finer than the step, else the
 *  step (quantumOf); 0 for a stepless linear range. */
function quantumAt(v, p, fine) {
  const q = quantumOf(p, fine);
  if (!rangeOf(p).log) return q;
  const r = relQuantum(clampValue(v, p), fine);
  return q && q <= r ? q : r;
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

/** `v` clamped and snapped to the grid in value space: the step (fine: a tenth of it), anchored
 *  at min; on a log range four significant digits (fine: five) where that is finer. */
export function quantize(v, p, { fine = false } = {}) {
  if (choicesOf(p)) return clampValue(v, p);
  const { min, log } = rangeOf(p);
  let x = clampValue(v, p);
  const q = quantumOf(p, fine);
  const r = log ? relQuantum(x, fine) : 0;
  if (r && !(q && q <= r)) x = clampValue(Math.round(clean(x / r)) * r, p);
  else if (q) x = clampValue(min + Math.round(clean((x - min) / q)) * q, p);
  return clean(x);
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
 *  1/LOG_STEPS of a log one's norm range; fine a tenth. A step the grid would swallow moves one
 *  grid unit. A choice moves `steps` options. */
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

/** PageUp/PageDown: 10 % of the (norm) range, on the grid, as K058 states; a page the grid
 *  would swallow moves one grid unit, as a key does. A choice moves one option. */
function page(value, p, dir) {
  if (choicesOf(p)) return stepOption(p, clampValue(value, p), dir);
  const v = clampValue(value, p);
  const out = quantize(fromNorm(toNorm(v, p) + dir / PAGE_STEPS, p), p);
  const q = quantumAt(v, p, false);
  if (q && out === quantize(v, p)) return quantize(v + dir * q, p);
  return out;
}

// ---------------------------------------------------------------- gestures

/**
 * The value after a vertical drag of `dy` px from where it started (`dy` = pointer y now minus
 * at the press; up is negative, and up increases). Computed from the start value, so a drag
 * accumulates no rounding. The whole range is `pixelsPerRange` px (pixelsPerRangeFor(kind, zoom)
 * puts a fader's cap under the finger); fine divides the movement by 10.
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

/** The drag, screen px, over a control's whole range at `zoom`: a knob is turned, so
 *  DRAG_PX_PER_RANGE; a fader's cap and a switch's lever follow the pointer, so travel × zoom. */
export function pixelsPerRangeFor(kind, zoom = 1, param) {
  if (!Object.hasOwn(CONTROL_BOX, kind)) {
    throw new Error(`pixelsPerRangeFor: kind must be knob, fader or switch, not '${kind}'.`);
  }
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`pixelsPerRangeFor: zoom must be a finite number above 0, not ${zoom}.`);
  }
  if (kind === 'knob') return DRAG_PX_PER_RANGE;
  if (kind === 'fader') return FADER_TRAVEL * zoom;
  return leverOf(switchPositions(param)).travel * zoom;
}

/** The orientation, checked: vertical (the default) or, for a fader alone, horizontal. */
function orientationOf(o = 'vertical', kind = 'fader') {
  if (o !== 'vertical' && (o !== 'horizontal' || kind !== 'fader')) {
    throw new Error(`orientation: a ${kind} is vertical${kind === 'fader' ? ' or horizontal'
      : ''}, not '${o}'.`);
  }
  return o;
}

/**
 * The value after a wheel event, and the px the host carries to the next: deltaY × (deltaMode
 * 1: WHEEL_LINE_PX, 2: WHEEL_NOTCH_PX, else 1) plus `rest`; each WHEEL_NOTCH_PX is a notch (up,
 * deltaY < 0, increases), so a 3-line detent is one and fractional lines accumulate. The rest is
 * dropped on a turn back of WHEEL_TURN_PX or more (less is jitter and only subtracts) and at an
 * end stop, so the first notch back moves. Under a notch the value comes back only clamped. A
 * notch is a key step but at least WHEEL_STEP of the norm range (fine a tenth), except on an
 * integer range of over 10 000 steps (a seed: one notch, one step); a choice moves an option.
 * The arrow keys are exempt: the precise path, PageUp/PageDown the coarse one.
 */
export function wheelValue(value, deltaY, p, { fine = false, deltaMode = 0, rest = 0 } = {}) {
  const scale = deltaMode === 1 ? WHEEL_LINE_PX : (deltaMode === 2 ? WHEEL_NOTCH_PX : 1);
  const d = Number.isFinite(deltaY) ? deltaY * scale : 0;
  let carried = Number.isFinite(rest) ? rest : 0;
  if (carried !== 0 && Math.sign(d) === -Math.sign(carried) && Math.abs(d) >= WHEEL_TURN_PX) {
    carried = 0;
  }
  const px = d + carried;
  // Fractions of a line (100/3 px) accumulate with float error: a sum within 1e-9 of a notch
  // is that notch, and a rest within 1e-9 of nothing is nothing.
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
  const n0 = toNorm(v0, p);
  if (!identifier && Math.abs(toNorm(next, p) - n0) < Math.abs(steps) * floor - 1e-12) {
    next = quantize(fromNorm(n0 + steps * floor, p), p, { fine });
  }
  return out(next);
}

/**
 * The control's answer to a key event, for the host's own delegated listener: ArrowUp/Right
 * +step, ArrowDown/Left -step (Shift or `fine`: a tenth, an integer's smallest step; a choice:
 * the next or previous option); PageUp/PageDown 10 % of the range (a choice: one option); Home
 * min, End max; Enter { edit: true } on a number (the host opens a typed entry, parseValue),
 * the other state of a boolean, nothing on an enum; anything else, or with Ctrl, Meta or Alt,
 * null. Delete, Backspace, Space and Escape are the page's key registry's (K153, dev-53).
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

const SPACES = /[ \u00a0\u2009\u202f]+/;

/**
 * Typed text made plain, or why it is refused: a leading minus sign (U+2212) or en dash is '-';
 * a thin, narrow or normal space groups thousands only as 1-3 digits then groups of exactly 3
 * (4 294 967 295), else malformed; one comma with no dot is the decimal mark (the owner's locale
 * writes 1,5), except as a thousands separator could be (1-3 digits not led by 0, then three):
 * "1,000" is ambiguous and refused, so neither 1000 nor 1.0 is guessed.
 */
function plainNumber(raw) {
  const t = raw.replace(/^[\u2212\u2013]/, '-').replace(/\u2212/g, '-');
  const m = /^([-+]?)([\d.,][\d., \u00a0\u2009\u202f]*)(.*)$/.exec(t);
  if (!m) return { text: t };
  const [, sign, body, tail] = m;
  const head = body.replace(/[ \u00a0\u2009\u202f]+$/, '');
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
 * A typed value read for `p` (Enter, then text): a number with an optional k and unit (440,
 * 2.5 kHz, 1k, 250 ms, +12 st, -6 dB), checked by the registry's validateParamValue, an integer
 * rounded; a choice by its label or value (Saw, sawtooth, On, off). { ok: true, value } or
 * { ok: false, reason }.
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

/** The decimals a number's shortest text has (1e-7: 7). */
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

/** The least decimals `p` shows: its step's, or 2 for a stepless range. */
function stepDecimals(p) {
  const step = quantumOf(p, false);
  return step ? decimalsIn(step) : 2;
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
 * The value with its unit, as shown and announced. Frequencies and times go through the units
 * module (core/frequency.js); cents, semitones and octaves carry a sign (+5 ct, +12 st,
 * +0.50 oct), dB one decimal at least, anything else the step's decimals. The decimals follow
 * the value's own grid, capped at the fine step's, so a fine move shows (50.1 %). A choice shows
 * its label (Saw, On).
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
  const least = { oct: 2, dB: 1 }[p.unit] || 0;
  const base = Math.max(stepDecimals(p), least);
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

/** The spellings a text may end in for `p`'s unit; the first is the one this core writes. */
const unitSpellings = (unit) => (unit === 'cents' ? ['ct', 'cents'] : [unit]);

/** Whether `text` ends in `unit` (or a k/m/µ-prefixed `unit`) after a digit, space or start. */
function endsWithUnit(text, unit) {
  return unitSpellings(unit).some((spelling) => {
    const u = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\d\\s.])(?:[kmµu])?${u}$`).test(text.trim());
  });
}

/**
 * The ARIA attributes in N003's controlAttrs shape (dev-53, 2026-11-02): role slider, valuemin
 * 0, valuemax 1000, valuenow round(toNorm(value) × 1000) (a log parameter steps in its log
 * domain; a choice has its option index's position); valuetext the value with its unit, true
 * beyond the range (the position clamps, the text does not). `format(v, param)` overrides the
 * text, the unit added when it does not end in it. Anything not a number reads min, never NaN.
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

// ---------------------------------------------------------------- the drawing

const num = (x) => Number(x.toFixed(2));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rad = (deg) => ((deg - 90) * Math.PI) / 180;
const polar = (r, deg) => [num(r * Math.cos(rad(deg))), num(r * Math.sin(rad(deg)))];

/** An SVG arc around the origin from angle a to b (degrees, 0 up, clockwise). */
function arcPath(r, a, b) {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const [x0, y0] = polar(r, s);
  const [x1, y1] = polar(r, e);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

// Graph units, centred on the origin; the caller places the group. Every knob part stays
// inside the 44 box: the focus ring's outer edge is r 22, and the detent, at any angle, ends at
// r 21.75 so its butt corners do too (the scale ticks reach r 22 only at their fixed angles).
// The unlit arc is half the value arc's width (no token pair holds 3:1 between them), and the
// applied arc lies on the skirt face, between the cap and the knurl.
const KNOB = Object.freeze({ arc: 19, arcW: 3, trackW: 1.5, skirt: 16, edgeW: 1.5, knurlIn: 14.5,
  knurlOut: 16, knurls: 24, cap: 12, pointerIn: 4, pointerOut: 11, pointerW: 2.5,
  tickIn: 20.5, tickOut: 22, ticks: 11, tickZoom: 1.25, detentOut: 21.75, detentW: 1.5,
  applied: 13.5, appliedW: 1.5, appliedMinDeg: 5, focus: 21, focusW: 2, shadowDy: 1,
  shadowDragDy: 2 });
/** A disabled knob's value arc: dashed, butt-ended, so the gaps stay open. */
const DISABLED_DASH = '2 3';
/** A fader's cap, graph units: w across the travel, h along it. */
export const FADER_CAP = Object.freeze({ w: 28, h: 14 });
const FADER = { travel: FADER_TRAVEL, capW: FADER_CAP.w, capH: FADER_CAP.h, trackW: 4, grip: 3 };
const SWITCH = { w: 14, h: 28, inset: 2, leverW: 10 };
/** The cap highlight's intensity class: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The cap shadow's intensity class: the hw-shadow key, as the cable's shadow. */
const SHADOW_CLASS = 'opacity-hw-shadow';

/** Each kind's extent, graph units, centred on the origin: all controlSvg draws lies inside it
 *  (an SVG host's viewBox), and the hit rect is never smaller. */
export const CONTROL_BOX = Object.freeze({
  knob: Object.freeze({ x: -22, y: -22, width: 44, height: 44 }),
  fader: Object.freeze({ x: -22, y: -(FADER_TRAVEL / 2 + 10), width: 44,
    height: FADER_TRAVEL + 20 }),
  switch: Object.freeze({ x: -17, y: -18, width: 34, height: 36 }),
});

const FADER_ACROSS = Object.freeze({ x: CONTROL_BOX.fader.y, y: CONTROL_BOX.fader.x,
  width: CONTROL_BOX.fader.height, height: CONTROL_BOX.fader.width });

/** A kind's extent in an orientation: CONTROL_BOX, or a horizontal fader's, turned. */
export function controlBox(kind, orientation = 'vertical') {
  if (!Object.hasOwn(CONTROL_BOX, kind)) throw new Error(`controlBox: no kind '${kind}'.`);
  return orientationOf(orientation, kind) === 'vertical' ? CONTROL_BOX[kind] : FADER_ACROSS;
}

/** How many positions a switch of `p` has: one per option of an enum (at most
 *  SWITCH_MAX_POSITIONS), two for a boolean. A number is refused: a switch cannot show the
 *  values between its ends, so a number is a knob or a fader. */
function switchPositions(p) {
  const opts = choicesOf(p);
  if (!opts) {
    throw new Error(`${idOf(p)}: a switch is for an enum or a boolean; draw a number as a knob `
      + 'or a fader.');
  }
  if (opts.length > SWITCH_MAX_POSITIONS) {
    throw new Error(`${idOf(p)}: a switch has at most ${SWITCH_MAX_POSITIONS} positions, not `
      + `${opts.length}; draw it as a knob (a rotary selector).`);
  }
  return Math.max(2, opts.length);
}

/** A switch lever for `n` positions: its height and its travel inside the slot. */
function leverOf(n) {
  const span = SWITCH.h - 2 * SWITCH.inset;
  const h = n <= 2 ? 12 : span / n;
  return { h, travel: span - h };
}

/** Whether an applied value is given and sits elsewhere than the value. */
function appliedAt(applied, value, p) {
  if (applied === undefined || applied === null) return null;
  const a = clampValue(applied, p);
  return Math.abs(toNorm(a, p) - toNorm(value, p)) > 1e-9 ? a : null;
}

/** Radial strokes from r0 to r1 at each angle, as one path's 'M x y L x y' segments. */
function radialPath(r0, r1, angles) {
  return angles.map((deg) => {
    const [x0, y0] = polar(r0, deg);
    const [x1, y1] = polar(r1, deg);
    return `M ${x0} ${y0} L ${x1} ${y1}`;
  }).join(' ');
}

function knobShapes(value, applied, p, t, st, zoom) {
  const c = t.control;
  const dim = st.disabled;
  const half = SWEEP_DEG / 2;
  const angle = (v) => -half + SWEEP_DEG * toNorm(v, p);
  const a = angle(value);
  // A range across zero starts its arcs at zero (12 o'clock when the range is symmetric), with
  // a detent tick there; any other range starts at its minimum.
  const bipolar = p.min < 0 && p.max > 0;
  const origin = bipolar ? angle(0) : -half;
  let out = '';
  if (zoom >= KNOB.tickZoom) {
    const at = Array.from({ length: KNOB.ticks }, (_, i) => -half + (i * SWEEP_DEG)
      / (KNOB.ticks - 1));
    out += `<path d="${radialPath(KNOB.tickIn, KNOB.tickOut, at)}" data-ticks="" fill="none" `
      + `stroke="${esc(c.track)}" stroke-width="1"/>`;
  }
  if (bipolar) {
    const [dx0, dy0] = polar(KNOB.tickIn, origin);
    const [dx1, dy1] = polar(KNOB.detentOut, origin);
    out += `<line data-detent="" x1="${dx0}" y1="${dy0}" x2="${dx1}" y2="${dy1}" `
      + `stroke="${esc(c.track)}" stroke-width="${KNOB.detentW}"/>`;
  }
  // Disabled, the unlit arc takes the knurl's tone, so the dashed value arc stays apart.
  out += `<path d="${arcPath(KNOB.arc, -half, half)}" data-track="" fill="none" `
    + `stroke="${esc(dim ? c.knurl : c.track)}" stroke-width="${KNOB.trackW}" `
    + 'stroke-linecap="round"/>';
  if (Math.abs(a - origin) > 0.01) {
    out += `<path d="${arcPath(KNOB.arc, origin, a)}" data-ring="" fill="none" `
      + `stroke="${esc(dim ? c.disabled : c.ring)}" stroke-width="${KNOB.arcW}" `
      + (dim ? `stroke-dasharray="${DISABLED_DASH}"/>` : 'stroke-linecap="round"/>');
  }
  const knurl = Array.from({ length: KNOB.knurls }, (_, i) => (i * 360) / KNOB.knurls);
  out += `<circle data-skirt="" cx="0" cy="0" r="${KNOB.skirt}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(st.hover ? c.pointer : c.edge)}" stroke-width="${KNOB.edgeW}"/>`
    + `<path d="${radialPath(KNOB.knurlIn, KNOB.knurlOut, knurl)}" data-knurl="" fill="none" `
    + `stroke="${esc(c.knurl)}" stroke-width="1"/>`;
  if (applied !== null) {
    // From the same origin; at the origin itself a short arc, so the split is still seen.
    const b = angle(applied);
    const [s0, s1] = Math.abs(b - origin) < KNOB.appliedMinDeg
      ? [b - KNOB.appliedMinDeg / 2, b + KNOB.appliedMinDeg / 2] : [origin, b];
    out += `<path d="${arcPath(KNOB.applied, s0, s1)}" data-applied="" fill="none" `
      + `stroke="${esc(c.applied)}" stroke-width="${KNOB.appliedW}" stroke-linecap="round"/>`;
  }
  const [x0, y0] = polar(KNOB.pointerIn, a);
  const [x1, y1] = polar(KNOB.pointerOut, a);
  return out
    + `<circle data-shadow="" class="${SHADOW_CLASS}" cx="0" `
    + `cy="${st.dragging ? KNOB.shadowDragDy : KNOB.shadowDy}" r="${KNOB.cap}" `
    + `fill="${esc(t.surface.edge)}" stroke="none"/>`
    + `<circle data-cap="" cx="0" cy="0" r="${KNOB.cap}" fill="${esc(c.cap)}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`
    + `<ellipse class="${SHEEN_CLASS}" cx="-3.5" cy="-4.5" rx="5" ry="3.5" `
    + `fill="${esc(c.capHi)}" stroke="none"/>`
    + `<line data-pointer="" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" `
    + `stroke="${esc(dim ? c.disabled : c.pointer)}" stroke-width="${KNOB.pointerW}" `
    + 'stroke-linecap="round"/>'
    + (st.focus ? `<circle data-focus="" cx="0" cy="0" r="${KNOB.focus}" fill="none" `
      + `stroke="${esc(c.focus)}" stroke-width="${KNOB.focusW}"/>` : '');
}

function faderShapes(value, applied, p, t, st) {
  const c = t.control;
  const half = FADER.travel / 2;
  const yOf = (v) => num(half - FADER.travel * toNorm(v, p));
  const y = yOf(value);
  const top = -half - 2;
  const len = FADER.travel + 4;
  const tw = FADER.trackW;
  const ax = FADER.capW / 2 + 3;
  // The value fill runs from the bottom, or from zero on a range across zero (as the knob's arc).
  const bipolar = p.min < 0 && p.max > 0;
  const from = bipolar ? yOf(0) : half + 2;
  const [f0, f1] = y < from ? [y, from] : [from, y];
  const [cw, ch, g] = [FADER.capW, FADER.capH, FADER.grip];
  const grip = (dy, role, paint, w) => `<line data-grip="${role}" x1="${-cw / 2 + 4}" `
    + `y1="${num(y + dy)}" x2="${cw / 2 - 4}" y2="${num(y + dy)}" stroke="${esc(paint)}" `
    + `stroke-width="${w}"/>`;
  const reach = FADER.travel / 2 + ch / 2 + 2;
  return `<rect x="${-tw / 2}" y="${top}" width="${tw}" height="${len}" rx="${tw / 2}" `
    + `fill="${esc(t.surface.edge)}" stroke="${esc(c.track)}" stroke-width="1"/>`
    + (f1 - f0 > 0.01 ? `<rect x="${-tw / 2}" y="${f0}" width="${tw}" height="${num(f1 - f0)}" `
      + `rx="${tw / 2}" fill="${esc(st.disabled ? c.disabled : c.ring)}" stroke="none"/>` : '')
    + (applied !== null ? `<line data-applied="" x1="${-ax}" y1="${yOf(applied)}" x2="${ax}" `
      + `y2="${yOf(applied)}" stroke="${esc(c.pointer)}" stroke-width="1"/>` : '')
    + `<rect data-cap="" x="${-cw / 2}" y="${num(y - ch / 2)}" width="${cw}" height="${ch}" `
    + `rx="2" fill="${esc(c.cap)}" stroke="${esc(st.dragging ? c.pointer : c.edge)}" `
    + 'stroke-width="1"/>'
    + grip(-g, '', c.edge, 1) + grip(0, 'centre', st.disabled ? c.disabled : c.pointer, 1.5)
    + grip(g, '', c.edge, 1)
    + (st.focus ? `<rect data-focus="" x="${-cw / 2 - 3}" y="${-reach}" width="${cw + 6}" `
      + `height="${2 * reach}" rx="3" fill="none" stroke="${esc(c.focus)}" stroke-width="2"/>`
      : '');
}

function switchShapes(value, applied, p, t, st) {
  const c = t.control;
  const n = switchPositions(p);
  const opts = choicesOf(p);
  const lever = leverOf(n);
  const bottom = SWITCH.h / 2 - SWITCH.inset - lever.h / 2;
  const centre = (i) => num(bottom - (i * lever.travel) / (n - 1));
  const index = (v) => optionIndex(v, p, opts);
  const yc = centre(index(value));
  const x = SWITCH.w / 2;
  let detents = '';
  if (n > 2) {
    for (let i = 0; i < n; i++) {
      detents += `<line data-detent="" x1="${x + 2}" y1="${centre(i)}" x2="${x + 5}" `
        + `y2="${centre(i)}" stroke="${esc(c.track)}" stroke-width="1"/>`;
    }
  }
  const ay = applied !== null ? centre(index(applied)) : null;
  return `<rect x="${-x}" y="${-SWITCH.h / 2}" width="${SWITCH.w}" `
    + `height="${SWITCH.h}" rx="3" fill="${esc(t.surface.edge)}" stroke="${esc(c.track)}" `
    + 'stroke-width="1"/>'
    + detents
    + (ay !== null && ay !== yc ? `<line data-applied="" x1="${-x - 5}" y1="${ay}" `
      + `x2="${-x - 2}" y2="${ay}" stroke="${esc(c.pointer)}" stroke-width="1"/>` : '')
    + `<rect data-cap="" x="${-SWITCH.leverW / 2}" y="${num(yc - lever.h / 2)}" `
    + `width="${SWITCH.leverW}" height="${num(lever.h)}" rx="2" fill="${esc(c.cap)}" `
    + `stroke="${esc(st.dragging ? c.capHi : t.surface.edge)}" stroke-width="1"/>`
    + `<line x1="-3" y1="${yc}" x2="3" y2="${yc}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="1.5"/>`
    + (st.focus ? `<rect x="${-x - 3}" y="${-SWITCH.h / 2 - 3}" `
      + `width="${SWITCH.w + 6}" height="${SWITCH.h + 6}" rx="5" fill="none" `
      + `stroke="${esc(c.focus)}" stroke-width="2"/>` : '');
}

const SHAPES = Object.freeze({ knob: knobShapes, fader: faderShapes, switch: switchShapes });

/**
 * One control as an SVG '<g>' string, centred inside controlBox(kind, orientation), drawn only
 * from `tokens` (synthTokens): knob = unlit arc (control.track), value arc (control.ring; from
 * zero with a detent tick across zero; dashed while disabled), skirt with its edge (control.edge,
 * control.pointer on hover) and knurl, cap with its shadow (1 down, 2 dragged) and highlight,
 * pointer, scale ticks from zoom 1.25, focus ring; fader = slot in control.track, value fill
 * (from zero across zero), a FADER_CAP cap edged in control.edge (control.pointer dragged) with
 * three grip lines, the centre one on the value; orientation 'horizontal' turns it (rotate(90):
 * more to the right); switch = a lever position per option of an enum of up to four or a
 * boolean, detents past two. `applied`, elsewhere than `value`, marks the engine's value: on a
 * knob an arc at r 13.5 in control.applied, else a line in control.pointer. `state` is { focus,
 * dragging, disabled, hover }. An invisible hit rect of at least HIT_PX / zoom, never under the
 * box, takes the pointer (44 screen px at any zoom); the drawing takes none. Every shape sets
 * its own stroke. A setpoint: no animation.
 */
export function controlSvg({ kind, value, applied, param, tokens, zoom = 1, state = {},
  orientation = 'vertical' } = {}) {
  if (!tokens || !tokens.control || !tokens.surface) {
    throw new TypeError('controlSvg needs the synth tokens (synthTokens(el)).');
  }
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`controlSvg: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const shapes = Object.hasOwn(SHAPES, kind) ? SHAPES[kind] : null;
  if (!shapes) throw new Error(`controlSvg: kind must be knob, fader or switch, not '${kind}'.`);
  if (kind === 'switch') switchPositions(param);
  const box = controlBox(kind, orientation);
  const turn = box === FADER_ACROSS ? ' transform="rotate(90)"' : '';
  const w = num(Math.max(HIT_PX / zoom, box.width));
  const h = num(Math.max(HIT_PX / zoom, box.height));
  const st = state || {};
  const v = clampValue(value, param);
  return `<g data-control="${kind}">`
    + `<rect data-hit="" x="${num(-w / 2)}" y="${num(-h / 2)}" width="${w}" `
    + `height="${h}" fill="none" stroke="none" pointer-events="all"/>`
    + `<g pointer-events="none"${turn}>${shapes(v, appliedAt(applied, v, param), param, tokens, st,
      zoom)}</g>`
    + '</g>';
}
