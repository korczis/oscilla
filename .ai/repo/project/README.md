---
schema: context/v1
id: ai.repo.project
kind: context
title: Project model
description: Milestones as outcomes, issues as execution contracts, and a dependency graph that decides what is next.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
children:
  require_contract: false
---

# Project model

The canonical plan: `project.yaml` for the project itself, `milestones/` for the outcomes,
`issues/` for the execution contracts that reach them, and the dependency edges between
issues for the order they may be executed in. Nothing here is generated; everything
downstream is. The ready set, the diagrams and the projections all come from
`majordomus plan`, which reads these files and nothing else.

No status is stored. An issue records what happened to it — when it started, when it was
verified, when it completed, and its evidence — and the state is derived from those facts
and from its dependencies. A status field would be a second source of truth that drifts
the moment a dependency changes.

The directories below hold instances of these kinds rather than sections of their own, so
they owe no contract until this repository decides to describe them
(`children.require_contract: false`).

```bash
majordomus plan next          # the issues whose dependencies are satisfied
majordomus plan validate      # the graph: acyclic, every edge resolves
```

## Issue identifiers

An issue's id is a letter and three digits; the letter says which line of work it belongs to,
and nothing derives a status from it.

```text
S001-S095   V1 specification sections (M001-M005); S000 received the text of 64-95
D001-D003   V1 delivery (M006)
V2xx        V2 laboratory (M007-M010, M034)          R0xx  release engineering (M011, M035)
V3xx        V3 MEASURE (M012-M020); V39x its measurement extensions after 3.11 (M047)
V4xx        V3.1 Studio (M021-M033); V44x its completion after 3.11 (M048)
V5xx        MIDI jam companion (M045)
E0xx        engineering integrity: structure, size and checks of the code base (M046)
L0xx        Learn lessons (M049)
P0xx        product: first run, positioning, productization (M050, M051)
Q0xx        questions only the owner can answer (M052; Q001 under M005)
```

A Q issue is answered by the owner. A worker records the answer as evidence (covers
`owner_decision`) only by quoting the owner's words with their date and source, and never answers
one itself. Work that waits on an answer names the Q issue in `depends_on`, and M052 sorts after
every live milestone, so `majordomus plan next` never nominates a question to a worker. A question
recorded with `majordomus question add` lives in one checkout's `.ai/local/` and is read by nobody
else; a question the next worker must see is a Q issue.
