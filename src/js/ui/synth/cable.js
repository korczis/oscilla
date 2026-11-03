// The shared synth-theme layer's patch cable (plan F013; the seam agreed on 2026-11-02): pure
// string renderers for one cable and one plug, from two points in the caller's coordinates (the
// bay's or a graph's), so a node drag recomputes only its own edges and nothing reads a layout. The
// signal type is the dash pattern, never colour alone, and a dash keeps its gaps at every width
// (butt caps); a refused cable is marked by a shape as well as the refuse colour. The colour is
// the caller's palette token (tokens.cable.palette[sourceModule % 6]); every other paint is a
// token too (project.visual-identity-lock v3), and every shape sets its own stroke. No number
// here sets an opacity, an alpha or a shadow (v4): the sheen's and the shadow's intensities are
// the hw-sheen and hw-shadow Tailwind keys (classes opacity-hw-sheen and opacity-hw-shadow), and
// the hit path is hidden rather than transparent. Imports nothing.
//
//   CABLE_DASH                              the pattern of each signal type
//   cableCurve(a, b, { slack, box })        'M … C …', a hanging cable from a to b
//   cableParts({ id, from, to, type, colour, state, tokens, slack, box, zoom, sheen, dash,
//     port })
//                                           [{ key, tag, attrs, parent }], for setAttribute
//   partsSvg(parts)                         the markup of those records
//   cableSvg(spec)                          '<g data-cable="id">…</g>' = partsSvg(cableParts(spec))
//   plugSvg({ at, colour, tokens })         a seated plug, taking no pointer

/** The dash pattern per signal type (PORT_VISUALS: solid, dashed, pulse, dash-dot). */
export const CABLE_DASH = Object.freeze({
  AUDIO: null, CONTROL: '9 6', TRIGGER: '2 6', ANALYSIS: '6 3 2 3',
});
/** A refused connection of a solid type still shows by pattern, not by colour alone. */
export const REFUSED_DASH = '4 4';
/** The least a cable hangs below its chord's midpoint, graph units, however short. */
export const CABLE_MIN_SAG = 12;
/** The most a cable hangs below its chord's midpoint, graph units, however long. */
export const CABLE_MAX_SAG = 60;
/** The default slack: the sag as a fraction of the distance between the ends. */
export const CABLE_SLACK = 0.25;
/** The hit path's width in screen px at every zoom (vector-effect="non-scaling-stroke"). */
export const CABLE_HIT_PX = 44;
/** A near-vertical cable's sideways bow (to +x) at its middle, as a part of min(sag, rise). */
export const CABLE_BOW = 0.3;
/** Half the arm of the refused cross, graph units, and its stroke width. */
const CROSS = Object.freeze({ arm: 5, width: 2, under: 4.5 });
/** How far back from the target end the refused cross sits, graph units: the plug's sleeve
 *  (r 7 and half its 1.5 ring) plus the cross's reach (arm × √2 and half its underlay), so the
 *  cross never covers the plug. */
const CROSS_BACK = 7.75 + CROSS.arm * Math.SQRT2 + CROSS.under / 2 + 1;
/** The sheen's offset up and left, screen px. */
const SHEEN_PX = 0.7;
/** The shadow underlay's drop, screen px: at rest, and lifted while the cable is dragged. */
const SHADOW_PX = Object.freeze({ rest: 1, lifted: 3 });
/** How much wider than the stroke the shadow underlay is, graph units. */
const SHADOW_SPREAD = 3;
/** The intensity class of the sheen: the hw-sheen key of tailwind.config.cjs. */
const SHEEN_CLASS = 'opacity-hw-sheen';
/** The intensity class of the soft shadow: the hw-shadow key of tailwind.config.cjs. */
const SHADOW_CLASS = 'opacity-hw-shadow';
const WIDTH = Object.freeze({ base: 4.5, hover: 6, selected: 7.5 });

