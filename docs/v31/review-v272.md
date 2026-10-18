# V272: the final adversarial review of OSCILLA (spec §272)

Spec §272 asks for a final adversarial review of the architecture, the compiler, the runtime
lifecycle, the timeline, automation, accessibility, Majordomus completeness and release
integrity, with the question: "Find a way this architecture can lie, leak, drift or become
impossible to maintain. Fix valid findings." It is the open part of plan issue V431. The
V431 review (`docs/v31/review-v431.md`) covered architecture, UX and adversarial lenses of
the Studio, but not Majordomus completeness or release integrity, and its later reviews were
scoped to single changes.

## Method

Four independent Claude reviewers each reviewed main at 2d56148 (the V3.11 release line) through two of the
eight lenses. None of them wrote the code and none saw another's work. As in V431, independence
comes from separate contexts and the evidence rule below, not from different models; the owner
ruled out other providers.

| Reviewer | Lenses | Scope |
| --- | --- | --- |
| A | architecture, compiler | `src/js/studio/**`, the Studio ADRs, the model, port and engine rules |
| B | runtime lifecycle, timeline, automation | runtime, transport, timeline compiler, automation, offline render |
| C | accessibility | the Studio and its dialogs in the built page, chromium first |
| D | Majordomus completeness, release integrity | `.ai/`, the plan, claims, the release scripts, CI and Pages |

**Evidence rule.** Every finding came with a check that failed against the real code: a node
script over `src/js/**`, a playwright script against `dist/index.html` from file://, or a
command with its output. Where no check was possible, the reviewer gave the exact file:line and
a concrete scenario. Unsupported opinion was dropped. The coordinator re-ran every cited check
before accepting the finding. Each fix was written by a separate builder, never by a reviewer.
Each fix commit follows a test commit that fails on the code before it. Nine builders worked on
nine branches, split by file so their changes did not overlap. One integration branch merged
them and rebuilt dist once.

**Result.** 37 findings: 28 defects, 4 risks and 5 nits (A 9, B 11, C 9, D 8), plus 4 small
text corrections under D9. 35 are fixed with a test that fails before the fix. D2 and D3 need
the owner or Majordomus and stay open (below). Two more defects surfaced during integration and
are fixed (I1, I2).

## Findings

Class: **defect** violates the spec, an ADR or a rule, or is demonstrably wrong; **risk** is a
plausible failure with concrete evidence; **nit** is a small correctness or clarity issue.

### Architecture and compiler (A)

| # | Finding | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| A1 | The store committed models that the library saved and then refused to load: a 65th track, the 513th marker or node, a form feed in the notes, zoom 1e7, a 300-character event payload. | defect | One predicate, `validateStudioCommit`, used by dispatch, the initial model, save and export. It checks normalized form, the model rules and the import's own limits. `VIEW_LIMITS` bounds VIEW_SET. | `v31-studio-patches.test.mjs` "V272 A1" (two tests, one a seeded walk of 400 actions) |
| A2 | TRIGGER inputs on Random (`trigger`) and Step Modulator (`clock`) were accepted, compiled and drawn live, but nothing read them. | defect | The clock is implemented: the k-th trigger since PLAY sets value or step k on the audio clock, live and offline. A rate edge into a clocked node is inactive with its reason. | `v272-transport-lifecycle.test.mjs` "V272 A2" (five tests) |
| A3 | A muted TRIGGER edge still gated its Envelope. | defect | Muted edges gate and clock nothing; muting during playback reschedules the future clips. | "V272 A3" (two tests) |
| A4 | With two Transfer Analyzers, array order chose the measurement, and array order is not in `studioHash`, so genuine provenance failed to verify. | defect | Analyzers are ordered by id, and more than one Sweep reference reaching an analyzer is refused. | `v272-studio-measurement-recipe.test.mjs` "V272 A4" (two tests) |
| A5 | The measured path could be muted, or the Master Output set to 0, and the recipe did not change. | defect | A muted connection on the measured path is refused. A Master Output level other than the run's output level is refused, and the workspace passes that level (I2). | "V272 A5" (three tests) |
| A6 | The store could commit non-normalized models (pasted edge props, a three-element time signature), so a save failed its own `studioHash` check on load. | risk | PASTE completes edge props like EDGE_ADD. A time signature is `[beats, unit]`. Dispatch refuses a model that is not normalized. | "V272 A6" |
| A7 | An Oscillator's detune escaped the 0.95 × Nyquist cap: static detune, detune modulation and detune lanes. | defect | `computeBases` counts detune in the frequency headroom and reports `limitedEdges` / `limitedParams`. A detune lane is bounded by `detuneCeiling` and reported in `limitedLanes`. | `v31-studio-compiler.test.mjs` "V272 A7" (two tests); `v272-studio-automation.test.mjs` "V272 A7" |
| A8 | The recipe ignored clip order, gaps and the capture and analysis clips, although the docs say the recipe is what the timeline shows. | defect | Each phase needs exactly one clip, in engine order, back to back. The stimulus must be exactly the Sweep's length, and the capture clip must span pre-roll to tail. | "V272 A8" (two tests) |
| A9 | A patch named only with spaces imported as `''`, which Insert then refused. | nit | The trimmed name is validated. | "V272 A9" |

