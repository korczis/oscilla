---
id: project.release-receipt-binds-gate
version: 1
kind: rule
title: The release-gate receipt binds everything the verdict depended on
description: The receipt release:prepare writes binds the version, the dist sha256, the source digest and a digest of every tracked file except the release record files, so any change on main between prepare and publish makes release:publish refuse until the gate is re-run.
statement: The release-gate receipt binds the version, the source digest, the sha256 of dist/index.html and gateTree, a digest of every tracked file except the release records .ai/repo/releases/v*.yaml and .ai/local/. release:publish refuses while any of the four differs from the checkout it runs in or is absent from the receipt or from the current fingerprint, so a change to tests, package.json, scripts, workflows, the .ai layer or source after the gate passed needs the full gate again before a tag is created.
status: active
class: blocking
depends_on: [project.single-file-deliverable@2]
tags: [release, gate, provenance]
x-majordomus:
  tests: [tests/unit/release-publish.test.mjs]
---

# Rationale

A receipt says "the gate passed for this". Until this rule it bound the version, the dist
bytes and the source digest, and the source digest covers the build inputs only: `src/`,
`licenses/`, the build scripts, `package.json`. The gate's verdict depends on much more: the
tests it runs, the scripts that run them, the workflows, the `.ai` layer `majordomus doctor`
reads.

2026-10-06: pull requests #144 and #147 (new WebKit CI jobs, un-skipped About provenance
tests) merged after the v3.10.3 gate had run. The receipt still verified, because neither
touched a build input, and the release was published on a tree whose tests the gate had never
run. 2026-10-04: #76 and #77 were armed for auto-merge during the v3.3.0 gate and had to be
disarmed by hand, because nothing would have noticed them landing.

# Required behaviour

- `release:prepare` writes `gateTree` into the receipt with the other three values, computed
  after the gate passed, over the working tree (so the bump it gated is included).
- `release:publish` compares all four with the checkout it runs in, as a dry run and with
  `--yes`, and refuses on any difference before it creates a tag. A value that is absent, or
  not a non-empty string, is a difference, on the receipt and on the current fingerprint
  alike: two fingerprints that both lack `gateTree` are both unbound, not equal.
- The two exclusions are the only ones: the release record files
  `.ai/repo/releases/v<version>.yaml`, written after a publish and landed by their own pull
  request, and `.ai/local/`, checkout-local state that is never tracked. A record landing
  between prepare and publish does not invalidate a receipt. Anything else does, a
  documentation change included, and so does any other file under `.ai/repo/releases/` (its
  README, a subdirectory): the rule does not guess which files the gate reads.
- A squash-merged `chore(release)` pull request whose tree equals the prepared tree verifies:
  the digest is over content, not over commits.
- After any other merge to main, run `npm run release:prepare` again on main. `package.json`
  already carries the untagged version, so it confirms it without a second bump, re-runs the
  full gate and writes a new receipt; unless the merge raised the required level (a `feat`
  landing after a patch bump), in which case it bumps again and the release needs a new
  `chore(release)` pull request.
- Do not arm auto-merge on another pull request while a release is between prepare and
  publish. Nothing stops the merge; this rule makes the publish refuse afterwards.

# Enforcement

`scripts/release-prepare.mjs`: `computeGateTree()` hashes the content of every path of
`git ls-files` outside `GATE_TREE_EXCLUDE`, in the source digest's manifest format;
`currentFingerprint()` returns it as `gateTree`; `receiptProblems()` compares the keys of
`RECEIPT_KEYS`, of which `gateTree` is one, and reports a key that either side lacks.
`scripts/release-publish.mjs` puts every problem
`receiptProblems()` returns among its preconditions and refuses on any of them.

`tests/unit/release-publish.test.mjs`, on a throwaway git repository:

- "the gate tree covers every tracked file except the release records": a change to a test,
  a workflow, a script, a rule, a new test file, the README of `.ai/repo/releases/` or a file
  in a subdirectory of it each gives `gate receipt gateTree … != current …`; a changed or new
  `.ai/repo/releases/v*.yaml` still verifies.
- "currentFingerprint binds every receipt key, and a test changed after the gate refuses":
  the real `currentFingerprint()` on a committed fixture checkout returns every key of
  `RECEIPT_KEYS`; after a test file changes, the source digest and the dist sha are unchanged
  and `receiptProblems()` names `gateTree` and this rule.
- "publish computes the fingerprint itself and refuses a tree changed after the gate":
  `publish()` with no injected fingerprint on that checkout.
- "a key missing on both sides never verifies a receipt": for each key, a receipt and a
  fingerprint that both lack it are refused.
- "publish refuses a receipt whose gate tree is not the current tree": the dry run and
  `--yes` both exit non-zero and nothing is tagged.
- "gate receipt must match version, source digest, dist bytes and gate tree": a receipt
  written before this rule, which has no `gateTree`, is refused.

Not enforced here: that nobody merges to main during a release. The rule makes such a merge
cost a second gate run instead of shipping untested. Not covered by the digest: file modes
(a file made executable with unchanged content) and untracked files, which the clean-tree
precondition of `release:publish` refuses separately.

# Failure behaviour

`release:publish` prints `BLOCKED gate receipt gateTree <receipt> != current <now>` (or
`gate receipt has no gateTree` for a receipt that predates this rule) and the
instruction to re-run `release:prepare`, and exits 1 without tagging. The fix is the gate, on
the tree that will be published; never an edited receipt.
