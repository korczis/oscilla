// Live real-time analyser (RTA) of the input: FFT, octave and one-third-octave modes with
// averaging, peak hold, freeze and calibration (spec §44-§49, §122-§123; docs/v3/algorithms.md
// "Live RTA"). Pure: no DOM, no Web Audio, no clock. The browser side (src/js/ui/measure.js)
// reads time-domain frames from the input tap (capture.js openLiveTap → AnalyserNode →
// analysis/analyser.js reader) at display rate and pushes them here.
//
// Scaling — the ONE band-level scale of OSCILLA (spectrum.js 'mean-square', rta.js): each frame
// is the last fftSize samples (default 8192; an expert may choose 4096 … 32768), windowed
// (periodic Hann by default, or Blackman-Harris), transformed by
// createPowerSpectrumAnalyzer(…, { scale: 'mean-square' }), so Σ P[k] is the frame's mean
// square and a sine of amplitude A reads 10·log10(A²/2) in its band (full scale: −3.01 dB)
// whatever the window, exactly as welch() → bandPowers() reads a captured signal. The
// AnalyserNode's own dB values (Blackman window, smoothingTimeConstant, its own scaling) are
// never used.
//   FFT mode      the per-bin mean-square power (PSD × bin width). A tone spreads over the
//                 window's main lobe, so its peak bin reads below its band level: Hann 1.76 dB
//                 bin-centred (10·log10 1.5, the ENBW) to 3.19 dB half-way between bins;
//                 Blackman-Harris 3.02-3.85 dB (rta-chart.js FFT_PEAK_BIN_DEFICIT_DB).
//   OCTAVE, 1/3   rta.js integrateBands over bandCenters('octave' | 'third', 20, 20000, sr):
//                 power summed over each band's bins, never a sample at the centre; a band
//                 narrower than UNDER_RESOLVED_BINS bins is flagged underResolved.
//
// Time averaging: rta.js createRtaAverager of POWER per bin or band, instant / fast
// (τ = 125 ms) / slow (τ = 1 s), α = 1 − e^(−Δt/τ) with Δt the caller's wall-clock time between
// frames. Frames overlap (an 8192-sample window is ≈ 171 ms at 48 kHz, read ≈ 60 times a
// second), so even INSTANT spans one window; FAST and SLOW are the conventional names and
// constants, not an IEC 61672-1 detector (no IEC claim). Peak hold is the running maximum of
// the averaged level. freeze() keeps the frame and skips the analysis; mode, averaging and
// calibration changes restart the average and the peaks.
//
// Calibration (§18, §24, §158):
//   frequency profile, band modes: per frame, calibration/interpolate.js
//     applyFrequencyCorrectionToBands with that frame's spectrum as the in-band weighting
//     ('spectrum'), written in place; the corrected band POWER is averaged by its own averager
//     (averaging is linear, so this equals correcting the average). Bands the profile does not
//     cover show the raw level and are flagged uncovered; nothing is extrapolated.
//   frequency profile, FFT mode: interpolate.js correctionCurve at the bin centres, computed
//     once per profile (a bin's correction is constant), applied as observed − correction.
//   level calibration: only a VALID LevelCalibration (calibration/level.js) adds its offset, and
//     only then are the values dB SPL; otherwise they are "dB relative (dBFS-like)".
//
// Allocation (§123): every buffer is allocated at construction or on a mode, averaging or
// calibration change; push() allocates nothing and returns the same frame object and arrays.
//
// Live RTA is feedback: nothing here is stored. snapshot() turns the current averaged band
// levels into an rta.js rtaResult (raw levels, algorithm ID oscilla.rta.v1 and the window ID)
// for an explicit save; the frequency and level calibrations are applied downstream, as for
// every stored result.

import { createPowerSpectrumAnalyzer, windowAlgorithm, WINDOW_NAMES } from './spectrum.js';
import {
  bandCenters, bandBinCounts, integrateBands, powerToDb, createRtaAverager, rtaResult, RTA_MODES,
  RTA_ALGORITHM, NYQUIST_FRACTION,
} from './rta.js';
import {
  applyFrequencyCorrectionToBands, conventionSign, correctionCurve,
} from '../calibration/interpolate.js';
import { isValidLevelCalibration } from '../calibration/level.js';

