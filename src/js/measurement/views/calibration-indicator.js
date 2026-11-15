// T036 (304 R1): the guided MEASURE header's Frequency indicator states what the frequency
// profile covers of the measurement, never CALIBRATED without coverage (project.no-fake-science).
// It follows the charts' rule (calibration/interpolate.js correctionCurve: a point is corrected
// only inside [first, last] profile point, no extrapolation): against the completed result's
// frequency grid when there is one, else against the requested sweep span [f1, f2]. Pure.
//
//   frequencyIndicator({ profile, inUse, frequencies?, span? })
//     -> { state, text, title, on }
//   state  'off'      no profile in use                    text UNCALIBRATED
//          'none'     the profile covers nothing measured   text UNCALIBRATED (mimo pásmo)
//          'partial'  it covers part of it                  text CALIBRATED jen <from>–<to>
//          'full'     it covers all of it                   text CALIBRATED <from>–<to>
//          'unknown'  in use, nothing measured or requested text UNKNOWN
//   on     true only for 'full' (the header's is-on look)

import { coverage, correctionCurve } from '../../calibration/interpolate.js';
import { formatFrequencyCompact as hz } from '../../core/frequency.js';
import { QUANTITY_KINDS, UNAVAILABLE } from './common.js';

const CAL = QUANTITY_KINDS.CALIBRATED;
const UNCAL = UNAVAILABLE.UNCALIBRATED;

/** "1 kHz–16 kHz"; one frequency (a one-point profile, one covered grid point) as itself. */
const range = (a, b) => (a === b ? hz(a) : `${hz(a)}–${hz(b)}`);

/** The covered stretch of a measured grid: { count, n, from, to } (from/to null when none). */
function gridCoverage(profile, frequencies) {
  const { covered } = correctionCurve(profile, frequencies);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) continue;
    count++;
    if (first < 0) first = i;
    last = i;
  }
  return { count, n: covered.length, from: first < 0 ? null : frequencies[first],
    to: last < 0 ? null : frequencies[last] };
}

/** The covered stretch of a requested span: a stretch of no width corrects nothing. */
function spanCoverage(cov, [f1, f2]) {
  const from = Math.max(cov[0], f1);
  const to = Math.min(cov[1], f2);
  if (!(to > from)) return { full: false, from: null, to: null };
  return { full: cov[0] <= f1 && cov[1] >= f2, from, to };
}

export function frequencyIndicator({ profile, inUse, frequencies = null, span = null } = {}) {
  if (!inUse || !profile) {
    return { state: 'off', text: UNCAL, on: false,
      title: 'Frekvenční profil není použit: hodnoty jsou nekalibrované.' };
  }
  const cov = coverage(profile);
  const named = `Profil „${profile.name}“ pokrývá ${range(cov[0], cov[1])} (bez extrapolace)`;
  const grid = frequencies && frequencies.length > 0;
  const validSpan = Array.isArray(span) && span.every(Number.isFinite) && span[1] > span[0];
  if (!grid && !validSpan) {
    return { state: 'unknown', text: UNAVAILABLE.UNKNOWN, on: false,
      title: `${named}; měřené pásmo zatím není známo.` };
  }
  let state;
  let from;
  let to;
  let measured;
  if (grid) {
    const g = gridCoverage(profile, frequencies);
    state = g.count === 0 ? 'none' : g.count === g.n ? 'full' : 'partial';
    ({ from, to } = g);
    measured = `změřeno ${range(frequencies[0], frequencies[frequencies.length - 1])}, `
      + `korigováno ${g.count} z ${g.n} bodů`;
  } else {
    const s = spanCoverage(cov, span);
    state = s.from === null ? 'none' : s.full ? 'full' : 'partial';
    ({ from, to } = s);
    measured = `nastavené pásmo ${range(span[0], span[1])}`;
  }
  const text = state === 'none' ? `${UNCAL} (mimo pásmo)`
    : state === 'full' ? `${CAL} ${range(from, to)}` : `${CAL} jen ${range(from, to)}`;
  return { state, text, on: state === 'full', title: `${named}; ${measured}.` };
}
