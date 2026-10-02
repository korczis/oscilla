import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpectrumAnalyzer,
  blackmanWindow,
  BLACKMAN_COHERENT_GAIN,
  createFft,
} from '../../src/js/analysis/fft.js';
import {
  findPeak,
  parabolicPeak,
  bandMedianDb,
  createPitchDetector,
  estimateFrequency,
  SINE_DBFS_CORRECTION_DB,
  displayStepHz,
} from '../../src/js/analysis/peak-detector.js';

const SR = 48000;
const N = 8192;
const BIN = SR / N;

function sine(f, amp = 1, len = N, phase = 0.3) {
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR + phase);
  return x;
}

const analyzer = createSpectrumAnalyzer(N);
const spectrumOf = (x) => analyzer.compute(x, 0, new Float32Array(N / 2));

test('fft: forward transform of a unit impulse is flat', () => {
  const fft = createFft(16);
  const re = new Float64Array(16);
  const im = new Float64Array(16);
  re[0] = 1;
  fft.forward(re, im);
  for (let k = 0; k < 16; k++) {
    assert.ok(Math.abs(re[k] - 1) < 1e-12);
    assert.ok(Math.abs(im[k]) < 1e-12);
  }
});

test('fft: Blackman window matches the Web Audio definition and coherent gain 0.42', () => {
  const w = blackmanWindow(1024);
  assert.ok(Math.abs(w[0] - (0.42 - 0.5 + 0.08)) < 1e-7);
  const mean = w.reduce((s, v) => s + v, 0) / w.length;
  assert.ok(Math.abs(mean - BLACKMAN_COHERENT_GAIN) < 1e-6);
});

test('fft: bin-centred full-scale sine reads 20·log10(0.21) dB = 0 dBFS corrected', () => {
  const s = spectrumOf(sine(64 * BIN));
  assert.ok(Math.abs(s[64] - 20 * Math.log10(0.21)) < 0.01, `got ${s[64]}`);
  assert.ok(Math.abs(s[64] + SINE_DBFS_CORRECTION_DB) < 0.01);
});

test('parabolicPeak: exact for a parabola, clamped, flat input', () => {
  // y = -(x - 0.3)^2 sampled at -1, 0, 1
  const f = (x) => -((x - 0.3) ** 2);
  const r = parabolicPeak(f(-1), f(0), f(1));
  assert.ok(Math.abs(r.offset - 0.3) < 1e-12);
  assert.ok(Math.abs(r.value) < 1e-12);
  assert.deepEqual(parabolicPeak(1, 1, 1), { offset: 0, value: 1 });
});

test('findPeak: dB interpolation error over fractional offsets (and better than linear)', () => {
  let worstDb = 0;
  let worstLin = 0;
  let worstLevelDb = 0;
  let worstLevelLin = 0;
  for (let off = 0; off <= 0.5001; off += 0.05) {
    const f = (300 + off) * BIN;
    const s = spectrumOf(sine(f, 0.5));
    const pDb = findPeak(s, { sampleRate: SR });
    const pLin = findPeak(s, { sampleRate: SR, interpolation: 'linear' });
    worstDb = Math.max(worstDb, Math.abs(pDb.frequencyHz - f) / BIN);
    worstLin = Math.max(worstLin, Math.abs(pLin.frequencyHz - f) / BIN);
    worstLevelDb = Math.max(worstLevelDb, Math.abs(pDb.levelDbfs - 20 * Math.log10(0.5)));
    worstLevelLin = Math.max(worstLevelLin, Math.abs(pLin.levelDbfs - 20 * Math.log10(0.5)));
  }
  // Reported for the status file / design justification.
  console.log(
    `# peak interpolation worst error: dB ${worstDb.toFixed(4)} bin, ` +
      `linear ${worstLin.toFixed(4)} bin;` +
      ` level dB ${worstLevelDb.toFixed(3)} dB, linear ${worstLevelLin.toFixed(3)} dB`,
  );
  assert.ok(worstDb < 0.05, `dB interpolation worst error ${worstDb} bin`);
  assert.ok(worstDb < worstLin, 'dB fit should beat linear fit for the Blackman window');
  assert.ok(worstLevelDb < 0.2, `level error ${worstLevelDb} dB`);
});

