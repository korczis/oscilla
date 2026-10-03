# Studio current-state audit (V401), performed retrospectively

> **Retrospective.** This audit was performed on **2026-10-03**, after V3.1 STUDIO had been
> merged (`320130f`) and released (tagged on `a810b94`), against HEAD `535af3b`. Issue V401
> asked for it before Studio code (spec `docs/specs/oscilla-v3.1-studio.md` §3, §6, §55, §85).
> The first Studio code (`90de098`, 2026-10-02 05:12:13 UTC) and ADR 0034, which chose the
> custom editor (`62ad1f3`, 05:39:49 UTC), both came before any written audit, and the graph
> editor itself was first committed in `e31ab23` (2026-10-03 04:34:11 UTC) without the measured
> comparison that ADR 0034 named as its confirmation criterion (a).
>
> **What it cannot prove.** It cannot show that the comparison below informed the editor
> decision: the decision was taken on prose reasoning and the editor was built first. It
> measures the shipped editor against the libraries *now*, so it can confirm or contradict the
> decision after the fact, not justify it before. Everything numeric below was measured on
> 2026-10-03 by the commands at the end; nothing is estimated.

## 1. Current reality (spec §3)

| Area | State at `535af3b` | Where |
|---|---|---|
| HEAD, version | `535af3b`; `package.json` carries the V3.1 release version, the only version source (ADR 0027) | `git log`, `npm run version:check` |
| Releases, deployment | v2.0.0, v2.0.1, v3.0.0 and the V3.1 release on `a810b94` (latest). Pages deployed `535af3b`; `npm run release:verify-deploy` PASS: live page is the committed dist stamped with `535af3b` | `gh release list`, Pages run 37105247629 |
| Build provenance | source digest compiled into the bundle, deploy stamp adds the commit (ADR 0028) | `scripts/release-metadata.mjs`, `src/js/core/build-info.js` |
| Sequencer | V2 block sequencer unchanged in `src/js/sequencer/` (model, compiler, timeline, editor); the V2 panel still runs on it. The Studio timeline reuses its compiler per pattern clip | `docs/v31/sequencer-migration.md`, `src/js/studio/timeline-compiler.js` |
| Signal Path | V2's passive p5 view of the Playground's sounding graph (`src/js/visualization/signal-path.js`, `pathNodesFor`), still shown in the workbench. Studio does not reuse it: the compact Studio widget draws the StudioModel through its own automatic layout (`src/js/ui/studio/graph-layout.js`) | §2 |
| Audio graph abstractions | one `AudioEngine` owns the context, voices and the safety chain `master → limiter → trim → ceiling → analyser → destination`; V2 hooks `inserts`, `periodicWave`, `adsr`, `dualRouter`. The Studio compiler builds every node from existing engine and DSP builders and leaves only through `engine.master` | `src/js/audio/audio-engine.js`, `docs/v31/compiler.md`, ADR 0035 |
| Measurement architecture | PCM capture → deterministic offline DSP → `MeasurementResult` → quality and provenance → chart; state machine, capture, transfer/IR, RTA, quality | `docs/v3/architecture.md`, `src/js/measurement/` |
| Experiment model | versioned schema, migrations, hashes, CSV, comparison; StudioModel enters experiment provenance | `src/js/experiments/`, `src/js/studio/provenance.js`, ADR 0038 |
| Persistence | one IndexedDB database (`experiments/store.js`): `DB_VERSION` 1 experiments and summaries, 2 adds `studio` and `studioSummaries`; memory fallback under `file://` without IndexedDB; preferences in `core/storage.js` | `docs/v31/patches-and-provenance.md` |
| Visual regression | `visual-gate.mjs` (13 regions of the Playground reference), `visual-measure.mjs` (MEASURE desktop and phone), `visual-studio.mjs` (Studio desktop, phone, compact), references for darwin-arm64 and linux-x64, all in `npm run test:visual` and the release gate | `tests/README.md`, ADR 0029 |
| CI / release gate | PR checks `unit`, V1 engine ×2, DSP/labs/sequencer ×2, V3 measurement ×3, V3.1 Studio ×3, browser gate ×3, visual, `gate` (all SUCCESS on PR #37) | `.github/workflows/ci.yml` |
| Majordomus | `plan validate` 0 failures (1 warning: M034 milestone evidence); `doctor` 0 failures; `adr check` 38 ADRs consistent, 0030-0038 `proposed`; no open questions; Studio features and use cases `draft` (issue V403) | §4 |

## 2. Concept map: KEEP / REFACTOR / SUPERSEDE / MIGRATE (spec §85)

The sequencer map is `docs/v31/sequencer-migration.md` (issue V416) and is not repeated here:
data concepts of `sequencer/model.js` MIGRATE into Studio clips through `importSequence` /
`exportSequence`; the scheduling in `sequencer/compiler.js` is KEPT and called once per pattern
clip; list-order editing and the V2 playhead are SUPERSEDED by time-based clip actions and
`positionAt`; tick maths, look-ahead and transport are REFACTORED onto absolute time.

The other V2 concepts Studio touches:

| Concept | Verdict | Reason |
|---|---|---|
| Signal Path view (`visualization/signal-path.js`) | KEEP | The Playground's passive picture of the voice graph; Studio is its visual descendant, not a user of its code |
| Signal Path as the picture of a Studio graph | SUPERSEDE | `ui/studio/graph-layout.js` lays out the StudioModel itself (same topology as the full editor, automatic positions, never written back) |
| `AudioEngine` lifecycle, node and source accounting, safety chain | KEEP | No second engine (§42); Studio registers its nodes in `engine.nodes` / `engine.sources` |
| Engine hooks (`inserts`, `dualRouter`, `_osc`) | REFACTOR | Reached through `studio/adapters/engine-hooks.js`; `docs/v31/compiler.md` lists the hooks still to add properly |
| DSP builders (`filters`, `stereo`, `noise`, `envelope`, `modulation`, `analysis/*`) | KEEP | Each Studio node type names the builder it compiles to (registry `compiler` field) |
| Measurement engine and experiment schema | KEEP | Measurement nodes orchestrate it (ADR 0038); Studio adds a provenance section, no second pipeline |
| Experiment IndexedDB store | REFACTOR | Same database, upgrade 1 → 2 adds Studio stores and deletes nothing |
| V2 configuration file, URL state, presets | KEEP | Playground state; Studio files are their own kinds (`oscilla-studio`, `oscilla-patch`) |

**Update after this audit (V421).** The Signal Path rows above describe `535af3b`. Since V421 the
Signal Path view is REFACTORED, not kept as it was. Its stage list is no longer its own
derivation (`pathNodesFor` is removed). It is the Signal Path projection
(`studio/signal-path-projection.js`) of the Playground voice expressed as a StudioModel
(`studio/playground-voice.js`). The p5 renderer and the V1 wording are unchanged. The compact
widget still lays out the Studio document through `graph-layout.js`. The decision and its
limits are in `docs/v31/signal-path.md`.

## 3. Custom editor versus libraries, measured (spec §55, ADR 0034 criterion (a))

### Method

- Libraries: tarballs fetched with `npm pack <pkg>@<version>` into a scratch directory outside
  the repository (nothing was added to `package.json` or `node_modules` of the project). Sizes
  are the published minified builds, or an esbuild `--minify` of the published ES build when
  none is minified, gzip level 9 (`zlib.gzipSync`). The Rete stacks were installed in the scratch
  directory and bundled with the project's pinned esbuild (minified IIFE), because their parts
  import each other and `@babel/runtime`.
- OSCILLA: the shipped modules bundled with the production esbuild options and target
  (`scripts/build-config.mjs` `TARGETS`, minified) with everything outside the measured set
  external, so each number is the code of that set alone; gzip level 9.
- Capability columns come from reading the published code (marker counts in brackets, e.g.
  `aria-*`, `tabindex`, `keydown`, `touchstart`, `pointerdown`, `getContext("2d")`,
  `fetch(` / `XMLHttpRequest`, `eval(` / `new Function(`) and from the projects' package
  metadata. For OSCILLA they come from the browser and unit suites named.

### Size

| Candidate (version) | What is counted | min bytes | min+gzip bytes |
|---|---|---:|---:|
| **OSCILLA graph editor** (shipped) | `ui/studio/graph-*.js` (7 modules: canvas, nodes, cables, viewport, keys, pickers, view model) | 40 728 | 14 929 |
| OSCILLA graph editor + library panel + Inspector | the 7 modules + `library-panel.js` + `inspector.js` | 67 014 | 22 592 |
| OSCILLA all Studio UI | all 23 modules of `src/js/ui/studio` (adds timeline, automation, transport, compact, patches, workspace) | 168 121 | 55 714 |
| OSCILLA Studio CSS | `studio.css` / `studio-timeline.css` | 19 385 / 12 897 | 3 878 / 2 801 |
| Drawflow 0.0.60 | `dist/drawflow.min.js` + `drawflow.min.css` | 48 100 | 9 207 |
| Rete.js 2.0.6 core | `rete` + `rete-area-plugin` 2.3.2 + `rete-connection-plugin` 2.0.5 + `@babel/runtime` helpers, **no renderer** | 62 652 | 15 365 |
| Rete.js 2.0.6 with a framework-free renderer | the above + `rete-render-utils` 2.0.3 + `rete-lit-plugin` 2.0.3 (community) + Lit 3.3.3 | 270 518 | 43 890 |
| litegraph.js 0.7.18 | `build/litegraph.core.min.js` + `css/litegraph.css` (core, no node library) | 189 145 | 50 565 |
| @comfyorg/litegraph 0.17.2 (maintained fork) | `dist/litegraph.es.js` minified + `css/litegraph.css` | 312 155 | 88 213 |

Context: `dist/index.html` is 2 561 441 B raw / 728 228 B gzip at HEAD against a budget of
2 700 000 / 760 000 (`scripts/build-config.mjs`). The Studio model, compiler and runtime
(`src/js/studio`, 209 542 / 70 380) are needed with any editor and are not in the table.

A library does not replace the OSCILLA code above: node cards with inline controls in OSCILLA
primitives, the Inspector, typed-port rules, the bridge to StudioModel actions and the keyboard
and screen-reader paths would still be written. A library adds its bytes to most of the custom
editor's, it does not take them away.

### Capabilities

| | OSCILLA custom | Drawflow 0.0.60 | Rete.js 2 | litegraph.js 0.7.18 / @comfyorg 0.17.2 |
|---|---|---|---|---|
| Licence | MIT | MIT | MIT (core, plugins; lit-plugin MIT, Lit BSD-3-Clause) | MIT / MIT |
| Runtime dependencies | none | none | `@babel/runtime`; a renderer needs React, Vue, Angular, Svelte (official plugins) or Lit (community plugin, which needed import aliases to bundle with Lit 3) | none / none |
| Rendering | HTML nodes over one SVG cable layer | HTML nodes, SVG connections [svg 10] | DOM via the framework renderer, SVG connections | **canvas 2D** [getContext("2d") 3 / 1, svg 0] |
| Single file, `file://`, `verify-dist` | in the dist today; gate passes | no fetch/eval [0/0]: would inline | no fetch/eval in core/area/connection [0/0]; package runs a `postinstall.js` | litegraph.js contains `fetch(` and `XMLHttpRequest`, the fork `XMLHttpRequest`; `eval` / `new Function` [2 / 1]: fails the first-party fetch/XHR rule of `verify-dist` unless shipped verbatim and allow-listed like p5 |
| Own graph model | none: a projection of the StudioModel (ADR 0030) | own JSON graph (`export`/`import`) | `NodeEditor` | `LGraph` |
| Typed ports | `canConnect` matrix with reasons, checked before the runtime (ADR 0032) | none: numbered `input_N` / `output_N`, any connection; host can only undo it after `connectionCreated` | `Socket` has a name only; compatibility is left to the host | typed slots, `isValidConnection` by type name |
| Undo | action layer, snapshot history, one entry per gesture (ADR 0031) | none [0] | separate `rete-history-plugin` (not measured) | none: `beforeChange` / `afterChange` hooks only |
| Keyboard | 18 shortcuts (`graph-keys.js`), Tab never taken, connect dialog, arrow nudge, quick add; browser `keyboard-connect` | container `tabIndex=0`; keydown handles Delete/Backspace only | keydown only tracks Ctrl/Meta for multi-select (every match is in `accumulateOnCtrl`) | canvas shortcuts [16 / 20]; nodes are pixels, not focusable |
| Screen reader | labelled controls, live-region announcements, text summary of the graph; browser `controls-labelled` | `aria-*` 0 | `aria-*` 0 (renderer-dependent) | `aria-*` 0 / 6 (context menu only); canvas content is not exposed |
| Touch | Pointer Events with capture, tap-to-connect; browser `mobile-tap-connect` | touch handlers [5], pointer [6] | pointer events in area [28] | touch [9] / pointer [20] |
| OSCILLA styling, light theme, identity lock | tokens and panel primitives; Studio visual references in the gate | default theme CSS to override; DOM nodes can carry OSCILLA markup | styling by the framework components the host writes | node look drawn in canvas code: CSS tokens and the light theme do not apply without re-implementing drawing |
| SVG control (cable hit width, style by port type) | own paths, wide hit paths, style per port type (unit `graph-view`) | fixed SVG path generation | connection component by the host | no SVG |
| Timeline interop | timeline, transport and automation share the store and actions | none | none | none |

### Verdict

- **Drawflow** is smaller than the shipped editor (9 207 vs 14 929 B gzip) but has no port types,
  no undo, no accessibility and a model of its own; adopting it means keeping almost all of the
  custom code and adding a second graph model to reconcile with the StudioModel.
- **Rete.js** core is about the size of the editor and renders nothing; a renderer brings a
  framework (React, Vue, Angular, Svelte) or the community Lit plugin, which is 2.9× the shipped
  editor's gzip bytes and still has no keyboard or ARIA story.
- **LiteGraph** (both lines) is canvas-only, 3.4×-5.9× larger, contains network calls
  (`fetch` / `XMLHttpRequest`) and `eval`, and cannot meet the DOM controls, screen-reader and visual-identity requirements.

The measurement supports ADR 0034: no library satisfies the visual identity lock, the
single-file rule and the accessibility requirements at a smaller cost. Two limits: the
OSCILLA keyboard path itself is incomplete (issue V428 records graph search as not built), and
ADR 0034's criterion (b), the frame-time targets on a large graph, is unmeasured (issue V431).
This audit closes criterion (a) only.

## 4. Majordomus state (spec §6)

`majordomus plan validate`: 34 milestones, 229 issues, 0 failures, 1 warning. `majordomus
doctor`: 0 failures (warnings: local branches not pushed, doctor time budget). `majordomus adr
check`: 38 decisions, identities unique, statuses known, references resolve. `majordomus question
list`: no open questions. Studio in the product graph: feature `studio` with five sub-features
and the `studio-*` use cases, all `draft`; the Studio claims in `docs/CLAIMS.yaml` (issue V403
records them as planned with no test).

## Commands run

```bash
git log -1 --format='%h %cI %s' 90de098 62ad1f3 e31ab23 320130f a810b94 HEAD
git log --reverse --no-merges feature/v31-studio ^feature/v3 ^origin/main
gh release list; gh run list --workflow pages.yml; gh pr view 37 --json statusCheckRollup
npm run release:verify-deploy
npm pack litegraph.js@0.7.18 @comfyorg/litegraph@0.17.2 drawflow@0.0.60 rete@2.0.6 \
  rete-area-plugin@2.3.2 rete-connection-plugin@2.0.5 rete-render-utils@2.0.3 rete-lit-plugin@2.0.3
npm install --ignore-scripts rete@2.0.6 rete-area-plugin@2.3.2 rete-connection-plugin@2.0.5 \
  rete-render-utils@2.0.3 rete-lit-plugin@2.0.3 lit   # scratch directory only
# measurement scripts (scratch): published min files + gzip -9; esbuild minify of
# litegraph.es.js; esbuild bundles of the rete stacks; esbuild bundles of src/js/ui/studio sets
majordomus plan validate; majordomus doctor; majordomus adr check; majordomus question list
```
