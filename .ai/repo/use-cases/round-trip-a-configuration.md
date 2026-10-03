---
id: round-trip-a-configuration
kind: use-case
title: 'Save a configuration and restore it from a file or a link'
summary: 'Export the configuration as a file or copy a link, open it later, and get the same instrument state through the validated path.'
category: share
status: active
target: advisory
weight: 90
difficulty: basic
commands: [knowledge]
claims: [config-file-round-trip, link-restores-configuration, presets-save-and-load]
tags: [oscilla, product-acceptance]
---

# Situation

Someone has set up a demonstration and wants it back tomorrow, or wants to send it to a
colleague. They export the configuration file, copy a link, or save a named preset.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/integration-ui.test.mjs, tests/unit/core.test.mjs)
- `npm run test:browser` (tests/browser/app.cjs, checks config-export-import-round-trip, url-copy-round-trip, presets-save-load)

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
  - id: config-file-round-trip-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim config-file-round-trip is implemented by src/js/ui/config-file.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:config-file-round-trip +implementation:src/js/ui/config-file\.js']
  - id: config-file-round-trip-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim config-file-round-trip is proven by tests/unit/integration-ui.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:config-file-round-trip +test:tests/unit/integration-ui\.test\.mjs']
  - id: link-restores-configuration-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim link-restores-configuration is implemented by src/js/core/url-state.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:link-restores-configuration +implementation:src/js/core/url-state\.js']
  - id: link-restores-configuration-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim link-restores-configuration is proven by tests/unit/core.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:link-restores-configuration +test:tests/unit/core\.test\.mjs']
  - id: presets-save-and-load-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim presets-save-and-load is implemented by src/js/core/storage.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:presets-save-and-load +implementation:src/js/core/storage\.js']
  - id: presets-save-and-load-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim presets-save-and-load is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:presets-save-and-load +test:tests/browser/app\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The exported file carries every specified key and no runtime objects; importing it, opening
the link (`#v=1&...`) or loading the preset restores the same configuration through one
validated path, with the gain capped. Each persisted format carries its own schema
version (ADR 0023).
