# The first screen: analysis and layout options

Plan issue P001 (milestone M050, intent `first-run-experience`). The owner felt the first screen
no longer reflects the product, "since generating one signal need not take so much space", and
asked first for an analysis of the layout and of the changes, ADRs and commits since V3, then
for a proposal (ChatGPT project conversation 6ac1beb8, 2026-10-05T19:17:26Z). This document is
that analysis and three options. It builds nothing: no file under `src/` changes, and no layout
is built before the owner chooses one (Q004). Q004 is answered from this document; P002 builds
the answer.

Every number below was produced by the command in section 1 on `main` at `50f6d6c`, unless the
line names another command. Shares are rounded to 0.1 %, so a column can sum to 100.3 %.

## 1. How it was measured

The measurement is the script at the end of this document (appendix A). From the repository
root, after `npm ci` and with the committed `dist/index.html`:

```sh
awk '/^```js first-screen-measure$/{f=1;next} f&&/^```$/{exit} f' \
  docs/first-screen-options.md | node - /tmp/first-screen
```

The trailing directory is optional; with it the script also writes one screenshot per row it
measures (`1536x1024-default.png`, `390x844-mmeasure.png`, ...). The screenshots are not
committed; the command regenerates them.

- **Browser**: Playwright's Chromium from `npm ci` (the run reported Chromium 153.0.8010.12),
  `dist/index.html` from `file://`, dark colour scheme, device scale factor 1. At 390x844 the
  context is a phone (`isMobile`, `hasTouch`).
- **A first visit**: every row is a fresh browser context, so storage is empty and the
  listening safety notice is shown, as a new visitor sees it. The visual gate's reference
  (`tests/visual/regions.json`) is taken with the notice dismissed, so its boxes sit 52 px
  higher than the ones measured here.
- **Ready**: the script waits for the page's own readiness mark (`html[data-ready="true"]`, the
  mark `tests/browser/perf-budgets.cjs` times) and for the fonts, with a 30 s deadline; there
  is no fixed sleep.
- **A part** is the header, the safety notice, each visible top-level `.osc-panel`, and the
  status bar. Its **share of the viewport** is the area of the part that is on screen (inside
  the viewport and inside every scrolling ancestor, because `#osc-main` scrolls between a fixed
  header and a fixed status bar) divided by the viewport's area. **Share of the part on screen**
  is how much of the part's own height is visible.
- **A usable control** is a button, link, input, select, tab, switch, radio or slider that is
  enabled, wholly on screen, and is what a pointer at its centre hits. That count is what a
  visitor can do without scrolling.
- **Screens tall** is the scroll height of `#osc-main` over its visible height: 1.00 means
  nothing is below the fold.

## 2. The current first screen

A visitor who opens the page without a hash gets the Playground: `DEFAULT_WORKSPACE =
'playground'` (`src/js/ui/navigation.js:61`) and the last step of ADR 0045's route precedence
("Otherwise the workspace is the Playground"). Its arrangement at 1536x1024 is the V2 layout:
the visual gate's region file `tests/visual/regions.json` was added by `9fe0a15` (2026-10-02,
"OSCILLA V2 acoustic laboratory") and neither it nor `tests/visual/baseline.json` has changed
since `v3.0.0` (`git log --format='%h %ad %s' --date=short -- tests/visual/regions.json` and
`git log --oneline v3.0.0..50f6d6c -- tests/visual/regions.json tests/visual/baseline.json`).

### 2.1 Desktop, 1536x1024

The Playground: 101 usable controls; `#osc-main` is 1.22 screens tall.

| part | share of viewport | share of the part on screen | controls |
|---|---:|---:|---:|
| header | 6.1 % | 100 % | 13 |
| safety notice | 4.5 % | 100 % | 1 |
| Source & Pattern | 8.3 % | 100 % | 18 |
| Signal analysis | 16.8 % | 100 % | 11 |
| Spectrogram | 14.0 % | 100 % | 4 |
| Microphone Analyzer | 8.6 % | 100 % | 5 |
| Device & Limits | 3.9 % | 100 % | 4 |
| Pattern Sequencer | 9.8 % | 100 % | 13 |
| Filter Lab | 4.3 % | 82 % | 9 |
| Envelope (ADSR) | 3.7 % | 82 % | 8 |
| Additive Synthesis | 3.4 % | 82 % | 2 |
| Phase & Stereo | 3.1 % | 82 % | 5 |
| Bioacoustics | 3.3 % | 82 % | 3 |
| Studio | 0.0 % | 0 % | 0 |
| status bar | 5.4 % | 100 % | 5 |
| (no part: gutters, empty space) | 5.1 % | | |

