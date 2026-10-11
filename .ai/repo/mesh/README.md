---
schema: context/v1
id: ai.repo.mesh
kind: context
title: Mesh
description: The one object that says whether this repository's Majordomus servers take part in mesh discovery and cooperation, over which transports, and whom they trust.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Mesh

`oscilla.yaml` is this repository's mesh declaration (`mesh/v1`). The shared server reads it
at startup: with it enabled, every worktree's server on the owner's machines discovers the
others on the local segment, links to those whose key is listed under `trust.allow`, and
replicates one journal of sessions, claims, handovers and reviews (`majordomus mesh state`).
Absent, or `enabled: false`, no socket opens. The keys are Ed25519 public keys; nothing
secret belongs here. `majordomus mesh doctor` proves the prerequisites on one machine.
