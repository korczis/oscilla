// A riff (library.js) into the Studio (B3). Pure; the StudioModel is the only place a riff
// lands (rule project.studio-model-is-canonical).
//
//   riffAction(model, riff, { trackId, atBeats = 0 }) -> { action } | { reason }
//     one BATCH of tempo-linked pattern clips on an event track, a tone clip per note, so one
//     Undo removes the whole riff and a tempo change moves every note with it
//   toNotes(riff) -> { notes: [{ at, note, len, vel }] }  at and len in beats from the riff's
//     start, note a MIDI number, vel 0..1: the payload of the multi-note clip kind the Studio's
//     piano roll brings (lane C+); until it lands nothing reads it but the tests
//   riffVoiceAction(model, riff, { atBeats = 0, at }) -> { action } | { reason }
//     the riff with a voice of its own, one BATCH: the Oscillator and low-pass Filter it was
//     written for (riff.voice), wired to the Master Output, an event track on the Oscillator and
//     the riff's clips on it; ids are free ones named after the riff, so one Undo removes it all
//   riffBeats(riff) -> the riff's length in beats (bars of 4/4)
import { midiOf, noteHz } from '../templates/demo-song-score.js';
import { BAR_STEPS } from './library.js';
import { withArticle } from '../../core/article.js';

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
    return { reason: `${track.name || track.id} is ${withArticle(track.kind)} track; a riff `
      + 'goes on an event track.' };
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

const PARTS = ['osc', 'filter', 'track', 'mix', 'e1', 'e2', 'e3', 'e4'];
/** A free stem `<base>`, `<base>-2`, ...: no id of the model starts with `<stem>-<part>`. */
function freeId(model, base) {
  const used = new Set([...model.graph.nodes, ...model.graph.edges, ...model.timeline.tracks,
    ...model.timeline.clips].map((x) => x.id));
  let id = base;
  for (let n = 2; PARTS.some((p) => used.has(`${id}-${p}`)); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The Filter into the Master Output, whose one audio input takes one connection: directly when
 * nothing feeds it, into a free input of the Mixer that feeds it, or else through a new Mixer
 * that takes the old feed on input 1 and the riff on input 2.
 */
function toMaster(model, master, filter, base, position) {
  const from = { node: filter, port: 'audio' };
  const feed = model.graph.edges.find((e) => e.to.node === master.id && e.to.port === 'audio');
  if (!feed) {
    return [{ type: 'EDGE_ADD', id: `${base}-e2`, from, to: { node: master.id, port: 'audio' } }];
  }
  const feeder = model.graph.nodes.find((n) => n.id === feed.from.node);
  if (feeder && feeder.type === 'mixer') {
    const free = ['in1', 'in2', 'in3', 'in4'].find((p) => !model.graph.edges.some((e) =>
      e.to.node === feeder.id && e.to.port === p));
    if (free) {
      return [{ type: 'EDGE_ADD', id: `${base}-e2`, from, to: { node: feeder.id, port: free } }];
    }
  }
  const mix = `${base}-mix`;
  return [
    { type: 'NODE_ADD', id: mix, nodeType: 'mixer', name: 'Riff mix', position },
    { type: 'EDGE_REMOVE', edgeId: feed.id },
    { type: 'EDGE_ADD', id: `${base}-e3`, from: feed.from, to: { node: mix, port: 'in1' } },
    { type: 'EDGE_ADD', id: `${base}-e2`, from, to: { node: mix, port: 'in2' } },
    { type: 'EDGE_ADD', id: `${base}-e4`, from: { node: mix, port: 'audio' },
      to: { node: master.id, port: 'audio' } },
  ];
}

export function riffVoiceAction(model, riff, { atBeats = 0, at = null } = {}) {
  const master = model.graph.nodes.find((n) => n.type === 'master');
  if (!master) return { reason: 'The Studio has no Master Output to play the riff through.' };
  const base = freeId(model, `riff-${riff.id}`);
  const osc = `${base}-osc`;
  const filter = `${base}-filter`;
  const trackId = `${base}-track`;
  const y = at ? at.y : Math.max(0, ...model.graph.nodes.map((n) => n.position.y)) + 160;
  const x = at ? at.x : 40;
  const voice = [
    { type: 'NODE_ADD', id: osc, nodeType: 'oscillator', name: `${riff.title} voice`,
      position: { x, y }, params: { waveform: riff.voice.waveform, level: 0.5 } },
    { type: 'NODE_ADD', id: filter, nodeType: 'filter', name: `${riff.title} filter`,
      position: { x: x + 220, y }, params: { type: 'lowpass', frequency: riff.voice.cutoff,
        Q: riff.voice.Q } },
    { type: 'EDGE_ADD', id: `${base}-e1`, from: { node: osc, port: 'audio' },
      to: { node: filter, port: 'audio' } },
    ...toMaster(model, master, filter, base, { x: x + 440, y }),
    { type: 'TRACK_ADD', id: trackId, kind: 'event', name: riff.title, target: osc },
  ];
  const withTrack = { ...model, timeline: { ...model.timeline,
    tracks: [...model.timeline.tracks, { id: trackId, kind: 'event', name: riff.title,
      target: osc }] } };
  const clips = riffAction(withTrack, riff, { trackId, atBeats });
  if (clips.reason) return clips;
  return { action: { type: 'BATCH', label: `Insert riff ${riff.title} with its voice`,
    steps: [...voice, ...clips.action.steps] } };
}
