# 02. Feature-to-UI traceability matrix

Deliverable 2 of the product reconstruction. Read-only pass over `main` at `c3b15610`
(v3.42.1), 2026-11-24.

Conventions:
- Module paths are relative to `src/js/`.
- Test columns: `B/x` is `tests/browser/x.cjs`, `U/x` is `tests/unit/x.test.mjs`.
- The panel-to-workspace mapping follows `data-osc-modes` in `src/index.html`, and
  `tests/unit/surface-census.json` confirms it.
- **Bold** in a cell marks a capability that exists in code but is hard to reach.

## Matrix

| Capability | Implementation | Location | State owner | Entry point | Related | Tests |
|---|---|---|---|---|---|---|
| Workspace nav (sidebar, groups, drawer, collapse) | ui/shell.js, ui/navigation.js | header + sidebar | ui.workspace, `oscilla.v2.sidebar` | sidebar, `#m=<id>`, Back/Forward | Related strip | B/navigation, U/workspace-registry, U/ui-shell |
| Workspace search | shell.js navSearch | header + sidebar | ui.navQuery | type + Enter | nav | B/ui-flowbite-pro |
| Page header: summary, Related, empty state | shell.js, ui/cross-links.js, ui/empty-states.js | every ws | ui.workspace | automatic | counterparts | B/integration-map, B/link-integrity |
| Hash dispatcher (7 domains) | ui/navigation.js, core/url-state*.js | global | URL hash | address | every deep link | U/navigation, U/route-hygiene |
| Shortcuts dialog | ui/shortcuts.js, ui/keys/* | dialog | none | `?`, header, menu | key registry | U/shortcut-help-from-registry |
| Theme toggle | ui/theme.js | header | `oscilla.v2.theme` | header | charts | B/ui-flowbite-pro |
| Explore hints | `hints` section | top of main | `explore` | overflow-menu checkbox | none | B/navigation |
| Settings (A4, attack/release, duration, range, reset) | core/instrument.js | settings dialog | instrument | overflow menu, status-bar gear | MIDI | B/midi |
| Safety limit, output ceiling | core/safety.js, audio/output-ceiling.js | safety notice, status | instrument.gainLevel | automatic | gain | U/c011-safety-limits |
| Status bar (Play, readout, announcements) | ui/workbench.js, core/output-bus.js | footer | output bus | always; Space | every player | U/status-play, U/playing-state |
| Unsaved-work guard | ui/unsaved.js | beforeunload | per-domain | leaving | Studio, Measure, Sequencer | U/leave-policy |
| Debug panel | main.js:653 | aside | cmp.debug | **`?debug=1` only** | build info | B/first-screen |
| Audio unlock on first touch | ui/audio-unlock.js | global | AudioContext | first gesture | phone | B/touch-audio |
| Signal generator (wave, frequency/note, gain, Hold, Trigger) | core/instrument.js, audio/voice.js | Source & Pattern | instrument | panel, status Play, Space | presets, Learn | B/app, B/engine-v1port |
| Patterns (14 incl. sweep, chirp, AM, FM, user steps) | audio/patterns.js | Source | instrument | pattern select ("Režim" fold on phone) | Sequencer | U/audio-synthesis, B/dsp |
| Device & limits | charts/device-panel.js | **Analyzer only** | engine | `#m=analyzer` | Learn Nyquist | B/live-smoke |
| Signal analysis: Průběh, Spektrum, Spektrogram, Harmonické | labs/analysis.js, charts/* | analysis panel (playground, analyzer, synthesis) | tabs.analysis | tabs | mic spectrum | B/app |
| Spectrogram panel (freeze, scale, span) | charts/spectrogram-panel.js | **Analyzer only** | panel | `#m=analyzer` | — | B/labs |
| Signal path view | studio/signal-path-projection.js | analysis tab | Studio projection | tab | Studio | U/v31-studio-signal-path |
| Open the Playground voice in Studio | studio/playground-voice-open.js | **only on the signalPath tab** (index.html:722) | studio.model | button | Studio | U/playground-voice-in-studio |
| Mic analyzer (spectrum, detected frequency, freeze/avg/peak) | labs/mic-analyzer.js | mic panel (analyzer, compare) | mic | mic.toggle | Measure RTA | B/labs |
| Generator vs mic compare | analysis/compare.js | mic tab | tabs.mic | tab; Compare `enter` | Experiments compare | B/labs |
| Filter Lab (biquad, draggable response) | labs/filter-lab.js, charts/filter-chart.js | filter panel | lab.filter | `#m=filter` | Synth VCF, template | B/labs, B/journeys |
| ADSR envelope | labs/envelope.js, charts/envelope-graph.js | synthesis | lab | `#m=synthesis` | subtractive-synth | U/audio-envelope |
| Additive synthesis | labs/additive.js | synthesis | lab | `#m=synthesis` | Synth additive engine | B/first-screen |
| Phase / Lissajous / Stereo | labs/phase-stereo.js | compare, synthesis | tabs.phase | tabs | dual | U/phase-stereo-controls; **Lissajous untested** |
| Bioacoustics | labs/bioacoustics.js | compare | tabs.bio | tabs | Learn | U/bioacoustics; **ranges untested** |
| Dual oscillator (beat, binaural, mixer) | instrument.js (dual) | synthesis | instrument.dual | ws | stereo-beat | U/dual-router-live |
| Headphones confirmation | dialog | synthesis, presets | none | binaural | dual | **untested** |
| Instrument presets (8 categories, custom, history) | data/presets.js, core/storage.js | Předvolby | local + session storage | `#m=presets`, Save preset | Playground | B/app; **3 tabs untested** |
| Lab settings in link | ui/lab-state.js | Copy link | URL | link | config file | U/lab-state-round-trip |
| Config JSON export/import | ui/config-file.js | header Export | instrument + labs + sequence | menu | presets | B/app |
| WAV, sequence WAV, PNG, config URL | ui/exporters.js, audio/offline-renderer.js | **header Export menu and status-bar actions (twice)** | none | two menus | Studio Render | B/app |
| Learn cards with demos (21) | data/learn.js | Výuka | learnTopic | `#m=learn` | LEARN_TOOLS | B/cross-links |
| About | ui/about.js | about view | — | `#m=about`, menu | all | U/about-current |
| Pattern Sequencer (blocks, loop, tempo, undo) | sequencer/*, labs/sequencer-panel.js | sequencer | sequencer/model.js | `#m=sequencer` | Studio | B/sequencer |
| Sequence → Studio | studio/sequence-import.js | **"Otevřít v…" menu, Sequencer only** | studio.model | menu | timeline | U/v31-studio-sequence-file |
| Compact Studio | ui/studio/compact.js | playground, sequencer | studio.model | panel, Expand | Studio | B/v31-studio-graph |
| Guided measurement (7 steps) | measurement/*, ui/measure.js | Měření; flow card on the Playground | measure session | `#m=measure` | Experiments | B/v3-ui, B/v3-measure |
| Stimulus, live input, live RTA, quality | measurement/* | Měření | measure session | measure | mic analyzer | U/v3-live-rta, U/v3-quality |
| FR / IR / RTA results | measurement/transfer.js, impulse-response.js, rta.js | measure tabs | session | tabs | experiments | U/v3-transfer-ir |
| Calibration profiles | calibration/*, ui/measure/calibration.js | setup card | profile | measure.calImport | quality | U/v3-calibration |
| Level calibration | calibration/level.js | dialog | **page memory only** | measure.levelCal | SPL | B/v3-ui |
| Recipe link | core/url-state-measure.js | dialog | `mr` | `#m=measure&mr=` | definitions | B/navigation |
| Save as experiment | ui/measure-experiment.js | Experiment card | IndexedDB | measure.save | Experiments | U/v3-experiments |
| Loopback test context | measurement/capture-loopback-system.js | measure | query | **`?measure=loopback` only** | tests | B/live-smoke |
| Saved experiments (open, rename, duplicate, delete, import/export) | ui/experiments.js, experiments/store.js | Experimenty | IndexedDB | `#m=experiments&exp=` | compare | B/v3-ui; **delete dialog untested** |
| Experiment detail, evidence, lineage, CSV | experiments/evidence.js, csv.js | detail | record | row | findings | U/v3-run-evidence |
| Compare experiments | experiments/compare.js, semantic-diff.js | Compare panel | selection | exp.compare | mic compare | U/v3-semantic-compare |
| Definitions | experiments/definition.js | Definitions | IndexedDB | `def=` | Measure | U/v3-experiment-definitions |
| Findings | ui/findings.js | Findings | IndexedDB | `finding=` | experiments | U/v4-findings |
| Record connections | ui/connections.js | detail | records | cnx.link | history | U/v4-connections |
| Studio graph editor | ui/studio/graph-*.js, studio/actions.js | Graph subview | studio.model | `#m=studio&sv=graph` | inspector | B/v31-studio-graph |
| Node library | studio/registry.js, library-panel.js | library + Add dialog | registry | panel; drop a cable on empty canvas | catalog | U/studio-registry-definition-check |
| Inspector (params, node presets, runtime truth, trace) | ui/studio/inspector*.js | Inspector | studio.model + selection | `sv=inspector` | trace | U/v31-studio-runtime-truth |
| Timeline, automation | studio/timeline.js, automation.js | Timeline | studio.model | `sv=timeline` | transport | B/v31-studio-timeline |
| Transport | studio/transport*.js | Studio bar | studio.transport | Space | MIDI clock | B/v31-studio-transport |
| Notes-clip step grid + Record | ui/kinds/step-grid.js, studio/notes-record.js | Inspector | studio.model | R | Drums | B/step-grid |
| Templates (14) | studio/templates/index.js | templates dialog | none | `&st=` | patch library | U/v31-studio-templates |
| Projects and patches + patch library | ui/patch-browser.js, studio/patch-catalog.js | dialog (shared with the Synth) | IndexedDB | studio.library, synth.library | riffs | U/patch-browser |
| Riff library | studio/riffs/* | **patch library only** | none | dialog | demo song | U/riff-library |
| Render WAV | studio/offline.js | dialog | none | studio.renderWav | export | B/v31-studio-offline |
| Measurement from Studio | studio/measurement-run.js | Studio | measure engine | Play | experiments | B/v31-studio-workflows |
| Synth semi-modular panel (96 knobs, 73 jacks) | synth/*, ui/synth/*, ui/patch/patch-bay.js | Synth Panel tab | studio.model | `#m=synth` | Studio | B/synth |
| Polyphonic engines | synth/panels/engines.js | Enginy tab | studio.model | `yt=engines&ye=` | Learn | B/synth-engines |
| XY tab | synth/xy.js, ui/kinds/xy-pad.js | XY tab | studio.model | `yt=xy` | patch library | B/xy-pad |
| Drums (step grid, pads, record) | synth/drums.js | Bicí tab | notes clip | `yt=drums` | step grid | B/drums |
| Synth step strip | synth/step-strip.js | Panel tab | studio.model | **only after the picker inserts it** (index.html:2809) | step grid | U/synth-step-strip |
| Synth presets, Copy link, Open in Studio | synth/presets.js, synth/link.js | Synth | URL `y*` | buttons | Learn | U/synth-link |
| Computer and on-screen keyboard | midi/keyboard*.js | Playground; docked elsewhere | ui.kbd* | arm, `kbd=1`, Alt+K | MIDI | B/midi |
| MIDI in, monitor, call and response, clock out, device map | midi/* | **Settings dialog only** (index.html:3473-3590) | midi state | overflow menu → Nastavení | keyboard | B/midi |

## Hard to discover

These features exist in code but are hard to find:

- **"Open in Studio" for the Playground voice** shows only on the Signal-path tab.
- **Template and Studio links** sit behind "Otevřít v…" menus that are hidden outside their
  own workspace (index.html:1521-1528, 1659, 1728, 1977).
- **The Synth step strip** appears only after the picker inserts its notes clip.
- **Some features are reachable only by URL or query:** the debug panel, the loopback context,
  and the `def=` and `finding=` records. Every analysis, mic, phase, bio, measure and presets
  tab has no deep link.
- **All of MIDI** lives in the Settings dialog.
- **Riffs** are only in the patch library dialog.
- **Seven templates**, the demo song among them, are only in the dialog, the patch library or
  the README.
- **Device & limits and the Spectrogram panel** exist only on the Analyzer.
- **The Playground's composition depends on width.** At 1536 px and wider the lab panels are
  hidden, between 768 and 1535 px all of them show, and a phone shows only the panels listed
  for the Playground.
- **Untested surfaces:**
  - the Lissajous tab;
  - the bio ranges;
  - three preset tabs;
  - the headphones, copy and experiment-delete dialogs.
- **No feature record** exists for the Synth, keyboard/MIDI, XY, Drums, Learn, findings or the
  template/riff library: `.ai/repo/features/` holds 29 records.

## Panels shown in more than one workspace

| Panel | Workspaces |
|---|---|
| Source & Pattern | playground, sequencer, synthesis |
| Signal analysis | playground, analyzer, synthesis |
| Mic | analyzer, compare |
| Phase | compare, synthesis |
| Compact Studio | playground, sequencer |
| Measure flow card | measure, playground |
| Keyboard | every workspace |
| Patch library | Synth, Studio |
| Global dialogs | 12 workspaces |

## One concept, built more than once

- **Sequencers: 8 surfaces over 3 engines.**
  - Surfaces: source user steps, Pattern Sequencer, Studio timeline, notes-clip step grid,
    Synth step strip, Drums tab, step-voltage nodes, riffs.
  - Engines: the instrument pattern, the V2 sequence, and StudioModel.
  - The only bridge between engines is `sequence-import.js`.
- **Note inputs: 6.** On-screen/computer keys, the dock picker, the Studio `keys` node, drum
  pads, the L/R pads, XY, plus MIDI.
- **Filters: 4.** Filter Lab (V1 engine), Synth HPF/LPF, the Studio filter node, the
  filter-automation template.
- **Envelopes: 5.** Lab ADSR, the Studio envelope node, Synth EG1/EG2, Sequencer block
  envelopes, Settings attack/release.
- **Spectrum and spectrogram.** Three spectrogram mounts share one view; measure live RTA and
  result; Studio spectrum, spectrogram, RTA and scope nodes; mini scopes in the envelope and
  additive panels.
- **"Compare" names three different things:** generator vs mic, saved experiments, and the
  Porovnání workspace (mic + bio + phase).
- **Additive: 3.** Lab, Synth drawbars, the Studio additive voice.
- **Two oscillators: 3.** The dual panel, Synth VCO1/VCO2, the stereo-beat template.
- **Presets: 5 systems.** The patch library unifies three of them plus XY and riffs; the
  instrument presets stay outside it.
- **"To Studio" conversions: 4 kinds.** Playground voice, Synth Open in Studio, Sequencer
  send-to, per-lab template links.

## Studio templates (14)

| id | What links to it |
|---|---|
| basic-tone | dialog, patch library, README |
| subtractive-synth | **default Studio document** (workspace.js:238); Synthesis Related; envelope.toStudio |
| sweep-sequence | Sequencer Related; seq.toStudioTemplate |
| stereo-beat | Synthesis Related; dual.toStudio |
| filter-automation | Filter Related; filter.toStudio |
| measurement-sweep | Measure Related; measure.toStudio (not in the patch library) |
| first-patch | Learn `signal-path` demo |
| filter-envelope-synth, fm-chime, ring-mod, drive-lead, macro-pad | dialog, patch library, README only |
| step-bass | seq.toStepBass |
| demo-song | dialog, patch library, README |
