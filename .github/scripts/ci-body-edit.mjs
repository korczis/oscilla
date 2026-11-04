#!/usr/bin/env node
// R030: an edit of a pull request's title or body re-runs the jobs that read them (fail-first
// and review-verdict read the PR as it is now, through PR_JSON) and the gate, and runs no
// browser, visual or census job: those judge the tree, which a body edit does not change. The
// `body-edit` job of .github/workflows/ci.yml runs the BASE branch's copy of this file (taken
// with `git cat-file blob`, as the `changes` job takes its classifier), on a body edit only,
// and writes `proven=<JSON list of job keys>` to $GITHUB_OUTPUT. `gate` accepts the skip of a
// HEAVY job on that run only when its key is in that list.
//
//   node .github/scripts/ci-body-edit.mjs --event-path <file> --repo <owner/name> --run <id>
//        [--workflow ci.yml] [--wait-minutes <n>] [--poll-seconds <n>] [--output <file>]
//
// A job is proven when every one of its legs (HEAVY names them as the API does) concluded
// `success` the last time it ran (any conclusion but `skipped`) in a completed run of this
// workflow at the pull request's head commit, other than this one. A leg that never ran there,
// was cancelled, failed or timed out the last time leaves its job unproven, and the gate then
// fails: an edit never turns a red or unfinished browser result green.
//
// It waits until no other run of the workflow at that head commit is still going (polling every
// --poll-seconds up to --wait-minutes), so a run that was in progress when the body was edited
// (whose fail-first may have read the old body) finishes, and its `gate`, before this run's
// does: the required check that is left is the one that judged the new body. Past the deadline,
// or when the API cannot be read (every request bounded by REQUEST_TIMEOUT_MS and tried
// REQUEST_TRIES times, project.ci-bounded), it exits 1 and the gate fails with the job.
//
// An event that is not a body edit (any action but `edited`, or an edit that changed the base
// branch, which changes the merge commit) proves nothing: `proven=[]`, and no request is made.
//
// Dependency-free on purpose: the job runs it as one extracted file, before `npm ci`.
// Tested by tests/unit/ci-body-edit.test.mjs; the wiring by tests/unit/ci-workflows.test.mjs.

import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BROWSERS = ['chromium', 'firefox', 'webkit'];
const legs = (name) => BROWSERS.map((b) => `${name} (${b})`);

/**
 * The jobs a body edit skips, by key, with the names the API gives their legs. They must equal
 * ci.yml's jobs and names with the matrix expanded (tests/unit/ci-body-edit.test.mjs).
 */
export const HEAVY = Object.freeze({
  engine: legs('V1 engine checks'),
  suites: legs('DSP, labs, sequencer'),
  measure: legs('V3 measurement and UI'),
  studio: legs('V3.1 Studio UI'),
  browser: legs('Browser gate'),
  census: legs('Control census'),
  visual: ['Visual regression gate'],
});

export const REQUEST_TIMEOUT_MS = 20_000;
export const REQUEST_TRIES = 3;
export const RETRY_DELAY_MS = 5_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;

const USAGE = 'usage: node .github/scripts/ci-body-edit.mjs --event-path <file> '
  + '--repo <owner/name> --run <id>\n'
  + '       [--workflow ci.yml] [--wait-minutes <n>] [--poll-seconds <n>] [--output <file>]\n'
  + '  on an edit of a pull request\'s title or body, writes proven=<JSON list> naming each\n'
  + '  job of HEAVY whose every leg succeeded the last time it ran at the head commit';

class Refusal extends Error {}

/** True for an `edited` pull_request event that left the base branch as it was. */
export function isBodyEdit(event) {
  return event?.action === 'edited' && !event?.changes?.base && !!event?.pull_request;
}

/**
 * The keys of HEAVY proven by `runs` (each { id, created_at, jobs: [{ name, status,
 * conclusion }] }, every one completed): a key whose every leg's last conclusion other than
 * `skipped`, in run order, is `success`.
 */
export function provenJobs(runs) {
  const ordered = [...runs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))
    || a.id - b.id);
  const last = new Map();
  for (const run of ordered) {
    for (const job of run.jobs ?? []) {
      if (job.status !== 'completed' || !job.conclusion || job.conclusion === 'skipped') continue;
      last.set(job.name, { conclusion: job.conclusion, run: run.id });
    }
  }
  const proven = [];
  const evidence = [];
  for (const [key, names] of Object.entries(HEAVY)) {
    let ok = true;
    for (const name of names) {
      const seen = last.get(name);
      evidence.push({ job: key, leg: name, conclusion: seen?.conclusion ?? 'never ran',
        run: seen?.run ?? null });
      if (seen?.conclusion !== 'success') ok = false;
    }
    if (ok) proven.push(key);
  }
  return { proven, evidence };
}

const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** One GET, bounded by REQUEST_TIMEOUT_MS and tried `tries` times. */
async function getJson(url, { fetch, token, tries, retryDelayMs, sleep }) {
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
    if (i < tries) await sleep(retryDelayMs);
  }
  throw new Refusal(`ci-body-edit: ${url}: ${last} after ${tries} tries`);
}

