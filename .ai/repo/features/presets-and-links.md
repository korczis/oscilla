---
schema: feature/v1
id: presets-and-links
kind: feature
title: 'Save presets and share configurations as links'
short_title: 'Presets and links'
headline: 'Keep the setups you use, and send any setup to someone else as a link.'
summary: 'Built-in presets with technical descriptions, saved presets in local storage, and the whole instrument state encoded in a `#v=1&...` link restored through one validated path.'
status: stable
weight: 120
featured: false
rules: [project.no-fake-science]
docs: [README.md]
adrs: [adr-0023]
claims: [link-restores-configuration, presets-save-and-load]
use_cases: [round-trip-a-configuration]
related: [export]
tags: [sharing, v2]
---

## What it does

`src/js/core/url-state.js` encodes and decodes the link, `src/js/core/config.js` validates
every incoming configuration, `src/js/core/storage.js` persists presets with a schema version
and a migration hook (ADR 0023), and `src/js/data/presets.js` holds the built-in presets.

## What it does not do

Nothing is stored on a server: presets live in the browser's local storage and a link carries
the state itself. Blocked storage degrades to a notice, never to an error.
