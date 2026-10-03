---
id: open-under-the-oscilla-sub-path
kind: use-case
title: 'Open OSCILLA under the /oscilla/ sub-path as GitHub Pages serves it'
summary: 'Serve the same file at /oscilla/ over HTTP and get the same application, with no absolute path that breaks under a sub-path.'
category: run
status: active
target: advisory
weight: 110
difficulty: basic
commands: [knowledge]
claims: [opens-from-file-and-subpath]
tags: [oscilla, product-acceptance]
---

# Situation

GitHub Pages publishes the repository at https://korczis.github.io/oscilla/, a sub-path
rather than a domain root. Anything the page resolved against `/` would break there and
nowhere else.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:browser` (tests/browser/app.cjs serves dist at http://127.0.0.1:<port>/oscilla/ with python3 -m http.server)

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
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Every browser check runs twice, from file:// and from a local `/oscilla/` sub-path, and
both pass. Whether the public page carries the expected version and commit is a separate
question that no canonical object answers yet (peer issues R003 and R005).
