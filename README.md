# OSCILLA

[![Deploy to GitHub Pages](https://github.com/korczis/oscilla/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/korczis/oscilla/actions/workflows/pages.yml)

An interactive sound and frequency laboratory that runs in the browser from one static file.

![OSCILLA playing a 440 Hz sine: source, waveform, relative spectrum, spectrogram, microphone analyzer, sequencer and device limits](site/og-image.png)

**Live demo:** https://korczis.github.io/oscilla/

## What it does

OSCILLA generates signals with the native Web Audio API and measures them while they play. It
shows them as a waveform, a live spectrum and a spectrogram, and it compares them with what your
microphone picks up. You can arrange signals into block sequences, shape them with filters, an
ADSR envelope and additive harmonics, explore phase and stereo, and export the result. In the
Measure workspace it records a sweep through your speaker and microphone. From that recording
it computes the response of the whole playback and capture chain, rates the quality of the
measurement and keeps it as a reproducible experiment. The app is a single HTML file. It needs no server, no account and no network once loaded, and it works
when opened straight from disk.

The words OSCILLA uses for its objects (project, Studio, runtime, measurement, run, experiment,
definition, calibration, trace) are defined in the [glossary](docs/GLOSSARY.md).

## Navigation

The header has eight entries: **Playground**, **Measure**, **Experiments**, **Analyze**,
**Synthesis**, **Learn**, **Studio** and **About**, in that order. Analyze and Synthesis are
groups. Analyze opens Analyzer, Filter Lab and Compare; Synthesis opens Synthesis, Sequencer and
Presets. A group is a button that shows its list of workspaces: Enter or Space opens it and Tab
walks the list, or ArrowDown opens it on the current workspace and the arrow keys move. Escape
closes it. Every V2 workspace is still there under the same name, and only the way to it has
changed.

- **The address names the workspace.** Each switch writes `m=<workspace>` into the page address
  (`#m=measure`, `#m=analyzer`, …) and adds one browser history entry, also from `file://`.
  Back and Forward move between workspaces, keep what each workspace holds and move focus to the
  workspace heading; a reload reopens the workspace. A link is read by one dispatcher: the
  Studio keys win over `m`, and `m` wins over a recipe link's `mr`, so `#m=studio&mr=…` opens
  Studio and still loads the recipe into Measure
  ([ADR 0045](.ai/repo/adrs/0045-workspace-in-history-one-hash-dispatcher-unsaved-guard.md)).
  **Copy config URL** keeps the recipe and Studio keys that are in the address. Each nav item
  links to its workspace's address, so opening it in a new tab opens that workspace. A link
  that is refused does not stay in the address or in history.
- **Unsaved work.** While something would be lost, a reload, a closed tab or leaving the page
  makes the browser ask first: unsaved Studio changes, a completed measurement that is not
  saved, a saved experiment's name or notes not yet stored with "Update name and notes", a
  rename being typed, or a level calibration (it is kept in page memory only). Where the browser allows no
  IndexedDB, saved experiments and Studio projects live in page memory too and count as well.
  Studio shows "unsaved changes" and Measure "unsaved result" or "unsaved name or notes". With
  nothing to lose the page asks nothing. Sequencer patterns are not guarded yet.

## The V2 laboratory

- **Generator:** sine, triangle, sawtooth and square sources, set by frequency or by note, with
  continuous and finite tone, pulse, burst, sweep up/down, ping-pong, chirp, siren, wobble, AM,
  FM, random, alternating, octave-stepping and user-defined step sequences, plus a dual
  oscillator.
- **Analyzer:** a live spectrum on log or linear frequency axes, with the requested frequency
  marked.
- **Spectrogram:** a scrolling time-frequency view, with level shown as colour.
- **Microphone analyzer and compare:** your microphone's spectrum and spectrogram, the detected
  frequency with its uncertainty, and a generator-versus-microphone comparison with freeze,
  averaging and peak hold.
- **Sequencer:** a timeline of tone, silence, sweep, pulse, chirp, burst, siren, AM, FM and
  random blocks, with drag-and-drop editing, keyboard control, looping and tempo-locked
  durations.
- **Filter Lab:** biquad filters with a response chart drawn from the browser's own filter
  response. Cutoff and Q can be dragged on the chart.
- **ADSR:** an attack/decay/sustain/release envelope with a draggable graph.
- **Additive synthesis:** a harmonic editor. The bars you see are the same coefficients that
  build the waveform you hear.
- **Phase, Lissajous and stereo:** A/B phase views, a Lissajous figure, a correlation meter and
  stereo routing (split, panned or mono).
- **Bioacoustics:** approximate hearing ranges and call examples for humans and several animal
  species, every value cited.
- **Export:** WAV of the current tone, pattern or sequence, rendered offline through the same
  signal chain as live playback; a PNG of the graphs; the configuration as JSON (export and
  import); a shareable configuration URL.
- **About:** the last workspace tells how OSCILLA was built and with what discipline, and shows
  the running build's version, commit, channel and source digest.

## The V3 measurement workbench

V3 adds two workspaces after Playground: **Measure** takes a measurement, **Experiments** keeps
and compares them. A measurement plays a known digital signal, records what comes back and
analyses the recording offline. Its result is the observed response of the whole playback and
capture chain, not of any one part of it. How to make a useful measurement is in the
[measurement guide](docs/v3/measurement-guide.md). How the layers fit together is in the
[architecture](docs/v3/architecture.md). How each result is computed, and which tests pin it,
is in the [algorithm notes](docs/v3/algorithms.md).

### Measurement Workbench

- **Guided flow.** Seven steps: input, calibration, noise check, stimulus, measure, review,
  save. One primary action moves the flow on, and an explicit state machine owns every stage
  (IDLE, PREFLIGHT, NOISE_CHECK, READY, ARMED, MEASURING, ANALYZING, then COMPLETE, INVALID,
  ABORTED or ERROR). The preset CHARACTERIZE PLAYBACK CHAIN runs a noise check and then a
  20 Hz-20 kHz log sweep, three times, at the LOW digital level. Expert settings add the sweep
  range and duration, the number of runs (1-10), mean or median aggregation, timing and phase.
- **Setup check.** Before anything plays, OSCILLA checks the microphone permission, the input
  device, the sample rate, the input level and the background noise. It requests echo
  cancellation, noise suppression and automatic gain control off, and reads back what the
  browser actually applied. A blocker stops the flow and a warning never does.
- **Input device.** The default input stays the default. Once the browser has granted the
  microphone, the Live input panel lists the inputs and you can choose one; the experiment
  records it as a hashed identifier. An input that disappears stays selected and is reported as
  not available; OSCILLA never switches microphones for you.
- **Recipe link.** "Copy recipe link" puts the measurement recipe (sweep, level, runs, timing)
  in the page address. Opening the link fills the setup and opens Measure without starting
  anything; it never carries results, calibration or a device, and an altered link is refused
  as a whole.
- **During the run.** A quality bar reports INPUT, NOISE, CLIPPING, SIGNAL and CAPTURE, and a
  screen reader hears one announcement per stage. While a measurement owns the output, the
  instrument cannot play. Escape, STOP, hiding the page or leaving the workspace aborts the
  measurement, and no audio node, capture or input track is left running.
- **Capture.** Mono PCM is recorded by an AudioWorklet loaded from a `data:` URL, so it also
  works from `file://`. When AudioWorklet is unavailable, a ScriptProcessor fallback records
  instead. The stimulus passes through the same master safety chain as every other sound, and
  that chain is part of what is measured.
- **TEST CONTEXT.** `?measure=loopback` replaces the microphone with a known synthetic digital
  system. The page then says TEST CONTEXT on the result and in every saved experiment. The
  automated tests use this mode, and it is never presented as a measurement of a physical
  system.

### Calibration

- **Frequency-response profile.** Import a microphone correction file (CSV, TXT or JSON).
  Errors are reported with their line numbers. A profile is identified by the SHA-256 of its
  points and interpolated linearly in dB over log frequency. It applies only between its first
  and last frequency: outside that range the curve stays uncorrected and is marked
  uncalibrated. The raw curve is always kept beside the CALIBRATED one. The loaded profile
  exports as CSV or JSON; both files are deterministic and import back to the same profile.
- **Absolute level calibration.** You enter an external reference (for example 94 dB SPL at
  1 kHz from a calibrator) and the relative level OSCILLA observed. This is the only way to
  get dB SPL. It is valid only for the microphone, gain, browser settings and position it was
  taken with. There is no default calibration. OSCILLA stores one only once it knows the input
  (the setup check or the reference capture), binds it to that input and stops applying it when
  the input changes; a reading typed before any setup check is refused with the reason. The
  measurement itself checks the input it captures from and never applies a calibration bound
  to another one (the record then says why it is uncalibrated); until an input is checked the
  indicator reads PENDING INPUT CHECK. A browser that exposes no device id binds the sample rate
  and processing settings only, "as far as the browser reports it". A record from an earlier
  version whose calibration has no input says "not bound to an input".

### Transfer Function

The Frequency response tab shows the magnitude recovered from the captured sweep. The capture
is divided by the spectrum of the rendered sweep, with band-limited regularisation. The tab
offers:

- the raw curve, a calibrated curve where a profile covers it, smoothing (1/24 to 1/3 octave)
  and normalisation (0 dB at 1 kHz, or the mean over 500 Hz-2 kHz). Every derived view is
  labelled, and the raw curve stays visible behind it.
- a valid range, which ends where the sweep has no energy or where the signal is less than
  10 dB above the background noise. Stretches outside it are drawn dashed and faded.
- a cursor that prints frequencies no finer than the analysis resolution allows.

Phase is shown only when requested and when the alignment is robust. Otherwise it is absent,
not guessed. The magnitude is a ratio and never dB SPL.

### Impulse Response

The Impulse response tab derives the impulse response from the same sweep and the same
spectral division. Time is shown in ms from the direct peak, and the absolute offset in the
recording is kept. You can zoom to the direct sound, the early part or the whole response,
show the analysis window, and switch to a dB view normalised to the peak. Windows and
normalised views are derived objects, so the stored response never changes. The peak time
includes unknown device and browser delays: it is not a time of flight and not a latency.

### RTA

The analysis layer computes octave and one-third-octave band power on the standard base-10
band edges. Bands above 95 % of Nyquist are left out. An averager offers instant, fast and slow
time constants, peak hold and freeze. The RTA tab of the Measure workspace draws
one-third-octave band levels as bars over each band's edges, with peak hold, freeze and reset.
Levels are in dB relative (dBFS-like) unless a valid level calibration applies. No IEC 61260-1
filter class is claimed. An experiment saved from Measure does not store band levels yet: its
`results.rta` is empty, although the format, validation and CSV export already support them.

### Experiments

- **What is recorded.** Every saved measurement becomes an experiment. It records the recipe
  (stimulus, runs, analysis settings), the output level, the input device and the requested
  and applied constraints, the calibration (profile name and identity, level calibration), the
  sample rate and runs, the quality assessment and the algorithm ID of every result. It also
  records the product version and build (including the build's source digest and, for the
  deployed page, the artifact SHA-256), with a configuration hash and a result hash. The
  result hash (version 4) covers the results, the verdict, the calibration, the input, the
  output, the runs (each with a stable id, `run-1`, `run-2`, ...), the build, the recipe and
  the definition the experiment was executed from. Files with a version 1, 2 or 3 hash still verify
  in their own version.
- **Definitions.** A definition says what to measure and how: the recipe as asked for, the
  conditions declared for every experiment and, optionally, the lowest quality verdict that
  meets it.
  Its hash covers only those fields, so a rename never changes it. Editing them creates a new
  version; earlier experiments keep the version they used. "Run this definition" runs its
  latest version, and Repeat loads a saved experiment's version again. An experiment records
  the version only when its measurement ran exactly that recipe. One without a definition, or
  whose setup was changed, records a definition derived from the recipe it played and marked
  as derived, never as authored. An experiment is shown under a stored definition's name only
  when that definition has its version with its hash
  ([ADR 0043](.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md),
  proposed).
- **Recorded as measured.** The calibration saved is the one the measurement applied, and the
  notes are those at its start. A profile loaded, a correction switched or a level calibration
  made after the measurement never becomes part of its record, and the Experiment panel says so; notes
  edited later are saved as an annotation. An experiment from an earlier version whose named
  calibration its own results contradict still opens and imports, and is marked as such: it is
  shown and compared as uncalibrated, never in dB SPL.
- **Only a log sweep is repeated.** The measurement engine measures log sweeps only. A file
  whose stimulus is anything else (white or pink noise, a sine, a chirp) still imports and is
  kept as it is, with a warning that this version cannot measure it; Repeat and "Run this
  definition" refuse it rather than run a log sweep in its place.
- **Evidence.** A saved experiment's detail answers two questions from what its record stores. "What
  produced this value?" traces the stored response value at a frequency you enter (1 kHz by
  default) through the analysis algorithms, the capture (input, sample rate, processing flags),
  the calibration as applied, the runs, the definition version, the build and, for an
  experiment run from Studio, the Studio graph the recipe was derived from with the measured path it names (the nodes,
  connections and measurement clips the measurement used). "Can I repeat this?" is a checklist: each item is recorded, partial or not recorded,
  with its reason, and there is no score. The result hash is recomputed and its reason says what
  it covers; the algorithm ids, environment notes and lineage are covered by no result hash.
  The raw capture is never retained: OSCILLA stores the
  derived result. Anything the record does not store reads "not recorded"
  ([ADR 0044](.ai/repo/adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md),
  proposed).
- **A completed experiment cannot be changed.** Only the name, the annotation notes and the baseline
  mark of a saved
  experiment can be edited, and no hash covers them. The store refuses any other change to a
  completed experiment, and rename edits only the name. A duplicate is the same experiment
  under a new ID,
  with the same hashes and creation time, and it records which experiment it was copied from
  ([ADR 0040](.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md),
  proposed).
- **Repeats.** With two or more runs, the stored response is the aggregate: a power mean with
  a standard-deviation envelope, or a median with a 10th-90th percentile band, plus a
  repeatability figure in dB. The stored transfer is the aggregate's centre, marked as
  derived, never a single run.
- **The Experiments workspace.** It lists, opens, renames, duplicates, repeats (as a new
  experiment from the same definition version), exports and deletes experiments. It also
  shows an experiment in Measure. Its Definitions panel lists each definition with its version
  count and last run, creates one from the Measure setup, renames and edits it, and runs it.
  Export gives an `.oscilla.json` file or CSV (transfer, impulse response, aggregate) with a
  metadata header and explicit unit columns.
- **Import.** An imported file is untrusted. Oversized files, wrong types, non-finite numbers,
  unknown algorithm IDs, a future schema version and a result-hash mismatch are all refused,
  each with its reason. The file format has its own schema version, independent of the
  product version
  ([ADR 0023](.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md), proposed).
  Schema 1 files import through a migration that adds the run ids and keeps their hash.
  Schema 2 files import through a migration that gives the experiment the definition derived from
  its own recipe (marked as derived) and keeps their hash.
- **Compare.** Comparing two or more experiments names every difference in calibration, sample
  rate, stimulus and algorithm. It also lists what changed between the experiments, grouped
  by domain: the definition version (an edit of the same definition between two experiments
  is said plainly), recipe (stimulus and analysis field by field, with units), algorithms (with the
  version step), calibration, input and output conditions, the Studio graph an experiment recorded
  (nodes and connections added or removed, parameters with their units, automation lanes),
  build provenance and the quality verdict and reasons. Execution changes come first. Layout,
  view and metadata changes are collapsed and never counted as execution changes. The list
  says what differs between the two records, not what caused a difference in the responses.
  A line names the evidence checklist items whose state differs between the experiments and the
  recorded identities (build, definition, calibration, input device) that differ.
  One experiment can be marked as the baseline: Compare then shows it first and compares a
  single selected experiment with it. The mark is metadata, kept in the file, and at most one
  experiment carries it
  ([ADR 0041](.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md),
  proposed). A minus B is shown only for equivalent experiments, and only
  over their overlapping valid range. Equivalent experiments also get an impulse-response
  overlay, each response drawn from its own direct peak on its original scale (there is no A
  minus B of impulse responses).
- **Where they are kept.** In this browser's IndexedDB only, also from `file://` (tested in
  Chromium, Firefox and WebKit, which keep an experiment across a reload). Where the database
  cannot open, experiments are kept in memory for the page view and the page says so; a full
  storage fails the save with its reason and keeps the result. The Playground never depends on
  this storage.

