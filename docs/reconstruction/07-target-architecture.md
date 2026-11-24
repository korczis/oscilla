# 07. Target product architecture

This document covers deliverables 7, 8, 10, 11 and 13 of the product reconstruction: the
competing architectures, the recommended target, the visual system, desktop and phone
composition, and the migration strategy.

- **Base.** `main` at `c3b15610` (v3.42.1), 2026-11-24.
- **Evidence.** Documents 01 to 05 and the screenshot census in `evidence/`.
- **Critique.** An independent critic tried to falsify the first draft against the code and
  the binding records. Every amendment it made is folded in here and marked *(critique)*.
- **Owner approval pending.** Model E itself needs owner question Q114 (section 8). Until it is
  answered, only the slices that need no new decision proceed.

## 1. Diagnosis

OSCILLA is one instrument wearing thirteen name tags.

- **The six lab workspaces are crops of one surface.** Playground, Analyzátor, Filtry,
  Porovnání, Syntéza and Sekvencer show one shared grid of panels around one generator. Seven
  mechanisms decide which panel shows *(critique: the keys dock's per-view rule,
  `midi/routes.js:41-59`, is the seventh)*, and the registry that names the workspaces owns
  none of them.
- **Three documents can sound.** Synth and Studio are two projections of one StudioModel
  document. The generator and the labs play a second voice path. The Pattern Sequencer runs a
  third model with its own undo and transport.
- **The output is already unified.** Every player reaches one master chain (master → limiter
  → trim → ceiling → analyser, `audio-engine.js:318-323`; Studio via
  `studio/adapters/output.js:15-19`). What sounds is already derived (`soundingOwner`,
  `core/output-bus.js:217-252`).
- **The interface does not use that.** "See what I hear" still needs a workspace switch.
- **Chrome takes most of the screen.** Navbar, page header, keys dock and status bar leave the
  Studio and Synth about 40 % of a 1024 px screen. On a phone their first screen shows no
  instrument content at all.

The interface does not lack components. It lacks two things:

- one owner of composition;
- one persistent, honest sense of "the sound I am working on".

## 2. Competing architectures

| | A Workspace (today) | B Task | C Capability | D Free workbench | E Hybrid |
|---|---|---|---|---|---|
| Idea | named pages, sidebar | Create / Explore / Measure / Compare / Perform | a catalog of tools | user-docked panels | persistent instrument context + a few places + observed lens + palette |
| Discoverability | poor: 13 names, features behind tabs and URLs (02) | good | poor: long flat list | poor: empty canvas | good |
| Learnability | medium | good | poor | poor | good |
| Expert efficiency | medium | poor: wizard-like | good | best | good |
| Cognitive load | high: crops look like apps | low | high | high | low |
| Cross-feature integration | poor: links between crops | medium: tasks cross | medium | best | good: lens + context cross every place |
| Mobile | medium | good | poor | fails | good |
| State consistency | mirrors (01 §4) | medium | medium | layouts drift | derived from owners |
| Implementation cost | none | high: panels duplicated per task | medium | very high: a window manager | medium |
| Accessibility | gaps (05) | good | medium | fails: free layout | good |
| Performance | medium | good | medium | poor | good |

These ratings are qualitative judgements on the cited evidence, not measurements.

**Why each alternative falls short:**

- **A** keeps the disease.
- **B** reads well, but every journey crosses tasks: make a sound, look at it, save it. A task
  shell either duplicates panels per task or recreates A's crops.
- **C** exposes the inventory, not a way of working.
- **D** suits a 1536 px expert. It fails phones and accessibility, and it needs a window
  manager the stack forbids.

**Recommendation: E.** It keeps what A does well (stable places, deep links, ADR 0045). It
borrows B's verbs for naming the places. It adds the two things A lacks: the persistent
instrument context and the observed lens.

## 3. Product mental model

"One instrument. One sound at a time. Places to shape it, look at it, measure it and keep it."

### The sound

The sound is derived, never stored. It is `soundingOwner(cmp)`, together with the document
that owner plays:

| Owner | Document |
|---|---|
| Synth / Studio | StudioModel |
| generator | instrument |
| Sequencer | V2 sequence |
| measurement | measurement session |

### The instrument context

One strip at the bottom of the screen replaces the status bar and the keys dock. It holds:

- the subject;
- a Play/Stop that follows a per-place table (section 4.3);
- an observed level;
- the keys, collapsible;
- **Sonda**, the lens button.

### Places

Places are primary navigation. Their list is the owner's choice (Q114). The current records
disagree with one another:

- Q089: the landing is new, at `/oscilla/`.
- Q033/K138: the Generator is its own workspace.
- Q090 (an LLM decision that can be amended): the 8 entries are Landing/Playground, Synth,
  Studio, Analyzer, Measure, Experiments, Learn and About, after the Synthesis, Presets,
  Filter Lab, Compare and Sequencer folds (U069-U074).

Q114 presents the merge as a question; this document does not assume an answer *(critique)*.

