// V3 live RTA (src/js/measurement/live-rta.js) and its view/calibration hooks: the live
// spectrum uses the ONE band-level scale (spectrum.js 'mean-square', rta.js), so a sine reads
// 10·log10(A²/2) in its band exactly as welch() → bandPowers() reads the same signal; push()
// allocates nothing (§123); averaging, peak hold, freeze, calibration and the snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GCProfiler } from 'node:v8';
import {
  createLiveRta, LIVE_RTA_FFT_SIZE, LIVE_RTA_MODES,
} from '../../src/js/measurement/live-rta.js';
import { welch } from '../../src/js/measurement/spectrum.js';
import {
  bandCenters, bandPowers, createRtaAverager, RTA_TAU_FAST_S,
} from '../../src/js/measurement/rta.js';
import {
  applyFrequencyCorrectionToBands, correctionCurve,
} from '../../src/js/calibration/interpolate.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  createLevelCalibration, levelOffsetWithProfile, toDisplayLevel,
} from '../../src/js/calibration/level.js';
import { buildRtaView, LIVE_RTA_Y_RANGE } from '../../src/js/measurement/views/rta-chart.js';

const N = LIVE_RTA_FFT_SIZE;
const RATES = [44100, 48000, 96000];
const db = (p) => 10 * Math.log10(p);

/** n samples of Σ a·sin(2πft + φ) at sr. */
function tones(sr, n, parts) {
  const x = new Float32Array(n);
  for (const { f, a, phase = 0.3 } of parts) {
    for (let i = 0; i < n; i++) x[i] += a * Math.sin(2 * Math.PI * f * (i / sr) + phase);
  }
  return x;
}

const PROFILE = createFrequencyProfile({ name: 'Live test microphone',
  points: [[100, 0.5], [1000, 0], [4000, 1], [8000, 2]] });
const LEVEL = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30.5, conditions: 'synthetic', createdAt: '2026-10-03T09:00:00.000Z' });

test('live RTA: a sine reads 10·log10(A²/2) in its band (octave and third, three rates)', () => {
  for (const sr of RATES) {
    for (const mode of ['third', 'octave']) {
      const live = createLiveRta({ sampleRate: sr, mode, averaging: 'instant' });
      const bands = live.frame.bands;
      // Bands at least ~5 bins wide at every rate: a narrower band loses part of a tone's
      // Hann main lobe (±2 bins) to its neighbours (rta.js underResolved, "few bins").
      for (const nominal of [250, 1000, 4000]) {
        const b = bands.find((x) => x.nominal === nominal);
        for (const a of [1, 0.1]) {
          const f = live.push(tones(sr, N, [{ f: b.exact, a }]), 0.016);
          const i = bands.indexOf(b);
          const expect = db((a * a) / 2);
          assert.ok(Math.abs(f.values[i] - expect) < 0.01,
            `${sr} Hz ${mode} ${nominal} Hz A=${a}: ${f.values[i]} vs ${expect}`);
          const next = Math.max(...f.values.filter((v, j) => j !== i));
          assert.ok(f.values[i] - next >= 20,
            `${mode} ${nominal}: dominance ${f.values[i] - next}`);
        }
      }
    }
  }
});