/** Live RTA modes: per-bin FFT, octave bands, one-third-octave bands. */
export const LIVE_RTA_MODES = Object.freeze(['fft', 'octave', 'third']);
/** Frame length (samples): the V2 microphone analyser size (audio/microphone.js). */
export const LIVE_RTA_FFT_SIZE = 8192;
/** Default analysis window of the live frames (periodic Hann, spectrum.js). */
export const LIVE_RTA_WINDOW = 'hann';
/** Frame lengths an expert may choose (AnalyserNode allows 32 … 32768). */
export const LIVE_RTA_FFT_SIZES = Object.freeze([4096, 8192, 16384, 32768]);
/** Windows an expert may choose (spectrum.js WINDOW_NAMES). */
export const LIVE_RTA_WINDOWS = WINDOW_NAMES;
/** Nominal band / display range in Hz (bands are selected by their nominal label). */
export const LIVE_RTA_RANGE_HZ = Object.freeze([20, 20000]);

function checkMode(mode) {
  if (!LIVE_RTA_MODES.includes(mode))
    throw new TypeError(`live RTA mode must be ${LIVE_RTA_MODES.join(', ')}, got ${mode}`);
  return mode;
}

function checkAveraging(a) {
  if (!Object.hasOwn(RTA_MODES, a))
    throw new TypeError(`averaging must be instant, fast or slow, got ${a}`);
  return a;
}

/**
 * createLiveRta({ sampleRate, fftSize = LIVE_RTA_FFT_SIZE, window = LIVE_RTA_WINDOW,
 *   mode = 'third', averaging = 'fast', profile = null, levelCalibration = null }) → live
 *
 * live.push(samples, dtSeconds) → frame   samples: the last fftSize input samples (Float32Array
 *   or any array of fftSize numbers, read only); dtSeconds since the previous push.
 * frame (the same object on every push until the mode changes) = { mode, count, values,
 *   peaks, frequencies, bands, covered, underResolved, calibrated: { frequency, level },
 *   levelOffsetDb, frames, frozen }
 *   values / peaks  Float64Array(count): displayed level in dB (−Infinity: zero power), the
 *                   frequency correction and a valid level offset applied; peaks are the
 *                   held maxima of values
 *   frequencies     FFT mode: the bin centres shown (Float64Array, display range); else null
 *   bands           band modes: [{ nominal, exact, lo, hi }]; else null
 *   covered         Uint8Array(count) 1 where the frequency profile corrected the value, or null
 *   underResolved   band modes: boolean[] (fewer than 2 bins); else null
 * live.setMode(mode), live.setAveraging(averaging), live.setCalibration({ profile,
 *   levelCalibration }) restart the average and the peaks (and unfreeze); freeze(),
 *   unfreeze(), frozen;
 *   reset() (average and peaks), resetPeaks(); viewInput() → a buildRtaView input (copies);
 *   snapshot() → rtaResult (band modes) or null (FFT mode, or nothing analysed yet).
 */
