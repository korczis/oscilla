---
schema: knowledge/v1
id: deferred-ideas-from-the-chatgpt-project
kind: knowledge
class: fact
title: "Ideas from the ChatGPT conversations that are deferred or that ChatGPT advised against, recorded nowhere else: executable experiment steps and parameter sweeps, an experiment DSL, hardware and sensor domains (deferred); a generic ELN/LIMS and a rewrite in Elixir (advised against); and a review bar for token reuse"
description: "What ChatGPT proposed or warned against, why it waits, and what would bring it back; none is an owner decision; read before proposing one of them as new."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - scope
  - deferred
provenance:
  origin: authored
  derived_from:
    - file:.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md
    - file:.ai/repo/adrs/0051-v4-0-ships-method-claims-on-experiment-evidence-not-a-knowle.md
    - file:.ai/repo/rules/project/visual-identity-lock.v1.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
---

# Deferred ideas, and what ChatGPT advised against

Each is either a ChatGPT proposal or a ChatGPT warning. None is an owner decision, none was
asked for by the owner in the conversations, and none is planned. Times are UTC.

- **Experiments as executable steps, with variables and parameter sweeps** (setup, calibration,
  sweep, repeat N times, analysis, aggregate, quality gate, report; a crossover swept at
  60/70/80/90 Hz). `6ac1beb8` 2026-10-04T03:12:12Z and 03:25:12Z, and the v4 prompts. Today a
  definition is a recipe with conditions and acceptance (ADR 0043) and the engine measures log
  sweeps only. Deferred: no owner request; it would come back with a measurement job that one
  recipe cannot express.
- **A declarative experiment DSL** (a YAML-like definition as a second view of the GUI model;
  steps sweep, measure, repeat, aggregate, export; never eval), with batch measurement for
  "V3.2". `6abec18d` 2026-10-02T03:15:06Z; `6ac1beb8` 03:12:12Z. Deferred with the steps above.
- **A generic ELN or LIMS** (a workflow engine, approvals, teams, remote result stores).
  ChatGPT advised against it (not an owner decision): definitions are useful because they carry
  measurement semantics (`6ac3ead5`, 2026-10-05T18:32:06Z, §5).
- **Rewriting the JS and Web Audio system in Elixir/Phoenix** to fit a larger vision. ChatGPT
  advised against it (not an owner decision): the product invariant is an offline, single-file,
  local-first browser instrument; a larger system may wrap it, not replace it (`6ac3ead5`,
  §16). The instructions it ran under carried Phoenix/LiveView defaults (`6abf2906`,
  2026-10-02T03:46:27Z, §14; see `chatgpt-project-instructions-drift`); ChatGPT's own stated
  reason was only that a larger vision is no reason to rewrite.
- **What "would swallow the project"**, in ChatGPT's list (`6ac1beb8`, 2026-10-04T03:12:12Z): a
  DAW competitor, an Ableton or Max/MSP clone, a Eurorack simulator, 100 synth modules, a plugin
  marketplace, cloud collaboration, "generative AI everywhere", and a "universal knowledge graph
  engine". Deferred: no owner request.
- **Other physical domains** (vibration, sensor streams, control systems, electronics) and
  **hardware I/O**: ChatGPT's own proposed long-term direction, "a reproducible composition and
  measurement environment for physical systems" (`6ac1beb8`, 03:12:12Z), not part of the list
  above. Its v4 prompt deferred them itself: "Do not build hardware abstractions now" (§121,
  "Future hardware I/O") and "Do not add fake generic support now" (§122) (`6ac1beb8`,
  03:15:23Z). Deferred: no owner request; they would come back with a non-audio measurement
  need.
- **A generic AI chat**: "Do not introduce generic AI chat during this pass" (§56) and "AI chat
  panel" among the bad additions (`6ac1beb8`, 03:15:23Z). Deferred until structured state,
  provenance and diffs exist for it to read.
- **A quantitative review bar for the visual identity lock**: a new surface reuses at least 90 %
  of the existing tokens and components unless a new primitive is technically necessary
  (`6abec18d`, 2026-10-02T03:38:13Z, in the lock text the owner adopted at 03:38:09Z). The rule
  `project.visual-identity-lock` says "prefer extension" with no threshold. Not planned: no
  mechanism decides it as written, and a review-only number would be the kind of enforcement
  `project.rules-name-their-enforcement` forbids claiming.
- **Generated version-compatibility tables** (algorithm, schema, result hash, Studio schema,
  database, migrations) from the registries rather than by hand (`6ac3ead5`, §13). Deferred.
