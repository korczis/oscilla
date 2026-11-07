// Notes clips (K099 part 1, ADR 0084; the execution fields of ADR 0086, K068): the clip kind
// `notes` and its payload `{ notes: [{ at, note, len, vel, p?, r?, slide? }], grid? }`, the form
// K149's riff toNotes() emits. Pure: plain data in, plain data out; no DOM, no Web Audio, no
// globals.
//
//   at     beats from the clip start, a finite number, 0 or more
//   len    beats, a finite number above 0; at + len stays within the clip's musical length
//   note   the MIDI note number, an integer 0-127
//   vel    the velocity, a number in (0, 1]; accent is velocity (ADR 0086 decision 3)
//   p      optional: the note's probability in (0, 1] (absent: 1)
//   r      optional: the ratchet, an integer 1-8 (absent: 1): r equal onsets inside len
//   slide  optional: true (never false): the note opens no new gate and the target's pitch
//          glides to it over the target's own glide parameter
//   grid   optional { stepBeats, swing, seed }: stepBeats > 0 (swing's grid), swing a fraction
//          0-0.75 of stepBeats, seed a uint32 (the probability draw)
// Absent fields are never written, so a clip without them serializes and hashes as before.
// A notes clip is tempo-linked (its notes are beats, so the clip carries `musical`); it plays on
// a node that plays notes (registry.js playsNotes; clip-targets.js says where it is played: a
// Keys node). Its notes are kept sorted by (at, note) (normalizeStudio), and a clip holds one
// note per (at, note). The import limits are STUDIO_IMPORT_LIMITS notesPerClip and
// notesPerDocument (validate.js). A slide on a target without a glide parameter is refused
// (timeline.js clipRules through slideRule).
//
// Execution (notePlan, read by timeline-compiler.js compilePass, the one compile path, live and
// offline alike), in beats from the clip start:
//   probability  a note plays iff noteDraw(seed, pass, index) < p (core/math.js; seed 0
//                without a grid; index in the sorted array; pass the loop pass), so a render
//                repeats exactly and each loop pass draws anew; never Math.random
//   swing        a note whose at is exactly an odd grid position (2k + 1) x stepBeats starts
//                swing x stepBeats later, its onsets with it; an off-grid note is unmoved
//   ratchet      onset j of r starts at at + j x len / r and lasts len / r
//   slide        a slide's first onset opens no gate when a gate sounds at its start (an earlier
//                onset's gate reaches it, touching included): that gate lasts to the slide's
//                end. With no sounding note before it the slide plays as an ordinary note. Its
//                later ratchet onsets, if any, gate as ordinary onsets
//   cut          an onset at or after the cut (the clip end, or the loop end cutting the clip)
//                is dropped, one crossing it ends there
//
//   NOTE_FIELDS, NOTE_OPTIONAL_FIELDS, GRID_FIELDS, NOTE_RANGE, RATCHET_RANGE, SWING_MAX,
//   NOTES_TEXT
//   sortNotes(notes) -> notes sorted by (at, note), stable (normalize)
//   notesRules(clip) -> [{ code, message, path }] (paths relative to the clip; clipRules)
//   slideRule(clip, def) -> { code, message, path } | null   a slide on a target without glide
//   noteDraw(seed, pass, index) -> [0, 1)      swingDelay(at, grid) -> beats
//     (the draw mixes pass and index through DRAW_PASS_MUL and DRAW_INDEX_MUL)
//   noteVelocity(vel) -> 1-127 (delivery: rounded, never below 1)
//   notePlan(payload, { pass, cutBeats }) -> [{ index, onset, note, vel, velocity, start, end,
//                                              gate, gateEnd, slide }] in onset order
//   noteItems(clip, base, { pass, tempo, cutS, toAudio }) -> the compiler's `note` items

import { mulberry32 } from '../core/math.js';

