// scripts/flake-ledger.mjs (plan issue E010): the ledger of CI checks that failed on an earlier
// attempt of a workflow run and passed on a re-run. The entries are checked on fixture API
// responses (a failed first attempt and a passing second, a first attempt alone, a job carried
// over by a re-run of the failed jobs, a job still failing, the gate still running), the reads
// against a stubbed fetch (pages, retries, an API that stays down), the program as the gate
// job runs it, and the gate job of ci.yml itself.
//   node --test tests/unit/flake-ledger.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import {
  CAUSES, UNCLASSIFIED, browserOf, formatLedger, ledger, readAttempts, runLedger,
} from '../../scripts/flake-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'flake-ledger.mjs');

const step = (name, conclusion) => ({ name, status: 'completed', conclusion });

/** A job as GET .../attempts/{n}/jobs lists it. */
function job(name, attempt, conclusion, steps = [], status = 'completed') {
  return {
    name, run_attempt: attempt, status, conclusion,
    html_url: `https://github.com/o/r/actions/runs/7/job/${attempt}${name.length}`, steps,
  };
}

const ENGINE = 'V1 engine checks against the V2 engine';
const FAILED_FIRST = {
  1: [
    job('unit, build, artifact rules', 1, 'success'),
    job('V1 engine (firefox)', 1, 'failure',
      [step('Install the browser', 'success'), step(ENGINE, 'failure')]),
    job('V1 engine (chromium)', 1, 'success'),
    job('gate', 1, 'failure', [step('Every release-gate job passed', 'failure')]),
  ],
  2: [
    // A re-run of the failed jobs lists the jobs it carried over with their earlier attempt.
    job('unit, build, artifact rules', 1, 'success'),
    job('V1 engine (firefox)', 2, 'success',
      [step('Install the browser', 'success'), step(ENGINE, 'success')]),
    job('V1 engine (chromium)', 1, 'success'),
    job('gate', 2, null, [], 'in_progress'),
  ],
};

test('a check that failed on the first attempt and passed on the second is one entry', () => {
  const entries = ledger({ attempts: FAILED_FIRST, current: 2 });
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.equal(e.check, `V1 engine (firefox) / ${ENGINE}`);
  assert.equal(e.job, 'V1 engine (firefox)');
  assert.deepEqual(e.steps, [ENGINE]);
  assert.equal(e.browser, 'firefox');
  assert.deepEqual([e.earlier.attempt, e.earlier.conclusion], [1, 'failure']);
  assert.deepEqual([e.now.attempt, e.now.conclusion], [2, 'success']);
  assert.deepEqual(e.failedAttempts, [1]);
  assert.equal(e.cause, UNCLASSIFIED);
});

test('a first attempt has no ledger', () => {
  assert.deepEqual(ledger({ attempts: { 1: FAILED_FIRST[1] }, current: 1 }), []);
});

test('a carried-over job, one still failing and the running gate are no entry', () => {
  const attempts = {
    1: [
      job('carried', 1, 'failure'),
      job('still failing (webkit)', 1, 'failure', [step('suite', 'failure')]),
      job('gate', 1, 'failure'),
    ],
    2: [
      // Listed as a success of attempt 1: it did not run again, so it did not pass on retry.
      { ...job('carried', 1, 'success') },
      job('still failing (webkit)', 2, 'failure', [step('suite', 'failure')]),
      job('gate', 2, null, [], 'in_progress'),
    ],
  };
  assert.deepEqual(ledger({ attempts, current: 2 }), []);
});

test('a timed-out job is a failure; two failed attempts before the pass are both named', () => {
  const attempts = {
    1: [job('studio (webkit)', 1, 'timed_out', [step('Studio suite', 'cancelled')])],
    2: [job('studio (webkit)', 2, 'failure', [step('Studio suite', 'failure')])],
    3: [job('studio (webkit)', 3, 'success', [step('Studio suite', 'success')])],
  };
  const [e] = ledger({ attempts, current: 3 });
  assert.equal(e.check, 'studio (webkit) / Studio suite');
  assert.deepEqual(e.failedAttempts, [1, 2]);
  assert.deepEqual([e.earlier.attempt, e.earlier.conclusion], [2, 'failure']);
  // A job that timed out with no failed step is named by the job alone.
  const [t] = ledger({ attempts: { 1: attempts[1], 2: attempts[3].map((j) => ({ ...j,
    run_attempt: 2 })) }, current: 2 });
  assert.equal(t.check, 'studio (webkit)');
  assert.deepEqual(t.steps, []);
});

test('browserOf reads the matrix leg from the job name', () => {
  assert.equal(browserOf('DSP, labs, sequencer (chromium)'), 'chromium');
  assert.equal(browserOf('V1 engine (webkit)'), 'webkit');
  assert.equal(browserOf('unit, build, artifact rules'), null);
  assert.equal(browserOf('fail-first (feat/fix tests fail without the change)'), null);
});

