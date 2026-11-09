// The Drums view of the Synth (plan issue K222, ADR 0086, Q019): its pure half. One notes clip
// on a track of the panel's percussion engine (panels/engines.js `perc`), shown as rows of steps
// by the step-grid kind. A row is a note number of the engine's key map (ADR 0086 decision 5),
// in the octave the engine plays untransposed (perc-recipes.js percNote: C4-B4); its name is
// Czech and lives in the label, never in the voice ids of perc-recipes.js (Q104). A row's voice
// is changed by rewriting that lane's note numbers in one CLIP_UPDATE; a voice another row
// already holds is refused with its sentence. No DOM, no store, no audio.
//
//   DRUMS_TAB     the tab of the Synth panel declaration (panels/semi-mono.js)
//   DRUM_VOICES   [{ voice, note, label }] every voice the picker offers
//   DRUM_ROWS     the six default rows (kick, snare, clap, hat closed, hat open, tom mid)
//   DRUM_TEXT     the sentences (Czech)
//   rowsOf(clip, rows = DRUM_ROWS) -> rows   the default rows, then a row for each other note
//                 of the clip that is a drum voice (so no note is ever hidden), at most 8
//   lanesOf(rows) -> note numbers;  namesOf(rows) -> Czech names
//   drumClipOf(model, percId) -> clip | null  the first notes clip on a track of the engine
//   newDrumClip(model, percId) -> BATCH action  a track on the engine and an empty one-bar
//                 notes clip on the new step grid, one history entry
//   voiceChange(clip, rows, row, voice) -> { action, rows } | { refused }

import { NEW_STEP_GRID } from '../studio/notes-grid.js';

/** The Synth's Drums tab (Q019: a Pro tab of the one Synth workspace). */
export const DRUMS_TAB = Object.freeze({ id: 'drums', label: 'Bicí', title: 'Bicí',
  description: 'Bicí kroky jednoho taktu na perkusním enginu panelu: řada je zvuk sady, krok '
    + 'jeho úder. Pady pod mřížkou zahrají řadu hned; Přehrát spustí transport Studia.' });

/** Every voice of the kit at its untransposed note (perc-recipes.js PERC_KEYMAP, octave 5). */
export const DRUM_VOICES = Object.freeze([
  { voice: 'kick', note: 60, label: 'Kopák' },
  { voice: 'snare', note: 62, label: 'Virbl' },
  { voice: 'clap', note: 61, label: 'Tlesk' },
  { voice: 'hatClosed', note: 66, label: 'Hi-hat zavřený' },
  { voice: 'hatOpen', note: 70, label: 'Hi-hat otevřený' },
  { voice: 'tomMid', note: 65, label: 'Tom střední' },
  { voice: 'tomLow', note: 64, label: 'Tom nízký' },
  { voice: 'tomHigh', note: 67, label: 'Tom vysoký' },
].map((v) => Object.freeze(v)));
/** The six rows a new Drums view shows. */
export const DRUM_ROWS = Object.freeze(['kick', 'snare', 'clap', 'hatClosed', 'hatOpen',
  'tomMid']);
const MAX_ROWS = 8;
const TRACK_NAME = 'Bicí';

export const DRUM_TEXT = Object.freeze({
  taken: (label) => `${label} už má jiná řada; každý zvuk sady hraje jedna řada.`,
  unknown: 'Tento zvuk sada nemá.',
});

const byVoice = new Map(DRUM_VOICES.map((v) => [v.voice, v]));
const byNote = new Map(DRUM_VOICES.map((v) => [v.note, v]));

export function rowsOf(clip, rows = DRUM_ROWS) {
  const out = [...rows];
  for (const n of clip ? clip.payload.notes : []) {
    const v = byNote.get(n.note);
    if (v && !out.includes(v.voice) && out.length < MAX_ROWS) out.push(v.voice);
  }
  return out;
}
export const lanesOf = (rows) => rows.map((r) => byVoice.get(r).note);
export const namesOf = (rows) => rows.map((r) => byVoice.get(r).label);

export function drumClipOf(model, percId) {
  const tracks = new Set(model.timeline.tracks.filter((t) => t.target === percId)
    .map((t) => t.id));
  return model.timeline.clips.find((c) => c.kind === 'notes'
    && (c.target === percId || (!c.target && tracks.has(c.trackId)))) || null;
}

export function newDrumClip(model, percId) {
  const ids = new Set(model.timeline.tracks.map((t) => t.id));
  let k = 1;
  while (ids.has(`track-drums-${k}`)) k += 1;
  const trackId = `track-drums-${k}`;
  return { type: 'BATCH', label: 'Bicí klip', steps: [
    { type: 'TRACK_ADD', id: trackId, kind: 'event', target: percId, name: TRACK_NAME },
    { type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
      durationBeats: NEW_STEP_GRID.steps * NEW_STEP_GRID.stepBeats, payload: { notes: [] } },
  ] };
}

export function voiceChange(clip, rows, row, voice) {
  const to = byVoice.get(voice);
  if (!to) return { refused: DRUM_TEXT.unknown };
  const from = byVoice.get(rows[row]);
  if (from.voice === voice) return { action: null, rows };
  if (rows.includes(voice)) return { refused: DRUM_TEXT.taken(to.label) };
  const next = rows.map((r, i) => (i === row ? voice : r));
  const notes = clip.payload.notes.map((n) => (n.note === from.note ? { ...n, note: to.note } : n))
    .sort((a, b) => a.at - b.at || a.note - b.note);
  return { rows: next, action: { type: 'CLIP_UPDATE', clipId: clip.id,
    payload: { ...clip.payload, notes } } };
}
