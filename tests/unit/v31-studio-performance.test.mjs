// V3.1 Studio performance target (spec §145-§147, §250; plan V431): a 100-node / 200-edge
// Studio (tests/unit/fixtures/v31-large-studio.mjs, built through the store) stays responsive
// for the model operations and the compiler. The graph editor's render of the same graph in
// real browsers is tests/browser/v31-studio-workflows.cjs (check large-graph-render).
//   node --test tests/unit/v31-studio-performance.test.mjs
//
// Method: each operation runs REPEATS times after one warm-up, and the FASTEST repeat of the
// main thread's CPU time (cpuMs of the fixture: process.threadCpuUsage) is compared with its
// budget. Budgets are what an interaction may cost: one 60 Hz frame (16.7 ms) for anything a
// single gesture commits (one dispatch with its whole-model validation, undo, redo, search), a
// few frames for whole-document work (compile, import, hash), and one second for building the
// whole fixture action by action. The measured times (docs/v31/performance.md) are about 3
// (build) to several hundred times below them, so these fail on a gross regression (an
// accidental O(n²) per action), not on a slower CI runner.
//
// Why CPU time and not wall time (plan E029). Every operation here is synchronous JavaScript on
// the main thread: no I/O, no timer, no worker it waits for. Its wall time is its CPU time plus
// the time the scheduler gave other processes, and on the shared Mac (load 55-110 on 18 cores,
// 2026-10-29) that second part was most of it: the fastest of 15 builds took 2459 ms of wall
// time and 280 ms of CPU time, so the build missed 1000 ms on every batch (1138-3262 ms), and
// re-measuring, a median, or more repeats could not change that. CPU time is what the work
// costs; the load only stretches how long it takes to get it. A frame budget is the main
// thread's time, so helper threads (concurrent GC, the compiler) are not counted.
//
// The build has a second, machine-relative bound, because 1000 ms is about 3.5 times its cost
// and so would pass a build twice as slow: its CPU time may be at most BUILD_REFERENCE_RATIO
// times that of referenceWork() (a fixed workload in the build's shape, no product code),
// measured the same way in the same process just before. The ratio is the same on a fast and
// a slow machine, so the bound fails a 2x slower build on either; the test also asserts that
// it would (twice the measured build is over the bound), so a bound that drifted loose fails.
//
// Re-measure: an operation over its budget is re-measured in further batches of REPEATS,
// keeping the running minimum, until it is within budget or the named wall-clock deadline
// REMEASURE_DEADLINE_MS passes (a condition poll with a wall-clock deadline, in the spirit of
// project.bounded-test-timing; no sleep). All operations together share TOTAL_DEADLINE_MS
// (60 s), so the file stays inside fail-first's 180 s per-file timeout. A real regression is
// over budget at every minimum and still fails, with its CPU and wall minimum, the batch count
// and the load in the message. The numbers are printed as test diagnostics.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import { normalizeStudio, serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { importStudioFile, exportProjectFile } from '../../src/js/studio/library.js';
import { summarizeGraph } from '../../src/js/studio/a11y.js';
import { searchNodes } from '../../src/js/ui/studio/graph-search.js';
import { inspectorView } from '../../src/js/ui/studio/inspector.js';
import { compactView } from '../../src/js/ui/studio/compact.js';
import {
  BUILD_REFERENCE_RATIO, CPU_CLOCK, LARGE_EDGES, LARGE_NODES, PERF_BUDGETS, buildLargeStudio,
  cpuMs, largeStudioActions, referenceWork,
} from './fixtures/v31-large-studio.mjs';

const REPEATS = 15;
export const REMEASURE_DEADLINE_MS = 20_000;
export const TOTAL_DEADLINE_MS = 60_000;

/**
 * The re-measure deadline of each next operation: REMEASURE_DEADLINE_MS, or less once the
 * operations measured so far have used up most of the shared `totalMs`; never below 0 (one
 * batch, no re-measure).
 */
