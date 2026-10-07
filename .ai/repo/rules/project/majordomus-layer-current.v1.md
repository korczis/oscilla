---
id: project.majordomus-layer-current
version: 1
kind: rule
title: The local Majordomus and the .ai layer match the pinned version
description: A checkout runs the Majordomus version CI pins, the layer declares every policy key that version requires, and a version change follows one procedure.
statement: npm run verify refuses when the majordomus on PATH (the binary the git hooks run) differs from MJ_VERSION in .github/workflows/ci.yml, and names the migration procedure. The CI doctor verdict fails on a doctor line saying the policy lacks a required key, at any level, not only on FAIL. A version change migrates the layer on a branch under the new versioned binary until doctor reports no failure under both versions, lands by pull request, moves the pin and its digest, and only then does the owner flip the machine-wide launcher.
status: active
class: blocking
depends_on: []
tags: [majordomus, process, ci]
---

# Rationale

The git hooks run whatever `majordomus` the PATH resolves, for every session on the machine;
CI runs the version `.github/workflows/ci.yml` pins with a digest. When they differ, one
layer is judged by two tools.

- On 2026-10-03, during the v3.2.0 release, Majordomus 0.12.0 was installed machine-wide.
  The pre-commit doctor reported 433 failures in a layer CI accepted, and every session's
  commits were blocked until the layer was migrated (PR #64).
- Under 0.13.2 doctor printed "policy is missing required key
  knowledge.candidates_max_files" as a WARN. The CI verdict looked only at FAIL, so the gate
  passed while untracked knowledge candidates accumulated with no bound declared.

# Required behaviour

- The `majordomus` on PATH is the version in `MJ_VERSION`. A newer version is run by its
  versioned path until the launcher is flipped.
- A version change follows the procedure, in order: (1) on a branch, run the new versioned
  binary and migrate the `.ai/` layer until `doctor` reports 0 failures under both the pinned
  and the new version; (2) land that by pull request; (3) move `MJ_VERSION` and `MJ_SHA256`
  together, by pull request; (4) the owner flips the machine-wide launcher. Step 4 is the
  owner's: it changes the binary every session's hooks run.
- `.ai/repo/policy.yaml` declares every key the pinned version requires. A "missing required
  key" line is fixed in the policy, never waved through as a warning.

# Enforcement

- `scripts/majordomus-pin-check.mjs` reads `MJ_VERSION` from `.github/workflows/ci.yml`,
  compares it with `majordomus version`, and exits 1 with the procedure on a difference or
  when either cannot be read. `npm run verify` runs it immediately before `majordomus
  doctor`. It is a check of a developer checkout and CI does not run it; CI's own
  `knowledge` job installs the pinned archive by digest and tests that the installed version
  is the pinned one.
- `tests/unit/majordomus-pin.test.mjs`, run by `npm test` in the CI `unit` job, runs that
  script on fixture versions (a match passes; `MJ_VERSION` 0.12.0 against `majordomus
  0.13.2` exits 1 and prints the procedure) and asserts `npm run verify` chains it before
  doctor.
- `.github/doctor-verdict.jq`, the verdict of the CI `knowledge` job, fails on any doctor
  line whose message says the policy "declares no" or "is missing required key".
  `tests/unit/ci-knowledge-job.test.mjs` runs the verdict on the line doctor 0.13.2 printed
  for this repository, with no FAIL beside it, and asserts the policy declares the
  `knowledge:` block.

# Failure behaviour

`npm run verify` stops before doctor and prints both versions and the procedure. A policy
behind the pinned tool fails the `knowledge` job and so `gate`.

Not machine-checked: the pre-commit hook itself does not compare versions (it runs doctor,
which judges the layer with whatever binary it is); and the order of the procedure's steps
is a review matter. The launcher flip is owner-only and no session performs it.
