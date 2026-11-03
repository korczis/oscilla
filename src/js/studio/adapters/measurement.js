// Studio MEASUREMENT adapters (nodes/measurement.js): Capture and the ANALYSIS data nodes
// (Calibration, Transfer Analyzer, Measurement Result). The adapter contract is the header of
// adapters/nodes.js.

import { inertHandle } from './common.js';

export const capture = {
  compiler: 'measurement/capture-checks.js#checkCapture',
  structural: [],
  create({ ctx, acct }) {
    // Attach point for the measurement io (capture.js records from here, §106); a side-chain
    // input with no output, so it never alters the audio path.
    const tap = acct.track(ctx.createGain());
    return { ...inertHandle('ready', null, { tap }), inputs: { audio: tap } };
  },
};

export const dataNode = (compiler) => ({
  compiler,
  structural: [],
  data: true,
  // ANALYSIS data (captures, profiles, results) flows through the measurement engine, not
  // through Web Audio: the runtime only records the bindings (runtime.dataEdges).
  create: () => inertHandle('data', null),
});
