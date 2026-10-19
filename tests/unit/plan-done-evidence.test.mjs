// An issue recorded done carries the review verdict its criteria name (E017, intent
// engineering-integrity, criterion done-after-evidence).
//
// #210 R-1 and #208 R-3/R-4: E006 and E009 were recorded DONE on 2026-10-18 while their own
// criterion "carries a review verdict" was unmet, and `majordomus plan done` refused nothing:
// it checks that an evidence entry covers `verified`, not what the entry names. This test is
// the repository-side check (a refusal inside `plan done` is upstream work):
//
//   every issue of .ai/repo/project/issues with `completed_at` whose acceptance criteria
//   require a review verdict (a criterion that says "review verdict", "review-verdict" or "a
//   reviewer's verdict") has an evidence entry covering `verified` that EITHER
//   (a) names `.ai/repo/reviews/<pr>.yaml` as its `artifact:`, that file exists, and the
//       entry's `recorded_at` is not earlier than the first commit of that file (the commit
//       that added it, committer time); OR
//   (b) records that the base program (scripts/review-verdict.mjs) found no guarded path for
//       the issue's pull request: its command, result or artifact carries the empty content
//       digest (EMPTY_DIGEST, the SHA-256 of no guarded path) or the program's "no verdict
//       needed" line, together with the PR number ("PR 224", "#224", "--pr 224", "/pull/224").
//
// (b) is #224 R-1: by project.review-verdict a pull request that touches no guarded path has no
// verdict file, so with (a) alone such an issue (E017 itself; E003, E004, V397, V602, V603,
// whose criterion says "where it touches a guarded path") could never be recorded done
// without turning main red. Both ways are decidable from the record. An issue whose PR does
// have a verdict file and that records (b) is not refused: the required gate already held that
// PR's merge on its verdict, and this check does not judge the PR a second time.
//
// The evidence is the time the entry was recorded, not the issue's `verified_at`: `plan verify`
// is stamped when the implementation is complete and before the review, which is the order the
// lifecycle asks for; what must follow the verdict is the evidence that names it, and with it
// `plan done`.
//
// ALLOWANCE lists issues completed before 2026-10-19 that the check flags and that were not
// corrected, each with its reason. It only shrinks: an entry the check no longer flags fails
// (remove it), and an entry for an issue completed on or after 2026-10-19 fails (correct it
// with `majordomus plan evidence` instead).
//
// The first-commit check needs history. Without any commit (an export, or the `git archive`
// trees of scripts/fail-first.mjs) it is skipped and says why; a shallow clone skips outside
// GitHub Actions and fails under it, as tests/unit/plan-evidence-commits.test.mjs does (the CI
// unit job checks out with fetch-depth: 0).
//   node --test tests/unit/plan-done-evidence.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISSUES = '.ai/repo/project/issues';
const VERDICT_PATH = /^\.ai\/repo\/reviews\/\d+\.yaml$/;
const NEEDS_VERDICT = /review[ -]verdict|reviewer['\u2019]?s verdict/i;
/** The content digest scripts/review-verdict.mjs computes over no guarded path. */
export const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const NOT_NEEDED = new RegExp(`${EMPTY_DIGEST}|no verdict needed`, 'i');
const PR_NUMBER = /(?:--pr[ =]|\bPR\s*#?|#|\/pull\/)(\d+)\b/i;
const ALLOWANCE_CUTOFF = Date.parse('2026-10-19T00:00:00Z');

// issue id -> why its record is not corrected. Only issues completed before 2026-10-19.
const ALLOWANCE = new Map([
  ['R018', 'its verdict .ai/repo/reviews/179.yaml (first commit 5a77eb1, 2026-10-18T00:40Z) is '
    + 'named in the result of its ci evidence recorded 2026-10-18T05:14:48Z, whose artifact '
    + 'field holds Pages run 39084400974; R018.yaml is outside the scope of E017'],
]);

/** Whether an issue's acceptance criteria require a review verdict. */
export function needsVerdict(issue) {
  return (issue.acceptance_criteria || []).some((c) => NEEDS_VERDICT.test(String(c)));
}

/**
 * The PR number a verified evidence entry records the base program finding no guarded path
 * for, or null when it records no such finding.
 */
export function notNeededPr(e) {
  if (!e || e.covers !== 'verified') return null;
  const text = [e.command, e.result, e.artifact].filter(Boolean).map(String).join('\n');
  if (!NOT_NEEDED.test(text)) return null;
  const m = text.match(PR_NUMBER);
  return m ? Number(m[1]) : null;
}

/**
 * One problem per completed issue that needs a review verdict and has no verified evidence
 * entry naming an existing, committed verdict file recorded no earlier than its first commit,
 * nor one recording that the base program found no guarded path for its PR.
 * `verdictExists(rel)` answers whether the file is in the tree; `firstCommit(rel)` returns its
 * first commit time (ms), `null` when it has none, or `undefined` when history is unknown (the
 * time is then not judged).
 */
export function doneEvidenceProblems(issues, { verdictExists, firstCommit }) {
  const problems = [];
  for (const issue of issues) {
    if (!issue.completed_at || !needsVerdict(issue)) continue;
    if ((issue.evidence || []).some((e) => notNeededPr(e) !== null)) continue;
    const named = (issue.evidence || [])
      .filter((e) => e && e.covers === 'verified' && VERDICT_PATH.test(String(e.artifact || '')));
    if (named.length === 0) {
      problems.push({ id: issue.id, why: 'completed, a criterion requires a review verdict, and '
        + 'no evidence covering verified names .ai/repo/reviews/<pr>.yaml as its artifact, nor '
        + 'records the base program finding no guarded path for its PR '
        + `(${EMPTY_DIGEST.slice(0, 12)}... or "no verdict needed", with the PR number)` });
      continue;
    }
    const whys = named.map((e) => entryProblem(e, verdictExists, firstCommit));
    if (!whys.includes(null)) problems.push({ id: issue.id, why: whys.join('; ') });
  }
  return problems;
}

/** Why one evidence entry naming a verdict file does not hold, or null when it does. */
function entryProblem(e, verdictExists, firstCommit) {
  if (!verdictExists(e.artifact)) return `${e.artifact} does not exist`;
  const first = firstCommit(e.artifact);
  if (first === undefined) return null;
  if (first === null) return `${e.artifact} has no commit`;
  const recorded = Date.parse(String(e.recorded_at || ''));
  if (!Number.isFinite(recorded)) return `evidence naming ${e.artifact} has no recorded_at`;
  if (recorded < first) {
    return `evidence naming ${e.artifact} was recorded at ${e.recorded_at}, before its first `
      + `commit at ${new Date(first).toISOString()}`;
  }
  return null;
}

/** Problems the allowance does not cover, and allowance entries that are stale or too new. */
export function judge(problems, issues, allowance) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const flagged = new Set(problems.map((p) => p.id));
  const failures = problems.filter((p) => !allowance.has(p.id))
    .map((p) => `${p.id}: ${p.why}`);
  for (const [id, reason] of allowance) {
    const issue = byId.get(id);
    if (!issue) { failures.push(`allowance ${id}: no such issue`); continue; }
    if (!flagged.has(id)) failures.push(`allowance ${id}: no longer flagged, remove the entry`);
    if (!(Date.parse(String(issue.completed_at || '')) < ALLOWANCE_CUTOFF)) {
      failures.push(`allowance ${id}: completed on or after 2026-10-19, correct the record`);
    }
    if (String(reason).length < 30) failures.push(`allowance ${id}: the reason is not stated`);
  }
  return failures;
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** The committer time (ms) of the commit that first added `rel`, or null when none did. */
export function firstCommitTime(cwd, rel) {
  const out = git(cwd, ['log', '--diff-filter=A', '--format=%cI', '--', rel]);
  const lines = (out || '').split('\n').filter(Boolean);
  return lines.length ? Date.parse(lines[lines.length - 1]) : null;
}

/** 'ok', or why the history cannot date a file. */
function historyState(cwd) {
  if (git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']) === null) return 'no commit';
  if ((git(cwd, ['rev-parse', '--is-shallow-repository']) || '').trim() === 'true') {
    return 'shallow clone';
  }
  return 'ok';
}

const realIssues = () => readdirSync(path.join(ROOT, ISSUES)).filter((f) => f.endsWith('.yaml'))
  .sort().map((f) => parseYaml(readFileSync(path.join(ROOT, ISSUES, f), 'utf8')));

const inTree = (rel) => existsSync(path.join(ROOT, rel));

test('E017: every completed issue that needs a review verdict names it in its evidence', (t) => {
  const issues = realIssues();
  assert.ok(issues.length > 100, `issues parsed (${issues.length})`);
  const state = historyState(ROOT);
  if (state === 'shallow clone' && process.env.GITHUB_ACTIONS === 'true') {
    assert.fail('shallow clone: the CI unit job must check out with fetch-depth: 0');
  }
  if (state !== 'ok') t.diagnostic(`${state}: the first-commit time is not judged`);
  const problems = doneEvidenceProblems(issues, {
    verdictExists: inTree,
    firstCommit: (rel) => (state === 'ok' ? firstCommitTime(ROOT, rel) : undefined),
  });
  assert.deepEqual(judge(problems, issues, ALLOWANCE), []);
});

test('E017: the check covers the issues of #208 and #210', () => {
  const ids = realIssues().filter((i) => i.completed_at && needsVerdict(i)).map((i) => i.id);
  for (const id of ['E006', 'E009']) assert.ok(ids.includes(id), `${id} is in scope of the check`);
});

const fixture = (evidence) => ({
  id: 'X1',
  completed_at: '2026-10-19T12:00:00Z',
  acceptance_criteria: ['A test passes.', 'The pull request carries a review verdict (guarded).'],
  evidence,
});
const verdictEvidence = (artifact, recordedAt = '2026-10-19T11:00:00Z') => ({
  covers: 'verified', type: 'artifact', command: 'gh pr view 1',
  result: 'verdict merge', artifact, recorded_at: recordedAt,
});
const testEvidence = { covers: 'verified', type: 'test', command: 'npm test', result: 'pass',
  recorded_at: '2026-10-19T10:00:00Z' };

test('E017 mutation: no evidence naming the verdict fails; that evidence and the file pass', () => {
  const io = { verdictExists: (rel) => rel === '.ai/repo/reviews/1.yaml',
    firstCommit: () => Date.parse('2026-10-19T10:30:00Z') };
  const without = doneEvidenceProblems([fixture([testEvidence])], io);
  assert.equal(without.length, 1);
  assert.match(without[0].why, /no evidence covering verified names \.ai\/repo\/reviews/);
  assert.deepEqual(judge(without, [fixture([])], new Map()).length, 1);
  const withIt = fixture([testEvidence, verdictEvidence('.ai/repo/reviews/1.yaml')]);
  assert.deepEqual(doneEvidenceProblems([withIt], io), []);
});

test('E017 mutation: a missing file, a non-verdict artifact, a wrong cover and early evidence fail',
  () => {
    const io = { verdictExists: (rel) => rel === '.ai/repo/reviews/1.yaml',
      firstCommit: () => Date.parse('2026-10-19T10:30:00Z') };
    const run = (e) => doneEvidenceProblems([fixture([e])], io);
    assert.match(run(verdictEvidence('.ai/repo/reviews/2.yaml'))[0].why, /2\.yaml does not exist/);
    assert.match(run(verdictEvidence('https://github.com/x/y/actions/runs/1'))[0].why,
      /no evidence covering verified/);
    assert.match(run({ ...verdictEvidence('.ai/repo/reviews/1.yaml'), covers: 'other' })[0].why,
      /no evidence covering verified/);
    assert.match(run(verdictEvidence('.ai/repo/reviews/1.yaml', '2026-10-19T10:00:00Z'))[0].why,
      /recorded at 2026-10-19T10:00:00Z, before its first commit/);
    assert.match(doneEvidenceProblems([fixture([verdictEvidence('.ai/repo/reviews/1.yaml')])],
      { ...io, firstCommit: () => null })[0].why, /has no commit/);
    // Unknown history: presence and existence are still judged, the time is not.
    assert.deepEqual(doneEvidenceProblems(
      [fixture([verdictEvidence('.ai/repo/reviews/1.yaml', '2000-01-01T00:00:00Z')])],
      { ...io, firstCommit: () => undefined }), []);
    // Not completed, or no criterion requiring a verdict: out of scope.
    assert.deepEqual(doneEvidenceProblems([{ ...fixture([]), completed_at: undefined }], io), []);
    assert.deepEqual(doneEvidenceProblems(
      [{ ...fixture([]), acceptance_criteria: ['A test passes.'] }], io), []);
    assert.ok(needsVerdict({ acceptance_criteria: ['needs a review-verdict file'] }));
    assert.ok(needsVerdict({ acceptance_criteria: ["the pull request carries a reviewer's "
      + 'verdict (src/js/audio is guarded).'] }));
    assert.ok(!needsVerdict({ acceptance_criteria: ['a reviewer reads it'] }));
  });

const notNeededEvidence = (over = {}) => ({
  covers: 'verified', type: 'test',
  command: 'node scripts/review-verdict.mjs --pr 224 --base-branch origin/main',
  result: 'review-verdict: none of the 3 changed path(s) is guarded; no verdict needed',
  recorded_at: '2026-10-19T11:00:00Z', ...over,
});

test('E017 mutation (#224 R-1): no guarded path is proved by the base program, both ways', () => {
  const io = { verdictExists: (rel) => rel === '.ai/repo/reviews/1.yaml',
    firstCommit: () => Date.parse('2026-10-19T10:30:00Z') };
  const run = (...e) => doneEvidenceProblems([fixture([testEvidence, ...e])], io);
  // The "no verdict needed" line with the PR number passes, and so does the empty digest.
  assert.deepEqual(run(notNeededEvidence()), []);
  assert.deepEqual(run(notNeededEvidence({ command: 'gh pr checks 224',
    result: `PR #224: content ${EMPTY_DIGEST} (no guarded path)` })), []);
  assert.equal(notNeededPr(notNeededEvidence()), 224);
  assert.equal(notNeededPr(notNeededEvidence({ command: 'gh api repos/x/y/pulls',
    result: `no verdict needed, https://github.com/x/y/pull/7` })), 7);
  // Not-needed evidence for an issue whose PR in fact has a verdict file is still fine.
  assert.deepEqual(run(notNeededEvidence({ command: 'node scripts/review-verdict.mjs --pr 1' })),
    []);
  assert.deepEqual(run(notNeededEvidence(), verdictEvidence('.ai/repo/reviews/1.yaml')), []);
  // Neither fails, and so do a finding without the PR number, a wrong cover, another digest.
  const neither = run();
  assert.equal(neither.length, 1);
  assert.match(neither[0].why, /nor records the base program finding no guarded path/);
  assert.equal(run(notNeededEvidence({ command: 'node scripts/review-verdict.mjs' })).length, 1);
  assert.equal(run(notNeededEvidence({ covers: 'started' })).length, 1);
  assert.equal(run(notNeededEvidence({ result: `content ${'0'.repeat(64)}` })).length, 1);
  assert.equal(notNeededPr(null), null);
});

test('E017 mutation: the allowance only shrinks', () => {
  const old = { ...fixture([]), completed_at: '2026-10-18T12:00:00Z' };
  const problems = doneEvidenceProblems([old], { verdictExists: () => false,
    firstCommit: () => null });
  const reason = 'a reason that is long enough to be stated';
  assert.deepEqual(judge(problems, [old], new Map([['X1', reason]])), []);
  assert.match(judge(problems, [old], new Map())[0], /^X1: completed/);
  assert.match(judge([], [old], new Map([['X1', reason]]))[0], /no longer flagged/);
  const recent = fixture([]);
  const recentProblems = doneEvidenceProblems([recent], { verdictExists: () => false,
    firstCommit: () => null });
  assert.match(judge(recentProblems, [recent], new Map([['X1', reason]]))[0],
    /completed on or after 2026-10-19/);
  assert.match(judge(problems, [old], new Map([['X1', 'short']]))[0], /reason is not stated/);
  assert.match(judge([], [], new Map([['X9', reason]]))[0], /no such issue/);
});

test('E017: the first commit of a verdict file is read from history', () => {
  const repo = gitRepo('oscilla-e017-');
  try {
    repo.commit('base', { 'README.md': 'x\n' });
    const before = Date.now() - 2000;
    repo.commit('verdict', { '.ai/repo/reviews/1.yaml': 'pr: 1\n' });
    repo.commit('verdict edited', { '.ai/repo/reviews/1.yaml': 'pr: 1\nverdict: merge\n' });
    const first = firstCommitTime(repo.dir, '.ai/repo/reviews/1.yaml');
    assert.ok(first >= Math.floor(before / 1000) * 1000 && first <= Date.now() + 1000,
      `first commit time ${first}`);
    assert.equal(firstCommitTime(repo.dir, '.ai/repo/reviews/2.yaml'), null);
    assert.equal(historyState(repo.dir), 'ok');
  } finally {
    repo.dispose();
  }
});