Grouped by what the parts are for (sums of the rows above; "Studio" is the compact Studio
panel):

| group | parts | share | controls |
|---|---|---:|---:|
| Generate one signal and look at it | Source & Pattern, Signal analysis, Spectrogram, Pattern Sequencer, Filter Lab, Envelope, Additive Synthesis, Phase & Stereo | 63.4 % | 70 |
| Microphone and output device | Microphone Analyzer, Device & Limits | 12.5 % | 9 |
| Learning | Bioacoustics | 3.3 % | 3 |
| Frame | header, safety notice, status bar | 16.0 % | 19 |
| Nothing | gutters | 5.1 % | |

Without scrolling a visitor can: choose oscillator or pattern, the waveform, the frequency (a
slider and six step buttons), frequency or note input and the gain; hold to play or trigger a
tone; switch the analysis between waveform, spectrum, spectrogram, harmonics and Signal Path;
freeze the spectrogram; turn the microphone on and compare it with the generator; play, stop
and edit the pattern sequence; switch the filter, envelope and additive layers on; open the
phase, Lissajous and stereo views and the hearing ranges; and copy the URL, take a screenshot,
export WAV or save a preset. All eight top-level navigation entries are on screen.

What the first screen does not show:

- **Nothing of MEASURE**, the workflow ADR 0051 calls the wedge: no step, no quality reason, no
  result. The only measurement-shaped part is the Microphone Analyzer, which says of itself "Not
  a calibrated measurement".
- **Nothing of Experiments**: no saved experiment, finding or evidence.
- **The compact Studio is entirely below the fold** (0 % on screen), though the Playground
  hosts it (V3.1 §269) and the live smoke checks it there.
- **Five of the parts are cut off**: the bottom row (Filter Lab to Bioacoustics) shows 82 % of
  its height.
- **The positioning**: the only words about OSCILLA are the brand subtitle "Interactive Sound &
  Frequency Lab". The page's `h1` ("OSCILLA playground", `src/index.html:269`) is visually
  hidden.

### 2.2 Phone, 390x844

The Playground: 31 usable controls; `#osc-main` is 2.39 screens tall.

| part | share of viewport | share of the part on screen | controls |
|---|---:|---:|---:|
| header | 12.2 % | 100 % | 8 |
| safety notice | 5.6 % | 100 % | 2 |
| Source & Pattern | 67.3 % | 100 % | 19 |
| Signal analysis | 2.3 % | 4 % | 0 |
| Studio | 0.0 % | 0 % | 0 |
| status bar | 6.8 % | 100 % | 2 |
| (no part: gutters, empty space) | 5.9 % | | |

- **The generator is the first screen**: Source & Pattern takes 67.3 % of the viewport and 19
  of the 31 usable controls; the frame takes 24.6 % and the remaining 12 controls. This is
  where the owner's remark is literally true.
- At this width the Playground shows three panels only (Source & Pattern, Signal analysis, the
  compact Studio); the others are hidden by the layout. A visitor sees no chart without
  scrolling: Signal analysis shows 4 % of its height.
- **Four of the eight navigation entries are off screen** (Synthesis, Learn, Studio, About):
  the navigation strip scrolls sideways.
- The brand subtitle is not shown at this width (screenshot `390x844-default.png`), so the
  first screen says nothing about what OSCILLA is.

### 2.3 The other views a first screen could open

The same measurement for the existing views a first screen could open instead, by deep link
(ADR 0045), condensed from the script's per-view tables. Experiments is measured empty, as a
first visit sees it.

