// Known MIDI devices: which device an input is, what its port is for, and which physical control
// sent a message (plan issue V507; ADR 0058, its V507 note; docs/midi-devices.md).
//
// The profiles are data, src/data/midi-devices.json, written by scripts/midi/derive-devices.mjs
// from the maker's own device descriptions and factory templates on a machine where they are
// installed (rule project.midi-profiles-derived: never hand-typed). This module only reads them.
//
//   recognise(name)          -> { device, member, role }   device null (and role 'play') when
//                               the name is of no known device
//                               role 'play'   the port that sends the player's notes and controls
//                                    'daw'    a DAW-control port (Mackie Control and the like:
//                                             its Note On messages are buttons, not notes)
//                                    'editor' the maker's editor port (SysEx traffic)
//   controlOf(device, event) -> { id, kind, bank, label } | null
//                               the control of `device` whose factory message `event` is (an
//                               event of notes.js parseMidiMessage); bank 1 first
//   controlLabel(control)    -> its Czech label ("Enkodér 1", "Fader 9", "Pad 3 (banka 2)")
//   kindLabel(kind)          -> the Czech name of a control kind ("Enkodér", "Pad")
//
// A port is matched by its name only: the Web MIDI name is the operating system's endpoint name
// ("KeyLab mkII 61 MIDI", "KeyLab mkII 61 DAW"), which contains the device's model name. The
// SysEx identity (manufacturer, family, member) is in the profile for the tooling and the docs;
// OSCILLA asks for MIDI without SysEx (support.js), so the page never reads it.

import DATA from '../../data/midi-devices.json' with { type: 'json' };

export const PORT_ROLES = Object.freeze(['play', 'daw', 'editor']);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every device name of the profiles, longest first, so "BeatStep Pro" wins over "BeatStep". */
function namesOf(data) {
  const out = [];
  for (const device of data.devices || []) {
    for (const member of device.names || [device.name]) {
      const key = norm(member);
      if (key) out.push({ key, device, member });
    }
  }
  return out.sort((a, b) => b.key.length - a.key.length);
}

const NAMES = namesOf(DATA);

/** The role of a port from its name's own words. */
export function roleOf(name) {
  const s = String(name || '');
  if (/\bDAW\b/i.test(s) || /\bMCU\b|\bHUI\b/i.test(s)) return 'daw';
  if (/editor/i.test(s)) return 'editor';
  return 'play';
}

/** Which known device a port named `name` belongs to, and what the port is for. */
export function recognise(name, names = NAMES) {
  const key = norm(name);
  const hit = key ? names.find((n) => key.includes(n.key)) : null;
  // An unknown device's ports all play: only a profile says that a port is not for playing.
  return { device: hit ? hit.device : null, member: hit ? hit.member : null,
    role: hit ? roleOf(name) : 'play' };
}

/** A profile table of an alternative data set (tests; the page uses the bundled one). */
export function recogniserOf(data) {
  const names = namesOf(data);
  return (name) => recognise(name, names);
}

const MESSAGE_OF = Object.freeze({ 'control-change': ['cc', 'cc-switch'],
  'note-on': ['note'], 'note-off': ['note'] });

/** True when a profile channel (1-16, or a device-wide setting) admits a 0-based channel. */
function channelAdmits(channel, ch) {
  return typeof channel !== 'number' || channel === ch + 1;
}

/** The control of `device` that sends `event` in its factory setup, bank 1 first, or null. */
export function controlOf(device, event) {
  if (!device || !event) return null;
  const kinds = MESSAGE_OF[event.kind];
  if (!kinds) return null;
  const number = event.kind === 'control-change' ? event.controller : event.note;
  let best = null;
  for (const c of device.controls || []) {
    if (!kinds.includes(c.message) || c.number !== number) continue;
    if (!channelAdmits(c.channel, event.channel)) continue;
    if (!best || c.bank < best.bank) best = c;
  }
  return best ? { id: best.id, kind: best.kind, bank: best.bank, label: controlLabel(best) }
    : null;
}

// What a control kind is called on the page (Czech; the kinds are the profiles' own words).
const KIND_LABELS = Object.freeze({
  knob: 'Enkodér', bank_knob: 'Enkodér', encoder: 'Enkodér', fader: 'Fader', slider: 'Fader',
  pad: 'Pad', step: 'Krok', select_button: 'Tlačítko', button: 'Tlačítko',
  daw_button: 'Tlačítko DAW', transport_button: 'Transport', touchpad: 'Dotyková plocha',
  mod_wheel: 'Modulační kolečko', modwheel: 'Modulační kolečko', cv_in: 'CV vstup',
  control_pedal: 'Pedál', 'on/off_pedal': 'Pedál', sustain_pedal: 'Sustain pedál',
  sustain: 'Sustain pedál',
});

// Controls named by what they do rather than by a number.
const ID_LABELS = Object.freeze({
  sustain: 'Sustain pedál', expression: 'Expression pedál', modwheel: 'Modulační kolečko',
  pitchwheel: 'Ohyb výšky', cvin: 'CV vstup', breath: 'Dechový ovladač',
  cutoff: 'Frekvence filtru', resonance: 'Rezonance', attack: 'Náběh', decay: 'Pokles',
  sustainlevel: 'Výdrž', release: 'Doznění', volume: 'Hlasitost', tempo: 'Tempo',
  play: 'Přehrát', stop: 'Zastavit', record: 'Nahrávání', rec: 'Nahrávání',
  rewind: 'Přetočit zpět', fastforward: 'Přetočit vpřed', loop: 'Smyčka',
});

/** The Czech name of a profile's control kind ("Enkodér", "Pad"), or the kind's own words. */
export function kindLabel(kind) {
  const k = String(kind || '');
  return KIND_LABELS[k] || KIND_LABELS[norm(k)]
    || k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The Czech label of a profile control. */
export function controlLabel(control) {
  const id = String(control.id || '');
  const num = /(\d+)$/.exec(id);
  const bare = norm(id.replace(/\d+$/, ''));
  let label;
  if (num && /^aux$/.test(bare)) label = `Pedál Aux ${num[1]}`;
  else if (num) label = `${KIND_LABELS[control.kind] || KIND_LABELS[bare] || 'Ovladač'} ${num[1]}`;
  else if (ID_LABELS[bare]) label = ID_LABELS[bare];
  else label = KIND_LABELS[control.kind] && control.kind !== 'button'
    ? KIND_LABELS[control.kind]
    : id.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return control.bank > 1 ? `${label} (banka ${control.bank})` : label;
}

/** The bundled profile set (read-only). */
export const DEVICES = DATA;
