// ui-family: switch skin hardware
// The synth-theme layer's switches drawn as hardware (plan F013 entry 5, slice S5; K058): pure
// functions, no listener, no document. An enum or a boolean is drawn by its position count:
//   2      toggle   a bat handle (slice C, SW-02): a hex nut r8, its lower facets shaded, on a
//                   darker washer r9.5, a bushing r3.5 the lever's root enters, a lever
//                   tapering from 4 to 7 over 18 with a ball r3.5, pointing at the selected
//                   legend (the second option up, as controlSvg's switch has it), its shadow
//                   and highlight; an optional LED beside it
//   3-4    slide    a slot 4 wide hidden under a 14 x 18 cap at either stop, two ridges and an
//                   index line running past the cap to its detent, a detent per position from
//                   the slot towards its legend, legends to the right (index 0 at the bottom;
//                   SW-06, SW-07)
//   5-8    rotary   a detented rotary selector: the knob's face itself (knob.js's knobFace:
//                   cast shadow, toothed skirt, side wall, lit rim, cap, hover, pointer),
//                   scaled to the knob beside it (`knob`, graph units, CONTROL_BOX.knob.width by
//                   default), pointing at the selected detent, a detent per position over
//                   270° ending inside that knob's box, the selected one lit, and the legends
//                   around it at r >= 60, the radius the least that keeps every 44 px hit box
//                   apart and clear of the dial (searched to 240, scaled by the hit box below
//                   zoom 1; only legends too long for that are refused, naming the zoom)
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
// class opacity-hw-shadow in the depth shade (control.shade), a highlight opacity-hw-sheen (the
// depth highlight where it shows on its face in both themes, else capHi), and a toggle's LED is
// led.js's (ledSvg: its bezel, its lens in control.ring lit or surface.card with a control.edge
// ring off, both 3:1, and lit its SVG halo at the hw-sheen intensity), so every LED of the layer
// looks alike; the caller's { source, lit } is passed through, and ledSvg binds data-source and
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
//   switchSvg({ value, param, tokens, zoom, state, led, legends, knob, numbers, numberLegends,
//     uid })                                 (uid names a dial's gradients; else '<param id>.dial')
//                                            the drawing, an SVG <g>
//   SWITCH_STYLES, LEGEND_PX, NUMBERED_MIN, legendWidth

import { CONTROL_BOX, clampValue, formatValue, HIT_PX, hoverEdge, KNOB, knobFace } from './knob.js';
import { legendWidth, LEGEND_PX } from './legend.js';
import { LED, ledBox, ledSvg } from './led.js';

/** legendWidth and LEGEND_PX are legend.js's, which led.js reads too. */
export { legendWidth, LEGEND_PX };

/** Each style's position counts, inclusive. */
export const SWITCH_STYLES = Object.freeze({
  toggle: Object.freeze([2, 2]),
  slide: Object.freeze([3, 4]),
  rotary: Object.freeze([5, 8]),
  window: Object.freeze([9, 12]),
});
const MAX_POSITIONS = 12;
/** Around a legend inside its hit box, graph units. */
const PAD = 6;
/** A bat-handle toggle (slice C, SW-02), graph units: a hexagonal nut (vertex radius `nut`, a
 *  `nutW` edge) on a washer, a bushing of radius `bushing` at the pivot (review of slice C, C3),
 *  a lever `length` long from the nut's centre, `root` wide there and `tip` wide at its end, a
 *  ball of radius `ball` on that end, the legends `gap` past the ball, the lever's shadow
 *  shadowDy (shadowDragDy while dragging) below it. Focused (C4), a ring `focus` past the
 *  washer, `focusW` wide, and the legend ringed round its text, `focusPad` past its font-size
 *  box up and down and `focusPadX` past its width at weight 600 across (`bold` times the
 *  weight-400 estimate: review of AC, finding 1, where 2 round that estimate cut a focused
 *  "Off"; "Off" at 600 measured 1.155 times it in Chromium and Firefox, 1.152 in WebKit, so
 *  1.16 keeps the inner edge 2 clear of the text); the LED's bezel 1 clear of that ring
 *  (`ledGap` past the washer). */
