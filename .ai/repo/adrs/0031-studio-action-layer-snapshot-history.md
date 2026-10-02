---
schema: adr/v1
id: adr-0031
kind: adr
title: Every Studio mutation is a dispatched action reduced into a new immutable model; undo and redo restore earlier snapshots
status: proposed
date: 2026-10-02
tags:
  - studio
  - data-model
  - undo
  - v31
related:
  - rule:project.studio-model-is-canonical
  - claim:studio-exact-undo-redo
  - claim:studio-subgraph-paste
  - file:src/js/studio/actions.js
  - file:src/js/studio/history.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/history.js
    - issue:V402
---

# 31. Every Studio mutation is a dispatched action reduced into a new immutable model; undo and redo restore earlier snapshots

## Context

Undo and redo are mandatory from the first integrated release for node, edge, clip,
automation and track edits (specification §47-§52). A 400-event drag must be one history
item, and a new edit after undo must clear redo. Edits arrive from the graph editor, the
Inspector, the timeline, keyboard shortcuts, the accessible connection dialog, paste and
patch load. Ad hoc DOM handlers that each mutate state cannot be undone uniformly. The
specification leaves the history mechanism to architecture and memory cost (§49).

## Decision

Proposed:

- The store (`createStudioStore`) is the only writer. Every semantic change is
  `dispatch({ type, ... })` with a closed set of action types (NODE_ADD ... METADATA_SET,
  PASTE, DUPLICATE). A reducer produces a new model with structural sharing; the whole
  result is validated (ADR 0032, ADR 0033) and an error rejects the action with its reason,
  leaving model, history, selection and revision untouched.
- History is immutable snapshots, not command objects with inverses: each entry holds the
  model references before and after, and undo restores the earlier reference exactly.
  `beginGesture` / `endGesture` fold a continuous gesture into one labelled entry
  ("Move Filter 1"); `cancelGesture` (Escape) returns to the gesture's start without an
  entry. A new edit after undo clears redo.
- Selection and view changes are dispatched too but are not history entries and do not
  raise the revision.
- `revision` is monotonic in memory; it is what the incremental patcher (ADR 0035) and dirty
  state key on.

## Alternatives rejected

- Command objects with hand-written inverses: about 25 actions with cascades (deleting a
  node removes its edges, clips and lanes and clears track targets) means 25 inverse
  functions that can drift from their actions; snapshots cannot.
- DOM snapshots: forbidden (§49), and they would capture rendering rather than meaning.
- Unbounded history: memory grows without limit in a long session.

## Consequences

- An entry costs only the changed path (about 1-2 KB at 100 nodes), so a bound of 200
  entries stays well under 1 MB.
- Every new feature that changes the model adds an action type and a reducer, never a
  direct write; the compiler observes model changes and never originates them.
- Confirmation criteria (built and tested now): undo-all returns the initial model by
  reference and byte-equal serialization, redo-all the final one; 400 moves are one entry;
  a new edit after undo clears redo; a rejected action changes nothing. Revise toward a
  command log if measured history memory exceeds about 5 MB in the large-graph test
  (specification §250).

## Recorded values

Recorded as Majordomus decisions and repeated here: `STUDIO_HISTORY_LIMIT` is 200 entries;
`PASTE_OFFSET` is (24, 24) logical units for paste and duplicate.
