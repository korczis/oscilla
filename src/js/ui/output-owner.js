// One output owner at a time (plan issues C002, C036; docs/v31/compiler.md, "exclusive").
//
// OUTPUT_OWNER_TABLE below is the one table of who may own the shared output, in precedence
// order: what refuses every claim (a measurement, a microphone level-reference capture), what
// yields to whom when an owner takes it, what refuses the keyboard and MIDI notes and with
// which sentence, and how the views name the owner. Every other site imports a projection of
// it (C036): OUTPUT_REFUSALS and OUTPUT_YIELDS here, the views' owners and names
// (visualization/output-owner.js), the notes' refusals (midi/ui.js, midi/keyboard-ui.js), the
// Space owners (ui/shortcuts.js), the instrument's "another owner's voice" check
// (core/instrument.js) and the riff audition's owner mark (studio/riffs/audition.js).
// tests/unit/output-owner-one-table.test.mjs refuses a second table anywhere in src/js.
//
// A measurement, and a microphone level-reference capture, is never displaced: while one holds
// the output every other claim is refused with its notice. Any other claim takes the output in
// the action itself, from the live state of each owner, never from the 150 ms app.seqPlaying
// copy the views read. The Synth workspace is no owner of its own: its panel sounds through the
// Studio transport (studio) and its keys and XY pad are notes.
//
// No Web Audio here: the owners stop through their own click-free paths (editor.stop(),
// cmp.stopNow(), cmp.studioStop(), cmp.midiAllOff()), so the AudioEngine stays the one
// authority over nodes. No imports either: every layer may read this table.

export const OUTPUT_REFUSAL = 'The output belongs to the measurement: stop it (Esc) before '
  + 'playing.';
export const REFERENCE_REFUSAL = 'Výstup zůstává tichý, dokud se z mikrofonu snímá referenční '
  + 'úroveň: před přehráváním snímání zastavte.';

/**
 * The one table, in precedence order. A row:
 *   owner     the owner's id
 *   refuses   'all' (every claim and every note is refused while it holds the output) or
 *             'notes' (only the keyboard and MIDI notes are; the other claims take it over)
 *   probe     the component's method that says it holds the output now (the sequencer's is
 *             the editor's own flag, read through createOutputOwner and the MIDI part)
 *   title, text   the notice of a refused claim ('all' rows)
 *   notes     { midi, keyboard }: the sentence a refused note says, per player
 *   yields    who stops when this owner claims the output
 *   view      the name the views give it (the scope label, the canvas description, the status
 *             bar); rows without one are never named as the output owner
 * Precedence: the refusing rows first (the measurement, then the reference), then the views'
 * order: the instrument, the sequencer, the Studio, the held notes (refused while the
 * sequencer or the Studio owns the output; a note and an instrument voice never sound
 * together, ADR 0002). The audition plays through the instrument's path under its own name.
 * The measurement row's yields are the claim of MEASURE and Studio PLAY (stopPlayback).
 */
export const OUTPUT_OWNER_TABLE = Object.freeze([
  Object.freeze({ owner: 'measurement', refuses: 'all', probe: 'measureOwnsOutput',
    title: 'Measurement in progress', text: OUTPUT_REFUSAL,
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud výstup patří měření: nejdřív ho zastavte (Esc).',
      keyboard: 'Noty z klávesnice nehrají, dokud výstup patří měření: nejdřív ho zastavte '
        + '(Esc).' }),
    yields: Object.freeze(['sequencer', 'instrument', 'studio', 'notes']) }),
  // Only a microphone capture (session.js measureReferenceOwnsOutput): the loopback TEST
  // CONTEXT reference is the instrument's own output, so there nothing is refused.
  Object.freeze({ owner: 'reference', refuses: 'all', probe: 'measureReferenceOwnsOutput',
    title: 'Level reference capture', text: REFERENCE_REFUSAL,
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud se z mikrofonu snímá referenční úroveň.',
      keyboard: 'Noty z klávesnice nehrají, dokud se z mikrofonu snímá referenční úroveň.' }),
    yields: Object.freeze([]) }),
  // A playing Studio stops on its own watch of app.playing (ui/studio/workspace.js).
  Object.freeze({ owner: 'instrument', view: 'instrument',
    yields: Object.freeze(['sequencer', 'notes']) }),
  // The riff audition (studio/riffs/audition.js) plays through the instrument's engine.play path
  // under its own name; it stopped every other owner itself (svc.stopPlayback) before it plays.
  Object.freeze({ owner: 'audition', yields: Object.freeze(['sequencer', 'notes']) }),
  // The sequencer's start releases the notes itself (main.js playAfterMidi, before its first
  // claim): its claim repeats before every loop pass (C002), where releasing a note routed to
  // the Synth or the Studio would cut it, so 'notes' is not among its yields.
  Object.freeze({ owner: 'sequencer', view: 'sequencer', refuses: 'notes',
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud hraje sekvencer: nejdřív ho zastavte (Esc).',
      keyboard: 'Noty z klávesnice nehrají, dokud hraje sekvencer: nejdřív ho zastavte (Esc).' }),
    yields: Object.freeze(['instrument', 'studio']) }),
  Object.freeze({ owner: 'studio', view: 'Studio', refuses: 'notes', probe: 'studioOwnsOutput',
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud hraje Studio: nejdřív ho zastavte.',
      keyboard: 'Noty z klávesnice nehrají, dokud hraje Studio: nejdřív ho zastavte.' }),
    yields: Object.freeze([]) }),
  Object.freeze({ owner: 'notes', view: 'noty', yields: Object.freeze([]) }),
]);

