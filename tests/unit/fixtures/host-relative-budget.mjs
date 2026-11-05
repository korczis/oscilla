// A budget relative to the host (E058): a piece of work is judged by its cost as a multiple of a
// fixed, product-free reference workload timed on the same machine, in the same process,
// interleaved with it, so a slower or busier host slows both and the multiple stays the code's.
// The clock is E029's, cpuMs (the main thread's own CPU time, tests/unit/fixtures/
// v31-large-studio.mjs), so the time the scheduler hands to other processes counts for neither.
// Each test that uses it derives its bound from measured multiples and documents the derivation
// beside the constant; no absolute time is a bound here.
import { performance } from 'node:perf_hooks';
import { cpuMs } from './v31-large-studio.mjs';

/** Runs of each of the work and the reference, interleaved, of which the fastest counts. */
export const RELATIVE_RUNS = 9;

/**
 * The reference: deterministic work in the cable renderer's shape and of no product code.
 * `count` items each place 9 points of a bowed segment (float arithmetic, Math.sin, toFixed),
 * join them into a path, and print an attribute map of the path into an escaped <path> string;
 * every 8th item also tests the segment against a row of 25 boxes (the geometry of clearLabels).
 * Returns a checksum so that nothing is elided.
 */
export function referenceStrings(count = 5000) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const a = { x: (i * 37) % 1900, y: (i * 53) % 1100 };
    const b = { x: (i * 71) % 1900 + 5, y: (i * 29) % 1100 };
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      pts.push(`${(u * a.x + t * b.x).toFixed(3)} `
        + `${(u * a.y + t * b.y + Math.sin(t * Math.PI) * 30).toFixed(3)}`);
    }
    const attrs = { 'data-ref': `r${i}`, d: `M ${pts.join(' L ')}`, stroke: `var(--c-${i % 6})`,
      'stroke-width': (6 + (i % 3) * 0.75).toFixed(2), title: `a "${i}" & b` };
    const s = `<path ${Object.entries(attrs).map(([k, v]) => `${k}="${String(v)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ')}/>`;
    sum += s.length;
    if (i % 8 === 0) {
      for (let r = 0; r < 25; r++) {
        const box = { x: r * 76, y: (r * 41) % 1100, width: 46, height: 12 };
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        if (box.x + box.width < lo || box.x > hi) continue;
        const t = Math.min(1, Math.max(0, (box.x + box.width / 2 - a.x) / ((b.x - a.x) || 1)));
        const y = a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * 30;
        if (y >= box.y && y <= box.y + box.height) sum += 1;
      }
    }
  }
  return sum;
}

/** A timed unit spans at least this many steps of the clock, so its rounding stays under 5 %. */
export const MIN_TICKS = 20;

/**
 * The smallest step `clock` is seen to take: on macOS process.threadCpuUsage moves in
 * microseconds, on a Linux kernel that accounts by tick in whole ticks (1 ms on lundra), which
 * alone would be a fifth of a short run.
 */
export function clockTick(clock = cpuMs, samples = 3) {
  let tick = Infinity;
  for (let s = 0; s < samples; s++) {
    const t0 = clock();
    let t1 = clock();
    while (t1 === t0) t1 = clock();
    tick = Math.min(tick, t1 - t0);
  }
  return tick;
}


/**
 * One item of referenceNumbers(): fills `xs` from the generator, takes its running sum, the dot
 * product of the sums against themselves reversed and its square root, and insertion-sorts
 * `ix`, filled from the seed; adds to `acc[0]` and returns the next seed. A function of its own,
 * called once an item, so that the engine optimises it within the first call of the reference
 * (as one loop body it ran at an unoptimised tier for some ten calls on lundra's node 24, a
 * third slower, then hitched while it was optimised).
 */
function numbersItem(xs, ix, acc, seed) {
  const n = xs.length;
  let s = seed;
  for (let k = 0; k < n; k++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    xs[k] = s / 4294967296;
  }
  let run = 0;
  for (let k = 0; k < n; k++) {
    run += xs[k];
    xs[k] = run;
  }
  let dot = 0;
  for (let k = 0; k < n; k++) dot += xs[k] * xs[n - 1 - k];
  for (let k = 0; k < ix.length; k++) ix[k] = (s >>> k) & 1023;
  for (let a = 1; a < ix.length; a++) {
    const v = ix[a];
    let b = a - 1;
    while (b >= 0 && ix[b] > v) {
      ix[b + 1] = ix[b];
      b--;
    }
    ix[b + 1] = v;
  }
  acc[0] += Math.sqrt(dot) + ix[8];
  return s;
}

