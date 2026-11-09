// A notes clip's grid change (plan issue W008, ADR 0086 decision 2): the pure half of the
// NOTES_GRID_SET action (actions.js), one undo entry. The grid never moves a note by itself:
//
//   keep    the grid changes and every note stays where it is (some may become off-grid)
//   map     every note's at and len scale by the new over the old stepBeats; refused, the clip
//           unchanged, when a note would end past the clip
//   refuse  applies only when every note sits on the new grid, else refused naming the first
//           note that would not
//
// There is no silent re-quantise. swing and seed change with any mode (they move no note);
// changing the seed is a NOTES_GRID_SET too (decision 4). A clip without a grid starts from
// NEW_STEP_GRID with no swing and seed 0.
//
//   NEW_STEP_GRID, GRID_SET_MODES, NOTES_GRID_TEXT
//   gridSet(clip, grid, mode) -> { payload } | { refused: sentence }
//     grid: any of { stepBeats, swing, seed }, merged onto the clip's grid

import { GRID_FIELDS, notesRules } from './notes.js';

/** A new step clip's grid: one 4/4 bar of sixteenths (ADR 0086 decision 2). */
export const NEW_STEP_GRID = Object.freeze({ steps: 16, stepBeats: 0.25 });
/** How a grid change treats the notes (ADR 0086 decision 2). */
export const GRID_SET_MODES = Object.freeze(['keep', 'map', 'refuse']);

const EPS = 1e-9;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => Math.round(v * 1e6) / 1e6;

/** The sentences of a refused grid change. Czech (Q104). */
export const NOTES_GRID_TEXT = Object.freeze({
  kind: 'Mřížku má jen notový klip.',
  mode: `Změna mřížky má režim ${GRID_SET_MODES.join(', ')}.`,
  grid: `Změna mřížky nese některé z polí ${GRID_FIELDS.join(', ')}.`,
  field: (k) => `Změna mřížky nese některé z polí ${GRID_FIELDS.join(', ')}; „${k}“ mezi `
    + 'ně nepatří.',
  mapEnd: (i, end, beats) => `Přepočet mřížky by posunul konec noty ${i + 1} na dobu `
    + `${num(end)}, za konec klipu v době ${num(beats)}; klip zůstává, jak byl.`,
  offGrid: (i, at) => `Nota ${i + 1} v době ${num(at)} by na nové mřížce nebyla na kroku; `
    + 'režim refuse proto mřížku nemění.',
});

const onGrid = (at, stepBeats) => {
  const q = at / stepBeats;
  return Math.abs(q - Math.round(q)) < EPS * Math.max(1, Math.abs(q));
};

export function gridSet(clip, grid, mode = 'keep') {
  if (!clip || clip.kind !== 'notes') return { refused: NOTES_GRID_TEXT.kind };
  if (!GRID_SET_MODES.includes(mode)) return { refused: NOTES_GRID_TEXT.mode };
  if (!isObj(grid)) return { refused: NOTES_GRID_TEXT.grid };
  for (const k of Object.keys(grid)) {
    if (!GRID_FIELDS.includes(k)) return { refused: NOTES_GRID_TEXT.field(k) };
  }
  const old = clip.payload.grid || { stepBeats: NEW_STEP_GRID.stepBeats, swing: 0, seed: 0 };
  const next = { ...old, ...grid };
  const notes = clip.payload.notes;
  let out = notes;
  if (mode === 'map' && next.stepBeats !== old.stepBeats) {
    const f = next.stepBeats / old.stepBeats;
    const beats = clip.musical && Number.isFinite(clip.musical.durationBeats)
      ? clip.musical.durationBeats : null;
    out = notes.map((n) => ({ ...n, at: n.at * f, len: n.len * f }));
    if (beats !== null) {
      const i = out.findIndex((n) => n.at + n.len > beats + EPS);
      if (i >= 0) return { refused: NOTES_GRID_TEXT.mapEnd(i, out[i].at + out[i].len, beats) };
    }
  }
  if (mode === 'refuse') {
    const i = notes.findIndex((n) => !onGrid(n.at, next.stepBeats));
    if (i >= 0) return { refused: NOTES_GRID_TEXT.offGrid(i, notes[i].at) };
  }
  const payload = { ...clip.payload, notes: out, grid: next };
  // The new grid's own fields are judged as the notes rules judge a loaded clip.
  const bad = notesRules({ ...clip, payload })
    .find((r) => r.path && r.path.startsWith('payload.grid'));
  if (bad) return { refused: bad.message };
  return { payload };
}
