---
schema: adr/v1
id: adr-0045
kind: adr
title: The workspace is in navigation history; one hash dispatcher; an unsaved-work guard
status: proposed
date: 2026-10-06
tags:
  - workspace
  - navigation
  - url-state
  - data-loss
  - accessibility
related:
  - file:.ai/repo/adrs/0014-v1-behaviour-frozen-by-golden-vectors.md
  - rule:project.single-file-deliverable
  - rule:project.studio-model-is-canonical
  - rule:project.no-fake-science
  - file:src/js/ui/navigation.js
  - file:src/js/ui/unsaved.js
  - file:src/js/ui/app.js
  - file:src/js/main.js
  - file:src/js/core/url-state.js
  - file:src/js/core/url-state-measure.js
  - file:src/js/core/url-state-studio.js
  - file:src/js/ui/measure.js
  - file:src/js/ui/studio/workspace.js
  - file:docs/v4/completion-ledger.md
  - test:tests/unit/navigation.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/v4/completion-ledger.md
---

# 45. The workspace is in navigation history; one hash dispatcher; an unsaved-work guard

## Context

The v4 completion audit (ledger rows W2, P1, and W4, P2) found:

- **Silent data loss.** Nothing in `src/` listened for `beforeunload`. A reload, a closed tab
  or a Back past the page dropped unsaved Studio changes, a completed measurement that was
  not saved, and a level calibration (page memory only), without a question.
- **No history.** A workspace switch never touched the address. After twelve switches
  `history.length` was unchanged, Back left the application, and a reload always opened the
  Playground.
- **Split state.** The V1 `mode` and the V2 `workspace` were mapped from the hash in two
  places. The load path set both. The `hashchange` handler set only `mode`. So `#v=1&m=learn`
  set after load gave workspace `playground` with mode `learn` (the Learn panel showed inside
  the Playground). Copy config URL then wrote `m=learn` while the user was in the Playground.
- **Three hash routers.** `main.js` (the instrument), `measure.js` (the recipe `mr`) and
  `studio/workspace.js` (the Studio link) each listened to `hashchange` and each switched the
  workspace itself. Which one won depended on the order the listeners were added, and that
  order differed between load and `hashchange`. Copy config URL rewrote the whole hash and
  dropped `mr` and the Studio keys.

## Decision

Proposed:

- **The address names the workspace.** `m` carries any workspace id (`m=measure`,
  `m=analyzer`, `m=about`, …). It still accepts the V1 mode ids V1 links wrote (`sweep` →
  Playground, `dual` → Synthesis); the V1 codec ignores ids it does not know, as before. The
  V1 mode is never read from the hash on its own: it follows from the workspace and the
  source (`v1ModeFor`). So `mode` and `workspace` cannot disagree, at load or later.
- **One mapping, one precedence.** `ui/navigation.js` `routeOfHash` is the only place a hash
  becomes a workspace:
  1. The Studio keys (`m=studio`, `st` or `sv`) select Studio.
  2. Otherwise `m` selects the workspace it names.
  3. Otherwise a recipe link's `mr` selects Measure.
  4. Otherwise the workspace is the Playground.

  An in-page anchor (`#osc-main`, a fragment without `=`) is not a route.
  A hash carrying both `mr` and `m=studio` opens Studio. The recipe is still loaded into the
  Measure setup, and its notification says so: each domain applies its own keys whatever the
  route. If the route's owner refuses its keys (an invalid Studio link, or an invalid recipe
  link without `m`), no workspace changes, so "Nothing was changed" stays true.
- **One dispatcher.** The instrument, Measure and Studio no longer listen to the hash or
  switch workspaces. `main.js` registers their appliers with `navRegister(name, fn)`. The
  dispatcher runs them in the declared order `instrument, measure, studio`, then applies the
  route. It handles three origins:
  - *load*: the hash the page opened at.
  - *link*: a new hash in the page, typed, pasted or followed. Every domain applies its keys,
    then the entry is stamped with `history.state = { oscilla: 'workspace' }`.
  - *history*: Back or Forward to a stamped entry. Only the workspace changes. No domain
    re-applies its keys. A link's instrument values would otherwise overwrite settings changed
    since, or reopen a template over unsaved work.

  `popstate` and `hashchange` of one traversal are handled once.