/**
 * The control: a second reference of another character, which the calibration checks the first
 * against. `count` items of numbersItem over 64 doubles and 16 integers (a linear congruential
 * generator on Math.imul, a running sum, a dot product, a square root, an insertion sort):
 * integer and float arithmetic over typed arrays made once, with no string, no object and no
 * allocation in the loop, where referenceStrings() is strings, objects and garbage. Returns a
 * checksum.
 */
export function referenceNumbers(count = 45000) {
  const xs = new Float64Array(64);
  const ix = new Int32Array(16);
  const acc = new Float64Array(1);
  let seed = 0x2545f491;
  for (let i = 0; i < count; i++) seed = numbersItem(xs, ix, acc, seed);
  return acc[0];
}

// The calibration checks itself (E058, after the review of af and b0: "a starved host passes
// anything"). The multiple is only as good as its denominator: a reference slowed while the work
// is not (a host that starves the reference's units, or a reference that has changed) makes
// every work look cheap. A bound on the reference's own time would measure the host again, so
// the check is relative too: two references of different character, referenceStrings() and
// referenceNumbers(), are timed interleaved with the work, and on a healthy host their quotient
// (the fastest unit of each) is a constant of the two programs, whatever the host's speed;
// one slowed and not the other moves it. And each reference's units must agree with each
// other: its median unit over its fastest is its steadiness.
//
// Derivation: the calibration of each of the three cable budgets of ui-synth-cable.test.mjs (9
// units of each), in 10 runs of that file on the Apple M5 Pro of 18 cores, node 22, at its own
// load (13-21, the machine shared): quotient 0.864-1.053, steadiness at most 1.140; 10 runs
// under 8 spinning processes besides: 0.921-1.063, at most 1.135; 10 runs of the whole file and
// the whole unit suite in parallel (load to 34): 0.861-1.118, at most 1.192; lundra, x86_64 of
// 8 cores, node 24, load 2-3, three short runs (3 of the budgets, 2 of the file): 1.276-1.608,
// at most 1.264. QUOTIENT_MEASURED is [0.861, 1.608] rounded outward, STEADINESS_MEASURED 1.264
// rounded up. The band is that range widened by CALIBRATION_MARGIN on each side,
// [0.86 / 2, 1.61 x 2] = [0.43, 3.22]: room for a host whose engine weighs strings against
// arithmetic otherwise (lundra's already does by half again), never an absolute time. The
// steadiness limit is the margin times the largest measured, 2.54. A reference ten times
// slower or faster moves the quotient ten times, out of the band from any quotient measured,
// since the measured range spans 1.87 times and the band 7.5, under ten (8.6 > 3.22 and
// 0.161 < 0.43, by 2.7 times either way); a test checks that.
export const CALIBRATION_MARGIN = 2;
/** referenceStrings() over referenceNumbers(), [smallest, largest], as measured (see above). */
export const QUOTIENT_MEASURED = Object.freeze([0.86, 1.61]);
/** The quotient a trusted calibration holds. */
export const QUOTIENT_BAND = Object.freeze([QUOTIENT_MEASURED[0] / CALIBRATION_MARGIN,
  QUOTIENT_MEASURED[1] * CALIBRATION_MARGIN]);
/** The largest median unit over fastest unit measured of either reference (see above). */
export const STEADINESS_MEASURED = 1.27;
/** The steadiness a trusted reference holds. */
export const STEADINESS_LIMIT = STEADINESS_MEASURED * CALIBRATION_MARGIN;
/** An untrusted measurement is taken again up to three times, then the test fails. */
export const CALIBRATION_ATTEMPTS = 4;

/** The lower median over the smallest: how far a typical unit is from the fastest. */
function steadinessOf(units) {
  const sorted = [...units].sort((p, q) => p - q);
  return sorted[(sorted.length - 1) >> 1] / sorted[0];
}

/**
 * Why a calibration is not to be trusted: one line per failure, none when it holds. Pure.
 * @param {{ quotient: number, steadiness: { reference: number, control: number } }} cal
 */
export function calibrationFaults(cal, { band = QUOTIENT_BAND, limit = STEADINESS_LIMIT } = {}) {
  const faults = [];
  if (!(cal.quotient >= band[0] && cal.quotient <= band[1])) {
    faults.push(`the references' quotient ${cal.quotient.toFixed(3)} is outside`
      + ` [${band[0]}, ${band[1]}]`);
  }
  for (const which of ['reference', 'control']) {
    const s = cal.steadiness[which];
    if (!(s <= limit)) {
      faults.push(`the ${which}'s median unit is ${s.toFixed(3)} x its fastest (limit ${limit})`);
    }
  }
  return faults;
}

