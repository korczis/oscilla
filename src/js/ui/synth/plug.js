// The shared synth-theme layer's patch plug (plan F013 entry 3; the look audit's JC-3, p2's core
// file): a pure string renderer for the plug at one end of a cable, seen from the front of the
// panel, seated in a jack or held at the pointer. The plug COVERS the socket, as a real one does
// (the announced owner default of 2026-11-04 21:55Z, not objected; it replaces dev-53's S6c bound
// of 5.3, the 10.5 "eye" that floated inside the ring): a moulded boot, a cap of radius 13.5 on
// the jack joined by its two tangents to a neck of radius 11 six units along the way the cable
// leaves, in the cable's colour inside an outline of the cord's rim ink, with one strain-relief
// band on the neck and one sheen band on the cap, lit from above and the left in both themes (the
// relief in the rim ink, the sheen in the light depth role, the shadow in the dark one; review of
// 11-05). A plug over a jack in a state the bay marks (pending, compatible) carries that ring
// round its boot (`ring`), since it covers the jack's own. Every mark, its lifted shadow and the
// ring included, stays within PLUG.room (19.875): inside the jack's 44 px hit square, clear of a
// neighbour's plug a jack pitch (44) away and above the jack's label. It takes no pointer, so
// the jack's hit still wins: the caller draws plugs in a layer above the jacks. Every paint is a
// token (project.visual-identity-lock v3) and every shape sets its own stroke; no number here
// sets an opacity, an alpha or a shadow (v4): the bands' and the shadow's intensities are the
// classes opacity-hw-sheen and opacity-hw-shadow. Nothing moves: a held plug is drawn again where
// the pointer is, its seated size with its shadow lifted. Imports nothing; cable.js re-exports
// plugSvg and plugState, takes the cord's inks from cordInk, sheenInk and castInk, and keeps its
// refused cross clear of PLUG.room, or leaves it out when told the target plug is refused
// (cableParts' `plug`).
//
//   PLUG                                          the plug's geometry, graph units
//   plugSvg({ at, colour, tokens, state, direction, ring })
//                                                 '<g data-plug="" pointer-events="none">…</g>'
//   plugState(state)                              { held, refused }, a misspelt state refused
//   cordInk(tokens)                               the ink of a cord's rim, shade and bands and a
//                                                 plug's outline and relief: dark in both themes
//   sheenInk(tokens)                              the ink of a sheen: light in both themes
//   castInk(tokens)                               the ink of the shadow cast on the panel

/** The plug's geometry, graph units (1 = 1 CSS px at zoom 1). */
export const PLUG = Object.freeze({
  /** The cap's radius, on the jack: over the socket ring (JACK_R 13) and JC-4's bushing (9.5). */
  boot: 13.5,
  /** The neck's radius, where the cord leaves the boot. */
  neck: 11,
  /** How far along the cord the neck's centre sits from the jack's. */
  reach: 6,
  /** The outline's width: the cord's rim (cable.js CABLE_EDGE). */
  edge: 0.75,
  /** A held plug's scale about its centre: 1, so a plug held over a jack keeps the seated
   *  footprint; the lifted shadow tells held from seated. */
  held: 1,
  /** The soft shadow's drop: seated, and lifted while held. */
  lift: Object.freeze({ seated: 1, held: 2.5 }),
  /** How far a jack's state ring (`ring`) shows outside the boot's outline, all round. */
  halo: 2.5,
  /** The most any mark of a plug reaches from its centre, seated or held, the soft shadow and
   *  the ring included (the neck's far edge 6 + 11 + 0.375, and the lift or the ring 2.5): the
   *  room the cable's refused cross and its type bands keep clear. */
  room: 19.875,
});

