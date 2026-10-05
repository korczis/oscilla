---
schema: adr/v1
id: adr-0039
kind: adr
title: "Studio runtime truth: plan identity, applied record and divergence"
status: proposed
date: 2026-10-04
tags:
  - studio
  - runtime
  - diagnostics
  - v31
related:
  - rule:project.studio-model-is-canonical
  - rule:project.audio-engine-discipline
  - rule:project.single-file-deliverable
  - file:src/js/studio/validate.js
  - file:src/js/studio/compiler.js
  - file:src/js/studio/runtime.js
  - file:src/js/studio/transport.js
  - file:src/js/ui/studio/graph-view.js
  - file:docs/v31/compiler.md
  - test:tests/unit/v31-studio-runtime-truth.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/studio/runtime.js
    - file:src/js/studio/transport.js
    - file:docs/v31/compiler.md
---

# 39. Studio runtime truth: plan identity, applied record and divergence

## Context

ADR 0030 makes the StudioModel the one canonical state, and ADR 0035 compiles it into the one
AudioEngine in transactions. The screen must never show one topology while Web Audio runs
another (specification §1). A read-only audit of the code as of v3.4.0 found that the
repository could not state that as data:

- The compiled plan had no identity. Two plans could only be compared object by object.
- The runtime did not record what it had committed. `compiledRevision` also moved on an apply
  while stopped, when nothing runs.
- Divergence between the store and the runtime was detected by object identity
  (`plan.model === model` in `graph-view.js` `runtimeStatus`). That is not a verdict a test, a
  log or an agent can read.
- Reasons were prose. Compiler node and edge reasons, runtime warnings (`apply` flattened them to
  strings on one branch and returned objects on the other) and transport warnings and unplayed
  reasons could only be told apart by parsing text.
- `transport.syncNow` adopted the store's model even when `runtime.apply` refused it. The
  transport then scheduled clips and lanes and claimed parameters of a graph that was not running,
  so the transport and the runtime disagreed.

## Decision

Proposed:

- **One diagnostic shape.** `{ code, severity, owner, entity: { kind, id } | null, message,
  details? }`, built by `validate.js` `studioDiagnostic`. `owner` is one of `validate`,
  `compiler`, `runtime` and `transport`. The existing validation diagnostic is extended and keeps
  `path`, `nodeId?`, `edgeId?` and `detail?`, so no parallel type exists. Plan nodes and edges,
  runtime handles and routes, and transport unplayed entries carry a `code` beside their display
  `reason`. Runtime and transport warnings are lists of diagnostics, and any text list is derived
  from them. A consumer branches on `code` and never parses `message`. The codes are listed once,
  in `docs/v31/compiler.md` "Diagnostics".
- **Plan identity.** `planHash(plan)` is SHA-256 of the canonical JSON of `{ v, studioHash,
  nodes: [id, type, adapter compiler key, status, code], edges: [id, kind, from, to, status,
  code] }` in compile order. It uses the same helpers as `studioHash`, runs on first read, is
  memoized per immutable plan, and never runs on the audio path.
- **Applied record.** `runtime.applied()` → `{ revision, studioHash, planHash, at }`, set only
  when a transaction commits (`start`, `apply` while running). It is `null` while stopped, and a
  refused apply leaves it unchanged. `at` is wall-clock ISO text for people and is never used for
  audio timing. `lastError` names the revision it refused.
- **Divergence as data.** One pure function, `studioDivergence({ model, revision }, runtime)`,
  returns `{ state: 'not-applied' | 'in-sync' | 'refused' | 'behind', desired, applied, reason }`.
  A stopped runtime is `not-applied`. A refusal of the desired revision is `refused`, with the
  runtime's diagnostic. An applied record of another revision that was not refused is `behind`.
  A record is matched by revision, or by `studioHash` when the caller has no revision.
  `runtimeStatus` and `studioStatus` consume the verdict instead of object identity.
- **The transport follows the runtime.** When `runtime.apply` refuses a synced model, the
  transport keeps the model, owned parameters and schedule of the graph that still runs. It
  records the refusal as `lastError` with code `sync-refused` and a diagnostic, and `sync()`
  returns `ok: false`.

## Alternatives rejected

- **A second diagnostic type for runtime and transport.** Two shapes for one concept invite
  consumers that handle only one of them. Extending the validation diagnostic keeps every
  existing reader working.
- **Hashing the plan eagerly in `compileStudio`.** Every compile, including the status compile on
  every edit while stopped and the transaction inside the commit gate, would pay a SHA-256 for a
  value that is mostly never read. Lazy and memoized costs nothing until someone asks.
