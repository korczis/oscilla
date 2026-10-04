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
for whole-document work. The times below (the fastest of the repeats) are 10-100 times under them, so a budget fails on a
real regression (an accidental O(n²) per action), not on a slower CI runner.

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
15 after a warm-up):

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
