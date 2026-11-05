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
//   FADER_TRAVEL, FADER_TRAVELS, faderTravel, FADER_TICKS              a fader's travel, its scale
//   KNOB_SIZES                                                         a knob's size: lg, md, sm
//   capMaterial                                                        C6's cap material

import {
  choicesOf, clampValue, HIT_PX, idOf, optionIndex, orientationOf, originOf, SWEEP_DEG, toNorm,
  valuePositions, zoomOf,
} from '../controls/knob-model.js';
import { FADER_CAP, FADER_TRAVEL, leverOf, LEVER_SLOT, switchPositions, travelOf }
  from '../controls/slider-model.js';

export {
  ariaAttrs, clampValue, defaultValue, DRAG_PX_PER_RANGE, dragValue, FINE_DIV, formatValue,
  fromNorm, HIT_PX, knobKey, LOG_STEPS, parseValue, quantize, stepOption, SWEEP_DEG, toNorm,
  WHEEL_LINE_PX, WHEEL_NOTCH_PX, WHEEL_STEP, wheelValue,
} from '../controls/knob-model.js';
export {
  FADER_CAP, FADER_TRAVEL, FADER_TRAVELS, faderTravel, pixelsPerRangeFor,
} from '../controls/slider-model.js';

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
// at 64 px) in the cap material (C6, D-PAL: control.knobCap, one dark value in both themes), its
// silhouette edge control.edge (3:1 on the plates) under a rim lit from above (text.label at the
// top to control.edge at the foot, both 3:1 on the plates: A7); a side wall, the material's own
// opaque gradient from its lit tone (knobCapHi) at the top to the cap at the foot (b: ΔL* >= 3,
// A3); the cap's lit chamfer in knobCapHi; a sheen (K12: a radial gradient, the highlight at its
// focus up and left to the cap, at hw-sheen), now that the highlight shows on the cap in both
// themes (rule d, A3); a butt pointer on cap and skirt in the cap ink (control.capInk, 3:1 on both
// tones); hover (C5, one language for knob, dial, lever and slide: A1) brightens the part's own
// edge, the toothed outline in control.pointer. Depth shows on both plates (A2: the body's own
// tone, and D-PAL's plate foot where the shade shows). C1 (S7, co-signed by p2 and dev-53), with
// D-PAL by af + 21's decision of 2026-11-05 08:4xZ (a plateLo cap read as a missing part): a
// disabled knob is the same part at rest. It draws no value arc, no applied mark, the track only;
// cap and skirt keep the cap material (control.knobCap), flat: no lit tone (no side wall, no
// knobCapHi chamfer, the cap's edge its own body), no rim, no sheen; the pointer control.disabled
// (3:1 on knobCap in both themes), the edge the quiet control.knurl. The absent value mark is a
// shape cue, not colour alone, and the absent light (no lit tone, no sheen) a second. A token set
// without D-PAL (no cap material: the panel's adapter until dev-53 maps it) draws as before:
// cap and skirt plateLo, capMaterial. The fader's cap speaks the same language (FS-09).
export const KNOB = Object.freeze({ arc: 18.5, arcW: 2.5, trackW: 1.25, skirt: 16, toothIn: 14.8,
  teeth: 30, edgeW: 1, cap: 12, pointerIn: 5, pointerOut: 12, pointerW: 2,
  skirtPtrIn: 12.5, skirtPtrW: 1.5, tickIn: 20.75, tickOut: 22, ticks: 11, tickZoom: 1.25,
  detentOut: 21.75,
  detentW: 1.5, applied: 13.5, appliedW: 1.5, appliedMinDeg: 5, focus: 21, focusW: 2,
  shadowGrow: 0.5, shadowDx: 0.75, shadowDy: 1.5, shadowDragDy: 2.5, sheenFx: -4, sheenFy: -5 });

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

