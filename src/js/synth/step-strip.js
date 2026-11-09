// The Synth's step-sequencer strip (plan K221, Q103 (2); ADR 0086): steps above the Synth face
// that play the panel's Keys on the transport. It is no grid of its own: the strip is a notes
// clip on an event track whose target is the panel's Keys node, drawn and edited by the one
// step-grid kind (ui/kinds/step-grid.js, W008) through the Studio Inspector's clip-steps mount
// (ui/studio/inspector-steps.js mountClipSteps), and played by the transport's notes path (K068).
// Pure apart from the model it reads: every change is one plain action through the one store.
//
//   STRIP_TEXT                              the strip's Czech sentences
//   stripOf(model, panel) -> { keys, track, clip } | null
//     the first notes clip on an event track targeting the panel's Keys (a Studio-made one too)
//   stripCreateAction(model, panel) -> { action } | { reason }
//     one BATCH: an event track on the panel's Keys and a notes clip of NEW_STEP_GRID's 16 steps
//     of 1/16 at the start, its grid recorded; refused without the panel's Keys or with a strip

import { NEW_STEP_GRID } from '../studio/notes-grid.js';

export const STRIP_TEXT = Object.freeze({
  title: 'Krokový sekvencer',
  noKeys: 'Panel Synthu tu nemá klávesy (uzel Keys), takže sekvencer nemá co hrát.',
  exists: 'Krokový sekvencer už v tomto dokumentu je.',
  created: 'Krokový sekvencer přidán: 16 kroků po šestnáctinách hraje klávesy panelu, '
    + 'když běží Play.',
});

const STRIP_TRACK = 'synth-steps';

/** The strip of `model`: the first notes clip on an event track on the panel's Keys. */
export function stripOf(model, panel) {
  const keys = panel.resolve(model).get('keys');
  if (!keys) return null;
  for (const track of model.timeline.tracks) {
    if (track.kind !== 'event' || track.target !== keys.id) continue;
    const clip = model.timeline.clips.find((c) => c.trackId === track.id && c.kind === 'notes');
    if (clip) return { keys, track, clip };
  }
  return null;
}

/** A track id not in the model: STRIP_TRACK, else STRIP_TRACK-2, -3, ... */
function freeTrackId(model) {
  const used = new Set(model.timeline.tracks.map((t) => t.id));
  let id = STRIP_TRACK;
  for (let i = 2; used.has(id); i++) id = `${STRIP_TRACK}-${i}`;
  return id;
}

export function stripCreateAction(model, panel) {
  const keys = panel.resolve(model).get('keys');
  if (!keys) return { reason: STRIP_TEXT.noKeys };
  if (stripOf(model, panel)) return { reason: STRIP_TEXT.exists };
  const trackId = freeTrackId(model);
  const { steps, stepBeats } = NEW_STEP_GRID;
  return { action: { type: 'BATCH', label: STRIP_TEXT.title, steps: [
    { type: 'TRACK_ADD', id: trackId, kind: 'event', target: keys.id },
    { type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0, durationBeats: steps * stepBeats,
      payload: { notes: [], grid: { stepBeats, swing: 0, seed: 0 } } },
  ] } };
}
