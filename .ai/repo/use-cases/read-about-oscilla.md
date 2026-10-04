---
id: read-about-oscilla
kind: use-case
title: 'Read what OSCILLA is and how it was built'
summary: 'Choose About, the last navigation item, and learn the project''s origin, its commit-dated evolution, its engineering method and where its source and Majordomus live.'
category: about
status: active
target: advisory
weight: 120
difficulty: basic
commands: [knowledge]
claims: [about-is-last-workspace, about-provenance-matches-git, about-names-current-release]
tags: [oscilla, product-acceptance]
---

# Situation

A technically curious visitor wants to know, within a minute or two, what OSCILLA is, why it
exists, how quickly it was built, how the engineering stayed disciplined and what Majordomus
contributed, and then follow a link to the source.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run release-gate` (npm test, build, verify-dist, test:engine, test:browser)
- `npm test` (tests/unit/about.test.mjs, the provenance check against git)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
open the page. It proves the traceability instead: each claim's implementation and test are
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
  - id: about-is-last-workspace-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim about-is-last-workspace is implemented by src/index.html, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:about-is-last-workspace +implementation:src/index\.html']
  - id: about-is-last-workspace-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim about-is-last-workspace is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:about-is-last-workspace +test:tests/browser/app\.cjs']
  - id: about-provenance-matches-git-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim about-provenance-matches-git is proven by tests/unit/about.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:about-provenance-matches-git +test:tests/unit/about\.test\.mjs']
  - id: about-names-current-release-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim about-names-current-release is proven by tests/unit/about.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:about-names-current-release +test:tests/unit/about\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

About is the last navigation item in Chromium, Firefox and WebKit, from file:// and from the
/oscilla/ sub-path; it links exactly to https://github.com/korczis/oscilla,
https://majordomus.dev/ and mailto:korczis@gmail.com, and every time it states is a commit
time from the repository's own history. Its timeline names every published release line and
marks the line of the running build as current.
