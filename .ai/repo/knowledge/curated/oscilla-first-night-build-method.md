---
schema: knowledge/v1
id: oscilla-first-night-build-method
kind: knowledge
class: lesson
title: "OSCILLA was built fast with few lasting defects because its search space was tiny, each version was an executable specification for the next, invariants were blocking rules, and the loop from test to targeted fix was short"
description: "The account of how and why the first night worked, as the transcripts and the git history give it; read before arguing from OSCILLA's pace, or before repeating the method elsewhere."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - history
  - method
  - process
provenance:
  origin: authored
  derived_from:
    - commit:9fe0a15de5511a5158d786e654dc28869063628f
    - file:src/index.html
    - file:.ai/repo/adrs/0010-v1-before-v2.md
    - file:.ai/repo/adrs/0014-v1-behaviour-frozen-by-golden-vectors.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
  - type: relates_to
    target: knowledge:built-in-one-night-is-wall-clock
---

# How the first night worked

Sources are the conversations of `chatgpt-oscilla-project`; times are UTC.

## The method as the owner set it up

- The specification was a plan, not a wish. The owner asked for every section to be a tracked
  TODO, each step followed by a brief update, refinement and consultation with ChatGPT, Codex
  or Gemini, working "until done - deployed a verified public gh pages" (`6abec18d`,
  2026-10-01T20:52:21Z). Majordomus came first: installed and integrated before any
  implementation (`6abec18d`, 20:54:13Z). S001-S063 carry that plan.
- The visual target was fixed before V2: the owner asked for V2 to match ChatGPT's preview "1:1
  as close as possible" (`6abec18d`, 21:52:06Z); see `visual-reference-is-an-ai-render`.
- Freeze, then port: V1's feature set was frozen and its engine extracted into V2, not restyled
  step by step (`6abec18d`, 23:16:20Z; ADR 0010, ADR 0014).

## Why it was fast, and why defects did not last

The owner's own account, written about Majordomus and applied by ChatGPT to OSCILLA
(`6ac027b2`, 2026-10-02T21:53:19Z): years of experience, existing building blocks, a very clear
architecture, and AI as a parallel implementation force; "6 hours of human time is not 6 hours
of one programmer". The human set intent, architecture, invariants and acceptance criteria.

ChatGPT's analysis of the snapshot (`6ac027b2`, 21:55:24Z) names four reasons:

1. **A tiny architectural search space.** A browser, Web Audio, one static file; no backend,
   login, database or migrations. Many decisions were dead before they could be made.
2. **An executable specification.** V2 was a port of V1's behaviour into modules with V1 as the
   oracle, not a greenfield build. (Both V1 and V2 were built within the same night.)
3. **Invariants as blocking rules**, not aspirations: node ownership, the audio clock,
   click-free gain, the Nyquist bound, no fake science, a deterministic self-contained artifact.
4. **A short loop**: implement, test, browser, audit, targeted fix, gate. After the first large
   feature commit the fixes ran release/hash/dual detune, spec conformance, metrics and errors,
   click-free audio, accessibility twice, visualisation readouts, a second audit, engine
   correctness, then V2. "Defects appeared, but had a short half-life."

"Few defects" was not zero, but the one figure is not a first-night measure: a later
repository snapshot, read on 2026-10-02 at about 21:54Z (its commit is not recorded; it may
include post-V2 commits such as c367cdb..c43cd38), ran 1 358 unit tests passing and 2 failing
(`6ac027b2`, 21:54:43Z). It is not a measured first-night defect rate, and public copy must not
present it as one.

## The risk the same method carries

ChatGPT's warning at V3 (`6abec18d`, 2026-10-02T03:18:10Z, closing note): the risk is not that
the agent cannot build it but that it is "too willing to implement everything". The later
critiques say the same of scope (`6ac1beb8`, 2026-10-04T03:30:06Z: "scope gravity", each layer
leading logically to the next; `6ac3ead5`, 2026-10-05: attaching good things before their
boundaries firm up). The remedy came from the same critique (`6ac1beb8`, 03:30:06Z: "méně
nových nounů, více fungujících sloves", measurement as "tvoje wedge"; restated as point 252
"PREFER DEPTH OVER BREADTH" in `6ac1beb8`, 2026-10-05T18:20:52Z). The owner adopted it as v4
steering on 2026-10-07: "depth over breadth; fewer new nouns, more working verbs" (ADR 0051).

## Automation the owner asked for that the method does not have

The owner asked why ADRs and the knowledge base do not update automatically (`6abec18d`,
2026-10-01T23:25:22Z). ChatGPT's answer (`6abec18d`, 23:25:49Z) rejected an AI that rewrites
ADRs from diffs as "epistemically wrong" and proposed a trigger instead: name the ADRs a change
affects, then classify each as still conforming, needing clarification, superseded, or needing a
new ADR; knowledge is derived from canonical records. In this repository ADRs stay authored and
`proposed` with appended resolution notes, and knowledge is declared, not collected. The
affected-ADR trigger is a Majordomus capability, not OSCILLA work.