export function deadlines({ totalMs = TOTAL_DEADLINE_MS, perOpMs = REMEASURE_DEADLINE_MS,
  now = () => performance.now() } = {}) {
  const end = now() + totalMs;
  return () => Math.max(0, Math.min(perOpMs, end - now()));
}

/**
 * The fastest run of `fn` after one warm-up: batches of `repeats`, repeated while the running
 * minimum is over `budget` and less than `deadlineMs` of `now()` has passed since the start.
 * A run's cost is read on `clock` (CPU time); the deadline on `now` (wall time), so a starved
 * process re-measures for as long as the wall-clock deadline says and no longer. `fn(i)` gets
 * a run index that keeps counting across batches. `wall` is the fastest run on `now`, printed.
 * @returns {{ min: number, wall: number, batches: number, ok: boolean }}
 */
export function measure(fn, budget, { repeats = REPEATS, deadlineMs = REMEASURE_DEADLINE_MS,
  now = () => performance.now(), clock = cpuMs } = {}) {
  const start = now();
  fn(-1); // warm-up
  let min = Infinity;
  let wall = Infinity;
  let batches = 0;
  let i = 0;
  do {
    for (let r = 0; r < repeats; r++, i++) {
      const w0 = now();
      const c0 = clock();
      fn(i);
      min = Math.min(min, clock() - c0);
      wall = Math.min(wall, now() - w0);
    }
    batches += 1;
  } while (min > budget && now() - start < deadlineMs);
  return { min, wall, batches, ok: min <= budget };
}

/**
 * The build's budget on this machine: the smaller of PERF_BUDGETS.build and
 * BUILD_REFERENCE_RATIO times the CPU time of referenceWork() measured here.
 */
export function buildBudget(referenceMs, { cap = PERF_BUDGETS.build,
  ratio = BUILD_REFERENCE_RATIO } = {}) {
  return Math.min(cap, ratio * referenceMs);
}

const freshStore = () => {
  const m = normalizeStudio({});
  return createStudioStore(m, { idGenerator: createIdGenerator(m) });
};

test('§145 the 100-node / 200-edge fixture is valid and built by store actions', () => {
  const actions = largeStudioActions();
  assert.equal(actions.filter((a) => a.type === 'NODE_ADD').length, LARGE_NODES);
  assert.equal(actions.filter((a) => a.type === 'EDGE_ADD').length, LARGE_EDGES);
  const store = freshStore();
  assert.deepEqual(buildLargeStudio(store), { nodes: LARGE_NODES, edges: LARGE_EDGES });
  const report = validateStudioModel(store.getModel());
  assert.ok(report.ok, JSON.stringify(report.errors.slice(0, 2)));
  assert.equal(report.order.length, LARGE_NODES, 'acyclic: a full topological order');
  const plan = compileStudio(store.getModel());
  assert.ok(plan.ok, JSON.stringify(plan.errors && plan.errors.slice(0, 2)));
});

