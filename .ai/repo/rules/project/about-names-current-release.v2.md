---
id: project.about-names-current-release
version: 2
kind: rule
title: The About page names the current release line, from data, never retyped
description: The About timeline is rendered from src/data/about-stations.json; every published release line has a station, the line of package.json is current, and every number on a station is derived or stamped, never typed by hand.
statement: For every MAJOR.MINOR line OSCILLA has published, src/data/about-stations.json has one station with release "MAJOR.MINOR" whose commit is in that line's vMAJOR.MINOR.0 tag and whose datetime is that commit's committer date; the build renders the stations where src/index.html carries <!-- @about-stations -->, deriving the step number, the time shown, the (Vx.y) label and the state, so the station of package.json's MAJOR.MINOR is the last one and the only current one; release, commit and datetime are written only by scripts/about-stations.mjs --stamp, which release:prepare runs after its bump; the file never holds a full X.Y.Z and src/index.html holds no station markup.
status: active
class: blocking
depends_on: [project.single-file-deliverable@2]
tags: [about, release, provenance]
---

# Version 2 (R032, 2026-11-06)

Version 1 required every minor or major release to hand-type its station into
src/index.html: a step number, a commit id, a datetime and its HH:MM twice, the line in
`data-osc-release` and again as "(V3.x)" in the prose, and the previous station's state and
word flipped by hand, plus a source-size raise for the bytes it added (the 3.19, 3.20, 3.21 and
3.22 releases each carried such an edit). The owner's complaint of 2026-11-06 ("something is
hard-coded, numbers are duplicated, not everything is derived") names this: one fact typed in
several places. Version 2 keeps the same guarantee and removes the typing.

# Rationale

The About page tells a visitor how far OSCILLA has come. The release version has one
authority, package.json, and each station's time has one authority, its commit; the page is
held to them rather than to anyone's memory of updating it.

# Required behaviour

- A minor or major release adds one entry `{ "title", "summary" }` at the end of
  src/data/about-stations.json before `release:prepare` (a pending station: no release, no
  commit, no datetime, and no "(Vx.y)" in the summary). `release:prepare` stamps it with the
  line of the bumped package.json, the 7-character id of HEAD and HEAD's committer date
  (`node scripts/about-stations.mjs --stamp`), and restores the file on failure.
- A patch release changes nothing here: its line already has its station, and `--stamp` says
  so and writes nothing.
- Nobody types a step number, a time, a state or a release label: the build derives them.

# Enforcement

`tests/unit/release-about-station.test.mjs` (claim `about-names-current-release`): the file's
shape (a full X.Y.Z, a stored state, a label in the summary, a pending station not last and a
release out of order are each named, mutation cases included), the derivations, the refusal
of a build whose line has no station, the stamp on a scratch repository and its place in
release:prepare's plan before the build.

`tests/unit/about.test.mjs` reads the rendered timeline (expandStations, what the build
renders):

- "the About timeline marks the release line of package.json as current" reads package.json,
  so `npm test`, `npm run verify` and `npm run release-gate` (and so `release:prepare`) fail
  on a bump to a line with no station.
- "every published release line is on the About timeline" reads the `vX.Y.0` tags where they
  are fetched, and checks each line's station names a commit inside that tag.
- "timeline timestamps are the commit times of the commits they name" checks every stamped
  datetime against git (`node scripts/about-stations.mjs --check` does the same on its own).

Use case `read-about-oscilla` traces the claim to its implementation and test.

# Failure behaviour

The build and the release gate refuse; the fix is the pending station in
src/data/about-stations.json, never a test change and never markup in src/index.html.
