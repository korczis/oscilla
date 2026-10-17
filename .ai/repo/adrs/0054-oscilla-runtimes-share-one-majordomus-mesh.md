---
schema: adr/v1
id: adr-0054
kind: adr
title: "OSCILLA's runtimes share one Majordomus mesh: local multicast, deny unknown keys"
status: proposed
date: 2026-10-17
tags:
  - mesh
  - process
related:
  - file:.ai/repo/mesh/oscilla.yaml
  - file:.ai/repo/adrs/0008-parallel-agents-in-isolated-worktrees.md
  - rule:project.worktree-topology
  - rule:project.shared-machine-discipline
provenance:
  origin: extracted
  derived_from:
    - commit:e4cb88ca598ed281d4173adb319f6da14fa090a5
    - file:.ai/repo/mesh/oscilla.yaml
---

# 54. OSCILLA's runtimes share one Majordomus mesh: local multicast, deny unknown keys

## Context

OSCILLA is worked on by several sessions at once, each in its own linked worktree
(`project.worktree-topology`), and each worktree has its own Majordomus shared server. A
server's peer board knows only the sessions attached to it, so the sessions of one machine, and
those of the owner's other machines, could not see each other's claims, handovers or review
requests. The board lists the other checkouts but cannot tell what their sessions hold.
Coordination happened by chance or not at all. Two sessions could claim the same paths, and a
handover written in one worktree reached no session in another.

## Decision

The repository declares a Majordomus mesh in `.ai/repo/mesh/oscilla.yaml` (schema `mesh/v1`,
added by `e4cb88c` in merge train 1, #174). Every OSCILLA runtime discovers the others, links,
and shares one journal of sessions, claims, handovers and reviews. The posture is least
privilege, the same as the majordomus repository's own declaration:

- discovery by multicast on the local segment only (`239.255.77.77:7741`, TTL 1), no broadcast
  and no rendezvous hub;
- trust policy `deny_unknown`: a key not listed under `trust.allow` is observed and trusted for
  nothing;
- `trust.allow` holds the Ed25519 public keys of the owner's machines, never a secret. The
  worktrees of one machine share that machine's key; `majordomus mesh identity` prints it.

Sessions coordinate through the mesh: a session claims its scope, a builder requests the review
that `project.review-verdict` needs (`mesh review request`), and continuity crosses worktrees
by `mesh handover publish`.

## Alternatives rejected

- **Each worktree's board alone**, which was the state before the mesh. It cannot see claims or
  handovers held in another worktree, and that blindness is what the decision removes.
- **A rendezvous hub or broadcast discovery.** Either would reach beyond the local segment the
  owner's machines share, for no need OSCILLA has.
- **`trust: allow_all`.** Any runtime on the segment could then publish claims and reviews into
  the journal.

## Consequences

- A session in any OSCILLA worktree on the owner's machines sees every other session's live
  claims and open review requests, and can answer them.
- A machine whose key is not listed is ignored. Adding a machine is a reviewed change to
  `trust.allow`.
- The declaration takes effect only on a server started after it is on the branch the server
  serves. A running server must be restarted (`majordomus-cli serve stop`, then
  `serve ensure`) to pick it up.
- The mesh carries coordination, not authority. A review answered on the mesh does not replace
  the verdict file `project.review-verdict` requires, and claims are advisory unless taken as
  exclusive.
