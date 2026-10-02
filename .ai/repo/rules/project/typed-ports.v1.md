---
id: project.typed-ports
version: 1
kind: rule
title: Studio connections are typed and validated before the runtime changes
description: Every Studio connection is checked by the pure model compatibility and graph validation before any Web Audio or measurement object is created, connected or disconnected.
statement: A Studio edge reaches the runtime only after canConnect and validateStudioModel accept the whole resulting model; every port declares a type (AUDIO, CONTROL, TRIGGER, ANALYSIS) and a role, compatibility is decided by model logic and never by the DOM or by Web Audio, and every rejection carries a sentence the user can read.
status: active
class: blocking
depends_on: [project.audio-engine-discipline@2]
tags: [studio, graph, v31]
---

# Rationale

V3.1 specification §31-§38 and §46; ADR 0032 and ADR 0035. Web Audio accepts nearly any
connect() call and fails silently or audibly when the topology is wrong; letting it discover
an invalid graph means a half-connected runtime and a model that no longer describes it.

# Required behaviour

- Ports are declared in the node registry (`src/js/studio/registry.js`, `ports.js`) with a
  type and a role; an edge's signal type is derived from its ports and never stored.
- `canConnect(source, target)` is pure model logic returning `{ allowed, reason }`. The
  editor, the accessible connection dialog, paste, patch load and import all use it; none
  carries its own compatibility table.
- A semantic action is reduced and the whole result validated before the store commits it;
  the graph compiler (issue V414) and the incremental patcher (V415) receive only a model
  that validated, and they validate a transaction before they touch the running graph.
- A rejection leaves model, history, selection, revision and runtime unchanged and reports
  the reason ("Audio output cannot connect to a trigger input.").
- Untrusted input (patch, Studio file, clipboard, URL state) passes the import pipeline
  (size cap, structural scan, depth, counts, strict schema, normalize, validate) before any
  of it reaches the model.
- Node creation and connection in the runtime stay inside AudioEngine accounting
  (`project.audio-engine-discipline` v2, on which this rule depends).

# Failure behaviour

A review rejection; any path that connects runtime nodes from an edge the model did not
validate fails the rule regardless of whether the result sounds right.

# Verification

`tests/unit/v31-studio-model.test.mjs`: the compatibility matrix, role checks, wrong
direction, self connection, single-input ports, the rejected EDGE_ADD that leaves the store
unchanged, and malicious or oversized import rejected. Planned (V414, V415, V430): the
compiler and patcher refuse an invalid transaction and keep the last valid runtime graph.
