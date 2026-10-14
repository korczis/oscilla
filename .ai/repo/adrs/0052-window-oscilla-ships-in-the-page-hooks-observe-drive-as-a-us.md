---
schema: adr/v1
id: adr-0052
kind: adr
title: window.OSCILLA ships in the page; hooks observe, drive as a user, or inject only in TEST CONTEXT
status: proposed
date: 2026-10-07
tags:
  - testing
  - measurement
  - honesty
  - api-surface
provenance:
  origin: extracted
  derived_from:
    - file:src/js/main.js
    - file:src/js/ui/measure.js
    - file:tests/unit/v4-one-studio-store.test.mjs
    - file:tests/browser/live-smoke.cjs
    - file:docs/v4/completion-ledger.md
    - file:docs/specs/oscilla-v3-measure.md
---

# 52. window.OSCILLA ships in the page; hooks observe, drive as a user, or inject only in TEST CONTEXT

## Context

The completion ledger lists, as P2 item W7, that the `window.OSCILLA` test seam and `?mock=1` ship
in production. The owner approved the direction recorded here on 2026-10-07; this decision stays
`proposed` until the owner accepts it.

The seam goes back to V1 ("Test and debug seam (read-only use)"). Today it holds live objects
(engine, labs, the Alpine component as `app`) and per-area surfaces for measure, studio,
experiments, navigation and unsaved. 22 files under `tests/` and `scripts/` reach it: the
browser suites, the visual scripts, the unit suites that call the `*TestSeam()` methods, and the
public live smoke. The live smoke runs in the Pages workflow after `verify-deploy` has proven
that the public page is byte-equal to the committed dist.

Four facts bound the decision:

- **The seam adds no security exposure.** `window.Alpine` is global, so a page script can reach
  the same component methods without the seam. The public origin `korczis.github.io` is shared
  by every Pages site of the account (22 on 2026-10-07), so same-origin script already has the
  page's storage, IndexedDB, microphone grant and `contentWindow`. No seam hook opens the
  microphone or makes a network request itself; the live smoke asserts that getUserMedia is
  never called. The live internals reachable through it (`app`, `measure.engine`, `measure.io`)
  can run a setup check, which asks for the microphone exactly as the page's own button does.
  `useLoopback` is the same as the documented `?measure=loopback`, which is labelled TEST
  CONTEXT.
- **It has an honesty defect, under `project.no-fake-science` and ADR 0044.**
  `measure.showResult(result)` titled any result without `testContext` "Latest measurement",
  and `measureSave` saved it as an ordinary experiment. `measure.setInputNow(input)` set the
  input facts that a manual level calibration binds to, so the indicator could read CALIBRATED
  for a device that was never checked.
- **One hook could do what no user can.** `measure.setValues` was a bare `Object.assign`. It
  skipped the range validation of the recipe-link path and the READY reset that every UI edit
  performs. (`measureSetValue`, the page's own edit, resets READY but checks only that a number
  is finite; the range checks exist on the recipe-link path alone.)
- **The tested artifact must be the shipped one.** `project.single-file-deliverable` v2 says the
  one `dist/index.html` is committed and deployed, and the post-deploy smoke tests those bytes.
  A separate test build would not be the deployed artifact.

Spec §165 asks for "No giant unstable window.OSCILLA API; deliberate public/debug surface".
ADR 0027 and the README already name `window.OSCILLA.version`, and ADR 0042 names
`window.OSCILLA.studio.trace.steps()`.

`?mock=1` only toggles a class that draws dashed outlines on renderer hosts (layout comparison
only, never data), for the opt-in `scripts/visual-compare.mjs --mock`. It changes no behaviour.

## Decision

`window.OSCILLA` and `?mock=1` stay in the one shipped artifact. There is no flag, no build mode
and no test build. Every member of the seam is one of three kinds. (`studioTimeline`, whose
`createContext` built a second StudioStore, runtime and transport on the shared engine and
called `engine.stopAll`, was none of the three. It left the page under ledger W7a, and
`tests/unit/v4-one-studio-store.test.mjs` keeps a second Studio context out.)

1. **Observe.** Reads, `counts()`, state, model, trace, `version`, `build`. The stable reads are
   `version`, `build`, `measure.state`, `measure.counts()`, `studio.counts()`, `studio.model`
   and `studio.trace.steps()`. Every other member, including the live internals `app`, `engine`
   and `host`, may change without notice.
