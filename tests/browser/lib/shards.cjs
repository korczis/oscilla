#!/usr/bin/env node
// The CI legs of the browser gate: every browser suite `npm run test:release` runs (the visual
// gate apart, which has its own container job), split per browser over LEGS[browser] runners.
//
//   OSC_BROWSERS=webkit OSC_LEG=2 node tests/browser/lib/shards.cjs        run leg 2 of webkit
//   OSC_BROWSERS=webkit node tests/browser/lib/shards.cjs --plan          print every leg
//
// Nothing here is a hand-written list of suites. The suites are read from package.json:
// test:release names npm scripts, and each of those names its suites (tests/browser/*.cjs), in
// order; a suite added to any of them is in a leg on the next run. A suite named in PARTS is
// split into that many processes, each given `--part <i>/<n>` (the suite deals its checks over
// the parts, lib/shards.cjs dealt()). The units are dealt over the legs by their measured
// seconds (tests/browser/shard-weights.json): every leg within LEG_BUDGET_S one by one where a
// plan can be, then the slowest leg's sharing estimate as short as possible (deal(): for two
// legs every partition is searched, else the longest-first deal is improved by moves and swaps;
// deterministic, so the plan is the same on every runner). A unit without a weight gets its
// browser's median. tests/unit/browser-shards.test.mjs holds the plan to: every unit
// of every browser in exactly one leg, the legs ci.yml declares equal to LEGS, and the slowest
// leg within LEG_BUDGET_S by the weights.
//
// Each suite declares its pace in a header line, `// suite-pace: solo (<reason>)` or
// `// suite-pace: shared (<reason>)`: a suite that judges the realtime output or the audio clock
// against a deadline runs alone on its runner, the rest OSC_SUITE_JOBS at a time
// (tests/unit/browser-shards.test.mjs holds every release suite to one declaration). A suite
// without one is solo. The dealing weighs a shared suite at its seconds / SHARED_SPEEDUP.
//
// Each leg runs its units through lib/run-suites.cjs (every unit runs, whatever the one before
// returned; its shared units OSC_SUITE_JOBS at a time, then its solo units one by one,
// OSC_SUITE_MS each), with OSC_BROWSERS as given.
//
// Exit: what run-suites returns; 2 when OSC_BROWSERS is not exactly one known browser or OSC_LEG
// is not a leg of it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runUnits } = require('./run-suites.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BROWSERS = Object.freeze(['chromium', 'firefox', 'webkit']);
/** How many CI runners (ci.yml jobs leg-1 .. leg-N, matrix browser) each browser's suites take. */
const LEGS = Object.freeze({ chromium: 2, firefox: 2, webkit: 2 });
/** Suites dealt over several processes with `--part <i>/<n>`; each must accept the flag. */
const PARTS = Object.freeze({ 'tests/browser/control-census.cjs': 2 });
/** The release gate's npm script whose browser suites the legs run. */
const RELEASE_SCRIPT = 'test:release';
/** The one browser suite that runs in its own container job, not in a leg. */
const OWN_JOB = new Set(['test:visual']);
/** The slowest leg's suites, by the weights, may take at most this many seconds one by one. */
const LEG_BUDGET_S = 55 * 60;
/**
 * What running shared suites OSC_SUITE_JOBS (2) at a time is assumed to gain, for the dealing
 * only: an estimate until CI measures it, never a bound.
 */
const SHARED_SPEEDUP = 1.5;
const PACE = /^\/\/ suite-pace: (solo|shared) \((.+)\)$/m;

/** A suite's declared pace: { pace, reason }, or null when it declares none. */
function paceOf(text) {
  const m = PACE.exec(String(text));
  return m ? { pace: m[1], reason: m[2] } : null;
}

/** Whether `file` (repository-relative) runs alone: declared solo, or declaring nothing. */
function soloOf(file, root = ROOT) {
  const full = path.resolve(root, file);
  if (!fs.existsSync(full)) return true;
  const p = paceOf(fs.readFileSync(full, 'utf8'));
  return !p || p.pace === 'solo';
}

