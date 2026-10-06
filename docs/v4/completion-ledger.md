# OSCILLA v4.0 completion ledger

The working closure ledger for the v4.0 generation. It is built from evidence: four independent,
read-only audits of `main` at 27f7c62 (the V3.8 release) on 2026-10-05 (Studio and runtime; experiments,
runs and measurement; workspace, persistence, accessibility, artifact and CI; the `.ai/` layer
and docs), with tests run and failures reproduced by scripts. It is updated as items close; each
closed item names the pull request that closed it.

Status words: **EXISTS** (the whole user path works and is tested), **PARTIAL**, **BROKEN**,
**DUPLICATED**, **STALE**, **MISSING**. Priorities: **P0** (data integrity, false provenance,
hidden runtime divergence, false claim of enforcement), **P1** (broken user path, accessibility,
mobile, significant performance), **P2** (polish, debt).

## Baseline

| | |
|---|---|
| Release / commit | V3.8 / 27f7c62 |
| Unit tests | 2273 pass, 0 skipped |
| Browser (sampled) | app 29/29 (file, http), layout 99/99 ×3 browsers, qa-regressions 15/14/14 |
| Artifact | 2,619,813 B raw / 754,989 B gzip (zlib 9) |
| Budget | 3,500,000 / 1,000,000 (owner stopgap, #114) → 24.5 % gzip headroom |
| Largest contributors (gzip) | p5 vendor 250,364 (33 %), app bundle 416,022 (55 %; Studio 36 % of it) |
| Build | deterministic (`build.mjs --check` twice, identical sha256) |
| CI gate | aggregates all 7 jobs, a skipped job fails it |

## Completion matrix

| Capability | Model | Validate | Execute | Persist | UI | Provenance | A11y | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Studio model, desired/plan/applied, divergence | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | EXISTS — but see R1, R2 |
| Runtime transaction (prepare/commit) | ✓ | ✓ | ✓ (#119) | – | ✓ | – | ✓ | prepare + commit injection | EXISTS |
| Operation trace (Studio) | ✓ | – | ✓ | ephemeral by design | ✓ | – | ✓ | ✓ | EXISTS (gaps: locate, edges) |
| Sequencer / timeline / automation | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | PARTIAL (clip-target policy duplicated, R7) |
| Studio Microphone node | ✓ | ✓ | ✓ (#119) | – | Allow microphone | – | ✓ | ✓ | EXISTS |
| Experiment definition | ✓ (#116) | ✓ | engine runs the bound recipe | ✓ (append-only versions) | ✓ | definition ref in result hash v4 | ✓ | ✓ | EXISTS (no separate plan compiler) |
| Measurement run (state machine, cancel, repeats) | ✓ | ✓ | ✓ | aggregate only | ✓ | ✓ | ✓ | ✓ | EXISTS (no retry/attempt record) |
| Calibration (level, frequency profile) | ✓ | ✓ | ✓ | session only | ✓ | as applied (#121); bound to its input (C1, #139) | ✓ | ✓ | EXISTS |
| Quality | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | glyph + shape | ✓ | EXISTS |
| Run store, immutability, baseline | ✓ | ✓ | – | IndexedDB / memory | ✓ | ✓ | ✓ | ✓ | EXISTS (unverified-import marker missing) |
| Import / export / migration | ✓ | ✓ (validate before put) | – | ✓ | ✓ | hash recomputed | – | ✓ | EXISTS |
| Semantic comparison | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | EXISTS |
| Studio provenance on a measurement | ✓ | ✓ | ✓ | ✓ | evidence, compare | whole graph + measured path (D3, #139) | – | ✓ | EXISTS |
| Raw data retention | – | – | engine `keepRaw` | none | none | – | – | – | MISSING (no stated policy) |
| Findings | – | – | – | – | – | – | – | – | MISSING |
| Cross-domain Trace (result → run → definition → build → Studio) | – | – | – | – | – | – | – | – | MISSING |
| Knowledge explorer | – | – | – | – | static About | – | – | – | MISSING |
| Project model | singletons | – | – | split by domain | – | – | – | – | PARTIAL |
| Workspace navigation / history / deep links | ✓ | – | – | URL only | ✓ | – | ✓ | ✓ | PARTIAL (W2, W3) |
| Unsaved-work protection | – | – | – | – | – | – | – | – | MISSING (W2) |
| `.ai/` knowledge layer | ✓ | doctor (local + CI) | – | – | – | – | – | all claims, rules, refs | EXISTS (ADRs still `proposed`; plan stale) |

## Findings and where they stand

### P0

| Id | Finding | Evidence | Status |
|---|---|---|---|
| D1 | Frequency-profile calibration is snapshotted at Save, not at completion: measure with A, load B, Save → record names B while its quality mask came from A | `ui/measure.js` experimentOf, `measure-experiment.js:66`; probe | **closed** #121 (V3.9.2): the engine-applied calibration is recorded |
| D2 | A level calibration made after an uncalibrated measurement is recorded as used (dB SPL for an uncalibrated run); environment notes read at Save | `ui/measure.js:1557-1601`, `:861`; probe | **closed** #121 (V3.9.2); older contradicted records read as uncalibrated |
| K1 | Generated bootstraps claim a worktree pre-commit guard, rule `project.worktree-topology` and `docs/WORKTREES.md` — none exist | AGENTS.md:38, CLAUDE.md:103, GEMINI.md:29 (from Majordomus 0.12 templates; fixed upstream in majordomus #783) | **closed** #120: repo override states the convention; majordomus #783 merged upstream (via #786), not yet in a tagged release |
| K2 | `project.no-fake-science` claims a grep enforcement nothing performs, and contradicts dB SPL under level calibration (ADR 0017) | rule v1 Verification; no test | **closed** #120: rule v2 with a real scanner over all of `src/js` and `src/index.html` |
| R1 | A refused PLAY leaves the Studio Master level on the shared engine (MEASURE, Labs, Playground inherit it); `dropAll` does not restore it | `adapters/nodes.js:743`, `runtime.js:441-447, 649, 659`; master-leak.mjs | **closed** #119 (V3.9.1): confirmed P0 — MEASURE's stimulus plays through that gain |

### P1

| Id | Finding | Status |
|---|---|---|
| R2 | Runtime commit phase not exception-safe: a throw after the plan swap leaves the applied record stale (hidden divergence) | **closed** #119: post-swap failures are sticky Diagnostics, verdict `degraded` |
| R3 | Studio Microphone node can never be enabled; help text points to a control that does not exist | **closed** #119: Allow microphone, including re-allow while playing |
| W1 | Deleting the open Studio project leaves it looking saved; the next template replaces the graph without the unsaved-changes prompt (data loss) | **closed** #119: the open document detaches and stays unsaved |
| W2 | No `beforeunload` guard, no history entries; reload/Back silently loses unsaved Studio work and an unsaved measurement | fixing: branch `fix/unsaved-work-is-protected` (ADR 0045) |
| W3 | README privacy statement omits the `studio` / `studioSummaries` stores | **closed** #120: inventory test derives keys and stores from code |
| C1 | Unbound manual level calibration applies to every input | **closed** #139: a reading is stored only once an input is known and bound to it; an unbound calibration never applies to a known input; records say "not bound to an input" (ADR 0017 resolution) |
| D3 | Studio provenance hashes unconnected nodes, so identical measurements read as an execution change | **closed** #139: the Studio block also names the measured path with its own hash (experiment schema 4); compare classes changes outside it as unmeasured; earlier blocks record the whole graph and say so (ADR 0038 resolution) |
| D4 | Schema accepts five stimulus kinds the engine cannot run; Repeat of such a record silently runs a log sweep | **closed** #139: such a record imports with a finding and is kept; Repeat and "Run this definition" refuse it (ADR 0043 resolution) |
| K3 | No CI job consumes the `.ai/` layer; claim guarding stops at Studio claims | **closed** #120: knowledge-integrity test plus required CI `knowledge` job (pinned doctor) |
| K4 | Hand-written CLAUDE.md is stale (V2, ADRs 0011-0029, 3 of 8 rules) | **closed** #120 |
| A1 | About page overstates enforcement | **closed** #120 |
| X1 | #116 review: one invalid definition row breaks the Experiments workspace and save retries duplicate runs | **closed** in #116 before merge (V3.9.0) |

### P2 (tracked)

Diagnostic codes derived from message text (R5, fixing); clip-target policy duplicated between
registry, timeline UI and transport (R7); pattern-played Oscillator frequency lanes drive a
silent carrier (R8); presentation-only edits pay a full compile while playing (R9);
`mode`/`workspace` split state and three hash routers (W4, fixing with W2: one dispatcher, ADR 0045); Space has two meanings and two
shortcut dialogs (W5); disabled controls without a reason (W6, partly fixing); WebKit absent from
engine/dsp/labs/sequencer CI and the About provenance tests skip in CI's shallow clone (CI1);
no startup budget or large-library fixture (P1); `window.OSCILLA` test seam and `?mock=1` ship
in production (W7); five dead CSS classes; an import without a hash shows no "unverified"
marker; an unreadable stored record fails silently; ADR status never leaves `proposed`; the plan
contradicts git (V386 READY, M033 BLOCKED; **closed** #144, see "plan reconciled" below); "run" means both a repeat and a completed
experiment, and "project" both a Studio file and OSCILLA; no glossary.

## What v4.0 still lacks entirely

These are release criteria of the v4.0 brief that no code implements yet. They are built only
as real, tested slices, in dependency order, never as placeholders:

1. Experiment definition separate from run (#116, in review).
2. Evidence on a run: a value traced through stored provenance, and a reproducibility checklist.
3. Findings linked to evidence.
4. Cross-domain Trace over real stored relations.
5. Unsaved-work protection and navigation history in the workspace.
6. A knowledge explorer fed by a build-time index of claims, features, rules, ADRs and releases.

## Release decision at this baseline

**NOT READY FOR v4.0 RELEASE.** Blockers: D1, D2, K1, K2, R1 (P0); the missing capabilities
above that v4.0 promises (definition/run, evidence, findings, Trace).

## Update 2026-10-06 — after the closure PRs

Shipped: V3.9.0 (#116 experiment definitions), V3.9.1 (#119 runtime closure), V3.9.2 (#121
calibration as measured); #120 (knowledge truth) is live on Pages at b73e18b without a version
bump (docs-only by the release analyser). Every one passed two independent adversarial reviews.

**All five P0 findings are closed.** Open from this ledger: W2 (unsaved-work guard and
navigation history), C1 (unbound manual level calibration), D3 (Studio provenance over-records
unconnected nodes), D4 (schema wider than the engine), and the P2 list.

**Release decision now: NOT READY FOR v4.0 RELEASE.** No P0 remains; the blockers are the
v4.0 capabilities no code implements yet: evidence on a run (value trace and reproducibility
checklist), findings linked to evidence, cross-domain Trace, and W2.

## Update 2026-10-06 — measurement truth

C1, D3 and D4 are closed by #139, each with tests that failed before the change (unit
`tests/unit/v4-measurement-truth.test.mjs`; browser checks `calibration` and
`unmeasurable-stimulus` in `tests/browser/v3-ui.cjs` and `measure-from-studio` in
`tests/browser/v31-studio-workflows.cjs`). The evidence checklist of #129 keeps saying exactly
what a record holds: an unbound level calibration stays partial, a stimulus this build cannot
measure keeps "Recipe recorded" partial, and the Studio link names the measured path.

An independent review of #139 found that C1 was not yet closed in the engine: a calibration
bound to one input could be applied to a run captured from another when the workspace's input
check was stale. The engine now checks the input it captures from, records are cross-checked,
and the indicator waits for the input check (ADR 0017, review note); the review's other
findings (ids with a dot, records written as schema 4 without need, wording without a device
id) are fixed in the same pull request (`tests/unit/v4-review-139.test.mjs`).

With W2 handled by #130 (ADR 0045), the findings of this ledger still open are the P2 list.

## Update 2026-10-06 — plan reconciled with main (#144)

The stale V3 and V3.1 release issues were re-checked against `main` at caf7764, the latest release line.
Each issue now carries evidence recorded at that commit (`majordomus plan show <id>`), and its
derived status matches git. None of them is done: each one still lacks something real, named
below. Nothing was closed because a file exists.

| Issue | Now met | Still unmet |
|---|---|---|
| V386 Release 3.0.0 (M020) | public verify (spec 230): `verify-deploy` PASS, `test:live` 14/14 in three browsers incl. MEASURE and the Playground | rc first (spec 233). It cannot become true now, and `majordomus decision` writes only untracked `.ai/local`, so the deviation needs a tracked ADR (the owner decides). No release/v1 record for v3.0.0, because its GitHub Release has no asset |
| V431 Reviews (M032) | spec 235-237: `docs/v31/review-v431.md`, 30 findings, all fixed with tests; performance, bundle, licence, no runtime network | spec 272 final review: its "Majordomus completeness" and "release integrity" lenses are not covered by a recorded review whose findings are fixed. The PR reviews only cover their own diffs |
| V432 Studio docs and self-knowledge (M032) | spec 266 test `tests/unit/v31-studio-self-knowledge.test.mjs` (#73) passes | blocked behind V431. Spec 225: majordomus 0.13.2 indexes Studio feature records as kind `unknown`, which is an upstream gap |
| V433 Release 3.1 (M033) | public Studio smoke, including the Measurement Sweep template (spec 270); release/v1 records (the latest one passes `--check`) | blocked behind V432 and V386. Spec 269: no workflow or release script runs `test:live`, although its header says Pages does, and the smoke checks neither the compact Studio nor the timeline. Spec 270 checks node counts, not node kinds. Spec 259: no final Studio report. v3.1.0 has no release record |
