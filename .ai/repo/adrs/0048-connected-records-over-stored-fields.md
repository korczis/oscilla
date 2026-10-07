---
schema: adr/v1
id: adr-0048
kind: adr
title: Connected records come from stored fields only, and read present only when the identity verifies
status: proposed
date: 2026-10-06
tags:
  - experiments
  - findings
  - studio
  - navigation
  - evidence
  - v4
related:
  - file:.ai/repo/adrs/0038-measurement-topology-inside-studio.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md
  - file:.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md
  - file:.ai/repo/adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md
  - file:.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md
  - file:.ai/repo/adrs/0046-findings-interpretation-linked-to-evidence.md
  - rule:project.no-fake-science
  - rule:project.studio-model-is-canonical
  - file:src/js/experiments/connections.js
  - file:src/js/core/url-state-records.js
  - file:src/js/ui/connections.js
  - file:src/js/ui/navigation.js
  - file:docs/v4/completion-ledger.md
  - test:tests/unit/v4-connections.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/v4/completion-ledger.md
---

# 48. Connected records come from stored fields only, and read present only when the identity verifies

## Context

The v4 completion ledger lists "Cross-domain Trace over real stored relations" as missing
capability 4 (matrix row "Cross-domain Trace (result → run → definition → build → Studio)",
MISSING). The owner's steer of 2026-10-05 asks for depth over breadth, fewer new nouns and
more working verbs, with acoustic measurement as the wedge: no new workspace and no graph drawn
for its own sake. From any stored record a user should get two answers: what is this connected
to (upstream: what produced it or what it rests on), and what depends on it (downstream: what
cites it or was made from it).

The records already point at each other through stored fields, but nothing followed them. A
experiment's detail named its definition version as text, and a repeat named its original only
inside the evidence lineage. A finding listed its references, but from an experiment the user
could not reach a finding that cited it, or from a definition the experiments that executed it,
or from a saved Studio project the experiments measured from its graph.

Two words were taken. *Trace* is the Studio operation trace (ADR 0042: one operation, in
memory, not evidence). *Lineage* is evidence's trace of one value within one experiment (ADR 0044).
Neither describes links between records.

## Decision

Proposed:

- **The word.** The interface says **Connected records**. A row has no noun of its own: it is
  named by its relation ("A repeat of", "Cited by"). "Trace" would claim the Studio operation
  trace's meaning. "Lineage" would say that a finding or a repeat is an ancestor of a value,
  which it is not: a finding cites an experiment, it did not produce it. "Connected" claims no
  direction or cause, so the two questions carry the direction: "What is this connected to?"
  and "What depends on it?". In Studio, "connection" means a graph edge between two ports, so
  record text never uses the bare word; this document and the code (`connections.js`, `cnx.*`)
  use it only as the internal name of a row. The stored record is an **experiment**; a **run**
  is one capture or repeat inside it (owner decision of 2026-10-07), so the record link key is
  `exp` and no record text says "run" for a saved record. The glossary has the entry, beside
  lineage and trace.
- **One stored field per connection, named.** `src/js/experiments/connections.js` is pure. It
  takes the subject record and an index of what this browser stores, and returns typed
  connections `{ direction, relation, from, to, field, fieldOf, state, text, href }`. Nothing is
  inferred: two experiments with the same name, recipe, definition or time are not connected
  unless one stores the other's id or hash. The lists are bounded (50 per direction), and what
  is left out is counted in words. A list over the bound puts the entries that are not *stored
  here* first, so the bound never hides one that is not fine, and the count says how many of
  the unlisted are not fine.
