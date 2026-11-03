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
// measured the same way in the same process just before. The ratio build / reference is not
// the same on every machine: 5.5-6.5 on the Apple M5 Pro, 3.78 on a GitHub ubuntu runner (CI
// run 41190815003). So the budget the build is judged against is derived from the ratio
// measured in this run (buildBudget below, with the arithmetic), so that it passes the
// measured build and is under twice it on any runner where a budget can be both.
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

/** The derived build budget sits this far above the measured build: under 2, over 1. */
export const BUILD_MARGIN = 1.9;
/** The derived build budget is never under this many times the reference. */
export const BUILD_FLOOR_RATIO = 2;

/**
 * The build's budget on this machine, from the reference's and the build's CPU time measured
 * here. With r = buildMs / referenceMs (the measured ratio):
 *
 *   multiple = min(bound, max(floor, margin * r))      bound 9, floor 2, margin 1.9
 *   budget   = min(cap, multiple * referenceMs)         cap 1000 ms
 *
 * It passes the measured build whenever r <= bound and buildMs <= cap: margin * r > r, and a
 * floor that binds is above margin * r. So what fails a slow build in one run is the bound
 * (r > 9) and the cap, as before; the derivation only tightens the budget below the bound.
 *
 * It fails a build twice as slow as the measured one (2 * buildMs > budget) wherever that is
 * possible: margin * r < 2 * r; when the bound binds, margin * r >= bound, so 2 * r >= 2 *
 * bound / 1.9 > bound; when the cap binds, 1.9 * buildMs >= cap or 9 * referenceMs >= cap with
 * r >= 9 / 1.9, so 2 * buildMs > cap. Only the floor can bind with 2 * r <= floor, at r <= 1:
 * a build that costs no more CPU time than the product-free reference, where the yardstick is
 * not measuring the build's shape and no budget both passes it and fails it doubled (catches2x
 * false; the test skips that check and says why). Any real build is far above (r 3.78-6.5).
 *
 * A fixed budget of 9 x the reference could not do both on every runner: at r = 3.78 a build
 * twice as slow (7.56 x) is under it (CI run 41190815003: 710.81 ms against 845.62 ms), and
 * any fixed multiple low enough for that runner (< 7.56) leaves little room above the Mac's
 * 6.5. A regression that a later run measures is judged by the bound: on the Mac (r ~6) a 2x
 * slower build is r ~12 > 9 and fails; on a runner at r 3.78 only a build over 2.38x fails.
 * @returns {{ ratio: number, multiple: number, budget: number, passes: boolean,
 *   catches2x: boolean }}
 */
