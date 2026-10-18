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

On 2026-10-18 the owner accepted the decisions that the code implements as described and CI
holds (explicit instruction in the session of 2026-10-18, applied by the coordinating Claude
session). Each accepted decision says so in a dated entry under its `## Resolution notes`,
with the claims, code paths and tests that evidence it; `majordomus adr list --status
accepted` lists them. The rest stay `proposed`, each for a stated reason:

- 0001: the Studio runtime holds automation with `cancelAndHoldAtTime` where the browser has
  it (`src/js/studio/automation.js`, `transport.js`, and `envelope.js` `holdAt` through
  `adapters/nodes.js`), so "`cancelAndHoldAtTime` is not used anywhere" holds only for the
  AudioEngine's voices.
- 0008: superseded in practice, as its 2026-10-05 note records; marking it `superseded` is
  the owner's call.
- 0011: Pages no longer serves the committed file unchanged; it stamps one metadata region
  (ADR 0028).
- 0019: the configuration hash covers the calibration, sample rate, algorithms and build
  besides the recipe (`src/js/experiments/hash.js`), and the setup a user repeats is now
  named by a definition version (ADR 0043).
- 0030, 0034, 0038: implemented, but `tests/unit/v31-studio-self-knowledge.test.mjs` requires
  the Studio ADRs with open questions to keep `proposed`; 0038 also keeps one question open
  (Apple Safari with a real input device).
- 0045: amended by ADR 0048, which re-applies the `records` domain on Back and Forward.
- 0047: `tests/unit/release-analyze.test.mjs` requires it to stay unaccepted, because
  `release:prepare --no-rc-because` accepts any accepted ADR and would then accept this one.
- 0050, 0052, 0054, 0055, 0056, 0057: implemented, but their `provenance.origin` is
  `extracted`, and `majordomus adr check` refuses `accepted` on an extracted record.
- 0051: the "Why trust the method?" list and its hand-written claims mirror under
  `src/js/measurement/` are not built.
- 0053: the user-visible "run" strings its consequences list are not changed yet.
- 0058: a proposed direction; nothing implements it.

A worker still never promotes a status without the owner: this was the owner's act, and a
later acceptance, supersession or rejection is too.

## How one is added

Nothing here is generated and nothing is promoted here automatically: a decision recorded
while working (`majordomus decision add`) stays in the checkout's local state until a person
judges it durable enough to write down here (`majordomus adr propose`).
