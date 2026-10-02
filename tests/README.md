# Tests

`npm run release-gate` runs, in order: `npm test`, `build:check`, `verify-dist`, then
`test:release` (`test:engine`, `test:dsp`, `test:labs`, `test:sequencer`, `test:measure`,
`test:browser`, `test:visual`). CI runs the same scripts as parallel jobs aggregated by the required `gate` job.
`OSC_BROWSERS=chromium,firefox` narrows the multi-browser suites. `test:live` (post-deploy, needs
the network) is run by the Pages workflow, not by release-gate.

Classes: **GATE** fails a release · **SUPPORTING** data or helpers a gate needs · **DIAGNOSTIC**
for people, never gating · **DELETED** removed, with its replacement.

| File | Class | Unique invariant |
| --- | --- | --- |
| `unit/freeze.test.mjs` | GATE | V1 behaviour (1083 vectors, golden from V1 a7b7a23) holds on the V2 modules |
| `unit/engine.test.mjs` | GATE | AudioEngine snapshot and extension points on a recording mock context |
| `unit/core.test.mjs` | GATE | applyConfig / URL restore, storage migration, safety rules |
| `unit/core-visualization.test.mjs` | GATE | the bridge reads snapshots only; p5 views render on a stub p5 |
| `unit/charts.test.mjs` | GATE | chart axis, log mapping, FFT-to-pixel and drag maths |
| `unit/analysis-peak.test.mjs` | GATE | FFT, Blackman window, dBFS calibration, peak interpolation |
| `unit/analysis-spectrogram.test.mjs` | GATE | colour LUT and dB-to-index mapping |
| `unit/analysis-misc.test.mjs` | GATE | analyser bin maths, reader throttle, frame-rate independent averaging |
| `unit/audio-envelope.test.mjs` | GATE | ADSR clamps and Web Audio automation semantics |
| `unit/audio-synthesis.test.mjs` | GATE | Fourier series and PeriodicWave arrays |
| `unit/audio-wav.test.mjs` | GATE | WAV header bytes and PCM conversion |
| `unit/bioacoustics.test.mjs` | GATE | species data is sourced and carries the disclaimer (no fake science) |
| `unit/integration-ui.test.mjs` | GATE | config file schema, typing guard, WAV render length |
| `unit/ui-shell.test.mjs` | GATE | theme resolution, slider fill, tab restore, LUT ends (moved from `visual/ui.test.mjs`) |
| `unit/sequencer-model.test.mjs` | GATE | block schemas, Nyquist-safe frequency clamps |
| `unit/sequencer-compiler.test.mjs` | GATE | planned automation: sorted, never gain 0, frequencies in range |
| `unit/sequencer-timeline.test.mjs` | GATE | time scale, ticks, block rectangles |
| `unit/sequencer-editor.test.mjs` | GATE | editor state, no Web Audio in state, stop timing constants |
| `unit/pack-single-file.test.mjs` | GATE | the packer inlines in order and escapes `</script` |
| `unit/verify-dist.test.mjs` | GATE | verify-dist rejects modules, external scripts, altered vendors |
| `unit/social-meta.test.mjs` | GATE | favicon, touch icon and Open Graph tags are complete and absolute |
| `unit/sequencer-fake-audio.mjs` | SUPPORTING | recording fake AudioContext for the sequencer units |
| `freeze/vectors.cjs`, `freeze/extract.cjs`, `freeze/golden-a7b7a23.json`, `freeze/freeze-plan.txt` | SUPPORTING | inputs, V1 harness and golden of the freeze |
| `browser/app.cjs` | GATE | dist in chromium, firefox, webkit from file:// and the /oscilla/ sub-path: boot, controls, audio, export, a11y, overflow at fine pointer |
| `browser/layout.cjs` | GATE | 320-1536 px, every workspace: no squashed or overlapping panel, transport hit-testable, no page overflow; coarse pointer at 320/375/768: no overflow, 44 px targets; Escape and page hide stop the sequencer |
| `browser/engine-v1port.cjs` | GATE | V1's 77 engine checks on the V2 engine; teardown bounded on the audio clock (deadline polls) |
| `browser/dsp.cjs` | GATE | DSP modules in real browsers: analyser calibration, filter responses, panning, noise |
| `browser/labs.cjs` | GATE | chart renderers and lab controllers against a fake engine adapter, fake mic device |
| `browser/sequencer.cjs` | GATE | rendered sequence frequencies, click-free block edges and stops, 0 live sources after stop |
| `browser/v3-measure.cjs` | GATE | the MeasurementEngine and capture io on real Web Audio (TEST CONTEXT loopback), file:// and /oscilla/: recovered loopback response, limiter transparency (G12), 0 nodes after finish and abort, fake-microphone capture path |
| `browser/v3-ui.cjs` | GATE | MEASURE and EXPERIMENTS of dist in chromium, firefox, webkit, file:// and /oscilla/: guided flow through the UI on a TEST CONTEXT loopback, stage announcements, abort at every stage (Escape, STOP, page hide, leaving the workspace) with 0 nodes after, output exclusivity, fake-microphone setup check, calibration import and level calibration, experiment import/compare/rename/duplicate/export/CSV/delete, no "SPL" without a valid level calibration |
| `browser/fixtures/v3-experiments.mjs` | SUPPORTING | deterministic TEST CONTEXT experiments (the real engine on a synthetic io) for `v3-ui.cjs` and the MEASURE visual reference |
| `unit/v3-ui.test.mjs` | GATE | navigation order (About last), the workspaces' static markup rules, the pure experiment builder of MEASURE |
| `../scripts/visual-measure.mjs` + `visual/measure/*` | GATE | MEASURE at 1536x1024 and 390x844 showing a deterministic TEST CONTEXT experiment, against the accepted reference per environment (≤ 0.5 % differing pixels) |
| `browser/live-smoke.cjs` | GATE (post-deploy) | the public site boots, its provenance region matches the runtime, HOLD sounds and cleans up |
| `browser/fixtures/*` | SUPPORTING | in-memory esbuild entries and pages for dsp, labs, sequencer |
| `../scripts/visual-gate.mjs` + `visual/baseline.json` | GATE | 1536x1024 `--play` scene vs accepted values per environment: per-region chrome (+0.5 pp) and data (+measured variance) mismatch, panel and control geometry within 2 px, totals |
| `visual/reference.png`, `visual/regions.json` | SUPPORTING | the visual reference and its region and control boxes |
| `../scripts/visual-compare.mjs` (`npm run visual`), `visual/preview-boot.mjs` | DIAGNOSTIC | side-by-side, crops, responsive shots; the gate reuses its capture |
| `browser/dist-gate.cjs` | DELETED | targeted skeleton ids and crashed; superseded by `app.cjs` and `verify-dist` |

Visual baseline: `node scripts/visual-gate.mjs --update-baseline` re-accepts the current
environment deliberately (3 runs; it refuses an unstable chrome). The CI environment
(`linux-x64`) is the Playwright container: `docker run --rm --platform linux/amd64 --ipc=host -v
"$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble node scripts/visual-gate.mjs
--update-baseline`. The MEASURE references are re-accepted the same way with
`node scripts/visual-measure.mjs --update-reference` (same container command for linux-x64).
