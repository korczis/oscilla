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
    - commit:2dc84bf005311c819c7f0c6c598f4ef0e8c897d2
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
throwaway.", derived from git (claim `about-provenance-matches-git`). ChatGPT's earlier
"roughly seven hours from the first tracked commit" (`6abf2a8d`, 2026-10-02T04:11:27Z) had the
same start (16550028, 20:58 UTC) but ended at the then-current `main` at about 04:00 UTC, not at
V2 (9fe0a15, 02:49 UTC).

What the interval was:

- wall-clock time with several reasoning, implementation and audit sessions in parallel. The
  repository snapshot ChatGPT read on 2026-10-02 at about 21:53Z (its commit is not recorded)
  held, by ChatGPT's count, 75 captured prompt and session records under `.ai/local/prompts`,
  including subagent and cross-session messages (`6ac027b2`, 2026-10-02T21:55:24Z). The export
  does not include the listing, so the count is ChatGPT's statement, not verified. The capture
  hooks were committed in 2dc84bf (2026-10-02 00:16 +0200), so captures before about 00:16 are
  unlikely, and the count is not limited to the 22:58-04:49 interval. Public copy must not turn it into
  "75 AI sessions in one night";
- parallel branches, measured from GitHub: PR #3 (`feature/v2`, which became 9fe0a15) was open
  00:54:17Z-02:49:04Z UTC on 2026-10-02 while PR #4 (`fix/v1-engine-round-2`,
  01:15:55Z-01:19:43Z) and PR #5 (`chore/v1-records`, 01:51:29Z-01:55:05Z) were opened and
  merged (`gh pr view 3 4 5 --json createdAt,mergedAt`);
- the owner's account of Majordomus' own pace, pasted under his question about OSCILLA: years
  of experience, existing building blocks, a clear architecture, AI as a parallel
  implementation force (`6ac027b2`, the owner at 21:53:19Z). ChatGPT applied it to OSCILLA,
  saying Majordomus supplied the rules, scope, task lifecycle and verification (21:55:24Z) and
  calling the hours a compression of years of experience (22:03:44Z);
- V1 written and frozen first, then ported (`oscilla-first-night-build-method`).

ChatGPT's suggested wording (`6ac027b2`, 21:55:24Z): not "I programmed OSCILLA in six hours",
but that it came together in about six hours of wall-clock time, with V1 as an executable
specification, Majordomus supplying rules and verification, and several AI workers
implementing, testing, auditing and fixing in parallel. It called "35k LOC in six hours" a
cheap metric.

About carries the interval and "The speed was unusual. The constraints were deliberately not."
but not the parallel-workers qualifier. Q005 is decided (2026-10-18) by the coordinating Claude
session under the owner's delegation of 2026-10-18 ("tak to vse pores"); the owner may
override: About keeps "Built in one night" and the 5 h 51 min derived from git, and qualifies it
as wall-clock time with several AI workers in parallel. The qualifier rests on the PR overlap above and
the two commits; it does not cite the 75 captures or a line count. About is unchanged until the follow-up copy issue lands.
