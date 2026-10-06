---
schema: adr/v1
id: adr-0047
kind: adr
title: A major release is preceded by a release candidate; v3.0.0 was not
status: proposed
date: 2026-10-06
tags:
  - release
  - deviation
provenance:
  origin: extracted
  derived_from:
    - file:scripts/release-prepare.mjs
    - file:scripts/release-publish.mjs
    - issue:V386
---

# 47. A major release is preceded by a release candidate; v3.0.0 was not

## Context

Specification §233 (V3) asks for `3.0.0-rc.1` during final validation "if the release process
supports prereleases". It did: at the `v3.0.0` tag (5d94576, 2026-10-03)
`scripts/release-prepare.mjs` already accepted `--prerelease [--preid rc]`, and
`release-publish.mjs` creates a SemVer prerelease as a GitHub prerelease that is never marked
latest. No candidate was cut: the repository has no `*rc*` tag, and 3.0.0 was released
directly. Plan issue V386 has carried this as unmet through three evidence rounds.

It cannot be made true afterwards. Tagging a `v3.0.0-rc.1` now, on a commit that was never
offered as a candidate, would be a false record. So the gap is closed the only honest way: by
recording the deviation and the rule that applies from now on.

What a candidate adds here is specific. Pages deploys every push to `main`, so the public page
is always the head of `main`. A release candidate is the only state in which the public page
says it is a candidate (the status bar and the provenance region carry `X.Y.Z-rc.N`), and in
which `release:verify-deploy` and `test:live` run against that candidate before anyone calls
it the release.

## Decision

Proposed:

- **The deviation is recorded, not repaired.** v3.0.0 shipped without a release candidate,
  although the process supported one. No retroactive tag is created. V386's §233 criterion is
  answered by this record, not by a claim that a candidate existed.
- **A major release is preceded by a release candidate.** `X.0.0` is first prepared with
  `npm run release:prepare -- --prerelease` (giving `X.0.0-rc.1`), published with
  `release:publish -- --yes`, proven with `release:verify-deploy` and `test:live`, and recorded
  with `release:record` on the prerelease channel. A defect found while the candidate is live
  is fixed on `main` and shipped as `rc.N+1` the same way. `X.0.0` is prepared from the last
  candidate's `main` only after that candidate has passed live verification.
- **Minor and patch releases need no candidate.** Each already passes the full release gate
  (with a receipt bound to the source digest and the dist sha256), `verify-deploy` and
  `test:live` in Chromium, Firefox and WebKit. A candidate before each would double the release
  work for a single static page without testing anything the live verification does not.

## Alternatives rejected

- **Tag a `v3.0.0-rc.1` retroactively.** It would name a candidate that was never offered, a
  false provenance record.
- **A candidate before every release.** It costs a second publish and verification cycle per
  patch and adds no check the live verification of the release itself does not make.
- **Leave V386 open indefinitely.** An unmeetable criterion left open makes the plan say less
  than the truth: that the deviation happened and what was decided about it.

## Consequences

- v4.0.0 is published first as `4.0.0-rc.1`. The public page shows the candidate version for
  the candidate window; that is intended.
- The rule is a process commitment. No script refuses a major release without a prior
  candidate; `release:prepare` would have to compare the last `v*` tag to enforce it. Until
  such a check exists, the release issue of each major milestone carries the rule in its
  acceptance criteria.
- `release:analyze` already finalises a prerelease (`X.0.0-rc.N` plus a major level gives
  `X.0.0`, per `scripts/release-metadata.mjs`), so the flow needs no new tooling.
