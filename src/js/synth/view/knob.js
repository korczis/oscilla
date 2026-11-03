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
//   knobSvg({ uid, value, param, tokens, disabled }) -> '<svg>' of the core's knob at 64 px
//   selectorSvg({ value, param, tokens, disabled }) -> '<svg>' of a switch (an enum of up to
//     four options, or a boolean) or a rotary selector (the core's knob on a longer enum)
//   panelControlTokens(t) -> the core's token set from the panel's
//   stepOption(param, v, dir) -> the core's

import {
  CONTROL_BOX, DRAG_PX_PER_RANGE, SWEEP_DEG, controlSvg, dragValue, formatValue, fromNorm, knobKey,
  parseValue, quantize, stepOption, toNorm,
} from '../../ui/synth/knob.js';

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
const SWITCH_MAX = 4;

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
    format: (v) => formatValue(v, p),
    /** aria-valuetext: the value with its unit, as shown. */
    text: (v) => formatValue(v, p),
  };
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
