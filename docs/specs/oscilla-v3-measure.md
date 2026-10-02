# OSCILLA V3 — MEASURE (specification as supplied by the requester, 2026-10-02)

Recorded verbatim in content; only the `=====` rulers and blank lines between list items were
condensed. Section numbers are the requester's. Plan: milestones M012-M020, issues V3xx.

Repository: https://github.com/korczis/oscilla · Public deployment: https://korczis.github.io/oscilla/

You are evolving an EXISTING product. Do NOT treat the repository as disposable. Do NOT rewrite
working V2 architecture without evidence. Do NOT build a prototype beside the real application.

Mission: transform OSCILLA from V1 PLAY (generate → see → learn) and V2 LAB (generate → analyze →
compose → filter → synthesize → compare → export) into V3 MEASURE (calibrate → measure → repeat →
compare → quantify → reproduce → verify).

Defining idea: OSCILLA V3 is a zero-install, scientifically honest, reproducible acoustic
measurement and experiment platform that runs entirely in the browser.

Primary loop: GENERATE → PHYSICAL SYSTEM → OBSERVE → CALIBRATE → MEASURE → ASSESS CONFIDENCE →
REPEAT → COMPARE → SAVE EXPERIMENT → REPRODUCE. This is the center of V3.

Addendum (requester): V2 = AnalyserNode → chart. V3 = PCM capture → deterministic offline DSP →
structured MeasurementResult → quality / provenance → chart.

## 0. Do not start coding
Before changing code: 1 inspect current main; 2 public deployment; 3 tags/releases; 4 package
version; 5 build provenance; 6 V2 architecture; 7 all Majordomus project state; 8 ADRs;
9 Features; 10 Use Cases; 11 deployment/release records; 12 tests; 13 CI/release gate; 14 visual
reference; 15 V2 release-engineering state; 16 read current Majordomus documentation; 17 create a
durable V3 implementation plan. Do not assume observations in this specification match HEAD.
Verify first.

## 1. Current product baseline
V2 is expected to provide most or all of: signal generator; sine/square/triangle/saw; frequency
patterns; sweep; dual oscillator; live waveform; FFT spectrum; spectrogram; microphone analyzer;
generator vs microphone compare; sequencer; filters; ADSR; additive synthesis; phase
visualization; Lissajous; stereo; bioacoustics; WAV export; config import/export; URL state;
presets; direct file:// execution; GitHub Pages deployment; modular source; single-file
dist/index.html; build provenance; Majordomus governance; automated browser tests. VERIFY EACH
RELEVANT CAPABILITY. Do not duplicate existing functionality. V3 should reuse the strongest parts
of V2.

## 2. V3 product definition
Primarily A BROWSER ACOUSTIC MEASUREMENT WORKBENCH. It answers: what acoustic signal did my
playback system actually produce; how observed output differs from the requested digital signal;
the frequency response of this playback/room/microphone chain; the impulse response; how
repeatable the measurement is; the measurement uncertainty; whether the signal clipped; the noise
floor; comparing two measurements; reproducing the exact experiment later; which calibration
profile was used; which OSCILLA version and algorithm produced the result. NOT merely a larger
synthesizer.

## 3. V3.0 scope
Six capabilities: 1 calibration profiles; 2 transfer function / frequency response; 3 impulse
response; 4 RTA / real-time analyzer; 5 reproducible experiments; 6 measurement quality /
confidence. Do NOT let optional future ideas derail completion.

## 4. Future V3.x architectural preparation
V3.1: RT60, EDT, T20, T30, ETC, room decay, THD, THD+N, latency, phase transfer, group delay,
device characterization. V3.2: experiment recipes, batch measurement, automation,
repeat/aggregate pipelines, CSV analysis workflows, algorithm-versioned measurements. V3.3: deeper
AudioWorklet DSP, WASM/Rust DSP if benchmarks justify it, larger FFT/deconvolution workloads,
optimized convolution/correlation. DO NOT implement V3.1-3.3 during V3.0. Prepare interfaces only
when that improves V3.0 architecture.

## 5. Majordomus first
Visit https://majordomus.dev/ and read CURRENT documentation. Inspect `majordomus --version`,
`--help` and current commands for context, doctor, plan, task, feature, product, usecase, adr,
decision, question, evidence, deployment, release, knowledge, rules, worktree, check, finish,
update. Do not rely on remembered commands. Do not hallucinate unsupported capabilities.

## 6. Majordomus bootstrap
Run the correct bootstrap/validation. Establish: repository context, applicable project rules,
worktree status, project plan state, V2 milestone state, ADR validity, Feature validity, Use Case
validity, knowledge validity, doctor state. Fix legitimate issues before V3. Do not suppress
failures merely to proceed.

## 7. Create V3 project model
Represent V3 work in Majordomus project state; milestone hierarchy appropriate to the schema.
Suggested: V3-M1 measurement architecture; M2 calibration; M3 transfer-function measurement;
M4 impulse-response measurement; M5 RTA; M6 experiment model; M7 measurement quality/confidence;
M8 integrated V3 workbench UX; M9 verification and release. Use repository numbering conventions.

