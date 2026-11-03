// The synth-theme layer's SVG text measure (plan F013): the width a legend or a label is laid
// out at, an estimate from its glyphs, shared by switch.js (its legends) and led.js (an LED's
// label, a meter's unit) so neither imports the other. Pure: no DOM, no font metrics.
//
//   legendWidth(label, size)   graph units, rounded to 0.01

const NARROW = /[ .,:;'|!()[\]/\-iIjlft]/;
const WIDE = /[MWmw@%→←·]/;

/** An estimate of a label's width at `size` (12 px, the font floor, by default): a glyph-class
 *  sum, on the generous side. */
export function legendWidth(label, size = 12) {
  let em = 0;
  for (const ch of String(label)) {
    if (NARROW.test(ch)) em += 0.34;
    else if (WIDE.test(ch)) em += 0.92;
    else if (/[A-Z0-9#&]/.test(ch)) em += 0.68;
    else em += 0.57;
  }
  return Number((em * size).toFixed(2)) + 0; // + 0: never -0
}
