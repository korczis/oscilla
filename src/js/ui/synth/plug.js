// The shared synth-theme layer's patch plug (plan F013 entry 3, slices S6 and S6c; p2's core
// file): a pure string renderer for the plug at one end of a cable, seen from the front of the
// panel, seated in a jack or held at the pointer. Every mark of it reaches at most 5.25 from its
// centre, seated and held (dev-53's bound, 5.3: S6c), so it sits inside the inner edge of all four
// of dev-53's port glyphs' rings (jack.js portGlyph at JACK_R 13, stroke 2: circle 12, square
// 9.4, diamond 8.19, the trigger triangle 5.34, its inradius 6.34 less half the stroke), its soft
// shadow too, and every port shape stays readable round it; far inside the nut (NUT_R 17), it
// never covers the jack's label. It takes no pointer, so the jack's hit still wins: the
// caller draws plugs in a layer above the jacks. Every paint is a token (project.visual-identity-
// lock v3) and every shape sets its own stroke; no number here sets an opacity, an alpha or a
// shadow (v4): the highlight's and the shadow's intensities are the classes opacity-hw-sheen and
// opacity-hw-shadow. Nothing moves: a held plug is drawn again where the pointer is, its seated
// size with its shadow lifted (it does not scale, so it keeps the footprint over a jack). Imports
// nothing; cable.js re-exports plugSvg and plugState and keeps its refused cross clear of
// PLUG.room, or leaves it out when told the target plug is refused (cableParts' `plug`).
//
//   PLUG                                          the plug's geometry, graph units
//   plugSvg({ at, colour, tokens, state, direction })
//                                                 '<g data-plug="" pointer-events="none">…</g>'
//   plugState(state)                              { held, refused }, a misspelt state refused

/** The plug's geometry, graph units (1 = 1 CSS px at zoom 1). */
export const PLUG = Object.freeze({
  /** The sleeve's radius, the farthest any mark but the soft shadow reaches: diameter 10.5, under
   *  dev-53's 5.3 and the trigger triangle's inner stroke edge (5.34). */
  sleeve: 5.25,
  /** The boot ring's width: as wide as the jack's own ring stroke. */
  ring: 2,
  /** The rim of the sleeve outside the boot ring, so the ring borders only the sleeve and never
   *  the plate or the jack body under the plug. */
  rim: 0.75,
  /** A held plug's scale about its centre: 1, so a plug held over a jack keeps the seated
   *  footprint (S6c); the lifted shadow tells held from seated. */
  held: 1,
  /** The soft shadow's drop: seated, and lifted while held; at 2.5 the shadow still clears the
   *  triangle's base (inner edge 8.1 below the centre: 5.25 + 2.5 = 7.75). */
  lift: Object.freeze({ seated: 1, held: 2.5 }),
  /** The most any mark of a plug reaches from its centre, seated or held, the soft shadow
   *  included (5.25 + 2.5): the room the cable's refused cross keeps clear. */
  room: 7.75,
});

/** The three grip ribs: angles off the leaving direction (radians), their radial span inside the
 *  boot ring (2.5 to 4.5) and their width. */
const RIBS = Object.freeze({ angles: [-0.6, 0, 0.6], inner: 2.85, outer: 4.15, width: 0.75 });
/** The tip's outline and the centre's dot, the sleeve showing between them and the ring. */
const TIP = Object.freeze({ r: 1.4, width: 0.75, centre: 0.6 });
/** The highlight: an arc on the boot ring, lit from the upper left (degrees, y down). */
const SHEEN = Object.freeze({ r: 3.5, from: 200, to: 260, width: 0.75 });
/** The refused cross: its half arm, its underlay and its stroke, inside the sleeve (2.5 × √2 +
 *  1.25 = 4.79). */
const CROSS = Object.freeze({ arm: 2.5, under: 2.5, width: 1.75 });
const DOWN = Object.freeze({ x: 0, y: 1 });
const SEATED = Object.freeze({ held: false, refused: false });
const HELD = Object.freeze({ held: true, refused: false });
const REFUSED = Object.freeze({ held: false, refused: true });
/** The intensity class of the highlight: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The intensity class of the soft shadow: the hw-shadow key of tailwind.config.cjs. */
const SHADOW_CLASS = 'opacity-hw-shadow';

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const KEYS = Object.freeze(['held', 'refused']);
/** A value as an error message names it: what JSON cannot spell (NaN, a symbol) as itself. */
const shown = (x) => {
  if (typeof x === 'number' || typeof x === 'symbol' || typeof x === 'bigint') return String(x);
  if (typeof x === 'function') return 'a function';
  try {
    const json = JSON.stringify(x);
    const proto = x && typeof x === 'object' ? Object.getPrototypeOf(x) : null;
    const kind = proto && proto !== Object.prototype && proto.constructor
      ? `${proto.constructor.name || 'an object'} ` : '';
    return `${kind}${json === undefined ? String(x) : json}`;
  } catch {
    return Object.prototype.toString.call(x);
  }
};
/** A plain record (prototype Object.prototype or null) whose own keys, enumerable or not,
 *  symbols included, are only held and refused, each a boolean or absent. */
