# OSCILLA Studio user guide (V3.1)

Studio is the patching and composition workspace of OSCILLA: a graph of nodes joined by typed
cables, a timeline of clips and automation lanes, and a transport, all playing on the one audio
engine of the Playground. This guide is the short "how do I"; how it works is in
[the model](studio-model.md), [the compiler](compiler.md), [the timeline](timeline.md),
[patches and provenance](patches-and-provenance.md) and [performance](performance.md).

Start quietly, especially on headphones: Studio plays through the same master chain, limiter
and ceiling as the Playground, and every level is relative to digital full scale, not a sound
pressure.

## Open Studio and start from a template

1. Choose **Studio** in the navigation (after Experiments). The Playground's compact Studio
   panel has **EXPAND STUDIO**, which opens the same document.
2. **Templates** lists the shipped documents: Basic Tone, Subtractive Synth, Sweep Sequence,
   Filter Automation, Stereo Beat and Measurement Sweep. **Open** replaces the current Studio;
   if it has unsaved changes the dialog says so first.
3. **Play** (Space) plays the graph and the timeline; **Stop** (Esc) releases every node. The
   Playground voice and Studio are exclusive: starting one stops the other. For a screen
   reader the button is always "Play the Studio", a toggle that reads as pressed while the
   Studio plays.

Below 768 px the workspace shows one of **Graph**, **Timeline** and **Inspector** at a time
(tabs and their panels). On a touch screen, **Frame all** and **Frame selection** do not zoom
out so far that a port is smaller than 24 px: a large graph is centred, and you pan to the
rest.

## Links and fullscreen

- **Copy link** (the chain-link button after Frame all in the toolbar) puts a link to the current view in the
  address bar and on the clipboard (a dialog shows it when there is no clipboard, for example
  from some `file://` pages). It names the Studio workspace and the current view, plus the
  template while the document is that shipped template unmodified, for example
  `#m=studio&st=filter-automation&sv=timeline`. After any edit, or for a saved or imported
  project, the link carries the workspace and the view only and says so: share the document
  itself by exporting a project file. A link never carries a graph.
- **Opening a link** shows Studio, the view (`sv`: `graph`, `timeline` or `inspector`) and the
  template (`st`, one of the shipped template ids). Nothing plays until you press Play. An
  unknown template or view, an empty or repeated value, or `st` / `sv` without `m=studio` is
  refused whole with the reason, and nothing changes. If the current Studio has unsaved
  changes, the link does not replace it: the Templates dialog opens, names the linked template
  and repeats the unsaved-changes note, and **Open** is your choice.
- The Studio keys sit beside the Playground's own link and the Measure recipe link; each reads
  only its own keys. Copy link in Studio writes the Studio keys alone, and a recipe link copied
  in Measure leaves them out.
- **Fullscreen** (the button with two diagonal arrows, next to Copy link) shows the
  Studio workspace alone on the screen through the browser's fullscreen; press it again, or
  Esc, to leave. Leaving the Studio workspace leaves fullscreen too. It is optional: the
  workspace already fills the window without it. Where the browser has no fullscreen for part
  of a page (Safari on iPhone, for example) or it is turned off, the button stays but is marked
  unavailable, and pressing it says why.
- While Studio is fullscreen, Esc belongs to the browser first. In the tests, Firefox and
  WebKit leave fullscreen and do not pass that key press to Studio, so a second Esc is the
  usual Studio Esc (cancel a drag, close a picker, else stop). **Stop** in the toolbar always
  stops.

## Create a node

- Click an item in the **Node library** to add it at the centre of the graph, or drag it onto
  the graph to place it.
- Press **N** (or double-click empty canvas) for the searchable **Add node** picker; Enter adds
  the first match. An empty graph says so on the canvas, with these ways to begin.
- A Studio has exactly one Master Output; the library says so instead of adding a second.

## Connect nodes

- Drag from an output port to an input port. Port glyphs show the signal type (audio, control,
  trigger, analysis); compatible inputs are emphasised while you drag.
- Without dragging: select a node and press **C** (or **Connect…** in the Inspector) for the
  list of inputs that can take its output; Enter connects. On a touch screen, tap an output,
  then tap a highlighted input.
- Drop a cable on empty canvas to add a node that accepts it, already connected.
- With a screen reader, a node reads its name, kind, settings and how many input and output
  connections it has; the Inspector's Connections list and the Connect dialog name each port
  and what it is connected to.