// Slice B, graph units: the slot (4 wide) and its value fill, 2 wide and inside the slot's walls
// (FS-07); a scale either side of the slot in control.track (FS-03): FADER_TICKS.marks marks over
// the travel from ±tickIn to ±tickOut, the majors (0, 5 and 10, or an axis's ends and middle)
// to ±majorOut, one mark per value on an integer or choice axis of up to perValue values, and a
// detent at zero on a range across it (detentW, as the knob's); the cap moulded (FS-04): a cast
// shadow in control.shade at hw-shadow, the size of the cap's outer edge (its stroke's outside)
// and offset by the knob's KNOB.shadowDx, shadowDy (shadowDragDy while dragged), so it shows
// right and below as far as the knob's does: one light, from above and left, on screen in either
// orientation (review B1, B2); on the cap the material's lit tone and sheen along its top and a
// lower lip of `lip` along its foot, the material's lit tone too (the flange catching the light;
// before D-PAL surface.edge, the plan's). The focus ring (stroke 2) at ±focusX, so its inner edge
// at ±20 clears the long marks' ±19.5 and its outer edge stays in the 44 box: outside the scale,
// never over it (C4, review B3; the plan's marks reached ±21, under the ring).
export const FADER_TICKS = Object.freeze({ marks: 11, tickIn: 15.5, tickOut: 18, majorOut: 19.5,
  perValue: 25, detentW: 1.5 });
const FADER = { capW: FADER_CAP.w, capH: FADER_CAP.h, trackW: 4, fillW: 2, grip: 3, lip: 1,
  focusX: 21 };
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

/**
 * C6's cap material (D-PAL, oscilla-21; the owner's default): { body, hi, ink, dpal } from a token
 * set, the knob caps, a dial's face, the switch lever, the slide and fader caps all draw it.
 * `dpal` is false for a set without control.knobCap (the Synth panel's adapter, panelControlTokens,
 * until dev-53 maps the roles), which keeps the drawing it had before D-PAL: the cap in
 * control.cap and control.capHi, the ink in control.pointer.
 */
export function capMaterial(t) {
  const c = t.control;
  const dpal = typeof c.knobCap === 'string' && c.knobCap !== '';
  return Object.freeze({ dpal, body: dpal ? c.knobCap : c.cap, hi: dpal ? c.knobCapHi : c.capHi,
    ink: dpal ? c.capInk : c.pointer });
}

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
  const m = capMaterial(t);
  const dim = st.disabled;
  // C1 with D-PAL: a disabled cap keeps the material, flat; without D-PAL, plateLo as before.
  const body = esc(dim && !m.dpal ? t.surface.plateLo : m.body);
  const id = `knob-${String(uid).replace(/[^\w.:-]/g, '_')}`;
  const ptr = dim ? c.disabled : m.ink;
  // D-PAL: the side wall is the material's opaque lit gradient; before it, cap to edge at sheen.
  const side = m.dpal ? `<path d="${TEETH}" data-side="" fill="url(#${id}-side)" stroke="none"/>`
    : `<path d="${TEETH}" data-side="" class="${SHEEN_CLASS}" fill="url(#${id}-side)" `
      + 'stroke="none"/>';
  // K12: the sheen's focus up and left (-4, -5 on the r 12 cap), in the box's fractions.
  const sheen = m.dpal && !dim ? `<defs><radialGradient id="${id}-sheen" cx="0.5" cy="0.5" `
    + `r="0.5" fx="${num((k.sheenFx + k.cap) / (2 * k.cap))}" `
    + `fy="${num((k.sheenFy + k.cap) / (2 * k.cap))}">${stops(c.highlight, m.body)}`
    + `</radialGradient></defs><circle data-sheen="" class="${SHEEN_CLASS}" cx="0" cy="0" `
    + `r="${k.cap}" fill="url(#${id}-sheen)" stroke="none"/>` : '';
  return `<circle data-cast-shadow="" class="${SHADOW_CLASS}" cx="${k.shadowDx}" `
    + `cy="${st.dragging ? k.shadowDragDy : k.shadowDy}" r="${k.skirt + k.shadowGrow}" `
    + `fill="${esc(c.shade)}" stroke="none"/>${under}`
    + `<path d="${TEETH}" data-skirt="" fill="${body}" `
    + `stroke="${esc(dim ? c.knurl : c.edge)}" stroke-width="${k.edgeW}"/>`
    + (dim ? '' : `<defs><linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1">`
      + `${m.dpal ? stops(m.hi, m.body) : stops(m.body, t.surface.edge)}</linearGradient>`
      + `<linearGradient id="${id}-rim" `
      + `x1="0" y1="0" x2="0" y2="1">${stops(t.text.label, c.edge)}</linearGradient></defs>`
      + side
      + `<path d="${TEETH}" data-rim="" fill="none" stroke="url(#${id}-rim)" `
      + `stroke-width="${k.edgeW}"/>`)
    + mid
    + `<circle data-cap="" cx="0" cy="0" r="${k.cap}" fill="${body}" `
    + `stroke="${esc(m.dpal ? (dim ? m.body : m.hi) : t.surface.edge)}" stroke-width="1"/>`
    + sheen
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

