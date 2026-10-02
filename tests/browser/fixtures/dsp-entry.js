// Browser fixture for tests/browser/dsp.cjs: bundles the DSP modules and exposes measurement
// routines on window.DSP_TESTS. Each routine returns plain numbers; the runner asserts.

import { createAnalyserReader } from '../../../src/js/analysis/analyser.js';
import { findPeak } from '../../../src/js/analysis/peak-detector.js';
import { createSpectrumAnalyzer } from '../../../src/js/analysis/fft.js';
import { pearson } from '../../../src/js/analysis/correlation.js';
import { createSpectrogram } from '../../../src/js/analysis/spectrogram.js';
import {
  applyAdsr,
  releaseAt,
  getSchedule,
  valueAtTime,
  ENVELOPE_FLOOR,
} from '../../../src/js/audio/envelope.js';
import {
  harmonicSeries,
  buildPeriodicWave,
  createAdditiveOscillator,
} from '../../../src/js/audio/additive.js';
import { createFilterStage } from '../../../src/js/audio/filters.js';
import { createStereoRouter } from '../../../src/js/audio/stereo.js';
import { createNoiseSource } from '../../../src/js/audio/noise.js';
import { encodeWav } from '../../../src/js/audio/wav.js';
import { render, renderTone, bufferStats } from '../../../src/js/audio/offline-renderer.js';

const SR = 48000;
const FFT = 8192;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rms = (d, from = 0, to = d.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / (to - from));
};

function spectrumPeak(samples, offset, opts = {}) {
  const spec = createSpectrumAnalyzer(FFT).compute(samples, offset, new Float32Array(FFT / 2));
  return findPeak(spec, { sampleRate: SR, fftSize: FFT, ...opts });
}

/** 1 kHz tone through a live AnalyserNode + reader + peak detector. */
async function liveTonePeak() {
  const ctx = new AudioContext({ sampleRate: SR });
  try {
    await ctx.resume();
    if (ctx.state !== 'running') return { skipped: `context ${ctx.state}` };
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    const an = ctx.createAnalyser();
    an.fftSize = FFT;
    an.smoothingTimeConstant = 0;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    osc.connect(g).connect(an).connect(mute).connect(ctx.destination);
    osc.start();
    await sleep(600);
    const reader = createAnalyserReader(an);
    const spec = reader.readFrequency();
    const p = findPeak(spec, {
      sampleRate: ctx.sampleRate,
      fftSize: an.fftSize,
      minHz: 100,
      maxHz: 5000,
    });
    osc.stop();
    return { sampleRate: ctx.sampleRate, binHz: reader.binHz, peak: p };
  } finally {
    await ctx.close();
  }
}

/** Same through an OfflineAudioContext suspended at 0.5 s (deterministic), when supported. */
async function offlineTonePeak() {
  const ctx = new OfflineAudioContext(1, SR, SR);
  if (typeof ctx.suspend !== 'function') return { skipped: 'OfflineAudioContext.suspend missing' };
  const osc = ctx.createOscillator();
  osc.frequency.value = 1000;
  const g = ctx.createGain();
  g.gain.value = 0.25;
  const an = ctx.createAnalyser();
  an.fftSize = FFT;
  an.smoothingTimeConstant = 0;
  osc.connect(g).connect(an).connect(ctx.destination);
  osc.start();
  let result = null;
  try {
    ctx.suspend(0.5).then(() => {
      const reader = createAnalyserReader(an, { sampleRate: SR });
      result = findPeak(reader.readFrequency(1), { sampleRate: SR, fftSize: FFT });
      ctx.resume();
    });
  } catch (e) {
    return { skipped: `suspend(t) unsupported: ${e.message}` };
  }
  await ctx.startRendering();
  return { binHz: SR / FFT, peak: result };
}

