# OSCILLA V3.1 — STUDIO (specification as supplied by the requester, 2026-10-02)

Recorded verbatim in content; only the `=====` rulers and list line breaks were condensed.
Section numbers are the requester's. The VISUAL IDENTITY LOCK supplied with it is at the end and
binds every V3.x surface. Plan: milestones M021-M033, issues V4xx.

Title: OSCILLA V3.1 STUDIO: VISUAL SIGNAL PROGRAMMING, SEQUENCING, AUTOMATION AND EXPERIMENT
GRAPH. Repository https://github.com/korczis/oscilla · public https://korczis.github.io/oscilla/.
This is an EXISTING product. Do not build a side prototype. Do not replace working architecture
without evidence. Do not create a second application beside OSCILLA. Do not implement only the
attractive visual surface while leaving the model, compiler, tests, provenance or Majordomus state
unfinished. The engineer owns the complete result: product, architecture, model, DSP, UI, UX,
accessibility, testing, Majordomus, knowledge, ADRs, use cases, features, release, deployment,
public verification. Continue autonomously until the public V3.1 release is verified.

## 0. Product evolution
V1 PLAY (generate, see, learn); V2 LAB (generate, analyze, compose, filter, synthesize, compare,
export); V3.0 MEASURE (calibrate, measure, repeat, compare, quantify, save, reproduce); V3.1
STUDIO (CONNECT, SEQUENCE, AUTOMATE, MODULATE, MEASURE, ORCHESTRATE, REPRODUCE). Defining idea:
OSCILLA Studio is a visual signal-programming environment where a user can construct sound and
measurement graphs, sequence them over time, automate parameters, route modulation and analysis,
and preserve the whole software-side experiment as reproducible structured state. Studio is NOT
simply a prettier sequencer. It combines: editable signal graph, modular audio routing, typed
ports, signal processing, modulation routing, analysis routing, measurement routing, multi-track
timeline, event clips, pattern clips, automation lanes, measurement actions, transport, graph
compilation, undo/redo, serialization, patch reuse, experiment provenance.

## 1. Central product principle
Studio turns the existing Signal Path from PASSIVE VISUALIZATION into EDITABLE EXECUTABLE MODEL.
The visual graph is a projection of the canonical StudioModel, which is compiled into the actual
audio/control/measurement topology: UI GRAPH → STUDIO MODEL (validation, graph semantics, timeline
semantics, automation, serialization) → COMPILER → OSCILLA AUDIO / MEASUREMENT ENGINE. The screen
must never show one topology while the actual Web Audio topology is something else.

## 2. V3.1 is a full product milestone
Not "improve the sequencer" but "introduce the OSCILLA Studio execution model". The current
sequencer becomes one part of Studio; Signal Path is the visual ancestor of the graph editor;
AudioEngine remains the authoritative audio lifecycle owner; V3 measurement architecture remains
authoritative for measurement. Studio orchestrates these systems and does not duplicate them.

## 3. First action: verify current reality
Before changing code inspect: HEAD; public deployment; product version; tags/releases; build
provenance; V1/V2/V3 architecture; sequencer; Signal Path implementation; audio graph
abstractions; measurement architecture; experiment model; persistence; visual regression system;
CI/release gate; Majordomus state; all ADRs; Features; Use Cases; Rules; Knowledge sources;
Deployments/Release records; open Decisions; open Questions; milestones/issues; README, CLAUDE.md,
AGENTS.md, GEMINI.md. Repository evidence wins.

## 4. Majordomus first
Read current documentation at https://majordomus.dev/, then `majordomus --version`, `--help` and
current commands for context, doctor, watch, check, finish, plan, project, task, worktree,
feature, product, usecase, adr, decision, question, evidence, knowledge, rules, deployment,
release, session, handover, update. Do not hallucinate commands; use actual schemas.

## 5. Majordomus is part of the implementation
Not only bootstrap/TODO/final check: it is the repository-level knowledge and governance layer
for Studio. Studio must exist canonically across PROJECT, MILESTONES, ISSUES, FEATURES, USE CASES,
ADRS, DECISIONS, QUESTIONS, RULES, KNOWLEDGE, EVIDENCE, DEPLOYMENTS, RELEASES; also evaluate
APPLICATIONS, AREAS, AUDIENCES, CLAIMS, WHY/MOMENTS if part of the ontology. No meaningless
boilerplate.

## 6. Majordomus bootstrap
Run current equivalents of context, doctor, plan status, product validate, usecase coverage, adr
check. Resolve legitimate findings. Confirm provider projections current, rules discoverable,
knowledge sources valid, project graph valid, release/deployment state understood, worktree
valid, no unfinished task conflicts. Use Majordomus worktree conventions for feature branches.

## 7. Create V3.1 project structure
One explicit V3.1 product milestone plus supporting milestones: A Studio architecture; B graph
model; C graph editor; D audio graph compiler; E timeline; F automation; G compact Studio; H full
Studio workspace; I measurement integration; J persistence/patches; K accessibility/mobile;
L verification; M release/deployment. Use repository numbering conventions.

## 8. V3.1 task graph
Tracked issues for at least: architecture audit; Studio schema; node model; edge model; typed
ports; graph validation; cycle detection; graph compiler; runtime graph diff; live topology
updates; node library; graph viewport; node drag; cable drag; connection editing; selection;
multi-selection; lasso/rectangle selection; copy/paste; duplicate; undo/redo; Inspector; timeline
model; tracks; clips; clip drag; clip resize; snapping; transport; loop region; markers;
automation model; automation editor; automation compilation; compact Studio widget; full Studio
workspace; Studio navigation; mobile Studio; accessible non-drag operations; patch serialization;
patch persistence; experiment integration; measurement nodes; Studio provenance; tests; visual
regression; documentation; release. Explicit dependencies.

## 9. Canonical state
Exactly ONE canonical Studio state (StudioModel or a repository-consistent name). Compact Studio,
Full Studio, Inspector, Timeline, Signal Path preview and experiment serialization are all
PROJECTIONS. Separate synchronized states (compactSequencerState, fullStudioState,
signalPathState) are prohibited.

## 10. Studio model
Versioned, serializable: { schemaVersion: 1, graph: { nodes, edges }, timeline: { tracks, clips,
automation, markers, loop }, transport: { timeMode: 'seconds', tempo: 120, timeSignature: [4,4] },
view: { graph, timeline }, metadata }. Never serialize AudioContext, AudioNode, AudioParam,
MediaStream, Canvas, DOM references, uPlot, p5 instances, workers, worklets.

