// The Studio graph's Tidy (L) as a layered layout (plan V637, ADR 0087; owner order of
// 2026-11-03: fewest crossings, ergonomics first, mobile first, multi-line).
//   src/js/ui/studio/graph-layout.js tidyLayout, cardGeometry; graph-commands.js tidy
//   node --test tests/unit/studio-graph-layout.test.mjs
//
// Crossings are counted here, independently of the module: each cable is the straight segment
// from its output anchor (the card's right edge) to its input anchor (the left edge), the
// anchors at the registry's port rows (y 49 + 16 i + 8 on a 168-wide card), and a crossing is
// a proper intersection of two segments, as the spike of 2026-11-03 measured them. "Today's
// tidy" is the K009 tidy this replaces (compactLayout columns and rows, 240 apart, rows 48
// below the tallest card of the row above), rebuilt from compactLayout, which stays.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cardGeometry, compactLayout, tidyLayout } from '../../src/js/ui/studio/graph-layout.js';
import { createGraphCommands } from '../../src/js/ui/studio/graph-commands.js';
import { COARSE_FIT_MIN_ZOOM, FIT_PADDING_PX } from '../../src/js/ui/studio/graph-geometry.js';
import {
  DEMO_SONG_TEMPLATE_ID, STUDIO_TEMPLATES, templateModel,
} from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { normalizeStudio, studioHash } from '../../src/js/studio/schema.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { PERF_BUDGETS, cpuMs, largeStudioActions } from './fixtures/v31-large-studio.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHONE = Object.freeze({ w: 390, h: 844 });
const DESKTOP = Object.freeze({ w: 1536, h: 1024 });
const W = 168;
const PORT_Y = (i) => 49 + 16 * i + 8;

// ------------------------------------------------------------------------- graphs
const PREFIX = { oscillator: 'osc', mixer: 'mix' };

/** A model from NODE_ADD / EDGE_ADD actions with the store's ids (<prefix>-<n> per type). */
function modelFromActions(actions) {
  const counts = {};
  const nodes = [];
  const edges = [];
  for (const a of actions) {
    if (a.type === 'NODE_ADD') {
      const p = PREFIX[a.nodeType] || a.nodeType;
      counts[p] = (counts[p] || 0) + 1;
      nodes.push({ id: `${p}-${counts[p]}`, type: a.nodeType, position: a.position, params: {} });
    } else edges.push({ id: `edge-${edges.length + 1}`, from: a.from, to: a.to });
  }
  return normalizeStudio({ kind: 'oscilla-studio', schemaVersion: 1, graph: { nodes, edges },
    timeline: { tracks: [], clips: [], automation: [], markers: [] },
    transport: { timeMode: 'seconds', tempo: 120, timeSignature: [4, 4] },
    metadata: { title: 'large', notes: '' } });
}

/** 300 nodes / 600 edges in the fixture's topology: 60 chains, 15 + 4 + 1 mixers, 39 LFOs. */
function large300Actions() {
  const actions = [];
  const add = (nodeType, x, y) => actions.push({ type: 'NODE_ADD', nodeType, position: { x, y } });
  const C = 60;
  for (const [t, x] of [['oscillator', 0], ['filter', 240], ['gain', 480], ['pan', 720]]) {
    for (let k = 0; k < C; k++) add(t, x, k * 160);
  }
  for (let m = 0; m < 15; m++) add('mixer', 960, m * 640);
  for (let m = 0; m < 4; m++) add('mixer', 1200, m * 2400);
  add('mixer', 1440, 4000);
  add('master', 1680, 4000);
  for (let l = 0; l < 39; l++) add('lfo', -240, l * 240);
  const id = (p, i) => `${p}-${i + 1}`;
  const edge = (f, fp, t, tp) => actions.push({ type: 'EDGE_ADD', from: { node: f, port: fp },
    to: { node: t, port: tp } });
  for (let k = 0; k < C; k++) {
    edge(id('osc', k), 'audio', id('filter', k), 'audio');
    edge(id('filter', k), 'audio', id('gain', k), 'audio');
    edge(id('gain', k), 'audio', id('pan', k), 'audio');
    edge(id('pan', k), 'audio', id('mix', Math.floor(k / 4)), `in${(k % 4) + 1}`);
  }
  for (let m = 0; m < 15; m++) {
    edge(id('mix', m), 'audio', id('mix', 15 + Math.floor(m / 4)), `in${(m % 4) + 1}`);
  }
  for (let m = 0; m < 4; m++) edge(id('mix', 15 + m), 'audio', 'mix-20', `in${m + 1}`);
  edge('mix-20', 'audio', 'master-1', 'audio');
  const params = [['osc', 'frequency'], ['filter', 'frequency'], ['osc', 'level'],
    ['gain', 'gain'], ['filter', 'Q'], ['pan', 'pan'], ['osc', 'detune'], ['filter', 'gain']];
  let n = 0;
  for (const [p, param] of params) {
    for (let k = 0; k < C && n < 600 - (C * 4 + 20); k++, n++) {
      edge(id('lfo', n % 39), 'control', id(p, k), param);
    }
  }
  return actions;
}

