# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OSCILLA — Interactive Sound & Frequency Lab: a browser-based acoustic laboratory and
synthesizer-like frequency playground. The whole application is one file, `index.html`, built
with Tailwind (Play CDN), Flowbite, Alpine.js, p5.js and the native Web Audio API. It must run
from `file://` and from GitHub Pages.

The binding constraints are project rules under `.ai/repo/rules/project/`:
`project.single-file-deliverable`, `project.audio-engine-discipline` and `project.no-fake-science`.
Read them before changing `index.html`.

## Commands

```bash
open index.html                    # run it (file://)
python3 -m http.server 8000        # serve it the way GitHub Pages does
majordomus plan next               # the spec section to implement now
majordomus plan status             # milestone progress
```

Planned, not yet in the repository: `tests/smoke.cjs` (Playwright smoke test, installed with
`npm --prefix tests install`, run with `node tests/smoke.cjs [--url <deployed-url>]`) and
`.github/workflows/pages.yml` (GitHub Pages deployment publishing only `index.html`).

## Plan

Each numbered section of the specification is one Majordomus issue in
`.ai/repo/project/issues/`: `S001`–`S063` across milestones `M001`–`M004`. The specification
paste ended mid-sentence in section 63, so `S064`–`S095` depend on `S000` (receive the remaining
text) and are blocked. `D001`–`D003` are the cross-model review, the file:// and responsive
verification, and the Pages deployment. Status is derived from recorded evidence:
`majordomus plan evidence <id> ...` then `majordomus plan done <id>`.

## Architecture of `index.html`

The script is organised in banner-commented sections, in this order: constants, helpers,
frequency helpers, musical-note helpers, preset definitions, the `AudioEngine` class, the
visualization bridge, the Alpine component `oscillaApp`, the p5 sketch, bootstrapping. Add code
to the section it belongs to. `AudioEngine` lives outside Alpine's reactive state; Alpine talks
to it through methods, and p5 reads engine and UI state only through the visualization bridge.

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