test('§145-§147 model operations, compile and views stay within their budgets', (t) => {
  const measured = {};
  const next = deadlines();
  const time = (k, fn, repeats, budget = PERF_BUDGETS[k]) => {
    measured[k] = { ...measure(fn, budget, { repeats, deadlineMs: next() }), budget };
  };
  // The yardstick first, in the same process and on the same clock as the build.
  const reference = measure(() => referenceWork(), Infinity);
  time('build', () => buildLargeStudio(freshStore()), 5, buildBudget(reference.min));
  const store = freshStore();
  buildLargeStudio(store);
  const base = store.getModel();
  time('dispatchMove', (i) => {
    const r = store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-7',
      position: { x: 8 * ((i % 1000) + 2), y: 960 } });
    assert.ok(r.ok);
  });
  time('dispatchParam', (i) => {
    const r = store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-12', key: 'frequency',
      value: 500 + 10 * ((i % 100) + 2) });
    assert.ok(r.ok, r.reason);
  });
  time('dispatchEdge', () => {
    const r = store.dispatch({ type: 'EDGE_REMOVE', edgeId: store.getModel().graph.edges.at(-1)
      .id });
    assert.ok(r.ok, r.reason);
    store.undo();
  });
  time('undoRedo', () => {
    assert.ok(store.undo().ok);
    assert.ok(store.redo().ok);
  });
  const m = store.getModel();
  time('validate', () => assert.ok(validateStudioModel(m).ok));
  time('compile', () => assert.ok(compileStudio(m).ok));
  time('hash', () => studioHash(m));
  time('exportImport', () => {
    const f = exportProjectFile(m);
    const r = importStudioFile(f.text);
    assert.ok(r.ok && r.kind === 'project');
  });
  time('summary', () => summarizeGraph(m));
  time('search', () => searchNodes(m, 'filter 1'));
  time('inspector', () => inspectorView(m, { nodes: ['filter-12'] }));
  time('compact', () => compactView(m, { nodes: [] }));
  assert.ok(serializeStudio(base).length > 10000, 'a real document');
  const load = os.loadavg()[0].toFixed(1);
  const ratio = measured.build.min / reference.min;
  t.diagnostic(`100 nodes / 200 edges, fastest of ${REPEATS} per batch on ${CPU_CLOCK}, `
    + `load ${load} on ${os.cpus().length} cores:`);
  t.diagnostic(`reference      ${reference.min.toFixed(3)} ms (wall ${reference.wall.toFixed(3)});`
    + ` build / reference ${ratio.toFixed(2)} (bound ${BUILD_REFERENCE_RATIO})`);
  for (const [k, v] of Object.entries(measured)) {
    t.diagnostic(`${k.padEnd(14)} ${v.min.toFixed(3)} ms (wall ${v.wall.toFixed(3)}, budget `
      + `${v.budget.toFixed(1)}, ${v.batches} batch(es))`);
  }
  for (const [k, v] of Object.entries(measured)) {
    const of = k === 'build' ? ` (the smaller of ${PERF_BUDGETS.build} ms and `
      + `${BUILD_REFERENCE_RATIO} x the reference's ${reference.min.toFixed(2)} ms; build / `
      + `reference ${ratio.toFixed(2)})` : '';
    assert.ok(v.ok, `${k}: ${v.min.toFixed(2)} ms of CPU time > budget ${v.budget.toFixed(2)} ms`
      + `${of}, the fastest of ${v.batches} batch(es) within ${REMEASURE_DEADLINE_MS} ms (all`
      + ` operations within ${TOTAL_DEADLINE_MS} ms); wall ${v.wall.toFixed(2)} ms at load ${load}`);
  }
  assert.ok(2 * measured.build.min > measured.build.budget, `a build twice as slow `
    + `(${(2 * measured.build.min).toFixed(2)} ms) would pass its budget `
    + `${measured.build.budget.toFixed(2)} ms: lower BUILD_REFERENCE_RATIO (build / reference is `
    + `${ratio.toFixed(2)} here) so that the budget still fails a 2x regression`);
});

// The re-measure on fake clocks: `now` (wall) and `cpu` are the only time sources, and each
// fake operation advances them by what it "costs": `spend(cpuMs, wallMs)`, the wall time
// being the CPU time unless the fake host also kept the process waiting.
function fakeClock() {
  let wall = 0;
  let cpu = 0;
  return {
    now: () => wall,
    cpu: () => cpu,
    spend: (c, w = c) => { cpu += c; wall += w; },
  };
}
const on = (c, opts = {}) => ({ now: c.now, clock: c.cpu, ...opts });

test('§145-§147 re-measure: an operation always over budget fails after the deadline', () => {
  const c = fakeClock();
  const r = measure(() => c.spend(2), 1, on(c, { deadlineMs: 300 }));
  assert.equal(r.ok, false);
  assert.equal(r.min, 2);
  assert.ok(c.now() >= 300, `ran until the deadline (${c.now()} ms)`);
  assert.equal(r.batches, 10, '15 runs of 2 ms per batch: 30 ms a batch, 300 ms deadline');
});

