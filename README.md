# OSCILLA

[![Deploy to GitHub Pages](https://github.com/korczis/oscilla/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/korczis/oscilla/actions/workflows/pages.yml)

An interactive sound and frequency laboratory that runs in the browser from one static file.

![OSCILLA playing a 440 Hz sine: source, waveform, relative spectrum, spectrogram, microphone analyzer, sequencer and device limits](site/og-image.png)

**Live demo:** https://korczis.github.io/oscilla/

## What it does

OSCILLA generates signals with the native Web Audio API and measures them while they play. It
shows them as a waveform, a live spectrum and a spectrogram, and it compares them with what your
microphone picks up. You can arrange signals into block sequences, shape them with filters, an
ADSR envelope and additive harmonics, explore phase and stereo, and export the result. The app
is a single HTML file. It needs no server, no account and no network once loaded, and it works
when opened straight from disk.

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

## Safety and measurement limits

- **Start quietly, especially on headphones.** Loudness is a poor guide to acoustic output,
  above all at very low and very high frequencies. Open-ended patterns stop at a hard time
  limit unless you allow continuous playback for the session, and a limiter caps the output.
- **Levels are relative, not SPL.** Every level is relative to digital full scale (dBFS-like)
  and labelled as uncalibrated. A browser knows sample values, not sound pressure.
- **The microphone is not calibrated.** Its response, the input processing and the room are
  unknown, so readings are only comparisons. Detected frequencies are never shown with more
  precision than the analysis resolution allows.
- **Speaker output is unknown.** Generating a frequency digitally does not mean your hardware
  reproduces it accurately, or at all.
- **Hearing ranges are approximate.** They depend on the threshold criterion and on the
  individual. Each entry cites its source (for example Heffner & Heffner 2007) and lists
  differing published values.

The reasoning is in the proposed [ADR 0017](.ai/repo/adrs/0017-relative-levels-spl-only-when-calibrated.md)
and the rule [`project.no-fake-science`](.ai/repo/rules/project/no-fake-science.v1.md).

## Architecture

```text
src/  (ES modules, plain CSS, the src/index.html shell)
  -> scripts/build.mjs              esbuild (pinned): one IIFE app bundle + one stylesheet
  -> scripts/pack-single-file.mjs   pure string assembly
  -> dist/index.html                the whole app: CSS, p5 block, app bundle, licence notices,
                                    one build-metadata region
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

## Why one file?

You can double-click a single file and it works, even offline. GitHub Pages serves that same
file. The modular source exists so that the code can be tested and so that parallel work does
not collide; users never see it. See
[ADR 0011](.ai/repo/adrs/0011-modular-source-one-committed-dist.md) and the rule
[`project.single-file-deliverable`](.ai/repo/rules/project/single-file-deliverable.v2.md).

## Run locally

Double-click [`dist/index.html`](dist/index.html). No build, server or network is needed. Some
browsers refuse microphone access from `file://`. In that case the microphone panel says so and
everything else keeps working. To use the microphone locally, serve the repository on localhost
and open `dist/index.html` there:

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
| Browser | `tests/browser/` | Playwright suites for the app gate, layout, V1 engine port, DSP, labs and sequencer |
| Visual | `tests/visual/` | The 1536x1024 reference and named regions, compared region by region with thresholds measured from run-to-run variance ([ADR 0029](.ai/repo/adrs/0029-visual-regression-in-the-release-gate.md)) |

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
- **Release flow.**
  1. `npm run release:analyze` reads the conventional commits since the last `v*` tag and
     proposes the level, with a reason for each commit.
  2. `npm run release:prepare` starts from a clean tree. It bumps `package.json` once (or
     confirms an untagged version), rebuilds, and runs `version:check`, the release gate and
     `majordomus doctor`. If anything fails, it restores the files. It never tags. Land the
     result on `main` through a pull request.
  3. `npm run release:publish` is a dry run by default. With `-- --yes`, on `main`, it creates
     the annotated tag `vX.Y.Z`, pushes it, waits for the Pages deployment, verifies it, and
     creates the GitHub Release with notes generated from the commits since the previous tag.
- **Tags** are `vX.Y.Z`. V1, the original hand-written single file, is `v1.0.0` (deployed) and
  `v1.0.1` (a maintenance tag that was never deployed).
- **In the app.** The About dialog shows the version, the commit (linked to GitHub, or
  "source build" for a local build), the channel and the source digest. Opening the page with
  `?debug=1` adds the full commit SHA, the source date, the artifact hash, the config schema
  version and live engine state: sample rate, Nyquist, AudioContext state, voices, nodes,
  microphone state and the last error.
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

Planned, not shipped: OSCILLA V3 Measure ([`docs/specs/oscilla-v3-measure.md`](docs/specs/oscilla-v3-measure.md))
and V3.1 Studio ([`docs/specs/oscilla-v3.1-studio.md`](docs/specs/oscilla-v3.1-studio.md)),
milestones M012-M033.

## Privacy

There are no analytics, no server and no account. The page fetches nothing at runtime. The
microphone starts only when you press "Use microphone". Its signal goes to a local analyser
and is never played back, recorded or uploaded. Exports are downloaded to your machine. A
configuration URL contains only your settings, and it leaves your machine only if you share
it.

Browser storage holds only these keys:

| Storage | Key | Contents |
| --- | --- | --- |
| localStorage | `oscilla.presets` | Your saved presets |
| localStorage | `oscilla.v2.theme` | Light or dark theme |
| localStorage | `oscilla.v2.analysisTab` | The last analysis tab |
| sessionStorage | `oscilla.history` | Recently played configurations (this tab only) |
| sessionStorage | `oscilla.safetyNoticeCollapsed` | Whether the safety notice was collapsed |

Permission to play continuously is never stored.

## Licences

An HTML comment at the top of `dist/index.html` carries the name, version, licence and full
licence text of every bundled third-party package:

- Alpine.js (including its `@vue/reactivity` and `@vue/shared`) and uPlot: MIT.
- lucide-static (icons): ISC.
- p5.js: LGPL-2.1. It is shipped unmodified as a separately identifiable script block, and any
  compatible p5.js build can replace it.

The licence for OSCILLA's own code has not been decided yet. `package.json` declares
`UNLICENSED`, and choosing a licence is an open decision for the owner.
