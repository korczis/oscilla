// Compact Signal Path layout (spec §128, §150, §197): the compact widget draws the SAME graph as
// the full editor with a simplified, automatic layout; the full Studio keeps the authored
// positions (same topology, different projection). Pure and deterministic: no randomness, ties
// broken by model order. Never writes positions into the model (§150: auto layout never moves
// a user graph without an explicit action).
//
//   compactLayout(model, opts) -> { columns, nodes: [{ id, col, row }], links: [{ id, from, to,
//     type }], width: columns, height: rows }
//
// Columns are the longest path from a node without inputs over AUDIO, CONTROL and TRIGGER edges
// (ANALYSIS data edges too: measurement chains read left to right); the model is always acyclic
// (validate.js), so the longest path exists. Rows inside a column follow the model order, with a
// node placed on the row of its first upstream neighbour when that row is free, which keeps a
// straight chain (OSC → ENV → FILTER → OUT) on one row.

import { NODE_REGISTRY } from '../../studio/registry.js';
import {
  COARSE_FIT_MIN_ZOOM, FIT_MAX_ZOOM, FIT_PADDING_PX, NODE_WIDTH, snap,
} from './graph-geometry.js';

export function compactLayout(model, { registry = NODE_REGISTRY } = {}) {
  const nodes = model.graph.nodes;
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const links = [];
  for (const e of model.graph.edges) {
    if (!order.has(e.from.node) || !order.has(e.to.node)) continue;
    incoming.get(e.to.node).push(e.from.node);
    outgoing.get(e.from.node).push(e.to.node);
    const a = nodes[order.get(e.from.node)];
    const port = registry.port(a.type, e.from.port, 'out');
    links.push({ id: e.id, from: e.from.node, to: e.to.node, type: port ? port.type : 'AUDIO',
      muted: !!(e.props && e.props.muted) });
  }
  // Longest path depth (Kahn order; ties in model order).
  const indeg = new Map(nodes.map((n) => [n.id, incoming.get(n.id).length]));
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const seen = new Set();
  while (queue.length) {
    queue.sort((x, y) => order.get(x) - order.get(y));
    const id = queue.shift();
    seen.add(id);
    for (const t of outgoing.get(id)) {
      depth.set(t, Math.max(depth.get(t), depth.get(id) + 1));
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  // A cyclic remainder cannot occur in a valid model; keep such nodes in column 0 anyway.
  for (const n of nodes) if (!seen.has(n.id)) depth.set(n.id, 0);
  const columns = nodes.length ? Math.max(...nodes.map((n) => depth.get(n.id))) + 1 : 0;
  const rowOf = new Map();
  const used = Array.from({ length: columns }, () => new Set());
  const byColumn = Array.from({ length: columns }, () => []);
  for (const n of nodes) byColumn[depth.get(n.id)].push(n.id);
  for (let c = 0; c < columns; c++) {
    for (const id of byColumn[c]) {
      const ups = incoming.get(id).filter((u) => rowOf.has(u))
        .sort((x, y) => order.get(x) - order.get(y));
      let row = ups.length ? rowOf.get(ups[0]) : 0;
      while (used[c].has(row)) row++;
      used[c].add(row);
      rowOf.set(id, row);
    }
  }
  const rows = nodes.length ? Math.max(...nodes.map((n) => rowOf.get(n.id))) + 1 : 0;
  return {
    columns,
    rows,
    nodes: nodes.map((n) => ({ id: n.id, col: depth.get(n.id), row: rowOf.get(n.id) })),
    links,
  };
}

// ------------------------------------------------------------------ Tidy (L): layered layout
// Plan V637, ADR 0087. The whole-graph Tidy of the editor (L): a layered (Sugiyama) layout of
// the real cards, left to right, with the fewest cable crossings it finds, and on a viewport
// too narrow for it a wrap into rows. Pure and deterministic (ties in model order); it returns
// positions and never writes them: the editor applies them as one NODE_MOVE gesture, on the
// explicit L only (§150). Positions are PRESENTATION state, so a Tidy never changes studioHash.
//
//   tidyLayout(model, viewport, { registry, geometry, minZoom }) -> { positions, rows, zoom }
//     viewport  { w, h } px of the graph viewport, or null (then no wrap)
//     geometry  Map id -> { h, anchors: Map 'in:<port>' | 'out:<port>' -> { y } }, the measured
//               card (graph-editor.js); a card it lacks takes cardGeometry's default
//     minZoom   the wrap gate: rows only when the unwrapped Frame-all zoom on `viewport` is
//               below it (COARSE_FIT_MIN_ZOOM, about 0.92) and the rows fit it at a larger zoom
//     positions Map id -> { x, y } on the grid, from the graph's current top-left corner
//     rows      1 unwrapped, else the number of rows; zoom the Frame-all zoom on `viewport`
//
// 1. Layers: the longest path from the sources over every cable; a source is then pulled right
//    to one layer before its nearest target, so a modulator sits beside what it modulates.
// 2. A cable spanning several layers gets one dummy per crossed layer.
// 3. Order: barycentre sweeps on port anchors (rank + anchor / height), which keeps the fixed
//    port order of the cards (the registry's def.inputs / def.outputs); the order with the
//    fewest crossings wins.
// 4. y: each card moves toward its neighbours' anchors, then the column is made non-overlapping.
// 5. Wrap (gated): consecutive layers form rows, cut where the fewest cables span the cut (a DP
//    per row count); the row count whose aspect is closest to the viewport's wins.

/** Card geometry (src/styles/studio.css, fine pointer): port rows from y 49, 16 apart. */
export const CARD_PORT_TOP = 49;
export const CARD_PORT_ROW = 16;
export const CARD_BOTTOM = 8;
export const TIDY_COLUMN_GAP = 72;
export const TIDY_NODE_GAP = 24;
export const TIDY_ROW_GAP = 72;
const SWEEPS = 6;
const PASSES = 8;
const DUMMY_H = 12;

/** Each node's card: { id, w, h, inY, outY } (port anchor y offsets, registry port order). */
export function cardGeometry(model, { registry = NODE_REGISTRY, geometry = null } = {}) {
  return model.graph.nodes.map((n) => {
    const def = registry.get(n.type);
    const ins = def ? def.inputs.map((p) => p.id) : [];
    const outs = def ? def.outputs.map((p) => p.id) : [];
    const at = (i) => CARD_PORT_TOP + i * CARD_PORT_ROW + CARD_PORT_ROW / 2;
    const m = geometry && geometry.get(n.id);
    const anchor = (dir, p, i) => {
      const a = m && m.anchors && m.anchors.get(`${dir}:${p}`);
      return a && a.y > 0 ? a.y : at(i);
    };
    const rows = Math.max(1, ins.length, outs.length);
    return { id: n.id, w: NODE_WIDTH,
      h: m && m.h > 0 ? m.h : CARD_PORT_TOP + rows * CARD_PORT_ROW + CARD_BOTTOM,
      inY: new Map(ins.map((p, i) => [p, anchor('in', p, i)])),
      outY: new Map(outs.map((p, i) => [p, anchor('out', p, i)])) };
  });
}

/** Layered positions (top-left, from 0, 0) and the layer of each card. */
function layered(cards, edges) {
  const n = cards.length;
  const idx = new Map(cards.map((c, i) => [c.id, i]));
  const E = edges.filter((e) => idx.has(e.from.node) && idx.has(e.to.node)
    && e.from.node !== e.to.node);
  const succ = cards.map(() => []);
  const indeg = new Array(n).fill(0);
  for (const e of E) {
    succ[idx.get(e.from.node)].push(idx.get(e.to.node));
    indeg[idx.get(e.to.node)]++;
  }
  const hasPred = indeg.map((d) => d > 0);
  const layer = new Array(n).fill(0);
  const queue = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    for (const v of succ[queue[q]]) {
      layer[v] = Math.max(layer[v], layer[queue[q]] + 1);
      if (--indeg[v] === 0) queue.push(v);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!hasPred[i] && succ[i].length) layer[i] = Math.min(...succ[i].map((v) => layer[v])) - 1;
  }
  const minL = Math.min(...layer);
  for (let i = 0; i < n; i++) layer[i] -= minL;
  const L = Math.max(...layer) + 1;

  const items = cards.map((c, i) => ({ layer: layer[i], h: c.h }));
  const segs = [];
  for (const e of E) {
    let a = idx.get(e.from.node);
    let b = idx.get(e.to.node);
    let ay = cards[a].outY.get(e.from.port) ?? cards[a].h / 2;
    let by = cards[b].inY.get(e.to.port) ?? cards[b].h / 2;
    if (layer[a] > layer[b]) [a, b, ay, by] = [b, a, by, ay];
    let prev = a;
    let py = ay;
    for (let l = layer[a] + 1; l < layer[b]; l++) {
      const d = items.push({ layer: l, h: DUMMY_H }) - 1;
      segs.push({ u: prev, uy: py, v: d, vy: DUMMY_H / 2, w: prev === a ? 1 : 2 });
      prev = d;
      py = DUMMY_H / 2;
    }
    if (layer[a] !== layer[b]) segs.push({ u: prev, uy: py, v: b, vy: by, w: 1 });
  }
  const layers = Array.from({ length: L }, () => []);
  items.forEach((it, k) => layers[it.layer].push(k));
  const down = items.map(() => []);
  const up = items.map(() => []);
  for (const s of segs) { down[s.u].push(s); up[s.v].push(s); }

  // Crossing reduction.
  const rank = new Array(items.length).fill(0);
  const setRanks = () => layers.forEach((ly) => ly.forEach((k, r) => { rank[k] = r; }));
  const pos = (k, y) => rank[k] + y / items[k].h;
  const crossings = () => {
    let c = 0;
    for (let l = 0; l + 1 < L; l++) {
      const ss = layers[l].flatMap((k) => down[k]).map((s) => [pos(s.u, s.uy), pos(s.v, s.vy)]);
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          if ((ss[i][0] - ss[j][0]) * (ss[i][1] - ss[j][1]) < 0) c++;
        }
      }
    }
    return c;
  };
  const sweep = (l, fromLeft) => {
    const key = new Map();
    for (const k of layers[l]) {
      const ss = fromLeft ? up[k] : down[k];
      key.set(k, ss.length ? ss.reduce((a, s) => a + (fromLeft ? pos(s.u, s.uy)
        : pos(s.v, s.vy)), 0) / ss.length : rank[k]);
    }
    layers[l].sort((x, y) => key.get(x) - key.get(y) || rank[x] - rank[y]);
    layers[l].forEach((k, r) => { rank[k] = r; });
  };
  setRanks();
  for (let l = 1; l < L; l++) sweep(l, true);
  let best = layers.map((ly) => ly.slice());
  let bestC = crossings();
  for (let s = 0; s < SWEEPS && bestC > 0; s++) {
    if (s % 2 === 0) for (let l = L - 2; l >= 0; l--) sweep(l, false);
    else for (let l = 1; l < L; l++) sweep(l, true);
    const c = crossings();
    if (c < bestC) { bestC = c; best = layers.map((ly) => ly.slice()); }
  }
  best.forEach((ly, l) => { layers[l] = ly; });
  setRanks();

  // Coordinates: toward the neighbours' anchors, then non-overlapping per column.
  const top = new Array(items.length).fill(0);
  for (const ly of layers) {
    let y = 0;
    for (const k of ly) { top[k] = y; y += items[k].h + TIDY_NODE_GAP; }
  }
  const gap = (k) => items[k].h + TIDY_NODE_GAP;
  const place = (ly, want) => {
    const f = want.slice();
    for (let i = 1; i < ly.length; i++) f[i] = Math.max(f[i], f[i - 1] + gap(ly[i - 1]));
    const b = want.slice();
    for (let i = ly.length - 2; i >= 0; i--) b[i] = Math.min(b[i], b[i + 1] - gap(ly[i]));
    const m = f.map((v, i) => (v + b[i]) / 2);
    for (let i = 1; i < ly.length; i++) m[i] = Math.max(m[i], m[i - 1] + gap(ly[i - 1]));
    ly.forEach((k, i) => { top[k] = m[i]; });
  };
  for (let p = 0; p < PASSES; p++) {
    for (let j = 0; j < L; j++) {
      const ly = layers[p % 2 === 0 ? j : L - 1 - j];
      place(ly, ly.map((k) => {
        let sum = 0;
        let wsum = 0;
        for (const s of up[k]) { sum += s.w * (top[s.u] + s.uy - s.vy); wsum += s.w; }
        for (const s of down[k]) { sum += s.w * (top[s.v] + s.vy - s.uy); wsum += s.w; }
        return wsum ? sum / wsum : top[k];
      }));
    }
  }
  const minTop = Math.min(...cards.map((_, i) => top[i]));
  const pitch = NODE_WIDTH + TIDY_COLUMN_GAP;
  return { layer, L, E, at: cards.map((_, i) => ({ x: layer[i] * pitch, y: top[i] - minTop })) };
}

