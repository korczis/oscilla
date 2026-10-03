# V2 sequencer → Studio timeline migration map (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §81-§85, §180-§181. Plan issue V416. Code:
`src/js/studio/sequence-import.js` (import / export), `src/js/studio/timeline.js` (clip
semantics), `src/js/studio/timeline-compiler.js` (scheduling). Tests:
`tests/unit/v31-studio-timeline.test.mjs`.

The rule of §84-§85: keep the proven scheduling code, migrate the data, and replace only what the
timeline's absolute-time model makes obsolete. Nothing in `src/js/sequencer/` is modified; the
V2 sequencer panel keeps working on its own model until the Studio replaces it.

Verdicts: **KEEP** (used as is), **REFACTOR** (same behaviour, reshaped for the timeline),
**SUPERSEDE** (replaced in the Studio by a different concept; the V2 code stays for the V2
panel), **MIGRATE** (data converted by `importSequence` / `exportSequence`).

## Data: `sequencer/model.js`

| Concept | Verdict | Studio equivalent and reason |
| --- | --- | --- |
| Sequence `{ version, tempoBpm, loop, waveform, seed, blocks }` | MIGRATE | `importSequence` builds a Studio model: Sequence node → Master Output, one event track, pattern clips, transport tempo, loop region. `exportSequence` is the inverse; the round trip is exact on every fixture |
| Block `{ id, type, durationMs, beats, params }` | MIGRATE | Pattern clip `{ id: 'clip-<blockId>', kind: 'pattern', start, duration, payload: { blockType, params }, musical? }`; `start` is the cumulative duration (absolute time replaces list order) |
| `BLOCK_TYPES`, `BLOCK_SCHEMA`, parameter descriptors, `clampParam`, `applyConstraints`, `normalizeBlock`, `defaultParams` | KEEP | Pattern payload defaults (`schema.js normalizeClipPayload`), validation (`validate.js checkPattern` runs `normalizeBlock`), duration bounds (`timeline.js clipDurationBounds`) |
| `durationMs` authoritative, `beats` tempo lock | REFACTOR | Seconds (`start`, `duration`) authoritative; a tempo-locked block becomes a tempo-linked clip (`musical: { startBeats, durationBeats }`). The V2 chain re-flowed every later block on a tempo change; on the timeline only tempo-linked clips move, absolute clips stay where they are (§91) |
| `setTempo` | REFACTOR | `TRANSPORT_SET` with a new tempo rescales tempo-linked clips (`actions.js retempo`); `timeline.js clipsAtTempo` previews it |
| `setDurationUnit` (ms ↔ beats) | REFACTOR | `CLIP_SET_TIME_BASE` (`absolute` ↔ `tempo`); measurement clips refuse `tempo` |
| `safeMaximum`, `SEQ_MIN_FREQUENCY`, `PROVISIONAL_SAMPLE_RATE`, `SAFE_NYQUIST_FACTOR` | KEEP | Pattern frequencies are clamped by the sequencer compiler; automation frequencies use `safeMaximum` (`automation.js paramBounds`) |
| `MIN_BLOCK_MS`, `MAX_BLOCK_MS` | KEEP | `MIN_CLIP_S` (0.01 s) and the per-type duration bounds |
| `MAX_BLOCKS` (64) | KEEP / SUPERSEDE | Still the V2 export limit (`exportSequence` reports a longer track); the Studio timeline has its own limits (`STUDIO_IMPORT_LIMITS`, 2048 clips) |
| Block ids `b<n>`, `nextBlockId` | MIGRATE | Clip ids `clip-<blockId>` (the export recovers block ids); new clips get Studio ids from the store's generator |
| Model `seed` | MIGRATE | Only seeds random blocks added later in the V2 editor, never playback: returned as `extras.seed` and passed back to `exportSequence`. Random blocks keep their own `params.seed` in the payload, so playback is identical |
| `loop` flag | MIGRATE | Loop region `{ enabled, start: 0, end: total }`; exported as `loop: true` only when the active region spans exactly the sequence |
| `waveform` | MIGRATE | The Sequence node's `waveform` parameter (the voice's carrier) |
| `addBlock`, `deleteBlock`, `duplicateBlock`, `moveBlock`, `moveEarlier`, `moveLater`, `updateBlock` | SUPERSEDE | Studio actions `CLIP_ADD`, `CLIP_REMOVE`, `DUPLICATE` (with `placements`), `CLIP_MOVE`, `CLIP_RESIZE`, `CLIP_UPDATE`: clips move in time and between tracks, not in a list |
| `seedFor` | KEEP | V2 editor only |
| `selectBlock`, `neighbourAfterDelete` | SUPERSEDE | Store selection (`SELECTION_CHANGE`) |
| `describeBlock`, `formatCompactFrequency`, `formatFrequencyRange`, `formatMs` | KEEP | Clip labels |
| `serializeSequence`, `parseSequence` | KEEP | The V2 file format; `importSequence` parses with `parseSequence` (never throws), `exportSequence` writes with `serializeSequence` |
| `referenceSequence` | KEEP | Test fixture |

## Scheduling: `sequencer/compiler.js`