| view | 1536x1024: controls, screens tall | largest parts at 1536x1024 | 390x844: controls, screens tall | largest parts at 390x844 |
|---|---|---|---|---|
| Playground (no hash) | 101, 1.22 | Signal analysis 16.8 %, Spectrogram 14.0 % | 31, 2.39 | Source & Pattern 67.3 % |
| Measure (`#m=measure`) | 30, 1.66 | Measurement result 28.5 % (69 % on screen), Guided measurement 14.6 %, Stimulus, Live input and Quality 12.1 % each | 14, 3.85 | Guided measurement 50.2 %, Quality 17.7 % |
| Experiments (`#m=experiments`) | 23, 1.00 | Findings 4.4 %, Experiment 3.8 %; 69.5 % is empty | 16, 1.00 | Findings 18.4 %, Saved experiments 18.0 % |
| Studio (`#m=studio`) | 75, 1.00 | Signal graph 28.5 %, Timeline 20.9 % | 33, 1.51 | Studio toolbar 35.2 %, Signal graph 27.7 % (47 % on screen) |

On a first visit Measure shows its seven steps (Input, Calibration, Noise check, Stimulus,
Measure, Review, Save) with Check setup as the one primary action, "UNCALIBRATED" frequency and
level badges, five quality reasons none of which is assessed yet (INPUT UNKNOWN, NOISE NOT MEASURED,
CLIPPING NOT CHECKED YET, SIGNAL NOT MEASURED, CAPTURE IDLE), and an empty result
("NOT MEASURED"). Its first action asks for microphone permission; the Input device list also
offers "TEST CONTEXT · digital loopback (no microphone)" (`?measure=loopback`, commit
`d742228`), whose results are labelled and never presented as a measurement. At 390x844 the
Measure view puts Quality directly under the steps and the Stimulus and Live input panels below
the fold.

### 2.4 Nothing on the Playground exists only there

Every panel of the opening Playground is also shown by another workspace (the last table the
script prints, at 1536x1024):

| workspace | panels shown |
|---|---|
| playground | source, analysis, spectrogram, mic, device, sequencer, filter, envelope, additive, phase, bio, studio |
| analyzer | analysis, spectrogram, mic, device |
| filter | filter |
| compare | mic, phase, bio |
| synthesis | source, analysis, envelope, additive, phase, dual |
| sequencer | source, sequencer, studio |

So a first screen that shows fewer of these panels removes no feature: each stays one
navigation step away (Analyze: Analyzer, Filter Lab, Compare; Synthesis: Synthesis, Sequencer).

## 3. What changed since V3

Measured with `git rev-list --count v3.0.0..50f6d6c` (and `--merges`, `--no-merges`),
`git log --no-merges --format=%s v3.0.0..50f6d6c` (types counted from the conventional prefix)
and `git diff --name-only --diff-filter=A v3.0.0 50f6d6c -- .ai/repo/adrs`. `v3.0.0` is
`5d94576` (2026-10-03); `50f6d6c` is 2026-10-18.

- **476 commits**, 82 of them merges. The 394 others: 114 fix, 96 test, 76 docs, 60 chore,
  23 feat, 9 ci, 7 refactor, 5 build, 3 perf, 1 style. The most frequent feat and fix scopes:
  studio 45, findings 18, measure 16, release 11.
- **30 ADRs, 0030 to 0059**, were added in that period (their `date:` fields run from
  2026-10-02 to 2026-10-18; all are `proposed`).

What those changes made of the product, and what the first screen shows of each:

| line of work | records | on the first screen today |
|---|---|---|
| Studio: canonical model, graph editor, compiler and runtime, timeline, automation, runtime truth, operation trace, deep links, the Playground's Signal Path as a Studio projection | ADR 0030-0039, 0042; V421, V422 | the compact Studio, below the fold at 1536x1024 and 390x844 |
| Experiments as stored records: immutable runs, versioned definitions, semantic comparison, evidence (lineage and checklist), findings, connected records, raw-capture retention, the vocabulary | ADR 0040, 0041, 0043, 0044, 0046, 0048, 0049, 0053 | nothing |
| Measurement trust: the method claims on an experiment's evidence instead of a knowledge explorer; TEST CONTEXT entered from the input list; the page seam | ADR 0051, 0052; `d742228` | nothing |
| Navigation: eight top-level entries with Analyze and Synthesis groups; the workspace in history with one hash dispatcher; one owner of Space per workspace | V371 (`8304915`), ADR 0045, 0050 | the navigation strip (four entries off screen on a phone) |
| Releases and process: release candidates, the merge train, the Majordomus mesh and pin, Pages evidence, a deployed page naming its release state | ADR 0047, 0054-0057, 0059 | the version in the status bar |
| MIDI as an optional local input layer | ADR 0058 | nothing (not built) |