## 8. Task decomposition
At minimum: baseline audit; measurement architecture; measurement state model; stimulus
abstraction; capture abstraction; calibration model; calibration import/export; calibration
interpolation; calibration UI; transfer-function DSP; transfer-function visualization; sweep
measurement workflow; impulse-response excitation; deconvolution; impulse-response visualization;
RTA engine; octave bands; third-octave bands; averaging; noise floor; clipping detection;
repeatability; measurement confidence; experiment schema; experiment persistence; experiment
import/export; experiment comparison; experiment provenance; algorithm versioning; source/input
metadata; measurement UX; responsive layout; accessibility; visual acceptance; test suite;
release; deployment. Each must have acceptance evidence.

## 9. Autonomous execution loop
Per task: read task/spec; resolve Majordomus context; inspect relevant code; inspect relevant
ADRs; run ADR affected analysis when architecture is touched; implement; focused tests; inspect
result; consult Codex/ChatGPT/Gemini where useful and available; evaluate criticism technically;
refine; rerun tests; record evidence; update canonical Features/Use Cases/decisions; verify
knowledge; checkpoint; proceed. Brief progress updates only. No waiting for approval of ordinary
engineering decisions.

## 10. No uncontrolled feature creep
Not in V3.0 unless required: MIDI, cloud accounts, server backend, collaboration, social sharing,
plugin marketplace, AI sound classification, generative music, DAW multitrack, 3D room
simulation, VST-style effects, healing/focus frequencies, medical interpretation, therapy. V3.0 is
measurement infrastructure.

## 11. Architectural principle
Distinguish SIGNAL GENERATION from MEASUREMENT. Layers explicit: Stimulus → Output → Physical
system → Input → Capture → Calibration → Analysis → Measurement Result → Quality Assessment →
Experiment.

## 12. Measurement pipeline
StimulusGenerator → PlaybackSession → audio output; physical world; MediaStream input →
CaptureSession → input calibration → MeasurementAnalyzer → MeasurementResult → QualityAssessment →
ExperimentStore. UI state separate from DSP state.

## 13. Measurement session
Explicit session abstraction: sample rate, requested stimulus, capture start/stop,
synchronization, calibration, signal quality, analysis algorithm version, result generation,
cleanup. No measurement orchestration in Alpine event handlers.

## 14. Stimulus abstraction
Required stimuli: sine; logarithmic sweep; white noise; pink noise; band-limited noise; short
chirp/impulse-like signal where appropriate. Reuse the V2 pattern engine where correct; do not
duplicate generator logic.

## 15. Pink noise
Technically defensible: a known approximation/filter strategy, not a gain ramp. Document
limitations. Test spectral slope statistically.

## 16. Band-limited noise
Minimum and maximum frequency with proper filter behaviour; for measurement exploration.

## 17. Calibration model
Two separate types: A frequency-response calibration (frequency-dependent correction); B absolute
level calibration (relative amplitude → claimed SPL scale). NEVER conflated.

## 18. Frequency-response calibration
Frequency/correction pairs (e.g. 20 Hz +4.2 dB, 50 Hz +1.7, 100 Hz +0.5, 1 kHz 0.0, 10 kHz +2.1,
20 kHz +6.8). Implement parsing, validation, interpolation, extrapolation policy, enable/disable,
raw/corrected overlay.

## 19. Calibration interpolation
Interpolate in the log-frequency domain, not linear Hz; amplitude linear in dB between points
unless a better documented method is justified. Test it.

## 20. Calibration import
CSV and optionally JSON; `frequency_hz, correction_db`; tolerant of commas, tabs, headers,
comments; never accept ambiguous malformed files silently.

## 21. Calibration export
Normalized OSCILLA format: schema version, profile name, source/manufacturer where the user
provides it, points, units, notes, created/imported metadata. Do not invent provenance.

## 22. Calibration profile UX
Dedicated UI; UNCALIBRATED or CALIBRATED prominent but unobtrusive; profile name; frequency
correction on/off; absolute SPL calibration on/off. Never let relative be mistaken for SPL.

## 23. Absolute level calibration
Optional and explicit. Workflow: 1 kHz reference; known external 94 dB SPL; observed relative
level X; derived offset Y; store offset and conditions. No fake default SPL calibration.

## 24. SPL labeling rule
Without valid absolute calibration display "Relative level, dBFS-like / analyser-relative scale",
never "dB SPL". With it: "dB SPL" and a visible CALIBRATED indicator.

## 25. Calibration provenance
Every result keeps calibration profile ID, profile version/hash, absolute calibration state,
frequency calibration state.

## 26. Transfer function
Known stimulus X(f), observed Y(f), H(f) = Y(f)/X(f); complex domain where phase/sync data
suffice. At minimum a robust magnitude response.

## 27. Transfer-function scope
Required: magnitude. Optional only if robust: phase. Do not fake phase.

## 28. Log sweep measurement
Guided log sine sweep, default 20 Hz → 20 kHz, 5-20 s selectable, conservative output, custom
range, respect Nyquist.

## 29. Measurement workflow
1 input device; 2 calibration profile; 3 sweep range; 4 duration; 5 output level; 6 preflight;
7 noise floor; 8 sweep; 9 analyze; 10 result; 11 quality/confidence; 12 save experiment. The
canonical V3 experience.

## 30. Preflight
Check AudioContext, sample rate, mic permission, input stream, input clipping, background noise,
range vs Nyquist, calibration availability, output level. Show READY or actionable warnings; do
not block on noncritical warnings.

## 31. Noise floor
Optional short ambient capture before the sweep; noise spectrum and broadband relative level; used
in quality. No calibrated ambient SPL without calibration.

## 32. Signal-to-noise
SNR where meaningful; prefer frequency-dependent; at minimum signal vs preflight noise per band.