/** The owner ids as constants (OWNER.instrument === 'instrument'), for the sites that name one. */
export const OWNER = Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE
  .map((r) => [r.owner, r.owner])));

/** The table's row of `owner`, or null. */
export function ownerRow(owner) {
  return OUTPUT_OWNER_TABLE.find((r) => r.owner === owner) || null;
}

/** The owners the views name, in precedence order, and how they name each. */
export const VIEW_OWNER_ROWS = Object.freeze(OUTPUT_OWNER_TABLE.filter((r) => r.view));

/**
 * Who refuses every claim, in order: a measurement, then a microphone level-reference capture
 * (session.js; the capture stopped the other owners when it started, and the reading must not
 * hear one start). Each row names the component's probe and the notice it raises.
 */
export const OUTPUT_REFUSALS = Object.freeze(OUTPUT_OWNER_TABLE
  .filter((r) => r.refuses === 'all'));

/** The refusal row that holds the output now, or null (pure: it reads the probes only). */
export function outputRefusalOf(cmp) {
  if (!cmp) return null;
  return OUTPUT_REFUSALS.find((r) => typeof cmp[r.probe] === 'function' && cmp[r.probe]())
    || null;
}

/**
 * Who refuses a keyboard or MIDI note now: the row's owner id, or null. The rows that refuse
 * notes, in table order; `sequencerPlaying()` is the sequencer editor's own flag (the
 * component has no probe for it).
 */
export function notesRefusalOf(cmp, { sequencerPlaying = () => false } = {}) {
  if (!cmp) return null;
  const holds = (r) => (r.owner === OWNER.sequencer ? !!sequencerPlaying()
    : typeof cmp[r.probe] === 'function' && !!cmp[r.probe]());
  const row = OUTPUT_OWNER_TABLE.find((r) => r.notes && holds(r));
  return row ? row.owner : null;
}

/** The sentences a refused note says, per player ('midi' | 'keyboard'), keyed by owner id. */
export function notesRefusedSentences(player) {
  return Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE.filter((r) => r.notes)
    .map((r) => [r.owner, r.notes[player]])));
}

/**
 * Who yields the output when an owner takes it (`measure`: the measurement row's claim, made by
 * MEASURE and Studio PLAY through stopPlayback).
 */
export const OUTPUT_YIELDS = Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE
  .filter((r) => r.yields.length)
  .map((r) => [r.owner === OWNER.measurement ? 'measure' : r.owner, r.yields])));

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

  // How each owner a claim stops is read and stopped (C002, C016), for the owners the table's
  // yields name: what yields when an owner takes the output and what the setup check of a
  // measurement reports as other audio read the same rows. The sequencer is read live
  // (editor.playing), never through the 150 ms app.seqPlaying copy; its voices and the Studio's
  // never enter the engine's audibleVoiceCount. A claim releases the notes while a key is lit
  // (C024: an instrument voice also fades their voices, ADR 0002); stopPlayback releases them
  // always (`forced`): an XY pad's note lights no key, and the release is idempotent (V502).
  const STOPS = {
    [OWNER.sequencer]: { busy: () => sequencerPlaying(), stop: (cmp) => stopSequence(cmp) },
    [OWNER.instrument]: { busy: (cmp) => !!cmp.playing, stop: (cmp) => cmp.stopNow() },
    [OWNER.studio]: {
      busy: (cmp) => typeof cmp.studioOwnsOutput === 'function' && !!cmp.studioOwnsOutput(),
      stop: (cmp) => cmp.studioStop(),
    },
    [OWNER.notes]: { forced: true, busy: (cmp) => !!cmp.notesSounding,
      stop: (cmp) => { if (typeof cmp.midiAllOff === 'function') cmp.midiAllOff(); } },
  };

  function yieldOutput(cmp, owners, force = false) {
    for (const owner of owners) {
      const s = STOPS[owner];
      if ((force && s.forced) || s.busy(cmp)) s.stop(cmp);
    }
  }

  /**
   * True while any owner that stopPlayback stops sounds (MEASURE's setup check reports it as
   * other audio, C016); it stops and claims nothing.
   */
  function outputBusy(cmp) {
    return OUTPUT_YIELDS.measure.some((owner) => STOPS[owner].busy(cmp));
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
    // The reference row refuses only a microphone capture (measureReferenceOwnsOutput, as
    // calibration.js stops playback only for the microphone; the loopback TEST CONTEXT reference
    // is the instrument's own output). The notes read the same row (notesRefusalOf, C036).
    const refusal = outputRefusalOf(cmp);
    if (refusal) {
      cmp.notify('info', refusal.title, refusal.text);
      return refusal.text;
    }
    yieldOutput(cmp, OUTPUT_YIELDS[owner]);
    if (owner === OWNER.sequencer && !cmp.seqPlaying) {
      cmp.seqPlaying = true; // the views and Studio's watch learn it now, not at the next poll
      later(changed);
    }
    return true;
  }

  /**
   * Measure (and Studio PLAY, and the status-bar stop key) take the output: stop the instrument
   * and the sequencer (their voices fade), a playing Studio (V3.1; it is not playing while it
   * claims the output) and the MIDI and keyboard notes (V502): the measurement row's yields.
   */
  function stopPlayback(cmp) {
    yieldOutput(cmp, OUTPUT_YIELDS.measure, true);
  }

  return { sequencerPlaying, stopSequence, claimOutput, stopPlayback, outputBusy };
}

/**
 * The owner an engine.play claims the output as (the guard in main.js): the riff audition's
 * voices carry its owner mark (AUDITION_OPTIONS.owner); every other voice is the instrument's.
 */
export function playOwnerOf(opts) {
  return opts && opts.owner === OWNER.audition ? OWNER.audition : OWNER.instrument;
}
