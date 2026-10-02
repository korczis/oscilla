---
id: play-a-440-hz-tone
kind: use-case
title: 'Play a 440 Hz tone and stop it cleanly'
summary: 'Hold play on the default sine at 440 Hz, hear it at the set relative gain, release, and nothing keeps sounding.'
category: generate
status: active
target: advisory
weight: 10
difficulty: basic
commands: [knowledge]
claims: [tone-plays-and-releases]
tags: [oscilla, product-acceptance]
---

# Situation

Someone opens OSCILLA to hear a reference tone: A4, 440 Hz, a sine. They hold the
play button, listen, and let go. What they need is a tone at the level the gain control
says, no click when it starts or stops, and silence afterwards, not an oscillator left
running in the background.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:browser` (tests/browser/app.cjs, check hold-plays-release-zero-nodes)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: tone-plays-and-releases-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim tone-plays-and-releases is implemented by src/js/audio/audio-engine.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:tone-plays-and-releases +implementation:src/js/audio/audio-engine\.js']
  - id: tone-plays-and-releases-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim tone-plays-and-releases is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:tone-plays-and-releases +test:tests/browser/app\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Holding play produces the tone at the set relative gain (the analyser peak equals the
gain within 0.01), the status reads PLAYING, and after release the engine holds zero audio
nodes. The level is relative to digital full scale; nothing here says how loud the
speakers are (rule `project.no-fake-science`).
