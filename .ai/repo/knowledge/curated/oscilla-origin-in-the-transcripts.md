---
schema: knowledge/v1
id: oscilla-origin-in-the-transcripts
kind: knowledge
class: memory
title: "The transcripts show OSCILLA starting from an anti-bark ad promising 'ultrasound through any phone's speaker', which ChatGPT judged 'several levels above reality', and the owner's 'this can be knocked together in one HTML5'; About's 'simple question' origin is ChatGPT's draft, and the personal motive is unrecorded"
description: "What the ChatGPT export shows about how OSCILLA began, where the public origin story differs from it, which parts are unconfirmed, and what About's Origin will tell (Q005); read before writing any origin text."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - history
  - origin
  - unconfirmed
  - unverified
provenance:
  origin: authored
  derived_from:
    - file:src/index.html
    - file:.ai/repo/why/moments/demo-whose-science-is-invented.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
---

# How OSCILLA began, as the transcripts show it

Sources are the conversations of `chatgpt-oscilla-project`; times are UTC. The record's
`observed` status covers what the transcripts say. Claims ChatGPT reported from a web search
(marked below) are second-hand: its cited pages are not in the export, and nobody has checked
them against the vendor's own site or terms.

## What the transcripts show

- `6abec18d`, 2026-10-01T20:25:00Z. The export opens with ChatGPT's answer to a screenshot
  that is not in the export: a Czech ad for a "Bark Button". What the screenshot said, as
  ChatGPT quotes it: "ultrasound through any phone's speaker", "only dogs hear it, people hear
  nothing", "stops barking instantly", "1 999 Kč struck through -> FREE TODAY -> ADD TO CART".
- Same message, what ChatGPT reported from a web search (unverified here): the vendor's site
  gives the tone as about 15.5 kHz, adjustable from audible to "ultrasonic"; the vendor's own
  article says the tone only interrupts the dog; per its terms the subscription renews
  automatically.
- ChatGPT's verdict, with its hedges: 15.5 kHz is not ultrasound (that starts at about 20 kHz);
  many younger people still hear 15-16 kHz; the ad is "several levels above reality"; "not
  necessarily fraud" and not clearly phishing; "free" may mean the button itself or an entry
  offer, not necessarily no future payment.
- `6abec18d`, 20:25:58Z, the owner's first message in the export: "Tak tohle se da spichnout v
  jednom html5" (this can be knocked together in one HTML5 file).
- `6abec18d`, 20:26:01Z, ChatGPT: the core of such an app is about 30 lines of HTML and JS (its sketch
  defaults to `beep(freq = 15500, ...)`); a phone does not guarantee usable output at 18-20+ kHz; any product value would lie in workflow,
  UX and content, not in the button.
- `6abec18d`, 20:39:20Z and 20:41:04Z, the owner: the instrument is "no longer just for
  dogs", across the whole human range with presets and custom ranges, and asks for a name.
  ChatGPT's shortlist (20:41:05Z) was Oscilla, Wavefield, Resonant, Sonoscope and Overtone
  (HertzLab also listed), avoiding WaveLab (Steinberg), Audible (Amazon), the crowded Spectra and
  Sonora, and any dog, bark or canine word. OSCILLA, "Interactive Sound & Frequency Lab", is in
  every prompt from 20:42:59Z.

The honest-science rules of OSCILLA (15.5 kHz is not ultrasound, generation is not
reproduction; `project.no-fake-science`) answer that ad point by point. ChatGPT called the
honesty the positioning it would keep (`6abec18d`, 20:32:10Z, 23:16:20Z).

## Where the public story differs

- About's "Origin" (`src/index.html`, the `osc-about-origin` block) opens with "OSCILLA began
  with a simple question: how much of an acoustic laboratory could live entirely inside a web
  browser?". That sentence is ChatGPT's About draft: `6abf2a8d`, 2026-10-02T04:11:27Z ("Oscilla
  started as a simple question: ..."), then word for word at 04:13:38Z. ChatGPT wrote it after
  the owner asked how a nice About could say how the project began, how long it took and what
  majordomus.dev contributed (04:10:44Z), and then asked for it as an About page (04:13:22Z).
  ChatGPT's launch post repeats the question in Czech (`6ac015e1`, 20:38:25Z). None of the
  owner's own messages poses that question; they start from the ad (`6abec18d`, 20:25:58Z).
- `6abec18d`, 2026-10-02T03:04:36Z: ChatGPT recalled the start as "an ad for a magical dog
  whistle". That is ChatGPT's paraphrase of the ad, not the owner's words.
- `6ac015e1`, 2026-10-02T20:38:08Z and 20:38:25Z: after searching the owner's earlier ChatGPT
  conversations, ChatGPT suggested the seed may have been "a technically trivial high-frequency
  generator". The owner never states it. **Unconfirmed.**
- `6ac3efc5`, 2026-10-05T18:45:03Z: ChatGPT declined to invent the owner's personal motive,
  because the repository "documents a technical beginning, not the personal moment". The
  personal motive is **unrecorded**.

## What follows

Q005 is decided (2026-10-18) by the coordinating Claude session under the owner's delegation
of 2026-10-18 ("tak to vse pores"); the owner may override. About's Origin will tell the
documented start: the owner's reaction to an anti-bark ad promising "ultrasound through any
phone's speaker" that only dogs hear (a phone tone around 15-16 kHz, the kind ChatGPT's
30-line answer generated, is audible to many people and is not ultrasound) with "this can be
knocked together in one HTML5", growing that night into a lab. The "how much of an acoustic laboratory could live in a browser"
question stays only as the framing the project grew into, not as its starting point. The
reasoning: the public story must not be invented, and this start is the one the transcripts
record in the owner's own words, while the "simple question" is ChatGPT's draft.

Until the follow-up copy change lands, About is unchanged. Any origin text:

- does not name or characterise the company behind the ad beyond "an anti-bark ad": what is
  known about it is ChatGPT's unverifiable web summary, not fact;
- uses the 15.5 kHz figure only for the physics point (a tone around 15.5 kHz is audible to
  many people and is not ultrasound), not as a statement about the vendor's product;
- invents no personal motive.