## 11. Product version vs Studio schema
Keep separate: product version (3.1.x), Studio schema version (e.g. 1), experiment schema
version, config/preset schema version. A Studio file from 3.1.0 may stay valid in 3.4.0.

## 12. Studio feature object
A canonical Majordomus Feature for OSCILLA Studio, plus subordinate stable features only where
semantics justify (likely studio, studio-signal-graph, studio-timeline, studio-automation,
studio-patches, studio-measurement-routing). Features describe user capabilities ("Delete button"
is not a feature).

## 13. Feature relationships
Where schemas allow typed references, connect Features to ADRs, Use Cases, Rules, source modules,
tests, issues, applications, claims, documents.

## 14. Studio use cases
UC1 build a simple signal path (Oscillator → ADSR → Filter → Master); UC2 connect modulation
(LFO → Filter Cutoff); UC3 reject invalid connection; UC4 sequence multiple events (Tone → Sweep →
Pulse); UC5 automate a parameter (cutoff 500 Hz → 8 kHz); UC6 edit while playing without leaking
nodes; UC7 undo/redo; UC8 copy/paste a subgraph; UC9 compact ↔ full synchronization; UC10 save
and load a patch; UC11 define a measurement pipeline (Sweep → Output; Microphone → Calibration →
Transfer Analyzer); UC12 save topology as experiment provenance; UC13 operate without pointer
dragging; UC14 open Studio under file://. Actual current use-case schema.

## 15. Use cases executable where possible
Run actual commands/tests; reference/invoke Playwright scenarios where the use-case mechanism
supports it; no fake transcripts.

## 16. V3.1 ADR audit
Candidates: StudioModel separate from runtime graph; one canonical model with compact/full
projections; typed ports; HTML nodes + SVG cable layer; custom graph implementation vs generic
flow-editor framework; compiled into the existing AudioEngine; incremental runtime patching vs
full rebuild; timeline audio-clock authority; automation and modulation separate; command/action
model provides undo/redo; Studio schema independent of product version; measurement topology
inside Studio; instantaneous feedback cycles rejected; single-file compatibility. Only genuinely
durable decisions.

## 17. ADR lifecycle
Respect repository ADR policy; leave new ADRs proposed if acceptance needs a human; use Majordomus
ADR tooling to propose, validate, find affected decisions, link references; run ADR affected
analysis for every major architecture-changing commit.

## 18. ADR history must remain true
Do not rewrite old ADRs: still valid → evidence only; clarification → careful update if policy
permits; superseded → new superseding ADR; new decision → new ADR.

## 19. Majordomus decisions
For durable choices below ADR level: graph coordinate unit, min/max zoom, default grid size,
connection hit width, initial Studio schema version, timeline snap defaults, pointer-drag
threshold, maximum node import count. Only what future work needs.

## 20. Majordomus questions
For unresolved uncertainties (e.g. Safari worklets from file://, patch file extension, browser
Fullscreen worth it, groups/subgraphs in 3.1.0 or 3.2). Resolve with evidence; do not silently
guess important architecture.

## 21. Project rules
Add/update rules where V3.1 introduces permanent invariants, e.g.: STUDIO MODEL IS CANONICAL; NO
RUNTIME AUDIO NODES IN SERIALIZED STUDIO STATE; TYPED PORTS (validate before runtime mutation);
AUDIO CLOCK AUTHORITY (no scheduling from rAF/setTimeout); UNDOABLE STUDIO MUTATIONS; NO SILENT
FEEDBACK LOOPS; STUDIO MUST WORK UNDER FILE://; NO GENERIC FLOW-EDITOR VISUAL IDENTITY. Only rules
that deserve enforcement.

## 22. Knowledgebase
Knowledge learns Studio from canonical artifacts; no second wiki duplicating Features, ADRs, Use
Cases, Rules, project records. Validate discovery after each major addition.

## 23. Knowledge questions V3.1 must answer
What is Studio; canonical state; why HTML nodes and SVG cables; how graphs compile to Web Audio;
port types; why audio and control ports differ; why automation and modulation are distinct; which
Use Case proves drag-and-drop connection; which proves keyboard connection; how undo works; how
Studio integrates with measurement; how Studio state enters experiment provenance; which tests
prove compact/full sync; Studio schema version; which ADR governs feedback loops; which Studio
version is public. Answers from canonical evidence.

## 24. Curated knowledge
Only reusable technical findings (Web Audio graph mutation pitfalls, SVG cable hit-testing,
Pointer Events drag architecture, AudioParam automation interactions, graph-cycle safety,
cross-browser pointer/touch differences). Not architecture decisions.

## 25. Application / area model
If the ontology uses Applications/Areas, evaluate whether Studio is an application, an area or
neither (possible areas: audio-graph, sequencing, measurement, visualization). No gratuitous
ontology.

## 26. Claims
Only verifiable claims with evidence (e.g. "compact and full views use one canonical state",
"graphs serialize independently of runtime nodes", "transport uses AudioContext time"). No
marketing.

## 27. Graph model
Nodes { id, type, position, params, metadata } and edges { id, from: { node, port }, to: { node,
port }, routing properties } (e.g. filter-1 lowpass 2400 Hz Q 0.707 enabled at x 430, y 160;
edge-4 osc-1.audio → filter-1.audio).

## 28. Node type definitions
A canonical node-type registry, not giant switches: type ID, display name, category, input ports,
output ports, parameter schema, defaults, compact summary, compiler adapter, Inspector schema,
optional visualization, serialization rules. No audio nodes in registry metadata.

## 29. Initial node library
SOURCES Oscillator, Noise, Sweep, Sequence, Microphone; MODULATION LFO, Envelope, Random, Step
Modulator; PROCESSING Gain, Filter, Pan, Stereo Split, Mixer; ANALYSIS Scope, Spectrum,
Spectrogram, Meter, RTA; OUTPUT Master Output, Recorder/Export; MEASUREMENT Capture, Calibration,
Transfer Analyzer. Reuse V2/V3 implementations; no duplicated DSP.

## 30. Node categories
Grouped library with text search over name, aliases, category.

## 31. Port types
Minimum AUDIO, CONTROL, TRIGGER, ANALYSIS (MEASUREMENT only if truly different semantics). Type
drives compatibility, visual shape, cable style, Inspector language, compiler behaviour.

## 32. Visual port semantics
Distinguishable without colour: AUDIO circle, CONTROL diamond, TRIGGER triangle, ANALYSIS square;
accessible labels state type and direction.

