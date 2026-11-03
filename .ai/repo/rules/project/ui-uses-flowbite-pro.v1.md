---
id: project.ui-uses-flowbite-pro
version: 1
kind: rule
title: The UI is built on Flowbite Pro, and the legacy interface only shrinks
description: Every UI surface of OSCILLA is built from the owner's licensed Flowbite Pro templates and components on Tailwind, compiled at build time and inlined; no other UI kit or ad-hoc component library is added, no Pro source file is committed, and the legacy interface (its surfaces, every osc-* class token, the uses of its other class names, its stylesheets' selectors and declarations, its inline styles, measured over every file the build bundles) is a recorded debt that never grows; the domain views' own stylesheets are recorded apart and never grow either, but are not debt.
statement: A new or changed UI surface (the shell, a workspace, a panel, a dialog, and every component inside them) is adapted from the matching Flowbite Pro template or block, with its Tailwind class structure, and a surface once on Pro stays on Pro; no dependency, import or stylesheet of another UI kit, no new stylesheet the build reaches, under src/ or imported from anywhere, but the Tailwind entry (tailwind.css under src/styles, which with the Tailwind configuration defines no ad-hoc CSS) and no ad-hoc component library is added; no Flowbite Pro source file, by name, fingerprint or licence marker, is committed, because OSCILLA is public; the domain views (charts, Signal Path, the Studio graph and timeline) keep their own rendering as the content of Pro cards; and the legacy interface recorded in tests/unit/ui-flowbite-pro-baseline.json (the surfaces not yet on Pro, the occurrences of every osc-* class token, the uses of each other legacy class name, the selectors and declarations of each legacy stylesheet and of each domain view's own stylesheet, the inline styles of src/index.html, over every file the build bundles) equals the tree and never rises above its value in a commit of the base branch; a surface counts as on Pro only when the build compiles Tailwind with the flowbite plugin (ADR 0061).
status: active
class: blocking
depends_on: [project.single-file-deliverable@2, project.visual-identity-lock@3]
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
and Pro classes on a surface while no Tailwind exists. The record then measured all of these
(measure 2, debt 4252). Its second review found more of the same kind: a module outside
`src/js` or a stylesheet outside `src/` that the build bundles, a class renamed into a legacy
token already in the vocabulary, an `@utility` in the Tailwind entry, and a legacy state class
that would have come back as new once its last legacy rule was removed. The record now
measures every file the build bundles and counts each legacy class name per use (measure 3,
debt 4342 at the commit it was taken on: 62 surfaces, 2550 osc-* class tokens of 756 names,
103 uses of 38 other legacy class names, 1627 legacy selectors), and each of those mutations
is a fixture of the test that fails. The third review found the history check judging the
branch's own earlier commits, so a branch that merged its base and re-measured failed its own
test while its pull request passed; the check now reads only the base branch's chain. It also
found an aliased plugin call, an osc-* class carried by a `data-` attribute, a `data:`
`@import` and a tracked `node_modules` file escaping the record, and the domain views'
stylesheets counted as debt that decision 3 of ADR 0061 keeps. The record became measure 4
(debt 3905 at the same commit: 62 surfaces, 2551 osc-* class tokens of 757 names, 103 uses of
38 other legacy class names, 1189 legacy selectors; the domain views' 438 selectors, recorded
apart, are not debt).

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
  and the like), never a selector rule, an `@layer components` rule or an `@utility`; the
  Tailwind configuration and its local plugins never mention `addComponents`,
  `addUtilities`, `matchComponents`, `matchUtilities` or `addBase` (a call through an alias of
  the destructured name or a property access counts as one).
- **Domain views inside Pro surfaces.** Charts, the Signal Path, the Studio graph and
  timeline, the spectrogram and meters keep their own rendering and the dataviz rules, as the
  content of Pro cards (`project.visual-identity-lock` v2). Their own stylesheets
  (`charts.css`, `studio.css`, `studio-timeline.css` under `src/styles`) and `tokens.css`, the
  custom properties they read, are therefore not debt: the record lists them apart
  (`domainViews`), and they never gain a selector or a declaration, but the interface reaches
  debt 0 without removing them.
- **No other kit.** No dependency, JavaScript import or CSS `@import` of another UI kit
  (Bootstrap, Bulma, Material, MUI, Ant Design, Chakra, daisyUI, Headless UI, Radix and the
  others the test lists); no CSS `@import` of a package but uPlot's stylesheet, Tailwind and
  Flowbite, each by its exact package name, and none that is not relative either (a `data:`
  URI, a URL, an absolute path); no stylesheet the build reaches beyond the legacy ones, the
  domain views' and the Tailwind entry; no module of an ad-hoc component library among the
  inputs.
