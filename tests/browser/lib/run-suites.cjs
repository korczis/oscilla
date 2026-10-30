#!/usr/bin/env node
// Run browser suites one after another, every one of them, and fail when any of them failed.
// `node a.cjs && node b.cjs` stops at the first failing suite, so in CI the suites after it
// never ran and their checks had no Linux run at all (review #330 F5). This runner starts each
// suite in turn whatever the one before it returned, prints one line per suite and a summary,
// and exits non-zero when any suite did.
//
//   node tests/browser/lib/run-suites.cjs tests/browser/app.cjs tests/browser/layout.cjs ...
//
// Each suite is an entry suite of its own (rule project.suite-harness): it opens its run through
// lib/suite.cjs, which reads OSC_BROWSERS and OSC_ORIGINS from the environment this runner
// passes on unchanged, and holds its own deadlines (rule project.bounded-test-timing). The runner
// adds one more: a suite that has not exited after OSC_SUITE_MS (default 20 minutes) is stopped
// and counted as failed, so a wedged suite cannot hold the ones after it.
//
// Exit: 0 when every suite exited 0; 2 when no suite was named, a named file does not exist or
// OSC_SUITE_MS is not a positive number (nothing is run); 1 otherwise.
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MS = 20 * 60 * 1000;

/** The per-suite deadline from OSC_SUITE_MS; null when the value is not a positive number. */
function suiteDeadline(env = process.env) {
  if (env.OSC_SUITE_MS === undefined || env.OSC_SUITE_MS === '') return DEFAULT_MS;
  const ms = Number(env.OSC_SUITE_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
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
  const ms = suiteDeadline();
  if (!files.length || ms === null) {
    console.error(ms === null ? `run-suites: OSC_SUITE_MS must be a positive number of ms`
      : 'usage: node tests/browser/lib/run-suites.cjs <suite.cjs> [<suite.cjs> ...]');
    return 2;
  }
  const missing = files.filter((f) => !fs.existsSync(path.resolve(f)));
  if (missing.length) {
    console.error(`run-suites: no such suite: ${missing.join(', ')}`);
    return 2;
  }
  const { code, results } = runAll(files, (file) => {
    console.log(`run-suites: ${file}`);
    return spawnSync(process.execPath, [file], { stdio: 'inherit', timeout: ms,
      killSignal: 'SIGTERM' });
  });
  console.log('run-suites: summary');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.file} (${r.ok ? '' : `${r.why}, `}`
      + `${r.s.toFixed(1)} s)`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `run-suites: ${failed} of ${results.length} suites failed`
    : `run-suites: all ${results.length} suites passed`);
  return code;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { runAll, suiteDeadline, DEFAULT_MS };
