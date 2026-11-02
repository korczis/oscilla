// The shared synth-theme layer's control core (the control API agreed on 2026-11-02): one knob,
// fader and switch, as pure functions. Values come from the parameter descriptor only
// ({ id, label, unit, min, max, step, scale: 'lin' | 'log', default, type? }); the control holds
// no constant of any parameter. The value is a setpoint (project.no-fake-science): nothing here
// tweens or smooths it. The core adds no listener and reads no document: a host calls knobKey
// from its own delegated listener (K153 counts key listeners), and draws controlSvg where it
// wants, an HTML panel or an SVG graph box at any zoom. Every colour is a token passed in
// (tokens.js; project.visual-identity-lock v3), so nothing here is a colour literal.
//
//   clampValue, toNorm, fromNorm, quantize, defaultValue  value mapping (lin and log)
//   dragValue, wheelValue, knobKey                        gestures -> the next value
//   formatValue, ariaAttrs                                the value as text, the slider's ARIA
//   controlSvg                                            the drawing, an SVG <g> string

import { formatFrequencyCompact, formatMs } from '../../core/frequency.js';

/** Vertical drag over the whole range, px; fine (Shift) divides the sensitivity by FINE_DIV. */
export const DRAG_PX_PER_RANGE = 200;
export const FINE_DIV = 10;
/** The hit area's side in screen px, at any zoom (the phone gates' 44 px target). */
export const HIT_PX = 44;
/** The knob's sweep: from -135° (minimum) to +135° (maximum), 0° up. */
export const SWEEP_DEG = 270;
/** A stepless or log range moves 1/KEY_DIVS of itself per key; PageUp/PageDown PAGE_STEPS. */
const KEY_DIVS = 100;
const PAGE_STEPS = 10;

// ---------------------------------------------------------------- value mapping