/** Lowpass at Q = 0.7071 (linear): response at cutoff and a measured tone attenuation. */
async function filterResponse() {
  const probeCtx = new OfflineAudioContext(1, 128, SR);
  const st = createFilterStage(probeCtx, { type: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 });
  const r1 = st.getResponse(Float32Array.from([1000, 100, 10000]));
  st.update({ frequency: 2000 });
  const r2 = st.getResponse(Float32Array.from([2000]));
  st.update({ type: 'highpass', frequency: 1000 });
  const r3 = st.getResponse(Float32Array.from([1000, 100]));
  st.update({ type: 'peaking', frequency: 3000, Q: 2, gain: 6 });
  const r4 = st.getResponse(Float32Array.from([3000]));
  st.dispose();

  // measured: a 1 kHz sine through the lowpass stage vs. the same sine dry
  const measure = async (enabled) =>
    render(
      (ctx, dest) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = 1000;
        const tracked = [];
        const stage = createFilterStage(
          ctx,
          { type: 'lowpass', frequency: 1000, Q: Math.SQRT1_2, enabled },
          {
            track: (n) => {
              tracked.push(n);
              return n;
            },
          },
        );
        osc.connect(stage.input);
        stage.output.connect(dest);
        osc.start(0);
        measure.tracked = tracked.length;
      },
      { duration: 0.5, sampleRate: SR, channels: 1 },
    );
  const wet = await measure(true);
  const dry = await measure(false);
  const a = wet.getChannelData(0);
  const b = dry.getChannelData(0);
  const measuredDb = 20 * Math.log10(rms(a, SR * 0.25, SR * 0.5) / rms(b, SR * 0.25, SR * 0.5));
  return {
    lpAtCutoffDb: r1.magDb[0],
    lpAt100Db: r1.magDb[1],
    lpAt10kDb: r1.magDb[2],
    lpPhaseAtCutoffDeg: r1.phaseDeg[0],
    lpAfterUpdateDb: r2.magDb[0],
    hpAtCutoffDb: r3.magDb[0],
    hpAt100Db: r3.magDb[1],
    peakingDb: r4.magDb[0],
    measuredDb,
    trackedNodes: measure.tracked,
  };
}

/** Offline-render a 440 Hz tone, encode WAV (16 and 32 bit), decode it, find the peak. */
async function wavRoundTrip() {
  const buffer = await renderTone({
    frequency: 440,
    duration: 1,
    sampleRate: SR,
    channels: 2,
    gain: 0.5,
    waveform: 'sine',
    envelope: { a: 0.01, d: 0.05, s: 1, r: 0.05 },
  });
  const stats = bufferStats(buffer);
  const out = { stats, rendered: spectrumPeak(buffer.getChannelData(0), 12000) };
  const ctx = new OfflineAudioContext(1, 1, SR);
  for (const bitDepth of [16, 32]) {
    const wav = encodeWav(buffer, { bitDepth });
    const decoded = await ctx.decodeAudioData(wav.slice(0));
    out[`b${bitDepth}`] = {
      bytes: wav.byteLength,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      length: decoded.length,
      peak: spectrumPeak(decoded.getChannelData(1), 12000),
      maxAbsDiff: (() => {
        const x = buffer.getChannelData(0);
        const y = decoded.getChannelData(0);
        let m = 0;
        for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i]));
        return m;
      })(),
    };
  }
  return { binHz: SR / FFT, ...out };
}

