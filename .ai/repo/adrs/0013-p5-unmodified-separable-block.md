---
schema: adr/v1
id: adr-0013
kind: adr
title: p5.js (LGPL-2.1) ships as an unmodified, separately identifiable script block with its licence notice
status: accepted
date: 2026-10-02
tags:
  - dependencies
  - licensing
  - build
provenance:
  origin: authored
---

# 13. p5.js (LGPL-2.1) ships as an unmodified, separately identifiable script block with its licence notice

## Context

The conceptual views (waveform, signal path, interference) are p5.js sketches carried over from
V1. p5.js is LGPL-2.1; Alpine.js and uPlot are MIT, Lucide is ISC. Bundling p5 into the minified
app script would merge it with first-party code, so a recipient could not identify or replace the
library, which the LGPL requires to remain possible for a combined work. A single-file artifact
(ADR 0011, ADR 0012) has no separate `.js` file to point at.

## Decision

- `scripts/build-config.mjs` lists p5 in `VENDOR_SCRIPTS`: its official `p5/lib/p5.min.js` is
  emitted byte-for-byte as its own classic `<script data-vendor="p5@1.11.3" data-sha256="…">`,
  before the app script, and the app reaches it through `window.p5` (the `vendor-globals` esbuild
  plugin), never through a bundled copy.
- The third-party notice, an HTML comment after the doctype, carries every contained package's
  name, version, licence and full licence text; for p5 it states that the block is unmodified,
  may be replaced by any compatible build, and where its source is. Packages that ship no licence
  file (alpinejs) take the upstream text from `licenses/`.
- `verify-dist` fails when the vendor block is not byte-identical to the pinned package file or
  when a notice is missing.

## Alternatives rejected

- Bundle and minify p5 with the app: smaller by little, and the library becomes neither
  identifiable nor replaceable.
- Drop p5 and redraw the conceptual views on raw canvas: a rewrite of working V1 drawing code for
  no user-visible gain (renderer split in ADR 0016).
- Load p5 from a CDN: violates ADR 0012.

## Consequences

- p5 is the largest single contributor to the artifact (about 1.03 MiB raw, 244 KiB gzip).
- Upgrading p5 is a version bump in `package.json`; the build re-derives the block, hash and
  notice. Patching p5 in place is not possible without abandoning this decision.
- New vendor libraries with copyleft licences follow the same pattern; permissive ones are
  bundled.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: p5 is the budget's largest line, and replacing it is deferred

When the dist budget was raised to 1 000 000 B gzip / 3 500 000 B raw (#114, owner decision
2026-10-05, a stopgap; see the note on ADR 0012), replacing p5 was named as the alternative
and deferred: p5 is about 245 KB of the gzip while the views call about 28 of its 2D drawing
functions. This decision stands until that replacement is decided; it would supersede the
first rejected alternative above.

### 2026-10-18: accepted by the owner

Accepted by the owner (explicit instruction in the session of 2026-10-18, applied by the
coordinating Claude session) — implemented as described; evidence: the verbatim `<script
data-vendor="p5@1.11.3" data-sha256=…>` block in `dist/index.html` from `VENDOR_SCRIPTS` in
`scripts/build-config.mjs`, its byte identity and the notices checked by
`scripts/verify-dist.mjs` (`tests/unit/verify-dist.test.mjs`); replacing p5 stays deferred (its
2026-10-05 note).

### 2026-10-18: what replacing p5 would cost

Measured for the owner by plan issue E012; it decides nothing, and the decision above stands.
The measurements ran on the spike branch `spike/p5-canvas2d`, which is never opened for merge:
`e710fe1c1f55` adds only the measuring harness (its `dist/index.html` is main's at `50f6d6c`,
p5 included); `3ab180ba5424` swaps p5 for a Canvas2D adapter (`b57d41b57368`) and rebuilds.
One Mac (Apple M5 Pro, Chromium 153, Playwright 1.63.0) under a 1-minute load of 60 to 108.

