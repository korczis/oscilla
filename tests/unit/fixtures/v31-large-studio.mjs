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
 * Budgets of the §145 target (ms), the one copy that the unit tests (the fastest repeat of the
 * main thread's CPU time, cpuMs below), the browser suite (v31-studio-workflows.cjs) and
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

/**
 * The build's machine-relative bound: its CPU time may be at most this many times that of
 * referenceWork() measured the same way in the same process. docs/v31/performance.md records
 * the ratios measured and why this, not the 1000 ms, is what fails a build twice as slow.
 */
export const BUILD_REFERENCE_RATIO = 9;

/**
 * The CPU time the calling thread has spent, in ms: process.threadCpuUsage(), the main
 * thread's own user + system time, so the time the scheduler gives other processes does not
 * count; process.cpuUsage() (every thread of the process, never less) on a Node without it.
 */
export const CPU_CLOCK = typeof process !== 'undefined'
  && typeof process.threadCpuUsage === 'function' ? 'process.threadCpuUsage' : 'process.cpuUsage';
export function cpuMs() {
  const u = CPU_CLOCK === 'process.threadCpuUsage' ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1000;
}

/**
 * A fixed workload of no product code, the yardstick of BUILD_REFERENCE_RATIO, in the build's
 * shape: 300 steps grow a 100-node / 200-edge graph of plain objects, and after each step the
 * whole graph is copied and checked (JSON round trip, an id map, endpoint lookups, a sort, a
 * walk of every parameter). Deterministic; returns a checksum so that nothing is elided.
 */
export function referenceWork() {
  const nodes = [];
  const edges = [];
  let sum = 0;
  for (let s = 0; s < LARGE_NODES + LARGE_EDGES; s++) {
    if (s < LARGE_NODES) {
      nodes.push({ id: `n-${s}`, type: `t${s % 7}`, position: { x: s * 8, y: s * 3 },
        params: { frequency: 440 + s, level: 0.5, gain: s / 300, name: `node ${s}` } });
    } else {
      edges.push({ id: `e-${s}`, from: { node: `n-${s % LARGE_NODES}`, port: 'out' },
        to: { node: `n-${(s * 7) % LARGE_NODES}`, port: `in${s % 4}` } });
    }
    const copy = JSON.parse(JSON.stringify({ nodes, edges }));
    const byId = new Map(copy.nodes.map((n) => [n.id, n]));
    const keys = [];
    for (const e of copy.edges) {
      if (byId.has(e.from.node) && byId.has(e.to.node)) keys.push(`${e.to.node}:${e.to.port}`);
    }
    keys.sort();
    sum += keys.length;
    for (const n of copy.nodes) {
      for (const [k, v] of Object.entries(n.params)) sum += typeof v === 'number' ? 1 : k.length;
    }
  }
  return sum;
}
