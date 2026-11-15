// The destination of a low- or high-pass Q automation lane (K232), split out of transport.js
// (its source-size cap): the lane is in Q and plays on the biquad's dB Q, the AudioParam its log
// cables drive; values, bounds and the log cables' constant part are in dB there (clip-targets.js
// laneMap), every segment a step or a linear ramp, so 'shift' is exact.
import { laneMap } from './clip-targets.js';
import { paramBounds } from './automation.js';
import { DB_PER_OCTAVE_Q } from '../audio/filters.js';
import { CENTS_PER_OCTAVE } from '../core/music.js';

/**
 * qLaneDest(def, params, handle, param, { sampleRate, centsOf }) -> the lane's destination
 * { param, handle, offset, bounds, mode: 'shift', scale: 1, map }, or null when `def` is not a
 * low- or high-pass Q (laneMap) or the handle has no log target for `param`. `centsOf()` is the
 * log cables' constant part in cents, read only when the destination exists.
 */
export function qLaneDest(def, params, handle, param, { sampleRate, centsOf }) {
  const map = laneMap(def, params);
  if (!map) return null;
  let q = null;
  try { q = handle.modTarget(param, 'log'); } catch (e) { q = null; }
  if (!q || !q.param) return null;
  const pb = paramBounds(def, sampleRate);
  return { param: q.param, handle, offset: (centsOf() / CENTS_PER_OCTAVE) * DB_PER_OCTAVE_Q,
    bounds: { min: map(pb.min), max: map(pb.max) }, mode: 'shift', scale: 1, map };
}
