# MIDI input in OSCILLA

MIDI is an optional input layer over the audio engine (ADR 0058,
`.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md`). This page
describes its first pieces and the keyboard that shares their note voices. V501: OSCILLA
detects Web MIDI and its permission at runtime, lists the connected inputs and states one support
state. V502: the notes of the connected inputs sound through the audio engine (see "Playing
notes" below). K026: the computer and on-screen keyboard plays the same note voices (see "The
computer and on-screen keyboard"), and every key the page answers goes through one key registry
(see "Keys"). V506: a controller's knobs, faders and sustain pedal play the Synth panel (see
"Controllers"). When MIDI is missing, nothing outside the MIDI surface changes.

## Where it is

Settings (Nastavení: the gear in the status bar, or the menu) has a **MIDI input** section
(Vstup MIDI): a status line that states the support state, and the button **Connect MIDI**
(labelled „Připojit MIDI“, which the Czech copy quotes), which works by pointer and by keyboard.

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
  says "tuto stránku", because which origin a browser keys a file's permission to was not
  measured.
- Nothing about MIDI is stored and nothing leaves the page: no device name is persisted and the
  MIDI path makes no network call.

## The support states

The page holds one state at a time. The context is checked first; once Connect MIDI has been
chosen, the latest request (and the access it gave) decides; only before the first Connect MIDI
does the permission query decide. `{site}` is the host over http(s) and "tuto stránku" on
`file://`; `{names}` the connected inputs' names joined by ", "; `{name}` the input whose
disconnection left none connected; `{error}` the name of the browser's error. An empty device
name reads "nepojmenovaný vstup". The copy is `MIDI_COPY` in `src/js/midi/support.js`, and
`tests/unit/midi/support.test.mjs` holds it to the table of ADR 0058.

| State | When | Copy |
|---|---|---|
| `insecure` | the page is not in a secure context (Connect MIDI not offered) | MIDI není k dispozici: tato stránka neběží v zabezpečeném kontextu. Otevřete ji přes https. |
| `unsupported` | secure, but the browser has no `navigator.requestMIDIAccess` (Connect MIDI not offered) | MIDI není k dispozici: tento prohlížeč tu Web MIDI nenabízí. |
| `pending` | Connect MIDI was chosen and the browser has not answered | Čeká se na odpověď prohlížeče o přístupu k MIDI. Zbytek aplikace OSCILLA funguje dál. |
| `blocked` | the request was refused with `SecurityError` | MIDI je pro {site} blokované: prohlížeč nebo nastavení webu této stránce MIDI nedovolí. Některé prohlížeče ho povolí až po instalaci doplňku s oprávněním pro web. |
| `denied` | the request was refused with `NotAllowedError`, or before Connect MIDI the permission reads `denied` | Přístup k MIDI není pro {site} povolený. Povolte MIDI v nastavení webu v prohlížeči a pak znovu zvolte „Připojit MIDI“. |
| `failed` | the request failed with any other error | MIDI se na tomto počítači nepodařilo spustit (prohlížeč ohlásil {error}). |
| `revoked` | access was given, then the permission was withdrawn; the page stops listening | Přístup k MIDI byl pro {site} odebrán. Zvolte „Připojit MIDI“ a požádejte o něj znovu. |
| `connected` | access was given and at least one input is connected | MIDI je zapnuté: {names}. |
| `disconnected` | access was given, an input was connected and the last one went away | Vstup MIDI odpojen: {name}. Není připojený žádný vstup MIDI. |
| `no-devices` | access was given and no input has been connected | MIDI je zapnuté. Není připojený žádný vstup MIDI; připojte ho a objeví se tady. |
| `unknown` | before Connect MIDI, the browser cannot answer the permission query | MIDI je vypnuté. Prohlížeč neříká, zda je MIDI pro {site} povolené; „Připojit MIDI“ se ho zeptá. |
| `needs-permission` | before Connect MIDI, the permission reads `prompt` | MIDI je vypnuté. „Připojit MIDI“ požádá prohlížeč o přístup k zařízením MIDI pro {site}. |
| `allowed` | before Connect MIDI, the permission reads `granted` | MIDI je pro {site} povolené. Zvolte „Připojit MIDI“ a OSCILLA začne poslouchat. |

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

