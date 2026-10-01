---
id: majordomus.roadmap-integrity
version: 1
kind: rule
title: The roadmap is a projection, never a document
description: No document is a second authority for the roadmap. While a hand-written roadmap table exists, it can neither list a version no milestone declares nor hide one the model does.
statement: No document is a second authority for the roadmap; a hand-written table can neither list a version no milestone declares nor hide one the model does.
status: active
class: blocking
depends_on: [majordomus.define-done-first@1]
tags: [plan, roadmap]

x-majordomus:
  validator: roadmap
  category: roadmap
  enforced_by: [doctor, watch]
  exit_code: 10
  claims: [roadmap-derived]
  tests: [test/cases/49_roadmap_doctrine.sh]
---

# Rationale

No document is a second authority for the roadmap. While a hand-written roadmap table exists, it can neither list a version no milestone declares nor hide one the model does.

# Required behaviour

No document is a second authority for the roadmap; a hand-written table can neither list a version no milestone declares nor hide one the model does.

# Failure behaviour

A violation is a `FAIL` finding under the category `roadmap`, and the command that found it exits 10. Under `watch` the same violation is reported as drift and the command exits 11.

# Verification

`mj_validate_roadmap` decides it, dispatched from `doctor, watch`. The behavioural case `test/cases/49_roadmap_doctrine.sh` proves it, and CI runs that case.