### The lens (Sonda)

A sheet over any place. It shows only **observed** views of the digital output after the
ceiling: Průběh, Spektrum, Spektrogram and the level. It is labelled with its subject and its
tap point *(critique)*.

Computed views appear only when the subject is the V1 instrument, labelled as computed from its
settings (ADR 0063 decision 2, `project.no-fake-science`). The computed views are:

- harmonics, the theoretical partials;
- the signal path of the V1 voice;
- the filter response;
- the phase/stereo model.

Phase/stereo over a stereo Studio output would need a counted ChannelSplitter and two
analysers (rule `audio-engine-discipline`). It is deferred.

### The command palette

The existing shell search extended over the catalog (ADR 0081), templates, presets, stored
records and Learn topics. It is not a second index *(critique)*.

## 4. The smallest viable composition architecture

Each element below names the problem it solves and its single consumer.

### 4.1 Membership declaration (narrowed, critique)

**Problem.** Membership is decided by seven mechanisms. The Measure view's markup says
`measure` but it also shows on the Playground (`index.html:971-972`). The census note
contradicts the CSS.

**Change.**

- The registry row owns membership, order, the phone primary and the default open state.
- `data-osc-modes` is generated from it, or checked equal to it.
- `markWorkspacePanels` stays the one imperative applier. It runs before first paint, whereas a
  per-panel Alpine binding would flash in.
- **CSS keeps the geometry.** Grid spans, `display: contents` flattening and Studio's
  template stay in CSS. Only the roughly 20 visibility selectors are deleted (inventory in
  the critique), and `ui-flowbite-pro-baseline.json` is lowered in the same commit.
- State-gated links stay state-gated (`:hidden="… && !seqPlaying"`).

**Not built.** A pure `composition(place, viewport)` that also carries geometry. That would be
a layout engine.

**Test oracle.** A DOM geometry census records, for every panel and in-panel link, its
computed `display` and rect per place × viewport × engine on `main`. That census is the
fail-first baseline. A pixel diff of live canvases never reaches zero.

### 4.2 Route aliases

**Problem.** Q089 and ADR 0045 require every inventoried deep link to keep opening.

**Change.** A data table maps an old id to a place and a focus:

- every workspace id;
- the V1 mode ids `sweep`, `dual`, `presets` and `learn` (`navigation.js:104-114`);
- the record keys.

Its one consumer is `routeOfHash`. The aliases follow the fold decisions: Filtry → the Synth
and Studio filter (Q090 D4, U071), Bioacoustics → Learn (D5). The V1 URL codec stays frozen
(ADR 0014).

**Test.** The deep-link inventory (`tests/browser/ui-flowbite-pro.cjs`, `link-integrity.cjs`)
passes unchanged.

### 4.3 Instrument context (revised, critique)

**State.**

- The subject is a getter over `soundingOwner`.
- Play/Stop follows **one per-place play-target table**. It replaces both `SPACE_OWNER`
  (`ui/shortcuts.js:37-51`) and `STATUS_PLAY_WORKSPACES` (`core/play-hints.js:15`), and
  settles C032: Studio → its transport; Synth → arm-and-play; Measure → its primary action;
  Sequencer → the sequence. Today Space plays the tone in the Sequencer (05 §12). Experiments
  and About hide Play.

**The level is new code.** A read of the existing analyser, labelled "relativní dBFS,
pozorováno" (ADR 0063). No glow unless it reflects that read (visual-identity-lock v4:
`data-led`, `data-source`).

**Persistence across places is an owner decision.** `LEAVE_POLICY` (`output-bus.js:104-151`)
today disarms an armed Synth, releases held notes, and stops a measurement when you leave its
place. That kills the "persistent sound" on exactly the Synth → analysis journey. Q114 asks
whether the sound survives a place change; C053 is revised accordingly.

### 4.4 Lens sheet (first user-visible slice)

**Problem.** Analysing the output needs a workspace switch.

**Change.** The existing analysis charts are reparented, or reused without a second analyser
read. The sheet's subject comes from `soundingOwner`, and its views are observed only.

**Test.** With the Synth playing a note, the engine analyser's peak bin sits at the note's
fundamental and the label names Synth. Idle shows "Nic nehraje". Escape closes the sheet
without stopping audio. Three engines, at 1536 and 390.

**Slice.** `feat/observed-lens-sheet`.

### 4.5 Command palette

**Problem.** These features are reachable only through a tab, a dialog or a URL (02 §Hard to
discover):

- all of MIDI;
- riffs;
- seven templates;
- the debug and loopback contexts;
- every analysis, mic, phase, bio, measure and presets tab.

**Change.** Extend `navSearch` (`shell.js:310-320`) over the catalog and the data registries,
with Czech entries.

**Test.** Every entry, executed, reaches its target (link-walk). Every catalog component,
template, preset and Learn topic has exactly one entry.

### 4.6 What is deliberately not built

