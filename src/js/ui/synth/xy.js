// The synth-theme layer's XY pad drawn as hardware (plan F013 entry 12, slice S10; p2's core
// file): pure functions, no document, no listener, no timer. A square recessed surface, a puck
// on it, a horizontal fader under the pad for X, a vertical one beside it for Y, and the gate
// LED in the corner between the two faders, as a hardware XY unit lays them out.
//
// Graph units: 1 is 1 CSS px at zoom 1, the layout's box from (0, 0). The surface is
// surface.card (--osc-surface-2, never bg-gray-900) in a control.edge frame (--osc-text-dim,
// 3:1 on the surface and on both plates in both themes) with a recess along its top and left in
// control.shade at the hw-shadow intensity, and a grid in text.dim at the hw-texture intensity
// (class opacity-hw-texture: a line per value of an integer axis of up to XY.gridMax values,
// else XY.gridDivs divisions), with two guides in control.track through the puck.
//
// The puck is a raised Ø28 cap (PUCK.r 14): a skirt in control.cap rimmed in text.value
// (--osc-text, 3:1 or more on the surface and the skirt in both themes) around a Ø20 face
// (PUCK.face) in control.edge (--osc-text-dim: of the control roles the only neutral but the
// pointer's --osc-text that is 1.3:1 or more on the surface in both themes, 3.91:1 in each, and
// 4.2:1 / 4.4:1 on the skirt), a crosshair notch in control.pointer, a highlight arc on the
// face's top-left in control.highlight at hw-sheen (PUCK.highlight: 195° to 255°, at 0.8 of
// the face's radius) and a drop shadow in control.shade at hw-shadow (PUCK.shadow: the cap with
// its rim, r 14.75, 2 down), so the rim casts a crescent below it. The relief is symmetric: it
// comes from the two depth roles the palette owner approved (oscilla-21's amendment (a)-(e),
// 11-04), --osc-hw-shade and --osc-hw-highlight, which darken and lighten what they lie on alike
// in both themes (each use |ΔL*| >= 3 on its face, ui-synth-tokens.test.mjs), so the cap reads
// raised in dark and light. The skirt alone still differs by theme: control.cap
// (--osc-surface-1) is darker than the surface in dark and lighter in light, so in dark the
// collar reads recessed and the rim carries the edge, and in light the skirt reads raised; the
// shadow and the highlight now say raised in both. Touched, the cap is pressed, alike in both
// themes: the face sinks by PUCK.sink graph units and by at least PUCK.sink screen px from zoom
// 0.3 up (rounded up to 0.02, never past half the face; Ø20 to Ø17 at zoom 1), so more skirt
// shows, the notch shortens and the highlight shrinks with it (both in proportion), and the
// shadow drops PUCK.shadow.pressed (1) instead of dy, as a cap pushed toward its surface casts
// less. The pressed cue (the face Ø20 to Ø17 at zoom 1) is the same in both. Disabled, the face
// is blank and carries no highlight. The rim stays text.value (cyan is the gate LED's and a
// selection's colour): the gate shows on its LED. The centre travels over the surface inset by
// XY.inset (18), so neither the cap, its rim nor its shadow crosses the frame.
//
// The axis faders are knob.js's controlSvg (kind 'fader', orientation 'horizontal' for X,
// 'vertical' for Y) at controlBox, with the puck's travel (the layout's travel), so they look,
// feel and hit as every fader of the layer and each fader's cap sits exactly under or beside
// the puck's centre.
// The gate LED is led.js's ledSvg, lit by the caller's `gate` boolean, its data-source the
// caller's `source` (the state it shows, never a constant), labelled XY.ledLabel at the 12 px
// font floor (LEGEND_PX screen px at any zoom). Every colour is a token passed in (synthTokens;
// project.visual-identity-lock) and no number sets an opacity, an alpha or a shadow (v4): the
// intensities are the classes opacity-hw-texture, opacity-hw-shadow and opacity-hw-sheen (the
// puck's highlight, and the LED's halo, led.js's).
//
// Mapping: xyPosition and xyValue work in positions 0..1 along each axis, y up (0 at the
// bottom, as hardware), clamped to the puck's travel. A position is held to 12 significant
// digits and a point to 1e-9 graph units, so float noise never survives a trip: a round trip is
// exact for grid values (positions k/40 and whole graph units, as the tests walk them) and
// otherwise lands within 1e-11 of a position and 1e-9 graph units of a point. A host maps a
// value to its position with knob.js's toNorm and back with fromNorm and quantize, the faders'
// own mapping, so the puck and both fader caps always agree (an integer axis's value sits at its
// grid line).
//
// Accessibility: the pad is role="group" with an aria-label; the drawing (surface, puck, grid)
// is aria-hidden and takes no pointer. The surface's hit rect (data-xy-hit="pad", the whole
// surface) is the keyboard's and the pointer's surface, as src/js/ui/kinds/xy-pad.js draws it:
// tabindex 0 (-1 while disabled), role="application", aria-roledescription "XY pad", the
// group's aria-label, aria-keyshortcuts the keys below, aria-disabled while disabled, and
// data-gate the gate's boolean for hosts. The gate is not aria-pressed, which ARIA 1.2 does not
// allow on role="application" (axe aria-allowed-attr): the hit's aria-describedby names the
// gate LED, led.js's labelled LED (role="img", aria-label "Gate: on" or "Gate: off") outside
// the hidden drawing, in a group (data-xy-gate) whose id is the caller's source made an id:
// 'xy-gate-' and the source, each character outside A-Z, a-z, 0-9 and '-' written _<hex>_, so
// it is stable, valid and one per source. There is no aria-live: the host owns announcements,
// so the core never speaks a gate change. The host owns the keys, from its own delegated
// listener as xy-pad.js does today (this core adds none): on the surface
// the arrows move the puck (Left/Right and Home/End along X, Up/Down and PageUp/PageDown along
// Y, Shift fine, each axis through knobKey), Enter held opens the gate and its keyup closes it,
// Escape ends the gesture. The puck is
// not a second accessible slider: the two axis faders are the sliders, each role="slider" with
// tabindex 0, an aria-label, an aria-orientation and N003's ariaAttrs (aria-valuenow the 0..1000
// position, aria-valuetext the value with its unit), so a screen reader moves X and Y one at a
// time. Every hit is at least HIT_PX (44) screen px a side at any zoom (rounded up to the next
// 0.02 graph units), none overlaps another and every one lies inside the box (the surface grows
// below zoom 1 to keep its 44 px). States: idle; touched (the face sinks; the caller
// lights the gate); focus on one part ('pad' rings the surface in control.focus, 2 wide;
// 'x' or 'y' rings that fader through controlSvg); disabled (aria-disabled; the puck's rim,
// its notch and the frame in control.disabled, the frame dashed, the face blank in control.cap,
// the faders dimmed by controlSvg; by token, never by an opacity). A setpoint: nothing moves
// here, so there is no reduced-motion check; a host that glides the puck does it in its own
// file, which checks prefers-reduced-motion (the v4 motion guard). Coordination: the kind
// src/js/ui/kinds/xy-pad.js still announces raw values; adopting these faders moves its
// aria-valuenow to the position, which its browser checks must follow (plan entry 12).
//
//   xyLayout({ size, zoom })           frozen { zoom, size, pad, travel, puck, faders: { x, y:
//                                      { orientation, travel, at, box, hit } }, led: { at, box },
//                                      hits: { pad, x, y }, box } (graph units)
//   xyPosition({ x, y, layout })       positions 0..1 -> { px, py }, graph units, clamped
//   xyValue({ px, py, layout })        graph units -> positions { x, y } 0..1, clamped
//   xySvg({ x, y, gate, source, params: { x, y }, tokens, zoom, size, state, label, format })
//                                      '<g data-xy="" role="group" …>…</g>'
//   PUCK, XY                           the geometry, graph units

