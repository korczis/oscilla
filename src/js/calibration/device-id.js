// Input device identifiers in stored and exported records (spec §88). Pure.
//
// A MediaTrackSettings.deviceId is a per-origin identifier that lets a page re-open exactly
// that microphone. OSCILLA needs it only to tell whether two records were taken with the SAME
// input (a level calibration against the current input, two experiments in a comparison), so it
// never stores or exports the raw value: hashDeviceId() replaces it by
//   'sha256:' + the first 32 hex digits of SHA-256('oscilla.device-id:' + deviceId)
// (128 bits: equal inputs stay equal, the raw identifier cannot be recovered or replayed into
// getUserMedia). An already hashed value is returned unchanged, so hashing is idempotent and a
// record can be sanitized again without changing.

import { sha256Hex } from './sha256.js';

export const DEVICE_ID_PREFIX = 'sha256:';
const HASHED_RE = /^sha256:[0-9a-f]{32}$/;

/** True for a value produced by hashDeviceId(). */
export function isHashedDeviceId(v) {
  return typeof v === 'string' && HASHED_RE.test(v);
}

/** The stored form of a deviceId: null for none, the hash for anything else (idempotent). */
export function hashDeviceId(id) {
  if (id === null || id === undefined || id === '') return null;
  if (typeof id !== 'string') throw new TypeError('deviceId must be a string or null');
  if (isHashedDeviceId(id)) return id;
  return `${DEVICE_ID_PREFIX}${sha256Hex(`oscilla.device-id:${id}`).slice(0, 32)}`;
}