### Measurement quality

Every measurement is rated GOOD, USABLE, POOR or INVALID by a versioned rule set
(`oscilla.confidence.v4` for new measurements; v1-v3 are kept so stored ratings reproduce). The rules use named metrics: signal-to-noise, clipping, dropouts,
discontinuities, frequency coverage and resolution, repeatability, and calibration. Each
rating comes with its reasons, and each reason carries its value and unit. A check that was
not made reads NOT MEASURED. Severe clipping, an empty capture, or a dropout or discontinuity
inside the sweep makes a run INVALID; milder clipping lowers the rating. Statuses are shown with text, a glyph and a shape, never colour alone. The rationale
is in the proposed [ADR 0025](.ai/repo/adrs/0025-data-driven-quality-with-reasons.md).

### Scientific limitations

- **A measurement is of the whole chain.** That chain is the browser's output, the operating
  system, the DAC and amplifier, the loudspeaker, the room, the microphone position, the
  microphone, its ADC and the browser's input path. A room measurement is not "the speaker's
  response".
- **Browsers may process the input anyway.** OSCILLA requests input processing off but cannot
  enforce it. When the applied settings cannot be confirmed, the result says so.
- **SPL needs a level calibration.** Without a valid absolute level calibration, nothing is
  labelled dB SPL. A frequency profile alone never gives SPL
  ([ADR 0017](.ai/repo/adrs/0017-relative-levels-spl-only-when-calibrated.md),
  [ADR 0020](.ai/repo/adrs/0020-calibration-semantics.md), both proposed).
