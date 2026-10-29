// Which source owns the one output (engine.master -> engine.analyser) right now, as the views
// that describe that output need it: the scope's live trace and its label, the analysis canvas
// label, the bridge's loop and the Spectrum's requested-frequency marker. Pure; plain values in,
// plain values out (no engine, store or Alpine object crosses into the bridge).
//
// The instrument, the sequencer and the Studio sound through the same output analyser. Before
// C013 the scope and the Spectrum followed the instrument alone, so a sequence or a Studio run
// was drawn as "not playing" over a computed instrument wave, and the Spectrum marked the idle
// instrument frequency beside the real peak.

/** The owners a view can name; null is "nothing owns the output". */
export const OUTPUT_OWNERS = Object.freeze(['instrument', 'sequencer', 'studio']);

/** How a view names each owner in its label. */
export const OUTPUT_OWNER_NAMES = Object.freeze({
  instrument: 'instrument', sequencer: 'sequencer', studio: 'Studio',
});

/**
 * The output owner from the three playing flags: 'instrument' | 'sequencer' | 'studio' | null.
 * The instrument first, then the sequencer, then the Studio, the precedence the composition root
 * (main.js) already uses for what counts as playing.
 */
export function outputOwnerOf({ instrument = false, sequencer = false, studio = false } = {}) {
  if (instrument) return 'instrument';
  if (sequencer) return 'sequencer';
  if (studio) return 'studio';
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
