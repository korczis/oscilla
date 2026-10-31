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

## Presets and links

Five presets (`src/js/synth/presets.js`): Init, Bass, Lead, Sweep and Ring bell. A preset sets
every knob and amount as one history entry; cables stay. **Copy link** writes
`#m=synth&yp=<preset>&yv=<values that differ>&yc=<cables>`; the keys are the Synth's own, so a
Synth link never opens Studio, and a link with one unknown item is refused whole. A cable in
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
- Not here yet: the step sequencer, drums, the other synthesis engines, an AudioWorklet filter,
  oscillator sync, a plucked string and FM operator feedback (both need
  `project.no-silent-feedback` v2), MIDI CC and MIDI out.