import { ariaAttrs, clampValue, controlBox, controlSvg, HIT_PX, toNorm } from './knob.js';
import { ledBox, ledSvg } from './led.js';

/** The puck, graph units: the cap's radius (Ø28), its face's (Ø20), its rim, the crosshair
 *  notch's half arm and width (the arm idle: it shortens with the face), how far the face sinks
 *  when touched (graph units, and screen px at least), the shadow (the cap with its rim, dropped
 *  dy idle and pressed when touched) and the face's highlight arc (degrees, y down, its radius
 *  as a share of the face's and its width). */
export const PUCK = Object.freeze({ r: 14, face: 10, edgeW: 1.5, notch: 6, notchW: 1.5,
  sink: 1.5, shadow: Object.freeze({ dy: 2, pressed: 1, r: 14.75 }),
  highlight: Object.freeze({ from: 195, to: 255, at: 0.8, w: 1.5 }) });
/** The pad, graph units: the default and least side of the surface, the puck travel's inset
 *  (the cap, its ring and its shadow inside the frame), the margin that holds the focus ring,
 *  the gap to the faders, the frame's corner, width and disabled dash, the focus ring's offset
 *  and width, the recess's width, the grid (a line per value up to gridMax values, else gridDivs
 *  divisions), the guides' width and the gate LED's label. */
