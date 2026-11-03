---
schema: adr/v1
id: adr-0086
kind: adr
title: "One notes array: the step grid, the piano roll and the beat machine edit the notes clip, on the one transport and scheduler"
status: proposed
date: 2026-11-03
tags:
  - studio
  - daw
  - sequencer
related:
  - file:.ai/repo/adrs/0084-the-studio-timeline-carries-notes-clips-instrument-tracks-and-a-session-grid.md
  - rule:project.studio-model-is-canonical
  - rule:project.audio-engine-discipline
---

# 86. One notes array: the step grid, the piano roll and the beat machine edit the notes clip

## Context

ADR 0084 puts notes clips with a piano roll on the Studio timeline (K099). The owner's programs
of 2026-11-03 add a visual step sequencer and a beat machine (connected-instrument#drum-machine,
K071-K074, K095) and ask that they, the DAW and the Synth share one transport. The Studio has
one player (`src/js/studio/transport.js`) and one scheduler (`src/js/studio/timeline-compiler.js`
`createTimelineScheduler().advance(ctx.currentTime)`, frame-exact pass and loop starts, the same
code offline). Today a drum hit is one `event` clip: the demo song (K144) needs 744 of them.

## Decision

1. **One truth: the notes array.** A notes clip's payload is `{ notes: [{ at, note, len, vel,
   p? }], grid? }`, `at` and `len` in beats from the clip start (ADR 0084). `note` is an integer
   0-127, `vel` an integer 1-127 (the scale `transport.live()` and the voice pools already take),
   `len > 0`, `0 <= at` and `at + len` within the clip; `p`, when present, is the note's
   probability in (0, 1], absent meaning 1. The piano roll, the step grid and the beat machine
   are editors of that array; none stores notes of its own. `STUDIO_IMPORT_LIMITS` (validate.js)
   gains a maximum of notes per clip and per document, and validate refuses a model over either
   with the limit in its reason, so an import at the byte limit cannot flood the compiler.
2. **The grid is a projection.** The optional `grid: { stepBeats, steps, swing, seed }` tells the
   step editor how to draw the array; a step that is on is a note at `at = i x stepBeats`. The
   grid never moves notes by itself. Changing it is one action, `NOTES_GRID_SET { clipId, grid,
   mode }`, one undo entry: `keep` changes the grid and leaves every note where it is (some may
   become off-grid); `map` scales every note's `at` and `len` by new over old `stepBeats` and is
   refused, model unchanged, if any note would leave the clip; `refuse` applies only when every
   note stays on the new grid and otherwise refuses naming the first note that would not. There is
   no silent re-quantise. A note off the grid stays as it is and the step editor shows it as
   off-grid; it is never dropped and never snapped on load.
3. **Accent is velocity.** The step editor renders a step whose `vel` is at or above a stated
   threshold as accented, and setting an accent writes `vel`. There is no stored accent field.
   A flam is a second note at a short offset in beats: data, not a scheduler feature.
4. **Execution fields are hashed.** `swing`, `seed` and every note's `p` change what sounds, so
   they are part of the canonical clip and of `studioHash`. Swing is a fraction of `stepBeats`
   from 0 to 0.75 (validate refuses anything else); it delays only a note whose `at` is exactly an
   odd grid position, `(2k + 1) x stepBeats`, and never moves an off-grid note. Probability is per
   note (`p`); a per-clip or per-step probability is out of scope. The draw is the pure seeded
   generator of `core/math.js` (`mulberry32`), seeded by `seed`, a uint32, combined with the loop
   pass and the note's index in the sorted array, so a render repeats exactly and each loop pass
   draws anew; never `Math.random`. Changing the seed is a `NOTES_GRID_SET`, undoable, and changes
   `studioHash`. The compiler reads `stepBeats` (swing's grid), so it is an execution field too;
   `steps` is presentation (how many steps the editor shows) and is outside the hash.
5. **Lanes are note numbers.** A drum lane is a note number; its name comes from the target's key
   map (the percussion engine's, K071's), and a note with no key-map name shows its note name
   (C1, ...), so no lane is unlabelled. A choke group belongs to the voice, not the grid.
   Per-lane lengths (polymeter) are out of scope until a plan issue names them.
6. **One compile path, one clock.** The timeline compiler expands a notes clip into note-on and
   note-off items inside the existing pass and loop arithmetic; the runtime delivers them to the
   target as `transport.live()` delivers a live note today, so a scheduled and a played note take
   one voice path. No second scheduler, no timer-driven timing: every step is on the audio clock.
   An edit made while playing (journey G8, the documented update boundary) is heard from the next
   look-ahead window on: notes already scheduled in the current window play as scheduled and are
   never retracted mid-window, except by Stop, which releases them as it does today.
7. `pattern` and `event` clips stay as they are. Turning a run of event clips into one notes clip
   is a later migration, not part of this decision.

## Consequences

K099 builds the clip kind, its validation and actions, the compiler expansion and the piano roll;
the step-grid editor over `grid` is a separate slice; K073's beat machine panel sits on both. The
contract tests are: an off-grid note survives a load, swing leaves it in place, and a
`NOTES_GRID_SET` that cannot map is refused with the model unchanged; `swing`, `seed`, a note's
`p` and `stepBeats` change `studioHash` and `steps` does not; a swing above 0.75, a note outside
0-127, a velocity outside 1-127, `len <= 0` and a clip or document over the note limits are
refused by validate; an offline render with a `p` below 1 repeats byte for byte; the expanded
notes start on whole frames of the pass arithmetic in the timeline compiler's own tests; and a
browser check edits a note while playing and hears it from the next look-ahead window, with the
notes of the current window unchanged.

## Resolution notes

### 2026-11-03: proposed

Written by oscilla-26 with oscilla-b0's four constraints (one notes array, accent from velocity,
hashed execution fields, note-number lanes). b0's review of the first text asked for five points,
now in decisions 1, 2, 4 and 6: swing only on odd grid positions within 0-0.75, probability per
note with the named seeded generator, the live-edit boundary, the note limits and ranges, and
the `NOTES_GRID_SET` action with its modes. Accepting it is the owner's act.