test('live RTA: one frame agrees with welch() → bandPowers() on the same signal', () => {
  const sr = 48000;
  // A stationary two-tone + offset signal: Welch over many segments and one live frame of the
  // same signal see the same band power (a stationary periodic signal; tolerance 0.05 dB).
  const x = tones(sr, N * 4, [{ f: 997, a: 0.5 }, { f: 3150, a: 0.05, phase: 1.1 },
    { f: 210, a: 0.2, phase: 2 }]);
  const bands = bandCenters('third', 20, 20000, sr);
  const ref = bandPowers(welch(x, { fftSize: N, window: 'hann', scale: 'mean-square' }), sr / N,
    bands);
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant' });
  const f = live.push(x.subarray(N, 2 * N), 0.016);
  for (const nominal of [200, 1000, 3150]) {
    const i = bands.findIndex((b) => b.nominal === nominal);
    assert.ok(Math.abs(f.values[i] - ref[i]) < 0.05, `${nominal}: ${f.values[i]} vs ${ref[i]}`);
  }
  // Two equal tones in one octave band add their power: +3.01 dB over one of them.
  const oct = createLiveRta({ sampleRate: sr, mode: 'octave', averaging: 'instant' });
  const one = oct.push(tones(sr, N, [{ f: 900, a: 0.3 }]), 0).values.slice();
  const two = oct.push(tones(sr, N, [{ f: 900, a: 0.3 }, { f: 1200, a: 0.3, phase: 1 }]), 0)
    .values;
  const k = oct.frame.bands.findIndex((b) => b.nominal === 1000);
  assert.ok(Math.abs(two[k] - one[k] - 10 * Math.log10(2)) < 0.05, `${two[k] - one[k]}`);
});

test('live RTA FFT mode: mean-square bins; a bin-centred tone peaks 1.76 dB below its band', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'fft', averaging: 'instant' });
  const f0 = 171 * (sr / N); // bin-centred, near 1 kHz
  const fr = live.push(tones(sr, N, [{ f: f0, a: 1 }]), 0);
  let best = 0;
  for (let i = 1; i < fr.count; i++) if (fr.values[i] > fr.values[best]) best = i;
  assert.ok(Math.abs(fr.frequencies[best] - f0) < 1e-9);
  // Hann: the main lobe holds |X|² ratios 1/4, 1, 1/4 → the peak bin is 1/1.5 of the power.
  assert.ok(Math.abs(fr.values[best] - (db(0.5) - db(1.5))) < 1e-6, `${fr.values[best]}`);
  let sum = 0;
  for (let i = 0; i < fr.count; i++) sum += 10 ** (fr.values[i] / 10);
  assert.ok(Math.abs(db(sum) - db(0.5)) < 1e-3, 'Σ bins = mean square (Parseval)');
  assert.ok(fr.frequencies[0] >= 20 && fr.frequencies.at(-1) <= 0.95 * sr / 2);
  assert.equal(live.snapshot(), null, 'an FFT frame is not a band result');
});

test('live RTA averaging: FAST reaches 63.2 % of a power step after τ; instant follows', () => {
  const sr = 48000;
  const quiet = tones(sr, N, [{ f: 1000, a: 0.01 }]);
  const loud = tones(sr, N, [{ f: 1000, a: 0.1 }]);
  const fast = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'fast' });
  const i = fast.frame.bands.findIndex((b) => b.nominal === 1000);
  const p0 = 10 ** (fast.push(quiet, 0.016).values[i] / 10);
  const p1 = 10 ** (createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant' })
    .push(loud, 0).values[i] / 10);
  const after = 10 ** (fast.push(loud, RTA_TAU_FAST_S).values[i] / 10);
  assert.ok(Math.abs((after - p0) / (p1 - p0) - (1 - Math.exp(-1))) < 1e-9);
  // Peak hold holds the maximum; resetPeaks() lets it fall to the current level.
  const f = fast.push(quiet, 1);
  assert.ok(f.peaks[i] >= f.values[i] + 15);
  fast.resetPeaks();
  assert.equal(fast.frame.peaks[i], fast.frame.values[i]);
  assert.throws(() => fast.setAveraging('impulse'), TypeError);
  assert.throws(() => fast.setMode('sixth'), TypeError);
  assert.deepEqual(LIVE_RTA_MODES, ['fft', 'octave', 'third']);
});

