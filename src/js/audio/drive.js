// Drive stage (K012): soft saturation by a tanh curve on a WaveShaperNode with 4x oversampling.
//
//   input (drive gain) ─ shaper (tanh curve, oversample '4x') ─ output (trim ≤ 1)
//
// The curve maps x in [−1, 1] to DRIVE_HEADROOM · tanh(DRIVE_SPAN · x), and the drive gain in
// front of it is driveGain(drive) / DRIVE_SPAN, so a signal s comes out as
// DRIVE_HEADROOM · tanh(driveGain(drive) · s) for |driveGain · s| ≤ DRIVE_SPAN and at the
// curve's end value beyond it. tanh is odd (no DC) and below 1 in magnitude. Drive 0 is a
// small-signal gain of DRIVE_HEADROOM (still tanh of the input); drive 1 adds DRIVE_MAX_DB.
// 4x oversampling (the browser's own) keeps the curve's harmonics of high notes from folding
// back below Nyquist as strongly as without it; it does not remove aliasing entirely. Its
// resampling filter overshoots a hard-saturated edge (Gibbs: up to about 18 % of the curve's
// peak for an ideal band limit; 17 % measured on a 110 Hz sawtooth at drive 100 % in Chromium,
// Firefox and WebKit), which is what DRIVE_HEADROOM (0.8, −1.9 dB) is for: with the trim held
// at 1 or less the stage's output peak stays below trim × 0.8 × 1.18 < trim, so behind a Master
// level at or below the engine's ceiling the Drive alone never reaches that ceiling.
// Drive changes glide (τ GLIDE_TAU_S) on the drive gain; the curve itself never changes.

/** Input span of the curve: x in [−1, 1] is tanh(DRIVE_SPAN · x). */
export const DRIVE_SPAN = 8;
/** Gain the drive adds at 100 %, in dB. */
export const DRIVE_MAX_DB = 36;
/** Scale of the curve: room for the 4x resampling filter's overshoot (see the header). */
export const DRIVE_HEADROOM = 0.8;
/** Points of the curve (odd, so that 0 maps to exactly 0). */
export const DRIVE_CURVE_SIZE = 4097;

const GLIDE_TAU_S = 0.015;
const identity = (node) => node;
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** The small-signal gain of drive 0..1: 10^(drive · DRIVE_MAX_DB / 20). */
export function driveGain(drive) {
  return 10 ** ((clamp01(drive) * DRIVE_MAX_DB) / 20);
}

/** The shaper curve: DRIVE_HEADROOM · tanh(span · x), x evenly spaced on [−1, 1]. */
export function driveCurve(size = DRIVE_CURVE_SIZE, span = DRIVE_SPAN) {
  const out = new Float32Array(size);
  const mid = (size - 1) / 2;
  for (let i = 0; i < size; i++) out[i] = DRIVE_HEADROOM * Math.tanh((span * (i - mid)) / mid);
  return out;
}

/**
 * createDriveStage(ctx, { drive = 0.5, trim = 0.5 }, { track }) →
 *   { input, shaper, output, update({ drive, trim }), dispose(), config }
 * track(node) is called for every node created (engine accounting; default identity).
 */
export function createDriveStage(ctx, cfg = {}, { track = identity } = {}) {
  let c = { drive: 0.5, trim: 0.5 };
  const norm = (next) => ({ drive: clamp01(next.drive), trim: clamp01(next.trim) });
  c = norm({ ...c, ...cfg });
  const input = track(ctx.createGain());
  const shaper = track(ctx.createWaveShaper());
  const output = track(ctx.createGain());
  shaper.curve = driveCurve();
  shaper.oversample = '4x';
  const t0 = ctx.currentTime;
  input.gain.setValueAtTime(driveGain(c.drive) / DRIVE_SPAN, t0);
  output.gain.setValueAtTime(c.trim, t0);
  input.connect(shaper);
  shaper.connect(output);
  let disposed = false;
  return {
    input,
    shaper,
    output,
    update(next = {}) {
      if (disposed) return { ...c };
      const prev = c;
      c = norm({ ...c, ...next });
      const t = ctx.currentTime;
      if (c.drive !== prev.drive) {
        input.gain.setTargetAtTime(driveGain(c.drive) / DRIVE_SPAN, t, GLIDE_TAU_S);
      }
      if (c.trim !== prev.trim) output.gain.setTargetAtTime(c.trim, t, GLIDE_TAU_S);
      return { ...c };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const n of [input, shaper, output]) {
        try {
          n.disconnect();
        } catch (e) {
          /* already disconnected */
        }
      }
    },
    get config() {
      return { ...c };
    },
  };
}
