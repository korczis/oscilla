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
| Knowledge explorer | – | – | – | – | static About | – | – | – | DESCOPED (ADR 0051, proposed) |
| Method claims on evidence ("Why trust the method?" on a saved experiment) | – | – | – | – | – | – | – | claim-prose id check only | MISSING (ADR 0051; built after #149 and #151) |
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
engine/dsp/labs/sequencer CI and the About provenance tests skip in CI's shallow clone (CI1,
**closed** #147: WebKit legs in both jobs, nothing narrowed; the unit job checks out full
history and tags, and the About checks fail instead of skipping under CI without them);
no startup budget or large-library fixture (P1); `window.OSCILLA` test seam and `?mock=1` ship
in production (W7, **decided and partly fixed** #161, ADR 0052: they stay in the one tested
artifact; three hooks now refuse what they must, but an unchecked input can still read
CALIBRATED outside TEST CONTEXT by two hook sequences, W7f, open; see "W7" below);
`studioTimeline.createContext` builds a second Studio store and transport on the shared engine
for one browser suite (W7a, open); TEST CONTEXT cannot be entered or left from the page, only by
the URL (W7b, open); a manual level calibration made in TEST CONTEXT is not labelled as one (W7c,
open); the public origin `korczis.github.io` is shared with every other Pages site of the
account (W7d, open); the live smoke calls seam hooks instead of loading the documented
`?measure=loopback#mr=` URL (W7e, open); no caller reads the verdict `setValues` now returns, a
non-boolean toggle value is coerced instead of refused, and the v3-ui `calibration` check
depends on the check before it (W7g-W7i, open); five dead CSS classes; an import without a hash shows no "unverified"
marker; an unreadable stored record fails silently; ADR status never leaves `proposed`; the plan
contradicts git (V386 READY, M033 BLOCKED; **closed** #144, see "plan reconciled" below); "run" means both a repeat and a completed
experiment, and "project" both a Studio file and OSCILLA (**partly closed** #162, ADR 0053 and
`docs/GLOSSARY.md` "Run", "Experiment", "Project": a run is one capture, an experiment is the
stored record, and the page, the UI controllers, the record views and the About view say so,
held by `tests/unit/vocabulary.test.mjs`; still open: the same renames inside #149 and #151
before they merge, and the import, validation and store messages and the derived-definition
wording that the ADR's Consequences lists); the glossary exists since #120.

## What v4.0 still lacks entirely

These are release criteria of the v4.0 brief that no code implements yet. They are built only
as real, tested slices, in dependency order, never as placeholders:

1. Experiment definition separate from run (#116, in review).
2. Evidence on a run: a value traced through stored provenance, and a reproducibility checklist.
3. Findings linked to evidence.
4. Cross-domain Trace over real stored relations.
5. Unsaved-work protection and navigation history in the workspace.
6. ~~A knowledge explorer fed by a build-time index of claims, features, rules, ADRs and
   releases.~~ — descoped by ADR 0051 (proposed); replaced by method claims on a saved
   experiment's Evidence (item 7).
7. "Why trust the method?" on a saved experiment's Evidence: for each recorded algorithm id,
   the published claim that covers exactly that version with its test, or a plain statement
   that none does (ADR 0051). Open; built after #149 and #151 land.

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

## Update 2026-10-06 — CI1

CI1 is closed by #147. The engine and DSP/labs/sequencer jobs run WebKit (Linux runner, 44.1 kHz)
with every check, the five engine microphone checks included (Playwright's WebKit mock device,
granted by permission). Two of the suites could not have run WebKit before: `dsp.cjs` ran 0 checks
and `labs.cjs` launched Chromium under any other name; every suite now refuses an unknown browser.
The About timeline checks run in CI against full history and tags (`tests/unit/about.test.mjs`).

## Update 2026-10-07 — knowledge explorer descoped (ADR 0051, proposed)

Item 6 is descoped by decision, not built: v4.0 ships no knowledge explorer and no build-time
index of claims, features, rules, ADRs or releases. The owner approved the direction on
2026-10-07, steering by: "depth over breadth; fewer new nouns, more working verbs; acoustic
measurement is the wedge; the meta-layer must not grow for its own sake; Majordomus must pay
rent; the single file is not a religion". ADR 0051 holds the reasons and the preconditions for
reopening it; the descoping counts once the owner marks that ADR accepted.

Its replacement is item 7, one list on a panel that already exists. It is open, and it is built
in its own pull request after findings (#149) and connected records (#151) land, because all
three edit the Evidence section.

Shipped with the decision, at 0 bytes in `dist/index.html`: the impulse-response note in
`docs/CLAIMS.yaml` named `oscilla.ir.farina-inverse.v1` as the test oracle while the default,
which the test runs, is v3. `tests/unit/knowledge-integrity.test.mjs` now fails on any algorithm
id in claim prose that is not a current default, unless the line says it is retained; it failed
on that note before the fix.

The release blockers recorded above are unchanged by this update.


## Update 2026-10-07 — W7

W7 is decided by #161 (ADR 0052, proposed; the owner approved the direction on 2026-10-07) and
fixed in part: the three guards below hold, and W7f is what they leave open, so W7 is not closed.
`window.OSCILLA` and `?mock=1` stay in the one `dist/index.html` that is tested and deployed:
removing or gating them would protect nothing (`window.Alpine` is global and the origin is
shared) and the post-deployment smoke would stop testing the served bytes. What was wrong was
what two hooks could do outside TEST CONTEXT, and one hook that could do what no user can:

- `measure.showResult` titled a result without a `testContext` "Latest measurement" and Save
  stored it as an ordinary experiment. It now refuses such a result.
- `measure.setInputNow` named an input nobody checked; a typed level reading then bound to it
  and the indicator read CALIBRATED. A direct call is now refused outside TEST CONTEXT loopback.
  The indicator can still be reached by two other sequences (W7f).
- `measure.setValues` was a bare `Object.assign`. It is now the validated recipe-link action:
  unknown keys, out-of-range values and calls while a measurement runs are refused whole, and a
  READY setup check is reset as by any edit.

Each has a test that failed before the change (`tests/unit/v4-seam-contract.test.mjs`); the
release gate pins the key lists of `window.OSCILLA` and `OSCILLA.measure` and asserts the
refusals on the built page (`seam-surface-pinned` in `tests/browser/app.cjs`). The README names
the stable reads and says the seam is not a security boundary.

Recorded as their own P2 lines, open, and not part of #161. W7f is the remainder of W7 itself;
the review of #161 rated the claim that it was closed P1, and #161 withdrew the claim instead of
widening the approved change:

| Id | Finding | Status |
|---|---|---|
| W7a | `studioTimeline.createContext` (`src/js/ui/studio/timeline-test-seam.js`) builds a second StudioStore, runtime and transport on the shared engine, used only by `tests/browser/v31-studio-timeline.cjs` (`project.studio-model-is-canonical`): move the suite onto the canonical store, then delete the module and the `studioTimeline` key | open |
| W7b | TEST CONTEXT can be entered and left only by the URL: `input-devices.js` disables the Input device select while loopback is on, so a `?measure=loopback` user cannot return to a microphone without editing the address. Add a TEST CONTEXT option to the select | open |
| W7c | A manual level calibration made in TEST CONTEXT carries no TEST CONTEXT label; only the captured branch of `measureSaveLevelCalibration` adds it | open |
| W7d | The public origin `korczis.github.io` is shared by every Pages site of the account, so their scripts share OSCILLA's storage, IndexedDB and microphone grant. Independent of the seam; only a custom domain changes it | open |
| W7e | The live smoke calls `useLoopback` and `setValues` instead of loading `?measure=loopback#mr=<recipe>`, and no test or script loads the documented `?measure=loopback` flag at all | open |
| W7f | An unchecked input still reads CALIBRATED outside TEST CONTEXT through seam hooks alone. Route A: `useLoopback()`, `setInputNow(input)`, `useMicrophone()`; leaving TEST CONTEXT does not clear `ctx.inputNow` (the device-change path does), and a typed level reading then binds to it. Route B, never entering loopback: `showResult(result)` with a `testContext` and an `input`; the inner `showResult` adopts `result.input`, and the typed reading binds to it. Fix: clear the input when the seam enters or leaves loopback and do not adopt an injected result's input outside loopback, with both sequences as tests in `tests/unit/v4-seam-contract.test.mjs` and a full v3-ui run. Beyond the three guards approved on 2026-10-07: needs the owner's nod | open |
| W7g | `setValues` returns `true` or `{ ok: false, errors }` and no caller reads it: `live-smoke.cjs`, `navigation.cjs`, `app.cjs` (setup helper) and every v3-ui call site discard it. It validates the whole setup, so one out-of-range value typed into a field (the page's edit checks only that a number is finite) makes every later call refuse, and v3-ui runs its checks on one page. Make the shared setup helpers throw unless the call returns `true`; in the live smoke this goes with W7e | open |
| W7h | `setValues` coerces a toggle value to a boolean (`{ phase: 'no' }` sets `true`) instead of refusing it. Reject a non-boolean toggle before the encode step | open |
| W7i | The v3-ui `calibration` check run alone (`--only calibration`) no longer clears its input: its `setInputNow(null)` relies on TEST CONTEXT left on by the `live-rta` check before it. Call `useLoopback` at the start of the check when `v3-ui.cjs` is next edited | open |
| W7j | The `seam-surface-pinned` check has not been seen to fail on main's dist (its fail-first is inferred from the unit suite), and `live-smoke.cjs` has not been run locally against `file://dist` with this change; the machine's load stayed above the limit for local browsers. CI ran the check green in three browsers and two origins | open |