test('live RTA: freeze keeps the frame and skips the analysis; mode change restarts', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'slow' });
  live.push(tones(sr, N, [{ f: 1000, a: 0.1 }]), 0.016);
  live.freeze();
  const held = live.frame.values.slice();
  const frames = live.frame.frames;
  live.push(tones(sr, N, [{ f: 250, a: 0.9 }]), 0.016);
  assert.deepEqual(Array.from(live.frame.values), Array.from(held));
  assert.equal(live.frame.frames, frames);
  assert.equal(live.frame.frozen, true);
  live.unfreeze();
  live.push(tones(sr, N, [{ f: 250, a: 0.9 }]), 0.016);
  assert.equal(live.frame.frames, frames + 1);
  live.freeze();
  live.setMode('octave');
  assert.equal(live.frozen, false, 'a new mode starts live');
  assert.equal(live.frame.frames, 0);
  assert.ok(live.frame.values.every((v) => v === -Infinity));
});

test('live RTA calibration: profile per band (spectrum-weighted), per bin, level offset', () => {
  const sr = 48000;
  const x = tones(sr, N, [{ f: 3500, a: 0.2 }, { f: 160, a: 0.05, phase: 1 }]);
  const raw = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant' });
  const cal = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant',
    profile: PROFILE, levelCalibration: LEVEL });
  const r = raw.push(x, 0).values.slice();
  const c = cal.push(x, 0);
  const bands = c.bands;
  // The same correction applyFrequencyCorrectionToBands gives for this frame's spectrum.
  const spectrum = welch(x, { fftSize: N, window: 'hann', scale: 'mean-square' });
  const ref = applyFrequencyCorrectionToBands({ bands, levelsDb: Float64Array.from(r) }, PROFILE,
    { power: spectrum, binHz: sr / N });
  for (let i = 0; i < bands.length; i++) {
    const expect = (ref.covered[i] ? ref.correctedDb[i] : r[i]) + LEVEL.offsetDb;
    if (Number.isFinite(expect)) assert.ok(Math.abs(c.values[i] - expect) < 1e-6, `${i}`);
    assert.equal(c.covered[i], ref.covered[i]);
  }
  assert.ok(c.covered.some((v) => v === 0) && c.covered.some((v) => v === 1));
  assert.deepEqual(c.calibrated, { frequency: true, level: true });
  // FFT mode: the per-bin correction of correctionCurve, observed − correction.
  cal.setMode('fft');
  raw.setMode('fft');
  const rf = raw.push(x, 0).values.slice();
  const cf = cal.push(x, 0);
  const cc = correctionCurve(PROFILE, cf.frequencies);
  for (const i of [10, 400, 2000]) {
    const corr = cc.covered[i] ? -cc.correctionDb[i] : 0;
    assert.ok(Math.abs(cf.values[i] - (rf[i] + corr + LEVEL.offsetDb)) < 1e-9);
  }
  // An invalid level calibration is ignored (no offset, no SPL).
  const bad = createLiveRta({ sampleRate: sr, levelCalibration: { ...LEVEL, offsetDb: 1 } });
  assert.equal(bad.frame.calibrated.level, false);
  assert.equal(bad.levelCalibration, null);
});

test('applyFrequencyCorrectionToBands({ out }) writes the same values in place', () => {
  const sr = 48000;
  const bands = bandCenters('third', 20, 20000, sr);
  const x = tones(sr, N, [{ f: 2000, a: 0.3 }]);
  const spectrum = welch(x, { fftSize: N, window: 'hann', scale: 'mean-square' });
  const levelsDb = bandPowers(spectrum, sr / N, bands);
  const a = applyFrequencyCorrectionToBands({ bands, levelsDb }, PROFILE,
    { power: spectrum, binHz: sr / N });
  const out = { correctedDb: new Float64Array(bands.length), correctionDb:
    new Float64Array(bands.length), covered: new Uint8Array(bands.length).fill(7) };
  const b = applyFrequencyCorrectionToBands({ bands, levelsDb }, PROFILE,
    { power: spectrum, binHz: sr / N, out });
  assert.equal(b, out);
  assert.deepEqual(Array.from(b.correctedDb), Array.from(a.correctedDb));
  assert.deepEqual(Array.from(b.correctionDb).map(String), Array.from(a.correctionDb).map(String));
  assert.deepEqual(Array.from(b.covered), Array.from(a.covered));
  assert.deepEqual(b.coverage, a.coverage);
  assert.equal(b.weighting, 'spectrum');
});

