// The Playground configurations of plan V605 ("Open the Playground voice in the Studio"), shared
// by tests/unit/playground-voice-in-studio.test.mjs (the document and refusal contract) and
// tests/browser/fixtures/playground-voice-in-studio-entry.js (the offline renders and their
// residual, run by tests/browser/v31-studio-offline.cjs). Each entry is what a user sets in the
// Playground: a configuration applied the way a preset or a link applies it (core/config.js
// applyConfig, then audio/patterns.js buildPlan, as instrument.js currentPlan does) and the labs
// that shape the voice, in the plain shape main.js labVizInputs hands the Signal Path.
//
//   VOICE_CONFIGS    [{ id, label, cfg, labs, opens, code? }]
//                    opens: true   the voice opens, and its Studio render matches the Playground's
//                    opens: false  refused, `code` naming the reason (VOICE_OPEN_TEXT)
//   voiceSetup(entry, { sampleRate }) -> { state, plan, warnings, labs, input, router }
//     input   playgroundVoiceModel's input (what the Signal Path draws from)
//     router  the stereo router config main.js routerConfigFor gives a dual plan, or null
//
// labs: { filter: { type, frequency, Q, gain } (enabled), adsr: { a, d, s, r }, pan (the Phase
//         lab's pan), phaseDeg, additive: [{ gain }] (the Additive lab's bars) }

import { applyConfig } from '../../../src/js/core/config.js';
import { buildPlan } from '../../../src/js/audio/patterns.js';
import { BUILTIN_PRESETS } from '../../../src/js/data/presets.js';
import { SAFE_NYQUIST_FACTOR } from '../../../src/js/core/constants.js';

const preset = (id) => {
  const p = BUILTIN_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p.cfg;
};

/** Every configuration V605 lists: covered (opens) or refused (code). */
export const VOICE_CONFIGS = Object.freeze([
  // Single source.
  { id: 'single-tone', label: 'single source, continuous tone (held), sine 440 Hz',
    cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440 }, opens: true },
  { id: 'single-tone-filter-adsr', label: 'single source, sawtooth 220 Hz held, Filter Lab '
    + 'low-pass 1.2 kHz and Envelope Lab ADSR',
  cfg: { source: 'single', pattern: 'tone', waveform: 'sawtooth', frequency: 220 },
  labs: { filter: { type: 'lowpass', frequency: 1200, Q: Math.SQRT1_2, gain: 0 },
    adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.2 } }, opens: true },
  { id: 'finite-tone', label: 'single source, finite tone 500 ms, triangle 261.63 Hz',
    cfg: { source: 'single', pattern: 'finite', waveform: 'triangle', frequency: 261.63,
      duration: 500 }, opens: true },
  { id: 'finite-tone-adsr', label: 'single source, finite tone 600 ms, sine 330 Hz, Envelope '
    + 'Lab ADSR', cfg: { source: 'single', pattern: 'finite', waveform: 'sine', frequency: 330,
    duration: 600 }, labs: { adsr: { a: 0.02, d: 0.1, s: 0.5, r: 0.15 } }, opens: true },
  // The V1 patterns of src/js/data/presets.js (siren, wobble, AM, FM, sequence, pulse, octave,
  // chirp): a preset where one exists, else the pattern's defaults.
  { id: 'am', label: 'AM tremolo: 440 Hz carrier, 4 Hz, 80 %',
    cfg: { source: 'single', pattern: 'am', waveform: 'sine', frequency: 440 }, opens: true },
  { id: 'am-audio-rate', label: 'AM at audio rate: sawtooth 330 Hz carrier, 150 Hz, 50 %',
    cfg: { source: 'single', pattern: 'am', waveform: 'sawtooth', frequency: 330,
      pp: { am: { modFreq: 150, depth: 50 } } }, opens: true },
  { id: 'wobble-still', label: 'Wobble at depth 0: the LFO built, nothing modulated',
    cfg: { source: 'single', pattern: 'wobble', waveform: 'triangle', frequency: 523.25,
      pp: { wobble: { depth: 0, rate: 5 } } }, opens: true },
  { id: 'sequence', label: 'A major arpeggio (mus-triad): 4 tones × 350 ms',
    cfg: preset('mus-triad'), opens: true },
  { id: 'sequence-adsr', label: 'A major arpeggio with the Envelope Lab ADSR on every tone',
    cfg: preset('mus-triad'), labs: { adsr: { a: 0.01, d: 0.05, s: 0.6, r: 0.05 } },
    opens: true },
  { id: 'pulse', label: 'Double pulse (pt-double): 15.5 kHz, 150 ms × 2',
    cfg: preset('pt-double'), opens: true },
  { id: 'octave', label: 'Octave stepping (pt-octaves): 125 Hz to 16 kHz × 400 ms',
    cfg: preset('pt-octaves'), opens: true },
  { id: 'chirp', label: 'Chirp (pt-chirp): 10 to 18 kHz exponential, 300 ms',
    cfg: preset('pt-chirp'), opens: true },
  { id: 'pingpong', label: 'Ping-pong sweep: 200 Hz to 4 kHz, 1 s cycle, twice, log',
    cfg: { source: 'single', pattern: 'pingpong', waveform: 'sine',
      pp: { pingpong: { min: 200, max: 4000, cycleMs: 1000, repeats: 2, curve: 'log' } } },
    opens: true },
  // The sweep source.
  { id: 'sweep-once', label: 'sweep source once: 40 to 250 Hz, 4 s, log (sw-bass)',
    cfg: preset('sw-bass'), opens: true },
  { id: 'sweep-linear-down', label: 'sweep source once: 2 kHz down to 200 Hz, 1 s, linear',
    cfg: { source: 'sweep', sweep: { start: 200, end: 2000, durationMs: 1000, curve: 'linear',
      direction: 'down', repeat: 'once' } }, opens: true },
  { id: 'sweep-pingpong', label: 'sweep source ping-pong: 100 Hz to 1 kHz, 400 ms a pass, log',
    cfg: { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 400, curve: 'log',
      direction: 'pingpong', repeat: 'once' } }, opens: true },
  // The dual source, B phase 0.
  { id: 'dual-mono', label: 'dual source, mono: 440 + 442 Hz',
    cfg: { source: 'dual' }, opens: true },
  { id: 'dual-stereo', label: 'dual source, stereo split (the stereo router): 440 / 446 Hz',
    cfg: preset('du-binaural'), opens: true },
  { id: 'dual-panned', label: 'dual source, mono panned by the Phase lab (pan 0.5): '
    + 'sine 300 + square 450 Hz',
  cfg: { source: 'dual', dual: { a: { freq: 300, wave: 'sine', gain: 100, detune: 0 },
    b: { freq: 450, wave: 'square', gain: 60, detune: 0 }, levelA: 80, levelB: 50,
    stereo: false, binaural: false } }, labs: { pan: 0.5 }, opens: true },
  // Refused, each with its reason.
  { id: 'additive', label: 'the Additive lab on a held tone',
    cfg: { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 220 },
    labs: { additive: [{ gain: 1 }, { gain: 0.5 }, { gain: 0.33 }, { gain: 0 }] },
    opens: false, code: 'additive' },
  { id: 'siren', label: 'Fast siren (pt-siren): sine LFO 3 Hz, 13 to 17 kHz',
    cfg: preset('pt-siren'), opens: false, code: 'modulation' },
  { id: 'siren-triangle', label: 'Siren, triangle LFO 0.5 Hz, 600 to 1200 Hz',
    cfg: { source: 'single', pattern: 'siren', waveform: 'square',
      pp: { siren: { min: 600, max: 1200, rate: 0.5, shape: 'triangle' } } }, opens: false,
    code: 'modulation' },
  { id: 'wobble', label: 'Soft wobble (pt-wobble): 15 kHz ± 800 Hz at 2 Hz',
    cfg: preset('pt-wobble'), opens: false, code: 'modulation' },
  { id: 'fm', label: 'FM: 440 Hz carrier, 5 Hz, ± 60 Hz',
    cfg: { source: 'single', pattern: 'fm', waveform: 'sine', frequency: 440 }, opens: false,
    code: 'modulation' },
  { id: 'dual-phase', label: 'a dual voice with B 90° ahead (the Phase lab)',
    cfg: { source: 'dual' }, labs: { phaseDeg: 90 }, opens: false, code: 'phase' },
  { id: 'sweep-continuous', label: 'a sweep repeating without an end (continuous playback '
    + 'allowed)', cfg: { source: 'sweep', sweep: { start: 300, end: 3000, durationMs: 500,
    curve: 'log', direction: 'up', repeat: 'continuous' } }, continuous: true,
  opens: false, code: 'continuous' },
  { id: 'short-tone', label: 'a 20 ms finite tone, shorter than its 10 ms attack and 30 ms '
    + 'release allow', cfg: { source: 'single', pattern: 'finite', frequency: 1000,
    duration: 20 }, opens: false, code: 'short' },
  { id: 'finite-adsr-fast-release', label: 'a finite tone with an Envelope Lab release of 2 ms',
    cfg: { source: 'single', pattern: 'finite', frequency: 440, duration: 500 },
    labs: { adsr: { a: 0.01, d: 0.05, s: 0.6, r: 0.002 } }, opens: false, code: 'release' },
]);

