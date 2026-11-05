// The synth-theme layer's indicators (plan F013 entry 9, slice S9): an LED and a needle meter,
// drawn as an old-school modular draws them (project.visual-identity-lock v4, Q071). Pure string
// renderers: no DOM, no listener, no timer, no animation.
//
// Indicators bind to state. Every LED is a group marked data-led whose data-source names the
// state it shows and whose data-lit is that state's boolean, both interpolated from the caller;
// every meter is a group marked data-needle with data-source and data-value from the caller.
// Neither can be drawn without them: a missing source or a lit that is not a boolean throws, so
// no LED is ever lit by a constant, a timer or a random value. Which state a source names is the
// reviewer's to check (the rule's review-only list).
//
// The LED: a 6 across lens (graph units: 1 is 1 CSS px at zoom 1, scaled with the drawing) in a
// bezel: a control.capHi (--osc-surface-4) body ringed in control.bezel (--osc-border-strong),
// the strongest neutral the palette has against the plates (dark 1.30, 1.20 and 1.10:1 on
// surface-1, -2 and -3; light 1.61, 1.43 and 1.33; the lens tells the state, so the bezel only
// decorates). Lit, the lens is the state token the caller chose by role (LED_COLOURS,
// control.led by default), seated in a surface.edge ring (every lit colour 3:1 on it in both
// themes; light --osc-red is 2.94:1 on the bezel's body), and glows: a box-shadow paints no SVG
// element, so the glow is an SVG halo, one circle in the lens's colour past the lens by LED.halo
// graph units but never past HALO_PX screen px (min(LED.halo, HALO_PX / zoom), as a label keeps
// LABEL_PX), over the bezel and under the lens, at the hw-sheen intensity by its class
// opacity-hw-sheen (never a literal opacity), aria-hidden and taking no pointer; never on the
// group or on text. An SVG LED glow is a halo circle bounded by the v4 glow max (6 screen px,
// measured by visual-identity-lock-v4.test.mjs at every zoom) because box-shadow does not paint
// in SVG. Unlit, there is no halo and the lens is surface.card (--osc-surface-2) with
// a control.edge (--osc-text-dim) ring, 3:1 on the bezel and on either plate surface in both
// themes (ui-synth-led.test.mjs computes it from tokens.css). LXK-10 (D-PAL): a plain lit LED
// is the emission colour control.led (--osc-hw-led, one value in both themes, derived in
// ui-synth-palette.test.mjs to hold 3:1 on the bezel, its seat, the card and every plate), the
// default; the ring colour is no longer an LED colour (dark blue in light, a lit lens read as
// off), while control.applied and jack.refuse stay, because their colour encodes which state
// the LED shows (the engine's applied value, a refusal; never by colour alone: the label and
// data-source name it). A token set without control.led (the panel's adapter until dev-53 maps
// it) lights the default in control.ring, as before. switch.js draws a toggle's LED
// through ledSvg. An optional label is 12 screen px at any zoom, in text.label, and names the
// LED to assistive technology ("Arm: on"); an unnamed LED is aria-hidden.
//
// The meter: a recessed face (surface.card, control.edge), an arc scale in control.track with
// ticks, a needle in control.pointer and a pivot cap. Measurement truth (project.no-fake-science):
// the scale is 'relative' and draws no unit unless it is 'calibrated', which requires
// calibrated === true and a unit, so no needle reads in dB SPL without a valid calibration. The
// value is clamped to [0, 1]; out of range the needle pins and the group says data-pinned (low or
// high), while data-value keeps the caller's value. The renderer draws a setpoint and never
// moves: a host that animates the needle between two values does it in its own file, and that
// file checks prefers-reduced-motion (the v4 motion guard).
//
// Neither takes the pointer by default (pointer-events none). With `interactive`, a hit rect of
// at least HIT_PX screen px a side at the given zoom, centred on the drawing's box, takes it and
// the drawing takes none, as controlSvg's knob. The hit only takes the pointer: as with
// switch.js's drawing, whose caller keeps each option a radio button, the host supplies the
// control's role, its keyboard focus and focus ring, and its value (aria-pressed, aria-checked
// or aria-valuenow) on its own element; ledSvg and meterSvg draw none of them.
//
//   ledSvg({ at, lit, source, tokens, colour, zoom, label, interactive })  '<g data-led …>…</g>'
//   ledBox({ at, zoom, label })                                           the LED's extent
//   meterSvg({ at, value, source, scale, unit, calibrated, tokens, zoom, interactive })
//                                                                         '<g data-needle …>…</g>'
//   meterBox({ at, zoom, unit })                                          the meter's extent
//   checkLed(led, id)                  a host's { source, lit }, checked
//   LED, LED_COLOURS, METER, METER_BOX, LABEL_PX, HALO_PX

