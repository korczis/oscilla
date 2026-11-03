// The synth-theme layer's switches drawn as hardware (plan F013 entry 5, slice S5; K058): pure
// functions, no listener, no document. An enum or a boolean is drawn by its position count:
//   2      toggle   an 18 x 30 r4 housing in surface.card with a 3:1 edge (control.edge), a
//                   bushing, an 8 x 14 lever in control.pointer pointing at the selected
//                   legend (the second option up, as controlSvg's switch has it); an optional
//                   LED beside it
//   3-4    slide    a slot 4 wide, a 16 x 12 cap at the selected index, a detent per position,
//                   legends to the right (index 0 at the bottom)
//   5-8    rotary   a detented rotary selector: the knob face (skirt, cap with its shadow and
//                   highlight, pointer) with a detent per position over 270°, the selected one
//                   lit, and the legends around it at r >= 60, the radius the least that keeps
//                   every 44 px hit box apart
//   9-12   window   the same dial with a display-window frame above it for the selected name
//                   (the frame only: its text is the caller's, at layout.window) and a legend
//                   grid of 44 px cells below it
// The drawing is aria-hidden and takes no pointer: the caller keeps each option a
// [data-option][data-v][aria-checked] radio button (never the slider role of ariaAttrs) and
// places it at switchLayout's hit box, at least HIT_PX screen px a side at the given zoom and
// never overlapping another; the box holds the legend. Graph units: 1 is 1 CSS px at zoom 1,
// the mechanism centred on the origin; layout.box holds everything drawn and every hit box
// (zoom >= 1: at a smaller zoom the boxes grow with the 44 px rule and the box with them).
// Legends are LEGEND_PX screen px at any zoom, in text.label (4.5:1), the selected or hovered
// one in text.value at weight 600, text.dim while disabled; their width is an estimate from the
// glyphs (legendWidth), used only to lay the boxes out. Colours are tokens passed in
// (synthTokens; project.visual-identity-lock) and no number sets an intensity (v4): a shadow is
// class opacity-hw-shadow, the cap highlight opacity-hw-sheen, an LED's glow shadow-hw-led
// alone, and an LED binds data-source and data-lit interpolated from the caller's { source, lit }
// (the parameter's real state, never a literal). A box-shadow paints no SVG element, so where an
// SVG host draws the LED its state is told by its fill alone (control.ring lit, surface.card with
// a control.edge ring off; both 3:1). A setpoint: nothing moves, so no reduced-motion check.
//
//   switchStyle(param)                       'toggle' | 'slide' | 'rotary' | 'window'
//   switchLayout(param, { zoom, led })       frozen { style, positions, zoom, legendPx, radius,
//                                            box, options, window, led } (graph units)
//   switchOptions(param, { zoom, led })      layout.options: per option { index, value, label,
//                                            legend: { x, y, anchor, size, width }, hit }
//   switchSvg({ value, param, tokens, zoom, state, led, legends })   the drawing, an SVG <g>
//   SWITCH_STYLES, LEGEND_PX, legendWidth

import { clampValue, formatValue, HIT_PX } from './knob.js';

/** Each style's position counts, inclusive. */
export const SWITCH_STYLES = Object.freeze({
  toggle: Object.freeze([2, 2]),
  slide: Object.freeze([3, 4]),
  rotary: Object.freeze([5, 8]),
  window: Object.freeze([9, 12]),
});
/** A legend's size in screen px at any zoom (the 12 px font floor). */
export const LEGEND_PX = 12;
const MAX_POSITIONS = 12;
/** Around a legend inside its hit box, graph units. */
const PAD = 6;
const TOGGLE = Object.freeze({ w: 18, h: 30, rx: 4, edgeW: 1.5, leverW: 8, leverH: 14,
  bushing: 5.5, gap: 4, ledR: 3, ledGap: 3.5, shadowDy: 1, shadowDragDy: 2 });
const SLIDE = Object.freeze({ slotW: 4, capW: 16, capH: 12, tickIn: -13, tickOut: -10,
  legendX: 14, pitchPad: 8, gripW: 2 });