/** PeriodicWave square approximation (harmonics 1…5): levels of 1, 3, 5 and the even gaps. */
async function periodicWaveSquare() {
  const f0 = 64 * (SR / FFT); // bin-centred: 375 Hz, harmonics on bins 192, 320
  let build = null;
  const buffer = await render(
    (ctx, dest) => {
      const osc = ctx.createOscillator();
      build = buildPeriodicWave(ctx, harmonicSeries('square', 5));
      osc.setPeriodicWave(build.wave);
      osc.frequency.value = f0;
      osc.connect(dest);
      osc.start(0);
    },
    { duration: 0.5, sampleRate: SR, channels: 1 },
  );
  const d = buffer.getChannelData(0);
  const band = (f) => spectrumPeak(d, 4800, { minHz: f - 40, maxHz: f + 40, minSnrDb: -200 });
  const h = [1, 2, 3, 4, 5].map((n) => band(n * f0));
  let peak = 0;
  for (let i = 4800; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return {
    f0,
    freqs: h.map((p) => p && p.frequencyHz),
    levels: h.map((p) => p && p.levelDbfs),
    scale: build.scale,
    expectedPeak: build.outputPeak,
    renderedPeak: peak,
  };
}

/**
 * ADSR release click test: a constant source × envelope, so the output IS the gain curve.
 * Releases mid-attack, mid-decay and during sustain, scheduled ahead (native and emulated hold)
 * and, where OfflineAudioContext.suspend exists, "now" while the ramp is being rendered.
 * Controls that must show a click: 'naive' (release assuming the sustain level) and
 * 'naive-now' (cancelScheduledValues + ramp, the in-progress ramp is dropped).
 */
async function releaseClicks() {
  const adsr = { a: 0.05, d: 0.1, s: 0.5, r: 0.08 };
  const t0 = 0.01;
  const cases = [];
  const hasNative = typeof AudioParam.prototype.cancelAndHoldAtTime === 'function';
  const probe = new OfflineAudioContext(1, 128, SR);
  const hasSuspend = typeof probe.suspend === 'function';
  const modes = (hasNative ? ['native', 'emulated'] : ['emulated']).concat(['naive']);
  if (hasSuspend) modes.push(...(hasNative ? ['native-now'] : []), 'emulated-now', 'naive-now');
  for (const tReq of [0.0251, 0.1137, 0.25]) {
    for (const mode of modes) {
      if (mode === 'naive' && tReq > 0.2) continue; // sustain: the naive assumption is right
      let schedule = null;
      let gainParam = null;
      let tRel = tReq;
      const buffer = await render(
        (ctx, dest) => {
          const src = ctx.createConstantSource();
          src.offset.value = 1;
          const env = ctx.createGain();
          gainParam = env.gain;
          applyAdsr(env.gain, t0, adsr, 1);
          const native = mode.startsWith('native');
          if (mode.endsWith('-now')) {
            ctx.suspend(tReq).then(() => {
              tRel = ctx.currentTime; // quantised to the render quantum
              if (mode === 'naive-now') {
                env.gain.cancelScheduledValues(tRel);
                env.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, tRel + adsr.r);
              } else {
                releaseAt(env.gain, tRel, adsr.r, { native });
              }
              ctx.resume();
            });
          } else if (mode === 'naive') {
            env.gain.cancelScheduledValues(tRel);
            env.gain.setValueAtTime(adsr.s, tRel);
            env.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, tRel + adsr.r);
          } else {
            releaseAt(env.gain, tRel, adsr.r, { native });
          }
          src.connect(env).connect(dest);
          src.start(0);
        },
        { duration: 0.4, sampleRate: SR, channels: 1 },
      );
      schedule = getSchedule(gainParam);
      const d = buffer.getChannelData(0);
      const i0 = Math.round((tRel - 0.005) * SR);
      const i1 = Math.round((tRel + 0.005) * SR);
      let maxStep = 0;
      let maxExpectedStep = 0;
      for (let i = i0; i < i1; i++) {
        maxStep = Math.max(maxStep, Math.abs(d[i + 1] - d[i]));
        const e = Math.abs(valueAtTime(schedule, (i + 1) / SR) - valueAtTime(schedule, i / SR));
        maxExpectedStep = Math.max(maxExpectedStep, e);
      }
      let modelError = 0;
      for (let i = 0; i < d.length; i++) {
        modelError = Math.max(modelError, Math.abs(d[i] - valueAtTime(schedule, i / SR)));
      }
      let tail = 0;
      for (let i = Math.round((tRel + adsr.r + 0.01) * SR); i < d.length; i++)
        tail = Math.max(tail, Math.abs(d[i]));
      const iRel = Math.round(tRel * SR);
      cases.push({
        tReq,
        tRel,
        mode,
        maxStep,
        maxExpectedStep,
        modelError,
        tail,
        valueAtRelease: d[iRel],
        valueBeforeT0: d[Math.round(t0 * SR) - 10],
      });
    }
  }
  return { hasNative, hasSuspend, cases };
}

