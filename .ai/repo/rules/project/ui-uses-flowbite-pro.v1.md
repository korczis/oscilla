---
id: project.ui-uses-flowbite-pro
version: 1
kind: rule
title: The UI is built on Flowbite Pro, and the legacy interface only shrinks
description: Every UI surface of OSCILLA is built from the owner's licensed Flowbite Pro templates and components on Tailwind, compiled at build time and inlined; no other UI kit or ad-hoc component library is added, no Pro source file is committed, and the legacy interface (its surfaces, every osc-* class token, its other class names, its stylesheets' selectors and declarations, its inline styles) is a recorded debt that never grows.
statement: A new or changed UI surface (the shell, a workspace, a panel, a dialog, and every component inside them) is adapted from the matching Flowbite Pro template or block, with its Tailwind class structure, and a surface once on Pro stays on Pro; no dependency, import or stylesheet of another UI kit, no new stylesheet but the Tailwind entry (tailwind.css under src/styles, which holds no selector rule) and no ad-hoc component library is added; no Flowbite Pro source file, by name, fingerprint or licence marker, is committed, because OSCILLA is public; the domain views (charts, Signal Path, the Studio graph and timeline) keep their own rendering as the content of Pro cards; and the legacy interface recorded in tests/unit/ui-flowbite-pro-baseline.json (the surfaces not yet on Pro, the occurrences of every osc-* class token, the frozen set of the other class names, the selectors and declarations of each legacy stylesheet, the inline styles of src/index.html) equals the tree and never rises above its value in an earlier commit; a surface counts as on Pro only when the build compiles Tailwind with the flowbite plugin (ADR 0061).
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
surfaces of `src/index.html` was on Pro. A rule that required the whole interface at once
could not land, and a rule that required nothing would be "enforced" in name only. So the rule
holds the direction: the legacy interface does not grow, nothing migrated goes back, and the
recorded remainder only falls.

The first record counted 28 primitive class names and the list of stylesheet files (debt 905).
The review of pull request #250 showed that it could be met without adopting Pro: a new
`<div>` surface with a new class family, CSS appended to a legacy stylesheet, a class used from
a `.mjs` file or built as `'osc-' + 'btn'`, a renamed class, a surface whose id was removed,
and Pro classes on a surface while no Tailwind exists. The record now measures all of these
(measure 2, debt 4252 at the commit it was taken on: 62 surfaces, 2563 osc-* class tokens of
758 names, 1627 legacy selectors), and each of those mutations is a fixture of the test that
fails.

# Required behaviour

- **Pro first.** A surface is built from the matching Pro template or block (the admin shell
  first: navbar, sidebar drawer, main content, page header with breadcrumb, cards, tables,
  tabs, drawers, dropdowns, modals, alerts, badges, empty states, forms), adapting its markup
  and Tailwind class lists. A component the Pro set has is not invented.
- **Build time only.** Tailwind compiles from one entry stylesheet, tailwind.css under
  src/styles, at build time into the one inlined `<style>`; Flowbite's behaviour comes from
  the pinned public `flowbite` npm package bundled into the app script, or from Alpine.
  `project.single-file-deliverable` holds unchanged: no CDN, no runtime compiler, no remote
  font, no fetch. The entry holds at-rules only (`@import`, `@plugin`, `@source`, `@theme`
  and the like), never a selector rule.
- **Domain views inside Pro surfaces.** Charts, the Signal Path, the Studio graph and
  timeline, the spectrogram and meters keep their own rendering and the dataviz rules, as the
  content of Pro cards (`project.visual-identity-lock` v2).
- **No other kit.** No dependency, JavaScript import or CSS `@import` of another UI kit
  (Bootstrap, Bulma, Material, MUI, Ant Design, Chakra, daisyUI, Headless UI, Radix and the
  others the test lists); no CSS `@import` of a package but uPlot's stylesheet, Tailwind and
  Flowbite, each by its exact package name; no stylesheet under `src/` beyond the legacy ones
  and the Tailwind entry; no module of an ad-hoc component library under `src/`.
- **Licence.** No Flowbite Pro source file is committed: not by its package directory name,
  not as a copy (fingerprint), not with the Pro licence URL or repository names in it. Only
  markup adapted into OSCILLA's own files ships.
- **The legacy interface only shrinks.** The record lists every surface not yet on Pro, every
  surface migrated, the count of every osc-* class name, the frozen set of the other class
  names, the selectors and declarations of each legacy stylesheet and the inline styles. The
  tree equals it, so a migration lowers it in the same change; no committed version of the
  same measure is exceeded; a pending surface leaves the record only into `migrated`, never by
  vanishing; and a surface is migrated only when the build compiles Tailwind with the flowbite
  plugin and defines its Pro classes. Until F001 lands that build, no surface can be migrated,
  and no new class name of any kind can be added.

