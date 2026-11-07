---
id: project.czech-prose
version: 1
kind: rule
title: The app, its release notes, its pull requests and its published pages speak Czech
description: Every visible text of the app is Czech prose, and the English the app still shows is a per-file ratchet that only falls; release notes, pull request and issue bodies and the claude.ai pages published for OSCILLA are Czech. Code, identifiers, commit subjects and developer docs stay English.
statement: No file of the app (src/index.html and src/js) shows more English sentences than tests/unit/czech-prose-baseline.json allows it, and a file not listed shows none (scripts/czech-prose.mjs measures; tests/unit/czech-prose.test.mjs refuses a rise and a fall the baseline did not record); new visible text is written in Czech; the GitHub Release notes, the pull request and issue descriptions and the claude.ai Artifacts published for OSCILLA are written in Czech. Code, identifiers, commit subjects (Conventional Commits, which release:analyze parses) and the repository's developer documentation stay English.
status: active
class: blocking
depends_on: []
tags: [language, ui, release, process]
---

# Rationale

The owner's order of 2026-11-07, recorded verbatim with the answer to its clarifying question
in plan issue Q104: "odted ten artifakt musi mit ceskou prozu, vzdy a vsude, musi byt
enforced", and, asked which artifact, "Vsechno uvedene": the app, the claude.ai artifacts, the
release notes and GitHub. The app showed 3 236 English sentences in 263 files when the rule
was adopted; a translation of that size lands file by file, so the rule is a ratchet first:
nothing new in English, and every translated file lowers its count.

# Required behaviour

- New visible text in src/index.html or src/js is Czech; a technical term with no Czech
  equivalent in use (Studio, patch, MIDI, hi-hat) stays as it is inside a Czech sentence.
- A change that translates a file runs `node scripts/czech-prose.mjs --write`, which lowers
  that file's count in tests/unit/czech-prose-baseline.json; the baseline is never raised.
- Pull request and issue bodies, release notes and published claude.ai pages are Czech.
- Commit subjects, code, identifiers, data ids and developer documentation stay English.

# Enforcement

`tests/unit/czech-prose.test.mjs` (in `npm test`, `verify` and the gate): a file whose English
sentences exceed its baseline, a file not in the baseline with any, a translated file whose
baseline was not lowered, and a baseline total that is not the sum of its counts each fail;
mutation cases prove the measure finds an English sentence and passes a Czech one and a short
label. The measure is `scripts/czech-prose.mjs` (three or more words, two English function
words, no Czech letter with a diacritic; the literals come from the one JavaScript lexer,
`scripts/ui-catalog/scan.mjs` lexJs), one home for the test and any later check.

The generated lines of the GitHub Release notes are Czech from the release that carries #473 on
(`scripts/release-publish.mjs` releaseNotes; `tests/unit/release-publish.test.mjs` reads them
through the same measure); the Releases published before stay as they were written, since a
published Release is a record and is not rewritten. Pull request bodies and published pages
are held by review and by the issues that automate them (Q104's follow-ups); until those
land, this rule binds the agents.

# Failure behaviour

The gate refuses the change; the fix is the Czech text, never a raised baseline.
