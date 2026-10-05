---
schema: adr/v1
id: adr-0042
kind: adr
title: "Studio operation trace: one correlation id, bounded, not evidence"
status: proposed
date: 2026-10-05
tags:
  - studio
  - runtime
  - diagnostics
  - v31
related:
  - file:.ai/repo/adrs/0035-compiled-into-existing-engine-incremental-patching.md
  - file:.ai/repo/adrs/0039-studio-runtime-truth-plan-identity-applied-record-divergence.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - rule:project.no-fake-science
  - rule:project.audio-engine-discipline
  - rule:project.single-file-deliverable
  - file:src/js/core/trace.js
  - file:src/js/studio/actions.js
  - file:src/js/studio/runtime.js
  - file:src/js/studio/transport.js
  - file:src/js/ui/studio/inspector.js
  - file:src/js/ui/studio/workspace.js
  - file:docs/v31/compiler.md
  - test:tests/unit/v31-studio-trace.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/studio/runtime.js
    - file:src/js/studio/transport.js
    - file:docs/v31/compiler.md
---

# 42. Studio operation trace: one correlation id, bounded, not evidence

## Context

ADR 0039 made "is what plays what the model says?" plain data: plan identity, the applied
record and the divergence verdict. The Inspector shows that verdict (its resolution note). The
verdict describes the present, not what one edit did. After an edit, nothing could answer
whether the runtime compiled it, whether the running graph took it, which AudioParam moved and
to what value, or why nothing moved. An automation lane owns the parameter, the transport is
stopped, or the runtime refused the transaction. The answers existed only as side effects: a
store revision, `runtime.lastOps`, a transport warning, the scheduling calls of an AudioParam.

