// Modulation subgraphs (lfo, am, fm) and the two-oscillator dual graph. Extracted from V1
// AudioEngine.play switch cases 'lfo' / 'am' / 'fm' and AudioEngine._buildDual
// (index.html@36f4b47), ported to index.html@a7b7a23 (the dual plan carries sounding
// frequencies; detune is never automated). Builders run with the engine as `this` (see scheduler.js); case bodies
// are unchanged except `break;` (removed) and the carrier oscillator, created with
// this._carrier(v, …) so options.periodicWave applies. Every node goes through track()/source().
// v.live keeps the V1 shape updateLive() relies on: lfo {lfo, depth}, am {lfo, lfoGain, amGain},
// fm {mod, modGain}, dual {A, B} with A/B = {osc, g, panner} (+ router with a dual router hook).

/** V1: AudioEngine.play case 'lfo' (index.html@a7b7a23) */
export function buildLfo(v, plan, b) {
  const { ctx, t0, track, source, env } = b;
  const osc = source(this._carrier(v, plan.wave, plan.center, t0));
  const lfo = source(this._osc(plan.shape, plan.rate, t0));
  const depth = track(ctx.createGain());
  depth.gain.value = plan.depth;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  osc.connect(env);
  v.carrier = osc;
  v.live = { lfo, depth };
}

/** V1: AudioEngine.play case 'am' (index.html@a7b7a23) */
export function buildAm(v, plan, b) {
  const { ctx, t0, track, source, env } = b;
  const osc = source(this._carrier(v, plan.wave, plan.freq, t0));
  const amGain = track(ctx.createGain());
  amGain.gain.value = 1 - plan.depth / 2;
  const lfo = source(this._osc('sine', plan.modFreq, t0));
  const lfoGain = track(ctx.createGain());
  lfoGain.gain.value = plan.depth / 2;
  lfo.connect(lfoGain);
  lfoGain.connect(amGain.gain);
  osc.connect(amGain);
  amGain.connect(env);
  v.carrier = osc;
  v.live = { lfo, lfoGain, amGain };
}

/** V1: AudioEngine.play case 'fm' (index.html@a7b7a23) */
export function buildFm(v, plan, b) {
  const { ctx, t0, track, source, env } = b;
  const osc = source(this._carrier(v, plan.wave, plan.freq, t0));
  const mod = source(this._osc('sine', plan.modFreq, t0));
  const modGain = track(ctx.createGain());
  modGain.gain.value = plan.depth;
  mod.connect(modGain);
  modGain.connect(osc.frequency);
  osc.connect(env);
  v.carrier = osc;
  v.live = { mod, modGain };
}

/**
 * Two oscillators, mono mix or stereo split (StereoPanner, or a ChannelMerger fallback).
 * V1: AudioEngine._buildDual (index.html@a7b7a23).
 * V2 dual/stereo output hook: router(ctx, track, plan, source) -> { inputA, inputB, output,
 * update(plan), dispose() } replaces the panners (src/js/audio/stereo.js createStereoRouter,
 * wrapped by the integration). Each side keeps its own gain node (o.gain · level · 0.5); the
 * router only routes. updateLive() calls router.update(newPlan); dispose() runs at cleanup.
 */
export function buildDual(v, plan, t0, track, source, env, router = null) {
  const ctx = this.ctx;
  const canPan = !router && typeof ctx.createStereoPanner === 'function';
  const make = (o, level, pan) => {
    // o.freq is the sounding frequency (detune already folded in), so detune stays 0 and no
    // intermediate value of a live change can exceed the clamp.
    const osc = source(this._osc(o.wave, o.freq, t0));
    const g = track(ctx.createGain());
    g.gain.value = o.gain * level * 0.5;
    osc.connect(g);
    let panner = null;
    if (canPan) {
      panner = track(ctx.createStereoPanner());
      panner.pan.value = pan;
      g.connect(panner);
      panner.connect(env);
    }
    v.freqParams.push(osc.frequency);
    return { osc, g, panner };
  };
  const A = make(plan.a, plan.levelA, plan.stereo ? -1 : 0);
  const B = make(plan.b, plan.levelB, plan.stereo ? 1 : 0);
  if (router) {
    const R = router(ctx, track, plan, source);
    A.g.connect(R.inputA);
    B.g.connect(R.inputB);
    R.output.connect(env);
    v.inserts.push(R);
    v.carrier = A.osc;
    v.live = { A, B, router: R };
    return;
  }
  if (!canPan) {
    if (plan.stereo) {
      const merger = track(ctx.createChannelMerger(2));
      A.g.connect(merger, 0, 0);
      B.g.connect(merger, 0, 1);
      merger.connect(env);
    } else {
      A.g.connect(env);
      B.g.connect(env);
    }
  }
  v.carrier = A.osc;
  v.live = { A, B };
}