- **Licence.** No Flowbite Pro source file is committed: not by its package directory name,
  not as a copy (fingerprint), not with the Pro licence URL or repository names in it. Only
  markup adapted into OSCILLA's own files ships.
- **The legacy interface only shrinks.** The record lists every surface not yet on Pro, every
  surface migrated, the count of every osc-* class name, the uses of each other legacy class
  name (a frozen vocabulary, counted per use), the selectors and declarations of each legacy
  stylesheet and the inline styles, over every file the build bundles, and apart from them the
  selectors and declarations of the domain views' stylesheets. The tree equals it, so a
  migration lowers it in the same change; no version of the same measure committed on the base
  branch is exceeded; a pending surface leaves the record only into `migrated`, never by
  vanishing; and a surface is migrated only when the build compiles Tailwind with the flowbite
  plugin and defines its Pro classes. Until F001 lands that build, no surface can be migrated,
  and no new class name of any kind can be added; a legacy class name is neither reused nor
  renamed into.

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
`scripts/flowbite-pro-fingerprints.mjs` from the owner's licensed copy, which the measure
imports for the fingerprint function). The measure itself is
`scripts/ui-flowbite-pro-measure.mjs`; the test's header defines every term exactly. The
record is written from the tree by `node scripts/ui-flowbite-pro-record.mjs` (it keeps the
rule, the note and the measured block; `--measured <commit>` takes a new measure), and
`node scripts/ui-flowbite-pro-record.mjs --check` exits 1 when the committed record differs
from the tree (`tests/unit/ui-flowbite-pro-record.test.mjs`). Writing the record never excuses
a rise: the test judges the written record against the base branch's versions.

- (a) the record, which the tree must equal:
  - the inputs: every tracked file under `src/` and every file a relative JavaScript import
    (`import`, `export ... from`, `import()`, `require()`, `new URL()`) or CSS `@import` of one
    of them reaches, transitively, wherever it lives, a tracked file under a `node_modules`
    directory included; a reached `.css` file is a stylesheet, any other a JavaScript text;
  - the surfaces of `src/index.html` (navbar, sidebar, main, footer by their landmarks; every
    `osc-view-*` workspace; every other `<section>` with an id; every `<dialog>` with an id),
    pending unless the root carries the Pro class set of its kind, the build compiles Tailwind
    with the flowbite plugin (the `tailwindcss` and `flowbite` packages, the plugin in the
    entry or a `tailwind.config.*`, a script under `scripts/` that imports Tailwind) and every
    class of that set is a Pro class: the committed `dist/index.html` defines it and no legacy
    stylesheet names it;
  - every osc-* class token, per name, BEM variants and run-time prefixes (`'osc-' + x`,
    `` `osc-x--${y}` ``) included: in every attribute of `src/index.html` but the id
    references (`id`, `for`, `form`, `list`, `headers`, `aria-*`, `x-ref`, an `href` that
    starts with `#`, and their bound forms), `data-*` and Alpine attributes included (HTML
    comments removed), and in the whole text of every JavaScript input, whatever its
    extension; a name that is only an element id, or a Studio node id (`osc-1`), and never in
    a class position is not counted, and any other name that is not a class (a storage key)
    is, so the count errs high;
  - the other class names in class positions that are not Pro classes, counted per use: a
    frozen vocabulary that neither gains a name nor a use; a name a legacy stylesheet names
    stays in it whatever `dist/index.html` defines, so removing a legacy rule never turns a
    used legacy class into a new one;
  - the selectors and declarations of each stylesheet input but the entry; those of the
    domain views' stylesheets and `tokens.css` (`DOMAIN_VIEW_STYLESHEETS`) apart, as
    `domainViews`, ratcheted the same way and not debt;
  - the inline `style` attributes of `src/index.html`;
  - debt: pending surfaces + osc-* class tokens + uses of legacy vocabulary names + legacy
    selectors (the domain views' not among them).

  Beside it, the Tailwind entry holds no selector rule and no `@utility`, the Tailwind configuration
  and the local plugins it or the entry loads mention none of Tailwind's CSS-defining plugin
  functions, and `src/index.html` holds no `<style>` element. The working tree's record is judged
  against every committed version of itself on the base branch's first-parent chain (the base is
  `GITHUB_BASE_REF` in CI, `main` otherwise; the chain runs backwards from the newest commit of that
  chain the branch contains, which is `git merge-base HEAD origin/<base>` when the branch forked
  from or merged it), never against a commit of the branch itself, even once the base holds the
  branch, so a branch that merges its base and re-measures is judged as its pull request is: no
  number above one of the same measure (an osc-* class name or a vocabulary token absent there
  counts as 0), no vocabulary token, stylesheet or pending surface an earlier version (of any
  measure that lists them) did not list, no pending surface that is now neither pending nor
  migrated, no migrated surface lost, no measure going back. osc-* class names are compared within
  the same measure only. When the base holds no record at the fork, the change introduces it and
  nothing is judged. In CI a git failure, a shallow clone, a missing base or an empty history of a
  base that holds the record fails the check; outside CI it skips.
