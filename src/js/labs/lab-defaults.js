// The labs' default settings, as constants only. Pure: it imports nothing, so a module that
// needs a lab's keys or defaults (the UI catalogue's state table, ui/catalog/sources.js) reads
// them here instead of importing a lab module, and no import cycle forms when a lab later
// imports the catalogue. Each lab re-exports its own constant, so its public API is unchanged.

/** Filter Lab (filter-lab.js): low-pass 2.5 kHz, Q 0.7071, 0 dB, enabled. */
export const FILTER_DEFAULTS = Object.freeze({
  type: 'lowpass',
  frequency: 2500,
  Q: Math.SQRT1_2,
  gain: 0,
  enabled: true,
});

/** Envelope (envelope.js): attack, decay and release in seconds, sustain 0…1. */
export const ADSR_DEFAULTS = Object.freeze({ a: 0.01, d: 0.1, s: 0.6, r: 0.3 });

/** Phase & Stereo (phase-stereo.js): A/B frequencies in Hz, phase offset, pan, output route. */
export const PHASE_DEFAULTS = Object.freeze({
  freqA: 440,
  freqB: 442,
  phaseDeg: 45,
  pan: 0,
  route: 'mono',
});

/** Additive (additive.js): the number of harmonics in the partial table. */
export const HARMONIC_COUNT = 10;
