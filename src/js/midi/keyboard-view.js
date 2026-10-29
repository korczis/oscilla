// The on-screen keys of the keyboard (plan issue K026): the geometry, the hit test and the
// drawing on a 2D canvas. The canvas is a domain view (ADR 0061 decision 3): it draws with the
// theme's custom properties and holds no state of its own; src/js/midi/keyboard.js owns what is
// held. The geometry and the hit test are pure; draw() touches only the canvas it is given.

import { isBlack, noteName } from './keyboard.js';

const BLACK_W = 0.6;   // a black key's width, as a fraction of a white key
const BLACK_H = 0.62;  // a black key's height, as a fraction of the keys' height

/**
 * The keys of [first, last] laid out in a box of `width` x `height` (CSS px):
 * [{ note, black, x, y, w, h }], the white keys first (so the black keys draw on top).
 */
export function keyLayout(first, last, width, height) {
  const whites = [];
  for (let n = first; n <= last; n++) if (!isBlack(n)) whites.push(n);
  const ww = width / Math.max(1, whites.length);
  const keys = whites.map((note, i) => ({ note, black: false, x: i * ww, y: 0, w: ww, h: height }));
  for (let n = first; n <= last; n++) {
    if (!isBlack(n)) continue;
    const left = whites.indexOf(n - 1);
    if (left < 0) continue;
    const bw = ww * BLACK_W;
    keys.push({ note: n, black: true, x: (left + 1) * ww - bw / 2, y: 0, w: bw, h: height * BLACK_H });
  }
  return keys;
}

/** The note under the point (x, y) of a layout, black keys first; null outside every key. */
export function noteAt(layout, x, y) {
  const inside = (k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h;
  for (let i = layout.length - 1; i >= 0; i--) {
    if (layout[i].black && inside(layout[i])) return layout[i].note;
  }
  const white = layout.find((k) => !k.black && inside(k));
  return white ? white.note : null;
}

/**
 * The theme's colours, read from the custom properties where the keys are drawn. A white key is
 * lighter than a black key in both themes: raised surface over the inset in the dark theme, the
 * panel surface over the body text colour in the light theme.
 */
export function keyColours(el, doc = el && el.ownerDocument) {
  const cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const v = (name, fallback) => (cs && cs.getPropertyValue(name).trim()) || fallback;
  const light = !!doc && doc.documentElement && doc.documentElement.dataset.theme === 'light';
  return {
    white: light ? v('--osc-surface-1', '#ffffff') : v('--osc-surface-4', '#1b2e42'),
    black: light ? v('--osc-text-2', '#2b3b50') : v('--osc-surface-0', '#020a16'),
    edge: v('--osc-bg', '#020b15'),
    lit: v('--osc-blue', '#007afd'),
    midi: v('--osc-green', '#34db7b'),
    label: v('--osc-text-muted', '#94a9bd'),
    blackLabel: light ? v('--osc-surface-4', '#d9e1ec') : v('--osc-text-muted', '#94a9bd'),
    onLit: v('--osc-text-on-accent', '#ffffff'),
    font: v('--osc-font', 'system-ui, sans-serif'),
  };
}

/**
 * Draw the keys on `ctx` (a 2D context already scaled to CSS px). state: { first, last,
 * width, height, lit(note) -> sources[] | null, label(note) -> string | null, colours }.
 * A note lit only by MIDI is drawn in the MIDI colour, any other lit note in the accent.
 */
export function drawKeys(ctx, state) {
  const { first, last, width, height, colours: c } = state;
  const layout = keyLayout(first, last, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const k of layout) {
    const sources = state.lit(k.note);
    const fill = !sources ? (k.black ? c.black : c.white)
      : sources.every((s) => s === 'midi') ? c.midi : c.lit;
    ctx.fillStyle = fill;
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1;
    ctx.fillRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1);
    ctx.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1);
    const text = sources ? c.onLit : (k.black ? c.blackLabel : c.label);
    const size = Math.max(8, Math.min(12, Math.floor(k.w * 0.42)));
    ctx.fillStyle = text;
    const letter = state.label(k.note);
    if (letter) {
      ctx.font = `600 ${size}px ${c.font}`;
      ctx.fillText(letter, k.x + k.w / 2, k.y + k.h - (k.black ? 8 : 22));
    }
    if (!k.black && k.note % 12 === 0) {
      ctx.font = `${Math.max(8, size - 2)}px ${c.font}`;
      ctx.fillText(noteName(k.note), k.x + k.w / 2, k.y + k.h - 7);
    }
  }
  return layout;
}