## 33. Transfer result
Magnitude with raw, calibrated, optional smoothing, confidence/reliability region; log frequency
axis; relative or calibrated dB.

## 34. Response normalization
Optional (e.g. to 1 kHz, or mean over a band); clearly labelled; never silent.

## 35. Smoothing
None, 1/24, 1/12, 1/6, 1/3 octave; raw kept; smoothing is a derived view.

## 36. Frequency-response cursor
Frequency, raw magnitude, calibrated magnitude, confidence, SNR; uPlot or existing quantitative
charts.

## 37. Impulse response
Required in V3.0; log-sweep stimulus with deconvolution; not a literal one-sample impulse as the
primary method.

## 38. Deconvolution
Mathematically correct sweep deconvolution: inverse filter for the exponential sweep, or
frequency-domain deconvolution; chosen for correctness, browser feasibility, testability;
documented in an ADR / algorithm note.

## 39. IR output
Time-domain IR with time axis and relative amplitude; direct peak, early reflections where
visible, noise tail.

## 40. IR windowing
Inspect/select a useful time region; never destructively crop the original.

## 41. IR normalization
Display may normalize peak to 0 dB or 1.0, clearly labelled; original scale kept in the
experiment.

## 42. IR metadata
Sample rate, measurement start, stimulus, sweep duration, deconvolution algorithm and version,
calibration profile, input device metadata where available.

## 43. Algorithm versioning
Stable IDs (e.g. oscilla.transfer.v1, oscilla.ir.log-sweep.v1, oscilla.peak.v2, oscilla.rta.v1,
oscilla.confidence.v1) persisted in results; interpretation never depends only on current code.

## 44. RTA
Modes FFT, OCTAVE, 1/3 OCTAVE; all three in V3.0.

## 45. FFT RTA
Reuse/improve the V2 analyzer: live relative spectrum, averaging, peak hold, freeze, log axis;
calibration correction when enabled.

## 46. Octave bands
Standard nominal octave centres; standards-compatible centre mathematics; band edges derived, not
hard-coded approximate bars.

## 47. Third-octave bands
Standard-style 1/3-octave centres (V2 values may be reused) but levels aggregate spectral energy
correctly; do not sample the FFT at centres.

## 48. Band power
Integrate power over each band's FFT bins; power-based aggregation; never average dB.

## 49. RTA averaging
Instant, fast, slow with documented time constants; optional peak hold; no IEC-grade claim unless
implemented and verified.

## 50. Experiment model
First-class EXPERIMENT, larger than a preset; versioned schema: { schemaVersion, oscillaVersion,
experimentId, name, stimulus, output, input, calibration, environment, measurement, quality,
algorithms, results, provenance }. Never serialize Web Audio nodes.

## 51. Experiment provenance
OSCILLA version, commit, experiment schema version, algorithm IDs, sample rate, input metadata the
browser exposes, calibration identity, stimulus parameters, analysis parameters, timestamp.

## 52. Device metadata
Only what the browser exposes; otherwise "Unknown / browser did not expose device label". Never
invent device names.

## 53. Environment notes
Manual notes (distance, room, position, device, temperature); no pretence of automatic sensing.

## 54. Experiment storage
Browser storage; evaluate IndexedDB vs localStorage; likely IndexedDB; design a storage layer.

## 55. file:// storage
Keep file:// usable; test IndexedDB/localStorage under file:// in target browsers; fall back to
import/export; measurement never depends on persistence.

## 56. Experiment file format
Export/import; `.oscilla.json` (or `.oscilla` if clean); JSON preferred; large arrays may be
encoded compactly; no opaque binary yet.

## 57. Data size
Explicit storage representation for IR/spectrum arrays (numeric arrays, base64 typed arrays,
compressed blocks); evaluate trade-offs; prefer correctness and portability.

## 58. Import validation
Imports are untrusted: strictly validate schema, numeric bounds, array sizes, algorithm IDs,
calibration data, strings; never eval; avoid memory bombs; set maximum sizes.

## 59. Experiment comparison
Two or more compatible experiments; required: frequency-response overlay; useful: IR overlay;
A, B, A−B where meaningful.

## 60. Comparison metadata
Show differences in calibration, sample rate, stimulus, algorithm version; warn on non-equivalent
experiments; never silently normalize incompatible data.

## 61. Repeat measurements
Repeated runs (e.g. 5) then an aggregate.

## 62. Aggregation
Mean and median for compatible vectors; variability for repeated curves.

## 63. Variance / dispersion
Uncertainty envelope (standard deviation or robust percentile band for median); choose and
document.

## 64. Measurement quality
Explicit, DATA-DRIVEN assessment ("no AI vibes"): clipping, SNR, noise-floor margin,
repeatability, bin resolution, signal stability, calibration presence, range coverage, input
dropout, variance.

## 65. Quality status
GOOD, USABLE, POOR, INVALID. Avoid "HIGH CONFIDENCE" unless numeric semantics are defensible; if
HIGH/MEDIUM/LOW, define exact rules.

