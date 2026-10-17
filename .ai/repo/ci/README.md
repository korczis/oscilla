---
schema: context/v1
id: ai.repo.ci
kind: context
title: Continuous integration model
description: The validation gates CI runs, the job and command of each, and the paths that select them, as Majordomus reads them.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
tracks: [.github/workflows/ci.yml]
---

# Continuous integration model

`gates.yaml` is the CI model Majordomus reads: every validation gate, the job of
`.github/workflows/ci.yml` that runs it, the command that reproduces it, and the path classes
that select it. `majordomus check` and `finish` plan a task's gates from it and judge each one
from the runs recorded with `majordomus evidence --gate <id> --exit <status>`; a run is bound
to the hash of the files that select the gate, so a later change makes it stale. A gate that
never reported is named as a debt, never counted as a pass.

The workflow is the source and this file describes it. `tests/unit/ci-gates-model.test.mjs`
fails when the two disagree on the job set (one gate per job and per browser matrix leg), the
commands, the path selection (ci.yml filters no path, so every gate is `always`) or what the
aggregate `gate` needs. A change to a job of `ci.yml` changes its gate here in the same pull
request.
