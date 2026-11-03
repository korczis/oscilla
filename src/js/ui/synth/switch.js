// The synth-theme layer's switches drawn as hardware (plan F013 entry 5, slice S5; K058): pure
// functions, no listener, no document. An enum or a boolean is drawn by its position count:
//   2      toggle   an 18 x 30 r4 housing in surface.card with a 3:1 edge (control.edge), a
//                   bushing, an 8 x 14 lever in control.pointer pointing at the selected
//                   legend (the second option up, as controlSvg's switch has it); an optional
//                   LED beside it
//   3-4    slide    a slot 4 wide, a 16 x 12 cap at the selected index, a detent per position,
//                   legends to the right (index 0 at the bottom)
//   5-8    rotary   a detented rotary selector: the knob's face (knob.js's: skirt, its 24-ridge
//                   knurl, cap with its shadow and highlight) at the size of the knob beside it
//                   (`knob`, graph units, CONTROL_BOX.knob.width by default), a pointer, a
//                   detent per position over 270° ending inside that knob's box, the selected
//                   one lit, and the legends around it at r >= 60, the radius the least that
//                   keeps every 44 px hit box apart and clear of the dial (searched to 240,
//                   scaled by the hit box below zoom 1; only legends too long for that are
//                   refused, naming the zoom)
//   9-12   window   the same dial with a display-window frame above it for the selected name
//                   (the frame only: its text is the caller's, at layout.window) and a legend
//                   grid of 44 px cells below it
// A dial of NUMBERED_MIN (7) or more detents numbers them 1..n (`numbers`: true numbers any
// dial, false none), each numeral at its detent
// outside the ticks (layout option.number, option.numeral), the selected one lit; with
// `numberLegends` each legend reads "n · label" (legend.text), as a hardware algorithm chart.
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
// class opacity-hw-shadow, the cap highlight opacity-hw-sheen, and a toggle's LED is led.js's
// (ledSvg: its bezel, its lens in control.ring lit or surface.card with a control.edge ring off,
// both 3:1, and lit its SVG halo at the hw-sheen intensity), so every LED of the layer looks
// alike; the caller's { source, lit } is passed through, and ledSvg binds data-source and
// data-lit from it (the parameter's real state, never a literal). A setpoint: nothing moves, so
// no reduced-motion check.
//
//   switchStyle(param)                       'toggle' | 'slide' | 'rotary' | 'window'
//   switchLayout(param, { zoom, led, knob, numbers, numberLegends })   frozen { style, positions,
//                                            zoom, knob, legendPx, radius, pitch, dial, box,
//                                            options, window, led } (graph units)
//   switchOptions(param, opts)               layout.options: per option { index, value, label,
//                                            legend: { x, y, anchor, size, width, text }, hit,
//                                            number, numeral }
//   switchSvg({ value, param, tokens, zoom, state, led, legends, knob, numbers, numberLegends })
//                                            the drawing, an SVG <g>
//   SWITCH_STYLES, LEGEND_PX, NUMBERED_MIN, legendWidth

import { CONTROL_BOX, clampValue, formatValue, HIT_PX } from './knob.js';
import { legendWidth } from './legend.js';
import { LED, ledBox, ledSvg } from './led.js';

/** legendWidth is legend.js's, which led.js reads too. */
export { legendWidth };

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
  bushing: 5.5, gap: 4, ledGap: 3.5, shadowDy: 1, shadowDragDy: 2 });
const SLIDE = Object.freeze({ slotW: 4, capW: 16, capH: 12, tickIn: -13, tickOut: -10,
  legendX: 14, pitchPad: 8, gripW: 2 });
/** The knob's face in its CONTROL_BOX.knob units, as knob.js draws it (its KNOB: the skirt and
 *  its edge, the 24-ridge knurl from r 14.5 to 16, the cap, the pointer's width; the knob tests
 *  pin each), so a dial at the knob's size is the knob's face. */
const KNOB_FACE = Object.freeze({ skirt: 16, edgeW: 1.5, knurlIn: 14.5, knurlOut: 16, knurls: 24,
  cap: 12, pointerW: 2.5 });
/** A dial in the units of the knob beside it (scaled by knob / CONTROL_BOX.knob.width): the
 *  knob's face (KNOB_FACE), a pointer from the cap's centre to the knurl, and a detent per
 *  position from outside the skirt to r 21.75, so its butt corners stay in the knob's box. */
