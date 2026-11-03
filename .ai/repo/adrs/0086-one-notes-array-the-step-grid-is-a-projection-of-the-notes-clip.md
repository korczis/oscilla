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

1. **One truth: the notes array.** A notes clip's payload is `{ notes: [{ at, note, len, vel }],
   grid? }`, `at` and `len` in beats from the clip start (ADR 0084). The piano roll, the step
   grid and the beat machine are editors of that array; none stores notes of its own.
2. **The grid is a projection.** The optional `grid: { stepBeats, steps, swing, probability,
   seed }` tells the step editor how to draw the array; a step that is on is a note at
   `at = i x stepBeats`. The grid never moves notes by itself: changing `stepBeats` or `steps` is
   an explicit action that maps the notes or refuses with its reason, never a silent
   re-quantise. A note off the grid stays as it is and the step editor shows it as off-grid; it is
   never dropped and never snapped on load.
3. **Accent is velocity.** The step editor renders a step whose `vel` is at or above a stated
   threshold as accented, and setting an accent writes `vel`. There is no stored accent field.
   A flam is a second note at a short offset in beats: data, not a scheduler feature.
4. **Execution fields are hashed.** `swing`, `probability` and `seed` change what sounds, so
   they are part of the canonical clip and of `studioHash`; probability draws from a generator
   seeded by `seed` at compile time, never `Math.random`, so a render repeats exactly. The
   compiler reads `stepBeats` (swing delays the off-beat steps of that grid), so `stepBeats` is
   an execution field too; `steps` is presentation (it sets how many steps the editor shows) and
   is outside the hash.
5. **Lanes are note numbers.** A drum lane is a note number; its name comes from the target's key
   map (the percussion engine's, K071's), and a note with no key-map name shows its note name
   (C1, ...), so no lane is unlabelled. A choke group belongs to the voice, not the grid.
   Per-lane lengths (polymeter) are out of scope until a plan issue names them.
6. **One compile path, one clock.** The timeline compiler expands a notes clip into note-on and
   note-off items inside the existing pass and loop arithmetic; the runtime delivers them to the
   target as `transport.live()` delivers a live note today, so a scheduled and a played note take
   one voice path. No second scheduler, no timer-driven timing: every step is on the audio clock.
7. `pattern` and `event` clips stay as they are. Turning a run of event clips into one notes clip
   is a later migration, not part of this decision.

## Consequences

K099 builds the clip kind, its validation and actions, the compiler expansion and the piano roll;
the step-grid editor over `grid` is a separate slice; K073's beat machine panel sits on both. The
contract tests are: an off-grid note survives a load and a grid change that cannot map it is
refused; `swing`, `probability`, `seed` and `stepBeats` change `studioHash` and `steps` does not;
an offline render with a probability below 1 repeats byte for byte; the expanded notes start on
whole frames of the pass arithmetic in the timeline compiler's own tests.

## Resolution notes

### 2026-11-03: proposed

Written by oscilla-26 with oscilla-b0's four constraints (one notes array, accent from velocity,
hashed execution fields, note-number lanes); b0 reviews it. Accepting it is the owner's act.