- **One history entry per switch.** A watcher on `workspace` pushes `hashForWorkspace(hash,
  workspace)`, unless the address already names that workspace as the dispatcher left it.
  That covers load, link and history. The push keeps every other key (the instrument state,
  `mr`) and drops the Studio keys when the workspace is not Studio, because they would
  otherwise be a refused link on reload. `pushState` works from `file://` in Chromium, Firefox
  and WebKit (probed). Where it throws, a plain fragment assignment makes the entry and is
  recognised as the dispatcher's own write. The skip link's anchor is replaced in the address
  by the last state hash, so a reload still opens the workspace.
- **Copy config URL keeps the other domains' keys.** `configLinkHash` takes the instrument keys
  from the V1 `serializeHash`, keeps `mr`, the Studio keys and any other key, and sets `m` to
  the workspace. The V1 `serializeHash` and `restoreFromHash` are unchanged, because the
  golden vectors of ADR 0014 pin them. The recipe link now names `m=measure`. The Studio Copy
  link still writes only the Studio view (§200: "no huge state in URLs"). The three copy
  actions keep `history.state` when they replace the address.
- **Focus.** A workspace change the user did not make on a control (Back, Forward, a link)
  moves focus to the workspace heading: the heading its view is labelled by, the title of its
  first panel on the Playground grid, or the page heading. Script makes the heading focusable
  (`tabindex="-1"`). Focus never moves while a dialog is open. A nav click leaves focus on the
  control that was pressed, as before. Nothing is announced beyond the heading itself.
- **An unsaved-work guard that asks only when something would be lost.** `ui/unsaved.js`
  aggregates each domain's `whatWouldBeLost() -> [{ domain, label }]` and decides nothing
  itself. One reactive effect re-reads the domains. A `beforeunload` listener exists only
  while the list is non-empty. A clean page registers none, because browsers penalise an
  always-on handler (it costs the page the back/forward cache) and it must never ask on a
  clean page. The domains report:
  - Studio: unsaved changes (`studio.dirty`, the same flag as its "unsaved changes"
    indicator).
  - Measure: a completed measurement that is not saved (`state === COMPLETE && !saved`), shown
    as "unsaved result" in the Experiment panel with a sentence in the save hint.
  - Measure: a level calibration.

  Back and Forward between workspaces are same-document traversals and never fire
  `beforeunload`.
- **Calibrations.** A level calibration counts as losable work. It is measured with an
  external reference (a calibrator) and lives in page memory only, so a reload discards it. A
  frequency-response profile does not count, because its file can be imported again. No
  calibration persistence is built here. The help text that called it "a stored reference
  calibration" now says that it is kept in page memory only, and so does the level
  calibration dialog.

## Alternatives rejected

- **Keep three routers and order the listeners.** The order already differed between load
  and `hashchange`, and every new domain would have to know the others' keys.
- **The recipe (`mr`) wins over `m`.** Every address now carries `m`, so a recipe kept in the
  address while the user moves on would drag every reload back to Measure.
- **Re-apply every domain on Back / Forward.** That replays a link's instrument values over
  settings changed since and raises "Configuration restored from link" on every Back.
- **An always-on `beforeunload` that checks inside the handler.** The browser penalises the
  page for the listener itself, not for what it returns.
- **Moving focus to the workspace heading on a nav click as well.** The user is on the nav, and
  the existing keyboard model (roving tabs, groups that return focus to their button) relies
  on focus staying there.

## Consequences

- The address always says where the user is. A shared address reopens that workspace, and
  `history.length` grows by one per switch.
- `workbench.js` re-exports `v1ModeFor` and `workspaceForV1Mode` from `navigation.js`, where
  the one mapping lives.
- The domains' link appliers (`measureApplyRecipeHash`, `studioApplyLinkHash`) no longer take
  an origin or switch workspaces. Calling one directly applies its keys only.
- Confirmation criteria:
  - `tests/unit/navigation.test.mjs` covers the mapping and its precedence, anchors, the hash a
    switch writes, Copy config URL keeping `mr` and the Studio keys, and the guard holding one
    listener exactly while a source reports.
  - `tests/browser/navigation.cjs` covers the same in Chromium, Firefox and WebKit, from
    `file://` and `/oscilla/`, with the browsers' own beforeunload dialog.

  The browser checks fail on the build before this change: no listener and no dialog, Back
  leaves the page, a reload opens the Playground, `m=learn` after load leaves the workspace
  in the Playground, and Copy config URL drops `mr` and the Studio keys.
- Revisit this decision if a workspace needs state of its own in the address, such as a
  Studio subview on every switch. That state would belong to its domain's keys, never to `m`.
