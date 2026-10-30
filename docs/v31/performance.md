# OSCILLA Studio performance (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §145-§147 ("responsive at ~100 nodes, 200
edges"), §250. Plan issue V431. This document records the measured numbers and the budgets the
tests hold them to; the reasons for the editor's design (custom HTML nodes, one SVG layer,
targeted drag updates) are ADR 0034.

## The fixture

`tests/unit/fixtures/v31-large-studio.mjs` builds a 100-node / 200-edge Studio through the store,
one dispatched action per node and edge, each validated like a user's edit: 20 chains
Oscillator → Filter → Gain → Pan, five Mixers into a sixth, the Master Output, and 13 LFOs on
115 parameter inputs. It is acyclic and every input is single, as the registry declares.

## Budgets

One copy, `PERF_BUDGETS` and `BROWSER_BUDGETS` in the fixture module, used by the tests and
checked against this table by `tests/unit/v31-studio-docs.test.mjs`. A budget is what an
interaction may cost: one 60 Hz frame (16.7 ms) for what a single gesture commits, a few frames
for whole-document work. The unit test compares each budget with the fastest repeat of the
operation's main-thread CPU time (`process.threadCpuUsage`); the browser suite measures wall
time in the browser.

Why CPU time (plan E029): the operations are synchronous JavaScript on the main thread, so their
wall time is their CPU time plus the time the scheduler gave other processes. On the shared Mac
at loads of 55-110 on 18 cores (2026-10-29) the second part was most of it: the fastest of 15
builds took 2459 ms of wall time and 280 ms of CPU time, and the 1000 ms wall budget failed on
every batch (1138-3262 ms), however often it was re-measured. Main-thread CPU time is what a
frame pays; helper threads (concurrent GC, the compiler) do not block it and are not counted.

The build has a second bound, relative to the machine. Its 1000 ms is about 3.5 times its cost,
so on its own it would pass a build twice as slow. The build's CPU time may be at most
`BUILD_REFERENCE_RATIO` times the CPU time of `referenceWork()`, a fixed workload of no product
code in the build's shape (300 steps growing a 100-node / 200-edge graph of plain objects, each
followed by a JSON round trip and a check of the whole graph), measured first in the same
process on the same clock. The test also asserts that twice the measured build is over the
bound, so a bound that a faster build left loose fails and names the ratio to lower it to.

| Where | build / reference |
| --- | --- |
| Apple M5 Pro (arm64), Node 22.20.0, loads 79-112, 2026-10-29 | 5.5-6.5 |

An operation whose fastest repeat is over its budget is re-measured in further batches,
keeping the running minimum, until it is within budget or `REMEASURE_DEADLINE_MS` (20 s, wall
clock) passes; all operations together share `TOTAL_DEADLINE_MS` (60 s), so the file stays
well inside fail-first's 180 s per-file timeout. A failure names the CPU and wall minimum, the
batch count and the load.

<!-- budgets:begin -->
| Operation (fastest repeat) | Budget (ms) |
| --- | --- |
| build | 1000.0 |
| dispatchMove | 16.7 |
| dispatchParam | 16.7 |
| dispatchEdge | 16.7 |
| undoRedo | 16.7 |
| validate | 16.7 |
| compile | 50.0 |
| hash | 50.0 |
| exportImport | 100.0 |
| summary | 16.7 |
| search | 16.7 |
| inspector | 16.7 |
| compact | 16.7 |
| browser importMs | 3000.0 |
| browser editMs | 50.0 |
<!-- budgets:end -->

## Measured (development machine)

Apple M5 Pro, Node 22.20.0, Playwright 1.63.0 browsers, 2026-10-03.

Model, compiler and views (`node --test tests/unit/v31-studio-performance.test.mjs`, fastest of
15 after a warm-up; wall time on a quiet machine, before E029):

| Operation | What it covers | Median (ms) |
| --- | --- | --- |
| build | 100 NODE_ADD + 200 EDGE_ADD through the store, each validated (whole fixture) | 128 |
| dispatchMove | one NODE_MOVE (positions are not re-validated) | 0.04 |
| dispatchParam | one NODE_PARAM_SET with the whole-model validation | 1.0 |
| dispatchEdge | one EDGE_REMOVE (validated) and its undo | 1.0 |
| undoRedo | one undo and one redo | 0.03 |
| validate | `validateStudioModel` (typed ports, Tarjan cycle check, timeline) | 0.76 |
| compile | `compileStudio` (topological plan, statuses) | 0.96 |
| hash | `studioHash` (canonical JSON, SHA-256) | 2.4 |
| exportImport | project file export and the full import pipeline | 7.2 |
| summary | the accessible graph summary | 0.38 |
| search | `searchNodes` ("filter 1") | 0.59 |
| inspector | the Inspector view of a node | 0.20 |
| compact | the Playground compact view | 0.95 |

Since review V272 A1 (2026-10-18) every validated dispatch is judged by `validateStudioCommit`,
which adds the untrusted import's stages and a normalized-form check to `validateStudioModel`.
Measured against the commit before it on the same fixture and machine (fastest of 15, under
load): build 113 → 326 ms, dispatchParam and dispatchEdge 0.7 → 1.5 ms; NODE_MOVE is unchanged.
Both stay well inside their budgets.

Graph editor in real browsers (`tests/browser/v31-studio-workflows.cjs`, check
`large-graph-render`, file://, 1536x1024): opening the fixture as a project file through the
import path and its first render (two animation frames), then one edit with every projection
(store dispatch → compile → editor, Inspector, compact widget), one node move, and Frame All,
median of 9:

| Browser | Open + first render | NODE_PARAM_SET | NODE_MOVE | Frame All |
| --- | --- | --- | --- | --- |
| Chromium | 55-115 ms | 4.5-8.5 ms | 3.5-6.7 ms | 0.2-0.4 ms |
| Firefox | 78-141 ms | 6-11 ms | 4-9 ms | 1 ms |
| WebKit | 250-850 ms | 6-13 ms | 5-10 ms | ≤ 1 ms |

Ranges are separate runs; WebKit's first render is slowest after the rest of the suite has run
(250 ms on a fresh page). A node drag never dispatches before the gesture ends and moves only
the dragged nodes and their cables (§61-§62, §146-§147), so its per-frame cost does not grow
with the graph.

## What is not measured here

- Hundreds of timeline clips (§145) are bounded by the timeline editor's own tests
  (`tests/browser/v31-studio-timeline.cjs`), not by this fixture.
- Audio rendering cost depends on the nodes, not on the editor; the runtime's incremental
  patcher is covered by `tests/browser/v31-studio-audio.cjs`.
