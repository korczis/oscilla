---
schema: knowledge/v1
id: browser-ui-pitfalls
kind: knowledge
class: lesson
title: Browser and Alpine behaviours that broke OSCILLA's UI checks
description: x-show timing, WebKit Tab order, Tailwind truncation and Linux layout differences found while verifying sections 1-63.
status: verified
epistemics: observed
date: 2026-10-02
tags:
  - alpine
  - webkit
  - accessibility
  - layout
provenance:
  origin: authored
  derived_from:
    - file:index.html
    - file:tests/spec.cjs
    - file:tests/smoke.cjs
---

# Browser and Alpine behaviours that broke OSCILLA's UI checks

## Alpine `x-show` lags one animation frame

Alpine applies `x-show` changes on the next animation frame. Right after a tab click, the
previous mode panel is still laid out, so a measurement in the same task (for example "HOLD
TO PLAY inside the first viewport") sees the wrong layout. The fix is
`:class="mode === 'x' ? '' : 'hidden'"` on mode panels, which applies within the same
microtask flush. Repro: click Learn, then Playground, then read each panel's `display` after
one `await Promise.resolve()`.

## WebKit's default Tab order skips buttons

With WebKit's default keyboard settings, Tab does not stop on `<button>`. A focus trap that
only wraps when the last button has focus never wraps there, so focus escapes the dialog.
The trap has to move focus itself on every Tab.

## `querySelector('[data-autofocus], input, button')` is document order, not priority

A list selector returns the first match in document order, so a dialog's close button wins
over a later `data-autofocus` input. Query `[data-autofocus]` first, then fall back.

## Tailwind `truncate` in a shrinking flex item hides required text

`truncate` on a `min-w-0` header subtitle clipped "Interactive Sound & Frequency Lab" to
"Interactive S…" at 375 px. Text the spec requires to be visible needs wrapping, not
truncation, and the header must be checked at every width in every status state.

## Pending state must be guarded in the handler, not only with `:disabled`

A second click can arrive before Alpine renders `:disabled="micPending"`, so
`getUserMedia` ran twice and leaked a live track. Return early on the pending flag inside
the handler.

## Linux CI lays out differently from macOS

The first CI run on ubuntu-latest failed the 390 px first-viewport check (button bottom
852 px against an 844 px viewport) that passed on macOS. Keep first-viewport margins above a
few pixels, or re-measure on the runner.