const finite = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const num = (x) => {
  const r = Number(x.toFixed(6));
  return r === 0 ? 0 : r;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The most sag that keeps the curve above `bottom`. Below the chord the cubic is
 * y(t) = a.y + dy t + 4 sag t (1 - t); while |dy| <= 4 sag its lowest point is
 * mid + sag + dy² / (16 sag), so the largest sag with that at most bottom is
 * (R + √(R² - dy²/4)) / 2, R = bottom - mid. With an end at or below the bottom, the sag that
 * puts the lowest point on the lower end, |dy| / 4, so the cable never hangs below its end.
 */
function sagRoom(a, b, bottom) {
  const dy = b.y - a.y;
  const r = bottom - (a.y + b.y) / 2;
  const half = Math.abs(dy) / 2;
  if (r <= half) return half / 2;
  return (r + Math.sqrt(r * r - half * half)) / 2;
}

/** The bottom edge of a viewBox { x, y, width, height }, or Infinity without one. */
function bottomOf(box) {
  if (box === undefined || box === null) return Infinity;
  const ok = ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(box[k]));
  if (!ok || box.height < 0) {
    throw new RangeError('cableCurve: box must be a viewBox { x, y, width, height } of finite '
      + 'numbers with a height of 0 or more.');
  }
  return box.y + box.height;
}

/** The two control points of the hanging cubic from a to b (see cableCurve). */
function controls(a, b, slack, box) {
  if (!finite(a) || !finite(b)) throw new TypeError('cableCurve: a and b need finite x and y.');
  if (!(Number.isFinite(slack) && slack >= 0)) {
    throw new RangeError(`cableCurve: slack must be a finite number of 0 or more, not ${slack}.`);
  }
  const bottom = bottomOf(box);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const want = Math.min(CABLE_MAX_SAG, Math.max(CABLE_MIN_SAG, slack * Math.hypot(dx, dy)));
  const sag = Math.max(0, Math.min(want, sagRoom(a, b, bottom)));
  const h = (sag * 4) / 3;
  // A near-vertical cable bows sideways, always to the right (+x), so it still reads as
  // hanging; the bow fades to nothing as the cable leans to |dx| = sag. One fixed side keeps the
  // curve continuous as an end is dragged across the vertical (a side taken from the sign of dx
  // would jump from one side to the other there, where the bow is largest), and it does not
  // depend on the order of a and b, so reversed ends draw the same curve.
  const lean = Math.abs(dx);
  const bow = lean < sag && sag > 0
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
 * slack × the distance, never below CABLE_MIN_SAG nor above CABLE_MAX_SAG; given the drawing's
 * viewBox (`box`), it is lessened so the curve never hangs below the box's bottom edge (the box
 * wins over the minimum, down to a straight cable). A cable steeper than its sag also bows
 * sideways (CABLE_BOW), so a vertical one still hangs. Reversed ends draw the same curve, and
 * a == b is a finite droop.
 */
export function cableCurve(a, b, { slack = CABLE_SLACK, box } = {}) {
  const [c1, c2] = controls(a, b, slack, box);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/**
 * The point of the cubic from a to b that lies CROSS_BACK from b, walking back from b: the
 * first sample (1/64 steps) that far away, refined by bisection. A cable too short to reach
 * that far takes its point farthest from b.
 */
function nearTarget(a, b, slack, box) {
  const [c1, c2] = controls(a, b, slack, box);
  const p = (t) => {
    const u = 1 - t;
    const f = (k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k]
      + t * t * t * b[k];
    return { x: f('x'), y: f('y') };
  };
  const away = (t) => {
    const q = p(t);
    return Math.hypot(q.x - b.x, q.y - b.y);
  };
  const STEPS = 64;
  let best = 1;
  for (let i = STEPS - 1; i >= 0; i--) {
    const t = i / STEPS;
    if (away(t) >= CROSS_BACK) {
      let lo = t;
      let hi = (i + 1) / STEPS;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        if (away(m) >= CROSS_BACK) lo = m; else hi = m;
      }
      const q = p(lo);
      return { x: num(q.x), y: num(q.y) };
    }
    if (away(t) > away(best)) best = t;
  }
  const q = p(best);
  return { x: num(q.x), y: num(q.y) };
}

function needTokens(tokens, who) {
  if (!tokens || !tokens.cable || !tokens.jack || !tokens.surface) {
    throw new TypeError(`${who} needs the synth tokens (synthTokens(el)).`);
  }
}

/** A dash pattern as SVG reads one: numbers of 0 or more, spaced or comma separated. */
const DASH_RX = /^\d*\.?\d+(?:(?:\s*,\s*|\s+)\d*\.?\d+)*$/;
/** A port shape's name (PORT_KINDS): a lowercase word, as the port glyph names it. */
const PORT_RX = /^[a-z][a-z0-9-]{0,31}$/;

