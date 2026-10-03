// Measurement lifecycle as an explicit finite-state machine (spec §167-§168). The engine owns
// one machine per measurement; the UI renders `state` and never infers it from side effects.
//
// States: IDLE (nothing open) → PREFLIGHT (permissions, devices, sample rate, settings) →
// NOISE_CHECK (background noise floor) → READY (input open, waiting for the user) → ARMED
// (capture running, stimulus scheduled) → MEASURING (stimulus playing and captured) →
// ANALYZING (offline DSP on the captured PCM) → COMPLETE | INVALID | ABORTED | ERROR.
//
// Terminal states: COMPLETE (a result exists), INVALID (the run finished but its data fails
// the checks: clipping, dropouts, empty capture, noise too high), ABORTED (the user or the
// engine stopped it), ERROR (an exception or a platform failure). Every terminal state leads
// back to IDLE, and all but ERROR may start again at PREFLIGHT.
//
// Every edge is listed in TRANSITIONS; go() refuses anything else with an
// IllegalTransitionError, so a bug in the orchestration fails loudly instead of producing a
// result from a half-finished run. There are no self-loops.

export const MEASUREMENT_STATES = Object.freeze({
  IDLE: 'IDLE',
  PREFLIGHT: 'PREFLIGHT',
  NOISE_CHECK: 'NOISE_CHECK',
  READY: 'READY',
  ARMED: 'ARMED',
  MEASURING: 'MEASURING',
  ANALYZING: 'ANALYZING',
  COMPLETE: 'COMPLETE',
  INVALID: 'INVALID',
  ABORTED: 'ABORTED',
  ERROR: 'ERROR',
});

const S = MEASUREMENT_STATES;

/** States in which a measurement is in progress; abort() is allowed from each of them. */
export const ACTIVE_STATES = Object.freeze([
  S.PREFLIGHT,
  S.NOISE_CHECK,
  S.READY,
  S.ARMED,
  S.MEASURING,
  S.ANALYZING,
]);

/** States that end a measurement. */
export const TERMINAL_STATES = Object.freeze([S.COMPLETE, S.INVALID, S.ABORTED, S.ERROR]);

/**
 * Allowed edges, from → [to]. ABORTED and ERROR are reachable from every active state.
 *
 * IDLE        → PREFLIGHT    a measurement is requested
 * PREFLIGHT   → NOISE_CHECK  preflight passed, measure the background first
 *             → READY        preflight passed and the recipe skips the noise check
 *             → INVALID      the setup cannot measure (e.g. no input channel, rate mismatch)
 * NOISE_CHECK → READY        background level recorded
 *             → INVALID      background too high for the requested measurement
 * READY       → ARMED        user starts; capture begins, stimulus is scheduled
 *             → NOISE_CHECK  repeat the background measurement
 *             → PREFLIGHT    settings or device changed; validate again
 * ARMED       → MEASURING    the stimulus has started (audio-clock time reached)
 *             → READY        disarmed before the stimulus started
 * MEASURING   → ARMED        one repeat captured, arm the next one
 *             → ANALYZING    all repeats captured
 *             → INVALID      a capture failed its checks (clipping, dropout, empty)
 * ANALYZING   → COMPLETE     result and quality assessment produced
 *             → INVALID      the analysis rejects the data (e.g. no alignment peak)
 * COMPLETE    → IDLE | PREFLIGHT   close, or measure again
 * INVALID     → IDLE | PREFLIGHT
 * ABORTED     → IDLE | PREFLIGHT
 * ERROR       → IDLE         an error is acknowledged before anything starts again
 */
export const TRANSITIONS = Object.freeze({
  [S.IDLE]: Object.freeze([S.PREFLIGHT]),
  [S.PREFLIGHT]: Object.freeze([S.NOISE_CHECK, S.READY, S.INVALID, S.ABORTED, S.ERROR]),
  [S.NOISE_CHECK]: Object.freeze([S.READY, S.INVALID, S.ABORTED, S.ERROR]),
  [S.READY]: Object.freeze([S.ARMED, S.NOISE_CHECK, S.PREFLIGHT, S.ABORTED, S.ERROR]),
  [S.ARMED]: Object.freeze([S.MEASURING, S.READY, S.ABORTED, S.ERROR]),
  [S.MEASURING]: Object.freeze([S.ARMED, S.ANALYZING, S.INVALID, S.ABORTED, S.ERROR]),
  [S.ANALYZING]: Object.freeze([S.COMPLETE, S.INVALID, S.ABORTED, S.ERROR]),
  [S.COMPLETE]: Object.freeze([S.IDLE, S.PREFLIGHT]),
  [S.INVALID]: Object.freeze([S.IDLE, S.PREFLIGHT]),
  [S.ABORTED]: Object.freeze([S.IDLE, S.PREFLIGHT]),
  [S.ERROR]: Object.freeze([S.IDLE]),
});

/** History entries kept per machine; older ones are dropped so a long session stays bounded. */
export const HISTORY_LIMIT = 256;

/** Thrown by go() for an edge not in TRANSITIONS or an unknown state name. */
export class IllegalTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal measurement transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
    this.code = 'ILLEGAL_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

export function isActiveState(state) {
  return ACTIVE_STATES.includes(state);
}

export function isTerminalState(state) {
  return TERMINAL_STATES.includes(state);
}

/** True when `from → to` is an edge of the table. */
export function canTransition(from, to) {
  const next = TRANSITIONS[from];
  return !!next && next.includes(to);
}

function freezeInfo(info) {
  if (info == null) return null;
  return Object.freeze(typeof info === 'object' ? { ...info } : { value: info });
}

/**
 * createMeasurementMachine({ onChange }) → machine
 *   state            current state name
 *   can(to)          whether go(to) would succeed
 *   go(to, info)     take the edge or throw IllegalTransitionError; returns the entry
 *   abort(reason)    → ABORTED from any active state (returns the entry); outside an active
 *                    state it is a no-op returning null, so a second STOP press is harmless
 *   reset()          back to IDLE from anywhere and clear the history (a new measurement)
 *   history          copy of the recorded entries, oldest first
 * Entries are frozen { seq, from, to, info }; info is the caller's plain data (shallow copy),
 * so timestamps come from the caller (audio clock or wall clock), never from this module.
 * onChange(entry) is called after every change, including reset() when the state differs.
 */
export function createMeasurementMachine(options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  let state = S.IDLE;
  let seq = 0;
  let history = [];

  function record(from, to, info) {
    const entry = Object.freeze({ seq: ++seq, from, to, info: freezeInfo(info) });
    history.push(entry);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    state = to;
    if (onChange) onChange(entry);
    return entry;
  }

  return {
    get state() {
      return state;
    },
    get history() {
      return history.slice();
    },
    can(to) {
      return canTransition(state, to);
    },
    go(to, info) {
      if (!canTransition(state, to)) throw new IllegalTransitionError(state, to);
      return record(state, to, info);
    },
    abort(reason) {
      if (!isActiveState(state)) return null;
      return record(state, S.ABORTED, reason == null ? null : { reason });
    },
    reset() {
      const from = state;
      const entry = from === S.IDLE ? null : record(from, S.IDLE, { reason: 'reset' });
      history = [];
      return entry;
    },
  };
}
