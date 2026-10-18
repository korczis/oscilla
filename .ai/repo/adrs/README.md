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
- 0016: accepted on 2026-10-18 and withdrawn the same day after the review of the acceptance
  (pull request #198, R-1): not every live renderer follows the one frame loop it decides.
- 0019: the configuration hash covers the calibration, sample rate, algorithms and build
  besides the recipe (`src/js/experiments/hash.js`), and the setup a user repeats is now
  named by a definition version (ADR 0043).
- 0030, 0034, 0038: implemented, but `tests/unit/v31-studio-self-knowledge.test.mjs` requires
  the Studio ADRs with open questions to keep `proposed`; 0038 also keeps one question open
  (Apple Safari with a real input device).
- 0045: amended by ADR 0048, which re-applies the `records` domain on Back and Forward.
- 0047: implemented, but its `provenance.origin` is `extracted`, and `majordomus adr check`
  refuses `accepted` on an extracted record. (Until 2026-10-18 it was also held back because
  `release:prepare --no-rc-because` took any accepted ADR; it now takes only an RC exemption,
  below.)
- 0050, 0052, 0054, 0055, 0056, 0057: implemented, but their `provenance.origin` is
  `extracted`, and `majordomus adr check` refuses `accepted` on an extracted record.
- 0051: the "Why trust the method?" list and its hand-written claims mirror under
  `src/js/measurement/` are not built.
- 0053: the user-visible "run" strings its consequences list are not changed yet.
- 0058: a proposed direction; nothing implements it.
- 0059: new on 2026-10-18 (pull request #197) and `extracted`; it amends 0028.
- 0060: new on 2026-10-18 (issue P004); a decision taken under the owner's delegation
  (Q003), which the owner may override, so its acceptance is the owner's.

A worker still never promotes a status without the owner: this was the owner's act, and a
later acceptance, supersession or rejection is too.

## An exemption from the release candidate

ADR 0047 requires a release candidate before the first stable release of a new major, and
`release:prepare` refuses that release without one (rule `project.release-flow-complete`).
`npm run release:prepare -- --no-rc-because <ADR>` lifts the refusal only for an ADR that is
an RC exemption for the major being opened. The ADR schema has no field for this, so the
convention uses what `majordomus adr check` accepts:

- `status: accepted` (the owner's act, as for every decision);
- `tags` include `rc-exemption` and `major-<N>`, the one major it exempts (`major-4`);
- `related` includes `adr:adr-0047`, the decision it exempts;
- its `# Decision` says why that major ships without a candidate.

Any other ADR, accepted or not, is refused with the missing parts named
(`rcExemptionProblems()` in `scripts/release-prepare.mjs`). No exemption exists today.

## How one is added

Nothing here is generated and nothing is promoted here automatically: a decision recorded
while working (`majordomus decision add`) stays in the checkout's local state until a person
judges it durable enough to write down here (`majordomus adr propose`).
