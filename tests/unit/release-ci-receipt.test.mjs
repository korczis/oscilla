// ADR 0082, rule project.release-receipt-binds-gate v3: the CI receipt. The CI run of the
// release pull request is the gate verdict only for main's HEAD whose tree that run tested,
// on its newest run and latest attempt, with every job ci.yml declares green: the job set is
// the base's ci.yml, read from the merge's first parent (R037), plus what the release tree's
// own copy adds.
//   node --test tests/unit/release-ci-receipt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CI_WORKFLOW, GH_ATTEMPTS, GH_TIMEOUT_MS, RERUN_ONLY_IF, ciReceiptProblems, expectedJobs,
  gatherCiReceipt, judgedRun,
} from '../../scripts/release-ci-receipt.mjs';
import { gateVerdict } from '../../scripts/release-publish.mjs';
import * as prep from '../../scripts/release-prepare.mjs';

const CI_TEXT = readFileSync(new URL(`../../${CI_WORKFLOW}`, import.meta.url), 'utf8');
const WORKFLOW = expectedJobs(CI_TEXT);
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PR = 'c'.repeat(40);
const TREE = 'd'.repeat(40);

const pull = (over = {}) => ({ number: 382, head: { sha: PR, ref: 'chore/release-v9.9.9' },
  base: { ref: 'main' }, merge_commit_sha: HEAD, ...over });
const run = (over = {}) => ({ id: 900, name: WORKFLOW.name, event: 'pull_request', head_sha: PR,
  head_branch: 'chore/release-v9.9.9',
  status: 'completed', conclusion: 'success', run_attempt: 1,
  created_at: '2026-11-02T10:00:00Z', ...over });
const jobsOf = (r, names = WORKFLOW.jobs) => names.map((name, i) => ({ id: i + 1, name,
  run_id: r.id, head_sha: PR, status: 'completed', conclusion: 'success',
  run_attempt: r.run_attempt }));

// workflow: the release tree's ci.yml (HEAD's); baseWorkflow: the base's, read from the merge's
// first parent (R037). A release that changes no workflow has the same copy on both.
function facts(over = {}) {
  const r = run();
  return { head: HEAD, parents: [BASE, PR], headTree: TREE, prTree: TREE, baseInPr: true,
    workflow: WORKFLOW, baseWorkflow: WORKFLOW, pulls: [pull()], runs: [r], jobs: jobsOf(r),
    roadmap: true, ...over };
}

const only = (f, re) => {
  const problems = ciReceiptProblems(f);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], re);
};

test('the job list is derived from ci.yml: every matrix value, the visual gate, doctor, gate',
  () => {
  assert.deepEqual(WORKFLOW.problems, []);
  assert.equal(WORKFLOW.name, 'CI');
  for (const b of ['chromium', 'firefox', 'webkit']) {
    assert.ok(WORKFLOW.jobs.includes(`Browser leg 1 (${b})`), b);
    assert.ok(WORKFLOW.jobs.includes(`Browser leg 2 (${b})`), b);
  }
  // ci-speed: a matrix that leaves a value out has no job of it (chromium takes two legs)
  assert.ok(WORKFLOW.jobs.includes('Browser leg 3 (webkit)'));
  assert.ok(!WORKFLOW.jobs.includes('Browser leg 3 (chromium)'));
  assert.ok(WORKFLOW.jobs.includes('Visual regression gate'));
  assert.ok(WORKFLOW.jobs.includes('gate'));
  assert.ok(WORKFLOW.jobs.some((j) => j.startsWith('.ai layer (majordomus doctor')));
  assert.ok(!WORKFLOW.jobs.some((j) => j.includes('${{')), 'no unexpanded matrix slot');
  const multi = expectedJobs('name: X\njobs:\n  a:\n    name: A\n    strategy:\n      matrix:\n'
    + '        os: [l, m]\n        b: [c, d]\n');
  assert.match(multi.problems.join(), /cannot be expanded/);
});

test('a green newest run of the merged pull request head, on the same tree, verifies', () => {
  assert.deepEqual(ciReceiptProblems(facts()), []);
  assert.equal(judgedRun(facts()).id, 900);
});

test('main holds more than CI tested: another tree refuses', () => {
  only(facts({ headTree: 'e'.repeat(40) }), /tree of HEAD .* != the tree of the pull request head/);
  only(facts({ prTree: null }), /could not be read/);
});

test('HEAD that is not the merge of a pull request refuses', () => {
  assert.match(ciReceiptProblems(facts({ parents: [BASE] })).join(), /not the merge commit/);
  assert.match(ciReceiptProblems(facts({ parents: null })).join(), /unread/);
});

test('a pull request head that did not contain its base refuses (CI tested another merge)', () => {
  only(facts({ baseInPr: false }), /does not contain the base/);
  only(facts({ baseInPr: null }), /does not contain the base .*\(unread\)/);
});

