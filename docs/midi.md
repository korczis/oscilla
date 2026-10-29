# MIDI input in OSCILLA

MIDI is an optional input layer over the audio engine (ADR 0058,
`.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md`). This page
describes what its first two pieces do. V501: OSCILLA detects Web MIDI and its permission at
runtime, lists the connected inputs and states one support state. V502: the notes of the
connected inputs sound through the audio engine (see "Playing notes" below). When MIDI is
missing, nothing outside the MIDI surface changes.

## Where it is

Settings (the gear in the status bar, or Settings… in the menu) has a **MIDI input** section: a
status line that states the support state, and the button **Connect MIDI**, which works by
pointer and by keyboard.

- Loading the page never asks for MIDI access and shows no prompt. At load the page reads only
  `window.isSecureContext`, `typeof navigator.requestMIDIAccess` and one
  `navigator.permissions.query({ name: 'midi' })`, which the Permissions API defines as never
  prompting. If that query has not answered within 2 s (`MIDI_QUERY_TIMEOUT_MS`), the state is
  `unknown` and Connect MIDI is offered; a later answer still sets the state.
- Where Connect MIDI is not offered (`insecure`, `unsupported`) its whole row is hidden.
- Only Connect MIDI asks the browser for access, always with `{ sysex: false }`. Choosing it
  again asks again; the state follows the latest request.
- A permission already granted does not connect by itself: it reads "allowed" until Connect
  MIDI is chosen.
- The permission belongs to the origin, not to OSCILLA. On GitHub Pages that origin
  (`korczis.github.io`) is shared by every Pages site of the account, so a grant or a denial
  made on another of them applies here too. The copy names the origin's host; on `file://` it
  says "this page", because which origin a browser keys a file's permission to was not measured.
- Nothing about MIDI is stored and nothing leaves the page: no device name is persisted and the
  MIDI path makes no network call.

## The support states

The page holds one state at a time. The context is checked first; once Connect MIDI has been
chosen, the latest request (and the access it gave) decides; only before the first Connect MIDI
does the permission query decide. `{site}` is the host over http(s) and "this page" on
`file://`; `{names}` the connected inputs' names joined by ", "; `{name}` the input whose
disconnection left none connected; `{error}` the name of the browser's error. An empty device
name reads "unnamed input". The copy is `MIDI_COPY` in `src/js/midi/support.js`, and
`tests/unit/midi/support.test.mjs` holds it to the table of ADR 0058.

| State | When | Copy |
|---|---|---|
| `insecure` | the page is not in a secure context (Connect MIDI not offered) | MIDI is unavailable: this page is not in a secure context. Open it over https. |
| `unsupported` | secure, but the browser has no `navigator.requestMIDIAccess` (Connect MIDI not offered) | MIDI is unavailable: this browser offers no Web MIDI here. |
| `pending` | Connect MIDI was chosen and the browser has not answered | Waiting for the browser's answer about MIDI access. The rest of OSCILLA keeps working. |
| `blocked` | the request was refused with `SecurityError` | MIDI is blocked for {site}: the browser or the site's settings do not let this page use MIDI. Some browsers allow it only after a site permission add-on is installed. |
| `denied` | the request was refused with `NotAllowedError`, or before Connect MIDI the permission reads `denied` | MIDI access is not allowed for {site}. Allow MIDI in the browser's site settings, then choose Connect MIDI again. |
| `failed` | the request failed with any other error | MIDI could not start on this computer (the browser reported {error}). |
| `revoked` | access was given, then the permission was withdrawn; the page stops listening | MIDI access was withdrawn for {site}. Choose Connect MIDI to ask again. |
| `connected` | access was given and at least one input is connected | MIDI is on: {names}. |
| `disconnected` | access was given, an input was connected and the last one went away | MIDI input disconnected: {name}. No MIDI input is connected. |
| `no-devices` | access was given and no input has been connected | MIDI is on. No MIDI input is connected; plug one in and it appears here. |
| `unknown` | before Connect MIDI, the browser cannot answer the permission query | MIDI is off. The browser does not say whether MIDI is allowed for {site}; Connect MIDI asks it. |
| `needs-permission` | before Connect MIDI, the permission reads `prompt` | MIDI is off. Connect MIDI asks the browser for access to MIDI devices for {site}. |
| `allowed` | before Connect MIDI, the permission reads `granted` | MIDI is allowed for {site}. Choose Connect MIDI to start listening. |

## What the gate builds do, measured