const record = (x) => {
  if (!x || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) return false;
  return Reflect.ownKeys(x).every((k) => KEYS.includes(k))
    && KEYS.every((k) => x[k] === undefined || typeof x[k] === 'boolean');
};
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A plug's state as { held, refused }, frozen: from 'seated' (or none), 'held', 'refused', or a
 * plain record (prototype Object.prototype or null) whose only own keys, enumerable or not and
 * symbols included, are held and refused, each a boolean or absent. Anything else (another word,
 * an array, a date, a map, a class instance, an inherited, hidden or misspelt key such as hold)
 * is a RangeError naming it, so a typo never draws a seated plug in silence. `who` and `option`
 * name the caller and its option in the message: cableParts reads its `plug` option through it.
 */
export function plugState(state, who = 'plugSvg', option = 'state') {
  if (state === undefined || state === null || state === 'seated') return SEATED;
  if (state === 'held') return HELD;
  if (state === 'refused') return REFUSED;
  if (!record(state)) {
    throw new RangeError(`${who}: ${option} must be seated, held, refused or { held, refused } `
      + `of booleans, not ${shown(state)}.`);
  }
  return Object.freeze({ held: Boolean(state.held), refused: Boolean(state.refused) });
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
 * (tokens.cable.shadow at the hw-shadow intensity, PLUG.lift down); the sleeve, diameter 10.5 in
 * surface-1 (tokens.surface.plateLo; tokens.jack.body, surface-0, in a set without it); the boot
 * ring, 2 wide in the cable's `colour` (the caller's palette token; none reads currentColor),
 * inside a rim of the sleeve PLUG.rim (0.75) wide, so the ring borders only the sleeve and every
 * palette colour holds 3:1 on what it borders in both themes, over the jack body or any plate
 * (on the light plate --osc-green is 2.71:1 on surface-3 but 3.28:1 on the surface-1 sleeve);
 * a grip collar of three ribs across the ring, grooves cut to the sleeve (its token), turned to
 * `direction`, the way the cable leaves the plug (cableDirections(from, to) gives both ends',
 * along the ports in the port-tangent mode; down when none is given); the tip's outline and the
 * centre in tokens.control.edge, --osc-text-dim (tokens.jack.ring in a set without it), 3:1 on
 * the sleeve; and a highlight arc on the face in tokens.cable.sheen at the hw-sheen intensity,
 * lit from the upper left whatever the direction. A panel's narrower set (jack, cable,
 * surface.edge: dev-53's layerTokens) thus draws every part from a token.
 *
 * `state` is 'seated' (the default), 'held', 'refused' or { held, refused } (plugState; any
 * other shape refused). Held draws the plug PLUG.held (1: its seated size, so it keeps the
 * footprint) times as large about `at` with the shadow lifted to PLUG.lift.held (2.5) and marks
 * the group data-held. Refused marks it data-refused
 * and draws a cross on the sleeve in tokens.jack.refuse over a tokens.cable.shadow underlay; the
 * cross stays inside the sleeve. One refusal shows one cross: a caller drawing a plug at a
 * cable's target end passes the plug's state to the cable too (cableParts' `plug`), and the
 * cable leaves its own cross out when that plug is refused (two separate calls cannot see each
 * other: told nothing, the cable draws its cross). Otherwise the cable's cross sits CROSS_BACK
 * from the target end, clear of PLUG.room at both ends of a cable between two jacks (ends a
 * pitch of 44 or more apart). The group takes no pointer and nothing in it can be hit or
 * focused: the jack under it keeps its hit and its keys.
 */
export function plugSvg({ at, colour, tokens, state, direction } = {}) {
  if (!finite(at)) throw new TypeError('plugSvg: at needs finite x and y.');
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError('plugSvg needs the synth tokens (synthTokens(el)).');
  }
  const st = plugState(state);
  const d = unitOf(direction);
  const k = st.held ? PLUG.held : 1;
  const s = (x) => num(x * k);
  const pt = (angle, r) => ({ x: num(at.x + r * k * Math.cos(angle)),
    y: num(at.y + r * k * Math.sin(angle)) });
  const c = `cx="${num(at.x)}" cy="${num(at.y)}"`;
  const paint = (x) => esc(x || 'currentColor');
  // A panel's adapter may pass the narrower set (jack, cable, surface.edge; dev-53's
  // layerTokens): the sleeve and the tip then take the jack's roles, as the plug did before S6.
  const sleeve = paint(tokens.surface.plateLo || tokens.jack.body);
  const edge = paint((tokens.control && tokens.control.edge) || tokens.jack.ring);
  const line = (p, q, stroke, width, extra = '') => `<line${extra} x1="${p.x}" y1="${p.y}" `
    + `x2="${q.x}" y2="${q.y}" stroke="${stroke}" stroke-width="${s(width)}" `;
  const lead = Math.atan2(d.y, d.x);
  const ribs = RIBS.angles.map((off) => line(pt(lead + off, RIBS.inner),
    pt(lead + off, RIBS.outer), sleeve, RIBS.width, ' data-rib=""')
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
    + `<circle data-sleeve="" ${c} r="${s(PLUG.sleeve)}" fill="${sleeve}" `
    + 'stroke="none"/>'
    + `<circle data-ring="" ${c} r="${s(PLUG.sleeve - PLUG.rim - PLUG.ring / 2)}" fill="none" `
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