export const XY = Object.freeze({ size: 160, min: 96, inset: 18, margin: 4, gap: 6, rx: 3,
  frameW: 1.5, dash: '3 1.5', focusOut: 3, focusW: 2, recessW: 2, gridMax: 25, gridDivs: 8,
  guideW: 1, ledLabel: 'Gate' });

const AXES = Object.freeze(['x', 'y']);
const FOCUS = Object.freeze(['pad', 'x', 'y']);
const STATE_KEYS = Object.freeze(['touched', 'focus', 'disabled']);
const ORIENTATION = Object.freeze({ x: 'horizontal', y: 'vertical' });
/** The keys the host's listener answers on the surface (aria-keyshortcuts). */
const KEYS = 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End PageUp PageDown Enter Escape';

const num = (x) => Number(x.toFixed(2)) + 0; // + 0: never -0
/** Up to the next 0.02, so a grown side never rounds under the 44 px rule. */
const up = (x) => num(Math.ceil(x * 50 - 1e-9) / 50);
/** The face's radius touched at `zoom`: PUCK.sink graph units smaller, and PUCK.sink screen px
 *  at least (rounded up to 0.02), never past half the face. */
const sunkFace = (zoom) => num(PUCK.face
  - Math.min(PUCK.face / 2, up(Math.max(PUCK.sink, PUCK.sink / zoom))));
/** Float noise off: a position at 12 significant digits, a point at 1e-9 graph units: a trip
 *  is exact for grid values, else within 1e-11 of a position and 1e-9 graph units of a point. */
const clean = (x) => Number(x.toPrecision(12)) + 0;
const fine = (x) => Number(x.toFixed(9)) + 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rect = (x, y, width, height) => Object.freeze({ x, y, width, height });
/** The gate LED's id from its source: every character outside [A-Za-z0-9-] as _<hex>_, so two
 *  sources never share an id and the id is valid whatever the source holds. */
const gateId = (source) => `xy-gate-${[...source].map((ch) => (/[A-Za-z0-9-]/.test(ch) ? ch
  : `_${ch.codePointAt(0).toString(16)}_`)).join('')}`;
const labelOf = (p) => (p.label ? p.label : p.id ?? p.key ?? 'param');

function checkZoom(zoom, who) {
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`${who}: zoom must be a finite number above 0, not ${zoom}.`);
  }
}

/** A fader's hit at `zoom`, as controlSvg draws it: at least HIT_PX screen px (rounded up),
 *  never under the box. */
function faderHit(orientation, zoom, travel) {
  const b = controlBox('fader', orientation, { travel });
  return { w: up(Math.max(HIT_PX / zoom, b.width)), h: up(Math.max(HIT_PX / zoom, b.height)) };
}

// ---------------------------------------------------------------- the layout

/**
 * The pad's geometry at `zoom` for a surface of `size` graph units a side (XY.min or more): the
 * surface (grown to HIT_PX screen px below zoom 1), the puck's travel, the faders' centres and
 * boxes (X under the surface, Y beside it, each centred on it), the gate LED in the corner cell
 * between them, centred there with its label, every hit box, and the box that holds them all.
 */
