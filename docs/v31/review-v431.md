# V431: independent architecture, UX and adversarial review of the V3.1 Studio (spec §235-§237, §272)

Three independent Claude reviewers, none of whom wrote the code, each reviewed the Studio at
main 10fafa1 through one lens. They did not see each other's work. The spec asks for
cross-model critique (Codex, ChatGPT, Gemini "where available"). The owner ruled out other
providers, so independence here comes from three separate contexts, three lenses and the
evidence rule below, not from different models. The method follows the V382 DSP review
(`docs/v3/dsp-review-v382.md`).

**Evidence rule.** Every finding had to come with a failing check run against the real code: a
node script over `src/js/studio/**`, or a playwright script against the built
`dist/index.html` from file://. Where neither was possible, it needed the exact code
(file:line) and a concrete scenario. Unsupported opinions and reviewer taste were dropped
(§236). The coordinator re-ran every cited script before classifying it. Every fix below comes
with a test that fails on the code before the fix.

## Reviewers and lenses

| Lens | Scope | Questions it had to answer |
| --- | --- | --- |
| Architecture (A) | `src/js/studio/**`, `src/js/ui/studio/**`, ADR 0030-0038 | One canonical model and its projections; typed ports before Web Audio; the model/history/compiler/runtime/transport boundaries; no second engine; persistence, migration and provenance; invariants enforced only in the UI |
| UX and accessibility (U) | the Studio UI in chromium at 1536 px and 390x844 touch | Keyboard and non-drag paths, focus, announcements, mobile, compact vs full view, Inspector, automation, error and empty states, the visual identity lock |
| Adversarial (X) | the whole Studio, logic and runtime | Feedback cycles, hostile imports, AudioNode leaks after STOP and Escape, edits racing playback, undo/runtime drift, offline/live parity, file://, safety bypass |

