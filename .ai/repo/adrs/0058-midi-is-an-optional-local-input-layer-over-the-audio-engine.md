---
schema: adr/v1
id: adr-0058
kind: adr
title: MIDI is an optional, local control layer over the AudioEngine, never a second engine
status: proposed
date: 2026-10-18
tags:
  - midi
  - audio
  - product
related:
  - rule:project.audio-engine-discipline
  - rule:project.single-file-deliverable
  - rule:project.studio-model-is-canonical
  - rule:project.no-fake-science
  - rule:project.visual-identity-lock
  - file:src/js/audio/audio-engine.js
  - file:src/js/core/music.js
  - file:.ai/repo/project/intents/midi-jam-companion.yaml
  - file:.ai/repo/project/milestones/M045.yaml
provenance:
  origin: authored
  derived_from:
    - file:.ai/repo/project/intents/midi-jam-companion.yaml
---

# 58. MIDI is an optional, local control layer over the AudioEngine, never a second engine

## Context

On 2026-10-11, in the owner's ChatGPT project "Oscilla" (conversation `6acbd3dc`, knowledge
record `chatgpt-oscilla-project`), the owner wrote one line: "prismatic/oscilla jako midi jam
companion" (Prismatic and OSCILLA as a MIDI jam companion). ChatGPT's answer (18:23:45Z) gave
the idea its shape. A player connects a MIDI keyboard or controller. OSCILLA listens to what
they play, answers with a bounded response, and shows what the sound does. The answer drew a
firm boundary: OSCILLA is not to become another DAW or a copy of a commercial synthesizer. Its
product sentence was: OSCILLA plays with you, sees what you play, and lets you explore what that
sound does. It extends "See sound. Shape frequency." rather than replacing it.

The same answer split the roles. OSCILLA owns the sound, the MIDI input, the jam rules, the
rhythmic and harmonic response, the visualisation and the recording. Prismatic, the owner's
other project, would be the higher layer that designs and explains jam modes and holds presets,
experiments and structured session notes. Nothing in this repository builds or names that
layer.

On 2026-10-18 the owner adopted the direction by asking for it to be recorded; this decision,
the intent `midi-jam-companion` and M045 are that record. The boundary, the product sentence and
the role split are therefore ChatGPT's proposal as the owner adopted it, not the owner's own
words.

What exists today:

- one `AudioEngine` that owns the audio lifecycle (`project.audio-engine-discipline`);
- note arithmetic in `src/js/core/music.js` (`midiToFrequency`, `nearestNote`);
- the V1 block sequencer, which composes tones, pulses and sweeps and is not a note sequencer;
- the V3.1 Studio, whose `StudioModel` is the only Studio state
  (`project.studio-model-is-canonical`), with a timeline of clips and automation.

What constrains a MIDI feature:

- **Optional.** The Web MIDI API is not available in every browser, needs a secure context, and
  asks the user for permission. OSCILLA must keep working from `file://` and the Pages sub-path
  as one file (`project.single-file-deliverable`), so MIDI can only be an optional capability.
  Which of the three gate browsers expose it, and in which origin, is to be measured (V501),
  not assumed.
- **Deterministic timing.** A musician needs a steady pulse. A language model in the timing
  path would add latency and unpredictability exactly where they hurt.

## Decision

1. **MIDI is a control and musical layer; the AudioEngine stays the rendering layer.** MIDI
   input becomes note and controller events. Voices sound through the existing engine and its
   safety limits (level caps, click-free envelopes, the 0.95 × Nyquist bound). There is no
   second audio graph and no MIDI-specific synth.
2. **Optional and honest.** OSCILLA detects Web MIDI support and permission at runtime and states
   one of: unsupported, permission needed, denied, no devices, or connected with the device
   names. When MIDI is absent, nothing else changes. No claim names a browser that has not been
   measured.
