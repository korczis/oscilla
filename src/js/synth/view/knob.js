// The Synth knob (plan K058; design §6, D11): a pure value model and its SVG markup. The value
// is a setpoint of the StudioModel parameter it edits (project.no-fake-science): nothing here
// tweens, smooths or invents a reading. Colours come from OSCILLA tokens passed in (view/
// tokens.js), never from a literal (project.visual-identity-lock v3, synth-panel-tokens test).
//
//   knobModel(param) -> { norm(v), value(t), angle(v), drag(v, dyPx, fine), key(v, key, shift),
//                         parse(text) -> { ok, value } | { ok: false, reason }, format(v), text(v) }
//   knobSvg({ id, value, param, model, tokens, bipolar }) -> SVG markup string

import { validateParamValue } from '../../studio/registry.js';

/** Vertical drag over the full range, px (Shift: a tenth of that speed). */
export const DRAG_FULL_PX = 200;
export const FINE = 0.1;
/** Sweep of the arc: from -135° (minimum) to +135° (maximum). */
export const SWEEP_DEG = 270;
const LOG_STEPS = 200; // keyboard steps over a log range (Shift: 2000)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sig = (v, d = 3) => Number(v.toPrecision(d));
const fixed = (v, d) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

export function formatValue(v, p) {
  if (p.type === 'enum') {
    const o = p.options.find((x) => x[0] === v);
    return o ? o[1] : String(v);
  }
  if (p.type === 'boolean') return v ? 'On' : 'Off';
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const sign = (x) => (x > 0 ? '+' : '');
  switch (p.unit) {
    case 'Hz': return v >= 1000 ? `${fixed(v / 1000, 2)} kHz` : `${sig(v)} Hz`;
    case 's': return v < 1 ? `${sig(v * 1000)} ms` : `${fixed(v, 2)} s`;
    case 'cents': return `${sign(v)}${Math.round(v)} ct`;
    case 'oct': return `${sign(v)}${fixed(v, 2)} oct`;
    case 'st': return `${sign(v)}${Math.round(v)} st`;
    case '%': return `${Math.round(v)} %`;
    case 'dB': return `${fixed(v, 1)} dB`;
    default: return p.type === 'integer' ? String(Math.round(v)) : fixed(v, 2);
  }
}

export function knobModel(p) {
  const log = p.scale === 'log' && p.min > 0;
  const lo = p.min;
  const hi = p.max;
  const norm = (v) => (log ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo));
  const snap = (v) => {
    let x = clamp(v, lo, hi);
    if (p.type === 'integer') return Math.round(x);
    if (!log && p.step) x = lo + Math.round((x - lo) / p.step) * p.step;
    return Number(clamp(x, lo, hi).toPrecision(log ? 4 : 10));
  };
  const value = (t) => snap(log ? lo * (hi / lo) ** clamp(t, 0, 1) : lo + clamp(t, 0, 1) * (hi - lo));
  const stepT = (shift) => {
    if (log) return (shift ? FINE : 1) / LOG_STEPS;
    const s = p.step || (hi - lo) / 100;
    return ((shift ? s * FINE : s) / (hi - lo));
  };
  return {
    norm: (v) => clamp(norm(v), 0, 1),
    value,
    angle: (v) => -SWEEP_DEG / 2 + SWEEP_DEG * clamp(norm(v), 0, 1),
    drag: (v, dyPx, fine = false) => value(norm(v) - (dyPx / DRAG_FULL_PX) * (fine ? FINE : 1)),
    key(v, key, shift = false) {
      const t = norm(v);
      const s = stepT(shift);
      switch (key) {
        case 'ArrowUp': case 'ArrowRight': return p.type === 'integer' ? snap(v + 1) : value(t + s);
        case 'ArrowDown': case 'ArrowLeft': return p.type === 'integer' ? snap(v - 1)
          : value(t - s);
        case 'PageUp': return value(t + 0.1);
        case 'PageDown': return value(t - 0.1);
        case 'Home': return lo;
        case 'End': return hi;
        default: return null;
      }
    },
    parse(text) {
      const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(k)?\s*([a-z%]*)\s*$/i.exec(String(text));
      if (!m) return { ok: false, reason: `"${String(text).slice(0, 24)}" is not a number.` };
      let v = Number(m[1]) * (m[2] ? 1000 : 1);
      const unit = (m[3] || '').toLowerCase();
      if (unit === 'khz') v *= 1000;
      if (unit === 'ms' && p.unit === 's') v /= 1000;
      const known = ['', 'hz', 'khz', 's', 'ms', 'ct', 'cents', 'oct', 'st', '%', 'db'];
      if (!known.includes(unit)) return { ok: false, reason: `Unknown unit "${m[3]}".` };
      const why = validateParamValue(p, p.type === 'integer' ? Math.round(v) : v);
      return why ? { ok: false, reason: `${p.label} ${why}.` }
        : { ok: true, value: p.type === 'integer' ? Math.round(v) : v };
    },
    format: (v) => formatValue(v, p),
    /** aria-valuetext: the value with its unit, as shown. */
    text: (v) => formatValue(v, p),
  };
}

/** Enum stepping (switches): the next or previous option, clamped. */
export function stepOption(p, v, dir) {
  const i = p.options.findIndex((o) => o[0] === v);
  return p.options[clamp((i < 0 ? 0 : i) + dir, 0, p.options.length - 1)][0];
}

const rad = (deg) => ((deg - 90) * Math.PI) / 180;
const pt = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))]
  .map((x) => x.toFixed(2)).join(' ');
/** An SVG arc path from angle a to b (degrees, 0 = up, clockwise). */
export function arcPath(cx, cy, r, a, b) {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const large = e - s > 180 ? 1 : 0;
  return `M ${pt(cx, cy, r, s)} A ${r} ${r} 0 ${large} 1 ${pt(cx, cy, r, e)}`;
}

/** The knob drawing (64 × 64): track, value ring, cap with one highlight, pointer. */
export function knobSvg({ uid, value, param, tokens: t, disabled = false }) {
  const m = knobModel(param);
  const a = m.angle(value);
  const zero = param.min < 0 && param.max > 0 ? m.angle(0) : -SWEEP_DEG / 2;
  const ring = disabled ? t.dim : t.accent;
  return `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">`
    + `<defs><radialGradient id="kc-${uid}" cx="40%" cy="32%" r="70%">`
    + `<stop offset="0" stop-color="${t.capHi}"/><stop offset="1" stop-color="${t.cap}"/>`
    + '</radialGradient></defs>'
    + `<path d="${arcPath(32, 32, 27, -135, 135)}" fill="none" stroke="${t.track}" `
    + 'stroke-width="4" stroke-linecap="round"/>'
    + `<path d="${arcPath(32, 32, 27, zero, a)}" fill="none" stroke="${ring}" stroke-width="4" `
    + 'stroke-linecap="round"/>'
    + `<circle cx="32" cy="32" r="20" fill="url(#kc-${uid})" stroke="${t.edge}" `
    + 'stroke-width="1.5"/>'
    + `<line x1="${pt(32, 32, 6, a).split(' ')[0]}" y1="${pt(32, 32, 6, a).split(' ')[1]}" `
    + `x2="${pt(32, 32, 18, a).split(' ')[0]}" y2="${pt(32, 32, 18, a).split(' ')[1]}" `
    + `stroke="${disabled ? t.dim : t.pointer}" stroke-width="3" stroke-linecap="round"/>`
    + '</svg>';
}
