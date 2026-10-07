# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OSCILLA — Interactive Sound & Frequency Lab: a browser acoustic laboratory on its V3 line (V3
MEASURE, the V3.1 Studio and later 3.x minors; `package.json` holds the version). Modular `src/`
(ES modules, token-based CSS, Alpine.js, p5.js, uPlot, native Web Audio) builds with esbuild and
a custom packer into ONE static `dist/index.html`, committed and served by GitHub Pages (only
its build-metadata region is stamped at deploy); it must run from `file://` and the Pages
sub-path. V1 is tagged `v1.0.0`. `README.md` covers features, limits, testing, releases and
privacy; `docs/GLOSSARY.md` the terms; the reasons are the ADRs in `.ai/repo/adrs/` (0011 on
for V2 and later; all `proposed`, see its README).

The binding constraints are the project rules in `.ai/repo/rules/project/` (version in the file
name): `project.single-file-deliverable`, `project.audio-engine-discipline`,
`project.no-fake-science`, `project.about-names-current-release`,
`project.studio-model-is-canonical`, `project.typed-ports`, `project.no-silent-feedback`,
`project.visual-identity-lock`. Read them before changing `src/`. Four more bind how the
repository is worked on: `project.rules-name-their-enforcement`,
`project.no-conflict-markers`, `project.worktree-topology` (mechanism: `docs/WORKTREES.md`),
`project.majordomus-layer-current`; `project.shared-machine-discipline` is the advisory
session guidance (no pattern kills, no stash, no chained merge-and-commit, owner-only
actions). Read those before the first command.

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
npm run release:record -- --version X.Y.Z   # .ai/repo/releases/vX.Y.Z.yaml from the Release
majordomus plan status             # milestone progress
```

Ship through small PRs with `gh pr merge --auto --squash`; the required `gate` check
aggregates the CI jobs, whose `npm test` includes `tests/unit/knowledge-integrity.test.mjs`
(the paths the claims, rules and bootstraps name exist; claim and rule tests run in CI).
`majordomus doctor` runs in the pre-commit hook, `npm run verify` and CI; `majordomus finish
--check` before a push.

Releases: the version lives only in `package.json` (`version:check` rejects a hard-coded copy
of the current version elsewhere, this file included). On a clean tree `release:prepare`
bumps it and runs the gate; land `chore(release): vX.Y.Z` by PR; on main `release:publish`,
then `-- --yes`; `verify-deploy` fails Pages on a mismatch; land the release record by a small
PR (`release/record-vX.Y.Z`).

## Plan

`.ai/repo/project/`: V1 `S001`–`S063` and `D001`–`D003` (M001–M004; `S064`–`S095` blocked on
`S000`); V2 `V2xx` (M007–M010, maintenance M034); release engineering `R001`–`R017` (M011);
V3 MEASURE `V3xx` (M012–M020); the V3.1 Studio `V4xx` (M021–M033). Status is derived from
evidence (`majordomus plan evidence <id> ...`, `majordomus plan done <id>`); `majordomus plan
status` is the truth, not this paragraph.

## Architecture of `src/js/`

- `core/` (constants, maths, safety, storage, URL state, `build-info.js`, the V1 `instrument.js`,
  the Studio `trace.js`); `audio/` (`audio-engine.js` and its graph builders, scheduler, `wav`);
  `analysis/`, `sequencer/`, `visualization/`, `charts/`, `labs/`, `data/`.
- `measurement/` (V3 engine: state machine, capture, transfer, IR, RTA, quality, algorithm IDs,
  Worker, `views/`), `calibration/` (profiles, level), `experiments/` (schema, validate, store).
- `studio/` (StudioModel, actions, history, ports, compiler, runtime, transport, patches,
  provenance, templates); `ui/studio/` (workspace, graph and timeline editors, Inspector).
- `ui/` (Alpine shell, Measure and Experiments adapters, dialogs), `main.js` (composition).
- Build and release: `scripts/`. Tests: `tests/unit/`, `tests/browser/`, `tests/visual/`;
  `tests/README.md` says what each proves and which gate runs it.

<!-- majordomus:begin c624a658e5e3 f2d9a1017395dba3 -->
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
`majordomus worktree migrate` rather than continuing where you are. `majordomus worktree
guard` refuses a feature branch committed elsewhere wherever the pre-commit hook asks it;
the policy's `enforcement` says whether it does, and `majordomus doctor` proves the wiring.
<!-- majordomus:end -->
