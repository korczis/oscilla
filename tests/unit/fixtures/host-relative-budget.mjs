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
 * The work's cost as a multiple of the reference's. After a warm-up of each, each is timed in
 * units of `k` calls, `k` the fewest that span MIN_TICKS steps of `clock`; `runs` rounds of a
 * work unit then a reference unit, interleaved so that both meet the same load at the same
 * moment; the fastest unit of each, per call, and the multiple is their quotient. The fastest
 * is the code's cost, a busy host only lengthens the rest. `wallMs` (the work's fastest unit
 * per call, on `now`), `workMs` and `referenceMs` are for the diagnostic only.
 * @returns {{ ratio: number, workMs: number, referenceMs: number, wallMs: number,
 *   runs: number, calls: { work: number, reference: number } }}
 */
export function relativeCost(work, { reference = () => referenceStrings(), runs = RELATIVE_RUNS,
  clock = cpuMs, now = () => performance.now() } = {}) {
  const span = MIN_TICKS * clockTick(clock);
  const callsFor = (fn) => {
    const c0 = clock();
    fn(); // warm-up, and the size of a unit
    return Math.max(1, Math.ceil(span / Math.max(clock() - c0, Number.EPSILON)));
  };
  const calls = { work: callsFor(work), reference: callsFor(reference) };
  const unit = (fn, k) => {
    const w0 = now();
    const c0 = clock();
    for (let i = 0; i < k; i++) fn();
    return [(clock() - c0) / k, (now() - w0) / k];
  };
  let workMs = Infinity;
  let referenceMs = Infinity;
  let wallMs = Infinity;
  for (let r = 0; r < runs; r++) {
    const [w, wall] = unit(work, calls.work);
    workMs = Math.min(workMs, w);
    wallMs = Math.min(wallMs, wall);
    referenceMs = Math.min(referenceMs, unit(reference, calls.reference)[0]);
  }
  return { ratio: workMs / referenceMs, workMs, referenceMs, wallMs, runs, calls };
}

/**
 * `fn` made `factor` times as costly on `clock`: it runs, then spins until `factor` times its
 * own cost has passed. Applied to the work alone it is a seeded regression; applied to the work
 * and the reference alike it is a slower host.
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

/** One line for t.diagnostic: the multiple against its bound, then the absolute times. */
export function relativeReport(name, m, bound) {
  return `${name}: ${m.ratio.toFixed(3)} x the reference (bound ${bound} x), best of ${m.runs}`
    + ` units of ${m.calls.work} and ${m.calls.reference} calls; a call ${m.workMs.toFixed(2)} ms`
    + ` CPU, ${m.wallMs.toFixed(2)} ms wall, the reference ${m.referenceMs.toFixed(2)} ms CPU`;
}