/** The dash of a cable: the caller's (a CABLE_KINDS declaration), else CABLE_DASH[type]. */
function dashOf(type, dash, who) {
  if (dash === undefined) {
    if (!Object.hasOwn(CABLE_DASH, type)) {
      throw new Error(`${who}: type must be AUDIO, CONTROL, TRIGGER or ANALYSIS, not '${type}', `
        + 'unless its dash is passed.');
    }
    return CABLE_DASH[type];
  }
  if (typeof type !== 'string' || type === '') {
    throw new TypeError(`${who}: type must be the signal's kind name, not '${type}'.`);
  }
  if (dash === null) return null;
  const ok = typeof dash === 'string' && DASH_RX.test(dash.trim())
    && dash.split(/[\s,]+/).filter(Boolean).reduce((a, x) => a + Number(x), 0) > 0;
  if (!ok) {
    throw new TypeError(`${who}: dash must be null (solid) or an SVG dash pattern of numbers `
      + `of 0 or more, not all 0, not ${JSON.stringify(dash)}.`);
  }
  return dash;
}

/** The port shapes of a cable's two ends as root attributes, or none when none is passed. */
function portAttrs(port, who) {
  if (port === undefined) return {};
  const pair = typeof port === 'string' ? { from: port, to: port } : port;
  const ok = pair !== null && typeof pair === 'object'
    && [pair.from, pair.to].every((x) => typeof x === 'string' && PORT_RX.test(x));
  if (!ok) {
    throw new TypeError(`${who}: port must be a shape name or { from, to } of shape names `
      + `(a lowercase word), not ${JSON.stringify(port)}.`);
  }
  return { 'data-port-from': pair.from, 'data-port-to': pair.to };
}

/** One frozen part record. */
const part = (key, tag, parent, attrs) => Object.freeze({ key, tag, parent,
  attrs: Object.freeze(attrs) });
const str = (x) => String(x);

/**
 * One cable as attribute records, for a keyed setAttribute editor (no markup): a frozen list
 * of { key, tag, attrs, parent } in document order, every parent before its children, every
 * attribute value a raw string (unescaped: setAttribute takes it as it is). `key` names the
 * part within its cable and is the same for the same part whatever the cable's ends, zoom or
 * state ('cable', 'shadow', 'main', 'hit', 'stroke', then 'cross', 'cross-under-0',
 * 'cross-under-1', 'cross-0', 'cross-1' when refused, then 'sheen' when asked), so an editor
 * keyed by (cable id, key) updates attributes in place and adds or removes only the cross and
 * the sheen. cableSvg serialises exactly this list, so the two cannot disagree.
 *
 * The parts: a soft shadow (tokens.cable.shadow at the hw-shadow intensity, SHADOW_CLASS,
 * SHADOW_SPREAD wider than the stroke and SHADOW_PX.rest screen px down), then the main stroke
 * group, the only part that takes the pointer (a hit path CABLE_HIT_PX screen px wide at every
 * zoom through vector-effect="non-scaling-stroke", visibility="hidden", which
 * pointer-events="stroke" still hits, and the visible stroke in the caller's colour, dashed by
 * kind), then an optional sheen stripe (tokens.cable.sheen at the hw-sheen intensity; off by
 * default). Hover and selection thicken the stroke; a dashed stroke has butt caps, so its gaps
 * stay open at every width (round caps would close them), and a solid one round caps. Dragging
 * lifts the shadow (SHADOW_PX.lifted down). Refused paints the stroke tokens.jack.refuse,
 * dashed (a solid kind takes REFUSED_DASH), marks the group data-refused and draws a cross on
 * the curve at the target end, CROSS_BACK back from it so it never covers the plug there, so a
 * refusal is a shape, not a colour alone. `zoom` turns the screen-px offsets (the shadow's
 * drop, the sheen's) into graph units; `slack` and `box` are cableCurve's.
 *
 * The signal's look is an input: `dash` (a CABLE_KINDS declaration's pattern, null for solid)
 * wins over CABLE_DASH[type], which is only the default when no dash is passed, and with a dash
 * `type` may name any kind; `port` (a PORT_KINDS shape name, or { from, to }) is recorded on
 * the cable as data-port-from and data-port-to, so the port glyph each end meets is the
 * declared one. Neither passed, the parts are what they were before these inputs existed.
 */