/** The fader scale's positions along the travel (0..1): one per value of an integer axis, or per
 *  option of a choice, of up to FADER_TICKS.perValue (xy.js's XY.gridMax, its grid's rule; the
 *  model's valuePositions), else FADER_TICKS.marks equal divisions. */
const faderNorms = (p) => valuePositions(p, FADER_TICKS.perValue)
  ?? Array.from({ length: FADER_TICKS.marks }, (_, i) => i / (FADER_TICKS.marks - 1));

/** Horizontal strokes at each `y`, from ±x0 to ±x1(i) on both sides of the slot, one path. */
const marksAt = (ys, x0, x1) => ys.map((y, i) => `M ${-x1(i)} ${y} L ${-x0} ${y} `
  + `M ${x0} ${y} L ${x1(i)} ${y}`).join(' ');

function faderShapes(value, applied, p, t, st, zoom, tr, size, turned) {
  const c = t.control;
  const m = capMaterial(t);
  const F = FADER;
  const T = FADER_TICKS;
  const live = m.dpal && !st.disabled;
  const side = m.dpal && st.disabled ? c.disabled : c.edge;
  const half = tr / 2;
  const yOf = (v) => num(half - tr * toNorm(v, p));
  const y = yOf(value);
  const top = -half - 2;
  const len = tr + 4;
  const tw = F.trackW;
  const ax = F.capW / 2 + 3;
  // The value fill runs from the bottom, or from zero on a range across zero (as the knob's arc).
  const zero = originOf(p);
  const bipolar = zero !== null && toNorm(zero, p) > 0;
  const from = bipolar ? yOf(zero) : half + 2;
  const [f0, f1] = y < from ? [y, from] : [from, y];
  const [cw, ch, g] = [F.capW, F.capH, F.grip];
  const capY = num(y - ch / 2);
  const grip = (dy, role, paint, w) => `<line data-grip="${role}" x1="${-cw / 2 + 4}" `
    + `y1="${num(y + dy)}" x2="${cw / 2 - 4}" y2="${num(y + dy)}" stroke="${esc(paint)}" `
    + `stroke-width="${w}"/>`;
  const reach = half + ch / 2 + 2;
  // The cap's light is laid out on screen (review B2): a rect (sx, sy, sw, sh) from the cap's
  // centre with the screen's axes, W x H the cap as seen; a horizontal fader is drawn turned by
  // rotate(90), (x, y) to (-y, x), so its rect is mapped back into the drawing.
  const [W, H] = turned ? [ch, cw] : [cw, ch];
  const at = (sx, sy, sw, sh) => (turned
    ? `x="${num(sy)}" y="${num(y - sx - sw)}" width="${num(sh)}" height="${num(sw)}"`
    : `x="${num(sx)}" y="${num(y + sy)}" width="${num(sw)}" height="${num(sh)}"`);
  const k = KNOB;
  const norms = faderNorms(p);
  const last = norms.length - 1;
  const ticks = marksAt(norms.map((n) => num(half - tr * n)), T.tickIn,
    (i) => ((2 * i) % last === 0 ? T.majorOut : T.tickOut));
  return `<path data-ticks="" d="${ticks}" fill="none" stroke="${esc(c.track)}" `
    + 'stroke-width="1"/>'
    + (bipolar ? `<path data-detent="" d="${marksAt([yOf(zero)], T.tickIn, () => T.majorOut)}" `
      + `fill="none" stroke="${esc(c.track)}" stroke-width="${T.detentW}"/>` : '')
    + `<rect x="${-tw / 2}" y="${top}" width="${tw}" height="${len}" rx="${tw / 2}" `
    + `fill="${esc(t.surface.edge)}" stroke="${esc(c.track)}" stroke-width="1"/>`
    + (f1 - f0 > 0.01 ? `<rect x="${-F.fillW / 2}" y="${f0}" width="${F.fillW}" `
      + `height="${num(f1 - f0)}" rx="${F.fillW / 2}" `
      + `fill="${esc(st.disabled ? c.disabled : c.ring)}" stroke="none"/>` : '')
    + (applied !== null ? `<line data-applied="" x1="${-ax}" y1="${yOf(applied)}" x2="${ax}" `
      + `y2="${yOf(applied)}" stroke="${esc(c.pointer)}" stroke-width="1"/>` : '')
    // FS-04: the cap's cast shadow, its outer edge offset as the knob's; lower while held.
    + `<rect data-shadow="" class="${SHADOW_CLASS}" ${at(-W / 2 - 0.5 + k.shadowDx,
      -H / 2 - 0.5 + (st.dragging ? k.shadowDragDy : k.shadowDy), W + 1, H + 1)} rx="2.5" `
    + `fill="${esc(c.shade)}" stroke="none"/>`
    + `<rect data-cap="" x="${-cw / 2}" y="${capY}" width="${cw}" height="${ch}" `
    + `rx="2" fill="${esc(m.body)}" stroke="${esc(st.dragging ? c.pointer : c.edge)}" `
    + 'stroke-width="1"/>'
    // D-PAL: the material's lit tone along the top and a sheen strip on it, as the knob's and the
    // slide's (review of D-PAL, finding 7); a disabled cap is the material flat, as the knob's
    // (C1 with D-PAL, FS-09: af + 21, 2026-11-05 08:4xZ).
    + (live ? `<rect data-cap-hi="" ${at(-W / 2 + 1, -H / 2 + 1, W - 2, 2)} rx="1" `
      + `fill="${esc(m.hi)}" stroke="none"/>`
      + `<rect data-sheen="" class="${SHEEN_CLASS}" ${at(-W / 2 + 4, -H / 2 + 1, W - 8, 1)} `
      + `rx="0.5" fill="${esc(c.highlight)}" stroke="none"/>` : '')
    // FS-04: the lower lip along the cap's foot, inside its stroke (flat when disabled, C1).
    + (st.disabled ? '' : `<rect data-lip="" ${at(-W / 2 + 1, H / 2 - 0.5 - F.lip, W - 2,
      F.lip)} fill="${esc(m.dpal ? m.hi : t.surface.edge)}" stroke="none"/>`)
    // FS-09 (C1 with D-PAL): a disabled cap's every grip in control.disabled, as the knob's
    // pointer; before D-PAL the centre grip alone.
    + grip(-g, '', side, 1) + grip(0, 'centre', st.disabled ? c.disabled : m.ink, 1.5)
    + grip(g, '', side, 1)
    + (st.focus ? `<rect data-focus="" x="${-F.focusX}" y="${-reach}" width="${2 * F.focusX}" `
      + `height="${2 * reach}" rx="3" fill="none" stroke="${esc(c.focus)}" stroke-width="2"/>`
      : '');
}