/** The browser suites of the release gate, in the order its scripts name them. */
function releaseSuites(pkg) {
  const scripts = pkg.scripts || {};
  const release = scripts[RELEASE_SCRIPT];
  if (typeof release !== 'string') throw new Error(`package.json has no ${RELEASE_SCRIPT}`);
  const out = [];
  for (const m of release.matchAll(/\bnpm run ([\w:.-]+)/g)) {
    const name = m[1];
    if (OWN_JOB.has(name)) continue;
    if (typeof scripts[name] !== 'string') throw new Error(`${RELEASE_SCRIPT} runs ${name}, no script`);
    for (const s of scripts[name].matchAll(/\btests\/browser\/[\w.-]+\.cjs\b/g)) {
      if (s[0] === 'tests/browser/lib/run-suites.cjs') continue;
      if (!out.includes(s[0])) out.push(s[0]);
    }
  }
  return out;
}

/** The units of a release: one per suite, PARTS[suite] for a split one. */
function units(pkg, parts = PARTS, solo = soloOf) {
  const out = [];
  for (const file of releaseSuites(pkg)) {
    const n = parts[file] || 1;
    const s = solo(file);
    if (n === 1) out.push({ file, args: [], label: file, solo: s });
    else {
      for (let i = 1; i <= n; i++) {
        out.push({ file, args: ['--part', `${i}/${n}`], label: `${file} --part ${i}/${n}`,
          solo: s });
      }
    }
  }
  return out;
}

const suiteName = (file) => path.basename(file, '.cjs');

/** The seconds of a unit in `browser`: its suite's weight over its parts, or the median. */
function weightOf(unit, browser, seconds, parts = PARTS) {
  const table = seconds[browser] || {};
  const all = Object.values(table).sort((a, b) => a - b);
  const median = all.length ? all[Math.floor(all.length / 2)] : 60;
  const w = table[suiteName(unit.file)];
  return (typeof w === 'number' ? w : median) / (parts[unit.file] || 1);
}

/** Up to this many units a two-leg plan is searched exhaustively (2^(n-1) partitions). */
const EXACT_MAX_UNITS = 24;

/**
 * The cost of a plan, smaller is better, compared in order: how far its slowest leg one by one
 * runs over LEG_BUDGET_S (the budget's measure; 0 within it), the slowest leg's estimate with
 * the shared units sharing (the wall clock the legs take), then the slowest leg one by one.
 */
const costOf = (legs) => {
  const s = Math.max(...legs.map((l) => l.s));
  return { over: Math.max(0, s - LEG_BUDGET_S), est: Math.max(...legs.map((l) => l.est)), s };
};
const worse = (a, b) => a.over - b.over || a.est - b.est || a.s - b.s;

/**
 * The longest-first deal (the whole dealer before the balanced search): each item, by `key`
 * descending, to the leg whose `key` sum is least so far (lowest index on a tie). Returns the
 * leg index of every item.
 */
function lpt(items, legs, key) {
  const sum = new Array(legs).fill(0);
  const at = new Array(items.length);
  const order = items.map((x, k) => k).sort((a, b) => items[b][key] - items[a][key] || a - b);
  for (const k of order) {
    let best = 0;
    for (let l = 1; l < legs; l++) if (sum[l] < sum[best]) best = l;
    at[k] = best;
    sum[best] += items[k][key];
  }
  return at;
}

/**
 * Two legs, exactly: every partition with item 0 in the first leg, the one of least cost
 * (costOf), the smallest mask on a tie. 2^(n-1) partitions.
 */
