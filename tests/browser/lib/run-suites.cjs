#!/usr/bin/env node
// Run browser suites, every one of them, and fail when any of them failed.
// `node a.cjs && node b.cjs` stops at the first failing suite, so in CI the suites after it
// never ran and their checks had no Linux run at all (review #330 F5). This runner starts each
// suite whatever the one before it returned, prints one line per suite and a summary, and exits
// non-zero when any suite did.
//
//   node tests/browser/lib/run-suites.cjs tests/browser/app.cjs tests/browser/layout.cjs ...
//
// Each suite is an entry suite of its own (rule project.suite-harness): it opens its run through
// lib/suite.cjs, which reads OSC_BROWSERS and OSC_ORIGINS from the environment this runner
// passes on unchanged, and holds its own deadlines (rule project.bounded-test-timing). The runner
// adds one more: a suite that has not exited after OSC_SUITE_MS (default 20 minutes) is stopped
// and counted as failed, so a wedged suite cannot hold the ones after it.
//
// OSC_SUITE_JOBS (default 1) runs that many suites at once (the CI legs, lib/shards.cjs, on a
// 4-vCPU runner). With 1 every suite writes straight to the terminal, one after another; with
// more each suite's output is held and printed as one block when it exits, so the log reads
// suite by suite. A unit marked solo (lib/shards.cjs, a suite that judges the realtime output)
// never shares: the shared units run first, OSC_SUITE_JOBS at a time, then the solo ones alone.
// A suite stopped at its deadline gets SIGTERM, then SIGKILL after KILL_GRACE_MS if it is still
// there, so a child that ignores SIGTERM cannot hold the run to its step's bound.
//
// Exit: 0 when every suite exited 0; 2 when no suite was named, a named file does not exist,
// OSC_SUITE_MS is not a positive number or OSC_SUITE_JOBS not a positive integer (nothing is
// run); 1 otherwise.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MS = 20 * 60 * 1000;
/** How long a suite has to exit after SIGTERM before it gets SIGKILL. */
const KILL_GRACE_MS = 15000;

/** The per-suite deadline from OSC_SUITE_MS; null when the value is not a positive number. */
function suiteDeadline(env = process.env) {
  if (env.OSC_SUITE_MS === undefined || env.OSC_SUITE_MS === '') return DEFAULT_MS;
  const ms = Number(env.OSC_SUITE_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** How many suites run at once, from OSC_SUITE_JOBS; null when it is not a positive integer. */
function suiteJobs(env = process.env) {
  if (env.OSC_SUITE_JOBS === undefined || env.OSC_SUITE_JOBS === '') return 1;
  const n = Number(env.OSC_SUITE_JOBS);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Why a finished suite failed, or 'exit 0'. */
function whyOf(r) {
  if (r.error) return r.error.code === 'ETIMEDOUT' ? 'timed out' : String(r.error.message);
  return r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
}

/**
 * Run every unit ({ file, args?, label? }) with `start(unit)` -> Promise<{ status, signal,
 * error }>, at most `jobs` at once, each started as soon as a slot is free, in the given order.
 * Every unit is run whatever the others returned. Resolves { code, results } in the units'
 * order: code 0 when every status was 0, else 1.
 */
async function runPool(units, start, { jobs = 1 } = {}) {
  const results = new Array(units.length);
  let next = 0;
  const worker = async () => {
    // Each unit is taken once, by the first free worker; each start is bounded by its own
    // deadline (startSuite), so the loop ends when the units do.
    for (let i = next++; i < units.length; i = next++) {
      const t0 = Date.now();
      let r;
      try {
        r = await start(units[i]);
      } catch (error) {
        r = { status: null, error };
      }
      const ok = r.status === 0 && !r.signal && !r.error;
      results[i] = { file: units[i].label || units[i].file, ok, why: whyOf(r),
        s: (Date.now() - t0) / 1000 };
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, units.length) }, worker));
  return { code: results.every((r) => r.ok) ? 0 : 1, results };
}

/**
 * Start one suite as a child process, stopped with SIGTERM after `ms`. With `hold` its output
 * is collected and printed as one block when it exits; else it is the terminal's.
 */
function startSuite(unit, { ms, hold, env = process.env, log = console.log,
  graceMs = KILL_GRACE_MS }) {
  return new Promise((resolve) => {
    const label = unit.label || unit.file;
    if (!hold) log(`run-suites: ${label}`);
    const child = spawn(process.execPath, [unit.file, ...(unit.args || [])],
      { stdio: hold ? ['ignore', 'pipe', 'pipe'] : 'inherit', env });
    const out = [];
    if (hold) {
      child.stdout.on('data', (b) => out.push(b));
      child.stderr.on('data', (b) => out.push(b));
    }
    let timedOut = false;
    let killer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), graceMs);
    }, ms);
    const finish = (r) => {
      clearTimeout(timer);
      clearTimeout(killer);
      if (hold) {
        log(`run-suites: ${label} (its output, held while ${label} ran)`);
        log(Buffer.concat(out).toString('utf8').replace(/\n$/, ''));
        log(`run-suites: end of ${label}`);
      }
      resolve(r);
    };
    child.on('error', (error) => finish({ status: null, error }));
    child.on('exit', (status, signal) => finish(timedOut
      ? { status, signal: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }
      : { status, signal }));
  });
}