Once Connect MIDI has connected an input, its notes play the one instrument (K247, ADR 0058's
K247 note): in every workspace the Studio document's note target (its routed node, else its first
node that plays notes), and where it has none the Synth panel, which lives in the same document.
The computer keys and the on-screen keys play the same instrument. There is no second
synthesizer and no voice of a page's own: the Studio transport is a graph of the one audio
engine. The one exception is a Studio document of the user's that plays no notes and whose
Master Output the Synth panel would have to take: a key never rewires it, so there the keys play
the engine's own voice (its laws, as V502 set them, are below) until **Vložit** puts the panel in.
In the Studio workspace a key never inserts the panel into the document in sight: there the keys
play the document's note target, else the engine's voice. In any other workspace, where the
document holds nothing that plays notes and the panel may go in by itself (the untouched default
document, or nothing of the user's would be cut), the first key inserts it and says so at once: a
warning notice with K246's whole sentence (what went in, whose Master Output input it took) and
its own **Zpět**, which undoes the insert right there while it is still the document's last
change.

- **The instrument's voices.** The Keys node of the Synth panel is monophonic (the last key
  wins); an engine routed as the note target plays its own polyphony. Velocity reaches the node
  the keys play. Every voice is under the safety chain's output ceiling (`MAX_OUTPUT_GAIN`), and
  a frequency at or above 95 % of the context's Nyquist frequency is clamped to it, never played
  above it.
- **The engine voice (a page without the Synth).** Up to 8 notes (`NOTE_POLYPHONY`), each one
  eighth of a full voice; amplitude `(velocity / 127)^2`; a note at or above 95 % of Nyquist is
  not played; the Playground's waveform, attack, release and A4 tuning apply.
- **Messages.** Every channel is heard. Note On with velocity 0 is a Note Off. Playing a key that
  is still sounding restarts it. CC 120 (All Sound Off) stops every note at once; CC 123 (All
  Notes Off) releases them. Sustain (CC 64) holds released keys (V506); the controllers are below.
- **Safety.** A held note is exempt from the safety limit while its key is down (ADR 0062, amending
  ADR 0005): it sounds until its Note Off, under the same output ceiling, and never louder for
  being held.