export function buildBudget(referenceMs, buildMs, { cap = PERF_BUDGETS.build,
  bound = BUILD_REFERENCE_RATIO, margin = BUILD_MARGIN, floor = BUILD_FLOOR_RATIO } = {}) {
  const ratio = buildMs / referenceMs;
  const multiple = Math.min(bound, Math.max(floor, margin * ratio));
  const budget = Math.min(cap, multiple * referenceMs);
  return { ratio, multiple, budget, passes: buildMs <= budget, catches2x: 2 * buildMs > budget };
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

test('§145-§147 model operations, compile and views stay within their budgets', async (t) => {
  const measured = {};
  const next = deadlines();
  const time = (k, fn, repeats, budget = PERF_BUDGETS[k]) => {
    measured[k] = { ...measure(fn, budget, { repeats, deadlineMs: next() }), budget };
  };
  // The yardstick first, in the same process and on the same clock as the build. The build is
  // re-measured while it is over the bound; its budget is then derived from what it measured.
  const reference = measure(() => referenceWork(), Infinity);
  time('build', () => buildLargeStudio(freshStore()), 5,
    Math.min(PERF_BUDGETS.build, BUILD_REFERENCE_RATIO * reference.min));
  const derived = buildBudget(reference.min, measured.build.min);
  measured.build.budget = derived.budget;
  measured.build.ok = derived.passes;
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
    + ` build / reference ${ratio.toFixed(2)} (bound ${BUILD_REFERENCE_RATIO}, budget `
    + `${derived.multiple.toFixed(2)} x the reference; the bound alone fails a build `
    + `${(BUILD_REFERENCE_RATIO / ratio).toFixed(2)}x as slow as this one)`);
  for (const [k, v] of Object.entries(measured)) {
    t.diagnostic(`${k.padEnd(14)} ${v.min.toFixed(3)} ms (wall ${v.wall.toFixed(3)}, budget `
      + `${v.budget.toFixed(1)}, ${v.batches} batch(es))`);
  }
  for (const [k, v] of Object.entries(measured)) {
    const of = k === 'build' ? ` (the smaller of ${PERF_BUDGETS.build} ms and `
      + `${derived.multiple.toFixed(2)} x the reference's ${reference.min.toFixed(2)} ms, at most `
      + `${BUILD_REFERENCE_RATIO} x; build / reference ${ratio.toFixed(2)})` : '';
    assert.ok(v.ok, `${k}: ${v.min.toFixed(2)} ms of CPU time > budget ${v.budget.toFixed(2)} ms`
      + `${of}, the fastest of ${v.batches} batch(es) within ${REMEASURE_DEADLINE_MS} ms (all`
      + ` operations within ${TOTAL_DEADLINE_MS} ms); wall ${v.wall.toFixed(2)} ms at load ${load}`);
  }
  await t.test('a build twice as slow as the measured one is over its budget', (st) => {
    if (!derived.catches2x) {
      st.skip(`build / reference is ${ratio.toFixed(2)} here, at most 1: the build costs no more `
        + 'CPU time than the product-free reference, so no budget both passes it and fails it '
        + 'doubled (the reference is not measuring the build on this runner)');
      return;
    }
    assert.ok(2 * measured.build.min > measured.build.budget, `a build twice as slow `
      + `(${(2 * measured.build.min).toFixed(2)} ms) would pass its budget `
      + `${measured.build.budget.toFixed(2)} ms (build / reference ${ratio.toFixed(2)})`);
  });
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

const pick = ({ budget, passes, catches2x }) => ({ budget, passes, catches2x });
test('§145-§147 the build budget passes the measured build and fails it doubled', () => {
  const opts = { cap: 1000, bound: 9, margin: 1.9, floor: 2 };
  // CI run 41190815003: reference 845.62 / 9 ms, build 710.81 / 2 ms, build / reference 3.78.
  const ref = 845.62 / 9;
  for (const r of [3.78, 6, 9]) {
    const b = buildBudget(ref, r * ref, opts);
    assert.ok(b.passes, `r ${r}: the measured build is within ${b.budget} ms`);
    assert.ok(b.catches2x && 2 * r * ref > b.budget, `r ${r}: twice the build is over the budget`);
  }
  assert.ok(Math.abs(buildBudget(ref, 3.78 * ref, opts).multiple - 1.9 * 3.78) < 1e-9,
    'r 3.78: the budget is 1.9 x the measured ratio, under the bound');
  assert.equal(buildBudget(ref, 6 * ref, opts).multiple, 9, 'r 6: the bound binds');
  assert.equal(buildBudget(ref, 9 * ref, opts).multiple, 9, 'r 9: the bound binds');
  // The fixed budget of 9 x the reference before this: at r 3.78 a build twice as slow passed.
  assert.ok(2 * 3.78 * ref <= Math.min(1000, 9 * ref), 'the CI flake: 7.56 x is under 9 x');
  // A 2x regression measured by a later run: the bound fails it where r was above 4.5 (the
  // Mac's 6 becomes 12), and cannot where r was 3.78 (7.56 is within 9; over 2.38x fails).
  assert.equal(buildBudget(ref, 2 * 6 * ref, opts).passes, false, 'r 6 -> 12: fails');
  assert.equal(buildBudget(ref, 2 * 3.78 * ref, opts).passes, true, 'r 3.78 -> 7.56: passes');
  assert.equal(buildBudget(ref, 9.01 * ref, opts).passes, false, 'over the bound: fails');
  // The cap: never above 1000 ms; a build over it fails, one under it doubled is over it.
  assert.equal(buildBudget(200, 1100, opts).budget, 1000);
  assert.equal(buildBudget(200, 1100, opts).passes, false);
  assert.deepEqual(pick(buildBudget(200, 600, opts)), { budget: 1000, passes: true,
    catches2x: true });
  // The floor: at r <= 1 no budget both passes the build and fails it doubled.
  assert.deepEqual(pick(buildBudget(100, 90, opts)), { budget: 200, passes: true,
    catches2x: false });
  assert.deepEqual(pick(buildBudget(100, 101, opts)), { budget: 200, passes: true,
    catches2x: true });
  // The defaults are the fixture's bound and the 1000 ms budget.
  assert.deepEqual(buildBudget(50, 300), buildBudget(50, 300,
    { cap: PERF_BUDGETS.build, bound: BUILD_REFERENCE_RATIO, margin: 1.9, floor: 2 }));
});

test('§145-§147 the reference workload is fixed and product-free', () => {
  const sum = referenceWork();
  assert.equal(referenceWork(), sum, 'deterministic');
  assert.ok(sum > 0);
  const src = referenceWork.toString();
  assert.ok(!/store|dispatch|validate|Studio/i.test(src), 'no product code in the yardstick');
});