export function xyLayout({ size = XY.size, zoom = 1 } = {}) {
  if (!(typeof size === 'number' && Number.isFinite(size) && size >= XY.min)) {
    throw new RangeError(`xyLayout: size is a finite number of graph units, at least ${XY.min}, `
      + `not ${String(size)}.`);
  }
  checkZoom(zoom, 'xyLayout');
  const M = XY.margin;
  const G = XY.gap;
  const S = Math.max(size, up(HIT_PX / zoom));
  const pad = rect(M, M, S, S);
  const T = S - 2 * XY.inset;
  const travel = rect(M + XY.inset, M + XY.inset, T, T);
  const hx = faderHit(ORIENTATION.x, zoom, T);
  const hy = faderHit(ORIENTATION.y, zoom, T);
  const fader = (axis, at, hit) => {
    const b = controlBox('fader', ORIENTATION[axis], { travel: T });
    return Object.freeze({ orientation: ORIENTATION[axis], travel: T, at: Object.freeze(at),
      box: rect(at.x + b.x, at.y + b.y, b.width, b.height),
      hit: rect(num(at.x + num(-hit.w / 2)), num(at.y + num(-hit.h / 2)), hit.w, hit.h) });
  };
  const fx = fader('x', { x: num(M + S / 2), y: num(M + S + G + hx.h / 2) }, hx);
  const fy = fader('y', { x: num(M + S + G + hy.w / 2), y: num(M + S / 2) }, hy);
  // The corner cell between the faders: as wide as Y's hit and as tall as X's.
  const b0 = ledBox({ at: { x: 0, y: 0 }, zoom, label: XY.ledLabel });
  const ledAt = Object.freeze({ x: num(M + S + G + hy.w / 2),
    y: num(M + S + G + hx.h / 2 - (b0.y + b0.height / 2)) });
  // The box ends where the faders' hits end. What keeps every hit inside it: up() rounds each
  // hit side to 0.02, so the half is a whole 0.01 and num() keeps the edges exact.
  return Object.freeze({
    zoom,
    size: S,
    pad,
    travel,
    puck: PUCK,
    faders: Object.freeze({ x: fx, y: fy }),
    led: Object.freeze({ at: ledAt, box: ledBox({ at: ledAt, zoom, label: XY.ledLabel }) }),
    hits: Object.freeze({ pad, x: fx.hit, y: fy.hit }),
    box: rect(0, 0, num(M + S + G + hy.w), num(M + S + G + hx.h)),
  });
}

// ---------------------------------------------------------------- the mapping

function travelOf(layout, who) {
  const t = layout && layout.travel;
  if (!t || ![t.x, t.y, t.width, t.height].every(Number.isFinite) || !(t.width > 0)) {
    throw new TypeError(`${who}: layout is xyLayout's.`);
  }
  return t;
}

/** A position held to [0, 1]; NaN reads 0, anything not a number is refused. */
function unit(n, who, name) {
  if (typeof n !== 'number') throw new TypeError(`${who}: ${name} is a number, not ${typeof n}.`);
  return Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n));
}

/** The puck's centre, graph units, for positions `x` and `y` (0..1, clamped; y up). */
export function xyPosition({ x, y, layout } = {}) {
  const t = travelOf(layout, 'xyPosition');
  const nx = unit(x, 'xyPosition', 'x');
  const ny = unit(y, 'xyPosition', 'y');
  return { px: fine(t.x + nx * t.width), py: fine(t.y + t.height - ny * t.height) };
}

/** A point's coordinate: a number (NaN reads the travel's start); anything else is refused. */
function coordinate(v, who, name) {
  if (typeof v !== 'number') throw new TypeError(`${who}: ${name} is a number, not ${typeof v}.`);
  return v;
}

/** The positions (0..1, y up) at a point in graph units, clamped to the puck's travel. */
export function xyValue({ px, py, layout } = {}) {
  const t = travelOf(layout, 'xyValue');
  const along = (d, span) => (Number.isNaN(d) ? 0 : clean(Math.min(1, Math.max(0, d / span))));
  return { x: along(coordinate(px, 'xyValue', 'px') - t.x, t.width),
    y: along(t.y + t.height - coordinate(py, 'xyValue', 'py'), t.height) };
}

// ---------------------------------------------------------------- the drawing

function checkTokens(tokens) {
  if (!tokens || !tokens.control || !tokens.surface || !tokens.text) {
    throw new TypeError('xySvg needs the synth tokens (synthTokens(el)).');
  }
}

function checkParams(params) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('xySvg: params is { x, y }, each a parameter descriptor.');
  }
  for (const axis of AXES) {
    const p = params[axis];
    if (!p || typeof p !== 'object') {
      throw new TypeError(`xySvg: params.${axis} is a parameter descriptor.`);
    }
    if (p.type === 'enum' || p.type === 'boolean') {
      throw new TypeError(`xySvg: an XY axis is a number or an integer, not ${p.type} `
        + `(${labelOf(p)}); draw a choice as a switch.`);
    }
  }
}

