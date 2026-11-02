// What a Synth module does, drawn on its plate from its own parameters (K152): a VCO's one
// cycle, a filter's magnitude response, an envelope's shape and an LFO's two cycles. Computed,
// never measured: each curve is the parameter's own definition, so it moves with the knob in
// the same frame. The filter response is the Web Audio biquad of the specification (Audio EQ
// Cookbook coefficients) for the LINEAR Q the Studio stores (audio/filters.js nodeQ gives the
// node the dB value that makes it the same response), at the sample rate given (48 kHz unless
// the caller passes the context's). Pure markup; every shape sets its own stroke.
//
//   scopeOf(nodeType, params, tokens, { sampleRate }) -> { svg, label } | null
//   biquadDb(type, f0, Q, gainDb, f, sampleRate) -> the magnitude in dB at f
//   refreshScope(el, moduleId, nodeType, params, tokens) -> redraws the plate's scope in place
//   scopeDrive(nodeType, params) -> the parameter a drag on the scope sets, or null:
//     a filter's cutoff (x, on the drawing's log axis), a pulse's width (x), an LFO's rate (x,
//     the knob's own scale) and an envelope's sustain (y). The knob stays the keyboard control.
//   scopeValue(box, event, nodeType, param) -> that parameter's value under the pointer

const W = 120;
const H = 44;
const MID = H / 2;
const F_LO = 20;
const F_HI = 20000;
const DB_TOP = 24;
const DB_BOTTOM = -36;

const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`);
const fmtS = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${+s.toFixed(2)} s`);
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** One period of a waveform at phase p in [0, 1), level in [-1, 1]. */
function waveAt(shape, p, width = 0.5) {
  if (shape === 'sine') return Math.sin(2 * Math.PI * p);
  if (shape === 'triangle') return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  if (shape === 'sawtooth') return p < 0.5 ? 2 * p : 2 * p - 2;
  if (shape === 'pulse') return p < width ? 1 : -1;
  return p < 0.5 ? 1 : -1; // square
}

function cycles(shape, n, width) {
  const out = [];
  const steps = 96 * n;
  for (let i = 0; i <= steps; i++) {
    const p = (i / steps) * n;
    const ph = p - Math.floor(p);
    // A step (square, pulse, saw reset) is drawn vertical: both values at the same x.
    const v = waveAt(shape, ph === 0 && i ? 0.999999 : ph, width);
    out.push([(i / steps) * W, MID - v * (MID - 4)]);
    if (i && i < steps - 1 && ['square', 'pulse', 'sawtooth'].includes(shape)) {
      const nx = ((i + 1) / steps) * n;
      const nv = waveAt(shape, nx - Math.floor(nx), width);
      if (Math.abs(nv - v) > 1) out.push([(i / steps) * W, MID - nv * (MID - 4)]);
    }
  }
  return out;
}

/** The Web Audio biquad's magnitude in dB at f (linear Q for every type; shelves S = 1). */
export function biquadDb(type, f0, Q, gainDb, f, sampleRate = 48000) {
  const w0 = (2 * Math.PI * Math.min(f0, sampleRate / 2 - 1)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** (gainDb / 40);
  const q = Math.max(1e-4, Q);
  const alpha = sin / (2 * q);
  const aS = (sin / 2) * Math.SQRT2;
  const sA = 2 * Math.sqrt(A) * aS;
  const c = {
    lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    bandpass: [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha],
    notch: [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha],
    allpass: [1 - alpha, -2 * cos, 1 + alpha, 1 + alpha, -2 * cos, 1 - alpha],
    peaking: [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A],
    lowshelf: [A * ((A + 1) - (A - 1) * cos + sA), 2 * A * ((A - 1) - (A + 1) * cos),
      A * ((A + 1) - (A - 1) * cos - sA), (A + 1) + (A - 1) * cos + sA,
      -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - sA],
    highshelf: [A * ((A + 1) + (A - 1) * cos + sA), -2 * A * ((A - 1) + (A + 1) * cos),
      A * ((A + 1) + (A - 1) * cos - sA), (A + 1) - (A - 1) * cos + sA,
      2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - sA],
  }[type];
  if (!c) return 0;
  const w = (2 * Math.PI * f) / sampleRate;
  const mag = (x0, x1, x2) => Math.hypot(x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w),
    x1 * Math.sin(w) + x2 * Math.sin(2 * w));
  const h = mag(c[0], c[1], c[2]) / mag(c[3], c[4], c[5]);
  return 20 * Math.log10(Math.max(h, 1e-9));
}

const xOfHz = (f) => (Math.log10(f / F_LO) / Math.log10(F_HI / F_LO)) * W;
const yOfDb = (db) => 2 + ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db)))
  / (DB_TOP - DB_BOTTOM)) * (H - 4);

