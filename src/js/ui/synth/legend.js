// The synth-theme layer's SVG text measure (plan F013): the width a legend or a label is laid
// out at, an estimate from its glyphs, shared by switch.js (its legends) and led.js (an LED's
// label, a meter's unit) so neither imports the other. Pure: no DOM, no font metrics read; the
// widths are a table measured once (LEG-1).
//
//   legendWidth(label, size)   graph units, rounded to 0.01
//   LEGEND_PX                  a legend's or a label's size in screen px (the 12 px font floor)
//   LEGEND_GLYPHS              the characters the table measures
//   LEGEND_MARGIN              the estimate's margin over the table
//
// LEG-1: a glyph-class sum (0.34, 0.57, 0.68 and 0.92 em) laid "Minor pentatonic" out 99.84
// wide where DejaVu Sans Bold, the ubuntu-26.04 runner's system-ui, draws it 115.79, so the XY
// Mode dial's legend left its plate by 1.4 px in all three engines there. Each character's width
// is now the widest measured of it (advance or ink, weight 400 or 600) in the panel's legend
// font at 12 px, in chromium, firefox and webkit (Playwright 1.63) on each font set below; a
// legend's estimate is their sum and LEGEND_MARGIN, twice the worst overrun of that sum
// (0.077), so a selected (600) legend fits as a plain one. Every legend the registry can draw,
// measured (tests/unit/fixtures/legend-widths.json, held by tests/unit/ui-synth-legend.test.mjs),
// worst width over the estimate:
//
//   font set (system-ui)                          old sum      this table   with margin
//   macOS 26.5.1, local (SF Pro)                  1.208 Off    1.077 C      0.929
//   Ubuntu 24.04 container (WenQuanYi Zen Hei)    1.011 Off    0.958 4      0.826
//   Ubuntu 26.04 container (WenQuanYi Zen Hei)    1.011 Off    0.958 4      0.826
//   Ubuntu 26.04 + fonts-dejavu-core (DejaVu)     1.251 On     1.075 A      0.927
//   Ubuntu 26.04 + fonts-noto-core (Noto Sans)    1.199 Off    0.968 A      0.834
//
// (each the worst of the three engines, at weight 600; containers mcr.microsoft.com/playwright
// v1.63.0-noble and -resolute. The DejaVu set reproduces the runner's s-choices numbers.)

const LEGEND_TABLE = Object.freeze({
  glyphs: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
    + 'abcdefghijklmnopqrstuvwxyz{|}~°µ·×–—…←→',
  // Thousandths of an em, in the order of `glyphs`.
  em: [349, 457, 521, 838, 696, 1002, 873, 321, 458, 458, 621, 838, 380, 438, 380, 542, 696,
    696, 696, 696, 696, 696, 696, 696, 696, 696, 400, 400, 838, 838, 838, 581, 1000, 775, 763,
    734, 831, 684, 684, 821, 837, 390, 538, 809, 638, 996, 837, 851, 733, 851, 771, 721, 684,
    813, 775, 1104, 771, 759, 726, 458, 609, 458, 838, 577, 500, 675, 716, 593, 716, 679, 450,
    716, 712, 343, 377, 692, 343, 1042, 712, 688, 716, 716, 494, 596, 479, 712, 652, 924, 646,
    652, 583, 712, 551, 712, 838, 500, 736, 380, 838, 609, 1034, 1021, 1021, 1021],
});

/** The characters the table measures; any other is laid out wider than the widest of them. */
export const LEGEND_GLYPHS = LEGEND_TABLE.glyphs;
const EM = new Map([...LEGEND_GLYPHS].map((ch, i) => [ch, LEGEND_TABLE.em[i] / 1000]));
const UNMEASURED_EM = 1.2;

/** A legend's and a label's size in screen px at any zoom (the 12 px font floor); switch.js's
 *  LEGEND_PX and led.js's LABEL_PX are this one. */
export const LEGEND_PX = 12;

/** The estimate's margin over the measured table: twice its worst overrun (LEG-1). */
export const LEGEND_MARGIN = 0.16;

/** A label's width at `size` (LEGEND_PX, the font floor, by default): the sum of its characters'
 *  measured widths and LEGEND_MARGIN, at weight 400 or 600 alike. */
export function legendWidth(label, size = LEGEND_PX) {
  let em = 0;
  for (const ch of String(label)) em += EM.get(ch) ?? UNMEASURED_EM;
  return Number((em * size * (1 + LEGEND_MARGIN)).toFixed(2)) + 0; // + 0: never -0
}
