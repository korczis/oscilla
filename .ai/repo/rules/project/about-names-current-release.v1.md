---
id: project.about-names-current-release
version: 1
kind: rule
title: The About page names the current release line
description: The About view's evolution timeline names every published release line and marks the line of the running build as current; a release whose line is missing is refused by the gate.
statement: For every MAJOR.MINOR line OSCILLA has published, the About timeline in src/index.html has one station with data-osc-release="MAJOR.MINOR" that names a commit in that line's vMAJOR.MINOR.0 tag; the last station is the only one with data-state="current" and its line is package.json's MAJOR.MINOR; every earlier station is done.
status: active
class: blocking
depends_on: [project.single-file-deliverable@2]
tags: [about, release, provenance]
---

# Rationale

The About page tells a visitor how far OSCILLA has come. Its timeline stopped at V3.1 while
V3.2 and V3.3 shipped, because nothing tied the page to the release process. The release
version has one authority, package.json, so the page is held to it rather than to anyone's
memory of updating it.

# Required behaviour

- A minor or major release adds its station to the About timeline in the same change that
  lands before `release:prepare`: a one-word title, one line on what the line delivered, the
  commit the line is known by (its merge or its `chore(release)` commit) with that commit's
  time, and `data-osc-release`. The previous current station becomes done.
- A patch release changes nothing here: its line is already current.
- Times on the timeline are commit times (claim `about-provenance-matches-git`).

# Enforcement

`tests/unit/about.test.mjs` (claim `about-names-current-release`):

- "the About timeline marks the release line of package.json as current" reads package.json,
  so `npm test`, `npm run verify` and `npm run release-gate` (and so `release:prepare`) fail
  on a bump to a line the page does not name.
- "every published release line is on the About timeline" reads the `vX.Y.0` tags where they
  are fetched, and checks each line's station names a commit inside that tag.

Use case `read-about-oscilla` traces the claim to its implementation and test.

# Failure behaviour

The release gate refuses the release; the fix is the timeline station, never a test change.
