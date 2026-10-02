---
id: export-a-wav-file
kind: use-case
title: 'Export the current signal as a WAV file'
summary: 'Press WAV export and get a valid RIFF/WAVE file of the current tone or pattern, rendered offline.'
category: share
status: active
target: advisory
weight: 80
difficulty: basic
commands: [knowledge]
claims: [wav-export-valid]
tags: [oscilla, product-acceptance]
---

# Situation

Someone wants the tone they just configured as a file, for another tool or a lesson. They
press the WAV export button.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/audio-wav.test.mjs; tests/unit/integration-ui.test.mjs for the render length)
- `npm run test:browser` (tests/browser/app.cjs, check wav-export-valid)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: wav-export-valid-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim wav-export-valid is implemented by src/js/audio/wav.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:wav-export-valid +implementation:src/js/audio/wav\.js']
  - id: wav-export-valid-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim wav-export-valid is proven by tests/unit/audio-wav.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:wav-export-valid +test:tests/unit/audio-wav\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The download is a valid RIFF/WAVE file (16-bit PCM, stereo; the encoder also writes
32-bit float) that parses back to the same samples.
The render length follows the plan, the trigger and the safety cap. Nothing is uploaded:
the file is built in the page.