import { HIT_PX } from './knob.js';
import { legendWidth, LEGEND_PX } from './legend.js';

/** The LED's geometry, graph units: the lens radius (6 across), the bezel's, their strokes, the
 *  lit halo's reach past the lens at zoom 1 and below (HALO_PX caps it on screen above) and the
 *  gap to the label. */
export const LED = Object.freeze({ lens: 3, bezel: 4.5, ringW: 1, bezelW: 1, halo: 4,
  labelGap: 3 });
/** The token roles an LED may light in: each holds 3:1 on the bezel and both plate surfaces in
 *  both themes (the test computes it); a role elsewhere, a literal or a raw var() is refused. */
export const LED_COLOURS = Object.freeze(['control.led', 'control.applied', 'jack.refuse']);
/** A label's and a unit's size in screen px at any zoom (the 12 px font floor, legend.js's). */
export const LABEL_PX = LEGEND_PX;
/** The lit halo's greatest reach past the lens in screen px at any zoom, within the v4 glow
 *  bound of 6 px. */
export const HALO_PX = 4;
/** The meter's geometry, graph units, around the origin: the face, the pivot below the centre,
 *  the arc's radius and sweep (0 up, clockwise), the ticks (a major one every `major`), the
 *  needle's reach, the pivot cap and the strokes. */
export const METER = Object.freeze({ faceW: 48, faceH: 36, faceRx: 3, pivotY: 8, arcR: 26,
  sweep: 90, ticks: 11, major: 5, tickIn: 22.5, majorIn: 20.5, needle: 24, cap: 3, arcW: 1,
  tickW: 1, majorW: 1.5, needleW: 1.5, edgeW: 1, unitGap: 2 });
/** The meter's extent at the origin without a unit: the face, which holds every mark. */
export const METER_BOX = Object.freeze({ x: -METER.faceW / 2, y: -METER.faceH / 2 - 4,
  width: METER.faceW, height: METER.faceH });

const num = (x) => Number(x.toFixed(2)) + 0; // + 0: never -0
/** Up to the next 0.02, so a hit never rounds under the 44 px rule and its half is exact. */
const up = (x) => num(Math.ceil(x * 50 - 1e-9) / 50);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rad = (deg) => (deg * Math.PI) / 180;
/** The point at radius r and angle deg (0 up, clockwise) around (cx, cy). */
const polar = (cx, cy, r, deg) => [num(cx + r * Math.sin(rad(deg))),
  num(cy - r * Math.cos(rad(deg)))];

// ---------------------------------------------------------------- shared checks

function checkTokens(tokens, who) {
  if (!tokens || !tokens.control || !tokens.surface || !tokens.text) {
    throw new TypeError(`${who} needs the synth tokens (synthTokens(el)).`);
  }
}

function checkZoom(zoom, who) {
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`${who}: zoom must be a finite number above 0, not ${zoom}.`);
  }
}

function pointOf(at, who) {
  const x = at && at.x !== undefined ? at.x : 0;
  const y = at && at.y !== undefined ? at.y : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`${who}: at is { x, y }, finite graph units.`);
  }
  return { x, y };
}

function checkSource(source, who) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new TypeError(`${who}: name the state it shows as data-source (a non-empty string).`);
  }
}

/** A hit rect of at least HIT_PX screen px a side, centred on `box`, and the drawing under it. */
function wrap(open, box, zoom, interactive, drawing) {
  if (!interactive) return `${open} pointer-events="none">${drawing}</g>`;
  const w = up(Math.max(HIT_PX / zoom, box.width));
  const h = up(Math.max(HIT_PX / zoom, box.height));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return `${open}><rect data-hit="" x="${num(cx - w / 2)}" y="${num(cy - h / 2)}" width="${w}" `
    + `height="${h}" fill="none" stroke="none" pointer-events="all"/>`
    + `<g pointer-events="none">${drawing}</g></g>`;
}

// ---------------------------------------------------------------- the LED

/** The lit halo's reach past the lens at `zoom`, graph units: LED.halo, but never past HALO_PX
 *  screen px, so it spreads at most HALO_PX on screen however far the graph zooms in. */
// Rounded down, so the rounding never carries the halo past HALO_PX on screen.
const haloReach = (zoom) => Math.floor(Math.min(LED.halo, HALO_PX / zoom) * 100 + 1e-9) / 100;
/** Half the LED's extent at `zoom`: the bezel's outer edge or the lit halo, whichever reaches
 *  further, so the box is the same lit and unlit. */
const ledHalf = (zoom) => Math.max(LED.bezel + LED.bezelW / 2, LED.lens + haloReach(zoom));

