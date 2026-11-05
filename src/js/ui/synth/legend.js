// The synth-theme layer's SVG text measure (plan F013): the width a legend or a label is laid
// out at, an estimate from its glyphs, shared by switch.js (its legends) and led.js (an LED's
// label, a meter's unit) so neither imports the other. Pure: no DOM, no font metrics.
//
//   legendWidth(label, size)   graph units, rounded to 0.01
//   LEGEND_PX                  a legend's or a label's size in screen px (the 12 px font floor)

const NARROW = /[ .,:;'|!()[\]/\-iIjlft]/;
const WIDE = /[MWmw@%→←·]/;

/** A legend's and a label's size in screen px at any zoom (the 12 px font floor); switch.js's
 *  LEGEND_PX and led.js's LABEL_PX are this one. */
export const LEGEND_PX = 12;

/** An estimate of a label's width at `size` (LEGEND_PX, the font floor, by default): a
 *  glyph-class sum, on the generous side. */
export function legendWidth(label, size = LEGEND_PX) {
  let em = 0;
  for (const ch of String(label)) {
    if (NARROW.test(ch)) em += 0.34;
    else if (WIDE.test(ch)) em += 0.92;
    else if (/[A-Z0-9#&]/.test(ch)) em += 0.68;
    else em += 0.57;
  }
  return Number((em * size).toFixed(2)) + 0; // + 0: never -0
}