test('the Markdown names every entry and the cause classes, or says there is none', () => {
  const md = formatLedger(ledger({ attempts: FAILED_FIRST, current: 2 }), { run: 7, current: 2 });
  assert.match(md, /^### Flake ledger \(run 7, attempt 2\)/);
  assert.match(md, new RegExp(`\\| V1 engine \\(firefox\\) / ${ENGINE} \\| firefox \\| 1: failure `
    + '\\| 2: success \\| unclassified \\|'));
  for (const c of CAUSES) assert.ok(md.includes(c), c);
  assert.match(formatLedger([], { run: 7, current: 2 }), /No check that failed/);
});

/** A fetch over fixture attempts, paged by per_page/page, failing the first `flaky` calls. */
function stubFetch(attempts, { flaky = 0, down = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (down || calls.length <= flaky) return { ok: false, status: 502, json: async () => ({}) };
    const u = new URL(url);
    const n = Number(/attempts\/(\d+)\/jobs/.exec(u.pathname)[1]);
    const per = Number(u.searchParams.get('per_page'));
    const page = Number(u.searchParams.get('page'));
    const all = attempts[n] ?? [];
    return {
      ok: true, status: 200,
      json: async () => ({
        total_count: all.length, jobs: all.slice((page - 1) * per, page * per),
      }),
    };
  };
  return { fetch, calls };
}

test('readAttempts reads every attempt, with the token, through every page', async () => {
  const many = { 1: Array.from({ length: 150 }, (_, i) => job(`j${i}`, 1, 'success')), 2: [] };
  const { fetch, calls } = stubFetch(many);
  const attempts = await readAttempts({ repo: 'o/r', run: 7, current: 2, fetch, token: 't' });
  assert.equal(attempts[1].length, 150);
  assert.equal(attempts[2].length, 0);
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname + new URL(c.url).search), [
    '/repos/o/r/actions/runs/7/attempts/1/jobs?per_page=100&page=1',
    '/repos/o/r/actions/runs/7/attempts/1/jobs?per_page=100&page=2',
    '/repos/o/r/actions/runs/7/attempts/2/jobs?per_page=100&page=1',
  ]);
  assert.equal(calls[0].init.headers.authorization, 'Bearer t');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'every request is bounded');
});

test('a failed request is retried; an API that stays down refuses', async () => {
  const flaky = stubFetch(FAILED_FIRST, { flaky: 1 });
  const ok = await readAttempts({ repo: 'o/r', run: 7, current: 2, fetch: flaky.fetch,
    retryDelayMs: 0 });
  assert.equal(ok[2].length, 4);
  const down = stubFetch(FAILED_FIRST, { down: true });
  await assert.rejects(
    readAttempts({ repo: 'o/r', run: 7, current: 2, fetch: down.fetch, tries: 3, retryDelayMs: 0 }),
    /HTTP 502 after 3 tries/,
  );
  assert.equal(down.calls.length, 3);
});

test('runLedger writes the JSON ledger on a re-run and nothing on a first attempt', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flake-ledger-'));
  try {
    const out = path.join(dir, 'flake-ledger.json');
    const first = stubFetch(FAILED_FIRST);
    assert.equal(await runLedger({ repo: 'o/r', run: 7, current: 1, out, fetch: first.fetch }),
      null);
    assert.equal(existsSync(out), false);
    assert.equal(first.calls.length, 0, 'a first attempt reads nothing');

    const { fetch } = stubFetch(FAILED_FIRST);
    const r = await runLedger({ repo: 'o/r', run: 7, current: 2, out, fetch });
    assert.equal(r.entries.length, 1);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(json.schema, 'flake-ledger/v1');
    assert.deepEqual([json.run, json.attempt], [7, 2]);
    assert.equal(json.entries[0].check, `V1 engine (firefox) / ${ENGINE}`);
    assert.equal(json.entries[0].earlier.conclusion, 'failure');
    assert.equal(json.entries[0].now.conclusion, 'success');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function run(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('the program on a first attempt prints and writes nothing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flake-ledger-'));
  try {
    const out = path.join(dir, 'flake-ledger.json');
    const r = run('--repo', 'o/r', '--run', '7', '--attempt', '1', '--out', out);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out, '');
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the program refuses a missing or malformed argument with exit 2', () => {
  assert.equal(run('--run', '7', '--attempt', '2').status, 2);
  assert.equal(run('--repo', 'o/r', '--run', '7', '--attempt', 'two').status, 2);
  assert.equal(run('--repo', 'o/r', '--run', '0', '--attempt', '2').status, 2);
  assert.equal(run('--repo', 'not a slug', '--run', '7', '--attempt', '2').status, 2);
  assert.equal(run('--repo', 'o/r', '--run', '7', '--attempt', '2', '--bogus').status, 2);
  assert.equal(run('--help').status, 0);
});

test('the gate job records the ledger only on a re-run, before its verdict', () => {
  const ci = parseYaml(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const gate = ci.jobs.gate;
  assert.deepEqual(gate.permissions, { contents: 'read', actions: 'read' });
  const steps = gate.steps;
  const ledgerAt = steps.findIndex((s) => /scripts\/flake-ledger\.mjs/.test(s.run ?? ''));
  const verdictAt = steps.findIndex((s) => s.name === 'Every release-gate job passed');
  assert.ok(ledgerAt >= 0 && verdictAt > ledgerAt, 'the ledger runs before the verdict');
  const s = steps[ledgerAt];
  assert.match(s.run, /--attempt "\$GITHUB_RUN_ATTEMPT"/);
  assert.match(s.run, /--out flake-ledger\.json/);
  assert.match(s.run, /GITHUB_STEP_SUMMARY/);
  assert.ok(Number(s['timeout-minutes']) > 0);
  // Everything before the verdict runs only on a re-run; the verdict always runs.
  for (const before of steps.slice(0, verdictAt)) {
    assert.match(String(before.if), /fromJSON\(github\.run_attempt\) > 1/,
      before.name ?? before.uses);
  }
  assert.equal(steps[verdictAt].if, undefined);
  const upload = steps.find((x) => /upload-artifact/.test(x.uses ?? ''));
  assert.equal(upload.with.name, 'flake-ledger');
  assert.equal(upload.with.path, 'flake-ledger.json');
});
