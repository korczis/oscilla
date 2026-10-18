---
schema: knowledge/v1
id: positioning-candidates
kind: knowledge
class: fact
title: "The ChatGPT conversations propose about a dozen positioning sentences for OSCILLA and the owner has adopted none of them; the README and About still say \"interactive sound and frequency laboratory\""
description: "The candidate positioning sentences, framings and anti-framings with their sources, for the owner's choice (issue Q002); none is a decision, and no copy changes from this record."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - positioning
  - messaging
  - product
provenance:
  origin: authored
  derived_from:
    - file:README.md
    - file:src/index.html
    - file:docs/specs/oscilla-v3-measure.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
  - type: relates_to
    target: knowledge:product-landscape-and-the-pigments-path
---

# Positioning candidates

What the product says today: README "An interactive sound and frequency laboratory that runs in
the browser from one static file"; About's lede "A browser-based interactive sound, frequency
and measurement laboratory"; the tagline "See sound. Shape frequency." and "Built as an
instrument, not a dashboard." Every sentence below is a ChatGPT proposal unless marked; the owner
has chosen none (issue Q002). Times are UTC.

## Candidate sentences

| # | sentence | source |
| --- | --- | --- |
| C1 | "A zero-install, scientifically honest, reproducible acoustic laboratory that runs in the browser." (the V3 spec's defining idea, `docs/specs/oscilla-v3-measure.md`, says "measurement and experiment platform") | `6abec18d` 2026-10-02T03:15:06Z |
| C2 | "Arturia: make sound. Oscilla: understand sound, program signal flow, measure reality, reproduce experiment." | `6abec18d` 03:35:53Z |
| C3 | An "audio systems laboratory": sound as a system, not only a musical instrument | `6abec18d` 03:35:53Z |
| C4 | "Local-first acoustic experimentation instrument with composable signal topology, reproducible measurements and inspectable execution" (replacing "browser-based sound & frequency lab", called too narrow) | `6ac3ead5` 2026-10-05T18:32:06Z |
| C5 | "OSCILLA is a local-first environment for composing, executing, measuring and explaining reproducible experiments"; audio and acoustics are the first and deepest domain | `6ac1beb8` 2026-10-04T03:25:12Z |
| C6 | A "local sound lab for learning and experimenting"; loop: create a signal, see, understand why, adjust, share or export | `6abf3077` 2026-10-02T04:21:01Z |
| C7 | "An interactive scientific instrument you can play", not "an admin dashboard with sliders" | `6abec18d` 2026-10-01T20:46:12Z (§1) |
| C8 | "Oscilla plays with you, sees what you play, and lets you explore what that sound does" (MIDI direction only; adopted with ADR 0058 as that direction's sentence) | `6acbd3dc` 2026-10-11T18:23:45Z |

## Framings that support a sentence

- Three pillars that need each other: INSTRUMENT (generate, synthesise, analyse), STUDIO
  (compose, topology, execute), EXPERIMENTS (measure, provenance, reproduce). Alone, Studio is a
  browser synth, Measure a utility, Experiments an archive (`6ac3ead5`, 18:32:06Z).
- Two axes, Measurement and Studio, meeting in the experiment (`6abec18d`, 2026-10-02T03:22:47Z).
- Sound is invisible and OSCILLA makes it observable: what signal am I generating, what is it
  made of, where are its harmonics, what did the filter do, what does the microphone hear
  (`6ac015e1`, 2026-10-02T20:38:25Z).
- Harder to fool: OSCILLA says "I know / I estimated / I observed / I corrected using
  calibration / I cannot know this from this setup" (V3 spec §250; `6abec18d` 03:18:10Z).
- The honesty angle: OSCILLA admits the gap between generated 19 kHz samples and a speaker
  emitting 19 kHz, which "intellectually beats" the anti-bark ad it started from (`6abec18d`,
  2026-10-01T20:32:10Z; `oscilla-origin-in-the-transcripts`).
- "The system cannot quietly lie" about its version, commit, deployment, measurement, visual
  state or a test that never ran (`6abec18d`, 2026-10-02T03:06:41Z, §149).
- Method: "AI accelerated implementation. Majordomus constrained and organized it. Human
  judgment defined the product." (ChatGPT's wording, `6abf2a8d` 2026-10-02T04:11:27Z, which
  ChatGPT itself recommended keeping. About does not carry it verbatim: its C Method list says
  "Human judgment defined the product and the architecture. AI accelerated implementation.
  Majordomus kept the rules, plan and decisions in the repository and checked them. The
  repository remained the source of truth."; its Majordomus coda says "AI accelerated
  implementation. Majordomus supplied structure, memory and constraints. The repository
  remained the source of truth." (`src/index.html`, section `osc-about-method` and
  `p.osc-about-coda`).) Prismatic as the
  technology, Majordomus as the production process, OSCILLA as the proof the process works
  (`6ac027b2`, 22:03:18Z) is ChatGPT's framing; Prismatic is absent from the public copy.

## Guidance given with them

- Lead with concrete jobs, not the abstract category: "measure a speaker", "compare two room
  setups", "a repeatable frequency-response experiment". ChatGPT itself called
  "reproducible experimentation environment for physical systems" a poor first marketing
  sentence (`6ac1beb8`, 2026-10-04T03:30:06Z). The audiences `audio-hobbyists` and
  `researchers` under `.ai/repo/why/audiences/` describe those jobs.
- Anti-framings, consistent across the conversations: not a dog or anti-bark app, not a
  "miracle ultrasonic gadget", not a medical or hearing-diagnostic tool, not a DAW, not a
  generic SaaS dashboard, not "Pigments, free in the browser"; bioacoustics is one comparison
  domain, not the identity (`6abec18d` 2026-10-01T23:25:49Z; 2026-10-02T03:35:53Z).
- ChatGPT's overall verdict: technically "very above average", product-wise "a strong emerging
  identity, but still too many possible identities". It added, as a general aside rather than a
  score, that technical quality "can be 9/10 and business clarity 5/10" because the two do not
  correlate (`6ac1beb8`, 2026-10-04T03:30:06Z). Nothing derived from this record presents 9/10
  and 5/10 as ratings.
