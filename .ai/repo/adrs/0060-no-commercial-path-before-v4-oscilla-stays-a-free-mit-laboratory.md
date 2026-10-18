---
schema: adr/v1
id: adr-0060
kind: adr
title: "No commercial path before v4.0: OSCILLA stays a free MIT laboratory"
status: proposed
date: 2026-10-18
tags:
  - product
  - licence
  - v4
related:
  - file:.ai/repo/project/issues/Q003.yaml
  - file:.ai/repo/project/issues/P004.yaml
  - file:.ai/repo/adrs/0051-v4-0-ships-method-claims-on-experiment-evidence-not-a-knowle.md
  - rule:project.single-file-deliverable
  - rule:project.no-fake-science
  - file:LICENSE
  - file:README.md
  - file:docs/v4/completion-ledger.md
  - file:.ai/repo/project/intents/product-direction.yaml
  - file:.ai/repo/project/critiques/product-direction.yaml
  - file:.ai/repo/knowledge/curated/product-landscape-and-the-pigments-path.md
provenance:
  origin: authored
  derived_from:
    - issue:Q003
---

# 60. No commercial path before v4.0: OSCILLA stays a free MIT laboratory

## Context

The owner asked whether OSCILLA can be productized and what is missing to make money from it
(ChatGPT project conversation `6abf3077`, 2026-10-02T04:18:12Z and 04:30:50Z; knowledge
record `chatgpt-oscilla-project`). The conversations answered with ideas, not a decision: a
paid teaching pack on top of the free lab, measurement segments that would need another offer,
and the observation that free browser tone tools and REW already exist
(`product-landscape-and-the-pigments-path`). No intent, milestone, ADR or record named a buyer,
an offer or a pilot, and the intent `product-direction` forbids a worker to invent one.

Issue Q003 put six questions: whether there is a product path at all; who pays; which offer;
which pilot comes first; whether the consequence of the MIT licence (`LICENSE`) is accepted;
and what must exist before a first sale. Its critique (`product-direction`, finding
`licence-non-goal-contradicts-q003`) required that the licence question be either open or
closed, not both; it is resolved by Q003's decision, which does not reopen the licence.

Who decided: the coordinating Claude session, on 2026-10-18, under the owner's delegation of
2026-10-18 ("tak to vse pores", resolve all of it), given to that session together with the
approval to accept implemented ADRs, enable strict branch protection and upload new ChatGPT
project instructions. These are not the owner's own words, and the owner may override the
decision. It is recorded as `owner_decision` evidence on Q003 (`majordomus plan show Q003`).

## Decision

No commercial path now. As Q003 records it:

1. **Product path.** OSCILLA stays a free, open instrument and proof of method.
2. **Buyer.** None is chosen.
3. **Offer.** None is built; the teaching-pack idea stays a recorded idea, not planned work.
4. **Pilot.** None.
5. **Licence.** The MIT consequence is accepted: anyone may take, modify and resell the core.
   The licence is not reopened.
6. **Before a first sale.** Nothing is prepared (terms, privacy notice, support contact, tax
   handling), because no sale is planned.

The question is not asked again before a v4.0.0 release exists (`docs/v4/completion-ledger.md`
says the project is not ready for v4.0). After v4.0 it returns as a new intent, not as a
reopening of Q003 or of this record.

The reasoning Q003 records:

- The owner's v4 steering puts depth over breadth and requires the meta-layer to pay rent
  (ADR 0051). A commercial line is breadth.
- Commercial work would add accounts, a backend or analytics, which README's "Privacy" section
  (no analytics, no server, no account) and `project.single-file-deliverable` (nothing fetched
  at runtime, no server) exclude.
- Demand is unproven next to free browser tools and REW, and no record names a buyer.
- v4.0, the generation the owner steers, is not complete.

## Alternatives rejected

The conversations raised three ways to earn on a free MIT core (Q003 questions 3 and 5:
revenue could rest only on content, services or support). What each would cost, from what
the repository records:

- **A paid teaching pack** (ChatGPT's proposal in `6abf3077`): guided experiments with goals
  and steps, teacher materials, student questions, ready configurations and worksheets on top
  of the free lab. Cost: writing that content and keeping it true to the page release by
  release, since its claims fall under `project.no-fake-science`; everything Q003 question 6
  lists before a first sale; and a way to sell and deliver it. Inside the page that means a
  checkout or an account, which the intent's invariant and README's privacy statement
  exclude; outside it, a sales channel the project does not have. Its buyers (teachers and
  schools) are a segment Q003 named, not one any record shows asking.
- **Measurement services** (the measurement segments of Q003 question 2: speaker developers,
  room tuning, audio engineering, labs and R&D, which "would need another offer"). Cost: a
  person's time on every engagement, and claims that OSCILLA's evidence must back. The intent
  excludes selling OSCILLA as calibrated measurement software (`project.no-fake-science`),
  and REW is free, professional and works with calibrated microphones, so a service would sell
  the operator, not the product.
- **Support.** Cost: a support contact and a commitment to answer it (Q003 question 6),
  staffed by the owner, for users no record names, while the v4.0 work it would compete with
  is unfinished.

Each of them also carries the MIT consequence: none can stop anyone from reselling the core.

## Consequences

- OSCILLA stays free under the MIT licence. Anyone may resell the core, and nothing in the
  repository tries to prevent it; `LICENSE` is unchanged.
- The intent's invariant holds: no checkout, account, backend, analytics or pricing page is
  built, and no buyer, offer or pilot is planned before a v4.0.0 release exists and a new
  intent reopens the question.
- The work this decision implies, each item to be planned in a separate change from this
  record: today, none. After v4.0 is released, a new intent for the product question (who
  pays, for which offer, with which pilot), which starts from this record and from Q003.
- The teaching pack, measurement services and support remain recorded ideas in this record
  and in Q003, not plan items.
- If the owner overrides the decision, the override is recorded in the owner's words and this
  record gains a dated resolution note; its status remains the owner's to change.
