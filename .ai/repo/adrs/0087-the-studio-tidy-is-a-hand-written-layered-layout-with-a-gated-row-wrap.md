---
schema: adr/v1
id: adr-0087
kind: adr
title: "The Studio Tidy (L) is a hand-written layered layout with a gated min-cut row wrap; no layout library enters dist"
status: proposed
date: 2026-11-03
tags:
  - studio
  - layout
  - mobile
  - budget
related:
  - rule:project.studio-model-is-canonical
  - rule:project.single-file-deliverable
  - rule:project.visual-identity-lock
  - rule:project.ui-uses-flowbite-pro
  - file:.ai/repo/adrs/0080-cytoscape-for-one-read-only-relationship-explorer.md
  - file:.ai/repo/project/issues/V637.yaml
  - file:.ai/repo/project/issues/K009.yaml
  - file:src/js/ui/studio/graph-layout.js
  - file:src/js/ui/studio/graph-commands.js
  - file:tests/unit/studio-graph-layout.test.mjs
provenance:
  origin: authored
---

# 87. The Studio Tidy (L) is a hand-written layered layout with a gated min-cut row wrap; no layout library enters dist

## Context

On 2026-11-03 the owner ordered, about the Studio graph (in Czech, quoted): "optimalizuj
rendering krabicek a propojeni ... minimum krizeni, ergo first, mobile first" (optimise how
the boxes and cables are laid out: fewest crossings, ergonomics first, mobile first); "generic,
dynamic, derived, inferred, lepsi nez ted, zadny kroky zpet" (better than now, no step back);
"grafika je nyni pekna, layout zly, interaktivita muze byt lepsi" (the graphics are good now,
the layout is bad, the interaction could be better); and "multiline".

The Tidy of plan K009 (L) placed `compactLayout`'s columns and rows: the longest-path column of
each node and the row of its first upstream neighbour, 240 apart, each row 48 below the tallest
card of the row above. It ignores port order and never reorders a column, so on a large graph it
crosses as many cables as the authored positions, and it is always one wide strip, which no
phone shows at a touch-sized zoom.

A spike of the same day (origin/main 117c755c; Node 22.20.0 on the shared Mac at load about
25) measured five candidates on the 7 shipped templates, the §145 fixture (100 nodes, 200
cables) and a 300-node, 600-cable scale-up of its topology. A crossing is a proper
intersection of two straight segments from an output anchor to an input anchor, the anchors at
the real card geometry (168 wide; port rows from y 49, 16 apart, `src/styles/studio.css`),
because the editor draws a Bézier between those two anchors (`cablePath`), not a route through
a library's bend points.

| Graph (nodes/cables) | stored | K009 tidy | layered (this) | elkjs | dagre | d3-dag | cytoscape bfs |
|---|--:|--:|--:|--:|--:|--:|--:|
| 7 templates, summed | 0 | 0 | 0 | 0 | 6 | 6 | 8 |
| large-100 (100/200) | 2 510 | 2 526 | 1 353 | 2 504 | 1 339 | 1 241 | 1 758 |
| large-300 (300/600) | 23 413 | 23 347 | 12 290 | 18 129 | 17 408 | 9 036 | 16 733 |
| CPU ms at 300 nodes | | 1.1 | 4.4 | 354 | 571 | 1 102 | 31 |
| dist cost, KB gzip | | | 1.4 | 450.6 | 16.7 | 29.1 | 141.7 |

The headroom under the 1 200 000 B gzip budget was 260 353 B at 117c755c. On the templates the
layered layout also has 0 cables through a box (the stored positions have 2). Every crossing
left on the large graphs involves a modulation cable (13 LFOs fanning out to 115 targets in the
fixture); the stored positions have none among audio cables. Wrapped on the phone (390x844), the
layered layout plus a min-cut row wrap crosses 1 cable over the 7 templates, against 6 to 15
for the other layouts and wraps (ELK's own MULTI_EDGE wrap 5). Unwrapped, no template fits a
phone at the coarse-pointer fit floor (`COARSE_FIT_MIN_ZOOM`, 24/26, about 0.92); wrapped, 6
of 7 do.

## Decision

1. **The Tidy is a hand-written layered layout** (`tidyLayout`, `src/js/ui/studio/graph-layout.js`,
   pure): longest-path layering, with a source pulled right to one layer before its nearest
   target; one dummy per layer a cable spans; barycentric crossing reduction on the port
   anchors, keeping the order of each card's ports as the registry declares them (`def.inputs`,
   `def.outputs`), the order with the fewest crossings kept; coordinates from the cards as the
   editor measured them (height and port anchors), falling back to the CSS geometry when a card
   is not drawn. It replaces K009's placement; `compactLayout` stays for the compact Studio.
