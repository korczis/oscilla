# 03b. User journeys, walked in a real browser

These are the ten journeys of the reconstruction pack, measured on `main` at `c3b15610`
(v3.42.1) on 2026-11-24.

## Method

- **Setup.** Chromium with a fake microphone, at 1536x1024 and at 390x844 (touch, mobile).
- **Input.** Real clicks and keys on visible controls.
- **How sound was confirmed.** Whether something plays is read from the engine's post-chain
  analyser through `window.OSCILLA`, never assumed.
- **Errors.** There was no page error and no console error in any run.
- **Not verified.**
  - Anything by ear.
  - Real touch drags on the phone: the knobs and cables there were dragged with mouse events.
  - Levels under the machine's load of 30–40 during J5–J10, which is timing-sensitive.
- **Where the files are.** The screenshots (133) and step logs stay outside the repository.

The metrics columns: **Clicks / keys** and **Switches** are per viewport, written desktop / phone.
**Scrolls** is the count of controls that had to be scrolled to.

| # | Journey | Clicks / keys | Switches | Scrolls | Outcome |
|---|---|---|---|---|---|
| J1 | Start a new sound | 4 + 1 key / 5 taps | 0 | 0 / 1 | sounds; **one stray letter key plays another voice and rewrites the Studio document** |
| J2 | Modify a sound (filter, envelope) | 18 + 8 keys / 23 | 4 | 2 / 5 | the generator keeps its lab settings across Filtry and Syntéza; the Synth ignores all of them |
| J3 | Connect modulation | 9 / 14 | 2 | 3 / 4 (4,907 px) | the search does not find "LFO"; **a patched cable has depth 0** until a knob in another module is turned |
| J4 | Analyze the output | 10 / 13 | 2 | 2 / 3 | the Analyzer shows the Synth's output; opening the dock hides the spectrogram |
| J5 | Measure a playback chain | 7 / 8 | 1 | 0 / 2 | the fake mic clips every run (English reason, truncated); the test context completes in 44 s |
| J6 | Save and compare experiments | 11 + 26 keys / 11 | 1 | 3 / 4 (6,695 px) | "Opakovat" locks the level, so the comparison is trivially identical; the Experiments page is mostly English |
| J7 | Studio patch from scratch | 16 / 19 | 1 | 2 / 5 | there is no empty template; Basic Tone plus nodes is **silent on Play**; added nodes stack; the graph is 686x189 px |
| J8 | Build and perform a sequence | 15 / 17 | 2 | 1 / 1 | **keys are muted while the sequencer plays**; two transports, two tempos (90 vs 120); drums about 27 dB quieter |
| J9 | Reopen previous work | 19 / 25 | 5 | — | **reload resets generator, labs, Synth and sequence**; only Studio Save, presets and experiments persist, each in its own place |
| J10 | Learn a concept and use it | 14 / 17 | **10** | 3 / 6 (10,501 px) | demos jump away and play nothing; the AM demo opens the Synth Panel, not the AM engine |

## Where the workspace boundaries force a switch

| Journey | What forces it |
|---|---|
| J2 | the filter is in Filtry, the envelope in Syntéza, the voice in Synth |
| J3 | modulation lives only in Synth or Studio, and the search cannot find it |
| J4 | the sound is in Synth, its spectrogram in Analyzátor |
| J6 | the measurement is in Měření, the comparison in Experimenty |
| J8 | steps are in Synth/Bicí, blocks in Sekvencer |
| J10 | every demo goes to another workspace |

## Voices, keyboards and transports that conflict

- **Separate voices.** The Playground generator, the Synth semimodular voice, the Synth
  engines, the Studio nodes and percussion are separate voices. The one dock keyboard plays
  "the Studio instrument", which changes with the Synth tab.
- **Seven transports**, and they interfere:
  - Spustit / Podržet a hrát;
  - the status-bar Přehrát;
  - the Pattern Sequencer;
  - Studio Play;
  - compact-Studio play;
  - drums Přehrát.

  Drums Přehrát stops the block sequence, and the keys are muted while the sequence runs.
- **Five analysers:**
  - the Playground analysis panel;
  - Analyzátor;
  - the Studio spectrum node;
  - the mic analyzer;
  - the Měření RTA.

## The ten HCI problems that matter most, and where the plan answers them

| # | Problem | Evidence | Answered by |
|---|---|---|---|
| 1 | A reload throws away all instrument work; saved work sits in three stores reached from three places | J9 | U138 (recovery), U130 (palette reaches every store) |
| 2 | You cannot play the keys over a running sequence | J8 | U139 |
| 3 | One letter key on the Playground plays a different voice and rewrites the Studio document, while the analysis and status bar say nothing plays | J1 | U140, U134 (letter keys), U131 (the strip names the subject) |
| 4 | A Synth patch cable is inaudible (depth 0); a Studio cable defaults to 1200 Hz | J3, J7 | M123 (one jack/cable model, one default) |
| 5 | The keys dock takes 240–292 px and covers the patch bay, drum grid and spectrogram | J3, J4, J8 | U131 (chrome budget), U135 (phone sheet) |
| 6 | A Studio graph built from scratch is silent on Play; nodes stack; the graph and ports are tiny | J7 | U131 (space), M048 / studio-completion (existing) |
| 7 | Learn demos jump away and do not play | J10 | U126 (Sonda over any place), perception-lessons intent (existing) |
| 8 | The fake-mic measurement always clips, with an English, truncated reason | J5 | measurement-extensions (existing), czech-prose ratchet |
| 9 | Separate transports and tempos | J8 | U127 (one play target per place); tempo unification is engine work, out of scope (07 §4.6) |
| 10 | English UI on a Czech page, and a search that finds only workspace names | J6, J7, J3 | czech-prose ratchet, U130 |
