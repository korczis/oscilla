---
id: studio-connect-modulation
kind: use-case
title: 'Modulate a filter cutoff with an LFO'
summary: 'Connect an LFO control output to the Filter cutoff parameter port and set the modulation depth on the cable.'
category: studio
status: active
target: advisory
weight: 310
difficulty: intermediate
commands: [knowledge]
claims: [studio-typed-connections, studio-feedback-rejected, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone adds an LFO beside the Filter of a working chain and drags its control output onto
the Filter's cutoff port (specification §14 UC2). The cable is drawn in the control style; in
the Inspector the connection carries its depth (1200 Hz, bipolar, in the Subtractive Synth
template) and the cutoff moves around its set value.

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("parameter target ports know parameter,
  unit, range and mapping", "modulation edge properties: depth, polarity, mapping, offset",
  "control-cycle policy") and tests/unit/v31-studio-compiler.test.mjs ("LFO → cutoff binds the
  real AudioParam with edge depth and polarity"); tests/unit/v31-studio-timeline.test.mjs
  "automation + modulation: actual = base + modulation within bounds".
- `npm run test:studio`: tests/browser/v31-studio-audio.cjs §210 (a 1 Hz LFO at 800 Hz and
  400 Hz depth moves the level of a filtered 1 kHz sine between the levels the browser's biquad
  predicts; a muted edge holds it steady), and tests/browser/v31-studio-graph.cjs
  cable-connect, in Chromium, Firefox and WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not open a browser or play audio. It proves the
traceability instead: each claim's implementation and test are tracked files wired to the
claim in the knowledge graph, so a renamed or deleted test breaks this use case rather than
silently orphaning the claim. The behaviour itself is proven by the commands above, which the
release gate runs and CI blocks a merge on.

# Scenario

```yaml
mode: live
steps:
  - id: studio-typed-connections-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-typed-connections is implemented by src/js/studio/ports.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-typed-connections +implementation:src/js/studio/ports\.js']
  - id: studio-typed-connections-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-typed-connections is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-typed-connections +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-feedback-rejected-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-feedback-rejected is implemented by src/js/studio/validate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-feedback-rejected +implementation:src/js/studio/validate\.js']
  - id: studio-feedback-rejected-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-feedback-rejected is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-feedback-rejected +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-compiled-topology-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-compiled-topology is implemented by src/js/studio/compiler.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-compiled-topology +implementation:src/js/studio/compiler\.js']
  - id: studio-compiled-topology-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-compiled-topology is proven by tests/browser/v31-studio-audio.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-compiled-topology +test:tests/browser/v31-studio-audio\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The modulation is an edge of the model with its own depth (ADR 0037); compiled, it adds to
the cutoff's base value and never rewrites the cutoff automation. A modulation loop is
refused as a control cycle.
