// Studio node types of the Synth engines (plan K090 FM, K091 additive, K092 wavetable with the
// sync bank of K089, K121 AM and ring, K123 percussion; the voice pool K122). Each is a
// polyphonic note source (capabilities.notes, up to 16 voices, owner decision Q021) played by
// the keyboard, the on-screen keys and MIDI through the Synth workspace; the semi-modular panel
// stays mono. New types only: no existing definition changes, so every pinned template hash and
// saved studioHash stays as it is (design D2).
//
// Every engine has a Chain input: the audio there passes to the output unchanged and the
// engine's voices are added to it, which is how several instruments share the one Master
// Output (its input takes one cable). Levels are relative: a voice peaks at Level / 64 of
// digital full scale times the velocity law, so the 16 voices at Level 4 and full velocity
// together peak at most at full scale and the Master Output level stays the cap (ADR 0058's
// rule for note voices; adapters/voices.js). Pitch is a requested digital frequency
// (project.no-fake-science).
//
// A definition may name `inactive(params, key) -> reason | null` (why a control does nothing
// at these settings, project.no-inert-surfaces (b)) and `facts(params) -> text` (a readout
// derived from the parameters); the Synth face shows both.

import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';
import { definePort } from '../ports.js';
import { FM_ALGORITHMS, FM_FEEDBACK_BLOCKED, FM_OPERATORS, operatorRole } from
  '../../synth/fm-algorithms.js';
import { MORPH_MAX, WAVETABLE_BANKS, WAVETABLE_BANK_IDS, morphText } from
  '../../synth/wavetables.js';
import { percDecays, percKeysText } from '../../synth/perc-recipes.js';
import { MAX_VOICES } from '../../synth/voice-pool.js';
import {
  CATEGORIES, boolParam, defineNode, enumParam, levelParam, numberParam, optionLabel, parts,
  secondsParam, secs,
} from './common.js';

export const ADDITIVE_HARMONICS = 12;
const WAVES = [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'],
  ['square', 'Square']];

const audioOut = definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' });
const chainIn = definePort({ id: 'thru', direction: 'in', type: 'AUDIO', label: 'Chain' });

/** The parameters every engine shares: its level and the amplitude ADSR of each voice. */
const voiceParams = (release = 0.3) => [
  numberParam('level', 'Level', { min: 0, max: 4, step: 0.01, default: 4 }),
  secondsParam('attack', 'Attack', 0.005, 0.001, 5, { scale: 'log' }),
  secondsParam('decay', 'Decay', 0.3, 0.001, 5, { scale: 'log' }),
  levelParam('sustain', 'Sustain', 0.7),
  secondsParam('release', 'Release', release, 0.001, 10, { scale: 'log' }),
];
const POLY = `Up to ${MAX_VOICES} voices: a ${MAX_VOICES + 1}th note takes the voice released `
  + 'first, else the oldest, after a 5 ms fade. A voice peaks at Level / 64 of digital full scale '
  + `times (velocity / 127)², so the ${MAX_VOICES} voices together peak at most at digital full `
  + 'scale (at Level 4, the highest) and the Master Output level stays the cap. A note-on for a '
  + 'held note re-attacks it from the level it holds.';
const engine = (def) => defineNode({
  category: CATEGORIES.SOURCES,
  inputs: [chainIn],
  outputs: [audioOut],
  sounding: true,
  capabilities: { realtime: true, offline: false, notes: true, voices: MAX_VOICES },
  compiler: 'audio/audio-engine.js#AudioEngine',
  ...def,
  help: { inputs: 'Notes from the keyboard, the on-screen keys or MIDI while the Synth is '
    + 'armed; Chain: audio passed to the output unchanged, the voices added to it.',
  outputs: 'Audio: the chain input plus the voices.', ...def.help,
  constraints: `${def.help.constraints} ${POLY}` },
});

export const additiveVoice = engine({
  type: 'additive-voice',
  displayName: 'Additive engine',
  idPrefix: 'add',
  aliases: ['additive', 'harmonics', 'drawbars', 'organ', 'partials'],
  params: [
    enumParam('shape', 'Shape', [['custom', 'Drawbars'], ['sawtooth', 'Saw'],
      ['square', 'Square'], ['triangle', 'Triangle']], 'custom'),
    ...Array.from({ length: ADDITIVE_HARMONICS }, (_, i) => levelParam(`h${i + 1}`,
      `H${i + 1}`, i === 0 ? 1 : i < 4 ? 0.5 / (i + 1) : 0)),
    numberParam('tilt', 'Tilt', { min: -12, max: 6, step: 0.1, unit: 'dB/oct', default: 0 }),
    ...voiceParams(),
  ],
  summary: (p) => parts(optionLabel(additiveVoice, 'shape', p.shape),
    p.tilt ? `${p.tilt} dB/oct` : null),
  inactive: (p, key) => (/^h\d+$/.test(key) && p.shape !== 'custom'
    ? 'The harmonic levels apply to the Drawbars shape; this shape sets them.' : null),
  facts: () => `${ADDITIVE_HARMONICS} harmonics; each note drops those above `
    + `${SAFE_NYQUIST_FACTOR_TEXT} × the digital Nyquist limit and says how many.`,
  reuses: ['audio/additive.js#harmonicSeries', 'audio/additive.js#buildPeriodicWave'],
  help: {
    what: 'Additive synthesis: a sum of harmonics, the drawbars H1-H12 (linear amplitude, '
      + 'relative), or the series of a saw, square or triangle, with a tilt in dB per octave.',
    constraints: 'One band-limited PeriodicWave per note range; harmonics above '
      + `${SAFE_NYQUIST_FACTOR_TEXT} × the digital Nyquist limit of the running context are `
      + 'dropped and counted. The wave is scaled to its own peak, so levels are relative.',
  },
});

