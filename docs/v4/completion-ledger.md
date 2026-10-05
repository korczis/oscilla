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
| Runtime transaction (prepare/commit) | ✓ | ✓ | partial | – | ✓ | – | ✓ | prepare only | PARTIAL (R1, R2) |
| Operation trace (Studio) | ✓ | – | ✓ | ephemeral by design | ✓ | – | ✓ | ✓ | EXISTS (gaps: locate, edges) |
| Sequencer / timeline / automation | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | PARTIAL (clip-target policy duplicated, R7) |
| Studio Microphone node | ✓ | ✓ | never enabled | – | inert | – | – | asserts degraded | BROKEN (R3) |
| Experiment definition / plan | recipe only | recipe | engine runs recipe directly | ✓ | setup | configHash | – | ✓ | MISSING → #116 |
| Measurement run (state machine, cancel, repeats) | ✓ | ✓ | ✓ | aggregate only | ✓ | ✓ | ✓ | ✓ | EXISTS (no retry/attempt record) |
| Calibration (level, frequency profile) | ✓ | ✓ | ✓ | session only | ✓ | **wrong at Save** | ✓ | ✓ | BROKEN (D1, D2) |
| Quality | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | glyph + shape | ✓ | EXISTS |
| Run store, immutability, baseline | ✓ | ✓ | – | IndexedDB / memory | ✓ | ✓ | ✓ | ✓ | EXISTS (unverified-import marker missing) |
| Import / export / migration | ✓ | ✓ (validate before put) | – | ✓ | ✓ | hash recomputed | – | ✓ | EXISTS |
| Semantic comparison | ✓ | – | – | – | ✓ | ✓ | ✓ | ✓ | EXISTS |
| Studio provenance on a measurement | ✓ | ✓ | ✓ | ✓ | – | over-records unused nodes | – | partial | PARTIAL (D3) |
| Raw data retention | – | – | engine `keepRaw` | none | none | – | – | – | MISSING (no stated policy) |
| Findings | – | – | – | – | – | – | – | – | MISSING |
| Cross-domain Trace (result → run → definition → build → Studio) | – | – | – | – | – | – | – | – | MISSING |
| Knowledge explorer | – | – | – | – | static About | – | – | – | MISSING |
| Project model | singletons | – | – | split by domain | – | – | – | – | PARTIAL |
| Workspace navigation / history / deep links | ✓ | – | – | URL only | ✓ | – | ✓ | ✓ | PARTIAL (W2, W3) |
| Unsaved-work protection | – | – | – | – | – | – | – | – | MISSING (W2) |
| `.ai/` knowledge layer | ✓ | doctor (local only) | – | – | – | – | – | Studio claims only | PARTIAL (K1–K4) |

## Findings and where they stand

### P0

| Id | Finding | Evidence | Status |
|---|---|---|---|
| D1 | Frequency-profile calibration is snapshotted at Save, not at completion: measure with A, load B, Save → record names B while its quality mask came from A | `ui/measure.js` experimentOf, `measure-experiment.js:66`; probe | fixing: branch `fix/measurement-evidence-at-completion` |
| D2 | A level calibration made after an uncalibrated measurement is recorded as used (dB SPL for an uncalibrated run); environment notes read at Save | `ui/measure.js:1557-1601`, `:861`; probe | same branch |
| K1 | Generated bootstraps claim a worktree pre-commit guard, rule `project.worktree-topology` and `docs/WORKTREES.md` — none exist | AGENTS.md:38, CLAUDE.md:103, GEMINI.md:29 (from Majordomus 0.12 templates; fixed upstream in majordomus #783) | fixing: branch `docs/knowledge-tells-the-truth` (repo override) |
| K2 | `project.no-fake-science` claims a grep enforcement nothing performs, and contradicts dB SPL under level calibration (ADR 0017) | rule v1 Verification; no test | same branch (rule v2 + real test) |
| R1 | A refused PLAY leaves the Studio Master level on the shared engine (MEASURE, Labs, Playground inherit it); `dropAll` does not restore it | `adapters/nodes.js:743`, `runtime.js:441-447, 649, 659`; master-leak.mjs | fixing: branch `fix/studio-runtime-closure` (P0 if MEASURE output passes through it — being verified) |

### P1

| Id | Finding | Status |
|---|---|---|
| R2 | Runtime commit phase not exception-safe: a throw after the plan swap leaves the applied record stale (hidden divergence) | fixing: `fix/studio-runtime-closure` |
| R3 | Studio Microphone node can never be enabled; help text points to a control that does not exist | fixing: `fix/studio-runtime-closure` |
| W1 | Deleting the open Studio project leaves it looking saved; the next template replaces the graph without the unsaved-changes prompt (data loss) | fixing: `fix/studio-runtime-closure` |
| W2 | No `beforeunload` guard, no history entries; reload/Back silently loses unsaved Studio work and an unsaved measurement | open |
| W3 | README privacy statement omits the `studio` / `studioSummaries` stores | fixing: `docs/knowledge-tells-the-truth` |
| C1 | Unbound manual level calibration applies to every input | open |
| D3 | Studio provenance hashes unconnected nodes, so identical measurements read as an execution change | open |
| D4 | Schema accepts five stimulus kinds the engine cannot run; Repeat of such a record silently runs a log sweep | open |
| K3 | No CI job consumes the `.ai/` layer; claim guarding stops at Studio claims | fixing: `docs/knowledge-tells-the-truth` |
| K4 | Hand-written CLAUDE.md is stale (V2, ADRs 0011-0029, 3 of 8 rules) | same branch |
| A1 | About page overstates enforcement | same branch |
| X1 | #116 review: one invalid definition row breaks the Experiments workspace and save retries duplicate runs | fixing in #116 |

### P2 (tracked)

Diagnostic codes derived from message text (R5, fixing); clip-target policy duplicated between
registry, timeline UI and transport (R7); pattern-played Oscillator frequency lanes drive a
silent carrier (R8); presentation-only edits pay a full compile while playing (R9);
`mode`/`workspace` split state and three hash routers (W4); Space has two meanings and two
shortcut dialogs (W5); disabled controls without a reason (W6, partly fixing); WebKit absent from
engine/dsp/labs/sequencer CI and the About provenance tests skip in CI's shallow clone (CI1);
no startup budget or large-library fixture (P1); `window.OSCILLA` test seam and `?mock=1` ship
in production (W7); five dead CSS classes; an import without a hash shows no "unverified"
marker; an unreadable stored record fails silently; ADR status never leaves `proposed`; the plan
contradicts git (V386 READY, M033 BLOCKED); "run" means both a repeat and a completed
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