The reviewers reported 34 raw findings: A 9, U 14, X 11. Five were duplicates and were merged
(A2 = X6, A3 = X5, A5 = X3, X8 into X2, X9 into A4). A4 held two separate faults (plain data,
event actions), so it is listed twice. That leaves **30 findings: 19 defects, 2 risks and
9 nits.** This change fixes 11 defects and 1 nit; the other 18 are open follow-ups, listed at
the end.
Later changes fixed all eight open defects, marked in place in the follow-up table: #13 (A1,
PR #76), #16 (X1, #77), #17 (X2/X8, #78), #14 (A5/X3), #18 (U2), #19 (U7) and #20 (U8)
(#80), and #15 (A6). A further change fixed the two risks and the eight nits, #21-#30.
**All 30 are fixed; none stays open.**

**Classes.**
- **Defect:** violates the spec, an ADR or a rule, or produces demonstrably wrong behaviour.
- **Risk:** a plausible failure with concrete evidence that has not been shown to go wrong.
- **Nit:** a small correctness or clarity issue.

## Findings fixed in this change

| # | Finding (evidence) | Class | Fix | Test (fails before the fix) |
| --- | --- | --- | --- | --- |
| 1 | **Undo, redo and a cancelled gesture rolled the view back** (A2, X6). Pan 500 / zoom 2 / timeline 400 px/s was set, then a move was undone, and the view returned to 0 / 1 / 100. ADR 0030 and 0031 say the view is persisted but not undoable. Cause: `actions.js` undo/redo restored the whole `e.before` / `e.after`, including `view`. | defect | `withCurrentView` in the store: undo, redo and cancel restore the document and keep the current view (`src/js/studio/actions.js`) | `tests/unit/v31-studio-review-v431.test.mjs` A2/X6 |
| 2 | **Non-plain data could enter the canonical model** (A4, X9). CLIP_ADD with `payload.cb = () => 42` was accepted. A PASTE whose JSON-parsed edge props carried `"__proto__"` became a prototype. Afterwards `serializeStudio`, `studioHash` and `studioProvenance` threw, so the model could not be saved and a measurement could not be recorded. Cause: `copyPlain` keeps functions and assigns `__proto__`, and `dispatch` never re-checked plain data. | defect | Every committed model passes `assertPlainData`; a violation is refused with its path (`actions.js`) | review test A4, X9 |
| 3 | **An event clip with any action was accepted by the store** (A4). `action: 'explode'` was accepted; only the editor's `validateClip` checked it. | defect | `validateStudioModel` checks `EVENT_ACTIONS`, now defined once in `schema.js` (`validate.js`, `timeline.js`) | review test A4 event |
| 4 | **A Studio measurement did not follow the clips the timeline shows** (A3, X5). An 8 s pre-roll or a 0.05 s tail ran as the engine defaults 0.5 s / 1.5 s, but the provenance recorded 8 s. A 2 s stimulus clip played the full 5 s sweep, while the editor warned "would be cut off". Cause: `provenance.js` `recipeFromStudio` fell back silently to `DEFAULT_TIMING`. | defect | `recipeFromStudio` refuses a timing clip outside `TIMING_LIMITS` and a stimulus clip shorter than its Sweep, giving the reason; defaults only for absent clips. The editor warning now says the run will refuse | review tests A3/X5, X5 |
| 5 | **Two setups with the same `studioHash` gave different recipes** (A7). With a second pre-roll clip, reversing the clip array kept the hash but changed `preRollS` from 0.5 to 2. Cause: the recipe took the first clip in array order, while the hash sorts by id. | defect | More than one noise-check, pre-roll, stimulus or tail clip refuses the recipe (one pass is one measurement, §108) | review test A7 |
| 6 | **The Studio master level stayed in the engine after STOP** (X4). With the Studio level at 0.25 and the Playground at 0.08, `engine.gainLevel` was still 0.25 after STOP and in MEASURE. MEASURE stimuli and Labs then played about 10 dB above the level the UI showed. Cause: the master adapter wrote `engine.setMasterGain` and nothing restored it. | defect | The runtime saves the engine level at start and restores it on STOP: immediately for readers of `gainLevel`, audibly only after the bus fade-out. A restart during the hold cancels the held glide (`runtime.js`, `adapters/engine-hooks.js`) | `tests/unit/v31-studio-compiler.test.mjs` "V431 X4" |
| 7 | **Keyboard focus could skip selection, so Delete removed a node other than the focused one** (U1). Steps: click the canvas, press on Filter 1's Gain input port, Tab to Oscillator 1, press Delete. Filter 1 was deleted ("Deleted Filter 1"). Cause: `graph-editor.js` set `pointerFocus` on every press but cleared it only in `focusin`; a press that moves no focus left it set. | defect | The flag lasts only until the end of the press's event-loop turn; the delete path clears it after focusing the neighbour (`graph-editor.js`) | `tests/browser/v31-studio-graph.cjs` `focus-never-body` (tabSelectsFocused, deleteRemovesFocused) |
| 8 | **Undo/redo that removed the focused node, clip or point left focus on `<body>`** (U3). In the graph: N, gain, Enter, then Cmd-Z gave BODY. In the timeline: Cmd-D on a clip, then Cmd-Z gave BODY; an automation point add then undo also gave BODY. | defect | Graph and toolbar: `studioKeepFocus` sends a lost focus to the pane it came from, else the canvas, else the subview tab (`workspace.js`). Timeline: the clip's track add button, the point's lane add button, or the marker tool (`timeline-editor.js`) | `focus-never-body` (undoKeepsFocus, clipUndoKeepsFocus) |
| 9 | **The toolbar Undo button disabled itself while focused** (U4). Enter on Undo with one entry left: disabled, focus BODY. | defect | Same fallback as #8 after the render | `focus-never-body` (disabledUndoKeepsFocus) |
| 10 | **Compact widget chips dropped focus** (U5). Enter on a node chip or Space on a clip chip gave BODY, because every render rebuilt the chips. | defect | The render puts focus on the rebuilt chip with the same id (`compact.js`) | `focus-never-body` (compactChipsKeepFocus) |
| 11 | **"Back to the Playground" dropped focus** (U6): BODY. | defect | Focus goes to the compact Expand button, else the Playground tab (`workspace.js`) | `focus-never-body` (backKeepsFocus) |
| 12 | **A cancelled gesture destroyed the redo stack** (X7). Sequence: undo, begin gesture, move, cancel; after that `canRedo()` was false. | nit | The first change in a gesture still clears redo (§51). Cancel, or a gesture with no net change, puts the cleared entries back (`history.js`) | review test X7 |

#6 is the only fix that changes audio behaviour. Its test checks two things: the immediate
`gainLevel`, and that the master glide is held until after the fade (no swell under the
Studio's fade-out). It also checks that a restart during the hold keeps the Studio level.

Docs that went stale with these fixes were updated in this change: `docs/v31/compiler.md`
(master level), `docs/v31/patches-and-provenance.md` (recipe refusals),
`docs/v31/studio-model.md` (history and plain data) and `docs/v31/timeline.md` (measurement
bounds).

## Open findings (follow-ups)

These needed a decision or a change too large for a review pass. Each entry has its evidence;
the scripts are the reviewers' own and are not committed. Every entry is now fixed, marked in
place with its test, which fails on the code before the fix.

| # | Finding (evidence) | Class | Suggested fix |
| --- | --- | --- | --- |
| 13 | **Studio provenance records nodes the measurement did not use** (A1). The test template had a 200 Hz low-pass between Sweep and Master, `cal-1.profileId` set and `pointsPerOctave: 6`. It produced the same recipe, and the provenance still listed all three. The run uses MEASURE's calibration (`ui/measure.js` `calibrationInput()`), and the engine plays its own stimulus, so the filter is bypassed (`provenance.js` `recipeFromStudio`). §237: "can a measurement graph lie". | defect, **fixed**: `recipeFromStudio` refuses all three with a reason (`tests/unit/v431-studio-recipe-unused.test.mjs`) | `recipeFromStudio` refuses a Sweep→Master path with other nodes in it, a Calibration profile other than the one MEASURE applies, and a non-default `pointsPerOctave`. Alternatively, pass them into the run. |
| 14 | **A cable with no Web Audio route looks routed** (A5, X3). Osc → Recorder and Microphone → Spectrum appear in `runtime.debugInfo().inactiveEdges`, yet are drawn `is-audio is-solid` at 2 px like a live cable. LFO → filter Q on a low-pass is inactive "not applied", while the Inspector offers depth and polarity and gives no reason. Cause: `graph-view.js` `edgeView` and the edge Inspector never read the runtime/plan edge status. `docs/v31/compiler.md` promises "inactive routes with a reason". | defect | **Fixed.** `graph-view.js` `edgeRoute` gives each cable `live`, `no-route` (the compiled plan edge is inactive; its reason) or `no-effect` (routed, inaudible: Filter Q on low-/high-pass, the adapter's own reason; Filter gain on any type but peaking). The workspace passes `compiledEdgeStatus(plan)` from the compile it already runs. Such cables are drawn `is-inactive` with a sparse dash and a midpoint cross (shape, not colour), are left out of the running emphasis, and carry the reason in their label, the connection Inspector (`studio.inspector.edgeStatus`), the node's Connections list and its "Modulated" note. Nothing is refused in validation (compiler.js and validate.js unchanged). Tests: `tests/unit/v31-studio-review-v431-ui.test.mjs` (no-route, Q, gain, each with parity against the runtime's inactive edges); `v31-studio-graph.cjs` `inactive-cables` |
| 15 | **A failed runtime prepare keeps the model change** (A6). ADR 0035 says the change is refused. An injected `createBiquadFilter` throw while playing: `dispatch ok`, store revision 2, runtime revision 1, `lastError: prepare`. The node card shows no degraded state, because node status comes from a fresh `compileStudio(model)` (`workspace.js`), not from `runtime.plan`. | defect | **Fixed: refused, as ADR 0035 says.** The store asks a commit gate before every dispatch, undo, redo and cancelled-gesture return (`actions.js` `gate`). While playing, the workspace's gate is `transport.admit`, which applies the model to the running graph before the store commits it. A failed prepare (or validate) refuses the edit: `{ ok: false, refused: true, phase: 'prepare' }`. Model, revision, undo stack and redo stack are unchanged, and the runtime stays on its last good revision and plan. The reason is announced (assertive) and shown in the Studio warning line. A refused undo or redo keeps its entry. While the runtime runs, node and edge status come from it (`graph-view.js` `runtimeStatus` via `workspace.js` `studioStatus`), so anything the running plan does not hold shows `degraded` / `inactive` with the reason. ADR 0035 has a dated resolution note. Tests: `tests/unit/v431-studio-refused-edit.test.mjs` (live edit refused: store and runtime revision, model identity, history, `lastError`; undo/redo refused; status from the runtime; the store gate) |
| 16 | **An automated frequency escapes the 0.95 x Nyquist cap** (X1). At 48 kHz with LFO → osc frequency (log, 2 octaves): with a static 20 kHz base the edge is limited (peak 22800 Hz). With a frequency lane held at 20 kHz it is not limited (peak 80000 Hz). Cause: `compiler.js` `computeBases` sizes headroom from the static param, not the lane. | defect, **fixed**: lanes claim their peak and the headroom uses max(base, peak) (`tests/unit/v31-studio-compiler.test.mjs` X1) | Pass each owned parameter's peak (lane max + base offset) to the runtime; `computeBases` uses max(base, peak) for frequency headroom. |
| 17 | **Removing a detune lane while playing leaves the oscillator an octave off** (X2, X8). A log frequency edge with offset 1 plus a detune lane: after the lane is removed during playback, detune is 0 cents. A fresh play of the same model gives 1200 cents. While a detune lane plays, the log offset is dropped, which is documented as a limitation in `docs/v31/timeline.md` but contradicts §103. Cause: `runtime.baseOffset(id, 'detune')` omits the log cents that `applyBase` writes to detune. | defect, **fixed**: `baseOffset` adds the constant cents of log edges on the same AudioParam (`tests/unit/v431-studio-detune-lane.test.mjs`) | Include `base.detune.cents + base.frequency.cents` in the detune offset, or re-apply the node's cached base when a lane is released. Either fixes both symptoms. |
| 18 | **Inspector actions drop focus to `<body>`** (U2). Keyboard Enter on a connection link, "Select source" or "Duplicate": BODY. Cause: the rebuilt Inspector restores focus only by `data-key` (`inspector.js`), and these controls have none. | defect | **Fixed.** Inspector actions carry a `data-key` (Duplicate lands on the copy's Duplicate); when the focused control is gone after a rebuild, focus goes to the new view's heading (`tabindex=-1`): "Connection" after a link, the source's name after Select source (`inspector.js`). Test: `v31-studio-graph.cjs` `inspector-focus` (linkKeepsFocus, selectSourceKeepsFocus, duplicateKeepsFocus) |
| 19 | **Below 768 px, Inspector Connect… and Delete send focus to the hidden graph** (U7). Focus lands on `main.osc-main` or BODY, because `graph-picker.js` and the delete path call `focusNode` on a `display:none` subview. | defect | **Fixed.** `focusNode` / `focusViewport` refuse while the graph is hidden and Delete leaves focus where it is (`graph-editor.js`); the Connect dialog then falls back to the Inspector's Connect…, else its heading (`graph-picker.js`, `workspace.js`). Delete lands on the Inspector heading. Test: `v31-studio-graph.cjs` `inspector-phone-focus` (connectKeepsFocus, cancelKeepsFocus, deleteKeepsFocus) |
| 20 | **On a phone, "Automated · show lane" announces "lane shown" but shows nothing** (U8). At 390 px the subview stays Inspector and the lane is not visible (`inspector.js`). | defect | **Fixed.** When the timeline is not on screen, "show lane" opens the Timeline subview, scrolls the lane into view, focuses its add-point button and announces "… automation lane shown in the Timeline view". On a wide layout it scrolls the lane into view and focus stays (`workspace.js` `studioShowLane`, `timeline-editor.js` `revealLane`). Test: `v31-studio-graph.cjs` `inspector-phone-focus` (laneSubview, laneShown, laneFocused, laneAnnounced) |
| 21 | **Port targets are about 13 px at the phone frame-all zoom** (U9). Effective scale 0.37 on the Subtractive Synth at 390x844; a tap 8 px off the Q glyph hits frequency or gain. Connect… is the equivalent control (WCAG 2.5.8 exception). | risk | **Fixed: a minimum fit zoom on coarse pointers.** Dividing the hit size by zoom cannot help: at 0.37 adjacent port rows are 9.6 px apart, so any hit area overlaps its neighbour. On a coarse pointer Frame all and Frame selection stop at `COARSE_FIT_MIN_ZOOM` = 24/26 (`graph-geometry.js` `fitView` `minZoom`, `graph-editor.js`), where a 26-unit port row is 24 px on screen; a larger graph is centred and the rest is a pan away. Fine pointers frame as before (the visual references are unchanged). Tests: `tests/unit/v431-studio-open-findings.test.mjs` #21; `v31-studio-graph.cjs` `phone-port-targets` (portTargets: every port ≥ 24 px at 390x844 touch, 9.6 px before) |
| 22 | **The Studio measurement start depends on a JS timer** (R1). `measurement-run.js` arms the hand-off with `setTimeout(lead)`, and the engine schedules relative to when the timer fires. Background throttling moves the start off the clip's audio-clock time. | risk | **Fixed.** The hand-off passes the clip's `startTime` as `startAt` (`measurement-run.js` → `workspace.js` → `measure.js measureRunRecipe` → `engine.measure(recipe, { startAt })`), and the engine schedules its first capture there on the audio clock: `notBefore` of the noise check (`capture.js captureNoise` gained it) or of the first run. The hand-off is armed `HANDOFF_LEAD_S` (0.25 s) before the clip, so preflight and the 0.1 s capture lead fit before the anchor; the timer now only decides when preflight starts, and a late timer can delay a start only past its anchor. Studio sound in the last 0.25 s before the first measurement clip is cut by the hand-off. Tests: `tests/unit/v31-studio-gaps.test.mjs` "V431 R1" (startAt passed; first capture at the anchor with and without a noise check) and the updated V424 hand-off timing |
| 23 | Signal Path projection ignores an edge's `muted` and `polarity` (A8): "±100 Hz" for a unipolar edge whose compiled excursion is [0, 100]. Latent today: only the playground voice uses it, with bipolar unmuted edges. | nit | **Fixed.** `depthText` reads "+100 Hz" for a unipolar edge ("−50 Hz" for a negative depth) and "± …" for a bipolar one; a muted modulation (FM/LFO or AM) stage is drawn bypassed (`enabled: false`) with "· muted", and an unmuted edge is preferred when there are several (`signal-path-projection.js`). The playground voice's stages are unchanged (`v31-studio-signal-path.test.mjs` parity passes). Test: `tests/unit/v431-studio-open-findings.test.mjs` #23 |
| 24 | Rules exist in two copies (A9): the NODE_REMOVE cascade (`actions.js`, `patches.js`), the import front end (`migrate.js`, `validate.js`), clip validation (`validate.js`, `timeline.js`). The copies agree today. The clip split was the root of #4: the store still accepts out-of-range measurement clips, and only the recipe refuses them. | nit | **Fixed: one implementation each.** `schema.js withoutNodes` is the cascade of NODE_REMOVE and `replaceWithPatch`; `validate.js readStudioInput` (size cap, parse, safety scan, depth, kind) is the front end of `validateStudioImport` and `importStudio`, which now checks depth before migration too; `timeline.js clipRules` is the clip rule table of `validateStudioModel` and `validateClip`. The store now refuses an out-of-range measurement clip, a measurement clip on the wrong target type and a non-logarithmic stimulus sweep with the editor's sentence; `stimulus-truncated` stays a warning, and `recipeFromStudio` keeps its refusals for models built outside the store (the A3/X5 test now builds its model with `normalizeStudio`). Every template and test fixture still validates. Tests: `tests/unit/v431-studio-open-findings.test.mjs` #24 (store refusals with the editor's sentence; identical store and editor errors for six bad clips; cascade and front end shared, no second copy in the sources) |
| 25 | `createStoreHandle(...).replace(partialModel)` throws `TypeError: r is not iterable` instead of a schema error (X10), because the id generator reads the raw model before normalization. Programmatic API only. | nit | **Fixed.** The handle's id generator is seeded lazily from the new store's own normalized model (`workspace.js createStoreHandle`), so a partial model is normalized like any other, and an invalid one throws `StudioSchemaError` from `createStudioStore`. Test: `tests/unit/v431-studio-open-findings.test.mjs` #25 |
| 26 | Empty graph: the canvas has no guidance (U10). `.is-empty` is set but unstyled; the hint lives in the Inspector, which is hidden on phones. | nit | **Fixed.** The canvas holds a hint ("Empty graph. Press N or use Add node, or open a setup from Templates.", `data-osc="studio.graph.empty"`), shown only on `.osc-sg.is-empty`, centred and inert, in the graph banner's language: tokens only (surface, border, cyan rule, `--osc-fs-sm`), dark and light. It shows on phones too, inside the Graph subview (`graph-editor.js`, `studio.css`). No visual reference shows an empty graph, so the references are unchanged. Tests: `v31-studio-graph.cjs` `review-open-ui` (emptyHint) and `phone-port-targets` (emptyHint) |
| 27 | Play toggles both its label and `aria-pressed` (U11), so a screen reader reads "Stop the Studio, pressed". | nit | **Fixed: `aria-pressed` stays, the name is fixed.** The toolbar Play and the compact widget's Play are always "Play the Studio"; only `aria-pressed` says it plays, as the timeline strip's Play already did (`index.html`, `compact.js`). Tests: `v31-studio-graph.cjs` `review-open-ui` (playName, both buttons idle and playing); `tests/unit/v431-studio-open-findings.test.mjs` #28 (markup) |
| 28 | The subview tabs control sections without `role="tabpanel"` (U12). | nit | **Fixed.** The Graph, Timeline and Inspector sections are `role="tabpanel"` (named by their headings) and each tab has an id beside its `aria-controls` (`index.html`). Above 768 px the tablist is `display: none`, so only the regions remain in use there. Tests: `tests/unit/v431-studio-open-findings.test.mjs` #28; `v31-studio-graph.cjs` `review-open-ui` (tabPanels) |
| 29 | A clip selection is announced as "1 clip selected", without its name (U13; `a11y.js` names single nodes only). | nit | **Fixed.** `announceSelection` names a single clip with its label and track ("Sweep clip on Source selected"); `clipLabel` moved to `a11y.js` and `compact.js` re-exports it. Test: `tests/unit/v431-studio-open-findings.test.mjs` #29 |
| 30 | Port descriptions (§143) are `aria-hidden` and only in `title` (U14). The Inspector Connections list and the Connect dialog are the non-visual path. | nit | **Fixed: both.** A node card's accessible label adds its counts ("…, 2 input connections, 2 output connections"; a direction the node has no ports for is left out: `a11y.js describeNode` `connections`, used by `graph-view.js nodeCard`), and the user guide names the Inspector Connections list and the Connect dialog as the per-port path. Tests: `tests/unit/v431-studio-open-findings.test.mjs` #30; `v31-studio-ui-graph-view.test.mjs` (the node card label) |

## Verified, not changed (with evidence)

- **Feedback and cycles.** An audio cycle through a Mixer is rejected `audio-feedback`. A self-loop is rejected `self-connection`, and a second edge into a gain input `multiple-connections`. LFO↔LFO is rejected `control-cycle`; LFO → LFO.rate is accepted. Every non-move action is re-validated before commit (`actions.js` dispatch), so paste, patch insert, templates and undo only ever reach validated snapshots.
- **Hostile imports.**
  - `__proto__`/`constructor` keys, 1e308, string params, master level 0.26 and duplicate ids are all refused, including node/edge id clashes.
  - Also refused: unknown types, schema `'1'` and 2, depth over 32, more than 512 nodes, names over 64 characters, control characters, positions out of range, master automation, an out-of-range gain lane, and Microphone → Master (`live-input-to-output`).
  - URL state carries only a template id and a subview, never a graph.
- **Master safety.**
  - Nothing in `src/js/studio` or `src/js/ui/studio` connects to `ctx.destination`; the only exit is the Master bus into `engine.master` (unit test walks every connection).
  - The master level is neither modulatable nor automatable.
  - REFERENCE↔OBSERVED connections are refused.
- **Leaks and races.**
  - 10 edit/undo/redo bursts while playing, a template switch while playing, and 13 play/stop cycles (including stop during start) all end at 0 engine and runtime nodes and 0 sources.
  - Fuzzing in chromium: 40 random bursts, 126 accepted and 98 rejected actions, 64 undo/redo while playing. Runtime handles and edges always equalled the model, revisions matched, and nothing was left after stop.
  - A separate run of 10 edit/undo/redo steps also kept nodes, edges, handles and revision in line.
- **Clock.**
  - No `Date.now`, `performance.now`, rAF or `setInterval` schedules audio in `src/js/studio`; the transport's only timer is its wake-up.
  - Events are scheduled on context time.
  - The exception was #22; since its fix the hand-off timer only starts preflight, and the
    measurement's first capture is anchored on the clip's audio-clock time.
- **file://.**
  - Zero network requests across all runs.
  - No `fetch`, dynamic `import()` or Worker URL other than the analysis worker's data: URL.
- **One engine, one store.**
  - The offline render reuses the same runtime and transport on an engine shim; its missing limiter is documented, and its stats report clipping.
  - The compact and full views wrap one store.
  - Every import goes through `importStudio`.
  - Migrations are identity today, and a newer schema is refused.
  - The experiment layer recomputes the same `studioHash`.
- **Accessibility that holds.**
  - All 8 Studio dialogs are modal, named, and return focus to their opener on Escape.
  - C → Enter connects, is announced, and keeps focus on the node.
  - A visible focus ring sits on all 56 distinct Tab stops.
  - The live region announces play, stop, natural end, loop, undo, redo, delete and add, and `aria-pressed` stays in sync between the toolbar and the compact widget.
  - Invalid imports and a missing Web Audio API get assertive messages.
  - No horizontal overflow and no target under 24 px at 390x844.
  - No colour or font literals outside the tokens in the Studio CSS or JS.

## Verification of this change

Run in the review worktree:
- `npm test`: 2148 tests pass.
- `npm run build`, then `npm run build:check` and `npm run verify-dist`: pass.
- `OSC_BROWSERS=chromium npm run test:studio`: graph 22/22 (file) and 6/6 (http); timeline 14/14 and 14/14; audio, transport and offline all pass; workflows 6/6 and 3/3; links 7/7 and 7/7.
- The new `focus-never-body` check fails all seven conditions against the dist at 10fafa1.

Firefox and WebKit runs of the new check are left to CI, which runs every suite in three
browsers.