export function createLiveRta({
  sampleRate, fftSize = LIVE_RTA_FFT_SIZE, window = LIVE_RTA_WINDOW, mode = 'third',
  averaging = 'fast', profile = null, levelCalibration = null,
} = {}) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate))
    throw new RangeError(`sample rate must be positive, got ${sampleRate}`);
  const analyzer = createPowerSpectrumAnalyzer(fftSize, window, { scale: 'mean-square' });
  const half = fftSize / 2;
  const bins = half + 1;
  const binHz = sampleRate / fftSize;
  const spectrum = new Float64Array(bins);
  const [fMin, fMax] = LIVE_RTA_RANGE_HZ;
  const fTop = Math.min(fMax, (NYQUIST_FRACTION * sampleRate) / 2);
  const kLo = Math.max(1, Math.ceil(fMin / binHz));
  const kHi = Math.min(half, Math.floor(fTop / binHz));
  const binFrequencies = new Float64Array(bins);
  for (let k = 0; k < bins; k++) binFrequencies[k] = k * binHz;
  const shownFrequencies = binFrequencies.subarray(kLo, kHi + 1);

  // Band layouts (both modes, once) and their per-band buffers.
  const layouts = {};
  for (const kind of ['octave', 'third']) {
    const bands = bandCenters(kind, fMin, fMax, sampleRate);
    const n = bands.length;
    const instDb = new Float64Array(n);
    const correction = { correctedDb: new Float64Array(n), correctionDb: new Float64Array(n),
      covered: new Uint8Array(n), coverage: [0, 0] };
    layouts[kind] = {
      bands,
      underResolved: bandBinCounts(binHz, bands, bins).underResolved,
      power: new Float64Array(n),
      instDb,
      corrPower: new Float64Array(n),
      correction,
      // The arguments of the per-frame correction, built once (push() allocates nothing).
      corrInput: { bands, levelsDb: instDb },
      corrOpts: { power: spectrum, binHz, out: correction },
    };
  }

  let curMode = checkMode(mode);
  let curAveraging = checkAveraging(averaging);
  let curProfile = null;
  let curLevel = null;
  let levelOffsetDb = 0;
  let fftCorrection = null; // { factor: Float64Array (display dB added per shown bin), covered }
  let frozen = false;
  let raw = null;  // averager of raw power (bins or bands)
  let corr = null; // averager of corrected band power (band modes with a profile)
  let rawRes = null; // the averagers' result objects (each returns the same one every push)
  let corrRes = null;
  let frame = null;

  function count() {
    return curMode === 'fft' ? shownFrequencies.length : layouts[curMode].bands.length;
  }

  function bandCovered(kind) {
    if (!curProfile) return null;
    const L = layouts[kind];
    // Coverage of a band depends on its edges only: one evaluation fixes it for the profile.
    applyFrequencyCorrectionToBands(L.corrInput, curProfile, { out: L.correction });
    return L.correction.covered;
  }

  // Every change restarts: fresh averagers and peaks, a new (unfrozen) frame.
  function rebuild() {
    frozen = false;
    const n = curMode === 'fft' ? bins : layouts[curMode].bands.length;
    raw = createRtaAverager({ mode: curAveraging, peakHold: true, size: n });
    corr = curMode !== 'fft' && curProfile
      ? createRtaAverager({ mode: curAveraging, peakHold: true, size: n }) : null;
    rawRes = null;
    corrRes = null;
    const c = count();
    let covered = null;
    if (curMode === 'fft') covered = fftCorrection ? fftCorrection.covered : null;
    else covered = bandCovered(curMode);
    frame = {
      mode: curMode,
      count: c,
      values: new Float64Array(c).fill(-Infinity),
      peaks: new Float64Array(c).fill(-Infinity),
      frequencies: curMode === 'fft' ? shownFrequencies : null,
      bands: curMode === 'fft' ? null : layouts[curMode].bands,
      covered,
      underResolved: curMode === 'fft' ? null : layouts[curMode].underResolved,
      calibrated: { frequency: !!curProfile, level: !!curLevel },
      levelOffsetDb,
      frames: 0,
      frozen,
    };
  }

  function setCalibration({ profile: p = null, levelCalibration: l = null } = {}) {
    curProfile = p || null;
    curLevel = isValidLevelCalibration(l) ? l : null;
    levelOffsetDb = curLevel ? curLevel.offsetDb : 0;
    fftCorrection = null;
    if (curProfile) {
      const cc = correctionCurve(curProfile, shownFrequencies);
      const sign = conventionSign(curProfile);
      const factor = new Float64Array(cc.correctionDb.length);
      for (let i = 0; i < factor.length; i++) {
        // the profile's own convention, as the band modes apply it (V382: a 'correction'
        // profile was subtracted here like a 'deviation' one)
        factor[i] = cc.covered[i] ? sign * cc.correctionDb[i] : 0;
      }
      fftCorrection = { factor, covered: cc.covered };
    }
    rebuild();
  }

  function writeFft(res) {
    const v = frame.values;
    const pk = frame.peaks;
    const f = fftCorrection ? fftCorrection.factor : null;
    for (let i = 0; i < v.length; i++) {
      const k = kLo + i;
      const add = levelOffsetDb + (f ? f[i] : 0);
      v[i] = res.levelsDb[k] + add; // −Infinity stays −Infinity
      pk[i] = res.peakDb[k] + add;
    }
  }

  function writeBands(covered) {
    const v = frame.values;
    const pk = frame.peaks;
    for (let i = 0; i < v.length; i++) {
      const src = corrRes && covered[i] ? corrRes : rawRes;
      v[i] = src.levelsDb[i] + levelOffsetDb;
      pk[i] = src.peakDb[i] + levelOffsetDb;
    }
  }

  function push(samples, dtSeconds) {
    if (!samples || samples.length !== fftSize)
      throw new RangeError(`push needs ${fftSize} samples, got ${samples && samples.length}`);
    if (frozen) return frame;
    const dt = dtSeconds >= 0 && Number.isFinite(dtSeconds) ? dtSeconds : 0;
    analyzer.compute(samples, 0, spectrum);
    if (curMode === 'fft') {
      rawRes = raw.push(spectrum, dt);
      writeFft(rawRes);
    } else {
      const L = layouts[curMode];
      integrateBands(spectrum, binHz, L.bands, L.power);
      rawRes = raw.push(L.power, dt);
      if (corr) {
        powerToDb(L.power, L.instDb);
        applyFrequencyCorrectionToBands(L.corrInput, curProfile, L.corrOpts);
        const cd = L.correction.correctionDb;
        const cov = L.correction.covered;
        for (let i = 0; i < L.power.length; i++) {
          L.corrPower[i] = cov[i] ? L.power[i] * 10 ** (cd[i] / 10) : L.power[i];
        }
        corrRes = corr.push(L.corrPower, dt);
      }
      writeBands(L.correction.covered);
    }
    frame.frames += 1;
    return frame;
  }

  function viewInput() {
    const averagingInput = { mode: curAveraging };
    if (curMode === 'fft') {
      const off = levelOffsetDb;
      return {
        fft: { frequencies: Float64Array.from(shownFrequencies),
          levelsDb: Float64Array.from(frame.values, (x) => x - off) },
        peakDb: Float64Array.from(frame.peaks, (x) => x - off),
        frequencyCovered: fftCorrection ? Uint8Array.from(fftCorrection.covered) : null,
        frozen, live: true, window, averaging: averagingInput, levelCalibration: curLevel,
      };
    }
    const L = layouts[curMode];
    const n = L.bands.length;
    const out = {
      rta: { resolution: curMode, bands: L.bands, levelsDb: rawRes
        ? Float64Array.from(rawRes.levelsDb) : new Float64Array(n).fill(-Infinity) },
      peakDb: rawRes ? Float64Array.from(rawRes.peakDb) : new Float64Array(n).fill(-Infinity),
      binHz,
      frozen,
      live: true,
      window,
      averaging: averagingInput,
      levelCalibration: curLevel,
      correction: null,
    };
    if (corr) {
      const off = levelOffsetDb;
      out.correction = {
        correctedDb: Float64Array.from(frame.values, (x) => x - off),
        peakDb: Float64Array.from(frame.peaks, (x) => x - off),
        covered: Uint8Array.from(L.correction.covered),
        profileId: L.correction.profileId,
      };
    }
    return out;
  }

  function snapshot() {
    if (curMode === 'fft' || !rawRes) return null;
    return rtaResult({ sampleRate, resolution: curMode, bands: layouts[curMode].bands,
      levelsDb: rawRes.levelsDb, fftSize, window });
  }

  setCalibration({ profile, levelCalibration });

  return {
    sampleRate,
    fftSize,
    binHz,
    window,
    windowAlgorithm: windowAlgorithm(window),
    algorithm: RTA_ALGORITHM,
    get mode() { return curMode; },
    get averaging() { return curAveraging; },
    get frozen() { return frozen; },
    get frame() { return frame; },
    get profile() { return curProfile; },
    get levelCalibration() { return curLevel; },
    push,
    setMode(m) {
      curMode = checkMode(m);
      rebuild();
    },
    setAveraging(a) {
      curAveraging = checkAveraging(a);
      rebuild();
    },
    setCalibration,
    freeze() {
      frozen = true;
      frame.frozen = true;
    },
    unfreeze() {
      frozen = false;
      frame.frozen = false;
    },
    reset() {
      rebuild();
    },
    resetPeaks() {
      raw.resetPeaks();
      if (corr) corr.resetPeaks();
      frame.peaks.set(frame.values);
    },
    viewInput,
    snapshot,
  };
}
