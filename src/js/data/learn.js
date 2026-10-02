// Learn topics: explanatory text and a demo configuration per topic. Extracted from V1
// (index.html@a7b7a23, section 5). Text and demo configurations are unchanged, with one V2 fix
// over index.html@a7b7a23: the 'hearing' demo sets the octave steps explicitly (V1's cfg has no
// pp, so a user-edited Steps field changed what "Octave steps 125 Hz – 16 kHz" played). demo.viz
// keeps the V1 visualization ids (wave, spectrum, motion, harmonics, interference).

import { OCTAVE_STEP_FREQUENCIES } from '../core/constants.js';

// V1: LEARN_TOPICS (index.html@a7b7a23)
export const LEARN_TOPICS = [
  { id: 'frequency', title: 'Frequency', body: 'Frequency is the number of cycles per second, measured in hertz (Hz). Doubling it raises the pitch by one octave.',
    demo: { label: 'Hear 220 → 440 → 880 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'sequence', waveform: 'sine', pp: { sequence: { text: '220, 440, 880', toneMs: 500, gapMs: 80, repeats: 1 } } } } },
  { id: 'period', title: 'Period', body: 'The period is the duration of one cycle: T = 1 / f. Higher frequencies have shorter periods.',
    demo: { label: 'Show 440 Hz (2.27 ms)', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440 } } },
  { id: 'wavelength', title: 'Wavelength', body: 'In air (≈ 343 m/s) the wavelength is λ = 343 / f. 100 Hz spans about 3.4 m; 10 kHz about 3.4 cm.',
    demo: { label: 'Try 100 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 100 } } },
  { id: 'amplitude', title: 'Amplitude', body: 'Amplitude is the size of the oscillation. Here it is a relative digital level — not a calibrated sound pressure level.',
    demo: { label: 'AM: watch the level move', viz: 'wave', cfg: { source: 'single', pattern: 'am', waveform: 'sine', frequency: 440, pp: { am: { modFreq: 2, depth: 90 } } } } },
  { id: 'waveform', title: 'Waveform', body: 'The waveform is the shape of one cycle. Sine is pure; triangle, saw and square add harmonics and sound brighter.',
    demo: { label: 'Saw at 220 Hz', viz: 'wave', cfg: { source: 'single', pattern: 'tone', waveform: 'sawtooth', frequency: 220 } } },
  { id: 'harmonic', title: 'Harmonics', body: 'Harmonics are integer multiples of the fundamental (2f, 3f, …). Square and triangle contain odd harmonics; saw contains all.',
    demo: { label: 'Square at 220 Hz', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'square', frequency: 220 } } },
  { id: 'nyquist', title: 'Nyquist limit', body: 'A digital system can represent frequencies only below half its sample rate. Nyquist is a digital limit, not a guarantee of speaker performance.',
    demo: { label: 'Square at 5 kHz', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'square', frequency: 5000 } } },
  { id: 'samplerate', title: 'Sample rate', body: 'The sample rate is how many values per second the audio system produces. Once audio starts, OSCILLA uses the rate this device reports; until then the display assumes 44.1 kHz provisionally and marks it as such.',
    demo: { label: 'Open the spectrum', viz: 'spectrum', cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 1000 } } },
  { id: 'aliasing', title: 'Aliasing', body: 'Content above Nyquist folds back to wrong, lower frequencies. Web Audio oscillators are band-limited, so they omit harmonics above Nyquist instead.',
    demo: { label: 'Saw at 8 kHz: few harmonics fit', viz: 'harmonics', cfg: { source: 'single', pattern: 'tone', waveform: 'sawtooth', frequency: 8000 } } },
  { id: 'modulation', title: 'Modulation', body: 'Modulation means one signal changes a property of another — its level (AM) or its frequency (FM, wobble, siren).',
    demo: { label: 'Siren', viz: 'motion', cfg: { source: 'single', pattern: 'siren', waveform: 'sine', pp: { siren: { min: 500, max: 1000, rate: 0.5, shape: 'sine' } } } } },
  { id: 'am', title: 'AM', body: 'Amplitude modulation varies the level. Slow AM is heard as tremolo; fast AM creates sidebands at f ± fm.',
    demo: { label: 'AM 5 Hz tremolo', viz: 'wave', cfg: { source: 'single', pattern: 'am', waveform: 'sine', frequency: 660, pp: { am: { modFreq: 5, depth: 80 } } } } },
  { id: 'fm', title: 'FM', body: 'Frequency modulation varies the frequency. Slow FM is vibrato; audio-rate FM creates many sidebands spaced by the modulation frequency.',
    demo: { label: 'Audio-rate FM', viz: 'spectrum', cfg: { source: 'single', pattern: 'fm', waveform: 'sine', frequency: 1000, pp: { fm: { modFreq: 200, depthHz: 400 } } } } },
  { id: 'interference', title: 'Interference', body: 'When two waves add, they reinforce where they are in phase and cancel where they are out of phase.',
    demo: { label: '440 + 445 Hz', viz: 'interference', mode: 'dual', cfg: { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 445, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: false, binaural: false } } } },
  { id: 'beating', title: 'Beating', body: 'Two close frequencies produce a level that rises and falls at their difference: 440 Hz and 442 Hz beat at about 2 Hz.',
    demo: { label: '440 + 442 Hz', viz: 'interference', mode: 'dual', cfg: { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 442, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: false, binaural: false } } } },
  { id: 'logscale', title: 'Logarithmic perception', body: 'Pitch is perceived roughly by ratios: 100→200 Hz and 1→2 kHz are both one octave and sound like a similar step. That is why sweeps and maps here are logarithmic.',
    demo: { label: 'Log sweep 20 Hz → 20 kHz', viz: 'motion', cfg: { source: 'sweep', sweep: { start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'once' } } } },
  { id: 'hearing', title: 'Human hearing range', body: 'Nominally 20 Hz – 20 kHz. The upper limit commonly falls with age and noise exposure; individual hearing varies widely.',
    demo: { label: 'Octave steps 125 Hz – 16 kHz', viz: 'motion', cfg: { source: 'single', pattern: 'octave', waveform: 'sine',
      // V2 fix: the steps (and their timing) are what the label promises
      pp: { octave: { text: OCTAVE_STEP_FREQUENCIES.join(', '), toneMs: 400, gapMs: 100 } } } } },
  { id: 'ultrasound', title: 'Ultrasound', body: 'Nominal ultrasound begins above about 20 kHz. 15.5 kHz is a high-frequency signal, not ultrasound. Generating >20 kHz digitally does not mean a speaker emits it.',
    demo: { label: 'High range sweep', viz: 'spectrum', cfg: { source: 'sweep', sweep: { start: 8000, end: 'max', durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } } } },
  { id: 'speakers', title: 'Speaker limitations', body: 'Speakers, headphones, DACs and amplifiers can attenuate or distort very low and very high frequencies. Perceived loudness is not a measure of acoustic output.',
    demo: { label: '40 Hz sub-bass', viz: 'spectrum', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 40, duration: 2000 } } },
];

/**
 * V2 extension: where each V1 demo.viz id is shown in the V2 layout (analysis tab ids of the
 * visual shell; 'motion' is the frequency-over-time chart, 'phase' the Phase & Stereo panel).
 * A suggestion for the integration; LEARN_TOPICS itself is unchanged.
 */
export const LEARN_VIZ_TARGETS = Object.freeze({
  wave: 'waveform',
  spectrum: 'spectrum',
  motion: 'motion',
  path: 'signalPath',
  harmonics: 'harmonics',
  interference: 'phase',
});
