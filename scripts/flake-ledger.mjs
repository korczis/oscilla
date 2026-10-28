#!/usr/bin/env node
// The flake ledger (plan issue E010): every CI check that failed on an earlier attempt of a
// workflow run and passed on this one. No browser suite or check is retried inside the harness
// (tests/browser/lib/suite.cjs has no retry, and adding one would hide failures and change
// project.suite-harness), so a re-run of the run is the only way a check passes on retry, and
// this records it. The `gate` job of .github/workflows/ci.yml runs it when github.run_attempt is
// above 1, after every other job of the attempt has finished; it appends the Markdown to the step
// summary and uploads the JSON as the artifact `flake-ledger`.
//
// For every job this attempt ran that succeeded, and that failed or timed out on an earlier
// attempt of the same run, one entry names the check (the job and the step that failed), the
// browser of its matrix leg, the earlier attempt's outcome and this one's, and a cause class.
// The cause is `unclassified` until a person classifies it as product, browser,
// infrastructure or test defect. The ledger feeds one decision: whether a flaky check is fixed
// in the product, in the test, or recorded as infrastructure, against the recorded debt of
// tests/browser/timing-baseline.json.
//
// A job this attempt did not run (a re-run of the failed jobs only carries the others over,
// listed with their earlier run_attempt) is not a pass on retry, and one still running (the
// gate job itself) has no outcome yet; neither is an entry.
//
// The jobs of each attempt are read from the GitHub REST API
// (GET /repos/{repo}/actions/runs/{run}/attempts/{n}/jobs, which needs `actions: read`); every
// request is bounded by REQUEST_TIMEOUT_MS and tried REQUEST_TRIES times (project.ci-bounded).
// The ledger reports and never fails the gate: when the API cannot be read it prints a
// workflow warning and a summary line saying so, and exits 0.
//
//   node scripts/flake-ledger.mjs --repo <owner/name> --run <id> --attempt <n> [--out <file>]
//
// On attempt 1 it writes nothing and reads nothing. The token is GH_TOKEN (or GITHUB_TOKEN).
// Exit codes: 0 ledger written, nothing to record, or the API unreadable (warned); 2 usage.
import { writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The classes a person assigns to an entry; every entry starts unclassified. */
export const CAUSES = ['product', 'browser', 'infrastructure', 'test defect'];
export const UNCLASSIFIED = 'unclassified';

export const REQUEST_TIMEOUT_MS = 20_000;
export const REQUEST_TRIES = 3;
export const RETRY_DELAY_MS = 5_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;

const FAILED = new Set(['failure', 'timed_out']);
const BROWSER = /\((chromium|firefox|webkit)\)\s*$/;

const USAGE = 'usage: node scripts/flake-ledger.mjs --repo <owner/name> --run <id> '
  + '--attempt <n> [--out <file>]\n'
  + '  on attempt n > 1, lists every job that failed on an earlier attempt of the run and\n'
  + '  passed on attempt n, as Markdown on stdout and as JSON in <file>; on attempt 1 it\n'
  + '  writes nothing';

/** The browser of a matrix leg, from the job name `<job> (<browser>)`, or null. */
export function browserOf(jobName) {
  const m = BROWSER.exec(jobName);
  return m ? m[1] : null;
}

/** The names of the steps that failed in a job, in order. */
function failedSteps(job) {
  return (job.steps ?? []).filter((s) => FAILED.has(s.conclusion)).map((s) => s.name);
}

/**
 * The ledger entries of attempt `current`, from the jobs of every attempt:
 * `attempts` maps an attempt number to the jobs the API lists for it.
 */
export function ledger({ attempts, current }) {
  if (!(current > 1)) return [];
  const ranIn = (n) => (attempts[n] ?? []).filter((j) => (j.run_attempt ?? n) === n);
  const entries = [];
  for (const job of ranIn(current)) {
    if (job.status !== 'completed' || job.conclusion !== 'success') continue;
    const failures = [];
    for (let n = 1; n < current; n += 1) {
      const earlier = ranIn(n).find((j) => j.name === job.name);
      if (earlier && FAILED.has(earlier.conclusion)) failures.push({ n, job: earlier });
    }
    if (!failures.length) continue;
    const last = failures[failures.length - 1];
    const steps = failedSteps(last.job);
    entries.push({
      check: steps.length ? `${job.name} / ${steps.join(', ')}` : job.name,
      job: job.name,
      steps,
      browser: browserOf(job.name),
      earlier: { attempt: last.n, conclusion: last.job.conclusion, url: last.job.html_url ?? null },
      now: { attempt: current, conclusion: job.conclusion, url: job.html_url ?? null },
      failedAttempts: failures.map((f) => f.n),
      cause: UNCLASSIFIED,
    });
  }
  return entries;
}

/** The ledger as Markdown for the step summary. */
export function formatLedger(entries, { run, current }) {
  const lines = [`### Flake ledger (run ${run}, attempt ${current})`, ''];
  if (!entries.length) {
    lines.push('No check that failed on an earlier attempt passed on this one.', '');
    return lines.join('\n');
  }
  lines.push(
    '| check | browser | earlier attempt | this attempt | cause |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const e of entries) {
    lines.push(`| ${e.check} | ${e.browser ?? '-'} | ${e.earlier.attempt}: ${e.earlier.conclusion} `
      + `| ${e.now.attempt}: ${e.now.conclusion} | ${e.cause} |`);
  }
  lines.push(
    '',
    `Each entry stays ${UNCLASSIFIED} until a person classifies it as `
      + `${CAUSES.slice(0, -1).join(', ')} or ${CAUSES[CAUSES.length - 1]}; the classification `
      + 'decides whether the product, the test or the record of infrastructure changes, '
      + 'against tests/browser/timing-baseline.json.',
    '',
  );
  return lines.join('\n');
}

class Refusal extends Error {}

const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** One GET, bounded by REQUEST_TIMEOUT_MS and tried `tries` times. */
async function getJson(url, { fetch, token, tries, retryDelayMs }) {
  let last = '';
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    if (i < tries) await delay(retryDelayMs);
  }
  throw new Refusal(`flake-ledger: ${url}: ${last} after ${tries} tries`);
}

