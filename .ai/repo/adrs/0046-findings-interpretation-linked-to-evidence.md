---
schema: adr/v1
id: adr-0046
kind: adr
title: A finding is an interpretation linked to the evidence it rests on, never measurement truth
status: proposed
date: 2026-10-06
tags:
  - experiments
  - findings
  - evidence
  - storage
  - v4
related:
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md
  - file:.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md
  - file:.ai/repo/adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md
  - file:.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md
  - rule:project.no-fake-science
  - file:src/js/experiments/findings.js
  - file:src/js/experiments/store.js
  - file:src/js/ui/findings.js
  - file:src/js/ui/experiments.js
  - file:docs/v4/completion-ledger.md
  - test:tests/unit/v4-findings.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/v4/completion-ledger.md
---

# 46. A finding is an interpretation linked to the evidence it rests on

## Context

The v4 completion ledger lists "Findings linked to evidence" as missing capability 3. The
owner's scope decision of 2026-10-05 put it after the definition/run split (ADR 0043) and the
evidence on a run (ADR 0044), deepening the measurement wedge without a new workspace or a meta
layer. Until now the glossary said that OSCILLA had no finding object: a user who concluded
something from two runs could only type it into a run's annotation notes, where it was tied to
one run, carried no status and pointed at nothing.

Three things must not be confused:

- a **measurement** is what was observed or computed: a stored run, immutable (ADR 0040);
- an **observation** is what the user recorded about it;
- a **finding** is the user's interpretation, linked to the evidence it rests on.

A finding that blurs into the first would present an opinion as a result, which the
no-fake-science rule forbids in spirit; a finding that floats free of evidence is a note.

## Decision

Proposed:

- **The model.** `src/js/experiments/findings.js`, pure. A finding is
  `{ kind: 'oscilla-finding', schemaVersion: 1, id, statement, status, evidence, runs, notes,
  createdAt, updatedAt }`. The statement is one line of plain text; notes may wrap.
- **Status is categorical.** `observation` (recorded, not interpreted), `hypothesis`,
  `supported`, `contradicted`, `inconclusive`. There is no confidence number or score. A
  `supported` or `contradicted` finding must cite at least one reference; the validator refuses
  it otherwise. The interface says that a status is the user's judgement, not a measurement.
- **Typed, unambiguous references.** `{ kind: 'run', experimentId }`, `{ kind: 'compare', a, b }`
  (two different runs, A first, as the compare view orders them) and
  `{ kind: 'value', experimentId, at: { hz } }`, the stored grid point ADR 0044's lineage traces
  (the run detail records it at the point the Evidence section shows). Duplicates and unknown
  fields are refused.
- **A cited run's identity is its id and its result hash.** An id alone is not an identity: a
  run can be deleted and a different record stored under the same id. Each finding therefore
  carries `runs: [{ experimentId, resultHash }]`, exactly one entry per cited id, taken from the
  stored run when the reference is linked. An export carries it, so the evidence identity
  travels with the file.
- **Untrusted input.** Validation builds a clean copy from known fields only. It refuses a
  non-plain object, any unknown key (so `__proto__` and `constructor` never pass), HTML-like
  markup (`<` followed by a letter, `/`, `!` or `?`; a comparison written "A < B" passes),
  control characters, bidirectional overrides, ids outside the id pattern, a frequency that is
  not above 0 Hz or beyond 192 kHz, and sizes over the limits (statement 1000 characters, notes
  10000, 32 references, 2000 findings and 8 MiB per file). The page renders every text with
  `x-text`, never as markup.
- **Storage.** The `findings` object store (keyPath `id`) in the existing experiments database,
  added by DB version 4; the upgrade creates it and deletes nothing. The memory fallback holds
  findings with the same API, and `held().findings` reaches the unsaved-work guard (ADR 0045),
  so findings kept in page memory are reported as losable. Findings are user metadata: no
  finding write touches a run, and deleting a run never touches a finding. A stored finding
  that fails validation is listed as unreadable and never hides the others; its `createdAt`
  never changes.