test('a job missing, skipped, cancelled or from another run or sha refuses', () => {
  const r = run();
  const drop = jobsOf(r).filter((j) => j.name !== 'Visual regression gate');
  only(facts({ jobs: drop }), /no job "Visual regression gate"/);
  const skipped = jobsOf(r).map((j) => (j.name === 'Browser leg 3 (webkit)'
    ? { ...j, conclusion: 'skipped' } : j));
  only(facts({ jobs: skipped }), /job "Browser leg 3 \(webkit\)" of run 900 is completed\/skipped/);
  const cancelled = jobsOf(r).map((j) => (j.name === 'gate' ? { ...j, conclusion: 'cancelled' }
    : j));
  only(facts({ jobs: cancelled }), /job "gate" of run 900 is completed\/cancelled/);
  const otherSha = jobsOf(r).map((j) => (j.name === 'gate' ? { ...j, head_sha: HEAD } : j));
  only(facts({ jobs: otherSha }), /job "gate" ran on aaaaaaa in run 900, not on ccccccc/);
  const otherRun = jobsOf(r).map((j) => (j.name === 'gate' ? { ...j, run_id: 1 } : j));
  only(facts({ jobs: otherRun }), /job "gate" ran on .* in run 1, not on/);
  only(facts({ jobs: [...jobsOf(r), { ...jobsOf(r)[0], name: 'extra' }] }),
    /a job "extra" that .* does not declare/);
  only(facts({ jobs: null }), /jobs of run 900 could not be read/);
});

test('the flake ledger is the one re-run-only job, by its ci.yml condition (E010)', () => {
  assert.equal(WORKFLOW.rerunOnly.length, 1, WORKFLOW.rerunOnly.join());
  assert.match(WORKFLOW.rerunOnly[0], /flake ledger/i);
  assert.ok(CI_TEXT.includes(`if: ${RERUN_ONLY_IF}`), 'ci.yml carries the condition verbatim');
});

test('a first attempt with the flake ledger skipped by its own condition verifies', () => {
  const r = run({ run_attempt: 1 });
  const ledger = WORKFLOW.rerunOnly[0];
  const jobs = jobsOf(r).map((j) => (j.name === ledger ? { ...j, conclusion: 'skipped' } : j));
  assert.deepEqual(ciReceiptProblems(facts({ runs: [r], jobs })), []);
});

test('from the second attempt the flake ledger must succeed; any other skip still refuses', () => {
  const ledger = WORKFLOW.rerunOnly[0];
  const r2 = run({ run_attempt: 2 });
  const skipLedger = jobsOf(r2).map((j) => (j.name === ledger ? { ...j, conclusion: 'skipped' } : j));
  only(facts({ runs: [r2], jobs: skipLedger }), /flake ledger.*completed\/skipped/i);
  const r1 = run({ run_attempt: 1 });
  const other = WORKFLOW.jobs.find((n) => n !== ledger && /Browser leg/.test(n));
  const skipOther = jobsOf(r1).map((j) => (j.name === other ? { ...j, conclusion: 'skipped' } : j));
  only(facts({ runs: [r1], jobs: skipOther }), /Browser leg.*completed\/skipped/);
});

test('mutation-proven guard: on attempt 1 a cancelled, failed or running ledger refuses (#417 R1)',
  () => {
  const ledger = WORKFLOW.rerunOnly[0];
  const r1 = run({ run_attempt: 1 });
  for (const [status, conclusion] of [['completed', 'cancelled'], ['completed', 'failure'],
    ['in_progress', null], ['completed', 'timed_out']]) {
    const jobs = jobsOf(r1).map((j) => (j.name === ledger ? { ...j, status, conclusion } : j));
    only(facts({ runs: [r1], jobs }), new RegExp(`flake ledger.*${status}/${conclusion}`, 'i'));
  }
});

test('from attempt 3 too the ledger must succeed; a carried skip stamped later refuses (#417 R5, R7)',
  () => {
  const ledger = WORKFLOW.rerunOnly[0];
  const r3 = run({ run_attempt: 3 });
  const skip3 = jobsOf(r3).map((j) => (j.name === ledger ? { ...j, conclusion: 'skipped' } : j));
  only(facts({ runs: [r3], jobs: skip3 }), /flake ledger.*completed\/skipped/i);
  // GitHub re-stamps a job it carries over with the run's attempt (#417 review R7): a ledger
  // skipped on attempt 1 and carried into attempt 2 arrives stamped 2, and refuses; a release
  // run re-runs all its jobs, so this fails closed rather than verifying a partial re-run
  const r2 = run({ run_attempt: 2 });
  const carried = jobsOf(r2).map((j) => (j.name === ledger
    ? { ...j, conclusion: 'skipped', run_attempt: 2 } : j));
  only(facts({ runs: [r2], jobs: carried }), /flake ledger.*completed\/skipped/i);
  // a job object with no run_attempt falls back to the run's attempt (#417 R8)
  const noAttempt = jobsOf(run({ run_attempt: 1 })).map((j) => (j.name === ledger
    ? { ...j, conclusion: 'skipped', run_attempt: undefined } : j));
  assert.deepEqual(ciReceiptProblems(facts({ runs: [run({ run_attempt: 1 })], jobs: noAttempt })),
    []);
});