/** The jobs of every attempt 1..current of a run, read page by page. */
export async function readAttempts({
  repo, run, current, fetch = globalThis.fetch, token,
  tries = REQUEST_TRIES, retryDelayMs = RETRY_DELAY_MS,
}) {
  const attempts = {};
  for (let n = 1; n <= current; n += 1) {
    attempts[n] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = `https://api.github.com/repos/${repo}/actions/runs/${run}/attempts/${n}/jobs`
        + `?per_page=${PER_PAGE}&page=${page}`;
      const body = await getJson(url, { fetch, token, tries, retryDelayMs });
      const jobs = body.jobs ?? [];
      attempts[n].push(...jobs);
      if (jobs.length < PER_PAGE || attempts[n].length >= (body.total_count ?? 0)) break;
    }
  }
  return attempts;
}

/**
 * Run the ledger: returns { markdown, entries } or null on attempt 1. The API being
 * unreadable is a Refusal, which the program turns into a warning.
 */
export async function runLedger({ repo, run, current, out, fetch, token, tries, retryDelayMs }) {
  if (!(current > 1)) return null;
  const attempts = await readAttempts({ repo, run, current, fetch, token, tries, retryDelayMs });
  const entries = ledger({ attempts, current });
  if (out) {
    writeFileSync(out, `${JSON.stringify({ schema: 'flake-ledger/v1', repo, run,
      attempt: current, causes: CAUSES, entries }, null, 2)}\n`);
  }
  return { markdown: formatLedger(entries, { run, current }), entries };
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const argv = process.argv.slice(2);
  const opts = {};
  const usage = (msg) => {
    process.stderr.write(`flake-ledger: ${msg}\n${USAGE}\n`);
    process.exit(2);
  };
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
    return v;
  };
  const positive = (flag) => {
    const v = value(flag);
    if (!/^[1-9]\d*$/.test(v)) usage(`${flag} needs a positive integer, not ${v}`);
    return Number(v);
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--help' || a === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (a === '--repo') opts.repo = value(a);
    else if (a === '--run') opts.run = positive(a);
    else if (a === '--attempt') opts.current = positive(a);
    else if (a === '--out') opts.out = value(a);
    else usage(`unknown argument ${a}`);
  }
  for (const [k, flag] of [['repo', '--repo'], ['run', '--run'], ['current', '--attempt']]) {
    if (opts[k] === undefined) usage(`${flag} is required`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) usage(`--repo needs <owner/name>, not ${opts.repo}`);
  opts.token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const r = await runLedger(opts);
    if (r) process.stdout.write(r.markdown);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    process.stdout.write(`### Flake ledger (run ${opts.run}, attempt ${opts.current})\n\n`
      + `Not recorded: ${e.message}\n`);
    process.stderr.write(`::warning::${e.message}\n`);
  }
}
