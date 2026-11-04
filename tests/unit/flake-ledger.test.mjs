// scripts/flake-ledger.mjs (plan issue E010): the ledger of CI checks that failed on an earlier
// attempt of a workflow run and passed on a re-run. The entries are checked on fixture API
// responses (a failed first attempt and a passing second, a job that passed on both, a first
// attempt alone, a job carried over by a re-run of the failed jobs, a job still failing, the
// gate still running, a later re-run of a job that already passed), the reads against a stubbed
// fetch (pages, retries, an API that stays down), the program as the flake-ledger job runs it,
// and the two jobs of ci.yml themselves: the ledger is its own job, never path gated, and the
// gate's verdict, run as ci.yml states it, drops the ledger's entry before E026's path-gated
// rule, so it is the same whatever the ledger job's result, a skip included.
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
    job('V1 engine (webkit)', 1, 'success'),
    job('gate', 1, 'failure', [step('Every release-gate job passed', 'failure')]),
  ],
  2: [
    // A re-run of the failed jobs lists the jobs it carried over with their earlier attempt.
    job('unit, build, artifact rules', 1, 'success'),
    job('V1 engine (firefox)', 2, 'success',
      [step('Install the browser', 'success'), step(ENGINE, 'success')]),
    job('V1 engine (chromium)', 1, 'success'),
    // A re-run of all jobs runs this one again: it passed on both attempts, so it is no flake.
    job('V1 engine (webkit)', 2, 'success'),
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

test('a job that passed on every attempt it ran is no entry (R-2)', () => {
  const attempts = {
    1: [job('studio (webkit)', 1, 'success'), job('studio (firefox)', 1, 'success')],
    2: [job('studio (webkit)', 2, 'success'), job('studio (firefox)', 2, 'success')],
  };
  assert.deepEqual(ledger({ attempts, current: 2 }), []);
  assert.deepEqual(ledger({ attempts: FAILED_FIRST, current: 2 }).map((e) => e.job),
    ['V1 engine (firefox)']);
});

test('a job is judged against its own last earlier run, so a pass is recorded once (R-3)', () => {
  // Attempt 2 re-ran the failed job and it passed; attempt 3 re-ran every job.
  const failPassPass = {
    1: [job('suites (webkit)', 1, 'failure', [step('DSP suite', 'failure')])],
    2: [job('suites (webkit)', 2, 'success')],
    3: [job('suites (webkit)', 3, 'success')],
  };
  assert.equal(ledger({ attempts: failPassPass, current: 2 }).length, 1);
  assert.deepEqual(ledger({ attempts: failPassPass, current: 3 }), []);
  // Carried over by attempt 2 (listed with run_attempt 1), its last earlier run is attempt 1.
  const carried = {
    1: [job('suites (webkit)', 1, 'failure', [step('DSP suite', 'failure')])],
    2: [job('suites (webkit)', 1, 'failure', [step('DSP suite', 'failure')])],
    3: [job('suites (webkit)', 3, 'success')],
  };
  const [c] = ledger({ attempts: carried, current: 3 });
  assert.deepEqual([c.earlier.attempt, c.failedAttempts], [1, [1]]);
  // An earlier failure before a pass is history, not this attempt's flake.
  const passFailPass = {
    1: [job('suites (webkit)', 1, 'failure')],
    2: [job('suites (webkit)', 2, 'success')],
    3: [job('suites (webkit)', 3, 'failure', [step('DSP suite', 'failure')])],
    4: [job('suites (webkit)', 4, 'success')],
  };
  const [p] = ledger({ attempts: passFailPass, current: 4 });
  assert.deepEqual([p.earlier.attempt, p.failedAttempts, p.steps], [3, [3], ['DSP suite']]);
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

test('a skipped job is no failure: a path-gated skip before or after a run is no entry', () => {
  // E026 skips the path-gated jobs on a non-runtime change, and the ledger itself is skipped
  // on a first attempt: neither skip is a failure, so neither makes a pass a flake.
  const attempts = {
    1: [
      job('V1 engine (webkit)', 1, 'skipped'),
      job('studio (firefox)', 1, 'failure', [step('Studio suite', 'failure')]),
      job('flake ledger (checks that passed only on a re-run)', 1, 'skipped'),
    ],
    2: [
      job('V1 engine (webkit)', 2, 'success'),
      job('studio (firefox)', 2, 'skipped'),
      job('flake ledger (checks that passed only on a re-run)', 2, null, [], 'in_progress'),
    ],
  };
  assert.deepEqual(ledger({ attempts, current: 2 }), []);
  // A skip between a failure and the pass does not hide the failure behind it either: the
  // job's last earlier run is the skip, which is no failure, so the pass is no flake.
  const between = {
    1: [job('suites (webkit)', 1, 'failure', [step('DSP suite', 'failure')])],
    2: [job('suites (webkit)', 2, 'skipped')],
    3: [job('suites (webkit)', 3, 'success')],
  };
  assert.deepEqual(ledger({ attempts: between, current: 3 }), []);
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
  assert.equal(ok[2].length, 5);
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

const CI_TEXT = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const CI = parseYaml(CI_TEXT);
const GATE = CI.jobs.gate;
const LEDGER_JOB = 'flake-ledger';
const VERDICT_STEP = 'Every release-gate job passed, or was skipped for a non-runtime change';
/** E026's path-gated jobs, as the verdict lists them (tests/unit/ci-changes.test.mjs). */
const PATH_GATED = ['engine', 'suites', 'measure', 'studio', 'browser', 'visual'];
const LEDGER_IF = '${{ always() && fromJSON(github.run_attempt) > 1 }}';

test('the ledger is its own job, after every judged job, on a re-run only (R-1, R-4)', () => {
  const fl = CI.jobs[LEDGER_JOB];
  assert.ok(fl, `ci.yml has a ${LEDGER_JOB} job`);
  // A step of the gate that fails fails the gate, whatever its verdict, and project.ci-bounded
  // forbids continue-on-error: so the gate runs its verdict and nothing else, and reads nothing.
  assert.deepEqual(GATE.steps.map((s) => s.name ?? s.uses), [VERDICT_STEP]);
  assert.equal(GATE.permissions, undefined);
  assert.ok(GATE.needs.includes(LEDGER_JOB), 'gate needs every job (project.ci-bounded)');
  // The ledger runs when every job the gate judges has finished, whether or not they passed,
  // and is never path gated: its condition is exactly this, whatever `changes` said.
  assert.equal(fl.if, LEDGER_IF);
  assert.deepEqual([...fl.needs].sort(), GATE.needs.filter((j) => j !== LEDGER_JOB).sort());
  assert.ok(fl.needs.includes('changes') && fl.needs.includes('census'),
    'the ledger waits for every job the gate judges, changes and census included');
  assert.deepEqual(fl.permissions, { contents: 'read', actions: 'read' });
  assert.ok(Number(fl['timeout-minutes']) > 0);
  const s = fl.steps.find((x) => /scripts\/flake-ledger\.mjs/.test(x.run ?? ''));
  assert.match(s.run, /--attempt "\$GITHUB_RUN_ATTEMPT"/);
  assert.match(s.run, /--out flake-ledger\.json/);
  assert.match(s.run, /GITHUB_STEP_SUMMARY/);
  assert.equal(s.env.GH_TOKEN, '${{ github.token }}');
  assert.ok(Number(s['timeout-minutes']) > 0);
  const upload = fl.steps.find((x) => /upload-artifact/.test(x.uses ?? ''));
  // One artifact per attempt: a second re-run's upload does not collide with the first's.
  assert.equal(upload.with.name, 'flake-ledger-${{ github.run_attempt }}');
  assert.equal(upload.with.path, 'flake-ledger.json');
});

/** The exit status of a gate's verdict step, run as ci.yml states it (its env), over `needs`. */
function verdict(needs, gate = GATE) {
  const step = gate.steps.find((s) => s.name === VERDICT_STEP);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
    encoding: 'utf8',
    env: { ...process.env, ...step.env, RESULTS: JSON.stringify(needs) },
  });
  assert.equal(r.error, undefined, 'bash and jq run');
  return r.status;
}

/**
 * Every way a gate's verdict lets the ledger decide it: for each ledger result, on a runtime
 * change (every job ran) and on a non-runtime one (the path-gated jobs skipped), the verdict
 * must pass when every judged job did, and fail when any judged job failed, was cancelled or
 * was skipped where a skip is not allowed (each judged job in turn, unless `perJob` is false).
 * Empty when the ledger never decides.
 */
function ledgerDecides(gate = GATE, { perJob = true } = {}) {
  const judged = gate.needs.filter((j) => j !== LEDGER_JOB);
  const found = [];
  for (const runtime of ['true', 'false']) {
    const ok = Object.fromEntries(judged.map((j) => [j, {
      result: runtime === 'false' && PATH_GATED.includes(j) ? 'skipped' : 'success',
      outputs: j === 'changes' ? { runtime } : {},
    }]));
    for (const ledgerResult of ['success', 'failure', 'cancelled', 'skipped']) {
      const needs = { ...ok, [LEDGER_JOB]: { result: ledgerResult, outputs: {} } };
      const where = `runtime=${runtime}, ledger ${ledgerResult}`;
      if (verdict(needs, gate) !== 0) found.push(`every judged job passed, ${where}: fails`);
      for (const j of perJob ? judged : []) {
        for (const bad of ['failure', 'cancelled', 'skipped']) {
          // a path-gated job's skip on runtime=false is E026's, and passes
          if (bad === 'skipped' && runtime === 'false' && PATH_GATED.includes(j)) continue;
          // body-edit runs on an edit of the body only (R030): its skip on any other event
          // passes and proves nothing (tests/unit/ci-workflows.test.mjs)
          if (bad === 'skipped' && j === 'body-edit') continue;
          const status = verdict({ ...needs, [j]: { ...needs[j], result: bad } }, gate);
          if (status !== 1) found.push(`${j} ${bad}, ${where}: exit ${status}`);
        }
      }
    }
  }
  return found;
}

test('the gate verdict is the same whatever the ledger job did, skipped or not (R-1)', () => {
  assert.deepEqual(ledgerDecides(), []);
});

/** ci.yml's gate after exact edits, re-read; each edit must apply exactly once. */
function mutatedGate(...edits) {
  let text = CI_TEXT;
  for (const [from, to] of edits) {
    const parts = text.split(from);
    assert.equal(parts.length, 2, `the mutation target occurs once: ${from}`);
    text = parts.join(to);
  }
  return parseYaml(text).jobs.gate;
}

test('mutation: a verdict that judges the ledger, or reads its skip as E026\'s, is caught', () => {
  const exclusion = ['            | map(select(.key != "flake-ledger"))\n', ''];
  // The ledger's entry kept: its skip on a first attempt, and any failure of it, fail the gate.
  const kept = ledgerDecides(mutatedGate(exclusion), { perJob: false });
  assert.ok(kept.some((f) => /runtime=true, ledger skipped: fails/.test(f)), kept.join('\n'));
  assert.ok(kept.some((f) => /runtime=false, ledger skipped: fails/.test(f)), kept.join('\n'));
  assert.ok(kept.some((f) => /ledger failure: fails/.test(f)), kept.join('\n'));
  // The ledger listed among the path-gated jobs instead of dropped: its skip then counts as
  // E026's and needs runtime=false, and its failure still fails the gate.
  const list = '["engine", "suites", "measure", "studio", "browser", "visual"]';
  const listed = ledgerDecides(mutatedGate(exclusion,
    [list, list.replace(']', ', "flake-ledger"]')]), { perJob: false });
  assert.ok(listed.some((f) => /runtime=true, ledger skipped: fails/.test(f)), listed.join('\n'));
  assert.ok(!listed.some((f) => /runtime=false, ledger skipped: fails/.test(f)),
    'on runtime=false the listed ledger\'s skip passes as a path-gated one');
  assert.ok(listed.some((f) => /ledger failure: fails/.test(f)), listed.join('\n'));
});
