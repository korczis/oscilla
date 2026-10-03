---
id: open-measure-from-file
kind: use-case
title: 'Open the Measure workspace from file://'
summary: 'Open dist/index.html from disk and use Measure and Experiments with no server and no network.'
category: run
status: active
target: advisory
weight: 210
difficulty: basic
commands: [knowledge]
claims: [measure-from-file-and-subpath, opens-from-file-and-subpath, dist-self-contained]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone downloads `dist/index.html` and opens it from disk on a machine with no
development tools, then switches to Measure.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:measure` (tests/browser/v3-ui.cjs and tests/browser/v3-measure.cjs, every check from file:// and from /oscilla/ in Chromium, Firefox and WebKit, ending with no-console-errors)
- `npm run verify-dist` (scripts/verify-dist.mjs: no module script, no external script, no worklet loaded from a path)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

Some browsers refuse microphone access or IndexedDB from file://. The workspace then says
so (setup check blocker, memory store notice); serving the file on localhost avoids it.

# Scenario

```yaml
mode: live
steps:
  - id: measure-from-file-and-subpath-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim measure-from-file-and-subpath is implemented by src/js/measurement/capture.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:measure-from-file-and-subpath +implementation:src/js/measurement/capture\.js']
  - id: measure-from-file-and-subpath-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim measure-from-file-and-subpath is proven by tests/browser/v3-ui.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:measure-from-file-and-subpath +test:tests/browser/v3-ui\.cjs']
  - id: opens-from-file-and-subpath-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim opens-from-file-and-subpath is implemented by src/index.html, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:opens-from-file-and-subpath +implementation:src/index\.html']
  - id: opens-from-file-and-subpath-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim opens-from-file-and-subpath is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:opens-from-file-and-subpath +test:tests/browser/app\.cjs']
  - id: dist-self-contained-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim dist-self-contained is implemented by scripts/verify-dist.mjs, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:dist-self-contained +implementation:scripts/verify-dist\.mjs']
  - id: dist-self-contained-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim dist-self-contained is proven by tests/unit/verify-dist.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:dist-self-contained +test:tests/unit/verify-dist\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Measure and Experiments boot without console errors from file:// and from the GitHub Pages
sub-path. The capture worklet loads from a data URL inside the page; nothing is fetched.