2. **Drive.** Only actions a user already has, through the user's code path and validation:
   - `measure.useLoopback()` is the same as `?measure=loopback`. `useLoopback(system)` also
     takes a synthetic system, which the URL flag cannot set; what it measures stays labelled
     TEST CONTEXT.
   - `measure.useMicrophone()` leaves TEST CONTEXT.
   - `studio.store` dispatches through the canonical store and its undo history.
   - `measure.setValues(values)` is the validated recipe-link action
     (`decodeRecipeLink` over the setup with the given values, then the same apply step a
     recipe link uses). Keys outside the recipe fields, out-of-range values, and calls while a
     measurement is running are refused whole with `{ ok: false, errors }`; otherwise it
     returns `true`. A change resets a READY setup check. It shows no toast and leaves the
     link state and `repeatOf` alone.
3. **Inject.** Only as TEST CONTEXT:
   - `measure.showResult(result)` refuses (returns `false` for) a result without
     `testContext`. It checks the result's mark, not whether the page is in TEST CONTEXT.
   - `measure.setInputNow(input)` refuses (returns `false`) unless the page is in TEST CONTEXT
     loopback.
   - `onceInState` only observes timing and stays as it is.

A release-gate check (`seam-surface-pinned` in `tests/browser/app.cjs`) pins the key lists of
`window.OSCILLA` and `OSCILLA.measure`, so the surface grows only through a deliberate test
edit, and asserts the refusals on the built page. `tests/unit/v4-seam-contract.test.mjs` holds
the contract of the measure hooks. The README states the stable reads, the three kinds, and
that the seam is not a security boundary.

## Alternatives rejected

- **Remove the seam, or keep only reads.** This would break the post-deploy live smoke and the
  browser suites. It would gain no protection while `window.Alpine` and the shared origin stay.
- **Gate the mutating hooks behind a URL flag.** The code still ships, a new noun is added, every
  suite and the smoke must pass the flag, and the flag protects nothing.
- **A separate test or DEBUG build.** It contradicts single-file-deliverable v2 and makes the
  smoke test a different artifact from the one users get.
- **Label injected results TEST CONTEXT instead of refusing them.** Injected data would stay
  saveable, the default title would misdescribe it as a loopback run, and the test-only branches
  would stay live. Every existing caller already carries a `testContext`, so refusing costs
  nothing.
- **`Object.freeze(window.OSCILLA)`.** The pinned-key test stops drift without breaking outside
  tools that patch the object.
- **Route `setValues` through `measureSetValue`.** That gives the READY reset but no range
  validation; the recipe-link path gives both.
- **Keep it as is and only document it.** That leaves two paths that present unmeasured data as
  measured.

## Consequences

- Through the seam, a page script can no longer show or save an injected result as a
  measurement, and a direct `setInputNow` call outside TEST CONTEXT is refused. Deliberate
  forgery through `window.Alpine` and component internals is still possible and is not claimed
  to be prevented. Imported records stay the job of the open "unverified import" marker.
