// Plan evidence names a commit that exists (V272 D4).
//
// `majordomus plan evidence` writes HEAD into an evidence entry's `commit:`, and `majordomus
// plan validate` accepts any text there: a commit that was rebased away before the push, all
// zeros or "not-a-sha" all validate. This test holds every `commit:` of the evidence in
// .ai/repo/project/issues/*.yaml and .ai/repo/project/milestones/*.yaml to:
//
//   - a full 40-hex object name that is not all zeros;
//   - a commit object of this clone that HEAD reaches (main's history, or on a pull request
//     the history under test);
//   - or one of OFF_HISTORY below: the head of a pull request that was squash-merged after its
//     evidence was recorded. GitHub keeps such a commit under refs/pull/<n>/head, which no
//     clone fetches, so it cannot be checked here; each entry names its pull request and the
//     merge on main, verified with `gh api repos/korczis/oscilla/pulls/<n>/commits` when it was
//     added. A commit reachable only from a remote branch is not accepted: the branch is
//     deleted after its merge, and the record would then name a commit no clone has.
//
// An entry without `commit:` must say in its result that the commit "was not preserved" and
// what replaced it. Record evidence at a commit of main, as the chore(plan) pull requests do:
// evidence recorded on a branch that is then squash-merged passes on its own pull request and
// fails here on main afterwards (#238, squash-merged as 508bd3d, turned main red until #246).
// So on a pull request (GITHUB_BASE_REF set, as in CI's unit job) a second check refuses, before
// the merge, every evidence commit that is neither reachable from origin/<base> nor in
// OFF_HISTORY, whatever merge method the pull request will use: remove it and record it in a
// follow-up chore(plan) pull request from a fresh branch of origin/main, before that branch's
// first commit, since `plan evidence` records HEAD (offBase below; the commands are in
// .ai/repo/workflows/plan.md, "Evidence names a commit of main").
//
// It needs full history. CI's unit job checks out with fetch-depth: 0, so under GitHub Actions
// a shallow clone fails the check; elsewhere (a shallow clone, an export without .git) it
// skips and says why, as tests/unit/about.test.mjs does.
//   node --test tests/unit/plan-evidence-commits.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAN_DIRS = ['.ai/repo/project/issues', '.ai/repo/project/milestones'];
const SHA = /^[0-9a-f]{40}$/;
const NOT_PRESERVED = /\bwas not preserved\b/;

// sha -> why it is not in this clone's history. Only squash-merged pull-request heads.
const OFF_HISTORY = new Map([
  ['ff3c806f3707d3bf8a0a75833006f5f1f8cf71de',
    'V249: first commit of #26 (fix/v249-engine-release), squash-merged as e3cb46d'],
  ['6a27eda8ca174553ebd8851a6eedde63cc8f6d52',
    'V250: first commit of #42 (fix/v250-envelope-lanes), squash-merged as 84e2c05'],
  ['65dbed84a63f1012d414bc5cfc8c99dd65a746c0',
    'V382: fourth commit of #61 (chore/v382-evidence), squash-merged as 1f68c76'],
  ['b8c59532fa90bf6ff6719c856bfeb7228f84ce95',
    'V433: second commit of #146 (ci/pages-runs-live-smoke), squash-merged as 3514628'],
  ['9135c8f417edc0f39b3a345c5e2e677149b6ac3c',
    'V433, M020, M032: first commit of #238 (chore/plan-done-verify-backlog), squash-merged as '
      + '508bd3d'],
  ['dcb28f29686156c586e32eff54225aa079c14be7',
    'E017, E018, E021, E022, E025, V602: second commit of #238 (chore/plan-done-verify-backlog), '
      + 'squash-merged as 508bd3d'],
]);

/** Every evidence entry of the plan records: [{ file, index, commit?, result }]. */
export function evidenceEntries(files) {
  const out = [];
  for (const [file, text] of files) {
    let inEvidence = false;
    let cur = null;
    for (const line of text.split('\n')) {
      if (/^\S/.test(line)) { inEvidence = /^evidence:\s*$/.test(line); cur = null; continue; }
      if (!inEvidence) continue;
      const start = line.match(/^ {2}- ([a-z_]+):\s*(.*)$/);
      if (start) {
        cur = { file, index: out.filter((e) => e.file === file).length };
        out.push(cur);
        cur[start[1]] = unquote(start[2]);
        continue;
      }
      const kv = cur && line.match(/^ {4}([a-z_]+):\s*(.*)$/);
      if (kv) cur[kv[1]] = unquote(kv[2]);
    }
  }
  return out;
}

