# MIDI input in OSCILLA

MIDI is an optional input layer over the audio engine (ADR 0058,
`.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md`). This page
describes what the first piece of it (plan issue V501) does: OSCILLA detects Web MIDI and its
permission at runtime, lists the connected inputs and states one support state. Notes do not
sound yet; that is V502. When MIDI is missing, nothing outside the MIDI surface changes.

## Where it is

Settings (the gear in the status bar, or Settings… in the menu) has a **MIDI input** section: a
status line that states the support state, and the button **Connect MIDI**, which works by
pointer and by keyboard.

- Loading the page never asks for MIDI access and shows no prompt. At load the page reads only
  `window.isSecureContext`, `typeof navigator.requestMIDIAccess` and one
  `navigator.permissions.query({ name: 'midi' })`, which the Permissions API defines as never
  prompting.
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
1.63.0) from `file://` and from `http://127.0.0.1/oscilla/`, in browser contexts with no MIDI
test script, and prints each result on a `RECORD` line. On darwin arm64 (2026-10-28, the same
builds ADR 0058 probed):

| Gate build | `file://` | `http://127.0.0.1` |
|---|---|---|
| Chromium 153.0.8010.12 | `needs-permission`; Connect MIDI ends `denied`. With Playwright's `midi` grant: `allowed`, then `denied`; with `midi` and `midi-sysex`: `allowed`, then `no-devices`, and clearing the grant reads `revoked` | as `file://` |
| Firefox 155.0 | `unsupported` (Connect MIDI not offered) | `needs-permission`; Connect MIDI shows `pending`, then `blocked` after several seconds (about 10 s in this run) |
| WebKit 26.6 | `unsupported` | `unsupported` |

These are gate builds, not the browsers people install: no statement here says what a released
browser does. The CI runners (`ubuntu-latest`) were not measured when this was written; there
the suite accepts the states ADR 0058 allows for a platform that may have no MIDI backend
(`denied` or `failed`, and `no-devices` or `failed` with the grant) and records what it saw.
`insecure` is reached only over plain http on a non-local address, which no gate origin is, and
`connected`, `disconnected` and the other states without a real device are proved with the test
seam below.

## How it is tested without hardware

The seam is `tests/browser/lib/midi-stub.cjs`, installed with `context.addInitScript` before any
page script runs. It replaces `navigator.requestMIDIAccess` and returns a fake `MIDIAccess`
whose inputs name themselves "TEST STUB · MIDI input" (manufacturer "OSCILLA test"), so anything
shown under it says so. It is not part of the page and does not ship in `dist/index.html`. A
check that uses it is a seam check and says "handles (stubbed API)"; only a measured check
supports a statement about a gate build. In the gate builds that have the real interfaces, a
measured check compares the members the page reads on the stub's objects with them.