- a capability registry beside the catalog (ADR 0081 already is one);
- a layout engine;
- user docking;
- a context-resolution engine (`soundingOwner` already is the context);
- any new store.

**Engine unification stays out of scope.** The output bus and master chain already unify the
output, so the UI does not wait for it. The Sequencer fold waits for M065 (Q090 D7).

## 5. Visual system

The visual identity rule (`project.visual-identity-lock` v4) stays binding:

- Flowbite Pro around OSCILLA's own domain views;
- the restrained hardware layer drawn only by the synth-theme tokens;
- glow only on an LED that shows real state.

Additions:

- **Chrome budget.** The navbar and page header merge into one 56 px bar; the title lives
  only in the shared bar (Q110). The status bar and dock merge into the instrument strip,
  56 px collapsed. At 1536×1024 a place's own content gets at least 75 % of the height with
  the keys collapsed and at least 55 % with them open. At 390×844 the first screen shows the
  primary surface for at least 50 % of the height. A browser test measures this.
- **Hierarchy.** One h1 per place (05 requirement 1). Panels are cards with an h2. A domain
  view is the largest element of its place.
- **State representation.** Selected, armed, sounding and refused are shown by shape as well
  as colour (forced colours, 05 §6). Contrast is at least 4.5:1 for every state token in both
  themes.
- **Signal types** keep `PORT_VISUALS` (shape, never colour alone).
- **Language.** Czech labels. "Gate", "Gain" and "Velocity" get one Czech term each in
  `docs/GLOSSARY.md` (04 §10).

## 6. Desktop and phone composition

| Region | 1536+ | 1024-1535 | 768-1023 | Phone |
|---|---|---|---|---|
| Places nav | slim rail, labels, no groups | rail, icons + labels | rail, icons | bottom bar: 4 places + Více |
| Title bar | one bar: place, breadcrumb, search/palette, actions | same | same | place + palette + menu |
| Place content | ≥ 75 % of height | ≥ 70 % | ≥ 65 % | primary surface first, the rest in sheets |
| Instrument strip | persistent, keys collapsible | same | same | persistent; keys follow Q114 (Q019 says docked) |
| Lens | right side sheet | right sheet | bottom sheet | bottom sheet ≤ 60 % |
| Inspector (Studio) | column | column | sheet on selection | sheet on selection |

Phone composition per place:

- **Studio.** The graph is full-bleed with a one-row toolbar (Play, Přidat, Přizpůsobit,
  Další). The remaining 13 tools sit behind Další.
- **Synth.** The section chips are sticky, knobs sit two per row, and the patch bay is a
  sheet. The notice, preset row and tabs collapse into one row.

## 7. Migration strategy

Order matters. Every slice is small and fail-first, and lands by merge commit.

1. **R-fix (now, no decision needed).**
   - Escape closing a menu stops audio (04 §2).
   - Escape in an Inspector field stops the transport (04 §3).
   - The Synth tablist ARIA (05 §4).
2. **R-lens (now).** The observed lens sheet (4.4).
3. **R-play (after R-fix-1).** The per-place play-target table (4.3). This also fixes the
   Sequencer's Space.
4. **R-census (now).** The DOM geometry census baseline (4.1 oracle).
5. **R-records (now).** Stamp what has landed but is not recorded: F002 (#386, #601) and U077.
   Record the evidence of Q090 and Q110.
6. **R1′ (after F002 is stamped and R-census exists).** The registry owns membership.
7. **R-palette.** The command palette (4.5).
8. **After the Q114 answer:**
   - R-chrome: merged title bar plus the instrument strip, under the chrome-budget test;
   - R-places: places, aliases and the phone bottom bar, under ADR 0089;
   - R-folds: U069-U074 as membership moves, each under Q090's no-loss check;
   - R-retire: groups, the dual `mode` *gating* (not the frozen codec), the duplicate export
     menu, the stale `docs/ui-audit.md`.

Nothing is retired before its replacement is live, reachable and sounding in three engines
(Q090).

## 8. Owner question Q114

1. **Model.** Adopt E: places + instrument strip + observed lens + palette.
2. **Places.** Choose one:
   - Landing, Playground and Generator stay three things (Q089, Q033);
   - the Generator is the Playground;
   - the landing replaces the Playground's first screen.
3. **Sound across places.** Should an armed Synth, held notes and a running sequence survive a
   place change (C053, `LEAVE_POLICY`)?
4. **Phone keys.** Keep them docked (Q019), or make them a sheet opened from the strip?
5. **Letter keys.** Keep "armed everywhere" (Q105), or arm them only in Synth, Studio and
   Playground with one global switch (WCAG 2.1.4, 05 §5)?
6. **Shell.** Amend ADR 0061 decision 1 (navbar, sidebar, footer): merged title bar, slim rail
   without groups, phone bottom bar, footer → instrument strip. This would be ADR 0089.

A separate recorded LLM decision amends Q090's alias consequences: Filtry → Synth/Studio
filter, Bioacoustics → Learn, Experiments and the library, About's place.