const LARGE_100 = modelFromActions(largeStudioActions());
const LARGE_300 = modelFromActions(large300Actions());

// ------------------------------------------------------------------------- metrics
/** Card rects and anchors from the registry (independent of graph-layout.js). */
function cards(model, pos) {
  return new Map(model.graph.nodes.map((n) => {
    const def = NODE_REGISTRY.get(n.type);
    const rows = Math.max(1, def.inputs.length, def.outputs.length);
    const p = pos.get(n.id);
    return [n.id, { x: p.x, y: p.y, w: W, h: 49 + 16 * rows + 8,
      in: new Map(def.inputs.map((q, i) => [q.id, p.y + PORT_Y(i)])),
      out: new Map(def.outputs.map((q, i) => [q.id, p.y + PORT_Y(i)])) }];
  }));
}

const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1])
  - (b[1] - a[1]) * (c[0] - a[0]));
const cross = (s, t) => orient(s[0], s[1], t[0]) * orient(s[0], s[1], t[1]) < 0
  && orient(t[0], t[1], s[0]) * orient(t[0], t[1], s[1]) < 0;

function crossings(model, pos) {
  const c = cards(model, pos);
  const segs = model.graph.edges.map((e) => {
    const a = c.get(e.from.node);
    const b = c.get(e.to.node);
    return [[a.x + a.w, a.out.get(e.from.port)], [b.x, b.in.get(e.to.port)]];
  });
  let k = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) if (cross(segs[i], segs[j])) k++;
  }
  return k;
}

function overlaps(model, pos) {
  const r = [...cards(model, pos).values()];
  let k = 0;
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const p = r[i];
      const q = r[j];
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) k++;
    }
  }
  return k;
}