In short: since V3 the product grew Studio, Experiments and the trust apparatus around a
measurement, and the owner set the direction (ADR 0051: "depth over breadth; fewer new nouns,
more working verbs; acoustic measurement is the wedge"). The first screen is still the V2
Playground: 63.4 % of a desktop and 67.3 % of a phone go to generating and viewing one signal,
and 0 % to measurement or experiments.

## 4. What every option keeps

These come from the intent, its critique, ADR 0051, Q002 and the rules; no option relaxes them.

- **The words.** The first screen describes OSCILLA only in the sentence Q002 recorded, verbatim:
  "A zero-install, scientifically honest acoustic laboratory in your browser: generate, measure
  and reproduce sound experiments, and know how far each result can be trusted." The tagline
  "See sound. Shape frequency." and the product name "OSCILLA · Interactive Sound & Frequency
  Lab" stay. Every option puts the sentence in the page's `h1`, made visible (today it is the
  hidden "OSCILLA playground"), once, above the panels. At 390 px the 170-character sentence
  wraps over several lines; its share is P002's to measure with this command.
- **Its claims are backed** (`project.no-fake-science`; Q002's reasoning): nothing on the first
  screen says a result is measured before a measurement exists, and the existing
  "UNCALIBRATED", "not assessed" and "Not a calibrated measurement" wording stays.
- **The look.** Only existing panels, tokens and primitives (`project.visual-identity-lock`); no
  marketing landing page, sign-up, analytics or newsletter (the intent's non-goals); About is
  not the default view (rejected in the About brief, conversation 6abf2a8d,
  2026-10-02T04:13:38Z).
- **No new noun** (ADR 0051). Options A and B use only existing views and panel names; option C
  is the one that needs a new name or a changed meaning of one, and says so.
- **Entry paths.** Every deep link, `file://`, the `/oscilla/` sub-path and the direct path to
  the instrument keep working (`project.single-file-deliverable`), proven by the table-driven
  inventory P002 commits first (`tests/browser/first-screen.cjs`, passing on today's screen).
- **The safety notice** stays in flow on a first visit; no option starts sound without a
  gesture (`project.audio-engine-discipline`).

## 5. Options

Shares written as targets below are proposals, not measurements; P002 measures the built layout
with the command of section 1.

### Option A: the Playground, lighter, with the measurement in view

The opening view stays the Playground (no route change). It loses the parts that exist
elsewhere and gains the Measure steps.

**The first screen in the sentence's words**: under the visible sentence, **generate** is the
Source & Pattern panel beside Signal analysis, as now; **measure** is the Guided measurement
panel of MEASURE (its seven steps and Check setup) on the first screen; **reproduce sound
experiments** is the Save step of that panel and the compact Studio, raised into view; **know how
far each result can be trusted** is the "UNCALIBRATED" badges of that panel and the Device &
Limits note, both existing words.

```text
1536x1024
+--------------------------------------------------------------------------------------+
| header: OSCILLA  Interactive Sound & Frequency Lab | eight entries |     Export       |
| safety notice (first visit)                                                          |
| h1: A zero-install, scientifically honest acoustic laboratory in your browser: ...   |
+----------------+------------------------------+--------------------+-----------------+
| Source &       | Signal analysis              | Microphone         | Device & Limits |
| Pattern        | waveform / spectrum / ...    | Analyzer           |                 |
+----------------+------------------------------+--------------------+-----------------+
| Guided measurement: 1 Input ... 7 Save   [Check setup]   Frequency/Level UNCALIBRATED|
+---------------------------------------------+----------------------------------------+
| Studio (compact)                            | Pattern Sequencer                      |
+---------------------------------------------+----------------------------------------+
| status bar                                                                           |

390x844, top to bottom: header; safety notice; h1; Source & Pattern with the six step
buttons and Mode folded behind the panel's own disclosure; Signal analysis; Guided
measurement (steps folded to the current one, Check setup); compact Studio.
```

- **Leaves the first screen**: the separate Spectrogram panel (also the Signal analysis
  Spectrogram tab and Analyze > Analyzer), the bottom row Filter Lab, Envelope, Additive
  Synthesis, Phase & Stereo and Bioacoustics (Synthesis, Filter Lab, Compare). Together 31.8 %
  of the desktop viewport today, five of them cut off.
- **Serves**: the owner's remark (of the one-signal parts' 63.4 % of a desktop, the parts that
  stay, Source & Pattern, Signal analysis and Pattern Sequencer, take 34.9 % today; on a phone
  Source & Pattern gives up part of its 67.3 %); V3.1 §269 and V421 (the compact Studio, which
  shows the Playground's signal flow as a Studio model, becomes visible instead of 0 %); ADR
  0045 unchanged (no route change).
- **Costs**: `src/index.html` and the layout CSS of the Playground; the Guided measurement
  panel shown in a second place, so its state must stay owned by MEASURE (one source of truth,
  P002 decides how); a new accepted visual reference for the Playground scene
  (`scripts/visual-gate.mjs`, `tests/visual/regions.json`, `tests/visual/baseline.json`) and a
  review of the hidden-logo question; `tests/browser/layout.cjs` re-run at every width; the
  live smoke (`tests/browser/live-smoke.cjs`) keeps finding the compact Studio, now higher.
  Q004's guided path (waveform, spectrum, filter, compare, export) loses Filter from the first
  screen: it is one navigation step away.
- **Serves the wedge (ADR 0051)**: partly. Measurement moves from 0 % to a full-width row with
  its primary action, but generation still leads the screen, and the measurement itself still
  runs in MEASURE. It is the smallest step that puts the wedge on the first screen.

### Option B: MEASURE opens first

A visit without a hash opens MEASURE as it is today, under the visible sentence; the Playground
stays the first navigation entry and every link that names it still opens it.

**The first screen in the sentence's words**: **measure** leads (the seven steps and Check
setup); **know how far each result can be trusted** is the Quality panel's reasons and the
UNCALIBRATED badges, on screen at both sizes (12.1 % and 17.7 % today); **reproduce sound
experiments** is the Save step and "New from Measure setup" one step away in Experiments;
**generate** is the Stimulus panel (the sweep a measurement plays) and the Playground entry.

```text
1536x1024 (Measure as measured in 2.3, with the h1 above it)
+--------------------------------------------------------------------------------------+
| header | safety notice | h1: A zero-install, scientifically honest acoustic ...      |
| Guided measurement: 1 Input  2 Calibration ... 7 Save  [Check setup]   UNCALIBRATED  |
| Stimulus                  | Live input                  | Quality (reasons)          |
| Measurement result: NOT MEASURED (69 % on screen today)                              |
| status bar                                                                           |

390x844, top to bottom: header; safety notice; h1; Guided measurement; Quality; then, below
the fold, Stimulus, Live input, Measurement result (3.85 screens today).
```

- **Serves**: ADR 0051 directly; Q002's reasoning (the sentence leads with the trust of a
  measurement); ADR 0025 (quality with reasons) and ADR 0044 (the Save step leads to evidence).
  The Measure view needs no new layout at all.
- **Costs**: a route change: `DEFAULT_WORKSPACE` (`src/js/ui/navigation.js:61`) and the last
  step of ADR 0045's precedence, which is a recorded decision, so a new ADR or an amendment
  says so. Everything that opens the bare URL and expects the Playground must name
  `#m=playground` or be re-specified: the files that reference the Playground's play control
  are `tests/browser/app.cjs`, `layout.cjs`, `navigation.cjs`, `qa-regressions.cjs`,
  `live-smoke.cjs` (the compact Studio check, V3.1 §269), `perf-budgets.cjs` (its ready-mark
  check asserts Hold to Play and the frequency slider are hit-testable at ready) with
  `tests/browser/fixtures/perf-dom.json`, and `scripts/visual-compare.mjs` and
  `scripts/social-assets.mjs` (`grep -rlE "osc-hold-play|Hold to Play" tests/browser scripts`).
  Space's owner on the first screen becomes Measure's (ADR 0050). A link without `m` (the
  instrument's serializer writes `m`, `src/js/core/url-state.js:36`, but a hand-written or older
  link may not) would open MEASURE: the P002 inventory decides whether any such link is
  inventoried.
- **Risks**: the first interaction asks for microphone permission, and a visitor without a
  microphone meets a wall of "UNKNOWN" and an empty result (28.5 % of the desktop viewport) until
  they pick TEST CONTEXT, which is labelled a test and, rightly, not a measurement. Making
  "measure a speaker or a room" the first impression for a visitor who came to hear a tone is a
  bet on the wedge; Q004 owns it.
- **Serves the wedge (ADR 0051)**: fully. The first thing a visitor can do is start a
  measurement, and the first thing they read about a result is how far it can be trusted.

### Option C: generate, measure, reproduce, side by side

One opening view composed of existing panels in three columns named by the sentence's verbs:
**generate** (Source & Pattern and Signal analysis), **measure** (Guided measurement and the
Quality reasons) and **reproduce** (Saved experiments and Findings, with their existing empty
states on a first visit: "No saved experiments in this browser. Measure and save one, or import
an .oscilla.json file.").

**The first screen in the sentence's words**: the sentence is the heading and the three column
headings are its three verbs, in its order; **know how far each result can be trusted** is the
Quality column's reasons, under measure.

```text
1536x1024
+--------------------------------------------------------------------------------------+
| header | safety notice | h1: A zero-install, scientifically honest acoustic ...      |
+----------------------------+----------------------------+----------------------------+
| generate                   | measure                    | reproduce                  |
| Source & Pattern (compact) | Guided measurement         | Saved experiments          |
| Signal analysis            | Quality (reasons)          | Findings                   |
+----------------------------+----------------------------+----------------------------+
| status bar                                                                           |

390x844: the three columns stacked in the sentence's order; only generate is on the first
screen, measure and reproduce start below the fold.
```

- **Serves**: all three verbs of Q002's sentence on one screen; the loop the plan built since V3
  (ADR 0043, 0044, 0046: definition, run, evidence, finding) is visible at once.
- **Costs**: the most. Either a new workspace id (a new noun, which ADR 0051 asks to avoid, and
  a ninth navigation entry or a renamed Playground) or the Playground id showing Measure and
  Experiments panels, so three workspaces' state shares one screen; whether the MEASURE and
  Experiments adapters can render outside their views is not analysed here and is P002's first
  question. The compact Studio leaves the first screen (live smoke, V3.1 §269, the
  compact-sync claim). A new visual reference with no existing scene to compare; the route
  change and test costs of option B if it is not the Playground id.
- **Risks**: it reads as an overview page, close to the intent's non-goal (a landing page), and
  shows breadth where ADR 0051 asks for depth; on a phone it is option A's first screen with
  more below the fold.
- **Serves the wedge (ADR 0051)**: in the middle column only. Measurement is one of three equal
  columns, so it is shown but not the wedge.

## 6. The options side by side

| | A: Playground, lighter | B: MEASURE first | C: three verbs |
|---|---|---|---|
| view that opens | Playground | Measure | a composed view |
| route change (ADR 0045) | none | the default workspace | a new id, or none |
| measurement on the first screen | the steps and Check setup | the whole MEASURE view | the steps and Quality |
| one-signal parts on a desktop (63.4 % today) | the parts that stay take 34.9 % today | the Stimulus panel only | one column |
| new nouns (ADR 0051) | none | none | one, or a changed Playground |
| gates to re-accept or re-specify | Playground visual reference; layout | bare-URL suites, perf ready mark, live smoke, visual scene | new visual reference; live smoke; as B if a new id |
| ADR 0051's wedge | partly | fully | one of three |

What Q004's answer must say for P002 to state testable criteria (Q004's acceptance): the view
that opens, the parts it shows and their order at desktop and phone width, and whether Q004's
guided path belongs on it. The sentence is already chosen (Q002).

## Appendix A: the measurement script

Run it with the command of section 1. It reads `dist/index.html`, writes nothing unless given a
screenshot directory, and prints the tables of section 2.

```js first-screen-measure
// P001: measure the first screen of dist/index.html (docs/first-screen-options.md, section 1).
// Fed to `node -` from the repository root, so `playwright` resolves from its node_modules.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const SHOTS = process.argv[2] || null;
const SIZES = [[1536, 1024, false], [390, 844, true]];
const ROUTES = ['', '#m=measure', '#m=experiments', '#m=studio'];
const BASE = pathToFileURL(path.resolve('dist/index.html')).href;

function survey() {
  const vw = innerWidth, vh = innerHeight;
  const shown = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // The part of el on screen: inside the viewport and inside every clipping ancestor.
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    let l = Math.max(r.left, 0), t = Math.max(r.top, 0);
    let rr = Math.min(r.right, vw), b = Math.min(r.bottom, vh);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = a.getBoundingClientRect();
      l = Math.max(l, q.left); t = Math.max(t, q.top);
      rr = Math.min(rr, q.right); b = Math.min(b, q.bottom);
    }
    return rr > l && b > t ? { l, t, w: rr - l, h: b - t } : null;
  };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const label = (p) => text(p.querySelector('.osc-panel-title')) || p.getAttribute('aria-label')
    || text(document.getElementById(p.getAttribute('aria-labelledby'))) || p.id;
  const regions = [];
  const add = (name, el) => { if (el && shown(el)) regions.push({ name, el }); };
  add('header', document.querySelector('.osc-header'));
  add('safety notice', document.querySelector('#osc-safety'));
  for (const p of document.querySelectorAll('.osc-panel')) {
    if (shown(p) && !p.parentElement.closest('.osc-panel')) add(label(p), p);
  }
  add('status bar', document.querySelector('.osc-statusbar'));
  // A control counts when it is enabled, wholly on screen and what a pointer at its centre hits.
  const usable = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), '
    + 'select, textarea, [role=tab], [role=switch], [role=radio], [role=slider]')].filter((c) => {
    if (!shown(c) || c.disabled || c.classList.contains('osc-sr-only')) return false;
    if (c.closest('[inert], [aria-hidden=true]')) return false;
    const r = c.getBoundingClientRect(), s = onScreen(c);
    if (!s || s.w < r.width - 1 || s.h < r.height - 1) return false;
    const hit = document.elementFromPoint(s.l + s.w / 2, s.t + s.h / 2);
    return !!hit && (c.contains(hit) || hit.contains(c));
  });
  const rows = regions.map(({ name, el }) => {
    const s = onScreen(el), r = el.getBoundingClientRect();
    return { name, share: s ? (100 * s.w * s.h) / (vw * vh) : 0,
      seen: s ? (100 * s.h) / r.height : 0, controls: usable.filter((c) => el.contains(c)).length };
  });
  const nav = [...document.querySelectorAll('#osc-nav > li > :is(a, button)')]
    .map((b) => text(b) + (usable.includes(b) ? '' : ' (off screen)'));
  const main = document.querySelector('#osc-main');
  return { rows, usable: usable.length, nav, screens: main.scrollHeight / main.clientHeight,
    workspace: document.querySelector('#osc-app').dataset.mode };
}

// The page's own readiness mark (html[data-ready]) and loaded fonts, deadline 30 s.
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.ready
  === 'true' && document.fonts.status === 'loaded', null, { timeout: 30000 });

(async () => {
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
  const browser = await chromium.launch();
  console.log(`dist/index.html at ${head}, Chromium ${browser.version()}, file://, dark scheme`);
  try {
    for (const [w, h, phone] of SIZES) {
      for (const route of ROUTES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h },
          isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, colorScheme: 'dark' });
        const page = await ctx.newPage();
        await page.goto(BASE + route);
        await ready(page);
        const tag = route.replace(/[#=&]/g, '') || 'default';
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${w}x${h}-${tag}.png`) });
        const s = await page.evaluate(survey);
        console.log(`\n${w}x${h} ${route || '(no hash)'}: workspace ${s.workspace}, `
          + `${s.usable} usable controls, main is ${s.screens.toFixed(2)} screens tall`);
        console.log(`nav: ${s.nav.join(' | ')}`);
        console.log('| part | share of viewport | share of the part on screen | controls |');
        console.log('|---|---:|---:|---:|');
        let sum = 0;
        for (const r of s.rows) {
          sum += r.share;
          console.log(`| ${r.name} | ${r.share.toFixed(1)} % | ${r.seen.toFixed(0)} % | `
            + `${r.controls} |`);
        }
        console.log(`| (no part: gutters, empty space) | ${(100 - sum).toFixed(1)} % | | |`);
        await ctx.close();
      }
    }
    // Where else each panel of the opening view is shown, at 1536x1024.
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    console.log('\n| workspace | panels shown |\n|---|---|');
    for (const ws of ['playground', 'analyzer', 'filter', 'compare', 'synthesis', 'sequencer']) {
      await page.goto(`${BASE}#m=${ws}`);
      await ready(page);
      const ids = await page.evaluate(() => [...document.querySelectorAll('.osc-panel')]
        .filter((p) => p.getClientRects().length && !p.parentElement.closest('.osc-panel'))
        .map((p) => p.id.replace('osc-panel-', '')));
      console.log(`| ${ws} | ${ids.join(', ')} |`);
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
```
