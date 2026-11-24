# 03. UX/HCI audit of the current application

Deliverable 3, measured on `main` at `c3b15610` (v3.42.1), 2026-11-24.

## Coverage

- **Screens captured:** 252 screenshots, each with layout metrics. That is Chromium, Firefox
  and WebKit × 6 viewports (1536x1024, 1280x800, 1024x768, 768x1024, 390x844, 320x740) × the
  13 workspaces of the registry, plus a fresh first screen.
- **Input modes:** phone viewports used touch, with `isMobile` where the engine supports it.
- **Metrics files:** `evidence/metrics-chromium.json`, `evidence/metrics-firefox_webkit.json`.
- **Not committed:** the screenshots themselves (about 60 MB). A selection is in the owner's
  Czech summary page.

## Cross-engine result

The three engines lay the page out the same way: no metric differs from Chromium's by more
than 30 % of a viewport. No workspace overflows horizontally, and no page error was recorded.
The findings below are therefore design findings, with one engine bug:

- **V-W1, WebKit at 320x740, Synth.** The status bar is drawn across the docked keys.

## Scroll depth

Main scroll height as a multiple of the viewport height, maximum over the three engines.

| Workspace | 1536x1024 | 1280x800 | 1024x768 | 768x1024 | 390x844 | 320x740 |
|---|---:|---:|---:|---:|---:|---:|
| playground | 1.2 | 3.4 | 3.8 | 3.5 | 2.4 | 2.9 |
| measure | 1.5 | 2.2 | 2.6 | 2.3 | 3.1 | 3.9 |
| experiments | 0.8 | 0.7 | 0.7 | 0.8 | 0.9 | 1.2 |
| analyzer | 0.9 | 1.4 | 1.4 | 1.2 | 2.1 | 2.5 |
| filter | 0.8 | 0.7 | 0.7 | 0.8 | 0.8 | 0.9 |
| compare | 0.9 | 0.8 | 0.9 | 0.8 | 1.3 | 1.6 |
| synthesis | 1.1 | 1.6 | 1.9 | 2.0 | 4.3 | 4.9 |
| sequencer | 0.8 | 1.2 | 1.3 | 1.2 | 1.7 | 1.9 |
| presets | 1.3 | 2.8 | 3.2 | 2.5 | 3.9 | 4.8 |
| learn | 2.3 | 6.7 | 8.5 | 6.5 | 8.0 | 10.5 |
| studio | 0.8 | 0.8 | 0.8 | 0.8 | 1.3 | 1.3 |
| synth | 3.6 | 5.5 | 5.4 | 3.9 | 7.0 | 8.6 |
| about | 6.1 | 8.4 | 10.6 | 8.5 | 18.2 | 23.8 |

Under 1.0, the workspace is held to one screen: the Studio, Filtry and Experimenty. Above 1.0,
it scrolls: Synth to 8.6 screens, About to 24.

## Small text

Visible elements with a computed font-size under 12 px. Text drawn in canvas or SVG is not
counted. The count includes everything visible, so the docked keys and the status bar are in
it.

| Workspace | 1536x1024 | 1280x800 | 1024x768 | 768x1024 | 390x844 | 320x740 |
|---|---:|---:|---:|---:|---:|---:|
| playground | 151 | 211 | 206 | 204 | 0 | 0 |
| measure | 127 | 126 | 126 | 125 | 0 | 0 |
| experiments | 37 | 36 | 36 | 35 | 0 | 0 |
| analyzer | 66 | 65 | 65 | 64 | 0 | 0 |
| filter | 27 | 26 | 26 | 25 | 0 | 0 |
| compare | 65 | 64 | 64 | 63 | 0 | 0 |
| synthesis | 95 | 94 | 94 | 93 | 0 | 0 |
| sequencer | 81 | 83 | 78 | 76 | 0 | 0 |
| presets | 21 | 20 | 20 | 19 | 0 | 0 |
| learn | 20 | 19 | 19 | 18 | 0 | 0 |
| studio | 238 | 146 | 141 | 141 | 32 | 32 |
| synth | 42 | 41 | 30 | 28 | 0 | 0 |
| about | 364 | 363 | 363 | 362 | 0 | 0 |

The phone floor (12 px) holds in every workspace except the Studio, which shows 32 small-text
elements on a phone. On desktop there is no floor except the Studio criterion at zoom 1
(`ui-current#desktop-text-floor`). The desktop counts show that most of the app's dense
readouts sit at 10–11 px.

## Findings per workspace

| Workspace | Purpose and hierarchy | Composition and density | Cross-links and context | Phone |
|---|---|---|---|---|
| Playground | Generator, analysis, mic, device, guided measurement, Pattern Sequencer and compact Studio on one screen, with no focal point. The h1 is the tagline, at 12.5 px. | 4 columns plus 3 rows at 1536. Between 768 and 1535 every lab panel also shows. "Zařízení" wraps one word per line. | Related: Měření, Synth, Výuka. | Generator only; no view of the sound on the first screen. |
| Měření | Clear seven-step procedure. | Good density. The result chart is an empty frame until a run. | Related: Experimenty, Výuka. | 3.1 to 3.9 screens. |
| Experimenty | Records, definitions, findings. | Compact. | Compare lives here and also means two other things (02). | — |
| Analyzátor | Live views, not calibrated measurement. | The only home of Device and the Spectrogram panel. | Duplicates the Playground's analysis panel. | — |
| Filtry | One biquad chart. Bypassed by default, labelled in English ("BYPASSED"). | The lower third is empty at every desktop size. | One link onward. | — |
| Porovnání | Mic, bio and phase together. Its name is ambiguous (02). | — | `enter` selects the mic Compare tab. | — |
| Syntéza | Envelope, additive, phase, dual, beside the generator crop. | The page opens scrolled, with the Source panel under the header. | Duplicates the Playground's source and analysis. | 4.3 to 4.9 screens. |
| Sekvencer | Blocks timeline. Its summary points to the Synth's Bicí tab for steps. | — | "Krokový sekvencer a pady (Bicí)" is a link out. | — |
| Předvolby | Instrument presets and history. | — | Outside the patch library (02). | — |
| Výuka | 21 concept cards. | Long scroll (2.3 to 10.5 screens). | Demos open other workspaces. | — |
| Studio | Graph, timeline, inspector, library. | The graph is about 230 px high at 52 % zoom (1536), and about 100 px at 25 % (1024, Firefox). The docked keys take a quarter of the height. | — | A 17-button toolbar in 4 rows before the graph; **no graph on the first screen**. |
| Synth | Panel, Enginy, XY, Bicí. | Description, preset row, info alert, tabs and an expand row come before any module. The keys take 30 % of the height. | — | **No instrument on the first screen**: notice, preset, 4 buttons, tabs, chips, then keys. |
| O aplikaci | The project as it stands. | 6 to 24 screens. | — | — |

### Shared patterns

- **Chrome cost.** Stacked chrome takes 108 px at the top (navbar 64 + page header 44) and
  55 px for the status bar. The keys dock adds a 60 px handle when folded, or about 290 px
  when open.
- **Mixed language.** The Studio's toolbar, library and inspector are English ("Play", "Add
  node", "Templates") on a Czech page.
- **Phone navigation.** It is a hamburger drawer of 13 entries in 2 groups. Each workspace
  header repeats a Související dropdown and a headphones button.

## User journeys

The ten journeys of the pack were walked in a real browser at 1536x1024 and 390x844. The
results are in `03b-journeys.md`.
