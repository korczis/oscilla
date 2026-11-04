// R030: .github/scripts/ci-body-edit.mjs, the proof behind a body edit's skipped jobs. On an
// edit of a pull request's title or body (the base left as it was) it waits until every other
// run of ci.yml at the head commit has ended, then names each heavy job whose every leg
// succeeded the last time it ran there; on any other event it proves nothing and asks nothing.
// Here: the event table, the proof table (a leg that failed, was cancelled or never ran leaves
// its job unproven; a later success after an earlier failure proves it; a skip is not a run),
// the wait against a stubbed API and clock, the deadline and an unreadable API (exit 1), HEAVY
// against ci.yml's job names, and that one extracted blob runs.
//   node --test tests/unit/ci-body-edit.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import {
  HEAVY, isBodyEdit, main, provenJobs, readRuns,
} from '../../.github/scripts/ci-body-edit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, '.github/scripts/ci-body-edit.mjs');
const CI = parseYaml(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const SHA = 'c'.repeat(40);
const REPO = 'korczis/oscilla';
const OWN = 900;

const legsOf = () => Object.values(HEAVY).flat();
/** A completed run whose jobs are every heavy leg with `conclusion`, but `except`. */
const run = (id, conclusion, except = {}, extra = {}) => ({ id, head_sha: SHA,
  status: 'completed', created_at: `2026-11-05T10:${String(id % 60).padStart(2, '0')}:00Z`,
  jobs: legsOf().map((name) => ({ name, status: 'completed',
    conclusion: except[name] ?? conclusion })), ...extra });

test('HEAVY is ci.yml\'s seven heavy jobs, by the names the API gives their legs', () => {
  assert.deepEqual(Object.keys(HEAVY), ['engine', 'suites', 'measure', 'studio', 'browser',
    'census', 'visual']);
  for (const [key, names] of Object.entries(HEAVY)) {
    const job = CI.jobs[key];
    assert.ok(job, `ci.yml has ${key}`);
    const browsers = job.strategy?.matrix?.browser;
    const want = browsers
      ? browsers.map((b) => job.name.replace('${{ matrix.browser }}', b)) : [job.name];
    assert.deepEqual(names, want, key);
  }
});

test('isBodyEdit: an edit of the title or body, never of the base, never another action', () => {
  const pr = { head: { sha: SHA } };
  const rows = [
    [{ action: 'edited', changes: { body: { from: 'a' } }, pull_request: pr }, true],
    [{ action: 'edited', changes: { title: { from: 'a' } }, pull_request: pr }, true],
    [{ action: 'edited', changes: {}, pull_request: pr }, true],
    [{ action: 'edited', changes: { base: { ref: { from: 'x' } } }, pull_request: pr }, false],
    [{ action: 'edited', changes: { body: {}, base: { ref: {} } }, pull_request: pr }, false],
    [{ action: 'edited' }, false],
    [{ action: 'synchronize', pull_request: pr }, false],
    [{ action: 'opened', pull_request: pr }, false],
    [{ action: 'reopened', pull_request: pr }, false],
    [{}, false],
    [null, false],
  ];
  for (const [event, want] of rows) assert.equal(isBodyEdit(event), want, JSON.stringify(event));
});

test('provenJobs: every leg\'s last run succeeded, or the job is not proven', () => {
  const all = Object.keys(HEAVY);
  const proven = (runs) => provenJobs(runs).proven;
  assert.deepEqual(proven([run(1, 'success')]), all);
  assert.deepEqual(proven([]), [], 'no run at this commit: nothing is proven');
  assert.deepEqual(proven([run(1, 'skipped')]), [], 'a skip is not a run');
  const failedLeg = { 'Browser gate (webkit)': 'failure' };
  assert.deepEqual(proven([run(1, 'success', failedLeg)]), all.filter((k) => k !== 'browser'));
  for (const bad of ['cancelled', 'timed_out', 'failure', 'action_required']) {
    assert.ok(!proven([run(1, 'success', { 'Control census (firefox)': bad })])
      .includes('census'), bad);
  }
  // the last conclusion that is not a skip decides, in run order
  assert.deepEqual(proven([run(1, 'success', failedLeg), run(2, 'success')]), all);
  assert.deepEqual(proven([run(2, 'success', failedLeg), run(1, 'success')]),
    all.filter((k) => k !== 'browser'), 'ordered by creation, not by the listing');
  assert.deepEqual(proven([run(1, 'success'), run(2, 'success', failedLeg)]),
    all.filter((k) => k !== 'browser'), 'a later failure undoes an earlier success');
  assert.deepEqual(proven([run(1, 'success'), run(2, 'skipped')]), all,
    'an earlier edit\'s skips leave the last real run standing');
  // a leg missing from the listing never ran
  const missing = run(1, 'success');
  missing.jobs = missing.jobs.filter((j) => j.name !== 'Visual regression gate');
  assert.deepEqual(proven([missing]), all.filter((k) => k !== 'visual'));
  // a job still in progress in a listing is no conclusion
  const going = run(1, 'success');
  going.jobs.find((j) => j.name === 'V1 engine checks (chromium)').status = 'in_progress';
  assert.ok(!proven([going]).includes('engine'));
  // jobs that are not heavy are never proven, whatever they did
  const other = run(1, 'success');
  other.jobs.push({ name: 'fail-first (feat/fix tests fail without the change)',
    status: 'completed', conclusion: 'success' });
  assert.deepEqual(proven([other]), all);
  assert.equal(provenJobs([run(1, 'success')]).evidence.length, legsOf().length);
});

/** A stubbed GitHub API: `pages` is a list of run listings, one per poll. */
function api(pages, { fail = false } = {}) {
  const calls = [];
  let poll = 0;
  const fetch = async (url) => {
    calls.push(url);
    if (fail) return { ok: false, status: 502, json: async () => ({}) };
    const u = new URL(url);
    if (/\/workflows\/ci\.yml\/runs$/.test(u.pathname)) {
      assert.equal(u.searchParams.get('head_sha'), SHA);
      assert.equal(u.searchParams.get('event'), 'pull_request');
      const listing = pages[Math.min(poll, pages.length - 1)];
      poll += 1;
      return { ok: true, json: async () => ({ total_count: listing.length,
        workflow_runs: listing.map(({ jobs, ...r }) => r) }) };
    }
    const m = /\/runs\/(\d+)\/jobs$/.exec(u.pathname);
    assert.ok(m, url);
    assert.equal(u.searchParams.get('filter'), 'latest');
    const r = pages.at(-1).find((x) => x.id === Number(m[1]));
    return { ok: true, json: async () => ({ total_count: r.jobs.length, jobs: r.jobs }) };
  };
  return { fetch, calls };
}

/** A fake clock: sleep advances it. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('readRuns waits for every other run at the head commit, then reads their jobs', async () => {
  const done = run(1, 'success');
  const going = { ...run(1, 'success'), status: 'in_progress' };
  const own = { ...run(OWN, 'skipped'), id: OWN, status: 'in_progress' };
  const { fetch, calls } = api([[going, own], [going, own], [done, own]]);
  const c = clock();
  const logs = [];
  const runs = await readRuns({ repo: REPO, run: OWN, sha: SHA, waitMs: 60 * 60_000,
    pollMs: 30_000, fetch, retryDelayMs: 0, ...c, log: (s) => logs.push(s) });
  assert.deepEqual(runs.map((r) => r.id), [1], 'this run is never waited for or read');
  assert.equal(c.now(), 60_000, 'two polls of 30 s');
  assert.equal(logs.filter((l) => /waiting for run 1 \(in_progress\)/.test(l)).length, 2);
  assert.equal(calls.filter((u) => /\/jobs\?/.test(u)).length, 1);
  assert.deepEqual(provenJobs(runs).proven, Object.keys(HEAVY));
});

test('readRuns gives up at its deadline, and an unreadable API is refused', async () => {
  const going = { ...run(1, 'success'), status: 'queued' };
  const c = clock();
  await assert.rejects(readRuns({ repo: REPO, run: OWN, sha: SHA, waitMs: 5 * 60_000,
    pollMs: 30_000, fetch: api([[going]]).fetch, retryDelayMs: 0, ...c }),
  /run 1 at c{40} still queued after 5 min/);
  assert.equal(c.now(), 5 * 60_000, 'the wait ends at the deadline, not later');
  const down = api([[]], { fail: true });
  await assert.rejects(readRuns({ repo: REPO, run: OWN, sha: SHA, waitMs: 1000, pollMs: 1000,
    fetch: down.fetch, retryDelayMs: 0, tries: 3, ...clock() }), /HTTP 502 after 3 tries/);
  assert.equal(down.calls.length, 3, 'each request is tried three times');
});

/** main() on an event payload; returns { status, out, err, output }. */
async function program(t, event, { pages = [[run(1, 'success')]], fail = false, args = [] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-body-edit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const eventPath = path.join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  const output = path.join(dir, 'output');
  writeFileSync(output, '');
  const out = [];
  const err = [];
  const stub = api(pages, { fail });
  const status = await main(['--event-path', eventPath, '--repo', REPO, '--run', String(OWN),
    '--output', output, ...args], { fetch: stub.fetch, env: {}, log: (s) => out.push(s),
    err: (s) => err.push(s), ...clock() });
  return { status, out: out.join('\n'), err: err.join('\n'),
    output: readFileSync(output, 'utf8'), calls: stub.calls };
}
const bodyEdit = { action: 'edited', changes: { body: { from: 'old' } },
  pull_request: { head: { sha: SHA } } };

test('the program: proven=<list> on a body edit, [] without a request on anything else',
  async (t) => {
    const all = await program(t, bodyEdit);
    assert.equal(all.status, 0, all.err);
    assert.equal(all.output, `proven=${JSON.stringify(Object.keys(HEAVY))}\n`);
    assert.match(all.out, /Browser gate \(webkit\): success \(run 1\)/);
    const red = await program(t, bodyEdit,
      { pages: [[run(1, 'success', { 'DSP, labs, sequencer (firefox)': 'failure' })]] });
    assert.equal(red.status, 0);
    assert.equal(red.output, `proven=${JSON.stringify(Object.keys(HEAVY)
      .filter((k) => k !== 'suites'))}\n`);
    assert.match(red.err, /::warning::ci-body-edit: not proven at c{40}: suites/);
    for (const event of [{ action: 'synchronize', pull_request: { head: { sha: SHA } } },
      { ...bodyEdit, changes: { base: { ref: { from: 'train/x' } } } }]) {
      const none = await program(t, event, { fail: true });
      assert.equal(none.status, 0, none.err);
      assert.equal(none.output, 'proven=[]\n');
      assert.deepEqual(none.calls, [], 'no request on an event that is not a body edit');
    }
  });

test('the program: exit 1 and no answer when the API cannot be read or the wait runs out',
  async (t) => {
    const down = await program(t, bodyEdit, { fail: true });
    assert.equal(down.status, 1);
    assert.equal(down.output, '', 'no answer: the gate has no proof');
    assert.match(down.err, /::error::ci-body-edit: .*HTTP 502/);
    const stuck = await program(t, bodyEdit, { pages: [[{ ...run(1, 'success'),
      status: 'in_progress' }]], args: ['--wait-minutes', '1'] });
    assert.equal(stuck.status, 1);
    assert.equal(stuck.output, '');
    assert.match(stuck.err, /still in_progress after 1 min/);
    const noSha = await program(t, { ...bodyEdit, pull_request: { head: {} } });
    assert.equal(noSha.status, 1);
    assert.match(noSha.err, /no head commit/);
    const bad = await program(t, bodyEdit, { args: ['--poll-seconds', '0'] });
    assert.equal(bad.status, 1);
    assert.match(bad.err, /positive integer/);
  });

test('the program imports nothing but node built-ins, so one extracted blob runs', () => {
  const text = readFileSync(PROGRAM, 'utf8');
  const imports = [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length);
  for (const m of imports) assert.match(m, /^node:/, m);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-body-edit-blob-'));
  try {
    const copy = path.join(dir, 'ci-body-edit.mjs');
    writeFileSync(copy, text);
    const eventPath = path.join(dir, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ action: 'opened' }));
    const r = spawnSync(process.execPath, [copy, '--event-path', eventPath],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /proven=\[\]/);
    const u = spawnSync(process.execPath, [copy, '--frobnicate'], { encoding: 'utf8' });
    assert.equal(u.status, 1);
    assert.match(u.stderr, /bad argument --frobnicate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
