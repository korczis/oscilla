---
schema: adr/v1
id: adr-0081
kind: adr
title: "A component is declared once, in a registry built into the single file; its trace stays outside the bundle, and Majordomus serves every declaration from a generated knowledge projection"
status: proposed
date: 2026-10-30
tags:
  - ui
  - components
  - knowledge
  - majordomus
related:
  - rule:project.ui-uses-flowbite-pro
  - rule:project.studio-model-is-canonical
  - rule:project.typed-ports
  - rule:project.single-file-deliverable
  - rule:project.no-inert-surfaces
  - rule:project.no-fake-science
  - rule:project.rules-name-their-enforcement
  - file:.ai/repo/adrs/0030-studio-model-canonical-separate-from-runtime.md
  - file:.ai/repo/adrs/0032-typed-ports-validated-before-runtime.md
  - file:.ai/repo/adrs/0061-the-ui-is-built-on-flowbite-pro.md
  - file:.ai/repo/knowledge/README.md
  - file:.ai/repo/knowledge/sources.yaml
  - file:.ai/repo/project/issues/J001.yaml
  - file:src/js/studio/registry.js
  - file:src/js/studio/nodes/common.js
  - file:scripts/ui-flowbite-pro-measure.mjs
provenance:
  origin: authored
  derived_from:
    - file:.ai/repo/knowledge/sources.yaml
    - file:src/js/studio/registry.js
---

# 81. A component is declared once, in a registry built into the single file; its trace stays outside the bundle, and Majordomus serves every declaration from a generated knowledge projection

Filed on 2026-10-30 by plan issue J001 from the draft of 2026-10-29 (`majordomus adr next`
allocated adr-0081; 0062 is held by `feat/k026-qwerty-piano` and 0064-0079 are spent).

## Context

On 2026-10-29 the owner asked, in Czech, for the components of OSCILLA and their interfaces to
improve, for ADRs and knowledge-base entries for them, for knobs, sliders and control panels
done in one generic way, and for the whole to be "Majordomus integrated": each component and
parameter declaration carries its intent, issue and rule ids, a deterministic generator
projects the registry into `.ai/repo/knowledge` so that Majordomus serves it, and a check
fails when a component has no plan or knowledge link.

What exists on `origin/main` (`cdda563c`):

- Studio node types are declared once each by `defineNode` and collected in `NODE_REGISTRY`
  (`src/js/studio/registry.js`); a parameter is a section 79 descriptor
  (`numberParam`, `frequencyParam`, `enumParam` in `src/js/studio/nodes/common.js`). ADR 0030
  makes the StudioModel the only Studio state; ADR 0032 types every port.
- Nothing else in the interface is declared. About 576 `data-osc` hooks are written by hand in
  `src/index.html` and `src/js` (the components inventory of 2026-10-29).
- The Flowbite Pro ratchet refuses a build input path with a `components`, `widgets`,
  `ui-kit` or `design-system` segment (`COMPONENT_LIBRARY` in
  `scripts/ui-flowbite-pro-measure.mjs`), and reads every tracked file under `src/`.
- The knowledge index of Majordomus discovers only tracked files, through the classes of
  `.ai/repo/knowledge/sources.yaml`. The knowledge README says a compiled product (an index, a
  graph) is local and belongs under `.ai/local/cache/`.

The session's drafts plan the pieces: the catalogue contract and registry (G001), its
generated documents and trace check (G014, G017), the parameter declaration and the control
interface (N001, N003), the face declaration of a node type (V619), the parameter contract
(K105), the new instrument kinds (W001-W016) and the GL views (Y001-Y009). None of them decides
how a component reaches Majordomus. This record decides the contract they share and that.

Measured on 2026-10-29 with Majordomus 1.0.0-alpha.1 (then the CI pin) and 1.0.0-alpha.8
(then the launcher) on a throwaway copy of `origin/main`, and read in `lib/knowledge.awk` of
both distributions. Both are 1.0.0-alpha.9 since pull request #291; the points below were not
re-measured on it, and G001 re-measures the ones it relies on:

1. A record of `schema: knowledge/v1` in a new directory, discovered by a new source class of
   `kind: knowledge`, becomes a node of the index. Each `relations[].target` of the form
   `rule:`, `adr:`, `intent:`, `milestone:`, `feature:`, `claim:`, `moment:`, `knowledge:`,
   `implementation:` or `test:`, and each `provenance.derived_from` `file:` or `test:`, is an
   edge, and `majordomus knowledge related rule:project.typed-ports` lists the record among the
   edges into the rule.
2. `majordomus knowledge validate` refuses a record with a key the schema does not declare or
   an enum value it does not know, and reports a relation to a node that does not exist as a
   dangling edge (FAIL in `knowledge validate`, WARN in `doctor`).
