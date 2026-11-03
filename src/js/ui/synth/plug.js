// The shared synth-theme layer's patch plug (plan F013 entry 3, slice S6; p2's core file): a pure
// string renderer for the plug at one end of a cable, seen from the front of the panel, seated in
// a jack or held at the pointer. It fits inside a jack nut of 22 across flats (dev-53's jack), so
// it never covers the jack's label, and it takes no pointer, so the jack's hit still wins: the
// caller draws plugs in a layer above the jacks. Every paint is a token (project.visual-identity-
// lock v3) and every shape sets its own stroke; no number here sets an opacity, an alpha or a
// shadow (v4): the highlight's and the shadow's intensities are the classes opacity-hw-sheen and
// opacity-hw-shadow. Nothing moves: a held plug is drawn again where the pointer is. Imports
// nothing; cable.js re-exports plugSvg and keeps its refused cross clear of PLUG.room.
//
//   PLUG                                          the plug's geometry, graph units
//   plugSvg({ at, colour, tokens, state, direction })
//                                                 '<g data-plug="" pointer-events="none">…</g>'

/** The plug's geometry, graph units (1 = 1 CSS px at zoom 1). */
export const PLUG = Object.freeze({
  /** The sleeve's radius: diameter 14, inside a jack nut of 22 across flats. */
  sleeve: 7,
  /** The boot ring's width; its outer edge is the sleeve's, so it borders the jack body. */
  ring: 3,
  /** A held plug's scale about its centre. */
  held: 1.1,
  /** The soft shadow's drop: seated, and lifted while held. */
  lift: Object.freeze({ seated: 1, held: 3 }),
  /** The most any mark of a plug reaches from its centre, seated or held (7 × 1.1 = 7.7, the
   *  soft shadow apart): the room the cable's refused cross keeps clear. */
  room: 7.75,
});

/** The three grip ribs: angles off the leaving direction (radians), and their radial span. */
const RIBS = Object.freeze({ angles: [-0.6, 0, 0.6], inner: 4.25, outer: 6.75, width: 1 });
/** The tip's outline and the centre's dot. */
const TIP = Object.freeze({ r: 2.5, width: 0.75, centre: 1 });
/** The highlight: an arc on the sleeve's face, lit from the upper left (degrees, y down). */
const SHEEN = Object.freeze({ r: 3.4, from: 200, to: 260, width: 0.75 });
/** The refused cross: its half arm, its underlay and its stroke, inside the sleeve. */
const CROSS = Object.freeze({ arm: 3.25, under: 3.5, width: 2 });
const DOWN = Object.freeze({ x: 0, y: 1 });
/** The intensity class of the highlight: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The intensity class of the soft shadow: the hw-shadow key of tailwind.config.cjs. */
const SHADOW_CLASS = 'opacity-hw-shadow';

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** { held, refused } from 'seated', 'held', 'refused' or an object of two booleans. */
function stateOf(state) {
  if (state === undefined || state === null || state === 'seated') {
    return { held: false, refused: false };
  }
  if (state === 'held') return { held: true, refused: false };
  if (state === 'refused') return { held: false, refused: true };
  const ok = typeof state === 'object' && ['held', 'refused']
    .every((k) => state[k] === undefined || typeof state[k] === 'boolean');
  if (!ok) {
    throw new RangeError('plugSvg: state must be seated, held, refused or { held, refused } '
      + `of booleans, not ${JSON.stringify(state)}.`);
  }
  return { held: Boolean(state.held), refused: Boolean(state.refused) };
}

/** The leaving direction as a unit vector; down when none is given. */
function unitOf(direction) {
  if (direction === undefined) return DOWN;
  const ok = finite(direction) && Math.hypot(direction.x, direction.y) > 0;
  if (!ok) {
    throw new TypeError('plugSvg: direction must be { x, y } of finite numbers, not zero (the '
      + 'way the cable leaves the plug; cableDirections gives it).');
  }
  const l = Math.hypot(direction.x, direction.y);
  return { x: direction.x / l, y: direction.y / l };
}

