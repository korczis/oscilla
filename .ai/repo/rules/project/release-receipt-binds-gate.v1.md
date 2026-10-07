---
id: project.release-receipt-binds-gate
version: 1
kind: rule
title: The release-gate receipt binds everything the verdict depended on
description: The receipt release:prepare writes binds the version, the dist sha256, the source digest and a digest of every tracked file outside the release records, so any change on main between prepare and publish makes release:publish refuse until the gate is re-run.
statement: The release-gate receipt binds the version, the source digest, the sha256 of dist/index.html and gateTree, a digest of every tracked file except those under .ai/repo/releases/ and .ai/local/. release:publish refuses while any of the four differs from the checkout it runs in, so a change to tests, package.json, scripts, workflows, the .ai layer or source after the gate passed needs the full gate again before a tag is created.
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
  `--yes`, and refuses on any difference before it creates a tag.
- The two excluded directories are the only ones: `.ai/repo/releases/` holds the release
  records, written after a publish and landed by their own pull request, and `.ai/local/` is
  checkout-local state that is never tracked. A record landing between prepare and publish
  does not invalidate a receipt. Anything else does, a documentation change included: the
  rule does not guess which files the gate reads.
- A squash-merged `chore(release)` pull request whose tree equals the prepared tree verifies:
  the digest is over content, not over commits.
- After any other merge to main, run `npm run release:prepare` again on main. `package.json`
  already carries the untagged version, so it confirms it without a second bump, re-runs the
  full gate and writes a new receipt.
- Do not arm auto-merge on another pull request while a release is between prepare and
  publish. Nothing stops the merge; this rule makes the publish refuse afterwards.

# Enforcement

`scripts/release-prepare.mjs`: `computeGateTree()` hashes the content of every path of
`git ls-files` outside `GATE_TREE_EXCLUDE`, in the source digest's manifest format;
`currentFingerprint()` returns it as `gateTree`; `receiptProblems()` compares the keys of
`RECEIPT_KEYS`, of which `gateTree` is one. `scripts/release-publish.mjs` puts every problem
`receiptProblems()` returns among its preconditions and refuses on any of them.

`tests/unit/release-publish.test.mjs`, on a throwaway git repository:

- "the gate tree covers every tracked file except the release records": a change to a test,
  a workflow, a script, a rule or a new test file each gives `gate receipt gateTree … !=
  current …`; a change under `.ai/repo/releases/` still verifies.
- "publish refuses a receipt whose gate tree is not the current tree": the dry run and
  `--yes` both exit non-zero and nothing is tagged.
- "gate receipt must match version, source digest, dist bytes and gate tree": a receipt
  written before this rule, which has no `gateTree`, is refused.

Not enforced here: that nobody merges to main during a release. The rule makes such a merge
cost a second gate run instead of shipping untested.

# Failure behaviour

`release:publish` prints `BLOCKED gate receipt gateTree <receipt> != current <now>` and the
instruction to re-run `release:prepare`, and exits 1 without tagging. The fix is the gate, on
the tree that will be published; never an edited receipt.