function stateOf(state) {
  const st = state || {};
  for (const k of Object.keys(st)) {
    if (!STATE_KEYS.includes(k)) {
      throw new TypeError(`xySvg: state is { ${STATE_KEYS.join(', ')} }, not ${k}.`);
    }
  }
  const { focus } = st;
  if (focus !== undefined && focus !== null && focus !== false && !FOCUS.includes(focus)) {
    throw new TypeError(`xySvg: state.focus is ${FOCUS.map((f) => `'${f}'`).join(', ')} or none, `
      + `not ${String(focus)}.`);
  }
  return { touched: Boolean(st.touched), focus: FOCUS.includes(focus) ? focus : null,
    disabled: Boolean(st.disabled) };
}

/** The grid's positions along an axis: each value of an integer axis of up to XY.gridMax
 *  values, else XY.gridDivs equal divisions. */
function gridNorms(p) {
  if (p.type === 'integer') {
    const step = p.step > 0 ? p.step : 1;
    const count = Math.floor((p.max - p.min) / step + 1e-9) + 1;
    if (count >= 2 && count <= XY.gridMax) {
      return Array.from({ length: count }, (_, i) => toNorm(p.min + i * step, p));
    }
  }
  return Array.from({ length: XY.gridDivs + 1 }, (_, i) => i / XY.gridDivs);
}

function padShapes(L, nx, ny, params, t, st) {
  const { pad } = L;
  const inner = XY.frameW / 2;
  const left = num(pad.x + inner);
  const right = num(pad.x + pad.width - inner);
  const top = num(pad.y + inner);
  const bottom = num(pad.y + pad.height - inner);
  const at = (x, y) => xyPosition({ x, y, layout: L });
  const grid = gridNorms(params.x).map((n) => `M ${num(at(n, 0).px)} ${top} V ${bottom}`)
    .concat(gridNorms(params.y).map((n) => `M ${left} ${num(at(0, n).py)} H ${right}`))
    .join(' ');
  const { px, py } = at(nx, ny);
  const cx = num(px);
  const cy = num(py);
  const P = PUCK;
  const r0 = XY.recessW / 2 + inner;
  const f = XY.focusOut;
  const c = t.control;
  const rim = st.disabled ? c.disabled : t.text.value;
  const sh = P.shadow;
  const face = st.touched ? sunkFace(L.zoom) : P.face;
  const arm = num((P.notch * face) / P.face);
  const H = P.highlight;
  const hr = num(face * H.at);
  const on = (deg) => `${num(cx + hr * Math.cos((deg * Math.PI) / 180))} `
    + `${num(cy + hr * Math.sin((deg * Math.PI) / 180))}`;
  return `<rect data-surface="" x="${pad.x}" y="${pad.y}" width="${pad.width}" `
    + `height="${pad.height}" rx="${XY.rx}" fill="${esc(t.surface.card)}" `
    + `stroke="${esc(st.disabled ? c.disabled : c.edge)}" stroke-width="${XY.frameW}"`
    + `${st.disabled ? ` stroke-dasharray="${XY.dash}"` : ''}/>`
    + `<path data-recess="" class="opacity-hw-shadow" d="M ${num(pad.x + r0)} `
    + `${num(pad.y + pad.height - XY.rx)} V ${num(pad.y + r0)} H `
    + `${num(pad.x + pad.width - XY.rx)}" fill="none" stroke="${esc(c.shade)}" `
    + `stroke-width="${XY.recessW}"/>`
    + `<path data-grid="" class="opacity-hw-texture" d="${grid}" fill="none" `
    + `stroke="${esc(t.text.dim)}" stroke-width="1"/>`
    + `<path data-guide="" d="M ${cx} ${top} V ${bottom} M ${left} ${cy} H ${right}" `
    + `fill="none" stroke="${esc(t.control.track)}" stroke-width="${XY.guideW}"/>`
    + `<circle data-puck-shadow="" class="opacity-hw-shadow" cx="${cx}" `
    + `cy="${num(cy + (st.touched ? sh.pressed : sh.dy))}" r="${sh.r}" fill="${esc(c.shade)}" `
    + 'stroke="none"/>'
    + `<circle data-puck-cap="" cx="${cx}" cy="${cy}" r="${P.r}" fill="${esc(c.cap)}" `
    + `stroke="${esc(rim)}" stroke-width="${P.edgeW}"/>`
    + `<circle data-puck-face="" cx="${cx}" cy="${cy}" r="${face}" `
    + `fill="${esc(st.disabled ? c.cap : c.edge)}" stroke="none"/>`
    + (st.disabled ? '' : `<path data-puck-highlight="" class="opacity-hw-sheen" `
      + `d="M ${on(H.from)} A ${hr} ${hr} 0 0 1 ${on(H.to)}" fill="none" `
      + `stroke="${esc(c.highlight)}" stroke-width="${H.w}" stroke-linecap="round"/>`)
    + `<path data-notch="" d="M ${num(cx - arm)} ${cy} L ${num(cx + arm)} ${cy} `
    + `M ${cx} ${num(cy - arm)} L ${cx} ${num(cy + arm)}" fill="none" `
    + `stroke="${esc(st.disabled ? c.disabled : c.pointer)}" `
    + `stroke-width="${P.notchW}" stroke-linecap="butt"/>`
    + (st.focus === 'pad' ? `<rect data-focus="" x="${num(pad.x - f)}" y="${num(pad.y - f)}" `
      + `width="${num(pad.width + 2 * f)}" height="${num(pad.height + 2 * f)}" `
      + `rx="${XY.rx + f}" fill="none" stroke="${esc(t.control.focus)}" `
      + `stroke-width="${XY.focusW}"/>` : '');
}

