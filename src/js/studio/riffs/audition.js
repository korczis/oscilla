// Audition a riff (Q032's ephemeral preview): the riff plays as ONE finite steps plan of the
// AudioEngine's play(), the instrument's own path, so the engine's output guard decides (a
// measurement owns the output: refused, and said). Nothing is written to the StudioModel, the
// history or provenance; Listen stops the other owners first, and Stop, a load from the library
// or closing its dialog ends it. The riff is monophonic, so one voice plays it; each note keeps
// a tenth of its length as a gap, so repeated pitches are heard as separate notes.
//
//   auditionPlan(riff, { tempo = riff.tempo, transpose = 0 }) -> the engine's steps plan
//   createRiffAudition({ engine, stopOthers, now }) -> { start(id, opts) -> { ok, ms } |
//     { ok: false, reason }, stop() -> bool, playing: the riff id until it ends | null }

import { midiOf, noteHz } from '../templates/demo-song-score.js';
import { BAR_STEPS, riffOf } from './library.js';

const GATE = 0.9;
/** The instrument's play options for a programmed plan (core/instrument.js): one trigger of the
 *  whole riff, a short attack and release on each step. */
export const AUDITION_OPTIONS = Object.freeze({ mode: 'trigger', attackS: 0.005,
  releaseS: 0.02 });

export function auditionPlan(riff, { tempo = riff.tempo, transpose = 0 } = {}) {
  const step = 60 / tempo * 4 / BAR_STEPS;
  const steps = riff.notes.map(([at, pitch, len]) => ({ t: at * step,
    f: noteHz(midiOf(pitch) + transpose), dur: len * step * GATE }));
  return { type: 'steps', kind: 'finite', wave: riff.voice.waveform, steps,
    dur: riff.bars * BAR_STEPS * step, label: `Riff ${riff.title}`,
    freqs: [...new Set(steps.map((s) => s.f))], modulated: true };
}

export function createRiffAudition({ engine = null, stopOthers = () => {},
  now = () => Date.now() } = {}) {
  let playing = null;
  let until = 0;
  return {
    start(id, opts) {
      const riff = riffOf(id);
      if (!riff) return { ok: false, reason: `No riff "${String(id)}" in the library.` };
      if (!engine || typeof engine.play !== 'function') {
        return { ok: false, reason: 'No audio output: the riff cannot play here.' };
      }
      stopOthers();
      const plan = auditionPlan(riff, opts);
      playing = engine.play(plan, { ...AUDITION_OPTIONS, durationS: plan.dur,
        limitS: plan.dur }) ? riff.id : null;
      until = now() + plan.dur * 1000;
      return playing ? { ok: true, ms: Math.ceil(plan.dur * 1000) } : { ok: false,
        reason: 'The riff cannot play now: a measurement owns the output, or audio is off.' };
    },
    stop() {
      if (!this.playing) return false;
      playing = null;
      engine.stopAll();
      return true;
    },
    get playing() { return playing && now() < until ? playing : null; },
  };
}