## 33. Port compatibility
Pure model logic `canConnect(sourcePort, targetPort)` → { allowed, reason } (e.g. "Audio output
cannot connect to a trigger input."). Not DOM logic.

## 34. Parameter target ports
Control ports targeting parameters know parameter, units, range, mapping (cutoff, frequency, gain,
pan).

## 35. Modulation connection
Control edges carry depth, polarity, mapping, offset if supported (e.g. LFO 1 → cutoff, depth
1200 Hz, bipolar) on the edge, not as unrelated node params.

## 36. Connection objects are first-class
Edges can be selected, inspected, deleted, muted/edited where meaningful; state in the model, not
the SVG.

## 37. Graph validation
Pure, structured diagnostics: unknown node type, missing node, unknown port, wrong direction, type
mismatch, duplicate illegal edge, unsupported multiple connection, cycle, unreachable mandatory
output, invalid edge properties.

## 38. Cycle detection
Explicit traversal, cycle detection, topological ordering; never let Web Audio discover invalid
topology.

## 39. Feedback policy
Reject instantaneous audio feedback cycles ("Connection rejected: This would create an
unsupported instantaneous audio feedback loop."). Safe delay/feedback nodes later need their own
feature/ADR.

## 40. Control cycles
Define semantics: LFO modulating another control node may be valid; a modulation loop controlling
itself may not. Test.

## 41. Graph compiler
StudioGraph → existing runtime components: validate, resolve types, order, instantiate, connect
ports, bind parameters, configure values, register with AudioEngine lifecycle accounting, bind
analyzers, return runtime handles, support disposal.

## 42. No second audio engine
Absolute: reuse AudioEngine, filter builders, additive, stereo, analyzers, measurement engine,
offline renderer. Studio is orchestration.

## 43. Runtime graph representation
Ephemeral map Studio node ID → runtime handle (runtime.nodes.get('filter-1')); model stays
serializable.

## 44. Incremental graph updates
Diff/patch, not rebuild: param change → update node; node added → create; edge added → connect;
edge removed → crossfade/disconnect; node removed → remove routes, fade, dispose.

## 45. Click-free live editing
Create new path, crossfade, detach old, dispose; never disconnect the master graph immediately
while playing.

## 46. Graph transaction
Validate change → prepare runtime mutation → commit model → apply/crossfade → cleanup; on failure
keep the last valid runtime graph; never half-connected.

## 47. Studio action layer
All meaningful mutations via dispatch({ type, ... }): NODE_ADD, NODE_REMOVE, NODE_MOVE,
NODE_PARAM_SET, EDGE_ADD, EDGE_REMOVE, EDGE_UPDATE, SELECTION_CHANGE, CLIP_ADD, CLIP_REMOVE,
CLIP_MOVE, CLIP_RESIZE, AUTOMATION_POINT_ADD, AUTOMATION_POINT_MOVE, TRACK_ADD, MARKER_ADD. No ad
hoc DOM mutation.

## 48. Undo / redo
Mandatory from the first integrated release, for node add/delete/move/param edit, connection
create/delete, clip add/delete/move/resize, automation edit, track edit.

## 49. Undo architecture
Immutable history or command objects with inverses, chosen by architecture and memory cost; never
DOM snapshots.

## 50. Undo coalescing
A 400-event drag is one history item ("Move Filter 1 from A to B"); slider drags coalesce.

## 51. Redo
A new edit after undo clears redo. Test.

## 52. History debugging
Debug mode may expose undo depth, redo depth, last action; not normal UI.

## 53. Graph editor renderer
HTML/CSS nodes + SVG cable layer unless evidence strongly favours otherwise (DOM semantics,
accessible controls, text, Inspector integration, path quality, large hit areas, clean
selection). No giant canvas editor without strong reason.

## 54. No React migration
Do not introduce React for React Flow; overwhelming evidence required.

## 55. Third-party node editor evaluation
Briefly compare custom vs lightweight libraries (size, licence, framework dependency, file://
bundling, touch, typed ports, OSCILLA styling, keyboard a11y, SVG control, undo integration,
timeline interop). Document; measure rather than assume.

## 56. Graph coordinates
Logical coordinates; viewport { panX, panY, zoom }; positions independent of screen pixels.

## 57. Graph pan
Pointer pan on blank canvas; middle mouse if appropriate; Space+drag if it does not conflict with
transport; touch one-finger pan when not dragging a node (or another proven model).

## 58. Graph zoom
Wheel/trackpad, buttons, keyboard if useful; centred on pointer; sane bounds (e.g. 0.25x-2.5x,
chosen by testing).

## 59. Frame all
Fit the graph bounding box.

## 60. Frame selection
Fit selected nodes; key F when the graph has focus and no text field is active.

## 61. Node drag
Pointer Events, pointer capture, efficient visual updates during drag, one model action at
gesture end, rAF coalescing.

## 62. Node drag performance
Update the node and its connected cables only; no full rerender.

## 63. Node library drag
Drag a type onto the graph (drop converted to logical coordinates); also click to insert at
viewport centre.

## 64. Quick add
N key or double-click blank canvas opens a searchable picker. Never hijack Tab.

## 65. Cable drag
From an output port with a preview path; compatible inputs emphasized, invalid de-emphasized;
valid drop → EDGE_ADD; invalid → cancel with a concise explanation.

## 66. Create-node-from-cable
Optional: drop on empty canvas → picker filtered by compatible inputs → create and connect. Only
after core cable interaction is stable.

## 67. SVG cables
Smooth cubic Bézier (M sx sy C sx+dx sy, tx−dx ty, tx ty), behaving well in both directions,
including targets left of the source.

## 68. Connection hit target
Visible ~2 px, transparent hit path ~10-16 px by pointer type.

## 69. Cable style
Derived from Signal Path: AUDIO solid, CONTROL dashed, TRIGGER short pulse pattern, ANALYSIS
distinct pattern, selected strong emphasis, active subtle highlight; never colour only.

## 70. Signal activity
Animation is visual state only unless real meter data exists; then distinguish ACTIVE from LEVEL;
never imply amplitude from decorative motion.

## 71. Reduced motion
prefers-reduced-motion disables moving pulses; selection and activity stay readable.

## 72. Connection selection
Click selects the edge; Inspector shows it; Delete removes it.

## 73. Connection inspector
Source node/port, target node/port, signal type, routing properties; control edges show depth,
polarity, mapping.

## 74. Node visual design
Editable descendants of Signal Path nodes using existing surface tokens, borders, typography,
technical labels, compact metrics, icons; not generic workflow rectangles.

## 75. Node compactness
Only identifying parameters on the card (e.g. FILTER 1 · Low Pass · 2.40 kHz · Q 0.707); detail
in the Inspector.

## 76. Inline node controls
Only high-value instant controls (bypass, mute, one primary knob); no full panels in nodes.

## 77. Node status
Active, bypassed, error, unconnected, selected. No decorative telemetry.

## 78. Inspector
Contextual: node → full parameters; connection → properties; clip → clip editor; automation →
lane/point; nothing → Studio/transport properties.

## 79. Inspector parameter schemas
Generated from registry metadata (key, label, type, range, step, unit, scale, enum options,
automatable, modulatable); custom editors allowed for complex nodes.

## 80. Parameter updates
Dispatch → model → runtime → all projections; no direct AudioParam mutation bypassing the model
unless explicitly ephemeral.

## 81. Studio timeline
The sequencer becomes a multi-track event/control timeline, not an audio-file editor.

## 82. Track types
Candidates EVENT, PATTERN, AUTOMATION, MODULATION, MEASUREMENT, MARKER/STRUCTURE only where
semantics differ.

## 83. Clip model
{ id, trackId, kind, start, duration, target, payload } (e.g. pattern clip clip-1 on
track-source, start 1.0, duration 2.0, target osc-1, payload sweep 440 → 880 log).

## 84. Clip types
pattern, event, automation, measurement; reuse sequencer block semantics; keep proven scheduling
code.

## 85. Sequencer migration
Map existing concepts to KEEP / REFACTOR / SUPERSEDE / MIGRATE; keep backward-compatible sequence
files where practical; no unnecessary scheduling rewrite.

## 86. Clip drag
Horizontal = time, vertical = compatible track, snap, commit at gesture end.

## 87. Clip resize
Edge handles; validate minimum duration, pattern constraints, measurement requirements.

## 88. Clip duplicate
Cmd/Ctrl+D (or modifier drag); new ID, same payload.

## 89. Timeline scale
View state (pixels per second, scroll); model times absolute.

## 90. Time modes
SECONDS first-class/default; optional MUSICAL; musical time never infects measurement
experiments.

## 91. Tempo
Applies to tempo-linked clips; absolute-second clips stay absolute; define conversion.

## 92. Snap
OFF, TIME GRID, MUSICAL GRID, maybe MARKERS; no single forced semantic.

## 93. Transport
Play, stop, return to start, loop; pause only if correctly implemented, never a fake pause.

## 94. Playhead
AudioContext time is authoritative; the playhead observes the scheduler; no rAF scheduling.

## 95. Loop region
Desirable: draggable loop bounds, audio-clock loop scheduling, boundary tests.

## 96. Timeline markers
Start, Sweep, Capture, Analysis, End; annotations/anchors, not fake clips.

## 97. Automation
Target node, parameter, points { time, value, curve }.

## 98. Automation curves
STEP, LINEAR, EXPONENTIAL (exponential only where the domain allows; never to zero).

## 99. Automation compiler
To AudioParam scheduling (setValueAtTime, linearRampToValueAtTime,
exponentialRampToValueAtTime); audio clock authority.

## 100. Automation editor
Add, drag, delete points, choose curve; double-click/tap empty lane adds a point; non-pointer
alternatives.

## 101. Automation scale
Per parameter: frequency logarithmic, gain dB linear, pan −1..1, Q appropriate; no shared 0-1
chart unless clearly normalized.

## 102. Automation targeting
Inspector AUTOMATE on eligible parameters creates/reveals the lane.

## 103. Automation vs modulation
Automation = time-based authored base value; modulation = continuous control from another node;
actual = base automation + modulation within bounds.

## 104. Modulation depth
Belongs to the modulation connection; never simulate modulation by mutating automation.

## 105. Offline rendering
Compile graph/timeline into OfflineAudioContext where supported; keep WAV export for supported
nodes; live-only nodes (Microphone) produce an explicit limitation.

## 106. Measurement integration
Studio visually represents an experiment (LOG SWEEP → OUTPUT; LOG SWEEP reference → TRANSFER
ANALYZER ← observed CALIBRATION ← MICROPHONE) reflecting real software-side relationships.

## 107. Measurement node types
Evaluate Capture, Calibration, Transfer Analyzer, RTA, Measurement Result; adapt/orchestrate
MeasurementEngine, never duplicate it.

## 108. Measurement timeline
Clips orchestrate noise check, pre-roll, stimulus, capture, tail, analysis via the same
ExperimentEngine / MeasurementSession state machine.

## 109. Experiment provenance
Experiments can include or reference Studio schema version, StudioModel, patch ID, timeline,
automation, node graph, algorithm IDs.

## 110. Recipe vs Studio
Define the relationship (likely StudioModel part of / referenced by the Recipe); no competing
orchestration schemas.

## 111. Patches
Reusable serializable graph/subgraph + defaults (Basic Subtractive Synth, Sweep Analyzer, Stereo
Beat Patch, Measurement Chain).

## 112. Patch schema
Own version or an explicit StudioModel subset; no runtime state.

## 113. Save patch
Save locally (current persistence layer); Export Patch as JSON if useful.

## 114. Load patch
Validate, then replace or insert, with explicit user intent.

## 115. Patch import safety
Limits on node/edge counts, parameter size, string lengths, automation points; reject malformed;
no eval.

## 116. Graph grouping
Architect for subgraphs/groups with exposed ports; optional for 3.1 and must not derail it.

## 117. Collapsed group
Future/optional ([SYNTH VOICE] = Oscillator → Envelope → Filter; double-click enters).

## 118. Multi-selection
Cmd/Ctrl-click and rectangle selection; selected nodes move, delete, duplicate, copy.

## 119. Rectangle selection
Blank-canvas drag in logical coordinates selects intersecting nodes.

## 120. Selection rules
Blank click clears (unless modifiers); Inspector follows the primary selection.

## 121. Copy / paste
Internal clipboard: selected nodes plus edges with both endpoints selected; paste with new IDs,
small offset, internal connections preserved; no clipboard permission needed.

## 122. System clipboard
Optional JSON to the system clipboard only if the app already has safe clipboard interaction.

## 123. Duplicate
Cmd/Ctrl+D duplicates the selected subset with new IDs and relative geometry.

## 124. Delete
Removes connected edges, updates runtime, history stores the inverse, Inspector resets.

## 125. Keyboard shortcuts
When Studio has focus and no form control is being edited: Delete/Backspace delete; Cmd/Ctrl+C,
V, D; Cmd/Ctrl+Z undo; Cmd/Ctrl+Shift+Z redo; Space play/stop; Escape cancel gesture / clear
transient connection / stop when appropriate; F frame selection; A frame all; arrows move by grid,
Shift+arrow larger step. Do not intercept browser shortcuts gratuitously.

## 126. Command palette
Optional later; must not delay core editing.

## 127. Compact Studio widget
In the normal cockpit; not a shrunken Full Studio. Summarizes transport, current time, clips,
signal path, status (conceptual: ▶ ■ LOOP 00:04.210; [Tone][Sweep][Pulse]; OSC → ENV → FILTER →
OUT with LFO ↑ into ENV/FILTER; ↗ expand).

## 128. Compact signal path
Reuses Studio graph data with simplified layout; never separately authored topology; selecting a
node opens a quick Inspector or selects it in the shared state.

## 129. Compact timeline
Important clips and playhead; basic select, move where practical, transport.

## 130. Expand
EXPAND STUDIO opens the large workspace inside OSCILLA; identical state.

## 131. Full Studio workspace
Desktop: transport/toolbar on top; node library | graph | inspector; timeline/automation below.
Proportions refined visually.

## 132. Studio toolbar
Back, Play, Stop, Loop, current time, Undo, Redo, Add Node, Frame All, Grid/Snap, Save Patch,
Export, Maximize/Fullscreen where useful; no clutter.

## 133. Maximized Studio
EXPAND = Studio occupies the main workspace; works without the Fullscreen API.

## 134. Browser fullscreen
Optional separate FULLSCREEN command, feature-detected; Studio never depends on it.

## 135. Fullscreen cleanup
Design Escape priority between browser fullscreen, active drag and Studio STOP; test real browser
behaviour.

## 136. Mobile Studio
Not the desktop squeezed to 390 px: GRAPH, TIMELINE, INSPECTOR subviews, one dominant at a time.

## 137. Mobile graph
Tap selection, pan, zoom, pinch where practical, tap-port connection; no precision cable drag on
phones.

## 138. Tap connection mode
Tap output → "Connecting from OSC 1 / Audio" → compatible targets highlight → tap input → edge
created; cancel available. Also the keyboard/non-drag path.

## 139. Accessible connection dialog
Non-visual flow listing compatible targets ([Filter 1 / Audio Input] [Analyzer / Input] [Master /
Input]); select; confirm. Important for keyboard and screen-reader users.

## 140. Accessible node movement
Arrow keys; optional Position X/Y in the Inspector; drag never mandatory.

## 141. Accessible clip movement
Clip Inspector start time, duration, track: every drag has a semantic input fallback.

## 142. Focus management
Nodes focusable; the connection editor returns focus sensibly; deleting moves focus to the nearest
remaining node or the canvas; never to body.

## 143. ARIA
E.g. "Oscillator 1, source node, selected"; "Audio output port, connected to Filter 1"; "Filter
cutoff control input, available"; "Connection from Oscillator 1 audio to Filter 1 input". No
per-frame drag announcements.

## 144. Live regions
Announce semantic actions (Connected Oscillator 1 to Filter 1; Connection rejected: incompatible
port type; Deleted Filter 1; Undo: deleted Filter 1); never pointer coordinates.

## 145. Graph performance target
Responsive at ~100 nodes, 200 edges, hundreds of clips (an engineering target, not a promise of
infinite graphs).

## 146. Drag performance
Avoid global reactive rerender during drag; targeted DOM transforms; commit the canonical position
after the gesture.

## 147. Cable update performance
Recompute only cables attached to moving nodes.

## 148. ResizeObserver
Update port positions on node size, Inspector content or responsive changes; no polling.

## 149. Port geometry
Endpoints from actual port element geometry transformed to graph coordinates; no hard-coded
offsets.

## 150. Auto layout
Optional, deterministic or justified; never auto-move a user graph without explicit action.

## 151. Grid
Optional visual grid and snapping; the model stores coordinates, not grid indices.

## 152. Node z-order
Selected/dragged node on top; cables under nodes; menus/dialogs above the workspace.

## 153. Minimap
Optional, only after pan, zoom, frame all and frame selection are excellent.

## 154. Saving Studio state
Local projects/patches in the existing persistence abstraction (IndexedDB); no second DB layer.

## 155. Autosave
If added: debounced, local, versioned, recoverable; never silently overwrite explicit patches.

## 156. Unsaved state
Know and subtly show whether the model differs from the last explicit save; no cloud-sync
language.

## 157. Crash recovery
Optional last working draft; must not block 3.1.

## 158. Import / export
Studio JSON export/import (e.g. .oscilla-studio.json); transparent schema.

## 159. Import validation
Untrusted: limit nodes, edges, tracks, clips, automation points, string lengths, nesting depth;
reject invalid graphs before compile.

## 160. Migrations
parse → validate → normalize → migrate, ready for v1 → v2; no version checks scattered in the UI.

## 161. Serialization determinism
Normalized state serializes deterministically for diffing, hashing, testing, provenance.

## 162. Studio hash
Optional SHA-256 of the normalized definition (studioHash); exclude ephemeral viewport unless
intended.

## 163. Reproducibility
Separate EXECUTION STATE (graph, timeline, automation) from EDITOR VIEW STATE (pan, zoom,
selection).

## 164. Signal Path view
Existing Signal Path renders from StudioGraph where possible; no unrelated topology generator.

## 165. Signal Path auto view
Playground keeps a read-only simplified projection; Studio makes the same semantics editable.

## 166. Visual design contract
Studio belongs to OSCILLA (dark technical cockpit, Signal Path, existing tokens); interaction
patterns may be learned from Node-RED, React Flow, Max/MSP, Ableton, Bitwig, never their
appearance.

## 167. Node colours
Restrained semantic accents; no candy; selection accent clearly distinct.

## 168. Cable crossing
Smooth paths, clear selection, possibly subtle crossing differentiation; no complex routing
before necessary.

## 169. Cable labels
Usually omitted; type/target info on hover, selection, Inspector unless an edge property needs an
inline label.

## 170. Node errors
Invalid parameter or runtime failure shows an error state explained in the Inspector; the compiler
never throws the app into a broken state.

## 171. Degraded nodes
Missing browser capability → unavailable/degraded node explained (e.g. Microphone unavailable
under file://); the model is not corrupted.

## 172. Node identity
Stable unique IDs (ULID/UUID or repo convention); "Filter 1" is display metadata.

## 173. Duplicate display names
Allowed with distinct IDs; numbered defaults preferred.

## 174. Node renaming
Friendly names ("Room Mic", "Main Sweep", "HF Filter") without changing type identity.

## 175. Offline nodes
Registry capability metadata: supportsRealtime, supportsOffline, requiresInputPermission; used by
UI and compiler.

## 176. Node capabilities
Realtime, offline, measurement, serializable, automatable and modulatable parameters.

## 177. Studio debug mode
Model node/edge counts, runtime node count, compiled graph revision, history depth, transport
clock, scheduler queue, active clips, validation findings; hidden from ordinary users.

## 178. Graph revision
Optional monotonic in-memory revision so the runtime knows which topology it reflects; not
persisted as a product version.

## 179. Studio / audio error recovery
On compile failure keep the previous valid runtime topology and show the error; prefer rejecting
changes that violate graph rules over carrying an invalid draft.

## 180. Playback model
Transport compiles the timeline into scheduled events via the current sequencer compiler; no
per-clip setTimeout.

## 181. Scheduler
AudioContext.currentTime is master; playhead derived; keep the existing look-ahead behaviour.

## 182. Edit during playback
Define semantics: simple parameter change live; future clip rescheduled safely; already-playing
clip decided explicitly (now vs next trigger) and recorded.

## 183. Timeline editing during playback
E.g. the current event stays until a compatible live edit; the future schedule is rebuilt from a
safe horizon; existing scheduler; tested.

## 184. Sequence stop
Releases scheduled/current sources, cancels future scheduling, leaves the model intact, playhead
per transport semantics.

## 185. Escape
Priority: 1 cancel drag/cable gesture; 2 close transient popup; 3 cancel selection mode; 4 if
nothing transient and audio active, stop per OSCILLA convention. Predictable.

## 186. Playback safety
Output ceiling and conservative gain preserved; Master Output maps into the existing safe output
chain; no bypass.

## 187. Multiple outputs
Prefer one canonical Master Output in 3.1; otherwise define summing/safety semantics.

## 188. Mixer
Intentional summing with gain accounting; accidental summing never bypasses output safety.

## 189. Fan-out
One source may feed a destination and an analyzer; the compiler supports explicit branching.

## 190. Analysis connection
Analysis taps are side-chains that do not alter the audio path; documented.

## 191. Measurement reference signal
Transfer Analyzer receives reference digital signal and observed capture signal through
semantically separate ports.

## 192. Port roles
Metadata beyond type (ANALYSIS + REFERENCE / OBSERVED) used in compatibility checks; avoid type
proliferation.

## 193. Node library documentation
Concise help per node type (what, inputs, outputs, constraints) through the Learn/help
architecture.

## 194. Learn + Studio
Educational examples (envelope before/after filter, how modulation works, side-chain analyzer,
transfer measurement routing); no textbook walls.

## 195. Templates
Basic Tone, Subtractive Synth, Sweep Sequence, Stereo Beat, Filter Automation, Measurement Sweep
(also test fixtures).

## 196. Template provenance
Canonical, versioned, validated product data, not buried in UI handlers.

## 197. Autosize compact graph
Compact view may auto-layout; Full Studio respects authored positions (same topology, different
projection).

## 198. Studio navigation
Top level includes Studio alongside Playground, Measure, Experiments, Analyze, Synthesis, Learn;
review navigation first; avoid too many destinations.

## 199. Deep link
URL state can open Studio and optionally a patch/project ID; no huge state in URLs.

## 200. URL sharing
No giant graphs in query strings unless the URL mechanism has robust compression; prefer exported
files.

## 201. Screenshot / export
Graph screenshot if the existing infrastructure supports it; not release-critical.

## 202. Graph printability
Optional later.

## 203. Studio visual regression
Deterministic references: compact widget, full desktop, mobile graph, mobile timeline, from
seeded model state.

## 204. Full Studio reference
Fixture with Oscillator, Envelope, Filter, LFO, Analyzer, Output, connections, several clips, an
automation lane, Inspector open.

## 205. Visual gate
Studio references in the release gate with robust region thresholds.

## 206. Interaction browser tests
Playwright: library drag; node drag; connect output to input; reject wrong port; select cable;
delete cable; multi-select; rectangle select if implemented; copy/paste; duplicate; undo/redo;
pan; zoom; frame all; move clip; resize clip; add automation point; drag automation point;
compact/full sync; keyboard-only connection; mobile tap-to-connect.

## 207. Graph model unit tests
Node add/remove, edge add/remove, deletion cascade, ID uniqueness, port lookup, compatibility,
cycle detection, serialization, migration, copy/paste mapping, normalization.

## 208. History tests
Add node, add node, connect, move, change parameter, add clip; undo all → exact initial semantic
state; redo all → exact final state.

## 209. Audio graph test
Compile OSC → GAIN → FILTER → MASTER in a real browser; verify signal; remove the filter; verify
output change, released runtime nodes, node count back, no console failure.

## 210. Modulation test
LFO → cutoff affects the real filter parameter; depth semantics work.

## 211. Automation test
0.0 s 500 Hz, 1.0 s 2 kHz, 2.0 s 8 kHz: verify the AudioParam schedule; linear, step, exponential
where legal.

## 212. Timeline test
Tone 0.0-1.0, Sweep 1.0-3.0, Silence 3.0-3.5, Pulse 3.5-4.5 scheduled on the AudioContext clock.

## 213. Leak test
20 graph edits during playback (add/remove/reconnect), stop: 0 leaked sources, 0 unintended
active nodes, no growth over repeated cycles.

## 214. Compact/full model test
Move a clip in Compact → Full reflects it; add a Filter in Full → Compact Signal Path reflects it;
assert the same model identity, not a synchronized copy.

## 215. file:// test
Full Studio in the self-contained dist/index.html via file://: graph, timeline, undo, patch
export/import, offline-capable features; microphone limits handled.

## 216. Bundle audit
Track Studio's size impact; report library contributions; do not blow the artifact budget.

## 217. Dependency audit
Any dependency documented: functionality, size, licence, framework impact, file:// and browser
compatibility. Prefer native DOM/SVG/Pointer Events.

## 218. No runtime network
Node definitions, icons, templates, patches, worker source all bundled.

## 219. Single-file workers
Inline bundled source if a worker is ever needed; no external worker file.

## 220. Licence
Update third-party notices if dependencies change; no silent copyleft/attribution additions.

## 221. Documentation
README: Studio, compact/full modes, signal graph, timeline, automation, patches, measurement
integration, keyboard shortcuts, architecture; no ADR duplication.

## 222. Studio architecture doc
One technical doc: StudioModel, graph, timeline, compiler, runtime, history, views, experiment
integration (how; ADRs say why).

## 223. User guide
Concise: create node, connect, sequence, automate, save patch, use the measurement template.

## 224. Keyboard shortcut documentation
Discoverable in-app reference kept in sync, ideally from one canonical table shared by UI, docs,
tests.

## 225. Majordomus knowledge after implementation
Run product/knowledge validation; Studio feature and use cases appear; ADR references, source and
test associations resolve; no orphan records.

## 226. Majordomus evidence
Each task carries real verification (compiler → unit + browser signal test; drag-and-drop →
Playwright + visual evidence; automation → AudioParam schedule test; compact/full → sync test;
measurement → experiment test). Not done because a file exists.

## 227. Majordomus deployment record
Through the current deployment schema: version, commit, environment, public URL, workflow,
artifact identity, verification result; no unsupported fields.

## 228. Release version
From actual release history; if 3.0.0 is released and Studio is a backward-compatible expansion,
likely 3.1.0; verify tags first.

## 229. Release notes
From actual work (graph, timeline, automation, patching, measurement routing, compact/full,
accessibility, Majordomus product graph); no claims for features that did not land.

## 230. Build provenance
Single-source product version shown everywhere; no Studio-specific product version; schema
version separate.

## 231. Public provenance
Verify public version, commit, Studio feature marker, artifact identity, Pages run.

## 232. Release gate
V1 freeze, V2 features, V3 measurement, Studio unit, graph audio, timeline, interaction browser,
accessibility, file://, Pages subpath, visual regression, version/provenance, Majordomus
integrity.

## 233. Fast verify
`npm run verify` stays fast; full Studio browser/visual suites belong to `npm run release-gate`.

## 234. CI parallelization
Split jobs (static/unit, audio, studio-browser, cross-browser, visual, Majordomus) only after
measuring; a final gate aggregates.

## 235. Cross-model architecture review
Before committing core architecture, independent critique (Codex, ChatGPT, Gemini where available)
of StudioModel, compiler, history, runtime mutation, typed ports, timeline and measurement
integration; resolve with evidence.

## 236. Cross-model UX review
Drag model, mobile graph, Inspector, compact/full relationship, automation UX; do not blindly
implement reviewer tastes.

## 237. Adversarial review questions
Where can UI and runtime topology diverge? Where can a mutation leak AudioNodes? Can undo return a
model the runtime does not match? Can an invalid imported graph reach Web Audio? Can the timeline
still use JS time? Can Compact and Full drift? Can modulation overwrite automation? Can a
measurement graph lie about signal direction? Can a cable look active with no signal? Can a user
make an unsafe feedback loop? Can a patch bypass master safety? Can serialization include runtime
objects? Can a migration silently alter meaning? Fix valid findings.

## 238. Security
Imported Studio JSON is untrusted: no eval, new Function, dynamic code or HTML injection; labels
rendered safely; bounds validated.

## 239. Privacy
No telemetry; Microphone node local; files stay local unless explicitly exported.

## 240. Audio safety
The master safety path is authoritative; no graph connects an oscillator to the destination
outside the AudioEngine master chain.

## 241. Feedback safety
Unsupported cycles rejected before runtime; the browser's feedback explosion is never the
validator.

## 242. Clipping
Summing may raise level; the limiter is a last resort; make excessive gain visible; never imply
the limiter makes unsafe behaviour harmless.

## 243. Light/dark
Preserve the theme architecture; Studio semantics work in supported themes without reduced
fidelity.

## 244. Responsive
Test 320, 375, 768, 1024, 1280, 1536: desktop graph + timeline + library + Inspector; tablet
adaptive panes; mobile GRAPH/TIMELINE/INSPECTOR switching; no horizontal page overflow.

## 245. Touch targets
Large invisible hit areas for ports and handles; no giant visible circles.

## 246. Pointer capture
setPointerCapture for drags; handle pointercancel and lostpointercapture; clean transient state.

## 247. Window blur
Mid-drag blur cancels/commits safely; no stuck cable preview.

## 248. Reduced motion
Honour for signal flow, playhead embellishments, selection animation; core behaviour intact.

## 249. Screen-reader summary
E.g. "6 nodes, 5 connections. Signal path: Oscillator 1 to Envelope 1 to Filter 1 to Master.
Modulation: LFO 1 controls Filter 1 cutoff. Analysis: Spectrum 1 observes Filter 1 output." No
exhaustive internals.

## 250. Large graph
Summary, search and frame selection matter more than animation.

## 251. Studio search
Find nodes by name/type; selecting a result frames it.

## 252. Selection in URL state
Selection never enters experiment provenance; it is view state.

## 253. Graph view state
Pan/zoom may persist locally; not graph semantics.

## 254. Dirty state
View changes do not mark semantic content dirty; separate semantic and view state.

## 255. Model hash
Exclude selection, pan, zoom, hover; include graph, routing, timeline, automation, parameters.

## 256. Templates as test fixtures
Use shipped templates in browser tests so they do not rot.

## 257. Basic synth template
OSC → ADSR → FILTER → MASTER; LFO → FILTER cutoff; timeline Tone, Sweep; automation of cutoff.
Serves as the full Studio reference fixture.

## 258. Measurement template
Sweep → Master Output; Sweep reference → Transfer Analyzer; Microphone → Calibration → Transfer
Analyzer. Used for the Studio + Measurement integration test.

## 259. Studio reporting
Final report: schema version, node types, port types, timeline and automation capabilities, patch
support, measurement integration, test counts, artifact size delta, Majordomus artifacts, ADRs,
use cases, features, public version, commit, deployment run.

## 260. No false completion
Not complete because nodes drag or cables draw; complete only if the graph is canonical, runtime
compiled from it, history, timeline, automation, serialization, measurement integration and
compact/full sync work, tests exist, Majordomus knows it, release deployed.

## 261. V3.1 definition of done
All of: baseline audited; Majordomus context/doctor clean; V3.1 plan recorded; Studio Features;
Studio Use Cases; ADR gap audit; required ADRs proposed; Rules updated where needed; Knowledge
discovers Studio objects; StudioModel; Studio schema version; no AudioNodes in the model; node
registry; typed ports; compatibility validation; graph validation; cycle detection; compiler;
compiler reuses AudioEngine; runtime node mapping; incremental mutations; click-free route changes
where applicable; editor renders the real model; node library; node drag; cable drag; invalid
connection rejected; cable selection; connection Inspector; pan; zoom; frame all; frame selection;
multi-selection; rectangle selection if chosen; copy/paste; duplicate; deletion cleans
edges/runtime; undo; redo; drag coalescing; Inspector; sequencer migrated cleanly; multi-track
timeline; clip drag; clip resize; timeline zoom; snapping; playhead follows audio clock; transport;
automation model; automation editor; AudioParam automation compilation; modulation distinct from
automation; compact widget; Full Studio; compact/full share ONE state; mobile Studio; keyboard
Studio; non-drag connection flow; patch save/load; import validation; Studio in experiment
provenance; measurement template; output safety cannot be bypassed; feedback cycles rejected;
STOP cleans runtime; no graph-edit leaks; file://; Pages subpath; V1, V2, V3 measurement tests
green; Studio unit, browser, audio, visual green; accessibility green; version/provenance green;
final Majordomus validation green; release prepared; tagged where policy requires; Pages
deployment succeeds; public version and commit verified; public Studio smoke passes; deployment
evidence recorded.

## 262. Implementation phases
A current-state audit; B Majordomus V3.1 model (milestones, issues, Features, ADRs, Rules, Use
Cases); C StudioModel, schema, registry, ports, edges, validation; D history/actions, undo/redo,
serialization; E compiler, incremental runtime updates, AudioEngine integration; F graph editor
(nodes, SVG cables, pan/zoom, drag/connect, selection); G Inspector, parameter and connection
editing; H timeline migration, multi-track editor, clips, transport; I automation; J compact
widget; K Full Studio; L measurement/experiment integration; M patches, persistence,
import/export; N mobile, accessibility, keyboard; O performance, audio lifecycle, cross-browser;
P visual refinement; Q Majordomus knowledge/evidence audit; R release candidate; S public
deployment; T post-deploy verification.

## 263. Phase protocol
Per phase: load Majordomus context; inspect code; inspect ADRs/rules; update issue state; smallest
coherent slice; unit test; browser/audio test; Majordomus checks; independent review where useful;
fix; record evidence; checkpoint; commit through the repository workflow; continue without routine
approval.

## 264. Brief status output
After each phase only: PHASE, DONE, TESTS, MAJORDOMUS, REVIEW, NEXT. Then continue.

## 265. Majordomus final audit
Current equivalents of doctor, check, finish --check, product validate, product list, usecase
coverage, usecase validation, adr check, knowledge, plan status, release, deployment. Resolve
blockers.

## 266. Repository self-knowledge test
A fresh agent can discover from the repository: Studio exists; canonical state is StudioModel;
compact and full share it; typed ports; compiled into AudioEngine; audio-clock timeline;
automation; measurement integration; topology recorded in experiments; feedback restrictions;
schema version; which tests prove each capability; which public release contains it. If this
needs the prompt or chat history, the Majordomus integration is incomplete.

## 267. Release
Full release gate; SemVer from actual history (V3.0.x + Studio → likely 3.1.0, verify); single-
source version workflow; never hard-coded.

## 268. Public deployment
Only the verified artifact through the existing Pages workflow; no parallel manual path.

## 269. Post-deploy verification
HTTP success, version, commit, Studio navigation visible, compact Studio loads, Full Studio opens,
a template loads, graph and timeline render, basic interaction works, no boot console error,
artifact identity matches; bounded retry; mismatch after retries is a failure.

## 270. Public Studio smoke
Open the public app, open Studio, load Basic Synth, verify Oscillator, Envelope, Filter, Master and
connections, play, stop, no error, open the Measure template, verify measurement nodes render. No
physical microphone needed.

## 271. Deployment evidence
Version, commit, public URL, Pages run, artifact identity, Studio smoke result, date, through the
current evidence/deployment model.

## 272. Final cross-model review
Adversarial review of architecture, compiler, runtime lifecycle, timeline, automation,
accessibility, Majordomus completeness, release integrity: "Find a way this architecture can lie,
leak, drift or become impossible to maintain." Fix valid findings.

## 273. Final engineering principle
Not pretty draggable boxes: the boxes represent a real typed model, the model compiles into real
sound and measurement behaviour, time is scheduled correctly, changes are reversible, state is
reproducible, and the repository knows why.

## 274. Final product principle
A user authors Oscillator → Envelope → Filter → Output, adds LFO → Filter cutoff and automation
500 Hz → 8 kHz, and OSCILLA plays exactly that graph, shows it, saves it, restores it, undoes
changes to it, exports its sequence where supported, and records it as provenance when used in an
experiment. That is OSCILLA Studio.

## 275. Begin
Inspect HEAD, deployment, release version/tags, Majordomus version and docs, run context/doctor,
inspect Studio/sequencer/Signal Path code, audio compiler/lifecycle, V3 experiment/measurement
architecture, Features/Use Cases/ADRs/Rules/Knowledge; create the V3.1 milestone and task graph;
ADR gap analysis; minimum canonical Studio Features/Use Cases/Rules before implementation;
implement StudioModel; proceed phase by phase keeping Majordomus current; finish only when the
verified V3.1 public release is live. Do not return with only a plan; do not stop when nodes can
be dragged, when local tests pass, before Majordomus knows what was built, or before the public
Pages deployment is verified.

# VISUAL IDENTITY LOCK (binds every V3.x surface)

OSCILLA already has a recognizable visual identity. Treat the existing production V2/V3 interface
as the canonical design language. DO NOT redesign OSCILLA for Studio. DO NOT import the visual
identity of Arturia, Ableton, Bitwig, Native Instruments, Max/MSP, Reaktor, Node-RED, React Flow or
DAW software in general; study them for interaction patterns only. OSCILLA Studio must look like
OSCILLA.

The design language is fixed: dark technical cockpit; navy / blue-gray surfaces; thin structural
borders; compact radii; dense information layout; restrained spacing; technical typography;
tabular numeric readouts; cyan/blue interaction accent; semantic secondary accents; precise
grids; minimal decorative effects; no glassmorphism; no marketing gradients; no oversized pills;
no soft consumer-app styling; no skeuomorphic analog-synth treatment.

New Studio components must be built from or visually inherit the current OSCILLA design tokens,
panel primitives, controls, typography, chart styling and Signal Path visual language. Signal Path
is the direct visual ancestor of Studio Graph: a Studio node looks like an editable OSCILLA Signal
Path node, not a generic modular-synth block; a cable looks like an interactive extension of
OSCILLA's signal-flow visualization. Measurement nodes, audio nodes, control nodes and analyzers
remain visually part of the same product.

Before introducing ANY new token, component shape, colour family or interaction surface, determine
whether an existing OSCILLA primitive can be extended. Prefer extension over invention.

Visual acceptance question: "If the OSCILLA logo were hidden, would this still obviously belong to
the same application as the existing Playground, Analyzer and Signal Path?" If not, the design is
wrong.

Maintain this identity across compact Studio, full Studio, mobile Studio, Measure, Analyzer,
Experiments, Learn, dialogs, inspectors, timelines, nodes, cables, automation lanes and charts. Do
not fork the product visually by mode.
