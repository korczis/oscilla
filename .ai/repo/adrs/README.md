---
schema: context/v1
id: ai.repo.adrs
kind: context
title: Architecture decisions
description: The architecture decisions recorded for this repository, what their status means, and who accepts them.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Architecture decisions

The durable decisions about how this repository is built, one file each, with the context,
the decision, the alternatives rejected and the consequences.

## What the status means

On 2026-10-05 every decision here had `status: proposed` and none had been accepted;
`majordomus adr list` shows the current statuses. `majordomus adr propose` writes only
`proposed`, and accepting a decision is the owner's act, not a worker's.
Read `proposed` as: recorded, and implemented as described, unless a dated entry under
`## Resolution notes` at the end of the file says otherwise. Those notes are appended and
never rewrite the sections above them; they record what shipped, what changed since, and a
decision that practice has superseded. A worker does not promote a decision to `accepted`,
`superseded` or `rejected`; it adds a resolution note and leaves the status to the owner.

On 2026-10-18 the owner accepted the decisions that the code implements as described and CI
holds (explicit instruction in the session of 2026-10-18, applied by the coordinating Claude
session). Each accepted decision says so in a dated entry under its `## Resolution notes`,
with the claims, code paths and tests that evidence it; `majordomus adr list --status
accepted` lists them. The rest stay `proposed`, each for a stated reason:

- 0001: the Studio runtime holds automation with `cancelAndHoldAtTime` where the browser has
  it (`src/js/studio/automation.js`, `transport.js`, and `envelope.js` `holdAt` through
  `adapters/nodes.js`), so "`cancelAndHoldAtTime` is not used anywhere" holds only for the
  AudioEngine's voices.
- 0008: superseded in practice, as its 2026-10-05 note records; marking it `superseded` is
  the owner's call.
- 0011: Pages no longer serves the committed file unchanged; it stamps one metadata region
  (ADR 0028).
