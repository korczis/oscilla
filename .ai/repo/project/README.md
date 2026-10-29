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
and nothing derives a status from it. This list names every prefix under `issues/`; a new
prefix is added here in the same change that adds its first issue.

```text
S000-S095   V1 specification sections (M001-M005); S000 received the text of 64-95
D001-D003   V1 delivery (M006)
V2xx        V2 laboratory (M007-M010, M034)
R0xx        release engineering (M011, M035)
V3xx        V3 MEASURE (M012-M020); V39x its measurement extensions after 3.11 (M047)
V4xx        V3.1 Studio (M021-M033)
V5xx        MIDI jam companion (M045)
V6xx        Studio completion after 3.11 (M048) and Studio boxes (M080-M081)
E0xx        engineering integrity: structure, size and checks of the code base (M046); E030
            the definition of done (M083)
K0xx-K1xx   playable instrument (M057-M059, M061), audio-band signal lab (M060), charts (M062),
            connected instrument (M064-M069, M071-M072) and signal generator lab (M082)
L0xx        Learn lessons (M049)
P0xx        product: first run (M050), positioning, product path, public story (M051)
U0xx        the whole interface shows the current product (M054)
F0xx        the whole interface on Flowbite Pro (M055)
Q0xx        questions and acts only the owner can answer or take (M052; Q001 under M005, Q004 under
            M050, Q007 under M053, Q008-Q017 under M063, Q018-Q024 under M070, Q030-Q033 under
            M084)
```

A Q issue is answered by the owner, or by a session the owner delegated the decision to. The
answer is recorded as evidence (covers `owner_decision`) with its date and source: in the owner's
words, or attributed to the deciding session together with the delegation's date and words, its
reasoning and the note that the owner may override it, never presented as the owner's own words.
A worker without such a delegation never answers one. Work that waits on an answer names the Q
issue in `depends_on`, and M052 (questions), M053 (owner acts on published releases, Q007),
M063 (the charts line's questions, Q008-Q017), M070 (the instrument line's, Q018-Q024) and
M084 (the Studio boxes and generator lines', Q030-Q033) sort after every live milestone, so
`majordomus plan next` does not nominate them first. That is a convention, not a guarantee: a
Q issue is READY to `majordomus plan start` like any other, and its `owner` field only informs.
A question recorded with `majordomus question add` lives in one checkout's `.ai/local/` and is
read by nobody else; a question the next worker must see is a Q issue.

## Shared files and closing issues

`docs/CLAIMS.yaml` and an intent file are changed by one closing issue per milestone (E015 for
M046, V399 for M047, V606 for M048, L006 for M049), which registers the milestone's claims and
points the intent's criteria at them once the work has landed; the other issues of the milestone
leave both files alone, so they can run in parallel and none fails `finish` on scope or moves
its binding's pins mid-task. P002, P003 and P005 do the swap themselves and have the intent file
in their scope: P003 then P005 are chained, P002 follows Q004 after P001, and P004 does not edit
the intent; a P004 worker re-reads its binding pins after rebasing over P003 or P005. `tests/README.md` must have a row for every
test (`tests/unit/knowledge-integrity.test.mjs`), so every test-adding issue appends one row to
it; two such issues running at once rebase on that index, which `majordomus plan validate`
reports as a scope conflict and which is a merge, not a design conflict. `dist` is a rebuild
artifact in the same way: whichever change lands second rebuilds it.

An issue whose verification rounds may be partial (V386, V431, V432, V433) declares a closing
token, `all_criteria_met`, besides `verified` in `evidence_required`; each round is recorded
under `verified`, met or not, and `all_criteria_met` only when every acceptance criterion is
met, so `majordomus plan done` refuses until then.
