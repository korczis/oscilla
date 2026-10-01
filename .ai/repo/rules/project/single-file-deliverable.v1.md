---
id: project.single-file-deliverable
version: 1
kind: rule
title: Single-file deliverable
description: The whole application is index.html; it runs from file:// and from GitHub Pages with CDN libraries only.
statement: All application code, styles, presets and tooling live in index.html; nothing the application loads is a local file, and nothing in it needs a server or a build step.
status: active
class: blocking
depends_on: []
tags: [deliverable, deployment]
---

# Rationale

Specification section 1 requires exactly one runnable file. Opening it directly (`file://`) and
serving it from GitHub Pages must behave the same.

# Required behaviour

- index.html contains the HTML, styles, Tailwind configuration, Alpine state, Web Audio engine,
  p5 sketch, presets, helpers and debug tooling.
- Libraries load from CDNs only: Tailwind CSS (Play CDN), Flowbite, Alpine.js, p5.js. No audio
  framework (Tone.js, Howler.js) — the native Web Audio API is the engine.
- Nothing needs a server: no local ES module imports, no `fetch` of local files, no service worker.
- Repository tooling (`.ai/`, `.claude/`, `tests/`, Markdown) is never published; the Pages
  deployment ships index.html alone.

# Failure behaviour

A second application file, a build step or a server dependency is a review rejection.

# Verification

The headless smoke test loads index.html from `file://` and from the deployed URL with zero
console errors.
