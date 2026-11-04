# Retroactive review of src/js/synth at 447bb27b (K060)

- **Scope:** every file under `src/js/synth/**` at main `447bb27b5` (merge of train 4, #410), read
  with what it calls when that was needed to judge it (the Studio runtime, compiler and store,
  `audio/audio-engine.js`, `midi/notes.js`, `midi/ui.js`, `midi/keyboard-ui.js`, `ui/kinds/xy-pad.js`,
  `ui/synth/*`) and their tests.
- **Rules judged:** project.audio-engine-discipline v2, studio-model-is-canonical, typed-ports,
  no-fake-science v2, a-phone-sounds, no-silent-feedback, no-inert-surfaces, ui-uses-flowbite-pro and
  visual-identity-lock v4.
- **Reviewer:** session oscilla-21, which built none of `src/js/synth` (its only earlier trace there
  is a diagnosis of the logo, with no code). An independent first reader read the tree at 655a37a1
  (train 3's head); oscilla-21 verified every P1 and P2 by reading the code and re-checked them at
  447bb27b. The P3 findings are the first reader's and are recorded as such. Owner decision behind
  the review: "Retroactive review" (K060, via oscilla-b0, 2026-11-03). Second pass: oscilla-af.
- **Method:** reading only; no browser was run for this record. Each finding has file:line at
  655a37a1 unless it says otherwise (train 4 moved `synth/ui.js` by about one line; the cited code
  is unchanged at 447bb27b), the rule it touches, a reproduction or test sketch and a fix.
- **P0 and P1 findings are plan issues** under M064 (K174-K176); P2 and P3 stay in this table for
  their owners (oscilla-26 for the Synth panel and XY pad, dev-53 for W1b's look and dock).

## Status at 447bb27b

| id | severity | status | issue / owner |
|---|---|---|---|
| S1 | P1 | open, verified | K174 (26) |
| S2 | P1 | open, verified; still reproduces at train 5's 2301794d (the Playground engine path records no sink) | K175 (26, with dev-53) |
| S18 | P1 | fixed by 2124f226 (train 5, #413), pending merge | K175 |
| S19 | P1 | fixed by 2124f226 (train 5, #413), refined by 1ef29135 (train 6), pending merge | K176 |
| S3 | P2 | open, verified | 26, with K175 |
| S4 | P2 | open, verified | 26 |
| S5 | P2 | open, verified | 26 |
| S6 | P2 | open, verified; owner confirmed it is not intended (an XY preset touches only what its recipe names) | 26, K097 |
| S7 | P2 | open, verified | 26 |
| S8 | P2 | open, verified by reading | 26 |
| S9 | P2 | open, verified code path; device behaviour unverified | 26 / dev-53 (W1b touches the bay) |
| S10 | P2 | open, verified | 26 |
| S11 | P3 | reclassified: unwired until W1b (dev-53, F013 with K058); closes when W1b lands | dev-53 |
| S12-S17 | P3 | open, first reader's, not re-verified | 26 |

### S18 (P1, audio-engine-discipline): a note held on the Studio keyboard can sound forever

`midi/keyboard-ui.js` releases held keys in a `$watch('workspace')` that runs after the change, and
`midi/notes.js:100-103` `noteOff` takes its sink from `route()` (`midi/ui.js:61-62`: the current
workspace), so a key held in the Studio and released by the switch goes to the Playground or Synth
sink; `synth/studio-sink.js`'s `held` map (lines 52-58) never sees the off, and live notes have no
hold limit. Reproduce: hold a key in the Studio, switch workspace, the Studio node keeps sounding.
Fix: the sink is remembered per note key at note-on and the off goes through it (one change with S2).

### S19 (P1, no-silent-feedback / output ownership): the Studio keyboard leaves the shared transport armed

`synth/studio-sink.js:44-51` arms the shared transport on the first note when it is not playing,
and nothing disarms it on leaving the Studio (the only workspace-leave disarm is the Synth's, in
`synth/ui.js`); `studioOwnsOutput()` (`ui/studio/workspace.js`) is `transport.playing`, so after
leaving the Studio the Playground keys and MIDI are refused with "Studio is playing" and MEASURE's
setup counts it as other audio. Fix: the sink disarms an armed-only run (never a PLAYed one) on
leaving the Studio.

## Overall

The pure layers hold up well: `panel.js`, `normals.js`, `voice-pool.js`, `note-stack.js`,
`fm-algorithms.js`, `wavetables.js`, `perc-recipes.js`, `presets.js` and the engine adapters.
Polyphony is bounded (16 voices per engine, mono panel, 32 held keys). The voice level law
keeps 16 voices at or below full scale, and the master chain (limiter and ceiling) sits behind
everything. Every oscillator frequency goes through `clampFrequency` (0.95 × Nyquist of the
running context). Releases use `releaseAt` / `cancelAndHoldAtTime`, and every node is built
inside `acct.track` / `acct.source`. Edges reach the runtime only through the validated store.
Readouts are setpoints or values computed from the parameters, and they are labelled that way.

The defects sit in the **adapter** (`synth/ui.js`) and its seams. There are UI copies of
runtime state (`synth.armed`, `synth.engine`) that drift from the transport and the model. A
note-off is routed by the state at release time, not by the state at press time. A few
whole-panel actions (XY presets, links, New Synth voice) do more, or less, than they say.

---

## Findings

### S1: The Arm/Disarm button keeps a stale copy of the transport state, so Disarm can go inert (P1)
- **Rules:** project.studio-model-is-canonical (a second copy of state); project.no-inert-surfaces (c).
- **Where:** `src/js/synth/ui.js:415`, `:714`, `:745-752`, `:849-858`; `src/index.html:2464-2465`;
  the stops that bypass it are in `src/js/ui/studio/workspace.js:1252-1254` (visibilitychange and
  pagehide call `stopStudio`) and `:834-839`.
- **What is wrong:** `cmp.synth.armed` is a copy of `transport.armed`. It is written only by
  `refresh()` (store changes in the Synth workspace), `noteOn`, `synthArm` and `disarm`. Nothing
  updates it when the transport stops for another reason: the page is hidden, the phone locks
  (`workspace.js` `hide`), or `stopStudio` runs from elsewhere. `disarm()` then returns early on
  `!t.armed` (`ui.js:747`), **before** it resets `cmp.synth.armed`. The button keeps saying
  "Disarm" with `aria-pressed="true"`, and pressing it does nothing and says nothing. The value
  is only corrected by the next model change or the next note.
  - A second variant: Studio PLAY, then switch to Synth while the transport is still playing the
    document, then press Arm. `armLive` returns `{ ok: true, already: true }`, so the status says
    "Synth armed: the keys play the panel.", but `t.armed` is false and the button still reads
    "Arm".
- **Repro:**
  1. Synth workspace, press Arm. The button reads "Disarm".
  2. Switch to another browser tab, or lock the phone, then come back.
  3. Observed: the button still reads "Disarm" (`aria-pressed=true`) and pressing it changes
     nothing. `synthDebug().armed` is false.
  4. Expected: the button reads "Arm", or Disarm works.
  - Unit sketch: give `createSynthUi` a fake transport, call `synthArm()`, set the fake's
    `playing` to false (as `stop` would), call `synthDisarm()`, then assert
    `cmp.synth.armed === false`. Today it stays true.
  - The browser suite `tests/browser/synth.cjs` reads only `synthDebug().armed` (the
    transport's value), so it cannot see this.
- **Fix:** Derive `armed` from the transport rather than storing it. Either subscribe to
  `transport.on('state')` in `synthInit` and set `cmp.synth.armed = t.armed` there, or make the
  button read a getter. In `disarm()`, set `cmp.synth.armed = !!t.armed` before the early
  return. When `arm()` returns `already` with `armed: false`, say that the Studio is playing the
  document.

### S2: A MIDI note-off is routed to whichever sink is current at release, so a Playground note sticks after switching to Synth (P1)
- **Rules:** project.audio-engine-discipline (voices left sounding); ADR 0062's forced releases.
- **Where:** `src/js/midi/notes.js:76-78` and `:100-103`; `src/js/midi/ui.js:60-61`.
- **What is wrong:** `route()` is evaluated per message, not per note. A MIDI Note On in the
  Playground starts a held engine note (`held: true`, it sounds past the safety limit until its
  Note Off). If the workspace changes to Synth before the Note Off, the Note Off goes to
  `synthSink().noteOff`, and the engine note is never released.
  - The computer and on-screen keys are released on a workspace change (`keyboard-ui.js:185`);
    MIDI is not.
  - The tone sounds in the Synth workspace with no owner until Escape, a window blur, the page
    hiding, or the first Synth note (arming claims the output, then
    `stopPlayback → midiAllOff`).
- **Repro:**
  1. Connect a MIDI keyboard in the Playground.
  2. Hold a key, and with the mouse switch the navigation to Synth (the window keeps focus).
  3. Release the key. Observed: the Playground tone keeps sounding. Expected: it releases.
  - Unit sketch: `createMidiNotes({ engine: fake, route: () => current })`. Call
    `noteOn(60, 100)` with `current = null`, set `current = sink`, call `noteOff(60)`, then
    assert that `fake.noteOff` was called with key `0:0:60`. Today it is `sink.noteOff`.
- **Fix:** Record the sink per note key at Note On (a `Map key → sink | 'engine'`) and send the
  Note Off to the recorded sink. Alternatively, call `midiAllOff()` from the workspace
  `$watch`, as the keyboard does.

### S3: A note-off is resolved against the target played at release time, and the engine chip un-routes before it releases (P2)
- **Rules:** project.audio-engine-discipline (stuck voices).
- **Where:** `src/js/synth/ui.js:727-731` (`noteOff` re-resolves `played()`); `:498-500` (the
  engine chip calls `dock.unroute()` **before** `showTab` → `allOff`); `:733-742` (`allOff`
  covers only panel modules plus the current `played()`).
- **What is wrong:** `noteOn` sends the note to `played()` at press time, and `noteOff` sends it
  to `played()` at release time. Anything that changes `played()` while a key is held, without
  an `allOff` before it, leaves the old target holding the note. The engine chip does exactly
  that: it dispatches `METADATA_SET noteTarget: null` first, and only then `showTab` releases.
  At that point `played()` and the panel list no longer include a routed node outside the panel
  (any `playsNotes` node the picker lists, `picker.js:36-44`).
  - Other paths that change `played()` without an `allOff`: undoing or redoing a `noteTarget`,
    and a link applied while a key is held.
- **Repro (unverified end to end):**
  1. In Studio, add a second FM engine and route it to Master through a mixer.
  2. In Synth, use the dock "Plays:" to choose that node.
  3. Hold computer key A, then click any engine chip on the Engines tab.
  4. Release A. Observed: the external engine's voice stays held until disarm. Expected: it
     releases.
  - Unit sketch: a fake transport recording `live()` calls. `noteOn(60)` with
    `noteTarget = X`; `onClick` on an engine chip; `noteOff(60)`. Assert that X received
    `off` or `all-off`.
- **Fix:** Keep an ephemeral `Map note → node id` filled by `noteOn` and used by `noteOff`. This
  is performance state, not model state. Also call `allOff()` before `dock.unroute()`.

### S4: The engine radio says which engine "the keys play" from a UI copy, not from the model's route (P2)
- **Rules:** project.studio-model-is-canonical (a view that does not derive from the model);
  a UI that shows a state the instrument is not in.
- **Where:** `src/js/synth/ui.js:64-70` (`engineId()` reads `cmp.synth.engine`, `played()`
  prefers `routedNode`); `src/js/synth/view/engines.js:16-31` (`aria-label="Engine the keys
  play"`, `aria-checked` from `on`); `src/js/synth/picker.js:57-58` (routing to a panel engine
  stores its id in `metadata.noteTarget`).
- **What is wrong:** The picker can route the keys to one of the panel's own engines. That
  writes `noteTarget`, but `synthPick` does not touch `cmp.synth.tab` or `cmp.synth.engine`. On
  the Engines tab the radio then shows the default engine checked and its plate, while the keys
  play the routed engine. An engine preset has the same effect: it switches the radio but leaves
  `noteTarget` in place.
- **Repro:**
  1. Dock "Plays:", choose FM.
  2. Click the Engines tab. Observed: ADDITIVE is checked and its plate is shown, but the keys
     sound FM (and the dock says "Plays: FM"). Expected: FM is checked and shown, or the route is
     cleared when the tab is chosen.
- **Fix:** Derive the checked engine from `played()` when `routedNode` is a panel engine. In
  `synthPick`, when the routed node is a panel engine, also set the tab and engine through
  `showTab('engines', module)`. Have `synthPreset` clear the route as the engine chip does.

### S5: "New Synth voice" cuts the user's Master feed without the notice and consent that Insert requires (P2)
- **Rules:** the Synth's own insert contract (`insert.js insertDecision`: a changed document
  gets the panel only from the Insert button, with a notice naming the feed it takes).
- **Where:** `src/js/synth/picker.js:47-50` (`panel.instantiate(model)`, no `insertDecision`);
  `src/js/synth/dock.js:31-43` (says only "The keys play KEYBOARD."); `src/js/synth/panel.js:236`
  (the `EDGE_REMOVE` of `cuts`).
- **What is wrong:** `ensurePanel` refuses to auto-insert into a changed document whose own
  chain feeds Master (`ui.js:107-121`). It inserts only from the explicit Insert button, and
  then says `SYNTH_TEXT.took(names)`. The dock's "New Synth voice" item calls
  `panel.instantiate` directly. That item is enabled whenever the panel is absent, which is
  exactly the state where the view shows Insert. So it removes the document's Master feed and
  announces nothing about it. It also places the panel at (0, 0), over the user's nodes, where
  `ensurePanel` puts it below them.
- **Repro:**
  1. Edit the reference document in Studio, keeping a chain into Master. Open Synth: it shows
     "Insert the Semi-modular mono voice".
  2. Open the dock "Plays:" and choose New Synth voice.
  3. Observed: the user's chain no longer reaches Master, and the status says only "The keys
     play KEYBOARD.". Expected: the `took(...)` notice, as Insert gives.
- **Fix:** Route `NEW_VOICE` through `ensurePanel({ explicit: true })` (or share its notice and
  placement). Add a test asserting the `took` sentence when `cutsOf(model)` is not empty.

### S6: Loading an XY preset resets every engine to its Init values (P2)
- **Rules:** the preset scope contract in `presets.js` ("a panel preset leaves the engines as
  they are"); an undoable but silent loss of the user's settings.
- **Where:** `src/js/synth/xy.js:110-115` and `:117-131`; `src/js/synth/link.js:57-63`
  (`presetAction(..., { all: true })`); `src/js/synth/presets.js:85-86`.
- **What is wrong:** Built-in XY presets go through `linkAction`, which applies the base preset
  with `{ all: true }`. That resets every module, the six engines included, to the preset's
  values, which are Init for the engines. `xyPatchAction` then reapplies
  `linkAction(linkOf(doc, panel, 'init'))`, which also uses `all`. Any engine settings are lost
  as a side effect of choosing an XY preset.
  - The test "a saved XY patch loads back to the same panel state" uses a fresh store, so it
    cannot see this.
- **Repro:**
  1. Engines, FM, set Op 2 ratio to 5.
  2. XY tab, preset "XY lead".
  3. Engines, FM. Observed: Op 2 ratio is back to 2. Expected: unchanged, as a panel preset
     leaves it.
- **Fix:** Scope the XY load to the panel tab and the xy module. Either give
  `linkAction`/`presetAction` a module filter, or have `xyPatchAction` drop steps that touch
  engine nodes. Test it: change an engine parameter, load each XY preset, and assert that the
  engine parameters are unchanged.

### S7: Copy link and saved XY presets drop every cable's props apart from amount-knob depths (P2)
- **Rules:** the link contract (`link.js` header: "a copied link reopens the same sound");
  project.studio-model-is-canonical (serialization of the panel state).
- **Where:** `src/js/synth/link.js:54` (cables encoded as `[from, to]` pairs only); `:79-95`
  (props rebuilt by `patchCable`/`cableProps`); `src/js/synth/xy.js:126` (an XY patch reloads
  through `linkOf`).
- **What is wrong:** A cable's depth, polarity, mapping, offset or `muted` edited in the Studio
  Inspector is not carried. On reload it gets the defaults from `cableProps` (or the amount
  depth). The XY pad's Y range lives on exactly such an edge (`xy.y → target`, its depth and
  offset), so a saved XY preset with a tuned Y range reloads with the default range.
  - The round-trip tests compare only the endpoints (`tests/unit/xy-pad.test.mjs:357-358`, and
    "every jack pair ... round-trips" in `synth-review-329-round2`).
- **Repro:**
  1. XY tab: patch the pad, Y drives LPF Cutoff. In Studio, set that edge's depth to 0.5.
  2. Save it in the Library as an XY preset, then load it into a fresh document. Observed: the
     depth is the default. Expected: 0.5. The same happens for Copy link.
  - Unit sketch: take a panel model, `EDGE_UPDATE` a cable's props, compute
    `linkAction(fresh, linkOf(model))`, then compare props.
- **Fix:** Carry the non-default props of each cable in the link and the XY patch. The patch
  already holds the edges, so use `patch.graph.edges[*].props`. Extend the round-trip tests to
  compare props.

### S8: After an XY preset or "Patch the pad into the voice", the keyboard plays silently with no reason given (P2)
- **Rules:** project.no-inert-surfaces (a control that does nothing at these settings, without
  a stated reason).
- **Where:** `src/js/synth/xy.js:25-26` (`XY_VOICE` patches into `vco1/2.pitch` and
  `eg1/2.gate`); `src/js/synth/normals.js:219-227` (a cable breaks the jack's normals
  `n1`-`n4`); `src/js/synth/ui.js:68` (on the XY and Panel tabs the keys play `keys`);
  `src/js/synth/presets.js:120-127` (PATCH_REPLACE of a panel preset never restores normals).
- **What is wrong:** Once the pad is patched, the Keys node's pitch and gate reach nothing but
  S&H, so every key note arms the transport, returns `ok` and sounds nothing. The only notice is
  the one-off sentence at patch time. Choosing a Panel preset, even Init, does not bring the
  keyboard back. The cables have to be removed in the bay.
- **Repro:**
  1. XY tab, preset "XY lead".
  2. Panel tab, preset Init. Play keys. Observed: silence, and the status says nothing.
     Expected: either sound, or a sentence that the pad's cables replace the keyboard's normals,
     with the fix.
- **Fix:** In `noteOn`, when the played Keys node's `gateTargets` has no envelopes, say why
  (name the cables) and offer "Unpatch the pad". Alternatively, make Panel presets restore the
  keyboard normals they cover.

### S9: Touch-dragging a cable on the patch bay has no `touch-action: none`, and pointercancel is handled as a drop (P2)
- **Rules:** project.a-phone-sounds (the phone is the first screen); interaction correctness.
- **Where:** `src/js/synth/ui.js:438-444` (`preventDefault` on pointerdown, which does not stop
  panning); `:816` (`pointercancel` → `onPointerUp`); `:474-489` (an unmoved pointer is a tap,
  a moved one is a drop); `src/js/ui/patch/patch-bay.js:157-165` (the bay `<svg>` and jacks
  carry no `touch-none`, unlike the knobs, `view/face.js:76`, and the XY pad).
- **What is wrong:** On a touch screen, a drag that starts on a jack pans the page. The browser
  sends `pointercancel`, which the Synth treats as `pointerup`:
  - If the pointer has not moved more than 4 px, this is a tap (`tapJack`). Scrolling the bay
    with a finger that lands on a jack therefore starts a pending connection ("Connecting from
    ...").
  - If it has moved, the cancel point is taken as a drop.
  - **Unverified:** the bay `<svg>` may be replaced during the drag (`renderBay` from the
    `resize` listener, which fires as a mobile URL bar collapses). The pointerup can then land
    outside `[data-osc="synth-view"]`, leaving `cable` set. `refresh()` then never calls
    `renderAll()` again (`ui.js:417`).
- **Repro (device behaviour unverified):** On a phone, Synth, Patch bay face, swipe the bay
  starting on a jack. Observed (expected from reading): the page scrolls and the jack enters
  "Connecting from ...". Expected: either a cable drag (with `touch-none` on the jacks) or a
  plain scroll with no pending state.
- **Fix:** Add `touch-none` to the jack hit targets (or the bay `<svg>` while a drag is armed).
  Handle `pointercancel` separately: clear `cable` and the live path, and connect nothing.
  Clear `cable` on `lostpointercapture`.

### S10: Amount-knob "memory" is semantic state outside the model (P2)
- **Rules:** project.studio-model-is-canonical ("a view keeps only its own ephemeral
  presentation ... and derives everything else from the model").
- **Where:** `src/js/synth/normals.js:142-160` (`createAmountMemory`) and `:186-194`, `:247-251`
  (the depth written into new EDGE_ADDs); `src/js/synth/ui.js:58`, `:87`, `:411`.
- **What is wrong:** The depth that `unpatch`, `restoreNormals` and `patchCable` write into the
  model comes partly from a per-session Map that the model does not hold. The same action on
  the same model can therefore produce different documents: after a reload, after opening the
  same document in another tab, or after a link. The design is documented in the header, but
  it is the "second source" the rule names, and it is not part of history or serialization.
- **Repro:**
  1. LPF "EG 2 → cutoff" to 3.5.
  2. Patch MG → LPF Cutoff, which breaks n21 and n22.
  3. Reload. The Studio document is restored, but the memory is empty.
  4. Remove the cable. Observed: n22 comes back at 2 (declared). Without the reload it comes
     back at 3.5. Expected: one result.
- **Fix:** Keep the depth in the model. Options: a muted edge, or an `amounts` map in
  `metadata.panel` (schema change, ADR); or keep the broken normal as an edge with `muted: true`
  instead of removing it. At least, state the behaviour in the UI.

### S11: The knob and feel core in `ui/synth/` (about 970 lines) is not reachable from the app, and the shipped knob is a separate model (P2)
- **Rules:** maintainability ("duplicated logic that could diverge"); the feel contract it
  advertises (Escape cancels a gesture, wheel, a lost pointerup never merges gestures) is not
  what users get.
- **Where:** `src/js/ui/synth/knob.js` (813 lines) is imported only by `src/js/ui/synth/feel.js`
  (158 lines), which nothing in `src/` imports. The app's knob is `src/js/synth/view/knob.js`.
  Both define `SWEEP_DEG = 270`, `LOG_STEPS = 200`, a 200 px drag range and their own
  `formatValue`/`parse`.
- **What is wrong:** `tests/unit/ui-synth-knob.test.mjs` (more than 1,600 lines) proves
  behaviour of code the user never runs. The shipped knob (`ui.js:422-494`) has no wheel
  input, does not cancel the gesture on Escape, and handles a lost capture only through
  `pointercancel`. The two models will diverge silently.
- **Repro:** `grep -rn "ui/synth/knob\|ui/synth/feel" src/js` finds no importer outside
  `ui/synth/`.
- **Fix:** Either migrate `synth/view/knob.js` and the `ui.js` knob handlers onto
  `ui/synth/knob.js`/`feel.js` (one model), or delete them and their tests until a surface uses
  them. Add a unit check that every module under `ui/synth/` is imported by the app graph.

### S12: Restore module re-implements normal restoration and has diverged from `normalSteps` (P3)
- **Rules:** duplicated logic.
- **Where:** `src/js/synth/ui.js:590-609` (`props: n.props`) against `src/js/synth/normals.js:238-254`
  (`normalSteps`, which applies the amount knob's depth).
- **What is wrong:** A restored module's normals return at their declared depth, ignoring the
  amount knob's remembered depth. `unpatch` and Restore normal honour it.
- **Repro:**
  1. Set "EG 2 → cutoff" (LPF) to 3.5.
  2. Delete EG 2 in Studio, then press Restore module.
  3. Observed: the knob reads 2. Restore normal on the same jack would give 3.5.
- **Fix:** Build the edges with `normalSteps` over the model plus the NODE_ADD, or factor the
  props rule into one helper.

### S13: Double-click resets a knob even while it is disabled (P3)
- **Rules:** project.no-inert-surfaces (b): a disabled control should not act.
- **Where:** `src/js/synth/ui.js:689-694`. There is no `aria-disabled` check, unlike
  pointerdown (`:427`), keydown (`:615`) and toggles (`:511`).
- **Repro:** Set VCO 1 Wave to Saw, so Pulse width is disabled with its reason. Double-click
  the Pulse width knob. Observed: a NODE_PARAM_SET and an undo entry. Expected: the reason is
  said and nothing changes.
- **Fix:** Apply the same `aria-disabled` guard (and the `say(why)`) in `onDoubleClick`.

### S14: Arrow keys on a switch leave focus on the old option (P3)
- **Rules:** accessibility (the ARIA radio-group pattern).
- **Where:** `src/js/synth/ui.js:628-636`, with `:810` (`subscribe` → `queueMicrotask(refresh)`)
  and `:307-312`, `:372-377` (`keep` re-focuses `data-v` of the **old** value).
- **What is wrong:** The store emits synchronously, but the Synth re-renders in a microtask. The
  focus lookup at `:634` therefore finds the old checked option, and `renderAll` re-focuses it.
  Focus ends on an unchecked radio, and a screen reader announces the old value.
- **Repro:** Tab to VCO 1 Wave (Saw) and press ArrowRight. Observed: Square is checked, focus is
  on Saw. Expected: focus on Square.
- **Fix:** After `setControl`, record the new value and focus
  `[data-option=cid][data-v=new]` after `renderAll`. Alternatively, have `renderAll`'s `keep`
  prefer the checked option of a radio group.

### S15: Smaller silent paths and copy gaps (P3)
- **Delete key (`ui.js:647-652`):** a refused `unpatch` is ignored silently, and a successful
  one is not announced, while the Remove button says "Cable removed; the normal is restored."
  Use the same message path.
- **A new cable replaces an existing one into a single input (`normals.js:221-227`):** the old
  cable or Studio edge is removed in the same BATCH, but `ui.js:190` announces only "Patched A
  to B.". Name the replaced cable. The connection list also does not say that the jack is
  occupied.
- **Preset select (`index.html:2456-2457`):** `x-model` writes `synth.preset` before
  `synthPreset` runs, so a refused preset (no panel, or the store refuses) leaves the select
  showing a preset that was not applied. Reset `synth.preset` on failure.

### S16: Percussion clap bursts gate the envelope from its level to 0.0001 with a hard step (P3)
- **Rules:** project.audio-engine-discipline ("Gain never hard-switches from nonzero to zero").
- **Where:** `src/js/studio/adapters/engines.js:370-377`.
- **What is wrong:** Each burst but the last does `setValueAtTime(level)` and then
  `setValueAtTime(0.0001)`, an instantaneous step on white noise. This is the clap's intended
  transient and is inaudible as a defect, but the letter of the rule has no exemption for it.
  The same layer also schedules against `ctx.currentTime` (`:371`), not the voice's `v.t`.
- **Fix:** Use about 0.5-1 ms linear ramps at each burst edge (the sound is unchanged), or
  record a stated exemption in the rule for one-shot transients. Anchor the scheduling to `v.t`.

### S17: The wavetable engine does not drop partials between 0.95 × Nyquist and Nyquist, as the additive engine does (P3, unverified scope)
- **Rules:** project.audio-engine-discipline (0.95 × Nyquist).
- **Where:** `src/js/studio/adapters/engines.js:317-330` (64-partial PeriodicWaves at any note)
  against `:82` (`partialsBelow` in the additive engine).
- **What is wrong:** The fundamental is clamped, but upper partials up to the browser's own band
  limit can sound in the 0.95-1.0 × Nyquist band, and no "dropped" count is reported. The
  additive engine treats the same situation as a rule matter. **Unverified:** whether the rule
  is meant to cover partials inside a PeriodicWave, and how each browser band-limits a periodic
  wave.
- **Fix:** Build per-range PeriodicWaves with `partialsBelow`, as the additive engine does, or
  state in the rule and the engine's help that table partials rely on the browser's band
  limiting.

---

## Checked and found sound (no finding)
- **Nodes:** created only inside `acct.track` / `acct.source` (voice host, engine adapters).
  `disposeHandle` stops, disconnects and untracks them. No DelayNode, no recurrence.
  `fm-algorithms`, pluck and FM feedback are blocked with reasons.
- **Polyphony:** bounded: 16 per engine through the pool, which is bounded at 64 by
  construction; a steal fades in 5 ms before the new voice; the mono stack holds 32 keys.
- **Level:** `voicePeak` keeps 16 voices at Level 4 at or below full scale. The FM carrier sum,
  `percLevelScale` and the morph headroom are each at or below 1. The Studio bus enters the
  engine's master safety chain (`adapters/output.js`).
- **Frequency:** every engine oscillator goes through `clampFrequency`. Percussion sweeps and
  filters clamp to `limitHz`. Hats skip ratios above the limit, and FM drops operators above
  it.
- **Edges and loops:** every Synth edge goes through `patchCable` / the store (typed ports and
  cycles validated there). Link input is validated (`core/url-state-synth.js`, amounts within
  their knob ranges).
- **Readouts:** knob values are model setpoints; `displayHtml` refuses anything but computed
  text and labels it; the XY readout is the pad's own position. No meter or LED in the Synth.
- **Theme:** tokens only in `synth/view` and the `ui/synth` files read; no hardware vocabulary
  outside the layer.

## Summary table

| id | severity | rule | file:line | summary |
|---|---|---|---|---|
| S1 | P1 | studio-model-is-canonical; no-inert-surfaces | src/js/synth/ui.js:745-752, 415 | `synth.armed` copy goes stale after a hide or stop; Disarm becomes inert |
| S2 | P1 | audio-engine-discipline | src/js/midi/notes.js:76-103 | MIDI note-off routed by the current sink; a Playground note sticks after switching to Synth |
| S3 | P2 | audio-engine-discipline | src/js/synth/ui.js:727-731, 498-500 | note-off goes to the target at release time; the engine chip un-routes before allOff |
| S4 | P2 | studio-model-is-canonical | src/js/synth/ui.js:64-70; view/engines.js:16-31 | engine radio "the keys play" disagrees with the routed `noteTarget` |
| S5 | P2 | insert contract (insertDecision) | src/js/synth/picker.js:47-50; dock.js:31-43 | New Synth voice cuts the Master feed silently and places the panel at 0,0 |
| S6 | P2 | preset scope contract | src/js/synth/xy.js:110-131; link.js:57-63 | an XY preset resets all six engines to Init |
| S7 | P2 | link contract; canonical serialization | src/js/synth/link.js:54, 79-95 | links and XY presets drop cable props (depth, offset, mapping, muted) |
| S8 | P2 | no-inert-surfaces | src/js/synth/xy.js:25-26; ui.js:68 | keys silent after the pad is patched, with no stated reason; presets do not restore them |
| S9 | P2 | a-phone-sounds (phone UX) | src/js/synth/ui.js:438-444, 816; patch-bay.js:157 | no touch-none on the bay; pointercancel treated as tap or drop |
| S10 | P2 | studio-model-is-canonical | src/js/synth/normals.js:142-194 | amount memory is semantic state outside the model |
| S11 | P2 | maintainability | src/js/ui/synth/knob.js, feel.js | about 970 lines of knob and feel core unreachable from the app; two knob models |
| S12 | P3 | duplicated logic | src/js/synth/ui.js:590-609 | Restore module ignores the amount depth that normalSteps honours |
| S13 | P3 | no-inert-surfaces (b) | src/js/synth/ui.js:689-694 | double-click resets a disabled knob |
| S14 | P3 | accessibility | src/js/synth/ui.js:628-636 | arrow on a switch leaves focus on the old option |
| S15 | P3 | silent paths | ui.js:647-652, normals.js:221-227, index.html:2456 | Delete is silent; a replaced cable is not named; preset select drifts on refusal |
| S16 | P3 | audio-engine-discipline | src/js/studio/adapters/engines.js:370-377 | clap burst gates are hard steps; scheduled on ctx.currentTime |
| S17 | P3 (unverified) | audio-engine-discipline | src/js/studio/adapters/engines.js:317-330 | wavetable partials in the 0.95-1.0 Nyquist band are not dropped |

Counts: P0 0, P1 2, P2 9, P3 6.

## Files read in full
- `src/js/synth/ui.js`, `dock.js`, `picker.js`, `link.js`, `normals.js`, `panel.js`,
  `presets.js`, `xy.js`, `insert.js`, `library.js`, `note-stack.js`, `voice-pool.js`,
  `fm-algorithms.js`, `wavetables.js`, `perc-recipes.js`
- `src/js/synth/panels/semi-mono.js`, `engines.js`, `xy.js`
- `src/js/synth/view/face.js`, `knob.js`, `xy-tab.js`, `engines.js`, `faces.js`, `bay.js`,
  `tokens.js`
- `src/js/ui/synth/display.js`, `plate.js`, `label.js`
- `src/js/studio/live-notes.js`, `adapters/voices.js`, `adapters/engines.js`,
  `adapters/output.js`, `adapters/common.js`
- `src/js/midi/notes.js`, `src/js/midi/keyboard-ui.js`, `src/js/ui/kinds/xy-pad.js`
- The rules: audio-engine-discipline v2, studio-model-is-canonical v1, typed-ports v1,
  no-fake-science v2, a-phone-sounds v1, no-silent-feedback v1, no-inert-surfaces v1 (in full);
  ui-uses-flowbite-pro v1 and visual-identity-lock v4 (their Required behaviour sections).

## Read in part
- `src/js/studio/transport.js`: arm, start, stop, abort, disarm, live.
- `src/js/ui/studio/workspace.js`: `createStoreHandle`, synth wiring, `ensureAudio`,
  `onTransport`, `stopStudio`, hide.
- `src/js/midi/ui.js` and `midi/keyboard.js`: the controller.
- `src/js/ui/output-owner.js`, `src/js/studio/adapters/engine-hooks.js` (oscillator clamp),
  `src/js/audio/audio-engine.js` (`_osc`).
- `src/js/studio/nodes/engines.js`: the FM, AM and inactive rules and facts.
- `src/js/core/url-state-synth.js` (validation, by grep); `src/js/ui/patch/patch-bay.js`
  (the svg).
- `src/js/ui/synth/knob.js` and `feel.js` (headers and import graph only).
- `src/index.html` (the Synth markup and keyboard dock), `src/js/main.js` (pagehide and
  unlock).
- Tests: titles of every `tests/unit/synth-*.test.mjs` and `xy-pad.test.mjs`, plus specific
  bodies (the XY round trip, link routing). `tests/browser/synth.cjs` by grep for armed checks.

## Not reviewed
- `src/js/ui/synth/jack.js`, `cable.js`, `tokens.js`; most of `ui/synth/knob.js`.
- `src/js/studio/runtime.js`, `compiler.js`, `actions.js` internals (trusted for validation and
  gesture semantics).
- The browser suites' bodies beyond the grepped checks.
