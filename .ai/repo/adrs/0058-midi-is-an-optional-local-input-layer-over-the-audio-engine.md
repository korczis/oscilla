---
schema: adr/v1
id: adr-0058
kind: adr
title: MIDI is an optional, local control layer over the AudioEngine, never a second engine
status: proposed
date: 2026-10-18
tags:
  - midi
  - audio
  - product
related:
  - rule:project.audio-engine-discipline
  - rule:project.single-file-deliverable
  - rule:project.studio-model-is-canonical
  - rule:project.no-fake-science
  - rule:project.visual-identity-lock
  - file:src/js/audio/audio-engine.js
  - file:src/js/core/music.js
  - file:.ai/repo/project/intents/midi-jam-companion.yaml
  - file:.ai/repo/project/milestones/M045.yaml
provenance:
  origin: authored
  derived_from:
    - file:.ai/repo/project/intents/midi-jam-companion.yaml
---

# 58. MIDI is an optional, local control layer over the AudioEngine, never a second engine

## Context

On 2026-10-11, in the owner's ChatGPT project "Oscilla" (conversation `6acbd3dc`, knowledge
record `chatgpt-oscilla-project`), the owner wrote one line: "prismatic/oscilla jako midi jam
companion" (Prismatic and OSCILLA as a MIDI jam companion). ChatGPT's answer (18:23:45Z) gave
the idea its shape. A player connects a MIDI keyboard or controller. OSCILLA listens to what
they play, answers with a bounded response, and shows what the sound does. The answer drew a
firm boundary: OSCILLA is not to become another DAW or a copy of a commercial synthesizer. Its
product sentence was: OSCILLA plays with you, sees what you play, and lets you explore what that
sound does. It extends "See sound. Shape frequency." rather than replacing it.

The same answer split the roles. OSCILLA owns the sound, the MIDI input, the jam rules, the
rhythmic and harmonic response, the visualisation and the recording. Prismatic, the owner's
other project, would be the higher layer that designs and explains jam modes and holds presets,
experiments and structured session notes. Nothing in this repository builds or names that
layer.

On 2026-10-18 the owner adopted the direction by asking for it to be recorded; this decision,
the intent `midi-jam-companion` and M045 are that record. The boundary, the product sentence and
the role split are therefore ChatGPT's proposal as the owner adopted it, not the owner's own
words.

What exists today:

- one `AudioEngine` that owns the audio lifecycle (`project.audio-engine-discipline`);
- note arithmetic in `src/js/core/music.js` (`midiToFrequency`, `nearestNote`);
- the V1 block sequencer, which composes tones, pulses and sweeps and is not a note sequencer;
- the V3.1 Studio, whose `StudioModel` is the only Studio state
  (`project.studio-model-is-canonical`), with a timeline of clips and automation.

What constrains a MIDI feature:

- **Optional.** The Web MIDI API is not available in every browser, needs a secure context, and
  asks the user for permission. OSCILLA must keep working from `file://` and the Pages sub-path
  as one file (`project.single-file-deliverable`), so MIDI can only be an optional capability.
  Which of the three gate browsers expose it, and in which origin, is to be measured (V501),
  not assumed.
- **Deterministic timing.** A musician needs a steady pulse. A language model in the timing
  path would add latency and unpredictability exactly where they hurt.

## Decision

1. **MIDI is a control and musical layer; the AudioEngine stays the rendering layer.** MIDI
   input becomes note and controller events. Voices sound through the existing engine and its
   safety limits (level caps, click-free envelopes, the 0.95 × Nyquist bound). There is no
   second audio graph and no MIDI-specific synth.
2. **Optional and honest.** OSCILLA detects Web MIDI support and permission at runtime and states
   one of: unsupported, permission needed, denied, no devices, or connected with the device
   names. When MIDI is absent, nothing else changes. No claim names a browser that has not been
   measured.
3. **Local and deterministic.** The response modes are deterministic rules over the incoming
   events (drone plus answer, call and response). They are scheduled on the AudioContext clock.
   No network call and no model inference happens in the audio or event path. A higher layer may
   suggest a mode between phrases; that is not part of this decision.
4. **One record.** A recorded jam is an editable event track. Where it lives (Studio timeline
   clips versus a separate record) is decided in V505 against `project.studio-model-is-canonical`.
   It is never a second, unvalidated state.
5. **Out of scope for the first version:** MIDI clock, MIDI output to external instruments,
   multiple tracks and AI improvisation.

## Alternatives rejected

- **Turning the block sequencer into a MIDI sequencer.** The sequencer composes sound patterns,
  not notes. Forcing notes into it would blur both.
- **A separate MIDI synth or audio graph.** It would duplicate the engine and bypass its safety
  and lifecycle guarantees.
- **An LLM that decides what to play note by note.** Latency and unpredictability in the timing
  path.
- **Requiring MIDI.** It would break `file://` use and browsers without Web MIDI.

## Consequences

- M045 plans the first usable version in five issues (V501 to V505). The plan records it as
  planned work; nothing is implemented by this decision.
- Every MIDI surface follows `project.visual-identity-lock` and has a non-pointer path.
- The intent `midi-jam-companion` holds the criteria that make the direction true. Until claims
  and tests exist, its criteria are unmet, and the plan says so.
- The status stays `proposed` until the owner accepts the direction.

## Resolution notes

Appended; the status stays `proposed`.

### 2026-10-18: the Context's provenance corrected

The first version of the Context said the owner proposed the direction on 2026-10-18 and quoted
the boundary and the product sentence as the proposal. The conversation is dated 2026-10-11, the
owner's part of it is one line, and the shape, the boundary, the product sentence and the role of
Prismatic are ChatGPT's answer, which the owner adopted on 2026-10-18. The Context now says so.
The Decision is unchanged.
