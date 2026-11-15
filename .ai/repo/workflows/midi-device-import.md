# Importing MIDI device facts

How a controller's facts reach OSCILLA (plan issue V507, rule `project.midi-profiles-derived`).
The maker's files stay where they were installed; the repository holds what is derived from
them and the tool that derives it again.

| Step | Run | What it gives |
|---|---|---|
| 1. derive | `node scripts/midi/derive-devices.mjs` | `src/data/midi-devices.json`, the generated region of `docs/midi-devices.md`, and the full decode under `.local/midi/` (ignored) |
| 2. check | `node scripts/midi/derive-devices.mjs --check` | exit 0 when the committed files equal a fresh derivation; on CI (no install) it says so and passes |
| 3. measure | `swift scripts/midi/identity.swift` | each connected device's Universal SysEx Identity reply, to compare with the profile's identity numbers |
| 4. listen | `swift scripts/midi/listen.swift [seconds]` | every message each port sends while the device is played, to check the factory messages and the port roles |
| 5. bind | edit `src/js/midi/devices.js` only for a new port role or control kind | the labels the page shows |
| 6. prove | `node --test tests/unit/midi/*.test.mjs` and `node tests/browser/midi.cjs` | the rule's test and the seams through the stub device |
| 7. record | the plan issue's `current_state` | the editor version, the device replies and the date |

Facts that need step 3 or 4 are recorded with the device, the firmware the identity reply gave
and the date. A protocol detail neither the files nor a measurement give is not assumed: the
feature that needs it waits for the measurement.

The sequence on the owner's Mac (2026-11-15): MIDI Control Center 1.23.0.134, 11 device
profiles, 30 plug-in maps; KeyLab mkII 61 identity `00 20 6B / 02 00 / 05 64`, BeatStep Pro
`00 20 6B / 02 00 / 07 00`, firmware 2.0.1.6.
