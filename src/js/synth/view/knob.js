// The Synth knob (plan K058; design §6, D11), since F013 W1b a thin adapter onto the synth-theme
// layer's control core (src/js/ui/synth/knob.js): the value mapping, keys, drag, typed entry and
// text are the core's, and so is the drawing (controlSvg), under the names the panel (synth/
// ui.js, view/face.js) and the XY pad (ui/kinds/xy-pad.js) import. The value is a setpoint of
// the StudioModel parameter it edits (project.no-fake-science): nothing here tweens, smooths or
// invents a reading. Colours are the panel's tokens (view/tokens.js) in the layer's roles, never
// a literal (project.visual-identity-lock v3 and v4).
//
//   knobModel(param) -> { norm(v), value(t), angle(v), drag(v, dyPx, fine), key(v, key, shift),
//                         parse(text) -> { ok, value } | { ok: false, reason }, format(v), text(v) }
//     format is the readout (a short physical unit only), text the aria-valuetext (every unit)
//   readoutText(v, param) -> the readout: formatValue's text less a unit not short and physical
//   knobSvg({ uid, value, param, tokens, disabled }) -> '<svg>' of the core's knob at 64 px
//   selectorSvg({ value, param, tokens, disabled }) -> '<svg>' of a switch (an enum of up to
//     four options, or a boolean) or a rotary selector (the core's knob on a longer enum); the
//     panel draws only a toggle's lever with it since W1c
//   choiceLayout(param) -> the core's switchLayout at zoom 1 (graph units are CSS px)
//   choiceSvg({ value, param, tokens, disabled }) -> the inner markup of a choice's one drawing:
//     the core's switch (lever, slide, detented rotary, rotary with a window) with its legends
//     silk-screened at 12 px, a rotary's skirt ridged as a knob's, a window's selected name
//   panelControlTokens(t) -> the core's token set from the panel's
//   stepOption(param, v, dir) -> the core's
//   SWITCH_MAX -> the most options a switch draws; a longer enum is a rotary

import {
  CONTROL_BOX, DRAG_PX_PER_RANGE, SWEEP_DEG, controlSvg, dragValue, formatValue, fromNorm, knobKey,
  parseValue, quantize, stepOption, toNorm,
} from '../../ui/synth/knob.js';
import { switchLayout, switchSvg } from '../../ui/synth/switch.js';

export { stepOption };

/** Vertical drag over the full range, px (Shift: a tenth of that speed). */
export const DRAG_FULL_PX = DRAG_PX_PER_RANGE;
/** The knob's drawn size on the panel, px: zoom 64/44, past the core's scale-tick zoom. */
const KNOB_PX = 64;
/** A rotary selector's size, px: below the tick zoom, since its positions are its options. */
const SELECTOR_PX = 52;
/** A switch's drawn height, px: one 44 px row beside its legends. */
const SWITCH_PX = 44;
/** The core draws a switch of at most this many positions; a longer enum is a rotary. */
export const SWITCH_MAX = 4;

export function knobModel(p) {
  return {
    norm: (v) => toNorm(v, p),
    value: (t) => quantize(fromNorm(t, p), p),
    angle: (v) => -SWEEP_DEG / 2 + SWEEP_DEG * toNorm(v, p),
    drag: (v, dyPx, fine = false) => dragValue(v, dyPx, p, { fine }),
    /** The next value for a key, or null (Enter opens the panel's typed entry). */
    key(v, key, shift = false) {
      const next = knobKey({ key, shiftKey: shift }, { value: v, param: p });
      return typeof next === 'number' ? next : null;
    },
    parse: (text) => parseValue(text, p),
    /** The readout: the core's text with only a short physical unit (readoutText). */
    format: (v) => readoutText(v, p),
    /** aria-valuetext: the core's text, the value with its unit whatever the unit. */
    text: (v) => formatValue(v, p),
  };
}

/** The units a knob's readout writes, as the registry names them (formatValue spells cents ct
 *  and Hz kHz above 1000): short and physical, or a ratio sign, so the value fits on one line of
 *  its 80 px column. Any other unit ('logical gain', 'dB/oct', 'samples') is left to
 *  aria-valuetext (knobModel text): the readout stays the value the typed entry reads. */
const READOUT_UNITS = new Set(['Hz', 's', 'dB', 'cents', 'st', 'oct', '%', '×']);

/** The readout of `v`: formatValue's text, less a unit outside READOUT_UNITS. */
export function readoutText(v, p) {
  const text = formatValue(v, p);
  const suffix = ` ${p.unit}`;
  return p.unit && !READOUT_UNITS.has(p.unit) && text.endsWith(suffix)
    ? text.slice(0, -suffix.length) : text;
}

/**
 * The core's token set from the panel's (view/tokens.js panelTokens): the same --osc-* token in
 * each role (ui/synth/tokens.js), the skirt on the plate's top (the panel reads no surface-2).
 * There is no applied role: the panel has no applied value to mark.
 */
