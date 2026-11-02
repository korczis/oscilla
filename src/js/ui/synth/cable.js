// The shared synth-theme layer's patch cable (the seam agreed on 2026-11-02): pure string
// renderers for one cable and one plug, from two points in the caller's coordinates (the bay's
// or a graph's), so a node drag recomputes only its own edges and nothing reads a layout. The
// signal type is the dash pattern, never colour alone; the colour is the caller's palette token
// (tokens.cable.palette[sourceModule % 6]); every other paint is a token too
// (project.visual-identity-lock v3), and every shape sets its own stroke. Imports nothing.
//
//   CABLE_DASH                              the pattern of each signal type
//   cableCurve(a, b, { slack })             'M … C …', a hanging cable from a to b
//   cableSvg({ id, from, to, type, colour, state, tokens, slack, zoom, sheen })
//                                           '<g data-cable="id">…</g>'
//   plugSvg({ at, colour, tokens })         a seated plug, taking no pointer

/** The dash pattern per signal type (PORT_VISUALS: solid, dashed, pulse, dash-dot). */
export const CABLE_DASH = Object.freeze({
  AUDIO: null, CONTROL: '9 6', TRIGGER: '2 6', ANALYSIS: '6 3 2 3',
});
/** A refused connection of a solid type still shows by pattern, not by colour alone. */
export const REFUSED_DASH = '4 4';
/** The least a cable hangs below its chord's midpoint, graph units, however short. */
export const CABLE_MIN_SAG = 12;
/** The default slack: the sag as a fraction of the distance between the ends. */
export const CABLE_SLACK = 0.25;
/** The hit path's width in screen px (divided by the zoom, as the control's hit area is). */
export const CABLE_HIT_PX = 24;
const WIDTH = Object.freeze({ base: 4.5, hover: 6, selected: 7.5 });

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => Number(x.toFixed(6));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A hanging cable from a to b as one cubic: the ends exactly a and b, both control points a
 * third of the way along the chord and lowered by 4/3 of the sag, so the middle of the curve
 * hangs `sag` below the chord's midpoint, down the screen whichever end is higher. The sag is
 * slack × the distance, never below CABLE_MIN_SAG; reversed ends draw the same curve, and
 * a == b is a finite droop.
 */
export function cableCurve(a, b, { slack = CABLE_SLACK } = {}) {
  if (!finite(a) || !finite(b)) throw new TypeError('cableCurve: a and b need finite x and y.');
  if (!(Number.isFinite(slack) && slack >= 0)) {
    throw new RangeError(`cableCurve: slack must be a finite number of 0 or more, not ${slack}.`);
  }
  const sag = Math.max(CABLE_MIN_SAG, slack * Math.hypot(b.x - a.x, b.y - a.y));
  const h = (sag * 4) / 3;
  const c1x = num((2 * a.x + b.x) / 3);
  const c1y = num((2 * a.y + b.y) / 3 + h);
  const c2x = num((a.x + 2 * b.x) / 3);
  const c2y = num((a.y + 2 * b.y) / 3 + h);
  return `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
}

function needTokens(tokens, who) {
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError(`${who} needs the synth tokens (synthTokens(el)).`);
  }
}

/**
 * One cable as '<g data-cable="id">…</g>': a soft shadow (tokens.cable.shadow), then the main
 * stroke group, the only part that takes the pointer (a wide invisible hit path of
 * CABLE_HIT_PX / zoom and the visible stroke in the caller's colour, dashed by type), then an
 * optional sheen stripe. Hover and selection thicken the stroke; dragging lifts the shadow;
 * refused paints the stroke tokens.jack.refuse, dashed.
 */
export function cableSvg({ id, from, to, type, colour, state = {}, tokens, slack = CABLE_SLACK,
  zoom = 1, sheen = false } = {}) {
  needTokens(tokens, 'cableSvg');
  if (!Object.hasOwn(CABLE_DASH, type)) {
    throw new Error(`cableSvg: type must be AUDIO, CONTROL, TRIGGER or ANALYSIS, not '${type}'.`);
  }
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`cableSvg: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const st = state || {};
  const d = cableCurve(from, to, { slack });
  const w = st.selected ? WIDTH.selected : (st.hover ? WIDTH.hover : WIDTH.base);
  const paint = st.refused ? tokens.jack.refuse : (colour || 'currentColor');
  const pattern = st.refused ? (CABLE_DASH[type] || REFUSED_DASH) : CABLE_DASH[type];
  const dash = pattern ? ` stroke-dasharray="${pattern}"` : '';
  const lift = st.dragging ? 6 : 3;
  const shine = tokens.text && tokens.text.value ? tokens.text.value : 'currentColor';
  return `<g data-cable="${esc(id)}" pointer-events="none">`
    + `<path data-shadow="" d="${d}" fill="none" stroke="${esc(tokens.cable.shadow)}" `
    + `stroke-opacity="0.35" stroke-width="${num(w + 3)}" stroke-linecap="round" `
    + `transform="translate(0 ${lift})"/>`
    + '<g data-main="" pointer-events="stroke">'
    + `<path data-hit="" d="${d}" fill="none" stroke="currentColor" stroke-opacity="0" `
    + `stroke-width="${num(CABLE_HIT_PX / zoom)}" stroke-linecap="round"/>`
    + `<path data-stroke="" d="${d}" fill="none" stroke="${esc(paint)}" stroke-width="${w}" `
    + `stroke-linecap="round"${dash}/>`
    + '</g>'
    + (sheen ? `<path data-sheen="" d="${d}" fill="none" stroke="${esc(shine)}" `
      + `stroke-opacity="0.28" stroke-width="${num(w * 0.3)}" stroke-linecap="round"${dash} `
      + 'transform="translate(-0.7 -0.7)" pointer-events="none"/>' : '')
    + '</g>';
}

/** A plug seated at `at`: a sleeve (jack tokens), a boot ring in the cable's colour, a dark
 *  centre. It takes no pointer: the cable's main stroke and the jack do. */
export function plugSvg({ at, colour, tokens } = {}) {
  if (!finite(at)) throw new TypeError('plugSvg: at needs finite x and y.');
  needTokens(tokens, 'plugSvg');
  const c = `cx="${num(at.x)}" cy="${num(at.y)}"`;
  return '<g data-plug="" pointer-events="none">'
    + `<circle ${c} r="7" fill="${esc(tokens.jack.body)}" stroke="${esc(tokens.jack.ring)}" `
    + 'stroke-width="1.5"/>'
    + `<circle ${c} r="4.5" fill="none" stroke="${esc(colour || 'currentColor')}" `
    + 'stroke-width="3"/>'
    + `<circle ${c} r="1.5" fill="${esc(tokens.surface.edge)}" stroke="none"/>`
    + '</g>';
}