/** The stereo router config of a dual plan (main.js routerConfigFor, needsRouter). */
function routerFor(plan, labs) {
  if (!plan || plan.type !== 'dual') return null;
  const pan = Number(labs.pan) || 0;
  if (plan.stereo) return { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1 };
  if (Math.abs(pan) > 1e-3) return { mode: 'pan', panA: pan, panB: pan, levelA: 1, levelB: 1 };
  return null;
}

/** The Playground state, plan and Signal Path input of a configuration at a sample rate. */
export function voiceSetup(entry, { sampleRate }) {
  const labs = entry.labs || {};
  const continuous = !!entry.continuous;
  const { state } = applyConfig(null, entry.cfg, { sampleRate, continuousAllowed: continuous });
  const safeMax = (sampleRate / 2) * SAFE_NYQUIST_FACTOR;
  const res = buildPlan({ source: state.source, pattern: state.pattern, waveform: state.waveform,
    frequency: state.frequency, duration: state.duration, pp: state.pp, sweep: state.sweep,
    dual: state.dual }, { safeMax, continuous });
  const plan = res.ok ? res.plan : null;
  const dual = !!plan && plan.type === 'dual';
  const router = routerFor(plan, labs);
  const lab = {
    additive: labs.additive && !dual ? labs.additive.map((b) => ({ ...b })) : null,
    adsr: labs.adsr ? { ...labs.adsr } : null,
    filter: labs.filter ? { ...labs.filter, enabled: true } : null,
    router: router ? { ...router } : null,
    phaseDeg: dual ? Number(labs.phaseDeg) || 0 : 0,
  };
  const input = { plan, waveform: state.waveform, frequency: state.frequency,
    gain: state.gainLevel, attackMs: state.attack, releaseMs: state.release, lab };
  return { state, plan, warnings: res.ok ? res.warnings : [res.error], labs, input, router };
}