function switchShapes(value, applied, p, t, st) {
  const c = t.control;
  const m = capMaterial(t);
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
    + `width="${SWITCH.leverW}" height="${num(lever.h)}" rx="2" fill="${esc(m.body)}" `
    // D-PAL: the lever edged as the fader's cap is (control.edge, the pointer while dragged).
    + `stroke="${esc(m.dpal ? (st.dragging ? c.pointer : c.edge)
      : (st.dragging ? c.capHi : t.surface.edge))}" stroke-width="1"/>`
    + `<line${m.dpal ? ' data-index=""' : ''} x1="-3" y1="${yc}" x2="3" y2="${yc}" `
    + `stroke="${esc(st.disabled ? c.disabled : m.ink)}" stroke-width="1.5"/>`
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
 * with it; fader = a scale either side in control.track (FADER_TICKS; a detent at zero across
 * zero), slot in control.track, a 2-wide value fill inside it (from zero across zero), a FADER_CAP
 * cap casting its shadow (control.shade at hw-shadow, lower while dragged), edged in control.edge
 * (control.pointer dragged), three grip lines, the centre one on the value, a lower lip, and with
 * the cap material its lit tone along the top and a sheen strip (flat when disabled);
 * 'horizontal' turns it (rotate(90): more to the right), `travel` (default FADER_TRAVEL; a role's
 * is faderTravel's) its length; switch = a lever position per option of an enum of up to four or a boolean, detents past
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
      tokens, st, zoom, kind === 'knob' ? uid ?? idOf(param) : travelOf(kind, travel), sz,
      turn !== '')}</g>`
    + '</g>';
}
