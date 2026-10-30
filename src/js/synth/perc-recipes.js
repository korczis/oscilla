// The percussion engine's recipes (plan K123, from K071's voices): data only. A key's pitch
// class picks the voice, so every octave of the keyboard holds the whole kit, and the octave
// above or below C4 tunes it by ±12 semitones. Every level is relative and every decay is "to
// −60 dB rel": the amplitude falls exponentially with time constant decay / ln(1000).
//
// A voice is a list of layers, each one of
//   { kind: 'tone', wave, hz, toHz?, sweepS?, decayS, level }   an oscillator, its pitch
//                                    falling exponentially from hz to toHz over sweepS
//   { kind: 'noise', filter, hz, q, decayS, level, bursts? }     white noise through a biquad;
//                                    bursts: [[onset s, length s]] before the decay (a clap)
//   { kind: 'metal', ratios, baseHz, filterHz, decayS, level }    square oscillators at fixed
//                                    non-harmonic ratios of baseHz through a high-pass
// `tone` (0..1, a knob) balances the tonal and noise layers of a voice that has both; `choke`
// lets a closed hat release a sounding open hat (a choke group, on the audio clock).

export const DECAY_TAU_PER_S = 1 / Math.log(1000); // τ = decay · this: −60 dB at `decay`
export const CHOKE_TAU_S = 0.002;
export const HAT_RATIOS = Object.freeze([2, 3, 4.16, 5.43, 6.79, 8.21]);

const voice = (id, label, layers, extra = {}) => Object.freeze({ id, label,
  layers: Object.freeze(layers.map((l) => Object.freeze(l))), ...extra });

export const PERC_VOICES = Object.freeze({
  kick: voice('kick', 'Kick', [
    { kind: 'tone', wave: 'sine', hz: 150, toHz: 48, sweepS: 0.07, decayS: 0.5, level: 1 },
    { kind: 'noise', filter: 'bandpass', hz: 3000, q: 1, decayS: 0.012, level: 0.3,
      noise: true }]),
  snare: voice('snare', 'Snare', [
    { kind: 'tone', wave: 'triangle', hz: 185, decayS: 0.16, level: 0.55 },
    { kind: 'tone', wave: 'triangle', hz: 330, decayS: 0.12, level: 0.35 },
    { kind: 'noise', filter: 'highpass', hz: 1500, q: 0.7, decayS: 0.24, level: 0.8,
      noise: true }]),
  clap: voice('clap', 'Clap', [
    { kind: 'noise', filter: 'bandpass', hz: 1200, q: 1.4, decayS: 0.28, level: 1, noise: true,
      bursts: [[0, 0.008], [0.011, 0.008], [0.022, 0.008]] }]),
  tomLow: voice('tomLow', 'Tom low', [
    { kind: 'tone', wave: 'sine', hz: 140, toHz: 100, sweepS: 0.09, decayS: 0.45, level: 1 }]),
  tomMid: voice('tomMid', 'Tom mid', [
    { kind: 'tone', wave: 'sine', hz: 200, toHz: 145, sweepS: 0.08, decayS: 0.38, level: 1 }]),
  tomHigh: voice('tomHigh', 'Tom high', [
    { kind: 'tone', wave: 'sine', hz: 280, toHz: 205, sweepS: 0.07, decayS: 0.32, level: 1 }]),
  hatClosed: voice('hatClosed', 'Hat closed', [
    { kind: 'metal', ratios: HAT_RATIOS, baseHz: 400, filterHz: 7000, decayS: 0.06,
      level: 1 }], { chokes: 'hatOpen' }),
  hatOpen: voice('hatOpen', 'Hat open', [
    { kind: 'metal', ratios: HAT_RATIOS, baseHz: 400, filterHz: 7000, decayS: 0.5,
      level: 1 }], { group: 'hatOpen' }),
  noise: voice('noise', 'Noise hit', [
    { kind: 'noise', filter: 'bandpass', hz: 2500, q: 2, decayS: 0.3, level: 1, noise: true,
      tracks: true }]),
});

/** Pitch class (C = 0) → voice id: the whole kit in every octave. */
export const PERC_KEYMAP = Object.freeze(['kick', 'clap', 'snare', 'clap', 'tomLow', 'tomMid',
  'hatClosed', 'tomHigh', 'hatClosed', 'noise', 'hatOpen', 'noise']);

/** The voice a note plays, and its tuning in semitones from the octave around C4. */
export function percNote(note) {
  const pc = ((note % 12) + 12) % 12;
  return { voice: PERC_VOICES[PERC_KEYMAP[pc]], octaveSt: (Math.floor(note / 12) - 5) * 12 };
}

/** Each voice's decay to −60 dB rel at a decay scale (the face's derived readout). */
export function percDecays(scale = 1) {
  return Object.values(PERC_VOICES).map((v) => ({ id: v.id, label: v.label,
    decayS: Math.max(...v.layers.map((l) => l.decayS)) * scale }));
}

/**
 * A layer's level after the tone knob: in a voice with both tonal and noise layers (kick,
 * snare), tonal layers × min(1, 2·tone) and noise layers × min(1, 2·(1 − tone)); a voice of one
 * kind keeps its levels, so the knob never silences a voice.
 */
export function layerLevel(v, layer, tone) {
  const mixed = v.layers.some((l) => l.noise) && v.layers.some((l) => l.kind === 'tone');
  if (!mixed) return layer.level;
  return layer.level * Math.min(1, 2 * (layer.noise ? 1 - tone : tone));
}