/**
 * A plug at `at` (the jack's centre, or the pointer while held), from the front: a soft shadow
 * (tokens.cable.shadow at the hw-shadow intensity, PLUG.lift down); the sleeve, diameter 14 in
 * surface-3 (tokens.surface.plateHi); the boot ring, 3 wide in the cable's `colour` (the
 * caller's palette token; none reads currentColor), its outer edge on the sleeve's, so the plug
 * holds 3:1 on the jack body in both themes; a grip collar of three ribs across the ring in
 * --osc-border (tokens.control.knurl), turned to `direction`, the way the cable leaves the plug
 * (cableDirections(from, to) gives both ends', along the ports in the port-tangent mode; down
 * when none is given); the tip's outline and the centre in --osc-bg (tokens.surface.edge); and
 * a highlight arc on the face in tokens.cable.sheen at the hw-sheen intensity, lit from the
 * upper left whatever the direction.
 *
 * `state` is 'seated' (the default), 'held', 'refused' or { held, refused }. Held draws the
 * plug PLUG.held (1.1) times as large about `at` with the shadow lifted to PLUG.lift.held and
 * marks the group data-held. Refused marks it data-refused and draws a cross on the sleeve in
 * tokens.jack.refuse over a tokens.cable.shadow underlay; the cross stays inside the sleeve, and
 * cableParts' own refused cross sits CROSS_BACK from the target end, outside PLUG.room, so the
 * two never overlap; a caller that draws a refused plug at the target end passes cross: false
 * to the cable, so one cross marks one refusal. The group takes no pointer and nothing in it can
 * be hit or focused: the jack under it keeps its hit and its keys.
 */
export function plugSvg({ at, colour, tokens, state, direction } = {}) {
  if (!finite(at)) throw new TypeError('plugSvg: at needs finite x and y.');
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError('plugSvg needs the synth tokens (synthTokens(el)).');
  }
  const st = stateOf(state);
  const d = unitOf(direction);
  const k = st.held ? PLUG.held : 1;
  const s = (x) => num(x * k);
  const pt = (angle, r) => ({ x: num(at.x + r * k * Math.cos(angle)),
    y: num(at.y + r * k * Math.sin(angle)) });
  const c = `cx="${num(at.x)}" cy="${num(at.y)}"`;
  const paint = (x) => esc(x || 'currentColor');
  const edge = paint(tokens.surface.edge);
  const knurl = paint(tokens.control && tokens.control.knurl);
  const line = (p, q, stroke, width, extra = '') => `<line${extra} x1="${p.x}" y1="${p.y}" `
    + `x2="${q.x}" y2="${q.y}" stroke="${stroke}" stroke-width="${s(width)}" `;
  const lead = Math.atan2(d.y, d.x);
  const ribs = RIBS.angles.map((off) => line(pt(lead + off, RIBS.inner),
    pt(lead + off, RIBS.outer), knurl, RIBS.width, ' data-rib=""')
    + 'stroke-linecap="butt"/>').join('');
  const rad = (deg) => (deg * Math.PI) / 180;
  const a0 = pt(rad(SHEEN.from), SHEEN.r);
  const a1 = pt(rad(SHEEN.to), SHEEN.r);
  let cross = '';
  if (st.refused) {
    const r = CROSS.arm;
    const arms = [[[-r, -r], [r, r]], [[-r, r], [r, -r]]].map((l) => l.map(([x, y]) => ({
      x: num(at.x + x * k), y: num(at.y + y * k) })));
    const draw = (stroke, width) => arms.map(([p, q]) => line(p, q, stroke, width)
      + 'stroke-linecap="round"/>').join('');
    cross = `<g data-cross="">${draw(paint(tokens.cable.shadow), CROSS.under)}`
      + `${draw(paint(tokens.jack.refuse), CROSS.width)}</g>`;
  }
  const flags = (st.held ? ' data-held=""' : '') + (st.refused ? ' data-refused=""' : '');
  return `<g data-plug="" pointer-events="none"${flags}>`
    + `<circle data-shadow="" class="${SHADOW_CLASS}" ${c} r="${s(PLUG.sleeve)}" `
    + `fill="${paint(tokens.cable.shadow)}" stroke="none" `
    + `transform="translate(0 ${st.held ? PLUG.lift.held : PLUG.lift.seated})"/>`
    + `<circle data-sleeve="" ${c} r="${s(PLUG.sleeve)}" fill="${paint(tokens.surface.plateHi)}" `
    + 'stroke="none"/>'
    + `<circle data-ring="" ${c} r="${s(PLUG.sleeve - PLUG.ring / 2)}" fill="none" `
    + `stroke="${paint(colour)}" stroke-width="${s(PLUG.ring)}"/>`
    + `<g data-grip="">${ribs}</g>`
    + `<circle data-tip="" ${c} r="${s(TIP.r)}" fill="none" stroke="${edge}" `
    + `stroke-width="${s(TIP.width)}"/>`
    + `<circle data-centre="" ${c} r="${s(TIP.centre)}" fill="${edge}" stroke="none"/>`
    + `<path data-sheen="" class="${SHEEN_CLASS}" d="M ${a0.x} ${a0.y} A ${s(SHEEN.r)} `
    + `${s(SHEEN.r)} 0 0 1 ${a1.x} ${a1.y}" fill="none" stroke="${paint(tokens.cable.sheen)}" `
    + `stroke-width="${s(SHEEN.width)}" stroke-linecap="round"/>`
    + `${cross}</g>`;
}
