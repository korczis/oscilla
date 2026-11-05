// ui-family: knob skin hardware
// ui-family: slider skin hardware
// ui-family: switch skin hardware
// The synth-theme layer's control skin (plan K058; API agreed 2026-11-02; slice S): a knob,
// fader and switch drawn as hardware, an SVG <g> from tokens, on the control family's one knob
// model (src/js/ui/controls/knob-model.js) and one slider model (slider-model.js), which it
// re-exports, so every importer of this module keeps its names: the same functions, not copies.
// No value logic lives here (where a value starts is the model's originOf). A setpoint
// (project.no-fake-science): nothing tweens. No listener, no document. Colours are tokens
// (lock v3), intensity only the opacity-hw-* classes (v4).
//
//   clampValue, toNorm, fromNorm, quantize, defaultValue, stepOption   value mapping (model)
//   dragValue, pixelsPerRangeFor, wheelValue, knobKey                  gestures (model)
//   parseValue, formatValue, ariaAttrs                                 typed entry, text, ARIA
//   controlSvg, controlBox, CONTROL_BOX, FADER_CAP, KNOB, knobFace     the drawing, an SVG <g>
//   KNOB_SIZES                                                         a knob's size: lg, md, sm

import {
  choicesOf, clampValue, HIT_PX, idOf, optionIndex, orientationOf, originOf, SWEEP_DEG, toNorm,
  zoomOf,
} from '../controls/knob-model.js';
import { FADER_CAP, FADER_TRAVEL, leverOf, LEVER_SLOT, switchPositions, travelOf }
  from '../controls/slider-model.js';

export {
  ariaAttrs, clampValue, defaultValue, DRAG_PX_PER_RANGE, dragValue, FINE_DIV, formatValue,
  fromNorm, HIT_PX, knobKey, LOG_STEPS, parseValue, quantize, stepOption, SWEEP_DEG, toNorm,
  WHEEL_LINE_PX, WHEEL_NOTCH_PX, WHEEL_STEP, wheelValue,
} from '../controls/knob-model.js';
export { FADER_CAP, FADER_TRAVEL, pixelsPerRangeFor } from '../controls/slider-model.js';

const num = (x) => Number(x.toFixed(2));
/** Up to the next 0.02, so a hit never rounds under HIT_PX screen px (as led.js's). */
const up = (x) => num(Math.ceil(x * 50 - 1e-9) / 50);
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

// Graph units, in the 44 box. The unlit arc is half the value arc's width (no token pair holds
// 3:1 between them). Slice A: cast shadow (control.shade); skirt of 30 teeth 1.2 deep (1.75 px
// at 64 px) in the cap's colour, its silhouette edge control.edge (3:1 on the plates) under a
// rim lit from above (text.label at the top to control.edge at the foot, both 3:1 on the
// plates: A7); a side wall (lit top) at hw-sheen; no sheen, since no token shows on the cap in
// both themes (rule b; A3: D-PAL); butt pointer on cap and skirt; hover (C5, one language for
// knob, dial, lever and slide: A1) brightens the part's own edge, the toothed outline in
// control.pointer. Depth shows on plateHi; on plateLo, the cap's own token, it waits on D-PAL's
// --osc-knob-cap (A2). C1 (S7, co-signed by p2 and dev-53): disabled draws no value arc, no
// applied mark, the track only; cap and skirt plateLo (no side wall, no rim), the pointer
// control.disabled, the edge the quiet control.knurl. The absent value mark is a shape cue, not
// colour alone; plateLo is control.cap's token until D-PAL, so the cue today is the missing value
// arc, the dim pointer and the quiet edge (A4).
export const KNOB = Object.freeze({ arc: 18.5, arcW: 2.5, trackW: 1.25, skirt: 16, toothIn: 14.8,
  teeth: 30, edgeW: 1, cap: 12, pointerIn: 5, pointerOut: 12, pointerW: 2,
  skirtPtrIn: 12.5, skirtPtrW: 1.5, tickIn: 20.75, tickOut: 22, ticks: 11, tickZoom: 1.25,
  detentOut: 21.75,
  detentW: 1.5, applied: 13.5, appliedW: 1.5, appliedMinDeg: 5, focus: 21, focusW: 2,
  shadowGrow: 0.5, shadowDx: 0.75, shadowDy: 1.5, shadowDragDy: 2.5 });

