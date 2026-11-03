// Studio ANALYSIS adapters (nodes/analysis.js): Scope, Spectrum, Spectrogram, Meter, RTA.
// Each is a side-chain tap; the adapter contract is the header of adapters/nodes.js.

import { createAnalyserReader } from '../../analysis/analyser.js';
import { createRtaAverager } from '../../measurement/rta.js';
import { did } from './common.js';

function analyserTap({ ctx, acct, params, fftSize = 8192, smoothing = 0.55, extra = {} }) {
  // A tap is an AnalyserNode with no output: it observes the edge's copy of the signal and
  // never alters the audio path (§190). Analysers are pulled by the browser without a
  // destination connection (as the engine's microphone analyser already relies on).
  const analyser = acct.track(ctx.createAnalyser());
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  analyser.minDecibels = -140;
  analyser.maxDecibels = 0;
  const reader = createAnalyserReader(analyser, { sampleRate: ctx.sampleRate });
  return {
    inputs: { audio: analyser },
    outputs: {},
    outputRange: {},
    modTarget: (key) => ({ reason: `${key} is not modulatable` }),
    applyBase() {},
    update(changed, owned, w) {
      if ('fftSize' in changed) { analyser.fftSize = changed.fftSize; reader.sync(); }
      if ('smoothing' in changed) analyser.smoothingTimeConstant = changed.smoothing;
      did(w, changed, ['fftSize', 'smoothing'], 'set');
    },
    stop() {}, dispose() {},
    info: { analyser, reader, params: { ...params }, ...extra },
    status: 'ready',
    reason: null,
  };
}

export const scope = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: env.params.fftSize }),
};
export const spectrum = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: env.params.fftSize,
    smoothing: env.params.smoothing }),
};
export const spectrogram = {
  compiler: 'analysis/spectrogram.js#createSpectrogram',
  structural: [],
  // The view binds createSpectrogram(canvas, ...) to this analyser; the runtime has no canvas.
  create: (env) => analyserTap({ ...env,
    extra: { view: 'analysis/spectrogram.js#createSpectrogram' } }),
};
export const meter = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: 2048 }),
};
export const rta = {
  compiler: 'measurement/rta.js#createRtaAverager',
  structural: ['averaging', 'peakHold'],
  create: (env) => analyserTap({ ...env, extra: { averager: createRtaAverager({
    mode: env.params.averaging, peakHold: env.params.peakHold }) } }),
};
