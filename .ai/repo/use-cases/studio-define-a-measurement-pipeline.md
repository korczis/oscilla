---
id: studio-define-a-measurement-pipeline
kind: use-case
title: 'Define a measurement pipeline in Studio'
summary: 'Wire Sweep to Output and Microphone through Calibration into the Transfer Analyzer with the sweep as reference, and run it from the timeline.'
category: studio
status: active
target: advisory
weight: 400
difficulty: advanced
commands: [knowledge]
claims: [studio-measurement-topology, studio-experiment-provenance]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone opens the **Measurement Sweep** template: Sweep → Master Output, the Sweep's
reference → Transfer Analyzer REFERENCE, Microphone → Calibration → Transfer Analyzer OBSERVED
→ Measurement Result, with noise-check, pre-roll, stimulus, tail and analysis clips on a
measurement track (specification §14 UC11, the §258 template). They press **Play**
(docs/v31/user-guide.md, "Measure with the Measurement Sweep template").

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("§258 Measurement topology builds and
  validates", "analysis cycles and live input to output are rejected"),
  tests/unit/v31-studio-templates.test.mjs ("§258 Measurement Sweep is the measurement topology;
  the microphone never sounds") and tests/unit/v31-studio-gaps.test.mjs (the first measurement
  clip hands the derived recipe to the engine; a topology that cannot be measured is refused;
  a real MeasurementEngine runs the clip pass).
- `npm run test:studio`: tests/browser/v31-studio-workflows.cjs check measure-from-studio (on the
  TEST CONTEXT loopback: PREFLIGHT … COMPLETE, the experiment saved, Studio PLAY refused while
  the measurement owns the output, Escape aborts, 0 nodes afterwards) and
  tests/browser/v31-studio-graph.cjs check templates (the Microphone shown as unavailable with a
  reason where it is), in Chromium, Firefox and WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not open a browser or play audio. It proves the
traceability instead: each claim's implementation and test are tracked files wired to the
claim in the knowledge graph, so a renamed or deleted test breaks this use case rather than
silently orphaning the claim. The behaviour itself is proven by the commands above, which the
release gate runs and CI blocks a merge on.

# What it cannot prove

The browser checks run on a digital loopback; no automated test proves how a physical
speaker, room or microphone behaves. Measurement clips are not rendered offline: they run live.

# Scenario

```yaml
mode: live
steps:
  - id: studio-measurement-topology-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-measurement-topology is implemented by src/js/studio/nodes/measurement.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-measurement-topology +implementation:src/js/studio/nodes/measurement\.js']
  - id: studio-measurement-topology-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-measurement-topology is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-measurement-topology +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-experiment-provenance-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-experiment-provenance is implemented by src/js/studio/provenance.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +implementation:src/js/studio/provenance\.js']
  - id: studio-experiment-provenance-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-experiment-provenance is proven by tests/unit/v31-studio-provenance.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +test:tests/unit/v31-studio-provenance\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Running the pipeline drives the existing measurement state machine of the Measure workspace
and produces its result; levels stay relative unless a valid calibration applies (ADR 0017).
