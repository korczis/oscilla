---
id: project.midi-profiles-derived
version: 1
kind: rule
title: MIDI device profiles are derived by tooling, and nothing of the maker's is committed
description: A device profile is written only by scripts/midi/derive-devices.mjs from the maker's files on a machine where they are installed; only derived facts reach the repository.
statement: src/data/midi-devices.json is the output of scripts/midi/derive-devices.mjs, never edited by hand, and names for each device the source files and their sha256; it and the generated region of docs/midi-devices.md hold only derived facts (names, identity numbers, memory count, per control its kind, bank, message, channel and number; per controller number a count and a role word), never a key, an updater field, an image or layout reference, a template, a preset, a sample, firmware or a decompiled library; the full decode lives only in the ignored .local/ directory; and a protocol fact the maker's files do not state is derived clean-room from the device itself (a probe of scripts/midi), never from decompiled code.
status: active
class: blocking
depends_on: [project.no-fake-science@2]
tags: [midi, licensing, data, tooling]
---

# Rationale

On 2026-11-14 and 2026-11-15 the owner ordered that everything about the controllers be taken
from the maker's installed software: the MIDI mapping, features and protocol, firmware
included, "pro maximální odvození". The installed editor states almost all of it in plain data
(device descriptions, factory templates) and the plug-ins state their default maps. What OSCILLA
may hold of it is bounded by copyright and the licence: OSCILLA is MIT and public, the maker's
files are not. Facts are not protected; files, images, layouts, presets and code are. So the
repository holds the facts and a tool that derives them again, and the files stay where they
were installed. A profile typed by hand would also drift from the device silently; derived, it
is reproduced by one command and checked against the install.

# Required behaviour

- The profile and the docs region change only by running
  `node scripts/midi/derive-devices.mjs` on a machine with the install; a reviewer compares the
  diff with `--check` there. The procedure is `.ai/repo/workflows/midi-device-import.md`.
- The script reads only device descriptions, factory templates and plug-in MIDI maps. It never
  opens an image, a layout (`.ui`), a firmware file, or a key field; it writes no maker file into
  the repository; `--dump` writes under `.local/`, which `.gitignore` ignores.
- A protocol fact beyond those files (the SysEx identity reply, the DAW port's messages) is
  measured on the device with a probe kept in `scripts/midi/`, and the measurement is recorded
  with its date in the plan issue that uses it.
- No firmware or library is decompiled or disassembled, and no maker graphic is traced or
  copied; the MIDI section's UI is OSCILLA's own, on Flowbite Pro.

# Enforcement

- `tests/unit/midi/devices.test.mjs` ("project.midi-profiles-derived ..."): the committed profile
  names `scripts/midi/derive-devices.mjs` as its writer and, per device, its source files with a
  sha256; no key of the profile or of a fixture's derivation is outside the allowed set, and no
  forbidden field (productKey, firmwareUpdater, imagePath, templateExtension, a `.png`/`.ui`
  reference) appears in it; the script's derivation of a synthetic fixture drops the fixture's
  key, updater and image fields; no tracked file has a maker template, firmware or editor-layout
  extension; `.local/` is ignored; and `scripts/midi/derive-devices.mjs --check` exits 0 (where
  the install is absent it says so; where present it compares). It runs in `npm test`, so in
  `npm run verify` and the CI `unit` job.

# Failure behaviour

The test fails with the field, the file or the differing output named, and the pull request
cannot land.

Not machine-checked: that a hand edit was not followed by a matching hand edit of the docs
region on a machine without the install (CI cannot run the derivation; the reviewer runs
`--check` on the owner's Mac), and that a fact recorded as measured on a device was measured.
