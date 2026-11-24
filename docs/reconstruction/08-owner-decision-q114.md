# 08. Owner decision Q114, verbatim

- **Session:** Claude Code session `40c3f589-de0d-4e90-ba18-aee761b5273a`.
- **Asked:** 2026-11-24 between 16:30Z and 16:34Z, through AskUserQuestion.
- **Before the questions:** the owner had pasted the prompt pack "OSCILLA — Complete product
  experience reconstruction" and then ordered `/orchestrate proceed using our best agents in
  parallel`.
- **Record:** plan issue `Q114`.
- **Format:** each question and its options are quoted as asked. Every answer was the option
  marked "(Recommended)".

## 1. Model

> Adopt product model E for OSCILLA? Model E keeps a few navigation places, adds one
> persistent bottom strip (what is sounding, Play/Stop, observed level, keys, the probe
> 'Sonda'), an observed-output probe sheet over any page, and a command palette. It would also
> amend ADR 0061 decision 1: navbar and page header merge into one bar, a slim rail without
> groups, a bottom bar on phones, and the footer becomes the instrument strip (new ADR 0089).

Options:
- "Adopt E + ADR 0089 (Recommended)"
- "Adopt E, keep the shell"
- "Task-oriented (B)"

**Answer: "Adopt E + ADR 0089 (Recommended)"**

## 2. Places

> Landing, Playground and Generator are three separate records today: Q089 (a new landing
> page at /oscilla/), Q033 (Generator as its own workspace) and Q090 (8 nav entries without a
> Generator). Which place structure should the navigation have?

Options:
- "Generator = Playground (Recommended)": one place named Generátor answers both
  #m=playground and #m=generator; the landing stays a separate first page (Q089).
- "Keep three places"
- "Landing replaces Playground"

**Answer: "Generator = Playground (Recommended)"**

## 3. Sound across places

> Today, leaving a page disarms an armed Synth, releases held notes and stops a running
> measurement or sequence (the LEAVE_POLICY in core/output-bus.js). So 'play on Synth, then go
> analyze it' loses the sound. Should the sound survive a place change?

Options:
- "Sound survives (Recommended)": whatever plays keeps playing across places; the strip
  always shows it and stops it. Measurement still stops when leaving Měření, to protect run
  integrity.
- "Survives, measurement too"
- "Keep current stopping"

**Answer: "Sound survives (Recommended)"**

## 4. Letter keys

> Letter keys play notes in every page today, including Měření, Experimenty, Výuka and O
> aplikaci (your choice Q105 'armed everywhere'). WCAG 2.1.4 flags single-letter shortcuts
> without a global off switch. What should apply?

Options:
- "Instrument places + switch (Recommended)": letter keys play in Synth, Studio and
  Generátor/Playground, with one global on/off switch shown in the strip; other pages stay
  silent.
- "Everywhere + global switch"
- "Keep as is"

**Answer: "Instrument places + switch (Recommended)"**

## 5. Phone keys

> On a phone, should the on-screen keys stay docked at the bottom (your Q019) or open as a
> sheet from the instrument strip, so the place's own content gets the first screen?

Options:
- "Sheet from the strip (Recommended)": keys open as a bottom sheet with whole octaves and
  44 px keys; Synth opens it by default, other places start with it closed.
- "Keep docked (Q019)"
- "Docked only in Synth"

**Answer: "Sheet from the strip (Recommended)"**