/** The descriptor's range, checked: finite, max above min, a known scale, log above zero. */
function rangeOf(p) {
  const id = p && p.id !== undefined ? p.id : 'param';
  const { min, max } = p || {};
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new Error(`${id}: a range needs a finite max above min (min ${min}, max ${max}).`);
  }
  const scale = p.scale === undefined ? 'lin' : p.scale;
  if (scale !== 'lin' && scale !== 'log') {
    throw new Error(`${id}: scale must be 'lin' or 'log', not '${scale}'.`);
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

/** `v` held to [min, max]; NaN reads min. */
export function clampValue(v, p) {
  const { min, max } = rangeOf(p);
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** The value as a position 0..1 along the control (log: equal ratios, equal distances). */
export function toNorm(v, p) {
  const { min, max, log } = rangeOf(p);
  const x = clampValue(v, p);
  return log ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min);
}

/** The value at position `n` (0..1, clamped) along the control. */
export function fromNorm(n, p) {
  const { min, max, log } = rangeOf(p);
  const t = unit01(n);
  if (t === 0) return min;
  if (t === 1) return max;
  return log ? min * (max / min) ** t : min + t * (max - min);
}

/** `v` clamped and snapped to the step in value space (fine: to a tenth of it). */
export function quantize(v, p, { fine = false } = {}) {
  const { min } = rangeOf(p);
  let x = clampValue(v, p);
  const q = quantumOf(p, fine);
  if (q) x = clampValue(min + Math.round((x - min) / q) * q, p);
  return clean(x);
}

/** The value a double-click, Delete or Backspace returns to: the default, else min. */
export function defaultValue(p) {
  const { min } = rangeOf(p);
  return quantize(p.default === undefined || p.default === null ? min : p.default, p);
}

/** `steps` key or wheel steps from `value`: the step on a stepped linear range, else 1 % of
 *  the (norm) range; fine a tenth. A step the grid would swallow moves one grid unit. */
function nudge(value, p, steps, fine) {
  const { min, max, log } = rangeOf(p);
  const q = quantumOf(p, fine);
  const v = clampValue(value, p);
  const div = KEY_DIVS * (fine ? FINE_DIV : 1);
  let next;
  if (!log && q) next = v + steps * q;
  else if (!log) next = v + (steps * (max - min)) / div;
  else next = fromNorm(toNorm(v, p) + steps / div, p);
  const out = quantize(next, p, { fine });
  if (q && steps && out === quantize(v, p, { fine })) {
    return quantize(v + Math.sign(steps) * q, p, { fine });
  }
  return out;
}

/** PageUp/PageDown: 10 steps on a stepped linear range, else 10 % of the (norm) range. */
function page(value, p, dir) {
  const { log } = rangeOf(p);
  const step = quantumOf(p, false);
  if (!log && step) return quantize(clampValue(value, p) + dir * PAGE_STEPS * step, p);
  return quantize(fromNorm(toNorm(value, p) + dir / PAGE_STEPS, p), p);
}

// ---------------------------------------------------------------- gestures

/**
 * The value after a vertical drag of `dy` px from where it started (`dy` = pointer y now minus
 * at the press; up is negative, and up increases). Computed from the start value, so a drag
 * accumulates no rounding. The whole range is `pixelsPerRange` px; fine divides it by 10.
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

/** The value after one wheel notch: up (deltaY < 0) a step up, down a step down; 0 holds. */
export function wheelValue(value, deltaY, p, { fine = false } = {}) {
  if (!deltaY || Number.isNaN(deltaY)) return quantize(value, p, { fine });
  return nudge(value, p, deltaY < 0 ? 1 : -1, fine);
}

/**
 * The control's answer to a key event, for the host's own delegated listener:
 *   ArrowUp / ArrowRight +step, ArrowDown / ArrowLeft -step (Shift or `fine`: a tenth of the
 *   step, or an integer's smallest step); PageUp / PageDown 10 steps or 10 % of the range;
 *   Home min, End max; Delete / Backspace the default (as a double-click);
 *   Enter { edit: true } (the host opens a typed entry);
 *   anything else, or any key with Ctrl, Meta or Alt, null (not the control's: let it pass).
 */
export function knobKey(e, { value, param, fine = false } = {}) {
  if (!e || typeof e.key !== 'string') return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const f = Boolean(fine) || Boolean(e.shiftKey);
  switch (e.key) {
    case 'ArrowUp': case 'ArrowRight': return nudge(value, param, 1, f);
    case 'ArrowDown': case 'ArrowLeft': return nudge(value, param, -1, f);
    case 'PageUp': return page(value, param, 1);
    case 'PageDown': return page(value, param, -1);
    case 'Home': return rangeOf(param).min;
    case 'End': return rangeOf(param).max;
    case 'Enter': return { edit: true };
    case 'Delete': case 'Backspace': return defaultValue(param);
    default: return null;
  }
}

// ---------------------------------------------------------------- text and ARIA

function decimalsOf(p) {
  const step = quantumOf(p, false);
  if (!step) return 2;
  const s = String(step);
  const exp = /e-(\d+)$/.exec(s);
  if (exp) return Number(exp[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** The value with its unit, as shown and announced: frequencies and times through the units
 *  module (core/frequency.js), anything else at the step's decimals. */
export function formatValue(v, p) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (p.unit === 'Hz') return formatFrequencyCompact(v);
  if (p.unit === 's') return formatMs(v * 1000);
  const d = decimalsOf(p);
  const text = (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
  return p.unit ? `${text} ${p.unit}` : text;
}

/** The slider's ARIA attributes; `format(v, param)` overrides the text, and the unit is added
 *  when the text lacks it. */
export function ariaAttrs(value, p, format) {
  const { min, max } = rangeOf(p);
  const v = clampValue(value, p);
  let text = typeof format === 'function' ? String(format(v, p)) : formatValue(v, p);
  if (p.unit && !text.includes(p.unit)) text = `${text} ${p.unit}`;
  return { role: 'slider', 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': v,
    'aria-valuetext': text };
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

// Graph units, centred on the origin; the caller places the group.
const KNOB = { ring: 17, cap: 12, ringW: 3, focus: 21 };
const FADER = { travel: 32, capW: 16, capH: 8, trackW: 4 };
const SWITCH = { w: 14, h: 28, leverW: 10, leverH: 12 };

function knobShapes(value, p, t, st) {
  const c = t.control;
  const dim = st.disabled;
  const angle = (v) => -SWEEP_DEG / 2 + SWEEP_DEG * toNorm(v, p);
  const a = angle(value);
  const zero = p.min < 0 && p.max > 0 ? angle(0) : -SWEEP_DEG / 2;
  const ringW = st.dragging ? KNOB.ringW + 1 : KNOB.ringW;
  const [x0, y0] = polar(3, a);
  const [x1, y1] = polar(KNOB.cap - 2, a);
  return `<path d="${arcPath(KNOB.ring, -SWEEP_DEG / 2, SWEEP_DEG / 2)}" fill="none" `
    + `stroke="${esc(c.track)}" stroke-width="${KNOB.ringW}" stroke-linecap="round"/>`
    + (Math.abs(a - zero) > 0.01 ? `<path d="${arcPath(KNOB.ring, zero, a)}" data-ring="" `
      + `fill="none" stroke="${esc(dim ? c.disabled : c.ring)}" stroke-width="${ringW}" `
      + 'stroke-linecap="round"/>' : '')
    + `<circle cx="0" cy="0" r="${KNOB.cap}" fill="${esc(c.cap)}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`
    + `<ellipse cx="-3.5" cy="-4.5" rx="5" ry="3.5" fill="${esc(c.capHi)}" fill-opacity="0.6" `
    + 'stroke="none"/>'
    + `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" `
    + `stroke="${esc(dim ? c.disabled : c.pointer)}" stroke-width="2.5" stroke-linecap="round"/>`
    + (st.focus ? `<circle cx="0" cy="0" r="${KNOB.focus}" fill="none" `
      + `stroke="${esc(c.focus)}" stroke-width="2"/>` : '');
}

function faderShapes(value, p, t, st) {
  const c = t.control;
  const half = FADER.travel / 2;
  const y = num(half - FADER.travel * toNorm(value, p));
  const top = -half - 2;
  const len = FADER.travel + 4;
  const tw = FADER.trackW;
  return `<rect x="${-tw / 2}" y="${top}" width="${tw}" height="${len}" rx="${tw / 2}" `
    + `fill="${esc(c.track)}" stroke="${esc(t.surface.edge)}" stroke-width="0.5"/>`
    + (y < half ? `<rect x="${-tw / 2}" y="${y}" width="${tw}" height="${num(half + 2 - y)}" `
      + `rx="${tw / 2}" fill="${esc(st.disabled ? c.disabled : c.ring)}" stroke="none"/>` : '')
    + `<rect data-cap="" x="${-FADER.capW / 2}" y="${num(y - FADER.capH / 2)}" `
    + `width="${FADER.capW}" height="${FADER.capH}" rx="1.5" fill="${esc(c.cap)}" `
    + `stroke="${esc(st.dragging ? c.capHi : t.surface.edge)}" stroke-width="1"/>`
    + `<line x1="${-FADER.capW / 2 + 2}" y1="${y}" x2="${FADER.capW / 2 - 2}" y2="${y}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="1.5"/>`
    + (st.focus ? `<rect x="${-FADER.capW / 2 - 3}" y="${top - 3}" width="${FADER.capW + 6}" `
      + `height="${len + 6}" rx="3" fill="none" stroke="${esc(c.focus)}" stroke-width="2"/>`
      : '');
}

function switchShapes(value, p, t, st) {
  const c = t.control;
  const on = toNorm(value, p) >= 0.5;
  const y = on ? -SWITCH.h / 2 + 2 : 2;
  const grip = num(y + SWITCH.leverH / 2);
  return `<rect x="${-SWITCH.w / 2}" y="${-SWITCH.h / 2}" width="${SWITCH.w}" `
    + `height="${SWITCH.h}" rx="3" fill="${esc(c.track)}" stroke="${esc(t.surface.edge)}" `
    + 'stroke-width="1"/>'
    + `<rect data-cap="" x="${-SWITCH.leverW / 2}" y="${y}" width="${SWITCH.leverW}" `
    + `height="${SWITCH.leverH}" rx="2" fill="${esc(c.cap)}" `
    + `stroke="${esc(st.dragging ? c.capHi : t.surface.edge)}" stroke-width="1"/>`
    + `<line x1="-3" y1="${grip}" x2="3" y2="${grip}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="1.5"/>`
    + (st.focus ? `<rect x="${-SWITCH.w / 2 - 3}" y="${-SWITCH.h / 2 - 3}" `
      + `width="${SWITCH.w + 6}" height="${SWITCH.h + 6}" rx="5" fill="none" `
      + `stroke="${esc(c.focus)}" stroke-width="2"/>` : '');
}

const SHAPES = Object.freeze({ knob: knobShapes, fader: faderShapes, switch: switchShapes });

/**
 * One control as an SVG '<g>' string, centred on the origin, drawn only from `tokens`
 * (synthTokens): knob = track, value ring (control.ring), cap with one highlight, pointer;
 * fader = track, value fill and cap; switch = two positions. An invisible hit rect of
 * HIT_PX / zoom graph units takes the pointer, so the target stays 44 screen px at any zoom;
 * the drawing takes none. Every shape sets its own stroke. A setpoint: no animation.
 */
export function controlSvg({ kind, value, param, tokens, zoom = 1, state = {} } = {}) {
  if (!tokens || !tokens.control || !tokens.surface) {
    throw new TypeError('controlSvg needs the synth tokens (synthTokens(el)).');
  }
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`controlSvg: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const shapes = Object.hasOwn(SHAPES, kind) ? SHAPES[kind] : null;
  if (!shapes) throw new Error(`controlSvg: kind must be knob, fader or switch, not '${kind}'.`);
  const hit = num(HIT_PX / zoom);
  const st = state || {};
  return `<g data-control="${kind}">`
    + `<rect data-hit="" x="${num(-hit / 2)}" y="${num(-hit / 2)}" width="${hit}" `
    + `height="${hit}" fill="none" stroke="none" pointer-events="all"/>`
    + `<g pointer-events="none">${shapes(clampValue(value, param), param, tokens, st)}</g>`
    + '</g>';
}
