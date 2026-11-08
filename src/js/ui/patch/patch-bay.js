// The patch bay (B2): one SVG with every jack of a set of modules grouped by module, and the
// user's cables drawn inside it with sag and a soft shadow, so they stay right however the
// modules stack on a phone. The jacks, cables and plugs are the synth-theme layer's
// (ui/synth/jack.js, ui/synth/cable.js; F013 W1), so the bay carries no drawing of its own.
// Generic over any source of typed ports: the Synth panel
// (synth/view/bay.js) is one adapter, and a Studio node's ports can be another. Jack shapes are
// the Studio's PORT_VISUALS (audio circle, control diamond, trigger triangle); the cable pattern
// follows the signal type, its colour the source module (never colour alone). Pure markup and
// geometry; the caller wires the events.
//
//   source = { groups: [{ id, label, jacks: [jack] }], nameOf(groupId) -> label }
//     jack = { key, label, type: 'AUDIO' | 'CONTROL' | 'TRIGGER', direction: 'in' | 'out',
//              module: groupId }
//   patchLayout(source, width) -> { jacks: Map<jack key, { x, y, jack }>, groups, width, height }
//   cablePath(a, b) -> the layer's hanging cable (cableCurve), the live cable while dragging
//   patchSvg({ source, layout, cables, states, pending, compatible, verdicts, tokens, selected })
//   portLabel(source, jack, state, verdict) -> the jack's accessible name
//
// ui-family: patch-bay model

import { PORT_VISUALS } from '../../studio/ports.js';
import { esc } from '../../synth/view/face.js';
import { JACK_HIT, jackSvg, layerTokens, nutSvg, patchCord } from '../synth/jack.js';
import { cableCurve } from '../synth/cable.js';

export { JACK_HIT };

export const JACK_PITCH = 52;
/** Row pitch: a jack, its label below it, and air. */
export const ROW_PITCH = 62;
const LABEL_H = 18;
/** The bay's text in user units, drawn 1:1 (the SVG is as wide as its box): 12 px, the
 *  smallest text a phone shows (V634, criterion ui-current#phone-whole). */
export const BAY_TEXT = 12;
/** The widest jack label that fits its 52 px pitch at BAY_TEXT, counted with an output's " ▸":
 *  a word a panel abbreviates is printed so (LABEL_ABBREV, as hardware prints VEL, MOD, CV);
 *  longer labels keep their head and end in an ellipsis; the jack's accessible name carries the
 *  whole label. */
export const LABEL_MAX = 8;
export const LABEL_ABBREV = Object.freeze({ Velocity: 'Vel', Modulator: 'Mod', Control: 'CV',
  Frequency: 'Freq', Resonance: 'Res', Envelope: 'Env', Modulation: 'Mod' });
export function shortLabel(label, direction = 'in') {
  const s = String(label).replace(/[A-Z][a-z]+/g, (w) => LABEL_ABBREV[w] || w);
  const room = direction === 'out' ? LABEL_MAX - 2 : LABEL_MAX;
  const text = s.length > room ? `${s.slice(0, room - 1)}…` : s;
  return direction === 'out' ? `${text} ▸` : text;
}
/** A full-length label is held to its pitch whatever the engine's font metrics (Firefox draws
 *  wider than Chromium); a shorter one keeps its natural width. */
const labelFit = (text) => (text.length >= LABEL_MAX
  ? ` textLength="${JACK_PITCH - 6}" lengthAdjust="spacingAndGlyphs"` : '');
const GAP = 12;
const PAD = 8;

export const cablePath = (a, b) => cableCurve(a, b);