/**
 * One measurement: after a warm-up of each, the work, the reference and the control are each
 * timed in units of `k` calls, `k` the fewest that span MIN_TICKS steps of `clock`; `runs`
 * rounds of a work unit, a reference unit and a control unit, interleaved so that all three meet
 * the same load at the same moment; the fastest unit of each, per call. The fastest is the
 * code's cost, a busy host only lengthens the rest. The multiple is the work's over the
 * reference's, the calibration the reference's over the control's and each one's steadiness.
 */
export function measureRelative(work, { reference = () => referenceStrings(),
  control = () => referenceNumbers(), runs = RELATIVE_RUNS, clock = cpuMs,
  now = () => performance.now() } = {}) {
  const span = MIN_TICKS * clockTick(clock);
  const callsFor = (fn) => {
    const c0 = clock();
    fn(); // warm-up, and the size of a unit
    return Math.max(1, Math.ceil(span / Math.max(clock() - c0, Number.EPSILON)));
  };
  const calls = { work: callsFor(work), reference: callsFor(reference),
    control: callsFor(control) };
  const unit = (fn, k) => {
    const w0 = now();
    const c0 = clock();
    for (let i = 0; i < k; i++) fn();
    return [(clock() - c0) / k, (now() - w0) / k];
  };
  const units = { work: [], reference: [], control: [] };
  let wallMs = Infinity;
  for (let r = 0; r < runs; r++) {
    const [w, wall] = unit(work, calls.work);
    units.work.push(w);
    wallMs = Math.min(wallMs, wall);
    units.reference.push(unit(reference, calls.reference)[0]);
    units.control.push(unit(control, calls.control)[0]);
  }
  const [workMs, referenceMs, controlMs] = [units.work, units.reference, units.control]
    .map((u) => Math.min(...u));
  const steadiness = { reference: steadinessOf(units.reference),
    control: steadinessOf(units.control) };
  const calibration = { quotient: referenceMs / controlMs, steadiness };
  return { ratio: workMs / referenceMs, workMs, referenceMs, controlMs, wallMs, runs, calls,
    calibration };
}

/**
 * The work's cost as a multiple of the reference's (measureRelative), on a calibration that
 * checked itself: a measurement with calibrationFaults is taken again, up to
 * CALIBRATION_ATTEMPTS in all, and when none holds the call throws, naming the calibration as
 * unreliable, with the last measurement as `measurement` and its faults as `faults`. It never
 * returns a multiple measured against an untrusted reference.
 */
export function relativeCost(work, options = {}) {
  let m;
  let faults = [];
  for (let attempt = 1; attempt <= CALIBRATION_ATTEMPTS; attempt++) {
    m = measureRelative(work, options);
    faults = calibrationFaults(m.calibration);
    if (faults.length === 0) return { ...m, attempts: attempt };
  }
  const error = new Error(`the calibration is unreliable after ${CALIBRATION_ATTEMPTS} attempts:`
    + ` ${faults.join('; ')} (the reference ${m.referenceMs.toFixed(2)} ms CPU, the control`
    + ` ${m.controlMs.toFixed(2)} ms CPU); no multiple is judged against it`);
  error.measurement = { ...m, attempts: CALIBRATION_ATTEMPTS };
  error.faults = faults;
  throw error;
}

/**
 * `fn` made `factor` times as costly on `clock`: it runs, then spins until `factor` times its
 * own cost has passed. Applied to the work alone it is a seeded regression; applied to the work
 * and both references alike it is a slower host; applied to one reference, a starved one.
 */
export function slowed(fn, factor, { clock = cpuMs } = {}) {
  return (...args) => {
    const c0 = clock();
    const out = fn(...args);
    const until = c0 + (clock() - c0) * factor;
    while (clock() < until) { /* the slower host */ }
    return out;
  };
}

/** One line for t.diagnostic: the multiple against its bound, the calibration, then the times. */
export function relativeReport(name, m, bound) {
  const c = m.calibration;
  return `${name}: ${m.ratio.toFixed(3)} x the reference (bound ${bound} x), best of ${m.runs}`
    + ` units of ${m.calls.work}, ${m.calls.reference} and ${m.calls.control} calls`
    + `${m.attempts > 1 ? ` (attempt ${m.attempts})` : ''}; calibration quotient`
    + ` ${c.quotient.toFixed(3)}, steadiness ${c.steadiness.reference.toFixed(3)}`
    + ` ${c.steadiness.control.toFixed(3)}; a call ${m.workMs.toFixed(2)} ms CPU,`
    + ` ${m.wallMs.toFixed(2)} ms wall, the reference ${m.referenceMs.toFixed(2)} ms CPU,`
    + ` the control ${m.controlMs.toFixed(2)} ms CPU`;
}
