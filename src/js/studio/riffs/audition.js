// Audition a riff (Q032's ephemeral preview): the riff plays as ONE finite steps plan of the
// AudioEngine's play(), the instrument's own path under its own owner name ('audition', the
// output-owner table's row), so the engine's output guard decides (a measurement or a microphone
// level reference owns the output: refused, and said). Nothing is written to the StudioModel,
// the history or provenance. While the output is refused (refused(), the table's refusal text,
// or the older measuring() flag), Listen is refused with that sentence before anything is
// stopped (a capture is never aborted silently); otherwise it stops the ordinary
// owners first (Hold, the sequencer, the Studio transport), and Stop, a load from the library
// or closing its dialog ends it. The riff is monophonic, so one voice plays it; each note keeps
// a tenth of its length as a gap, so repeated pitches are heard as separate notes.
//
//   auditionPlan(riff, { tempo = riff.tempo, transpose = 0 }) -> the engine's steps plan
//   createRiffAudition({ engine, stopOthers, measuring, refused }) -> { start(id, opts,
//     { onEnd }) -> { ok } | { ok: false, reason }, stop() -> bool, playing: the riff id while
//     its engine voice sounds | null, dispose() }

import { midiOf, noteHz } from '../templates/demo-song-score.js';
import { BAR_STEPS, riffOf } from './library.js';

const GATE = 0.9;
/** The instrument's play options for a programmed plan (core/instrument.js): one trigger of the
 *  whole riff, a short attack and release on each step, and the owner mark the instrument reads
 *  so its live update never rebuilds the riff into its own plan (instrument.js syncViz). */
export const AUDITION_OPTIONS = Object.freeze({ mode: 'trigger', attackS: 0.005,
  releaseS: 0.02, owner: 'audition' });

export function auditionPlan(riff, { tempo = riff.tempo, transpose = 0 } = {}) {
  const step = 60 / tempo * 4 / BAR_STEPS;
  const steps = riff.notes.map(([at, pitch, len]) => ({ t: at * step,
    f: noteHz(midiOf(pitch) + transpose), dur: len * step * GATE }));
  return { type: 'steps', kind: 'finite', wave: riff.voice.waveform, steps,
    dur: riff.bars * BAR_STEPS * step, label: `Riff ${riff.title}`,
    freqs: [...new Set(steps.map((s) => s.f))], modulated: true };
}

export function createRiffAudition({ engine = null, stopOthers = () => {},
  measuring = () => false, refused = () => null } = {}) {
  let playing = null;
  let voice = null;
  let onEnd = null;
  let off = () => {};
  // The audition lasts as long as its engine voice, never by the clock: it ends when the engine
  // releases or ends that voice (its natural end, a stop from any owner, a hidden page) or starts
  // a voice of another plan over it, or the context closes. A replacement that carries this
  // audition's own play options (the owner mark and the riff id) carries the audition to it.
  const current = () => {
    const o = engine && engine.voice && engine.voice.opts;
    return o && o.owner === AUDITION_OPTIONS.owner && o.riff === playing ? engine.voice.id : null;
  };
  const end = () => {
    if (!playing) return;
    playing = null;
    voice = null;
    const fn = onEnd;
    onEnd = null;
    if (fn) fn();
  };
  if (engine && typeof engine.on === 'function') {
    off = engine.on((type, d) => {
      if (!playing) return;
      if (type === 'play' && d && d.id !== voice) {
        if (current() === d.id) voice = d.id;
        else end();
      } else if (((type === 'release' || type === 'ended') && d && d.id === voice)
        || (type === 'context' && d === 'closed')) {
        end();
      }
    });
  }
  return {
    /** start(id, opts, { onEnd }) -> { ok } | { ok: false, reason }; onEnd runs once it ends. */
    start(id, opts, hooks = {}) {
      const riff = riffOf(id);
      if (!riff) return { ok: false, reason: `No riff "${String(id)}" in the library.` };
      if (!engine || typeof engine.play !== 'function') {
        return { ok: false, reason: 'No audio output: the riff cannot play here.' };
      }
      const why = refused()
        || (measuring() ? 'A measurement is running: the riff plays after it.' : null);
      if (why) return { ok: false, reason: why };
      stopOthers();
      end();
      const plan = auditionPlan(riff, opts);
      const info = engine.play(plan, { ...AUDITION_OPTIONS, riff: riff.id, durationS: plan.dur,
        limitS: plan.dur });
      if (!info) {
        return { ok: false, reason: 'The riff cannot play now: a measurement owns the output, '
          + 'or audio is off.' };
      }
      playing = riff.id;
      voice = current() || info.id;
      onEnd = typeof hooks.onEnd === 'function' ? hooks.onEnd : null;
      return { ok: true };
    },
    stop() {
      if (!playing) return false;
      end();
      engine.stopAll();
      return true;
    },
    get playing() { return playing; },
    /** Stop listening to the engine (a re-registered source replaces this one). */
    dispose() {
      if (playing) this.stop();
      off();
      off = () => {};
    },
  };
}