`tests/browser/midi.cjs` measures the three browser builds the release gate runs (Playwright
1.63.0) from `file://` and from `http://127.0.0.1:<port>/oscilla/`, in browser contexts with no
MIDI test script, and prints each result on a `RECORD` line. The http origin is the Pages-like
sub-path served locally on 127.0.0.1, not the Pages origin `https://korczis.github.io`: no check
loads the deployed site, so nothing here is a measurement of Pages itself, and each `RECORD`
line names its origin that way. On darwin arm64 (2026-10-28, the same builds ADR 0058 probed):

| Gate build | `file://` | `http://127.0.0.1:<port>/oscilla/` (Pages-like, not Pages) |
|---|---|---|
| Chromium 153.0.8010.12 | `needs-permission`; Connect MIDI ends `denied`. With Playwright's `midi` grant: `allowed`, then `denied`; with `midi` and `midi-sysex`: `allowed`, then `no-devices`, and clearing the grant reads `revoked` | as `file://` |
| Firefox 155.0 | `unsupported` (Connect MIDI not offered) | `needs-permission`; Connect MIDI shows `pending`, then `blocked` after several seconds: 7.0 s, 9.99 s and 9.98 s in three V501 runs on 2026-10-28 (ADR 0058 measured 3.0 to 12.9 s over 32 runs; the suite allows up to 60 s) |
| WebKit 26.6 | `unsupported` | `unsupported` |

These are gate builds, not the browsers people install: no statement here says what a released
browser does. The CI runners (`ubuntu-latest`) were not measured when this was written; there
the suite accepts the states ADR 0058 allows for a platform that may have no MIDI backend
(`denied` or `failed`, and `no-devices` or `failed` with the grant) and records what it saw. A
Chromium request still `pending` at its deadline there is recorded as such ("pending at the
30000 ms deadline", with the pending copy checked) rather than failed, and the revocation check
is then skipped, because there is no access to withdraw; on darwin the same outcome fails.
`insecure` is reached only over plain http on a non-local address, which no gate origin is, and
`connected`, `disconnected` and the other states without a real device are proved with the test
seam below.

## Playing notes

Once Connect MIDI has connected an input, its notes sound through the one audio engine, with the
Playground's waveform, attack, release and A4 tuning. There is no second synthesizer; the
decisions are the V502 note of ADR 0058.

- **Polyphony.** Up to 8 notes (`NOTE_POLYPHONY`) sound at once. Each is scaled to one eighth of
  a full voice, so a full chord never exceeds the level of one Playground tone at the same
  output level; one note is therefore 18 dB quieter than a Playground tone. A ninth note fades
  out the oldest note (one already releasing first) and starts when that fade has ended.
- **Velocity.** Amplitude `(velocity / 127)^2`: velocity 127 is full level, 64 about -12 dB,
  32 about -24 dB.
- **Messages.** Every channel is heard. Note On with velocity 0 is a Note Off. Playing a key that
  is still sounding restarts it. CC 120 (All Sound Off) stops every note at once; CC 123 (All
  Notes Off) releases them. Sustain (CC 64) and every other message are ignored for now.
- **Safety.** A note that would sound at or above 95 % of the context's Nyquist frequency is not
  played. A held note obeys the safety limit like HOLD TO PLAY: without the continuous
  permission it stops at the limit (2 s by default) even with the key down.
- **Stopping.** Every note stops within a few milliseconds when its input is unplugged, when the
  MIDI access is withdrawn or Connect MIDI is chosen again, when the page is hidden, on Escape,
  and when a measurement or the Studio takes the output. Switching to another window does not
  stop notes: their Note Off still arrives.
- **The output.** A note and a Playground tone never sound together: whichever starts fades the
  other out first. While a measurement or the Studio is playing, notes are refused, and OSCILLA
  says so once.

`tests/unit/midi/notes.test.mjs` proves this on a fake audio context; `tests/browser/midi.cjs`
check `midi-seam-notes` plays synthetic MIDI events from the test seam into the built page in
the three gate builds and counts the oscillators independently. No check plays a real device,
and latency is not measured.

## How it is tested without hardware

The seam is `tests/browser/lib/midi-stub.cjs`, installed with `context.addInitScript` before any
page script runs. It replaces `navigator.requestMIDIAccess` and returns a fake `MIDIAccess`
whose inputs name themselves "TEST STUB · MIDI input" (manufacturer "OSCILLA test"), so anything
shown under it says so. It is not part of the page and does not ship in `dist/index.html`. A
check that uses it is a seam check and says "handles (stubbed API)"; only a measured check
supports a statement about a gate build. In the gate builds that have the real interfaces, a
measured check compares the members the page reads on the stub's objects with them.
