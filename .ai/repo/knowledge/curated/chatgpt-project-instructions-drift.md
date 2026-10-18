---
schema: knowledge/v1
id: chatgpt-project-instructions-drift
kind: knowledge
class: fact
title: "The ChatGPT project's instructions describe an Elixir/Phoenix agent platform and contradict OSCILLA's stack, scope and authority order; only their OSCILLA-specific core is binding, through the project rules"
description: "Which parts of the instructions the ChatGPT project \"Oscilla\" runs under are true of this repository and which contradict it; read before trusting advice produced under them."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - process
  - drift
provenance:
  origin: authored
  derived_from:
    - file:.ai/README.md
    - file:.ai/repo/rules/project/single-file-deliverable.v2.md
    - file:.ai/repo/rules/project/visual-identity-lock.v1.md
    - file:.ai/repo/adrs/0051-v4-0-ships-method-claims-on-experiment-evidence-not-a-knowle.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
---

# The ChatGPT project instructions drifted from the repository

On 2026-10-02 the owner asked ChatGPT to write the project's instructions (`6abf2906`,
03:46:20Z); its answer (03:46:27Z) became the project source `01-PROJECT_INSTRUCTIONS.md`, which
later conversations read (`6abf3077` 04:18:36Z; `6acbd3dc` 2026-10-11T18:23:03Z). A
`PROJECT_INSTRUCTIONS.md` was never tracked in git. Every later ChatGPT answer in the project was
written under those instructions.

## Where they contradict the repository

| instruction (section) | the repository |
| --- | --- |
| A "senior Elixir/Phoenix/LiveView engineer" role (§1); Phoenix/LiveView defaults, the JS-as-exception policy, OTP discipline, database migrations, `mix.exs` audits (§14, §15, §18, §37, §58) | a browser application in ES modules built into one static `dist/index.html` with no server (`project.single-file-deliverable`, ADR 0011, ADR 0012) |
| One instrument across Studio, Sequencer, Signal Path **and ADRs, knowledge base, Agents, Models, Pipelines, Majordomus UI** (§2); a universal composition engine shared by ADRs, knowledge, agents and investigations (§8, §31, §55) | the product shows no ADRs, rules or knowledge to users and ships no knowledge explorer (ADR 0051); measurement topology lives inside Studio only (ADR 0038) |
| Agents with capabilities, typed LLM boundaries, model and tool execution security (§12, §13, §38) | OSCILLA runs no model or agent; development agents are governed by `AGENTS.md` and the profiles |
| Truth order: repository, tests, runtime, docs, ADRs, then explicit user instruction, plans, assumptions (§21) | Git is the authority, then the manifest, rules, policy and the rest (`.ai/README.md`, "Precedence"); owner-only actions are the owner's, and the instructions' rank for a user instruction below the ADRs is not this repository's |

## What is binding, and where

The OSCILLA-specific core of the instructions is binding today, as project rules, not because
the instructions say it: no generic SaaS UI and no imitation of other products
(`project.visual-identity-lock`); embedded and full Studio as one object
(`project.studio-model-is-canonical`); typed connections and rejected feedback
(`project.typed-ports`, `project.no-silent-feedback`). Other parts are partly carried (explicit
domain models and versioned formats by ADRs 0023, 0024 and 0043) or not at all ("no circular
dependencies", §19: the source has one cycle, issue E006).

Rewriting the instructions to match the repository (drop Phoenix, OTP and agents, point to
`.ai/repo/rules/project/`) is an act in the owner's ChatGPT account, outside this repository
(issue Q006).