export function panelControlTokens(t) {
  return {
    surface: { plateHi: t.plateHi, plateLo: t.plateLo, card: t.plateHi, edge: t.edge },
    control: { cap: t.cap, capHi: t.capHi, ring: t.accent, track: t.dim, pointer: t.pointer,
      focus: t.focus, disabled: t.dim, edge: t.dim, knurl: t.track },
    // A choice's legends: the plate's label (4.5:1 on both ends of the plate), the selected one
    // the plate's text, a disabled one dimmed as every disabled control is.
    text: { label: t.label, value: t.text, dim: t.dim },
  };
}

const box = (b) => `${b.x} ${b.y} ${b.width} ${b.height}`;
const svgOf = (b, w, h, extra, inner) => `<svg viewBox="${box(b)}" width="${w}" height="${h}" `
  + `aria-hidden="true" focusable="false"${extra}>${inner}</svg>`;

/** The core's focus ring drawn always and shown by its slider's keyboard focus (class group),
 *  so a redraw while focused keeps it; hidden by visibility, the layer's idiom, not an opacity. */
const FOCUS_CLASS = ' class="invisible group-focus-visible:visible"';

/** One knob as the panel shows it: the core's knob, 64 px. */
export function knobSvg({ value, param, tokens, disabled = false }) {
  const g = controlSvg({ kind: 'knob', value, param, tokens: panelControlTokens(tokens),
    zoom: KNOB_PX / CONTROL_BOX.knob.width, state: { focus: true, disabled } });
  return svgOf(CONTROL_BOX.knob, KNOB_PX, KNOB_PX, '',
    g.replace('<circle data-focus=""', `<circle data-focus=""${FOCUS_CLASS}`));
}

/** A choice's drawing beside its legends: a switch, or the core's knob on a longer enum. It is
 *  decoration (the legends are the radios): the core's hit rect sets its own pointer-events="all",
 *  which would win over the svg's, so it is neutralised and a press reaches nothing. */
export function selectorSvg({ value, param, tokens, disabled = false }) {
  const rotary = param.type === 'enum' && param.options.length > SWITCH_MAX;
  const b = CONTROL_BOX[rotary ? 'knob' : 'switch'];
  const h = rotary ? SELECTOR_PX : SWITCH_PX;
  const w = Math.round((b.width * h) / b.height);
  return svgOf(b, w, h, ' class="pointer-events-none shrink-0"', controlSvg({
    kind: rotary ? 'knob' : 'switch', value, param, tokens: panelControlTokens(tokens),
    zoom: h / b.height, state: { disabled } }).replace('pointer-events="all"',
    'pointer-events="none"'));
}

/** A choice's layout at zoom 1, the core's: one graph unit is one CSS px, so its legends are
 *  12 px on screen and every hit box at least 44 px a side. */
export function choiceLayout(param) {
  return switchLayout(param);
}

/** A rotary's ridged skirt, as a knob's: 24 ridges from just inside the dial's skirt (r 17) to
 *  its edge, in the knob's ridge token (the faint --osc-border), between the skirt and the cap. */
const RIDGES = Object.freeze({ count: 24, rIn: 15.5, rOut: 17 });
const r2 = (x) => Number(x.toFixed(2));
function ridgesPath() {
  let d = '';
  for (let i = 0; i < RIDGES.count; i++) {
    const a = (i * 2 * Math.PI) / RIDGES.count;
    const [s, c] = [Math.sin(a), -Math.cos(a)];
    d += `${d ? ' ' : ''}M ${r2(RIDGES.rIn * s)} ${r2(RIDGES.rIn * c)} `
      + `L ${r2(RIDGES.rOut * s)} ${r2(RIDGES.rOut * c)}`;
  }
  return d;
}
const RIDGES_D = ridgesPath();

/**
 * A choice's one drawing, the inner markup of its svg (viewBox choiceLayout(param).box at 1:1):
 * the core's switch at `value` (aria-hidden, pointer-events none) with its legends as panel
 * text, a rotary's skirt ridged as a knob's (V10), and a window's frame holding the selected
 * option's name. The options' radio buttons are the caller's, at the layout's hit boxes.
 */
export function choiceSvg({ value, param, tokens, disabled = false }) {
  const ct = panelControlTokens(tokens);
  const L = switchLayout(param);
  let g = switchSvg({ value, param, tokens: ct, state: { disabled } });
  if (L.style === 'rotary' || L.style === 'window') {
    g = g.replace(/(<circle data-skirt=""[^>]*\/>)/, `$1<path d="${RIDGES_D}" data-ridges="" `
      + `fill="none" stroke="${tokens.track}" stroke-width="1"/>`);
  }
  const w = L.window;
  if (!w) return g;
  const sel = param.options.find((o) => o[0] === value) || param.options[0];
  return `${g}<text data-window-text="" x="${r2(w.x + w.width / 2)}" y="${r2(w.y + w.height / 2)}" `
    + 'font-size="12" text-anchor="middle" dominant-baseline="central" font-weight="600" '
    + `fill="${disabled ? tokens.dim : tokens.text}" stroke="none" aria-hidden="true">`
    + `${escText(sel[1])}</text>`;
}
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
