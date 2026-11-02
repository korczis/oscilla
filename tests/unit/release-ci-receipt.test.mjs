// ADR 0082, rule project.release-receipt-binds-gate v2: the CI receipt. The CI run of the
// release pull request is the gate verdict only for main's HEAD whose tree that run tested,
// on its newest run and latest attempt, with every job ci.yml declares green.
//   node --test tests/unit/release-ci-receipt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CI_WORKFLOW, GH_ATTEMPTS, GH_TIMEOUT_MS, ciReceiptProblems, expectedJobs, gatherCiReceipt,
  judgedRun,
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
const jobsOf = (r) => WORKFLOW.jobs.map((name, i) => ({ id: i + 1, name, run_id: r.id,
  head_sha: PR, status: 'completed', conclusion: 'success', run_attempt: r.run_attempt }));

function facts(over = {}) {
  const r = run();
  return { head: HEAD, parents: [BASE, PR], headTree: TREE, prTree: TREE, baseInPr: true,
    workflow: WORKFLOW, pulls: [pull()], runs: [r], jobs: jobsOf(r), roadmap: true, ...over };
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
    assert.ok(WORKFLOW.jobs.includes(`Browser gate (${b})`), b);
    assert.ok(WORKFLOW.jobs.includes(`V1 engine checks (${b})`), b);
  }
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
  const skipped = jobsOf(r).map((j) => (j.name === 'Browser gate (webkit)'
    ? { ...j, conclusion: 'skipped' } : j));
  only(facts({ jobs: skipped }), /job "Browser gate \(webkit\)" of run 900 is completed\/skipped/);
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

test('ADR 0083 mutation: a queue group of two refuses (HEAD^1 is another pull request\'s queue'
  + ' commit)', () => {
  // the release pull request queued behind another: its queue commit's first parent is that
  // other pull request's queue commit, which the release head does not contain
  const problems = ciReceiptProblems(queued({ baseInPr: false, prTree: 'f'.repeat(40) }));
  assert.ok(problems.some((p) => /does not contain the base/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /main holds more than CI tested/.test(p)), problems.join('\n'));
});

test('ADR 0083 mutation: a skipped or missing job of the queue run refuses; none is excused', () => {
  const q = qrun();
  const skipped = qjobs(q).map((j) => (j.name === 'review-verdict (guarded paths need a recorded'
    + ' review)' ? { ...j, conclusion: 'skipped' } : j));
  assert.match(ciReceiptProblems(queued({ queueJobs: skipped })).join(),
    /job "review-verdict .*" of run 950 is completed\/skipped/);
  const missing = qjobs(q).filter((j) => !j.name.startsWith('fail-first'));
  assert.match(ciReceiptProblems(queued({ queueJobs: missing })).join(),
    /run 950 has no job "fail-first/);
});

test('ADR 0083 mutation: a pull_request run does not stand in when the queue commit\'s tree'
  + ' differs from the pull request head\'s', () => {
  assert.match(ciReceiptProblems(facts({ prTree: 'f'.repeat(40) })).join(),
    /main holds more than CI tested/);
});

test('release:prepare defaults to the CI path and keeps the full gate behind --local-gate', () => {
  const ci = prep.CI_PREPARE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.deepEqual(ci, ['node scripts/roadmap.mjs', 'npm run build', 'npm run version:check',
    'npm run verify']);
  const local = prep.GATE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.ok(local.includes('npm run release-gate'));
  assert.match(prep.USAGE, /--local-gate/);
});