# Failure behaviour

A failing check fails `npm test`, so CI's `unit` job, and the required `gate`, refuse the pull
request. The fix is the surface, never the record: build the surface from Pro, or remove the
legacy class, rule or style. A pull request that migrates a surface moves it from `pending` to
`migrated` and lowers the counts. A surface deleted from the product cannot leave the record
on its own: the record keeps it pending (the tree check then fails), and its removal is an
owner decision that changes this rule.

# Enforcement

`tests/unit/ui-flowbite-pro.test.mjs`, run by `npm test` in the CI `unit` job (with
`fetch-depth: 0`, so the history check runs there), with its record
`tests/unit/ui-flowbite-pro-baseline.json` and the fingerprints
`tests/unit/flowbite-pro-fingerprints.json` (written by
`scripts/flowbite-pro-fingerprints.mjs` from the owner's licensed copy, which the test
imports for the fingerprint function). The test's header defines every term exactly:

- (a) the record, which the tree must equal:
  - the surfaces of `src/index.html` (navbar, sidebar, main, footer by their landmarks; every
    `osc-view-*` workspace; every other `<section>` with an id; every `<dialog>` with an id),
    pending unless the root carries the Pro class set of its kind, the build compiles Tailwind
    with the flowbite plugin (the `tailwindcss` and `flowbite` packages, the plugin in the
    entry or a `tailwind.config.*`, a script under `scripts/` that imports Tailwind) and the
    committed `dist/index.html` defines every class of that set;
  - every osc-* class token, per name, BEM variants and run-time prefixes (`'osc-' + x`,
    `` `osc-x--${y}` ``) included: in the class and Alpine attributes of `src/index.html`
    (HTML comments removed) and in the whole text of every tracked file under `src/js`,
    whatever its extension; a name that is only an element id is not counted, and a name that
    is neither a class nor an id (a storage key, a node id) is, so the count errs high;
  - the other class names in class positions, a frozen vocabulary;
  - the selectors and declarations of each tracked stylesheet under `src/` but the entry;
  - the inline `style` attributes of `src/index.html`;
  - debt: pending surfaces + osc-* class tokens + legacy selectors.

  Beside it, the Tailwind entry holds no selector rule and `src/index.html` no `<style>`
  element. The working tree's record is judged against every committed version of itself in
  its first-parent history: no number above one of the same measure, no class, vocabulary
  token, stylesheet or pending surface an earlier version did not list, no pending surface
  that is now neither pending nor migrated, no migrated surface lost, no measure going back.
  In CI a git failure or an empty history fails the check; outside CI it skips.
- (b) a surface listed as migrated exists and is migrated as defined in (a).
- (c) another UI kit in `package.json`, an import or an `@import`; an `@import` of a package
  outside uPlot, Tailwind and Flowbite (exact names); a new stylesheet; a component-library
  path.
- (d) a tracked file named like a Pro package, matching a Pro fingerprint or carrying a Pro
  marker, over every tracked file.
- Each clause has fixture mutations in the same file that make it fail, among them the six of
  the review of pull request #250 (M2 a div-based surface or a new class family, M3 appended
  CSS, M4 and M5 a `.mjs` file and concatenation, M7 a renamed class, M8 a vanished surface,
  M9 Pro classes without the build).

# What no check decides

A reviewer owns each of these; no test here decides them:

- A non-osc class reached in `src/js` through a variable, a helper's argument or a ternary
  branch that is not a literal of a recognised class position (`class:`, `className:`,
  `.className =`, `classList.*(...)`, `setAttribute('class', ...)`, `class="..."` in a string).
- Styling set from `src/js`: `el.style`, `style:` keys, an injected `<style>` or `insertRule`.
- An osc-* class name that is also an element id and never appears in a class position.
- Whether a surface that carries the Pro class set follows its Pro template in substance
  (layout, spacing, the components inside it), and a markup surface that is neither a
  landmark, a `<section>` nor a `<dialog>` with an id (its classes are still counted).
- A Pro file copied with edits: a one-byte change escapes the fingerprint, and only about 120
  of the roughly 1,800 Pro files carry a marker, so most edited copies go undetected. Pro
  content inlined as a `data:` URI inside another file, `dist/index.html` included, is not
  fingerprinted either.
- A change of the measure itself (`MEASURE` in the test): it resets the numeric comparison
  with earlier versions, and it is a change of the test.
- Whether a domain view belongs inside a Pro card or is a component Pro already has, and
  whether its own classes (counted as debt) leave the record by migration or by an owner
  decision.
- Once F001 lands, which Tailwind classes are used: the vocabulary check then accepts any new
  class that `dist/index.html` defines, so whether those classes follow the Pro template is
  the review's question.