const DIAL = Object.freeze({ sweep: 270, pointerIn: 3, pointerOut: 14, tickIn: 18.5,
  tickOut: 21.75, tickW: 1.5, litW: 2, shadowDy: 1, shadowDragDy: 2, sheen: [-3.5, -4.5, 5, 3.5] });
/** A dial's surroundings, graph units: the ring's least radius, its search step and limit, the
 *  gap past the dial a leader starts at, and the numerals' gap past the ticks, their search step
 *  and the space kept between two of them. */
const RING = Object.freeze({ radius: 60, radiusStep: 2, radiusMax: 240, margin: 1, leaderGap: 3,
  numberGap: 2, numberStep: 0.5, numberApart: 1 });
/** A dial of this many detents or more numbers them. */
export const NUMBERED_MIN = 7;
const WINDOW = Object.freeze({ minW: 88, pad: 10, gap: 8, gridGap: 10, gridMaxW: 6 * HIT_PX,
  barW: 2 });
const SHADOW_CLASS = 'opacity-hw-shadow';
const SHEEN_CLASS = 'opacity-hw-sheen';

const num = (x) => Number(x.toFixed(2)) + 0; // + 0: never -0
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
const option = (index, [value, label, text], legend, hit) => ({ index, value, label,
  legend: { ...legend, text }, hit, number: null, numeral: null });

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
    const w = legendWidth(o[2], F);
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
    const w = legendWidth(o[2], F);
    const legend = { x: S.legendX, y: yAt(i), anchor: 'start', size: F, width: w };
    const width = up(Math.max(H, S.legendX + w + PAD - x0));
    return option(i, o, legend, rect(x0, yAt(i) - pitch / 2, width, pitch));
  });
  const end = ((n - 1) / 2) * pitch + S.capH / 2 + 1;
  return { options, pitch, mech: [S.tickIn - 1, -end - 1, S.capW / 2 + 1, end + 1 + 2] };
}

const dialAngle = (i, n) => -DIAL.sweep / 2 + (i * DIAL.sweep) / (n - 1);

/** The numerals 1..n round a dial at radius r, each centred on its detent's angle. */
function numeralsAt(n, r, F) {
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = polar(r, dialAngle(i, n));
    return { x, y, anchor: 'middle', size: F, width: legendWidth(String(i + 1), F) };
  });
}

/** A rect grown by d each side. */
const grown = (r, d) => ({ x: r.x - d, y: r.y - d, width: r.width + 2 * d,
  height: r.height + 2 * d });

/**
 * The dial of n detents beside a knob `knob` units wide, legends F units: its scale, skirt and
 * tick radius; the numerals when `numbers` (the least radius, from the ticks outward,
 * at which every numeral clears the ticks by RING.numberGap and its neighbours by
 * RING.numberApart); `radius`, the circle that holds the dial and its numerals; `extent`, the
 * half side of the square that does; and `leaderIn`, where a leader may start.
 */
function dialOf(n, knob, F, numbers) {
  const k = knob / CONTROL_BOX.knob.width;
  const tickOut = DIAL.tickOut * k;
  const base = (CONTROL_BOX.knob.width / 2) * k + RING.margin;
  if (!numbers) {
    return { scale: k, skirt: num(KNOB_FACE.skirt * k), tickOut: num(tickOut), numerals: null,
      radius: num(base), extent: num(base), leaderIn: num(base + RING.leaderGap - RING.margin) };
  }
  for (let r = tickOut; ; r += RING.numberStep) {
    const ms = numeralsAt(n, r, F);
    const boxes = ms.map(textBox);
    const clear = boxes.every((b) => reach(b) >= tickOut + RING.numberGap);
    const apart = boxes.every((a, i) => boxes.slice(i + 1).every((b) => !overlaps(grown(a,
      RING.numberApart / 2), grown(b, RING.numberApart / 2))));
    if (clear && apart) {
      const far = Math.max(...boxes.map((b) => Math.hypot(Math.max(Math.abs(b.x),
        Math.abs(b.x + b.width)), Math.max(Math.abs(b.y), Math.abs(b.y + b.height)))));
      const side = Math.max(...boxes.map((b) => Math.max(Math.abs(b.x), Math.abs(b.x + b.width),
        Math.abs(b.y), Math.abs(b.y + b.height))));
      return { scale: k, skirt: num(KNOB_FACE.skirt * k), tickOut: num(tickOut), numerals: ms,
        numeralR: num(r), radius: num(Math.max(base, far + RING.margin)),
        extent: num(Math.max(base, side + RING.margin)),
        leaderIn: num(Math.max(base, far) + RING.leaderGap) };
    }
  }
}
const dialMech = (d) => [-d.extent, -d.extent, d.extent, d.extent];

