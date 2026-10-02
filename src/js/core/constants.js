// OSCILLA core constants, extracted from V1 (index.html@a7b7a23, section 1 CONSTANTS).
// Values are unchanged. FREQUENCY_REGIONS lives in frequency.js, NOTE_* in music.js and the
// pattern descriptors and defaults in audio/patterns.js.
//
// Moved V1 bodies keep their original line text (including lines over 100 columns) so later V1
// fixes can be ported from a diff against a7b7a23; new code follows CONVENTIONS.md.

// V1: APP_VERSION … LIMITER_RATIO (index.html@a7b7a23; CONTINUOUS_SCHEDULE_S was removed there,
// the continuous sweep is scheduled ahead in slices by the engine, see audio/scheduler.js).
// APP_VERSION stays '1.0.0' (frozen by the golden vectors); bump it at release time.
export const APP_VERSION = '1.0.0';
export const SPEED_OF_SOUND = 343;            // m/s, used for approximate wavelength
export const SAFE_NYQUIST_FACTOR = 0.95;      // safeMaximum = nyquist * 0.95
export const PROVISIONAL_SAMPLE_RATE = 44100; // UI-only assumption until an AudioContext exists
export const MIN_FREQUENCY = 1;               // Hz, absolute floor of every range
export const MAX_OUTPUT_GAIN = 0.25;          // logical gain at UI 100 %, never Web Audio gain 1
export const DEFAULT_GAIN = 0.08;
export const GAIN_FLOOR = 0.0001;             // positive floor for exponential ramps (-80 dB)
export const START_OFFSET_S = 0.02;           // schedule slightly ahead of currentTime
export const MAX_PROGRAMMED_S = 30;           // longest programmed pattern
export const SAFETY_LIMIT_OPTIONS = [0.5, 1, 2, 3, 5];
export const HISTORY_MAX = 50;
export const PRESET_SCHEMA_VERSION = 1;
export const LIMITER_THRESHOLD_DB = -3;
export const LIMITER_RATIO = 20;

// V1: STORAGE_KEYS (index.html@a7b7a23)
export const STORAGE_KEYS = {
  theme: 'oscilla.theme',
  presets: 'oscilla.presets',
  history: 'oscilla.history',
  safetySeen: 'oscilla.safetyNoticeCollapsed',
};

// V1: WAVEFORMS, WAVEFORM_LABELS, RANGE_MODES (index.html@a7b7a23)
export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];
export const WAVEFORM_LABELS = { sine: 'Sine', triangle: 'Triangle', sawtooth: 'Saw', square: 'Square' };

export const RANGE_MODES = [
  { id: 'human', label: 'Human', hint: '20 Hz – 20 kHz' },
  { id: 'high', label: 'High', hint: '8 kHz – digital limit' },
  { id: 'custom', label: 'Custom', hint: 'user-defined' },
  { id: 'advanced', label: 'Advanced', hint: '1 Hz – digital limit' },
];

// V1: THIRD_OCTAVE_FREQUENCIES, OCTAVE_STEP_FREQUENCIES, SPECTRUM_MARKERS (index.html@a7b7a23)
export const THIRD_OCTAVE_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
export const OCTAVE_STEP_FREQUENCIES = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const SPECTRUM_MARKERS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

// V1: VIZ_MODES, APP_MODES (index.html@a7b7a23). V1 navigation ids; V2 replaces them in the UI,
// LEARN_TOPICS demo.viz and the URL `m` key still use them.
export const VIZ_MODES = [
  { id: 'wave', label: 'Wave' },
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'motion', label: 'Motion' },
  { id: 'path', label: 'Path' },
  { id: 'harmonics', label: 'Harmonics' },
  { id: 'interference', label: 'Interfere' },
];

export const APP_MODES = [
  { id: 'playground', label: 'Playground', short: 'Play' },
  { id: 'sweep', label: 'Sweep', short: 'Sweep' },
  { id: 'dual', label: 'Dual Osc', short: 'Dual' },
  { id: 'presets', label: 'Presets', short: 'Presets' },
  { id: 'learn', label: 'Learn', short: 'Learn' },
];
