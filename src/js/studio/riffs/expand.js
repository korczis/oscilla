// A riff (library.js) into the Studio (B3). Pure; the StudioModel is the only place a riff
// lands (rule project.studio-model-is-canonical).
//
//   riffAction(model, riff, { trackId, atBeats = 0 }) -> { action } | { reason }
//     one BATCH of tempo-linked pattern clips on an event track, a tone clip per note, so one
//     Undo removes the whole riff and a tempo change moves every note with it
//   toNotes(riff) -> { notes: [{ at, note, len, vel }] }  at and len in beats from the riff's
//     start, note a MIDI number, vel 0..1: the payload of the multi-note clip kind the Studio's
//     piano roll brings (lane C+); until it lands nothing reads it but the tests
//   riffBeats(riff) -> the riff's length in beats (bars of 4/4)
import { midiOf, noteHz } from '../templates/demo-song-score.js';
import { BAR_STEPS } from './library.js';

const STEP_BEATS = 4 / BAR_STEPS;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

export const riffBeats = (riff) => riff.bars * 4;

export function toNotes(riff) {
  return { notes: riff.notes.map(([step, pitch, len, vel]) => ({ at: round6(step * STEP_BEATS),
    note: midiOf(pitch), len: round6(len * STEP_BEATS), vel: round6(vel / 127) })) };
}

export function riffAction(model, riff, { trackId, atBeats = 0 } = {}) {
  const track = model.timeline.tracks.find((t) => t.id === trackId);
  if (!track) return { reason: 'Choose an event track for the riff.' };
  if (track.kind !== 'event') {
    return { reason: `${track.name || track.id} is a ${track.kind} track; a riff goes on an `
      + 'event track.' };
  }
  if (!(Number.isFinite(atBeats) && atBeats >= 0)) {
    return { reason: 'A riff starts at a beat of 0 or later.' };
  }
  const steps = riff.notes.map(([step, pitch, len]) => ({ type: 'CLIP_ADD', trackId,
    kind: 'pattern', startBeats: round6(atBeats + step * STEP_BEATS),
    durationBeats: round6(len * STEP_BEATS),
    payload: { blockType: 'tone', params: { freq: noteHz(midiOf(pitch)) } } }));
  return { action: { type: 'BATCH', label: `Insert riff ${riff.title}`, steps } };
}
