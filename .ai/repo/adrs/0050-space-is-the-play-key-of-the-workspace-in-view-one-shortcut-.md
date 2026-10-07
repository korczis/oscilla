---
schema: adr/v1
id: adr-0050
kind: adr
title: Space has one owner in each workspace; one shortcut dialog
status: proposed
date: 2026-10-07
tags:
  - keyboard
  - accessibility
  - safety
  - workspace
related:
  - file:.ai/repo/adrs/0014-v1-behaviour-frozen-by-golden-vectors.md
  - file:.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md
  - rule:project.audio-engine-discipline
  - rule:project.single-file-deliverable
  - file:src/js/ui/shortcuts.js
  - file:src/js/ui/app.js
  - file:src/js/main.js
  - file:src/js/ui/dialogs.js
  - file:src/js/ui/studio/graph-keys.js
  - file:src/js/ui/studio/workspace.js
  - file:src/js/ui/workbench.js
  - file:src/index.html
  - file:docs/v31/user-guide.md
  - test:tests/unit/v4-shortcuts.test.mjs
  - test:tests/unit/v31-studio-docs.test.mjs
  - test:tests/browser/navigation.cjs
provenance:
  origin: extracted
  derived_from:
    - file:docs/v4/completion-ledger.md
    - file:src/js/ui/shortcuts.js
---

# 50. Space has one owner in each workspace; one shortcut dialog

## Context

The v4 completion audit (ledger P2 item W5) found that Space had two meanings and that two
dialogs listed shortcuts.

- **Two meanings of Space.** The instrument's window listener (`main.js` → V1
  `onKeyDown`) answered Space in every workspace with Hold to Play. Studio's listener
  (`ui/studio/workspace.js`) runs first and takes Space for its transport, a toggle, but only
  in Studio. So Space was the instrument's everywhere else. A probe of the built page on main
  (Chromium, focus on the page) started the instrument's tone in all eleven workspaces other
  than Studio. In Measure, a key that is never shown as a Measure control started a tone at
  the instrument's level, in a workspace whose own sound is a measurement stimulus that
  starts only from an explicit button.
- **Two dialogs.** Help (**?**) and the menu's "Keyboard shortcuts" opened `osc-dlg-help`, a
  static list of the instrument's keys, from every workspace. That included Studio, where
  it described a Space that Studio does not have. Studio's keyboard button opened a second
  dialog, `osc-dlg-studio-keys`, rendered from `STUDIO_SHORTCUTS`. Neither said which
  workspace it described.

The focus rule was already sound and is kept. A focused text field, native button, link,
slider, tab or listbox, or an open modal, keeps Space. For the instrument that is V1's
`keyGuard` in `ui/dialogs.js`. For Studio it is its `isEditingTarget` and control check, and
for the timeline it is its `kindOf`.

What is on screen does not decide the owner, and could not. A probe of the built page
(Chromium, 2026-10-07) found the instrument's Hold and Trigger and its frequency slider:

| Width | Hold, Trigger and the slider are shown in | The status bar's Play is shown in |
| --- | --- | --- |
| 1536 px | Playground, Synthesis, Sequencer | no workspace |
| 375 px | Playground, Analyzer, Filter Lab, Compare, Synthesis, Sequencer | every workspace |

So at desktop width Analyzer, Filter Lab, Compare and Presets show no Play control of the
instrument, and the status bar's Play exists only in the narrow layout
(`.osc-sb-play` is `display: none` outside a `responsive.css` media query).

## Decision

Proposed:

- **Space has one owner in each workspace, the same at every width.**
  `src/js/ui/shortcuts.js` `SPACE_OWNER` names it for each workspace in `app.js WORKSPACES`:
  - `instrument`: Playground, Analyzer, Filter Lab, Compare, Synthesis, Sequencer and
    Presets. These are the workspaces that play, load or analyse the instrument's signal.
    Space is Hold to Play, exactly as in V1: held, it sounds; released, it stops; a programmed
    pattern triggers once. It is so whether or not Hold or Trigger is on screen there.
  - `studio`: Studio. Space plays or stops the Studio transport, as its Play button does.
  - none: Measure, Experiments, Learn and About. None of them plays, loads or analyses the
    instrument. Space starts nothing there and the browser keeps the key (page scroll).

  The gesture is the owner's own, so Hold to Play holds and Studio's Play toggles.
- **Presets is the instrument's.** Load readies the instrument, stays in Presets, and the V1
  notice (frozen by the golden vectors, ADR 0014) says "Press TRIGGER (or Space) to play
  it." Neither Trigger nor Hold is shown in Presets, so Space is the only thing the notice
  names that works there. Learn is not: its demo moves to the Playground or Synthesis and
  focuses Hold.
- **The instrument asks before it answers.** `main.js` returns before the V1 `onKeyDown` when
  the key is Space and `instrumentTakesSpace(workspace)` is false. Escape still reaches it from
  every workspace (Stop is global), and the release (`onKeyUp`) is never gated, so a held
  tone always stops. The V1 `onKeyDown` and `keyGuard` are unchanged. Their golden vectors
  (ADR 0014) still hold.
- **The compact Studio panel has no Space of its own.** In the Playground and the Sequencer
  every focus target in that panel is a button (play, stop, loop, expand, node chips, clips),
  and a focused button keeps Space. A click on the panel's title, body or counts focuses
  nothing in it, and Space is then the workspace's, the instrument's. The panel's Play button
  is its control. The dialog lists no Space for the panel.