/**
 * Count typed-array constructions while fn runs: the global constructors are replaced by
 * counting subclasses (module code looks them up at call time; `from` and `of` construct
 * through `this`, so they are counted too) and restored afterwards.
 */
function countTypedArrays(fn) {
  const names = ['Float64Array', 'Float32Array', 'Uint8Array', 'Uint32Array', 'Int32Array'];
  const saved = names.map((n) => globalThis[n]);
  let count = 0;
  names.forEach((n, i) => {
    const Base = saved[i];
    globalThis[n] = class extends Base {
      constructor(...args) {
        super(...args);
        count++;
      }
    };
  });
  try {
    fn();
  } finally {
    names.forEach((n, i) => { globalThis[n] = saved[i]; });
  }
  return count;
}

test('live RTA push() allocates nothing: no typed array, no GC churn, same objects', () => {
  const sr = 48000;
  const x = tones(sr, N, [{ f: 1000, a: 0.1 }, { f: 63, a: 0.01 }]);
  // The counter itself works (a control that allocates is seen).
  assert.equal(countTypedArrays(() => Float64Array.from([1, 2])), 1);
  for (const mode of ['third', 'octave', 'fft']) {
    for (const calibrated of [false, true]) {
      const live = createLiveRta({ sampleRate: sr, mode, averaging: 'fast',
        profile: calibrated ? PROFILE : null, levelCalibration: calibrated ? LEVEL : null });
      const f = live.push(x, 0.016);
      const refs = [f, f.values, f.peaks, f.covered];
      for (let i = 0; i < 50; i++) live.push(x, 0.016); // warm up (JIT)
      const made = countTypedArrays(() => {
        for (let i = 0; i < 20; i++) live.push(x, 0.016);
      });
      assert.equal(made, 0, `${mode}${calibrated ? ' calibrated' : ''}: ${made} typed arrays`);
      const gc = new GCProfiler();
      gc.start();
      for (let i = 0; i < 3000; i++) {
        const r = live.push(x, 0.016);
        if (r !== refs[0] || r.values !== refs[1] || r.peaks !== refs[2]
          || r.covered !== refs[3]) assert.fail(`${mode}: push ${i} returned new objects`);
      }
      // Per-frame object churn shows as young-generation scavenges (one small object per bin
      // and frame gave 40 in 1500 frames before interpolate.js stopped destructuring in its
      // bin loop); an unrelated scavenge may still land in the window. Major GCs are not
      // counted: they follow the garbage of earlier tests, not of this loop. Bound: the churn
      // this guards against costs ~80 scavenges per 3000 frames, while unrelated scavenges from
      // the runner and machine load were measured at up to 9 (5 in CI-like load), so 24 keeps a
      // 3x margin on both sides. The exact guarantees are the two deterministic checks above.
      const events = gc.stop().statistics.filter((e) => e.gcType === 'Scavenge').length;
      assert.ok(events <= 24, `${mode}: ${events} scavenges during 3000 pushes`);
    }
  }
});

test('live RTA snapshot: an rtaResult of the raw band levels with algorithm IDs', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'fast',
    profile: PROFILE, levelCalibration: LEVEL });
  assert.equal(live.snapshot(), null, 'nothing analysed yet');
  live.push(tones(sr, N, [{ f: 1000, a: 0.1 }]), 0.016);
  const s = live.snapshot();
  assert.equal(s.algorithm, 'oscilla.rta.v2');
  assert.equal(s.windowAlgorithm, 'oscilla.window.hann.v1');
  assert.equal(s.resolution, 'third');
  assert.equal(s.fftSize, N);
  assert.equal(s.sampleRate, sr);
  const i = s.bands.findIndex((b) => b.nominal === 1000);
  assert.ok(Math.abs(s.levelsDb[i] - db(0.005)) < 0.01, 'raw levels (no calibration applied)');
  assert.ok(s.levelsDb.every((v) => v >= -300));
});