const TOGGLE = Object.freeze({ nut: 8, nutW: 1.5, washer: 9.5, washerW: 1, bushing: 3.5,
  bushingW: 1, root: 4, tip: 7, length: 18, ball: 3.5, gap: 4, focus: 3, focusW: 2, focusPad: 2,
  focusPadX: 3, bold: 1.16, ledGap: 5, shadowDy: 1, shadowDragDy: 2 });
/** A slide (slice C, SW-06, SW-07), graph units: a slot slotW wide, a capW x capH cap with two
 *  ridges gripGap from its index line (gripX either side, the index line to indexOut), a detent
 *  from 1.5 past the slot to capW / 2 + 6, the legend 4 past it; each hit box's edge is `clear`
 *  past the cap's on every side, so the focus ring (inset 1, 2 wide) clears the cap's stroke. */
const SLIDE = Object.freeze({ slotW: 4, capW: 14, capH: 18, tickIn: 3.5, tickOut: 13,
  legendX: 17, pitchPad: 8, clear: 4, gripW: 1.5, gripEdgeW: 1, gripGap: 4, gripX: 5,
  indexOut: 9, shadowDy: 1, shadowDragDy: 2 });
/** A dial in the units of the knob beside it (scaled by knob / CONTROL_BOX.knob.width): the
 *  knob's own face (knob.js's knobFace, one drawing for both: review of slice A, finding 5) and a
 *  detent per position from outside the skirt to r 21.75, its butt corners in the knob's box. */
const DIAL = Object.freeze({ sweep: 270, tickIn: 18.5, tickOut: 21.75, tickW: 1.5, litW: 2 });
/** A dial's surroundings, graph units: the ring's least radius, its search step and limit, the
 *  gap past the dial a leader starts at, and the numerals' gap past the ticks, their search step
 *  and the space kept between two of them. */
const RING = Object.freeze({ radius: 60, radiusStep: 2, radiusMax: 240, margin: 1, leaderGap: 3,
  numberGap: 2, numberStep: 0.5, numberApart: 1 });
/** A dial of this many detents or more numbers them. */
export const NUMBERED_MIN = 7;
const WINDOW = Object.freeze({ minW: 88, pad: 10, gap: 8, gridGap: 10, gridMaxW: 6 * HIT_PX });
/** A focused dial's ring: `gap` past its ticks' outer end, `w` wide (C4: outside the scale,
 *  never over it; review of slice C, finding 1: at the skirt + 3 it lay on the ticks). */
const DIAL_FOCUS = Object.freeze({ gap: 1, w: 2 });
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

/** How far a toggle's lever reaches from the nut's centre, its ball's edge included. */
const LEVER_REACH = TOGGLE.length + TOGGLE.ball;

/** A focused toggle's legend ring (its stroke's centre line) round the legend `lg`. */
function legendRing(lg) {
  const tb = textBox(lg);
  const half = (lg.width * TOGGLE.bold) / 2 + TOGGLE.focusPadX;
  return { x: tb.x + tb.width / 2 - half, y: tb.y - TOGGLE.focusPad, width: 2 * half,
    height: tb.height + 2 * TOGGLE.focusPad };
}

function toggleLayout(opts, H, F) {
  const T = TOGGLE;
  // The legend clears the ball and its lifted shadow; the hit box holds its focus ring.
  const half = Math.max(LEVER_REACH, T.length + T.ball + T.shadowDragDy);
  const reachY = Math.max(H, half + T.gap + F + T.focusPad + T.focusW / 2);
  const options = opts.map((o, i) => {
    const dir = i === 1 ? -1 : 1;
    const w = legendWidth(o[2], F);
    const legend = { x: 0, y: num(dir * (half + T.gap + F / 2)), anchor: 'middle', size: F,
      width: w };
    // The hit holds the legend's focus ring, its stroke included.
    const hw = up(Math.max(H, w + 2 * PAD, 2 * T.washer + 2 * PAD,
      legendRing(legend).width + T.focusW));
    return option(i, o, legend, rect(-hw / 2, dir < 0 ? -reachY : 0, hw, reachY));
  });
  const side = Math.max(T.washer + T.washerW / 2, T.nut + T.nutW / 2, T.ball);
  return { options, mech: [-side, -LEVER_REACH, side, T.length + T.ball + T.shadowDragDy] };
}

