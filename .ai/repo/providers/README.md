---
schema: context/v1
id: ai.repo.providers
kind: context
title: Provider template overrides
description: The provider templates this repository overrides, why, and when each override can go.
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

| template | overrides | why |
|---|---|---|
| `agents.tmpl` | the Majordomus 0.12.0 `agents` template | worktree paragraph |
| `claude-code.tmpl` | the Majordomus 0.12.0 `claude-code` template | worktree paragraph |
| `gemini.tmpl` | the Majordomus 0.12.0 `gemini` template | worktree paragraph |

Each is the shipped template with one paragraph replaced. The shipped paragraph says a
pre-commit hook refuses a branch committed outside its canonical worktree, under a rule
`project.worktree-topology` with a mechanism document; none of that exists in this
repository, whose hooks run `majordomus doctor` and `majordomus finish --check`. It is fixed
upstream in majordomus #783 (merged via #786), and no tagged release contains it yet. Delete
all three files, then run `majordomus update`, once a Majordomus release containing it
(expected 0.13.2) is installed and the templates it ships under `share/providers/` no longer
name `project.worktree-topology`. Until then a change to a shipped template does not reach
these files, so compare them with the installed ones when upgrading.
