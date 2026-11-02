---
schema: adr/v1
id: adr-0080
kind: adr
title: "Cytoscape.js may enter dist for one read-only relationship explorer, and no other named visualization library does"
status: proposed
date: 2026-10-30
tags:
  - dependencies
  - visualization
  - budget
related:
  - rule:project.single-file-deliverable
  - rule:project.studio-model-is-canonical
  - rule:project.no-fake-science
  - rule:project.ui-uses-flowbite-pro
  - file:.ai/repo/adrs/0012-self-contained-runtime.md
  - file:.ai/repo/adrs/0013-p5-unmodified-separable-block.md
  - file:.ai/repo/project/issues/Q070.yaml
  - file:.ai/repo/project/issues/P009.yaml
  - file:.ai/repo/project/issues/P010.yaml
  - file:scripts/build-config.mjs
provenance:
  origin: authored
---

# 80. Cytoscape.js may enter dist for one read-only relationship explorer, and no other named visualization library does

## Context

In the prompt pack of 2026-10-29 the owner named Mermaid.js, Chart.js, Cytoscape.js and Apache
ECharts next to the incumbents p5 and uPlot. P009 measured each one as a minified, tree-shaken
esbuild 0.28.2 bundle, gzip level 9 as `scripts/size-report.mjs` measures. At origin/main
cdda563c, `dist/index.html` is 823 309 B gzip, which leaves 176 691 B under the budget of
1 000 000 B (`scripts/build-config.mjs`), or 376 691 B under the 1 200 000 B that E027
proposes. The measured costs:

- Mermaid 11.4.1 as a runtime: 742 486 B;
- Apache ECharts 5.5.1 (a line chart with grid, tooltip, legend, data zoom and aria): 178 711 B;
- Cytoscape.js 3.30.4: 121 232 B;
- Chart.js 4.4.7 (a line chart with log scale, tooltip and legend): 56 403 B;
- uPlot 1.6.32 (already bundled): 23 037 B.

The commands and the full record are on Q070.

On 2026-10-30 the owner answered Q070 through AskUserQuestion in Claude Code session
oscilla-af. The question offered four options: none (recommended), Cytoscape only, Chart.js only,
or decide later. The owner chose "Cytoscape only".

## Decision

1. Cytoscape.js may enter `dist/index.html` for exactly one consumer, a read-only explorer of
   relationships that a canonical source already records (P010). It is pinned to an exact
   version, imported through one adapter module, and inlined at build time. Nothing is
   fetched at runtime (ADR 0012).
2. The explorer never edits. Dragging a node moves only the view, and nothing it does writes
   the StudioModel, an experiment or any other record (`project.studio-model-is-canonical`).
   Every node and every edge has a real type, a stable id, the source it was read from and a
   deep link that the hash dispatcher routes. No synthetic edge is drawn
   (`project.no-fake-science`).
3. The explorer is built only after the gzip budget leaves room for Cytoscape and its consumer
   with margin. Under today's 1 000 000 B that is not true (121 232 B of 176 691 B), so P010
   waits for E027's raise to 1 200 000 B to land.
4. Mermaid is not a runtime dependency. It stays as GitHub-native diagrams in README. Chart.js
   and Apache ECharts do not enter dist: charts stay on uPlot and the M062 chart kit.

## Alternatives rejected

- **No library.** This was the recommendation; the owner chose otherwise.
- **Chart.js for M062.** A second chart engine next to uPlot gives two sources of chart
  behaviour.
- **A hand-written SVG explorer on the Studio renderer's primitives.** It is cheaper in bytes,
  but the owner chose Cytoscape's layout and interaction.

## Consequences

- P010 carries the integration and its acceptance: one adapter, a ceiling on the gzip delta,
  keyboard and screen-reader access, idle while hidden, and tests in three browsers from
  `file://` and the sub-path.
- Cytoscape.js's MIT licence notice joins `licenses/`.
- Any later library that wants to enter dist needs its own measured decision. This ADR admits
  no other.

## What no check decides

Whether a relationship is worth drawing is a design judgement. P010's reviewer decides it from
the source each edge is read from.