function slideLayout(opts, H, F) {
  const S = SLIDE;
  const n = opts.length;
  const pitch = up(Math.max(H, F + S.pitchPad, S.capH + 2 * S.clear));
  const yAt = (i) => num(((n - 1) / 2 - i) * pitch);
  // The hit box starts S.clear left of the cap, so a press on the cap is its option's.
  const x0 = -S.capW / 2 - S.clear;
  const options = opts.map((o, i) => {
    const w = legendWidth(o[2], F);
    const legend = { x: S.legendX, y: yAt(i), anchor: 'start', size: F, width: w };
    const width = up(Math.max(H, S.legendX + w + PAD - x0));
    return option(i, o, legend, rect(x0, yAt(i) - pitch / 2, width, pitch));
  });
  // The cap's edge (its stroke out) at the outermost position, and its lifted shadow below.
  const end = ((n - 1) / 2) * pitch + S.capH / 2 + 1;
  return { options, pitch, mech: [x0, -end, S.tickOut + 1, end + S.shadowDragDy] };
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
 * at which every numeral clears the ticks by RING.numberGap, the focus ring and its neighbours
 * by RING.numberApart); `radius`, the circle that holds the dial, its focus ring and its
 * numerals; `extent`, the half side of the square that does; and `leaderIn`, where a leader may
 * start (past the focus ring).
 */