function exactTwo(items) {
  const n = items.length;
  const S = items.reduce((t, x) => t + x.w, 0);
  const E = items.reduce((t, x) => t + x.e, 0);
  let best = null;
  const limit = 2 ** (n - 1);
  for (let m = 0; m < limit; m++) {
    // the second leg holds item k + 1 for every set bit k of m
    let s2 = 0;
    let e2 = 0;
    for (let k = 0, b = m; b; k++, b >>>= 1) {
      if (b & 1) { s2 += items[k + 1].w; e2 += items[k + 1].e; }
    }
    const cost = costOf([{ s: S - s2, est: E - e2 }, { s: s2, est: e2 }]);
    if (!best || worse(cost, best.cost) < 0) best = { cost, m };
  }
  return items.map((x, k) => (k > 0 && (best.m >>> (k - 1)) & 1 ? 1 : 0));
}

/**
 * Improve an assignment: move one item to another leg, or swap two items of different legs,
 * while that makes the plan's cost (costOf) strictly less; first improvement in item order,
 * repeated until none is left. Deterministic, and never worse than its input.
 */
function improve(items, at, legs) {
  const loads = () => Array.from({ length: legs }, (_, l) => items.reduce((t, x, k) => (at[k]
    === l ? { s: t.s + x.w, est: t.est + x.e } : t), { s: 0, est: 0 }));
  for (let guard = 0; guard < 10000; guard++) {
    const cur = costOf(loads());
    let moved = false;
    const tryAt = (next) => {
      const was = at.slice();
      next();
      if (worse(costOf(loads()), cur) < 0) return true;
      at.splice(0, at.length, ...was);
      return false;
    };
    for (let i = 0; i < items.length && !moved; i++) {
      for (let l = 0; l < legs && !moved; l++) {
        if (l !== at[i]) moved = tryAt(() => { at[i] = l; });
      }
      for (let j = i + 1; j < items.length && !moved; j++) {
        if (at[i] !== at[j]) moved = tryAt(() => { [at[i], at[j]] = [at[j], at[i]]; });
      }
    }
    if (!moved) return at;
  }
  return at;
}

/**
 * Deal `us` over `legs` legs at the least cost the search finds (costOf): every leg one by one
 * (`weigh`, the measure LEG_BUDGET_S holds) within the budget where any plan is, then the
 * slowest leg's estimate with the shared units sharing (a shared unit's seconds divided by
 * `speedup`) as short as possible, then its seconds one by one. Two legs of at
 * most EXACT_MAX_UNITS units are searched exhaustively; otherwise the longest-first deal is
 * improved by single moves and pairwise swaps. Deterministic: the same units and weights give
 * the same plan on every runner. The leg holding the first unit (longest first, by index on a
 * tie) is leg 1. Returns [{ leg, s, est, units }] in leg order: `s` the seconds one by one,
 * `est` the estimate with the shared units sharing; each leg's units longest first.
 */
function deal(us, legs, weigh, speedup = SHARED_SPEEDUP) {
  const items = us.map((u, i) => ({ u, i, w: weigh(u) }))
    .map((x) => ({ ...x, e: x.u.solo === false ? x.w / speedup : x.w }))
    .sort((a, b) => b.e - a.e || a.i - b.i);
  let at;
  if (legs <= 1 || !items.length) at = items.map(() => 0);
  else if (legs === 2 && items.length <= EXACT_MAX_UNITS) at = exactTwo(items);
  else at = improve(items, lpt(items, legs, 'w'), legs);
  // Number the legs by their first item, so leg 1 holds the longest unit.
  const rank = [];
  for (const l of at) if (!rank.includes(l)) rank.push(l);
  for (let l = 0; l < legs; l++) if (!rank.includes(l)) rank.push(l);
  const out = Array.from({ length: legs }, (_, i) => ({ leg: i + 1, s: 0, est: 0, units: [] }));
  items.forEach((x, k) => {
    const leg = out[rank.indexOf(at[k])];
    leg.units.push(x.u);
    leg.s += x.w;
    leg.est += x.e;
  });
  return out;
}