export function patchLayout(source, width) {
  const w = Math.max(4 * JACK_PITCH + 2 * PAD, width);
  const cols = Math.max(4, Math.floor((w - 2 * PAD) / JACK_PITCH));
  // Rows of plates as a hardware rack (p2's W1b review, V6): modules pack into rows in panel
  // order, then each row spreads its plates to the bay's full width (the slack shared equally,
  // the jacks centred on their plate) and every plate of a row takes the row's height.
  const rows = [];
  let row = null;
  for (const m of source.groups) {
    if (!m.jacks.length) continue;
    const n = Math.min(cols, m.jacks.length);
    const spec = { m, n, gw: n * JACK_PITCH,
      gh: LABEL_H + Math.ceil(m.jacks.length / cols) * ROW_PITCH };
    const used = row ? row.reduce((a, r) => a + r.gw + GAP, 0) : 0;
    if (!row || used + spec.gw > w - 2 * PAD) rows.push(row = []);
    row.push(spec);
  }
  const jacks = new Map();
  const groups = [];
  let y = PAD;
  for (const r of rows) {
    const slack = (w - 2 * PAD) - r.reduce((a, g) => a + g.gw, 0) - GAP * (r.length - 1);
    const extra = Math.max(0, slack) / r.length;
    const rowH = Math.max(...r.map((g) => g.gh));
    let x = PAD;
    for (const { m, gw } of r) {
      const pw = gw + extra;
      groups.push({ module: m.id, label: m.label, x, y, w: pw, h: rowH });
      const inset = x + (pw - gw) / 2;
      m.jacks.forEach((jk, i) => {
        jacks.set(jk.key, { x: inset + (i % cols) * JACK_PITCH + JACK_PITCH / 2,
          y: y + LABEL_H + Math.floor(i / cols) * ROW_PITCH + JACK_HIT / 2 + 2, jack: jk });
      });
      x += pw + GAP;
    }
    y += rowH + GAP;
  }
  return { jacks, groups, width: w, height: (rows.length ? y - GAP : y) + PAD };
}


const STATE_LABEL = { open: 'open: normal removed in Studio',
  mixed: 'patched in Studio while its normal still sounds',
  summing: 'normalled, plus a performance cable' };

/**
 * The accessible name of a jack: module, label, direction, signal type, its state and, while a
 * connection is pending, whether it can take the cable (with the refusal's sentence). `plus`
 * names what a summing jack's performance cable comes from ("normalled, plus XY PAD Y").
 */
export function portLabel(source, j, st, verdict = null, plus = null) {
  const state = st === 'summing' && plus ? `normalled, plus ${plus}` : STATE_LABEL[st] || st;
  const base = `${source.nameOf(j.module)} ${j.label} ${j.direction === 'in' ? 'input'
    : 'output'}, ${PORT_VISUALS[j.type].noun}${st === 'free' ? '' : `, ${state}`}`;
  if (!verdict) return base;
  return verdict.ok ? `${base}, can take the cable` : `${base}, refused: ${verdict.reason}`;
}

/**
 * state: 'normalled' | 'summing' | 'patched' | 'mixed' | 'open' | 'free' (normals.js
 * jackState). A summing jack (K183: a performance cable adds to its sounding normals) keeps the
 * normal's inner glyph and takes its cable's colour on the ring: both sources show at once.
 * verdicts: Map<jack key, { ok, reason }> while a connection is pending (ui.js).
 * Every shape sets its own stroke: an inherited `svg { stroke }` of the legacy stylesheet must
 * never draw on the panel. A jack shows keyboard focus with its own ring (group-focus-visible).
 */
/** The cable types the layer draws with their own dash (CABLE_DASH); any other draws solid. */
const DASHED = Object.freeze({ AUDIO: 1, CONTROL: 1, TRIGGER: 1, ANALYSIS: 1 });

