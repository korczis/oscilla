---
schema: moment/v1
id: published-page-is-not-the-released-bytes
kind: moment
title: 'A published page that is not the released bytes'
short_title: 'Unverified deploy'
hook: 'could not say which commit, version and inputs the page on GitHub Pages was built from'
summary: 'The page that is served differs from what the release gate passed, or cannot prove what it was built from, so a release record and an experiment''s build provenance point at nothing certain.'
status: stable
severity: high
frequency: rare
weight: 120
audiences: [maintainers, researchers]
areas: [delivery]
lifecycle: [operations, maintenance]
tags: [release, provenance, receipt, pages]
signals:
  - id: merged-after-gate
    text: 'A pull request merged between the release gate and the publish.'
  - id: page-without-provenance
    text: 'The live page could not say which commit and source digest it was built from.'
  - id: about-out-of-date
    text: 'The About page named an older release line than the one published.'
examples:
  - id: merged-during-release
    audience: maintainers
    title: 'Two pull requests after the gate'
    before: 'New CI jobs and un-skipped tests merged after the gate had run; the receipt still verified because neither touched a build input, and the release was published on a tree whose tests the gate never ran.'
    after: 'The receipt also binds the tree the gate passed, and release:publish refuses on any difference before it creates a tag.'
  - id: fixed-point
    audience: maintainers
    title: 'A file cannot contain its own commit'
    before: 'The committed page cannot carry the SHA of the commit that contains it, and a separate build file would break the single-file rule.'
    after: 'The deterministic build writes one inline metadata region; the Pages workflow stamps only that region, and verify-deploy reverses the stamp and compares the live page byte for byte with the committed file.'
  - id: which-build-measured
    audience: researchers
    title: 'Which build made this experiment?'
    before: 'An experiment made from a source build was not tied to its exact source.'
    after: 'An experiment records the build with its source digest and, for a deployed build, the artifact SHA-256, and About shows the running build''s version, commit, channel and source digest.'
claims: [single-file-build, dist-self-contained, about-names-current-release, about-provenance-matches-git, reproducible-experiments]
doctrines: [project.release-receipt-binds-gate, project.single-file-deliverable, project.release-flow-complete, project.about-names-current-release]
use_cases: [open-under-the-oscilla-sub-path, read-about-oscilla, open-from-file]
related: [page-breaks-offline-or-on-a-sub-path, number-nobody-can-trace-or-repeat]
aliases: ['deploy verification', 'release receipt', 'build provenance', 'stale About page']
---

## The moment

The release is tagged and Pages has deployed. Somebody asks which commit the live page is,
and whether the gate ran on it. The tag says one thing; the merges after the gate say another.

## Why it happens

A committed file cannot contain the SHA of the commit that contains it
([ADR 0028](../../adrs/0028-provenance-without-a-fixed-point.md)). And a receipt that binds
only the build inputs still verifies after a merge that changed the tests or workflows: on
2026-10-06 pull requests #144 and #147 merged after the v3.10.3 gate and the release was
published anyway (rule `project.release-receipt-binds-gate`).

## What it costs

A release record and every experiment's build provenance that point at bytes nobody verified,
and a public page that cannot be tied to the tests that were supposed to protect it.

## What OSCILLA does

The build is deterministic and the committed `dist/index.html` equals a rebuild; the Pages
workflow stamps only the inline build-metadata region, and `scripts/verify-deploy.mjs` proves
the rest of the deployed page is the committed file (rule `project.single-file-deliverable`).
The release receipt binds the version, the dist bytes, the source digest and the gated tree,
and `release:publish` refuses on any difference (rule `project.release-receipt-binds-gate`).
The release flow is completed in order, with its record
([ADR 0057](../../adrs/0057-a-static-pages-deployment-is-evidenced-by-its-release-v1-rec.md),
rule `project.release-flow-complete`), and the About page names the current release line
(rule `project.about-names-current-release`).

## How to verify it

`npm run verify` runs the build and dist checks and `npm test`; `npm run build:check` proves
the committed page matches a rebuild; `tests/unit/about.test.mjs` holds the About timeline to
`package.json`.

## What it does not do

It does not stop a merge from landing during a release: nothing prevents the merge, and the
rule makes the publish refuse afterwards.
