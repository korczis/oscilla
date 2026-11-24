---
schema: adr/v1
id: adr-0089
kind: adr
title: "One instrument: places in a slim rail, one title bar and one instrument strip replace the workspace sidebar, the page header and the footer"
status: proposed
date: 2026-11-24
tags:
  - ui
  - navigation
  - flowbite
  - reconstruction
related:
  - file:.ai/repo/adrs/0061-the-ui-is-built-on-flowbite-pro.md
  - file:.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md
  - file:.ai/repo/adrs/0050-space-is-the-play-key-of-the-workspace-in-view-one-shortcut-.md
  - file:.ai/repo/adrs/0063-one-output-owner-at-a-time-views-name-the-class-of-what-they-show-save-paths-state-their-scope.md
  - file:.ai/repo/project/issues/Q114.yaml
  - file:.ai/repo/project/issues/Q089.yaml
  - file:.ai/repo/project/issues/Q090.yaml
  - file:.ai/repo/project/issues/Q033.yaml
  - file:docs/reconstruction/07-target-architecture.md
  - rule:project.ui-uses-flowbite-pro
  - rule:project.visual-identity-lock
  - rule:project.no-fake-science
provenance:
  origin: authored
---

# 89. One instrument: places in a slim rail, one title bar and one instrument strip replace the workspace sidebar, the page header and the footer

## Context

ADR 0061 decision 1 builds the shell from the Pro admin dashboard: a navbar, a workspace sidebar
drawer, main content and a footer. On `main` at `c3b15610` that shell carries thirteen
workspaces in two groups. Six of them are crops of one panel grid. The shell's own chrome
(navbar 64 px, page header 44 px, keys dock, status bar 55 px) leaves the Studio and Synth
about 40 % of a 1024 px screen, and leaves no instrument content on a phone's first screen
(`docs/reconstruction/03` to `05`).

The owner chose model E and this amendment in Q114 on 2026-11-24.

## Decision

1. **Places replace workspaces as the navigation's unit.** The places are:
   - the landing (Q089, unchanged);
   - Generátor, which answers both `#m=playground` and `#m=generator` and so honours Q033
     without a ninth entry;
   - Synth;
   - Studio;
   - Analýza;
   - Měření;
   - Experimenty;
   - Výuka.

   O aplikaci moves to the header menu. The sidebar groups (Analýza, Syntéza) go.
2. **Navigation by viewport.** On desktop the sidebar becomes a slim rail of places: labels,
   no groups, collapsible to icons as today. On a phone a bottom bar holds four places plus
   Více (the rest and the palette), replacing the drawer.
3. **One title bar.** The navbar and the page header merge into one bar of 56 px or less,
   holding the place, the breadcrumb, the search/palette and the actions. The place's title
   stands only there (Q110).
4. **The footer becomes the instrument strip.** It holds:
   - the subject: what sounds, from `soundingOwner`;
   - one per-place Play (U127);
   - the observed level, read from the existing analyser and labelled relative dBFS
     (ADR 0063 decision 2);
   - the keys: docked on desktop; a sheet on a phone (Q114);
   - Sonda, the observed probe;
   - the letter-key switch (Q114).

   An LED in it glows only on real state (visual-identity-lock v4: `data-led`, `data-source`).
5. **Sonda shows only observed views** of the output after the ceiling: waveform, spectrum,
   spectrogram and level. Computed views appear only for the V1 instrument and are labelled as
   such.
6. **Routes.** One alias table in `ui/navigation.js` maps every old workspace id, V1 mode id
   and record key to a place and a focus. `routeOfHash` stays the one dispatcher
   (ADR 0045). The V1 codec stays frozen (ADR 0014).
7. **Q090's folds stand,** with their no-loss condition. Their alias consequences are recorded
   here as an LLM decision under Q114:
   - Filtry → the Synth and Studio filter (D4);
   - Bioacoustics → Výuka (D5);
   - Experimenty keeps the only compare of records.
8. **The registry owns membership.** The shell registry is the one owner of which panels a
   place shows (U129). CSS keeps the geometry. No layout engine is built.

Everything else in ADR 0061 stands: Pro components, Pro styling, and the domain views kept
inside Pro cards.

## Consequences

- **Pro shell criterion.** `ui-flowbite-pro#pro-shell` ("navbar, sidebar drawer collapsible to
  icons, page header with breadcrumb and actions") is satisfied by the merged bar and the
  rail. Its text is amended, dated, when U131 and U132 land.
- **Default route.** It stays Q089's landing. Every inventoried deep link keeps opening what
  it opens. `tests/browser/ui-flowbite-pro.cjs` and `link-integrity.cjs` are the proof.
- **Leave policy.** `LEAVE_POLICY` changes so that the sound survives a place change, except a
  running measurement (U133, Q114). C053 is revised.
- **Space.** `SPACE_OWNER` and `STATUS_PLAY_WORKSPACES` become one table (U127).
- **Order of work.** The shell moves in small slices (M124). Nothing is retired before its
  replacement is live, reachable and sounding in three engines.

## Alternatives

- **Keep the ADR 0061 shell and add the strip.** Rejected by the owner (Q114). It keeps the
  108 px of stacked header chrome and the 13-entry drawer on a phone.
- **A task-oriented top level** (Create, Explore, Measure, Compare, Perform). Rejected: every
  measured journey crosses tasks, and a task shell duplicates panels per task.
- **A free docking workbench.** Rejected: it fails phones and accessibility, and it needs a
  window manager the stack forbids.