const opParams = (k) => [
  numberParam(`ratio${k}`, `Op ${k} ratio`, { min: 0.25, max: 16, step: 0.01,
    default: k === 1 ? 1 : k === 2 ? 2 : k }),
  numberParam(`index${k}`, `Op ${k} index`, { min: 0, max: 10, step: 0.01, default: k === 2 ? 2
    : 1 }),
  levelParam(`level${k}`, `Op ${k} level`, k === 1 ? 1 : 0.5),
];

export const fmVoice = engine({
  type: 'fm-voice',
  displayName: 'FM engine',
  idPrefix: 'fm',
  aliases: ['fm', 'frequency modulation', 'operators', 'bell', 'electric piano'],
  params: [
    enumParam('algorithm', 'Algorithm', FM_ALGORITHMS.map((a) => [a.id, a.label]), '2-op'),
    ...Array.from({ length: FM_OPERATORS }, (_, i) => opParams(i + 1)).flat(),
    secondsParam('modDecay', 'Index decay', 0.4, 0.001, 5, { scale: 'log' }),
    levelParam('modSustain', 'Index sustain', 0.5),
    ...voiceParams(),
  ],
  summary: (p) => parts(optionLabel(fmVoice, 'algorithm', p.algorithm)),
  inactive(p, key) {
    const m = /^(ratio|index|level)(\d)$/.exec(key);
    if (!m) return null;
    const role = operatorRole(p.algorithm, Number(m[2]));
    if (role === 'unused') return `Op ${m[2]} is not used by this algorithm.`;
    if (m[1] === 'index' && role === 'carrier') {
      return `Op ${m[2]} is a carrier in this algorithm: its level applies, not an index.`;
    }
    if (m[1] === 'level' && role === 'modulator') {
      return `Op ${m[2]} is a modulator in this algorithm: its index applies, not a level.`;
    }
    return null;
  },
  facts: () => 'Linear FM: a modulator of index I moves its target by I × its own frequency '
    + `in Hz. ${FM_FEEDBACK_BLOCKED}`,
  help: {
    what: 'FM synthesis with 2 to 4 sine operators routed by an algorithm table: modulators '
      + 'drive the frequency of their targets, carriers sum into the voice.',
    constraints: 'Linear frequency modulation, index stated: Δf = I · f_mod Hz; the index '
      + 'falls from I to I × Index sustain over Index decay. Sidebands above the digital '
      + 'Nyquist limit fold back (linear FM is not band-limited); an operator above '
      + `${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist is left out of that note (with the modulators `
      + 'that only drive it). A modulator that is itself modulated reaches its target through a '
      + 'DC block at a tenth of the lowest operator frequency: its 0 Hz line would otherwise '
      + "shift the note's pitch. A carrier at a whole multiple of its modulator's frequency has a "
      + '0 Hz line of its own: a DC offset in the voice, not removed (a high-pass would raise the '
      + `voice's peak above its stated bound). ${FM_FEEDBACK_BLOCKED}`,
  },
});