- **Present only when the identity verifies.** A connection reads *stored here* only when the
  target is stored, was read (a stored experiment is validated and its result hash recomputed on
  every read), and is the record the field names. Every other case says which:
  - *missing*: nothing is stored here under the id. It is listed, never hidden or repaired.
  - *does not match*: something is stored under the id, but not what the field names (another
    result hash, a definition without that version hash, a definition where an experiment was
    named).
  - *not verifiable*: the target is stored and readable, but the field records no identity to
    check (a repeat names its original by id only; a result hash is not stamped on one side; a
    build without a source digest).
  - *unreadable*: a record is stored under the id, but it fails validation or its result hash
    does not verify.

  Between a finding and the experiments it cites, the states are not derived a second time: they are
  `findings.js` `findingIssues` (ADR 0046, after review 1 of #149) mapped one to one. No issue
  is *stored here*, `missing-experiment` is *missing*, `unreadable-experiment` *unreadable*,
  `unverifiable-identity` *not verifiable*, and `different-experiment`, `wrong-kind`,
  `no-response` and
  `not-a-grid-point` *does not match*, each with the issue's own words. The findings panel and
  the connected records therefore never disagree about one reference.

  Each state is a word at the start of the sentence, and a state other than the verified one
  also has a border, so colour is never the only signal. *Stored here* is said only of a record
  in the store. A build and a frequency profile are never stored, so their two entries have
  their own words (review 1 of #151): the build reads *running here* (this page's build has the
  same version and source digest) or *not running here*; the profile reads *loaded here* (the
  profile loaded in Measure now has that id) or *not loaded*.
- **The connections implemented, each with its field:**

  | From | Connection | Stored field | Present when |
  |---|---|---|---|
  | experiment | executed from definition (up) | `definition` (id, version, hash) | a stored definition has that version with that hash (`storedMatch`) |
  | experiment | a repeat of (up) | `provenance.repeatOf` | never: a repeat records no identity of its original, so it reads *not verifiable* when stored |
  | experiment | a duplicate of (up) | `provenance.duplicateOf` | the original's recomputed result hash equals the copy's (a duplicate keeps it) |
  | experiment | measured from the graph of a Studio project (up) | `studio.studioHash` | a stored project's graph, loaded and recomputed by `studioHash`, has that hash |
  | experiment | measured path held by a Studio project (up) | `studio.measured.hash` | a stored project's measured path, recomputed by `measuredPath` and `measuredPathHash` in the same version, has that hash (only for projects whose whole graph differs) |
  | experiment | frequency profile named (up) | `calibration.frequency.id` | the profile loaded in Measure has that id (the SHA-256 of its points) |
  | experiment | made by build (up) | `provenance.build` | the running build has that version and source digest (and artifact SHA-256 when both are stamped) |
  | experiment | cited by finding (down) | the finding's `evidence[i]` with `experiments[j].resultHash` | `findingIssues` reports nothing for that reference (the recorded hash equals the experiment's; a value names a stored grid point) |
  | experiment | repeated by (down) | the repeat's `provenance.repeatOf` | never: *not verifiable*, as above |
  | experiment | duplicated as (down) | the copy's `provenance.duplicateOf` | equal result hashes |
  | definition | executed by experiment (down) | the experiment's `definition` | `storedMatch` is `match` |
  | finding | cites experiment (up), per experiment id of each reference (a, b of a comparison) | `evidence[i]` with `experiments[j].resultHash` | `findingIssues` reports nothing for that reference |
  | Studio project | measured from this graph, or its measured path, by experiment (down) | the experiment's `studio.studioHash` / `studio.measured.hash` | equal recomputed hashes |

  The Studio connection is a stored relation because an experiment stores the hashes of the graph it
  was measured from (ADR 0038). A project is matched only by the hash recomputed over it as it
  loads (the full import pipeline, then `studioProvenance`), never by the `studioHash` its
  library row stores, and never by name. When no stored project has the graph, the connection
  reads *missing*: the experiment keeps the graph itself in its Studio block, not a project id.
- **Left out, and why.**
  - *Baseline*: a mark on one experiment that comparisons default to, not a reference to another
    record.
  - *A comparison as a record*: a comparison is not stored; it exists as a record only inside a
    finding, where it is listed as the two experiments it names.
  - *The level calibration*: it is stored inside the experiment, not referenced.
  - *A Studio project's patches or template*: a project stores no reference to a patch or a
    template, so there is no field to follow.
  - *Builds as records, and the experiments of a build*: a build is not stored; only the running
    build can be compared.
  - *Equal recipes (configHash)*: equal setups are a similarity, not a reference.
  - *Two hops*: a connection is direct. The findings that cite the experiments of a definition are
    reached by following the experiment's link.
