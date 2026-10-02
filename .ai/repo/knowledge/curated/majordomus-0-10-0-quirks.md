---
schema: knowledge/v1
id: majordomus-0-10-0-quirks
kind: knowledge
class: lesson
title: Majordomus 0.10.0 behaviours that shape how this repository is worked
description: Missing worktree command, branch-bound finish check, linked-worktree hooks path, plan evidence flow, and what the product graph (features, use cases, claims, releases, deployments) can and cannot express for OSCILLA.
status: verified
epistemics: observed
date: 2026-10-02
tags:
  - majordomus
  - git
  - workflow
provenance:
  origin: authored
---

# Majordomus 0.10.0 behaviours that shape how this repository is worked

- `majordomus worktree` does not exist in 0.10.0, though the bootstrap text names it.
  Worktrees are made by convention at `<repository>-wt/<branch>` (V2), or by agent isolation
  under `.claude/worktrees/` (ignored).
- The pre-push hook runs `majordomus finish --check`. It fails with "recorded on branch
  'main', now on '<branch>'" when the active task was started on `main`, so feature branches
  are pushed from the `main` checkout (`git push -u origin <branch>`).
- Doctor checks `$MJ_ROOT/.git/hooks`, which does not exist in a linked worktree where
  `.git` is a file. Setting `core.hooksPath` to the primary checkout's `.git/hooks` keeps the
  hooks running and doctor passing there.
- A new branch with no checkpoint or handover fails doctor's lifecycle checks on commit.
  Run `majordomus checkpoint --derive` and `majordomus handover` on that branch first.
- The `majordomus decision` log is append-only. A wrong number in an entry is corrected by a
  new entry with `--supersedes`, never by editing.
- Plan status is derived only from evidence: `majordomus plan evidence <id> --covers verified
  --type test --command ... --result ... --artifact <commit>`, then `majordomus plan done <id>`.

## The product graph for a static web app

Features are `.ai/repo/features/*.md`, use cases `.ai/repo/use-cases/*.md`, and the bridge
from both to source and tests is `docs/CLAIMS.yaml` (claim -> implementation -> test). What
0.10.0 does with them here:

- feature/v1 has no `planned` status (enum `stable`, `draft`, `deprecated`). The V3 features
  are `draft` and name claims whose `status: planned` has `implementation: "-"` and `test: "-"`.
- A stable feature's mechanism floor (`modules`, `commands`, `kinds`) names Majordomus's own
  capability modules, shell commands and layer kinds, none of which is an OSCILLA mechanism,
  so `product validate` warns once per stable feature. The warning is expected.
- use-case/v1 `commands` and every scenario step must be `bin/majordomus` commands; a fixture
  scenario needs the tool's own fixture scripts and a live one only read-only commands. The
  OSCILLA use cases are live scenarios over `majordomus knowledge edges` that prove each
  claim's implementation and test are tracked; the npm scripts prove the behaviour.
  `doctrines` accepts only rules with a validator, which no project rule has.
- `usecase coverage` counts commands and guaranteed claims that carry a `responsibility`
  (a Majordomus responsibility), so OSCILLA claims are never coverage targets.
- `majordomus-cli evidence show` reports every guaranteed claim `unrunnable`: the ledger
  records only `test/run.sh` and `cargo test` runs. The proof is the CI release gate.
- The front-matter reader keeps a doubled `''` inside a single-quoted string literally:
  write titles and summaries without apostrophes.
- The shell `knowledge` extractor has no rule for kind `feature` (one WARN, nodes `unknown`);
  `majordomus-cli product show <id>` resolves a feature's references, and
  `majordomus-cli entity show claim/<id>` shows a claim with its ADR, implementation, test and
  the use cases that name it.
- release/v1 requires GitHub release-download artifact URLs for Majordomus's own platform
  targets, deployment/v1 allows only `provider.name: fly` with a Cargo build and health
  routes, `release version` reads the Cargo manifest, and `served observe` probes
  `<url>/build.json`. None fits a single-file GitHub Pages deployment, so no canonical object
  records the public version and commit yet (peer issues R002, R003, R005).