/**
 * A knob's sizes (G022): the same part scaled about its centre, outer diameters 80, 64 and 48 px
 * (`px`) where md is the panel's 64 px knob (synth/view/knob.js draws the 44 box at zoom 64/44),
 * so md is today's knob and the default. `scale` is the size against md's 44 box; `ticks` the
 * scale's marks, drawn once the knob is KNOB.tickZoom × its md size on screen (zoom × scale);
 * `labelPx` and `labelClass` its label's type, never under 12 px (label.js's floor). The drag is
 * the knob model's at every size; the hit stays at least HIT_PX screen px at every zoom.
 * `labelPx` and `labelClass` are data for the host that mounts a sized knob: controlSvg draws
 * no label, and no module renders one at its tier yet (md's is label.js's LABEL, which every
 * panel knob prints today).
 */
export const KNOB_SIZES = Object.freeze({
  lg: Object.freeze({ scale: 1.25, px: 80, ticks: 21, labelPx: 14, labelClass: 'text-sm' }),
  md: Object.freeze({ scale: 1, px: 64, ticks: KNOB.ticks, labelPx: 12, labelClass: 'text-xs' }),
  sm: Object.freeze({ scale: 0.75, px: 48, ticks: 5, labelPx: 12, labelClass: 'text-xs' }),
});

/** The size of a `kind`, checked: md unless given; lg and sm are a knob's alone. */
function sizeOf(kind, size) {
  if (size === undefined || size === 'md') return 'md';
  if (typeof size !== 'string' || !Object.hasOwn(KNOB_SIZES, size)) {
    throw new RangeError(`size: 'lg', 'md' or 'sm', not '${String(size)}'.`);
  }
  if (kind !== 'knob') throw new Error(`size: a ${kind} has none.`);
  return size;
}

const FADER = { capW: FADER_CAP.w, capH: FADER_CAP.h, trackW: 4, grip: 3 };
const SWITCH = { w: 14, h: LEVER_SLOT.h, inset: LEVER_SLOT.inset, leverW: 10 };
/** The intensity classes: tailwind.config.cjs's hw-sheen and hw-shadow keys. */
const SHEEN_CLASS = 'opacity-hw-sheen';
const SHADOW_CLASS = 'opacity-hw-shadow';

const faderBox = (tr) => Object.freeze({ x: -22, y: -(tr / 2 + 10), width: 44, height: tr + 20 });
const across = (b) => Object.freeze({ x: b.y, y: b.x, width: b.height, height: b.width });
/** Each kind's extent, graph units, centred on the origin: all controlSvg draws lies inside it
 *  (an SVG host's viewBox), and the hit rect is never smaller. */
export const CONTROL_BOX = Object.freeze({
  knob: Object.freeze({ x: -22, y: -22, width: 44, height: 44 }),
  fader: faderBox(FADER_TRAVEL),
  switch: Object.freeze({ x: -17, y: -18, width: 34, height: 36 }),
});
const FADER_ACROSS = across(CONTROL_BOX.fader);
/** A knob's extent at each size: md is CONTROL_BOX.knob itself. */
const KNOB_BOX = Object.freeze(Object.fromEntries(Object.entries(KNOB_SIZES).map(([k, s]) => [k,
  s.scale === 1 ? CONTROL_BOX.knob : Object.freeze({ x: -22 * s.scale, y: -22 * s.scale,
    width: 44 * s.scale, height: 44 * s.scale })])));

/** A kind's extent in an orientation: CONTROL_BOX, a horizontal fader's turned, a fader of
 *  another `travel` as long as it needs, a knob of another `size` (KNOB_SIZES) scaled. */