test('live RTA view: fixed axis, live badges, under-resolved bands, no SPL uncalibrated', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'fast' });
  live.push(tones(sr, N, [{ f: 1000, a: 0.1 }]), 0.016);
  const v = buildRtaView({ ...live.viewInput(), fixedRange: true });
  assert.deepEqual(v.axes.y.range, [...LIVE_RTA_Y_RANGE.bands]);
  assert.ok(v.badges.includes('LIVE') && v.badges.includes('UNCALIBRATED'));
  assert.ok(v.bars.filter((b) => b.underResolved).length > 0, 'low bands span < 2 bins');
  assert.match(v.summary, /^RTA, 1\/3 OCTAVE, 31 bands, FAST .*highest band 1 kHz at −23\.0 dB/);
  assert.doesNotMatch(JSON.stringify(v), /SPL/);
  live.setMode('fft');
  live.push(tones(sr, N, [{ f: 1000, a: 0.1 }]), 0.016);
  const fv = buildRtaView({ ...live.viewInput(), fixedRange: true });
  assert.equal(fv.mode, 'fft');
  assert.deepEqual(fv.axes.y.range, [...LIVE_RTA_Y_RANGE.fft]);
  assert.ok(fv.badges.includes('UNCALIBRATED (frequency)'));
  assert.match(fv.notes.join(' '), /mean-square power per bin/);
  assert.doesNotMatch(JSON.stringify(fv), /SPL/);
  // Calibrated: dB SPL, the axis shifted by the offset, the corrected peaks drawn.
  const cal = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'fast',
    profile: PROFILE, levelCalibration: LEVEL });
  cal.push(tones(sr, N, [{ f: 3000, a: 0.1 }]), 0.016);
  const cv = buildRtaView({ ...cal.viewInput(), peakDb: null, fixedRange: true });
  assert.equal(cv.axes.y.unit, 'dB SPL');
  assert.deepEqual(cv.axes.y.range, [-120 + 130, 0 + 130]);
  assert.ok(cv.badges.includes('CALIBRATED (frequency)'));
  const k = cv.bars.findIndex((b) => b.nominal === 3150);
  assert.ok(cv.bars[k].covered);
  assert.ok(Math.abs(cv.bars[k].value - cal.frame.values[k]) < 1e-9, 'the drawn live value');
  assert.ok(Math.abs(cv.bars[k].peak - cal.frame.peaks[k]) < 1e-9, 'the corrected peak');
  // The averager the live RTA uses is rta.js's (power averaging, documented constants).
  assert.equal(createRtaAverager({ mode: 'fast' }).tau, RTA_TAU_FAST_S);
});

test('RTA view: a stored snapshot is never badged LIVE; its averaging is stored', () => {
  const sr = 48000;
  const live = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant' });
  live.push(tones(sr, N, [{ f: 1000, a: 0.1 }]), 0);
  const { rta, binHz } = live.viewInput();
  const snap = buildRtaView({ rta, binHz, snapshotLabel: 'NOISE CHECK SNAPSHOT',
    averaging: { text: 'Welch average of the whole noise check' } });
  assert.ok(snap.badges.includes('NOISE CHECK SNAPSHOT'));
  assert.ok(!snap.badges.includes('LIVE'));
  assert.match(snap.summary, /Welch average of the whole noise check/);
  assert.doesNotMatch(snap.summary, /INSTANT/);
  assert.ok(snap.bars.some((b) => b.underResolved), 'binHz given: 20-50 Hz bands are hatched');
  assert.ok(buildRtaView({ rta }).badges.includes('SNAPSHOT'), 'default for stored data');
});