function faderGroup(axis, value, p, L, t, zoom, st, format) {
  const f = L.faders[axis];
  const aria = ariaAttrs(value, p, typeof format === 'function' ? format : undefined);
  const attrs = Object.entries(aria).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<g data-xy-axis="${axis}" transform="translate(${f.at.x} ${f.at.y})"${attrs} `
    + `tabindex="0" aria-label="${esc(`${axis.toUpperCase()}: ${labelOf(p)}`)}" `
    + `aria-orientation="${f.orientation}"${st.disabled ? ' aria-disabled="true"' : ''}>`
    + controlSvg({ kind: 'fader', value, param: p, tokens: t, zoom, travel: f.travel,
      state: { focus: st.focus === axis, disabled: st.disabled }, orientation: f.orientation })
    + '</g>';
}

/**
 * The pad as an SVG '<g>' string inside xyLayout({ size, zoom }).box: `x` and `y` are the axis
 * values (params.x and params.y, registry descriptors of a number or an integer), drawn at their
 * position (knob.js's toNorm, clamped); `gate` the gate's boolean and `source` the state it
 * names (both required: the LED binds to them); `state` { touched, focus: 'pad' | 'x' | 'y',
 * disabled }; `label` the group's name (default 'XY pad: X <label>, Y <label>'); `format`
 * { x(v, p), y(v, p) } the faders' value text (ariaAttrs' format).
 */
export function xySvg({ x, y, gate, source, params, tokens, zoom = 1, size = XY.size, state,
  label, format = {} } = {}) {
  checkTokens(tokens);
  checkParams(params);
  checkZoom(zoom, 'xySvg');
  if (typeof gate !== 'boolean') {
    throw new TypeError(`xySvg: gate is the gate's boolean, not ${typeof gate}.`);
  }
  const st = stateOf(state);
  const L = xyLayout({ size, zoom });
  const px = params.x;
  const py = params.y;
  const nx = toNorm(clampValue(x, px), px);
  const ny = toNorm(clampValue(y, py), py);
  const name = label !== undefined && label !== null && label !== '' ? label
    : `XY pad: X ${labelOf(px)}, Y ${labelOf(py)}`;
  const led = ledSvg({ at: L.led.at, lit: gate, source, tokens, zoom, label: XY.ledLabel });
  const id = gateId(source);
  const h = L.hits.pad;
  return `<g data-xy="" role="group" aria-label="${esc(name)}"`
    + `${st.disabled ? ' aria-disabled="true"' : ''}>`
    + `<g data-xy-pad=""${st.touched ? ' data-touched=""' : ''} aria-hidden="true" `
    + `pointer-events="none">${padShapes(L, nx, ny, params, tokens, st)}</g>`
    + `<rect data-hit="" data-xy-hit="pad" x="${h.x}" y="${h.y}" width="${h.width}" `
    + `height="${h.height}" fill="none" stroke="none" pointer-events="all" `
    + `tabindex="${st.disabled ? -1 : 0}" role="application" aria-roledescription="XY pad" `
    + `aria-label="${esc(name)}" aria-describedby="${id}" data-gate="${gate}" `
    + `aria-keyshortcuts="${KEYS}"`
    + `${st.disabled ? ' aria-disabled="true"' : ''}/>`
    + faderGroup('x', x, px, L, tokens, zoom, st, format.x)
    + faderGroup('y', y, py, L, tokens, zoom, st, format.y)
    + `<g data-xy-gate="" id="${id}">${led}</g>`
    + '</g>';
}