3. **Local and deterministic.** The response modes are deterministic rules over the incoming
   events (drone plus answer, call and response). They are scheduled on the AudioContext clock.
   No network call and no model inference happens in the audio or event path. A higher layer may
   suggest a mode between phrases; that is not part of this decision.
4. **One record.** A recorded jam is an editable event track. Where it lives (Studio timeline
   clips versus a separate record) is decided in V505 against `project.studio-model-is-canonical`.
   It is never a second, unvalidated state.
5. **Out of scope for the first version:** MIDI clock, MIDI output to external instruments,
   multiple tracks and AI improvisation.

## Alternatives rejected

- **Turning the block sequencer into a MIDI sequencer.** The sequencer composes sound patterns,
  not notes. Forcing notes into it would blur both.
- **A separate MIDI synth or audio graph.** It would duplicate the engine and bypass its safety
  and lifecycle guarantees.
- **An LLM that decides what to play note by note.** Latency and unpredictability in the timing
  path.
- **Requiring MIDI.** It would break `file://` use and browsers without Web MIDI.

## Consequences

- M045 plans the first usable version in five issues (V501 to V505). The plan records it as
  planned work; nothing is implemented by this decision.
- Every MIDI surface follows `project.visual-identity-lock` and has a non-pointer path.
- The intent `midi-jam-companion` holds the criteria that make the direction true. Until claims
  and tests exist, its criteria are unmet, and the plan says so.
- The status stays `proposed` until the owner accepts the direction.

## Resolution notes

Appended; the status stays `proposed`.

### 2026-10-18: the Context's provenance corrected

The first version of the Context said the owner proposed the direction on 2026-10-18 and quoted
the boundary and the product sentence as the proposal. The conversation is dated 2026-10-11, the
owner's part of it is one line, and the shape, the boundary, the product sentence and the role of
Prismatic are ChatGPT's answer, which the owner adopted on 2026-10-18. The Context now says so.
The Decision is unchanged.

### 2026-10-18: the test seam that stands in for MIDI hardware, and the support-state table (V500)

**Note of 2026-10-18 (V500), no section above changes.** The critique of `midi-jam-companion`
holds V501 on two blocking findings, `no-hardware-test-seam-undecided` and
`permission-prompt-and-state-taxonomy`. This note decides both, and gives each state the gate
builds it can be produced in (finding `measured-support-is-playwright-not-users`). Decision 2
above names five states; the table below has thirteen. Decision 2 is refined by the table, not
replaced, and the criterion `midi-support-state` is restated by a plan change after V500 and
before V501 starts. Whether device names are persisted (finding
`shared-origin-permission-and-device-names`) is not decided here. A critic re-reviews the two
blocking findings against this note; the note does not resolve them itself.

**What the gate builds expose, measured.** On 2026-10-18 each gate build was probed headless
through Playwright 1.63.0, the version `package.json` pins, on darwin arm64 (Darwin 25.5.0),
at a 1-minute load average of about 23 to 46. The probe ran twice, with three and then five runs per
cell, each run in a fresh browser context. It loaded a blank page holding one button from
`file://`, from `http://127.0.0.1` served by `tests/browser/lib/serve.cjs` (the gate's own
origins), from 127.0.0.1 served with `Permissions-Policy: midi=()`, and from plain http on the
machine's LAN address. At load it read `window.isSecureContext`, `typeof
navigator.requestMIDIAccess`, `typeof MIDIAccess` and `navigator.permissions.query({ name:
'midi' })`. Then a click on the button called `requestMIDIAccess({ sysex: false })`. The probe
polled until the request settled, against a 60 s wall-clock deadline that no run reached. It
recorded how long the request took and read the query again. The probe script is in no
repository. These steps are what V501's measured checks repeat.

| Gate build | `file://` | `http://127.0.0.1` | plain http, LAN address | 127.0.0.1 with `Permissions-Policy: midi=()` |
|---|---|---|---|---|
| Chromium 153.0.8010.12 | API present; query `prompt`; request rejects `NotAllowedError` within 15 ms; query still `prompt` after | as `file://` | not a secure context; API absent | query `denied`; request rejects `SecurityError` ("Midi has been disabled in this document by permissions policy") within 5 ms |
| Firefox 155.0 | `requestMIDIAccess` absent (the `MIDIAccess` interface exists); query `prompt` | API present; query `prompt`; request rejects `SecurityError` ("WebMIDI requires a site permission add-on to activate") after 3.0 to 12.9 s (32 runs, with and without the policy); query still `prompt` after | not a secure context; API absent | as `http://127.0.0.1`: the policy makes no observable difference |
| WebKit 26.6 | API absent (`MIDIAccess` too); query rejects `NotSupportedError` | as `file://` | as `file://`, not a secure context | as `file://` |