| Concept | Verdict | Studio equivalent and reason |
| --- | --- | --- |
| `buildTimeline` (plan topologies, frame quantisation, clamping) | KEEP | Compiles every pattern clip (a one-block sequence, `timeline-compiler.js clipSequence`) |
| `planFromTimeline`, `planSequence` | KEEP | Each pattern item carries the plan with absolute `time` (= start + `t`); the test asserts the events equal the sequencer's plan |
| `compileSequence` (voice graph, `track` / `source` hooks, stop by an output-gain fade, cleanup) | KEEP | The runtime plays a pattern item with `compileSequence(item.sequence, ctx, destination, item.startTime)`; STOP calls `voice.stop(at)` |
| One voice for the whole sequence | REFACTOR | One voice per pattern clip. A block boundary is at the envelope floor in both cases, so contiguous clips sound the same; an edit or a STOP then touches exactly one voice, and only clips inside the look-ahead window own nodes |
| `renderSequenceOffline` | KEEP | Offline rendering of pattern clips (§105) |
| `automationValueAt` | KEEP | `automation.js scheduledValueAt` and every hold computation |
| `holdParam`, `loggedParam` | REFACTOR | `holdParam` is gone from `compileSequence` (a voice's stop fades only its output gain and never edits a sounding schedule); the hold rule (exact value, re-ended ramp, pinned value) lives on for automation lanes in `automation.js holdAutomation` and `timeline-compiler.js holdEvents`; `loggedParam` is module-private |
| `createSequenceLookup`, `freqAt`, `describeSequence` | KEEP | Readouts through each voice (`voice.freqAt`, `voice.blockIndexAt`) |
| `GAIN_FLOOR`, `EDGE_S`, `START_OFFSET_S`, `STOP_RAMP_S`, `STOP_PAD_S` | KEEP | Envelope edges, start offset, STOP fade (`STOP_POLICY`) |

## View: `sequencer/timeline.js`

| Concept | Verdict | Studio equivalent and reason |
| --- | --- | --- |
| `createTimeScale`, `chooseTickStep`, `formatTick`, `generateTicks` | REFACTOR | The Studio scale is view state (`view.timeline.pxPerSecond`, `scrollX`, §89) instead of fitting the sequence; the tick maths applies unchanged |
| `layoutBlocks` | REFACTOR | Clip rectangles per track row (`timeline.js timelineRows`) at absolute times |
| `BLOCK_ACCENTS` | KEEP | Pattern clip colours |
| `playheadPosition` | SUPERSEDE | `timeline-compiler.js positionAt(anchor, ctxTime)`: start position, loop region and pass number from the audio clock |
| `hitTestBlock` | KEEP | Clip hit testing |
| `dropIndexAt`, `reorderTarget`, `insertionMarkerX` | SUPERSEDE | Clips are dragged in time (`moveClipResult`, snap), not reordered |
| `scaleForModel` | REFACTOR | Scale from view state |

## Transport: `sequencer/editor.js`, `audio/scheduler.js`

| Concept | Verdict | Studio equivalent and reason |
| --- | --- | --- |
| `createSequencerEditor` | KEEP / SUPERSEDE | Stays for the V2 panel; in the Studio the store, the timeline helpers and the scheduler replace it |
| `LOOKAHEAD_S` (1 s), `_pump`, `MAX_QUEUED_PASSES` | REFACTOR | `createTimelineScheduler().advance(now)` schedules the window `[scheduledUntil, now + LOOKAHEAD_S)`; `MAX_PASSES_PER_WINDOW` guards short loops |
| `play`, `stop`, `restart`, `togglePlay` | REFACTOR | Scheduler `advance` / `stop` (STOP plan, `STOP_POLICY`) |
| Loop: next pass at the previous end | REFACTOR | Loop region passes on whole frames (`passInfo`); boundary truncation keeps a sweep on its curve |
| "Edits during playback apply from the next pass" | SUPERSEDE | `EDIT_POLICY`: future items rebuilt from the safe horizon, the current item kept until a compatible live edit |
| `onKeydown` (arrows, Alt+Arrow, Delete, Ctrl+D) | REFACTOR | `nudgeClipResult`, `duplicateClipPlacement`, store actions |
| `dragStart` / `dragOver` / `drop` | SUPERSEDE | `moveClipResult` inside a store gesture (one undo entry) |
| `playheadTime`, `currentPassTiming`, `activeBlockIndex`, `currentFrequency` | REFACTOR | `positionAt`, the active item, `voice.freqAt` |
| `serialize`, `load` | KEEP | V2 files; Studio files go through `importSequence` |
| `SCHEDULE_LEAD_S` | KEEP | `SAFE_HORIZON_S`: nothing is rescheduled closer to now |
| `TOP_UP_EVERY_MS` | KEEP | Upper bound of `nextWakeMs` |
| `SCHEDULE_AHEAD_S`, `scheduleCycles`, `armTopUp` | KEEP | The continuous instrument; the timeline scheduler follows the same rule after a stall (late items skipped, grid kept) |
| Config file `sequencer` key (`ui/config-file.js`) | KEEP | A saved configuration's sequence opens in the Studio through `importSequence` |

## Compatibility

- Every V2 file the sequencer reads, the Studio reads: `parseSequence` repairs and reports, it
  never throws, and `importSequence('{not json')` returns an empty playable model with the issue.
- `exportSequence(importSequence(v2).model, { seed: extras.seed })` equals
  `serializeSequence(v2)` for the reference sequence, all ten block types, tempo-locked blocks
  after a tempo change, a looping triangle sequence, reordered block ids and a single 333.333 ms
  chirp.
- Imported clip boundaries are the sequencer's own frame boundaries (the test compares frames).
- Not representable in V2, reported by `exportSequence`: overlapping pattern clips (skipped),
  gaps shorter than 10 ms (closed), more than 64 blocks (cut), a loop region that is not the whole
  sequence (exported without loop).
