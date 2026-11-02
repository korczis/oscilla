// One output owner at a time (plan issue C002; docs/v31/compiler.md, "exclusive").
//
// The owners of the shared output are the instrument (every Playground voice, through the
// engine.play wrapper in main.js), the V2 pattern sequencer, the Studio transport and a
// measurement. A measurement is never displaced: while it owns the output every other claim is
// refused with the same notice. Any other claim takes the output in the action itself, from the
// live state of each owner, never from the 150 ms app.seqPlaying copy the views read.
//
// No Web Audio here: the owners stop through their own click-free paths (editor.stop(),
// cmp.stopNow(), cmp.studioStop()), so the AudioEngine stays the one authority over nodes.

export const OUTPUT_REFUSAL = 'The output belongs to the measurement: stop it (Esc) before '
  + 'playing.';

/** Who yields the output when an owner takes it. */
export const OUTPUT_YIELDS = Object.freeze({
  // A playing Studio stops on its own watch of app.playing (ui/studio/workspace.js).
  instrument: Object.freeze(['sequencer']),
  sequencer: Object.freeze(['instrument', 'studio']),
  // MEASURE and Studio PLAY (through stopPlayback); the Studio is not playing while it claims.
  measure: Object.freeze(['sequencer', 'instrument', 'studio']),
});

/**
 * options: { app() → the reactive component or null, sequencer() → the sequencer editor or
 *            null, changed() → called (in a microtask) after app.seqPlaying was set here }
 * → { sequencerPlaying(), stopSequence(cmp), claimOutput(owner), stopPlayback(cmp) }
 */
export function createOutputOwner({ app, sequencer, changed = () => {} }) {
  const later = (fn) => (typeof queueMicrotask === 'function' ? queueMicrotask(fn)
    : Promise.resolve().then(fn));
  /** The sequencer's own transport state. */
  const sequencerPlaying = () => {
    const ed = sequencer();
    return !!(ed && ed.playing);
  };

  /** Stop a playing sequence (click-free fade) and clear the polled copy at once. */
  function stopSequence(cmp) {
    if (!sequencerPlaying()) return false;
    sequencer().stop();
    if (cmp.seqPlaying) {
      cmp.seqPlaying = false;
      later(changed);
    }
    return true;
  }

  function yieldOutput(cmp, owners) {
    for (const owner of owners) {
      if (owner === 'sequencer') {
        stopSequence(cmp);
      } else if (owner === 'instrument' && cmp.playing) {
        cmp.stopNow();
      } else if (owner === 'studio' && typeof cmp.studioOwnsOutput === 'function'
        && cmp.studioOwnsOutput()) {
        cmp.studioStop();
      }
    }
  }

  /**
   * `owner` ('instrument' or 'sequencer') takes the output: true, or the reason it is refused
   * (a measurement owns it; the notice is raised here, once, for every owner alike).
   */
  function claimOutput(owner) {
    const cmp = app();
    if (!cmp) return true;
    if (!OUTPUT_YIELDS[owner]) throw new Error(`claimOutput: unknown owner ${owner}`);
    if (typeof cmp.measureOwnsOutput === 'function' && cmp.measureOwnsOutput()) {
      cmp.notify('info', 'Measurement in progress', OUTPUT_REFUSAL);
      return OUTPUT_REFUSAL;
    }
    yieldOutput(cmp, OUTPUT_YIELDS[owner]);
    if (owner === 'sequencer' && !cmp.seqPlaying) {
      cmp.seqPlaying = true; // the views and Studio's watch learn it now, not at the next poll
      later(changed);
    }
    return true;
  }

  /**
   * Measure (and Studio PLAY, and the status-bar stop key) take the output: stop the instrument
   * and the sequencer (their voices fade), a playing Studio (V3.1; it is not playing while it
   * claims the output) and the MIDI notes (V502).
   */
  function stopPlayback(cmp) {
    yieldOutput(cmp, OUTPUT_YIELDS.measure);
    if (typeof cmp.midiAllOff === 'function') cmp.midiAllOff();
  }

  return { sequencerPlaying, stopSequence, claimOutput, stopPlayback };
}
