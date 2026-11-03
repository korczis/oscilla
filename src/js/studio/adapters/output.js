// Studio OUTPUT adapters (nodes/output.js): Master Output, Recorder/Export.
// The adapter contract is the header of adapters/nodes.js.

import { createRamp } from './ramp.js';
import { did, inertHandle } from './common.js';

export const master = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params, options, global }) {
    // The Studio bus feeds engine.master — the head of the existing safety chain (master gain
    // ≤ MAX_OUTPUT_GAIN → limiter → trim → ceiling → analyser → destination). It is the only
    // Studio node connected outside the Studio graph; nothing reaches ctx.destination directly.
    // The bus is silent (0) until the crossfade, so connecting it while prepared changes nothing.
    const out = hooks.masterInput();
    if (!out) throw new Error('The engine has no master output chain.');
    const bus = acct.track(ctx.createGain());
    const ramp = createRamp(bus.gain, 0, ctx.currentTime, ctx.sampleRate);
    bus.connect(out);
    // The engine's master level is shared with MEASURE, Labs and the Playground: written only
    // through the runtime's gate, and only once the transaction committed (engage, update).
    const level = global || { setMasterLevel: (g) => options.masterLevel !== 'ignore'
      && (hooks.setMasterLevel(g), true) };
    return {
      inputs: { audio: bus },
      outputs: {},
      outputRange: {},
      modTarget: () => ({ reason: 'The master level is neither automatable nor modulatable.' }),
      applyBase() {},
      engage() { level.setMasterLevel(params.level); },
      update(changed, owned, w) {
        // engine.setMasterGain: clamped and smoothed
        if ('level' in changed && level.setMasterLevel(changed.level)) {
          did(w, changed, ['level'], 'glide');
        }
      },
      /** Fade the whole Studio output (start, stop, Master removal). */
      fade(target, at, dur) { return ramp.to(target, at, dur); },
      stop() {},
      dispose() {},
      info: { bus, chainInput: out },
      status: 'ready',
      reason: null,
    };
  },
};

export const recorder = {
  compiler: 'audio/offline-renderer.js#renderToWav',
  structural: [],
  check: () => 'Recorder/Export renders offline (audio/offline-renderer.js); it has no realtime '
    + 'node.',
  create: () => inertHandle('offline-only', null),
};
