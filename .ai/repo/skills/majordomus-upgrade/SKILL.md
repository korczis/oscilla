---
schema: skill/v1
id: majordomus-upgrade
version: 1
title: Move the .ai layer and the CI pin to a new Majordomus
description: Migrate the .ai layer to a new Majordomus release and move MJ_VERSION and MJ_SHA256 with it, proven by doctor under both versions (rule majordomus-layer-current, ADR 0056).
status: draft
tags: [majordomus, ci, migration]
related: [review-a-guarded-pr]
inputs:
  - the new release as a versioned tree under ~/.local/share/majordomus/versions/<new>
  - the version CI pins today, MJ_VERSION in .github/workflows/ci.yml
outputs:
  - a migrated .ai layer that doctor passes under the new version (and the old one, when it can)
  - MJ_VERSION and MJ_SHA256 moved together, the digest checked against the release asset
  - one pull request, or two when a layer passes under both versions
---

# Purpose

Keeps the tool the git hooks run and the tool CI pins judging the same layer (rule
`project.majordomus-layer-current`). The procedure is the one
`scripts/majordomus-pin-check.mjs` prints (`PROCEDURE`), with the commands it leaves out.
It never flips the machine-wide launcher at `~/.local/bin/majordomus`: that is the owner's.

# Procedure

1. Read both versions and name the two binary directories:

   ```bash
   grep -n 'MJ_VERSION\|MJ_SHA256' .github/workflows/ci.yml
   majordomus version
   ls ~/.local/share/majordomus/versions/
   MJ_NEW="$HOME/.local/share/majordomus/versions/<new>/bin"
   MJ_OLD="$HOME/.local/share/majordomus/versions/<old>/bin"
   ```

   A version that is not in that directory is installed into a scratch prefix. Read the
   script first. Never install into the default prefix or without `--install-dir`: the
   installer rewrites the machine-wide launchers there and removes the superseded trees,
   the pinned one included.

   ```bash
   curl -fsSL https://majordomus.dev/install.sh -o <scratch>/install.sh
   sh <scratch>/install.sh --version <old> --prefix <scratch>/mj --install-dir <scratch>/mj/bin
   MJ_OLD=<scratch>/mj/versions/<old>/bin
   ```

2. Start the branch in its worktree:

   ```bash
   majordomus worktree create chore/majordomus-<new>
   cd "$(majordomus worktree path chore/majordomus-<new>)"
   npm ci
   majordomus start "Migrate the .ai layer to Majordomus <new>" --scope .ai \
     --scope AGENTS.md --scope CLAUDE.md --scope GEMINI.md --scope .github/workflows/ci.yml
   ```

3. Migrate the layer with the new binary:

   ```bash
   PATH="$MJ_NEW:$PATH" majordomus rules vendor diff
   PATH="$MJ_NEW:$PATH" majordomus rules vendor update
   PATH="$MJ_NEW:$PATH" majordomus doctor 2>&1 | grep -n 'missing required key\|declares no\|FAIL'
   ```

   For each missing key, copy its value from
   `~/.local/share/majordomus/versions/<new>/share/skeleton/policy.yaml` into
   `.ai/repo/policy.yaml`, never waving the line through as a warning. Then regenerate the
   projections (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`):
   `PATH="$MJ_NEW:$PATH" majordomus update`.

4. Judge the layer under both versions:

   ```bash
   PATH="$MJ_NEW:$PATH" majordomus doctor | tail -1     # doctor: 0 failure(s)
   PATH="$MJ_OLD:$PATH" majordomus doctor | tail -1
   ```

5. Move the pin. Take the digest of the CI target from the release metadata and check it
   against the downloaded asset (in a directory of its own):

   ```bash
   curl -fsSL https://majordomus.dev/releases/v<new>.json -o <scratch>/rel.json
   jq -r '.artifacts["x86_64-unknown-linux-gnu"].sha256' <scratch>/rel.json
   url=$(jq -r '.artifacts["x86_64-unknown-linux-gnu"].url' <scratch>/rel.json)
   curl -fsSL -o <scratch>/asset.tar.gz "$url"
   shasum -a 256 <scratch>/asset.tar.gz     # the same digest
   ```

   Edit `MJ_VERSION` and `MJ_SHA256` in `.github/workflows/ci.yml` together, with the
   version in the `knowledge` job's name and comments (`grep -n '<old>' .github/workflows/ci.yml`).

6. Verify with the new binary first on PATH, since the launcher still selects the old one:

   ```bash
   PATH="$MJ_NEW:$PATH" npm run verify
   ```

   `tests/unit/knowledge-integrity.test.mjs` refuses a Majordomus version other than the
   pin in a rule's enforcement section or `docs/WORKTREES.md`; update those lines.

7. Land it:
   - step 4 passed under both versions: the layer is one pull request and the pin a second
     one, landed after it;
   - the old version cannot read the new layer (an unknown key, a rule naming a validator it
     lacks): one pull request carries both, and its body shows both doctor outputs
     ([ADR 0056](../../adrs/0056-majordomus-pin-moves-with-the-layer.md)).

   The pin touches `.github/`, so the pull request needs a reviewer's verdict (skill
   `review-a-guarded-pr`). Its body carries the waiver line
   `fail-first: n/a tooling and CI pin migration, no behaviour change in src/`.

8. List the launcher flip for the owner and stop there.

# Output

- A branch whose layer passes `doctor` under the new version (and the old one, or the
  reason it cannot), with `MJ_VERSION` and `MJ_SHA256` moved together.
- The pull request or pull requests of step 7, with both doctor outputs and the digest check.
- A note to the owner that the launcher at `~/.local/bin/majordomus` can be flipped.
