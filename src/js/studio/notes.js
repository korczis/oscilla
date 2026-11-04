// Notes clips (K099 part 1, ADR 0084): the clip kind `notes` and its payload
// `{ notes: [{ at, note, len, vel }] }`, the form K149's riff toNotes() emits. Pure: plain data
// in, plain data out; no DOM, no Web Audio, no globals.
//
//   at    beats from the clip start, a finite number, 0 or more
//   len   beats, a finite number above 0; at + len stays within the clip's musical length
//   note  the MIDI note number, an integer 0-127
//   vel   the velocity, a number in (0, 1]
// A notes clip is tempo-linked (its notes are beats, so the clip carries `musical`); it plays on
// a node that plays notes (registry.js playsNotes, clip-targets.js). Its notes are kept sorted by
// (at, note) (normalizeStudio), and a clip holds one note per (at, note). A note has exactly
// these four fields: any other (the proposed `p`, `r` or `slide` of ADR 0086) is refused until a
// change adds it. The import limits are STUDIO_IMPORT_LIMITS notesPerClip and notesPerDocument
// (validate.js). The transport and the offline render do not play notes clips yet: they report
// them unplayed with the clip-target policy's reason (clip-targets.js CLIP_TARGET_TEXT).
//
//   NOTE_FIELDS, NOTE_RANGE, NOTES_TEXT
//   sortNotes(notes) -> notes sorted by (at, note), stable (normalize)
//   notesRules(clip) -> [{ code, message, path }] (paths relative to the clip; clipRules)

/** The fields of a note, all required. */
export const NOTE_FIELDS = Object.freeze(['at', 'note', 'len', 'vel']);
/** MIDI note numbers. */
export const NOTE_RANGE = Object.freeze([0, 127]);
/** Beats a note may pass the clip end by: float error only. */
const END_TOLERANCE_BEATS = 1e-9;
/** At most this many note errors are reported per clip. */
const MAX_NOTE_ERRORS = 8;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => Math.round(v * 1e6) / 1e6;

/** The sentences of the notes rules. `i` is the note's index in the sorted list. */
export const NOTES_TEXT = Object.freeze({
  absolute: 'A notes clip is placed in beats: its notes are beats from the clip start, so the '
    + 'clip must be tempo-linked.',
  payloadField: (k) => `A notes clip payload holds only its notes; "${k}" is not one of its `
    + 'fields.',
  list: 'A notes clip needs its notes as a list.',
  shape: (i) => `Note ${i + 1} must be an object { at, note, len, vel }.`,
  field: (i, k) => `Note ${i + 1} has the unknown field "${k}"; a note is { at, note, len, vel }.`,
  at: (i) => `Note ${i + 1}: at must be a number of beats from the clip start, 0 or more.`,
  len: (i) => `Note ${i + 1}: len must be a number of beats above 0.`,
  note: (i) => `Note ${i + 1}: note must be an integer MIDI note number from ${NOTE_RANGE[0]} to `
    + `${NOTE_RANGE[1]}.`,
  vel: (i) => `Note ${i + 1}: vel must be a number above 0 and at most 1.`,
  end: (i, end, beats) => `Note ${i + 1} ends at beat ${num(end)}, after the end of the clip at `
    + `beat ${num(beats)}.`,
  duplicate: (i, note, at) => `Note ${i + 1} repeats note ${note} at beat ${num(at)}; a clip `
    + 'holds one note per pitch and onset.',
});

const sortKey = (n, f) => (isObj(n) && finite(n[f]) ? n[f] : Infinity);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A copy of `notes` sorted by (at, note); equal keys and malformed notes keep their order. */
export function sortNotes(notes) {
  return notes.map((n, i) => ({ n, i }))
    .sort((a, b) => cmp(sortKey(a.n, 'at'), sortKey(b.n, 'at'))
      || cmp(sortKey(a.n, 'note'), sortKey(b.n, 'note')) || a.i - b.i)
    .map((x) => x.n);
}

/**
 * The payload and note rules of a notes clip (clipRules runs them for the store, every import
 * and the editor): [{ code, message, path }], paths relative to the clip.
 */
export function notesRules(clip) {
  const errors = [];
  const add = (code, message, path) => errors.push({ code, message, path });
  if (!clip.musical) add('notes-absolute', NOTES_TEXT.absolute, 'musical');
  const payload = isObj(clip.payload) ? clip.payload : {};
  for (const k of Object.keys(payload)) {
    if (k !== 'notes') add('invalid-notes', NOTES_TEXT.payloadField(k), `payload.${k}`);
  }
  const notes = payload.notes;
  if (!Array.isArray(notes)) {
    add('invalid-notes', NOTES_TEXT.list, 'payload.notes');
    return errors;
  }
  const beats = clip.musical && finite(clip.musical.durationBeats) ? clip.musical.durationBeats
    : null;
  const seen = new Set();
  let noteErrors = 0;
  for (let i = 0; i < notes.length && noteErrors < MAX_NOTE_ERRORS; i += 1) {
    const n = notes[i];
    const path = `payload.notes[${i}]`;
    const before = errors.length;
    const bad = (message, field) => add('invalid-note', message, field ? `${path}.${field}`
      : path);
    if (!isObj(n)) bad(NOTES_TEXT.shape(i));
    else {
      for (const k of Object.keys(n)) if (!NOTE_FIELDS.includes(k)) bad(NOTES_TEXT.field(i, k), k);
      if (!finite(n.at) || n.at < 0) bad(NOTES_TEXT.at(i), 'at');
      if (!finite(n.len) || n.len <= 0) bad(NOTES_TEXT.len(i), 'len');
      if (!Number.isInteger(n.note) || n.note < NOTE_RANGE[0] || n.note > NOTE_RANGE[1]) {
        bad(NOTES_TEXT.note(i), 'note');
      }
      if (!finite(n.vel) || n.vel <= 0 || n.vel > 1) bad(NOTES_TEXT.vel(i), 'vel');
      if (errors.length === before) {
        if (beats !== null && n.at + n.len > beats + END_TOLERANCE_BEATS) {
          bad(NOTES_TEXT.end(i, n.at + n.len, beats), 'len');
        }
        const key = `${n.at}/${n.note}`;
        if (seen.has(key)) bad(NOTES_TEXT.duplicate(i, n.note, n.at));
        seen.add(key);
      }
    }
    if (errors.length > before) noteErrors += 1;
  }
  return errors;
}
