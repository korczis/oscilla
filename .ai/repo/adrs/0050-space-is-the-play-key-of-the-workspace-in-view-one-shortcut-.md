---
schema: adr/v1
id: adr-0050
kind: adr
title: Space is the Play key of the workspace in view; one shortcut dialog
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
  - file:src/index.html
  - file:docs/v31/user-guide.md
  - test:tests/unit/v4-shortcuts.test.mjs
  - test:tests/unit/v31-studio-docs.test.mjs
provenance:
  origin: extracted
  derived_from:
    - file:docs/v4/completion-ledger.md
    - file:src/js/ui/shortcuts.js
---

# 50. Space is the Play key of the workspace in view; one shortcut dialog

## Context

The v4 completion audit (ledger P2 item W5) found that Space had two meanings and that two
dialogs listed shortcuts.

- **Two meanings of Space.** The instrument's window listener (`main.js` → V1
  `onKeyDown`) answered Space in every workspace with Hold to Play. Studio's listener
  (`ui/studio/workspace.js`) runs first and takes Space for its transport, a toggle, but only
  in Studio. So Space was the instrument's everywhere else. That includes the five workspaces
  that do not show the instrument at all: Measure, Experiments, Learn, Presets and About. A
  probe of the built page on main (Chromium, focus on the page) started the Playground tone
  in all eleven workspaces other than Studio, five of them showing no instrument. In Measure, a key that is never
  shown as a Measure control started a tone at the instrument's level, in a workspace whose
  own sound is a measurement stimulus that starts only from an explicit button.
- **Two dialogs.** Help (**?**) and the menu's "Keyboard shortcuts" opened `osc-dlg-help`, a
  static list of the instrument's keys, from every workspace. That included Studio, where
  it described a Space that Studio does not have. Studio's keyboard button opened a second
  dialog, `osc-dlg-studio-keys`, rendered from `STUDIO_SHORTCUTS`. Neither said which
  workspace it described.

The focus rule was already sound and is kept. A focused text field, button, link, slider,
tab or listbox, or an open modal, keeps Space. For the instrument that is V1's `keyGuard` in
`ui/dialogs.js`. For Studio it is its `isEditingTarget` and control check, and for the
timeline it is its `kindOf`.

## Decision

Proposed:

- **Space is the keyboard for the Play control of the workspace in view, and nothing else.**
  `src/js/ui/shortcuts.js` `SPACE_OWNER` names one owner for each workspace in
  `app.js WORKSPACES`:
  - `instrument`: Playground, Analyzer, Filter Lab, Compare, Synthesis and Sequencer. These
    are the workspaces whose panels are the instrument or act on its signal. Space is Hold to
    Play, exactly as in V1: held, it sounds; released, it stops; a programmed pattern triggers
    once.
  - `studio`: Studio. Space plays or stops the Studio transport, as its Play button does.
  - none: Measure, Experiments, Learn, Presets and About. Space starts nothing there and the
    browser keeps the key (page scroll).

  The verb is the same everywhere: press the Play control you can see. The gesture is that
  control's own, so Hold to Play holds and Studio's Play toggles.
- **The instrument asks before it answers.** `main.js` returns before the V1 `onKeyDown` when
  the key is Space and `instrumentTakesSpace(workspace)` is false. Escape still reaches it from
  every workspace (Stop is global), and the release (`onKeyUp`) is never gated, so a held
  tone always stops. The V1 `onKeyDown` and `keyGuard` are unchanged. Their golden vectors
  (ADR 0014) still hold.
- **The compact Studio panel is Studio.** In the Playground and the Sequencer, Space with
  focus inside that panel (not on one of its controls) plays or stops the Studio transport,
  as before. The dialog lists this as a key of those two workspaces.
- **One shortcut dialog.** `osc-dlg-help` is the only dialog that lists keys. Help, the
  menu's "Keyboard shortcuts" and Studio's keyboard button all open it. `shortcutHelp(workspace)`
  renders it in this order:
  1. The name of the workspace in view.
  2. Its Space meaning.
  3. Its own keys. The instrument's are Enter on Hold / Trigger and PgUp / PgDn on the
     frequency slider; the Sequencer adds its timeline keys; Studio lists `STUDIO_SHORTCUTS`
     in order, with the timeline's `KEY_HELP`; Measure lists Esc, which aborts a measurement.
  4. The keys that work everywhere: Esc, arrows on tabs and segments, and Tab.

  `osc-dlg-studio-keys` and the `studio.shortcuts` state are removed. `STUDIO_SHORTCUTS`
  stays Studio's one canonical table, and its Space row's text equals `SPACE_MEANING.studio`.
- **The user guide states it.** `docs/v31/user-guide.md` holds a Space table (region
  `space`) generated from the same code. `tests/unit/v31-studio-docs.test.mjs` requires it to
  equal `SPACE_OWNER` and `SPACE_MEANING`, next to the Studio table it already checks.

## Alternatives rejected

- **Space toggles everywhere (the Studio model).** That would change V1's frozen Hold to Play
  (ADR 0014) and its safety model, in which a tone sounds only while it is held unless
  continuous playback is allowed. The status bar's Play already offers a latched tone where
  the settings allow it.
- **Space holds in Studio too.** A timeline transport that stops when the key is released
  cannot play a section hands-free. That breaks the convention every sequencer and DAW
  follows, and Studio's Play button is a toggle.
- **Space plays the instrument from every workspace, since the status bar's Play is
  visible everywhere.** The status bar's Play is a pointer or Enter target that says what it
  plays. A key that starts a tone the workspace does not show surprises, most of all in Measure
  and Experiments.
- **Decide by what is visible in the DOM (the source panel's layout).** That layout differs by
  width (phone, tablet, desktop), so the same key would mean different things on different
  screens. A table keyed by workspace is the same at every width and can be tested.
- **Keep two dialogs and cross-link them.** The user still has to know which one applies. One
  dialog that names the workspace in view answers that question.

## Consequences

- In Measure, Experiments, Learn, Presets and About, Space no longer starts the hidden tone.
  A user who relied on it there plays from the Playground workspaces or the status bar's Play.
- Each new workspace must be given a Space owner in `SPACE_OWNER`.
  `tests/unit/v4-shortcuts.test.mjs` fails while its keys differ from `WORKSPACES`.
- Confirmation criteria:
  - `tests/unit/v4-shortcuts.test.mjs` covers:
    - one owner per workspace;
    - the instrument gate;
    - the dialog content for each workspace, with Studio's table in order;
    - the markup: one shortcut dialog, opened by Help, the menu and Studio.
  - `tests/browser/navigation.cjs` `space-one-meaning` presses Space with nothing focused in
    each of the twelve workspaces. It requires the expected owner and nothing else to start,
    and requires a focused link in Studio to keep Space. `one-shortcut-dialog` requires the
    three entry points to open the same dialog, naming the workspace and its Space meaning.
    Both run in Chromium, Firefox and WebKit, from `file://` and `/oscilla/`.

  Both browser checks fail on the build before this change.
- Revisit this decision if a workspace without a transport gains one, such as a Measure
  keyboard start. Its owner would then change in `SPACE_OWNER`, with its own row in the
  dialog.