test('live RTA: expert FFT size and window keep the band scale; resolution follows', () => {
  const sr = 48000;
  let lastUnder = Infinity;
  for (const fftSize of [4096, 16384, 32768]) {
    for (const window of ['hann', 'blackman-harris']) {
      const live = createLiveRta({ sampleRate: sr, fftSize, window, mode: 'third',
        averaging: 'instant' });
      const f = live.push(tones(sr, fftSize, [{ f: 1000, a: 0.1 }]), 0);
      const i = f.bands.findIndex((b) => b.nominal === 1000);
      assert.ok(Math.abs(f.values[i] - db(0.005)) < 0.01, `${fftSize} ${window}: ${f.values[i]}`);
      assert.equal(live.binHz, sr / fftSize);
      assert.equal(live.snapshot().fftSize, fftSize);
      assert.equal(live.snapshot().windowAlgorithm, `oscilla.window.${window}.v1`);
      const fft = createLiveRta({ sampleRate: sr, fftSize, window, mode: 'fft',
        averaging: 'instant' });
      const v = buildRtaView(fft.viewInput());
      assert.match(v.notes[0], window === 'hann' ? /Hann window.*1\.8-3\.2 dB/
        : /Blackman-Harris window.*3\.0-3\.9 dB/);
    }
    // V382: under-resolved below underResolvedBins(window) (Hann 6): fewer as N grows, and at
    // 32768 points only the third-octave bands below 40 Hz (about 3 bins of 1.46 Hz)
    const frame = createLiveRta({ sampleRate: sr, fftSize, mode: 'third' }).frame;
    const under = frame.underResolved.filter(Boolean).length;
    assert.ok(under > 0 && under < lastUnder, `${fftSize}: ${under} under-resolved`);
    lastUnder = under;
    if (fftSize === 32768) {
      assert.ok(frame.bands.every((b, i) => frame.underResolved[i] === b.nominal < 40));
    }
  }
  assert.throws(() => createLiveRta({ sampleRate: sr, window: 'kaiser' }), RangeError);
});

test('V382: a 94 dB calibrator reads 94 dB SPL whether or not a profile corrects it', () => {
  const sr = 48000;
  const x = tones(sr, N, [{ f: 1000, a: 0.1 }]);
  const band = (rta) => rta.bands.findIndex((b) => b.lo <= 1000 && 1000 < b.hi);
  // X: the calibrator's uncorrected third-octave band level, as reference.js reads it
  const raw = createLiveRta({ sampleRate: sr, mode: 'third', averaging: 'instant' });
  const r = raw.push(x, 0);
  const level = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: r.values[band(r)], conditions: 'synthetic',
    createdAt: '2026-10-03T09:00:00.000Z' });
  const points = [[20, 2], [500, 2], [1000, 2], [20000, 2]];
  for (const convention of [null, 'deviation', 'correction']) {
    for (const mode of ['third', 'fft']) {
      const profile = convention
        ? createFrequencyProfile({ name: convention, points, convention }) : null;
      const cal = createLiveRta({ sampleRate: sr, mode, averaging: 'instant', profile,
        levelCalibration: level });
      const c = cal.push(x, 0);
      // FFT mode: the tone's bins summed back to its band power
      const read = mode === 'fft'
        ? 10 * Math.log10(c.values.reduce((s, v, i) => (Math.abs(c.frequencies[i] - 1000) < 30
          ? s + 10 ** (v / 10) : s), 0))
        : c.values[band(c)];
      assert.ok(Math.abs(read - 94) < (mode === 'fft' ? 0.02 : 1e-6),
        `${convention || 'no profile'} ${mode}: ${read.toFixed(3)} dB SPL`);
    }
  }
  // the offset helper itself, and a profile that does not reach the reference frequency
  const dev = createFrequencyProfile({ name: 'd', points, convention: 'deviation' });
  assert.equal(levelOffsetWithProfile(level, null), level.offsetDb);
  assert.ok(Math.abs(levelOffsetWithProfile(level, dev) - (level.offsetDb + 2)) < 1e-12);
  const high = createFrequencyProfile({ name: 'h', points: [[2000, 5], [8000, 5]] });
  assert.equal(levelOffsetWithProfile(level, high), level.offsetDb);
  assert.equal(levelOffsetWithProfile(null, dev), 0);
  assert.ok(Math.abs(toDisplayLevel(level.observedDbRelative - 2, level, { profile: dev }).value
    - 94) < 1e-9);
});


