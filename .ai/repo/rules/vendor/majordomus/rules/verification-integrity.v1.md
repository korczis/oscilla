---
id: majordomus.verification-integrity
version: 1
kind: rule
title: Verification integrity
description: Completion requires a verification command that actually ran and exited 0; its exit code and duration are recorded.
statement: A completed outcome requires a verification command that ran and exited zero, with its exit code and duration recorded.
status: active
class: blocking
depends_on: [majordomus.verify-outcomes@1]
tags: [verification, finish]

x-majordomus:
  validator: verification
  category: verification
  enforced_by: [finish]
  policy_key: verification_ran
  exit_code: 10
  claims: [finish-contract, typed-outcome]
  tests: [test/cases/19_end_to_end.sh]
---

# Rationale

Completion requires a verification command that actually ran and exited 0; its exit code and duration are recorded.

# Required behaviour

A completed outcome requires a verification command that ran and exited zero, with its exit code and duration recorded.

# Failure behaviour

A violation is a `FAIL` finding under the category `verification`, and the command that found it exits 10. Under `watch` the same violation is reported as drift and the command exits 11.

# Verification

`mj_validate_verification` decides it, dispatched from `finish`. The behavioural case `test/cases/19_end_to_end.sh` proves it, and CI runs that case.
