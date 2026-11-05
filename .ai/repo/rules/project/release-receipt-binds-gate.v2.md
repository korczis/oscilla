---
id: project.release-receipt-binds-gate
version: 2
kind: rule
title: A release is published only on a tree a gate verdict binds, local or CI
description: release:publish tags main's HEAD only when a gate verdict binds exactly its tree - the CI run of the release pull request (the CI receipt, ADR 0082) or the local release-gate receipt - so any change on main after the verdict makes the publish refuse.
statement: release:publish refuses unless one of two gate verdicts binds the tree of main's HEAD. The CI receipt (scripts/release-ci-receipt.mjs) holds when HEAD is the merge commit of a pull request whose head H contains the merge's base and has HEAD's tree, the newest CI pull_request run on H has completed with success on its latest attempt, every job .github/workflows/ci.yml declares (a matrix job once per value) is among that run's latest jobs on H with success and no other job is, and the committed roadmap matches the plan (OSC_ROADMAP_CHECK=1). The local receipt (release:prepare --local-gate) holds when it binds the version, the source digest, the sha256 of dist/index.html and gateTree, a digest of every tracked file except the release records .ai/repo/releases/v*.yaml and .ai/local/, all equal to the checkout's, and records browsers chromium,firefox,webkit, origins file,http and skips declared-only; release:prepare --local-gate refuses to start while OSC_BROWSERS or OSC_ORIGINS is set and runs the gate with OSC_STRICT_SKIPS=1. A fact that cannot be read is a refusal, never an empty answer.
status: active
class: blocking
depends_on: [project.single-file-deliverable@2]
tags: [release, gate, provenance]
x-majordomus:
  tests: [tests/unit/release-ci-receipt.test.mjs, tests/unit/release-publish.test.mjs, tests/unit/release-gate-env.test.mjs]
---

# Version 2 (ADR 0082, owner decision 2026-11-02)

