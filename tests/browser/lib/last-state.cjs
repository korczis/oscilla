// A poll that keeps what it saw (C028): a wait over a page state returns the state that held,
// or, at the deadline, the last state it read, so a failure says what the page was doing
// (a slow return, focus left on <body>, a history entry not written) instead of only that the
// predicate did not hold.
//
//   const { untilState, describeState } = require('./lib/last-state.cjs');
//
//   const r = await untilState(() => H.state(page, 'learn'),
//     (s) => s.workspace === 'learn' && s.headingOf, { ms: 10000, what: 'Back opens Learn' });
//   if (!r.state) wrong.push(`Back did not return to Learn; ${describeState(r)}`);
//
// The wait itself is lib/wait.cjs until() with the same predicate and deadline (rule
// project.bounded-test-timing); only the reporting differs.
'use strict';

const { until } = require('./wait.cjs');

// The fields of a round-trip state a failure names: where the page is and where focus is.
const ROUND_TRIP_FIELDS = ['workspace', 'hash', 'focusTag', 'focusOsc', 'focusBody',
  'headingOf'];

/**
 * Poll `read()` until `pred(state)` holds. Resolves `{ state, last, error }`: `state` is the
 * state that held (null at the deadline or when reading failed), `last` the last state read
 * (null when none was), `error` what ended the wait without a state (null on success).
 */
async function untilState(read, pred, { ms, what } = {}) {
  let last = null;
  try {
    const state = await until(async () => {
      const s = await read();
      last = s;
      return pred(s) ? s : null;
    }, { ms, what });
    return { state, last: state, error: null };
  } catch (error) {
    if (error instanceof TypeError && /project\.bounded-test-timing/.test(error.message)) {
      throw error;
    }
    return { state: null, last, error };
  }
}

/** The named fields of the last state of `result`, for a failure message. */
function describeState(result, fields = ROUND_TRIP_FIELDS) {
  if (!result) return 'last state: no wait recorded';
  const s = result.last;
  if (!s || typeof s !== 'object') {
    const why = result.error ? result.error.message : 'nothing read';
    return `last state: none read (${why})`;
  }
  const seen = {};
  for (const f of fields) seen[f] = s[f] === undefined ? null : s[f];
  return `last state ${JSON.stringify(seen)}`;
}

module.exports = { untilState, describeState, ROUND_TRIP_FIELDS };
