// The shared synth-theme layer's patch cable (plan F013; the seam agreed on 2026-11-02): pure
// string renderers for one cable and one plug, from two points in the caller's coordinates (the
// bay's or a graph's), so a node drag recomputes only its own edges and nothing reads a layout. The
// signal type is the dash pattern, never colour alone, and a dash keeps its gaps at every width
// (butt caps); a refused cable is marked by a shape as well as the refuse colour. The colour is
// the caller's palette token (tokens.cable.palette[sourceModule % 6]); every other paint is a
// token too (project.visual-identity-lock v3), and every shape sets its own stroke. No number
// here sets an opacity, an alpha or a shadow (v4): the sheen's intensity is the hw-sheen
// Tailwind key (class opacity-hw-sheen), the shadow is an opaque underlay offset down, and the
// hit path is hidden rather than transparent. Imports nothing.
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
/** A near-vertical cable's sideways bow (to +x) at its middle, as a part of min(sag, rise). */
export const CABLE_BOW = 0.3;
/** Half the arm of the refused cross, graph units, and its stroke width. */
const CROSS = Object.freeze({ arm: 5, width: 2, under: 4.5 });
/** The sheen's offset up and left, screen px. */
const SHEEN_PX = 0.7;
/** The shadow underlay's drop, screen px: at rest, and lifted while the cable is dragged. */
const SHADOW_PX = Object.freeze({ rest: 1, lifted: 3 });
/** How much wider than the stroke the shadow underlay is, graph units. */
const SHADOW_SPREAD = 3;
/** The intensity class of the sheen: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
const WIDTH = Object.freeze({ base: 4.5, hover: 6, selected: 7.5 });

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The two control points of the hanging cubic from a to b (see cableCurve). */
function controls(a, b, slack) {
  if (!finite(a) || !finite(b)) throw new TypeError('cableCurve: a and b need finite x and y.');
  if (!(Number.isFinite(slack) && slack >= 0)) {
    throw new RangeError(`cableCurve: slack must be a finite number of 0 or more, not ${slack}.`);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sag = Math.max(CABLE_MIN_SAG, slack * Math.hypot(dx, dy));
  const h = (sag * 4) / 3;
  // A near-vertical cable bows sideways, always to the right (+x), so it still reads as
  // hanging; the bow fades to nothing as the cable leans to |dx| = sag. One fixed side keeps the
  // curve continuous as an end is dragged across the vertical (a side taken from the sign of dx
  // would jump from one side to the other there, where the bow is largest), and it does not
  // depend on the order of a and b, so reversed ends draw the same curve.
  const lean = Math.abs(dx);
  const bow = lean < sag
    ? CABLE_BOW * Math.min(sag, Math.abs(dy)) * (1 - lean / sag) * (4 / 3) : 0;
  return [
    { x: num((2 * a.x + b.x) / 3 + bow), y: num((2 * a.y + b.y) / 3 + h) },
    { x: num((a.x + 2 * b.x) / 3 + bow), y: num((a.y + 2 * b.y) / 3 + h) },
  ];
}

/**
 * A hanging cable from a to b as one cubic: the ends exactly a and b, both control points a
 * third of the way along the chord and lowered by 4/3 of the sag, so the middle of the curve
 * hangs `sag` below the chord's midpoint, down the screen whichever end is higher. The sag is
 * slack × the distance, never below CABLE_MIN_SAG; a cable steeper than its sag also bows
 * sideways (CABLE_BOW), so a vertical one still hangs. Reversed ends draw the same curve, and
 * a == b is a finite droop.
 */
export function cableCurve(a, b, { slack = CABLE_SLACK } = {}) {
  const [c1, c2] = controls(a, b, slack);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** The cubic from a to b at t = 0.5. */
function middle(a, b, slack) {
  const [c1, c2] = controls(a, b, slack);
  return { x: num((a.x + 3 * c1.x + 3 * c2.x + b.x) / 8), y: num((a.y + 3 * c1.y + 3 * c2.y
    + b.y) / 8) };
}

function needTokens(tokens, who) {
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError(`${who} needs the synth tokens (synthTokens(el)).`);
  }
}

/**
 * One cable as '<g data-cable="id">…</g>': a soft shadow (an opaque underlay in
 * tokens.cable.shadow, SHADOW_SPREAD wider than the stroke and SHADOW_PX.rest screen px down),
 * then the main stroke group, the only part that takes the pointer (a wide hit path of
 * CABLE_HIT_PX / zoom, visibility="hidden", which pointer-events="stroke" still hits, and the
 * visible stroke in the caller's colour, dashed by type), then an optional sheen stripe
 * (tokens.cable.sheen at the hw-sheen intensity; off by default). Hover and selection thicken
 * the stroke; a dashed stroke has butt caps, so its gaps stay open at every width (round caps
 * would close them), and a solid one round caps. Dragging lifts the shadow (SHADOW_PX.lifted
 * down). Refused paints the stroke
 * tokens.jack.refuse, dashed (a solid type takes REFUSED_DASH), marks the group data-refused and
 * draws a cross at the curve's middle (t = 0.5), so a refusal is a shape, not a colour alone.
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
  const cap = pattern ? 'butt' : 'round';
  const drop = num((st.dragging ? SHADOW_PX.lifted : SHADOW_PX.rest) / zoom);
  const shine = tokens.cable.sheen || 'currentColor';
  const off = num(-SHEEN_PX / zoom);
  let cross = '';
  if (st.refused) {
    const m = middle(from, to, slack);
    const r = CROSS.arm;
    const arms = [[m.x - r, m.y - r, m.x + r, m.y + r], [m.x - r, m.y + r, m.x + r, m.y - r]]
      .map((l) => l.map(num));
    const line = ([x1, y1, x2, y2], paint, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" `
      + `y2="${y2}" stroke="${esc(paint)}" stroke-width="${w}" stroke-linecap="round"/>`;
    cross = '<g data-cross="" pointer-events="none">'
      + arms.map((l) => line(l, tokens.cable.shadow, CROSS.under)).join('')
      + arms.map((l) => line(l, tokens.jack.refuse, CROSS.width)).join('')
      + '</g>';
  }
  return `<g data-cable="${esc(id)}"${st.refused ? ' data-refused=""' : ''} `
    + 'pointer-events="none">'
    + `<path data-shadow="" d="${d}" fill="none" stroke="${esc(tokens.cable.shadow)}" `
    + `stroke-width="${num(w + SHADOW_SPREAD)}" stroke-linecap="round" `
    + `transform="translate(0 ${drop})"/>`
    + '<g data-main="" pointer-events="stroke">'
    + `<path data-hit="" d="${d}" fill="none" stroke="currentColor" visibility="hidden" `
    + `stroke-width="${num(CABLE_HIT_PX / zoom)}" stroke-linecap="round"/>`
    + `<path data-stroke="" d="${d}" fill="none" stroke="${esc(paint)}" stroke-width="${w}" `
    + `stroke-linecap="${cap}"${dash}/>`
    + '</g>'
    + cross
    + (sheen ? `<path data-sheen="" class="${SHEEN_CLASS}" d="${d}" fill="none" `
      + `stroke="${esc(shine)}" stroke-width="${num(w * 0.3)}" stroke-linecap="${cap}"${dash} `
      + `transform="translate(${off} ${off})" pointer-events="none"/>` : '')
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