export const amVoice = engine({
  type: 'am-voice',
  displayName: 'AM/ring engine',
  idPrefix: 'am',
  aliases: ['am', 'ring', 'ring modulation', 'amplitude modulation', 'tremolo', 'sidebands'],
  params: [
    enumParam('mode', 'Mode', [['ring', 'Ring'], ['am', 'AM']], 'ring'),
    enumParam('carrier', 'Carrier', WAVES, 'sine'),
    enumParam('modulator', 'Modulator', WAVES, 'sine'),
    numberParam('ratio', 'Ratio', { min: 0.25, max: 16, step: 0.01, default: 1.25 }),
    levelParam('depth', 'Depth', 1),
    ...voiceParams(),
  ],
  summary: (p) => parts(optionLabel(amVoice, 'mode', p.mode), `ratio ${p.ratio}`),
  inactive: (p, key) => (key === 'depth' && p.mode !== 'am'
    ? 'Depth applies to AM; ring modulation is the full product.' : null),
  facts: (p) => (p.mode === 'ring' ? 'Ring: c·m, the sum and difference frequencies of the '
    + 'carrier and the modulator, the carrier itself suppressed.' : `AM: c·(1 − d/2 + d/2·m): `
    + `the carrier at ${(1 - p.depth / 2).toFixed(2)} and each sideband at `
    + `${(p.depth / 4).toFixed(2)} of a sine pair's full level.`),
  reuses: ['studio/adapters/instrument.js#ringLaw'],
  help: {
    what: 'Ring and amplitude modulation: a carrier at the note times a modulator at Ratio × '
      + 'the note.',
    constraints: 'Digital multiplication, levels relative (the Ring node of the Synth panel, '
      + 'per voice). Where a carrier harmonic and a modulator harmonic coincide (ratio 1; a whole '
      + 'ratio with a saw, square or triangle) the product has a mean, a DC offset: sines at ratio '
      + "1 put half the voice's peak there. It is not removed: a high-pass would raise the "
      + "voice's peak above its stated bound.",
  },
});

export const wavetableVoice = engine({
  type: 'wavetable-voice',
  displayName: 'Wavetable engine',
  idPrefix: 'wt',
  aliases: ['wavetable', 'morph', 'tables', 'hard sync', 'sync'],
  params: [
    enumParam('bank', 'Bank', WAVETABLE_BANK_IDS.map((b) => [b, WAVETABLE_BANKS[b].label]),
      'basic'),
    numberParam('morph', 'Morph', { min: 0, max: MORPH_MAX, step: 0.01, default: 0,
      modulatable: true, modDepth: 1 }),
    ...voiceParams(),
  ],
  summary: (p) => parts(optionLabel(wavetableVoice, 'bank', p.bank), `morph ${p.morph}`),
  facts: (p) => `Morph ${Number(p.morph).toFixed(2)}: ${morphText(p.bank, p.morph)} (an `
    + 'level-continuous crossfade of two neighbouring tables).'
    + (p.bank === 'sync' ? ' Hard sync at set ratios; morph crossfades neighbouring ratios, it '
      + 'is not a continuous sync sweep (that needs an AudioWorklet).' : ''),
  reuses: ['audio/additive.js#syncedSawSeries', 'audio/additive.js#buildPeriodicWave'],
  help: {
    what: 'Wavetable synthesis: four band-limited tables per bank, crossfaded by Morph (0 to 3, '
      + 'modulatable at audio rate). The Hard sync bank holds saws hard-synced at 1, 2, 3 and '
      + '4.5 times the note.',
    constraints: 'Morph crossfades two neighbouring tables, its level following the two '
      + "tables' levels (in dB) and never peaking above one table; it is not a per-sample "
      + 'interpolation across many tables. A modulated morph beyond 0 or 3 holds the end table.',
  },
});

export const percVoice = engine({
  type: 'perc-voice',
  displayName: 'Percussion engine',
  idPrefix: 'perc',
  aliases: ['drums', 'percussion', 'kick', 'snare', 'hat', 'clap', 'tom', 'noise hit', 'kit'],
  params: [
    numberParam('tune', 'Tune', { min: -24, max: 24, step: 1, unit: 'st', default: 0 }),
    numberParam('decay', 'Decay', { min: 0.25, max: 4, step: 0.01, unit: '×', default: 1,
      scale: 'log' }),
    levelParam('tone', 'Tone / noise', 0.5),
    boolParam('choke', 'Hat choke', true),
    numberParam('level', 'Level', { min: 0, max: 4, step: 0.01, default: 4 }),
  ],
  summary: (p) => parts(p.tune ? `${p.tune} st` : null, `decay × ${p.decay}`),
  facts: (p) => `Decay to −60 dB rel: ${percDecays(p.decay).map((d) => `${d.label} `
    + `${secs(d.decayS)}`).join(' · ')}. Keys: ${percKeysText()}; each octave tunes ±12 st.`,
  help: {
    what: 'A percussion kit on the keys: kick (a sine with a falling pitch and a noise click), '
      + 'snare (two tones and noise), clap (noise with three short bursts), three toms, hats '
      + '(six square oscillators at fixed non-harmonic ratios through a high-pass) and a noise '
      + 'hit.',
    constraints: 'Each hit decays exponentially to −60 dB rel at its stated decay (the clap '
      + 'from its last burst); a key release does not shorten it, all-off cuts it. A voice\'s '
      + 'layers are scaled to sum to at most 1, and the six hat squares by 1/6 (they start in '
      + 'phase, so their sum is coherent). With Hat choke on, a closed hat releases a sounding '
      + 'open hat on the audio clock.',
  },
});

export default [additiveVoice, fmVoice, amVoice, wavetableVoice, percVoice];