test('V382: FFT mode applies a profile in its own convention, as the band modes do', () => {
  const sr = 48000;
  const x = tones(sr, N, [{ f: 1000, a: 0.2 }]);
  const points = [[20, 6], [20000, 6]];
  const shift = (convention, mode) => {
    const raw = createLiveRta({ sampleRate: sr, mode, averaging: 'instant' });
    const cal = createLiveRta({ sampleRate: sr, mode, averaging: 'instant',
      profile: createFrequencyProfile({ name: convention, points, convention }) });
    const r = raw.push(x, 0);
    const c = cal.push(x, 0);
    const i = mode === 'fft'
      ? r.values.indexOf(Math.max(...r.values))
      : r.bands.findIndex((b) => b.lo <= 1000 && 1000 < b.hi);
    return c.values[i] - r.values[i];
  };
  for (const [convention, expect] of [['deviation', -6], ['correction', 6]]) {
    for (const mode of ['fft', 'third']) {
      assert.ok(Math.abs(shift(convention, mode) - expect) < 1e-6,
        `${convention} ${mode}: ${shift(convention, mode)} dB, expected ${expect}`);
    }
  }
});

test('V382: a band that is not flagged under-resolved reads a mid-band tone within 0.1 dB', () => {
  const a = 0.1;
  const expect = 10 * Math.log10((a * a) / 2);
  for (const sr of [44100, 48000]) {
    for (const window of ['hann', 'blackman-harris']) {
      const rta = createLiveRta({ sampleRate: sr, window, mode: 'third', averaging: 'instant' });
      const { bands, underResolved } = rta.frame;
      let worst = 0;
      bands.forEach((b, i) => {
        if (underResolved[i] || b.nominal > 2000) return;
        // across the central half of the band (in log frequency)
        for (const u of [0.25, 0.4, 0.5, 0.6, 0.75]) {
          const f = b.lo * (b.hi / b.lo) ** u;
          const r = rta.push(tones(sr, N, [{ f, a }]), 0);
          worst = Math.max(worst, Math.abs(r.values[i] - expect));
        }
      });
      assert.ok(worst < 0.1, `${sr} ${window}: worst ${worst.toFixed(3)} dB`);
      assert.ok(underResolved.some(Boolean), 'the lowest bands are flagged');
    }
  }
});

test('V383: the live view text shows the same SPL as the drawn frame under a profile', () => {
  const sr = 48000;
  const A = 0.1;
  const x = tones(sr, N, [{ f: 1000, a: A }]);
  const level = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: 10 * Math.log10((A * A) / 2), conditions: 'synthetic',
    createdAt: '2026-10-04T00:00:00.000Z' });
  const profile = createFrequencyProfile({ name: 'dev+2', points: [[500, 2], [1000, 2], [4000, 2]],
    convention: 'deviation' });
  for (const mode of ['third', 'fft']) {
    const live = createLiveRta({ sampleRate: sr, mode, averaging: 'instant', profile,
      levelCalibration: level });
    const f = live.push(x, 0);
    const v = buildRtaView({ ...live.viewInput(), fixedRange: true });
    if (mode === 'third') {
      const i = v.bars.findIndex((b) => b.nominal === 1000);
      assert.ok(Math.abs(f.values[i] - 94) < 1e-6, `drawn ${f.values[i]}`);
      assert.match(v.bars[i].text, /^94\.0 dB SPL/, v.bars[i].text);
      assert.match(v.summary, /1 kHz at 94\.0 dB SPL/, v.summary);
    } else {
      // FFT: the strongest bin reads the frame's value, drawn and in text alike
      const k = f.values.indexOf(Math.max(...f.values));
      assert.ok(v.summary.includes(`${f.values[k].toFixed(1)} dB SPL`), `${v.summary} / ${f.values[k]}`);
    }
  }
});
