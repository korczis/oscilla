// Generator versus microphone comparison. Pure: takes the requested digital frequency and an
// observed peak (from peak-detector.js findPeak / estimateFrequency) and returns numbers and a
// quality flag. Nothing here is calibrated: the level is a relative analyser level and the
// microphone and speaker responses are unknown.

export const QUALITY = Object.freeze({
  UNAVAILABLE: 'unavailable', // no valid requested frequency
  OUT_OF_RANGE: 'out-of-range', // requested at or above the digital Nyquist limit
  NO_SIGNAL: 'no-signal', // no peak above the noise floor
  MATCH: 'match', // difference within the analyser resolution
  CLOSE: 'close', // within closeCents, but beyond the resolution
  HARMONIC: 'harmonic', // observed peak at an integer multiple of the request
  MISMATCH: 'mismatch', // something else dominates the band
});

export const QUALITY_LABELS = Object.freeze({
  unavailable: 'UNAVAILABLE',
  'out-of-range': 'Above the digital Nyquist limit',
  'no-signal': 'No peak above the noise floor',
  match: 'Within analyser resolution',
  close: 'Close, beyond analyser resolution',
  harmonic: 'Strongest peak is a harmonic',
  mismatch: 'Strongest peak differs from the request',
});

/** Interval from fRef to f in cents (1200·log2(f/fRef)); null for non-positive input. */
export function centsBetween(fRef, f) {
  if (!(fRef > 0) || !(f > 0)) return null;
  return 1200 * Math.log2(f / fRef);
}

/**
 * compareFrequencies({ requestedHz, observed, sampleRate, closeCents = 50, weakDbfs = −70,
 *                      maxHarmonic = 8 }) → comparison
 *
 * observed: { frequencyHz, uncertaintyHz, levelDb?, levelDbfs? } or null
 * comparison: { requestedHz, observedHz, diffHz, diffCents, uncertaintyHz, uncertaintyCents,
 *               levelDb, levelDbfs, withinResolution, weak, harmonic, quality, label,
 *               calibrated: false }
 * Fields without a source are null.
 */
export function compareFrequencies(input = {}) {
  const req = input.requestedHz;
  const obs = input.observed || null;
  const closeCents = input.closeCents != null ? input.closeCents : 50;
  const weakDbfs = input.weakDbfs != null ? input.weakDbfs : -70;
  const maxHarmonic = input.maxHarmonic || 8;
  const out = {
    requestedHz: req > 0 ? req : null,
    observedHz: null,
    diffHz: null,
    diffCents: null,
    uncertaintyHz: null,
    uncertaintyCents: null,
    levelDb: null,
    levelDbfs: null,
    withinResolution: null,
    weak: null,
    harmonic: null,
    quality: QUALITY.UNAVAILABLE,
    label: '',
    calibrated: false,
  };
  if (obs && obs.frequencyHz > 0) {
    out.observedHz = obs.frequencyHz;
    out.uncertaintyHz = obs.uncertaintyHz > 0 ? obs.uncertaintyHz : null;
    out.levelDb = Number.isFinite(obs.levelDb) ? obs.levelDb : null;
    out.levelDbfs = Number.isFinite(obs.levelDbfs) ? obs.levelDbfs : null;
    out.weak = out.levelDbfs != null ? out.levelDbfs < weakDbfs : null;
  }
  if (!(req > 0)) {
    out.label = QUALITY_LABELS[out.quality];
    return out;
  }
  const nyquist = input.sampleRate > 0 ? input.sampleRate / 2 : null;
  if (nyquist != null && req >= nyquist) {
    out.quality = QUALITY.OUT_OF_RANGE;
  } else if (out.observedHz == null) {
    out.quality = QUALITY.NO_SIGNAL;
  }
  if (out.observedHz != null) {
    out.diffHz = out.observedHz - req;
    out.diffCents = centsBetween(req, out.observedHz);
    if (out.uncertaintyHz != null) {
      out.uncertaintyCents = centsBetween(req, req + out.uncertaintyHz);
      out.withinResolution = Math.abs(out.diffHz) <= out.uncertaintyHz;
    }
    if (out.quality === QUALITY.UNAVAILABLE) {
      const tol = out.uncertaintyHz || 0;
      if (out.withinResolution) {
        out.quality = QUALITY.MATCH;
      } else if (Math.abs(out.diffCents) <= closeCents) {
        out.quality = QUALITY.CLOSE;
      } else {
        const n = Math.round(out.observedHz / req);
        if (
          n >= 2 &&
          n <= maxHarmonic &&
          Math.abs(out.observedHz - n * req) <= tol + 0.005 * n * req
        ) {
          out.quality = QUALITY.HARMONIC;
          out.harmonic = n;
        } else {
          out.quality = QUALITY.MISMATCH;
        }
      }
    }
  }
  out.label = QUALITY_LABELS[out.quality];
  return out;
}