/** The legends round the dial at radius R: anchored away from it, each box holding its text. */
function ringAt(opts, R, H, F) {
  return opts.map((o, i) => {
    const [x, y] = polar(R, dialAngle(i, opts.length));
    const s = Math.sin(rad(dialAngle(i, opts.length)));
    const anchor = s > 0.35 ? 'start' : (s < -0.35 ? 'end' : 'middle');
    const legend = { x, y, anchor, size: F, width: legendWidth(o[2], F) };
    const t = textBox(legend);
    const hw = up(Math.max(H, t.width + 2 * PAD));
    const hh = up(Math.max(H, F + 2 * PAD));
    return option(i, o, legend, rect(t.x + t.width / 2 - hw / 2, y - hh / 2, hw, hh));
  });
}

/**
 * The least radius from DIAL.radius at which the ring's hit boxes lie apart and clear of the
 * dial. The search stops at DIAL.radiusMax scaled by the hit box (H / HIT_PX, at least 1): below
 * zoom 1 the boxes and legends grow by 1 / zoom while the dial does not, so a ring that fits at
 * zoom 1 fits at any lower zoom within that limit. Only legends too long for it are refused.
 */
function rotaryLayout(opts, H, F, id, zoom, dial) {
  const limit = num(RING.radiusMax * Math.max(1, H / HIT_PX));
  const marks = (dial.numerals || []).map(textBox);
  for (let R = RING.radius; R <= limit; R += RING.radiusStep) {
    if (R - F / 2 - 3 <= dial.leaderIn) continue; // a leader needs room before its legend
    const options = ringAt(opts, R, H, F);
    const apart = options.every((a, i) => options.slice(i + 1).every((b) => !overlaps(a.hit,
      b.hit)));
    if (apart && options.every((o) => reach(o.hit) > dial.radius - RING.margin
      && marks.every((m) => !overlaps(o.hit, m)))) {
      return { options, radius: R, mech: dialMech(dial) };
    }
  }
  throw new Error(`${id}: at zoom ${zoom}, the legends do not fit round a rotary selector within `
    + `radius ${limit} (${num(H)} unit hit boxes); shorten them.`);
}

function windowLayout(opts, H, F, id, zoom, dial) {
  const n = opts.length;
  const widest = Math.max(...opts.map((o) => legendWidth(o[2], F)));
  const cellW = up(Math.max(H, widest + 2 * PAD));
  const cellH = up(Math.max(H, F + 2 * PAD));
  // The grid's width limit grows with the boxes below zoom 1, so it keeps its zoom 1 columns.
  const s = Math.max(1, H / HIT_PX);
  const cols = Math.min(n, Math.max(1, Math.floor((WINDOW.gridMaxW * s) / Math.max(HIT_PX * s,
    widest + 2 * PAD) + 1e-9)));
  const top = dial.extent + WINDOW.gridGap;
  const options = opts.map((o, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const x = -(inRow * cellW) / 2 + (i % cols) * cellW;
    const y = top + row * cellH;
    const legend = { x: num(x + cellW / 2), y: num(y + cellH / 2), anchor: 'middle', size: F,
      width: legendWidth(o[2], F) };
    return option(i, o, legend, rect(x, y, cellW, cellH));
  });
  const ww = Math.max(WINDOW.minW, widest + 2 * WINDOW.pad);
  const wh = F + WINDOW.pad;
  const win = rect(-ww / 2, -(dial.extent + WINDOW.gap + wh), ww, wh);
  return { options, window: win, mech: dialMech(dial) };
}

