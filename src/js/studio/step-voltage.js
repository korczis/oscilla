// K226: where the step-voltage sequencer is, step by step. Pure: its parameters and a step index
// in, a step and the TRIGGER outputs that step fires out. The adapter (adapters/modulation.js)
// sets its three rows from it and the transport's fan-out (trigger-fanout.js) relays the steps
// it takes along the outputs it names, so both read one rule.
//
//   svsLength(params) -> 8 | 16
//   svsStep(params, k) -> the step (0-based) the k-th step taken since PLAY or the last reset
//                         plays, or null when a 'once' run has passed its last step
//   svsHeld(params, k) -> the step its rows hold at that index (a 'once' run holds its last)
//   svsRelayPorts(params, k) -> the TRIGGER outputs the k-th step fires: ['gate', 'trigN'], or
//                         [] once a 'once' run is over
//   svsOrder(params) -> one cycle of steps for the free-running rows (no clock cable)
//   svsRoleValue(role, v) -> what a row of that role carries for step value v
//   svsGateFraction(params, step) -> the fraction of the step period its Gate holds (a
//                         gateLength row's value as 0..1), or null when no row has that role
//
// A skipped step (params.skip[i] === 1) is passed over: the steps played are those within the
// length that are not skipped, in the playback's order; with none left nothing plays.

import { SVS_LENGTHS, SVS_MAX_STEPS, SVS_ROWS } from './nodes/modulation.js';

export function svsLength(params) {
  const n = Number(params && params.length);
  return SVS_LENGTHS.includes(String(n)) ? n : Number(SVS_LENGTHS[0]);
}

/** One back-and-forth cycle of `n` steps: 0 .. n-1 .. 1 (n = 1: just 0). */
const pingpong = (n) => (n > 1
  ? [...Array(n).keys(), ...Array.from({ length: n - 2 }, (_, i) => n - 2 - i)] : [0]);

/** The steps that play, in order: within the length and not skipped. */
function playable(params) {
  const skip = (params && params.skip) || [];
  return [...Array(svsLength(params)).keys()].filter((i) => skip[i] !== 1);
}

export function svsStep(params, k) {
  if (!Number.isInteger(k) || k < 0) return null;
  const steps = playable(params);
  const n = steps.length;
  if (!n) return null;
  const playback = params && params.playback;
  if (playback === 'once') return k < n ? steps[k] : null;
  if (playback === 'pingpong') {
    const cycle = pingpong(n);
    return steps[cycle[k % cycle.length]];
  }
  return steps[k % n];
}

export function svsHeld(params, k) {
  const step = svsStep(params, k);
  if (step !== null) return step;
  const steps = playable(params);
  return steps.length ? steps.at(-1) : 0;
}

export function svsRelayPorts(params, k) {
  const step = svsStep(params, k);
  return step === null ? [] : ['gate', `trig${step + 1}`];
}

export function svsOrder(params) {
  const steps = playable(params);
  if (!steps.length) return [0];
  return params && params.playback === 'pingpong' ? pingpong(steps.length).map((i) => steps[i])
    : steps;
}

export function svsRoleValue(role, v) {
  if (role === 'pitch') return Math.round(v * 12) / 12 || 0;
  if (role === 'octave') return Math.round(v) || 0;
  if (role === 'velocity' || role === 'gateLength') return (v + 1) / 2;
  return v;
}

/** Whether a role's output is 0..1 (unipolar) rather than -1..1. */
export const svsUnipolar = (role) => role === 'velocity' || role === 'gateLength';

export function svsGateFraction(params, step) {
  const row = SVS_ROWS.find(([, , r]) => params && params[`role${r}`] === 'gateLength');
  if (!row || step === null) return null;
  return svsRoleValue('gateLength', params[row[0]][step]);
}

export { SVS_MAX_STEPS };
