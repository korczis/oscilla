---
schema: adr/v1
id: adr-0062
kind: adr
title: A held key or MIDI note is exempt from the playback limit while it is held, and is released on blur, hide and Escape
status: proposed
date: 2026-10-29
tags:
  - safety
  - playback
  - midi
related:
  - rule:project.audio-engine-discipline
  - rule:project.no-silent-feedback
  - file:.ai/repo/adrs/0005-safety-limit-scope.md
  - file:.ai/repo/adrs/0050-space-is-the-play-key-of-the-workspace-in-view-one-shortcut-.md
  - file:.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md
  - file:src/js/audio/audio-engine.js
  - file:src/js/midi/notes.js
  - file:src/js/midi/ui.js
provenance:
  origin: authored
---

# 62. A held key or MIDI note is exempt from the playback limit while it is held, and is released on blur, hide and Escape

## Context

ADR 0005 caps every open signal at the configured playback limit (0.5 to 5 s, 2 s by
default) unless "Allow continuous playback" is on. The V502 note of ADR 0058 applied that cap
to MIDI notes exactly as to HOLD: a note ended at the limit with the key still down.

On 2026-10-29 the owner directed (session oscilla-b0, plan intent `playable-instrument`) that
OSCILLA becomes a playable instrument, and asked for a keyboard that is "ergonomic, mapped
onto the computer keyboard, super user-friendly, functional, connected to everything". A
piano whose notes stop after 2 s while a key is still pressed is not playable: a sustained
chord or a held bass note is the ordinary case. The owner decided it as D3 of the plan
(`.ai/repo/project/intents/playable-instrument.yaml`, criterion `held-notes-safe`, issue
K026): a held key or MIDI note is a user-held gesture, exempt from the limit while it is
held, with the output ceiling kept and release forced on blur, hide and Escape. The intent
says that this amends ADR 0005 by its own decision; this is that decision, recorded before
any code of K026 lands.

What the limit protects against is a sound nobody is holding: a latched tone, a pattern left
running, a page in a background tab. A note held by a finger is the opposite case, as long
as nothing can leave it sounding once the finger is gone. The browser does not always tell
the page that a key went up: a key released while another window has the focus delivers no
`keyup` here, and a MIDI Note Off can be lost with its device. Those are the cases the forced
release covers.

## Decision

1. **Held is exempt, only while held.** A note started by a held gesture (a key of the
   computer keyboard, a pointer on the on-screen keyboard, a MIDI Note On) is not cut at the
   playback limit. It sounds until its own release: the key up, the pointer up, the Note
   Off, or one of the forced releases below. Then it fades with its release time. The engine
   marks it `held` (`engine.noteOn(key, { held: true })`); it is neither `limited` nor
   `extended`, so withdrawing the continuous permission (`revokeContinuous`) does not touch
   it. Every other signal keeps ADR 0005 unchanged: Hold to Play, Trigger, the latch and the
   Finite tone stop at the limit, and patterns keep their programmed end (at most 30 s).
2. **The ceiling and the gain law stay.** A held note peaks at `level / NOTE_POLYPHONY` and
   goes through the same master, limiter and output ceiling as every voice (ADR 0002, the V502
   note of ADR 0058). Holding longer never makes it louder.
3. **Forced release.** Every held note fades within ESCAPE_RELEASE_S when the window loses the
   focus (`blur`), when the page is hidden (`visibilitychange` to hidden, `pagehide`) and on
   Escape, whatever the source. This replaces the V502 rule that window blur does not stop
   MIDI notes: a note that may have lost its release is stopped on the safe side, and the
   player presses it again. The existing stops stay: Measure or Studio PLAY taking the
   output, the sequencer starting, a MIDI input lost or its access withdrawn.
4. **The keyboard never takes Space.** Space keeps its one owner per workspace (ADR 0050).
   The computer keyboard plays notes only where it is armed, and never while a text field,
   a select or an open dialog has the keys.

## Alternatives rejected

- **Keep the limit for notes.** A 2 s cut makes the keyboard unplayable for anything but
  staccato, and the player cannot tell a cut from a fault.
- **A longer cap for notes (for one, the 30 s of programmed patterns).** It still cuts a held
  chord at an arbitrary moment and adds a second limit for the player to learn, while the
  forced releases already bound every case where nobody holds the key.
- **Require "Allow continuous playback" for held notes.** That permission lengthens signals
  nobody is holding; tying the keyboard to it would make every player turn off the
  protection for the signals that need it.

## Consequences

- `engine.noteOn` accepts `held`; a held note has no scheduled end, and `noteOff`,
  `notesOff`, `stopAll` and a closed context free it as before. The MIDI layer and the
  on-screen and computer keyboard pass `held: true`.
- `tests/unit/keyboard-held-notes.test.mjs` proves that a held note sounds past the limit,
  stays at or under the master level, is not released by `revokeContinuous`, and is released
  on blur, hidden, pagehide and Escape with the node census at zero after the release.
- The copy that states the limit (the Keyboard shortcuts dialog and the Settings note) says
  that held notes are exempt while held.
- The status stays `proposed` until the owner accepts it; ADR 0005 is amended by this
  decision and keeps its own text, with a resolution note pointing here.
