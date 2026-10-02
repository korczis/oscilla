// Stereo routing for two mono sources A and B, with L/R analysers for correlation.
//
//   inputA ─┬─ aL ─┐               ┌─ stereoPath ──────────────┐
//           └─ aR ─┤ merger(2) ────┤                           ├─ output(2ch) ─ splitter ─┬─ anL
//   inputB ─┬─ bL ─┤               └─ monoDown(1ch) ─ monoPath ┘                          └─ anR
//           └─ bR ─┘
//
// Panning is an explicit equal-power law (gainL = cos θ, gainR = sin θ, θ = (pan + 1)·π/4),
// identical to StereoPannerNode for a mono input but without its stereo-input behaviour and
// available in every browser. Inputs are forced to one channel (explicit downmix).
//
// Modes:
//   'split'  A → left only, B → right only (pan values ignored)
//   'pan'    A and B panned by panA / panB and mixed
//   'mono'   the 'pan' mix summed to mono: L = R = (L + R)/2 (a 1-channel "speakers" downmix,
//            upmixed back to both channels by the 2-channel output)
// Mode and level changes glide (setTargetAtTime), so switching never clicks. The analysers sit
// after the output, so correlation measures exactly what is routed.

const TAU_S = 0.015;

/** Equal-power pan gains for pan in [−1, 1] → { left, right }. */
export function panGains(pan) {
  const p = Math.max(-1, Math.min(1, Number(pan) || 0));
  const theta = ((p + 1) * Math.PI) / 4;
  return { left: Math.cos(theta), right: Math.sin(theta) };
}

/** Per-source L/R gains for a routing config (pure; what update() applies). */
export function routingGains(cfg) {
  const mode = cfg.mode || 'split';
  const la = cfg.levelA != null ? Math.max(0, cfg.levelA) : 1;
  const lb = cfg.levelB != null ? Math.max(0, cfg.levelB) : 1;
  const pa = mode === 'split' ? { left: 1, right: 0 } : panGains(cfg.panA);
  const pb = mode === 'split' ? { left: 0, right: 1 } : panGains(cfg.panB);
  return {
    aL: la * pa.left,
    aR: la * pa.right,
    bL: lb * pb.left,
    bR: lb * pb.right,
    stereo: mode === 'mono' ? 0 : 1,
    mono: mode === 'mono' ? 1 : 0,
  };
}

/**
 * createStereoRouter(ctx, cfg, { track }) → router (track(node) is called for every node created)
 * cfg: { mode: 'split' | 'pan' | 'mono', panA, panB (−1…1), levelA, levelB (linear),
 *        analyserFftSize (2048) }
 * router: { inputA, inputB, output, analyserL, analyserR, update(cfg), readTimeDomain(),
 *           config, dispose() }
 * readTimeDomain() fills and returns reused { left, right } Float32Arrays for correlation.js.
 */
export function createStereoRouter(ctx, cfg = {}, { track = (node) => node } = {}) {
  let c = { mode: 'split', panA: -1, panB: 1, levelA: 1, levelB: 1, ...cfg };
  const mono1 = (node) => {
    node.channelCount = 1;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'speakers';
    return node;
  };
  const inputA = mono1(track(ctx.createGain()));
  const inputB = mono1(track(ctx.createGain()));
  const g = {
    aL: track(ctx.createGain()),
    aR: track(ctx.createGain()),
    bL: track(ctx.createGain()),
    bR: track(ctx.createGain()),
  };
  const merger = track(ctx.createChannelMerger(2));
  const stereoPath = track(ctx.createGain());
  const monoDown = mono1(track(ctx.createGain()));
  const monoPath = track(ctx.createGain());
  const output = track(ctx.createGain());
  output.channelCount = 2;
  output.channelCountMode = 'explicit';
  output.channelInterpretation = 'speakers';
  const splitter = track(ctx.createChannelSplitter(2));
  const analyserL = track(ctx.createAnalyser());
  const analyserR = track(ctx.createAnalyser());
  const fft = cfg.analyserFftSize || 2048;
  analyserL.fftSize = fft;
  analyserR.fftSize = fft;

  inputA.connect(g.aL);
  inputA.connect(g.aR);
  inputB.connect(g.bL);
  inputB.connect(g.bR);
  g.aL.connect(merger, 0, 0);
  g.bL.connect(merger, 0, 0);
  g.aR.connect(merger, 0, 1);
  g.bR.connect(merger, 0, 1);
  merger.connect(stereoPath);
  merger.connect(monoDown);
  monoDown.connect(monoPath);
  stereoPath.connect(output);
  monoPath.connect(output);
  output.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);

  const left = new Float32Array(fft);
  const right = new Float32Array(fft);
  let disposed = false;

  function apply(immediate) {
    const k = routingGains(c);
    const t = ctx.currentTime;
    const set = (param, v) => {
      if (immediate) param.setValueAtTime(v, t);
      else param.setTargetAtTime(v, t, TAU_S);
    };
    set(g.aL.gain, k.aL);
    set(g.aR.gain, k.aR);
    set(g.bL.gain, k.bL);
    set(g.bR.gain, k.bR);
    set(stereoPath.gain, k.stereo);
    set(monoPath.gain, k.mono);
  }

  apply(true);

  return {
    inputA,
    inputB,
    output,
    analyserL,
    analyserR,
    get config() {
      return { ...c };
    },
    update(next = {}) {
      if (disposed) return { ...c };
      c = { ...c, ...next };
      apply(false);
      return { ...c };
    },
    readTimeDomain() {
      analyserL.getFloatTimeDomainData(left);
      analyserR.getFloatTimeDomainData(right);
      return { left, right };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const all = [
        inputA,
        inputB,
        g.aL,
        g.aR,
        g.bL,
        g.bR,
        merger,
        stereoPath,
        monoDown,
        monoPath,
        output,
        splitter,
        analyserL,
        analyserR,
      ];
      for (const n of all) {
        try {
          n.disconnect();
        } catch (e) {
          /* already disconnected */
        }
      }
    },
  };
}