const DIAL = Object.freeze({ sweep: 270, skirt: 17, edgeW: 1.5, cap: 12, pointerIn: 3,
  pointerOut: 15, pointerW: 2.5, tickIn: 19, tickOut: 23, tickW: 1.5, litW: 2, leaderIn: 25,
  radius: 60, radiusStep: 2, radiusMax: 240, clear: 24, shadowDy: 1, shadowDragDy: 2 });
const WINDOW = Object.freeze({ minW: 88, pad: 10, gap: 8, gridGap: 10, gridMaxW: 6 * HIT_PX,
  barW: 2 });
const SHADOW_CLASS = 'opacity-hw-shadow';
const SHEEN_CLASS = 'opacity-hw-sheen';
const LED_CLASS = 'shadow-hw-led';

const num = (x) => Number(x.toFixed(2));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const idOf = (p) => (p ? p.id ?? p.key ?? 'param' : 'param');
const rad = (deg) => (deg * Math.PI) / 180;
/** The point at radius r and angle deg (0 up, clockwise). */
const polar = (r, deg) => [num(r * Math.sin(rad(deg))), num(-r * Math.cos(rad(deg)))];

// ---------------------------------------------------------------- options and style

/** The [value, label] options: an enum's own, Off/On of a boolean; a number is refused. */
function optionsOf(p) {
  if (p && p.type === 'boolean') return [false, true].map((v) => [v, formatValue(v, p)]);
  if (p && p.type === 'enum') {
    clampValue(undefined, p); // refuses an enum with no option
    return p.options;
  }
  throw new Error(`${idOf(p)}: a switch is for an enum or a boolean; draw a number as a knob `
    + 'or a fader.');
}

/** The style of a switch for `param`, by its position count (SWITCH_STYLES). */
export function switchStyle(param) {
  const n = optionsOf(param).length;
  for (const [style, [lo, hi]] of Object.entries(SWITCH_STYLES)) {
    if (n >= lo && n <= hi) return style;
  }
  if (n < 2) throw new Error(`${idOf(param)}: a switch needs at least two options, not ${n}.`);
  throw new Error(`${idOf(param)}: a switch has at most ${MAX_POSITIONS} positions, not ${n}; `
    + 'pick the value from a list.');
}