function dialOf(n, knob, F, numbers) {
  const k = knob / CONTROL_BOX.knob.width;
  const tickOut = DIAL.tickOut * k;
  // A focused dial's ring lies outside the scale, so all that surrounds the dial clears it.
  const ringOut = tickOut + DIAL_FOCUS.gap + DIAL_FOCUS.w;
  const knobR = (CONTROL_BOX.knob.width / 2) * k;
  const base = Math.max(knobR, ringOut) + RING.margin;
  if (!numbers) {
    return { scale: k, skirt: num(KNOB.skirt * k), tickOut: num(tickOut), numerals: null,
      radius: num(base), extent: num(base),
      leaderIn: num(Math.max(knobR + RING.leaderGap, ringOut + RING.margin)) };
  }
  const least = Math.max(tickOut + RING.numberGap, ringOut + RING.numberApart);
  for (let r = tickOut; ; r += RING.numberStep) {
    const ms = numeralsAt(n, r, F);
    const boxes = ms.map(textBox);
    const clear = boxes.every((b) => reach(b) >= least);
    const apart = boxes.every((a, i) => boxes.slice(i + 1).every((b) => !overlaps(grown(a,
      RING.numberApart / 2), grown(b, RING.numberApart / 2))));
    if (clear && apart) {
      const far = Math.max(...boxes.map((b) => Math.hypot(Math.max(Math.abs(b.x),
        Math.abs(b.x + b.width)), Math.max(Math.abs(b.y), Math.abs(b.y + b.height)))));
      const side = Math.max(...boxes.map((b) => Math.max(Math.abs(b.x), Math.abs(b.x + b.width),
        Math.abs(b.y), Math.abs(b.y + b.height))));
      return { scale: k, skirt: num(KNOB.skirt * k), tickOut: num(tickOut), numerals: ms,
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
    // The bezel's outer edge T.ledGap past the washer; the box holds the halo (ledBox).
    ledAt = { cx: T.washer + T.ledGap + LED.bezel + LED.bezelW / 2, cy: 0, r: LED.lens };
    const lb = ledBox({ at: { x: ledAt.cx, y: ledAt.cy }, zoom });
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

const pathOf = (pts) => `M ${pts.map((p) => p.join(' ')).join(' L ')} Z`;
/** The nut's six vertices, flats top and bottom, and its two lower-right facets (with its
 *  centre), away from the light. */
const NUT_AT = Array.from({ length: 6 }, (_, i) => polar(TOGGLE.nut, 30 + 60 * i));
const NUT = pathOf(NUT_AT);
const FACET = pathOf([[0, 0], ...NUT_AT.slice(1, 4)]);

/** The lever and its ball as one outline, `dir` 1 down or -1 up, `dy` below: the shadow's shape
 *  (one path, so where lever and ball meet is not shaded twice). It starts at the ball's far
 *  point, on the plate beyond the washer. */
function leverOutline(dir, dy) {
  const T = TOGGLE;
  const at = (x, y) => [num(x), num(y * dir + dy)];
  const arc = (from, to) => Array.from({ length: 7 }, (_, i) => {
    const a = rad(from + ((to - from) * i) / 6);
    return at(T.ball * Math.sin(a), T.length + T.ball * Math.cos(a));
  });
  return pathOf([...arc(0, 90), at(T.root / 2, 0), at(-T.root / 2, 0), ...arc(-90, 0)
    .slice(0, -1)]);
}

/**
 * The bat-handle toggle (SW-02): the washer (control.knurl, darker than the nut in both themes,
 * its rim control.edge, 3:1 on the plates), the hex nut (capHi, its edge control.edge, 3:1 on
 * nut and washer, brightened on hover by hoverEdge, C5) with its lower facets in control.bezel
 * (no depth role shows on capHi in both themes, rule b), the bushing (review of slice C, C3:
 * surface.card, where the depth shade shows in both themes, rule b, as surface.edge does not in
 * dark, ΔL* -0.83; its rim control.edge) the lever's root enters and the On lever's shadow falls
 * on, the lever's shadow (control.shade at hw-shadow),
 * the tapered lever and its ball in control.edge (a grey metal that keeps its tone in both
 * themes, 3:1 on the plates and on the nut; no outline, the shadow gives its depth), and their
 * highlight (control.highlight at hw-sheen: it shows on control.edge in both themes, amendment
 * (b) and (c); ui-synth-tokens.test.mjs). Disabled (C1; review of slice C, finding 3): lever and
 * ball in control.bezel, quieter than control.edge; the nut flat in capHi, never lighter than
 * enabled; its edge and the washer's rim the knob's quiet disabled edge (control.knurl); no
 * highlight.
 */
function toggleShapes(L, sel, t, st) {
  const T = TOGGLE;
  const c = t.control;
  const dim = st.disabled;
  const dir = sel === 1 ? -1 : 1;
  const dy = st.dragging ? T.shadowDragDy : T.shadowDy;
  const metal = esc(dim ? c.bezel : c.edge);
  const rim = esc(dim ? c.knurl : c.edge);
  const ty = num(T.length * dir);
  const lever = pathOf([[-T.root / 2, 0], [T.root / 2, 0], [T.tip / 2, ty], [-T.tip / 2, ty]]);
  // The highlight: a strip down the lever's lit (left) side from inside the ball, and a glint on
  // the ball's upper left.
  const strip = pathOf([[-2.6, ty], [-1.5, num(2 * dir)], [-0.75, num(2 * dir)], [-1.4, ty]]);
  const hi = esc(c.highlight);
  return `<circle data-washer="" cx="0" cy="0" r="${T.washer}" fill="${esc(c.knurl)}" `
    + `stroke="${rim}" stroke-width="${T.washerW}"/>`
    + `<path data-nut="" d="${NUT}" fill="${esc(c.capHi)}" stroke="${rim}" `
    + `stroke-width="${T.nutW}" stroke-linejoin="round"/>`
    + (dim ? '' : `<path data-facet="" d="${FACET}" fill="${esc(c.bezel)}" stroke="none"/>`)
    + hoverEdge(`path d="${NUT}" stroke-width="${T.nutW}" stroke-linejoin="round"`, t, st)
    + `<circle data-bushing="" cx="0" cy="0" r="${T.bushing}" fill="${esc(t.surface.card)}" `
    + `stroke="${rim}" stroke-width="${T.bushingW}"/>`
    + `<path data-shadow="" class="${SHADOW_CLASS}" d="${leverOutline(dir, dy)}" `
    + `fill="${esc(c.shade)}" stroke="none"/>`
    + `<path data-lever="" d="${lever}" fill="${metal}" stroke="none"/>`
    + `<circle data-ball="" cx="0" cy="${ty}" r="${T.ball}" fill="${metal}" stroke="none"/>`
    + (dim ? '' : `<path data-sheen="" class="${SHEEN_CLASS}" d="${strip}" fill="${hi}" `
      + 'stroke="none"/>'
      + `<circle data-sheen-ball="" class="${SHEEN_CLASS}" cx="-1.2" cy="${num(ty - 1.2)}" `
      + `r="1.1" fill="${hi}" stroke="none"/>`);
}

/**
 * The slide (SW-06, SW-07): a slot ending capH / 2 - 1 past the outermost position (so the cap
 * hides its end at either stop), a detent per position from the slot towards its legend (a
 * scale the cap travels along), the cap's shadow (control.shade at hw-shadow), the capW x capH
 * cap (its edge brightened on hover by hoverEdge, C5), two ridges in control.edge (review of
 * slice C, C5: 3:1 on the cap, so it reads gripped at 2x; control.knurl was 1.18:1 in dark) and
 * the index line (control.pointer) running past the cap's edge onto its detent. Disabled (C1;
 * C6): the selected detent and the index line control.disabled, the ridges control.knurl. No
 * sheen: capHi does not show on the dark cap and darkens the light one, and the highlight does
 * not show on the cap in both themes (rule b), so it waits on D-PAL's cap roles (review of slice
 * C, findings 5 and 6).
 */
function slideShapes(L, sel, t, st) {
  const S = SLIDE;
  const c = t.control;
  const ys = L.options.map((o) => o.legend.y);
  const end = Math.max(...ys.map(Math.abs)) + S.capH / 2 - 1;
  const yc = ys[sel];
  const dy = st.dragging ? S.shadowDragDy : S.shadowDy;
  const capAt = (y) => `x="${-S.capW / 2}" y="${num(y - S.capH / 2)}" width="${S.capW}" `
    + `height="${S.capH}" rx="2"`;
  const cap = (attrs, y) => `<rect ${attrs} ${capAt(y)}`;
  const grip = (y, paint, w, x2 = S.gripX) => `<line data-grip="" x1="${-S.gripX}" `
    + `y1="${num(y)}" x2="${x2}" y2="${num(y)}" stroke="${esc(paint)}" stroke-width="${w}"/>`;
  const lit = st.disabled ? c.disabled : c.ring;
  const ridge = st.disabled ? c.knurl : c.edge;
  return `<rect data-slot="" x="${-S.slotW / 2}" y="${num(-end)}" width="${S.slotW}" `
    + `height="${num(2 * end)}" rx="${S.slotW / 2}" fill="${esc(t.surface.edge)}" `
    + `stroke="${esc(c.edge)}" stroke-width="1"/>`
    + ys.map((y, i) => `<line data-detent="" x1="${S.tickIn}" y1="${y}" x2="${S.tickOut}" `
      + `y2="${y}" stroke="${esc(i === sel ? lit : c.track)}" `
      + `stroke-width="${i === sel ? DIAL.litW : DIAL.tickW}"/>`).join('')
    + `${cap(`data-shadow="" class="${SHADOW_CLASS}"`, yc + dy)} fill="${esc(c.shade)}" `
    + 'stroke="none"/>'
    + `${cap('data-cap=""', yc)} fill="${esc(c.cap)}" stroke="${esc(c.edge)}" `
    + 'stroke-width="1.5"/>'
    + hoverEdge(`rect ${capAt(yc)} stroke-width="1.5"`, t, st)
    + grip(yc - S.gripGap, ridge, S.gripEdgeW)
    + grip(yc, st.disabled ? c.disabled : c.pointer, S.gripW, S.indexOut)
    + grip(yc + S.gripGap, ridge, S.gripEdgeW);
}

function dialShapes(L, sel, t, st, uid) {
  const D = DIAL;
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
      + `stroke="${esc(i === sel ? (st.disabled ? c.disabled : c.ring) : c.track)}" `
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
  const w = L.window;
  return `${out}<g data-face="" transform="scale(${Number(k.toFixed(4))})">`
    + `${knobFace(dialAngle(sel, n), t, st, uid)}</g>`
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

/** The LED: led.js's, its state the caller's { source, lit }, at the layout's place and zoom
 *  (its halo keeps the v4 glow bound on screen). */
function ledShape(at, led, t, zoom) {
  return ledSvg({ source: led.source, lit: led.lit, at: { x: at.cx, y: at.cy }, tokens: t,
    zoom });
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
 * `state` is { hover, focus, dragging, disabled }: hover (true, or { option: v }) brightens the
 * part's edge (C5, knob.js's hoverEdge: the dial's skirt, the lever's nut, the slide's cap) and
 * lights that option's legend; focus (true: the selected option, or { option: v }) rings, in
 * control.focus, 2 wide, that option's hit box inside it, a toggle's legend round its text
 * instead (its hit box runs through the nut), and the mechanism concentric with it outside it,
 * never over it (SW-13, C4): a dial 1 past its ticks, a toggle 3 past its washer; dragging
 * lifts the shadow; disabled dims the indicator and the selected detent (control.disabled; a
 * toggle's lever control.bezel) and the legends (text.dim) and marks the group
 * data-disabled (the caller's buttons carry aria-disabled and the reason). The selected option's
 * legend is text.value at weight 600, a window grid's as printed, with no underline (SW-08).
 * `led` ({ source, lit }, a toggle's alone) draws the LED;
 * `legends: false` leaves the legends to the caller; `knob`, `numbers` and `numberLegends` are
 * switchLayout's (a dial at the size of the knob beside it; "n · label" legends on a numbered
 * dial), and a numbered dial's numerals are drawn at their detents, the selected one lit as its
 * legend is. A setpoint: no animation.
 */
export function switchSvg({ value, param, tokens, zoom = 1, state = {}, led = null,
  legends = true, knob = CONTROL_BOX.knob.width, numberLegends = false, numbers, uid } = {}) {
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
  // SW-13 (C4): a focused dial is ringed too, concentric, outside its scale, never over it;
  // a focused toggle round its washer (review of slice C, C4), both under the mechanism.
  const ring = (flag, r, w) => `<circle ${flag}="" cx="0" cy="0" r="${num(r)}" fill="none" `
    + `stroke="${esc(tokens.control.focus)}" stroke-width="${w}"/>`;
  const toggle = L.style === 'toggle';
  let out = '';
  if (focus >= 0 && L.dial) {
    out += ring('data-dial-focus', L.dial.tickOut + DIAL_FOCUS.gap + DIAL_FOCUS.w / 2,
      DIAL_FOCUS.w);
  }
  if (focus >= 0 && toggle) {
    out += ring('data-lever-focus', TOGGLE.washer + TOGGLE.focus, TOGGLE.focusW);
  }
  out += SHAPES[L.style](L, sel, tokens, st, uid ?? `${id}.dial`);
  if (legends) {
    for (const o of L.options) {
      const lit = o.index === sel || o.index === hover;
      const lg = o.legend;
      out += `<text data-legend="" data-index="${o.index}" x="${lg.x}" y="${lg.y}" `
        + `font-size="${num(lg.size)}" text-anchor="${lg.anchor}" dominant-baseline="central" `
        + `font-weight="${o.index === sel ? 600 : 400}" `
        + `fill="${esc(st.disabled ? tx.dim : (lit ? tx.value : tx.label))}" stroke="none">`
        + `${esc(lg.text)}</text>`;
    }
  }
  if (focus >= 0) {
    const o = L.options[focus];
    const h = toggle ? legendRing(o.legend) : { x: o.hit.x + 1, y: o.hit.y + 1,
      width: o.hit.width - 2, height: o.hit.height - 2 };
    out += `<rect data-focus="" x="${num(h.x)}" y="${num(h.y)}" `
      + `width="${num(h.width)}" height="${num(h.height)}" rx="4" fill="none" `
      + `stroke="${esc(tokens.control.focus)}" stroke-width="2"/>`;
  }
  if (L.led) out += ledShape(L.led, led, tokens, zoom);
  return `<g data-control="switch" data-style="${L.style}" aria-hidden="true" `
    + `pointer-events="none"${st.disabled ? ' data-disabled=""' : ''}>${out}</g>`;
}
