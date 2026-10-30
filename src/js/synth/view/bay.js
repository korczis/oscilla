// The Synth patch bay (plan K063; design §3, §5): one SVG with every jack of the panel grouped by
// module, and the user's cables drawn inside it with sag and a soft shadow, so they stay right
// however the module plates stack on a phone. Jack shapes are the Studio's PORT_VISUALS (audio
// circle, control diamond, trigger triangle); the cable pattern follows the signal type, its
// colour the source module (never colour alone). Pure markup and geometry; ui.js wires it.
//
//   bayLayout(panel, width) -> { jacks: Map<jack key, { x, y, jack }>, groups, width, height }
//   cablePath(a, b) -> SVG path of a hanging cable;  sagOf(a, b) = min(80, 0.25 · distance)
//   baySvg({ panel, layout, cables, states, pending, compatible, tokens, selected }) -> markup

import { PORT_VISUALS } from '../../studio/ports.js';
import { esc } from './face.js';

export const JACK_PITCH = 52;
/** Row pitch: a jack, its label below it, and air. */
export const ROW_PITCH = 62;
export const JACK_HIT = 44;
const LABEL_H = 18;
const GAP = 12;
const PAD = 8;

export const sagOf = (a, b) => Math.min(80, 0.25 * Math.hypot(b.x - a.x, b.y - a.y));

export function cablePath(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sagOf(a, b);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} `
    + `${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function bayLayout(panel, width) {
  const w = Math.max(4 * JACK_PITCH + 2 * PAD, width);
  const cols = Math.max(4, Math.floor((w - 2 * PAD) / JACK_PITCH));
  const jacks = new Map();
  const groups = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const m of panel.modules) {
    const list = panel.jacksOf(m.id);
    if (!list.length) continue;
    const n = Math.min(cols, list.length);
    const rows = Math.ceil(list.length / cols);
    const gw = n * JACK_PITCH;
    const gh = LABEL_H + rows * ROW_PITCH;
    if (x > PAD && x + gw > w - PAD) {
      x = PAD;
      y += rowH + GAP;
      rowH = 0;
    }
    groups.push({ module: m.id, label: m.label, x, y, w: gw, h: gh });
    list.forEach((j, i) => {
      jacks.set(j.key, { x: x + (i % cols) * JACK_PITCH + JACK_PITCH / 2,
        y: y + LABEL_H + Math.floor(i / cols) * ROW_PITCH + JACK_HIT / 2 + 2, jack: j });
    });
    x += gw + GAP;
    rowH = Math.max(rowH, gh);
  }
  return { jacks, groups, width: w, height: y + rowH + PAD };
}

function glyph(shape, x, y, r) {
  if (shape === 'diamond') {
    return `<path d="M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z"`;
  }
  if (shape === 'triangle') {
    return `<path d="M ${x} ${y - r} L ${x + r * 0.95} ${y + r * 0.7} L ${x - r * 0.95} `
      + `${y + r * 0.7} Z"`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}"`;
}

/** state: 'normalled' | 'patched' | 'open' | 'free' (normals.js jackState). */
export function baySvg({ panel, layout, cables = [], states = new Map(), pending = null,
  compatible = new Set(), tokens: t, selected = null }) {
  const colourOf = (module) => t.cables[Math.max(0, panel.modules.findIndex((m) => m.id
    === module)) % t.cables.length];
  const groups = layout.groups.map((g) => `<text x="${g.x + 2}" y="${g.y + 12}" `
    + `font-size="10" font-weight="700" letter-spacing="1" stroke="none" `
    + `fill="${t.label}">${esc(g.label)}`
    + '</text>').join('');
  const jacks = [...layout.jacks.values()].map(({ x, y, jack: j }) => {
    const shape = PORT_VISUALS[j.type].shape;
    const st = states.get(j.key) || 'free';
    const ring = pending === j.key ? t.focus : compatible.has(j.key) ? t.accent
      : st === 'open' ? t.refuse : t.jackRing;
    const label = `${panel.module(j.module).label} ${j.label} ${j.direction === 'in' ? 'input'
      : 'output'}, ${PORT_VISUALS[j.type].noun}${st === 'free' ? '' : `, ${st === 'open'
      ? 'open: normal removed in Studio' : st}`}`;
    const inner = st === 'patched' ? colourOf(j.module) : st === 'normalled' ? t.normal : t.jack;
    return `<g role="button" tabindex="0" data-jack="${j.key}" aria-label="${esc(label)}" `
      + `aria-pressed="${pending === j.key}" class="cursor-pointer outline-none">`
      + `<rect x="${x - JACK_HIT / 2}" y="${y - JACK_HIT / 2}" width="${JACK_HIT}" `
      + `height="${JACK_HIT}" rx="10" fill="${t.jack}" fill-opacity="0.001"/>`
      + `${glyph(shape, x, y, 13)} fill="${t.jack}" stroke="${ring}" stroke-width="`
      + `${pending === j.key || compatible.has(j.key) ? 3.5 : 2}"`
      + `${st === 'open' ? ' stroke-dasharray="3 3"' : ''}/>`
      + `${glyph(shape, x, y, 5)} fill="${inner}"/>`
      + `<text x="${x}" y="${y + 33}" font-size="10" text-anchor="middle" stroke="none" `
      + `fill="${t.label}">`
      + `${esc(j.label.length > 9 ? `${j.label.slice(0, 8)}…` : j.label)}${j.direction === 'out'
        ? ' ▸' : ''}</text></g>`;
  }).join('');
  const dash = { CONTROL: ' stroke-dasharray="9 6"', TRIGGER: ' stroke-dasharray="2 6"',
    AUDIO: '' };
  const wires = cables.map((c) => {
    const a = layout.jacks.get(`${c.from}:out`);
    const b = layout.jacks.get(`${c.to}:in`);
    if (!a || !b) return '';
    const d = cablePath(a, b);
    const on = selected === c.id;
    return `<g data-cable="${esc(c.id)}" class="cursor-pointer">`
      + `<path d="${d}" fill="none" stroke="${t.edge}" stroke-opacity="0.45" stroke-width="7" `
      + 'transform="translate(0 3)" stroke-linecap="round"/>'
      + `<path d="${d}" fill="none" stroke="${colourOf(c.fromModule)}" stroke-width="`
      + `${on ? 7 : 4.5}" stroke-linecap="round"${dash[c.type] || ''}/></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="100%" `
    + `height="${layout.height}" data-osc="synth.bay.svg" role="group" `
    + `aria-label="Patch bay: ${layout.jacks.size} jacks, ${cables.length} cables">`
    + `${groups}<g data-layer="cables" pointer-events="stroke">${wires}</g>`
    + `<g data-layer="jacks">${jacks}</g><path data-live-cable="" d="" fill="none" `
    + `stroke="${t.focus}" stroke-width="4" stroke-linecap="round" pointer-events="none"/></svg>`;
}
