// The MIDI monitor: what every connected input sends, as the player can read it (plan issue
// V507; ADR 0058, its V507 note; docs/midi.md "The MIDI monitor").
//
// decodeMidi(bytes) reads one message by the MIDI 1.0 message table, every kind, not only the
// ones OSCILLA acts on, so the monitor also shows what is ignored. createMidiMonitor keeps the
// last MONITOR_ROWS entries outside reactive state and hands a copy to `publish` at most once per
// MONITOR_FLUSH_MS (a fader sends up to a few hundred messages a second; the page redraws ten
// times a second at most), the last one never lost.
//
//   decodeMidi(bytes)                 -> { kind, channel?, ...fields }
//   describeMidi(m, control)          -> the Czech line of the monitor
//   createMidiMonitor({ publish })    -> { add(entry), clear(), rows(), dispose() }

import { midiToName } from '../core/music.js';

export const MONITOR_ROWS = 12;
export const MONITOR_FLUSH_MS = 100;

const SYSTEM = Object.freeze({ 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop',
  0xfe: 'active-sensing', 0xff: 'reset', 0xf6: 'tune-request' });

/** One message by the MIDI 1.0 table. Channel messages carry a 0-based channel. */
export function decodeMidi(data) {
  const b = data ? Array.from(data) : [];
  const s = b[0];
  if (!Number.isInteger(s) || s < 0x80) return { kind: 'unknown', bytes: b };
  if (s === 0xf0) return { kind: 'sysex', bytes: b, length: b.length };
  if (SYSTEM[s]) return { kind: SYSTEM[s] };
  if (s === 0xf2) return { kind: 'song-position', beats: ((b[2] || 0) << 7) | (b[1] || 0) };
  if (s === 0xf3) return { kind: 'song-select', song: b[1] || 0 };
  if (s === 0xf1) return { kind: 'time-code', value: b[1] || 0 };
  if (s >= 0xf0) return { kind: 'unknown', bytes: b };
  const channel = s & 0x0f;
  const d1 = b[1] || 0;
  const d2 = b[2] || 0;
  switch (s & 0xf0) {
    case 0x90: return d2 > 0 ? { kind: 'note-on', channel, note: d1, velocity: d2 }
      : { kind: 'note-off', channel, note: d1, velocity: 0 };
    case 0x80: return { kind: 'note-off', channel, note: d1, velocity: d2 };
    case 0xa0: return { kind: 'poly-pressure', channel, note: d1, pressure: d2 };
    case 0xb0: return { kind: 'control-change', channel, controller: d1, value: d2 };
    case 0xc0: return { kind: 'program', channel, program: d1 };
    case 0xd0: return { kind: 'pressure', channel, pressure: d1 };
    default: return { kind: 'pitch-bend', channel, value: ((d2 << 7) | d1) - 8192 };
  }
}

const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

/** The monitor's line for message `m`; `control` the physical control (devices.js), or null. */
export function describeMidi(m, control = null) {
  const ch = Number.isInteger(m.channel) ? ` · kanál ${m.channel + 1}` : '';
  const who = control ? `${control.label} · ` : '';
  switch (m.kind) {
    case 'note-on': return `${who}Nota ${midiToName(m.note)} (${m.note}) stisk ${m.velocity}${ch}`;
    case 'note-off': return `${who}Nota ${midiToName(m.note)} (${m.note}) uvolnění${ch}`;
    case 'poly-pressure':
      return `${who}Tlak na notě ${midiToName(m.note)}: ${m.pressure}${ch}`;
    case 'control-change': return `${who}CC ${m.controller} = ${m.value}${ch}`;
    case 'program': return `Program ${m.program + 1}${ch}`;
    case 'pressure': return `Tlak kanálu: ${m.pressure}${ch}`;
    case 'pitch-bend': return `Ohyb výšky ${m.value > 0 ? '+' : ''}${m.value}${ch}`;
    case 'clock': return 'Takt hodin (24 na čtvrťovou notu)';
    case 'start': return 'Spuštění';
    case 'continue': return 'Pokračovat';
    case 'stop': return 'Zastavení';
    case 'song-position': return `Pozice v písni: ${m.beats} šestnáctin`;
    case 'song-select': return `Výběr písně ${m.song}`;
    case 'time-code': return `MIDI time code ${hex(m.value)}`;
    case 'active-sensing': return 'Udržovací signál';
    case 'reset': return 'Reset systému';
    case 'tune-request': return 'Požadavek na ladění';
    case 'sysex': {
      const head = m.bytes.slice(0, 8).map(hex).join(' ');
      return `SysEx ${m.length} B: ${head}${m.length > 8 ? ' …' : ''}`;
    }
    default: return `Neznámá zpráva ${(m.bytes || []).map(hex).join(' ')}`;
  }
}

/**
 * The monitor's rows: newest first, at most `rows`. Each entry is a plain object the markup
 * reads ({ n, input, role, text, kind }); `publish(rows)` receives a fresh array.
 */
export function createMidiMonitor({ publish = () => {}, rows = MONITOR_ROWS,
  flushMs = MONITOR_FLUSH_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let list = [];
  let n = 0;
  let timer = 0;
  let last = -Infinity;
  const flush = () => { timer = 0; last = Date.now(); publish(list.slice()); };
  return {
    add(entry) {
      n += 1;
      list = [{ n, ...entry }, ...list].slice(0, rows);
      if (timer) return;
      const wait = flushMs - (Date.now() - last);
      if (wait <= 0) flush();
      else timer = setTimer(flush, wait);
    },
    clear() {
      list = [];
      if (timer) { clearTimer(timer); timer = 0; }
      last = -Infinity; // the first message after a clear is shown at once
      publish([]);
    },
    rows: () => list.slice(),
    dispose() { if (timer) clearTimer(timer); timer = 0; },
  };
}
