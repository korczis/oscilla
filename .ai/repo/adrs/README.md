---
schema: context/v1
id: ai.repo.adrs
kind: context
title: Architecture decisions
description: The architecture decisions recorded for this repository, what their status means, and who accepts them.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Architecture decisions

The durable decisions about how this repository is built, one file each, with the context,
the decision, the alternatives rejected and the consequences.

## What the status means

On 2026-10-05 every decision here had `status: proposed` and none had been accepted;
`majordomus adr list` shows the current statuses. `majordomus adr propose` writes only
`proposed`, and accepting a decision is the owner's act, not a worker's.
Read `proposed` as: recorded, and implemented as described, unless a dated entry under
`## Resolution notes` at the end of the file says otherwise. Those notes are appended and
never rewrite the sections above them; they record what shipped, what changed since, and a
decision that practice has superseded. A worker does not promote a decision to `accepted`,
`superseded` or `rejected`; it adds a resolution note and leaves the status to the owner.

## How one is added

Nothing here is generated and nothing is promoted here automatically: a decision recorded
while working (`majordomus decision add`) stays in the checkout's local state until a person
judges it durable enough to write down here (`majordomus adr propose`).