- **Stopping.** Every note stops within a few milliseconds when any connected input is
  unplugged (every note, not only that input's), when the MIDI access is withdrawn or Connect
  MIDI is chosen again, when the window loses the focus (a Note Off may never arrive while
  another window has it; ADR 0062), when the page is hidden, on Escape, when a measurement or the
  Studio takes the output, and when the sequencer starts.
- **The output.** A note and a Playground tone never sound together: whichever starts fades the
  other out first. Starting a sequence stops the notes, which fade within 8 ms as the sequence
  begins; once it plays, notes sound over it (U139: playing over a running pattern is the
  instrument's basic case). A held note leaves the sequence playing, its release leaves the
  sequence untouched, the status bar goes on naming the sequence, and Escape stops both.
  While a measurement runs, a level reference is being captured from the microphone
  or the Studio is playing, notes are refused too (a loopback reference capture records the
  output itself, so there notes play, as the Playground tone does). These rules, and the
  sentences below, are rows of the one output-owner table (`src/js/ui/output-owner.js`, plan
  issue C036). OSCILLA says so once per run of refused notes, with one of these sentences:
  - "MIDI noty nehrají, dokud výstup patří měření: nejdřív ho zastavte (Esc)."
  - "MIDI noty nehrají, dokud se z mikrofonu snímá referenční úroveň."
  - "MIDI noty nehrají, dokud hraje Studio: nejdřív ho zastavte."

`tests/unit/midi/notes.test.mjs` proves this on a fake audio context; `tests/browser/midi.cjs`
check `midi-seam-notes` plays synthetic MIDI events from the test seam into the built page in
the three gate builds and counts the oscillators independently. No check plays a real device,
and latency is not measured.

## The computer and on-screen keyboard

Every workspace has the same keyboard (plan issues K026, K178, K247): it plays the one
instrument a MIDI input plays, with the same limits and refusals; a refusal says "Noty z
klávesnice nehrají, dokud …" instead of "MIDI noty".

- **Armed everywhere.** The keys are armed when a workspace first opens (Q105); **Odpojit
  klávesy** switches them off in that workspace only, and a link with `kbd=1` or `kbd=0` arms
  or disarms the workspace it opens. The key leaves the address with the next workspace change.
- **One dock.** The keyboard docks over the bottom edge of every workspace but the Playground,
  whose keys stay under its panels. On a page that is not an instrument (Measure, the labs,
  About and the others) it starts folded to its handle, **Keyboard**, and the computer keys
  still play; the handle unfolds the same keys.
- **The run ends with the page.** The first key arms the instrument; leaving the workspace ends
  that armed run (a run started with PLAY sounds on).
- **The keys**, by physical position (`KeyboardEvent.code`), so QWERTZ and AZERTY keyboards play
  from the same places: A W S E D F T G Y H U J K play C up to the next C (black keys on W E T
  Y U), O L P ; ' go on to F. Z and X move the octave down and up (C0 to C8), C and V the
  velocity (steps of 20, 1 to 127). The readout says the range and the velocity; the
  on-screen keys show which letter plays which key (the printed letter where the browser tells
  the layout).
- **Never in the way.** Space is never a keyboard key: it stays the workspace's play key (ADR
  0050). A key typed in a text field, a select or an open dialog is left alone, and so is any
  key with Ctrl, Meta or Alt. Armed in the Studio, A, C, F and T play notes instead of their
  Studio meanings; Studio's Ctrl / ⌘ shortcuts are unchanged.
- **Held.** A note sounds while its key or pointer is down, past the safety limit, and stops on
  release, Escape, a window blur, a hidden page, or when the workspace is left or disarmed.
- **On screen.** Two or three octaves (by width) that follow the octave. A pointer plays the key
  under it and a drag glides from key to key. A key lights up while it sounds, whoever plays it:
  the computer keyboard or a pointer in the accent colour, a MIDI input in green. While a note
  sounds the analysis views show the live output.

`tests/unit/keyboard-held-notes.test.mjs` and `tests/unit/midi/keyboard.test.mjs` prove this
without a browser; `tests/browser/midi.cjs` check `keyboard-qwerty` plays the keys and the
on-screen keys in the three gate builds, and `tests/browser/navigation.cjs` check
`keyboard-link` follows the link key.

## Keys

Every key the page answers, the keyboard's notes, Space, Escape and the workspaces' shortcuts,
is bound in one key registry (`src/js/ui/keys/registry.js`, plan issue K153) and heard by one
dispatcher (`src/js/ui/keys/dispatcher.js`), the page's only key listener; no feature adds its
own.

- **One owner per chord and scope.** A binding names its chord (a `KeyboardEvent.code` with its
  modifiers, so a layout never moves it) and its scope: the workspace, optionally a view inside
  it, and the focus (`none`, a text field, a control, the piano, a dialog). A second binding of
  the same chord in the same scope throws when it is made, so a conflict cannot ship.
- **The most specific binding wins.** A view's binding overrides its workspace's, and a
  workspace's overrides one bound everywhere; a binding may also say when it applies.
- **What passes through.** IME composition, typing in a text field, a focused control's own keys
  (Space, Enter, arrows, Home, End and paging on a button, slider, tab, menu item or option), an
  open dialog's keys and every chord nobody owns are left to the browser.
- **Held keys.** A binding runs once per press; auto-repeat is swallowed unless the binding asks
  for it, and its release runs on keyup, or for every key still held when the window loses focus
  or the page is hidden, so a held note never sticks.
- **Menus and lists.** A menu, list box or radio group walks its items through one helper
  (`src/js/ui/keys/roving.js`: arrows, Home and End, Escape back to its button) instead of a
  listener of its own.
- **The help.** The shortcuts help lists the registry's bindings with their labels and scopes.

`tests/unit/keys-registry.test.mjs` proves the registry and the dispatcher, and its ratchet
fails when a key listener outside `src/js/ui/keys/` is added
(`tests/unit/key-listener-baseline.json` only shrinks).

## How it is tested without hardware

The seam is `tests/browser/lib/midi-stub.cjs`, installed with `context.addInitScript` before any
page script runs. It replaces `navigator.requestMIDIAccess` and returns a fake `MIDIAccess`
whose inputs name themselves "TEST STUB · MIDI input" (manufacturer "OSCILLA test"), so anything
shown under it says so. It is not part of the page and does not ship in `dist/index.html`. A
check that uses it is a seam check and says "handles (stubbed API)"; only a measured check
supports a statement about a gate build. In the gate builds that have the real interfaces, a
measured check compares the members the page reads on the stub's objects with them.

## Controllers: knobs, faders and the sustain pedal (V506)

The decisions are ADR 0058's V506 note; the code is `src/js/midi/notes.js` (the pedal) and
`src/js/synth/midi-cc.js` (the knobs), reached from `src/js/midi/ui.js` `midiControl`.

**The pedal.** CC 64 at 64-127 holds every key of its input and channel whose Note Off arrives
while it is down; below 64 releases them. A key pressed again under the pedal sounds until its
own Note Off. Blur, page hide, Escape, a lost input, CC 120, CC 123 and every silence are never
held. The pedal works in every workspace, wherever the keys play.

**The knobs and faders.** Every other CC moves one control of the Synth panel, only while the
Synth workspace is shown. The value v (0-127) is the position v / 127 along the control's own
scale (a log cutoff sweeps in equal ratios); the first message of a turn jumps the control to
the controller's position. A run of messages on one control is one undo entry. The Synth's
status line says `CC 74 → LPF Cutoff: 1.2 kHz`, at most every 400 ms for the same control.

| Controller (KeyLab mkII factory mode) | CC | Panel tab | Engines tab |
|---|---|---|---|
| Encoder 1 | 74 | LPF Cutoff | (same) |
| Encoder 2 | 71 | LPF Peak | (same) |
| Encoder 3 | 76 | MG / LFO Rate | (same) |
| Encoder 4 | 77 | LPF MG → cutoff | (same) |
| Encoder 5 | 93 | MG / LFO Morph | (same) |
| Encoder 6 | 18 | LPF EG 2 → cutoff | (same) |
| Encoder 7 | 19 | VCO 1 EG 1 → pitch | (same) |
| Encoder 8 | 16 | HPF Cutoff | (same) |
| Encoder 9 | 17 | HPF Peak | (same) |
| Faders 1-4 (filter envelope) | 73, 75, 79, 72 | EG 2 attack, decay, sustain, release | the engine's attack, decay, sustain, release |
| Faders 5-8 (second envelope) | 80, 81, 82, 83 | EG 1 attack, decay, sustain, release | (same) |
| Fader 9 | 85 | OUTPUT Level | (same) |
| Modulation wheel | 1 | VCO 1 MG → pitch (vibrato) | (same) |
| Volume (General MIDI) | 7 | OUTPUT Level | (same) |
| Sustain pedal | 64 | holds released keys | (same) |

On this panel EG 2 is the filter envelope: it drives the LPF cutoff (normal n22) and the VCA
(n24). EG 1 is heard through its pitch amount, which encoder 7 sets.

**Where the layout comes from.** On 2026-11-14 the default MIDI configuration of the
classic-synth plug-ins installed on the owner's Mac (`plugin.prefmidi.xml` read with
`Reference_ParamNames.xml`, 20 instruments, read only) was compared slot by slot. The plug-ins
agree on the roles: CC 74 the filter cutoff and CC 71 its resonance (or the first two macros,
which are brightness and timbre), CC 73, 75, 79, 72 the filter envelope's attack, decay,
sustain and release, CC 80-83 the amplifier envelope's, CC 76 the LFO rate, CC 85 the master
volume, CC 16-19 secondary levels and amounts. The owner's KeyLab mkII 61 sent CC 71, 73-77 and
93 on channel 1 that day. Nothing of the plug-ins is in this repository: only the numbers and
the roles, which are facts of the controller's protocol.

