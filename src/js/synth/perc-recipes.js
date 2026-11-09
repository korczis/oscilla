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
//   { kind: 'fm', hz, ratio, index, decayS, level }     a two-operator linear FM blip: a sine
//                                    carrier at hz, its frequency swung by a sine modulator at
//                                    ratio x hz with peak deviation index x the modulator
// `tone` (0..1, a knob) balances the tonal and noise layers of a voice that has both. Each voice
// has its own tune (st), decay (x), level (0..1) and choke group (0 none, 1-4; K071): a hit in
// a group releases the group's voices sounding at it, on the audio clock (`choke` turns every
// group off). The hats share group 1 by default, so a closed hat cuts an open one.

export const DECAY_TAU_PER_S = 1 / Math.log(1000); // τ = decay · this: −60 dB at `decay`
export const CHOKE_TAU_S = 0.002;
export const HAT_RATIOS = Object.freeze([2, 3, 4.16, 5.43, 6.79, 8.21]);

/** The perc-voice parameters each voice has (K071, hash epoch 3), keyed percParamKey(id, name):
 *  kickDecay, kickTune, kickLevel, kickChoke, ... */
export const PERC_VOICE_PARAMS = Object.freeze(['decay', 'tune', 'level', 'choke']);
export const percParamKey = (id, name) => `${id}${name[0].toUpperCase()}${name.slice(1)}`;
export const CHOKE_GROUPS = 4;

const voice = (id, label, cs, layers, extra = {}) => Object.freeze({ id, label, cs,
  keyLabel: label.toLowerCase(), choke: 0,
  layers: Object.freeze(layers.map((l) => Object.freeze(l))), ...extra });

export const PERC_VOICES = Object.freeze({
  kick: voice('kick', 'Kick', 'Kopák', [
    { kind: 'tone', wave: 'sine', hz: 150, toHz: 48, sweepS: 0.07, decayS: 0.5, level: 1 },
    { kind: 'noise', filter: 'bandpass', hz: 3000, q: 1, decayS: 0.012, level: 0.3,
      noise: true }]),
  snare: voice('snare', 'Snare', 'Virbl', [
    { kind: 'tone', wave: 'triangle', hz: 185, decayS: 0.16, level: 0.55 },
    { kind: 'tone', wave: 'triangle', hz: 330, decayS: 0.12, level: 0.35 },
    { kind: 'noise', filter: 'highpass', hz: 1500, q: 0.7, decayS: 0.24, level: 0.8,
      noise: true }]),
  clap: voice('clap', 'Clap', 'Tlesk', [
    { kind: 'noise', filter: 'bandpass', hz: 1200, q: 1.4, decayS: 0.28, level: 1, noise: true,
      bursts: [[0, 0.008], [0.011, 0.008], [0.022, 0.008]] }]),
  tomLow: voice('tomLow', 'Tom low', 'Tom nízký', [
    { kind: 'tone', wave: 'sine', hz: 140, toHz: 100, sweepS: 0.09, decayS: 0.45, level: 1 }],
    { keyLabel: 'low tom' }),
  tomMid: voice('tomMid', 'Tom mid', 'Tom střední', [
    { kind: 'tone', wave: 'sine', hz: 200, toHz: 145, sweepS: 0.08, decayS: 0.38, level: 1 }],
    { keyLabel: 'mid tom' }),
  tomHigh: voice('tomHigh', 'Tom high', 'Tom vysoký', [
    { kind: 'tone', wave: 'sine', hz: 280, toHz: 205, sweepS: 0.07, decayS: 0.32, level: 1 }],
    { keyLabel: 'high tom' }),
  hatClosed: voice('hatClosed', 'Hat closed', 'Hi-hat zavřený', [
    { kind: 'metal', ratios: HAT_RATIOS, baseHz: 400, filterHz: 7000, decayS: 0.06,
      level: 1 }], { choke: 1, keyLabel: 'closed hat' }),
  hatOpen: voice('hatOpen', 'Hat open', 'Hi-hat otevřený', [
    { kind: 'metal', ratios: HAT_RATIOS, baseHz: 400, filterHz: 7000, decayS: 0.5,
      level: 1 }], { choke: 1, keyLabel: 'open hat' }),
  noise: voice('noise', 'Noise hit', 'Šumový úder', [
    { kind: 'noise', filter: 'bandpass', hz: 2500, q: 2, decayS: 0.3, level: 1, noise: true,
      tracks: true }], { keyLabel: 'noise' }),
  // K072: index 1 (the first sidebands at J1(1) / J0(1) = −4.8 dB rel the carrier), the
  // modulator at 0.35 x the carrier so no sideband up to the third folds onto another.
  blip: voice('blip', 'FM blip', 'FM úder', [
    { kind: 'fm', hz: 1000, ratio: 0.35, index: 1, decayS: 0.2, level: 1 }],
  { keyLabel: 'FM blip' }),
});

/** Each voice's own parameters at the engine's values `p` (defaults where `p` has none). */
export function voiceParams(v, p = {}) {
  const at = (name, d) => (p[percParamKey(v.id, name)] ?? d);
  return { tune: at('tune', 0), decay: at('decay', 1), level: at('level', 1),
    choke: at('choke', v.choke) };
}

/** Pitch class (C = 0) → voice id: the whole kit in every octave. */
export const PERC_KEYMAP = Object.freeze(['kick', 'clap', 'snare', 'clap', 'tomLow', 'tomMid',
  'hatClosed', 'tomHigh', 'hatClosed', 'noise', 'hatOpen', 'blip']);

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The key map as the face states it: "C kick, C# and D# clap, D snare, ...". */
export function percKeysText() {
  const keys = new Map();
  PERC_KEYMAP.forEach((id, pc) => keys.set(id, [...(keys.get(id) || []), PITCH_NAMES[pc]]));
  return [...keys].map(([id, names]) => `${names.join(' and ')} ${PERC_VOICES[id].keyLabel}`)
    .join(', ');
}

/** The voice a note plays, and its tuning in semitones from the octave around C4. */
export function percNote(note) {
  const pc = ((note % 12) + 12) % 12;
  return { voice: PERC_VOICES[PERC_KEYMAP[pc]], octaveSt: (Math.floor(note / 12) - 5) * 12 };
}

/** Each voice's decay to −60 dB rel at the engine's values `p`, or at a decay scale alone (the
 *  face's derived readout). */
export function percDecays(p = {}) {
  if (typeof p === 'number') p = { decay: p };
  const scale = p.decay ?? 1;
  return Object.values(PERC_VOICES).map((v) => ({ id: v.id, label: v.label,
    decayS: Math.max(...v.layers.map((l) => l.decayS)) * scale * voiceParams(v, p).decay }));
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

/**
 * The factor that keeps a voice's layers at or below 1 together (each layer peaks at its level
 * at most, so their sum bounds the voice's peak): 1 / max(1, Σ layerLevel).
 */
export function percLevelScale(v, tone) {
  return 1 / Math.max(1, v.layers.reduce((s, l) => s + layerLevel(v, l, tone), 0));
}