- (b) a surface listed as migrated exists and is migrated as defined in (a).
- (c) another UI kit in `package.json`, an import or an `@import`; an `@import` that is
  neither relative (`./`, `../`) nor a package of uPlot, Tailwind and Flowbite (exact names),
  a `data:` URI, a URL and an absolute path included; a new stylesheet; a component-library
  path among the inputs.
- (d) a tracked file named like a Pro package, matching a Pro fingerprint or carrying a Pro
  marker, over every tracked file.
- Each clause has fixture mutations in the same file that make it fail, among them those of
  the two reviews of pull request #250: M2 a div-based surface or a new class family, M3
  appended CSS, M4 and M5 a `.mjs` file and concatenation, M7 a renamed class, M8 a vanished
  surface, M9 Pro classes without the build; N2 and N7 a legacy class token reused or renamed
  into, N4 and N5 a module or stylesheet outside `src/js` or `src/` that the build reaches,
  N8 a legacy class renamed to a name a legacy stylesheet defines, N10 an `@utility` or a
  plugin component, and a legacy state class whose last legacy rule is removed after F001;
  and those of the third review: a branch that merges its base and re-measures (in a scratch
  git repository), an aliased plugin call, an osc-* class in a `data-` attribute, a `data:`
  `@import`, a tracked `node_modules` file, and a domain view that grows.

# What no check decides

A reviewer owns each of these; no test here decides them:

- A non-osc class reached in JavaScript through a variable, a helper's argument or a ternary
  branch that is not a literal of a recognised class position (`class:`, `className:`,
  `.className =`, `classList.*(...)`, `setAttribute('class', ...)`, `class="..."` in a string).
- An osc-* class name assembled from parts none of which holds `osc-`
  (`['osc', 'btn'].join('-')`, character codes).
- New markup without classes that legacy descendant selectors style (`.osc-panel button`):
  elements are not counted, only their classes.
- A legacy rule rewritten in place at the same counts of selectors and declarations: the
  record counts the legacy CSS, it does not hash it.
- A module or stylesheet the build reaches other than by a relative import: a path alias, a
  bundler plugin, a package (packages are judged by the kit check).
- Styling set from `src/js`: `el.style`, `style:` keys, an injected `<style>` or `insertRule`.
- An osc-* class name that is also an element id and never appears in a class position.
- Whether a surface that carries the Pro class set follows its Pro template in substance
  (layout, spacing, the components inside it), and a markup surface that is neither a
  landmark, a `<section>` nor a `<dialog>` with an id (its classes are still counted).
- A Pro file copied with edits: a one-byte change escapes the fingerprint, and only about 120
  of the roughly 1,800 Pro files carry a marker, so most edited copies go undetected. Pro
  content inlined as a `data:` URI inside another file, `dist/index.html` included, is not
  fingerprinted either.
- A change of the measure itself (`MEASURE` in `scripts/ui-flowbite-pro-measure.mjs`): it
  resets the numeric comparison with earlier versions, and it is a change of the measure.
- Which stylesheets are a domain view's own (`DOMAIN_VIEW_STYLESHEETS` in the same file):
  adding one there is a change of the measure, which the review of that change judges against
  decision 3 of ADR 0061.
- Whether a domain view belongs inside a Pro card or is a component Pro already has. Its own
  stylesheets (`charts.css`, `studio.css`, `studio-timeline.css`) and the `tokens.css` custom
  properties they read are outside the debt by decision 3 of ADR 0061: the record lists them
  apart and they never grow, but debt 0 does not require removing them. Whether a domain
  view's own classes (osc-* tokens and vocabulary uses, still counted as debt) leave the record
  by migration or by an owner decision is the owner's and the review's question.
- Once F001 lands, which Tailwind classes are used: the vocabulary check then accepts any new
  class that `dist/index.html` defines and no legacy stylesheet names, so whether those
  classes follow the Pro template is the review's question.
