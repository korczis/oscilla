---
schema: adr/v1
id: adr-0010
kind: adr
title: V1 is finished, verified and deployed before V2 starts on its own branch
status: accepted
date: 2026-10-02
tags:
  - planning
  - scope
provenance:
  origin: authored
---

# 10. V1 is finished, verified and deployed before V2 starts on its own branch

## Context

The specification paste ended mid-sentence in section 63; sections 64-95 never arrived. Later
the person supplied a separate V2 mission (modular src/, built dist/index.html, pure-function
freeze tests), also truncated (mid-section 14), and a v2.0 mockup.

## Decision

- V1 (sections 1-63) is finished, verified and deployed from `main` first, then given a
  baseline tag.
- S064-S095 stay BLOCKED on S000. No requirements are invented from section titles or the
  mockup.
- V2 is built on `feature/v2` in its canonical worktree (`oscilla-wt/feature/v2`). It amends
  `project.single-file-deliverable` and `pages.yml` on that branch only, and ships as its own
  auto-merge pull request once its release gate passes.
- V1 pull requests touch only `index.html`, `tests/*.cjs` and the CI step, so the V2 rebase
  stays mechanical.

## Consequences

- The deployed site is V1 until V2's gate passes.
- V2 ports V1 fixes from `index.html` diffs into its modules after each V1 merge.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: complete

Done as decided. V1 (sections 1-63) was finished, verified and deployed from `main` and tagged
`v1.0.0`; V2 was built on its own branch and shipped as its own pull request (9fe0a15, #3);
S064-S095 remain blocked on S000. V3 and the V3.1 Studio followed the same pattern. The
`oscilla-wt/feature/v2` worktree and the V1-only file layout it names no longer exist.

### 2026-10-18: accepted by the owner

Accepted by the owner (explicit instruction in the session of 2026-10-18, applied by the
coordinating Claude session) — implemented as described; evidence: tag `v1.0.0`; V2 shipped as
its own pull request (9fe0a15, #3); S064-S095 still blocked on S000 (its 2026-10-05 note).

### 2026-10-18: the tail was not lost; V1 stays sections 1-63

The Context's first clause holds: the single-file message stopped mid-sentence inside section
63, after the words "The initial UI", with its text block unclosed. Its second clause is what
changes. The owner's ChatGPT export (conversation `6abec18d`, knowledge record
`chatgpt-oscilla-project`) shows two V1 prompts: the unnumbered single-file prompt of
2026-10-01T20:42:59Z, whose 63 headings are S001-S063 and which, as exported, stops inside
section 63 (whether it would have continued is unknown; nothing of it after that point
exists); and a separate numbered multi-page specification of 20:46:12Z with sections 0-95, the
one the "95 sections" of the execution protocol named. Sections 64-95 of the second are now
recorded verbatim in `docs/specs/oscilla-v1-sections-64-95.md`, with the parts that conflict
with later decisions listed; nothing was lost in a paste. What stands: V1 was sections 1-63,
and no requirements are invented. S000 (receive the text) is satisfied by that file, which
supersedes the Decision's "S064-S095 stay BLOCKED on S000" and the 2026-10-05 note's "remain
blocked on S000": after the Q001 triage, twenty-one of S064-S095 are cancelled and the eleven
kept as work wait on Q001. Q001 was decided on 2026-10-18 by the coordinating Claude
session under the owner's delegation of that day ("tak to vse pores"), and the owner may
override it: M005 adopts the text as its source, every section triaged against
`project.single-file-deliverable`, S001-S063 and the ADRs from 0011 on, so that the superseded
and the already delivered sections are cancelled with their reason and only the rest is work.
The first Decision bullet is unchanged by that: V1 itself stays sections 1-63.