/** Every item of a paged list (`key` names the array in each page's body). */
async function getAll(url, key, opts) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await getJson(`${url}&per_page=${PER_PAGE}&page=${page}`, opts);
    const items = body[key] ?? [];
    out.push(...items);
    if (items.length < PER_PAGE || out.length >= (body.total_count ?? 0)) break;
  }
  return out;
}

/**
 * Wait until every other run of the workflow at `sha` has completed, then read the latest
 * attempt's jobs of each. Returns the runs with their jobs.
 */
export async function readRuns({
  repo, run, sha, workflow = 'ci.yml', waitMs, pollMs, fetch = globalThis.fetch, token,
  tries = REQUEST_TRIES, retryDelayMs = RETRY_DELAY_MS, now = Date.now, sleep = delay,
  log = () => {},
}) {
  const opts = { fetch, token, tries, retryDelayMs, sleep };
  const api = `https://api.github.com/repos/${repo}/actions`;
  const deadline = now() + waitMs;
  for (;;) {
    const runs = (await getAll(`${api}/workflows/${encodeURIComponent(workflow)}/runs`
      + `?head_sha=${sha}&event=pull_request`, 'workflow_runs', opts))
      .filter((r) => r.id !== run && r.head_sha === sha);
    const going = runs.filter((r) => r.status !== 'completed');
    if (!going.length) {
      for (const r of runs) {
        r.jobs = await getAll(`${api}/runs/${r.id}/jobs?filter=latest`, 'jobs', opts);
      }
      return runs;
    }
    if (now() >= deadline) {
      throw new Refusal(`ci-body-edit: run ${going.map((r) => r.id).join(', ')} at ${sha} still `
        + `${going[0].status} after ${Math.round(waitMs / 60000)} min; re-run this job once it `
        + 'has finished');
    }
    log(`ci-body-edit: waiting for run ${going.map((r) => `${r.id} (${r.status})`).join(', ')}`
      + ` at ${sha}`);
    await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
  }
}

/** The program: returns the exit status; writes `proven=` to `output` when it has an answer. */
export async function main(argv, {
  fetch = globalThis.fetch, env = process.env, log = (s) => process.stdout.write(`${s}\n`),
  err = (s) => process.stderr.write(`${s}\n`), now, sleep,
} = {}) {
  const opts = { workflow: 'ci.yml', waitMinutes: 70, pollSeconds: 30 };
  const args = [...argv];
  const value = (flag) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new Refusal(`${flag} needs a value`);
    return v;
  };
  const positive = (flag) => {
    const v = value(flag);
    if (!/^[1-9]\d*$/.test(v)) throw new Refusal(`${flag} needs a positive integer, not ${v}`);
    return Number(v);
  };
  try {
    while (args.length) {
      const a = args.shift();
      if (a === '--help' || a === '-h') {
        log(USAGE);
        return 0;
      } else if (a === '--event-path') opts.eventPath = value(a);
      else if (a === '--repo') opts.repo = value(a);
      else if (a === '--run') opts.run = positive(a);
      else if (a === '--workflow') opts.workflow = value(a);
      else if (a === '--wait-minutes') opts.waitMinutes = positive(a);
      else if (a === '--poll-seconds') opts.pollSeconds = positive(a);
      else if (a === '--output') opts.output = value(a);
      else throw new Refusal(`bad argument ${a}`);
    }
    if (!opts.eventPath) throw new Refusal('--event-path is required');
    const event = JSON.parse(readFileSync(opts.eventPath, 'utf8'));
    const answer = (proven) => {
      const line = `proven=${JSON.stringify(proven)}`;
      if (opts.output) appendFileSync(opts.output, `${line}\n`);
      log(line);
    };
    if (!isBodyEdit(event)) {
      log(`ci-body-edit: ${event?.action ?? 'no action'}${event?.changes?.base ? ' of the base'
        : ''} is not an edit of the title or body: nothing is proven`);
      answer([]);
      return 0;
    }
    if (!opts.repo || !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) {
      throw new Refusal(`--repo needs <owner/name>, not ${opts.repo}`);
    }
    if (!opts.run) throw new Refusal('--run is required');
    const sha = event.pull_request.head?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Refusal(`no head commit in the event: ${sha}`);
    const runs = await readRuns({ repo: opts.repo, run: opts.run, sha, workflow: opts.workflow,
      waitMs: opts.waitMinutes * 60_000, pollMs: opts.pollSeconds * 1000, fetch,
      token: env.GH_TOKEN || env.GITHUB_TOKEN, now, sleep, log });
    const { proven, evidence } = provenJobs(runs);
    log(`ci-body-edit: ${runs.length} other run(s) at ${sha}: `
      + `${runs.map((r) => r.id).join(', ') || 'none'}`);
    for (const e of evidence) {
      log(`  ${e.leg}: ${e.conclusion}${e.run ? ` (run ${e.run})` : ''}`);
    }
    const unproven = Object.keys(HEAVY).filter((k) => !proven.includes(k));
    if (unproven.length) {
      err(`::warning::ci-body-edit: not proven at ${sha}: ${unproven.join(', ')}; the gate `
        + 'accepts no skip of them');
    }
    answer(proven);
    return 0;
  } catch (e) {
    if (!(e instanceof Refusal) && !(e instanceof SyntaxError)) throw e;
    err(`::error::ci-body-edit: ${e.message}`);
    if (/needs a|bad argument|is required/.test(e.message)) err(USAGE);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