/** The K009 tidy this replaces, rebuilt from compactLayout (the cards' own heights). */
function todaysTidy(model) {
  const lay = compactLayout(model);
  const hOf = new Map([...cards(model, new Map(model.graph.nodes.map((n) => [n.id,
    { x: 0, y: 0 }])))].map(([id, c]) => [id, c.h]));
  const rowH = new Array(lay.rows).fill(0);
  for (const n of lay.nodes) rowH[n.row] = Math.max(rowH[n.row], hOf.get(n.id));
  const rowY = [0];
  for (let r = 1; r < lay.rows; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + 48;
  return new Map(lay.nodes.map((n) => [n.id, { x: n.col * (W + 72), y: rowY[n.row] }]));
}

/** The unwrapped Frame-all zoom of `pos` on `vp` (fitView's formula, before its floor). */
function fit(model, pos, vp) {
  const r = [...cards(model, pos).values()];
  const bw = Math.max(...r.map((c) => c.x + c.w)) - Math.min(...r.map((c) => c.x));
  const bh = Math.max(...r.map((c) => c.y + c.h)) - Math.min(...r.map((c) => c.y));
  return Math.min(1.25, (vp.w - 2 * FIT_PADDING_PX) / bw, (vp.h - 2 * FIT_PADDING_PX) / bh);
}

// ------------------------------------------------------------------------- tests
test('V637 the generated large graphs are valid, 100/200 and 300/600', () => {
  for (const [m, n, e] of [[LARGE_100, 100, 200], [LARGE_300, 300, 600]]) {
    assert.equal(m.graph.nodes.length, n);
    assert.equal(m.graph.edges.length, e);
    const v = validateStudioModel(m);
    assert.ok(v.ok ?? !(v.errors || []).length, JSON.stringify(v.errors && v.errors[0]));
  }
});

test('V637 Tidy gives 0 crossings and no overlap on every template, unwrapped and wrapped', () => {
  for (const t of STUDIO_TEMPLATES) {
    const m = templateModel(t.id);
    for (const vp of [null, DESKTOP]) {
      const { positions, rows } = tidyLayout(m, vp);
      assert.equal(rows, 1, `${t.id} fits ${vp ? 'the desktop' : 'no viewport'} unwrapped`);
      assert.equal(crossings(m, positions), 0, `${t.id} crossings`);
      assert.equal(overlaps(m, positions), 0, `${t.id} overlaps`);
    }
    const phone = tidyLayout(m, PHONE).positions;
    assert.equal(overlaps(m, phone), 0, `${t.id} overlaps on the phone`);
    assert.ok(crossings(m, phone) <= 1, `${t.id} crossings on the phone`);
  }
});

test('V637 Tidy has strictly fewer crossings than today\'s tidy on 100 and 300 nodes', (t) => {
  for (const [name, m] of [['large-100', LARGE_100], ['large-300', LARGE_300]]) {
    const before = crossings(m, todaysTidy(m));
    const { positions } = tidyLayout(m, DESKTOP);
    const after = crossings(m, positions);
    t.diagnostic(`${name}: today's tidy ${before} crossings, layered ${after}`);
    assert.ok(after < before, `${name}: ${after} < ${before}`);
    assert.ok(after <= before * 0.6, `${name}: about half (${after} of ${before})`);
    assert.equal(overlaps(m, positions), 0, `${name} overlaps`);
  }
});

test('V637 rows only below the 0.92 fit zoom, only to fit larger, never to cross more', () => {
  assert.ok(Math.abs(COARSE_FIT_MIN_ZOOM - 0.92) < 0.005);
  for (const t of STUDIO_TEMPLATES) {
    const m = templateModel(t.id);
    const flat = tidyLayout(m, null).positions;
    for (const vp of [PHONE, DESKTOP]) {
      const z = fit(m, flat, vp);
      const lay = tidyLayout(m, vp);
      if (z >= COARSE_FIT_MIN_ZOOM) {
        assert.equal(lay.rows, 1, `${t.id} at ${vp.w}: fits at ${z.toFixed(2)}, no rows`);
        assert.deepEqual(lay.positions, flat, `${t.id} at ${vp.w}: the unwrapped layout`);
      } else if (t.id === DEMO_SONG_TEMPLATE_ID) {
        // Its rows would fit only a little larger (0.21 to 0.30 on the phone's graph viewport)
        // and their return cables would cross 5: it stays one strip with 0 crossings.
        assert.equal(lay.rows, 1, `${t.id} at ${vp.w}: rows would cross more, one strip`);
        assert.equal(crossings(m, lay.positions), 0);
      } else {
        assert.ok(lay.rows > 1, `${t.id} at ${vp.w}: fit ${z.toFixed(2)} wraps`);
        assert.ok(lay.zoom > z, `${t.id} at ${vp.w}: rows fit larger (${lay.zoom} > ${z})`);
        assert.ok(crossings(m, lay.positions) <= crossings(m, flat), `${t.id}: no more crossings`);
      }
    }
  }
  // At the threshold: the 2-node Basic Tone is 408 wide unwrapped.
  const basic = templateModel('basic-tone');
  const at = (zoom) => ({ w: Math.round(2 * FIT_PADDING_PX + zoom * 408), h: 844 });
  assert.equal(tidyLayout(basic, at(0.95)).rows, 1, 'above 0.92: one row');
  assert.equal(tidyLayout(basic, at(0.88)).rows, 2, 'below 0.92: two rows');
  assert.equal(tidyLayout(basic, at(0.88), { minZoom: 0.5 }).rows, 1, 'the gate is minZoom');
  // A large graph that is already portrait stays in one row on the phone.
  assert.equal(tidyLayout(LARGE_100, PHONE).rows, 1);
  // No viewport (a hidden graph): never rows.
  assert.equal(tidyLayout(templateModel(DEMO_SONG_TEMPLATE_ID), { w: 0, h: 0 }).rows, 1);
});

test('V637 Tidy is deterministic, on the grid, from the graph\'s top-left, and pure', () => {
  for (const m of [templateModel(DEMO_SONG_TEMPLATE_ID), LARGE_100]) {
    const json = JSON.stringify(m);
    const a = tidyLayout(m, PHONE);
    assert.deepEqual(tidyLayout(m, PHONE), a, 'same model, same viewport, same result');
    assert.equal(JSON.stringify(m), json, 'the model is not written');
    const ps = [...a.positions.values()];
    assert.ok(ps.every((p) => p.x % 8 === 0 && p.y % 8 === 0), 'on the 8-unit grid');
    const x0 = Math.min(...m.graph.nodes.map((n) => n.position.x));
    const y0 = Math.min(...m.graph.nodes.map((n) => n.position.y));
    assert.equal(Math.min(...ps.map((p) => p.x)), Math.round(x0 / 8) * 8);
    assert.equal(Math.min(...ps.map((p) => p.y)), Math.round(y0 / 8) * 8);
  }
  // Port order comes from the registry: a card's anchors are its def.inputs / def.outputs rows.
  const m = templateModel('subtractive-synth');
  const filter = cardGeometry(m).find((c) => c.id === 'filter-1');
  const def = NODE_REGISTRY.get('filter');
  assert.deepEqual([...filter.inY.keys()], def.inputs.map((p) => p.id));
  assert.deepEqual([...filter.inY.values()], def.inputs.map((_, i) => PORT_Y(i)));
  // A measured card (coarse pointer rows) is used as measured.
  const g = new Map([['filter-1', { h: 300, anchors: new Map([['in:audio', { y: 62 }]]) }]]);
  const measured = cardGeometry(m, { geometry: g }).find((c) => c.id === 'filter-1');
  assert.equal(measured.h, 300);
  assert.equal(measured.inY.get('audio'), 62);
});

test('V637 an empty graph and a single node', () => {
  const empty = { graph: { nodes: [], edges: [] } };
  assert.deepEqual(tidyLayout(empty, PHONE), { positions: new Map(), rows: 0, zoom: null });
  const one = { graph: { nodes: [{ id: 'osc-1', type: 'oscillator', position: { x: 43, y: -21 } }],
    edges: [] } };
  const lay = tidyLayout(one, PHONE);
  assert.deepEqual([...lay.positions], [['osc-1', { x: 40, y: -24 }]]);
  assert.equal(lay.rows, 1);
});

test('V637 L is one NODE_MOVE history entry; undo restores; studioHash unchanged', () => {
  const m = templateModel(DEMO_SONG_TEMPLATE_ID);
  globalThis.requestAnimationFrame = () => 0;
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m) });
  const said = [];
  const cmd = createGraphCommands({ viewport: { addEventListener() {}, contains: () => false,
    focus() {} }, store, registry: NODE_REGISTRY, svc: { announce: (x) => said.push(x) },
  view: () => ({ panX: 0, panY: 0, zoom: 1 }), setView() {}, centerPoint: () => ({ x: 0, y: 0 }),
  clientToGraph: () => ({ x: 0, y: 0 }), isOverViewport: () => true, focusNode: () => true,
  isShown: () => false, nodeGeometry: () => new Map(), viewSize: () => ({ ...PHONE }) });
  // A user's layout: every box in one row (each move its own entry, before d0).
  m.graph.nodes.forEach((n, i) => store.dispatch({ type: 'NODE_MOVE', nodeId: n.id,
    position: { x: i * 240, y: 0 } }));
  const before = store.getModel();
  const hash0 = studioHash(before);
  const d0 = store.debugInfo().undoDepth;
  assert.equal(cmd.tidy(), true);
  assert.equal(store.debugInfo().undoDepth, d0 + 1, 'one history entry');
  assert.equal(store.debugInfo().lastAction.type, 'NODE_MOVE');
  assert.equal(store.undoLabel(), 'Tidy the graph');
  assert.match(said.at(-1), /^Tidied the graph: \d+ nodes moved$/, 'one strip: no rows');
  const after = store.getModel();
  assert.deepEqual(new Map(after.graph.nodes.map((n) => [n.id, n.position])),
    tidyLayout(before, PHONE).positions);
  assert.equal(studioHash(after), hash0, 'positions are presentation: the hash is unchanged');
  assert.equal(cmd.tidy(), false, 'a tidy graph does not change again');
  assert.equal(store.debugInfo().undoDepth, d0 + 1);
  store.undo();
  assert.deepEqual(store.getModel().graph.nodes.map((n) => n.position),
    before.graph.nodes.map((n) => n.position), 'undo restores every position');
});