function response(p, sampleRate) {
  const out = [];
  for (let i = 0; i <= 96; i++) {
    const f = F_LO * (F_HI / F_LO) ** (i / 96);
    out.push([xOfHz(f), yOfDb(biquadDb(p.type, p.frequency, p.Q, p.gain || 0, f, sampleRate))]);
  }
  return out;
}

function envelope(p) {
  const [a, d, r] = [p.attack, p.decay, p.release].map((v) => Math.max(0, Number(v) || 0));
  const hold = Math.max(0.05, 0.25 * (a + d + r));
  const k = W / (a + d + hold + r || 1);
  const top = 4;
  const floor = H - 3;
  const sus = floor - (floor - top) * Math.max(0, Math.min(1, p.sustain));
  return [[0, floor], [a * k, top], [(a + d) * k, sus], [(a + d + hold) * k, sus], [W, floor]];
}

export function scopeOf(nodeType, p, t, { sampleRate = 48000 } = {}) {
  let line;
  let label;
  let grid = `<line x1="0" y1="${MID}" x2="${W}" y2="${MID}" stroke="${t.track}" `
    + 'stroke-width="1" stroke-dasharray="2 3"/>';
  if (nodeType === 'vco') {
    const width = (Number(p.width) || 50) / 100;
    line = cycles(p.waveform, 1, width);
    label = `${p.waveform === 'pulse' ? `Pulse ${Math.round(width * 100)} %` : p.waveform}, `
      + 'one cycle';
  } else if (nodeType === 'lfo') {
    line = cycles(p.shape, 2);
    label = `${p.shape}, two cycles at ${fmtHz(p.rate)}`;
  } else if (nodeType === 'filter') {
    line = response(p, sampleRate);
    const y0 = yOfDb(0).toFixed(1);
    const xc = xOfHz(Math.max(F_LO, Math.min(F_HI, p.frequency))).toFixed(1);
    grid = `<line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="${t.track}" stroke-width="1" `
      + `stroke-dasharray="2 3"/><line x1="${xc}" y1="0" x2="${xc}" y2="${H}" `
      + `stroke="${t.track}" stroke-width="1"/>`;
    label = `${p.type} response, ${fmtHz(p.frequency)}, Q ${(+p.Q).toFixed(2)}`
      + `${['peaking', 'lowshelf', 'highshelf'].includes(p.type) ? `, ${p.gain} dB` : ''}`
      + ', 20 Hz to 20 kHz';
    if (p.enabled === false) label += ', bypassed';
  } else if (nodeType === 'envelope') {
    line = envelope(p);
    grid = `<line x1="0" y1="${H - 3}" x2="${W}" y2="${H - 3}" stroke="${t.track}" `
      + 'stroke-width="1"/>';
    label = `Envelope: attack ${fmtS(p.attack)}, decay ${fmtS(p.decay)}, sustain `
      + `${Math.round(p.sustain * 100)} %, release ${fmtS(p.release)}`;
  } else {
    return null;
  }
  const drive = scopeDrive(nodeType, p);
  if (drive) label += `; drag to set the ${drive.verb}`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="h-11 w-full" `
    + `role="img" aria-label="${label}" focusable="false">${grid}`
    + `<polyline points="${pts(line)}" fill="none" stroke="${t.accent}" stroke-width="1.75" `
    + 'stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  return { svg, label };
}

export function refreshScope(el, moduleId, nodeType, params, tokens) {
  const box = el && el.querySelector(`[data-scope="${moduleId}"]`);
  const s = box && scopeOf(nodeType, params, tokens);
  if (s) box.innerHTML = s.svg;
}

export function scopeDrive(nodeType, p) {
  if (nodeType === 'filter') return { key: 'frequency', axis: 'x', verb: 'cutoff' };
  if (nodeType === 'vco' && p.waveform === 'pulse') {
    return { key: 'width', axis: 'x', verb: 'width' };
  }
  if (nodeType === 'lfo') return { key: 'rate', axis: 'x', verb: 'rate' };
  if (nodeType === 'envelope') return { key: 'sustain', axis: 'y', verb: 'sustain' };
  return null;
}

export function scopeValue(box, e, nodeType, param) {
  const r = box.getBoundingClientRect();
  const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
  const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / (r.height || 1)));
  const lo = param.min;
  const hi = param.max;
  const clamp = (v) => Math.max(lo, Math.min(hi, v));
  let v;
  if (nodeType === 'filter') v = F_LO * (F_HI / F_LO) ** fx;
  else if (nodeType === 'envelope') v = (H - 3 - fy * H) / (H - 7);
  else if (param.scale === 'log' && lo > 0) v = lo * (hi / lo) ** fx;
  else v = lo + fx * (hi - lo);
  v = clamp(v);
  return Number(v.toPrecision(param.scale === 'log' ? 4 : 3));
}
