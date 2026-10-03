// The spec §145 performance fixture: a 100-node / 200-edge Studio built through the store (every
// node and edge is one dispatched action, validated like a user's). Shared by
// tests/unit/v31-studio-performance.test.mjs (model operations, compile) and
// tests/browser/v31-studio-workflows.cjs (graph editor render in real browsers).
//
//   LARGE_NODES = 100, LARGE_EDGES = 200
//   largeStudioActions() -> [action]     NODE_ADD × 100 then EDGE_ADD × 200 (ids are the store's
//                                        deterministic ids: osc-1…, filter-1…, edge-1…)
//   buildLargeStudio(store) -> { nodes, edges }   dispatch them, asserting each is accepted
//
// Topology (acyclic; every input single, as the registry declares): 20 chains Oscillator →
// Filter → Gain → Pan (60 audio edges); the Pans into 5 Mixers (20); Mixers 1-4 into a sixth
// Mixer (4), which feeds the Master Output (1); 13 LFOs modulate the chains' parameters in a
// fixed order (115 control edges). 20 × 4 + 6 + 1 + 13 = 100 nodes; 60 + 20 + 4 + 1 + 115 = 200.

export const LARGE_NODES = 100;
export const LARGE_EDGES = 200;
const CHAINS = 20;
const LFOS = 13;
const CHAIN_PARAMS = [['osc', 'frequency'], ['filter', 'frequency'], ['osc', 'level'],
  ['gain', 'gain'], ['filter', 'Q'], ['pan', 'pan'], ['osc', 'detune'], ['filter', 'gain']];
const CONTROL_EDGES = LARGE_EDGES - (CHAINS * 3 + CHAINS + 4 + 1);

export function largeStudioActions() {
  const actions = [];
  const add = (nodeType, x, y) => actions.push({ type: 'NODE_ADD', nodeType,
    position: { x, y } });
  for (let k = 0; k < CHAINS; k++) add('oscillator', 0, k * 160);
  for (let k = 0; k < CHAINS; k++) add('filter', 240, k * 160);
  for (let k = 0; k < CHAINS; k++) add('gain', 480, k * 160);
  for (let k = 0; k < CHAINS; k++) add('pan', 720, k * 160);
  for (let m = 0; m < 6; m++) add('mixer', 960 + (m === 5 ? 240 : 0), m * 400);
  add('master', 1440, 800);
  for (let l = 0; l < LFOS; l++) add('lfo', -240, l * 240);
  const id = (prefix, i) => `${prefix}-${i + 1}`;
  const edge = (from, fport, to, tport) => actions.push({ type: 'EDGE_ADD',
    from: { node: from, port: fport }, to: { node: to, port: tport } });
  for (let k = 0; k < CHAINS; k++) {
    edge(id('osc', k), 'audio', id('filter', k), 'audio');
    edge(id('filter', k), 'audio', id('gain', k), 'audio');
    edge(id('gain', k), 'audio', id('pan', k), 'audio');
    edge(id('pan', k), 'audio', id('mix', Math.floor(k / 4)), `in${(k % 4) + 1}`);
  }
  for (let m = 0; m < 4; m++) edge(id('mix', m), 'audio', id('mix', 5), `in${m + 1}`);
  edge(id('mix', 5), 'audio', 'master-1', 'audio');
  let n = 0;
  for (const [prefix, param] of CHAIN_PARAMS) {
    for (let k = 0; k < CHAINS && n < CONTROL_EDGES; k++, n++) {
      edge(id('lfo', n % LFOS), 'control', id(prefix, k), param);
    }
  }
  return actions;
}

/** Dispatch the fixture into `store` (empty Studio); throws on the first refused action. */
export function buildLargeStudio(store) {
  for (const a of largeStudioActions()) {
    const r = store.dispatch(a);
    if (!r.ok) throw new Error(`${a.type} ${JSON.stringify(a.to || a.nodeType)}: ${r.reason}`);
  }
  const m = store.getModel();
  return { nodes: m.graph.nodes.length, edges: m.graph.edges.length };
}

const FRAME_MS = 1000 / 60;

/**
 * Budgets of the §145 target (ms, medians), the one copy that the unit test
 * (v31-studio-performance.test.mjs), the browser suite (v31-studio-workflows.cjs) and
 * docs/v31/performance.md (checked by v31-studio-docs.test.mjs) use. One 60 Hz frame for what
 * a single gesture commits, a few frames for whole-document work; see docs/v31/performance.md.
 */
export const PERF_BUDGETS = Object.freeze({
  build: 1000, // 300 dispatches, each validated
  dispatchMove: FRAME_MS,
  dispatchParam: FRAME_MS,
  dispatchEdge: FRAME_MS,
  undoRedo: FRAME_MS,
  validate: FRAME_MS,
  compile: 3 * FRAME_MS,
  hash: 3 * FRAME_MS,
  exportImport: 6 * FRAME_MS,
  summary: FRAME_MS,
  search: FRAME_MS,
  inspector: FRAME_MS,
  compact: FRAME_MS,
});

/** Browser budgets: opening the fixture file and its first render; one edit or Frame All. */
export const BROWSER_BUDGETS = Object.freeze({ importMs: 3000, editMs: 50 });