3. It does not resolve `issue:` targets: `issue:` is a ledger reference in the extractor, so
   `issue:C999` is emitted as stated and never reported. Intent criteria are not nodes:
   `intent:ui-flowbite-pro#x` dangles.
4. `majordomus knowledge check` reads only `curated/` and `candidates/`. In another directory
   a record whose `id` differs from its file name, whose `date` is `2026-13-99`, or which says
   `verified` without provenance, is accepted.
5. A kind the repository declares in `.ai/repo/knowledge/kinds.yaml` is not one the extractor
   has a rule for: its nodes become `unknown`, with a WARN and no edges.
6. A context document under `.ai/` reaches a source path through `tracks` (pathspecs): with
   `tracks: [':(glob)src/js/labs/*.js']`, `majordomus context resolve src/js/labs/filter-lab.js`
   lists it. `scope: explicit` with `paths` outside `.ai/` is refused.
7. With `context.knowledge: true` in the profile, `majordomus context` for a task bound to an
   issue prints knowledge pointers: the issue, its milestone, and every node whose path is in
   the issue's `scope`. A knowledge record that relates to the issue but is not in its scope is
   not pointed to.

## Decision

1. **One declaration per component, in one registry.** A Studio node type stays one
   `defineNode` declaration, with its face (V619) and its parameters (section 79 descriptors,
   specified by N001 as `paramSpec`). Every other component is one `defineComponent`
   declaration under `src/js/ui/catalog/` (G001); a kind's own module lives where its line puts
   it (`src/js/ui/kinds/`, the param kind's views in `src/js/ui/kinds/param/`), never under a path the ratchet refuses. The
   catalogue registry imports every declaration statically and derives one entry per node type,
   so esbuild builds it into `dist/index.html` with no build-script change.
2. **The catalogue is data, not a framework.** It holds no value, resolves no state path at run
   time, subscribes to no store, evaluates no condition and registers no directive. The surface
   that owns a value passes it and commits it through the one entry point of its kind
   (`mountControl(host, decl, { value, commit })`, N003). A declared `state` path is
   documentation and a unit-test fact. The StudioModel stays the only Studio state.
   Every kind's mount returns `{ element, set, setDisabled, destroy }` plus its documented
   extras, and `commit` returns `true` or `{ refused }`. A view keeps only transient
   interaction state (focus, an in-progress drag preview, an open entry); selection,
   scroll, zoom, folding, markers, taps, holds and latches are passed in by the owner. No
   runtime module reads a declaration to route events or keys; the contract test proves
   each view's behaviour equals its declaration. No kind binds a bare letter key (the
   armed computer-keyboard piano owns the letters). Class names are literal strings, and
   no view writes `el.style`.
3. **The kinds are a closed list.** A kind is added with its interface (inputs, the events it
   emits, the state path it shows, its links, its accessible name, role and value text) and a
   contract test that every declaration of the kind passes. Only kinds with proven duplication
   render from a template, and a template is adapted Flowbite Pro markup with no CSS (ADR 0061).
4. **Every declaration carries its trace, outside the bundle.** The trace of a family lives in
   `scripts/ui-catalog/trace/<family>.mjs`, which no module under `src/` may import, so it costs
   no bytes and the ratchet does not read it. A trace entry names, for a kind, a component, a
   node type or a parameter:
   - `plan`: issue ids of `.ai/repo/project/issues`;
   - `serves`: `<intent>#<criterion>` in the grammar of an issue's `serves`;
   - `rules`: project rules in force; `adrs`: decision records;
   - `tests`: test files that `npm test` or a `package.json` script runs and that name the
     declaration's id in a string literal;
   - optionally `claims`, `features` and `moments`;
   - `since`: the day the entry was last changed by an author.

   A parameter inherits its component's entry, a component its family's defaults; what an entry
   adds is its own. The effective `plan` of every declaration is not empty, and neither is its
   effective `rules` with `adrs`.