The owner ordered "each fix is one version, deployed as app" on 2026-11-02, and the full local
gate (about an hour on the shared Mac, behind its load waits) became the release bottleneck.
CI already runs every suite of `npm run release-gate` on each pull request (`ci.yml`: every
browser, `file://` and `/oscilla/`, CI's strict skips, the visual gate, the `.ai` doctor), on
`refs/pull/<n>/merge`. For the release pull request that is the gate on exactly the tree that
lands, provided the head contained its base (strict branch protection makes it so; the receipt
checks it rather than assuming it). Version 2 accepts that run as a gate verdict for every
release; the owner chose it over patch-only.

## The CI receipt

`release:publish` judges it on main's HEAD when no local receipt verifies
(`gateVerdict()` in `scripts/release-publish.mjs`, `ciReceiptProblems()` in
`scripts/release-ci-receipt.mjs`):

- HEAD has two parents, base B and pull request head H (merge-commit landing);
- the tree of HEAD equals the tree of H, and B is an ancestor of H: CI merged H with a base
  no newer than B, which H contains, so the merge CI tested has H's tree;
- the newest run of the workflow named in `ci.yml` with event `pull_request` and
  `head_sha` H is `completed`/`success`; the run object reports its latest attempt, so a red
  re-run refuses, and an older green run never stands in for a newer one;
- the run's latest jobs (`filter=latest`) contain every job name `ci.yml` declares, each on H,
  in that run and `completed`/`success`; a missing, skipped or cancelled job refuses, and so
  does a job `ci.yml` does not declare. The names are derived from `ci.yml`, never listed by
  hand, and two jobs with one name refuse. One exemption (amended 2026-11-05, #417): the job
  with id `flake-ledger` whose `if:` is exactly `${{ always() && fromJSON(github.run_attempt) > 1 }}`
  (E010) may be `completed`/`skipped` when its own attempt is 1, since its condition skips it
  there by design; from attempt 2 on it must succeed like every other job. `ci.yml` must
  declare exactly one such job; any other skip still refuses;
- `node --test tests/unit/about-current.test.mjs` with `OSC_ROADMAP_CHECK=1` passes: the one
  check of the local gate that CI does not run.

Every fact is read through `gh api` and git; an unreadable one is a problem of its own.

`release:prepare` without flags runs `CI_PREPARE_COMMANDS` (the roadmap refresh, the build,
`version:check`, `npm run verify`, all with `OSC_ROADMAP_CHECK=1`) and writes no receipt;
`--local-gate` runs the version 1 gate and writes the local receipt. The `chore(release)`
pull request lands by merge commit (`gh pr merge --auto --merge`), and nothing else merges
before the publish: any later merge changes HEAD's tree and both verdicts refuse.

## Enforcement of version 2

`tests/unit/release-ci-receipt.test.mjs`, in `npm test`: the job list derived from the real
`ci.yml` (every matrix value, the visual gate, the doctor, `gate`); a valid fixture verifies,
and each of these refuses with its own problem: another tree, a head without its base, HEAD
not a merge, a missing, skipped, cancelled or foreign job, an undeclared job, two jobs with one
name, a re-run-only condition other than the exact one or on another job id, the flake ledger
cancelled, failed or running on attempt 1 or skipped on attempt 2 or later, a run on another
sha or event, a newer red or running run beside an older green one, a red latest attempt, the
roadmap check failing, and unreadable runs or jobs; the flake ledger skipped on its own first
attempt verifies (including a re-run of the gate alone, keyed on the job's own attempt), and
near-miss conditions (a bare expression, `> 0`, extra spaces, the condition on a step, a matrix
ledger) are not exempt. Each guard of `ciReceiptProblems()` is
mutation-proven (removing it fails a test). `gateVerdict()` takes a verified local receipt
without asking GitHub and otherwise reports both sets of problems.

Not enforced: that the CI workflow runs what `release-gate` runs. `tests/unit/main-checks.test.mjs`
and `tests/unit/ci-workflows.test.mjs` hold the jobs and their scripts; a suite added to
`release-gate` and not to CI would be released without having run.

# Version 1 (kept below, still in force for the local receipt)


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
- The gate runs everything, the way CI runs it. A suite narrows its browsers and origins by
  `OSC_BROWSERS` / `OSC_ORIGINS`, and outside CI it lets an undeclared skip pass with a
  printed line (`tests/browser/lib/suite.cjs`), so a tree-bound receipt alone could say
  "passed" for a gate that ran one browser (V272 D6: `OSC_BROWSERS=chromium npm run
  release:prepare` wrote `result: passed`). `release:prepare` therefore refuses to start
  while either variable is set (also as a dry run), runs every gate command with
  `OSC_STRICT_SKIPS=1` and without them, and writes `browsers`, `origins` and `skips`
  (`GATE_RUN`) into the receipt. `OSC_LOAD_MAX` and `OSC_LOAD_WAIT_MS` say when a suite may
  start, not what it runs, and stay allowed; CI itself is not switched on, so the load gate
  still holds the start on a busy machine.

# Enforcement

`scripts/release-prepare.mjs`: `computeGateTree()` hashes the content of every path of
`git ls-files` outside `GATE_TREE_EXCLUDE`, in the source digest's manifest format;
`currentFingerprint()` returns it as `gateTree`; `receiptProblems()` compares the keys of
`RECEIPT_KEYS`, of which `gateTree` is one, and reports a key that either side lacks.
`gateEnvProblems()` refuses the
narrowing variables, `gateEnv()` is the environment of the gate commands, and
`receiptProblems()` refuses a receipt whose `browsers`, `origins` or `skips` is absent or
differs from `GATE_RUN`. `scripts/release-publish.mjs` puts every problem
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

`tests/unit/release-gate-env.test.mjs` ("V272 D6"): `release:prepare --dry-run` through
`main()` with `OSC_BROWSERS=chromium`, an empty `OSC_BROWSERS`, the full list spelled out and
`OSC_ORIGINS=file` each refuses and changes nothing, while `OSC_LOAD_MAX` and
`OSC_LOAD_WAIT_MS` alone start; `gateEnv()` sets `OSC_STRICT_SKIPS` and leaves `CI` alone; a
suite run in that environment throws on a skip the README does not declare; a receipt with
`browsers: [chromium]`, `origins: [file]`, another `skips` or none of the three is refused.

Not enforced here: that nobody merges to main during a release. The rule makes such a merge
cost a second gate run instead of shipping untested. Not covered by the digest: file modes
(a file made executable with unchanged content) and untracked files, which the clean-tree
precondition of `release:publish` refuses separately.

# Failure behaviour

`release:publish` prints `BLOCKED gate receipt gateTree <receipt> != current <now>` (or
`gate receipt has no gateTree` for a receipt that predates this rule) and the
instruction to re-run `release:prepare`, and exits 1 without tagging. The fix is the gate, on
the tree that will be published; never an edited receipt.
