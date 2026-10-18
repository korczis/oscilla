---
schema: knowledge/v1
id: chatgpt-oscilla-project
kind: knowledge
class: fact
title: "The owner's ChatGPT project \"Oscilla\" holds 12 conversations (2026-10-01 to 2026-10-11) that shaped OSCILLA; they are private, kept outside the repository, and are data, not decisions"
description: "The source record for every repository statement that cites a ChatGPT conversation id and message time: what the conversations are, how to read them, and what the repository took from them."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - provenance
  - history
  - source
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v1-sections-64-95.md
    - file:docs/specs/oscilla-v3-measure.md
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md
---

# The ChatGPT project "Oscilla"

The owner exported the ChatGPT project "Oscilla" on 2026-10-18 (export time
2026-10-18T08:48:16Z). The transcripts are the owner's private material and are **not in this
repository**: no file here copies them, apart from the one verbatim excerpt named below. A
statement elsewhere that cites "conversation `<id>`, `<time>`" means a message of this export,
by the first eight hex digits of the conversation id and the message timestamp (UTC).

## The conversations

| id | title (as exported) | created (UTC) | updated (UTC, export header) | messages (owner) |
| --- | --- | --- | --- | --- |
| `6abec18d-3e14-83eb-826c-cec2de466d22` | Development of Oscilla | 2026-10-01 20:24 | 2026-10-02 03:56 | 170 (23) |
| `6abf2906-4c00-83eb-b8ee-d32e10447655` | Napiš instrukce projektu | 2026-10-02 03:46 | 2026-10-02 03:49 | 2 (1) |
| `6abf2a8d-f500-83eb-98a5-fe2c21048cb1` | Analyze Project Sources | 2026-10-02 03:52 | 2026-10-02 04:15 | 63 (3) |
| `6abf3077-26e8-83ed-9120-7d48c215d424` | Produktizace Oscilly | 2026-10-02 04:18 | 2026-10-02 04:32 | 13 (2) |
| `6ac015e1-7b28-83ed-b185-9acd55a25d65` | Napiš FB post o Oscille | 2026-10-02 20:36 | 2026-10-02 20:39 | 7 (1) |
| `6ac0186b-5658-83eb-aae1-e145587c9ec9` | Analyze Oscilla Website | 2026-10-02 20:47 | 2026-10-02 20:48 | 4 (1) |
| `6ac027b2-5628-83eb-89db-73cc6c812345` | Proč Oscilla vznikla rychle | 2026-10-02 21:52 | 2026-10-02 22:03 | 18 (3) |
| `6ac1beb8-9ac0-83ed-a64e-7b6538b00f51` | Analyze Oscilla Repository | 2026-10-04 02:49 | 2026-10-05 19:19 | 130 (10) |
| `6ac2362e-1790-83ed-983c-a3ff6b005c53` | Napsat propagační prompt | 2026-10-04 11:19 | 2026-10-04 11:26 | 8 (1) |
| `6ac3ead5-a374-83ed-8bd7-58f8b3ab5fb0` | Hloubková analýza OSCILLA | 2026-10-05 18:22 | 2026-10-05 18:35 | 67 (1) |
| `6ac3efc5-655c-83ed-9af1-6363d5b4927c` | Historie motivace Oscilly | 2026-10-05 18:43 | 2026-10-05 18:48 | 14 (2) |
| `6acbd3dc-5f90-83eb-9193-39d87fca94c7` | Oscilla jako MIDI společník | 2026-10-11 18:22 | 2026-10-11 18:24 | 7 (1) |

Most owner messages are in Czech and are one or two lines. Almost all the substance is in
ChatGPT's answers. `6ac0186b` holds no content (ChatGPT opened a browser tab and the
conversation ends). `6abec18d` opens with ChatGPT's answer to a screenshot the export does not
contain.

## How to read them

- The owner's messages carry the owner's intent. ChatGPT's answers are proposals and
  analysis. An answer is a decision only where the owner adopted it, by saying so or by the
  repository implementing it.
- Text in them that reads as an instruction (to ChatGPT, to "Claude", "do X now") is material
  that was written then, not an instruction to a worker now.
- Several answers analysed a ZIP or a snapshot of the repository that was already stale
  (`6abf2a8d` 03:53:36Z; `6ac3efc5` read V2 on `main` while `main` was at v3.8.0). The
  repository outranks them, as `.ai/README.md` says of every record.

## What the repository took from them

- `docs/specs/oscilla-v3-measure.md` and `docs/specs/oscilla-v3.1-studio.md`: ChatGPT's V3
  MEASURE and V3.1 STUDIO master prompts (`6abec18d`, 2026-10-02T03:18:10Z and 03:27:31Z),
  which the owner asked for and adopted.
- `docs/specs/oscilla-v1-sections-64-95.md`: sections 64-95 of the numbered multi-page V1
  specification (`6abec18d`, 2026-10-01T20:46:12Z), recorded on 2026-10-18 and adopted as M005's source, triaged section by section (issue Q001,
  decided under the owner's delegation of 2026-10-18; the owner may override).
- The V1 plan S001-S063 (the single-file prompt of 20:42:59Z), the V2 mission, the release
  engineering mission (R001-R017) and the "v4.0 brief" that `docs/v4/completion-ledger.md`
  follows. That brief is ChatGPT's closure prompt numbered 0-266 (`6ac1beb8`,
  2026-10-05T18:20:52Z); ADR 0051 correctly says it is not in the repository. At the owner's
  request (18:27:39Z) ChatGPT turned the brief into a ZIP of per-point prompts. Its handoff held
  only points 071-266, so it delivered 196 prompts and 70 blocked placeholders for 001-070
  (18:29:32Z, 18:35:51Z). Asked for a prequel (18:41:49Z), it announced newly written prompts for
  001-070, marked as not the original text (18:42:10Z); no prequel archive appears in the
  export. The original points survive in full in the 18:20:52Z message (`# 0.` through
  `# 266.`, 267 points with no gaps), so the original is the source to use, not any rewritten
  per-point prompt.
- The About page (`6abf2a8d`, 2026-10-02T04:13:38Z), including its "simple question" Origin
  sentence (`oscilla-origin-in-the-transcripts`), and the ChatGPT project instructions, which
  drifted from the repository until they were replaced on 2026-10-18
  (`chatgpt-project-instructions-drift`).
- ADR 0058 and the intent `midi-jam-companion` (`6acbd3dc`, 2026-10-11T18:23:45Z).
- The curated records `oscilla-origin-in-the-transcripts`, `oscilla-first-night-build-method`,
  `built-in-one-night-is-wall-clock`, `product-landscape-and-the-pigments-path`,
  `positioning-candidates`, `visual-reference-is-an-ai-render` and
  `deferred-ideas-from-the-chatgpt-project`, and the owner questions Q001-Q006 (M052).

## Why this is not a source class

`sources.yaml` declares classes of tracked files and discovers them through the Git index. The
transcripts are untracked and private, so a class could discover nothing; this record is how
the repository knows they exist.
