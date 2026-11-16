// Call and response: OSCILLA answers a player's phrase (plan issue V503; ADR 0058, its V503 note;
// docs/midi.md "Call and response").
//
// The one response mode, a pure rule from timestamped input events to output events, so the same
// phrase always gets the same answer. No network call, no model, no randomness and no timer
// lives here: this module imports nothing but core/music.js (a unit test reads its import list).
//
// A phrase is the notes the player played until PHRASE_GAP_MS passed with no key held. The
// phrase's end is asked on the transport's own lookahead pass (phraseEnded(now)), never by a
// timer in the event path (project.audio-engine-discipline). The answer is the phrase answered at
// the fifth (ANSWER_INTERVAL semitones up, the classical answer at the dominant): the same
// onsets, lengths and order, each velocity times ANSWER_VELOCITY. It is bounded:
//   at most RESPONSE_MAX_NOTES notes (the phrase's first),
//   within RESPONSE_MAX_MS of its start (later onsets dropped, lengths cut at the bound),
//   at most `polyphony` notes sounding at once (a note that would exceed it is dropped),
//   no note above MIDI 127 or at or above `maxFrequency` (dropped, never moved to a wrong pitch).
//
//   createPhrase()                  a recorder of one input's phrase:
//       on(note, velocity, atMs, source)   a key down (velocity > 0) from `source`
//       off(note, atMs, source)     a key up; only PLAYER events are recorded, so an answer
//                                   fed back in is never heard as the next call (A1)
//       endsAt()                    the phrase's end: its last key up with no key held, or null
//       ended(nowMs)                true once PHRASE_GAP_MS passed since the last key up with
//                                   no key held, and the phrase has a note
//       take()                      -> [{ note, velocity, start, length }] ms from the first
//                                   onset, onset order; the recorder starts empty again
//       clear()                     forget the phrase
//   answer(phrase, { polyphony, maxFrequency, a4 }) -> [{ note, velocity, start, length }]

import { midiToFrequency } from '../core/music.js';

export const PHRASE_GAP_MS = 600;
export const ANSWER_INTERVAL = 7;
export const ANSWER_VELOCITY = 0.8;
export const RESPONSE_MAX_NOTES = 16;
export const RESPONSE_MAX_MS = 8000;
/** The source tag of the player's own notes; an answer's notes carry ANSWER_SOURCE. */
export const PLAYER_SOURCE = 'player';
export const ANSWER_SOURCE = 'answer';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A recorder of one input's phrase, on the input events' own timeline (ms). */
export function createPhrase() {
  let notes = []; // { note, velocity, on, off } in onset order
  const held = new Map(); // note -> its entry in `notes`
  let lastUp = null;
  return {
    on(note, velocity, atMs, source = PLAYER_SOURCE) {
      if (source !== PLAYER_SOURCE) return false;
      if (!isNum(note) || !isNum(atMs) || !(velocity > 0)) return false;
      if (held.has(note)) this.off(note, atMs); // a re-press ends the note it repeats
      const n = { note, velocity, on: atMs, off: null };
      notes.push(n);
      held.set(note, n);
      return true;
    },
    off(note, atMs, source = PLAYER_SOURCE) {
      if (source !== PLAYER_SOURCE) return false;
      const n = held.get(note);
      if (!n || !isNum(atMs)) return false;
      n.off = Math.max(n.on, atMs);
      held.delete(note);
      lastUp = atMs;
      return true;
    },
    endsAt() {
      return notes.length > 0 && held.size === 0 && isNum(lastUp) ? lastUp : null;
    },
    ended(nowMs) {
      return notes.length > 0 && held.size === 0 && isNum(lastUp)
        && nowMs - lastUp >= PHRASE_GAP_MS;
    },
    take() {
      const t0 = notes.length ? notes[0].on : 0;
      const out = notes.filter((n) => n.off !== null).map((n) => ({ note: n.note,
        velocity: n.velocity, start: n.on - t0, length: n.off - n.on }));
      this.clear();
      return out;
    },
    clear() {
      notes = [];
      held.clear();
      lastUp = null;
    },
  };
}

/** The answer to `phrase` (take()'s notes): at the fifth, bounded; the same phrase, the same. */
export function answer(phrase, { polyphony, maxFrequency, a4 = 440 } = {}) {
  const out = [];
  const voices = Number.isInteger(polyphony) && polyphony > 0 ? polyphony : 1;
  for (const p of (phrase || []).slice(0, RESPONSE_MAX_NOTES)) {
    if (!isNum(p.start) || !isNum(p.length) || p.start >= RESPONSE_MAX_MS) continue;
    const note = p.note + ANSWER_INTERVAL;
    if (note > 127) continue;
    if (isNum(maxFrequency) && midiToFrequency(note, a4) >= maxFrequency) continue;
    const length = Math.min(p.length, RESPONSE_MAX_MS - p.start);
    const sounding = out.filter((o) => o.start <= p.start && p.start < o.start + o.length);
    if (sounding.length >= voices) continue;
    out.push({ note, start: p.start, length,
      velocity: Math.max(1, Math.min(127, Math.round(p.velocity * ANSWER_VELOCITY))) });
  }
  return out;
}