- **Results come from captured PCM.** Every result is computed from captured PCM by
  deterministic offline DSP. The live analyser is feedback only
  ([ADR 0018](.ai/repo/adrs/0018-measurement-from-captured-pcm-offline-dsp.md), proposed).
  Each stored result names its algorithm by a versioned ID
  ([ADR 0024](.ai/repo/adrs/0024-versioned-algorithm-ids.md), proposed).
- **The analysis runs in a Worker.** It is one serializable task, run in a Worker started from a
  `data:` URL of the page's own analysis script so that no step blocks the page; without Worker
  support the same code runs inline and yields between steps, with identical results (gap G21
  in the algorithm notes, resolved).
- **What the tests prove.** The automated tests check the digital pipeline, the mathematics on
  synthetic systems with known answers, the browser APIs and the interface. They cannot prove
  how your hardware, room or browser behaves.
- **No medical or certification claims.** OSCILLA is not audiometry and not an IEC 61672
  sound level meter.

## The V3.1 Studio

**Studio** is the last workspace before About. It is a patching and composition workspace
over the same audio engine: no second engine, and the engine's master chain and limits apply.
How to use it, with the keyboard shortcuts, is the [Studio user guide](docs/v31/user-guide.md).

- **The model is the source of truth.** A Studio document is a plain, versioned `StudioModel`:
  a graph of typed nodes and ports, a timeline of tracks and clips, automation lanes, and
  transport settings. Every edit is an action with undo and redo. The audio graph is compiled
  from the model and patched in place with crossfades, so editing during playback does not
  click. Details are in [the model](docs/v31/studio-model.md), [the compiler](docs/v31/compiler.md),
  [the timeline](docs/v31/timeline.md) and
  [patches and provenance](docs/v31/patches-and-provenance.md).
