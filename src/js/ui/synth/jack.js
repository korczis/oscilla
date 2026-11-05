// The synth-theme layer's jack (plan F013, W1): one patch point as an old-school modular draws
// it (project.visual-identity-lock v4, Q071), from tokens only. A jack keeps its typed shape
// (PORT_VISUALS: circle audio, diamond control, triangle trigger, square analysis), so the type
// never reads by colour alone; the hardware is what sits around it:
//   - a hexagonal nut under the socket, in its own layer below every jack (nutSvg), taking no
//     pointer;
//   - the socket: the typed ring (data-ring, the stroke the 3:1 check reads) and its inner glyph
//     in the state's colour;
//   - a 44 px hit square, hidden (visibility="hidden" pointer-events="all") rather than painted
//     transparent, and a focus ring shown only on keyboard focus; the jack takes its touches
//     (touch-none), so a drag from it draws a cable instead of scrolling the page.
// Every shape sets its own stroke, so an inherited `svg { stroke }` never draws on the bay.
//
//   portGlyph(shape, x, y, r) -> the opening of the shape's element (the caller closes it)
//   nutSvg({ x, y, tokens }) -> one nut
//   jackSvg({ key, x, y, shape, label, pressed, ring, ringWidth, dashed, inner, text, fit,
//     tokens }) -> '<g role="button" data-jack="key">…</g>'
//   layerTokens(t) -> the token set of ui/synth/cable.js from the panel's (synth/view/tokens.js),
//     its depth roles (shade, highlight) included, so the bay's cords are lit as the layer's
//   patchCord({ id, from, to, type, colour, selected, tokens, box, rings }) -> { cable, plugs }:
//     a patch cord as the layer draws it (cable.js cableSvg with its sheen, a plug on each end,
//     each carrying its jack's state ring when `rings` names one: a plug covers the jack's own)

/** The hit square's side, px: the touch target (WCAG 2.5.5). */
export const JACK_HIT = 44;
/** The socket ring's radius and the inner glyph's, graph units. */
export const JACK_R = 13;
const INNER_R = 5;
/** The nut's circumradius: a hexagon just outside the socket ring. */
const NUT_R = 17;

import { cableDirections, cableSvg, plugSvg } from './cable.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (v) => Math.round(v * 100) / 100;

export function portGlyph(shape, x, y, r) {
  if (shape === 'diamond') {
    return `<path d="M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z"`;
  }
  if (shape === 'triangle') {
    return `<path d="M ${x} ${y - r} L ${x + r * 0.95} ${y + r * 0.7} L ${x - r * 0.95} `
      + `${y + r * 0.7} Z"`;
  }
  if (shape === 'square') {
    return `<rect x="${x - r * 0.8}" y="${y - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}"`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}"`;
}

/** A hexagonal nut centred on the jack, flat side up. */
export function nutSvg({ x, y, tokens: t }) {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return `${n2(x + NUT_R * Math.cos(a))} ${n2(y + NUT_R * Math.sin(a))}`;
  });
  return `<path data-nut="" d="M ${pts.join(' L ')} Z" fill="${t.capHi}" stroke="${t.track}" `
    + 'stroke-width="1"/>';
}

export function jackSvg({ key, x, y, shape, label, pressed = false, ring, ringWidth = 2,
  dashed = false, inner, text, fit = '', textSize, tokens: t }) {
  const h = JACK_HIT / 2;
  return `<g role="button" tabindex="0" data-jack="${key}" aria-label="${esc(label)}" `
    + `aria-pressed="${pressed}" class="group cursor-pointer touch-none outline-none">`
    + `<rect data-hit="" x="${x - h}" y="${y - h}" width="${JACK_HIT}" height="${JACK_HIT}" `
    + 'rx="10" fill="currentColor" stroke="none" visibility="hidden" pointer-events="all"/>'
    + `<rect data-focus-ring="" x="${x - h + 1.5}" y="${y - h + 1.5}" width="${JACK_HIT - 3}" `
    + `height="${JACK_HIT - 3}" rx="9" fill="none" stroke="${t.focus}" stroke-width="3" `
    + 'class="opacity-0 group-focus-visible:opacity-100"/>'
    + `${portGlyph(shape, x, y, JACK_R)} data-ring="" fill="${t.jack}" stroke="${ring}" `
    + `stroke-width="${ringWidth}"${dashed ? ' stroke-dasharray="3 3"' : ''}/>`
    + `${portGlyph(shape, x, y, INNER_R)} fill="${inner}" stroke="none"/>`
    + `<text x="${x}" y="${y + 34}" font-size="${textSize}" text-anchor="middle" stroke="none" `
    + `fill="${t.label}"${fit}>${esc(text)}</text></g>`;
}

/** The cable and plug token set (ui/synth/tokens.js shape) from the panel's token values. */
export function layerTokens(t) {
  const out = { jack: { body: t.jack, ring: t.jackRing, normal: t.normal, refuse: t.refuse },
    cable: { palette: t.cables, shadow: t.edge, sheen: t.text }, surface: { edge: t.edge } };
  const control = {};
  if (t.shade) control.shade = t.shade;
  if (t.highlight) control.highlight = t.highlight;
  return Object.keys(control).length ? { ...out, control } : out;
}

export function patchCord({ id, from, to, type, colour, selected = false, tokens, box,
  rings = {} }) {
  if (rings === null || typeof rings !== 'object') {
    throw new TypeError('patchCord: rings must be { from, to }, each jack\'s ring or none.');
  }
  // Each plug's boot leaves the way its cord does (JC-3): the plug covers the socket, so it
  // carries the socket's state ring (a pending or a compatible jack) round its boot.
  const dirs = cableDirections(from, to, { box });
  return { cable: cableSvg({ id, from, to, type, colour, state: { selected }, tokens, box,
    sheen: true }),
  plugs: plugSvg({ at: from, colour, tokens, direction: dirs.from, ring: rings.from })
    + plugSvg({ at: to, colour, tokens, direction: dirs.to, ring: rings.to }) };
}
