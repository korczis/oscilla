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

This repository overrides one template, `agents`; `claude-code` and `gemini` are rendered
from the templates the installed Majordomus ships.

- `agents.tmpl` is the `agents` template shipped with Majordomus 1.0.0-alpha.9 plus one
  paragraph, after the one naming the default profile, that names the rules binding how a
  change reaches `main` (`project.ci-bounded`, `project.fail-first`,
  `project.review-verdict`, `project.definition-of-done`). Why: E030 (M083) requires
  `AGENTS.md` to name them, as the hand-written guide in `CLAUDE.md` does, and `AGENTS.md`
  is generated whole, so the paragraph can only come from a template. It names the rules
  and points to `.ai/repo/rules/project/`; their text stays there. It can go when the
  shipped `agents` template renders a repository's process rules (or a paragraph the policy
  declares) by itself, or when the owner decides `AGENTS.md` names no project rule. After
  any change to it, `majordomus update` regenerates `AGENTS.md`.

Until 2026-10-06 the repository overrode `agents`, `claude-code` and `gemini` to correct a
worktree paragraph that promised a pre-commit guard and a rule this repository did not have;
since majordomus #783 the shipped templates promise only what an adopter has, so those
overrides were deleted.

An override is a copy of a shipped template with a deliberate change. When one is added,
record here which template it overrides, why, and the condition under which it can go, and
compare it with the installed template on every Majordomus upgrade: a change to a shipped
template does not reach an override.