/** The LED's extent, graph units: the bezel and the lit halo, and the label below them when there
 *  is one. */
export function ledBox({ at, zoom = 1, label } = {}) {
  checkZoom(zoom, 'ledBox');
  const { x, y } = pointOf(at, 'ledBox');
  const half = ledHalf(zoom);
  if (label === undefined || label === null || label === '') {
    return Object.freeze({ x: num(x - half), y: num(y - half), width: num(2 * half),
      height: num(2 * half) });
  }
  const size = LABEL_PX / zoom;
  const width = Math.max(2 * half, legendWidth(label, size));
  return Object.freeze({ x: num(x - width / 2), y: num(y - half), width: num(width),
    height: num(2 * half + LED.labelGap + size * 1.2) });
}

/** A host's LED state ({ source, lit }, `id` naming the host in the error): the source a
 *  non-empty string, lit a boolean, else a TypeError (switch.js's toggle). */
export function checkLed(led, id) {
  if (!led || typeof led !== 'object') {
    throw new TypeError(`${id}: an LED is { source, lit }, bound to the parameter's state.`);
  }
  if (typeof led.source !== 'string' || !led.source.trim()) {
    throw new TypeError(`${id}: an LED names its data-source (the state it shows).`);
  }
  if (typeof led.lit !== 'boolean') {
    throw new TypeError(`${id}: an LED's lit is the state's boolean, not ${typeof led.lit}.`);
  }
}

function colourOf(tokens, colour) {
  if (!LED_COLOURS.includes(colour)) {
    throw new TypeError(`ledSvg: colour is a state token role (${LED_COLOURS.join(', ')}), `
      + `not ${JSON.stringify(colour)}.`);
  }
  const [group, role] = colour.split('.');
  const value = tokens[group] && tokens[group][role];
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`ledSvg: the tokens have no ${colour}.`);
  }
  return value;
}

export function ledSvg({ at, lit, source, tokens, colour, zoom = 1, label,
  interactive = false } = {}) {
  checkSource(source, 'ledSvg');
  if (typeof lit !== 'boolean') {
    throw new TypeError(`ledSvg: lit is the state's boolean, not ${typeof lit}.`);
  }
  checkTokens(tokens, 'ledSvg');
  if (typeof tokens.control.bezel !== 'string' || !tokens.control.bezel) {
    throw new TypeError('ledSvg: the tokens have no control.bezel (synthTokens(el)).');
  }
  checkZoom(zoom, 'ledSvg');
  const { x, y } = pointOf(at, 'ledSvg');
  const t = tokens;
  // The default before D-PAL's control.led reaches a token set: the ring, as it was.
  const paint = !lit ? t.surface.card : colour === undefined && !t.control.led ? t.control.ring
    : colourOf(t, colour ?? 'control.led');
  const ring = lit ? t.surface.edge : t.control.edge;
  const halo = lit ? `<circle data-halo="" class="opacity-hw-sheen" aria-hidden="true" `
    + `pointer-events="none" cx="${num(x)}" cy="${num(y)}" r="${num(LED.lens + haloReach(zoom))}" `
    + `fill="${esc(paint)}" stroke="none"/>` : '';
  const named = label !== undefined && label !== null && label !== '';
  const a11y = named ? ` role="img" aria-label="${esc(label)}: ${lit ? 'on' : 'off'}"`
    : ' aria-hidden="true"';
  const open = `<g data-led="" data-source="${esc(source)}" data-lit="${String(lit)}"${a11y}`;
  const size = LABEL_PX / zoom;
  const drawing = `<circle data-bezel="" cx="${num(x)}" cy="${num(y)}" r="${LED.bezel}" `
    + `fill="${esc(t.control.capHi)}" stroke="${esc(t.control.bezel)}" `
    + `stroke-width="${LED.bezelW}"/>`
    + halo
    + `<circle data-lens="" cx="${num(x)}" cy="${num(y)}" r="${LED.lens}" `
    + `fill="${esc(paint)}" stroke="${esc(ring)}" stroke-width="${LED.ringW}"/>`
    + (named ? `<text x="${num(x)}" y="${num(y + ledHalf(zoom) + LED.labelGap + size)}" `
      + `font-size="${num(size)}" text-anchor="middle" fill="${esc(t.text.label)}" `
      + `stroke="none">${esc(label)}</text>` : '');
  return wrap(open, ledBox({ at: { x, y }, zoom, label }), zoom, interactive, drawing);
}

// ---------------------------------------------------------------- the meter

const SCALES = Object.freeze(['relative', 'calibrated']);