### Runtime lifecycle, timeline and automation (B)

| # | Finding | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| B1 | STOP then PLAY, before STOP's promise resolved, hard-stopped the new playback's voices (`project.audio-engine-discipline`). | defect | Each STOP disposes only its own playback's voices and gates. | `v272-transport-lifecycle.test.mjs` "V272 B1" |
| B2 | Any compiling edit while a Studio measurement hand-off was pending silently lost the measurement. | defect | `edit()` keeps future items it does not change. A 'cancel' that disarms the hand-off lets the following 'schedule' re-arm it. | "V272 B2" (two tests) |
| B3 | Editing a lane during playback left the parameter at the held old value when no lane event followed the horizon. | defect | The lane glides onto the new lane's value over `LANE_GLIDE_S`, then plays its events. | `v272-studio-automation.test.mjs` "V272 B3" (four tests) |
| B4 | A lane that reappeared during playback, on undo, started from a stale scheduler value with a step. | defect | A removed lane's events are dropped. A fresh lane anchors at the value the parameter really has and glides onto the lane. | "V272 B4" |
| B5 | An edit that did not touch the timeline flattened a sounding Envelope gate. | defect | Same root and fix as B2. | "V272 B5" |
| B6 | A changed modulation offset never reached an automation lane already scheduled, and `docs/v31/timeline.md` claimed it did. | defect | `afterApply` re-offsets lanes from the horizon; the false limitation is removed. | "V272 B6" |
| B7 | An exponential lane plus a linear offset was not lane + offset, with errors of 189 to 372 cents. | defect | On strictly positive parameters, a ConstantSource carries the offset and the lane schedules its authored values. | "V272 B7" |
| B8 | Locating while playing left stale lane records, so a later node replacement re-bound the lane wrongly. | defect | `applyStop` trims the lane records. | "V272 B8" |
| B9 | Nested gate clips on one Envelope closed it early, with no warning. | risk | Overlapping gates on one Envelope are one gate: their union. | `v272-transport-lifecycle.test.mjs` "V272 B9" (two tests) |
| B10 | The Inspector showed a value the engine was not producing (an automated parameter's base). | risk | An automated field reads "Base …" with a lane note, and its slider's value text says the lane overrides it. | `v31-studio-ui-graph-panels.test.mjs` "V272 B10" |
| B11 | The default WAV render dropped the end of the last clip. | nit | The default length covers the start lead, the timeline and the fade. | "V272 B11" |

### Accessibility (C)

| # | Finding | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| C1 | Four timeline actions dropped focus to `<body>`: deleting a lane's only point, removing a lane, undo with focus in the details panel, and the panel's Delete point. | defect | Focus goes to the next lane's add button, else the Automate tool, or to the object's fallbacks recorded before it went. | `v31-studio-graph.cjs` `v272-c1-timeline-focus` |
| C2 | Inspector number and text fields kept a refused value, with no visible error and no `aria-invalid`. | defect | A visible error, `aria-describedby` and `aria-invalid`; Escape or blur restores the model's value. | `v31-studio-graph.cjs` `v272-inspector` (c2*) |
| C3 | The Automate toggle did not follow the model, and `aria-pressed` misstated it. | defect | Plain actions "Automate <param>" and "Show <param> lane"; the rebuild key includes the automated state. Compact chips use `aria-current`. | unit "V272 C3"; `v272-inspector` (c3*) |
| C4 | Messages announced while a Studio dialog was open were hidden from screen readers. | defect | `announce()` also writes into live regions inside the top-most open dialog. | `v272-c4-dialog-live` |
| C5 | There was no keyboard way to select a subset of nodes. | defect | `T` toggles the focused node in the selection. Focus landing on a member keeps the selection. Listed in `STUDIO_SHORTCUTS` and the user guide. | `v272-c5-keyboard-multiselect`; `v272-ui-focus.test.mjs` |
| C6 | Small Studio labels failed contrast in the dark theme (4.24:1). | defect | The existing `--osc-text-muted` token is used; the visual references were re-accepted for this. | `v31-studio-graph.cjs` `dark-theme`; `v31-studio-timeline.cjs` `layout` |
| C7 | The Add node dialog never reported its search result. | defect | A `role=status` line, for example "No node type matches …" or "1 node type matches; Enter adds Filter.". | `v272-c7-add-status`; unit "V272 C7" |
| C8 | Inspector units were visible but not exposed to assistive technology. | nit | The unit is in each field's `aria-describedby`. | `v272-inspector` (c8*) |
| C9 | An out-of-range position was refused as "needs finite x and y", although 1e9 is finite. | nit | The message names the range, derived from `POSITION_LIMIT`. | `v31-studio-patches.test.mjs` "V272 C9" |

### Majordomus completeness and release integrity (D)

| # | Finding | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| D1 | The release-provenance intent and M035 said the public page proves the release commit. Pages deploys every push with the release version, so the page later showed the V3.11 release version over other code, and M035's validation passed on any HEAD. | defect | The stamp records the release state: only the release commit shows the bare version, and a later build shows `<version>+<distance>.g<short>` (ADR 0059). verify-deploy and live-smoke check it. The intent and M035 are restated, and every live validation pins its commit. | `release-provenance.test.mjs` "V272 D1"; `release-validation-pins.test.mjs` |
| D4 | Evidence `commit:` was never validated; M034 and V251 cited a commit that exists nowhere. | defect | Every evidence commit must be in the history, apart from an explained list of squash-merged PR heads. The two records now say the commit was not preserved and name the rebased fix. | `plan-evidence-commits.test.mjs` |
| D5 | The review-verdict guard missed the files of the incident it cites (#139) and the deploy-proof scripts. | defect | Guarded paths now cover measurement, calibration, safety, the build, stamp and verify scripts, and the release rules' tests. | `review-verdict.test.mjs` "V272 D5" |
| D6 | The receipt bound the tree, not how the gate ran: `OSC_BROWSERS=chromium npm run release:prepare` passed. | risk | release:prepare refuses a narrowed gate, runs with strict skips and records the browsers, origins and skips; publish refuses a receipt that lacks them. | `release-gate-env.test.mjs` |
| D7 | The v4 completion ledger contradicted the claims and git. | defect | Reconciled with main, with a Claims column that a test holds to the claims ledger. | `knowledge-integrity.test.mjs` "V272 D7" |
| D8 | Shipped, CI-tested capabilities had no claim (ADRs 0039, 0045, 0049, 0050, 0052), and cited check ids were not validated. | risk | Six claims added. Each check a guaranteed claim cites must exist in its suite, and each ADR from 0011 on must be claimed or exempt with a reason. | `knowledge-integrity.test.mjs` "V272 D8" (with mutation tests) |
| D9 | (a) Two claims said a check skips in CI where it fails. (b) The cadence was claimed hourly; scheduled runs came 3 to 6 times a day. (c) The provenance intent still named v2.0.0. (d) CLAUDE.md enumerated a stale plan. | nit | Texts corrected; (a) has a test. | `knowledge-integrity.test.mjs` "V272 D9" |

### Found during integration (I)

| # | Finding | Class | Fix | Proof |
| --- | --- | --- | --- | --- |
| I1 | B2 and A8 together: a re-armed measurement derived its recipe from `getModel()` inside the store's commit gate, which still returned the model being replaced. With A8, the old model was refused and the moved pass failed. | defect | The transport's `schedule` event carries the model it plays. | The B2 re-arm test fails on the merged tree without the change and passes with it. |
| I2 | A5's level refusal was never wired into the app, because the workspace did not pass the level. | defect | `outputLevel: cmp.gainLevel` in the workspace. | The unit tests hold the recipe side; no browser check yet (follow-up). |

### Found by the review of the pull request (R)

The independent reviewer of the pull request requested changes (`.ai/repo/reviews/`); these were fixed before it landed.

| # | Finding | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| R-1 | A regression from A7: a static detune lowered into the Nyquist headroom was counted by `runtime.baseOffset` as an edge offset and shifted a detune lane (-89 to -236 cents at 48 / 44.1 kHz). | defect | `computeBases` reports how far it lowered each base, and `baseOffset` is only the edges' constant part. | `v272-studio-automation.test.mjs` "V272 R-1" (44.1 and 48 kHz) |
| R-2 | An edit made while a Studio measurement was armed was left out of it: the run measured the old model, bypassing A5. | defect | The transport sends the edited model while a measurement clip is scheduled. The run derives the recipe again at the hand-off: a changed recipe runs, and a refused one fails with its reason. | `v272-transport-lifecycle.test.mjs` "V272 R-2" (three tests) |
| R-5 | The first clock trigger of a clocked modulator plays the value it already holds. | nit | Kept: a Sequence clip at 0 s is the common case, and skipping step 0 there would surprise more. The node help, the user guide and `timeline.md` now state it. | "V272 R-5" pins the semantics |

## Open

- **D2: resolved on 2026-10-18.** The owner approved, and main's branch protection now requires the `gate` check with `strict: true`, so a pull request merges only when its branch is current with main and CI ran on the combined tree. A merge queue was not chosen (`project.ci-bounded` would have to allow `merge_group`).
- **D3 (defect, Majordomus).** 0 of the 85 intent criteria read met while their milestones are DONE: Majordomus 0.29 cannot record `node --test` or Playwright runs. This is queued post-alpha in Majordomus (foreign runners as evidence).
- **Follow-ups named by the builders:**
  - a browser check of the A5 level wiring;
  - the ~20 ms window in which the runtime's base glide precedes the transport's hold on a released parameter (pre-existing);
  - the 4 MB import limit measured two ways (estimate vs pretty-printed text);
  - `settingInput` fields that refuse with only an announcement;
  - whether `src/index.html`, `main.js` and the styles should be guarded paths (owner);
  - a Pages redeploy after tagging, so the release commit's page also shows its tag.