const LAYOUTS = Object.freeze({ toggle: toggleLayout, slide: slideLayout, rotary: rotaryLayout,
  window: windowLayout });

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/**
 * Where everything of a switch for `param` lies at `zoom`, graph units: the style, the position
 * count, the width of the knob a dial matches (`knob`, graph units; CONTROL_BOX.knob.width by
 * default), the legend size (LEGEND_PX screen px), the rotary's legend radius, the slide's pitch,
 * the dial ({ scale, skirt, tickOut, radius, extent }: the circle and the square half side that
 * hold it and its numerals; null on a toggle or a slide), per option its legend ({ x, y,
 * anchor: 'start' | 'middle' | 'end', size, width, text }: text the label, or "n · label" with
 * `numberLegends` on a numbered dial) and its hit box (at least HIT_PX / zoom a side, holding the
 * legend, never overlapping another, clear of a dial and its numerals), its detent's number
 * (1..n on a dial of NUMBERED_MIN or more detents, or as `numbers` says; else null) and that
 * numeral's place ({ x, y, anchor: 'middle', size, width } or null), the window's frame (the
 * caller's text goes there),
 * the LED's circle when `led` asks for one (a toggle's alone) and the box that holds all of it.
 * Deep-frozen.
 */
export function switchLayout(param, { zoom = 1, led = false, knob = CONTROL_BOX.knob.width,
  numberLegends = false, numbers } = {}) {
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`switchLayout: zoom must be a finite number above 0, not ${zoom}.`);
  }
  if (!(typeof knob === 'number' && Number.isFinite(knob) && knob > 0)) {
    throw new RangeError('switchLayout: knob is the width of the knob beside the switch, graph '
      + `units, a finite number above 0, not ${knob}.`);
  }
  if (numbers !== undefined && typeof numbers !== 'boolean') {
    throw new TypeError('switchLayout: numbers is true, false or left out (a dial of '
      + `${NUMBERED_MIN} or more detents), not ${numbers}.`);
  }
  const style = switchStyle(param);
  const base = optionsOf(param);
  if (led && style !== 'toggle') {
    throw new Error(`${idOf(param)}: an LED goes on a toggle, not on a ${style} selector.`);
  }
  const H = up(HIT_PX / zoom);
  const F = up(Math.max(LEGEND_PX, LEGEND_PX / zoom));
  const isDial = style === 'rotary' || style === 'window';
  const dial = isDial ? dialOf(base.length, knob, F, numbers ?? base.length >= NUMBERED_MIN)
    : null;
  const numbered = Boolean(dial && dial.numerals);
  const opts = base.map(([v, label], i) => [v, label, numbered && numberLegends
    ? `${i + 1} · ${label}` : String(label)]);
  const L = LAYOUTS[style](opts, H, F, idOf(param), zoom, dial);
  if (numbered) {
    L.options.forEach((o, i) => {
      o.number = i + 1;
      o.numeral = dial.numerals[i];
    });
  }
  let ledAt = null;
  const b = [...L.mech];
  if (led) {
    const T = TOGGLE;
    // The bezel's outer edge T.ledGap past the housing; the box holds the halo (ledBox).
    ledAt = { cx: T.w / 2 + T.ledGap + LED.bezel + LED.bezelW / 2, cy: 0, r: LED.lens };
    const lb = ledBox({ at: { x: ledAt.cx, y: ledAt.cy } });
    b[1] = Math.min(b[1], lb.y);
    b[2] = Math.max(b[2], lb.x + lb.width);
    b[3] = Math.max(b[3], lb.y + lb.height);
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
    if (o.numeral) grow(textBox(o.numeral));
  }
  if (L.window) grow({ x: L.window.x - 0.5, y: L.window.y - 0.5, width: L.window.width + 1,
    height: L.window.height + 1 });
  const dialOut = dial ? { scale: dial.scale, skirt: dial.skirt, tickOut: dial.tickOut,
    radius: dial.radius, extent: dial.extent, leaderIn: dial.leaderIn } : null;
  return deepFreeze({ style, positions: opts.length, zoom, knob, legendPx: F,
    radius: L.radius ?? null, pitch: L.pitch ?? null, dial: dialOut, box: rect(b[0], b[1],
      b[2] - b[0], b[3] - b[1]), options: L.options, window: L.window ?? null, led: ledAt });
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

/** Radial strokes from r0 to r1 at each angle, as one path's 'M x y L x y' segments. */
const radialPath = (r0, r1, angles) => angles.map((deg) => {
  const [x0, y0] = polar(r0, deg);
  const [x1, y1] = polar(r1, deg);
  return `M ${x0} ${y0} L ${x1} ${y1}`;
}).join(' ');