function unquote(v) {
  const t = v.trim();
  if (t.length > 1 && t[0] === '"' && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"');
  if (t.length > 1 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/**
 * One problem per evidence entry whose commit this history does not back.
 * `isCommit(sha)` and `reachable(sha)` answer for this clone; `offHistory` is OFF_HISTORY.
 */
export function evidenceProblems(entries, { isCommit, reachable, offHistory }) {
  const problems = [];
  for (const e of entries) {
    const where = `${e.file} evidence ${e.index}`;
    if (e.commit === undefined) {
      if (!NOT_PRESERVED.test(e.result || '')) {
        problems.push(`${where}: no commit, and the result does not say it was not preserved`);
      }
      continue;
    }
    if (!SHA.test(e.commit) || /^0+$/.test(e.commit)) {
      problems.push(`${where}: commit ${JSON.stringify(e.commit)} is not a 40-hex commit name`);
      continue;
    }
    if (offHistory.has(e.commit)) continue;
    if (!isCommit(e.commit)) {
      problems.push(`${where}: commit ${e.commit} is not a commit object of this clone`);
    } else if (!reachable(e.commit)) {
      problems.push(`${where}: commit ${e.commit} is not in the history of HEAD`);
    }
  }
  return problems;
}

/**
 * One problem per evidence entry whose commit the base branch does not have (V272 D4, PR side).
 * `reachableFromBase(sha)` answers for origin/<base>; `offHistory` is OFF_HISTORY. Entries
 * without a well-formed commit are evidenceProblems' to judge, not this one's.
 */
export function offBase(entries, { reachableFromBase, offHistory, base = 'main' }) {
  const problems = [];
  for (const e of entries) {
    if (!SHA.test(e.commit || '') || /^0+$/.test(e.commit)) continue;
    if (offHistory.has(e.commit) || reachableFromBase(e.commit)) continue;
    problems.push(`${e.file} evidence ${e.index}: commit ${e.commit} is not on ${base}, and a`
      + ' branch commit is lost to every clone once the branch is squashed or deleted, whatever'
      + ' the merge method. Remove the entry from this pull request; after it lands, record it'
      + ` in a follow-up chore(plan) pull request: \`majordomus worktree create chore/plan-<id>\`,`
      + ` then in that worktree, before its first commit (HEAD still on origin/${base}),`
      + ' `majordomus plan evidence <id> ...` and `majordomus plan done <id>`, commit, push and'
      + ' open the pull request (.ai/repo/workflows/plan.md, "Evidence names a commit of main")');
  }
  return problems;
}

function git(args, input) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function withoutHistory(t, why) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    assert.fail(`${why}: the CI unit job must check out with fetch-depth: 0`);
  }
  t.skip(why);
}

const planFiles = () => PLAN_DIRS.flatMap((dir) => readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.yaml')).sort()
  .map((f) => [`${dir}/${f}`, readFileSync(path.join(ROOT, dir, f), 'utf8')]));

test('V272 D4: every plan evidence commit is a commit of this history, or an explained one',
  (t) => {
    const shallow = git(['rev-parse', '--is-shallow-repository']);
    if (shallow === null) return withoutHistory(t, 'no git repository');
    if (shallow.trim() === 'true') return withoutHistory(t, 'shallow clone');
    const entries = evidenceEntries(planFiles());
    assert.ok(entries.length > 300, `evidence entries parsed (${entries.length})`);
    const shas = [...new Set(entries.map((e) => e.commit).filter((c) => SHA.test(c || '')))];
    const batch = git(['cat-file', '--batch-check'], shas.map((s) => `${s}^{commit}`).join('\n'));
    assert.ok(batch !== null, 'git cat-file --batch-check ran');
    const commits = new Set(batch.split('\n').map((l) => l.split(' '))
      .filter(([, type]) => type === 'commit').map(([sha]) => sha));
    const history = new Set((git(['rev-list', 'HEAD']) || '').split('\n').filter(Boolean));
    assert.ok(history.size > 0, 'git rev-list HEAD ran');
    const problems = evidenceProblems(entries, {
      isCommit: (s) => commits.has(s), reachable: (s) => history.has(s), offHistory: OFF_HISTORY,
    });
    assert.deepEqual(problems, []);
  });

test('V272 D4: on a pull request, every plan evidence commit is already on the base branch',
  (t) => {
    const baseRef = process.env.GITHUB_BASE_REF;
    if (!baseRef) return t.skip('not a pull request run (GITHUB_BASE_REF unset)');
    const shallow = git(['rev-parse', '--is-shallow-repository']);
    if (shallow === null) return withoutHistory(t, 'no git repository');
    if (shallow.trim() === 'true') return withoutHistory(t, 'shallow clone');
    const base = git(['rev-list', `origin/${baseRef}`]);
    assert.ok(base !== null, `git rev-list origin/${baseRef} ran (the unit job fetches it)`);
    const onBase = new Set(base.split('\n').filter(Boolean));
    const problems = offBase(evidenceEntries(planFiles()), {
      reachableFromBase: (s) => onBase.has(s), offHistory: OFF_HISTORY, base: baseRef,
    });
    assert.deepEqual(problems, []);
  });

test('V272 D4 mutation: a branch-only evidence commit is refused before the merge', () => {
  const onMain = 'a'.repeat(40);
  const branchOnly = 'c'.repeat(40);
  const squashed = 'd'.repeat(40);
  const entries = [onMain, branchOnly, squashed, 'not-a-sha', undefined]
    .map((commit, index) => ({ file: 'x.yaml', index, commit, result: 'ok' }));
  const problems = offBase(entries, {
    reachableFromBase: (s) => s === onMain, offHistory: new Map([[squashed, 'why']]),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /x\.yaml evidence 1: commit c{40} is not on main/);
  assert.match(problems[0], /follow-up chore\(plan\) pull request/);
  assert.match(problems[0], /whatever the merge method/);
  assert.match(problems[0], /before its first commit \(HEAD still on origin\/main\)/);
  assert.match(problems[0], /majordomus worktree create chore\/plan-<id>/);
  assert.doesNotMatch(problems[0], /a squash merge would/);
  assert.deepEqual(offBase(entries.slice(0, 1), {
    reachableFromBase: () => true, offHistory: new Map(),
  }), []);
});

test('V272 D4: every OFF_HISTORY entry is still cited and still outside this history', (t) => {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow === null) return withoutHistory(t, 'no git repository');
  if (shallow.trim() === 'true') return withoutHistory(t, 'shallow clone');
  const cited = new Set(evidenceEntries(planFiles()).map((e) => e.commit));
  const history = new Set((git(['rev-list', 'HEAD']) || '').split('\n').filter(Boolean));
  for (const [sha, why] of OFF_HISTORY) {
    assert.ok(cited.has(sha), `${sha} (${why}) is cited by a plan record`);
    assert.ok(!history.has(sha), `${sha} (${why}) is now in the history: remove the entry`);
    assert.match(why, /#\d+ .* squash-merged as [0-9a-f]{7}/, `${sha}: names its pull request`);
  }
});

test('V272 D4 mutation: zeros, "not-a-sha", a lost commit and an unreachable one are refused',
  () => {
    const yaml = (commit, extra = '') => [
      'id: X1', 'evidence:', '  - covers: verified', '    type: test',
      '    command: "npm test"', `    result: "ok${extra}"`,
      ...(commit === null ? [] : [`    commit: ${commit}`]),
      '    recorded_at: 2026-10-18T00:00:00Z', 'created_at: 2026-10-18', '',
    ].join('\n');
    const good = 'a'.repeat(40);
    const lost = 'b'.repeat(40);
    const branchOnly = 'c'.repeat(40);
    const io = {
      isCommit: (s) => s === good || s === branchOnly,
      reachable: (s) => s === good,
      offHistory: new Map(),
    };
    const run = (commit, extra) => evidenceProblems(
      evidenceEntries([['x.yaml', yaml(commit, extra)]]), io);
    assert.deepEqual(run(good), []);
    assert.match(run('0'.repeat(40))[0], /not a 40-hex commit name/);
    assert.match(run('not-a-sha')[0], /not a 40-hex commit name/);
    assert.match(run(good.slice(0, 7))[0], /not a 40-hex commit name/);
    assert.match(run(lost)[0], /not a commit object of this clone/);
    assert.match(run(branchOnly)[0], /not in the history of HEAD/);
    assert.match(run(null)[0], /does not say it was not preserved/);
    assert.deepEqual(run(null, '; commit 1234567 was not preserved, see #1'), []);
    assert.deepEqual(evidenceProblems(evidenceEntries([['x.yaml', yaml(lost)]]),
      { ...io, offHistory: new Map([[lost, 'why']]) }), []);
    const second = `evidence:\n  - covers: a\n    commit: ${lost}\n`;
    const two = evidenceEntries([['y.yaml', `${yaml(good)}${second}`]]);
    assert.deepEqual(two.map((e) => [e.index, e.commit]), [[0, good], [1, lost]]);
  });
