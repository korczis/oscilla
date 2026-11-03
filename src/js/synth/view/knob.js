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
//   choiceLayout(param) -> the core's switchLayout at zoom 1 (graph units are CSS px) beside the
//     panel's 64 px knob (a dial is the knob's face at its size), or, for a dial wider than
//     CHOICE_MAX_PX, the same dial with its legends packed into a grid below it (packed: true),
//     a numbered dial's (7+ detents) legends "n · label", so no choice is wider than the
//     narrowest plate
//   choiceSvg({ value, param, tokens, disabled }) -> the inner markup of a choice's one drawing:
//     the core's switch (lever, slide, detented rotary, rotary with a window) with its legends
//     silk-screened at 12 px, a dial knob-sized and knurled by the core, its detents numbered
//     from 7, a window's selected name
//   CHOICE_MAX_PX -> the widest a choice is drawn, px
//   panelControlTokens(t) -> the core's token set from the panel's
//   stepOption(param, v, dir) -> the core's
//   SWITCH_MAX -> the most options a switch draws; a longer enum is a rotary

import {
  CONTROL_BOX, DRAG_PX_PER_RANGE, HIT_PX, SWEEP_DEG, controlSvg, dragValue, formatValue, fromNorm,
  knobKey, parseValue, quantize, stepOption, toNorm,
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

/**
 * The widest a choice is drawn, px: the narrowest box a plate gives its controls, a 2xl column
 * (a 258 px card at 1536, px-3 each side; a 320 px phone gives 248). The core lays a dial's
 * legends round it or in a grid of up to six cells, so FM's algorithm (321 px) and the XY key
 * (264 px) were wider, and a plate's overflow-hidden cut their legends and targets off on a
 * narrow phone (review of W1c, finding 1).
 */
export const CHOICE_MAX_PX = 234;
/** Round a legend inside its cell, each side, graph units: the core's PAD (6) where the grid
 *  fits with it, else less, never under 2 (the numbered FM chart fits two columns at 2). */
const CELL_PADS = Object.freeze([6, 4, 2]);
/** The core's options for a choice: a dial at the size of the panel's knob (knobSvg), its
 *  detents unnumbered, since its legends round it or in a window's grid print no number. */
const CHOICE_OPTS = Object.freeze({ knob: KNOB_PX, numbers: false });
/** ... and for a packed legend grid under a dial: the core's count rule (7+ detents are
 *  numbered) and its legends "n · label", an algorithm chart under the numerals. */
const GRID_OPTS = Object.freeze({ knob: KNOB_PX, numberLegends: true });
const r2 = (x) => Number(x.toFixed(2));
const up = (x) => Math.ceil(x * 50 - 1e-9) / 50;
const rect = (x, y, width, height) => ({ x: r2(x), y: r2(y), width: r2(width),
  height: r2(height) });
/** The gap between a dial and a legend grid under it, the core's own: a window layout's first
 *  cell below its dial's extent. */
const GRID_GAP = (() => {
  const W = switchLayout({ id: 'grid', type: 'enum',
    options: Array.from({ length: 9 }, (_, i) => [i, String(i)]) }, CHOICE_OPTS);
  return W.options[0].hit.y - W.dial.extent;
})();

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/** A dial's layout `L` with its legends packed into a grid of 44 px+ cells below it and its
 *  numerals, rows centred: a rotary loses its leaders (radius null), a window keeps its frame.
 *  Each column is as wide as its widest legend and a pad each side; the grid takes the fewest
 *  rows CHOICE_MAX_PX allows, then the widest pad (CELL_PADS). Each cell is its option's hit box
 *  and holds its legend (the layout's text: "n · label" on a numbered dial). */
function packed(L) {
  const n = L.options.length;
  const cellH = up(Math.max(HIT_PX, L.legendPx + 2 * CELL_PADS[0]));
  const widthsAt = (cols, pad) => Array.from({ length: cols }, (_, j) => up(Math.max(HIT_PX,
    ...L.options.filter((o, i) => i % cols === j).map((o) => o.legend.width + 2 * pad))));
  let grid = { cols: 1, widths: widthsAt(1, CELL_PADS[CELL_PADS.length - 1]) };
  search: for (let cols = n; cols >= 1; cols--) {
    for (const pad of CELL_PADS) {
      const widths = widthsAt(cols, pad);
      if (widths.reduce((a, b) => a + b, 0) <= CHOICE_MAX_PX + 1e-9) {
        grid = { cols, widths };
        break search;
      }
    }
  }
  const { cols, widths } = grid;
  const R = L.dial.extent;
  const top = L.window ? L.options[0].hit.y : r2(R + GRID_GAP);
  const options = L.options.map((o, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const ws = widths.slice(0, inRow);
    const j = i % cols;
    const x = -ws.reduce((a, b) => a + b, 0) / 2 + ws.slice(0, j).reduce((a, b) => a + b, 0);
    const y = top + row * cellH;
    return { ...o, legend: { ...o.legend, x: r2(x + ws[j] / 2), y: r2(y + cellH / 2),
      anchor: 'middle' }, hit: rect(x, y, ws[j], cellH) };
  });
  const w = L.window;
  const x0 = Math.min(-R, ...options.map((o) => o.hit.x), w ? w.x - 0.5 : 0);
  const x1 = Math.max(R, ...options.map((o) => o.hit.x + o.hit.width),
    w ? w.x + w.width + 0.5 : 0);
  const y0 = Math.min(-R, w ? w.y - 0.5 : 0);
  const y1 = Math.max(...options.map((o) => o.hit.y + o.hit.height));
  return deepFreeze({ ...L, radius: null, box: rect(x0, y0, x1 - x0, y1 - y0), options,
    packed: true });
}

/** A choice's layout at zoom 1: one graph unit is one CSS px, so its legends are 12 px on
 *  screen and every hit box at least 44 px a side, a dial the size of the panel's knob. The
 *  core's, unless a dial's is wider than CHOICE_MAX_PX: then its legends are packed below it
 *  (packed), and a numbered dial's packed grid reads "n · label", an algorithm chart under its
 *  numerals. */
export function choiceLayout(param) {
  const L = switchLayout(param, CHOICE_OPTS);
  if (L.box.width <= CHOICE_MAX_PX || (L.style !== 'rotary' && L.style !== 'window')) return L;
  return packed(switchLayout(param, GRID_OPTS));
}

/** The core's options a choice's drawing takes: the layout's knob, and numbered legends when
 *  its grid is packed. */
const drawOpts = (L) => (L.packed ? GRID_OPTS : CHOICE_OPTS);

/** A packed layout's legends, as the core draws a window grid's: the selected one in the
 *  plate's text at weight 600 over a 2 unit bar in the ring colour, the others in its label,
 *  every one dimmed while disabled. */
function packedLegends(L, value, ct, disabled) {
  const tx = ct.text;
  return L.options.map((o) => {
    const lg = o.legend;
    const sel = o.value === value;
    let out = `<text data-legend="" data-index="${o.index}" x="${lg.x}" y="${lg.y}" `
      + `font-size="${r2(lg.size)}" text-anchor="middle" dominant-baseline="central" `
      + `font-weight="${sel ? 600 : 400}" `
      + `fill="${disabled ? tx.dim : (sel ? tx.value : tx.label)}" stroke="none">`
      + `${escText(lg.text)}</text>`;
    if (sel) {
      const y = r2(lg.y + lg.size / 2 + 2);
      out += `<line data-selected="" x1="${r2(lg.x - lg.width / 2)}" y1="${y}" `
        + `x2="${r2(lg.x + lg.width / 2)}" y2="${y}" `
        + `stroke="${disabled ? ct.control.disabled : ct.control.ring}" stroke-width="2"/>`;
    }
    return out;
  }).join('');
}

/**
 * A choice's one drawing, the inner markup of its svg (viewBox choiceLayout(param).box at 1:1):
 * the core's switch at `value` (aria-hidden, pointer-events none) with its legends as panel
 * text, a dial the knob's face at the panel's knob size, knurled by the core (V10, review of W1c
 * finding 4), its detents numbered from 7, and a window's frame holding the selected option's
 * name. A packed layout's legends are drawn here, in the core's group, and its dial keeps no
 * leader. The options' radio buttons are the caller's, at the layout's hit boxes.
 */
export function choiceSvg({ value, param, tokens, disabled = false }) {
  const ct = panelControlTokens(tokens);
  const L = choiceLayout(param);
  const v = (param.options.find((o) => o[0] === value) || param.options[0])[0];
  let g = switchSvg({ value, param, tokens: ct, state: { disabled }, legends: !L.packed,
    ...drawOpts(L) });
  if (L.packed) {
    g = `${g.replace(/<line data-leader=""[^>]*\/>/g, '').slice(0, -'</g>'.length)}`
      + `${packedLegends(L, v, ct, disabled)}</g>`;
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
