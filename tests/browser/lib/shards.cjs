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
// seconds (tests/browser/shard-weights.json), longest first, each to the leg with the least so
// far (ties to the lower leg, so the plan is the same on every runner). A unit without a weight
// gets its browser's median. tests/unit/browser-shards.test.mjs holds the plan to: every unit
// of every browser in exactly one leg, the legs ci.yml declares equal to LEGS, and the slowest
// leg within LEG_BUDGET_S by the weights.
//
// Each leg runs its units through lib/run-suites.cjs (every unit runs, whatever the one before
// returned; OSC_SUITE_JOBS at a time, OSC_SUITE_MS each), with OSC_BROWSERS as given.
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
const LEG_BUDGET_S = 50 * 60;

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
function units(pkg, parts = PARTS) {
  const out = [];
  for (const file of releaseSuites(pkg)) {
    const n = parts[file] || 1;
    if (n === 1) out.push({ file, args: [], label: file });
    else {
      for (let i = 1; i <= n; i++) {
        out.push({ file, args: ['--part', `${i}/${n}`], label: `${file} --part ${i}/${n}` });
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

/**
 * Deal `us` over `legs` legs: longest first, each to the least-loaded leg (lowest index on a
 * tie). Returns [{ leg, s, units }] in leg order; each leg's units longest first.
 */
function deal(us, legs, weigh) {
  const out = Array.from({ length: legs }, (_, i) => ({ leg: i + 1, s: 0, units: [] }));
  const order = us.map((u, i) => ({ u, i, w: weigh(u) }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const { u, w } of order) {
    let best = out[0];
    for (const l of out) if (l.s < best.s) best = l;
    best.units.push(u);
    best.s += w;
  }
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
        + `weights, ${l.units.length} suites`);
      for (const u of l.units) console.log(`  ${u.label}`);
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
  console.log(`shards: ${browser} leg ${leg.leg} of ${legs.length}, ${leg.units.length} suites, `
    + `${(leg.s / 60).toFixed(1)} min one by one by the weights`);
  return runUnits(leg.units, env);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { BROWSERS, LEGS, PARTS, LEG_BUDGET_S, RELEASE_SCRIPT, releaseSuites, units,
  weightOf, deal, plan, dealt, parsePart };
