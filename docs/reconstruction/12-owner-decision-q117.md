# 12. Owner decision Q117: the Synth panel is part of the default project

- **Asked:** 2026-11-25, shortly before 09:40Z, in Claude Code session
  40c3f589-de0d-4e90-ba18-aee761b5273a (coordinator oscilla-60), through AskUserQuestion.
- **Why it was asked:** U140 (PR #661) stops a key from inserting the Synth panel into the
  Studio document. One implicit edit was left, and the builder stopped there without deciding.
  The first visit to the Synth inserts the panel by itself (`synth/ui.js`, `$watch('workspace')`
  calls `ensurePanel()`). The panel then takes Master Output's only input, so the Studio's Play
  goes silent, and the document is not marked as changed.
  - Every way of removing that insert touches an earlier owner answer. Q105 says letters play
    in every workspace without pressing Arm, and Q114 (4) says letter keys play in the
    instrument places.
  - The single-store rule (`v4-one-studio-store`) forbids a separate performance voice outside
    the document.

## The question, verbatim

> U140 (#661): a key no longer edits the Studio document. One thing still does: opening the
> Synth for the first time quietly inserts the Synth panel into the Studio project. That
> silences the project's own sound when you then press Studio Play, and leaves the project
> unmarked as changed. How should the Synth behave instead?

The options, verbatim:

1. **Panel in default project (Recommended):** "A new project already contains the Synth panel,
   mixed beside the template's own sound. Opening the Synth changes nothing and the keys play at
   once. An older saved project without the panel offers 'Vložit' (insert) on first use."
2. **Insert first, then play:** "The Synth opens with 'Tento dokument Studia nemá panel Synthu.
   [Vložit]' and plays only after you insert the panel. Clean, but the Synth keys no longer work
   immediately, against Q105."
3. **Visit inserts, undoable:** "Keep the automatic insert on the first visit, but mark the
   project as changed and offer its own Undo. The project is still edited by a mere visit."
4. **Insert adds a mixer:** "The automatic insert also adds a mixer, so the Synth panel and the
   project's own chain both sound. The visit still edits the project, just without silencing
   it."

## The answer, verbatim

> "Panel in default project (Recommended)"

## What follows

U148 implements it:
- the default (reference) Studio document holds the Synth panel, mixed beside the template's
  own chain, so the Studio's Play sounds both;
- a visit to the Synth never inserts anything;
- a document without the panel offers Vložit on first use, and the explicit Vložit stays the
  only insert (one undo step, document marked unsaved);
- U140's own change (a key never inserts) lands as #661 independently.