The time Firefox takes to reject varies from run to run, and in 29 of the 32 runs it was longer
than 5 s; the review of pull request #211 measured 4.3 to 8.8 s in four. A check that reads the
request's state at a fixed time therefore records `pending` or `SecurityError` by chance.
Calling the request from `page.evaluate` instead of a click changed nothing in any build,
because Playwright evaluates with user activation.

Granting permissions through Playwright changes the outcome only in Chromium. Firefox refuses
the names `midi` and `midi-sysex` ("Unknown permission"). WebKit accepts both, and that changes
nothing without the API. In Chromium a grant of `midi` alone sets the query to `granted`, but
the request still rejects with `NotAllowedError`. A grant of `midi` and `midi-sysex` makes the
request resolve with no inputs and no outputs, on `file://` and on 127.0.0.1. When the grant is
cleared mid-session, the kept `PermissionStatus` fires `change` (`granted` to `prompt`). The
open `MIDIAccess` fires no `statechange`, and a new request rejects with `NotAllowedError`.
The CI runners (`ubuntu-latest`) were not measured. Whether Chromium there resolves with no
inputs or rejects for want of a platform MIDI backend is for V501's measured checks to record.
Where CI differs from this table, the gate column below is restated from V501's record.

**The seam: an `addInitScript` stub of `navigator.requestMIDIAccess` (option (a)).** No
`window.OSCILLA` member injects MIDI. The stub is one test helper that V501 adds under
`tests/browser/lib/` (`midi-stub.cjs`). A suite installs it with `context.addInitScript` before
any page script runs. It defines `Navigator.prototype.requestMIDIAccess` and returns a fake
`MIDIAccess` whose fake `MIDIInput`s dispatch `midimessage` events with a `Uint8Array` `data`
and a `timeStamp`, and `statechange` events with a `port`. The test drives the stub, not the
page. The probe installed such a stub, and a dispatched Note On reached a listener, in all three
gate builds from both origins; under it, `requestMIDIAccess` is not `[native code]`. This option
was chosen over a `window.OSCILLA` inject member for three reasons. The page's own code path
runs, from the request through the listeners, exactly as it would for a device. The shipped
surface does not grow. And a `window.OSCILLA` hook that feeds notes would be a shipped way to
play into the engine that no user has.

- **It is outside ADR 0052's member kinds.** ADR 0052's kinds (Observe, Drive, Inject)
  classify members of `window.OSCILLA`, and Inject's TEST CONTEXT is a mode that the page knows
  it is in and labels. The stub is neither a member nor such a mode. It is a test-harness
  substitute for the platform API, installed from outside the page, and it does not ship in
  `dist/index.html`. Of the three kinds it is nearest to Inject, because it feeds input that
  no user made. It cannot carry TEST CONTEXT labelling, because the page cannot know that it
  runs under the stub (next point), so the stub's self-naming device stands in for that
  labelling. The key lists pinned by `seam-surface-pinned` in `tests/browser/app.cjs` do not
  change for it. If V501 adds a read of the support state to the seam, that read is an
  Observe member, and the pinned list grows by that deliberate edit. No MIDI member of any kind
  is decided here.