const NARROW = /[ .,:;'|!()[\]/\-iIjlft]/;
const WIDE = /[MWmw@%→←·]/;
/** An estimate of a label's width at `size`: a glyph-class sum, on the generous side. */
export function legendWidth(label, size = LEGEND_PX) {
  let em = 0;
  for (const ch of String(label)) {
    if (NARROW.test(ch)) em += 0.34;
    else if (WIDE.test(ch)) em += 0.92;
    else if (/[A-Z0-9#&]/.test(ch)) em += 0.68;
    else em += 0.57;
  }
  return num(em * size);
}

// ---------------------------------------------------------------- the layout

/** Up to the next 0.02, so a size never rounds under the 44 px rule and its half is exact. */
const up = (x) => Math.ceil(x * 50 - 1e-9) / 50;
const rect = (x, y, width, height) => ({ x: num(x), y: num(y), width: num(width),
  height: num(height) });
const overlaps = (a, b) => a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9
  && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9;
/** The least distance from the origin to a rect. */
const reach = (r) => Math.hypot(Math.max(r.x, Math.min(0, r.x + r.width)),
  Math.max(r.y, Math.min(0, r.y + r.height)));
const option = (index, [value, label], legend, hit) => ({ index, value, label, legend, hit });

/** A legend's text box from its anchor point. */
function textBox(lg) {
  const x = lg.anchor === 'start' ? lg.x : (lg.anchor === 'end' ? lg.x - lg.width
    : lg.x - lg.width / 2);
  return { x, y: lg.y - lg.size / 2, width: lg.width, height: lg.size };
}

function toggleLayout(opts, H, F) {
  const T = TOGGLE;
  const half = T.h / 2;
  const reachY = Math.max(H, half + T.gap + F + 2);
  const options = opts.map((o, i) => {
    const dir = i === 1 ? -1 : 1;
    const w = legendWidth(o[1], F);
    const legend = { x: 0, y: num(dir * (half + T.gap + F / 2)), anchor: 'middle', size: F,
      width: w };
    const hw = up(Math.max(H, w + 2 * PAD, T.w + 2 * PAD));
    return option(i, o, legend, rect(-hw / 2, dir < 0 ? -reachY : 0, hw, reachY));
  });
  const e = T.edgeW / 2;
  const lever = T.leverH + T.shadowDragDy;
  return { options, mech: [-T.w / 2 - e, -Math.max(half + e, T.leverH), T.w / 2 + e,
    Math.max(half + e, lever)] };
}

function slideLayout(opts, H, F) {
  const S = SLIDE;
  const n = opts.length;
  const pitch = up(Math.max(H, F + S.pitchPad));
  const yAt = (i) => num(((n - 1) / 2 - i) * pitch);
  const x0 = S.tickIn - 1;
  const options = opts.map((o, i) => {
    const w = legendWidth(o[1], F);
    const legend = { x: S.legendX, y: yAt(i), anchor: 'start', size: F, width: w };
    const width = up(Math.max(H, S.legendX + w + PAD - x0));
    return option(i, o, legend, rect(x0, yAt(i) - pitch / 2, width, pitch));
  });
  const end = ((n - 1) / 2) * pitch + S.capH / 2 + 1;
  return { options, pitch, mech: [S.tickIn - 1, -end - 1, S.capW / 2 + 1, end + 1 + 2] };
}

const dialAngle = (i, n) => -DIAL.sweep / 2 + (i * DIAL.sweep) / (n - 1);
const DIAL_MECH = [-DIAL.tickOut - 1, -DIAL.tickOut - 1, DIAL.tickOut + 1, DIAL.tickOut + 1];

/** The legends round the dial at radius R: anchored away from it, each box holding its text. */
function ringAt(opts, R, H, F) {
  return opts.map((o, i) => {
    const [x, y] = polar(R, dialAngle(i, opts.length));
    const s = Math.sin(rad(dialAngle(i, opts.length)));
    const anchor = s > 0.35 ? 'start' : (s < -0.35 ? 'end' : 'middle');
    const legend = { x, y, anchor, size: F, width: legendWidth(o[1], F) };
    const t = textBox(legend);
    const hw = up(Math.max(H, t.width + 2 * PAD));
    const hh = up(Math.max(H, F + 2 * PAD));
    return option(i, o, legend, rect(t.x + t.width / 2 - hw / 2, y - hh / 2, hw, hh));
  });
}

function rotaryLayout(opts, H, F, id) {
  for (let R = DIAL.radius; R <= DIAL.radiusMax; R += DIAL.radiusStep) {
    const options = ringAt(opts, R, H, F);
    const apart = options.every((a, i) => options.slice(i + 1).every((b) => !overlaps(a.hit,
      b.hit)));
    if (apart && options.every((o) => reach(o.hit) > DIAL.clear)) {
      return { options, radius: R, mech: DIAL_MECH };
    }
  }
  throw new Error(`${id}: the legends do not fit round a rotary selector; shorten them.`);
}

function windowLayout(opts, H, F) {
  const n = opts.length;
  const widest = Math.max(...opts.map((o) => legendWidth(o[1], F)));
  const cellW = up(Math.max(H, widest + 2 * PAD));
  const cellH = up(Math.max(H, F + 2 * PAD));
  const cols = Math.min(n, Math.max(1, Math.floor(WINDOW.gridMaxW / Math.max(HIT_PX,
    widest + 2 * PAD))));
  const top = DIAL.tickOut + WINDOW.gridGap;
  const options = opts.map((o, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const x = -(inRow * cellW) / 2 + (i % cols) * cellW;
    const y = top + row * cellH;
    const legend = { x: num(x + cellW / 2), y: num(y + cellH / 2), anchor: 'middle', size: F,
      width: legendWidth(o[1], F) };
    return option(i, o, legend, rect(x, y, cellW, cellH));
  });
  const ww = Math.max(WINDOW.minW, widest + 2 * WINDOW.pad);
  const wh = F + WINDOW.pad;
  const win = rect(-ww / 2, -(DIAL.tickOut + WINDOW.gap + wh), ww, wh);
  return { options, window: win, mech: DIAL_MECH };
}

const LAYOUTS = Object.freeze({ toggle: toggleLayout, slide: slideLayout, rotary: rotaryLayout,
  window: windowLayout });

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/**
 * Where everything of a switch for `param` lies at `zoom`, graph units: the style, the position
 * count, the legend size (LEGEND_PX screen px), the rotary's legend radius, per option its
 * legend ({ x, y, anchor: 'start' | 'middle' | 'end', size, width }) and its hit box (at least
 * HIT_PX / zoom a side, holding the legend, never overlapping another, clear of a dial), the
 * window's frame (the caller's text goes there), the LED's circle when `led` asks for one (a
 * toggle's alone) and the box that holds all of it. Deep-frozen.
 */
export function switchLayout(param, { zoom = 1, led = false } = {}) {
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`switchLayout: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const style = switchStyle(param);
  const opts = optionsOf(param);
  if (led && style !== 'toggle') {
    throw new Error(`${idOf(param)}: an LED goes on a toggle, not on a ${style} selector.`);
  }
  const H = up(HIT_PX / zoom);
  const F = up(Math.max(LEGEND_PX, LEGEND_PX / zoom));
  const L = LAYOUTS[style](opts, H, F, idOf(param));
  let ledAt = null;
  const b = [...L.mech];
  if (led) {
    const T = TOGGLE;
    ledAt = { cx: T.w / 2 + T.ledGap + T.ledR, cy: 0, r: T.ledR };
    b[2] = Math.max(b[2], ledAt.cx + T.ledR + 0.5);
  }
  const grow = (r) => {
    b[0] = Math.min(b[0], r.x);
    b[1] = Math.min(b[1], r.y);
    b[2] = Math.max(b[2], r.x + r.width);
    b[3] = Math.max(b[3], r.y + r.height);
  };
  for (const o of L.options) {
    grow(o.hit);
    grow(textBox(o.legend));
  }
  if (L.window) grow({ x: L.window.x - 0.5, y: L.window.y - 0.5, width: L.window.width + 1,
    height: L.window.height + 1 });
  return deepFreeze({ style, positions: opts.length, zoom, legendPx: F,
    radius: L.radius ?? null, pitch: L.pitch ?? null, box: rect(b[0], b[1], b[2] - b[0],
      b[3] - b[1]), options: L.options, window: L.window ?? null, led: ledAt });
}

/** The options of switchLayout(param, opts): per option its legend and its 44 px hit box. */
export function switchOptions(param, opts) {
  return switchLayout(param, opts).options;
}

// ---------------------------------------------------------------- the drawing

function toggleShapes(L, sel, t, st) {
  const T = TOGGLE;
  const c = t.control;
  const y = sel === 1 ? -T.leverH : 0;
  const dy = st.dragging ? T.shadowDragDy : T.shadowDy;
  const lever = (attrs, ly) => `<rect ${attrs} x="${-T.leverW / 2}" y="${ly}" `
    + `width="${T.leverW}" height="${T.leverH}" rx="${T.leverW / 2}"`;
  return `<rect data-housing="" x="${-T.w / 2}" y="${-T.h / 2}" width="${T.w}" `
    + `height="${T.h}" rx="${T.rx}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(st.hover ? c.pointer : c.edge)}" stroke-width="${T.edgeW}"/>`
    + `<circle data-bushing="" cx="0" cy="0" r="${T.bushing}" fill="${esc(t.surface.edge)}" `
    + `stroke="${esc(c.edge)}" stroke-width="1"/>`
    + `${lever(`data-shadow="" class="${SHADOW_CLASS}"`, y + dy)} `
    + `fill="${esc(t.surface.edge)}" stroke="none"/>`
    + `${lever('data-lever=""', y)} fill="${esc(st.disabled ? c.disabled : c.pointer)}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`;
}

function slideShapes(L, sel, t, st) {
  const S = SLIDE;
  const c = t.control;
  const ys = L.options.map((o) => o.legend.y);
  const end = Math.max(...ys.map(Math.abs)) + S.capH / 2 + 1;
  const yc = ys[sel];
  const dy = st.dragging ? 2 : 1;
  const cap = (attrs, y) => `<rect ${attrs} x="${-S.capW / 2}" y="${num(y - S.capH / 2)}" `
    + `width="${S.capW}" height="${S.capH}" rx="2"`;
  return `<rect data-slot="" x="${-S.slotW / 2}" y="${num(-end)}" width="${S.slotW}" `
    + `height="${num(2 * end)}" rx="${S.slotW / 2}" fill="${esc(t.surface.edge)}" `
    + `stroke="${esc(st.hover ? c.pointer : c.edge)}" stroke-width="1"/>`
    + ys.map((y, i) => `<line data-detent="" x1="${S.tickIn}" y1="${y}" x2="${S.tickOut}" `
      + `y2="${y}" stroke="${esc(i === sel ? c.ring : c.track)}" `
      + `stroke-width="${i === sel ? DIAL.litW : DIAL.tickW}"/>`).join('')
    + `${cap(`data-shadow="" class="${SHADOW_CLASS}"`, yc + dy)} fill="${esc(t.surface.edge)}" `
    + 'stroke="none"/>'
    + `${cap('data-cap=""', yc)} fill="${esc(c.cap)}" stroke="${esc(c.edge)}" `
    + 'stroke-width="1.5"/>'
    + `<line data-grip="" x1="-5" y1="${yc}" x2="5" y2="${yc}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="${S.gripW}"/>`;
}

function dialShapes(L, sel, t, st) {
  const D = DIAL;
  const c = t.control;
  const n = L.options.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = dialAngle(i, n);
    const [x0, y0] = polar(D.tickIn, a);
    const [x1, y1] = polar(D.tickOut, a);
    out += `<line data-detent="" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" `
      + `stroke="${esc(i === sel ? c.ring : c.track)}" `
      + `stroke-width="${i === sel ? D.litW : D.tickW}"/>`;
    if (L.radius) {
      const [lx0, ly0] = polar(D.leaderIn, a);
      const [lx1, ly1] = polar(L.radius - L.legendPx / 2 - 3, a);
      out += `<line data-leader="" x1="${lx0}" y1="${ly0}" x2="${lx1}" y2="${ly1}" `
        + `stroke="${esc(c.track)}" stroke-width="1"/>`;
    }
  }
  const [px0, py0] = polar(D.pointerIn, dialAngle(sel, n));
  const [px1, py1] = polar(D.pointerOut, dialAngle(sel, n));
  const w = L.window;
  return out
    + `<circle data-skirt="" cx="0" cy="0" r="${D.skirt}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(st.hover ? c.pointer : c.edge)}" stroke-width="${D.edgeW}"/>`
    + `<circle data-shadow="" class="${SHADOW_CLASS}" cx="0" `
    + `cy="${st.dragging ? D.shadowDragDy : D.shadowDy}" r="${D.cap}" `
    + `fill="${esc(t.surface.edge)}" stroke="none"/>`
    + `<circle data-cap="" cx="0" cy="0" r="${D.cap}" fill="${esc(c.cap)}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`
    + `<ellipse class="${SHEEN_CLASS}" cx="-3.5" cy="-4.5" rx="5" ry="3.5" `
    + `fill="${esc(c.capHi)}" stroke="none"/>`
    + `<line data-pointer="" x1="${px0}" y1="${py0}" x2="${px1}" y2="${py1}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="${D.pointerW}" `
    + 'stroke-linecap="round"/>'
    + (w ? `<rect data-window="" x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}" `
      + `rx="2" fill="${esc(t.surface.edge)}" stroke="${esc(c.edge)}" stroke-width="1"/>` : '');
}

const SHAPES = Object.freeze({ toggle: toggleShapes, slide: slideShapes, rotary: dialShapes,
  window: dialShapes });

/** A state's option: true is the selected one, { option: v } the option of value v (false
 *  included, so a boolean's Off can be named), anything else none. */
function stateIndex(x, sel, opts) {
  if (x === true) return sel;
  if (!x || typeof x !== 'object' || !Object.hasOwn(x, 'option')) return -1;
  return opts.findIndex((o) => o[0] === x.option);
}

/** The LED's circle: its state bound to the caller's { source, lit }, glowing only when lit. */
function ledShape(at, led, t) {
  const lit = led.lit;
  const paint = lit ? t.control.ring : t.surface.card;
  const ring = lit ? t.control.ring : t.control.edge;
  const glow = lit ? ` class="${LED_CLASS}"` : '';
  return `<circle data-led="" data-source="${esc(led.source)}" data-lit="${String(lit)}"${glow} `
    + `cx="${num(at.cx)}" cy="${at.cy}" r="${at.r}" fill="${esc(paint)}" stroke="${esc(ring)}" `
    + 'stroke-width="1"/>';
}

function checkLed(led, id) {
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

/**
 * A switch for `param` at `value` as an SVG '<g>' string (aria-hidden, pointer-events none),
 * laid out as switchLayout(param, { zoom, led }) and drawn only from `tokens` (synthTokens).
 * `state` is { hover, focus, dragging, disabled }: hover (true, or { option: v }) lights the
 * mechanism's edge in control.pointer and that option's legend; focus (true: the selected
 * option, or { option: v }) rings that option's hit box in control.focus, 2 wide, inside it; dragging lifts the shadow; disabled dims the indicator (control.disabled) and the legends
 * (text.dim) and marks the group data-disabled (the caller's buttons carry aria-disabled and
 * the reason). The selected option's legend is text.value at weight 600; in a window grid a bar
 * in control.ring underlines it. `led` ({ source, lit }, a toggle's alone) draws the LED;
 * `legends: false` leaves the legends to the caller. A setpoint: no animation.
 */
export function switchSvg({ value, param, tokens, zoom = 1, state = {}, led = null,
  legends = true } = {}) {
  if (!tokens || !tokens.control || !tokens.surface || !tokens.text) {
    throw new TypeError('switchSvg needs the synth tokens (synthTokens(el)).');
  }
  const id = idOf(param);
  const L = switchLayout(param, { zoom, led: led !== null && led !== undefined });
  if (led !== null && led !== undefined) checkLed(led, id);
  const opts = optionsOf(param);
  const v = clampValue(value, param);
  const sel = opts.findIndex((o) => o[0] === v);
  const st = state || {};
  const hover = stateIndex(st.hover, sel, opts);
  const focus = stateIndex(st.focus, sel, opts);
  const tx = tokens.text;
  let out = SHAPES[L.style](L, sel, tokens, st);
  if (legends) {
    for (const o of L.options) {
      const lit = o.index === sel || o.index === hover;
      const lg = o.legend;
      out += `<text data-legend="" data-index="${o.index}" x="${lg.x}" y="${lg.y}" `
        + `font-size="${num(lg.size)}" text-anchor="${lg.anchor}" dominant-baseline="central" `
        + `font-weight="${o.index === sel ? 600 : 400}" `
        + `fill="${esc(st.disabled ? tx.dim : (lit ? tx.value : tx.label))}" stroke="none">`
        + `${esc(o.label)}</text>`;
      if (L.style === 'window' && o.index === sel) {
        const y = num(lg.y + lg.size / 2 + 2);
        out += `<line data-selected="" x1="${num(lg.x - lg.width / 2)}" y1="${y}" `
          + `x2="${num(lg.x + lg.width / 2)}" y2="${y}" `
          + `stroke="${esc(st.disabled ? tokens.control.disabled : tokens.control.ring)}" `
          + `stroke-width="${WINDOW.barW}"/>`;
      }
    }
  }
  if (focus >= 0) {
    const h = L.options[focus].hit;
    out += `<rect data-focus="" x="${num(h.x + 1)}" y="${num(h.y + 1)}" `
      + `width="${num(h.width - 2)}" height="${num(h.height - 2)}" rx="4" fill="none" `
      + `stroke="${esc(tokens.control.focus)}" stroke-width="2"/>`;
  }
  if (L.led) out += ledShape(L.led, led, tokens);
  return `<g data-control="switch" data-style="${L.style}" aria-hidden="true" `
    + `pointer-events="none"${st.disabled ? ' data-disabled=""' : ''}>${out}</g>`;
}