- A connection that cannot work is refused with a sentence, for example an audio output on a
  trigger input, or a loop that would feed audio back into itself without a delay. Nothing is
  changed silently.

## Edit parameters

Select a node: the **Inspector** shows its parameters with their units and ranges. Type a value
("2.4k" for 2400 Hz) or use the slider; a value out of range is refused with the range. Each
edit is one undo step (Ctrl/⌘ Z). **Automate** creates the parameter's automation lane, or shows
it when it exists.

## Find a node

Press **/** (or the search button in the Signal graph header) and type part of a name, a type
("filter"), a category ("modulation") or an alias ("vca"). Enter, or a click on a result,
selects the node, frames it in the graph and moves focus to it. Esc closes the search and
returns focus to where you were.

## Transport and document settings

With nothing selected (click empty canvas, or Esc), the Inspector shows the Studio itself:
title, the **Transport** (time in seconds or bars and beats, tempo in BPM, beats per bar and the
beat unit, the loop switch with its start and end, and the timeline's length) and notes. These
are document settings: each change is an undoable edit, and tempo changes move tempo-linked
clips. The timeline's transport strip shows the same tempo.

## Is what plays what you see? (Runtime)

The same Studio view of the Inspector (nothing selected) starts with **Runtime**: whether the
graph on screen is the one the audio engine runs.

- **Not applied**: nothing runs; press Play to apply this Studio.
- **Running**: the running graph is the current revision of the Studio.
- **Previous configuration still running**: an older revision plays; the current one is not
  applied yet.
- **Refused**: the engine refused the current revision and keeps playing the last one; the
  reason and its code follow.
- **Failed**: Play was refused on this revision; the reason and its code follow.

A change of state is announced to screen readers. Below it, the **diagnostics** of what runs
(or failed to): each gives its message, code and owner (runtime or transport), and **Select …**
selects the node, connection, clip or lane it names. A live edit the running graph cannot take
is refused, so the state stays Running and the refusal is listed until a later edit is applied;
the node's own status line in the Inspector gives the same reason with its code. **Runtime
details** shows the desired revision with a short Studio hash, the applied revision with a short
plan hash and the time it was applied, the nodes that are ready, degraded or offline-only, the
cables that are live, inactive or have no audible effect, the automation lanes playing and the
parameters they own. How these are computed is in [the compiler](compiler.md) "Runtime truth".

Below the state, **Trace** lists what the last operations did, newest first: your edit, Play,
Stop or an undo. Open one (Enter or Space on its line) to read its steps in words: the change
you made, the plan the runtime compiled (with a short plan hash), whether the running graph
applied it, refused it (with the code) or had nothing to apply because playback was stopped, and
each parameter value and connection gain the audio engine was given, with the audio time. A
setting that changes nothing audible right away says `stored`: a Spectrum's scale (a display
setting), or an Envelope stage (it applies at the next gate). When an automation lane drives a
parameter, the step says the parameter is owned: the lane writes it, not your edit. A long
slider drag records many steps and pushes older operations out of the list. With a node selected, its Inspector shows only the operations that touched that node. The
trace is kept in memory for the current session only, is never saved, and holds the most recent
steps.

## Sequence on the timeline

The **Timeline** holds tracks of clips: pattern clips (the sequencer's blocks) on a Sequence or
an Oscillator, gate events on an Envelope, and measurement clips. Add a clip with **+**, drag
it to move, drag its edges to resize; snapping is chosen in the strip (time grid, bars and
beats, markers or off). Every drag has a keyboard path; with a clip focused:

<!-- timeline-keys:begin -->
Space play or stop · Esc cancel or stop · Home return · ←/→ move (Shift fine) · ↑/↓ track or value · Enter edit · Delete remove · Ctrl/⌘ D duplicate · S split at playhead · M marker · L loop · [ ] previous / next marker
<!-- timeline-keys:end -->

The details panel and the Inspector also edit a clip's start, duration and track as numbers.
A clip that the measurement engine could not run (a pre-roll longer than 5 s, a stimulus clip
on a Microphone, ...) is refused with the reason, whether you drag it, type it or import it.
Selecting one clip announces it by name and track ("Sweep clip on Source selected" in the
Subtractive Synth).

## Automate a parameter

An automation lane belongs to one parameter and is drawn in that parameter's own scale (a
frequency lane is logarithmic). Double-click the lane to add a point, drag it, or focus it and
use the arrow keys (Page Up / Page Down for large steps); Enter types an exact value. Modulation
cables add to the automated value.

## Save, export and patches

- **Save** keeps the project in this browser; **Open** lists saved projects and patches. From
  `file://` the browser's storage may be unavailable: the library then keeps them in memory for
  this page view and says so.
- **Export** writes a `.oscilla-studio.json` file; **Import** reads a project (it replaces the
  document) or a patch (it is inserted, one undo step). A malformed or hostile file is refused
  with the reason.
- Select nodes and choose **Save as patch…** in the Inspector to reuse them; inserting a patch
  never overwrites existing nodes.

## Render WAV

**Render WAV** (the file icon with a wave in the toolbar) renders the Studio offline and
downloads a 16-bit WAV. The dialog offers the timeline's length (or 2 s for a graph without a
timeline), says the format (48 kHz stereo, or a Recorder node's format) and lists what will not
be rendered. The render runs the same compiler, runtime and transport as live playback on an
OfflineAudioContext, so the file is what PLAY plays, and the same Studio renders the same bytes.
Progress shows under the toolbar; **Abort** drops the render. A live input (Microphone) cannot be
rendered offline: Render is then disabled and the dialog says why. Measurement clips are not
rendered; they run live.

## Measure with the Measurement Sweep template

The **Measurement Sweep** template is a transfer measurement drawn as a graph: a logarithmic
Sweep plays to the Master Output, its exact digital reference goes to the Transfer Analyzer's
REFERENCE input, and the Microphone, through Calibration, goes to its OBSERVED input. The
measurement track holds the phases: noise check, pre-roll, stimulus, tail, analysis, with the
capture window on a second track.

1. Read the safety notes in **Measure** first: do not wear headphones during a loudspeaker
   sweep, and start with a low output level.
2. The browser asks for the microphone when the measurement's setup check opens the input; the
   capture stays in this page (nothing is uploaded).
3. Press **Play**. Just before the first measurement clip (a quarter of a second) the Studio
   releases the output and hands the measurement to the measurement engine of the **Measure**
   workspace, which starts capturing on the clip's own time: the stimulus and the
   timing come from the graph and the clips (sweep range, length and level from the Sweep;
   pre-roll, tail and noise-check lengths from their clips). The task strip under the toolbar
   shows the engine's state and progress; **Abort**, Stop or Esc abort it.
4. When it completes, the result is saved as an experiment that also records the Studio that ran
   (its schema version, its hash and its execution state: nodes, parameters, cables, clips,
   automation). Open it in **Experiments**; the result is also shown in **Measure**.

The result is a relative response of the whole chain (output, loudspeaker, room, microphone),
not an absolute level, unless you use a valid calibration in Measure. While a measurement owns
the output, Studio PLAY is refused.

## Keyboard shortcuts

They apply while the Studio has focus and no text field is being edited; Tab is never taken.
The same table is the in-app list (the keyboard button in the toolbar).

<!-- shortcuts:begin -->
| Keys | Action |
| --- | --- |
| Space | Play / stop the Studio transport |
| Esc | Cancel a drag or connection, close a picker, else stop |
| Delete / Backspace | Delete the selected nodes or connection |
| Ctrl/⌘ C | Copy the selected nodes |
| Ctrl/⌘ X | Cut the selected nodes |
| Ctrl/⌘ V | Paste (new ids, small offset) |
| Ctrl/⌘ D | Duplicate the selected nodes |
| Ctrl/⌘ Z | Undo |
| Ctrl/⌘ Shift Z, Ctrl Y | Redo |
| Ctrl/⌘ A | Select every node |
| N | Add a node (searchable picker) |
| / | Find a node by name or type and frame it |
| C | Connect the selected node (list of compatible inputs) |
| F | Frame the selection |
| A | Frame the whole graph |
| + | Zoom in |
| − | Zoom out |
| Arrows (Shift: ×4) | Move the selected nodes by the grid |
| Tab | Move focus (never taken by Studio) |
<!-- shortcuts:end -->

## Limits

- Not built yet: a minimap, node groups, dragging several clips at once, pinch zoom on the
  timeline. A link opens a shipped template only; a saved project is shared as a file.
- Studio is responsive at about 100 nodes and 200 connections ([performance](performance.md));
  it is not designed for much larger graphs.
