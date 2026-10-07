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
