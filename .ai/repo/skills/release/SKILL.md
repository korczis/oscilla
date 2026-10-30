---
schema: skill/v1
id: release
version: 1
title: Cut, publish and record a release
description: Take a releasable main through release:analyze, the About station and bump, release:prepare, the chore(release) pull request, release:publish and release:record, in the order rule release-flow-complete binds.
status: draft
tags: [release, deployment, provenance]
related: [merge-train]
inputs:
  - releasable commits on main since the newest v* tag, and that tag's record on main
  - gh signed in with push rights; a machine quiet enough for the release gate
outputs:
  - a vX.Y.Z tag, its GitHub Release and a Pages deployment that verify-deploy accepts
  - .ai/repo/releases/vX.Y.Z.yaml on main, landed by its own pull request
---

# Purpose

Runs the release flow of rule `project.release-flow-complete` (and README.md, "Versioning
and releases") with the commands each step needs. The rule says why each step exists and
what the scripts refuse; this skill does not restate it. A release is finished when its
record is on main.

# Procedure

1. Is one due, and is the previous one finished?

   ```bash
   git fetch origin --tags
   node scripts/release-cadence.mjs --report
   npm run release:analyze
   ```

   The newest tag's `.ai/repo/releases/<tag>.yaml` must be on main; `release:prepare`
   refuses without it.

2. Branch from main in its worktree:

   ```bash
   majordomus worktree create chore/release-vX.Y.Z
   cd "$(majordomus worktree path chore/release-vX.Y.Z)"
   npm ci
   majordomus start "Release vX.Y.Z" --scope src/index.html --scope dist \
     --scope package.json --scope package-lock.json
   ```

3. A minor or major only: add the line's station to the About timeline in `src/index.html`
   (rule `project.about-names-current-release`). Append an `<li data-state="current"
   data-osc-release="X.Y">`, turn the previous current station to `data-state="done"`,
   name the commit the line is known by with its commit time
   (`git show -s --format=%cI <sha>`), then commit it before the bump:

   ```bash
   npm run build
   git add src/index.html dist/index.html
   git commit -m "feat(about): the VX.Y station"
   ```

   `tests/unit/about.test.mjs` fails until the bump of step 4 names the same line.

4. Prepare on the clean tree. It bumps once, rebuilds, runs the full gate and writes the
   receipt into the common git directory; on a failure it restores what it changed. The
   browser suites wait for the load to fall below `OSC_LOAD_MAX`, so check the load and
   either wait or state the limit you accept:

   ```bash
   sysctl -n vm.loadavg
   npm run release:prepare -- --dry-run
   OSC_LOAD_MAX=<limit> npm run release:prepare
   git commit -am "chore(release): vX.Y.Z"
   ```

   The first candidate of a major is `npm run release:prepare -- --prerelease`.

5. Land it, and nothing else meanwhile: any other merge to main changes the tree the
   receipt binds (rule `project.release-receipt-binds-gate`).

   ```bash
   majordomus finish --check
   git push -u origin chore/release-vX.Y.Z
   gh pr create --base main --title "chore(release): vX.Y.Z" --body-file <file>
   gh pr merge <n> --auto --squash
   gh pr list --state open --json number,title,autoMergeRequest \
     --jq '.[] | select(.autoMergeRequest != null)'     # only this pull request
   ```

   The release changes `src/` (the About station), so rule `project.definition-of-done` judges
   it: the body carries the `Definition of done` section of `.github/pull_request_template.md`,
   each item naming a path or plan id the head holds (for example `extends: src/index.html`,
   `tested: tests/browser/app.cjs`, `deployed: package.json`), and, when no document under
   `docs/`, `README.md` or `.ai/repo/features/` changes, the line
   `dod-docs: n/a the About station is the release's documentation`.

6. Publish from a fresh clone of main (the primary checkout hosts the owner's trunk), with
   the receipt copied into its git directory:

   ```bash
   git clone git@github.com:korczis/oscilla.git <scratch>/oscilla-release
   cp "$(git rev-parse --git-common-dir)/oscilla-release-gate.json" <scratch>/oscilla-release/.git/
   cd <scratch>/oscilla-release && npm ci
   npm run release:publish
   npm run release:publish -- --yes
   ```

   The dry run names a stuck Pages run instead of waiting on it. `--yes` tags, waits for the
   Pages run, runs `verify-deploy` against that commit and creates the GitHub Release. It
   prints the `majordomus finish` line that closes the task against the published commit.

7. Record it by its own small pull request, before anything starts the next release:

   ```bash
   majordomus worktree create chore/release-record-vX.Y.Z
   cd "$(majordomus worktree path chore/release-record-vX.Y.Z)"
   majordomus start "Record vX.Y.Z" --scope .ai/repo/releases
   npm run release:record -- --version X.Y.Z
   git add .ai/repo/releases
   git commit -m "chore(release): record vX.Y.Z"
   majordomus finish --outcome completed \
     --verify-command "npm run release:record -- --version X.Y.Z --check" --note <file>
   git push -u origin chore/release-record-vX.Y.Z
   gh pr create --base main --title "chore(release): record vX.Y.Z" --body-file <file>
   gh pr merge <n> --auto --squash
   ```

8. Close the release task with the line `release:publish` printed:

   ```bash
   majordomus finish --outcome completed \
     --verify-command "npm run release:verify-deploy -- --commit <sha>" --note <file>
   ```

# Output

- The `chore(release): vX.Y.Z` commit on main, with the About station for a minor or major.
- The `vX.Y.Z` tag, its GitHub Release and a Pages deployment `verify-deploy` accepted.
- `.ai/repo/releases/vX.Y.Z.yaml` on main, from `release:record`, never written by hand.
- The task closed against the published commit.