/** The longest-first deal by the estimate, the dealer before the balanced search (a baseline). */
function dealLongestFirst(us, legs, weigh, speedup = SHARED_SPEEDUP) {
  const items = us.map((u, i) => ({ u, i, w: weigh(u) }))
    .map((x) => ({ ...x, e: x.u.solo === false ? x.w / speedup : x.w }))
    .sort((a, b) => b.e - a.e || a.i - b.i);
  const at = lpt(items, legs, 'e');
  const out = Array.from({ length: legs }, (_, i) => ({ leg: i + 1, s: 0, est: 0, units: [] }));
  items.forEach((x, k) => {
    out[at[k]].units.push(x.u);
    out[at[k]].s += x.w;
    out[at[k]].est += x.e;
  });
  return out;
}

/** The plan of one browser from the repository's package.json and weights. */
function plan(browser, { pkg, weights, legs = LEGS, parts = PARTS } = {}) {
  const p = pkg || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const w = weights || JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'browser',
    'shard-weights.json'), 'utf8'));
  return deal(units(p, parts), legs[browser], (u) => weightOf(u, browser, w.seconds, parts));
}

/**
 * The part a suite's check belongs to: `index` (0-based, in the suite's own order) dealt round
 * robin over `n` parts, so part i of n holds every n-th check from the (i-1)-th. Every index is
 * in exactly one part.
 */
function dealt(index, part) {
  return index % part.n === part.i - 1;
}

/** `--part <i>/<n>` from argv: { i, n }, null when absent; throws on a malformed value. */
function parsePart(argv) {
  const at = argv.indexOf('--part');
  if (at < 0) return null;
  const m = /^(\d+)\/(\d+)$/.exec(argv[at + 1] || '');
  const i = m ? Number(m[1]) : 0;
  const n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || i < 1 || i > n) {
    throw new Error(`--part takes <i>/<n> with 1 <= i <= n, not ${JSON.stringify(argv[at + 1])}`);
  }
  return { i, n };
}

async function main(argv, env = process.env) {
  const browser = env.OSC_BROWSERS;
  if (!BROWSERS.includes(browser)) {
    console.error(`shards: OSC_BROWSERS must be one of ${BROWSERS.join(', ')}, not `
      + `${JSON.stringify(browser)}`);
    return 2;
  }
  const legs = plan(browser);
  if (argv.includes('--plan')) {
    for (const l of legs) {
      console.log(`${browser} leg ${l.leg}/${legs.length}: ${(l.s / 60).toFixed(1)} min by the `
        + `weights one by one, ~${(l.est / 60).toFixed(1)} sharing, ${l.units.length} suites`);
      for (const u of l.units) console.log(`  ${u.solo ? 'solo  ' : 'shared'} ${u.label}`);
    }
    return 0;
  }
  const n = Number(env.OSC_LEG);
  const leg = legs.find((l) => l.leg === n);
  if (!leg) {
    console.error(`shards: OSC_LEG must be 1..${legs.length} for ${browser}, not `
      + `${JSON.stringify(env.OSC_LEG)}`);
    return 2;
  }
  const solo = leg.units.filter((u) => u.solo).length;
  console.log(`shards: ${browser} leg ${leg.leg} of ${legs.length}, ${leg.units.length} suites `
    + `(${leg.units.length - solo} shared, ${solo} solo), ${(leg.s / 60).toFixed(1)} min one by `
    + 'one by the weights');
  for (const u of leg.units) console.log(`shards:   ${u.solo ? 'solo  ' : 'shared'} ${u.label}`);
  return runUnits(leg.units, env);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { BROWSERS, LEGS, PARTS, LEG_BUDGET_S, SHARED_SPEEDUP, RELEASE_SCRIPT,
  EXACT_MAX_UNITS, releaseSuites, units, paceOf, soloOf, weightOf, deal, dealLongestFirst, plan,
  dealt, parsePart };
