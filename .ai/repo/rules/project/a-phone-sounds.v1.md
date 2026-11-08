---
id: project.a-phone-sounds
version: 1
kind: rule
title: A phone sounds
description: The instrument makes sound on a phone as on a desktop, and the gate proves it with the browser's user-gesture rule left on.
statement: The page starts audio at a phone's first gesture (pointerdown, pointerup, touchend, keydown; never a bare click) and asks iOS for a playback audio session where navigator.audioSession exists; a GATE browser suite holds both with Chromium's user-gesture rule on, and no change removes that suite from the gate or switches its rule off.
status: active
class: blocking
depends_on: [project.suite-harness@1]
tags: [audio, mobile, safety]
---

# Rationale

Owner report, 2026-11-02: "on the phone it makes no sound; this must not happen". Two causes
had shipped unseen:

- iOS (Safari 17+) mutes Web Audio at the ringer switch unless the page asks for a playback
  audio session, and the page never asked;
- for a touch, the HTML standard grants a user activation only at the end of the touch, while
  the page unlocked audio only at pointerdown.

No test could see either: every browser suite launches Chromium with
`--autoplay-policy=no-user-gesture-required`, which switches the gesture rule off, and no
suite stood in for `navigator.audioSession`. A phone is the instrument's first screen for
many people; silence there is the whole product failing.

# Required behaviour

- `src/js/ui/audio-unlock.js` is the one place the unlock is armed: it listens, in the capture
  phase, at pointerdown, keydown, pointerup and touchend, and never at a bare click (a click
  that assistive technology dispatches is no gesture and creates no AudioContext;
  `tests/browser/surface-census.cjs` no-audio holds that).
- Where `navigator.audioSession` exists, its type is set to `playback`; without the API
  nothing is set, and a refusal keeps the browser's default without failing the page.
- One exception, a microphone capture (C033): WebKit refuses getUserMedia under `playback`,
  so while a capture io holds an input open (a run, and READY after Check setup, whose
  checked input stays open) the session is `play-and-record`, which plays as `playback` does.
  `src/js/measurement/audio-session.js` is the one place it is set: only from `playback`, and
  the last open input to close puts `playback` back exactly once (never over a type someone
  else set since, never throwing when the browser refuses), on every path that closes it.
- `tests/browser/touch-audio.cjs` stays a GATE suite in `test:browser`, launches Chromium with
  `--autoplay-policy=user-gesture-required` (never the no-gesture policy) and keeps its checks
  `audio-session-playback` and `tap-unlocks-audio`.

# Failure behaviour

A unit-gate failure: removing the suite from `test:browser`, switching its gesture rule off,
dropping one of its two checks, adding click to the unlock or dropping the audio session
fails `npm test`.

# Verification

- `tests/unit/audio-unlock.test.mjs`, in `npm test`: the unlock events, the capture phase, no
  click, the audio session set, absent and refused, and `main.js` arming the module.
- `tests/unit/rule-a-phone-sounds.test.mjs`, in `npm test`: `tests/browser/touch-audio.cjs` is
  in `test:browser`, launches Chromium with the gesture rule on and never off, and keeps both
  checks.
- `tests/browser/touch-audio.cjs`, in `npm run test:browser` (CI's browser gate, three
  browsers): `audio-session-playback` fails on a page without the fix; `tap-unlocks-audio`
  guards the outcome.
- The capture exception: `tests/unit/measure-audio-session-paths.test.mjs`, in `npm test`,
  holds `play-and-record` while the input is open and `playback` back exactly once on every
  path that closes it (the run's end, abort, context closed, suspended or interrupted,
  pagehide, a hidden document, dispose, the watchdog, the permission prompt aborted, the track
  ending, a failure after getUserMedia, a refused restore, two ios sharing the session);
  `tests/unit/measure-stimulus-emits.test.mjs` the switch before getUserMedia; and
  `tests/browser/v3-measure.cjs` (`measure-check-sounds`, in `npm run test:measure`) reads
  `navigator.audioSession.type` in WebKit, the browser that has it: `play-and-record` in
  READY after Check setup, `playback` after the check is reset.

Not machine-checked: a real iPhone's ringer switch and a real touch screen. The suites stand
in for both; the first key tap of a session is a known limit until the engine replays a note
held across the unlock (follow-up of the phone fix, #384).
