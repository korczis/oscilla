# The Playground Signal Path renders from a Studio graph (V421)

Specification `docs/specs/oscilla-v3.1-studio.md` §1, §9, §127-§129, §164-§165, §197; plan issue
V421 (the open gap: "Playground Signal Path renders from StudioGraph"); rule
`project.studio-model-is-canonical`; ADR 0030 (every Studio view is a projection) and ADR 0014
(V1 behaviour frozen by golden vectors). This note records the decision. The doctrine of
`.ai/repo/adrs/` is that an ADR is written by a person promoting a decision, not automatically,
so this is a design note. It refines ADR 0030's "Signal Path preview" and does not add an
architecture of its own.

## The problem

Before V421 the Playground's Signal Path view (`src/js/visualization/signal-path.js`) drew a
stage list that `pathNodesFor(plan, state, lab)` built by hand from the Playground plan: V1's
seven fixed boxes, plus a V2 extension that patched in the filter, ADSR, additive and stereo
router stages. That was a second topology generator that had nothing to do with the Studio graph.
§164 forbids it ("Existing Signal Path renders from StudioGraph where possible; no unrelated
topology generator"), and §1 says the screen must not show one topology while another one
sounds.

## Decision

**The Signal Path projects the Playground voice, expressed as a StudioModel.** One pure function
turns the Playground's state into a schema-1 StudioModel
(`src/js/studio/playground-voice.js`, `playgroundVoiceModel`). One pure projection turns any
StudioModel into Signal Path stages (`src/js/studio/signal-path-projection.js`,
`projectSignalPath`). The canvas draws those stages and nothing else.

```
instrument.vizInputs() + main.js labVizInputs()          (the Playground's own state)
        │ playgroundVoiceModel()        pure, rebuilt on every bridge sync, never stored
        ▼
StudioModel "Playground voice"  { model, annotations }   (schema 1, normalized, plain data)
        │ projectSignalPath()           pure; the same signal-path reading as a11y.js
        ▼
bridge.state.pathNodes = stages,  bridge.state.signalPath = { model, annotations, sources }
        │
        ▼
createSignalPathView().draw()   V1 p5 renderer, unchanged (snake layout, flow, bypass arc)
```

### Why (a), the Playground voice as a derived model, and not (b), the active Studio document

- **The Signal Path means the Playground's own sound.** The caption says so ("Active Web Audio
  processing graph"). The view lights its boxes while the Playground voice plays
  (`st.playing && st.live.voice`), and it follows the Playground's plan and labs. The Studio
  document is unrelated to that voice and is often a measurement chain. The Studio output and
  the Playground voice are exclusive (`docs/v31/compiler.md`). Under (b), the Playground's
  Signal Path would show one topology while the Playground voice sounds another, which is the
  exact failure §1 forbids.
- **(b) would duplicate the compact widget.** The Playground already shows the active Studio
  document through the compact Studio widget (`ui/studio/compact.js`), a projection of the one
  store (§127-§128, §214). A second view of the same document would add nothing and would take
  away the only picture of the Playground's chain.
- **(a) keeps the one-model rule.** The Playground's canonical state stays where it is
  (instrument state and labs); the Studio's canonical state stays the one store. The derived
  model is neither of them: it is not stored, not dispatched to, not edited and not
  synchronized. Like `importSequence` (V2 sequence → StudioModel, `sequence-import.js`), it is
  a pure function of the Playground state, rebuilt on every bridge sync. No `signalPathState`
  exists. The Signal Path reads a StudioModel and derives no topology of its own.
- **It is §165 as written.** "Playground keeps a read-only simplified projection; Studio makes
  the same semantics editable." The Playground voice is now a Studio graph. A later "open the
  Playground voice in Studio" is a dispatch of this model into the store, not a translation.

### Why the renderer stays V1's

The canvas renderer, layout and wording do not change. The visual identity lock names the
Signal Path as the direct visual ancestor of the Studio graph. Its V1 wording is frozen:
`tests/freeze/golden-a7b7a23.json` holds ten `viz.bridge/syncViz:*` vectors of `pathNodes`, and
they pass unchanged on the projection. So the stage objects keep the V1 shape
`{ title, sub, mod, enabled? }`, and the node-to-stage provenance lives beside them
(`signalPath.sources`). The compact widget and the Signal Path are two projections of
StudioModels and share what makes them the same reading of a graph:

- **The model and the registry.**
- **The signal-path walk.** `signalInputs` collects AUDIO edges into SIGNAL inputs in port
  order. `a11y.js summarizeGraph` now uses it too, so the screen-reader summary and the Signal
  Path read the same path.
- **Titles from node names in capitals.** These are presentation state, as the compact
  widget's chips are.

They differ only in layout. Compact uses an automatic grid (`graph-layout.js`, §197); the Signal
Path keeps V1's snake of stages.

## The mapping

The derived graph is the voice that `AudioEngine.play` builds for the plan with the V2 options
(`audio-engine.js`, `modulation.js`, `scheduler.js`), node for node where Studio has the node.

| Playground | Studio graph (ids from `PLAYGROUND_VOICE_IDS`) | Signal Path stages |
| --- | --- | --- |
| any single-oscillator plan | Oscillator `osc-1` (waveform, frequency = the frequency control) → Envelope → [Filter] → Master Output | OSCILLATOR · MODULATION … · ENVELOPE · [FILTER] · MASTER GAIN · LIMITER · ANALYSER · DEVICE OUTPUT |
| fixed tone, finite tone, invalid plan | nothing modulates the oscillator | MODULATION "none · fixed frequency" (bypassed, arc) |
| siren, wobble (`lfo`) | LFO → `osc-1.frequency`; edge depth = plan depth (Hz), edge offset = plan centre − frequency control, so base + offset is the sounding centre | LFO → FREQUENCY "rate · ±depth" |
| FM (`fm`) | LFO node at modFreq → `osc-1.frequency`, depth in Hz | MODULATOR → FREQ |
| AM (`am`) | Oscillator → Gain (1 − depth/2) → Envelope; LFO → `gain-1.gain`, depth depth/2 (`buildAm`'s amGain and lfoGain) | LFO → GAIN (AM) "rate · depth %" (depth = 2d / (g + d)) |
| pulse, burst, alternating, random, octave, sequence (`steps`) | automation lane on `osc-1.frequency`, one step point per scheduled tone | FREQUENCY STEPS "n scheduled steps" |
| sweeps, ping-pong, chirp, sweep source (`ramps`) | automation lane on `osc-1.frequency`: a step point at each segment start, an exponential (log) or linear point at its end | FREQUENCY RAMP "exponential / linear ramp" |
| dual, mono | Osc A, Osc B (level = side gain · level · 0.5) → Mixer | OSC A + OSC B · MIX (MONO) "A + B summed" |
| dual, stereo, no router (V1) | Osc A → Pan −1, Osc B → Pan +1 → Mixer | STEREO PANNERS "A → left · B → right" |
| dual with the V2 stereo router | Osc A, Osc B → Stereo Split (mode split, or pan with the Phase lab's pan) | STEREO ROUTER "split · A → L · B → R" / "mix · pan x" |
| Envelope Lab off / on | Envelope attack/release with sustain 1 / the lab's ADSR | ENVELOPE "A · R" / ADSR ENVELOPE "A · D · S · R" |
| Filter Lab enabled | Filter after the envelope (the engine's insert) | FILTER "low-pass · 1.20 kHz · Q 0.707" |
| Additive Lab on | `osc-1` named Additive Osc, annotation `partials` | ADDITIVE OSC "PeriodicWave · n partials · f" |
| Phase lab, dual | annotation `phaseDeg` on `osc-2` | "… · B +90°" on the source stage |
| gain control | Master Output level (logical gain) | MASTER GAIN "logical 0.080"; LIMITER, ANALYSER, DEVICE OUTPUT are the safe output chain the Master Output compiles to (ADR 0035) |

The microphone is analysis only and can never reach Master Output (`live-input-to-output`). It
is not part of the voice and never was a stage. The Playground has no noise source.

## Where schema 1 falls short (recorded, not hidden)

- **Annotations.** Studio schema 1 has no field for two facts: an additive oscillator's partial
  count and the dual B side's start phase. They travel as `annotations` keyed by node id, beside
  the model, as runtime handles do (§43). They only add sub text to their node's stage; they
  never add, remove or reorder a stage. A schema that gains those fields retires them. Adding a
  parameter to the oscillator now would change the `studioHash` of every template and saved
  Studio.
- **Ranges.** The Studio LFO tops out at 100 Hz; the Playground's AM modulator reaches 500 Hz
  and its FM modulator 2 kHz. The derived model keeps the sounding value, so the Signal Path
  shows what plays. Such a model does not pass `validateStudioModel` (`invalid-param` on
  `lfo-1`). The derived model is never compiled, saved or entered into provenance, and the test
  asserts that exact diagnostic.
- **Per-step gating.** The silent gaps of a stepped pattern are the engine's per-step envelope.
  The derived model carries the frequency program as a lane and does not model the gaps as
  clips, because the Signal Path does not draw them.
- **One wording change.** An Envelope Lab ADSR at sustain exactly 1 now reads
  "A … · R …" instead of "A … · D … · S 1 · R …". At full sustain the decay goes from 1 to 1
  and changes nothing, and the projection reads the envelope from its parameters. The stage,
  its title (ADSR ENVELOPE) and its place are unchanged. Every other stage of the matrix test is
  identical.

## Tests

- `tests/unit/v31-studio-signal-path.test.mjs`:
  - **Parity.** Every pattern, the sweep source with its directions, dual mono and stereo, every
    lab stage and combination, four waveforms and two envelope and gain settings: 3 240 cases.
    The projection equals the pre-V421 derivation, frozen verbatim as a test oracle in
    `tests/unit/fixtures/signal-path-oracle.mjs` and never imported by `src/`. Every stage title
    the Signal Path ever drew appears.
  - **Model checks.** The derived model is valid plain data, and each stage's `sources` point to
    real nodes, edges and lanes.
  - **Topology.** The graph matches what the engine builds: AM gain stage, the modulation edge's
    sounding centre, lanes per step and ramp, mixer, panners and router.
  - **Ranges.** An out-of-range modulator gives exactly the `invalid-param` diagnostic.
  - **Bridge.** `pathNodes` is the projection, and the microphone does not change it.
  - **No second derivation.** No `pathNodesFor` remains anywhere in `src/`, the canvas view
    imports nothing, and the bridge assigns `pathNodes` once, from the projection.
  - **Generic graphs.** Every template projects along the signal path that the screen-reader
    summary reads, and a noise source and a microphone project.
- `tests/unit/freeze.test.mjs`: the ten V1 `syncViz` golden vectors (`pathNodes` included) pass
  on the projection.
- `tests/unit/qa-regressions.test.mjs` (#17) and `tests/browser/qa-regressions.cjs`
  `signal-path-stages`: the V2 stages appear in the app. Each drawn stage maps to its model
  nodes: FILTER to the filter node, ADSR ENVELOPE to the envelope, OSC A + OSC B to the two
  oscillators, STEREO ROUTER to the stereo split.

## Not done here

- **No "open the Playground voice in Studio" action (§165).** The model it would dispatch exists
  now.
- **No node selection from the Playground Signal Path.** §128's quick Inspector belongs to the
  compact Studio widget, which has it. The Playground's projection is read-only by §165.