- **Integrity is reported, never repaired.** `findingIssues(finding, lookup)` returns, in
  reference order: `missing-run` (the run is not stored here: deleted, or never imported; the
  reference reads "missing: … is not stored here"), `wrong-kind` (the id names a stored
  definition, not a run), `different-run` (a run is stored under the id, but its result hash
  differs from the cited one), `no-response` (a value reference to a run that stores no
  frequency response), and `unsupported-status` (the finding claims supported or contradicted
  but none of its references resolve here). The finding keeps its status and its references;
  the user decides. The delete dialog of a run says how many findings cite it.
- **Export and import.** `.oscilla-findings.json`:
  `{ kind: 'oscilla-findings', schemaVersion: 1, exportedAt, oscillaVersion, findings }`.
  The whole file is validated before anything is stored; a newer file or finding schema is
  refused with that reason. A finding stored here under the same id with different content
  refuses the whole import (never overwritten silently); an identical one is skipped. The
  store's `putFindings` checks and writes in one transaction, so a refused import writes
  nothing. Cited runs that are not in this browser read "not stored here", and the import
  notification says how many.
- **UI inside the Experiments workspace.** No new workspace: a Findings panel under the saved
  experiments (a real list; each finding an item with its statement as a heading, its status in
  words and its references as a list, with Open, Edit and Delete), a "Findings that cite this
  run" section in the run detail with "Record a finding about this run" and, when the run has a
  response, "Record a finding about the value at …", and "Record a finding about this
  comparison" in Compare (A compared with each other run). A comparison reference reads "what
  changed between the runs, not why", and the dialog says the same; nothing in this interface
  attributes a cause. The dialog is a native modal (keyboard reachable, Escape closes it); a
  finding being written counts as losable work for the unsaved-work guard.

## Alternatives rejected

- **A confidence number or score.** It would invite a number to stand for a judgement, as ADR
  0044 rejected for reproducibility.
- **Findings inside the run record (annotations).** A finding can cite several runs, and a run
  is immutable apart from its name and notes (ADR 0040); a finding spanning runs cannot belong
  to one of them.
- **Nulling or removing a reference when its run is deleted.** That would silently change what
  the finding says it rests on.
- **Cascading the deletion of a run to its findings.** A finding is the user's work; losing it
  because evidence was removed is data loss.
- **Refusing to delete a cited run.** The user owns the runs; the dialog states the consequence
  instead.
- **An id-only reference.** It cannot tell a re-imported identical run from a different record
  stored under the same id.
- **A new Findings workspace.** The owner's steer: no new workspace; findings belong next to
  the runs they cite.
- **Allowing markup and escaping it at render time only.** Rendering as text is kept as the
  second defence; refusing markup at the boundary keeps an exported file safe for any other
  reader.

## Consequences

- DB version 4. A tab still holding version 3 open blocks the upgrade, which the store already
  reports as unavailable and falls back to memory for.
- A finding's identity of a run is read once per id per page view (the experiments store
  verifies the record on read) and forgotten when the id leaves the list.
- Closing the finding dialog (Cancel or Escape) discards the draft; the guard protects it only
  against leaving the page.
- Confirmation criteria: `tests/unit/v4-findings.test.mjs` (statuses, evidence required for
  supported and contradicted, typed references, the identity list, prototype pollution, markup,
  control and bidirectional characters, sizes, a newer schema; every integrity issue; the memory
  and IndexedDB stores, the atomic import, the DB 3 to 4 migration, deletion of a cited run;
  export and import round-trips; the workspace adapter and the guard) and check `findings` in
  `tests/browser/v3-ui.cjs` (record from a run with the keyboard, link a comparison, set
  supported, the backlinks, the export carrying the result hash, deleting the cited run with
  the dialog's warning and the missing reference, 390 px, light theme; chromium, firefox and
  webkit over file:// and /oscilla/).