/** The fields of a note, all required. */
export const NOTE_FIELDS = Object.freeze(['at', 'note', 'len', 'vel']);
/** The execution fields a note may carry (ADR 0086), each absent by default. */
export const NOTE_OPTIONAL_FIELDS = Object.freeze(['p', 'r', 'slide']);
/** The fields of a clip's grid, all required when it has one. */
export const GRID_FIELDS = Object.freeze(['stepBeats', 'swing', 'seed']);
/** MIDI note numbers. */
export const NOTE_RANGE = Object.freeze([0, 127]);
/** Onsets a ratchet plays inside its note. */
export const RATCHET_RANGE = Object.freeze([1, 8]);
/** The largest swing, as a fraction of the grid's stepBeats. */
export const SWING_MAX = 0.75;
const SEED_MAX = 0xffffffff;
/** Beats a note may pass the clip end by: float error only. */
const END_TOLERANCE_BEATS = 1e-9;
/** Beats two positions may differ by and still be one (float error only). */
const BEAT_EPS = 1e-9;
/** At most this many note errors are reported per clip. */
const MAX_NOTE_ERRORS = 8;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => Math.round(v * 1e6) / 1e6;
const article = (type) => (/^[AEIOU]/.test(type) ? 'an' : 'a');

/** The sentences of the notes rules. `i` is the note's index in the sorted list. */
export const NOTES_TEXT = Object.freeze({
  absolute: 'A notes clip is placed in beats: its notes are beats from the clip start, so the '
    + 'clip must be tempo-linked.',
  payloadField: (k) => `A notes clip payload holds its notes and an optional grid; "${k}" is `
    + 'not one of its fields.',
  list: 'A notes clip needs its notes as a list.',
  shape: (i) => `Note ${i + 1} must be an object { at, note, len, vel }.`,
  field: (i, k) => `Note ${i + 1} has the unknown field "${k}"; a note is { at, note, len, vel } `
    + 'with an optional p, r and slide.',
  at: (i) => `Note ${i + 1}: at must be a number of beats from the clip start, 0 or more.`,
  len: (i) => `Note ${i + 1}: len must be a number of beats above 0.`,
  note: (i) => `Note ${i + 1}: note must be an integer MIDI note number from ${NOTE_RANGE[0]} to `
    + `${NOTE_RANGE[1]}.`,
  vel: (i) => `Note ${i + 1}: vel must be a number above 0 and at most 1.`,
  end: (i, end, beats) => `Note ${i + 1} ends at beat ${num(end)}, after the end of the clip at `
    + `beat ${num(beats)}.`,
  duplicate: (i, note, at) => `Note ${i + 1} repeats note ${note} at beat ${num(at)}; a clip `
    + 'holds one note per pitch and onset.',
  p: (i) => `Note ${i + 1}: p is the chance it plays, a number above 0 and at most 1.`,
  r: (i) => `Note ${i + 1}: r is the number of onsets it plays, an integer from `
    + `${RATCHET_RANGE[0]} to ${RATCHET_RANGE[1]}.`,
  slide: (i) => `Note ${i + 1}: slide is either true or left out.`,
  slideTarget: (i, type) => `Note ${i + 1} slides, but ${article(type)} ${type} node has no `
    + 'glide to slide with.',
  grid: 'A notes clip grid must be an object { stepBeats, swing, seed }.',
  gridField: (k) => `A notes clip grid is { stepBeats, swing, seed }; "${k}" is not one of its `
    + 'fields.',
  stepBeats: 'The grid stepBeats must be a number of beats above 0.',
  swing: `The grid swing must be a fraction of stepBeats from 0 to ${SWING_MAX}.`,
  seed: `The grid seed must be an integer from 0 to ${SEED_MAX}.`,
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

/** The grid rules (notesRules): an object of exactly GRID_FIELDS, each in its range. */
function gridRules(grid, add) {
  if (!isObj(grid)) {
    add('invalid-notes', NOTES_TEXT.grid, 'payload.grid');
    return;
  }
  for (const k of Object.keys(grid)) {
    if (!GRID_FIELDS.includes(k)) {
      add('invalid-notes', NOTES_TEXT.gridField(k), `payload.grid.${k}`);
    }
  }
  if (!finite(grid.stepBeats) || grid.stepBeats <= 0) {
    add('invalid-notes', NOTES_TEXT.stepBeats, 'payload.grid.stepBeats');
  }
  if (!finite(grid.swing) || grid.swing < 0 || grid.swing > SWING_MAX) {
    add('invalid-notes', NOTES_TEXT.swing, 'payload.grid.swing');
  }
  if (!Number.isInteger(grid.seed) || grid.seed < 0 || grid.seed > SEED_MAX) {
    add('invalid-notes', NOTES_TEXT.seed, 'payload.grid.seed');
  }
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
    if (k !== 'notes' && k !== 'grid') {
      add('invalid-notes', NOTES_TEXT.payloadField(k), `payload.${k}`);
    }
  }
  if ('grid' in payload) gridRules(payload.grid, add);
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
      for (const k of Object.keys(n)) {
        if (!NOTE_FIELDS.includes(k) && !NOTE_OPTIONAL_FIELDS.includes(k)) {
          bad(NOTES_TEXT.field(i, k), k);
        }
      }
      if (!finite(n.at) || n.at < 0) bad(NOTES_TEXT.at(i), 'at');
      if (!finite(n.len) || n.len <= 0) bad(NOTES_TEXT.len(i), 'len');
      if (!Number.isInteger(n.note) || n.note < NOTE_RANGE[0] || n.note > NOTE_RANGE[1]) {
        bad(NOTES_TEXT.note(i), 'note');
      }
      if (!finite(n.vel) || n.vel <= 0 || n.vel > 1) bad(NOTES_TEXT.vel(i), 'vel');
      if ('p' in n && (!finite(n.p) || n.p <= 0 || n.p > 1)) bad(NOTES_TEXT.p(i), 'p');
      if ('r' in n && (!Number.isInteger(n.r) || n.r < RATCHET_RANGE[0]
        || n.r > RATCHET_RANGE[1])) bad(NOTES_TEXT.r(i), 'r');
      if ('slide' in n && n.slide !== true) bad(NOTES_TEXT.slide(i), 'slide');
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

/**
 * A slide on a target whose node type has no glide parameter (ADR 0086 decision 1): the first
 * such note's error { code, message, path }, or null. `def` is the target's registry entry.
 */
export function slideRule(clip, def) {
  if (!def || def.params.some((p) => p.key === 'glide')) return null;
  const notes = isObj(clip.payload) && Array.isArray(clip.payload.notes) ? clip.payload.notes
    : [];
  const i = notes.findIndex((n) => isObj(n) && n.slide === true);
  return i < 0 ? null : { code: 'invalid-note', message: NOTES_TEXT.slideTarget(i,
    def.displayName), path: `payload.notes[${i}].slide` };
}

// ---------------------------------------------------------------- execution (K068)

// Odd 32-bit multipliers that spread pass and index over different bits before they meet the
// seed: a plain seed ^ pass ^ index is symmetric (pass 2, note 3 draws as pass 3, note 2) and
// cancels when pass equals index, so two notes of one pass could share every draw.
export const DRAW_PASS_MUL = 0x9e3779b1;
export const DRAW_INDEX_MUL = 0x85ebca77;

/** The probability draw of note `index` in loop pass `pass` (ADR 0086 decision 4). */
export function noteDraw(seed, pass, index) {
  return mulberry32((seed ^ Math.imul(pass + 1, DRAW_PASS_MUL)
    ^ Math.imul(index + 1, DRAW_INDEX_MUL)) >>> 0)();
}

/** The swing delay in beats of a note at `at` (0 unless exactly on an odd grid position). */
export function swingDelay(at, grid) {
  if (!grid || !(grid.swing > 0) || !(grid.stepBeats > 0)) return 0;
  const q = at / grid.stepBeats;
  const k = Math.round(q);
  if (Math.abs(q - k) > BEAT_EPS * Math.max(1, Math.abs(q))) return 0;
  return k % 2 === 1 ? grid.swing * grid.stepBeats : 0;
}

/** A note's velocity as delivery takes it (1-127, ADR 0086 decision 1): rounded, at least 1. */
export function noteVelocity(vel) {
  return Math.max(1, Math.min(127, Math.round(vel * 127)));
}

/**
 * The onsets a notes payload plays in loop pass `pass`, cut at `cutBeats` (the clip's musical
 * length, or less where a loop end cuts the clip), in beats from the clip start, sorted by start
 * (then note index, then onset): [{ index, onset, note, vel, velocity, start, end, gate,
 * gateEnd, slide }]. `gate`: the onset opens a gate, which lasts to `gateEnd` (its end, or the
 * end of the slides it carries); a slide onset opens none (`slide` true only where it glides).
 * The header states the rules.
 */
export function notePlan(payload, { pass = 0, cutBeats = Infinity } = {}) {
  const grid = isObj(payload.grid) ? payload.grid : null;
  const seed = grid && Number.isInteger(grid.seed) ? grid.seed >>> 0 : 0;
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const onsets = [];
  notes.forEach((n, index) => {
    if (n.p !== undefined && n.p < 1 && !(noteDraw(seed, pass, index) < n.p)) return;
    const r = n.r === undefined ? 1 : n.r;
    const at = n.at + swingDelay(n.at, grid);
    const each = n.len / r;
    for (let j = 0; j < r; j += 1) {
      const start = at + j * each;
      const end = Math.min(start + each, cutBeats);
      if (start >= cutBeats - BEAT_EPS || end - start <= BEAT_EPS) break;
      onsets.push({ index, onset: j, note: n.note, vel: n.vel, velocity: noteVelocity(n.vel),
        start, end, gate: true, gateEnd: end, slide: j === 0 && n.slide === true });
    }
  });
  onsets.sort((a, b) => a.start - b.start || a.index - b.index || a.onset - b.onset);
  // One gate at a time (a Keys node is monophonic): `last` opened the gate that sounds until
  // `until` (overlapping gates are one, as the transport's gate records merge them).
  let last = null;
  let until = -Infinity;
  for (const o of onsets) {
    const sounding = !!last && last.start < o.start - BEAT_EPS && until >= o.start - BEAT_EPS;
    if (o.slide && sounding) {
      o.gate = false;
      last.gateEnd = Math.max(last.gateEnd, o.end);
    } else {
      o.slide = false;
      last = o;
    }
    until = Math.max(until, last.gateEnd);
  }
  return onsets;
}

/**
 * The `note` items of a notes clip in one pass (timeline-compiler.js compilePass, K068): one per
 * onset of notePlan, at its position clip.start + beats x 60 / tempo, its times through `toAudio`
 * (the pass's whole-frame arithmetic). `base` is the clip's item; `cutS`, the clip's length
 * when a loop end cuts it (else null). An item: { ...base, key `<base key>:index.onset`, type
 * 'note', position, startTime, endTime (the end of the gate it opens, or its own end when it
 * opens none), duration, beat, index, onset, note, velocity (1-127), gate, slide }. An onset
 * shorter than one frame is dropped.
 */
export function noteItems(clip, base, { pass, tempo, cutS = null, toAudio }) {
  const spb = 60 / tempo;
  const cutBeats = cutS === null ? clip.musical.durationBeats : cutS / spb;
  const posOf = (beats) => clip.start + beats * spb;
  const out = [];
  for (const o of notePlan(clip.payload, { pass, cutBeats })) {
    const position = posOf(o.start);
    const startTime = toAudio(position);
    const endTime = toAudio(posOf(o.gate ? o.gateEnd : o.end));
    if (!(endTime > startTime)) continue;
    out.push({ ...base, key: `${base.key}:${o.index}.${o.onset}`, type: 'note', position,
      startTime, endTime, duration: endTime - startTime, beat: o.start, index: o.index,
      onset: o.onset, note: o.note, velocity: o.velocity, gate: o.gate, slide: o.slide });
  }
  return out;
}
