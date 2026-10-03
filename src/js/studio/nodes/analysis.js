// Studio ANALYSIS node types (spec §29, §190): Scope, Spectrum, Spectrogram, Meter, RTA.
// Every analyzer takes an AUDIO TAP input: a side-chain that observes a signal without altering
// the audio path, so an analyzer is never in series with the output. Defaults: the engine's
// analyser (fftSize 8192, smoothingTimeConstant 0.55, audio/audio-engine.js), createSpectrogram
// (20 Hz, −120..−20 dB, 10 s, log, analysis/spectrogram.js), createRtaAverager ('fast', no peak
// hold) and one-third-octave bands (measurement/rta.js). Levels are relative (dBFS-like) unless a
// level calibration applies downstream (project rule no-fake-science).

import { definePort } from '../ports.js';
import {
  CATEGORIES, boolParam, defineNode, enumParam, frequencyParam, hz, numberParam, optionLabel,
  parts,
} from './common.js';

const tap = () => definePort({ id: 'audio', direction: 'in', type: 'AUDIO', role: 'TAP',
  label: 'Audio', required: true });
const FFT_OPTIONS = [2048, 4096, 8192, 16384, 32768].map((n) => [n, String(n)]);
const ENGINE_FFT = 8192;
const live = { realtime: true };

export const scope = defineNode({
  type: 'scope',
  displayName: 'Scope',
  idPrefix: 'scope',
  category: CATEGORIES.ANALYSIS,
  aliases: ['oscilloscope', 'waveform', 'wave view'],
  inputs: [tap()],
  params: [enumParam('fftSize', 'Window', FFT_OPTIONS, ENGINE_FFT, { unit: 'samples' })],
  summary(p) {
    return `Waveform · ${p.fftSize} samples`;
  },
  capabilities: live,
  compiler: 'analysis/analyser.js#createAnalyserReader',
  help: {
    what: 'Shows the waveform of the tapped signal.',
    inputs: 'Audio tap (does not change the signal).',
    outputs: 'None.',
    constraints: 'Live only; shows digital sample values, not acoustic pressure.',
  },
});

export const spectrum = defineNode({
  type: 'spectrum',
  displayName: 'Spectrum',
  idPrefix: 'spectrum',
  category: CATEGORIES.ANALYSIS,
  aliases: ['fft', 'analyzer', 'analyser', 'frequency view'],
  inputs: [tap()],
  params: [
    enumParam('fftSize', 'FFT size', FFT_OPTIONS, ENGINE_FFT, { unit: 'samples' }),
    numberParam('smoothing', 'Smoothing', { min: 0, max: 0.99, step: 0.01, default: 0.55 }),
    enumParam('scale', 'Frequency scale', [['log', 'Logarithmic'], ['linear', 'Linear']], 'log'),
  ],
  summary(p) {
    return parts(`FFT ${p.fftSize}`, p.scale);
  },
  capabilities: live,
  compiler: 'analysis/analyser.js#createAnalyserReader',
  reuses: ['analysis/fft.js#spectrumDb', 'analysis/peak-detector.js#findPeak'],
  help: {
    what: 'Shows the magnitude spectrum of the tapped signal.',
    inputs: 'Audio tap (does not change the signal).',
    outputs: 'None.',
    constraints: 'Levels are relative (dBFS-like).',
  },
});

export const spectrogram = defineNode({
  type: 'spectrogram',
  displayName: 'Spectrogram',
  idPrefix: 'sgram',
  category: CATEGORIES.ANALYSIS,
  aliases: ['waterfall', 'sonogram', 'time frequency'],
  inputs: [tap()],
  params: [
    frequencyParam('minHz', 'Lowest frequency', 20),
    numberParam('minDb', 'Floor', { min: -200, max: 0, step: 1, unit: 'dB', default: -120 }),
    numberParam('maxDb', 'Ceiling', { min: -200, max: 0, step: 1, unit: 'dB', default: -20 }),
    numberParam('timeSpan', 'Time span', { min: 1, max: 60, step: 1, unit: 's', default: 10 }),
    enumParam('scale', 'Frequency scale', [['log', 'Logarithmic'], ['linear', 'Linear']], 'log'),
  ],
  summary(p) {
    return parts(`from ${hz(p.minHz)}`, `${p.timeSpan} s`, p.scale);
  },
  capabilities: live,
  compiler: 'analysis/spectrogram.js#createSpectrogram',
  help: {
    what: 'Shows how the spectrum of the tapped signal changes over time.',
    inputs: 'Audio tap (does not change the signal).',
    outputs: 'None.',
    constraints: 'The floor must be below the ceiling. Levels are relative.',
  },
});

export const meter = defineNode({
  type: 'meter',
  displayName: 'Meter',
  idPrefix: 'meter',
  category: CATEGORIES.ANALYSIS,
  aliases: ['level meter', 'vu', 'rms', 'peak meter'],
  inputs: [tap()],
  params: [enumParam('mode', 'Mode', [['rms', 'RMS'], ['peak', 'Peak']], 'rms')],
  summary(p) {
    return `${optionLabel(meter, 'mode', p.mode)} · dB relative`;
  },
  capabilities: live,
  compiler: 'analysis/analyser.js#createAnalyserReader',
  reuses: ['analysis/analyser.js#amplitudeToDb'],
  help: {
    what: 'Shows the level of the tapped signal.',
    inputs: 'Audio tap (does not change the signal).',
    outputs: 'None.',
    constraints: 'dB relative to digital full scale, never dB SPL.',
  },
});

export const rta = defineNode({
  type: 'rta',
  displayName: 'RTA',
  idPrefix: 'rta',
  category: CATEGORIES.ANALYSIS,
  aliases: ['real time analyzer', 'octave bands', 'third octave', '1/3 octave', 'band levels'],
  inputs: [tap()],
  outputs: [definePort({ id: 'result', direction: 'out', type: 'ANALYSIS', role: 'RESULT',
    label: 'Result' })],
  params: [
    enumParam('resolution', 'Bands', [['third', '1/3 octave'], ['octave', 'Octave']], 'third'),
    enumParam('averaging', 'Averaging', [['instant', 'Instant'], ['fast', 'Fast'],
      ['slow', 'Slow']], 'fast'),
    boolParam('peakHold', 'Peak hold', false),
  ],
  summary(p) {
    return parts(optionLabel(rta, 'resolution', p.resolution),
      optionLabel(rta, 'averaging', p.averaging), p.peakHold ? 'peak hold' : null);
  },
  capabilities: { realtime: true, measurement: true },
  compiler: 'measurement/rta.js#createRtaAverager',
  reuses: ['measurement/rta.js#bandCenters', 'measurement/rta.js#bandAnalysis'],
  help: {
    what: 'Band levels in octave or one-third-octave bands (estimated, FFT-based).',
    inputs: 'Audio tap (does not change the signal).',
    outputs: 'The band result for a Measurement Result.',
    constraints: 'Not an IEC 61260-1 class filter bank; levels are relative unless calibrated.',
  },
});

export default [scope, spectrum, spectrogram, meter, rta];