- **Graph editor.** Nodes look like the Signal Path boxes, joined by cables drawn in one SVG
  layer. Port glyphs show the signal type, and only compatible ports connect. A rejected
  connection, including a feedback loop without a delay, says why in words. The editor offers:
  - pan, zoom, and frame all or the selection
  - a node library
  - dropping a cable on empty canvas to pick a compatible node
  - rectangle selection, copy, paste, duplicate and delete
  - an inspector generated from each node's parameter schema, with units; with nothing
    selected it edits the transport and document settings (tempo, time signature, loop, notes)
  - search: `/` finds a node by name, type or category and frames it
- **Timeline, transport and automation.** Tracks hold clips that you create, move, resize,
  split and delete with snapping. The timeline also has a loop region, markers, a playhead that
  follows the audio clock, and automation lanes in each parameter's own scale. STOP and Escape
  release every node and source.
- **What runs, and what each edit did.** With nothing selected, the Inspector's Runtime section
  says whether the graph on screen is the one that plays: running, not applied, a previous
  configuration still running, refused or failed, with the diagnostic codes
  ([ADR 0039](.ai/repo/adrs/0039-studio-runtime-truth-plan-identity-applied-record-divergence.md),
  proposed). Its Trace section follows each recent edit, undo, Play and Stop under one
  operation id. It shows the action, the compiled plan with its hash, whether the running graph
  applied it, and each parameter value and connection gain the audio nodes report they were
  given, at its audio time. A setting that changes nothing audible at once is shown as stored. A
  refused edit shows its code, an edit made while stopped says it was not applied, and a
  parameter an automation lane drives is shown as owned. A selected node's Inspector lists only
  the operations that touched it. The trace is kept in memory for the session and is never saved
  or hashed
  ([ADR 0042](.ai/repo/adrs/0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md),
  proposed).