- **Storage.** No new store and no database version: `store.js` list rows carry `links`
  (`runLinks`: the result hash, `repeatOf`, `duplicateOf` and the Studio hashes an experiment
  stores), written by `put` and `annotate`, so the experiments that name a record are found
  without reading every record. A row written before this version has no `links`; the adapter
  reads that record once per page view for its links (discovery only, never an identity) and
  rewrites nothing.
- **One verification point.** Every experiment a connection names is verified, on every compute,
  by `findingsVerifyCitedExperiment` (ui/findings.js, review 3 of #149): fresh from the store, which
  validates the record and recomputes its result hash, never from a cache. Its answer (ok,
  different, unverifiable, unreadable, missing; the stored hash and grid) is the only identity
  `connections.js` sees, so the findings panel and the connected records share one check and no
  identity is kept between computes. Following a link to an experiment shown as stored here
  verifies it again at that moment, with the hash it was listed with: an experiment that changed
  since the list was read is not opened, the notice says why, and the list is read again. The
  record opened is then read from the store once and the detail is set from that read, and only
  when it has the listed hash: never a decoded copy kept under the id.
- **What an entry states and what was verified are one record.** An entry's substance (the
  field it names, the name) comes from the experiment's list row; its identity comes from the
  verification read. When the two differ (the row's result hash is not the verified one: the
  record was replaced while the list was read), the list is read again, twice at most; after
  that the row's entries read *not verifiable* and say that the record changed while the list
  was read. The verification point returns no links, so a list row altered by hand under an
  unchanged hash is not detected; that is left open (see the PR).
- **The entries under a detail are those of the record it shows.** The detail's section takes
  the result hash of the record the detail renders. When the record stored under the id has
  another hash, or is gone or unreadable, nothing is listed under the old heading: the list is
  read again first, which brings the detail to the stored record (or closes it) and says so,
  and the entries are then read for the record shown. Returning to Experiments reads the list
  again in the same way.
- **Never the workspace's decoded copy.** The record a view is about, and every experiment it
  names, is read from the store, never from the decoded records `ui/experiments.js` keeps.
  Another tab may have replaced an experiment under its id since this tab decoded it (review 2
  of #149): returning to Experiments or any stored change reads the shown connections again, and
  the replaced experiment then reads *does not match*.
- **Navigation (amends ADR 0045).** A fourth hash domain, `records`: `m=experiments` with one of
  `exp=<id>`, `def=<id>` or `finding=<id>` (`core/url-state-records.js`). It is refused whole
  when malformed, like the Studio and recipe links. Without `m`, a record key routes to
  Experiments, after `m` and before `mr`. The record keys leave the address with Experiments,
  like the Studio keys. The address names the experiment the detail shows on every path
  (replaceState, no new entry): when one is opened, when the detail closes or is replaced, on
  return to Experiments, and after a link to a record that is not stored (the notice says so and
  the address names what is shown again). An address that names a definition or a finding a
  link opened is kept until an experiment is opened. Following a connection is a new entry.
  ADR 0045 re-applied no domain on Back /
  Forward. This decision re-applies `records` alone (`HISTORY_DOMAINS`): opening a stored record
  replaces nothing the user made, so Back after following a connection returns to the record
  the user came from. The other domains are still not re-applied. Focus moves to the opened
  record's heading (the experiment detail's title, a definition's or finding's name) unless a dialog
  is open.