const wf = (ledgerJob) => `name: CI\njobs:\n  unit:\n    runs-on: x\n${ledgerJob}`;
test('only exactly that condition, on the job id flake-ledger, is re-run-only (#417 R3, R4)', () => {
  const exact = `  flake-ledger:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`;
  assert.deepEqual(expectedJobs(wf(exact)).problems, []);
  assert.deepEqual(expectedJobs(wf(exact)).rerunOnly, ['flake-ledger']);
  const nearMisses = [
    '  flake-ledger:\n    if: always() && fromJSON(github.run_attempt) > 1\n    runs-on: x\n',
    '  flake-ledger:\n    if: ${{ always() && fromJSON(github.run_attempt) > 0 }}\n    runs-on: x\n',
    '  flake-ledger:\n    if: ${{ always() &&  fromJSON(github.run_attempt) > 1 }}\n    runs-on: x\n',
    `  flake-ledger:\n    runs-on: x\n    steps:\n      - if: ${RERUN_ONLY_IF}\n        run: x\n`,
    `  flake-ledger:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n    strategy:\n      matrix:\n`
      + '        browser: [webkit]\n',
  ];
  for (const job of nearMisses) {
    const w = expectedJobs(wf(job));
    assert.deepEqual(w.rerunOnly, [], job);
    assert.ok(w.problems.some((p) => /exactly one re-run-only job/.test(p)), job);
  }
  const renamed = `  other-job:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`;
  assert.ok(expectedJobs(wf(renamed)).problems.some((p) => /id flake-ledger \(found: other-job/
    .test(p)));
  const two = `${exact}  second-ledger:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`;
  assert.ok(expectedJobs(wf(two)).problems.some((p) => /exactly one re-run-only job/.test(p)));
  assert.deepEqual(expectedJobs(wf(two)).rerunOnly, []);
  const twin = `  flake-ledger:\n    name: unit\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`;
  assert.ok(expectedJobs(wf(twin)).problems.some((p) => /two jobs named "unit"/.test(p)));
});

test('the run is on another sha, or none: refuses', () => {
  only(facts({ runs: [run({ head_sha: HEAD })] }), /no CI pull_request run on ccccccc/);
  only(facts({ runs: [run({ event: 'push' })] }), /no CI pull_request run/);
  only(facts({ runs: [run({ name: 'Pages' })] }), /no CI pull_request run/);
  only(facts({ runs: null }), /pull_request runs of ccccccc could not be read/);
});

test('only the newest run counts, on its latest attempt', () => {
  const green = run({ id: 900, created_at: '2026-11-02T10:00:00Z' });
  const newerRed = run({ id: 901, created_at: '2026-11-02T11:00:00Z', conclusion: 'failure' });
  // an older green run never stands in for a newer red one
  assert.match(ciReceiptProblems(facts({ runs: [green, newerRed], jobs: jobsOf(newerRed) }))
    .join(), /newest CI run 901 .* is completed\/failure/);
  const running = run({ id: 902, created_at: '2026-11-02T12:00:00Z', status: 'in_progress',
    conclusion: null });
  assert.match(ciReceiptProblems(facts({ runs: [green, running], jobs: jobsOf(running) }))
    .join(), /newest CI run 902 .* is in_progress/);
  // the run object reports its latest attempt: red on attempt 2 refuses
  const reRunRed = run({ run_attempt: 2, conclusion: 'failure' });
  assert.match(ciReceiptProblems(facts({ runs: [reRunRed], jobs: jobsOf(reRunRed) })).join(),
    /\(attempt 2\) is completed\/failure/);
  // a re-run whose latest attempt is green verifies
  const reRunGreen = run({ run_attempt: 2 });
  assert.deepEqual(ciReceiptProblems(facts({ runs: [reRunGreen], jobs: jobsOf(reRunGreen) })),
    []);
});

test('the run is bound to the one pull request that merged as HEAD (review F1 of #389)', () => {
  // a second pull request from the same head (CI runs for pull requests into any branch)
  only(facts({ pulls: [pull(), pull({ number: 383, base: { ref: 'next' } })] }),
    /2 pull requests have the head ccccccc \(#382, #383\)/);
  only(facts({ pulls: [] }), /0 pull requests have the head ccccccc \(none\)/);
  only(facts({ pulls: null }), /pull requests of ccccccc could not be read/);
  only(facts({ pulls: [pull({ base: { ref: 'next' } })] }), /#382 is based on next, not main/);
  only(facts({ pulls: [pull({ merge_commit_sha: BASE })] }), /#382 merged as bbbbbbb, not as HEAD/);
  // a green run of the same head from another branch never stands in
  only(facts({ runs: [run({ head_branch: 'other' })] }),
    /no CI pull_request run on ccccccc from chore\/release-v9\.9\.9/);
  const mine = run({ id: 900, created_at: '2026-11-02T10:00:00Z', conclusion: 'failure' });
  const theirs = run({ id: 950, created_at: '2026-11-02T11:00:00Z', head_branch: 'other' });
  assert.equal(judgedRun(facts({ runs: [mine, theirs] })).id, 900);
  assert.match(ciReceiptProblems(facts({ runs: [mine, theirs], jobs: jobsOf(mine) })).join(),
    /run 900 .* is completed\/failure/);
});

test('a workflow that names no jobs, or no name, refuses (review F2 of #389)', () => {
  assert.deepEqual(expectedJobs('name: X\njobs: {}\n').problems,
    [`${CI_WORKFLOW} declares no jobs`]);
  const unnamed = { name: null, jobs: WORKFLOW.jobs, problems: [] };
  only(facts({ workflow: unnamed, runs: [run({ name: null })] }),
    /has no workflow name to find its runs by/);
  const broken = { ...WORKFLOW, problems: [`${CI_WORKFLOW} does not parse: x`] };
  only(facts({ workflow: broken }), /does not parse/);
});

test('the roadmap check CI does not run is still required', () => {
  only(facts({ roadmap: false }), /roadmap does not match the plan/);
});

test('publish: a verified local receipt needs no CI; otherwise the CI receipt decides', () => {
  assert.deepEqual(gateVerdict([], null), { problems: [], by: 'local release-gate receipt' });
  assert.deepEqual(gateVerdict(['no release-gate receipt'], null).problems,
    ['no release-gate receipt']);
  const ok = gateVerdict(['no release-gate receipt'], facts());
  assert.deepEqual(ok.problems, []);
  assert.match(ok.by, /CI receipt: run 900 attempt 1 on the pull request head ccccccc/);
  const bad = gateVerdict(['no release-gate receipt'], facts({ baseInPr: false }));
  assert.deepEqual(bad.problems[0], 'no release-gate receipt');
  assert.match(bad.problems[1], /^CI receipt: .*does not contain the base/);
});

test('gatherCiReceipt reads parents, trees, ancestry, the runs and the latest jobs', () => {
  const r = run();
  const calls = [];
  const sh = (cmd, args, opts) => {
    calls.push([cmd, ...args, opts?.env?.OSC_ROADMAP_CHECK || '']);
    if (args[0] === 'rev-list') return { status: 0, stdout: `${HEAD} ${BASE} ${PR}` };
    if (args[0] === 'rev-parse') return { status: 0, stdout: TREE };
    if (args[0] === 'merge-base') return { status: 0, stdout: '' };
    if (args[0] === 'show') return { status: 0, stdout: CI_TEXT };
    if (cmd === 'node') return { status: 0, stdout: '' };
    if (args[0] === 'api' && /\/pulls\?/.test(args[1])) {
      return { status: 0, stdout: JSON.stringify([pull()]) };
    }
    if (args[0] === 'api' && /\/jobs\?filter=latest/.test(args[1])) {
      return { status: 0, stdout: JSON.stringify({ jobs: jobsOf(r) }) };
    }
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify({ workflow_runs: [r] }) };
    return { status: 1, stdout: '' };
  };
  const root = new URL('../..', import.meta.url).pathname;
  const f = gatherCiReceipt({ sh, root, head: HEAD });
  assert.deepEqual(ciReceiptProblems(f), []);
  assert.ok(calls.some((c) => c[0] === 'node' && c.at(-1) === '1'),
    'the roadmap check runs with OSC_ROADMAP_CHECK=1');
  // R037: the job set is read from the merge's first parent, never from the checkout alone
  assert.ok(calls.some((c) => c[0] === 'git' && c[1] === 'show' && c[2] === `${BASE}:${CI_WORKFLOW}`),
    'git show <first parent>:ci.yml');
  assert.deepEqual(f.baseWorkflow?.jobs, WORKFLOW.jobs);
  assert.ok(calls.some((c) => c[1] === 'api' && c[2].includes(`head_sha=${PR}`)
    && c[2].includes('event=pull_request')));
  // every GitHub read is bounded (review F3 of #389)
  const gh = calls.filter((c) => c[0] === 'gh');
  assert.equal(gh.length, 3, 'pulls, runs, jobs');
  // an unreadable answer is never an empty one, and each read is tried twice
  let tries = 0;
  const broken = gatherCiReceipt({ sh: (c, a, o) => {
    if (a[0] !== 'api') return sh(c, a, o);
    tries += 1;
    assert.equal(o?.timeout, GH_TIMEOUT_MS, 'a bounded read');
    return { status: 127, stdout: '' };
  }, root, head: HEAD });
  assert.match(ciReceiptProblems(broken).join(), /could not be read/);
  assert.equal(tries, 3 * GH_ATTEMPTS,
    'pulls, runs and the queue\'s runs (no pull request run verified), each tried twice');
  // a shape that is not the API's is unreadable too
  const odd = gatherCiReceipt({ sh: (c, a, o) => (a[0] === 'api'
    ? { status: 0, stdout: JSON.stringify({ workflow_runs: 'x', jobs: 'x' }) } : sh(c, a, o)),
  root, head: HEAD });
  assert.equal(odd.runs, null);
  assert.equal(odd.pulls, null);
});

// ADR 0083: a pull request that landed through the merge queue. main fast-forwarded to the
// queue's merge commit HEAD (parents: the earlier main BASE and the pull request head PR), and
// the queue's merge_group run tested HEAD itself (review of af, points 1-5).
const QREF = 'gh-readonly-queue/main/pr-382-cccccccccccccccccccccccccccccccccccccccc';
const qrun = (over = {}) => run({ id: 950, event: 'merge_group', head_sha: HEAD, head_branch: QREF,
  created_at: '2026-11-02T12:00:00Z', ...over });
const qjobs = (r, over = {}) => WORKFLOW.jobs.map((name, i) => ({ id: 100 + i, name, run_id: r.id,
  head_sha: r.head_sha, status: 'completed', conclusion: 'success', run_attempt: r.run_attempt,
  ...over }));
const queued = (over = {}) => {
  const q = qrun();
  return facts({ runs: [], jobs: null, queueRuns: [q], queueJobs: qjobs(q), ...over });
};

test('ADR 0083: a green merge_group run on HEAD itself, from the queue ref of that pull request,'
  + ' verifies', () => {
  assert.deepEqual(ciReceiptProblems(queued()), []);
  assert.equal(judgedRun(queued()).id, 950);
  // the pull request's own green run still verifies alone (a release outside the queue)
  assert.deepEqual(ciReceiptProblems(facts()), []);
});

test('ADR 0083 mutation: a merge_group run on another sha, or from another pull request\'s queue'
  + ' ref, refuses', () => {
  const other = qrun({ head_sha: 'e'.repeat(40) });
  assert.match(ciReceiptProblems(queued({ queueRuns: [other], queueJobs: qjobs(other) })).join(),
    /merge_group: no CI merge_group run on aaaaaaa/);
  const foreign = qrun({ head_branch: 'gh-readonly-queue/main/pr-999-cccc' });
  assert.match(ciReceiptProblems(queued({ queueRuns: [foreign], queueJobs: qjobs(foreign) }))
    .join(), /no CI merge_group run/);
  const red = qrun({ conclusion: 'failure' });
  assert.match(ciReceiptProblems(queued({ queueRuns: [red], queueJobs: qjobs(red) })).join(),
    /newest CI run 950 .* is completed\/failure/);
  // the newest queue run counts, on its latest attempt: an older green one does not stand in
  const older = qrun({ id: 940, created_at: '2026-11-02T11:00:00Z' });
  const newerRed = qrun({ id: 960, created_at: '2026-11-02T13:00:00Z', conclusion: 'failure' });
  assert.match(ciReceiptProblems(queued({ queueRuns: [older, newerRed],
    queueJobs: qjobs(newerRed) })).join(), /newest CI run 960/);
});

test('review F5 (r3, r6): the queue ref is anchored at both ends and names main', () => {
  for (const branch of [`x/${QREF}`, `refs/heads/${QREF}`, `${QREF}/x`, `${QREF}-x`,
    QREF.replace('/main/', '/other/'), QREF.replace('/main/', '/main/x/'),
    QREF.replace('pr-382-', 'pr-3820-'), QREF.replace('pr-382-', 'pr-38-')]) {
    const q = qrun({ head_branch: branch });
    const problems = ciReceiptProblems(queued({ queueRuns: [q], queueJobs: qjobs(q) }));
    const why = /merge_group: no CI merge_group run on aaaaaaa from gh-readonly-queue\/main\/pr-382-/;
    assert.match(problems.join(), why, branch);
  }
});

test('review F5 (r8): gatherCiReceipt reads the queue runs of HEAD itself, event merge_group',
  () => {
    const q = qrun();
    const calls = [];
    const sh = (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'rev-list') return { status: 0, stdout: `${HEAD} ${BASE} ${PR}` };
      if (args[0] === 'rev-parse') return { status: 0, stdout: TREE };
      if (args[0] === 'merge-base') return { status: 0, stdout: '' };
      if (args[0] === 'show') return { status: 0, stdout: CI_TEXT };
      if (cmd === 'node') return { status: 0, stdout: '' };
      if (args[0] !== 'api') return { status: 1, stdout: '' };
      assert.equal(opts?.timeout, GH_TIMEOUT_MS, 'a bounded read');
      const url = args[1];
      if (/\/pulls\?/.test(url)) return { status: 0, stdout: JSON.stringify([pull()]) };
      if (url === `repos/korczis/oscilla/actions/runs/${q.id}/jobs?filter=latest&per_page=100`) {
        return { status: 0, stdout: JSON.stringify({ jobs: qjobs(q) }) };
      }
      if (url === `repos/korczis/oscilla/actions/runs?head_sha=${HEAD}&event=merge_group`
        + '&per_page=100') {
        return { status: 0, stdout: JSON.stringify({ workflow_runs: [q] }) };
      }
      // the pull request's own runs: none, so the queue's are read
      if (/event=pull_request/.test(url)) return { status: 0, stdout: '{"workflow_runs":[]}' };
      return { status: 0, stdout: '{"workflow_runs":[]}' };
    };
    const root = new URL('../..', import.meta.url).pathname;
    const f = gatherCiReceipt({ sh, root, head: HEAD });
    assert.deepEqual(ciReceiptProblems(f), []);
    assert.equal(judgedRun(f).id, 950);
    const queueReads = calls.filter((c) => c[1] === 'api' && /event=merge_group/.test(c[2]));
    assert.deepEqual(queueReads.map((c) => c[2]),
      [`repos/korczis/oscilla/actions/runs?head_sha=${HEAD}&event=merge_group&per_page=100`]);
  });

test('ADR 0083 mutation: a queue group of two refuses (HEAD^1 is another pull request\'s queue'
  + ' commit)', () => {
  // the release pull request queued behind another: its queue commit's first parent is that
  // other pull request's queue commit, which the release head does not contain
  const problems = ciReceiptProblems(queued({ baseInPr: false, prTree: 'f'.repeat(40) }));
  assert.ok(problems.some((p) => /does not contain the base/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /main holds more than CI tested/.test(p)), problems.join('\n'));
});

test('ADR 0083 mutation: a skipped or missing job of the queue run refuses', () => {
  const q = qrun();
  const skipped = qjobs(q).map((j) => (j.name === 'review-verdict (guarded paths need a recorded'
    + ' review)' ? { ...j, conclusion: 'skipped' } : j));
  assert.match(ciReceiptProblems(queued({ queueJobs: skipped })).join(),
    /job "review-verdict .*" of run 950 is completed\/skipped/);
  const missing = qjobs(q).filter((j) => !j.name.startsWith('fail-first'));
  assert.match(ciReceiptProblems(queued({ queueJobs: missing })).join(),
    /run 950 has no job "fail-first/);
});

test('ADR 0083 with #417: on merge_group too only the flake ledger\'s own first attempt is'
  + ' excused', () => {
  const ledger = WORKFLOW.rerunOnly[0];
  const skipLedger = (r, over = {}) => qjobs(r).map((j) => (j.name === ledger
    ? { ...j, conclusion: 'skipped', ...over } : j));
  // attempt 1: the ledger skipped by its own condition verifies the queue run
  const q1 = qrun({ run_attempt: 1 });
  assert.deepEqual(ciReceiptProblems(queued({ queueRuns: [q1], queueJobs: skipLedger(q1) })), []);
  assert.equal(judgedRun(queued({ queueRuns: [q1], queueJobs: skipLedger(q1) })).id, 950);
  // attempt 2: it must succeed; skipped, or a carried skip stamped with attempt 2, refuses
  const q2 = qrun({ run_attempt: 2 });
  assert.match(ciReceiptProblems(queued({ queueRuns: [q2], queueJobs: skipLedger(q2) })).join(),
    /merge_group: job "flake ledger.*" of run 950 is completed\/skipped/i);
  assert.match(ciReceiptProblems(queued({ queueRuns: [q1],
    queueJobs: skipLedger(q1, { run_attempt: 2 }) })).join(), /flake ledger.*completed\/skipped/i);
  // a path-gated job (E026) skipped in the queue run is not excused: a browser leg, say
  const leg = WORKFLOW.jobs.find((n) => /Browser leg 3/i.test(n));
  assert.ok(leg, 'ci.yml declares a third browser leg');
  const skipLeg = qjobs(q1).map((j) => (j.name === leg ? { ...j, conclusion: 'skipped' }
    : j));
  assert.match(ciReceiptProblems(queued({ queueRuns: [q1], queueJobs: skipLeg })).join(),
    /merge_group: job "Browser leg 3.*" of run 950 is completed\/skipped/i);
});

test('ADR 0083 mutation: a pull_request run does not stand in when the queue commit\'s tree'
  + ' differs from the pull request head\'s', () => {
  assert.match(ciReceiptProblems(facts({ prTree: 'f'.repeat(40) })).join(),
    /main holds more than CI tested/);
});

test('release:prepare defaults to the CI path and keeps the full gate behind --local-gate', () => {
  const ci = prep.CI_PREPARE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.deepEqual(ci, ['node scripts/about-stations.mjs --stamp', 'node scripts/roadmap.mjs',
    'npm run build', 'npm run version:check', 'npm run verify']);
  const local = prep.GATE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.ok(local.includes('npm run release-gate'));
  assert.match(prep.USAGE, /--local-gate/);
});

// R037: the job set a run must carry is the base's ci.yml, the gate main had when the release
// branched, read from the merge's first parent; the release tree's own copy (the checkout's,
// after the merge) may add jobs beyond it but never drop one. Two small workflows: the base
// declares the visual gate, the release tree does not; or the release tree adds `extra`.
const LEDGER = `  flake-ledger:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`;
const VISUAL = '  visual:\n    name: Visual regression gate\n    runs-on: x\n';
const EXTRA = '  extra:\n    runs-on: x\n';
const SMALL = (jobs) => expectedJobs(`name: CI\njobs:\n  unit:\n    runs-on: x\n${LEDGER}${jobs}`);

test('R037: a job the first parent\'s ci.yml declares that the merge\'s own ci.yml and run lack'
  + ' refuses, naming it and the base', () => {
  const base = SMALL(VISUAL);
  const tree = SMALL('');
  assert.deepEqual([base.problems, tree.problems], [[], []]);
  const r = run();
  // the run is of the release tree's workflow, so it has exactly that copy's jobs
  const jobs = jobsOf(r, tree.jobs);
  only(facts({ workflow: tree, baseWorkflow: base, jobs }), new RegExp('run 900 has no job '
    + '"Visual regression gate" \\(\\.github/workflows/ci\\.yml of the base bbbbbbb '
    + 'declares it\\)'));
  // the same tree and run with a base that agrees verify
  assert.deepEqual(ciReceiptProblems(facts({ workflow: tree, baseWorkflow: tree, jobs })), []);
  // on merge_group too
  const q = qrun();
  const qj = tree.jobs.map((name, i) => ({ id: 100 + i, name, run_id: q.id, head_sha: q.head_sha,
    status: 'completed', conclusion: 'success', run_attempt: q.run_attempt }));
  assert.match(ciReceiptProblems(queued({ workflow: tree, baseWorkflow: base, queueRuns: [q],
    queueJobs: qj })).join(),
  /merge_group: run 950 has no job "Visual regression gate" .*base bbbbbbb/);
});

test('R037 superset: a job the release tree adds beyond the base verifies green and refuses red;'
  + ' a job neither copy declares refuses', () => {
  const base = SMALL('');
  const tree = SMALL(EXTRA);
  const r = run();
  const jobs = jobsOf(r, tree.jobs);
  assert.ok(jobs.some((j) => j.name === 'extra'), 'the run carries the added job');
  assert.deepEqual(ciReceiptProblems(facts({ workflow: tree, baseWorkflow: base, jobs })), []);
  const red = jobs.map((j) => (j.name === 'extra' ? { ...j, conclusion: 'failure' } : j));
  only(facts({ workflow: tree, baseWorkflow: base, jobs: red }),
    /job "extra" of run 900 is completed\/failure/);
  // an added job the run lacks still refuses, as today, naming the copy that declares it
  only(facts({ workflow: tree, baseWorkflow: base, jobs: jobs.filter((j) => j.name !== 'extra') }),
    /run 900 has no job "extra" \(\.github\/workflows\/ci\.yml declares it\)/);
  // a run job in neither copy is undeclared, however the two copies differ
  const alien = [...jobs, { ...jobs[0], id: 99, name: 'alien' }];
  only(facts({ workflow: tree, baseWorkflow: base, jobs: alien }), new RegExp('run 900 has a '
    + 'job "alien" that \\.github/workflows/ci\\.yml does not declare, at the base bbbbbbb or '
    + 'at HEAD'));
  // the ledger named by either copy keeps its first-attempt exemption
  const skipLedger = jobs.map((j) => (j.name === 'flake-ledger' ? { ...j, conclusion: 'skipped' }
    : j));
  assert.deepEqual(ciReceiptProblems(facts({ workflow: tree, baseWorkflow: base,
    jobs: skipLedger })), []);
});

test('R037: an unreadable or broken base ci.yml refuses, naming the base', () => {
  only(facts({ baseWorkflow: null }),
    /\.github\/workflows\/ci\.yml of the base bbbbbbb could not be read/);
  const broken = { ...WORKFLOW, problems: [`${CI_WORKFLOW} does not parse: x`] };
  only(facts({ baseWorkflow: broken }),
    /^base bbbbbbb: \.github\/workflows\/ci\.yml does not parse: x$/);
  const twoLedgers = expectedJobs(`name: CI\njobs:\n  unit:\n    runs-on: x\n${LEDGER}`
    + `  second-ledger:\n    if: ${RERUN_ONLY_IF}\n    runs-on: x\n`);
  assert.match(ciReceiptProblems(facts({ baseWorkflow: twoLedgers })).join('\n'),
    /^base bbbbbbb: .*exactly one re-run-only job/m);
});

// A real release merge on a throwaway repository: B (main, the base) declares `baseJobs`, H
// (the pull request head, a child of B) declares `headJobs`, and HEAD is the merge of B and H
// whose tree is H's. The checkout's ci.yml is therefore H's copy; the base's is only in git.
function mergeRepo(t, baseJobs, headJobs) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t',
    '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString().trim();
  const ci = (jobs) => `name: CI\njobs:\n  unit:\n    runs-on: x\n${LEDGER}${jobs}`;
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  git('init', '-q');
  git('checkout', '-q', '-b', 'main');
  writeFileSync(path.join(root, CI_WORKFLOW), ci(baseJobs));
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'ci: the base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(root, CI_WORKFLOW), ci(headJobs));
  // --allow-empty: a release tree that keeps the base's ci.yml is a head with the base's tree
  git('commit', '-q', '--no-verify', '--allow-empty', '-am', 'chore(release): the release tree');
  const pr = git('rev-parse', 'HEAD');
  const head = git('commit-tree', `${pr}^{tree}`, '-p', base, '-p', pr, '-m', 'merge');
  git('update-ref', 'HEAD', head);
  return { root, base, pr, head, headJobs: expectedJobs(ci(headJobs)).jobs };
}

// Real git in the repository; gh and the roadmap check faked around one green run on H.
function repoSh(repo) {
  const calls = [];
  const r = run({ head_sha: repo.pr });
  const jobs = repo.headJobs.map((name, i) => ({ id: i + 1, name, run_id: r.id,
    head_sha: repo.pr, status: 'completed', conclusion: 'success', run_attempt: 1 }));
  const p = pull({ head: { sha: repo.pr, ref: 'chore/release-v9.9.9' },
    merge_commit_sha: repo.head });
  const sh = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git') {
      const g = spawnSync('git', args, { cwd: repo.root, encoding: 'utf8' });
      return { status: g.status, stdout: String(g.stdout || '').trim() };
    }
    if (cmd === 'node') return { status: 0, stdout: '' };
    if (args[0] === 'api' && /\/pulls\?/.test(args[1])) {
      return { status: 0, stdout: JSON.stringify([p]) };
    }
    if (args[0] === 'api' && /\/jobs\?filter=latest/.test(args[1])) {
      return { status: 0, stdout: JSON.stringify({ jobs }) };
    }
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify({ workflow_runs: [r] }) };
    return { status: 1, stdout: '' };
  };
  return { sh, calls };
}