- **Keyboard and touch.** Every editor has a keyboard path: a "Connect…" dialog instead of
  dragging a cable, a details panel instead of dragging a clip, and arrow-key nudges. Changes
  are announced to screen readers. On coarse pointers the targets are 44 px. Below 768 px the
  workspace splits into Graph, Timeline and Inspector views.
- **Compact widget.** The Playground shows a small signal path and clip strip of the current
  Studio document, with a button to expand it to the full workspace.
- **Signal Path from the Studio model.** The Playground's Signal Path view draws the
  Playground voice expressed as a Studio graph: the same model kind and the same signal-path
  reading as Studio, read-only, with the boxes and wording it always had
  ([why and how](docs/v31/signal-path.md)).
- **Templates and patches.** Start from a template, then save, open, insert, export and import
  projects and patches. An import never overwrites silently, and a hostile file is refused.
  From `file://` the browser's storage may be unavailable; the library then uses memory and
  says so.
- **Render WAV.** The Studio renders offline through the same compiler, runtime and transport
  as live playback, with progress and Abort; the same Studio renders the same bytes. A live
  input (Microphone) is refused with the reason.
- **Measurement from Studio.** In the Measurement Sweep template, PLAY hands the measurement
  clips to the Measure workspace's measurement engine: the recipe is derived from the graph and
  the clips, and the saved experiment records the Studio graph it was run from (schema version,
  hash, execution state) beside its recipe, and the measured path the recipe was derived from
  with its own hash. A node the measurement never reads, such as an unconnected Oscillator, is
  recorded but is not an execution change when two experiments are compared. Such a record needs
  experiment schema 4, which earlier versions of OSCILLA refuse as newer than they support;
  every other record is still written as schema 3 and opens in them.
- **Performance.** Responsive at about 100 nodes and 200 connections; the numbers and budgets
  are in [performance](docs/v31/performance.md).
- **Links and fullscreen.** `#m=studio&st=<template id>&sv=<graph|timeline|inspector>` opens
  Studio, a shipped template and a view. It never starts playback, and it never replaces a
  document that has unsaved changes. An invalid link is refused with the reason. **Copy link**
  writes the current view, naming the template only while the document is that template
  unmodified. An optional **Fullscreen** button uses the browser's Fullscreen API where it
  exists; where it does not (Safari on iPhone), the button says so.

Studio output and Playground output are exclusive: starting one stops the other, and a
measurement stops the Studio.

Not yet built:
- a minimap
- node groups
- dragging several clips at once
- pinch zoom on the timeline

## Safety and measurement limits

- **Start quietly, especially on headphones.** Loudness is a poor guide to acoustic output,
  above all at very low and very high frequencies. Open-ended patterns stop at a hard time
  limit unless you allow continuous playback for the session, and a limiter caps the output.
- **Levels are relative, not SPL.** Every level is relative to digital full scale (dBFS-like)
  and labelled as uncalibrated. A browser knows sample values, not sound pressure. The only
  exception is the Measure workspace with a valid absolute level calibration that you supply
  from an external reference.
- **The microphone is not calibrated.** Its response, the input processing and the room are
  unknown, so readings are only comparisons. In Measure, a frequency-response profile corrects
  the microphone only inside the profile's range. Detected frequencies are never shown with more
  precision than the analysis resolution allows.
- **Measurement sweeps start at a low digital level.** Do not wear headphones during a
  loudspeaker sweep. Small speakers can be overloaded below about 50 Hz before you hear
  anything. The [measurement guide](docs/v3/measurement-guide.md) has the details.
- **Speaker output is unknown.** Generating a frequency digitally does not mean your hardware
  reproduces it accurately, or at all.
- **Hearing ranges are approximate.** They depend on the threshold criterion and on the
  individual. Each entry cites its source (for example Heffner & Heffner 2007) and lists
  differing published values.

The reasoning is in the proposed [ADR 0017](.ai/repo/adrs/0017-relative-levels-spl-only-when-calibrated.md)
and the rule [`project.no-fake-science`](.ai/repo/rules/project/no-fake-science.v2.md).

## Architecture

```text
src/  (ES modules, plain CSS, the src/index.html shell)
  -> scripts/build.mjs              esbuild (pinned): one IIFE app bundle + one stylesheet
     scripts/build-analysis-worker.mjs   the analysis library (one IIFE), imported by the app
  -> scripts/pack-single-file.mjs   pure string assembly; drops developer comments and
                                    markup indentation (pre, textarea, script, style verbatim)
  -> dist/index.html                the whole app: CSS, p5 block, analysis library, app
                                    bundle, licence notices, one build-metadata region
```

- **Deterministic build.** There are no timestamps or absolute paths, so the same inputs give
  the same bytes. `npm run build:check` rebuilds in memory and fails if the committed file
  differs. `npm run verify-dist` checks the artifact statically: nothing fetched or imported
  at runtime, no module scripts, licence notices present, size budget met.
- **Vendored p5.js.** p5.js is embedded byte-for-byte from its npm package as its own
  `<script data-vendor="p5@…" data-sha256="…">` block. It is never bundled into the app code,
  and `verify-dist` checks it against the pinned package file
  ([ADR 0013](.ai/repo/adrs/0013-p5-unmodified-separable-block.md)). Alpine.js and uPlot are
  bundled; Lucide icons are inlined at build time
  ([ADR 0012](.ai/repo/adrs/0012-self-contained-runtime.md)).
