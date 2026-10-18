---
schema: moment/v1
id: patch-closes-a-feedback-loop
kind: moment
title: 'A patch cable that closes a feedback loop'
short_title: 'Silent feedback loop'
hook: 'wired a node back into the chain that feeds it and got silence, or a runaway level'
summary: 'An editable graph lets a user close a loop that Web Audio either mutes without a word or lets run away to the output ceiling, and a modulation loop has no defined value at all.'
status: stable
severity: medium
frequency: occasional
weight: 110
audiences: [sound-designers, students, maintainers]
areas: [signal-graph-integrity, playback-safety]
lifecycle: [implementation, operations]
tags: [feedback, cycles, typed-ports, studio]
signals:
  - id: sudden-silence
    text: 'A patch went silent after one more cable and nothing said why.'
  - id: wrong-port-accepted
    text: 'An audio output was connected to a control or trigger input without complaint.'
  - id: microphone-to-speaker
    text: 'A live microphone input could be routed straight to the output.'
examples:
  - id: audio-loop
    audience: sound-designers
    title: 'Output back into its own input'
    before: 'A node''s output is wired into the chain that feeds it, and the browser silently mutes the cycle.'
    after: 'The connection is refused with "This would create an unsupported instantaneous audio feedback loop.", the shortest cycle path is shown, and the graph and the sound stay as they were.'
  - id: lfo-loop
    audience: students
    title: 'Two LFOs modulating each other'
    before: 'LFO 1 modulates LFO 2, which modulates LFO 1, and the result is a value with no definition.'
    after: 'A cycle through a control edge is a control-cycle and is refused with its reason before anything reaches Web Audio.'
  - id: silent-fix
    audience: maintainers
    title: 'Repair the loop quietly'
    before: 'The tempting fix is to drop an edge or insert a delay so the graph runs.'
    after: 'Nothing silently fixes a cycle: no automatic edge removal, no hidden mute, no implicit delay; every model entry point refuses the loop with its sentence.'
claims: [studio-feedback-rejected, studio-typed-connections, studio-untrusted-import]
doctrines: [project.no-silent-feedback, project.typed-ports]
use_cases: [studio-reject-an-invalid-connection, studio-connect-modulation, studio-copy-and-paste-a-subgraph]
related: [patch-on-screen-is-not-what-plays, test-tone-blasts-or-clicks]
aliases: ['feedback loop', 'cycle detection', 'incompatible port', 'audio cycle']
---

## The moment

One more cable and the patch goes silent, or climbs to the output ceiling. Nothing on the page
says that the cable closed a loop.

## Why it happens

In Web Audio an audio cycle without a `DelayNode` is muted by the browser; with one it can run
away to the output ceiling. A modulation loop has no defined value, and a loop through
calibration stages has no meaning
([ADR 0033](../../adrs/0033-feedback-and-control-cycles-rejected.md)). Web Audio itself
accepts the connection.

## What it costs

Time spent debugging a patch that the editor should have refused, and a level at the speaker
that nobody chose.

## What OSCILLA does

Ports are typed and `canConnect` is pure model logic used by the editor, the connection dialog,
paste, patch load and import ([ADR 0032](../../adrs/0032-typed-ports-validated-before-runtime.md),
rule `project.typed-ports`). Cycles are found by explicit traversal; an all-audio cycle, a
control cycle, an analysis cycle and a live input with an audio path to the output are each
refused with a reason and the cycle path (rule `project.no-silent-feedback`, claim
`studio-feedback-rejected`).

## How to verify it

`npm test` runs `tests/unit/v31-studio-model.test.mjs` and
`tests/unit/v31-studio-compiler.test.mjs`, which refuse a loop at every model entry point and
keep the runtime's last graph.

## What it does not do

It offers no safe delay or feedback node. That arrives only with its own feature, ADR and a new
version of the rule; until then every cycle is refused, including ones a musician might want.