- **The page cannot tell a stub from the platform, so the stub names itself.** Its inputs are
  named "TEST STUB · MIDI input" and its manufacturer is "OSCILLA test". Anything the page
  shows or records under the stub, with the device names, says so.
- **The stub stays faithful to the real interface.** In Chromium, the one gate build with a real
  `MIDIAccess`, a measured check compares the members the page reads on the stub's objects
  with `MIDIAccess.prototype`, `MIDIInput.prototype` and `MIDIPort.prototype`. A stub that
  drifts from the real interface fails that check.

**How a check tells measured from stubbed behaviour.**

1. Every MIDI check belongs to exactly one of two groups. Measured checks run in a browser
   context that has no MIDI init script. Seam checks run in one that has the stub, or a spy
   that only counts calls. The group is part of the check id (`midi-measured-...`,
   `midi-seam-...`) and of the leg line the suite prints.
2. Each check first asserts its own group inside the page. A measured check asserts that
   `navigator.requestMIDIAccess` is absent, or that
   `Function.prototype.toString.call(navigator.requestMIDIAccess)` contains `[native code]`, and
   that the stub's marker is absent. A seam check asserts that the marker is present. A check
   that finds the other group fails; it does not skip.
3. Only a measured check can support a support claim, and its wording names what it measured:
   "gate build" with the engine and version Playwright reports, the platform and the origin.
   It never names Chrome, Firefox or Safari as shipped. A seam check proves only that the page
   handles a state, and its wording says "handles (stubbed API)". The README's support text and
   the claim `midi-support-state` cite measured checks alone.

**When access is requested.** The page calls `requestMIDIAccess` only from an explicit user
action: the control "Connect MIDI", reachable by pointer and keyboard. It always calls it with
`{ sysex: false }`. Loading the page makes no request and shows no prompt. At load the page
reads only `window.isSecureContext`, `typeof navigator.requestMIDIAccess` and
`navigator.permissions.query({ name: 'midi' })`, a read the Permissions API defines as
never prompting; in the probe it settled without a prompt in every gate build. The page keeps the
`PermissionStatus` it got, because its `change` event is the only measured sign of a mid-session
revocation. A grant at load does not connect by itself: it is the state `allowed`, and
listening starts with Connect MIDI. V501 proves the rule with a seam check, a spy that counts
calls and calls through. In each gate build it loads the page and asserts zero calls to
`requestMIDIAccess`. In Chromium a measured check also asserts that the query still reads
`prompt` after the load.

**The permission is per origin.** It belongs to the origin, not to OSCILLA. On Pages that origin
is `https://korczis.github.io`, which ADR 0052 records as shared by every Pages site of the
account (22 on 2026-10-07). A grant made there is a grant to all of them, and a denial made on
another of them reads as `denied` here. The copy below names the origin's host as `{site}`
(`location.host`). On `file://` the copy says "this page", because which origin a browser keys
a file's permission to was not measured, so the copy claims no reach.

**The support-state table.** The page holds one state at a time. What happened most recently
wins over what was read at load:

1. The context comes first (rows 1 and 2). In those states Connect MIDI is not offered.
2. Once Connect MIDI has been chosen in this page, the state comes from the latest request and,
   once that request resolved, from the access it gave (rows 3 to 10). The permission query no
   longer chooses the state. Its one effect is the `change` event of the kept
   `PermissionStatus`, which is row 7.
3. Only before the first Connect MIDI does the query choose the state (rows 11 to 13). These
   rows read the kept `PermissionStatus`'s current `state`, which its `change` event updates.

Each cause names its phase (row 5 has one cause in each), so no two causes hold at once, and
every row is reached by its own cause. The order sets only the order of the checks. Choosing
Connect MIDI again starts a new request, and the state follows that request. Without a kept
`PermissionStatus` (row 11), a revocation is not detected, and the state stays what the access
reports.