- **Not closed by this decision as implemented: an unchecked input can still read CALIBRATED
  outside TEST CONTEXT through seam hooks alone, by two routes** (found by review of #161,
  reproduced on the merged branch; ledger W7f, open):
  - `useLoopback()`, `setInputNow(input)`, `useMicrophone()`: leaving TEST CONTEXT does not
    clear the injected input, so a typed level reading then binds to it.
  - `showResult(result)` with a `testContext` and an `input`, never entering loopback: the
    result is rightly titled TEST CONTEXT, but showing it adopts `result.input` as the current
    input, and a typed level reading then binds to it.
  Closing them (clear the input when the seam enters or leaves loopback; do not adopt an
  injected result's input outside loopback) changes behaviour beyond the three guards approved
  on 2026-10-07 and waits for the owner.
- `setValues` now resets a READY check and refuses invalid input. A test that relied on the old
  behaviour was relying on something no user can do. It validates the whole setup recipe, not
  only the keys given: when the setup already holds a value outside a recipe link's range
  (typed into a field, which checks only that a number is finite), every call is refused until
  that value is corrected.
- A toggle value is coerced to a boolean, as the page's own toggle does; it is not refused.
- `setValues` now returns a verdict that no existing caller reads (the browser suites and the
  live smoke discard it), so a refusal would surface as an unrelated later failure (ledger W7g).
- The browser gate, the visual tooling and the live smoke keep testing the deployed bytes. The
  byte cost is measured by verify-dist and recorded in the pull request.
- ADR 0027 and ADR 0042 hold unchanged. Spec §165 is met by the declared surface.
- These follow-ups are recorded in the ledger and are not needed for this decision:
  - `studioTimeline.createContext`, a second StudioStore on the shared engine used only by one
    browser suite, moves to the canonical store and leaves the page
    (`project.studio-model-is-canonical`). Done under ledger W7a.
  - The live smoke loads `?measure=loopback#mr=...` instead of calling seam hooks. Done under
    ledger W7e.
  - The Input device select gets a TEST CONTEXT option, so a user can leave `?measure=loopback`
    without editing the URL.
  - A manual level calibration made in TEST CONTEXT carries the TEST CONTEXT label.
  - The shared-origin exposure is tracked as its own item.
- If OSCILLA moves to its own origin, revisit `window.Alpine` and `OSCILLA.app` first, not the
  measure hooks.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-07: what is injected stays in TEST CONTEXT (ledger W7f, W7c, W7h)

The two routes recorded above as not closed are closed, at the place the binding is decided
and not at the two hooks:

- **An input belongs to the context that named it.** MEASURE keeps, next to the current input,
  whether TEST CONTEXT named it: the loopback's own setup check or reference capture, a result
  that carries a `testContext`, or `setInputNow`. Every reader that decides a binding, an
  indicator or a displayed level (the typed reading's binding, the indicator, the check
  before a measurement, the views, the dialog's note) goes through one function, `inputKnown()`, which answers "no input" when the input's
  context is not the page's. So `useLoopback()`, `setInputNow(input)`, `useMicrophone()` leaves
  no input known, and `showResult` of a TEST CONTEXT result outside loopback shows the result,
  labelled, without making its input the current one. Entering or leaving TEST CONTEXT also
  releases what was checked or captured before (the input, a captured reference, the setup
  check's facts), as choosing another input device does.
- **A level calibration belongs to the context it was made in.** One made in TEST CONTEXT does
  not apply on the microphone ("UNCALIBRATED: the level calibration was made in TEST CONTEXT
  ..."), and one taken with a microphone does not apply in TEST CONTEXT. It is not deleted:
  back in its own context it is checked against the input as before. This closes the third
  sequence the two routes implied: a reading typed in TEST CONTEXT for an injected "Mic A",
  then a real check of a microphone with the same binding.
- **A reading typed by hand in TEST CONTEXT says so** (W7c): its conditions start with
  "TEST CONTEXT: reading typed by hand while the page was in TEST CONTEXT (digital loopback, no
  microphone checked)." and MEASURE's state line starts with "TEST CONTEXT", for the captured
  kind too.
- **`setValues` refuses a toggle value that is not `true` or `false`** (W7h), replacing the
  consequence "A toggle value is coerced to a boolean" above. The page's own switch still
  coerces: it can only send one of the two.
- The browser suites read the verdict of `setValues` through `tests/browser/lib/measure-seam.cjs`
  (W7g); the live smoke's one call leaves with W7e.

ADR 0017's rule is unchanged and not weakened: a calibration is still stored only with its
input and applied only for that input, by the workspace and again by the measurement engine.
What is added only refuses more. A user reaches TEST CONTEXT by the URL flag alone, before
anything is checked, so no user path changes; the hooks are the only way to cross contexts in
one page.

Proven by `tests/unit/v4-seam-contract.test.mjs` (the W7f, W7c and W7h tests, which failed
before the change) and check `calibrated-only-for-a-checked-input` in `tests/browser/app.cjs`.

### 2026-10-07: a pending calibration is in no display (review of #169)

The note above left one path open, and review found it: with a microphone calibration stored,
a TEST CONTEXT result shown on the microphone page drew its noise-check RTA as "Level · dB
SPL" with a CALIBRATED badge while the indicator read PENDING INPUT CHECK. The display asked
whether a calibration could apply, not whether its input was checked. Closed in #169:

- **A level calibration is displayed only once its input is checked.** One function,
  `levelInUse()`, answers every view (response, stored noise-check snapshot, live RTA,
  evidence notes, and the Calibration step of the setup flow through `levelChecked`), and it
  answers "none" while the calibration waits for its input check. The measurement engine is
  still handed the pending calibration: it checks the input it measures (ADR 0017 C1,
  unchanged).
- **A result shown without evidence of its own takes only a calibration of its own context.**
  A TEST CONTEXT result never reads in dB SPL through a microphone calibration.
- **Leaving a context drops the result and the noise-check snapshot shown in it**, with the
  input, the reference and the setup check's facts. A saved experiment that is shown stays.
- **The TEST CONTEXT label is stored in front of the conditions as typed**, and the field's
  limit in TEST CONTEXT is the limit of a level calibration less the label, so nothing the
  field accepts is refused and nothing typed is cut.

Proven by the four "of #169" tests in `tests/unit/v4-seam-contract.test.mjs`, which failed
before the change, and by the fake-microphone leg of `calibrated-only-for-a-checked-input`.

### 2026-10-07: TEST CONTEXT is a choice of the Input device list (ledger W7b, #167)

_As written then; superseded in part by the note of 2026-10-11._

**Note of 2026-10-07 (ledger W7b), no decision above changes.** The follow-up "the Input
device select gets a TEST CONTEXT option" is done. The list ends with "TEST CONTEXT · digital
loopback (no microphone)"; choosing it is `?measure=loopback` (the address follows the
choice), and choosing an input leaves it. The banner, the labels on results and the refusal
to present a loopback result as a measurement are as before. Leaving clears what was produced
in TEST CONTEXT: its result (a saved experiment of it stays, labelled), the input check, a
captured reference reading and a level calibration stored in it; entering ends the input
check of the real input. A result measured with a real input, and a level calibration stored
with one, stay on either side as what they are.
`useLoopback()` and `useMicrophone()` are now that same transition, which is what "drive"
means here. That closes the first of the two routes above (`useLoopback()`,
`setInputNow(input)`, `useMicrophone()`): the injected input and a calibration stored on it
do not survive leaving. It follows from the page's own reset, not from the owner's answer
that W7f waits for; the second route (`showResult` adopting `result.input` outside loopback)
is open, and W7f stays open for it. `useLoopback()` while already in TEST CONTEXT keeps what
was made in it and only replaces the engine, as before.

### 2026-10-07: what was made in TEST CONTEXT is known from where it was made (review of #167)

_As written then; superseded in part by the note of 2026-10-11._

**Note of 2026-10-07 (review of #167), no decision above changes.** "Produced in TEST
CONTEXT" is recorded where a result is shown, not read off the result's label: the engine's
INVALID result carried no `testContext`, so one made in the loopback survived leaving, with
its noise-check snapshot, under the real input. It is now cleared and named, and the engine's
INVALID result carries the label of the setup check's facts. A pending repeat link and the
outcome in the assertive live region end with the transition, in both directions. Entering
clears an INVALID result of the real input: with no transfer it has no title that would say
whose it is. A level calibration applies only on the side it was stored on, whatever the
input reports about itself; one stored with a real input reads UNCALIBRATED, with the reason,
while the page is in TEST CONTEXT and is kept for that input. `useLoopback()` and
`useMicrophone()` are refused wherever the choice is refused (a measurement, a running setup
check, a reference capture), so "the same transition" holds for the refusal as well.

### 2026-10-11: #167 and #169 together (owner decision)

#167 and #169 disagreed on two points of the transition. The owner decided both on
2026-10-11, for #169's behaviour:

- **A level calibration stored in TEST CONTEXT is kept when TEST CONTEXT is left.** Outside it
  reads UNCALIBRATED with the reason, and it applies again once TEST CONTEXT is entered again
  and its input is named there. #167 cleared it on leaving and said so; nothing clears it now.
- **A result is dropped on any change of context, in both directions**, with its evidence, its
  save state and its noise-check snapshot: a result measured with a real input on entering, as
  a TEST CONTEXT result on leaving. #167 kept a COMPLETE result of a real input under its own
  title.

One transition implements both (`setTestContext()` in `src/js/ui/measure.js`), behind the
Input device choice and the seam's `useLoopback()` / `useMicrophone()`; #169's `setLoopback()`
is folded into it, and the two reasons a calibration does not apply are one pair of sentences.
With #167 a user crosses contexts in one page from the Input device list, so "the hooks are
the only way to cross contexts in one page" (first note above) no longer holds; what that note
decides holds for the page's choice as for the hooks, because they are the same transition.
Proven by `tests/unit/v4-test-context-choice.test.mjs`, `tests/unit/v4-seam-contract.test.mjs`
and checks `test-context-from-the-page` and `calibrated-only-for-a-checked-input` in
`tests/browser/app.cjs`.

This supersedes, in the two #167 notes of 2026-10-07 above, "a level calibration stored in
it" among what leaving clears, "A result measured with a real input ... stay[s] on either
side", "a calibration stored on it do[es] not survive leaving" and "Entering clears an INVALID
result of the real input" (entering now clears any result). Since W7f is closed by #169, its
"W7f stays open" is history too. Entering says what it cleared in a notification, as leaving
does, so that an unsaved measurement dropped on entering is not said to a screen reader only
(review of the merge). Whether the page should ask before it drops an unsaved measurement is
the owner's to decide; it does not ask.