- **Inventory.** The p5 instance API the app reaches is 45 members, in eight files under
  `src/js`: `visualization/p5-host.js` and the views it hosts (`visualization/waveform.js`,
  `phase.js`, `signal-path.js`; `ui/p5-views.js`, scope and harmonic bars), `charts/phase-view.js`
  and `charts/lissajous.js` (Phase & Stereo), and `visualization/visualization-bridge.js` (the
  loop): 22 drawing calls (`background` `clear` `color` `fill` `noFill` `stroke` `noStroke`
  `strokeWeight`, `beginShape` `vertex` `endShape` `line` `rect` `circle` `bezier`
  `bezierPoint`, `text` `textAlign` `textFont` `textSize` `textStyle` `textWidth`); 9
  lifecycle calls (`createCanvas` `resizeCanvas` `pixelDensity` `frameRate` `millis` `loop`
  `noLoop` `redraw` `remove`); 4 properties (`canvas` `drawingContext` `width` `height`); the
  `setup`/`draw` hooks; 8 constants (`LEFT` `RIGHT` `CENTER` `BASELINE` `BOTTOM` `NORMAL`
  `BOLD` `CLOSE`); plus `new p5(sketch, node)` and `p5.Color`'s `toString()` and
  `setAlpha()`. Command, on main at `50f6d6c`: `cd src/js && grep -ohE
  '\b(p|inst|instance)\.[A-Za-z_]+\b' visualization/{p5-host,waveform,phase,signal-path}.js
  ui/p5-views.js charts/{phase-view,lissajous}.js visualization/visualization-bridge.js | sed
  -E 's/^[a-z]+\.//' | sort -u` (45 lines).
- **Size.** The adapter (`src/js/visualization/canvas2d-p5.js`, 454 lines, which mirrors p5
  1.11's Renderer2D for exactly those calls) is 7 814 B minified, 2 758 B gzip on its own.
  `dist/index.html` goes from 2 817 241 B raw / 815 357 B gzip at `e710fe1c1f55` to
  1 742 881 B / 559 124 B at `3ab180ba5424`: **256 233 B gzip saved** (31.4 %; 1 074 360 B
  raw), above the 180-230 KB adoption threshold of conversation 6ac3ead5, section 7. Command
  at each commit: `npm run build && node scripts/verify-dist.mjs` (it prints 796.2 KiB and
  546.0 KiB gzip against the `BUDGET` of `scripts/build-config.mjs`); the exact bytes are
  `gzipSync(html, { level: 9 })`, as `verify-dist` computes them.
- **Visual difference per view.** `npm run test:visual` passes at `3ab180ba5424` (gate 13
  regions, MEASURE 2 views, Studio 5 views). Against the p5 build (`node
  scripts/visual-gate.mjs <dist of e710fe1c1f55>`) every region's mismatch is identical except
  the two that show p5 views: `analysis` (scope) 15.46 % data in both, and `phase` 10.75 % (p5)
  vs 11.01 % (adapter), which moves 3-3.5 % between runs anyway. Per view (`node
  scripts/p5-view-shots.mjs shoot <dist> <dir>` for each build, then `compare`): scope,
  waveform, signal path, interference and harmonic bars are pixel-identical (0 of 69 540 px);
  Phase & Stereo differs by 2.24 %, inside its own run-to-run difference (2.29 % p5 vs p5,
  2.25 % adapter vs adapter), because it animates.
- **Frame time.** `npm run test:perf -- --frame-time --frame-batch 50 --only frame-time` at
  `3ab180ba5424`, and with `--dist <dist of e710fe1c1f55>` for p5, three interleaved runs each;
  ms per frame (batches of 50 redraws plus a 1-pixel read-back), median of the three run
  medians, p5 → adapter. Chromium: scope 0.210 → 0.186, waveform 0.162 → 0.142, signal path
  0.096 → 0.072, interference 0.893 → 0.784, harmonic bars 0.044 → 0.042, Phase & Stereo
  0.087 → 0.040. WebKit: 0.32 → 0.24, 0.10 → 0.08, 0.14 → 0.12, 0.38 → 0.27, 0.06 → 0.04,
  0.26 → 0.20. Firefox runs were too noisy on this machine to read (interference 4.07-11.91 ms
  with p5, 1.22-5.51 ms with the adapter). Every view stays under 1 ms a frame in Chromium and
  WebKit either way, so frame time is no reason for or against. Startup, one run each (`npm
  run test:perf -- --measure-only --only startup`): Chromium 257.3 → 198.2 ms, Firefox 738 →
  479 ms, WebKit 283 → 277 ms.
- **Cost beyond the bytes.** The adapter becomes first-party code to own and test: the spike
  has no unit tests of it, nor a parity check in CI. `scripts/verify-deploy.mjs` requires the
  `data-vendor="p5@` marker, so two release-provenance tests fail at `3ab180ba5424` (every
  other unit test passes; two timing tests that failed under the load passed on a re-run);
  `verify-dist`'s vendor check, the p5 notice and this decision's replaceability guarantee
  would be retired; a view that needs a p5 call outside the 45 adds it to the adapter first.
  Adopting it supersedes this decision and the first rejected alternative, the owner's call.