function dialShapes(L, sel, t, st) {
  const D = DIAL;
  const K = KNOB_FACE;
  const k = L.dial.scale;
  const s = (x) => num(x * k);
  const c = t.control;
  const n = L.options.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = dialAngle(i, n);
    const [x0, y0] = polar(D.tickIn * k, a);
    const [x1, y1] = polar(D.tickOut * k, a);
    out += `<line data-detent="" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" `
      + `stroke="${esc(i === sel ? c.ring : c.track)}" `
      + `stroke-width="${s(i === sel ? D.litW : D.tickW)}"/>`;
    if (L.radius) {
      const [lx0, ly0] = polar(L.dial.leaderIn, a);
      const [lx1, ly1] = polar(L.radius - L.legendPx / 2 - 3, a);
      out += `<line data-leader="" x1="${lx0}" y1="${ly0}" x2="${lx1}" y2="${ly1}" `
        + `stroke="${esc(c.track)}" stroke-width="1"/>`;
    }
  }
  for (const o of L.options) {
    if (!o.numeral) continue;
    const m = o.numeral;
    const tx = t.text;
    out += `<text data-number="" data-index="${o.index}" x="${m.x}" y="${m.y}" `
      + `font-size="${num(m.size)}" text-anchor="middle" dominant-baseline="central" `
      + `font-weight="${o.index === sel ? 600 : 400}" `
      + `fill="${esc(st.disabled ? tx.dim : (o.index === sel ? tx.value : tx.label))}" `
      + `stroke="none">${o.number}</text>`;
  }
  const [px0, py0] = polar(D.pointerIn * k, dialAngle(sel, n));
  const [px1, py1] = polar(D.pointerOut * k, dialAngle(sel, n));
  const ridges = Array.from({ length: K.knurls }, (_, i) => (i * 360) / K.knurls);
  const [hx, hy, hrx, hry] = D.sheen.map(s);
  const w = L.window;
  return out
    + `<circle data-skirt="" cx="0" cy="0" r="${s(K.skirt)}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(st.hover ? c.pointer : c.edge)}" stroke-width="${s(K.edgeW)}"/>`
    + `<path d="${radialPath(K.knurlIn * k, K.knurlOut * k, ridges)}" data-knurl="" `
    + `fill="none" stroke="${esc(c.knurl)}" stroke-width="${s(1)}"/>`
    + `<circle data-shadow="" class="${SHADOW_CLASS}" cx="0" `
    + `cy="${s(st.dragging ? D.shadowDragDy : D.shadowDy)}" r="${s(K.cap)}" `
    + `fill="${esc(t.surface.edge)}" stroke="none"/>`
    + `<circle data-cap="" cx="0" cy="0" r="${s(K.cap)}" fill="${esc(c.cap)}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`
    + `<ellipse class="${SHEEN_CLASS}" cx="${hx}" cy="${hy}" rx="${hrx}" ry="${hry}" `
    + `fill="${esc(c.capHi)}" stroke="none"/>`
    + `<line data-pointer="" x1="${px0}" y1="${py0}" x2="${px1}" y2="${py1}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" stroke-width="${s(K.pointerW)}" `
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

/** The LED: led.js's, its state the caller's { source, lit }, at the layout's place. */
function ledShape(at, led, t) {
  return ledSvg({ source: led.source, lit: led.lit, at: { x: at.cx, y: at.cy }, tokens: t });
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
 * `legends: false` leaves the legends to the caller; `knob`, `numbers` and `numberLegends` are
 * switchLayout's (a dial at the size of the knob beside it; "n · label" legends on a numbered
 * dial), and a numbered dial's numerals are drawn at their detents, the selected one lit as its
 * legend is. A setpoint: no animation.
 */
export function switchSvg({ value, param, tokens, zoom = 1, state = {}, led = null,
  legends = true, knob = CONTROL_BOX.knob.width, numberLegends = false, numbers } = {}) {
  if (!tokens || !tokens.control || !tokens.surface || !tokens.text) {
    throw new TypeError('switchSvg needs the synth tokens (synthTokens(el)).');
  }
  const id = idOf(param);
  const L = switchLayout(param, { zoom, led: led !== null && led !== undefined, knob,
    numberLegends, numbers });
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
        + `${esc(lg.text)}</text>`;
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
