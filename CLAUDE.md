# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OSCILLA — Interactive Sound & Frequency Lab: a dense browser-based acoustic laboratory (V2).
Modular source in `src/` (ES modules, plain token-based CSS, Alpine.js, p5.js, uPlot, native
Web Audio API) builds with esbuild and a custom packer into ONE static `dist/index.html`, which
is committed and is what GitHub Pages serves (only its build-metadata region is stamped at
deploy). It must run from `file://` and from the Pages sub-path. V1, the hand-written single
file, is tagged `v1.0.0`. `README.md` covers features, limits, architecture, testing, releases,
privacy and licences; the reasons are the ADRs in `.ai/repo/adrs/` (0011-0029 for V2/V3).
Read those instead of restating them here.

The binding constraints are project rules under `.ai/repo/rules/project/`:
`project.single-file-deliverable` (v2), `project.audio-engine-discipline` (v2) and
`project.no-fake-science`. Read them before changing `src/`.

## Commands

```bash
npm ci
npm run verify                     # fast: unit, version/build checks, verify-dist, doctor
npm run build                      # src/ -> dist/index.html; commit dist/ with the change
npm run release-gate               # full gate (what it runs: package.json, tests/README.md)
npm run visual                     # compare against the visual reference at 1536x1024
npm run release:analyze            # SemVer level needed by the commits since the last v* tag
npm run release:prepare            # clean tree -> bump once, rebuild, gate; restores on failure
npm run release:publish            # dry run; `-- --yes` tags, waits for Pages, verifies, releases
npm run release:verify-deploy      # prove the public page is the committed dist at HEAD
open dist/index.html               # run it (file://)
majordomus plan status             # milestone progress
```

Ship through small PRs with `gh pr merge --auto --squash`; the `gate` check is required on main.

Releases: the product version lives only in `package.json` (`version:check` rejects a
hard-coded copy of the current version anywhere else, this file included). `release:prepare`
on a clean tree bumps it once and runs the gate; commit the result as `chore(release): vX.Y.Z`
and land it on main by PR; then on main `release:publish` (dry run), `release:publish -- --yes`.
Pages stamps the deployed commit into dist and `verify-deploy` fails the workflow on mismatch.

## Plan

V1 issues `S001`–`S063` (M001–M004) and `D001`–`D003` are done; `S064`–`S095` stay blocked on
`S000`. V2 is the `V2xx` issues across `M007`–`M010`; release engineering, provenance and the
product graph are `R001`–`R017` (M011); V3 MEASURE is the `V3xx` issues across `M012`–`M020`.
Status is derived from recorded evidence: `majordomus plan evidence <id> ...` then
`majordomus plan done <id>`.

## Architecture of `src/`

- `js/core/` — constants, frequency/music maths, safety rules, storage, URL state, pure config,
  `build-info.js` (runtime build provenance; the only place the runtime learns the version)
  and `instrument.js` (the V1 component logic without its DOM).
- `js/audio/` — `audio-engine.js` (owns the context, voices, master chain; V2 hooks `inserts`,
  `periodicWave`, `adsr`, `dualRouter`), `voice/scheduler/modulation/patterns`, plus graph
  builders (`filters`, `stereo`, `additive`, `envelope`, `noise`) and `wav`/`offline-renderer`.
- `js/analysis/` — analyser reader, peak/pitch estimation, correlation, compare, spectrogram.
- `js/sequencer/` — block model, compiler to scheduled Web Audio events, timeline, editor.
- `js/visualization/` (p5 views via the bridge and `engine.snapshot()`), `js/charts/` (uPlot and
  canvas renderers on one frame loop), `js/labs/` (panel controllers), `js/ui/` (Alpine shell,
  dialogs, workbench, exporters), `js/main.js` (composition and bootstrapping).
- Build and release scripts: `scripts/build.mjs`, `pack-single-file.mjs`, `verify-dist.mjs`;
  `release-metadata.mjs` (the one version/provenance helper) and the `release-*.mjs`,
  `stamp-build.mjs`, `verify-deploy.mjs` scripts that consume it.
- Tests: `tests/unit/` (including the V1 freeze in `tests/freeze/`), `tests/browser/` (release
  gate, V1 engine port, DSP, sequencer, labs), `tests/visual/` (regions of the reference).

<!-- majordomus:begin 9535da72e6a6 c99ef4280d2c8948 -->
# CLAUDE.md

Claude Code bootstrap. The repository's provider-neutral AI context lives under
[`.ai/`](.ai/); nothing specific to Claude is needed here.

Read `README.md`, then [`.ai/README.md`](.ai/README.md), and follow its
discovery protocol: the effective rules under `.ai/repo/rules/` with their
dependencies, the workflows and knowledge the task needs, and never `.ai/local/`.

Before working under a path, run `majordomus context resolve <path>` (or read the
`README.md` chain from `.ai/` down to that directory): each document adds to its
ancestors and the nearest one does not replace them. A provider's own nested-file
loading is an optimisation; the Majordomus resolution is what applies.

This repository is supervised by Majordomus. Run `majordomus context` before working;
the task lifecycle is `.ai/repo/workflows/task-lifecycle.md`; the default profile is
`implementation`. `AGENTS.md` carries the same bootstrap for every
other worker, and a rule that exists in one of these files and not in `.ai/` is a bug.

Linked git worktrees of this repository live at `<repository>-wt/<branch>` — the primary
checkout's sibling named with `-wt`, then the branch name with its hierarchy kept — derived
from git and never chosen or registered; the primary checkout hosts the trunk. Before
implementing, run `majordomus worktree` to see which branch and worktree you are in and
whether that is where the branch belongs; start new work with `majordomus worktree create
<branch>` and continue in the path it prints; bring a misplaced worktree home with
`majordomus worktree migrate` rather than continuing where you are. The pre-commit hook
refuses a feature branch committed from anywhere but its canonical worktree. The rule is
`project.worktree-topology`; the mechanism is `docs/WORKTREES.md`.
<!-- majordomus:end -->
