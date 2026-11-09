// Which source owns the one output (engine.master -> engine.analyser) right now, as the views
// that describe that output need it: the scope's live trace and its label, the analysis canvas
// label, the bridge's loop and the Spectrum's requested-frequency marker. Pure; plain values in,
// plain values out (no engine, store or Alpine object crosses into the bridge).
//
// The instrument, the sequencer and the Studio sound through the same output analyser. Before
// C013 the scope and the Spectrum followed the instrument alone, so a sequence or a Studio run
// was drawn as "not playing" over a computed instrument wave, and the Spectrum marked the idle
// instrument frequency beside the real peak.

/**
 * The owners a view can name; null is "nothing owns the output". 'notes' are the held keyboard
 * and MIDI notes (C024): the MIDI inputs, the computer keys and the on-screen keys, in every
 * route.
 */
export const OUTPUT_OWNERS = Object.freeze(['instrument', 'sequencer', 'studio', 'notes']);

/** How a view names each owner in its label. */
export const OUTPUT_OWNER_NAMES = Object.freeze({
  instrument: 'instrument', sequencer: 'sequencer', studio: 'Studio', notes: 'noty',
});

/**
 * The output owner from the playing flags: 'instrument' | 'sequencer' | 'studio' | 'notes' |
 * null. The instrument first, then the sequencer, then the Studio, the precedence the
 * composition root (main.js) already uses for what counts as playing; held notes last: they are
 * refused while the sequencer or the Studio owns the output (midi/ui.js ownedBy), and a note and
 * an instrument voice never sound together (the newer fades the older out, ADR 0002; main.js
 * releases the notes when the instrument takes the output), so they meet only inside that fade.
 */
export function outputOwnerOf({ instrument = false, sequencer = false, studio = false,
  notes = false } = {}) {
  if (instrument) return 'instrument';
  if (sequencer) return 'sequencer';
  if (studio) return 'studio';
  if (notes) return 'notes';
  return null;
}

/** Validate an owner value (typed port of bridge.setOutputOwner): returns it or throws. */
export function assertOutputOwner(owner) {
  if (owner === null || OUTPUT_OWNERS.includes(owner)) return owner;
  throw new TypeError(`output owner must be one of ${OUTPUT_OWNERS.join(', ')} or null, `
    + `not ${JSON.stringify(owner)}`);
}

/**
 * The frequency the Spectrum marks as requested (Hz, or null to hide the marker and its chip).
 * Positional and allocation-free: the chart reads it every frame.
 *   instrumentPlaying, instrumentHz  the instrument's flag and requested (or idle) frequency
 *   sequencerPlaying, sequencerHz    the sequencer editor's own flag and currentFrequency()
 *                                    (null in a silence or a gap)
 * While the instrument plays it is the instrument's; else, while the sequencer plays, the
 * sequence's (null in a gap); else the instrument's idle frequency, as before.
 */
export function requestedFrequencyFor(instrumentPlaying, instrumentHz, sequencerPlaying,
  sequencerHz) {
  if (!instrumentPlaying && sequencerPlaying) return sequencerHz > 0 ? sequencerHz : null;
  return instrumentHz > 0 ? instrumentHz : null;
}