test('V637 nothing but the L command calls the layout (it never moves a box on its own)', () => {
  const dir = path.join(ROOT, 'src', 'js');
  const callers = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js') && /\btidyLayout\(/.test(readFileSync(p, 'utf8'))) {
        callers.push(path.relative(ROOT, p));
      }
    }
  };
  walk(dir);
  assert.deepEqual(callers.sort(), ['src/js/ui/studio/graph-commands.js',
    'src/js/ui/studio/graph-layout.js']);
});

/** The fastest of `repeats` runs on the E029 clock (cpuMs), re-measured up to a deadline. */
function fastestCpu(fn, budget, { repeats = 15, deadlineMs = 20_000 } = {}) {
  const start = performance.now();
  fn();
  let min = Infinity;
  do {
    for (let r = 0; r < repeats; r++) {
      const c0 = cpuMs();
      fn();
      min = Math.min(min, cpuMs() - c0);
    }
  } while (min > budget && performance.now() - start < deadlineMs);
  return min;
}

test('V637 Tidy of 100 and 300 nodes takes at most one frame of CPU time (E029)', (t) => {
  for (const [name, m] of [['large-100', LARGE_100], ['large-300', LARGE_300]]) {
    const ms = fastestCpu(() => tidyLayout(m, PHONE), PERF_BUDGETS.dispatchMove);
    t.diagnostic(`${name}: ${ms.toFixed(2)} ms CPU`
      + ` (budget ${PERF_BUDGETS.dispatchMove.toFixed(1)})`);
    assert.ok(ms <= PERF_BUDGETS.dispatchMove, `${name}: ${ms} ms`);
  }
});