test('R037: gatherCiReceipt reads the job set with git show from the merge\'s first parent, not'
  + ' from the checkout', (t) => {
  // the base declares the visual gate; the release tree (the checkout) and its run do not
  const dropped = mergeRepo(t, VISUAL, '');
  const { sh, calls } = repoSh(dropped);
  const f = gatherCiReceipt({ sh, root: dropped.root, head: dropped.head });
  assert.deepEqual(f.parents, [dropped.base, dropped.pr]);
  assert.ok(calls.some((c) => c[0] === 'git' && c[1] === 'show'
    && c[2] === `${dropped.base}:${CI_WORKFLOW}`), calls.map((c) => c.join(' ')).join('\n'));
  assert.ok(f.baseWorkflow.jobs.includes('Visual regression gate'), 'the base copy was read');
  assert.ok(!f.workflow.jobs.includes('Visual regression gate'), 'the checkout copy was read');
  // the pull request's run does not verify, so the queue's runs are read too (ADR 0083) and
  // both verdicts are reported: every other fact of the real merge holds
  const problems = ciReceiptProblems(f);
  assert.match(problems.join('\n'), new RegExp('pull_request: run 900 has no job "Visual '
    + `regression gate" \\(\\.github/workflows/ci\\.yml of the base ${dropped.base.slice(0, 7)} `
    + 'declares it\\)'));
  assert.ok(problems.every((p) => /^(pull_request|merge_group): /.test(p)), problems.join('\n'));
  // the release tree adds a job beyond the base, and its run carries it green: verifies
  const added = mergeRepo(t, '', EXTRA);
  const g = gatherCiReceipt({ sh: repoSh(added).sh, root: added.root, head: added.head });
  assert.deepEqual(ciReceiptProblems(g), []);
  assert.equal(judgedRun(g).id, 900);
  // the base's copy missing from git is a refusal, never an empty job set
  const none = mergeRepo(t, '', '');
  const blind = repoSh(none);
  const h = gatherCiReceipt({ sh: (c, a) => (c === 'git' && a[0] === 'show'
    ? { status: 128, stdout: '' } : blind.sh(c, a)), root: none.root, head: none.head });
  assert.equal(h.baseWorkflow, null);
  assert.match(ciReceiptProblems(h).join(), new RegExp(`of the base ${none.base.slice(0, 7)} `
    + 'could not be read'));
});
