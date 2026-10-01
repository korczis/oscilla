---
id: majordomus.bootstrap-integrity
version: 1
kind: rule
title: Bootstrap integrity
description: The path from a human reader to the AI layer is unbroken — README.md names AGENTS.md, every generated instruction file points at .ai/README.md, and none of them carries a rule of its own.
statement: A person reaches the AI layer through README.md and AGENTS.md, every generated instruction file points at .ai/README.md, and none of them carries a rule of its own.
status: active
class: blocking
depends_on: [majordomus.minimum-sufficient-context@1]
tags: [bootstrap, projection]

x-majordomus:
  validator: bootstrap
  category: bootstrap
  enforced_by: [doctor, watch]
  exit_code: 10
  claims: [projection-generation, context-budget, bootstrap-chain]
  tests: [test/cases/03_update.sh]
---

# Rationale

The path from a human reader to the AI layer is unbroken — README.md names AGENTS.md, every generated instruction file points at .ai/README.md, and none of them carries a rule of its own.

# Required behaviour

A person reaches the AI layer through README.md and AGENTS.md, every generated instruction file points at .ai/README.md, and none of them carries a rule of its own.

# Failure behaviour

A violation is a `FAIL` finding under the category `bootstrap`, and the command that found it exits 10. Under `watch` the same violation is reported as drift and the command exits 11.

# Verification

`mj_validate_bootstrap` decides it, dispatched from `doctor, watch`. The behavioural case `test/cases/03_update.sh` proves it, and CI runs that case.
