---
id: project.no-inert-surfaces
version: 1
kind: rule
title: No placeholder copy, no mockup data and no inert control
description: Nothing a user can be shown is placeholder copy, no control is disabled without a stated reason, and every data-osc control in the running page has a handler registered for it; the matches that predate the rule are listed with a reason each, and that list only shrinks.
statement: No text OSCILLA can show is placeholder copy (TODO, FIXME, TBD, lorem ipsum, coming soon, not implemented, mock or mockup, placeholder, dummy, fake or sample data, work in progress, under construction), apart from the legitimate matches named here; no control in src/index.html is disabled or aria-disabled without a title, aria-describedby or aria-description on it that states why; and no data-osc control in the running page, in any workspace, Studio selection or Studio node type, is left without a handler registered for it or an effect the browser gives it. The matches that predate the rule are listed in tests/unit/no-inert-surfaces-allowance.json with a reason each, and no entry of that list may rise above, or return after, its value in an earlier commit. Whether a value shown as data comes from a literal rather than from state, and whether a sentence is placeholder copy in substance, stays with the reviewer.
status: active
class: blocking
depends_on: []
tags: [content, ui, tests]
---

# Rationale

The owner's standing instruction (ChatGPT project conversation 6ac1beb8, 2026-10-04T03:01:41Z):
no hard-coding, mockups or placeholders, old or new; everything connected, interactive,
integrated and covered by tests. Before it, in conversation 6abec18d (2026-10-01T21:52:21Z,
specification section 74): "NO FAKE DATA: the mockup fixes UI geometry, never values" and
"every control does something real". `project.no-fake-science` bans invented science; nothing
banned a placeholder, a control that does nothing, or a control that is disabled and does not
say why (the completion ledger's W6, `docs/v4/completion-ledger.md`).

The rule holds what a mechanism can decide and names what it cannot. A static scan of
`src/index.html` cannot tell whether a control does something: 111 of its 341 form controls
had no Alpine binding when the engineering-integrity critique counted them (at 0761335), being
bound from `src/js` by id or `data-osc`, and the Studio Inspector's controls exist only in
JavaScript. So the inert-control check runs in the browser, on the page as it runs.

# Required behaviour

- **(a) No placeholder copy.** What a user can be shown is `src/index.html` (its text and its
  attribute values; not its comments, not attribute names), the string literals of every
  module under `src/js` (not the comments), and the stylesheets under `src/styles` (without
  their comments). None of it says TODO, FIXME, TBD, lorem or ipsum, coming soon, not (yet)
  implemented or unimplemented, mock, mocks, mocked or mockup, placeholder, dummy, fake data
  (or values, readings, results), sample data, work in progress or WIP, or under
  construction, matched as words without regard to case. The legitimate matches on the tree
  when the rule was written are allowed by name, each with its count:
  - the MEASURE flow-step status value `todo` (a step not started) in `src/index.html`,
    `src/js/measurement/views/measure-flow.js` and the class `.is-todo` of
    `src/styles/measure.css`; it is compared and styled, and announced as "not started";
  - the `?mock=1` layout-comparison mode in `src/js/ui/app.js` and `src/styles/base.css`, the
    geometry-only mockup the owner allowed: it outlines the renderer hosts and shows no value;
  - the honest status text "not implemented by this build" in
    `src/js/experiments/evidence.js`, which says that an experiment names an analysis
    algorithm this build does not know;
  - the HTML `placeholder` attribute of an input, which is an attribute name and not copy:
    attribute names are not read, a string literal that is only the attribute name
    (`setAttribute('placeholder', …)`) is not read, and neither are the `::placeholder` and
    `:placeholder-shown` selectors. The attribute's value is copy and is read.
- **(b) No disabled control without a stated reason.** A start tag of `src/index.html` that
  carries `disabled` or `aria-disabled` (static, `:` or `x-bind:` bound; `aria-disabled="false"`
  excepted) carries a `title`, `aria-describedby` or `aria-description` (static or bound) that
  says why. A reason shown as text beside the control counts once the control points at it
  with `aria-describedby`.
- **(c) No inert control.** Every element with a `data-osc` attribute that is a control (a
  button, an input that is neither hidden nor read-only, a select, a textarea that is not
  read-only, a summary, a link, or an element with an interactive role) has, in the running
  page, a listener of any type registered on it, an `on…` handler property, or an effect the
  browser gives it: a link's navigation, a summary's toggle, the submit of a dialog form or of
  a form with a submit listener. A read-only field is an output. A control handled by a
  listener on an ancestor (delegation), or one whose value another control reads, is listed
  with that reason; the check does not follow delegation.
- **The allowance.** Every match the checks accept is an entry of
  `tests/unit/no-inert-surfaces-allowance.json` with a reason of at least three words: for (a)
  and (b) a count per file and key, for (c) the `data-osc` value. The tree holds exactly what
  the allowance lists: a match beyond it fails, and an entry the tree no longer needs fails
  until it is lowered or removed, so fixing a violation removes its entry in the same change.
  No entry may rise above its value in an earlier commit that changed the file, and an entry
  that was removed may not return.
- **Fixing a listed violation changes behaviour.** Each fix of a W6 or inert entry is its own
  pull request, with its own visual-reference acceptance; it is not a refactor.
- **What stays with the reviewer.** A value shown as data that comes from a literal rather
  than from state cannot be decided statically: cited constants such as the nominal 20 Hz to
  20 kHz convention are literals on purpose, so whether a literal is shown as if it were a
  measured or computed value stays with the reviewer. So does whether a sentence is
  placeholder copy in substance without using one of the words above ("details to follow"),
  whether a stated reason is a reason (a `title` that only repeats the label passes the
  scan), and whether a handler does something real (a listener that does nothing passes
  check (c)).

# Enforcement

`tests/unit/no-inert-surfaces.test.mjs`, run by `npm test` (so by the CI `unit` job), holds
(a), (b) and the allowance. Its failures start with `project.no-inert-surfaces:`.

- "src holds exactly the placeholder copy and reasonless disabled controls it allows" scans
  the tree and fails with `file:line` for each match beyond the allowance, and with the entry
  for each count the tree no longer reaches.
- "mutation (a)" adds placeholder copy to the shell's text, to an attribute value, to a
  template literal and a concatenated literal of a module, and to a stylesheet, and requires
  each to be refused; "comments, attribute names and code are not copy" requires a comment, a
  `placeholder` attribute, an object key, a regular expression and a `::placeholder` selector
  to pass.
- "mutation (b)" adds a control disabled by `:disabled`, by `disabled` and by `:aria-disabled`
  without a reason and requires each to be refused, and requires each form of a stated
  reason to pass.
- "the allowance only shrinks: no entry is above its value in an earlier commit" reads every
  commit that changed `tests/unit/no-inert-surfaces-allowance.json` (`git log`, `git show`)
  and fails when an entry is above its value in any of them, an entry absent there counting
  0; "mutation: an added entry, a widened one or one listed again after removal is refused"
  proves it on fixture histories. As with `tests/unit/browser-timing.test.mjs`, the history
  check needs the history: the CI `unit` job checks out with `fetch-depth: 0` and fails
  without it, a local shallow clone and a tree with no commit (the `fail-first` extracts)
  skip it, and a history rewritten by a force-push is not seen.

`no-inert-controls` in `tests/browser/qa-regressions.cjs`, run by `npm run test:browser` in
the CI `browser` job in Chromium, Firefox and WebKit, holds (c). Before any script of the
page runs it installs a registry of `addEventListener` and `removeEventListener`; it then
visits every workspace of the navigation, opens every Studio template and selects each of its
nodes, edges and clips, and adds and selects one node of each type the Studio library offers,
collecting each `data-osc` control without a handler. It fails on one the allowance does not
list and on an allowed one it no longer finds. Its mutation: a fixture button without a
handler is found and judged unexpected, and one with a click listener is not.

What the mechanism does not decide, stated so that nothing above is read as more than it is:

- (a) reads words, not meaning; a term inside an identifier joined with hyphens
  (`osc-mock`) is a match, which is why the `?mock=1` entries exist. Text built at run time
  from parts that each pass, or text in a `${…}` expression's result, is not seen.
- (b) reads the markup of `src/index.html` only. A control built in `src/js` and disabled
  there (`el.disabled = …`, `disabled:` in a builder's attributes) is not scanned.
- (c) sees the states it visits. A control that appears only in another state (a dialog's
  later step, a list row that needs stored data, a microphone-dependent view) is checked
  only as far as its element exists in a visited state. It counts a listener, not an effect.

# Failure behaviour

A failing check fails `npm test` or the CI `browser` job, so CI refuses the pull request. The
fix is the surface: remove the placeholder, state the reason on the control, give the control
its handler. The allowance is not a place for a new entry.
