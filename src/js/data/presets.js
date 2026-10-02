// Built-in presets and preset descriptions, extracted from V1 (index.html@a7b7a23, section 5
// PRESET DEFINITIONS, plus the component methods describeConfig and presetMaxFrequency).
// Data and wording are unchanged (no-fake-science reviewed), with one V2 fix over
// index.html@a7b7a23: 'pt-octaves' sets its steps text explicitly (V1 leaves pp.octave.text out,
// so a user-edited Steps field made the preset play something other than its label). Sweep
// presets use cfg.source 'sweep'; `end: 'max'` resolves to the running safe maximum at apply
// time (core/config.js).

import { OCTAVE_STEP_FREQUENCIES, THIRD_OCTAVE_FREQUENCIES } from '../core/constants.js';
import { isNum } from '../core/math.js';
import { formatFrequency } from '../core/frequency.js';
import { PATTERN_BY_ID } from '../audio/patterns.js';

// A preset is { id, cat, name, desc, params, cfg }. `cfg` is a partial configuration in the
// same shape the URL hash and custom presets use, applied through one validated code path
// (oscillaApp.applyConfig). `end: 'max'` resolves to the running safe maximum.

// V1: PRESET_CATEGORIES, REFERENCE_NOTES, refPreset (index.html@a7b7a23)
export const PRESET_CATEGORIES = [
  { id: 'reference', label: 'Reference' },
  { id: 'musical', label: 'Musical' },
  { id: 'sweeps', label: 'Sweeps' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'high', label: 'High freq' },
  { id: 'dual', label: 'Dual osc' },
  { id: 'custom', label: 'Custom' },
  { id: 'history', label: 'History' },
];

export const REFERENCE_NOTES = {
  20: 'Nominal lower edge of human hearing. Many speakers reproduce it weakly or not at all.',
  40: 'Deep sub-bass. Small speakers may reproduce mainly harmonic distortion rather than the fundamental.',
  60: 'Lower edge of the bass region; close to mains-hum frequencies (50/60 Hz).',
  100: 'Low bass. Wavelength ≈ 3.4 m — comparable to room dimensions.',
  250: 'Boundary between bass and low mids.',
  440: 'Concert pitch A4 in common tuning practice.',
  1000: 'Common reference tone for audio demonstrations.',
  2000: 'Upper mids; region of high hearing sensitivity.',
  4000: 'Presence region; hearing sensitivity is typically near its peak around 2–5 kHz.',
  8000: 'Brilliance region. One cycle lasts 125 µs.',
  10000: 'High-frequency signal; wavelength ≈ 3.4 cm.',
  12000: 'Very high frequency. Perceived loudness often falls with age and playback hardware.',
  15500: 'High-frequency signal — not ultrasound. Speakers may attenuate it strongly.',
  17000: 'Upper hearing range. Many adults perceive it weakly or not at all; the digital signal is generated regardless, and speaker output is unknown.',
  18000: 'Upper hearing range. Phone speakers and some codecs may attenuate it.',
  20000: 'Nominal upper edge of human hearing. Needs a sample rate of about 42.1 kHz or more, so that 20 kHz stays below the digital limit (95 % of Nyquist).',
};

export function refPreset(f) {
  return {
    id: `ref-${f}`, cat: 'reference', name: formatFrequency(f),
    desc: REFERENCE_NOTES[f] || 'Reference tone.',
    params: 'Sine · finite tone 1 s',
    cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: f, duration: 1000 },
  };
}

