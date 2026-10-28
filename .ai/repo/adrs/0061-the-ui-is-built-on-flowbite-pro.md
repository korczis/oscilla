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
  - file:scripts/ui-flowbite-pro-measure.mjs
  - file:scripts/ui-flowbite-pro-record.mjs
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
workspaces, 30 panels and 22 dialogs) carries the Flowbite Pro structure; `src/index.html`
and `src/js` hold 2550 osc-* class tokens of 756 names (`osc-panel`, `osc-btn`,
`osc-dialog`, `osc-tab`, their BEM variants and the rest) and 103 uses of 38 other class
names (`is-active` and the other state classes); and the stylesheets under `src/styles` hold
1627 selectors, 438 of them in the domain views' own stylesheets and `tokens.css` (decision 3).
The record's measure 4 counts 2551 osc-* class tokens of 757 names (it reads every attribute
but the id references) and debt 3905, the domain views' selectors not among it; see the rule
for the definitions.

The owner holds a Flowbite Pro licence. OSCILLA is a public MIT repository and a public
GitHub Pages site, so Pro-derived markup in `src/` is published under the MIT grant. On
2026-10-28 the owner was asked, by AskUserQuestion in session oscilla-b0, whether the Flowbite
Pro EULA permits adapted Pro markup in a public MIT project, and answered that it does. This
decision rests on that dated confirmation by the owner: the worker that wrote it did not read
the EULA, and no EULA text is checked in or quoted here (the vendored Pro READMEs only link
to Flowbite's licence page). Independently of that answer, the Pro source files themselves
are never committed (decision 5).

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
   them; the Pro set does not replace them. Their own stylesheets (`charts.css`, `studio.css`,
   `studio-timeline.css`) and `tokens.css`, the custom properties they read, are therefore
   not migration debt: the record lists them apart and keeps them from growing, and the
   interface reaches debt 0 with them in place. This amends the visual identity: rule
   `project.visual-identity-lock` v2 replaces v1's "existing tokens and primitives" with
   Flowbite Pro for the interface, and keeps the hidden-logo question for the domain views.
4. **Migration is a ratchet.** The legacy interface that predates this decision (its
   surfaces, every osc-* class token, its other class names, the selectors and declarations
   of its stylesheets, its inline styles) is debt, recorded in
   `tests/unit/ui-flowbite-pro-baseline.json` (written from the tree by
   `scripts/ui-flowbite-pro-record.mjs`); rule `project.ui-uses-flowbite-pro` keeps the
   record from growing against the base branch, every surface migrated on Pro, and a surface
   pending until the build compiles Tailwind with the flowbite plugin and defines its Pro
   classes. The domain views' stylesheets of decision 3 are recorded apart and do not grow,
   but are not debt.
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

- `tests/unit/ui-flowbite-pro.test.mjs` runs in `npm test` and CI's `unit` job. These fail
  the pull request: a new surface (a landmark, an `osc-view-*` workspace, a `<section>` or
  `<dialog>` with an id) that is not migrated; a pending surface that leaves the record other
  than into `migrated`; a rise of any osc-* class name (in the attributes of `src/index.html`
  but its id references, or in any file the build bundles), a class name outside the frozen
  legacy vocabulary that is not a Pro class (defined by the compiled Tailwind CSS, named by no
  legacy stylesheet), a further use of a legacy class name, a rise of a legacy stylesheet's
  selectors or declarations or of a domain view's, a selector rule or `@utility` in the
  Tailwind entry or a mention of a CSS-defining plugin function in the Tailwind configuration,
  an `@import` that is neither relative nor an allowed package, a `<style>` element or a
  further inline style in `src/index.html`; a migrated surface that regresses, or one
  counted as migrated without the Tailwind build; another UI kit, a new stylesheet or a Pro
  source file. Until F001 builds Tailwind with the flowbite plugin, no surface can be
  migrated and no class name can be added. What no check decides is listed below.
- Each migration rebuilds the visual references of the views it changes (ADR 0029): a
  reference accepted under the token CSS no longer describes the page.
- Adding Tailwind and `flowbite` changes `package.json`, the build and the licence notices;
  `scripts/verify-dist.mjs` and the budget judge the result like any dependency (ADR 0012).
- The migration is planned work under its own intent and milestone in `.ai/repo/project/`.

## What no check decides

The rule `project.ui-uses-flowbite-pro` lists these in full; a reviewer owns them:

- a non-osc class reached in JavaScript through a variable, a helper's argument or a ternary
  branch, an osc-* name assembled from parts that hold no `osc-`, and styling set from
  JavaScript (`el.style`, `style:` keys, injected CSS);
- new markup without classes that legacy descendant selectors style, and a legacy rule
  rewritten in place at the same counts;
- a module or stylesheet the build reaches other than by a relative import (an alias, a
  plugin, a package);
- an osc-* class name that is also an element id and never appears in a class position;
- whether a surface on the Pro class set follows its Pro template in substance, and a markup
  surface that is not a landmark, a `<section>` or a `<dialog>` with an id;
- a Pro file copied with edits, which escapes the fingerprint (only about 120 of the roughly
  1,800 Pro files carry a marker), and Pro content inlined as a `data:` URI inside another
  file, `dist/index.html` included;
- a change of the measure itself, the list of domain-view stylesheets included, which is a
  change of the measure;
- whether a domain view belongs inside a Pro card; its own stylesheets and the `tokens.css`
  custom properties they read are outside the debt by decision 3 (recorded apart, never
  growing), and whether its own classes, still debt, leave the record by migration or by an
  owner decision;
- whether the EULA permits what decision 5 allows: that rests on the owner's confirmation.

## Resolution notes

Appended; the sections above are left as written.

### 2026-10-28: accepted on the owner's order; the status was written by a worker

The `accepted` status was set by the worker that wrote this decision, on the owner's explicit
order of 2026-10-28 quoted under Context (the order asks for the decision to be documented
and enforced), not by the owner editing this file. The ADR README says a worker never
promotes a status without the owner; this promotion rests on that order alone, and the owner
may confirm or withdraw it. The enforcement lands with it: rule `project.ui-uses-flowbite-pro`
v1 and `tests/unit/ui-flowbite-pro.test.mjs` with its record. The migration of the surfaces
it records is not done; the record says how much remains.

### 2026-10-28: the ratchet measures the whole legacy interface

The review of pull request #250 showed that the first record (28 primitive class names and
the list of stylesheet files, debt 905) could be met without adopting Pro. Before landing, the
record became measure 2: every osc-* class token per name, a frozen vocabulary of the other
class names, the selectors and declarations of each stylesheet, the inline styles, a pending
surface that may leave only into `migrated`, and no surface migrated before the build compiles
Tailwind with the flowbite plugin (debt 4252 on the same `src/`). The same review asked for
the licence statement under Context to rest on the owner's dated confirmation rather than on
the worker's reading, and it now does.