2. **A min-cut row wrap, gated.** Only when the unwrapped Frame-all zoom on the current graph
   viewport is below `COARSE_FIT_MIN_ZOOM` are consecutive layers cut into rows, the cuts where
   the fewest cables span them, the row count whose aspect is nearest the viewport's; and only
   when the rows fit at a larger zoom than the strip. A graph that fits stays one strip; a
   portrait graph (the large fixtures) stays one strip.
3. **No layout library enters dist.** elkjs (450.6 KB gzip, about 175 % of the headroom, and
   no fewer anchor-to-anchor crossings), dagre (16.7 KB, no ports: 6 crossings on the
   templates), d3-dag (29.1 KB, no ports, 6 on the templates, about a second of CPU at 300
   nodes, so a Worker) and cytoscape's breadthfirst (the explorer of ADR 0080 only; the most
   crossings and right-to-left cables) are rejected.

Invariants, each held by `tests/unit/studio-graph-layout.test.mjs`:

- The layout runs only on the explicit Tidy action (L); nothing else in `src/js` calls it, and
  rendering, loading, playing or resizing never moves a box (§150).
- One Tidy is one history entry: one NODE_MOVE gesture labelled "Tidy the graph", undone exactly.
- It never moves a box on its own, and it never writes the model: it returns positions, which
  the command dispatches.
- Positions are PRESENTATION state (`src/js/studio/schema.js`): NODE_MOVE changes
  `presentationState`, so it is undoable and makes the document dirty, while `executionState`,
  and therefore `studioHash`, are unchanged by a Tidy.
- The look is unchanged: no class, selector, markup, style or cable drawing changes; only the
  numbers in the boxes' positions do.
- Deterministic: the model, the measured cards and the viewport decide; ties in model order.
  The result starts at the graph's current top-left corner, on the 8-unit grid.

## Alternatives rejected

- **elkjs** with fixed port positions: the only candidate with ports, but its size alone exceeds
  the dist headroom, it minimises crossings of its own routed edges rather than of the cables
  OSCILLA draws, and its tuning moved large-100 by at most 200 crossings.
- **d3-dag**: the fewest crossings at 100 and 300 nodes (8 % and 26 % below this layout), but
  it ignores port order, is worse on every template, and needs a Worker at 300 nodes. A cheaper
  route to its gain is to port its simplex layering into this layout later.
- **dagre**: no ports and no better crossings at 100 nodes, worse at 300.
- **cytoscape breadthfirst**: not a layered layout; the most through-box cables.
- **Keeping K009's placement and adding only a wrap**: the chain and min-cut wraps of K009's
  tidy cross 10 cables on the phone over the 7 templates, against 1 here.
- **An automatic layout on load or resize**: §150 forbids moving a user's graph without an
  explicit action.

## Consequences

- L is better than before on every measured graph and worse on none ("no step back"): 0
  crossings on every template, about half the crossings of K009's tidy at 100 and 300 nodes,
  and on a phone the graph wraps into rows that fit at a larger zoom.
- The return cable of a wrapped row runs right to left from the end of one row to the start of
  the next; drawn as today's Bézier it can pass through boxes (the spike counted 26 such
  segments over the templates on the phone). Routing it through the gutter between rows is
  later work, and so is lighter drawing of modulation cables, the lever left on large graphs.
- The layout costs about 1.4 KB gzip and one frame of CPU at 300 nodes on the main thread; it
  needs no Worker.
- V614's tidy-selection (Shift+L) builds on this function for the selected nodes.

## What no check decides

Whether the wrapped rows read better than one strip that pans is a judgement of the owner on
a real phone; the checks prove only that the rows fit at a larger zoom, cross no more cables
than stated and overlap no box.
