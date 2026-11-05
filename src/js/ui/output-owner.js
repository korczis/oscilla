// One output owner at a time (plan issue C002; docs/v31/compiler.md, "exclusive").
//
// The owners of the shared output are the instrument (every Playground voice, through the
// engine.play wrapper in main.js), the riff audition (the same wrapper, its own name), the V2
// pattern sequencer, the Studio transport and a measurement. A measurement, and a microphone
// level-reference capture, is never displaced: while one holds the output every other claim is
// refused with its notice (OUTPUT_REFUSALS). Any other claim takes the output in the action
// itself, from the live state of each owner, never from the 150 ms app.seqPlaying copy the views
// read.
//
// No Web Audio here: the owners stop through their own click-free paths (editor.stop(),
// cmp.stopNow(), cmp.studioStop()), so the AudioEngine stays the one authority over nodes.

export const OUTPUT_REFUSAL = 'The output belongs to the measurement: stop it (Esc) before '
  + 'playing.';
export const REFERENCE_REFUSAL = 'The output stays silent while the level reference is captured '
  + 'from the microphone: stop the capture before playing.';

/**
 * Who refuses every claim, in order (C024): a measurement, then a microphone level-reference
 * capture (session.js; the capture stopped the other owners when it started, and the reading
 * must not hear one start). Each row names the component's probe and the notice it raises.
 */
export const OUTPUT_REFUSALS = Object.freeze([
  Object.freeze({ owner: 'measurement', probe: 'measureOwnsOutput',
    title: 'Measurement in progress', text: OUTPUT_REFUSAL }),
  Object.freeze({ owner: 'reference', probe: 'measureReferenceOwnsOutput',
    title: 'Level reference capture', text: REFERENCE_REFUSAL }),
]);

/** The refusal row that holds the output now, or null (pure: it reads the probes only). */
export function outputRefusalOf(cmp) {
  if (!cmp) return null;
  return OUTPUT_REFUSALS.find((r) => typeof cmp[r.probe] === 'function' && cmp[r.probe]())
    || null;
}

/** Who yields the output when an owner takes it. */
export const OUTPUT_YIELDS = Object.freeze({
  // A playing Studio stops on its own watch of app.playing (ui/studio/workspace.js).
  instrument: Object.freeze(['sequencer']),
  // The riff audition (studio/riffs/audition.js) plays through the instrument's engine.play path
  // under its own name; it stopped every other owner itself (svc.stopPlayback) before it plays.
  audition: Object.freeze(['sequencer']),
  sequencer: Object.freeze(['instrument', 'studio']),
  // MEASURE and Studio PLAY (through stopPlayback); the Studio is not playing while it claims.
  measure: Object.freeze(['sequencer', 'instrument', 'studio']),
});

/**
 * options: { app() → the reactive component or null, sequencer() → the sequencer editor or
 *            null, changed() → called (in a microtask) after app.seqPlaying was set here }
 * → { sequencerPlaying(), stopSequence(cmp), claimOutput(owner), stopPlayback(cmp),
 *      outputBusy(cmp) }
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

  // The one table of the sources that sound into the master output (C002, C016): what yields
  // when an owner takes the output and what the setup check of a measurement reports as other
  // audio read the same rows. The sequencer is read live (editor.playing), never through the
  // 150 ms app.seqPlaying copy; its voices and the Studio's never enter the engine's
  // audibleVoiceCount.
  const SOURCES = {
    sequencer: { busy: () => sequencerPlaying(), stop: (cmp) => stopSequence(cmp) },
    instrument: { busy: (cmp) => !!cmp.playing, stop: (cmp) => cmp.stopNow() },
    studio: {
      busy: (cmp) => typeof cmp.studioOwnsOutput === 'function' && !!cmp.studioOwnsOutput(),
      stop: (cmp) => cmp.studioStop(),
    },
  };

  function yieldOutput(cmp, owners) {
    for (const owner of owners) if (SOURCES[owner].busy(cmp)) SOURCES[owner].stop(cmp);
  }

  /**
   * True while any owner that stopPlayback stops sounds (MEASURE's setup check reports it as
   * other audio, C016); it stops and claims nothing.
   */
  function outputBusy(cmp) {
    return OUTPUT_YIELDS.measure.some((owner) => SOURCES[owner].busy(cmp));
  }

  /**
   * `owner` ('instrument', 'audition' or 'sequencer') takes the output: true, or the reason it is
   * refused (a row of OUTPUT_REFUSALS holds it; the notice is raised here, once, for every owner
   * alike).
   */
  function claimOutput(owner) {
    const cmp = app();
    if (!cmp) return true;
    if (!OUTPUT_YIELDS[owner]) throw new Error(`claimOutput: unknown owner ${owner}`);
    // Known divergence, kept on purpose: the reference row refuses only a microphone capture
    // (measureReferenceOwnsOutput, as calibration.js stops playback only for the microphone; the
    // loopback TEST CONTEXT reference is the instrument's own output). The MIDI and keyboard
    // notes (midi/ui.js ownedBy 'reference') refuse every capture, loopback included, so in a
    // loopback capture a MIDI note is refused while a Playground voice plays. Not decided here.
    const refusal = outputRefusalOf(cmp);
    if (refusal) {
      cmp.notify('info', refusal.title, refusal.text);
      return refusal.text;
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

  return { sequencerPlaying, stopSequence, claimOutput, stopPlayback, outputBusy };
}

/**
 * The owner an engine.play claims the output as (the guard in main.js): the riff audition's
 * voices carry its owner mark (AUDITION_OPTIONS.owner); every other voice is the instrument's.
 */
export function playOwnerOf(opts) {
  return opts && opts.owner === 'audition' ? 'audition' : 'instrument';
}
