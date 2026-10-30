# Synth workspace

The Synth workspace (`#m=synth`, header entry **Synth**, after Studio) is a playable,
semi-modular mono voice with a docked keyboard. It is a projection of the ONE Studio document
(rule `project.studio-model-is-canonical`): every module is a Studio node, every cable a Studio
edge, and **Open in Studio** shows the same nodes, selected, at the same revision.

## The panel

Title: **Semi-modular mono voice**. Two oscillators and noise go through two 12 dB/oct filters in
series, high-pass then low-pass, into an envelope-driven amplifier:

| Module | Studio node | What is on its face |
|---|---|---|
| KEYBOARD | `keys` (new) | Glide, Transpose, Priority (last, low, high) |
| VCO 1, VCO 2 | `vco` (new) | Wave (triangle, saw, square, pulse, sine), Pulse width, Scale (32' 16' 8' 4'), Tune; on VCO 1 the MG and EG 1 pitch amounts |
| RING | `ring` (new) | Mode (ring, AM), Depth |
| NOISE | `noise` | Colour, Level, Seed |
| MIXER | `mixer` | VCO 1, VCO 2, Noise, Ring levels |
| HPF, LPF | `filter` (type fixed) | Cutoff, Peak, and the MG and EG 2 cutoff amounts (Peak has a knob and no jack: a low- or high-pass Q cannot be modulated in Web Audio, so a cable into it would do nothing) |
| EG 1, EG 2 | `envelope` | Attack, Decay, Sustain, Release |
| VCA | `gain` | Initial gain (EG 2 opens it) |
| MG / LFO | `lfo` (triangle, square) | Shape, Rate |
| S&H | `random`, clocked by the gate | Rate, Seed, Smooth (Rate and Smooth apply without a clock: disabled, saying why, while Clock is patched) |
| OUTPUT | `master` (the Studio's one) | Level |

The whole panel is one declaration, `src/js/synth/panels/semi-mono.js`: every knob, switch and
jack is generated from the registry's `defineNode` descriptors (`src/js/synth/panel.js`); the
panel may only fix, relabel, narrow or set initial values, so adding a module is one entry.

## Normalling and cables

Every input is **normalled**: with no cable the panel sounds (keyboard pitch to both VCOs, the
gate to both envelopes and the S&H, VCOs and noise into the mixer, the filters in series, EG 2
into the VCA and the cutoffs). A cable into a jack replaces its normals in one history entry;
removing the last cable restores them with their own ids. A normal is its own edge id
(`semi-mono-1-n21`), so a cable between the same two jacks (MG into LPF cutoff) is still a
cable: drawn, listed, removable and in the link. A normal removed in the Studio graph
stays removed ("open: normal removed in Studio") until **Restore normal**: the panel never
repairs the document behind the user. An edge added in the Studio graph into a normalled jack
sounds with the normal; the bay marks the jack "patched in Studio while its normal still
sounds" and offers **Break normal**. A cable that would close a loop is refused with the
`project.no-silent-feedback` sentence and nothing changes; a cable into a jack where it would
do nothing (S&H Rate while Clock is patched) is refused with the reason.

A new cable gets the props of the normal it replaces when it comes from the same source (a
Keys pitch cable into VCO 1 pitch tracks 1.00 oct per octave like normal n1); else the
polarity and mapping of a normal of the jack whose source has the same range (EG 1 into the
VCA rests closed, like EG 2's normal); else props from its source's range (an envelope is
unipolar, so it rests at the jack's base; a pitch source into an octave or cutoff input tracks
1.00 oct per octave). An amount knob that covers a cable gives it the knob's depth, and a
normal restored after a cable comes back at the knob's setting (within the session: the model
keeps a depth only on an edge, so after a reload a restored normal takes its declared depth).

The **patch bay** holds every jack, grouped by module: audio jacks are circles, control jacks
diamonds, trigger jacks triangles (`PORT_VISUALS`). Drag from one jack to another, or tap two
jacks. Enter on a focused jack opens the connection list under the bay: the jacks that can
take the cable, the refused ones with the reason, and Remove for the cables on that jack; the
jacks' names say which can take it. Delete removes a selected cable, and the cable list
removes cables, restores normals and breaks a normal a Studio edge shares. Each module card's
header folds the card (Expand all and Collapse all act on every card; the folding is view
state of the page, never in history, the link or browser storage, so a reload expands them). Amount knobs set the depth of every edge from
their source into their jacks, normalled or patched; with none they are disabled and say why.

## Inserting the panel

Opening the workspace inserts the panel into the Studio document (one history entry; Undo
removes it) when that cuts nothing. Master Output has one input: when the document's own chain
feeds it, nothing is inserted until **Insert**, and the card says which node it takes Master
Output from; the notice after Insert says it again, and Undo gives it back. A panel partly
deleted in Studio (the Keys node, say) is re-inserted around the modules still there.

## Playing

The on-screen keys, the computer keyboard (A to ', Z / X octave, C / V velocity) and MIDI notes
play the panel through one path (`src/js/midi/notes.js` `route`, `src/js/synth/ui.js`
`synthSink`). The first note **arms** the Studio transport (`transport.arm`, K104): it plays the
nodes connected to the Keys node (and Master Output), without the timeline and without an end.
Edits are applied while armed as while playing. Arming closes the envelopes a Keys gate
drives, so nothing sounds until a key is held. PLAY while armed promotes the transport to the
whole document (timeline included). Escape, page hide, STOP and leaving the
workspace disarm; a measurement that owns the output refuses the arm. Space starts nothing here
(ADR 0050).

## Engines

The **Engines** tab (Q019) holds the polyphonic engines, up to 16 voices each (Q021; the panel
stays mono). They are module entries of the same declaration (`src/js/synth/panels/engines.js`),
so their faces, jacks, presets, links and **Restore module** are generated by the same code as
the panel's; adding an engine is one entry. Choose an engine and the same keys, the on-screen
keys and MIDI play it (`transport.live` on the engine's node: its voice pool,
`src/js/synth/voice-pool.js`, `src/js/studio/adapters/voices.js`). Switching tab or engine
releases the held notes.

| Engine | Node | What it does | Honest limits |
| --- | --- | --- | --- |
| Additive | `additive-voice` | drawbars H1-H12 (linear amplitudes) or a saw, square or triangle series, tilt in dB/oct | each note drops the harmonics above 0.95 x Nyquist and the status line says how many |
| FM | `fm-voice` | 2-4 sine operators routed by 7 algorithms (`src/js/synth/fm-algorithms.js`); a modulator moves its target by I x f_mod Hz; the index falls to Index sustain over Index decay | linear FM is not band-limited: sidebands above Nyquist fold back; an operator above 0.95 x Nyquist is left out of the note (with the modulators that only drive it); a modulator that is itself modulated (the middle of a stack) is phase-modulated by its inputs, I x sin of the input's phase added to its own (the same peak deviation and line levels), and computed in the phase domain from two fixed oscillators and two wave shapers: every phase starts at 0, so it has no 0 Hz line at any ratio and the carrier holds its pitch from the onset, bass notes included (within 5 cents from 50 ms after it, A0 to A4, `o-pitch`); a carrier at a whole multiple of its modulator keeps its own 0 Hz line, a DC offset; no operator feedback (below) |
| AM / ring | `am-voice` | a carrier times a modulator at Ratio x the note, by the panel's ring law: ring c·m, AM c·(1 - d/2 + d/2·m) | digital multiplication, levels relative; coinciding carrier and modulator harmonics (the Ratio p/q in lowest terms puts the carrier's harmonic p on the modulator's harmonic q: ratio 1 always, others with a saw, square or triangle) give the product a mean, a DC offset (sines at ratio 1: half the voice's peak in ring, d/4 of it in AM), not removed: a high-pass would raise the voice's peak above its bound; the plate states it at the settings that have it (`amDcText`) |
| Wavetable | `wavetable-voice` | four band-limited tables per bank (Basic, Formant, Pulse), Morph 0-3 crossfades two neighbours, the level following the two tables' levels in dB (their correlation is taken into account) and never peaking above one table; Morph is a jack (audio-rate) | a crossfade of two tables, not a per-sample interpolation across many |
| Hard sync | `wavetable-voice`, bank fixed to Hard sync | saws hard-synced at 1, 2, 3 and 4.5 x the note, each an exact closed-form table (`syncedSawSeries`) | sync at set ratios; Morph crossfades neighbouring ratios, it is not a continuous sync sweep (that needs an AudioWorklet, K089) |
| Percussion | `perc-voice` | kick, snare, clap, three toms, closed and open hats (six squares at fixed non-harmonic ratios through a high-pass), a noise hit; the pitch class picks the voice, the octave tunes by 12 st; Hat choke | each decay is to -60 dB rel (τ = decay / ln 1000), stated on the face (the clap's from its last burst); a key release does not shorten a hit, all-off (Escape, a tab switch, MIDI all-off) cuts it; a voice's layers sum to at most 1 and the six in-phase hat squares are scaled by 1/6 |

Disabled in the picker, with their reason: the **plucked string** and **FM operator feedback**
need a loop in the audio graph (a delay shorter than one render quantum, or a one-sample
recurrence), which `project.no-silent-feedback` v1 refuses and which needs an AudioWorklet
(Q022, K094).

**One output.** The Master Output takes one cable, so the instruments share it through a chain:
the panel's VCA feeds the first engine's **Chain** input, each engine the next one, the last the
Output (normals `e1` to `e7`). An engine passes its Chain input through unchanged and adds its
voices. Deleting an engine in Studio breaks the chain there, which silences the panel and every
engine before it: the patch bay lists the gone module and the jacks it leaves open with
**Restore module** (a normal cannot come back without its module, so there is no Restore
normal for those jacks), and the tab you are on shows the gone module's plate first, with the
same button, which brings it back with its normals.

**Voices.** A note whose voice would sound nothing (every drawbar at 0, every FM carrier above
0.95 × Nyquist, ring with its modulator above it) takes no voice and steals none: the voice
count and the 16-voice ceiling count only what sounds.

**Levels.** A voice peaks at Level / 64 of digital full scale times (velocity / 127)², so the
16 voices of an engine at Level 4 (the highest and the default) and full velocity together peak
at most at digital full scale: the Master Output level is the cap and the output ceiling never
limits them (ADR 0058's rule for MIDI note voices; `src/js/studio/adapters/voices.js`). One
voice is therefore 24 dB below full scale; raise the Master Output for more. A stolen voice
fades for 5 ms before the new note starts, so the pool never sounds 17. A note-on for a note
already held re-attacks its voice from the level it holds (its oscillators run on).

## Presets and links

Five panel presets (`src/js/synth/presets.js`): Init, Bass, Lead, Sweep and Ring bell, and seven
engine presets: Organ, FM bell, FM keys, Ring metal, Formant pad, Sync lead and Kit. The menu
lists the presets of the tab you are on. A preset sets every knob and amount of its own tab as
one history entry; an engine preset sets its own engine only and chooses it, leaving the panel
and the other engines; the cables stay. **Copy link** writes `#m=synth[&yt=engines&ye=<engine>]&yp=<preset>&yv=<values that
differ>&yc=<cables>`; the keys are the Synth's own, so a Synth link never opens Studio, and a
link with one unknown item is refused whole. A link reopens the whole instrument: every module
from the preset, then the values that differ. A cable in
the link takes the depth of the amount knob that covers it (`src/js/synth/link.js`), so the
link reopens the same patch; opened over a panel that is already patched, it removes that
panel's cables first (one history entry), so the result is the sender's patch. Every jack pair
the panel patches round-trips through the link (a filter's or the VCA's `audio` names an
input and an output, and each end is read with its direction).

## Honest limits (`project.no-fake-science`)

- Pitch is the requested digital frequency: 1.00 oct per octave of the note, exact in the
  digital domain, clipped so a VCO never asks for more than 0.95 x the Nyquist limit of the
  running audio context.
- The pulse width is set, not modulated. The filter peak rings but does not self-oscillate (a
  biquad). The S&H steps a seeded random source: it samples no input.
- Levels are relative digital levels, never sound pressure.
- Not here yet: the step sequencer, the drum grid, granular synthesis (it needs the sample
  store, K074), an AudioWorklet filter, a continuous sync sweep and pulse-width modulation, a
  plucked string and FM operator feedback (both need `project.no-silent-feedback` v2), MIDI CC
  and MIDI out.
