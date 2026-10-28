---
schema: adr/v1
id: adr-0061
kind: adr
title: "The UI is built on Flowbite Pro: Tailwind and Flowbite return at build time, inlined"
status: accepted
date: 2026-10-28
tags:
  - design
  - visual
  - ui
  - dependencies
related:
  - rule:project.ui-uses-flowbite-pro
  - rule:project.visual-identity-lock
  - rule:project.single-file-deliverable
  - rule:project.no-inert-surfaces
  - file:.ai/repo/adrs/0012-self-contained-runtime.md
  - file:.ai/repo/adrs/0029-visual-regression-in-the-release-gate.md
  - file:.ai/repo/adrs/0034-custom-html-nodes-svg-cables.md
  - file:.ai/repo/rules/project/ui-uses-flowbite-pro.v1.md
  - file:.ai/repo/rules/project/visual-identity-lock.v2.md
  - file:tests/unit/ui-flowbite-pro.test.mjs
  - file:tests/unit/ui-flowbite-pro-baseline.json
  - file:tests/unit/flowbite-pro-fingerprints.json
  - file:scripts/flowbite-pro-fingerprints.mjs
  - file:scripts/build-config.mjs
provenance:
  origin: authored
---

# 61. The UI is built on Flowbite Pro: Tailwind and Flowbite return at build time, inlined

## Context

On 2026-10-28 the owner ordered, in a Claude Code session (a `/loop` instruction, in Czech):
"vsechny me projekty musi mit flowbite pro, musi byt enforced, always used; dokumentuj,
enforcuj, backpropaguj, overuj" (all my projects must have Flowbite Pro, enforced, always
used; document, enforce, backpropagate, verify). The same day the owner made it a standing
instruction for every project (the section "UI: Flowbite Pro (mandatory)" of the owner's
global Claude instructions, and the owner's `flowbite-pro` skill with its condensed reference
of the Pro admin shell and components).

OSCILLA's interface does not follow that order. ADR 0012 dropped Tailwind and Flowbite in V2
for plain token CSS (`src/styles/tokens.css` and siblings), because V1 loaded them from CDNs,
compiled Tailwind in the browser and therefore needed a network from `file://`. The reason was
the runtime fetch, not the component system: a build-time Tailwind was rejected only as "a
toolchain for a design that is token-driven anyway". Rule `project.visual-identity-lock` v1
then bound every surface to the existing tokens and panel primitives. Measured at the commit
this decision was written on, none of the 62 UI surfaces of `src/index.html` (the shell, six
workspaces, 30 panels and 22 dialogs) carries the Flowbite Pro structure, and the legacy
primitives (`osc-panel`, `osc-btn`, `osc-dialog`, `osc-tab` and the rest) occur 843 times in
`src/index.html` and `src/js`.

The owner holds a Flowbite Pro licence. Its terms let the owner adapt the Pro markup into the
owner's products; they do not allow publishing the Pro source files as such. OSCILLA is a
public MIT repository and a public GitHub Pages site.

## Decision

Accepted on the owner's order of 2026-10-28 quoted above.

1. **The UI of OSCILLA is Flowbite Pro on Tailwind.** The shell (navbar, workspace sidebar
   drawer, main content, footer), the page headers, cards, tables, tabs, buttons, form
   controls, dropdowns, modals, alerts and badges are adapted from the matching Flowbite Pro
   template or block (the admin dashboard shell first), with the Pro class lists, spacing,
   radius, typography and component behaviour. No component the Pro set already has is
   invented, and no other UI kit or ad-hoc component library is added.
2. **Tailwind and Flowbite come back at build time.** This supersedes the bullet of ADR 0012
   that dropped them for plain token CSS. Tailwind CSS compiles at build time from the
   classes `src/` uses into the one inlined `<style>`, through a single entry
   `src/styles/tailwind.css`; the theme extends `primary`, the surface greys and the fonts as
   the Pro `tailwind.config.js` does, mapped onto OSCILLA's palette. Flowbite's interactive
   behaviour comes from the public MIT `flowbite` npm package, pinned and bundled into the app
   script like Alpine.js and uPlot, or from Alpine where the page already drives the
   component. Dark mode follows OSCILLA's existing theme mechanism.
