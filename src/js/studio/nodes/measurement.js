// Studio MEASUREMENT node types (spec §29, §106-§107, §191): Capture, Calibration, Transfer
// Analyzer, Measurement Result. They orchestrate the V3 measurement modules and never duplicate
// them: capture checks and the measurement state machine, calibration/interpolate.js,
// measurement/transfer.js (DEFAULT_POINTS_PER_OCTAVE 48, phase off by default), and the
// experiment result record. Capture pre-roll 0.5 s and post-roll 1 s follow the V3 measurement
// specification ("e.g. 0.5 s before, 1-2 s after", docs/specs/oscilla-v3-measure.md).
//
// Data flow is ANALYSIS (captured PCM and results), never audio: the Transfer Analyzer takes the
// digital stimulus on REFERENCE and the capture on OBSERVED through separate ports (§191), so a
// measurement graph cannot swap or conflate them.

import { DEFAULT_POINTS_PER_OCTAVE } from '../../measurement/transfer.js';
import { SMOOTHING_FRACTIONS } from '../../measurement/smoothing.js';
import { EXTRAPOLATION_POLICIES } from '../../calibration/interpolate.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, boolParam, defineNode, enumParam, idParam, integerParam, optionLabel, parts,
  secondsParam,
} from './common.js';

const observedIn = (label = 'Observed') => definePort({ id: 'observed', direction: 'in',
  type: 'ANALYSIS', role: 'OBSERVED', label, required: true });
const observedOut = definePort({ id: 'observed', direction: 'out', type: 'ANALYSIS',
  role: 'OBSERVED', label: 'Observed' });
const resultOut = definePort({ id: 'result', direction: 'out', type: 'ANALYSIS', role: 'RESULT',
  label: 'Result' });
const SMOOTHING_OPTIONS = SMOOTHING_FRACTIONS.map((n) => [n, n === 0 ? 'None' : `1/${n} oct`]);

export const capture = defineNode({
  type: 'capture',
  displayName: 'Capture',
  idPrefix: 'capture',
  category: CATEGORIES.MEASUREMENT,
  aliases: ['record pcm', 'acquire', 'loopback', 'capture session'],
  inputs: [definePort({ id: 'audio', direction: 'in', type: 'AUDIO', role: 'TAP',
    label: 'Audio', required: true })],
  outputs: [observedOut],
  params: [
    secondsParam('preRoll', 'Pre-roll', 0.5, 0, 5),
    secondsParam('postRoll', 'Post-roll', 1, 0, 10),
  ],
  summary(p) {
    return parts(`pre ${p.preRoll} s`, `post ${p.postRoll} s`);
  },
  clipKinds: ['measurement'],
  capabilities: { realtime: true, measurement: true },
  compiler: 'measurement/capture-checks.js#checkCapture',
  reuses: ['measurement/state-machine.js#createMeasurementMachine'],
  help: {
    what: 'Captures a signal of the graph as PCM for measurement (a digital loopback).',
    inputs: 'Audio tap.',
    outputs: 'The observed capture.',
    constraints: 'Capture stays in memory and is checked for clipping and dropouts.',
  },
});

export const calibration = defineNode({
  type: 'calibration',
  displayName: 'Calibration',
  idPrefix: 'cal',
  category: CATEGORIES.MEASUREMENT,
  aliases: ['mic calibration', 'frequency correction', 'profile', 'correction'],
  inputs: [observedIn()],
  outputs: [observedOut],
  params: [
    idParam('profileId', 'Frequency profile'),
    enumParam('extrapolate', 'Outside the profile',
      EXTRAPOLATION_POLICIES.map((e) => [e, e === 'none' ? 'Leave uncorrected' : 'Hold edge']),
      'none'),
  ],
  summary(p) {
    return p.profileId
      ? parts(`Profile ${p.profileId.slice(0, 8)}`, optionLabel(calibration, 'extrapolate',
        p.extrapolate))
      : 'No profile · uncorrected';
  },
  capabilities: { realtime: true, measurement: true },
  compiler: 'calibration/interpolate.js#applyFrequencyCorrection',
  reuses: ['calibration/level.js#toDisplayLevel', 'calibration/profile.js#profileId'],
  help: {
    what: 'Applies a stored frequency-response calibration profile to the observed signal.',
    inputs: 'The observed capture.',
    outputs: 'The corrected observed capture.',
    constraints: 'Without a profile the data passes uncorrected and stays labelled '
      + 'uncalibrated. A profile is referenced by its id, never embedded.',
  },
});

export const transferAnalyzer = defineNode({
  type: 'transfer-analyzer',
  displayName: 'Transfer Analyzer',
  idPrefix: 'transfer',
  category: CATEGORIES.MEASUREMENT,
  aliases: ['transfer function', 'frequency response', 'impulse response', 'deconvolution',
    'h(f)'],
  inputs: [
    definePort({ id: 'reference', direction: 'in', type: 'ANALYSIS', role: 'REFERENCE',
      label: 'Reference', required: true }),
    observedIn(),
  ],
  outputs: [resultOut],
  params: [
    integerParam('pointsPerOctave', 'Points per octave', {
      min: 3, max: 96, default: DEFAULT_POINTS_PER_OCTAVE,
    }),
    boolParam('phase', 'Phase', false),
  ],
  summary(p) {
    return parts(`1/${p.pointsPerOctave} oct`, p.phase ? 'magnitude + phase' : 'magnitude');
  },
  clipKinds: ['measurement'],
  capabilities: { realtime: true, measurement: true },
  compiler: 'measurement/transfer.js#computeTransfer',
  reuses: ['measurement/align.js#align', 'measurement/impulse-response.js#computeImpulseResponse'],
  help: {
    what: 'Computes the transfer function H(f) from the digital reference and the capture.',
    inputs: 'Reference (the digital stimulus) and observed (the capture), on separate ports.',
    outputs: 'The transfer result.',
    constraints: 'Phase only when alignment is robust; magnitude is relative unless calibrated.',
  },
});

export const measurementResult = defineNode({
  type: 'measurement-result',
  displayName: 'Measurement Result',
  idPrefix: 'result',
  category: CATEGORIES.MEASUREMENT,
  aliases: ['result', 'experiment', 'response chart', 'report'],
  inputs: [definePort({ id: 'result', direction: 'in', type: 'ANALYSIS', role: 'RESULT',
    label: 'Result', required: true })],
  params: [enumParam('smoothing', 'Display smoothing', SMOOTHING_OPTIONS, 0)],
  summary(p) {
    return parts('Result', p.smoothing ? `1/${p.smoothing} oct view` : 'raw');
  },
  capabilities: { realtime: true, measurement: true },
  compiler: 'experiments/schema.js#withResults',
  reuses: ['measurement/smoothing.js#smoothFractionalOctave',
    'measurement/quality.js#assessQuality'],
  help: {
    what: 'Shows a measurement result and stores it in the experiment.',
    inputs: 'A transfer or RTA result.',
    outputs: 'None.',
    constraints: 'Smoothing is a display view; the raw result is never modified.',
  },
});

export default [capture, calibration, transferAnalyzer, measurementResult];
