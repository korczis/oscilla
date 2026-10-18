---
schema: adr/v1
id: adr-0010
kind: adr
title: V1 is finished, verified and deployed before V2 starts on its own branch
status: proposed
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

### 2026-10-18: the tail was not lost; the decision stands

The Context's first sentence is not what happened. The owner's ChatGPT export (conversation
`6abec18d`, knowledge record `chatgpt-oscilla-project`) shows two V1 prompts: the unnumbered
single-file prompt of 2026-10-01T20:42:59Z, whose 63 headings are S001-S063 and which ChatGPT's
own message ended after section 63, "The initial UI"; and a separate numbered multi-page
specification of 20:46:12Z with sections 0-95, the one the "95 sections" of the execution
protocol named. Sections 64-95 of the second are now recorded verbatim in
`docs/specs/oscilla-v1-sections-64-95.md`, with the parts that conflict with later decisions
listed. The decision is unchanged: V1 was sections 1-63, and nothing was invented for the rest.
S000 (receive the text) is satisfied by that file; whether M005 adopts it, triaged against
`project.single-file-deliverable`, or closes is the owner's decision, issue Q001.
