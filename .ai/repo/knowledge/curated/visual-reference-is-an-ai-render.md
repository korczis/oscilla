---
schema: knowledge/v1
id: visual-reference-is-an-ai-render
kind: knowledge
class: fact
title: "The V2 visual reference is most likely one of ChatGPT's two 1536x1024 image renders of a page that did not exist; the match is by size and timing, not by bytes (unverified)"
description: "Where tests/visual/reference.png probably came from, and what that means for reading it: a mockup that fixes geometry and look, never values."
status: verified
epistemics: inferred
date: 2026-10-18
tags:
  - visual
  - history
  - unconfirmed
provenance:
  origin: authored
  derived_from:
    - file:tests/visual/reference.png
    - commit:9fe0a15de5511a5158d786e654dc28869063628f
    - file:.ai/repo/rules/project/visual-identity-lock.v1.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
---

# The visual reference is an AI mockup

What the transcript shows (`6abec18d`, UTC):

- 2026-10-01T21:03:40Z, the owner: "ukaz nahled stranky" (show a preview of the page).
  21:03:43Z, ChatGPT answers with an image generation of size 1536x1024 and no prompt text.
- 21:09:03Z, the owner: "nahled ui? jak to zapada?" (a UI preview? how does it fit?). 21:09:07Z,
  a second 1536x1024 image generation.
- 21:52:06Z, the owner asks for libraries or custom components that look "1:1 as close as
  possible" like "your preview", and for the V2 prompt to reach exactly that function and look.
  ChatGPT's V2 addendum (21:52:21Z) pairs the look with "NO FAKE DATA": the mockup fixes the UI
  geometry, never the values, and every metric names its origin or says UNKNOWN.

What the repository holds: `tests/visual/reference.png` is 1536x1024 (RGBA), added with V2 in
9fe0a15; ADR 0029 and the v2-laboratory intent accept V2 against a 1536x1024 reference.

**Unverified:** the export carries the image generation calls, not the images, so the reference
is matched to the renders by size and timing only. If it is one of them, the reference is an
image of a page that did not exist when it was drawn, and its numbers, labels and readings are
the image model's, never data. The rule that keeps that apart in the product is
`project.no-fake-science`; "mockup geometry is not data" is written nowhere else, and the
planned no-placeholder rule (issue E007) is where it would be enforced.
