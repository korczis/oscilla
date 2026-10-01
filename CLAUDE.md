# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OSCILLA — Interactive Sound & Frequency Lab. A browser-based acoustic laboratory and
synthesizer-like frequency playground. The whole application is **one file: `index.html`**.

- No build step, no npm for the app, no backend, no local assets, no separate JS/CSS files.
- Libraries come from CDNs only: Tailwind CSS (Play CDN), Flowbite, Alpine.js, p5.js.
- Audio is the native Web Audio API. Do not add Tone.js, Howler.js or another audio library.
- It must run from `file://` and from GitHub Pages. Anything that needs a server (ES module
  imports of local files, `fetch` of local JSON, service workers) is out.

## Commands

```bash
open index.html                            # run it (file://)
python3 -m http.server 8000                # optional: serve it the way Pages does
npm --prefix tests install                 # once: Playwright for the smoke tests
node tests/smoke.cjs                       # headless smoke test (file://, viewports, audio engine)
node tests/smoke.cjs --url https://korczis.github.io/oscilla/   # same checks against the deployed site
```

Deployment is GitHub Pages via `.github/workflows/pages.yml`, which publishes **only**
`index.html` — repository tooling (`.ai/`, `tests/`, these Markdown files) is never served.

## Architecture of `index.html`

The script is organised in numbered sections with `// ====` banner comments, in this order:
constants → helpers → frequency helpers → musical-note helpers → preset definitions →
`AudioEngine` class → visualization bridge → Alpine component (`oscillaApp`) → p5 sketch →
bootstrapping. Keep that order; add code to the section it belongs to.

- **`AudioEngine`** owns every Web Audio node. Alpine never creates nodes. All audio timing
  uses `audioContext.currentTime` and AudioParam automation — `setTimeout`/`setInterval` are
  allowed only for UI bookkeeping. `stop()` must ramp down, cancel automation, stop and
  disconnect every node, and leave the active-node count at zero (PLAY→STOP→PLAY forever).
- **Envelopes** never hard-switch nonzero gain to zero and never exponential-ramp to 0.
- **Frequencies** are clamped to `safeMaximum = sampleRate / 2 * 0.95`; never assume 48 kHz.
- **Wide-range frequency controls are logarithmic** via `frequencyToNormalized` /
  `normalizedToFrequency`.
- **Alpine directives stay short**; logic lives in `oscillaApp` methods.
- **Visualization bridge** is the read-only seam p5 uses to see engine and UI state; the p5
  draw loop must not allocate per frame or touch the DOM.

## Content rules (non-negotiable)

No wellness, therapy, focus/sleep, "dogs only", "inaudible", "safe frequency" or SPL claims.
15.5 kHz is not ultrasound; nominal ultrasound starts above ~20 kHz; digital generation does not
imply acoustic reproduction. Continuous playback is opt-in per session and never persisted.

<!-- majordomus:begin ca779e02f878 c99ef4280d2c8948 -->
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
