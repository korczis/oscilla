---
schema: context/v1
id: ai.repo.providers
kind: context
title: Provider template overrides
description: Where this repository's provider templates come from, and how to override one.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Provider template overrides

`majordomus update` renders `AGENTS.md`, `CLAUDE.md` (its generated region) and `GEMINI.md`
from a provider template. It takes `<provider>.tmpl` from this directory when one exists and
the template shipped with the installed Majordomus otherwise; the policy and the hashes are
the same either way.

This repository currently overrides no template: every bootstrap is rendered from the
templates the installed Majordomus ships. Until 2026-10-06 it overrode `agents`,
`claude-code` and `gemini` to correct a worktree paragraph that promised a pre-commit guard
and a rule this repository did not have; Majordomus 0.13.2 ships templates that promise only
what an adopter has (majordomus #783), so the overrides were deleted.

An override is a copy of a shipped template with a deliberate change. When one is added,
record here which template it overrides, why, and the condition under which it can go, and
compare it with the installed template on every Majordomus upgrade: a change to a shipped
template does not reach an override.