/** The meter's extent, graph units: the face, and the unit below it on a calibrated scale. */
export function meterBox({ at, zoom = 1, unit } = {}) {
  checkZoom(zoom, 'meterBox');
  const { x, y } = pointOf(at, 'meterBox');
  const B = METER_BOX;
  const size = LABEL_PX / zoom;
  const width = unit ? Math.max(B.width, legendWidth(unit, size)) : B.width;
  const height = B.height + (unit ? METER.unitGap + size * 1.2 : 0);
  return Object.freeze({ x: num(x - width / 2), y: num(y + B.y), width: num(width),
    height: num(height) });
}

function checkScale(scale, unit, calibrated) {
  if (!SCALES.includes(scale)) {
    throw new TypeError(`meterSvg: scale is 'relative' or 'calibrated', not `
      + `${JSON.stringify(scale)}.`);
  }
  if (scale === 'relative') {
    if (unit !== undefined && unit !== null) {
      throw new TypeError('meterSvg: a relative scale draws no unit; a unit needs a '
        + "'calibrated' scale and the calibration that makes it true.");
    }
    return;
  }
  if (calibrated !== true) {
    throw new TypeError("meterSvg: a 'calibrated' scale needs calibrated === true, the valid "
      + 'calibration state (project.no-fake-science); without it the scale is relative.');
  }
  if (typeof unit !== 'string' || !unit.trim()) {
    throw new TypeError("meterSvg: a 'calibrated' scale names its unit.");
  }
}

export function meterSvg({ at, value, source, scale, unit, calibrated = false, tokens, zoom = 1,
  interactive = false } = {}) {
  checkSource(source, 'meterSvg');
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`meterSvg: value is the state's finite number, not ${String(value)}.`);
  }
  checkScale(scale, unit, calibrated);
  checkTokens(tokens, 'meterSvg');
  checkZoom(zoom, 'meterSvg');
  const { x, y } = pointOf(at, 'meterSvg');
  const t = tokens;
  const M = METER;
  const shown = Math.min(1, Math.max(0, value));
  const pinned = value < 0 ? ' data-pinned="low"' : value > 1 ? ' data-pinned="high"' : '';
  const open = `<g data-needle="" data-source="${esc(source)}" data-value="${String(value)}"`
    + ` data-scale="${scale}"${pinned} aria-hidden="true"`;
  const px = x;
  const py = y + M.pivotY;
  const from = -M.sweep / 2;
  const [ax0, ay0] = polar(px, py, M.arcR, from);
  const [ax1, ay1] = polar(px, py, M.arcR, -from);
  let ticks = '';
  for (let i = 0; i < M.ticks; i++) {
    const deg = from + (i * M.sweep) / (M.ticks - 1);
    const major = i % M.major === 0;
    const [x0, y0] = polar(px, py, major ? M.majorIn : M.tickIn, deg);
    const [x1, y1] = polar(px, py, M.arcR, deg);
    ticks += `<line data-tick="" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" `
      + `stroke="${esc(t.control.track)}" stroke-width="${major ? M.majorW : M.tickW}" `
      + 'stroke-linecap="butt"/>';
  }
  const [nx, ny] = polar(px, py, M.needle, from + shown * M.sweep);
  const B = METER_BOX;
  const size = LABEL_PX / zoom;
  const drawing = `<rect data-face="" x="${num(x + B.x)}" y="${num(y + B.y)}" width="${B.width}" `
    + `height="${B.height}" rx="${M.faceRx}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(t.control.edge)}" stroke-width="${M.edgeW}"/>`
    + `<path data-scale-arc="" d="M ${ax0} ${ay0} A ${M.arcR} ${M.arcR} 0 0 1 ${ax1} ${ay1}" `
    + `fill="none" stroke="${esc(t.control.track)}" stroke-width="${M.arcW}"/>`
    + ticks
    + `<line data-needle-arm="" x1="${num(px)}" y1="${num(py)}" x2="${nx}" y2="${ny}" `
    + `stroke="${esc(t.control.pointer)}" stroke-width="${M.needleW}" stroke-linecap="round"/>`
    + `<circle data-pivot="" cx="${num(px)}" cy="${num(py)}" r="${M.cap}" `
    + `fill="${esc(t.control.cap)}" stroke="${esc(t.control.edge)}" stroke-width="${M.edgeW}"/>`
    + (scale === 'calibrated' ? `<text x="${num(x)}" `
      + `y="${num(y + B.y + B.height + M.unitGap + size)}" font-size="${num(size)}" `
      + `text-anchor="middle" fill="${esc(t.text.label)}" stroke="none">${esc(unit)}</text>`
      : '');
  return wrap(open, meterBox({ at: { x, y }, zoom, unit: scale === 'calibrated' ? unit : null }),
    zoom, interactive, drawing);
}