- 0016: accepted on 2026-10-18 and withdrawn the same day after the review of the acceptance
  (pull request #198, R-1): not every live renderer follows the one frame loop it decides.
- 0019: the configuration hash covers the calibration, sample rate, algorithms and build
  besides the recipe (`src/js/experiments/hash.js`), and the setup a user repeats is now
  named by a definition version (ADR 0043).
- 0030, 0034, 0038: implemented, but `tests/unit/v31-studio-self-knowledge.test.mjs` requires
  the Studio ADRs with open questions to keep `proposed`; 0038 also keeps one question open
  (Apple Safari with a real input device).
- 0045: amended by ADR 0048, which re-applies the `records` domain on Back and Forward.
- 0047: implemented, but its `provenance.origin` is `extracted`, and `majordomus adr check`
  refuses `accepted` on an extracted record. (Until 2026-10-18 it was also held back because
  `release:prepare --no-rc-because` took any accepted ADR; it now takes only an RC exemption,
  below.)
- 0050, 0052, 0054, 0055, 0056, 0057: implemented, but their `provenance.origin` is
  `extracted`, and `majordomus adr check` refuses `accepted` on an extracted record.
- 0051: the "Why trust the method?" list and its hand-written claims mirror under
  `src/js/measurement/` are not built.
- 0053: the user-visible "run" strings its consequences list are not changed yet.
- 0058: a proposed direction; nothing implements it.
- 0059: new on 2026-10-18 (pull request #197) and `extracted`; it amends 0028.
- 0060: new on 2026-10-18 (issue P004); a decision taken under the owner's delegation
  (Q003), which the owner may override, so its acceptance is the owner's.
- 0063: new on 2026-10-29 (the G1 coherence contract); proposed, with two open questions
  for the owner, and nothing implements it yet.

On 2026-10-28 the owner ordered Flowbite Pro for the UI of every project; ADR 0061 records
that order as an accepted decision (its acceptance note quotes it) and supersedes the bullet of
0012 that dropped Tailwind and Flowbite, which 0012's own resolution note of that date says.

A worker still never promotes a status without the owner: this was the owner's act, and a
later acceptance, supersession or rejection is too.

## The accepted decisions by name

Which decisions the acceptance of 2026-10-18 covers was the coordinating session's selection
under the owner's one instruction, not a review of each decision by the owner, and a selection
can be wrong (0016 was withdrawn the same day). Every decision whose front matter says
`status: accepted` is listed here by name with the date of its acceptance note, so the owner can
confirm or withdraw each one. Where the last column says `yes`, the decision's `## Decision`
section still opens with "Proposed" because the sections above the resolution notes are never
rewritten: the acceptance note governs, and the decision reads as accepted.
`tests/unit/adr-accepted-list.test.mjs` fails when an accepted decision is missing, when a
listed one is not accepted, or when a link, title, date or mark differs from the file.

| ADR | Decision | Accepted | Opens with 'Proposed' |
| --- | --- | --- | --- |
| [0002](0002-voice-replacement-and-output-ceiling.md) | A new voice fades every earlier one out first; a waveshaper ceiling backs up the output cap | 2026-10-18 | no |
| [0003](0003-live-configuration-changes.md) | A configuration change while playing glides, dips or restarts, and never extends playback | 2026-10-18 | no |
| [0004](0004-continuous-repeat-schedule-window.md) | Continuous repeat is a plan kind scheduled ten seconds ahead and topped up | 2026-10-18 | no |
| [0005](0005-safety-limit-scope.md) | The hard safety limit caps open signals and the finite tone; patterns are exempt up to 30 s | 2026-10-18 | no |
| [0006](0006-engine-verification-on-an-output-tap.md) | The audio engine is verified on a sample-accurate output tap, not on its own bookkeeping | 2026-10-18 | no |
| [0007](0007-spec-verification-by-batched-audits.md) | Spec sections are verified by batched audits against the original text plus section-labelled browser tests | 2026-10-18 | no |
| [0009](0009-auto-merge-pull-requests-behind-ci-gate.md) | V1 ships through auto-merge pull requests behind a required CI gate | 2026-10-18 | no |
| [0010](0010-v1-before-v2.md) | V1 is finished, verified and deployed before V2 starts on its own branch | 2026-10-18 | no |
| [0012](0012-self-contained-runtime.md) | The runtime is self-contained: pinned dependencies are inlined and nothing is fetched, imported or loaded from a path | 2026-10-18 | no |
| [0013](0013-p5-unmodified-separable-block.md) | p5.js (LGPL-2.1) ships as an unmodified, separately identifiable script block with its licence notice | 2026-10-18 | no |
| [0014](0014-v1-behaviour-frozen-by-golden-vectors.md) | V1 behaviour is frozen as golden vectors from the V1 file and replayed against the V2 modules | 2026-10-18 | no |
| [0015](0015-native-web-audio-engine-extended-in-place.md) | The V2 engine is the V1 engine on the native Web Audio API, extended through option hooks and engine-accounted graph builders | 2026-10-18 | no |
| [0017](0017-relative-levels-spl-only-when-calibrated.md) | Levels are relative to digital full scale (dBFS-like); dB SPL appears only under a valid absolute-level calibration | 2026-10-18 | no |
| [0018](0018-measurement-from-captured-pcm-offline-dsp.md) | Measurement results come from captured PCM through deterministic offline DSP; the live analyser is feedback only | 2026-10-18 | yes |
| [0020](0020-calibration-semantics.md) | Frequency-response and absolute-level calibration are separate kinds, interpolated in log frequency and never extrapolated | 2026-10-18 | yes |
| [0021](0021-sweep-deconvolution-method.md) | Sweep deconvolution divides by the spectrum of the rendered canonical sweep with band-limited regularization; Farina's inverse filter is the test oracle | 2026-10-18 | yes |
| [0022](0022-experiment-persistence.md) | Experiments persist in IndexedDB with an in-memory fallback; file export and import are the durable path | 2026-10-18 | yes |
| [0023](0023-schema-versions-independent-of-product-version.md) | Each persisted format has its own integer schema version, independent of the product version, upgraded by explicit stepwise migrations | 2026-10-18 | yes |
| [0024](0024-versioned-algorithm-ids.md) | Every stored result names the algorithm that produced it by a stable versioned ID; a material change mints a new ID | 2026-10-18 | yes |
| [0025](0025-data-driven-quality-with-reasons.md) | Measurement quality is a rule-based status (GOOD, USABLE, POOR, INVALID) computed from named metrics, always with its reasons | 2026-10-18 | yes |
| [0026](0026-audioworklet-and-worker-by-spike.md) | AudioWorklet capture and Worker DSP are adopted only on the evidence of a recorded spike; the native graph and main thread stay the default | 2026-10-18 | yes |
| [0027](0027-package-json-is-the-product-version-authority.md) | package.json "version" is the only source of the product version; schema versions and the frozen V1 stamp are separate | 2026-10-18 | yes |
| [0028](0028-provenance-without-a-fixed-point.md) | The committed dist embeds a source digest, and the Pages workflow stamps one metadata region with the deployed commit | 2026-10-18 | yes |
| [0029](0029-visual-regression-in-the-release-gate.md) | The release gate includes a visual regression check with per-region thresholds measured from run-to-run variance | 2026-10-18 | yes |
| [0031](0031-studio-action-layer-snapshot-history.md) | Every Studio mutation is a dispatched action reduced into a new immutable model; undo and redo restore earlier snapshots | 2026-10-18 | yes |
| [0032](0032-typed-ports-validated-before-runtime.md) | Studio ports are typed with roles, and connection validity is pure model logic checked before any runtime mutation | 2026-10-18 | yes |
| [0033](0033-feedback-and-control-cycles-rejected.md) | Instantaneous audio feedback and control or analysis cycles are rejected by the model until a delay node has its own decision | 2026-10-18 | yes |
| [0035](0035-compiled-into-existing-engine-incremental-patching.md) | The StudioModel compiles into the existing AudioEngine and measurement engine, and edits patch the running graph incrementally in transactions | 2026-10-18 | yes |
| [0036](0036-timeline-on-audio-clock-via-sequencer-compiler.md) | The Studio timeline runs on the audio clock through the existing sequencer compiler, in absolute seconds | 2026-10-18 | yes |
| [0037](0037-automation-versus-modulation.md) | Automation is a timed base value on a timeline lane; modulation is a control edge with its own depth; the two never stand in for each other | 2026-10-18 | yes |
| [0039](0039-studio-runtime-truth-plan-identity-applied-record-divergence.md) | Studio runtime truth: plan identity, applied record and divergence | 2026-10-18 | yes |
| [0040](0040-completed-experiment-run-immutable-metadata-separate.md) | A completed experiment run is immutable; metadata is separate | 2026-10-18 | yes |
| [0041](0041-run-comparison-semantic-execution-vs-presentation.md) | Run comparison is semantic and classifies execution vs presentation changes | 2026-10-18 | yes |
| [0042](0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md) | Studio operation trace: one correlation id, bounded, not evidence | 2026-10-18 | yes |
| [0043](0043-runs-executed-from-versioned-experiment-definitions.md) | Runs are executed from a versioned experiment definition | 2026-10-18 | yes |
| [0044](0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md) | Evidence on a run is read from stored fields, as a lineage and a checklist, never a score | 2026-10-18 | yes |
| [0046](0046-findings-interpretation-linked-to-evidence.md) | A finding is an interpretation linked to the evidence it rests on, never measurement truth | 2026-10-18 | yes |
| [0048](0048-connected-records-over-stored-fields.md) | Connected records come from stored fields only, and read present only when the identity verifies | 2026-10-18 | yes |
| [0049](0049-raw-capture-retention.md) | The raw capture lives only for its analysis; a run stores derived results | 2026-10-18 | yes |
| [0061](0061-the-ui-is-built-on-flowbite-pro.md) | The UI is built on Flowbite Pro: Tailwind and Flowbite return at build time, inlined | 2026-10-28 | no |

## An exemption from the release candidate

ADR 0047 requires a release candidate before the first stable release of a new major, and
`release:prepare` refuses that release without one (rule `project.release-flow-complete`).
`npm run release:prepare -- --no-rc-because <ADR>` lifts the refusal only for an ADR that is
an RC exemption for the major being opened. The ADR schema has no field for this, so the
convention uses what `majordomus adr check` accepts:

- `status: accepted` (the owner's act, as for every decision);
- `tags` include `rc-exemption` and `major-<N>`, the one major it exempts (`major-4`);
- `related` includes `adr:adr-0047`, the decision it exempts;
- its `# Decision` says why that major ships without a candidate.

Any other ADR, accepted or not, is refused with the missing parts named
(`rcExemptionProblems()` in `scripts/release-prepare.mjs`). No exemption exists today.

## How one is added

Nothing here is generated and nothing is promoted here automatically: a decision recorded
while working (`majordomus decision add`) stays in the checkout's local state until a person
judges it durable enough to write down here (`majordomus adr propose`).