export function patchSvg({ source, layout, cables = [], states = new Map(), pending = null,
  compatible = new Set(), verdicts = new Map(), tokens: t, selected = null }) {
  const order = source.groups.map((m) => m.id);
  const colourOf = (module) => t.cables[Math.max(0, order.indexOf(module)) % t.cables.length];
  // A patched input shows its cable's colour, the source module's (as the cable does).
  const feeders = new Map(cables.map((c) => [`${c.to}:in`, c.fromModule]));
  const feederOf = (key) => feeders.get(key) || null;
  // What a summing jack's cables come from, by name, each module once ("XY PAD X and Y").
  const outLabel = new Map(source.groups.flatMap((g) => g.jacks).map((x) => [x.key, x.label]));
  const plusOf = (key) => {
    const by = new Map();
    const at = (c) => [...outLabel.keys()].indexOf(`${c.from}:out`); // in panel order
    for (const c of cables.filter((x) => `${x.to}:in` === key).sort((p, q) => at(p) - at(q))) {
      if (!by.has(c.fromModule)) by.set(c.fromModule, []);
      by.get(c.fromModule).push(outLabel.get(`${c.from}:out`) || c.from);
    }
    const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
      : xs[0]);
    return by.size ? and([...by].map(([m, js]) => `${source.nameOf(m)} ${and(js)}`)) : null;
  };
  // Each module is a plate, a tonal gradient between two OSCILLA tokens; its label is the group
  // text below. Layers, bottom up: plates, labels, nuts, cables, jacks (on top of the cables'
  // hit paths, so a tap on a jack is the jack's), plugs (no pointer).
  const plates = layout.groups.map((g) => `<rect x="${g.x - 4}" y="${g.y - 3}" `
    + `width="${g.w + 8}" height="${g.h + 4}" rx="8" fill="url(#bay-plate)" `
    + `stroke="${t.track}" stroke-width="1" data-plate="${esc(g.module)}"/>`).join('');
  const plateFill = '<defs><linearGradient id="bay-plate" x1="0" y1="0" x2="0" y2="1">'
    + `<stop offset="0" stop-color="${t.plateHi}"/><stop offset="1" stop-color="${t.plateLo}"/>`
    + '</linearGradient></defs>';
  // A module's title stays on its plate: one too wide for a narrow plate (OUTPUT over one jack)
  // is held to the plate's width (p2's W1b review, V4).
  const groups = layout.groups.map((g) => `<text x="${g.x + 2}" y="${g.y + 12}" `
    + `font-size="${BAY_TEXT}" font-weight="700" letter-spacing="1" stroke="none" `
    + `fill="${t.label}"${String(g.label).length * 9.5 > g.w ? ` textLength="${g.w}" `
      + 'lengthAdjust="spacingAndGlyphs"' : ''}>${esc(g.label)}`
    + '</text>').join('');
  const nuts = [...layout.jacks.values()].map(({ x, y }) => nutSvg({ x, y, tokens: t }))
    .join('');
  const jacks = [...layout.jacks.values()].map(({ x, y, jack: j }) => {
    const st = states.get(j.key) || 'free';
    const src = j.direction === 'out' ? j.module : feederOf(j.key);
    const ring = pending === j.key ? t.focus : compatible.has(j.key) ? t.accent
      : st === 'open' || st === 'mixed' ? t.refuse
        : st === 'summing' ? colourOf(src || j.module) : t.jackRing;
    const text = shortLabel(j.label, j.direction);
    return jackSvg({ key: j.key, x, y, shape: PORT_VISUALS[j.type].shape, tokens: t,
      label: portLabel(source, j, st, pending && pending !== j.key ? verdicts.get(j.key) : null,
        st === 'summing' ? plusOf(j.key) : null),
      pressed: pending === j.key, ring, dashed: st === 'open' || st === 'mixed',
      ringWidth: pending === j.key || compatible.has(j.key) ? 3.5 : 2,
      inner: st === 'patched' || st === 'mixed' ? colourOf(src || j.module)
        : st === 'normalled' || st === 'summing' ? t.normal : t.jack,
      text, fit: labelFit(text), textSize: BAY_TEXT });
  }).join('');
  // A cord hangs inside the bay (box) as the layer draws it, a plug on each end over its jack;
  // the plugs take no pointer, so the jack below still does.
  const th = layerTokens(t);
  const box = { x: 0, y: 0, width: layout.width, height: layout.height };
  const ends = [];
  const wires = cables.map((c) => {
    const a = layout.jacks.get(`${c.from}:out`);
    const b = layout.jacks.get(`${c.to}:in`);
    if (!a || !b) return '';
    const cord = patchCord({ id: c.id, from: a, to: b, type: c.type in DASHED ? c.type : 'AUDIO',
      colour: colourOf(c.fromModule), selected: selected === c.id, tokens: th, box });
    ends.push(cord.plugs);
    return cord.cable;
  }).join('');
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="100%" `
    + `height="${layout.height}" data-osc="synth.bay.svg" data-ui-family="patch-bay" role="group" `
    + `aria-label="Patch bay: ${layout.jacks.size} jacks, ${cables.length} cables">`
    + `${plateFill}<g data-layer="plates" pointer-events="none">${plates}</g>`
    + `${groups}<g data-layer="nuts" pointer-events="none">${nuts}</g>`
    + `<g data-layer="cables">${wires}</g><g data-layer="jacks">${jacks}</g>`
    + `<g data-layer="plugs" pointer-events="none">${ends.join('')}</g>`
    + '<path data-live-cable="" d="" fill="none" '
    + `stroke="${t.focus}" stroke-width="4" stroke-linecap="round" pointer-events="none"/></svg>`;
}
