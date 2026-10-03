---
id: open-from-file
kind: use-case
title: 'Open OSCILLA from file:// with no server and no network'
summary: 'Double-click dist/index.html and get the whole application: nothing is fetched, imported or loaded from a path.'
category: run
status: active
target: advisory
weight: 100
difficulty: basic
commands: [knowledge]
claims: [opens-from-file-and-subpath, dist-self-contained, single-file-build]
tags: [oscilla, product-acceptance]
---

# Situation

Someone downloads `dist/index.html` and opens it from disk, offline, on a machine with no
development tools. The page has to work exactly as it does on the web.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run release-gate` (npm test, build, verify-dist, test:engine, test:browser)
- `npm run verify-dist` (scripts/verify-dist.mjs on the committed dist/index.html)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
play audio. It proves the traceability instead: each claim's implementation and test are
tracked files wired to the claim in the knowledge graph, so a renamed or deleted test
breaks this use case rather than silently orphaning the claim. Majordomus classes
`knowledge` as state-mutating from 0.11 on, and a live scenario may run only read-only
commands, so the setup `oscilla-tree` (`test/fixtures/commands/setup/oscilla-tree.sh`)
copies the tracked files of this checkout into a disposable repository and the steps ask
the knowledge graph of that copy.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
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
  - id: single-file-build-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim single-file-build is implemented by scripts/pack-single-file.mjs, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:single-file-build +implementation:scripts/pack-single-file\.mjs']
  - id: single-file-build-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim single-file-build is proven by tests/unit/pack-single-file.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:single-file-build +test:tests/unit/pack-single-file\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The page boots without console errors and plays in Chromium, Firefox and WebKit from
file://. The committed file is one deterministic build of the modular source with every
dependency inlined; the verifier refuses module scripts, import maps, external scripts and
runtime fetches (rule `project.single-file-deliverable`, ADRs 0011 and 0012).