## 66. Quality reasons
Always show reasons (e.g. "✓ no clipping, ✓ 27 dB median SNR, ✓ five runs agree within ±0.8 dB,
✓ calibrated microphone profile loaded" or "! 15-20 kHz only 3 dB above noise floor, ! clipping
at 930 Hz, ! calibration absent above 16 kHz"). No unexplained score.

## 67. Clipping detection
Threshold plus run-length/statistical logic, not only exact ±1; report clipping regions.

## 68. Dropout / invalid capture
Detect empty capture, stalled input, abnormal zero buffers, discontinuities; mark invalid rather
than draw authoritative graphs.

## 69. Frequency resolution
Show Δf = sampleRate / FFTSize; use it for peak uncertainty; no precision beyond resolution.

## 70. Peak precision
Parabolic interpolation is reported as an estimate; no laboratory-grade claim.

## 71. Repeatability
Pointwise deviation and a summary (median absolute deviation or standard deviation); robust
where appropriate.

## 72. Measurement workbench UI
Primary V3 workspace MEASURE. Conceptual desktop layout: header "OSCILLA / MEASURE" with
CALIBRATED?; row of STIMULUS (sweep 20 → 20k, 10 s LOG) | LIVE INPUT (spectrum, level, device,
calibration) | QUALITY (READY, noise, clip, SNR); MEASUREMENT RESULT (frequency response / IR /
RTA); bottom MEASUREMENT SETUP (input/output/calibration) | EXPERIMENT (save/repeat/compare). Do
not reproduce literally if the cockpit suggests better; preserve OSCILLA design language.

## 73. Navigation
PLAYGROUND, MEASURE, EXPERIMENTS, ANALYZE, SYNTHESIS, LEARN. Preserve valuable V2 functions. No
14 top-level tabs.

## 74. Playground vs Measure
PLAYGROUND = direct sound experimentation; MEASURE = structured stimulus/capture/analysis.

## 75. Analyze
Live analyzer, spectrogram, RTA, existing mic analysis, saved measurement inspection; avoid
duplicated controls.

## 76. Experiments
Management surface: new, recent, open, rename, duplicate, delete, export, import, compare. No
cloud. Local-first only.

## 77. Guided measurement
Steps: 1 input; 2 calibration; 3 noise check; 4 stimulus; 5 measure; 6 review; 7 save. Experts
can bypass.

## 78. Expert mode
Range, sample settings, FFT, window, averaging, calibration, repeat count, smoothing, duration;
progressive disclosure.

## 79. AudioWorklet evaluation
Evaluate; do not migrate everything; evidence-based. Candidates: measurement capture,
synchronized stimulus timing, sample-level buffer access, custom DSP.

## 80. AudioWorklet baseline
Spike first: timing stability, buffer access, browser support, file://, build size, Safari.
Record the result. Adopt for the measurement kernel if beneficial; otherwise keep the graph.

## 81. AudioWorklet + single file
Artifact stays a single HTML; no separate worklet `.js` at runtime; e.g. inline source → Blob URL
→ addModule; verify file://, Pages, Chrome, Firefox, Safari/WebKit.

## 82. AudioWorklet CSP / Blob
Document CSP implications; do not add a CSP that blocks required Blob module loading.

## 83. WASM / Rust
Not by default. JS first and benchmark; WASM only if deconvolution, correlation or large FFT is
too slow, memory needs it, or profiling shows material gain. Record the benchmark first.

## 84. FFT strategy
AnalyserNode FFT is for visualization; offline FFT over captured arrays for measurements;
evaluate existing JS FFT, a small library, custom, later WASM; AnalyserNode must not be the sole
source for offline scientific results.

## 85. Offline analysis
Captured PCM plus deterministic offline analysis for final results; live analyzer for feedback;
results never depend on whichever frame was visible.

## 86. Windowing
Explicit window functions: at least Hann, possibly Blackman-Harris; exposed where useful;
recorded as algorithm choice.

## 87. Signal capture
Capture PCM for the required duration; bounded memory; never record indefinitely; transient
unless explicitly saved.

## 88. Privacy
Mic data stays local; no backend, upload or analytics; raw PCM saved only by explicit choice;
default stores derived results.

## 89. Raw data option
Optional SAVE RAW CAPTURE with a size warning; no auto-storage of long recordings.

## 90. Room acoustics (future)
IR representation supports later RT60, EDT, T20, T30, ETC, C50, C80; not implemented in V3.0.

## 91. Latency (future)
Keep timing information for future latency/cross-correlation; no latency claim without a
sufficient clock relationship.

## 92. THD (future)
Spectrum model extensible to fundamental, harmonics, THD, THD+N; not casually; chain distortion
acknowledged.

## 93. Calibration sources
No manufacturer files without licence/provenance; users import their own; bundled examples marked
as examples.

## 94. Bioacoustics
Preserved; V3 not animal-focused; reference ranges may be overlays.

## 95. Reference overlays
Optional: human hearing, species range, speech range, musical notes; context layers, not
transformations.

## 96. Units
Hz, kHz, ms, s, dB relative, dB SPL only when calibrated, degrees where phase exists; no
percentages for measurement amplitude.

## 97. Numeric precision
Precision matches uncertainty (not 18437.238194 Hz at 5.86 Hz resolution).

## 98. Scientific honesty
Always distinguish REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED, NORMALIZED. Never blur.

## 99. Data provenance
Every result traceable to stimulus, input, calibration, algorithm, software version, sample rate,
settings. No orphan graph.

## 100. Experiment hash
Deterministic configuration hash (SHA-256 when available) over configuration/provenance, not
mutable UI state.

## 101. Result hash
Optional hash of result data to detect corruption; skip if it adds little.

## 102. Shareable recipe
URL hash may carry small recipes; never results.

## 103. Recipe vs experiment
RECIPE = what to do; EXPERIMENT = what was done plus the result. In the architecture.

## 104. Experiment repeat
REPEAT loads the same recipe and creates a new experiment; never overwrite silently.

## 105. Compare workflow
Experiment A, B → compare: common configuration, differences, overlays, delta.

## 106. Device characterization workflow
Optional CHARACTERIZE PLAYBACK CHAIN: noise, sweep, response, quality, save. Never claim "speaker
response" when the chain includes room, mic, ADC and DSP; say OBSERVED PLAYBACK / CAPTURE CHAIN
RESPONSE unless isolated.

## 107. Room / distance warning
Mic position affects response; do not hide room effects; record distance/location notes.

## 108. Repeatability guidance
Encourage repeats without patronizing: "Run 1/5, 2/5 ..." and aggregate automatically.

## 109. Real-time quality bar
During measurement: INPUT OK, NOISE GOOD, CLIPPING NONE, SIGNAL ACTIVE, CAPTURE 63% — derived
from data.

## 110. Progress
From AudioContext time / the measurement timeline, not loose JS timers.

## 111. Abort
ESC / STOP aborts safely and cleans stimulus nodes, input capture, worklet/buffer, analysis state,
timers, UI state. Never leave sound playing.

## 112. Error states
Mic denied, mic disconnected, AudioContext suspended, input clipping, no input, capture timeout,
analysis failure, invalid calibration, memory limit, unsupported AudioWorklet, offline FFT
failure, storage failure — with useful errors.

## 113. Cross-browser
Priority: Chrome desktop, Edge, Firefox, Safari macOS, Safari iOS, Chrome Android. Feature-detect;
no sniffing unless unavoidable.

## 114. Safari
getUserMedia, AudioContext resume, AudioWorklet, MediaStreamSource, OfflineAudioContext,
IndexedDB under file://, Blob module worklets, canvas, typed-array performance; test WebKit via
Playwright where meaningful.

## 115. Mobile V3
Guided measurement first; not the dense cockpit squeezed to 390 px; priority: status, stimulus,
input, result, save; advanced settings expandable.

## 116. Desktop V3
Dense lab UI: stimulus, input, quality, primary result, setup, experiment without excessive
navigation.

## 117. Visual language
Preserve the V2 design system; extend tokens/components; accessible measurement colours for
requested/generator, observed, calibrated, warning, invalid.

## 118. No colour-only meaning
Quality states use text, icon and shape.

## 119. Chart system
uPlot quantitative; p5 conceptual/custom; custom canvas spectrogram/raster; no Chart.js.

## 120. Response chart
uPlot: log Hz, dB, raw/calibrated, optional smoothing, confidence envelope, cursor.

## 121. IR chart
uPlot or a custom high-performance line; X ms; Y relative amplitude or dB; zoom.

## 122. RTA chart
Custom bars or uPlot; bars correspond to calculated band power.

## 123. Performance budget
Profile CPU, memory, capture arrays, FFT, deconvolution, chart update; no large per-frame
allocations.

## 124. Worker thread
Evaluate a Web Worker for FFT, deconvolution, aggregation; bundled via Blob URL; test file://.

## 125. Single-file distribution
Mandatory unless an accepted ADR changes it: modular src/, one dist/index.html, no runtime
external files.

## 126. Build
Keep the build pipeline unless evidence requires change.

## 127. Dependency policy
New dependency needs clear benefit, licence audit, size impact, file:// and single-file
compatibility, browser support. Prefer small focused algorithms.

## 128. No backend
Static; no API, cloud account, upload or database server. Local IndexedDB is not a backend.

## 129. Build size
Track artifact size; analyse contributors before raising a budget.

## 130. Versioning
Use the V2 single-source version system; no hard-coded V3 version; release likely 3.0.0; verify
the release policy.

## 131. Experiment schema versioning
Separate product version, experiment schema version, calibration schema version, config/preset
schema version. Never 3.0.0 for all four.

## 132. Migrations
Explicit schema migrations (1 → 2) supported by the parser architecture; V3.0 starts at
experiment schema 1.

## 133. Majordomus Features
Candidates: measurement-workbench, calibration-profiles, transfer-function, impulse-response, rta,
experiments, measurement-comparison, measurement-quality. Current schema.

## 134. Majordomus Use Cases
Executable or evidence-backed: calibrate a mic frequency response; measure a playback/capture
chain response; measure an impulse response; run third-octave RTA; repeat a measurement five
times; compare two responses; save and reload an experiment; export an experiment; open V3 from
file://.

## 135. V3 ADRs
Candidates: measurement pipeline architecture; recipe vs experiment; calibration semantics;
relative vs calibrated SPL semantics; offline final analysis vs live visualization; AudioWorklet
adoption or rejection; worker-based offline DSP; experiment persistence; experiment schema
versioning. Not for trivial code structure.

## 136. Knowledge
Majordomus Knowledge must discover the canonical objects; no duplicate hand-written encyclopedia.

## 137. Algorithm documentation
Concise docs for transfer method, IR method, windowing, band aggregation, smoothing, confidence;
referenced by Features/Use Cases.

## 138. Algorithm tests
Synthetic known systems: flat gain, −6 dB gain, low-pass, high-pass, known EQ curve; expected
output derived mathematically; recovered response verified.

## 139. IR tests
Synthetic convolution: known impulse [1, 0, 0 ...], delayed impulse, echo (direct + delayed
attenuated copy); recovered IR locates known peaks.

## 140. Noise tests
Pink noise approximates −3 dB/octave PSD within tolerance; no exact random realization asserted.

## 141. RTA tests
Sine at band centre → that band dominates; two tones → correct energy aggregation.

## 142. Calibration tests
Exact point, between points, below range, above range, malformed CSV, duplicates, unsorted, NaN,
infinite correction, huge profile.

## 143. Confidence tests
Clean high-SNR repeated response, low SNR, clipped input, high variance, missing calibration,
partial coverage; reasons match data.

## 144. Experiment round trip
Export → import preserves configuration, calibration metadata, algorithm IDs, result arrays,
quality, provenance. No mutation.

## 145. Corrupt experiment
Invalid schema, oversized arrays, wrong types, NaN, Infinity, unknown algorithms, malformed
calibration → rejected cleanly.

## 146. Browser measurement tests
Fake mic/audio devices where Playwright supports them: permission, noise capture, sweep, result,
save, repeat, compare. No physical mic in CI.

## 147. Physical test limit
CI cannot prove hardware behaviour; it validates the digital pipeline, capture pipeline, analysis
math, browser APIs, UI. Be explicit.

## 148. Visual test
Deterministic V3 reference state without a real mic (synthetic captured response); render MEASURE
at 1536x1024 and mobile if useful.

## 149. Visual acceptance
V3 looks like OSCILLA; no generic new dashboard theme.

## 150. Accessibility
Keyboard-accessible controls; textual chart summaries (e.g. "Frequency response: maximum +3.2 dB
at 124 Hz, minimum −11.4 dB at 18.1 kHz, quality: usable"); never thousands of points to a screen
reader.

## 151. Measurement announcements
aria-live: Measurement started; Noise-floor check complete; Sweep running; Measurement complete;
Measurement invalid due to clipping. No progress chatter.

## 152. Safety
Conservative output, user gesture, hard stop; never auto-raise gain to beat noise.

## 153. Headphones
Warn about high output; safe defaults.

## 154. Very low frequency
Keep the excursion/distortion warning; never "turn it up until visible".

## 155. Very high frequency
Keep "weak perception does not imply weak output"; calibration/mic response may be poor.

## 156. Quality UX
Unreliable regions (e.g. above 17 kHz) drawn differently (dashed, faded, hatched) and explained.

## 157. Range validity
Store requested range and reliable measured range; never truncate silently.

## 158. Calibration coverage
Profile ending at 15 kHz with measurement to 20 kHz: "calibrated to 15 kHz", uncalibrated above;
no blind extrapolation.

## 159. Filtering input
No smoothing/filtering before storing the raw measurement. Raw first, derived views second.

## 160. Reproducibility
A saved experiment holds enough to reproduce the software-controlled setup; physical room, mic
position, analog behaviour go into notes.

## 161. Experiment summary
Compact: name (e.g. "MacBook speakers — desk"); stimulus "20 Hz → 20 kHz log sweep, 10 s"; input;
calibration (frequency profile none, SPL uncalibrated); runs 5; quality USABLE; OSCILLA 3.0.0,
commit abc1234.

## 162. Report export
Optional printable HTML report if easy; no PDF library.

## 163. CSV export
Frequency response, RTA, IR, with metadata header comments or companion metadata.

## 164. Data units
Explicit columns: frequency_hz, magnitude_db_relative, magnitude_db_calibrated, ...; never x,y.

## 165. API surface
No giant unstable window.OSCILLA API; deliberate public/debug surface; internals stay internal.

## 166. Experiment engine
A central ExperimentEngine (or equivalent): recipe, preflight, session, repetition, analysis,
quality, result. Avoid a giant Alpine object.

## 167. State machine
IDLE, PREFLIGHT, NOISE_CHECK, READY, ARMED, MEASURING, ANALYZING, COMPLETE, INVALID, ABORTED,
ERROR with transition discipline; no pile of booleans.

## 168. State machine test
Illegal transitions tested (e.g. ANALYZING → MEASURING).

## 169. Page leave
Active measurement + navigation: abort capture, stop output, release streams, clean up.

## 170. Long task UI
Progress if analysis exceeds ~100-200 ms; Worker if jank is measurable.

## 171. Benchmarks
10 s and 20 s 48 kHz sweeps, 96 kHz where supported, IR deconvolution, five-run aggregation;
record timings.

## 172. Memory
E.g. 48000 × 20 s × Float32 ≈ 3.84 MB/channel; explicit upper limits; never retain many raw
buffers.

## 173. Raw buffer lifecycle
Release capture buffers when raw is not saved, analysis completes, or the user discards.

## 174. Maximum limits
Caps for sweep duration, repeat count, imported experiment size, calibration points, stored
experiments; documented.

## 175. Storage quota
Handle quota exceeded; allow export/delete; never lose the current result silently.

## 176. Experiment ID
UUID/ULID or a stable local ID.

## 177. Clocks / timestamps
Experiment timestamps use the wall clock (provenance); the build timestamp stays deterministic.

## 178. Build reproducibility
Deterministic build per release commit; runtime timestamps dynamic; separate concerns.

## 179. Version
UI shows "OSCILLA v3.0.0" derived from the canonical version; never hard-coded.

## 180. Release engineering
Use the V2 release workflow; no parallel mechanism; the gate includes V3 measurement tests.

## 181. Majordomus release
Use Majordomus release/deployment/evidence features where supported.

## 182. Quality gate
V1 freeze, V2 unit, engine, browser tests, V3 unit DSP, V3 synthetic measurement, V3 browser
workflow, file://, Pages subpath, visual regression, Majordomus validation, version/provenance,
dist verification.

## 183. Do not weaken V1/V2
No regression in Playground, Sweep, Dual Osc, Sequencer, Filter Lab, Synthesis, Exports, file://.
V3 adds measurement; it does not replace V2.

## 184. Test performance
Fast verify separate from the full release gate; shortened mathematically equivalent fixtures in
unit tests.

## 185. Realistic integration test
At least one release-gate test runs a realistically sized measurement path.

## 186. Cross-model DSP review
Before finalizing transfer/IR math, independent critique of formulas, windowing, sweep inverse,
normalization, FFT scaling, power aggregation, dB conversion, calibration application, confidence
logic. Do not accept blindly; write synthetic proofs/tests.

## 187. DSP reference
Reputable primary/technical references, recorded in docs/knowledge.

## 188. No medical claims
No hearing/tinnitus diagnosis, clinical thresholds or audiometry; human-hearing exploration is
educational.

## 189. No certification claims
No IEC, ANSI, Class 1/2 claims unless implemented, calibrated and validated; use "experimental",
"educational", "measurement estimate".

## 190. V3 documentation
README V3 section: Measurement Workbench, Calibration, Transfer Function, Impulse Response, RTA,
Experiments, Measurement quality, Scientific limitations.

## 191. Measurement guide
How to make a useful measurement: quiet environment, fixed mic position, low/moderate output,
repeats, calibration if available, no speaker-only inference from a room measurement.

## 192. Architecture doc
Stimulus, Capture, Calibration, Analysis, Result, Quality, Experiment with a diagram.

## 193. ADR
Architecture doc says how; ADR says why. Do not copy one into the other.

## 194. Source tree
Likely modules (names may differ): src/js/measurement/{measurement-engine, session, stimulus,
capture, transfer, impulse-response, rta, confidence, aggregation, algorithms}.js;
src/js/calibration/{profile, csv, interpolate, level}.js; src/js/experiments/{schema, store,
compare, import-export, migration}.js.

## 195. Data-flow discipline
Measurement APIs accept plain data (`computeTransferFunction(stimulus, capture, options)`); no DOM
in DSP; independently testable.

## 196. Pure functions
Calibration interpolation, FFT-derived math, band aggregation, smoothing, quality scoring,
comparison, schema validation.

## 197. UI adapters
UI consumes result objects; charts do not own scientific state.

## 198. No magic constants
Named/configured thresholds (clip threshold, minimum SNR, repeatability threshold, noise capture
duration) with documented rationale.

## 199. Quality threshold versioning
Material rule changes change the algorithm ID (oscilla.confidence.v1).

## 200. Calibration hash
Deterministic identifier from normalized profile data, not the filename.

## 201. Unit test fixtures
Synthetic: flat-system, lowpass-system, echo-system, noisy-system, clipped-system,
calibration-profile; generated rather than massive blobs.

## 202. Golden files
Sparingly; prefer analytically derived expectations.

## 203. Float tolerances
Mathematically justified and documented; no "< 10 because browser DSP".

## 204. Sample rate
Test 44.1, 48, and 96 kHz where relevant; never assume 48 kHz.

## 205. Nyquist
All frequency-domain logic respects the actual sample rate; requested range clipped to the safe
digital limit and shown.

## 206. Stimulus inversion
The sweep inverse matches the emitted digital stimulus (envelope, limits), generated from the same
canonical definition.

## 207. Output limiter
Document the chain; consider the master limiter/ceiling's effect on transfer response; do not
bypass safety casually.

## 208. Measurement output level
Conservative: LOW/MEDIUM/HIGH or a numeric digital level; never called SPL.

## 209. Capture processing
Request echoCancellation, noiseSuppression, autoGainControl false where available; detect and
communicate when ignored.

## 210. Browser processing warning
Unconfirmed constraints → result notes "Input processing may have been applied by browser/device."

## 211. Channels
Mono first; architect correctly for stereo if supported.

## 212. Sample synchronization
Robust alignment (cross-correlation, known sweep timing, matched filter); never assume capture
starts with output.

## 213. Latency alignment
Correlation/sweep alignment finds the received start; prepares future latency measurement.

## 214. Impulse position
Display IR time relative to the detected direct peak where useful; keep the absolute capture
offset internally.

## 215. Physical propagation
No assumed propagation subtraction without known distance; "1 m ≈ 2.9 ms" is educational only.

## 216. Window around sweep
Pre-roll and post-roll (e.g. 0.5 s before, 1-2 s after), configurable internally.

## 217. Progress timeline
Pre-roll, sweep, tail, analysis, with real timing.

## 218. Abort tests
Abort during preflight, noise check, sweep, tail capture, analysis → 0 active sources, 0 capture
tasks, sane UI.

## 219. Multiple runs
Sufficient gaps between repetitions; never overlapping capture sessions.

## 220. Quality invalidation
Define invalidating conditions: severe clipping, no captured signal, capture underrun, numerical
failure.

## 221. Low-SNR region mask
Per-frequency/band reliability mask; uncertain regions displayed.

## 222. Calibration range mask
Distinguish calibrated vs uncalibrated frequency regions.

## 223. Export raw vs view
CSV exports raw by default; smoothed view export is labelled.

## 224. Report
Setup, calibration, result, quality, version, algorithm, limitations; no marketing.

## 225. Experiment deletion
Explicit action only; never deleted by a storage migration.

## 226. Migration tests
Store schema migration from empty and the initial version.

## 227. Data recovery
If the local DB cannot open, the app still runs with import/export; Playground never depends on
the experiment DB.

## 228. Offline
Runtime stays offline after loading the single HTML; reference/calibration examples embedded.

## 229. Deployment
dist/index.html deployed to Pages; same artifact.

## 230. Public verify
Version, commit, artifact, V3 MEASURE surface, Playground regression, file load markers, no
console boot failure.

## 231. Physical microphone test
Run a manual device test if the environment allows; otherwise report the limitation; do not block
release solely on the absence of a physical mic in CI.

## 232. V3 release version
Release 3.0.0 only when V3 scope has landed and policy supports it.

## 233. Beta / RC
3.0.0-rc.1 during final validation if the release process supports prereleases.

## 234. Public feature flag
No permanent secret flag: ship ready or keep it on a feature branch.

## 235. Final cross-model review
Before release, independent audit of DSP math, measurement semantics, calibration semantics,
experiment schema, confidence system, browser compatibility, privacy, UX, test completeness,
release readiness. Fix valid findings.

## 236. Final Majordomus audit
Doctor, ADR validation, product validation, usecase validation, knowledge inspection, plan status,
release/deployment validation, finish --check.

## 237. Final science audit
What looks more certain than the data is? Search for SPL without calibration, precision without
resolution, speaker response when measuring the full chain, universally asserted hearing limits,
confidence without reasons, uncalibrated regions shown as calibrated, smoothed data shown as raw,
unlabelled normalized graphs. Fix every legitimate problem.

## 238. Final UX audit
A new user can open OSCILLA, go to Measure, choose a sweep, select a mic, run preflight, measure,
see the response, understand quality, save an experiment without documentation.

## 239. Final expert audit
An expert can determine sample rate, FFT settings, window, calibration, smoothing, raw data,
algorithm version, quality metrics, experiment provenance.

## 240. Final performance audit
Idle, live RTA, spectrogram, 10 s measurement, IR analysis, 5-repeat aggregation; no pathological
freeze.

## 241. Final memory audit
After repeated experiments: raw buffers released, audio nodes released, worklets/workers disposed,
MediaStream tracks stopped, no growing handlers, no uncontrolled IndexedDB growth.

## 242. Final file:// audit
Playground, Analyzer, Measure UI, experiment import/export, calibration import, RTA without mic
if simulated, storage behaviour, graceful mic constraints.

## 243. Final Pages audit
Same artifact at https://korczis.github.io/oscilla/.

## 244. Final definition of done
V3.0 is DONE only when all hold: V2 baseline preserved; Majordomus V3 plan exists; V3 Features
exist; V3 Use Cases exist; relevant ADRs exist/proposed; measurement pipeline implemented;
calibration profile model implemented; calibration CSV import works; log-frequency interpolation
works; calibrated vs raw display works; SPL never appears without valid absolute calibration;
transfer-function measurement works; synthetic flat-system response test passes; synthetic
known-filter response test passes; log sweep workflow works; IR recovery works; synthetic echo IR
test passes; RTA FFT works; octave RTA works; third-octave RTA works; band-power math tested;
averaging works; clipping detection works; noise-floor estimation works; SNR/quality metrics work;
repeated measurement aggregation works; quality reasons explainable; experiment schema versioned;
experiment save/load works; export/import works; provenance stored; algorithm IDs stored;
experiment repeat works; comparison works; calibration differences surfaced in comparisons; no
fake calibrated output; abort cleans everything; no audio node leaks; mic cleanup correct; V1/V2
regression suite green; V3 unit suite green; V3 synthetic DSP suite green; browser suite green;
file:// green; Pages subpath green; visual regression green; release version/provenance green;
Majordomus validation green; public V3 release deployed; public commit verified; public version
verified; public smoke test passes.

## 245. Phase order
A baseline + Majordomus; B measurement architecture; C calibration; D transfer function;
E impulse response; F RTA; G experiment model; H quality/confidence; I integrated measurement UX;
J persistence/import/export/comparison; K cross-browser + accessibility + responsive; L scientific
review; M visual refinement; N release engineering; O public deployment and verification.

## 246. Phase updates
After each phase print only: PHASE, DONE, TESTS, MAJORDOMUS, REVIEW, NEXT. Then continue.

## 247. Implementation discipline
For difficult DSP: math → unit test → synthetic fixture → browser integration → UI. Not UI →
pretty chart → discover the math is wrong.

## 248. Data before UI
A graph is not a measurement. The result exists as structured data independent of the graph.

## 249. No fake data
Never render plausible random measurement values. Synthetic fixtures only visibly in test
context. Unavailable data reads UNKNOWN, NOT MEASURED, UNCALIBRATED, UNAVAILABLE.

## 250. Final principle
V3 makes OSCILLA harder to fool: "I know this." "I estimated this." "I observed this." "I
corrected this using calibration." "I cannot know this from this setup." More important than
another chart.

## 251. Begin
Inspect HEAD, deployment, V2 release state, Majordomus, Features/Use Cases/ADRs, measurement-
relevant V2 modules, browser mic architecture, analyser/FFT infrastructure, storage architecture,
build/release gate. Then create the V3 plan. Then execute autonomously. Do not stop after
planning, after a prototype, or when transfer-function graphs appear. Do not stop until the
complete V3.0 measurement foundation is implemented, tested, release-engineered, deployed to
GitHub Pages and publicly verified.