- **One copy of the analysis.** The offline analysis (the closure of
  `src/js/measurement/analysis-worker.js`) is bundled once, into its own classic
  `<script data-analysis>` before the app. The app imports it through that script's global and
  carries no copy; the analysis Worker is started from a `data:` URL of that same script text,
  so the Worker and the inline fallback run the same code and no file is loaded. The build
  fails if an analysis module is bundled into the app as well
  ([ADR 0026](.ai/repo/adrs/0026-audioworklet-and-worker-by-spike.md), resolution note).
- **dist/ is committed.** A clone runs without npm, every pull request shows how the artifact
  changed, and GitHub Pages serves the bytes CI checked (only the metadata region below is
  stamped) instead of running its own build.
- **Deploy-time provenance stamp.** A committed file cannot contain the hash of the commit that
  contains it. So the build writes one inline JSON region that records the version and a
  digest of the build inputs, with `commit: null`. The Pages workflow
  (`.github/workflows/pages.yml`) rewrites only that region with the deployed commit, the
  `production` channel, the commit date and the SHA-256 of the committed file
  ([ADR 0028](.ai/repo/adrs/0028-provenance-without-a-fixed-point.md)).
- **Engine and renderers.** The audio engine is the V1 engine on the native Web Audio API,
  extended through option hooks. All timing follows the audio clock
  ([ADR 0015](.ai/repo/adrs/0015-native-web-audio-engine-extended-in-place.md)). p5 draws the
  conceptual views, uPlot the quantitative charts, and custom canvas code the spectrogram and
  editors, all on one frame loop
  ([ADR 0016](.ai/repo/adrs/0016-renderer-split.md)).
- **Measurement layers.** V3 adds `src/js/measurement/`, `src/js/calibration/` and
  `src/js/experiments/`. Almost every module there is pure: plain data in, plain data out, no
  DOM and no Web Audio. Three modules are not: the engine, the browser capture adapter and the
  experiment store. The UI renders view models and computes nothing itself.
  [`docs/v3/architecture.md`](docs/v3/architecture.md) shows how stimulus, capture,
  calibration, analysis, result, quality and experiment fit together.

## Why one file?

You can double-click a single file and it works, even offline. GitHub Pages serves that same
file. The modular source exists so that the code can be tested and so that parallel work does
not collide; users never see it. See
[ADR 0011](.ai/repo/adrs/0011-modular-source-one-committed-dist.md) and the rule
[`project.single-file-deliverable`](.ai/repo/rules/project/single-file-deliverable.v2.md).

## Run locally

Double-click [`dist/index.html`](dist/index.html). No build, server or network is needed. Some
browsers refuse microphone access from `file://`. In that case the microphone panel and the
Measure setup check say so, and everything else keeps working. Where IndexedDB is unavailable
from `file://`, Experiments keeps saved experiments in memory for that page view and says so;
export them to keep them. To use the microphone locally, serve the repository on localhost and
open `dist/index.html` there:

```bash
python3 -m http.server 8000     # then open http://127.0.0.1:8000/dist/index.html
```

Or use the public URL: https://korczis.github.io/oscilla/

## Development

Requires Node.js 22 or later. The fast check also runs `majordomus doctor`, so it needs the
`majordomus` CLI.

```bash
npm ci
npm run verify          # fast: unit tests, version check, build check, artifact rules
npm run build           # src/ -> dist/index.html; commit dist/ together with the source change
npm run release-gate    # full gate, including the Playwright browser suites
npm run visual          # compare a screenshot with the visual reference at 1536x1024
```

`dist/index.html` embeds a digest of every build input (`src/`, `package.json`, the lockfile,
the build scripts), so any change to them, including a merge from `main` into a long-lived
branch, makes it stale by design: run `npm run build` and commit the result, or `build:check`
and CI fail.

The browser suites need Playwright's browsers (`npx playwright install chromium firefox
webkit`). Work lands through small pull requests. CI runs the gate on every pull request,
branch protection requires the `gate` check, and a merge to `main` redeploys Pages.

## Browser support

The release gate runs the built `dist/index.html` in Chromium, Firefox and WebKit (the engine
behind Safari) through Playwright. Each browser loads the file from `file://` and from a
GitHub-Pages-like `/oscilla/` sub-path, and the run must produce zero console errors.

## Testing

| Layer | Where | What it covers |
| --- | --- | --- |
| Unit | `tests/unit/` | Pure modules (DSP, analysis, sequencer, charts), the packer, the artifact rules and the release tooling, all under `node --test` |
| V1 freeze | `tests/freeze/` | Golden vectors that pin V1 behaviour ([ADR 0014](.ai/repo/adrs/0014-v1-behaviour-frozen-by-golden-vectors.md)) |
| Browser | `tests/browser/` | Playwright suites for the app gate, layout, navigation history and unsaved work, V1 engine port, DSP, labs and sequencer |
| Visual | `tests/visual/` | The 1536x1024 reference and named regions, compared region by region with thresholds measured from run-to-run variance ([ADR 0029](.ai/repo/adrs/0029-visual-regression-in-the-release-gate.md)) |
| V3 unit | `tests/unit/v3-*.test.mjs` | Measurement core, transfer and impulse response on synthetic systems with known answers, RTA and aggregation, calibration, quality, experiments (schema, round trip, corrupt imports, store), goldens per algorithm ID, the engine on a fake io and the view models, all in `npm test` |
| V3 browser | `npm run test:measure` | `tests/browser/v3-measure.cjs`: the measurement engine on real Web Audio, a recovered digital loopback response, limiter transparency, 0 nodes after finish and abort. `tests/browser/v3-ui.cjs`: Measure and Experiments of the built page, guided flow, abort at every stage, calibration, experiment import, compare and export, and no "SPL" without a level calibration. Both run in Chromium, Firefox and WebKit, from `file://` and `/oscilla/` |
| V3 visual | `scripts/visual-measure.mjs`, `tests/visual/measure/` | Measure at 1536x1024 and 390x844 showing a deterministic TEST CONTEXT experiment, against the accepted reference for each environment (part of `npm run test:visual`) |

