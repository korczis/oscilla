---
id: project.ui-uses-flowbite-pro
version: 1
kind: rule
title: The UI is built on Flowbite Pro, and the legacy interface only shrinks
description: Every UI surface of OSCILLA is built from the owner's licensed Flowbite Pro templates and components on Tailwind, compiled at build time and inlined; no other UI kit or ad-hoc component library is added, no Pro source file is committed, and the surfaces and primitives that predate the rule are recorded debt that only shrinks.
statement: A new or changed UI surface (the shell, a workspace, a panel, a dialog, and every component inside them) is adapted from the matching Flowbite Pro template or block, with its Tailwind class structure, and a surface once on Pro stays on Pro; no dependency, import or stylesheet of another UI kit, no new stylesheet but the Tailwind entry (tailwind.css under src/styles) and no ad-hoc component library is added; no Flowbite Pro source file, by name, fingerprint or licence marker, is committed, because OSCILLA is public; the domain views (charts, Signal Path, the Studio graph and timeline) keep their own rendering as the content of Pro cards; and the surfaces not yet on Pro and the occurrences of the legacy token-CSS primitives, recorded in tests/unit/ui-flowbite-pro-baseline.json, equal the tree and never rise above their value in an earlier commit (ADR 0061).
status: active
class: blocking
depends_on: [project.single-file-deliverable@2, project.visual-identity-lock@2]
tags: [design, visual, ui, dependencies, licence]
x-majordomus:
  tests: [tests/unit/ui-flowbite-pro.test.mjs]
---

# Rationale

The owner's order of 2026-10-28: "vsechny me projekty musi mit flowbite pro, musi byt
enforced, always used; dokumentuj, enforcuj, backpropaguj, overuj" (all my projects must have
Flowbite Pro, enforced, always used; document, enforce, backpropagate, verify). ADR 0061
records the decision, which supersedes ADR 0012's choice of plain token CSS over Tailwind and
Flowbite and keeps everything else of ADR 0012. When the rule was written, none of the 62 UI
surfaces of `src/index.html` was on Pro and the legacy primitives occurred 843 times: a rule
that required the whole interface at once could not land, and a rule that required nothing
would be "enforced" in name only. So the rule holds the direction: nothing new is built off
Pro, nothing migrated goes back, and the recorded remainder only falls.

# Required behaviour

- **Pro first.** A surface is built from the matching Pro template or block (the admin shell
  first: navbar, sidebar drawer, main content, page header with breadcrumb, cards, tables,
  tabs, drawers, dropdowns, modals, alerts, badges, empty states, forms), adapting its markup
  and Tailwind class lists. A component the Pro set has is not invented.
- **Build time only.** Tailwind compiles from one entry stylesheet, tailwind.css under
  src/styles, at build time into the one inlined `<style>`; Flowbite's behaviour comes from
  the pinned public `flowbite` npm package bundled into the app script, or from Alpine.
  `project.single-file-deliverable` holds unchanged: no CDN, no runtime compiler, no remote
  font, no fetch.
- **Domain views inside Pro surfaces.** Charts, the Signal Path, the Studio graph and
  timeline, the spectrogram and meters keep their own rendering and the dataviz rules, as the
  content of Pro cards (`project.visual-identity-lock` v2).
- **No other kit.** No dependency, JavaScript import or CSS `@import` of another UI kit
  (Bootstrap, Bulma, Material, MUI, Ant Design, Chakra, daisyUI, Headless UI, Radix and the
  others the test lists); no CSS `@import` of a package but uPlot's stylesheet, Tailwind and
  Flowbite; no stylesheet under `src/styles` beyond the legacy ones and the Tailwind entry;
  no module of an ad-hoc component library under `src/`.
- **Licence.** No Flowbite Pro source file is committed: not by its package directory name,
  not as a copy (fingerprint), not with the Pro licence URL or repository names in it. Only
  markup adapted into OSCILLA's own files ships.
- **The debt only shrinks.** The baseline lists every surface not yet on Pro, every surface
  migrated, the count of each legacy primitive and the legacy stylesheets. The tree equals it,
  so a migration lowers it in the same change, and no version of it rises above an earlier
  one.

# Failure behaviour

A failing check fails `npm test`, so CI's `unit` job, and the required `gate`, refuse the pull
request. The fix is the surface, never the record: build the surface from Pro, or remove the
primitive use. A pull request that migrates a surface moves it from `pending` to `migrated`
and lowers the counts.

# Enforcement

`tests/unit/ui-flowbite-pro.test.mjs`, run by `npm test` in the CI `unit` job (with
`fetch-depth: 0`, so the history check runs there), with its record
`tests/unit/ui-flowbite-pro-baseline.json` and the fingerprints
`tests/unit/flowbite-pro-fingerprints.json` (written by
`scripts/flowbite-pro-fingerprints.mjs` from the owner's licensed copy, which the test
imports for the fingerprint function). The test's header defines every term exactly:

- (a) the debt: the surfaces of `src/index.html` (navbar, sidebar, main, footer by their
  landmarks; every `osc-view-*` workspace; every other `<section>` with an id; every
  `<dialog>` with an id) whose root's class attribute lacks the Pro class set of its kind,
  plus the whole-name occurrences of the legacy primitives in `src/index.html` and `src/js`.
  The tree must equal the record, and every recorded version in the baseline's first-parent
  history is judged against every earlier one.
- (b) a surface listed as migrated exists and carries its Pro structure.
- (c) another UI kit in `package.json`, an import or an `@import`; a new stylesheet; a
  component-library path.
- (d) a tracked file named like a Pro package, matching a Pro fingerprint or carrying a Pro
  marker, over every tracked file.
- Each clause has fixture mutations in the same file that make it fail.

What no check decides, and a reviewer owns: whether a surface that carries the Pro class set
follows its Pro template in substance (layout, spacing, components inside it); fidelity of
components rendered by `src/js` beyond the primitive count; a Pro file copied with edits
(it escapes the fingerprint and is caught only if it keeps a marker); and whether a domain
view belongs inside a Pro card or is a component Pro already has.