`{site}` is `location.host` on http(s) and "this page" on `file://`. `{names}` is the `name`
values of the connected inputs, joined by ", ". `{name}` is the `name` of the port in the
`statechange` that left no input connected. An empty name reads "unnamed input" in both.
`{error}` is the rejection's `name`. "Gate builds without the seam" is the measured darwin arm64
record above. "Seam only" means V501 can produce the state only through the stub.

| # | State | Cause (how the page detects it) | Exact copy | Gate builds without the seam |
|---|---|---|---|---|
| 1 | `insecure` | `window.isSecureContext` is false. This is checked first, so a missing API in an insecure page is not called unsupported | "MIDI is unavailable: this page is not in a secure context. Open it over https." | Not from the gate's origins: `file://` and 127.0.0.1 are secure in all three. Chromium, Firefox and WebKit when served over plain http on a LAN address (a server condition, not the seam) |
| 2 | `unsupported` | Secure context, and `typeof navigator.requestMIDIAccess` is not `"function"`. The test is on the method, not on `MIDIAccess`, which Firefox exposes on `file://` without the method | "MIDI is unavailable: this browser offers no Web MIDI here." | WebKit, every origin; Firefox on `file://` |
| 3 | `pending` | Connect MIDI was chosen, and the latest request has not settled | "Waiting for the browser's answer about MIDI access. The rest of OSCILLA keeps working." | Firefox on 127.0.0.1, with or without the policy, for the 3.0 to 12.9 s before the request rejects (row 4). A check asserts it by a condition poll against a named deadline, never by a fixed wait (`project.bounded-test-timing`). In Chromium the request settles within 15 ms without a grant (up to 711 ms with one), too short to assert |
| 4 | `blocked` | The latest request rejected with `SecurityError`. This covers a permissions-policy block and a browser that allows MIDI only through a site permission add-on; the page does not tell them apart | "MIDI is blocked for {site}: the browser or the site's settings do not let this page use MIDI. Some browsers allow it only after a site permission add-on is installed." | Firefox on 127.0.0.1, with or without the policy ("WebMIDI requires a site permission add-on to activate"). Chromium only on 127.0.0.1 served with the policy (a server condition, not the seam), which before Connect MIDI is row 5 |
| 5 | `denied` | The latest request rejected with `NotAllowedError`. Or, before any Connect MIDI, the query reads `denied` | "MIDI access is not allowed for {site}. Allow MIDI in the browser's site settings, then choose Connect MIDI again." | After Connect MIDI: Chromium, `file://` and 127.0.0.1 (the request rejects; the query still reads `prompt` and no longer chooses the state). Before Connect MIDI: Chromium on 127.0.0.1 served with the policy only |
| 6 | `failed` | The latest request rejected with `NotSupportedError` or any other name (for one, no platform MIDI backend) | "MIDI could not start on this computer (the browser reported {error})." | Not on darwin arm64, where Chromium resolves. `ubuntu-latest` not measured (V501); otherwise seam only |
| 7 | `revoked` | The latest request resolved, and since then the kept `PermissionStatus` changed to anything but `granted`. The page stops listening and drops the access | "MIDI access was withdrawn for {site}. Choose Connect MIDI to ask again." | Chromium, `file://` and 127.0.0.1: grant `midi` and `midi-sysex`, choose Connect MIDI, then clear the grant (`change` fires, `granted` to `prompt`; the access fires nothing) |
| 8 | `connected` | The latest request resolved, not revoked, and at least one input has `state` `connected` | "MIDI is on: {names}." | Seam only |
| 9 | `disconnected` | The latest request resolved, not revoked, no input is connected, and an input was connected earlier under this access (a `statechange` took the last one away) | "MIDI input disconnected: {name}. No MIDI input is connected." | Seam only |
| 10 | `no-devices` | The latest request resolved, not revoked, no input is connected, and none was connected under this access | "MIDI is on. No MIDI input is connected; plug one in and it appears here." | Chromium, `file://` and 127.0.0.1, with the grant `midi` and `midi-sysex` (`midi` alone still rejects, row 5) |
| 11 | `unknown` | Before any Connect MIDI: `navigator.permissions.query` is missing, or `query({ name: 'midi' })` throws or rejects | "MIDI is off. The browser does not say whether MIDI is allowed for {site}; Connect MIDI asks it." | Seam only (WebKit's query rejects, but WebKit has no API and stops at row 2) |
| 12 | `needs-permission` | Before any Connect MIDI: the query reads `prompt` | "MIDI is off. Connect MIDI asks the browser for access to MIDI devices for {site}." | Chromium, `file://` and 127.0.0.1; Firefox on 127.0.0.1, with or without the policy |
| 13 | `allowed` | Before any Connect MIDI: the query reads `granted` | "MIDI is allowed for {site}. Choose Connect MIDI to start listening." | Chromium, `file://` and 127.0.0.1, with the grant `midi` (alone, or with `midi-sysex`) |

When one of several inputs disconnects and others stay connected, the state stays `connected`
with the remaining names. When a device is plugged in after `no-devices` or `disconnected`, the
state becomes `connected`. In no row does the copy name a browser. In every row, everything
outside the MIDI surface stays as it is.

**Corrected before landing (review of pull request #211, 2026-10-18).** The first version of
this note (commit 9ef1585) was corrected in place before it merged:

- It stated the first cause that holds, with the load-time query ranked above the request's
  outcomes. So `pending`, `denied` after a request, `blocked`, `failed` and `revoked` could not
  be stated while the query read `prompt`, and `no-devices` hid `disconnected`. The table now
  ranks what happened after Connect MIDI above the load-time query, and every cause names its
  phase. The states are the same thirteen.
- It recorded Firefox on 127.0.0.1 as leaving the request pending, and as rejecting with
  `SecurityError` only under `Permissions-Policy: midi=()`. That was an artefact of a fixed 5 s
  cut-off. Measured to settlement, Firefox rejects with `SecurityError` with or without the
  policy, after 3.0 to 12.9 s in 32 runs. So `blocked` is reached from the gate's own origin,
  and `pending` only for that time.
- It said WebKit refuses a `midi` grant. WebKit accepts the grant, which changes nothing
  without the API.
- It named the stub's ADR 0052 kind as Inject, TEST CONTEXT only. The stub is outside those
  member kinds (see the seam above).
- Row 1's copy advised opening the page from a file, which in Firefox's gate build leads to
  `unsupported`. Row 13 (now 9) used `{name}`, which the note did not define.

### 2026-10-29: how notes sound through the engine (V502)

**Note of 2026-10-29 (V502), no section above changes.** Decision 1 says voices sound through
the existing engine and its safety limits. The critique of `midi-jam-companion` found five open
questions for that (`polyphony-contradicts-voice-replacement`,
`velocity-curve-and-message-semantics`, `held-notes-and-drone-vs-safety-limit`,
`stuck-notes-have-no-criterion`, `output-ownership-with-measure-and-studio`). This note states
what V502 built for each. The findings stay open until a critic re-reviews them against it, and
the status stays `proposed`.

- **Polyphony, without amending ADR 0002.** `play()` keeps its one voice and ADR 0002's rule
  that a new voice fades every earlier one out first. Notes are a second kind of voice of the
  same engine: `engine.noteOn(key, o)`, `noteOff(key)`, `notesOff(fast)` and `noteCount` in
  `src/js/audio/audio-engine.js`. A note is a voice in `voices`, never `voice`, built through
  the engine's own accounting (osc, env, fade, cut, master), so `stop`, Escape (`stopAll`),
  `revokeContinuous`, a replacing `play()` and a closed context free it as they free any voice.
  A note and the `play()` voice never sound together: each one's start fades the other out
  first (FAST_RELEASE_S) and starts once that fade has ended. The sequencer plays into the
  engine's master outside `voices`, so it is kept apart from notes in the MIDI layer instead:
  starting a sequence fades every note within ESCAPE_RELEASE_S (`main.js`, around the editor's
  `play`), and a Note On is refused while the sequencer plays.
- **The bound and the gain law.** At most `NOTE_POLYPHONY` (8) notes sound at once. Each peaks
  at `level / NOTE_POLYPHONY`, so the notes together never exceed one voice's level: notes,
  with or without the `play()` voice, stay under the master level (at most `MAX_OUTPUT_GAIN`)
  without relying on the ceiling. What this does not cover: the sequencer's start overlaps the
  notes' fade (at most ESCAPE_RELEASE_S), as a `play()` tone and a stopping sequence overlap
  today; there the limiter and the ceiling are the bound. A ninth
  note fades out the oldest note already releasing, or else the oldest held one, within
  FAST_RELEASE_S, and starts when that fade has ended. The price is level: one note at full
  velocity is 18 dB under a `play()` tone at the same master level. This is a decision, not a
  measurement of what players want.
- **Velocity.** Amplitude `(velocity / 127)^2`, that is `40 log10(velocity / 127)` dB
  (`velocityLevel` in `src/js/midi/notes.js`). Chosen here; it is not claimed to be any
  standard's curve. The engine raises a note's peak to GAIN_FLOOR (-80 dB), so velocities 1 to
  3 sound at that floor, above the law; from velocity 4 the law holds exactly.
- **Messages.** Every channel is heard (omni); a key is input, channel and note, so the same
  note on two channels or two inputs is two notes. Note On with velocity 0 is a Note Off. A
  repeated Note On for a sounding key fades the old note out under the new one. A Note Off for a
  key that is not sounding changes nothing. CC 120 (All Sound Off) fades every note within
  ESCAPE_RELEASE_S; CC 123 (All Notes Off) releases every note with its release time. Every
  other message, CC 64 (sustain) included, is ignored in the first version. Pitch is
  `midiToFrequency(note, A4)` with the Playground's A4; waveform, attack and release are the
  Playground's. The Labs stages `play()` adds (filter, ADSR, additive) do not apply to notes.
- **The safety limit.** A note obeys the session safety limit exactly as HOLD does: without the
  continuous permission it ends at the limit (2 s by default) with the key still down, and
  withdrawing the permission releases the notes it lengthened. A drone (V503) is not decided
  here.
- **The 0.95 × Nyquist bound.** A note whose frequency is at or above `safeMaximum` of the
  running context is refused (nothing is scheduled), never clamped to a wrong pitch.
- **Nothing keeps sounding.** Every note fades within ESCAPE_RELEASE_S when any input that was
  listened to leaves (a `statechange` that disconnects it; every note stops, not only that
  input's: the safe side), when the access is withdrawn (`revoked`) or replaced by a new Connect
  MIDI, when the page is hidden (`visibilitychange`, `pagehide`), on Escape, when Measure or
  Studio PLAY takes the output (`stopPlayback` in `main.js`) and when the sequencer starts.
  Window blur does not stop notes: a Note Off still arrives while another window has the focus.
- **Who owns the output.** While a measurement, a level reference capture, the Studio transport
  or the sequencer owns the output a Note On is refused, and the page says so once per run of
  refused notes (an info notice, the sentences of `MIDI_REFUSED` in `src/js/midi/ui.js`, quoted
  in `docs/midi.md`), not per note.

What V502 does not decide: latency and the clock mapping of `MIDIMessageEvent.timeStamp`
(finding `latency-and-clock-mapping-unstated`: a note starts at `currentTime + START_OFFSET_S`
when its message is handled, later when a fade must end first); sustain; a recorded check on
real hardware (finding `no-real-device-check`). Every proof is on the fake audio context
(`tests/unit/midi/notes.test.mjs`) and on synthetic MIDI events from the stub in the gate builds
(`tests/browser/midi.cjs` check `midi-seam-notes`).