const boxOf = (cards, at) => {
  const x1 = Math.max(...cards.map((c, i) => at[i].x + c.w));
  const y1 = Math.max(...cards.map((c, i) => at[i].y + c.h));
  const x0 = Math.min(...at.map((p) => p.x));
  const y0 = Math.min(...at.map((p) => p.y));
  return { w: x1 - x0, h: y1 - y0 };
};

/** The Frame-all zoom of a box on `viewport` (fitView's, before its floor). */
function fitZoom(box, viewport) {
  return Math.min(FIT_MAX_ZOOM, (viewport.w - 2 * FIT_PADDING_PX) / Math.max(1, box.w),
    (viewport.h - 2 * FIT_PADDING_PX) / Math.max(1, box.h));
}

/** Rows of consecutive layers, cut where the fewest cables span; aspect nearest the viewport. */
function wrapRows(cards, { layer, L, E, at }, viewport) {
  const idx = new Map(cards.map((c, i) => [c.id, i]));
  const span = new Array(L).fill(0);
  for (const e of E) {
    const a = layer[idx.get(e.from.node)];
    const b = layer[idx.get(e.to.node)];
    for (let c = Math.min(a, b); c < Math.max(a, b); c++) span[c]++;
  }
  const aspect = viewport.w / viewport.h;
  const pitch = NODE_WIDTH + TIDY_COLUMN_GAP;
  let best = null;
  for (let R = 2; R <= L; R++) {
    const maxLen = Math.ceil(L / R) + 1;
    const cost = Array.from({ length: R + 1 }, () => new Array(L + 1).fill(Infinity));
    const from = Array.from({ length: R + 1 }, () => new Array(L + 1).fill(-1));
    cost[0][0] = 0;
    for (let r = 1; r <= R; r++) {
      for (let c = 1; c <= L; c++) {
        for (let s = Math.max(0, c - maxLen); s < c; s++) {
          const v = cost[r - 1][s] + (c < L ? span[c - 1] : 0);
          if (v < cost[r][c]) { cost[r][c] = v; from[r][c] = s; }
        }
      }
    }
    if (cost[R][L] === Infinity) continue;
    const starts = [];
    for (let r = R, c = L; r > 0; c = from[r][c], r--) starts.unshift(from[r][c]);
    const rowOf = (l) => {
      let r = 0;
      while (r + 1 < R && starts[r + 1] <= l) r++;
      return r;
    };
    const out = at.map((p) => ({ ...p }));
    let yOff = 0;
    for (let r = 0; r < R; r++) {
      const band = cards.map((_, i) => i).filter((i) => rowOf(layer[i]) === r);
      if (!band.length) continue;
      const y0 = Math.min(...band.map((i) => at[i].y));
      const y1 = Math.max(...band.map((i) => at[i].y + cards[i].h));
      for (const i of band) out[i] = { x: at[i].x - starts[r] * pitch, y: at[i].y - y0 + yOff };
      yOff += y1 - y0 + TIDY_ROW_GAP;
    }
    const box = boxOf(cards, out);
    const score = Math.abs(Math.log(box.w / box.h / aspect));
    if (!best || score < best.score - 1e-9) best = { score, at: out, rows: R, box };
  }
  return best;
}

export function tidyLayout(model, viewport = null, { registry = NODE_REGISTRY, geometry = null,
  minZoom = COARSE_FIT_MIN_ZOOM } = {}) {
  const nodes = model.graph.nodes;
  const positions = new Map();
  if (!nodes.length) return { positions, rows: 0, zoom: null };
  const cards = cardGeometry(model, { registry, geometry });
  const lay = layered(cards, model.graph.edges);
  const shown = viewport && viewport.w > 0 && viewport.h > 0;
  let at = lay.at;
  let rows = 1;
  let zoom = shown ? fitZoom(boxOf(cards, at), viewport) : null;
  if (shown && zoom < minZoom && lay.L > 1) {
    const w = wrapRows(cards, lay, viewport);
    const wz = w ? fitZoom(w.box, viewport) : 0;
    if (wz > zoom) ({ at, rows, zoom } = { at: w.at, rows: w.rows, zoom: wz });
  }
  const ox = snap(Math.min(...nodes.map((n) => n.position.x)));
  const oy = snap(Math.min(...nodes.map((n) => n.position.y)));
  nodes.forEach((n, i) => positions.set(n.id, { x: ox + snap(at[i].x), y: oy + snap(at[i].y) }));
  return { positions, rows, zoom };
}
