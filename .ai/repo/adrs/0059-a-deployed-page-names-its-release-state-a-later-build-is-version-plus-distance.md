---
schema: adr/v1
id: adr-0059
kind: adr
title: A deployed page names its release state; a build after its version's tag shows version+distance
status: proposed
date: 2026-10-18
tags:
  - release
  - deployment
  - provenance
related:
  - rule:project.release-flow-complete
  - rule:project.deploy-often
  - rule:project.about-names-current-release
  - file:scripts/release-metadata.mjs
  - file:scripts/stamp-build.mjs
  - file:scripts/verify-deploy.mjs
  - file:src/js/core/build-info.js
  - file:tests/browser/live-smoke.cjs
  - file:.github/workflows/pages.yml
  - file:tests/unit/release-provenance.test.mjs
  - file:tests/unit/release-validation-pins.test.mjs
provenance:
  origin: extracted
  derived_from:
    - file:docs/v31/review-v431.md
---

# 59. A deployed page names its release state; a build after its version's tag shows version+distance

## Context

`project.deploy-often` makes `pages.yml` deploy every push to `main`, and the deploy stamp
(ADR 0028, `scripts/stamp-build.mjs`) wrote the version of `package.json`. Between releases
`package.json` carries the version of the last release, so every commit after a release was
served under that release's bare version:

- 2026-10-06 to 2026-10-17: the page said v3.10.3 over 155 later commits (964e25d).
- 2026-10-18, review V272 finding D1: two hours after v3.11.0 (2b63ec3) the page was 2d56148,
  still labelled 3.11.0. `verify-deploy --commit 2b63ec3...` failed on the commit; M035
  ("the public page carries 3.11.0 and the release commit") still read as met, because its
  validation, `npm run release:verify-deploy` with no `--commit`, compares the page with
  whatever checkout runs it and passes on any main HEAD.

The page proved its commit (the About view links it) but presented a later build as the
release, and nothing checked the difference.

## Decision

The deploy stamp records where the deployed commit stands relative to the tag `v<version>`,
read from git at stamp time (`releaseState()` in `scripts/release-metadata.mjs`):

| `release` | `distance` | when | the page shows |
| --- | --- | --- | --- |
| `tagged` | 0 | `v<version>` points at the commit | `v<version>` |
| `after-tag` | N >= 1 | `v<version>` is an ancestor, N commits back (`git rev-list --count`) | `v<version>+N.g<short>` |
| `untagged` | null | no `v<version>` yet: the version is unpublished | `v<version>` |

- The production record becomes schema 2 with the two keys appended; the committed (source)
  record stays schema 1, so the stamp is still region-only and `normalizeStamped()` still
  reverses it to the committed dist byte for byte (`build:check`, `verify-dist` unchanged).
- The label is SemVer build metadata (`3.11.0+20.g2d56148`, git-describe style).
  `window.OSCILLA.version` stays `package.json`'s version; `BUILD.label` is what the status
  bar, the About view's Version row, the screenshot title and `?debug=1` show, and the About
  view adds a Release row (`BUILD.releaseText`).
- `untagged` shows the bare version because the release commit is deployed when its
  `chore(release)` pull request merges, before `release:publish` tags it. `verify-deploy`
  accepts a page stamped `untagged` whose commit git now reports `tagged`: that is the
  release, verified by `release:publish` right after it creates the tag. Any other
  disagreement between the stamp and git is a `release:` problem, and fatal.
- The stamp refuses a shallow clone and a clone without `v*` tags (both would call every
  build `untagged`), and a commit whose version's tag is not an ancestor. `pages.yml` checks
  the deploy job out with `fetch-depth: 0`.
- `tests/browser/live-smoke.cjs` checks that `window.OSCILLA.build.label` is the label of the
  region's release state and that the status bar shows it; `verify-deploy` has checked the
  state against git before the smoke runs.
- A plan or intent validation that runs `release:verify-deploy` or `test:live` names the
  commit it proves (`--commit <rev>`, `--expect-commit <rev>`; a SHA, a tag or `origin/main`),
  held by `tests/unit/release-validation-pins.test.mjs`. A release's proof is its own Pages
  run (the run id and its `headSha`) and its record; the live page proves only main's head.

## Alternatives rejected

- **Redeploy on the tag** (`pages.yml` on `push: tags: [v*]`), so the release commit is
  re-stamped `tagged` once the tag exists and `untagged` could show a marker. The
  `github-pages` environment allows deployments from `main` only (deployment branch policy
  read 2026-10-18), so a tag-triggered run cannot deploy; and `release:publish` waits for "the
  Pages run of HEAD", which would then be two runs. A `workflow_dispatch` on `main` from
  `release:publish` after tagging would work within the policy; it needs a change to
  `release:publish` and its tests and is left as a follow-up.
- **Stamp the bump commit as the release** (the first commit carrying the version). After a
  merge between prepare and publish, `release:prepare` confirms the version again and the tag
  lands on a later commit, which that rule would label as after the release.
- **Show the distance on every build, the release included** (`3.11.0+0.g2b63ec3`). The
  release is what a visitor should be able to name; the bare version is reserved for it.
- **Stop deploying between releases.** Contradicts `project.deploy-often`, which wants merged
  work on the public page.

## Consequences

- Between releases the public page reads `OSCILLA v<version>+<N>.g<short>`; only a release
  page reads `OSCILLA v<version>`. A later build cannot present itself as the release.
- Known gap: a commit that carries an unpublished version and is never tagged (a merge
  between `release:prepare` and `release:publish` that the receipt then refuses) shows the
  bare version while it is live. It is replaced by the next deploy; nothing marks it.
- Pages runs before this change stamped schema 1; `verify-deploy` refuses such a page, so the
  first deploy after this lands is the first that passes it.
- Plan items whose validation proves a past deployment now fail when re-run after main has
  moved, instead of passing on the current page. That is the honest reading of a
  point-in-time claim; their durable proof is the cited Pages run and release record.