Every V3 browser check runs on a TEST CONTEXT digital loopback or a fake microphone. No
automated test proves how a physical speaker, room or microphone behaves.

`npm run release-gate` is the authority on what the gate runs and in what order.
[`tests/README.md`](tests/README.md) describes each layer and how to run it alone.

## Versioning and releases

- **One source.** The `version` field in `package.json` is the only product version
  ([ADR 0027](.ai/repo/adrs/0027-package-json-is-the-product-version-authority.md)). The
  status bar, the About dialog, the exported configuration's `oscillaVersion` and
  `window.OSCILLA.version` all derive from it at build time. `npm run version:check` fails
  when any of these disagree, or when the current version is hard-coded anywhere else. That is
  why this README never names it. File-format schema versions are separate integers
  ([ADR 0023](.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md)).
- **SemVer.** MAJOR means an incompatible change to the configuration format or to a user or
  public contract (`type!:` or a `BREAKING CHANGE:` footer). MINOR means a new compatible
  capability (`feat:`). PATCH covers fixes, performance and any non-conventional commit.
  Commits that are only docs, chore, ci, test, refactor, style or build need no release.
  A new product generation (a new primary workspace family, such as V3's measurement
  workbench) may also take a MAJOR version without an incompatible change: the owner sets the
  untagged version in `package.json`, and `release:prepare` confirms it because it covers the
  level the commits require.
- **Release flow.**
  1. `npm run release:analyze` reads the conventional commits since the last `v*` tag and
     proposes the level, with a reason for each commit.
  2. `npm run release:prepare` starts from a clean tree. It bumps `package.json` once (or
     confirms an untagged version), rebuilds, and runs `version:check`, the release gate and
     `majordomus doctor`. If anything fails, it restores the files. It never tags. Land the
     result on `main` through a pull request.
  3. `npm run release:publish` is a dry run by default. With `-- --yes`, on `main`, it creates
     the annotated tag `vX.Y.Z`, pushes it, waits for the Pages deployment, verifies it, and
     creates the GitHub Release with notes generated from the commits since the previous tag,
     with the committed `dist/index.html` attached as `oscilla-vX.Y.Z.html`.
  4. `npm run release:record -- --version X.Y.Z` writes the release record
     `.ai/repo/releases/vX.Y.Z.yaml` (Majordomus `release/v1`): the tag and its commit, the
     channel, when the GitHub Release was published, its notes, and the attached file's
     SHA-256 and size read off the downloaded bytes, which must equal the committed
     `dist/index.html` at the tag (the artifact digest `verify-deploy` checks). A record is
     evidence: `-- --check` refuses one that differs from what was published, naming the
     field. Land it on `main` by a small pull request of its own (`release/record-vX.Y.Z`).
- **Tags** are `vX.Y.Z`. V1, the original hand-written single file, is `v1.0.0` (deployed) and
  `v1.0.1` (a maintenance tag that was never deployed).
- **About timeline.** A minor or major release adds its line to the About view's evolution
  timeline (one station with `data-osc-release="X.Y"`, marked current) before
  `release:prepare`. Rule `project.about-names-current-release` requires it, and
  `tests/unit/about.test.mjs` refuses a bump to a line the page does not name, so `verify` and
  the release gate fail until the station exists.
- **In the app.** The About dialog shows the version, the commit (linked to GitHub, or
  "source build" for a local build), the channel and the source digest. Opening the page with
  `?debug=1` adds the full commit SHA, the source date, the artifact hash, the config schema
  version and live engine state: sample rate, Nyquist, AudioContext state, voices, nodes,
  microphone state and the last error.
- **Inspection and test surface.** The page carries `window.OSCILLA`, the surface its own
  browser tests and the post-deployment smoke use, so the bytes that are tested are the bytes
  that are served. The stable reads are `version`, `build`, `measure.state`, `measure.counts()`,
  `studio.counts()`, `studio.model` and `studio.trace.steps()`; everything else may change
  without notice. Every member except `studioTimeline` (a second Studio context that one test
  suite builds; it is due to leave the page) is one of three kinds: it observes; it drives an
  action you already have in the page, through the same validation (`measure.useLoopback()` is
  `?measure=loopback`, `measure.setValues()` is a recipe link); or it injects test data.
  `measure.showResult()` refuses a result that is not marked TEST CONTEXT, so no injected result
  is shown or saved as a measurement, and a direct `measure.setInputNow()` is refused outside
  TEST CONTEXT. One gap is open: an input named while in TEST CONTEXT, or carried by an injected
  result, stays known afterwards, and a typed level reading can then bind to it. It is
  not a security boundary: any script running in the page can reach the same code without it.
  `?mock=1` only outlines the chart and view areas for layout comparison and never draws data.
