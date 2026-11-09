// The Studio Inspector's pure field helpers, split from inspector.js (its source-size budget; no
// behaviour change): the display text of a parameter value, the parse of a typed one, and the
// slider's range and position. inspector.js re-exports every name, so its callers are unchanged.
//
//   formatParamValue(p, v), parseParamInput(p, text), sliderRange(p), valueToSlider(p, v),
//   sliderToValue(p, pos), SLIDER_STEPS

import { validateParamValue } from '../../studio/registry.js';
import { formatFrequency, parseFrequency } from '../../core/frequency.js';
import { sig } from '../../core/math.js';

export const SLIDER_STEPS = 1000;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The display text of a parameter value with its unit ("2.40 kHz", "0.707", "Low-pass"). */
export function formatParamValue(p, v) {
  switch (p.type) {
    case 'boolean': return v ? 'On' : 'Off';
    case 'enum': {
      const o = (p.options || []).find((x) => x[0] === v);
      return o ? o[1] : String(v);
    }
    case 'list': return Array.isArray(v) ? v.map((x) => sig(x, 4)).join(', ') : '';
    case 'id': return v === null || v === undefined ? 'None' : `${String(v).slice(0, 12)}…`;
    default:
      if (!finite(v)) return '—';
      if (p.unit === 'Hz') return formatFrequency(v);
      return p.unit ? `${sig(v, 4)} ${p.unit}` : sig(v, 4);
  }
}

/**
 * Parse what was typed into a parameter field. Frequencies accept "2400", "2.4k", "2.4 kHz";
 * other numbers may carry their unit ("120 ms" is not converted: the unit must match). Returns
 * { ok: true, value } or { ok: false, error } with the registry's own range text.
 */
export function parseParamInput(p, text) {
  const raw = String(text ?? '').trim();
  const fail = (why) => ({ ok: false, error: `${p.label} ${why}.` });
  let value;
  if (p.type === 'number' || p.type === 'integer') {
    if (p.unit === 'Hz') {
      const r = parseFrequency(raw);
      if (!r.ok) return { ok: false, error: r.error };
      value = r.value;
    } else {
      const unit = p.unit ? p.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
      const stripped = unit ? raw.replace(new RegExp(`\\s*${unit}$`, 'i'), '') : raw;
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(stripped.replace(',', '.'))) {
        return fail('must be a number');
      }
      value = Number(stripped.replace(',', '.'));
    }
  } else if (p.type === 'list') {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    value = parts.map((x) => Number(x.replace(',', '.')));
    if (value.some((x) => !finite(x))) return fail('must be numbers separated by commas');
  } else {
    return fail('cannot be typed');
  }
  const why = validateParamValue(p, value);
  return why ? fail(why) : { ok: true, value };
}

/** The slider's range: the parameter's soft (display) range, else its full range. */
export function sliderRange(p) {
  const lo = p.softRange ? p.softRange[0] : p.min;
  const hi = p.softRange ? p.softRange[1] : p.max;
  return { lo, hi, log: p.scale === 'log' && lo > 0 };
}

/** Slider position 0..SLIDER_STEPS of a value (clamped to the slider range). */
export function valueToSlider(p, v) {
  const { lo, hi, log } = sliderRange(p);
  if (!finite(v) || !(hi > lo)) return 0;
  const x = Math.min(hi, Math.max(lo, v));
  const t = log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo);
  return Math.round(t * SLIDER_STEPS);
}

/** The value of a slider position, rounded to the parameter's step (4 significant digits). */
export function sliderToValue(p, pos) {
  const { lo, hi, log } = sliderRange(p);
  const t = Math.min(1, Math.max(0, pos / SLIDER_STEPS));
  let v = log ? lo * (hi / lo) ** t : lo + (hi - lo) * t;
  if (p.type === 'integer') v = Math.round(v);
  else if (p.step) v = Math.round(v / p.step) * p.step;
  v = Number(v.toPrecision(4));
  return Math.min(p.max, Math.max(p.min, v)) + 0;
}
