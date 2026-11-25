# 10. Independent interim product review (2026-11-25)

## Context

- **Build reviewed:** `origin/feat/observed-lens-sheet` at `2262b4c4`, which is `main` plus
  Sonda (#647), using its committed dist.
- **Reviewer:** a reviewer that had not read the target architecture or the plan.
- **What it judged:** the product against the owner's definition of success.
- **Method:**
  - Five journeys in headless Chromium, at 1536x1024 and at 390x844 (touch, isMobile).
  - Every sound claim was read from the engine analyser.
  - Screenshots are kept outside the repository.

## Verdicts against the owner's success criteria

| Criterion | Verdict | Main evidence |
|---|---|---|
| Feels like one instrument | not met | 13 places, including "Syntéza" inside a group also named "Syntéza"; three sequencers; the lab filter never reaches the keyboard; a key rewrites the Studio document |
| Tasks without knowing workspace history | not met | the filter lives under Analýza and the envelope under Syntéza; Filtry has no play control except the status-bar ▶ and keys that bypass the filter |
| Experts keep precise control | partly | numeric entry, inspector, shortcuts; the Studio graph at 52 % shows ports of about 11-14 px |
| Beginners not overwhelmed | not met | visible controls at desktop: Playground 115, Synth 243, Studio 152 |
| Mobile genuinely usable | partly | no horizontal scroll and touch hold sounds; but the Synth panel gets about 35 px, the Studio graph is off the first screen, and the Sonda sheet covers the keys |
| Controls behave consistently | partly | Escape depends on where focus is; Czech and English mixed (Studio, Experiments, Synth modules, Measure texts, live regions) |
| Every view reflects canonical state | partly | Sonda's subject tracks the real source; the status bar shows the generator's waveform and gain while the Synth plays; Studio is not marked dirty after the silent insertion |
| No capability needlessly isolated | not met | lab filter, envelope and additive apply only to the generator; a mini sequencer and mini Studio sit beside the full ones |
| No fake measurements | met | loopback marked TESTOVACÍ KONTEXT and NEKALIBROVÁNO, SNR not derived; one wording issue (below) |

The wording issue: on a phone, the Sonda sheet is captioned "Pozorovaný digitální výstup"
(observed output), yet it showed the generator's computed wave while its subject said Synth.

## The ten highest-impact problems, and where the plan answers them

| # | Problem | Answered by |
|---|---|---|
| 1 | Playing mutates the project: one key turns the Studio from 6 into 28 nodes and silences its Play (peak 0.0547 → 0.0000) | U140 (p0) |
| 2 | No single voice chain: the filter, envelope and additive do not reach the keyboard, Synth or Studio | Q090 D4/U071 (Filter Lab folds into the Synth and Studio filter); engine unification stays out of scope (07 §4.6) |
| 3 | A reload wipes the session | U138 (#657) |
| 4 | Sonda removes things instead of adding them: it moves the Playground and Analyzer charts into the sheet and draws nothing while idle; the desktop sheet covers content; on a phone it covers the keys | U146 |
| 5 | Navigation follows history: 13 places, "Syntéza" inside "Syntéza", three sequencers | U132, U069-U074 |
| 6 | The status bar reports the wrong source | U131 (the strip's subject and readout follow the sounding owner) |
| 7 | Czech and English mixed | U145 (catalogue), the czech-prose ratchet |
| 8 | Building in the Studio from scratch is hostile: no empty document, new nodes land on top of each other, clips orphaned | U147 |
| 9 | Beginners get the whole lab at once | U131, U132, U129 |
| 10 | On a phone the keys dock starves the instrument places | U131 B/C, U135 |

## What got worse with the recent changes

- **Sonda (#647).**
  - It hollows out the Playground and Analyzer charts while open, and draws nothing while idle.
  - On a phone it is two taps away, and once open it blocks the keys.
  - On desktop the sheet covers content instead of reflowing it.
  - Its placement in the navbar is fine.
- **Escape.** After a navigation click, the first Escape collapses a sidebar group, and only the
  second closes Sonda.

U146 answers both.

## What works

- **Keys across places (#651).** A note held while switching to Měření kept sounding and
  stopped on release.
- **The guided measurement in the test context.** It works end to end, and the experiment
  survives a reload.