### 2026-10-28: the ratchet measures every file the build bundles

The second review of pull request #250 found that a module outside `src/js` or a stylesheet
outside `src/` reached the build without being measured, that a class renamed into a legacy
token already in the vocabulary lowered the debt, that an `@utility` in the Tailwind entry was
not counted, and that after F001 a legacy state class would have come back as new once its
last legacy rule was removed. Before landing, the record became measure 3: the inputs are
every tracked file under `src/` and every file their relative imports reach; each legacy
class name outside osc-* is counted per use and its uses join the debt; a class is a Pro
class only when `dist/index.html` defines it and no legacy stylesheet names it; the Tailwind
entry and configuration define no ad-hoc CSS; and a Studio node id (`osc-1`) that is never
in a class position is not counted (debt 4342 on the same `src/`).

### 2026-10-29: the record is judged against the base branch, and the domain views are not debt

The third review of pull request #250 found that the history check read the branch's own
first-parent commits: once #247 raised a count on `main`, a branch that merged `main` and
re-measured failed its own test, while its pull request's merge ref passed. The check now
judges only the record's versions on the base branch's first-parent chain, from the merge
base backwards, as CI does; a fixture proves it on a scratch git repository. The same review
found an aliased plugin call, an osc-* class carried by a `data-` attribute, a `data:`
`@import` and a tracked `node_modules` file escaping the record, and that decision 3 left the
domain views' own selectors as debt with no exit. Before landing, the record became measure
4: every attribute but the id references is read, any mention of a CSS-defining plugin
function fails, an `@import` must be relative or an allowed package, and the domain views'
stylesheets and `tokens.css` are recorded apart, ratcheted and not debt (debt 3905 on the same
`src/`, with 438 domain-view selectors apart). The record now has a committed writer,
`scripts/ui-flowbite-pro-record.mjs`, with a `--check` mode.