- **Proof of deployment.** After every Pages deployment, `scripts/verify-deploy.mjs` fetches the
  public page, retrying a bounded number of times. It reverses the stamp and requires the
  result to be byte-identical to the committed `dist/index.html`. It also requires the stamped
  commit to be the deployed one, the version to match `package.json`, and the digest to match a
  fresh recomputation. Any mismatch fails the workflow. Run the same check yourself with
  `npm run release:verify-deploy`.

## Majordomus

The repository is supervised by [Majordomus](https://majordomus.dev). [`.ai/`](.ai/) holds the
project rules ([`.ai/repo/rules/project/`](.ai/repo/rules/project/)), the plan (milestones and
issues in [`.ai/repo/project/`](.ai/repo/project/)), the architecture decisions
([`.ai/repo/adrs/`](.ai/repo/adrs/)), features, use cases, workflows and knowledge notes.
`majordomus plan status` shows milestone progress. AI workers start at
[`AGENTS.md`](AGENTS.md) (Claude Code: [`CLAUDE.md`](CLAUDE.md)).

What is checked, and where:

- **On a commit and a push** (the git hooks Majordomus wires into a checkout): `majordomus
  doctor` validates the layer before a commit, and `majordomus finish --check` refuses a push
  outside the active task's scope. `npm run verify` runs `majordomus doctor` too.
- **In CI, on every pull request** (`.github/workflows/ci.yml`, all required through `gate`):
  the test suites; `tests/unit/knowledge-integrity.test.mjs`, which fails when a claim, rule,
  bootstrap or this README names a file that does not exist, and when a claim's test or a
  rule's `x-majordomus` test is not run by CI (other paths are checked only to exist);
  `tests/unit/storage-inventory.test.mjs`, which holds the privacy table below to the code; `tests/unit/no-fake-science.test.mjs`; and `majordomus doctor` at a pinned version.
- **Not checked by a machine**: a project rule is enforced by tests only where its
  `x-majordomus` block names them (`project.no-fake-science`), otherwise by review; use-case
  coverage of the claims is advisory; the worktree layout is a convention. An ADR's status
  `proposed` means recorded, not accepted (see [`.ai/repo/adrs/README.md`](.ai/repo/adrs/README.md)).

V3 Measure is specified in [`docs/specs/oscilla-v3-measure.md`](docs/specs/oscilla-v3-measure.md)
(milestones M012-M020). Its features, use cases and claims are under
[`.ai/repo/features/`](.ai/repo/features/), [`.ai/repo/use-cases/`](.ai/repo/use-cases/) and
[`docs/CLAIMS.yaml`](docs/CLAIMS.yaml). Each claim names the file that implements it and the
test that proves it.

V3.1 Studio ([`docs/specs/oscilla-v3.1-studio.md`](docs/specs/oscilla-v3.1-studio.md),
milestones M021-M033) has shipped (the V3.1 release tag); its features, use cases and claims are in the same
places, and `majordomus plan status` shows which Studio issues remain open.

## Privacy

There are no analytics, no server and no account. The page fetches nothing at runtime. The
microphone starts only when you press "Use microphone". Its signal goes to a local analyser
and is never played back, recorded or uploaded. Exports are downloaded to your machine. A
configuration URL contains only your settings, and it leaves your machine only if you share
it.

In Measure, the microphone opens only when you run the setup check or a measurement, and every
track is stopped when the measurement ends or is aborted. The captured audio is analysed in
the page. The raw recording is released after analysis and is never stored, exported or
uploaded. A saved experiment does contain the input device's label and the browser's device ID,
when the browser reports them, along with your notes and the results. Both go into an exported
file, so check it before you share it. Calibration profiles and level calibrations are kept in
page memory only.

Browser storage holds only these keys and one database, `oscilla-experiments` (version 3):

| Storage | Key | Contents |
| --- | --- | --- |
| localStorage | `oscilla.presets` | Your saved presets |
| localStorage | `oscilla.v2.theme` | Light or dark theme |
| localStorage | `oscilla.v2.analysisTab` | The last analysis tab |
| sessionStorage | `oscilla.history` | Recently played configurations (this tab only) |
| sessionStorage | `oscilla.safetyNoticeCollapsed` | Whether the safety notice was collapsed |
| IndexedDB | `oscilla-experiments`, object store `experiments` | Your saved experiments, in the exported file form |
| IndexedDB | `oscilla-experiments`, object store `summaries` | One small row per experiment for the list (name, date, schema and product version, quality status, size) |
| IndexedDB | `oscilla-experiments`, object store `studio` | Your saved Studio projects and patches (name, save time, studioHash and the document) |
| IndexedDB | `oscilla-experiments`, object store `studioSummaries` | One small row per Studio project or patch for the library list |
| IndexedDB | `oscilla-experiments`, object store `definitions` | Your experiment definitions, each with its versions (recipe, declared conditions, acceptance criterion, name and notes) |

Experiments are deleted only when you delete them. Permission to play continuously is never
stored.

## Licences

An HTML comment at the top of `dist/index.html` carries the name, version, licence and full
licence text of every bundled third-party package:

- Alpine.js (including its `@vue/reactivity` and `@vue/shared`) and uPlot: MIT.
- lucide-static (icons): ISC.
- p5.js: LGPL-2.1. It is shipped unmodified as a separately identifiable script block, and any
  compatible p5.js build can replace it.

OSCILLA's own code is released under the MIT License (see [`LICENSE`](LICENSE)). The same
notice comment carries it first, so the single published file contains its own licence text.