- **Keeping the applied record after STOP.** A record that outlives the graph would describe
  something that no longer runs. `not-applied` comes from the runtime state either way. A cleared
  record cannot be misread.
- **Divergence by object identity or by comparing models deeply in each view.** Identity breaks as
  soon as an equal model is rebuilt. A per-view comparison is the drift that ADR 0030 rejects.
- **Revision-only matching.** Callers without the store revision (tests, offline tools) would get
  no verdict. The `studioHash` fallback makes a presentation-only change `in-sync`, which is the
  truth about what sounds.

## Consequences

- A test, the debug panel or an agent can answer "is what plays what the model says?" from
  `debugInfo()` alone: `applied`, `diagnostics`, and the verdict.
- `debugInfo().unplayed` entries gain `code`. `transport.sync()` can now return `ok: false`. The
  transport's `'warning'` event passes a diagnostic, and its two listeners (the workspace warning
  line, the offline render) read `message`.
- Bundle cost. The data layer adds about 1 KB gzip to `dist/index.html` (measured with
  `npm run verify-dist`, see the change's report). Against a budget that had less than 1 KB of
  headroom, the gzip budget is the constraint any further runtime-truth surface must be weighed
  against.
- No new UI surface. The workspace keeps its existing status text. Showing the verdict to users
  is a separate decision.
- Confirmation criteria: built and tested by `tests/unit/v31-studio-runtime-truth.test.mjs`
  (each test fails on the code before this change: the diagnostic shape and codes for
  validation, compiler, runtime and transport; no string flattening; planHash determinism and
  sensitivity; the applied record only on commit; the four divergence states; the `syncNow`
  refusal). Revised if a consumer needs a reason the codes cannot express, which then gets a
  code, not a parsed message.

## Resolution notes

Appended; the decision and consequences above are left as written.

### 2026-10-04: the verdict is shown to users in the Studio Inspector

The consequence "no new UI surface; showing the verdict to users is a separate decision" is
resolved by that decision: the Studio Inspector (nothing selected) carries a Runtime section
built only from `studioDivergence`, `runtime.applied()` and the runtime and transport
diagnostics (`inspector.js` `runtimeView`, a pure view model). Two facts the surface needed for a
true answer were added to the record, not derived in the UI:

- `lastError` records the refused model's `studioHash`, and a refusal counts only while that
  hash is the desired model's: under the commit gate a refused revision number is reused by the
  next commit, so revision equality alone reported "Failed" for a document that never played.
  `lastError` is cleared when that revision later commits.
- Transport diagnostics describe the current playback only (PLAY empties them; a refusal drops
  out once a later model is applied), and `prepare-failed` / `edit-refused` / `sync-refused`
  name the entity whose preparation threw.

Tests: `tests/unit/v31-studio-runtime-view.test.mjs`, `tests/browser/v31-studio-runtime.cjs`.

### 2026-10-05: the record is true after a failure in commit; codes are never read from text (v4.0 closure audit)

- **Applied record (F4).** "Set only when a transaction commits" assumed the commit could not
  fail halfway. It could: a throw after the plan swap left `plan` on the new revision and the
  record on the old one, and the store refused the edit, so the verdict said in-sync while the
  runtime ran another model. A throw after the swap is now a runtime warning (`<step>-failed` or
  `commit-failed`) and the transaction commits, so the record, the store revision and the plan
  agree (ADR 0035 resolution note of the same date).
- **One diagnostic shape (F5).** Four producers still derived a code from prose or carried no
  code: `patches.js` mapped `/longer than|between/` to `limit-exceeded` (a future
  `studioSchemaVersion` got "must be between 1 and 1", `limit-exceeded`); `validateStudioImport`
  mapped `/import limit/` (an unknown node type quoting those words got `limit-exceeded`); the
  transport de-duplicated warnings by message, so a `sync-refused` with the text of an earlier
  `edit-refused` was dropped; and a refused PLAY stored `{ phase, message }`. Codes are now given
  where each check is made (`createChecker` `add(path, text, code)`; `unsupported-version` for a
  newer Studio schema), the transport keeps one diagnostic per code and entity, and its
  `lastError` is a Diagnostic plus `phase` with `disposed`, `claim-failed`, `claim-refused` or
  `play-refused`. The workspace's status compile that throws shows `compile-failed` on every node
  instead of a blank status.

Tests: `tests/unit/v40-studio-runtime-closure.test.mjs`; codes listed in `docs/v31/compiler.md`
"Diagnostics".
