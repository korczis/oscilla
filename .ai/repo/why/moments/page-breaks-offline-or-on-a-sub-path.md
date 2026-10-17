---
schema: moment/v1
id: page-breaks-offline-or-on-a-sub-path
kind: moment
title: 'A lab page that breaks offline or on a sub-path'
short_title: 'Page needs a network'
hook: 'opened a sound lab page in a classroom or from a download and it needed a network or a server it did not have'
summary: 'A page that loads its scripts from CDNs, fetches sibling files or resolves paths against the domain root works on the developer''s machine and fails from disk, offline, or under the GitHub Pages sub-path.'
status: stable
severity: medium
frequency: occasional
weight: 130
audiences: [teachers, students, maintainers]
areas: [delivery]
lifecycle: [operations, maintenance]
tags: [offline, file-protocol, single-file, sub-path]
signals:
  - id: blank-from-disk
    text: 'A downloaded page opened from disk showed a blank screen or console errors.'
  - id: worked-yesterday
    text: 'The page behaved differently because a CDN served something else that day.'
  - id: broke-on-pages
    text: 'A page worked at a domain root and broke under a repository sub-path.'
examples:
  - id: classroom-no-network
    audience: teachers
    title: 'The lecture-room computer has no network'
    before: 'The page loads Tailwind, Flowbite, p5.js and Alpine.js from three CDNs and stays blank without a network.'
    after: 'One dist/index.html with every style and script inlined, which loads nothing at runtime and works from file://.'
  - id: measure-from-disk
    audience: students
    title: 'Measure from a downloaded file'
    before: 'An AudioWorklet module from a blob: URL fails from file:// in Chromium, so the capture never starts.'
    after: 'Worklets and the analysis Worker load from data: URLs, so Measure and Studio work from file:// as they do on the web.'
  - id: root-relative-path
    audience: maintainers
    title: 'A path against /'
    before: 'Anything resolved against the root breaks at https://korczis.github.io/oscilla/ and nowhere else.'
    after: 'The release gate loads the built page from file:// and from a /oscilla/ sub-path in Chromium, Firefox and WebKit, with zero console errors.'
claims: [dist-self-contained, opens-from-file-and-subpath, measure-from-file-and-subpath, studio-file-protocol, single-file-build]
doctrines: [project.single-file-deliverable]
use_cases: [open-from-file, open-measure-from-file, studio-open-from-file, open-under-the-oscilla-sub-path]
related: [published-page-is-not-the-released-bytes]
aliases: ['offline', 'file protocol', 'CDN dependency', 'GitHub Pages sub-path']
---

## The moment

The demonstration is ready on a laptop with a network. On the lecture-room machine, from a
USB stick, it is a blank page.

## Why it happens

V1 loaded its libraries from three CDNs, so opened from `file://` it still needed a network and
its behaviour depended on what the CDNs served that day. A `file://` document has an opaque
origin: module scripts, `fetch` of sibling files and, in Chromium, AudioWorklet modules from
`blob:` URLs fail there ([ADR 0012](../../adrs/0012-self-contained-runtime.md)).

## What it costs

A lesson without its demonstration, and a measurement that cannot be taken on the machine that
has the microphone.

## What OSCILLA does

Source is modular; the runtime is one file. `npm run build` packs everything into
`dist/index.html` deterministically, with no runtime fetch, no module script, no worker or
worklet loaded from a path and no root-relative asset path
([ADR 0011](../../adrs/0011-modular-source-one-committed-dist.md), rule
`project.single-file-deliverable`).

## How to verify it

`npm run verify` checks the built page (claims `single-file-build`, `dist-self-contained`); the
release gate's browser suites boot it from `file://` and `/oscilla/` in three engines (claims
`opens-from-file-and-subpath`, `measure-from-file-and-subpath`, `studio-file-protocol`).

## What it does not do

It does not make the browser's storage available from `file://`: where it is not, the Studio
library uses memory and says so. And it does not remove the browser's own limits: where
AudioWorklet is unavailable, a ScriptProcessor fallback records instead.