export function cableParts({ id, from, to, type, colour, state = {}, tokens, slack = CABLE_SLACK,
  box, zoom = 1, sheen = false, dash, port } = {}) {
  const who = 'cableParts';
  needTokens(tokens, who);
  const pattern0 = dashOf(type, dash, who);
  const ports = portAttrs(port, who);
  if (!(Number.isFinite(zoom) && zoom > 0)) {
    throw new RangeError(`${who}: zoom must be a finite number above 0, not ${zoom}.`);
  }
  const st = state || {};
  const d = cableCurve(from, to, { slack, box });
  const w = st.selected ? WIDTH.selected : (st.hover ? WIDTH.hover : WIDTH.base);
  const paint = st.refused ? tokens.jack.refuse : (colour || 'currentColor');
  const pattern = st.refused ? (pattern0 || REFUSED_DASH) : pattern0;
  const dashed = pattern ? { 'stroke-dasharray': pattern } : {};
  const cap = pattern ? 'butt' : 'round';
  const drop = num((st.dragging ? SHADOW_PX.lifted : SHADOW_PX.rest) / zoom);
  const off = num(-SHEEN_PX / zoom);
  const parts = [
    part('cable', 'g', null, { 'data-cable': str(id), ...(st.refused ? { 'data-refused': '' }
      : {}), ...ports, 'pointer-events': 'none' }),
    part('shadow', 'path', 'cable', { 'data-shadow': '', class: SHADOW_CLASS, d, fill: 'none',
      stroke: tokens.cable.shadow, 'stroke-width': str(num(w + SHADOW_SPREAD)),
      'stroke-linecap': 'round', transform: `translate(0 ${drop})` }),
    part('main', 'g', 'cable', { 'data-main': '', 'pointer-events': 'stroke' }),
    part('hit', 'path', 'main', { 'data-hit': '', d, fill: 'none', stroke: 'currentColor',
      visibility: 'hidden', 'stroke-width': str(CABLE_HIT_PX),
      'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }),
    part('stroke', 'path', 'main', { 'data-stroke': '', d, fill: 'none', stroke: paint,
      'stroke-width': str(w), 'stroke-linecap': cap, ...dashed }),
  ];
  if (st.refused) {
    const m = nearTarget(from, to, slack, box);
    const r = CROSS.arm;
    const arms = [[m.x - r, m.y - r, m.x + r, m.y + r], [m.x - r, m.y + r, m.x + r, m.y - r]]
      .map((l) => l.map(num));
    const line = (key, [x1, y1, x2, y2], stroke, width) => part(key, 'line', 'cross', {
      x1: str(x1), y1: str(y1), x2: str(x2), y2: str(y2), stroke, 'stroke-width': str(width),
      'stroke-linecap': 'round' });
    parts.push(part('cross', 'g', 'cable', { 'data-cross': '', 'pointer-events': 'none' }),
      ...arms.map((l, i) => line(`cross-under-${i}`, l, tokens.cable.shadow, CROSS.under)),
      ...arms.map((l, i) => line(`cross-${i}`, l, tokens.jack.refuse, CROSS.width)));
  }
  if (sheen) {
    parts.push(part('sheen', 'path', 'cable', { 'data-sheen': '', class: SHEEN_CLASS, d,
      fill: 'none', stroke: tokens.cable.sheen || 'currentColor',
      'stroke-width': str(num(w * 0.3)), 'stroke-linecap': cap, ...dashed,
      transform: `translate(${off} ${off})`, 'pointer-events': 'none' }));
  }
  return Object.freeze(parts);
}

/**
 * Markup from part records (cableParts): each part's attributes in their order, escaped; a
 * part with children opens and closes around them, one without closes itself.
 */
export function partsSvg(parts) {
  const kids = new Map();
  for (const p of parts) {
    if (!kids.has(p.parent)) kids.set(p.parent, []);
    kids.get(p.parent).push(p);
  }
  const one = (p) => {
    const attrs = Object.entries(p.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const inner = kids.get(p.key) || [];
    return inner.length ? `<${p.tag}${attrs}>${inner.map(one).join('')}</${p.tag}>`
      : `<${p.tag}${attrs}/>`;
  };
  return (kids.get(null) || []).map(one).join('');
}

/** One cable as '<g data-cable="id">…</g>': partsSvg(cableParts(spec)), nothing more. */
export function cableSvg(spec = {}) {
  try {
    return partsSvg(cableParts(spec));
  } catch (e) {
    e.message = e.message.replace(/^cableParts:/, 'cableSvg:');
    throw e;
  }
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