/** Stereo router: split / inverted / mono correlation from the rendered channels. */
async function stereoRouting() {
  const run = (cfg, invertB) =>
    render(
      (ctx, dest) => {
        const router = createStereoRouter(ctx, cfg);
        const a = ctx.createOscillator();
        const b = ctx.createOscillator();
        a.frequency.value = 500;
        b.frequency.value = cfg.freqB || 500;
        const inv = ctx.createGain();
        inv.gain.value = invertB ? -1 : 1;
        a.connect(router.inputA);
        b.connect(inv).connect(router.inputB);
        router.output.connect(dest);
        a.start(0);
        b.start(0);
      },
      { duration: 0.3, sampleRate: SR, channels: 2 },
    );
  const corr = (buf) =>
    pearson(buf.getChannelData(0).subarray(4800), buf.getChannelData(1).subarray(4800));
  const split = await run({ mode: 'split' }, false);
  const inverted = await run({ mode: 'split' }, true);
  const unrelated = await run({ mode: 'split', freqB: 733 }, false);
  const mono = await run({ mode: 'mono', panA: -1, panB: 1, freqB: 733 }, false);
  const hardLeft = await run({ mode: 'pan', panA: -1, panB: -1 }, false);
  return {
    split: corr(split),
    inverted: corr(inverted),
    unrelated: corr(unrelated),
    mono: corr(mono),
    splitLeftRms: rms(split.getChannelData(0), 4800),
    splitRightRms: rms(split.getChannelData(1), 4800),
    hardLeftRightRms: rms(hardLeft.getChannelData(1), 4800),
    hardLeft: corr(hardLeft),
  };
}

/** Noise source and additive oscillator builders in an offline render (track/source hooks). */
async function buildersSmoke() {
  const counts = { track: 0, source: 0 };
  const hooks = {
    track: (n) => {
      counts.track++;
      return n;
    },
    source: (n) => {
      counts.source++;
      return n;
    },
  };
  let coeffs = null;
  const buf = await render(
    (ctx, dest) => {
      const noise = createNoiseSource(ctx, { color: 'pink', seed: 5, level: 1, ...hooks });
      noise.output.connect(dest);
      noise.start(0);
      noise.stop(0.4);
      const add = createAdditiveOscillator(ctx, harmonicSeries('sawtooth', 8), {
        frequency: 220,
        ...hooks,
      });
      coeffs = add.coefficients.map((c) => c.gain);
      add.dispose();
    },
    { duration: 0.5, sampleRate: SR, channels: 1 },
  );
  const d = buf.getChannelData(0);
  return {
    counts,
    coeffs,
    noiseRms: rms(d, SR * 0.05, SR * 0.35),
    afterStopPeak: d.subarray(Math.round(SR * 0.43)).reduce((m, v) => Math.max(m, Math.abs(v)), 0),
  };
}

/** Spectrogram smoke: ring strategy, tone row bright, other rows at the floor colour. */
function spectrogramSmoke() {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 100;
  document.body.appendChild(canvas);
  const sg = createSpectrogram(canvas, {
    sampleRate: SR,
    fftSize: FFT,
    minDb: -120,
    maxDb: -20,
    timeSpanS: 2,
  });
  const spec = new Float32Array(FFT / 2).fill(-140);
  const k = Math.round(1000 / (SR / FFT));
  spec[k - 1] = -40;
  spec[k] = -25;
  spec[k + 1] = -40;
  for (let t = 0; t <= 400; t += 16) sg.frame(spec, t);
  const c2 = canvas.getContext('2d');
  const yTone = Math.round(sg.yForFrequency(1000) - 0.5);
  const toneRgb = Array.from(c2.getImageData(199, yTone, 1, 1).data);
  const farRgb = Array.from(c2.getImageData(199, 5, 1, 1).data);
  const oldRgb = Array.from(c2.getImageData(2, yTone, 1, 1).data); // not yet reached by history
  const lut = Array.from(sg.lut.slice(0, 4));
  return { strategy: sg.strategy, yTone, toneRgb, farRgb, oldRgb, floor: lut };
}

window.DSP_TESTS = {
  liveTonePeak,
  offlineTonePeak,
  filterResponse,
  wavRoundTrip,
  periodicWaveSquare,
  releaseClicks,
  stereoRouting,
  buildersSmoke,
  spectrogramSmoke,
};
window.DSP_READY = true;
