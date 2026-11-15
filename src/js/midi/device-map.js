// A known controller's map: its controls laid out from its derived profile, what each one does,
// and which one a message came from (plan issue V509; ADR 0058; docs/midi.md "Device map").
//
// Nothing here is typed by hand. The controls, their groups, banks and numbers are the profile's
// (src/data/midi-devices.json, derived by scripts/midi/derive-devices.mjs, rule
// project.midi-profiles-derived); their labels are devices.js controlLabel / kindLabel; and what a
// control does is found by sending its own factory message through the decoder the page reads
// every message with (notes.js parseMidiMessage) and asking the module that acts on that event:
//   a note                    plays the one instrument (K247)
//   CC 64                     the sustain pedal (V506, notes.js)
//   CC 120 / 123              all sound off / all notes off (notes.js)
//   any other CC              the Synth panel control its slot moves (synth/midi-cc.js
//                             ccControl, the same function the status line and undo label use)
//                             in the Synth, or nothing where its slot names no control
// so changing a slot, a profile or the decoder changes the map with it.
//
//   deviceMap(device, { bank, acts })  -> { id, name, banks, bank, groups }
//       groups [{ kind, label, controls: [{ key, id, kind, bank, label, message, number,
//                channel, does }] }] in the profile's own order; `does` is acts(control)
//   actsOf(deps)                       -> (control) -> { kind, text }   what a control does
//                                         (deps: { ccControl }: a CC's control name, or null)
//   controlKey(control)                -> 'id@bank', the key a lit control is found by
//   litKey(device, event)              -> the key of the control that sent `event`, or null

import { controlLabel, controlOf, kindLabel } from './devices.js';
import { parseMidiMessage } from './notes.js';

/** The key of a control of a profile (its id within its bank). */
export const controlKey = (control) => `${control.id}@${control.bank}`;

/** The key of the control of `device` that sent `event` (a decoded message), or null. */
export function litKey(device, event) {
  const c = controlOf(device, event);
  return c ? controlKey(c) : null;
}

// A control's own factory message as bytes, on channel 1 (a device-wide channel setting such as
// 'user' is whatever the player set: the channel does not change what the event is).
function bytesOf(control) {
  const n = Math.min(127, Math.max(0, Number(control.number) || 0));
  if (control.message === 'note') return [0x90, n, 100];
  if (control.message === 'cc' || control.message === 'cc-switch') return [0xb0, n, 127];
  return null;
}

/**
 * What a control does, from the event its message decodes to. deps.ccControl(cc) gives the Synth
 * panel control a CC moves, { name } or null (synth/midi-cc.js ccControl with the panel's deps).
 */
export function actsOf({ ccControl } = {}) {
  return (control) => {
    const bytes = bytesOf(control);
    const e = bytes ? parseMidiMessage(bytes) : { kind: 'ignored' };
    if (e.kind === 'note-on') return { kind: 'notes', text: 'hraje noty nástroje' };
    if (e.kind === 'sustain') return { kind: 'sustain', text: 'drží noty (sustain)' };
    if (e.kind === 'all-sound-off') return { kind: 'panic', text: 'umlčí všechny zvuky' };
    if (e.kind === 'all-notes-off') return { kind: 'panic', text: 'uvolní všechny noty' };
    if (e.kind === 'control-change') {
      const t = typeof ccControl === 'function' ? ccControl(e.controller) : null;
      if (t) return { kind: 'synth', text: `v Synthu: ${t.name}` };
    }
    return { kind: 'none', text: 'nic neovládá' };
  };
}

/** The banks a device's controls are in, ascending. */
function banksOf(device) {
  return [...new Set((device.controls || []).map((c) => c.bank))].sort((a, b) => a - b);
}

/** The map of `device` in `bank` (its first bank by default), each control saying what it does. */
export function deviceMap(device, { bank, acts = actsOf() } = {}) {
  const banks = banksOf(device);
  const shown = banks.includes(bank) ? bank : banks[0] || 1;
  const groups = [];
  const byKind = new Map();
  for (const c of device.controls || []) {
    if (c.bank !== shown) continue;
    let g = byKind.get(c.kind);
    if (!g) {
      g = { kind: c.kind, label: kindLabel(c.kind), controls: [] };
      byKind.set(c.kind, g);
      groups.push(g);
    }
    g.controls.push({ key: controlKey(c), id: c.id, kind: c.kind, bank: c.bank,
      label: controlLabel(c), message: c.message, number: c.number, channel: c.channel,
      does: acts(c) });
  }
  return { id: device.id, name: device.name, banks, bank: shown, groups };
}
