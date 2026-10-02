// Safety rules: digital-limit checks and the continuous-playback / binaural permission rules.
// Extracted from V1 (index.html@a7b7a23, section 8 getters and methods). Wording unchanged
// (no-fake-science). Rules, as V1 enforces them:
//   - Open patterns (tone, siren, wobble, AM, FM, dual) stop at the hard safety limit
//     (SAFETY_LIMIT_OPTIONS, default 2 s) unless "Allow continuous playback" is on; the engine
//     applies it (AudioEngine.play o.continuous / o.limitS).
//   - The permission is never persisted and never restored from a link or preset.
//   - Latch requires the permission; revoking it stops a latched voice and turns a continuous
//     sweep repeat back into 'once'. A continuous repeat from a preset/link without the
//     permission becomes 'once' (config.js applyConfigTo).
//   - Binaural mode needs a headphone confirmation in this page view and a difference of
//     BINAURAL_MIN_DELTA_HZ … BINAURAL_MAX_DELTA_HZ, otherwise A/B become 440 / 446 Hz.

import { formatFrequency, formatMs } from './frequency.js';
import { presetMaxFrequency } from '../data/presets.js';

export const BINAURAL_MIN_DELTA_HZ = 0.5;
export const BINAURAL_MAX_DELTA_HZ = 30;
export const BINAURAL_DEFAULT_PAIR = Object.freeze({ a: 440, b: 446 });
export const DEFAULT_SAFETY_LIMIT_S = 2;

/** True when a preset needs more than this device's digital limit (95 % of Nyquist). */
export function presetDisabled(p, safeMax) {
  // V1: oscillaApp.presetDisabled (index.html@a7b7a23)
  return presetMaxFrequency(p.cfg) >= safeMax;
}

/** Why a preset is disabled. V1: oscillaApp.presetDisabledReason (index.html@a7b7a23) */
export function presetDisabledReason(p, safeMax, provisional) {
  return `Needs ${formatFrequency(presetMaxFrequency(p.cfg))}; this device's digital limit (95 % of Nyquist) is ${formatFrequency(safeMax)}${provisional ? ' (provisional until audio starts)' : ''}.`;
}

/** Whether a requested frequency is digitally representable. V1: getter representability. */
export function representability(f, nyquist, safeMax) {
  // V1: oscillaApp getter representability (index.html@a7b7a23), f computed by the caller
  if (f < safeMax) return `Requested ${formatFrequency(f)} is below the digital Nyquist limit (${formatFrequency(nyquist)}): digitally representable.`;
  if (f < nyquist) return `Requested ${formatFrequency(f)} is above the digital limit (95 % of Nyquist); it is clamped to ${formatFrequency(safeMax)}.`;
  return `Requested ${formatFrequency(f)} is at or above Nyquist (${formatFrequency(nyquist)}): not representable; clamped.`;
}

/**
 * The sweep repeat a user choice results in: { repeat, locked }. locked means V1 refused the
 * change (continuous without permission) and showed the "Continuous repeat is locked" notice.
 * V1: oscillaApp.setSweepRepeat (index.html@a7b7a23)
 */
export function sweepRepeatChoice(v, continuousAllowed, current) {
  if (v === 'continuous' && !continuousAllowed) return { repeat: current, locked: true };
  const repeat = ['once', 'n', 'continuous'].includes(v) ? v : 'once';
  return { repeat, locked: false };
}

/** Latch (play until stopped) needs the continuous permission. V1: oscillaApp.toggleLatch */
export function canLatch(continuousAllowed) {
  return !!continuousAllowed;
}

/** Trigger length of an open pattern in ms: the duration, capped by the safety limit. */
export function triggerMs(durationMs, safetyLimitS, continuousAllowed) {
  // V1: oscillaApp getters durationText / transportText (index.html@a7b7a23)
  return continuousAllowed ? durationMs : Math.min(durationMs, safetyLimitS * 1000);
}

/** The "trigger … · hold …" text of an open pattern. V1: getter durationText (open branch). */
export function openDurationText(durationMs, safetyLimitS, continuousAllowed) {
  return continuousAllowed ? `trigger ${formatMs(durationMs)} · hold unlimited`
    : `trigger ${formatMs(triggerMs(durationMs, safetyLimitS, false))} · hold ≤ ${safetyLimitS} s`;
}

/** Whether binaural confirmation must reset A/B to BINAURAL_DEFAULT_PAIR. */
export function binauralNeedsDefaultPair(delta) {
  // V1: oscillaApp.confirmHeadphones (index.html@a7b7a23)
  return delta < BINAURAL_MIN_DELTA_HZ || delta > BINAURAL_MAX_DELTA_HZ;
}

/** Stereo split with a 0–30 Hz difference but no binaural confirmation (V1 getter). */
export function stereoBinauralCondition(source, dual, delta) {
  // V1: oscillaApp getter stereoBinauralCondition (index.html@a7b7a23)
  return source === 'dual' && dual.stereo && !dual.binaural
    && delta > 0 && delta <= BINAURAL_MAX_DELTA_HZ;
}
