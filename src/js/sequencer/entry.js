// Sequencer entry parsing (K017). A frequency field takes a note name (A4, C#3, Bb2), a MIDI
// number (m69, midi 69) or a frequency in the forms core/frequency.js accepts (440, 440 Hz,
// 1k, 15.5 kHz); the tempo takes 20 to 300 BPM. Anything else is refused with a sentence the
// panel shows (project.no-silent-feedback); nothing is clamped silently (G1 coherence 2.4).
// Pure: no DOM, no audio. The frequencies are the ones core/music.js gives.
import { noteToFrequency, midiToFrequency } from '../core/music.js';
import { parseFrequency } from '../core/frequency.js';
import { MIN_TEMPO_BPM, MAX_TEMPO_BPM } from './model.js';

const MIDI_ENTRY = /^(?:m|midi\s*)(\d{1,3})$/i;
const round3 = (x) => Math.round(x * 1000) / 1000;

/** @returns {{ ok: true, hz: number, via: 'note'|'midi'|'hz' } | { ok: false, error: string }} */
export function parseFrequencyEntry(text, { a4 = 440 } = {}) {
  const s = String(text ?? '').trim();
  const note = noteToFrequency(s, a4);
  if (note !== null) return { ok: true, hz: round3(note), via: 'note' };
  const m = MIDI_ENTRY.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n <= 127) return { ok: true, hz: round3(midiToFrequency(n, a4)), via: 'midi' };
    return { ok: false, error: `MIDI nota ${n} je mimo rozsah 0 až 127.` };
  }
  const f = parseFrequency(s);
  if (f.ok) return { ok: true, hz: f.value, via: 'hz' };
  return { ok: false, error: `\u201e${s}\u201c není nota ani frekvence. Zkuste A4, C#3, m69, 440 nebo 1k.` };
}

/** @returns {{ ok: true, bpm: number } | { ok: false, error: string }} */
export function parseTempoEntry(value) {
  const raw = typeof value === 'number' ? value
    : Number(String(value ?? '').trim().replace(/\s*bpm$/i, ''));
  if (!Number.isFinite(raw)) {
    return { ok: false, error: `\u201e${String(value ?? '')}\u201c není tempo. Zkuste 120 BPM.` };
  }
  if (raw < MIN_TEMPO_BPM || raw > MAX_TEMPO_BPM) {
    return { ok: false, error: `Tempo ${raw} BPM je mimo rozsah ${MIN_TEMPO_BPM} až ${MAX_TEMPO_BPM} BPM.` };
  }
  return { ok: true, bpm: raw };
}