3. **OSCILLA keeps its domain visual language inside Pro surfaces.** The charts (uPlot), the
   Signal Path, the Studio graph (ADR 0034) and timeline, the spectrogram and the meters are
   the content of Pro cards and keep their own rendering and the dataviz rules (validated
   palette, one axis, labelled status, tabular numerals). The Pro shell and components carry
   them; the Pro set does not replace them. This amends the visual identity: rule
   `project.visual-identity-lock` v2 replaces v1's "existing tokens and primitives" with
   Flowbite Pro for the interface, and keeps the hidden-logo question for the domain views.
4. **Migration is a ratchet.** The surfaces and primitives that predate this decision are
   debt, recorded in `tests/unit/ui-flowbite-pro-baseline.json`; rule
   `project.ui-uses-flowbite-pro` makes every new surface Pro, every surface migrated stay
   Pro, and the recorded debt only shrink.
5. **The licence holds in a public repository.** No Flowbite Pro source file (the admin
   dashboard, the React and Next.js dashboards, the block libraries, their images and
   configuration) is committed, bundled verbatim or served by Pages. Only markup adapted into
   OSCILLA's own `src/`, the public MIT `flowbite` package and Tailwind ship.

What is not changed:

- `project.single-file-deliverable` and the rest of ADR 0012: one self-contained
  `dist/index.html`, built deterministically, inlined, opening from `file://` and from the
  Pages sub-path. No CDN, no runtime Tailwind (the Play CDN stays rejected), no remote font
  (Inter is not fetched: the font stack falls back to the system UI font unless a font is
  inlined within the budget), no runtime `fetch`, module script or worker from a path.
- The size budget of `scripts/build-config.mjs` (`BUDGET`). Tailwind ships only the classes
  used; the token CSS each migration replaces is removed in the same change.
- The measurement, analysis and audio rules, and the no-inert-surfaces and no-fake-science
  rules: a Pro component that does nothing, or a Pro demo text, is still a defect.

## Alternatives rejected

- Keeping the token CSS and restyling it to look like Flowbite: the order is to use Flowbite
  Pro, not a look-alike, and two component systems would drift.
- A runtime Tailwind or Flowbite from a CDN: refused by ADR 0012 for the network it needs.
- Copying the Pro admin dashboard bundle into the repository: the licence forbids publishing
  the Pro sources, and OSCILLA is public.
- Migrating everything in one change: the visual gate, the browser suites and the review would
  each have to judge the whole interface at once; the ratchet migrates surface by surface.

## Consequences

- `tests/unit/ui-flowbite-pro.test.mjs` runs in `npm test` and CI's `unit` job: a new
  surface off Pro, a new use of a legacy primitive, a migrated surface that regresses, another
  UI kit, a new stylesheet or a Pro source file fails the pull request.
- Each migration rebuilds the visual references of the views it changes (ADR 0029): a
  reference accepted under the token CSS no longer describes the page.
- Adding Tailwind and `flowbite` changes `package.json`, the build and the licence notices;
  `scripts/verify-dist.mjs` and the budget judge the result like any dependency (ADR 0012).
- The migration is planned work under its own intent and milestone in `.ai/repo/project/`.

## Resolution notes

Appended; the sections above are left as written.

### 2026-10-28: accepted by the owner

Accepted by the owner's order of 2026-10-28 quoted under Context, in the session that wrote
this decision; the order itself asks for the decision to be documented and enforced. The
enforcement lands with it: rule `project.ui-uses-flowbite-pro` v1 and
`tests/unit/ui-flowbite-pro.test.mjs` with its baseline. The migration of the surfaces it
records is not done; the baseline says how much remains.