5. **Majordomus serves the registry through a generated projection under
   `.ai/repo/knowledge/components/`.**
   - `scripts/ui-catalog.mjs --kb` (the catalogue's one generator, G014) writes one `knowledge/v1` record per kind
     (`component-kind-<kind>`), per panel (`component-panel-<panel>`) and per node type
     (`component-node-<type>`). A record names its parameters and their effective ids in its
     body, and its relations are the union of the ids. A kind record does not list its
     instances; a panel or node record relates to its kind record, so
     `knowledge related knowledge:component-kind-param` lists them. A change to one declaration
     therefore rewrites one record.
   - It also writes the directory's `README.md`, a `context/v1` document whose `tracks` are
     the source modules the declarations name, so that `context resolve` on any of them returns
     the contract.
   - A source class `component` (`kind: knowledge`, `pathspec:
     ':(glob).ai/repo/knowledge/components/*.md'`) discovers them.
   - The output is byte-stable: sorted by code unit, LF, no clock, no absolute path, plan
     ids only (never an issue's title or status); one `--check` covers the catalogue, the
     controls section, the traceability chain and this projection in `npm test`.
   - Each record is `class: fact`, `epistemics: observed`, `status: verified`,
     `provenance.origin: extracted`, with `derived_from` naming the declaration and trace files.
     Its statement is "the registry declares this, at this commit", and its verification is
     mechanical: byte equality with the generator and resolution of every reference, both in
     `npm test`. It is never edited by hand. What a person learns about a component is a
     curated note that relates to the generated record.
   - This amends the knowledge README for this one directory: Majordomus discovers tracked files
     only (Context 1), so a projection kept under `.ai/local/cache/` would be served by nothing.
     Every other compiled product stays local.
6. **A component with no plan link or no knowledge link fails.** `tests/unit/component-links.test.mjs`
   fails when a declared kind, component, node type or parameter:
   - has an empty effective `plan`, or names an id that does not resolve: an issue file, an
     intent and its criterion, a rule in force in the rules index, an ADR, a test run by
     `npm test`, a claim, a feature or a moment;
   - is listed in no generated record, or in more than one;
   - belongs to a record that is not current, or whose relations name no rule or ADR.

   The test resolves `issue:` and `intent#criterion` references itself, because Majordomus does
   not (Context 3). Declarations that exist before this lands are listed in a section of the one
   allowance file `tests/unit/ui-catalog-allowance.json`, which only shrinks. A project rule names the test as its enforcement in the change that lands it
   (`project.rules-name-their-enforcement`).
7. **Majordomus judges the projection too.** The CI `knowledge` job fails on any `knowledge
   validate` finding whose source is under `.ai/repo/knowledge/components/`. The
   `implementation` profile sets `context.knowledge: true`. An issue that changes a declaration
   names the records it rewrites in its `scope`, so the task's context points to them
   (Context 7).

## Alternatives rejected

- **One `feature/v1` record per component.** A feature is one thing the product does for a
  person, with product floors and a public page; a cutoff slider is not one. A component
  record relates to the feature it is part of instead (`relates_to feature:filter-lab`).
- **A repository kind `component` in `.ai/repo/knowledge/kinds.yaml`, one generated YAML file
  with one member per component.** This would be the better shape: one file, one node per
  component. Today the extractor gives a repository kind no edges (Context 5). It is the first
  upstream candidate; once Majordomus derives edges for repository kinds, this decision is
  superseded by a record that moves the projection there.
- **One hand-written curated note per component.** A second source of truth that goes stale
  first, which the curated README forbids.
- **A compiled index under `.ai/local/cache/`.** Never discovered.
- **The trace in the bundle.** About 15-20 KB gzip for every hook with a sentence (components
  design, section 2.3), for text no user reads.
- **Edges only in `docs/ui-traceability.md`.** Readers get the chain; Majordomus does not.
- **`status: candidate` for generated records.** A candidate waits for a person to promote or
  reject it. A generated record is never promoted; it is current or the gate fails.

## Consequences

- The tracked knowledge layer grows by about 80 records once G018 and G019 have declared every
  component (about 22 kinds, 30-45 panels and 25 node types on `origin/main`), and by one per
  node type the synth line adds. Each is a few kilobytes of text outside `src/`. The bundle does
  not change.
- `majordomus knowledge search cutoff`, `knowledge related rule:project.typed-ports`,
  `knowledge related issue:<id>`, `context resolve src/js/labs/filter-lab.js`, the resource
  `majordomus://knowledge/component-panel-filter-lab` and the Cockpit route
  `/cockpit/objects/knowledge` reach every component. From a record's issue ids,
  `majordomus_trace_issue` reaches the branches and commits that realised it.
- `majordomus why` does not list components, and neither does `majordomus_feature`: both
  derive only from the moment's or the feature's own fields. A component record relates to its
  moments, claims and features, which reach them backwards in the knowledge graph only.
  Listing inbound records on those views is an upstream candidate.
- G017's trace field `intents` becomes `serves`, criterion-level, and gains `rules`, `claims`,
  `features`, `moments` and `since`. The W and Y lines put their kinds and GL hosts in the same
  trace files.
- A worker adds a component by writing the declaration and its trace entry and running
  `npm run kb:components`. `npm test` says what is missing.
- The status stays `proposed` until the owner accepts it.