test('findPeak: 1 kHz tone within ±binHz/2, uncertainty and level reported', () => {
  const s = spectrumOf(sine(1000, 0.25));
  const p = findPeak(s, { sampleRate: SR });
  assert.ok(Math.abs(p.frequencyHz - 1000) <= BIN / 2);
  assert.equal(p.uncertaintyHz, BIN / 2);
  assert.equal(p.binHz, BIN);
  assert.ok(Math.abs(p.levelDbfs - 20 * Math.log10(0.25)) < 0.2);
  assert.equal(p.method, 'fft-parabolic-db');
});

test('findPeak: band limits, silence and noise-only return null', () => {
  const s = spectrumOf(sine(1000, 0.5));
  const outside = findPeak(s, { sampleRate: SR, minHz: 2000, maxHz: 4000 });
  // only the window's sidelobes reach this band: either nothing or a peak inside the band
  if (outside) assert.ok(outside.frequencyHz >= 2000);
  assert.equal(findPeak(new Float32Array(N / 2).fill(-Infinity), { sampleRate: SR }), null);
  assert.equal(findPeak(spectrumOf(new Float32Array(N)), { sampleRate: SR }), null);
  // white-ish noise: deterministic LCG, no tone → no peak 12 dB above the median? (can occur
  // by chance; raise the requirement to 25 dB which uniform noise never reaches)
  let seed = 1;
  const noise = new Float32Array(N).map(() => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 31 - 1;
  });
  assert.equal(findPeak(spectrumOf(noise), { sampleRate: SR, minSnrDb: 25 }), null);
  assert.equal(findPeak(s, { sampleRate: SR, minHz: 5000, maxHz: 4000 }), null);
  assert.equal(findPeak(null, { sampleRate: SR }), null);
});

test('findPeak: tone in noise is found; absolute floor rejects tiny peaks', () => {
  let seed = 7;
  const x = sine(5000, 0.1);
  for (let i = 0; i < N; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    x[i] += 0.01 * (seed / 2 ** 31 - 1);
  }
  const p = findPeak(spectrumOf(x), { sampleRate: SR });
  assert.ok(Math.abs(p.frequencyHz - 5000) <= BIN / 2);
  assert.ok(p.snrDb > 30);
  assert.equal(
    findPeak(spectrumOf(sine(5000, 1e-7)), { sampleRate: SR, absoluteFloorDb: -100 }),
    null,
  );
});

test('bandMedianDb: median, with -Infinity as lowest', () => {
  const a = Float32Array.from([-10, -20, -30, -Infinity, -40]);
  assert.equal(bandMedianDb(a, 0, 4), -30);
  assert.equal(bandMedianDb(Float32Array.from([-Infinity, -Infinity]), 0, 1), -Infinity);
});

test('autocorrelation pitch: 110 Hz and 440 Hz, confidence, silence → null', () => {
  const det = createPitchDetector({ sampleRate: SR, minHz: 40, maxHz: 1000 });
  for (const f of [110, 220.5, 440, 830]) {
    const r = det.detect(sine(f, 0.5));
    assert.ok(r, `no pitch for ${f}`);
    assert.ok(
      Math.abs(r.frequencyHz - f) <= r.uncertaintyHz,
      `${f}: got ${r.frequencyHz} ± ${r.uncertaintyHz}`,
    );
    assert.ok(r.confidence > 0.95);
  }
  assert.equal(det.detect(new Float32Array(N)), null);
  assert.equal(det.detect(new Float32Array(10)), null);
});

test('estimateFrequency: autocorrelation below 1 kHz only when it agrees and is finer', () => {
  const det = createPitchDetector({ sampleRate: SR });
  const x = sine(110, 0.5);
  const r = estimateFrequency({
    spectrumDb: spectrumOf(x),
    timeData: x,
    sampleRate: SR,
    pitchDetector: det,
  });
  assert.equal(r.method, 'autocorrelation');
  assert.ok(r.uncertaintyHz < BIN / 2);
  assert.ok(Math.abs(r.frequencyHz - 110) <= r.uncertaintyHz);
  const hi = sine(3000, 0.5);
  const r2 = estimateFrequency({
    spectrumDb: spectrumOf(hi),
    timeData: hi,
    sampleRate: SR,
    pitchDetector: det,
  });
  assert.equal(r2.method, 'fft-parabolic-db');
  assert.equal(
    estimateFrequency({ spectrumDb: spectrumOf(new Float32Array(N)), sampleRate: SR }),
    null,
  );
});

test('displayStepHz: no precision beyond the uncertainty', () => {
  assert.equal(displayStepHz(2.93), 1);
  assert.equal(displayStepHz(0.4), 0.1);
  assert.equal(displayStepHz(23), 10);
});
