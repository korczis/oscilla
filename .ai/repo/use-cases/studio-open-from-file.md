---
id: studio-open-from-file
kind: use-case
title: 'Open Studio from file://'
summary: 'Double-click the single dist/index.html and use Studio offline, with nothing fetched.'
category: studio
status: active
target: advisory
weight: 430
difficulty: basic
commands: [knowledge]
claims: [studio-file-protocol]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone opens the downloaded `dist/index.html` from disk, without a network, and opens
**Studio** (specification §14 UC14). The application-wide use case `open-from-file` covers the
rest of the page.

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm run test:studio`: every check of tests/browser/v31-studio-graph.cjs runs from file://
  and its smoke checks from a /oscilla/ sub-path; tests/browser/v31-studio-timeline.cjs runs every
  check from both; each ends with no-console-errors, in Chromium, Firefox and WebKit.
- `npm run verify`: scripts/verify-dist.mjs refuses any resource reference, module script,
  fetch, XMLHttpRequest or dynamic import in dist/index.html (claim dist-self-contained).

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not open a browser or play audio. It proves the
traceability instead: each claim's implementation and test are tracked files wired to the
claim in the knowledge graph, so a renamed or deleted test breaks this use case rather than
silently orphaning the claim. The behaviour itself is proven by the commands above, which the
release gate runs and CI blocks a merge on.

# What it cannot prove

From file:// the browser's storage may be unavailable; the Studio library then keeps
projects and patches in memory for this page view and says so. A deep link opens a shipped
template, never a stored project; browser fullscreen is optional and absent on some browsers
(Safari on iPhone).

# Scenario

```yaml
mode: live
steps:
  - id: studio-file-protocol-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-file-protocol is implemented by src/js/ui/studio/workspace.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-file-protocol +implementation:src/js/ui/studio/workspace\.js']
  - id: studio-file-protocol-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-file-protocol is proven by tests/browser/v31-studio-graph.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-file-protocol +test:tests/browser/v31-studio-graph\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Studio works from `file://` and from the Pages sub-path with no console error, inside the
one file that loads nothing at runtime.