export function controlBox(kind, orientation = 'vertical', { travel, size } = {}) {
  if (!Object.hasOwn(CONTROL_BOX, kind)) throw new Error(`controlBox: no kind '${kind}'.`);
  const v = orientationOf(orientation, kind) === 'vertical';
  const tr = travelOf(kind, travel);
  const sz = sizeOf(kind, size);
  if (kind === 'knob') return KNOB_BOX[sz];
  const b = tr === FADER_TRAVEL ? CONTROL_BOX[kind] : faderBox(tr);
  if (v) return b;
  return b === CONTROL_BOX.fader ? FADER_ACROSS : across(b);
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

/** The skirt's toothed outline: KNOB.teeth teeth, vertices alternating r skirt and toothIn. */
const TEETH = `M ${Array.from({ length: KNOB.teeth * 2 }, (_, i) => polar(i % 2 ? KNOB.toothIn
  : KNOB.skirt, (i * 180) / KNOB.teeth).join(' ')).join(' L ')} Z`;
const line = (flag, r0, r1, deg, paint, w) => {
  const [x0, y0] = polar(r0, deg);
  const [x1, y1] = polar(r1, deg);
  return `<line ${flag}="" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${esc(paint)}" `
    + `stroke-width="${w}" stroke-linecap="butt"/>`;
};
const stops = (a, b) => `<stop offset="0" stop-color="${esc(a)}"/>`
  + `<stop offset="1" stop-color="${esc(b)}"/>`;

/** C5's one hover language (A1): an overlay of a part's edge, `shape` the edge element's own
 *  geometry and width, in control.pointer; always emitted, so a host can reveal it with
 *  group-hover, shown on hover and never while disabled. knob, dial, lever and slide draw it. */
export function hoverEdge(shape, t, st = {}) {
  return `<${shape} data-hover="" fill="none" stroke="${esc(t.control.pointer)}"`
    + `${st.hover && !st.disabled ? '' : ' visibility="hidden"'}/>`;
}

/** The knob's face, pointer at `deg`: shadow, `under`, skirt, side wall, lit rim, `mid`, cap,
 *  hover, pointer (st: controlSvg's; ids knob-`uid`). switch.js's dial draws it too. */
export function knobFace(deg, t, st = {}, uid = 'knob', under = '', mid = '') {
  const c = t.control;
  const k = KNOB;
  const dim = st.disabled;
  const body = esc(dim ? t.surface.plateLo : c.cap);
  const id = `knob-${String(uid).replace(/[^\w.:-]/g, '_')}`;
  const ptr = dim ? c.disabled : c.pointer;
  return `<circle data-cast-shadow="" class="${SHADOW_CLASS}" cx="${k.shadowDx}" `
    + `cy="${st.dragging ? k.shadowDragDy : k.shadowDy}" r="${k.skirt + k.shadowGrow}" `
    + `fill="${esc(c.shade)}" stroke="none"/>${under}`
    + `<path d="${TEETH}" data-skirt="" fill="${body}" `
    + `stroke="${esc(dim ? c.knurl : c.edge)}" stroke-width="${k.edgeW}"/>`
    + (dim ? '' : `<defs><linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1">`
      + `${stops(c.cap, t.surface.edge)}</linearGradient><linearGradient id="${id}-rim" `
      + `x1="0" y1="0" x2="0" y2="1">${stops(t.text.label, c.edge)}</linearGradient></defs>`
      + `<path d="${TEETH}" data-side="" class="${SHEEN_CLASS}" fill="url(#${id}-side)" `
      + 'stroke="none"/>'
      + `<path d="${TEETH}" data-rim="" fill="none" stroke="url(#${id}-rim)" `
      + `stroke-width="${k.edgeW}"/>`)
    + mid
    + `<circle data-cap="" cx="0" cy="0" r="${k.cap}" fill="${body}" `
    + `stroke="${esc(t.surface.edge)}" stroke-width="1"/>`
    // K6-core: always emitted, shown on hover (or a host's group-hover), never disabled.
    + hoverEdge(`path d="${TEETH}" stroke-width="${k.edgeW}"`, t, st)
    + line('data-pointer', k.pointerIn, k.pointerOut, deg, ptr, k.pointerW)
    + line('data-pointer-skirt', k.skirtPtrIn, k.skirt, deg, ptr, k.skirtPtrW);
}

function knobShapes(value, applied, p, t, st, zoom, uid, size = 'md') {
  const c = t.control;
  const dim = st.disabled;
  const half = SWEEP_DEG / 2;
  const angle = (v) => -half + SWEEP_DEG * toNorm(v, p);
  const a = angle(value);
  // A range across zero starts its arcs at zero (12 o'clock when the range is symmetric), with
  // a detent tick there; any other range starts at its minimum (the model's originOf).
  const zero = toNorm(originOf(p), p);
  const bipolar = zero > 0;
  const origin = -half + SWEEP_DEG * zero;
  const { scale, ticks } = KNOB_SIZES[size];
  let out = '';
  // The scale shows once the knob is tickZoom × md's size on screen: its size and the zoom.
  if (zoom * scale >= KNOB.tickZoom) {
    const at = Array.from({ length: ticks }, (_, i) => -half + (i * SWEEP_DEG) / (ticks - 1));
    out += `<path d="${radialPath(KNOB.tickIn, KNOB.tickOut, at)}" data-ticks="" fill="none" `
      + `stroke="${esc(c.track)}" stroke-width="1"/>`;
  }
  if (bipolar) {
    const [dx0, dy0] = polar(KNOB.tickIn, origin);
    const [dx1, dy1] = polar(KNOB.detentOut, origin);
    out += `<line data-detent="" x1="${dx0}" y1="${dy0}" x2="${dx1}" y2="${dy1}" `
      + `stroke="${esc(c.track)}" stroke-width="${KNOB.detentW}"/>`;
  }
  // The unlit arc is control.track (3:1) in every state; the value arc is told by width (S7).
  out += `<path d="${arcPath(KNOB.arc, -half, half)}" data-track="" fill="none" `
    + `stroke="${esc(c.track)}" stroke-width="${KNOB.trackW}" stroke-linecap="round"/>`;
  if (!dim && Math.abs(a - origin) > 0.01) {
    out += `<path d="${arcPath(KNOB.arc, origin, a)}" data-ring="" fill="none" `
      + `stroke="${esc(c.ring)}" stroke-width="${KNOB.arcW}" stroke-linecap="round"/>`;
  }
  let mid = '';
  if (!dim && applied !== null) {
    // From the same origin; at the origin itself a short arc, so the split is still seen.
    const b = angle(applied);
    const [s0, s1] = Math.abs(b - origin) < KNOB.appliedMinDeg
      ? [b - KNOB.appliedMinDeg / 2, b + KNOB.appliedMinDeg / 2] : [origin, b];
    mid = `<path d="${arcPath(KNOB.applied, s0, s1)}" data-applied="" fill="none" `
      + `stroke="${esc(c.applied)}" stroke-width="${KNOB.appliedW}" stroke-linecap="round"/>`;
  }
  return knobFace(a, t, st, uid, out, mid)
    + (st.focus ? `<circle data-focus="" cx="0" cy="0" r="${KNOB.focus}" fill="none" `
      + `stroke="${esc(c.focus)}" stroke-width="${KNOB.focusW}"/>` : '');
}

// The fader (slider skin) and the lever switch (switch skin) drawn as hardware, on the slider
// model's travel and the switch model's positions.

function faderShapes(value, applied, p, t, st, zoom, tr) {
  const c = t.control;
  const half = tr / 2;
  const yOf = (v) => num(half - tr * toNorm(v, p));
  const y = yOf(value);
  const top = -half - 2;
  const len = tr + 4;
  const tw = FADER.trackW;
  const ax = FADER.capW / 2 + 3;
  // The value fill runs from the bottom, or from zero on a range across zero (as the knob's arc).
  const zero = originOf(p);
  const from = toNorm(zero, p) > 0 ? yOf(zero) : half + 2;
  const [f0, f1] = y < from ? [y, from] : [from, y];
  const [cw, ch, g] = [FADER.capW, FADER.capH, FADER.grip];
  const grip = (dy, role, paint, w) => `<line data-grip="${role}" x1="${-cw / 2 + 4}" `
    + `y1="${num(y + dy)}" x2="${cw / 2 - 4}" y2="${num(y + dy)}" stroke="${esc(paint)}" `
    + `stroke-width="${w}"/>`;
  const reach = half + ch / 2 + 2;
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
 * One control as an SVG '<g>' string centred in controlBox(kind, orientation), drawn only from
 * `tokens` (synthTokens): knob = scale ticks once tickZoom × md's size on screen, unlit arc
 * (control.track), value arc (control.ring; from zero with a detent tick across zero), knobFace,
 * focus ring; `uid` names its gradients (else the parameter's id); `size` (KNOB_SIZES: lg, md, sm;
 * md unless given, and any kind's; lg and sm a knob's alone) scales it about its centre, its box
 * with it; fader = slot in control.track, value fill (from zero across zero), a FADER_CAP cap edged
 * in control.edge (control.pointer dragged), three grip lines, the centre one on the value;
 * 'horizontal' turns it (rotate(90): more to the right), `travel` (default FADER_TRAVEL) its
 * length; switch = a lever position per option of an enum of up to four or a boolean, detents past
 * two. `applied`, elsewhere than `value`, marks the engine's value (a knob's arc at r 13.5 in
 * control.applied, else a control.pointer line). `state` is { focus, dragging, disabled, hover }.
 * An invisible hit rect of at least HIT_PX / zoom (rounded up), never under the box, takes the
 * pointer (the outer group's first child, outside every transform); the drawing takes none. Every
 * shape sets its own stroke. A setpoint: no animation.
 */
export function controlSvg({ kind, value, applied, param, tokens, zoom = 1, state = {},
  orientation = 'vertical', travel, uid, size } = {}) {
  if (!tokens || !tokens.control || !tokens.surface) {
    throw new TypeError('controlSvg needs the synth tokens (synthTokens(el)).');
  }
  zoomOf(zoom, 'controlSvg');
  if (kind === 'knob' && !tokens.text) {
    throw new TypeError('controlSvg: a knob needs the synth tokens\' text (its lit rim).');
  }
  const shapes = Object.hasOwn(SHAPES, kind) ? SHAPES[kind] : null;
  if (!shapes) throw new Error(`controlSvg: kind must be knob, fader or switch, not '${kind}'.`);
  if (kind === 'switch') switchPositions(param);
  const box = controlBox(kind, orientation, { travel, size });
  const sz = sizeOf(kind, size);
  const turn = orientationOf(orientation, kind) === 'horizontal' ? ' transform="rotate(90)"' : '';
  const scaled = sz === 'md' ? '' : ` transform="scale(${KNOB_SIZES[sz].scale})"`;
  const w = up(Math.max(HIT_PX / zoom, box.width));
  const h = up(Math.max(HIT_PX / zoom, box.height));
  const st = state || {};
  const v = clampValue(value, param);
  return `<g data-control="${kind}"${sz === 'md' ? '' : ` data-size="${sz}"`}>`
    + `<rect data-hit="" x="${num(-w / 2)}" y="${num(-h / 2)}" width="${w}" `
    + `height="${h}" fill="none" stroke="none" pointer-events="all"/>`
    + `<g pointer-events="none"${turn}${scaled}>${shapes(v, appliedAt(applied, v, param), param,
      tokens, st, zoom, kind === 'knob' ? uid ?? idOf(param) : travelOf(kind, travel), sz)}</g>`
    + '</g>';
}
