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

**What the gate builds expose, measured.** On 2026-10-18 a probe script (outside the
repository) ran each gate build headless through Playwright 1.63.0, the version
`package.json` pins, on darwin arm64. It loaded a blank page from `file://`, from
`http://127.0.0.1` (the gate's own origins; `tests/browser/lib/serve.cjs` listens on
127.0.0.1), from plain http on the machine's LAN address, and from 127.0.0.1 with
`Permissions-Policy: midi=()`. "Pending" means unsettled after 5 s.

| Gate build | `file://` | `http://127.0.0.1` | plain http, LAN address | `Permissions-Policy: midi=()` |
|---|---|---|---|---|
| Chromium 153.0.8010.12 | API present; query `prompt`; request rejects `NotAllowedError` | as `file://` | not a secure context; API absent | query `denied`; request rejects `SecurityError` |
| Firefox 155.0 | `requestMIDIAccess` absent (the `MIDIAccess` interface exists); query `prompt` | API present; query `prompt`; request pending | not a secure context; API absent | query `prompt`; request rejects `SecurityError` ("WebMIDI requires a site permission add-on to activate") |
| WebKit 26.6 | API absent; query rejects `NotSupportedError` | as `file://` | as `file://`, not a secure context | as `file://` |

Granting permissions through Playwright works only in Chromium. Firefox and WebKit refuse the
permission name `midi`. In Chromium a grant of `midi` alone sets the query to `granted`, but
the request still rejects with `NotAllowedError`. A grant of `midi` and `midi-sysex` makes the
request resolve with no inputs and no outputs, on `file://` and on 127.0.0.1. When the grant is
cleared mid-session, the kept `PermissionStatus` fires `change` (`granted` to `prompt`). The
open `MIDIAccess` fires no `statechange`, and a new request rejects with `NotAllowedError`.
The CI runners (`ubuntu-latest`) were not measured. Whether Chromium there resolves with no
inputs or rejects for want of a platform MIDI backend is for V501's measured checks to record.
Where CI differs from this table, the gate column below is restated from V501's record.

**The seam: an `addInitScript` stub of `navigator.requestMIDIAccess` (option (a)).** No
`window.OSCILLA` member injects MIDI. The stub is one test helper that V501 adds under
`tests/browser/lib/` (`midi-stub.cjs`). A suite installs it with `context.addInitScript`
before any page script runs. It defines `Navigator.prototype.requestMIDIAccess` and returns a
fake `MIDIAccess` whose fake `MIDIInput`s dispatch `midimessage` events with a `Uint8Array`
`data` and a `timeStamp`, and `statechange` events with a `port`. The test drives the stub, not
the page. The probe installed such a stub, and a dispatched Note On reached a listener, in all
three gate builds from both origins. This option was chosen over a `window.OSCILLA` inject
member for three reasons. The page's own code path runs, from the request through the
listeners, exactly as it would for a device. The shipped surface does not grow. And a
`window.OSCILLA` hook that feeds notes would be a shipped way to play into the engine that no
user has.

- **Its ADR 0052 kind is Inject, TEST CONTEXT only.** It is not a member of `window.OSCILLA`
  and does not ship in `dist/index.html`. So the key lists pinned by `seam-surface-pinned` in
  `tests/browser/app.cjs` do not change for it. If V501 adds a read of the support state to
  the seam, that read is an Observe member, and the pinned list grows by that deliberate edit.
  No MIDI member of any kind is decided here.
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

**The support-state table.** The page evaluates the causes top to bottom and states the first
that holds. `{site}` is `location.host` on http(s) and "this page" on `file://`.
`{names}` is the connected inputs' `name` values, with "unnamed input" for an empty name,
joined by ", ". `{error}` is the rejection's `name`. "Gate builds without the seam" is the
measured darwin arm64 record above; "seam only" means V501 can produce the state only through
the stub.

| # | State | Cause (how the page detects it) | Exact copy | Gate builds without the seam |
|---|---|---|---|---|
| 1 | `insecure` | `window.isSecureContext` is false (checked first, so a missing API in an insecure page is not called unsupported) | "MIDI is unavailable: this page is not in a secure context. Open it over https or from a file." | Not from the gate's origins: `file://` and 127.0.0.1 are secure in all three. Chromium, Firefox and WebKit when served over plain http on a LAN address (a server condition, not the seam) |
| 2 | `unsupported` | Secure context, and `typeof navigator.requestMIDIAccess` is not `"function"` (detected on the method, not on `MIDIAccess`, which Firefox exposes on `file://` without the method) | "MIDI is unavailable: this browser offers no Web MIDI here." | WebKit, both origins; Firefox on `file://` |
| 3 | `unknown` | The API is present, and `navigator.permissions.query` is missing, or `query({ name: 'midi' })` throws or rejects | "MIDI is off. The browser does not say whether MIDI is allowed for {site}; Connect MIDI asks it." | Seam only (WebKit's query rejects, but WebKit has no API) |
| 4 | `needs-permission` | The query reads `prompt` | "MIDI is off. Connect MIDI asks the browser for access to MIDI devices for {site}." | Chromium, both origins; Firefox on 127.0.0.1 |
| 5 | `allowed` | The query reads `granted` and Connect MIDI has not been chosen in this page | "MIDI is allowed for {site}. Choose Connect MIDI to start listening." | Chromium, both origins, with the grant `midi` and `midi-sysex` |
| 6 | `pending` | Connect MIDI was chosen and `requestMIDIAccess` has not settled | "Waiting for the browser's answer about MIDI access. The rest of OSCILLA keeps working." | Firefox on 127.0.0.1 (pending after 5 s); not Chromium, which rejects at once |
| 7 | `denied` | The query reads `denied`, or the request rejected with `NotAllowedError` | "MIDI access is not allowed for {site}. Allow MIDI in the browser's site settings, then choose Connect MIDI again." | Chromium, both origins (the request rejects; the query stays `prompt`). A `denied` query appears in the gate only with the policy of row 8 |
| 8 | `blocked` | The request rejected with `SecurityError` | "MIDI is blocked for this page by the browser or the site's settings." | Chromium and Firefox on 127.0.0.1 served with `Permissions-Policy: midi=()` (a server condition, not the seam). Before a request, Chromium reads `denied` there and shows row 7 |
| 9 | `failed` | The request rejected with `NotSupportedError` or any other name (no platform MIDI backend, for one) | "MIDI could not start on this computer (the browser reported {error})." | Not on darwin arm64, where Chromium resolves. `ubuntu-latest` not measured (V501); otherwise seam only |
| 10 | `no-devices` | The request resolved, and no input has `state` `connected` | "MIDI is on. No MIDI input is connected; plug one in and it appears here." | Chromium, both origins, with the grant `midi` and `midi-sysex` (`midi` alone still rejects) |
| 11 | `connected` | At least one input has `state` `connected` | "MIDI is on: {names}." | Seam only |
| 12 | `revoked` | After access, the kept `PermissionStatus` changes to anything but `granted`. The page stops listening and drops the access | "MIDI access was withdrawn for {site}. Choose Connect MIDI to ask again." | Chromium, by clearing the grant mid-session (`change` fires; the access fires nothing) |
| 13 | `disconnected` | A `statechange` leaves no connected input where there was one | "MIDI input disconnected: {name}. No MIDI input is connected." | Seam only |

When one of several inputs disconnects and others stay connected, the state stays `connected`
with the remaining names. When a device is plugged in after `no-devices` or `disconnected`, the
state becomes `connected`. In no row does the copy name a browser. In every row, everything
outside the MIDI surface stays as it is.