- **A focused Studio timeline item is not a control that keeps Space.** Clips, markers,
  points and loop handles carry `role="button"`, their activation is Enter, and Space plays
  or stops Studio there, as the timeline's `KEY_HELP` says. This is unchanged; the dialog and
  the user guide say it instead of promising that every button keeps Space.
- **One shortcut dialog.** `osc-dlg-help` is the only dialog that lists keys. Help, the
  menu's "Keyboard shortcuts" and Studio's keyboard button all open it. `shortcutHelp(workspace)`
  renders it in this order:
  1. The name of the workspace in view.
  2. Its Space meaning.
  3. Its own keys. The instrument's are Enter on Hold or Trigger and PgUp / PgDn on the
     frequency slider, each marked "where shown"; the Sequencer adds its timeline keys;
     Studio lists `STUDIO_SHORTCUTS` in order, its note on keyboard paths ("Every drag has a
     keyboard path ...") and the timeline's `KEY_HELP`; Measure's Esc row states the global
     stop and the abort of a running measurement.
  4. The keys that work everywhere: Esc, arrows on tabs and segments, and Tab, less any the
     workspace's own rows already state. Studio's table has Esc and Tab and Measure's row is
     Esc, so no key is listed twice in one view.

  A row is `keys`, shown in a `kbd`, and optionally `where`, shown beside it.
  `osc-dlg-studio-keys` and the `studio.shortcuts` state are removed. `STUDIO_SHORTCUTS`
  stays Studio's one canonical table, and its Space row's text equals `SPACE_MEANING.studio`.
- **The user guide states it.** `docs/v31/user-guide.md` holds a Space table (region
  `space`) generated from the same code. `tests/unit/v31-studio-docs.test.mjs` requires it to
  equal `SPACE_OWNER` and `SPACE_MEANING`, next to the Studio table it already checks.

## Alternatives rejected

- **"Space is the Play control of the workspace in view."** This was the first wording of
  this decision and it was false: at desktop width Analyzer, Filter Lab, Compare and Presets
  show no Play control, and Space plays there. The owner is stated by what the workspace does
  with the instrument's signal, not by a control.
- **Space toggles everywhere (the Studio model).** That would change V1's frozen Hold to Play
  (ADR 0014) and its safety model, in which a tone sounds only while it is held unless
  continuous playback is allowed.
- **Space holds in Studio too.** A timeline transport that stops when the key is released
  cannot play a section hands-free. That breaks the convention every sequencer and DAW
  follows, and Studio's Play button is a toggle.
- **Space plays the instrument from every workspace.** A key that starts a tone in a
  workspace that neither plays nor loads the instrument surprises, most of all in Measure and
  Experiments.
- **Presets without Space, with another notice or a move to the Playground after Load.** The
  notice is V1's and frozen; replacing it in the wrapper leaves two texts for one action, and
  leaving Presets after every Load ends browsing the list. V1 played a loaded preset by Space
  from Presets, and this keeps it.
- **Make Space in the compact Studio panel the Studio transport's (by the last pointer
  target).** Then the same key with the same focus would start one of two sound sources
  depending on where the pointer last was, which is the ambiguity W5 names.
- **Decide by what is visible in the DOM (the source panel's layout).** That layout differs by
  width (see the table above), so the same key would mean different things on different
  screens. A table keyed by workspace is the same at every width and can be tested.
- **Keep two dialogs and cross-link them.** The user still has to know which one applies. One
  dialog that names the workspace in view answers that question.

## Consequences

- In Measure, Experiments, Learn and About, Space no longer starts the instrument. A user who
  relied on it there plays from one of the seven instrument workspaces. In the narrow layout
  the status bar's Play is also there, by pointer or Enter; at desktop width it is not shown.
- In Analyzer, Filter Lab, Compare and Presets at desktop width Space plays an instrument
  whose Play control is not on screen. That is deliberate and stated in the dialog.
- With the one dialog open from Studio, Escape closes it and also reaches the global Escape
  handler (stop the sequencer, abort a measurement, stop the instrument), as Help already
  did. The Studio-only dialog used to swallow it. The Studio transport is not stopped by it.
- Each new workspace must be given a Space owner in `SPACE_OWNER`.
  `tests/unit/v4-shortcuts.test.mjs` fails while its keys differ from `WORKSPACES`.
- Confirmation criteria:
  - `tests/unit/v4-shortcuts.test.mjs` covers:
    - one owner per workspace, Presets with the instrument;
    - the instrument gate;
    - the dialog content for each workspace, with Studio's table in order and its note;
    - no key twice in one view, keys apart from where they apply, no compact-panel row;
    - the markup: one shortcut dialog, opened by Help, the menu and Studio;
    - the wording: the rule as first stated (see the first rejected alternative) is in no
      copy.
  - `tests/browser/navigation.cjs`, in Chromium, Firefox and WebKit, from `file://` and
    `/oscilla/`:
    - `space-one-meaning` presses Space with nothing focused in each of the twelve
      workspaces. It requires the expected owner and nothing else to start, reads "nothing"
      from the keydown itself (not claimed, nothing sounding), and requires a focused link in
      Studio to keep Space.
    - `space-after-preset-load`: Load in Presets, then Space with focus off a control plays.
    - `space-compact-studio-panel`: only buttons take focus in the panel, and after a click
      on its title Space starts the instrument, not Studio.
    - `one-shortcut-dialog` requires the three entry points to open the same dialog, naming
      the workspace and its Space meaning, each key once, with Studio's note.
- Revisit this decision if a workspace without an owner gains a transport, such as a Measure
  keyboard start, or if the timeline's items stop carrying `role="button"`.