/** Print the summary of a run and return its exit code. */
function summarize({ code, results }, log = console.log) {
  log('run-suites: summary');
  for (const r of results) {
    log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.file} (${r.ok ? '' : `${r.why}, `}${r.s.toFixed(1)} s)`);
  }
  const failed = results.filter((r) => !r.ok).length;
  log(failed ? `run-suites: ${failed} of ${results.length} suites failed`
    : `run-suites: all ${results.length} suites passed`);
  return code;
}

/**
 * Run `units` with the deadline and parallelism of the environment; resolves the exit code
 * (2 for a bad OSC_SUITE_MS or OSC_SUITE_JOBS, or a missing file, before anything runs).
 */
async function runUnits(units, env = process.env) {
  const ms = suiteDeadline(env);
  const jobs = suiteJobs(env);
  if (ms === null || jobs === null) {
    console.error(ms === null ? 'run-suites: OSC_SUITE_MS must be a positive number of ms'
      : 'run-suites: OSC_SUITE_JOBS must be a positive integer');
    return 2;
  }
  const missing = units.filter((u) => !fs.existsSync(path.resolve(u.file)));
  if (missing.length) {
    console.error(`run-suites: no such suite: ${missing.map((u) => u.file).join(', ')}`);
    return 2;
  }
  const shared = units.filter((u) => !u.solo);
  const solo = units.filter((u) => u.solo);
  if (jobs > 1) {
    console.log(`run-suites: ${units.length} suites, the ${shared.length} shared ${jobs} at a `
      + `time, then the ${solo.length} solo one by one`);
  }
  const start = (hold) => (u) => startSuite(u, { ms, hold, env });
  const a = jobs > 1 ? await runPool(shared, start(true), { jobs })
    : await runPool(units, start(false), { jobs: 1 });
  const b = jobs > 1 ? await runPool(solo, start(false), { jobs: 1 }) : { results: [] };
  const results = [...a.results, ...b.results];
  return summarize({ code: results.every((r) => r.ok) ? 0 : 1, results });
}

/**
 * Run `files` in order with `run(file)` -> { status, signal, error }; every file is run. Returns
 * { code, results }: code 0 when every status was 0, else 1.
 */
function runAll(files, run) {
  const results = [];
  for (const file of files) {
    const t0 = Date.now();
    const r = run(file);
    const ok = r.status === 0 && !r.signal && !r.error;
    const why = r.error ? (r.error.code === 'ETIMEDOUT' ? 'timed out' : String(r.error.message))
      : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
    results.push({ file, ok, why, s: (Date.now() - t0) / 1000 });
  }
  return { code: results.every((r) => r.ok) ? 0 : 1, results };
}

function main(argv) {
  const files = argv.slice(2);
  if (!files.length) {
    console.error('usage: node tests/browser/lib/run-suites.cjs <suite.cjs> [<suite.cjs> ...]');
    return Promise.resolve(2);
  }
  // each named suite's own pace declaration (lib/shards.cjs; loaded here, as it loads this)
  // eslint-disable-next-line global-require
  const { soloOf } = require('./shards.cjs');
  return runUnits(files.map((file) => ({ file, solo: soloOf(file) })));
}

if (require.main === module) main(process.argv).then((code) => { process.exitCode = code; });

module.exports = { runAll, runPool, runUnits, startSuite, suiteDeadline, suiteJobs, DEFAULT_MS,
  KILL_GRACE_MS };