/** The strain-relief band: an arc about the neck's centre, facing the cord (radians each side). */
const RELIEF = Object.freeze({ r: 8.5, half: 0.9, width: 2 });
/** The sheen band: an arc on the cap, lit from the upper left (degrees, y down). */
const SHEEN = Object.freeze({ r: 10.5, from: 200, to: 260, width: 1.5 });
/** The refused cross: its half arm, its underlay and its stroke, on the cap (4 × √2 + 1.5). */
const CROSS = Object.freeze({ arm: 4, under: 3, width: 2 });
const DOWN = Object.freeze({ x: 0, y: 1 });
const SEATED = Object.freeze({ held: false, refused: false });
const HELD = Object.freeze({ held: true, refused: false });
const REFUSED = Object.freeze({ held: false, refused: true });
/** The intensity class of the sheen band: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The intensity class of the soft shadow and the relief: the hw-shadow key. */
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
/** A coordinate to 1e-6 (never -0), without a string round trip: a plug is drawn twice a cord. */
const num = (x) => Math.round(x * 1e6) / 1e6 || 0;
const esc = (x) => {
  const v = String(x);
  return /[&"<>]/.test(v) ? v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;') : v;
};

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

/** The WCAG luminance of a token value written in hex (tokens.css), else NaN (var(), …). */
function luminanceOf(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return NaN;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether the cable sheen is the darker of the cable's two inks (both read as hex). */
function sheenDarker(tokens) {
  const { shadow, sheen } = (tokens && tokens.cable) || {};
  const ls = luminanceOf(shadow);
  const lt = luminanceOf(sheen);
  return Boolean(shadow && sheen) && Number.isFinite(ls) && Number.isFinite(lt) && lt < ls;
}

/** The ink of a cord's rim, shade and type bands and a plug's outline and relief (S8): the darker
 *  of tokens.cable.shadow and tokens.cable.sheen (dark --osc-bg, light --osc-text; each palette
 *  colour 3:1 on it), else cable.shadow, else currentColor. A choice of token only. */
export function cordInk(tokens) {
  if (sheenDarker(tokens)) return tokens.cable.sheen;
  return (tokens && tokens.cable && tokens.cable.shadow) || 'currentColor';
}

/** The ink of a cord's and a plug's sheen, lighter than every cord in both themes: the light
 *  depth role (tokens.control.highlight, --osc-hw-highlight); without it the lighter of the
 *  cable's two inks, else cable.sheen, else currentColor. */
export function sheenInk(tokens) {
  const c = tokens && tokens.control;
  if (c && c.highlight) return c.highlight;
  if (sheenDarker(tokens)) return tokens.cable.shadow;
  return (tokens && tokens.cable && tokens.cable.sheen) || 'currentColor';
}

/** The ink of the soft shadow a cord and a plug cast on the panel: the dark depth role
 *  (tokens.control.shade, --osc-hw-shade), which shows on the card and the plates at
 *  hw-shadow in both themes; without it cordInk. */
export function castInk(tokens) {
  const c = tokens && tokens.control;
  return (c && c.shade) || cordInk(tokens);
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
 * of the boot's shape (castInk at the hw-shadow intensity, PLUG.lift down); with `ring` (a token,
 * the ring the bay gives the jack: pending, compatible) that ring round the boot's outline,
 * PLUG.halo wide outside it, opaque as the jack's own; the boot,
 * the cap (PLUG.boot) about `at` and the neck (PLUG.neck) PLUG.reach along `direction`, the way
 * the cable leaves (cableDirections(from, to) gives both ends'; down when none is given), joined
 * by their outer tangents, filled with the cable's `colour` (the caller's palette token; none
 * reads currentColor) inside a PLUG.edge outline of cordInk(tokens), on which every palette
 * colour holds 3:1 in both themes; a strain-relief band, an arc about the neck facing the cord,
 * in cordInk at the hw-shadow intensity; and a sheen band, an arc on the cap lit from the upper
 * left whatever the direction, in sheenInk at the hw-sheen intensity.
 * No tip, dot or rib: from the front a plug shows its boot.
 *
 * `state` is 'seated' (the default), 'held', 'refused' or { held, refused } (plugState; any
 * other shape refused). Held keeps the seated size (PLUG.held 1) with the shadow lifted to
 * PLUG.lift.held (2.5) and marks the group data-held. Refused marks it data-refused and draws a
 * cross on the cap in tokens.jack.refuse over a tokens.cable.shadow underlay. One refusal shows
 * one cross: a caller drawing a plug at a cable's target end passes the plug's state to the
 * cable too (cableParts' `plug`), and the cable leaves its own cross out when that plug is
 * refused (told nothing, the cable draws its cross, CROSS_BACK from the target, clear of
 * PLUG.room at both ends of a cable whose ends are 2 × CROSS_BACK or more apart). The group takes
 * no pointer and nothing in it can be hit or focused: the jack under it keeps its hit and keys.
 */
export function plugSvg({ at, colour, tokens, state, direction, ring } = {}) {
  if (!finite(at)) throw new TypeError('plugSvg: at needs finite x and y.');
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError('plugSvg needs the synth tokens (synthTokens(el)).');
  }
  if (ring !== undefined && ring !== null && !(typeof ring === 'string' && ring !== '')) {
    throw new TypeError(`plugSvg: ring must be a paint (the jack's ring token), not ${
      shown(ring)}.`);
  }
  const st = plugState(state);
  const d = unitOf(direction);
  const k = st.held ? PLUG.held : 1;
  const s = (x) => num(x * k);
  // A point at radius r and angle a (radians) about c, in the frame of d (a = 0 along d, rising
  // the way SVG's sweep flag 1 turns).
  const lead = Math.atan2(d.y, d.x);
  const on = (c, r, a) => ({ x: num(c.x + r * k * Math.cos(a + lead)),
    y: num(c.y + r * k * Math.sin(a + lead)) });
  const xy = (p) => `${p.x} ${p.y}`;
  const paint = (x) => esc(x || 'currentColor');
  const neck = { x: at.x + PLUG.reach * k * d.x, y: at.y + PLUG.reach * k * d.y };
  // The outer tangents touch both circles at ±t off the axis: cos t = (boot - neck) / reach.
  const t = Math.acos((PLUG.boot - PLUG.neck) / PLUG.reach);
  const bootD = `M ${xy(on(at, PLUG.boot, t))} A ${s(PLUG.boot)} ${s(PLUG.boot)} 0 1 1 `
    + `${xy(on(at, PLUG.boot, -t))} L ${xy(on(neck, PLUG.neck, -t))} A ${s(PLUG.neck)} `
    + `${s(PLUG.neck)} 0 0 1 ${xy(on(neck, PLUG.neck, t))} Z`;
  const arc = (c, r, a0, a1) => `M ${xy(on(c, r, a0))} A ${s(r)} ${s(r)} 0 0 1 `
    + `${xy(on(c, r, a1))}`;
  // The sheen is fixed to the screen, not to the cord: its angles taken back into d's frame.
  const rad = (deg) => (deg * Math.PI) / 180 - lead;
  const line = (p, q, stroke, width) => `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" `
    + `stroke="${stroke}" stroke-width="${s(width)}" stroke-linecap="round"/>`;
  let cross = '';
  if (st.refused) {
    const r = CROSS.arm;
    const arms = [[[-r, -r], [r, r]], [[-r, r], [r, -r]]].map((l) => l.map(([x, y]) => ({
      x: num(at.x + x * k), y: num(at.y + y * k) })));
    const draw = (stroke, width) => arms.map(([p, q]) => line(p, q, stroke, width)).join('');
    cross = `<g data-cross="">${draw(paint(tokens.cable.shadow), CROSS.under)}`
      + `${draw(paint(tokens.jack.refuse), CROSS.width)}</g>`;
  }
  const flags = (st.held ? ' data-held=""' : '') + (st.refused ? ' data-refused=""' : '');
  const relief = arc(neck, RELIEF.r, -RELIEF.half, RELIEF.half);
  const sheen = arc(at, SHEEN.r, rad(SHEEN.from), rad(SHEEN.to));
  const ink = paint(cordInk(tokens));
  const halo = ring ? `<path data-halo="" d="${bootD}" fill="none" stroke="${esc(ring)}" `
    + `stroke-width="${s(PLUG.edge + 2 * PLUG.halo)}" stroke-linejoin="round"/>` : '';
  return `<g data-plug="" pointer-events="none"${flags}>`
    + `<path data-shadow="" class="${SHADOW_CLASS}" d="${bootD}" `
    + `fill="${paint(castInk(tokens))}" stroke="none" `
    + `transform="translate(0 ${st.held ? PLUG.lift.held : PLUG.lift.seated})"/>${halo}`
    + `<path data-boot="" d="${bootD}" fill="${paint(colour)}" stroke="${ink}" `
    + `stroke-width="${s(PLUG.edge)}" stroke-linejoin="round"/>`
    + `<path data-relief="" class="${SHADOW_CLASS}" d="${relief}" fill="none" `
    + `stroke="${ink}" stroke-width="${s(RELIEF.width)}" stroke-linecap="butt"/>`
    + `<path data-sheen="" class="${SHEEN_CLASS}" d="${sheen}" fill="none" `
    + `stroke="${paint(sheenInk(tokens))}" stroke-width="${s(SHEEN.width)}" `
    + 'stroke-linecap="round"/>'
    + `${cross}</g>`;
}