test('§145-§147 re-measure: slow on the first batch and fast on the second passes', () => {
  const c = fakeClock();
  let calls = 0;
  const r = measure(() => { calls += 1; c.spend(calls <= 16 ? 2 : 0.5); }, 1,
    on(c, { deadlineMs: 20_000 }));
  assert.deepEqual(r, { min: 0.5, wall: 0.5, batches: 2, ok: true });
});

test('§145-§147 re-measure: the deadline is wall-clock time, not a number of batches', () => {
  for (const [deadlineMs, batches] of [[60, 2], [600, 20]]) {
    const c = fakeClock();
    const r = measure(() => c.spend(2), 1, on(c, { deadlineMs }));
    assert.equal(r.batches, batches, `deadline ${deadlineMs} ms`);
  }
  const c = fakeClock();
  const r = measure(() => c.spend(0.5), 1, on(c, { deadlineMs: 0 }));
  assert.deepEqual(r, { min: 0.5, wall: 0.5, batches: 1, ok: true },
    'within budget: one batch, no wait');
});

test('§145-§147 re-measure: all operations share one total deadline', () => {
  const c = fakeClock();
  const next = deadlines({ totalMs: 300, perOpMs: 200, now: c.now });
  const over = () => measure(() => c.spend(2), 1, on(c, { deadlineMs: next() }));
  const first = over();
  assert.equal(first.batches, 7, '200 ms per operation: 7 batches of 30 ms');
  const second = over();
  assert.equal(second.batches, 3, 'the 90 ms left of the 300 ms total: 3 batches');
  const third = over();
  assert.equal(third.batches, 1, 'nothing left: one batch, no re-measure');
  assert.equal(next(), 0);
});

test('§145-§147 the budget is CPU time: time the host gives other processes does not count',
  () => {
    // 0.5 ms of work that a loaded machine stretches to 40 ms of wall time on every run.
    const c = fakeClock();
    const r = measure(() => c.spend(0.5, 40), 1, on(c, { deadlineMs: 20_000 }));
    assert.deepEqual(r, { min: 0.5, wall: 40, batches: 1, ok: true });
    // The same work on the wall clock alone (the method before E029) fails: the load, not the
    // operation, is over budget.
    const w = fakeClock();
    const old = measure(() => w.spend(0.5, 40), 1, { now: w.now, clock: w.now, deadlineMs: 600 });
    assert.equal(old.ok, false);
  });

test('§145-§147 the re-measure deadline stays wall time when the process is starved', () => {
  // Over budget on every run, and the process gets a tenth of the wall time: CPU time moves
  // 2 ms per run, wall time 20. The deadline ends it after 1000 ms of wall time (4 batches of
  // 300 ms after a 20 ms warm-up), when only 122 ms of CPU time have passed.
  const c = fakeClock();
  const r = measure(() => c.spend(2, 20), 1, on(c, { deadlineMs: 1000 }));
  assert.equal(r.ok, false);
  assert.equal(r.batches, 4);
  assert.equal(c.now(), 1220);
  assert.equal(c.cpu(), 122);
});

test('§145-§147 the build budget: the smaller of 1000 ms and the ratio times the reference',
  () => {
    assert.equal(buildBudget(50, { cap: 1000, ratio: 9 }), 450);
    assert.equal(buildBudget(200, { cap: 1000, ratio: 9 }), 1000, 'never above the 1000 ms');
    assert.equal(buildBudget(50), Math.min(PERF_BUDGETS.build, BUILD_REFERENCE_RATIO * 50));
    // A build at 6.3 times the reference passes; the same build twice as slow does not.
    const ref = 45;
    assert.ok(6.3 * ref <= buildBudget(ref, { cap: 1000, ratio: 9 }));
    assert.ok(2 * 6.3 * ref > buildBudget(ref, { cap: 1000, ratio: 9 }));
  });

test('§145-§147 the reference workload is fixed and product-free', () => {
  const sum = referenceWork();
  assert.equal(referenceWork(), sum, 'deterministic');
  assert.ok(sum > 0);
  const src = referenceWork.toString();
  assert.ok(!/store|dispatch|validate|Studio/i.test(src), 'no product code in the yardstick');
});