- **Studio.** A Studio project is never opened by a link. A Studio link never carries a project
  (§200), and loading one would replace the open graph. A connection to a project switches to
  Studio and opens its Projects and patches dialog at that project, focused, with its connected
  records open. Focus lands on that project's "Connected records" disclosure, which names the
  project, never on a button; every row button names its project ("Open <name>"), and Open over
  unsaved Studio changes asks first ("Replace unsaved changes") before it replaces the graph.
  That dialog lists, for each saved project, the experiments whose stored graph hash or
  measured-path hash equals the project's. Its links go through the same verified path: the
  dialog closes only once the experiment is verified, and a refused link leaves the dialog
  open, says why and reads that project's list again. The dialog's list is read when its
  disclosure opens and after a refusal, not on every stored change. The adapter reads the
  projects through Studio's own library
  (`studioLibrary`), the store Studio saves to, even where both fall back to page memory.
- **Where it shows.** No new workspace. There is a "Connected records" section in the experiment
  detail after Evidence. Each definition row and each finding row has a "Connected records"
  disclosure (a native `details`, computed when opened), and so does each project in Studio's
  dialog. Each connection reads: the relation, the target as a link, the state sentence, then
  "Field: <path>, on <this experiment | that experiment | this finding | that finding>".
  Everything is rendered as text. Returning to Experiments, or any stored change, reads the
  entries shown in Experiments again (Studio's dialog: see above).

## Alternatives rejected

- **A graph view or a new workspace.** That is the owner's "meta layer pursued for its own
  sake". Two lists answer the two questions where the user already is.
- **"Trace" or "lineage" for the user-facing word.** Both are taken (ADR 0042, ADR 0044), with
  meanings that would turn a citation into a cause.
- **Present by id alone.** An id is not an identity. A deleted experiment's id can hold a different
  record (ADR 0046's review), and a corrupt record must never read as fine.
- **Matching Studio projects by name or by their stored `studioHash` field.** A name is not an
  identity. A stored field is not recomputed, and a migrated project could carry a hash its
  loaded graph no longer has.
- **Opening a Studio project from a link.** That would replace the open graph without the
  explicit Open the unsaved-work rules require, and §200 keeps projects out of links.
- **A DB version that rewrites every list row.** It rewrites stored data for a derived index.
  Reading the older rows' records once per page view costs less and changes nothing.
- **Re-applying every domain on Back / Forward.** As in ADR 0045, that would replay instrument
  values over later changes. Only the read-only `records` domain is re-applied.

## Consequences

- An older row costs one record read per page view, and so does each experiment a shown connection
  names. A shown list reads at most 50 targets per direction.
- A repeat is never "stored here" from either side: it records no identity of its original.
  The words say so instead of showing a check it cannot pass.
- The address now names the open experiment. A copied link opens that experiment only in a
  browser that stores it, and anywhere else says it is not stored here.
- The gzip size grows by about 11 KB (the module, the adapter, and the markup repeated in the
  three record views); the PR states the measured figure.
- The labels of the two Studio relations say what is compared ("Its graph hash is that of",
  "Its measured-path hash is held by"), not that the project is the origin: every stored
  project with an equal hash gets the entry, including one saved after the measurement.
- Confirmation criteria: `tests/unit/v4-connections.test.mjs`, failing on the base before the
  implementation (the record link and its refusals; `runLinks` and the store rows; every
  connection above in each state; nothing inferred; the bounds; the records hash domain; the
  adapter over stores, older rows read once, Studio projects recomputed after a save, and a
  record link); check `connections` in `tests/browser/v3-ui.cjs` (a record link opens the
  experiment with focus on its heading, both directions with their fields, Enter on a
  connection, Back and Forward, a finding's connections, an impostor under a cited id reads
  "does not match", a record altered under its hash reads "unreadable" after a reload, 390 px)
  and check `connections-two-tabs` (an experiment replaced from another tab is never "stored
  here" from this tab's decoded copy), in Chromium, Firefox and WebKit over file:// and
  /oscilla/; check `connections-from-studio` in `tests/browser/v31-studio-workflows.cjs` (an
  experiment measured from a saved project names it, the dialog names the experiment back, both
  links work, and a node added outside the measured path leaves only the measured-path
  connection).