The code already shares some ids end to end. The store revision is the one the commit gate
offers (ADR 0035, #86) and the runtime applies. A model node id is also the plan entry's id and
the runtime handle's id. What it lacked is an id for one attempt. A refused attempt spends no
revision, and its number is reused by the next commit.

## Decision

Proposed:

- **One bounded trace.** `core/trace.js` `createTrace({ cap, now, onIdle })` keeps a ring of
  `TRACE_CAP` (256) steps. A full ring drops its oldest step and counts it (`stats().dropped`).
  A step is frozen plain data, `{ op, seq, at, owner, kind, revision, entity: { kind, id } |
  null, outcome, code, detail }`, with a flat `detail` of primitives. `at` is the injected wall
  clock, never audio timing. Audio times are in `detail` (`at`, `end`), in the AudioContext's
  seconds.
- **A correlation id per operation.** `run(fn)` opens an operation, and every producer called
  inside the outermost run reports under one id, `op-<n>`. The id is assigned at the
  operation's first step, so ids are gapless and a run that records nothing is not counted.
  The commit gate's `transport.admit` → `runtime.apply` runs inside the dispatch, so one edit is
  one op from intent to AudioParam. The existing ids are kept: `revision` (in the store
  handle's numbering) and the node or edge `entity` id. No parallel ids are invented.
- **Exact coverage.** These are operations:
  - the store's semantic `dispatch` (selection and view changes are not traced), `undo`,
    `redo`, and a cancelled gesture's return (`cancel`);
  - the handle's `replace` (opening a project, a template or a file);
  - `transport.start`, `stop`, `sync` (including a wake-up's sync) and `admit`;
  - the transport's abort when the context closes or the runtime stops elsewhere (`stop`,
    `aborted`);
  - `runtime.apply` and `start` when called alone.

  `endGesture` changes no model and is not traced. These are not traced either: the timeline's
  scheduled clips and lane events, a pending handle settling (microphone permission), deferred
  disposals after a fade, and the Playground, Labs and MEASURE.
- **A narrow port, injected.** Producers receive `{ run, record }` at the Studio composition
  point (`workspace.js`) and default to `NO_TRACE`. The store, runtime and transport do not
  import each other to report, and the trace knows nothing about the Studio beyond the step
  schema.
- **Truth only (`project.no-fake-science`).** A step records what its producer did or observed:
  `requested`, `committed`, `compiled` with the `planHash`, `applied` at the crossfade time,
  `scheduled`, `built`, `retired`. A refusal or failure carries its Diagnostic code (ADR 0039:
  `prepare-failed`, `edit-refused`, `sync-refused`, `<step>-failed`, validation codes). What did
  not happen is stated: `not-applied` with `playing: false` when an edit is committed while
  stopped, and `not-applied` with the runtime state when the runtime only keeps the plan.
- **A `param` step is what the adapter reports it did.** The runtime gives `applyBase` and
  `update` a report object (`w`), and the adapter fills it at the point where it writes:
  - `applyBase` reports each AudioParam value it wrote, after its own clamp or conversion: an
    Oscillator's clamped frequency, a Filter's normalized frequency and Q, and a log edge's
    cents as `detune`. Each write that differs from the node's previous write is `scheduled`,
    a glide from `at`.
  - `update` reports how it acted on each live key: `set` or `glide` (`scheduled`, at `at`),
    `crossfade` (`scheduled`, with no single audio time), or `next-gate` (an Envelope: `stored`
    for the next gate).
  - A key the adapter did not act on is `stored`, with no audio time: the plan holds it (a view
    setting such as a Spectrum's scale, a Capture's pre-roll). If another owner drives it, it
    is `owned`.

  The report says what was written, not what the AudioParam renders after its glide. A builder
  that clamps inside itself (Noise's level floor) is reported with the value handed to it.
- **Surface.** The Inspector's Trace section (`inspector.js` `traceView`, pure) lists the
  operations newest first, each a disclosure with its steps as text. The outcome and code are
  words, never colour alone. The node view lists the operations that name the node. The section
  refreshes when an operation ends (`onIdle`). `?debug=1` shows the counts, and the test seam
  exposes the live trace.
- **Not evidence.** The trace is ephemeral and in memory only. It is never persisted, never
  exported with a project or an experiment, and never part of `studioHash`, `planHash` or
  `resultHash`. It explains a session and proves nothing about a recorded result.

## Alternatives rejected

- **Using the store revision as the correlation id.** A refused edit spends no revision. Its
  number belongs to the next commit, possibly of another document after a replace, so a
  refusal and a later success would share an id.
- **Recording what the runtime handed the adapter** (the first version of this change). An
  independent review showed it claimed `scheduled` for keys adapters ignore (a Spectrum's
  scale, a Capture's pre-roll), store for the next gate (Envelope stages) or crossfade (Noise
  colour, Filter bypass). It also claimed frequency cents that an owned detune never received.
  Only the adapter knows what it wrote.
- **Wrapping AudioParam methods to observe writes.** The adapter contract forbids reassigning
  them.
- **Tracing the timeline's wake-ups** (each scheduled clip and lane event). They are not
  operations anyone requested, and they would flush the ring every few hundred milliseconds
  while playing.
- **A per-node step for every PLAY.** A 100-node Studio would fill the ring with one PLAY. PLAY
  records its apply with node and edge counts.
- **Persisting the trace or attaching it to an experiment.** A log of one session is not a
  measurement fact, and an experiment's hashes must not depend on it (ADR 0040).
- **Computing `planHash` lazily in the trace** (a thunk per step). Steps would stop being plain
  data, and the ring would keep up to 256 plans alive. With a real trace, the hash is computed
  in `runtime.apply` before its transaction. That apply runs while playing (when `applied()`,
  read by every Graph and Inspector render, hashes the same memoized plan anyway), at PLAY and
  on `setOptions`. With the `NO_TRACE` port nothing is hashed and no write report is collected,
  so an untraced runtime (offline render, tests) pays nothing.
- **One operation per drag gesture.** The ring's cap is per step, so grouping a drag into one op
  would not keep older operations from being evicted. It would only make that op's step list
  longer. This is a known limit: a slider drag of 60 inputs records about 360 steps and evicts
  earlier operations, such as a refused edit. `stats().dropped` and the Trace note ("n of m
  shown") say so.

## Consequences

- A user, a test or an agent can answer "what did my last edit do to the running audio, and if
  nothing, why?" from the Trace section or `window.OSCILLA.studio.trace.steps()`.
- A refused dispatch result now also carries the edit's `label` (announcements still use
  `reason`).
- Cost. A dispatch while stopped records three steps, and a live parameter edit six or more.
  The Inspector rebuilds its operation list once per operation, after it has ended.
  The traced `NODE_PARAM_SET` on the 100-node fixture while playing stays within the one-frame
  `dispatchParam` budget (`tests/unit/v31-studio-trace.test.mjs`). Bundle: about +2.9 KB gzip
  (measured with zlib level 9 against main, see the change's report).
- The adapter contract gains the optional report argument `w` on `applyBase` and `update`
  (`adapters/nodes.js` header). Adapters that write nothing report nothing.
- Confirmation criteria: `tests/unit/v31-studio-trace.test.mjs` covers:
  - the ring's cap, drop count, order, frozen steps, gapless ids and settled steps;
  - one op from action to compile with `planHash`, apply and the AudioParam call;
  - a topology edit's node and route steps with the edge gain's ramp;
  - the refused live edit with `prepare-failed` and `edit-refused`;
  - an edit while stopped `not-applied`;
  - live keys that are `set`, `stored` or stored for the next gate;
  - a base write reported only when the adapter made it (an owned detune);
  - no `planHash` without a trace;
  - the store verdict as the headline;
  - cancel and replace as operations;
  - equal hashes and document with and without a trace;
  - the traced drag budget.

  Each fails on the code before this change. Browser checks `trace-edit`, `trace-stopped`,
  `trace-refused`, `trace-phone`, `trace-themes`, `trace-one-fill` and `trace-focus` in
  `tests/browser/v31-studio-runtime.cjs` run in Chromium, Firefox and WebKit. Revised if a step needs a cause the producer cannot observe; that cause
  then gets recorded where it is observed, never inferred in the view.