**What it is not.** The layout is the panel's front panel in the player's hand: it writes the
stored value, as a drag does. A learned controller as a modulation source for any Studio
parameter is K077 (a `midi-cc` node), still planned. Other CCs, pitch bend, aftertouch, MIDI
clock and the controller's DAW port are not read yet.

## Known devices and the MIDI monitor (V507)

The Settings dialog's MIDI section lists every connected input with the known device it belongs
to and what its port is for, and shows a monitor of every message (`src/js/midi/monitor.js`):
notes, controllers, pitch bend, pressure, program changes, start, stop, song position and
SysEx, newest first, at most `MONITOR_ROWS` rows, redrawn at most every `MONITOR_FLUSH_MS`, each
row with the input and, for a known device, the physical control that sent it ("Enkodér 1 ·
CC 74 = 64 · kanál 1", "Pad 1 · Nota C2 (36) stisk 100 · kanál 10"). Clock ticks and active
sensing are not listed (they arrive 24 times a beat). Vymazat empties it. A DAW-control or editor
port of a known device never sounds a note. The profiles, where they come from and what is
measured on the devices are `docs/midi-devices.md`.

## Transport and clock (V508)

A controller's transport plays the workspace in view (`src/js/midi/transport.js`):

| Message | From | Action |
|---|---|---|
| Start (`FA`) | any input | the transport plays from the start |
| Continue (`FB`) | any input | the transport plays on from where it is |
| Stop (`FC`) | any input | the transport stops (the keys' armed run is kept) |
| Note On 94 / 93 / 91 / 86 (velocity > 0) | a DAW-control port (Mackie Control) | Play / Stop / Rewind to the start / Cycle (loop on or off) |
| Clock (`F8`, 24 per quarter note) | any input | measured: the MIDI section shows **Hodiny MIDI: … BPM** |

The transport is the Sequencer's own in the Sequencer and the Studio's everywhere else. A message
with nothing to do (Stop when stopped, Continue while playing) does nothing, nor does a Start or
Continue the Studio refuses (a measurement owns the output: the playhead stays where it was), and
the monitor row says only what each message did (`… → Studio: přehrát od začátku`). Record, Fast forward and the other
DAW buttons act on nothing. The clock's tempo is read over the last whole beat on the messages'
own timestamps and clears half a second after the clock stops; the transport never follows it by
itself (ADR 0058, its V508 note). OSCILLA sends MIDI only on an output you choose (below).

## Clock and transport out (V510)

In the MIDI section, **Hodiny a transport na výstup** picks one connected output; **Žádný** is
chosen on every load, and with it nothing is sent. The chosen output follows the transport in view
(the Sequencer's own in the Sequencer, the Studio's everywhere else), whatever starts or stops it:

| The transport | The output receives |
|---|---|
| starts from position 0 (seen within 0.25 s) | Start (`FA`) at its first beat, then Timing Clock (`F8`, 24 per quarter note) at its tempo |
| plays already (the output chosen later, the view back on it) or starts elsewhere | Song Position Pointer (`F2`) for the next sixteenth, Continue (`FB`) there, then the clock |
| starts again or jumps while sent | Stop (`FC`) first, then as above |
| changes tempo while playing | Stop, Song Position Pointer and Continue on the new beat grid |
| stops | Stop (`FC`) |

These messages need no SysEx and come under the same `{ sysex: false }` permission as the
input; MMC is SysEx (V511). A tempo change moves the device to the new grid rather than bending
its count, so its beats stay on OSCILLA's. Every message is stamped, and what is stamped earlier
reaches the device first: Stop comes after the last tick already sent ahead, and the new run no
earlier than it. Song Position Pointer counts at most 16383 sixteenths (about 34 minutes at
120 BPM); a device joining a run later than that is told the last position it can express, so its
bar count is wrong (its beats stay on the grid). Each tick is computed on the audio clock and sent ahead with its own
timestamp (`src/js/midi/clock-out.js`, `clock-out-mode.js`), so a busy page moves no tick; the
mapping from the audio clock to the page's clock is slewed by at most 0.02 ms per reading, since
the readings scatter (by several milliseconds in Firefox). An output that leaves, or stops taking
messages, is no longer followed, and the MIDI section says so once. ADR 0058, its V510 note.

**Measured.** In the browser gate, on the test stub's output: Start, then clock one tick of the
tempo apart within 0.05 ms, then Stop, in the Studio and the Sequencer, in Chromium, Firefox and
WebKit (`tests/browser/midi.cjs` `midi-seam-clock-out`). On hardware, the clock's jitter at the
owner's BeatStep Pro following it (`scripts/midi/listen.swift`) is **not measured yet**.