// V1: BUILTIN_PRESETS (index.html@a7b7a23)
export const BUILTIN_PRESETS = [
  ...[20, 40, 60, 100, 250, 440, 1000, 2000, 4000, 8000, 10000, 12000, 15500, 17000, 18000, 20000].map(refPreset),

  // MUSICAL
  { id: 'mus-a4', cat: 'musical', name: 'A4 · 440 Hz', desc: 'Concert pitch reference in equal temperament.',
    params: 'Sine · finite tone 1.5 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 440, duration: 1500 } },
  { id: 'mus-c4', cat: 'musical', name: 'C4 · 261.63 Hz', desc: 'Middle C at A4 = 440 Hz.',
    params: 'Triangle · finite tone 1.5 s', cfg: { source: 'single', pattern: 'finite', waveform: 'triangle', frequency: 261.63, duration: 1500 } },
  { id: 'mus-e2', cat: 'musical', name: 'E2 · 82.41 Hz', desc: 'Lowest string of a standard-tuned guitar.',
    params: 'Saw · finite tone 1.5 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sawtooth', frequency: 82.41, duration: 1500 } },
  { id: 'mus-a2', cat: 'musical', name: 'A2 · 110 Hz', desc: 'Two octaves below A4 (440 / 4).',
    params: 'Sine · finite tone 1.5 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 110, duration: 1500 } },
  { id: 'mus-triad', cat: 'musical', name: 'A major arpeggio', desc: 'A4, C♯5, E5, A5 in equal temperament.',
    params: 'Triangle · 4 tones × 350 ms', cfg: { source: 'single', pattern: 'sequence', waveform: 'triangle',
      pp: { sequence: { text: '440, 554.37, 659.26, 880', toneMs: 350, gapMs: 40, repeats: 1 } } } },
  { id: 'mus-octaves', cat: 'musical', name: 'Octave ladder A1–A7', desc: 'Each step doubles the frequency: 55 Hz to 3.52 kHz.',
    params: 'Sine · 7 tones × 400 ms', cfg: { source: 'single', pattern: 'sequence', waveform: 'sine',
      pp: { sequence: { text: '55, 110, 220, 440, 880, 1760, 3520', toneMs: 400, gapMs: 60, repeats: 1 } } } },
  { id: 'mus-semitones', cat: 'musical', name: 'Semitone steps A4–A5', desc: '13 equal-tempered steps; each is a ratio of 2^(1/12).',
    params: 'Sine · 13 tones × 220 ms', cfg: { source: 'single', pattern: 'sequence', waveform: 'sine',
      pp: { sequence: { text: '440, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.26, 698.46, 739.99, 783.99, 830.61, 880', toneMs: 220, gapMs: 30, repeats: 1 } } } },

  // SWEEPS (sweep mode)
  { id: 'sw-human', cat: 'sweeps', name: 'Human spectrum', desc: 'The nominal human hearing range on a logarithmic sweep.',
    params: '20 Hz → 20 kHz · 10 s · log', cfg: { source: 'sweep', sweep: { start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-speech', cat: 'sweeps', name: 'Speech-oriented range', desc: 'Region that carries most speech energy and intelligibility cues.',
    params: '100 Hz → 8 kHz · 6 s · log', cfg: { source: 'sweep', sweep: { start: 100, end: 8000, durationMs: 6000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-presence', cat: 'sweeps', name: 'Presence', desc: 'Upper mids to presence region.',
    params: '2 kHz → 6 kHz · 3 s · log', cfg: { source: 'sweep', sweep: { start: 2000, end: 6000, durationMs: 3000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-high', cat: 'sweeps', name: 'High range', desc: 'Brilliance into the upper hearing range.',
    params: '8 kHz → 18 kHz · 4 s · log', cfg: { source: 'sweep', sweep: { start: 8000, end: 18000, durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-upper', cat: 'sweeps', name: 'Upper range', desc: 'From 12 kHz to the digital limit of this device (95 % of Nyquist).',
    params: '12 kHz → digital limit · 4 s · log', cfg: { source: 'sweep', sweep: { start: 12000, end: 'max', durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-sub', cat: 'sweeps', name: 'Sub-bass', desc: 'Low end; watch speaker excursion and start at low gain.',
    params: '20 Hz → 100 Hz · 4 s · log', cfg: { source: 'sweep', sweep: { start: 20, end: 100, durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } },
  { id: 'sw-bass', cat: 'sweeps', name: 'Bass', desc: 'Bass region of most music.',
    params: '40 Hz → 250 Hz · 4 s · log', cfg: { source: 'sweep', sweep: { start: 40, end: 250, durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } },

  // PATTERNS
  { id: 'pt-short-high', cat: 'patterns', name: 'Short high tone', desc: 'Brief high-frequency sine tone.',
    params: '15.5 kHz · sine · 300 ms', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 15500, duration: 300 } },
  { id: 'pt-double', cat: 'patterns', name: 'Double pulse', desc: 'Two short high-frequency pulses.',
    params: '15.5 kHz · 150 ms × 2', cfg: { source: 'single', pattern: 'pulse', waveform: 'sine', frequency: 15500,
      pp: { pulse: { pulseMs: 150, pauseMs: 150, reps: 2 } } } },
  { id: 'pt-high-sweep', cat: 'patterns', name: 'High sweep', desc: 'Fast logarithmic sweep in the high-frequency region.',
    params: '12 → 18 kHz · 800 ms', cfg: { source: 'single', pattern: 'sweepUp', waveform: 'sine',
      pp: { sweepUp: { start: 12000, end: 18000, durationMs: 800, curve: 'log' } } } },
  { id: 'pt-siren', cat: 'patterns', name: 'Fast siren', desc: 'Sinusoidal LFO between two high frequencies.',
    params: '13 ↔ 17 kHz · 3 Hz LFO', cfg: { source: 'single', pattern: 'siren', waveform: 'sine',
      pp: { siren: { min: 13000, max: 17000, rate: 3, shape: 'sine' } } } },
  { id: 'pt-chirp', cat: 'patterns', name: 'Chirp', desc: 'Short exponential frequency glide.',
    params: '10 → 18 kHz · 300 ms', cfg: { source: 'single', pattern: 'chirp', waveform: 'sine',
      pp: { chirp: { start: 10000, end: 18000, durationMs: 300, ramp: 'exponential' } } } },
  { id: 'pt-wobble', cat: 'patterns', name: 'Soft wobble', desc: 'Slow frequency deviation around a high center frequency.',
    params: '15 kHz ± 800 Hz · 2 Hz', cfg: { source: 'single', pattern: 'wobble', waveform: 'sine', frequency: 15000,
      pp: { wobble: { depth: 800, rate: 2 } } } },
  { id: 'pt-440', cat: 'patterns', name: '440 Hz reference tone', desc: 'A4 sine for tuning and comparison.',
    params: '440 Hz · sine · 1 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 440, duration: 1000 } },
  { id: 'pt-1k', cat: 'patterns', name: '1 kHz reference tone', desc: 'Conventional reference frequency for demonstrations. Level is relative, not calibrated.',
    params: '1 kHz · sine · 1 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 1000, duration: 1000 } },
  { id: 'pt-20-pulse', cat: 'patterns', name: '20 Hz pulse', desc: 'Very low pulses; each lasts 10 cycles. Start at low gain.',
    params: '20 Hz · 500 ms × 3', cfg: { source: 'single', pattern: 'pulse', waveform: 'sine', frequency: 20,
      pp: { pulse: { pulseMs: 500, pauseMs: 400, reps: 3 } } } },
  { id: 'pt-40-sub', cat: 'patterns', name: '40 Hz sub-bass', desc: 'Sustained sub-bass tone. Small speakers may reproduce it poorly.',
    params: '40 Hz · sine · 2 s', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 40, duration: 2000 } },
  { id: 'pt-octaves', cat: 'patterns', name: 'Octave stepping', desc: '125 Hz to 16 kHz in octave steps.',
    params: '8 steps × 400 ms', cfg: { source: 'single', pattern: 'octave', waveform: 'sine',
      // V2 fix: the steps are part of what the label promises (125 Hz … 16 kHz)
      pp: { octave: { text: OCTAVE_STEP_FREQUENCIES.join(', '), toneMs: 400, gapMs: 100 } } } },
  { id: 'pt-third', cat: 'patterns', name: 'Third-octave demonstration', desc: 'Nominal third-octave center frequencies, 20 Hz to 20 kHz; values above the digital limit are skipped.',
    params: 'up to 31 steps × 250 ms', cfg: { source: 'single', pattern: 'sequence', waveform: 'sine',
      pp: { sequence: { text: THIRD_OCTAVE_FREQUENCIES.join(', '), toneMs: 250, gapMs: 50, repeats: 1 } } } },

  // HIGH FREQUENCY
  ...[[12000, 'Very high frequency region.'], [14000, 'Very high frequency region; perceived level often drops here.'],
    [15500, 'High-frequency signal — not ultrasound.'], [16000, 'Boundary of the upper hearing range.'],
    [17000, 'Upper hearing range.'], [18000, 'Upper hearing range; many playback chains attenuate it.'],
    [19000, 'Upper hearing range, close to the nominal 20 kHz edge.'],
    [21000, 'Nominal ultrasonic region. Digital generation does not imply your hardware emits it.'],
    [24000, 'Nominal ultrasonic region; needs a sample rate above ~50.5 kHz.']]
    .map(([f, desc]) => ({ id: `hf-${f}`, cat: 'high', name: formatFrequency(f), desc,
      params: 'Sine · finite tone 600 ms', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: f, duration: 600 } })),

  // DUAL OSC
  ...[[440, 441], [440, 442], [440, 445], [440, 450], [1000, 1002]].map(([a, b]) => ({
    id: `du-${a}-${b}`, cat: 'dual', name: `${a} + ${b} Hz`,
    desc: `Mono mix; amplitude beats at about ${b - a} Hz (the difference frequency).`,
    params: `Δf ${b - a} Hz · mono mix`,
    cfg: { source: 'dual', dual: { a: { freq: a, wave: 'sine', gain: 100, detune: 0 }, b: { freq: b, wave: 'sine', gain: 100, detune: 0 },
      levelA: 80, levelB: 80, stereo: false, binaural: false } } })),
  { id: 'du-binaural', cat: 'dual', name: 'Binaural demo 440 / 446 Hz', requiresHeadphones: true,
    desc: 'Left ear 440 Hz, right ear 446 Hz. Some listeners perceive a 6 Hz binaural beat. Headphones required.',
    params: 'L 440 · R 446 · stereo split',
    cfg: { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 446, wave: 'sine', gain: 100, detune: 0 },
      levelA: 80, levelB: 80, stereo: true, binaural: true } } },
];

/** One-line description of a configuration (V1: oscillaApp.describeConfig, index.html@a7b7a23). */
export function describeConfig(cfg) {
  if (!cfg) return '';
  if (cfg.source === 'dual' && cfg.dual) return `Dual ${formatFrequency(cfg.dual.a.freq)} + ${formatFrequency(cfg.dual.b.freq)}`;
  if (cfg.source === 'sweep' && cfg.sweep) return `Sweep ${formatFrequency(cfg.sweep.start)} → ${formatFrequency(cfg.sweep.end)}`;
  return `${PATTERN_BY_ID[cfg.pattern]?.label || 'Tone'} · ${formatFrequency(cfg.frequency)} · ${cfg.waveform || 'sine'}`;
}

/**
 * Highest frequency a configuration requests (0 when it is only known at play time).
 * V1: oscillaApp.presetMaxFrequency (index.html@a7b7a23)
 */
export function presetMaxFrequency(cfg) {
  if (!cfg) return 0;
  const n = (v) => (isNum(v) ? v : 0);
  if (cfg.source === 'dual' && cfg.dual) return Math.max(n(cfg.dual.a?.freq), n(cfg.dual.b?.freq));
  if (cfg.source === 'sweep' && cfg.sweep) return Math.max(n(cfg.sweep.start), cfg.sweep.end === 'max' ? 0 : n(cfg.sweep.end));
  const p = (cfg.pp && cfg.pp[cfg.pattern]) || {};
  switch (cfg.pattern) {
    case 'sweepUp': case 'sweepDown': {
      const s = cfg.pp?.[cfg.pattern] || cfg.sweep || {};
      return Math.max(n(s.start), n(s.end));
    }
    case 'pingpong': case 'siren': case 'random': return n(p.max);
    case 'chirp': return Math.max(n(p.start), n(p.end));
    case 'alternating': return Math.max(n(p.fA), n(p.fB));
    case 'octave': case 'sequence': return 0;
    default: return n(cfg.frequency);
  }
}
