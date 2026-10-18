---
schema: knowledge/v1
id: built-in-one-night-is-wall-clock
kind: knowledge
class: fact
title: "\"Built in one night\" is 5 h 51 min of wall-clock time from the first tracked commit to V2 on main, with several AI workers in parallel; it is not six hours of one programmer"
description: "The qualifier any public claim about OSCILLA's pace needs; read before writing a sentence about how long OSCILLA took."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - history
  - messaging
provenance:
  origin: authored
  derived_from:
    - commit:16550028982de3c0128b9b0dd29e00d782015678
    - commit:9fe0a15de5511a5158d786e654dc28869063628f
    - file:src/index.html
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
  - type: relates_to
    target: knowledge:oscilla-first-night-build-method
---

# "Built in one night" means wall-clock time

The git facts: the first tracked commit is 16550028 at 2026-10-01 22:58:26 +0200 ("bootstrap
.ai layer and 95-section plan model"); V2 reached `main` as 9fe0a15 at 2026-10-02 04:49:03
+0200. About states the interval, 5 h 51 min, under "Built in one night. Not built as a
throwaway.", derived from git (claim `about-provenance-matches-git`). ChatGPT's earlier "about 7
hours" (`6abf2a8d`, 2026-10-02T04:11:27Z) counted from another starting point.

What the interval was:

- wall-clock time with several reasoning, implementation and audit sessions in parallel. The
  snapshot ChatGPT read held about 75 captured prompt and session records for that window,
  including subagent and cross-session messages (`6ac027b2`, 2026-10-02T21:55:24Z);
- built on years of the owner's experience and existing building blocks, with Majordomus
  supplying the rules, scope and task lifecycle (`6ac027b2`, the owner at 21:53:19Z);
- V1 written and frozen first, then ported (`oscilla-first-night-build-method`).

ChatGPT's suggested wording (`6ac027b2`, 21:55:24Z): not "I programmed OSCILLA in six hours",
but that it came together in about six hours of wall-clock time, with V1 as an executable
specification, Majordomus supplying rules and verification, and several AI workers
implementing, testing, auditing and fixing in parallel. It called "35k LOC in six hours" a
cheap metric.

About carries the interval and "The speed was unusual. The constraints were deliberately not."
but not the parallel-workers qualifier. Whether the public copy adds it is the owner's decision
(issue Q005); About is not changed by this record.
