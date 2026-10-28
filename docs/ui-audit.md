# Interface audit of 2026-10-28

Plan issue U001 (intent `ui-current`, milestone M054). The owner said on 2026-10-28 that the live
Studio, About and the whole interface are outdated. This audit records what the live page showed
that day, workspace by workspace, so that U002 to U007 change findings rather than taste.

**Page audited:** <https://korczis.github.io/oscilla/>, the release of commit `e272fac`. It was
opened in Chromium (Playwright) at 1536x1024 and 390x844, with an empty profile and no microphone.
The routes are those of the navigation: `#m=<workspace>`.

**How empty area is measured.** Points are sampled on a 24 px grid between the header's bottom
edge and the status bar's top edge. A point counts as empty when `elementFromPoint` returns the
page background, `main`, or a workspace container. The share below is empty points over all
points. U005 adopts this definition for `tests/browser/ui-current.cjs`. It measures layout, not
whether the content is useful.

**Overflow.** No workspace scrolls sideways at either size. Phone width breaks nothing outright;
the phone findings concern legibility and reach.

## Summary

| Workspace | Empty, 1536 | Empty, 390 | Findings | Changed by |
| --- | ---: | ---: | --- | --- |
| Playground | 4 % | 0 % | A01 | M050 (Q004, P002) |
| Measure | 1 % | 0 % | A02 | M047 |
| Experiments | 64 % | 28 % | A03, A04 | U003 |
| Analyzer | 8 % | 0 % | A05 | U005 |
| Filter Lab | 35 % | 0 % | A06 | U004 |
| Compare | 31 % | 0 % | A07 | U005 |
| Synthesis | 9 % | 0 % | A08 | U006 |
| Sequencer | 46 % | 3 % | A09 | U005, U006 |
| Presets | 7 % | 1 % | A10 | U006 |
| Learn | 4 % | 0 % | A11 | U006, M049 |
| Studio | 4 % | 0 % | A12, A13 | U007, M048 |
| About | 1 % | 0 % | A14, A15, A16 | U002 |
| All | | | A17 | U006 |

Three workspaces leave more than a quarter of the desktop viewport empty: Experiments, Filter Lab
and Sequencer. Compare comes close at 31 %.

## Findings

**A01 · Playground: the first screen is the dense V2 instrument.** One signal generator, the
waveform and spectrum, the microphone analyzer, the device panel, the pattern sequencer, the
spectrogram and five labs share one screen. The owner already found that this first screen no
longer reflects the product (M050, 2026-10-05). The layout is the owner's choice on Q004, so this
audit records it and changes nothing.

**A02 · Measure: complete, with the planned figures still missing.** The guided seven-step flow,
the stimulus, live input and quality panels fill the screen. The result offers frequency response,
impulse response and RTA. Room decay, clarity, THD, chain delay, phase and run consistency are not
there yet; they are M047 (V391 to V399). No interface change is due here.

**A03 · Experiments with an empty store is two thirds empty.** Three cards (Definitions, Saved
experiments, Findings) each say that nothing is stored. The detail pane says to open an
experiment from a list that is empty. Nothing shows what an experiment looks like, and the only
way forward is to leave for Measure. → U003: a real TEST CONTEXT loopback run, labelled as such.

**A04 · Findings has no example either.** "Record one from an experiment's detail or from a
comparison" leads back to the same empty Experiments list. → U003.

**A05 · Analyzer: a live view with no route to the calibrated measurement.** The microphone
analyzer's live spectrum and spectrogram say "not a calibrated measurement". They do not point to
MEASURE's RTA, which is the calibrated counterpart. → U005.

**A06 · Filter Lab: one response curve on an otherwise empty workspace.** The panel shows the
biquad's response, cutoff and Q, and starts bypassed. It neither filters the sound the person is
playing nor shows a spectrum before and after the filter. Nothing leads to the Studio's filter
node, which does the same in a graph. → U004.

**A07 · Compare: the lower third is empty.** It shows the microphone analyzer, Bioacoustics and
Phase & Stereo; the space under Bioacoustics is empty. Its name suggests comparing measurements,
but comparing saved experiments lives in Experiments and nothing links the two. → U005.

**A08 · Synthesis: the compact Studio is there, but the Studio is reached only by "Expand
Studio".** Additive synthesis, the envelope and the dual oscillator do not offer their Studio
equivalents (oscillator, envelope and gain nodes in a template). → U006.

**A09 · Sequencer: half the screen is empty under the pattern sequencer and the compact
Studio.** The pattern sequencer and the Studio timeline are two sequencers with no stated
relation. → U005 (layout), U006 (the link to the timeline's Sequence node).

**A10 · Presets: no relation to Studio patches and templates.** Presets store instrument settings
and the Studio stores patches and templates; the two lists never refer to each other. → U006.

**A11 · Learn: concept cards with one demo each, and no lesson yet for perception.** The concept
cards (frequency to speaker limitations; eighteen carry a demo) each offer "Relate to current settings" and one demo. They
do not lead to the workspace that explores the concept in depth: Studio templates, Synthesis,
Measure. The perception lessons (missing fundamental, Shepard tone, equal loudness) are M049. →
U006, M049.

**A12 · Studio at phone width: the graph is drawn at fit-to-screen and cannot be read.** At
390x844 the signal graph fits all six nodes into the pane, so a node title renders about 5.6 px
tall. The toolbar above it has 18 buttons, 12 of them icons without a visible label. Graph, Timeline and
Inspector switch correctly. → U007 (a readable zoom on phone, labelled primary actions).

**A13 · Studio: the optional features are still missing.** Node groups, autosave with crash
recovery and the Playground voice opened as a Studio graph are not built. The minimap (V602) is.
→ M048 (V601, V604, V605), already planned.

**A14 · About opens on the first night.** The story headline is "Built in one night. Not built as
a throwaway." with 2026-10-01 22:58 to 2026-10-02 04:49 and "5 h 51 min of wall-clock time". The
project has since run four weeks through seventeen stations to the current release. The night is true and dated,
but it is not what OSCILLA is now. → U002 (the owner's override of Q005's headline).

**A15 · About does not say what comes next.** The open milestones are MIDI (M045), the
measurement extensions (M047), Studio completion (M048), the perception lessons (M049), the first
screen (M050) and this intent (M054). About lists only what has shipped. → U002 (from
`src/data/roadmap.json`).

**A16 · About does not map the workspaces.** The twelve workspaces of the navigation are never
listed with what each is for. The lede names measuring, comparing, saving and patching only. →
U002.

**A17 · No workspace links to the workspaces related to it.** The workspaces are connected only
by the navigation bar. The deep links that do exist (`#m=studio`, `#mr=` recipes, `#rec=` records)
serve sharing, not moving to the next step of a task. → U006.

## Already planned elsewhere

These are related features, as the owner put it. They already have their own issues, and this
intent does not plan them again:

- MIDI input, play and record: M045 (V501 to V505).
- Measurement figures: M047 (V391 to V399).
- Studio groups, pinch zoom, autosave, Playground voice: M048 (V601, V603 to V606).
- Perception lessons: M049 (L001, L002, L005, L006).
- The first screen: M050 (Q004, the owner's choice, then P002).
