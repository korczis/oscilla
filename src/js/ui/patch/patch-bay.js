// The patch bay (B2): one SVG with every jack of a set of modules grouped by module, and the
// user's cables drawn inside it with sag and a soft shadow, so they stay right however the
// modules stack on a phone. Generic over any source of typed ports: the Synth panel
// (synth/view/bay.js) is one adapter, and a Studio node's ports can be another. Jack shapes are
// the Studio's PORT_VISUALS (audio circle, control diamond, trigger triangle); the cable pattern
// follows the signal type, its colour the source module (never colour alone). Pure markup and
// geometry; the caller wires the events.
//
//   source = { groups: [{ id, label, jacks: [jack] }], nameOf(groupId) -> label }
//     jack = { key, label, type: 'AUDIO' | 'CONTROL' | 'TRIGGER', direction: 'in' | 'out',
//              module: groupId }
//   patchLayout(source, width) -> { jacks: Map<jack key, { x, y, jack }>, groups, width, height }
//   cablePath(a, b) -> SVG path of a hanging cable;  sagOf(a, b) = min(80, 0.25 · distance)
//   patchSvg({ source, layout, cables, states, pending, compatible, verdicts, tokens, selected })
//   portLabel(source, jack, state, verdict) -> the jack's accessible name

import { PORT_VISUALS } from '../../studio/ports.js';
import { esc } from '../../synth/view/face.js';

export const JACK_PITCH = 52;
/** Row pitch: a jack, its label below it, and air. */
export const ROW_PITCH = 62;
export const JACK_HIT = 44;
const LABEL_H = 18;
/** The bay's text in user units, drawn 1:1 (the SVG is as wide as its box): 12 px, the
 *  smallest text a phone shows (V634, criterion ui-current#phone-whole). */
export const BAY_TEXT = 12;
/** The widest jack label that fits its 52 px pitch at BAY_TEXT, counted with an output's " ▸":
 *  longer labels keep their head and end in an ellipsis; the jack's accessible name carries the
 *  whole label. */
export const LABEL_MAX = 8;
export function shortLabel(label, direction = 'in') {
  const s = String(label);
  const room = direction === 'out' ? LABEL_MAX - 2 : LABEL_MAX;
  const text = s.length > room ? `${s.slice(0, room - 1)}…` : s;
  return direction === 'out' ? `${text} ▸` : text;
}
const GAP = 12;
const PAD = 8;

export const sagOf = (a, b) => Math.min(80, 0.25 * Math.hypot(b.x - a.x, b.y - a.y));

export function cablePath(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sagOf(a, b);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} `
    + `${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function patchLayout(source, width) {
  const w = Math.max(4 * JACK_PITCH + 2 * PAD, width);
  const cols = Math.max(4, Math.floor((w - 2 * PAD) / JACK_PITCH));
  const jacks = new Map();
  const groups = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const m of source.groups) {
    const list = m.jacks;
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
  if (shape === 'square') {
    return `<rect x="${x - r * 0.8}" y="${y - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}"`;
  }
  return `<circle cx="${x}" cy="${y}" r="${r}"`;
}

const STATE_LABEL = { open: 'open: normal removed in Studio',
  mixed: 'patched in Studio while its normal still sounds' };

/**
 * The accessible name of a jack: module, label, direction, signal type, its state and, while a
 * connection is pending, whether it can take the cable (with the refusal's sentence).
 */
export function portLabel(source, j, st, verdict = null) {
  const base = `${source.nameOf(j.module)} ${j.label} ${j.direction === 'in' ? 'input'
    : 'output'}, ${PORT_VISUALS[j.type].noun}${st === 'free' ? '' : `, ${STATE_LABEL[st] || st}`}`;
  if (!verdict) return base;
  return verdict.ok ? `${base}, can take the cable` : `${base}, refused: ${verdict.reason}`;
}

/**
 * state: 'normalled' | 'patched' | 'mixed' | 'open' | 'free' (normals.js jackState).
 * verdicts: Map<jack key, { ok, reason }> while a connection is pending (ui.js).
 * Every shape sets its own stroke: an inherited `svg { stroke }` of the legacy stylesheet must
 * never draw on the panel. A jack shows keyboard focus with its own ring (group-focus-visible).
 */
export function patchSvg({ source, layout, cables = [], states = new Map(), pending = null,
  compatible = new Set(), verdicts = new Map(), tokens: t, selected = null }) {
  const order = source.groups.map((m) => m.id);
  const colourOf = (module) => t.cables[Math.max(0, order.indexOf(module)) % t.cables.length];
  // A patched input shows its cable's colour, the source module's (as the cable does).
  const feeders = new Map(cables.map((c) => [`${c.to}:in`, c.fromModule]));
  const feederOf = (key) => feeders.get(key) || null;
  const groups = layout.groups.map((g) => `<text x="${g.x + 2}" y="${g.y + 12}" `
    + `font-size="${BAY_TEXT}" font-weight="700" letter-spacing="1" stroke="none" `
    + `fill="${t.label}">${esc(g.label)}`
    + '</text>').join('');
  const jacks = [...layout.jacks.values()].map(({ x, y, jack: j }) => {
    const shape = PORT_VISUALS[j.type].shape;
    const st = states.get(j.key) || 'free';
    const ring = pending === j.key ? t.focus : compatible.has(j.key) ? t.accent
      : st === 'open' || st === 'mixed' ? t.refuse : t.jackRing;
    const label = portLabel(source, j, st, pending && pending !== j.key ? verdicts.get(j.key)
      : null);
    const src = j.direction === 'out' ? j.module : feederOf(j.key);
    const inner = st === 'patched' || st === 'mixed' ? colourOf(src || j.module)
      : st === 'normalled' ? t.normal : t.jack;
    return `<g role="button" tabindex="0" data-jack="${j.key}" aria-label="${esc(label)}" `
      + `aria-pressed="${pending === j.key}" class="group cursor-pointer outline-none">`
      + `<rect x="${x - JACK_HIT / 2}" y="${y - JACK_HIT / 2}" width="${JACK_HIT}" `
      + `height="${JACK_HIT}" rx="10" fill="${t.jack}" fill-opacity="0.001" stroke="none"/>`
      + `<rect data-focus-ring="" x="${x - JACK_HIT / 2 + 1.5}" y="${y - JACK_HIT / 2 + 1.5}" `
      + `width="${JACK_HIT - 3}" height="${JACK_HIT - 3}" rx="9" fill="none" `
      + `stroke="${t.focus}" stroke-width="3" class="opacity-0 group-focus-visible:opacity-100"/>`
      + `${glyph(shape, x, y, 13)} fill="${t.jack}" stroke="${ring}" stroke-width="`
      + `${pending === j.key || compatible.has(j.key) ? 3.5 : 2}"`
      + `${st === 'open' || st === 'mixed' ? ' stroke-dasharray="3 3"' : ''}/>`
      + `${glyph(shape, x, y, 5)} fill="${inner}" stroke="none"/>`
      + `<text x="${x}" y="${y + 34}" font-size="${BAY_TEXT}" text-anchor="middle" stroke="none" `
      + `fill="${t.label}">`
      + `${esc(shortLabel(j.label, j.direction))}</text></g>`;
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
