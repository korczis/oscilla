// ADR 0082, rule project.release-receipt-binds-gate v2: the CI receipt. The CI run of the
// release pull request is the gate verdict only for main's HEAD whose tree that run tested,
// on its newest run and latest attempt, with every job ci.yml declares green.
//   node --test tests/unit/release-ci-receipt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CI_WORKFLOW, ciReceiptProblems, expectedJobs, gatherCiReceipt, judgedRun,
} from '../../scripts/release-ci-receipt.mjs';
import { gateVerdict } from '../../scripts/release-publish.mjs';
import * as prep from '../../scripts/release-prepare.mjs';

const CI_TEXT = readFileSync(new URL(`../../${CI_WORKFLOW}`, import.meta.url), 'utf8');
const WORKFLOW = expectedJobs(CI_TEXT);
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PR = 'c'.repeat(40);
const TREE = 'd'.repeat(40);

const run = (over = {}) => ({ id: 900, name: WORKFLOW.name, event: 'pull_request', head_sha: PR,
  status: 'completed', conclusion: 'success', run_attempt: 1,
  created_at: '2026-11-02T10:00:00Z', ...over });
const jobsOf = (r) => WORKFLOW.jobs.map((name, i) => ({ id: i + 1, name, run_id: r.id,
  head_sha: PR, status: 'completed', conclusion: 'success', run_attempt: r.run_attempt }));

function facts(over = {}) {
  const r = run();
  return { head: HEAD, parents: [BASE, PR], headTree: TREE, prTree: TREE, baseInPr: true,
    workflow: WORKFLOW, runs: [r], jobs: jobsOf(r), roadmap: true, ...over };
}

const only = (f, re) => {
  const problems = ciReceiptProblems(f);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], re);
};

test('the job list is derived from ci.yml: every matrix value, the visual gate, doctor, gate', () => {
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
  only(facts({ runs: null }), /CI runs of ccccccc could not be read/);
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
  // an unreadable answer is never an empty one
  const broken = gatherCiReceipt({ sh: (c, a) => (a[0] === 'api' ? { status: 1, stdout: '' }
    : sh(c, a)), root, head: HEAD });
  assert.match(ciReceiptProblems(broken).join(), /could not be read/);
});

test('release:prepare defaults to the CI path and keeps the full gate behind --local-gate', () => {
  const ci = prep.CI_PREPARE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.deepEqual(ci, ['node scripts/roadmap.mjs', 'npm run build', 'npm run version:check',
    'npm run verify']);
  const local = prep.GATE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`);
  assert.ok(local.includes('npm run release-gate'));
  assert.match(prep.USAGE, /--local-gate/);
});
