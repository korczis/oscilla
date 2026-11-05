// ADR 0083 (E045): .github/scripts/queued-pr.sh names the pull request a CI run judges: the
// event's own on pull_request, the N of the queue ref on merge_group (with HEAD^1 to measure
// against), and refuses a ref that is not a merge-queue ref, so its `eval` runs nothing else.
// On merge_group HEAD must be the queue's merge commit onto exactly the base the ref names (two
// parents; HEAD^1 the ref's sha, which on GitHub is the entry's base, not the pull request's
// head: review N1, checked on rust-lang/rust-analyzer and primer/react), and `--check-head`
// requires HEAD^2 to be the pull request's headRefOid.
//   node --test tests/unit/queued-pr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../../.github/scripts/queued-pr.sh', import.meta.url));
const run = (env, { cwd, args = [] } = {}) => spawnSync('bash', [SCRIPT, ...args],
  { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, ...env } });
const vars = (out) => Object.fromEntries(out.trim().split('\n').map((l) => l.split(/=(.*)/s)
  .slice(0, 2)));
/** What the rule jobs do with the output: assign, then eval, under bash -eo pipefail. */
const evalLike = (env, cwd) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail',
  '-c', `vars="$(${JSON.stringify(SCRIPT)})"; eval "$vars"; echo "REACHED PR=$PR BASE=$BASE"`],
{ encoding: 'utf8', cwd, env: { PATH: process.env.PATH, ...env } });

/**
 * A queue fixture: main, a pull request branch `pr`, and HEAD detached at the queue's merge
 * commit of it (`merge`), its rebase (`linear`), or an octopus merge (`octopus`).
 */
function queue(t, shape = 'merge') {
  const repo = gitRepo('oscilla-queued-pr-');
  t.after(() => repo.dispose());
  repo.commit('base', { 'README.md': 'r\n' });
  repo.branch('pr');
  const head = repo.commit('change', { 'docs/a.md': 'a\n' });
  repo.git('checkout', '-q', 'main');
  repo.branch('other');
  repo.commit('other', { 'docs/b.md': 'b\n' });
  repo.git('checkout', '-q', '--detach', 'main');
  if (shape === 'merge') repo.git('merge', '-q', '--no-ff', '-m', 'queue', 'pr');
  else if (shape === 'octopus') repo.git('merge', '-q', '--no-ff', '-m', 'queue', 'pr', 'other');
  else repo.git('cherry-pick', 'pr');
  // GitHub names the queue ref by the entry's base, the queue commit's first parent
  return { repo, head, base: repo.git('rev-parse', 'HEAD^1') };
}
const queueEnv = (base, over = {}) => ({
  QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-385-${base}`,
  QUEUE_BASE: 'refs/heads/main', ...over });
const defined = (env) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));

test('pull_request: the event\'s pull request, measured against its base branch', () => {
  const r = run({ PR: '385', GITHUB_BASE_REF: 'main' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(vars(r.stdout), { PR: '385', BASE: 'main', DIFF_BASE: 'origin/main',
    QUEUED_HEAD: '' });
});

test('merge_group: the pull request the queue ref names, measured against HEAD^1', (t) => {
  const { repo, head, base } = queue(t);
  // GitHub's shape (review N1): the ref's sha is HEAD^1, the entry's base; DIFF_BASE is bound to
  // it, and HEAD^2 is the queued head that --check-head holds to headRefOid
  for (const sha of [base, base.slice(0, 12)]) {
    const r = run(queueEnv(sha), { cwd: repo.dir });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(vars(r.stdout), { PR: '385', BASE: 'main', DIFF_BASE: base,
      QUEUED_HEAD: head });
  }
  assert.notEqual(base, head);
  // end to end as the rule jobs run it: assign, eval, then --check-head against pr.json
  const flow = (oid) => {
    writeFileSync(path.join(repo.dir, '..', `${path.basename(repo.dir)}-pr.json`),
      JSON.stringify({ headRefOid: oid }));
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c',
      `vars="$(${JSON.stringify(SCRIPT)})"; eval "$vars"; `
      + `${JSON.stringify(SCRIPT)} --check-head "$QUEUED_HEAD" `
      + `${JSON.stringify(path.join(repo.dir, '..', `${path.basename(repo.dir)}-pr.json`))}; `
      + 'echo "REACHED $DIFF_BASE"'], { encoding: 'utf8', cwd: repo.dir,
      env: { PATH: process.env.PATH, ...queueEnv(base) } });
  };
  t.after(() => rmSync(path.join(repo.dir, '..', `${path.basename(repo.dir)}-pr.json`),
    { force: true }));
  const ok = flow(head);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), `REACHED ${base}`);
  const moved = flow(base);
  assert.equal(moved.status, 2, 'the pull request\'s head moved: HEAD^2 is not headRefOid');
  assert.doesNotMatch(moved.stdout, /REACHED/);
  // the earlier model, the ref naming the pull request's head (HEAD^2), refuses
  for (const sha of [head, head.slice(0, 12)]) {
    const r = run(queueEnv(sha), { cwd: repo.dir });
    assert.equal(r.status, 2, sha);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /HEAD\^1 is [0-9a-f]{40}, not the base the queue ref names/);
  }
});

test('a ref that is not a merge-queue ref, or a base that disagrees, refuses with exit 2', (t) => {
  // the ref names the entry's base, HEAD^1 (review N1)
  const { repo, base } = queue(t);
  for (const [env, why] of [
    [{ QUEUE_REF: 'refs/heads/evil;rm -rf /' }, /not a merge-queue ref/],
    [{ QUEUE_REF: 'refs/heads/gh-readonly-queue/main/pr-x-abc1234' }, /not a merge-queue ref/],
    // the anchors: nothing before refs/heads/, nothing after the sha
    [queueEnv(base, { QUEUE_REF: `xrefs/heads/gh-readonly-queue/main/pr-385-${base}` }),
      /not a merge-queue ref/],
    [queueEnv(base, { QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-385-${base};id` }),
      /not a merge-queue ref/],
    [queueEnv(base, { QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-385-${base}/x` }),
      /not a merge-queue ref/],
    [queueEnv(base, { QUEUE_BASE: 'refs/heads/other' }), /differs from the event's other/],
    [{ PR: '38$(id)', GITHUB_BASE_REF: 'main' }, /PR is not a number/],
  ]) {
    const r = run(env, { cwd: repo.dir });
    assert.equal(r.status, 2, JSON.stringify(env));
    assert.equal(r.stdout, '', 'nothing to eval');
    assert.match(r.stderr, why, JSON.stringify(env));
  }
});

test('review F8: on merge_group the base_ref is required and the ref\'s base must be it', (t) => {
  // the ref names the entry's base, HEAD^1 (review N1)
  const { repo, base } = queue(t);
  for (const [env, why] of [
    // no base_ref: the cross-check would be skipped
    [queueEnv(base, { QUEUE_BASE: '' }), /without a base_ref/],
    [queueEnv(base, { QUEUE_BASE: undefined }), /without a base_ref/],
    [queueEnv(base, { QUEUE_BASE: 'refs/heads/' }), /without a base_ref/],
    [queueEnv(base, { QUEUE_BASE: 'main' }), /without a base_ref/],
    // a greedy base: .../pr-1-abcdef0/pr-385-<sha> parses as base main/pr-1-abcdef0
    [queueEnv(base, { QUEUE_REF:
      `refs/heads/gh-readonly-queue/main/pr-1-abcdef0/pr-385-${base}` }), /differs/],
    [queueEnv(base, { QUEUE_REF: `refs/heads/gh-readonly-queue/../../x/pr-385-${base}`,
      QUEUE_BASE: 'refs/heads/../../x' }), /bad base/],
    [queueEnv(base, { QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-0-${base}` }),
      /PR is not a number/],
    [queueEnv(base, { QUEUE_REF: `refs/heads/gh-readonly-queue/main/pr-007-${base}` }),
      /PR is not a number/],
  ]) {
    const r = run(defined(env), { cwd: repo.dir });
    assert.equal(r.status, 2, JSON.stringify(env));
    assert.equal(r.stdout, '', 'nothing to eval');
    assert.match(r.stderr, why, JSON.stringify(env));
  }
});

test('review F1, N1: HEAD must be the queue\'s merge commit onto the base the ref names', (t) => {
  // under the rebase or squash method the queue commit has one parent, and HEAD^1..HEAD would be
  // only the last commit of the pull request; an octopus has three
  for (const shape of ['linear', 'octopus']) {
    const { repo, base } = queue(t, shape);
    const r = run(queueEnv(base), { cwd: repo.dir });
    assert.equal(r.status, 2, shape);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /parent\(s\), not the queue's merge commit/, shape);
  }
  // a merge commit whose first parent is another base than the one the ref names
  const { repo } = queue(t);
  const other = repo.git('rev-parse', 'other');
  const r = run(queueEnv(other), { cwd: repo.dir });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /HEAD\^1 is [0-9a-f]{40}, not the base the queue ref names/);
  // outside a repository HEAD cannot be read: refused
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-queued-pr-nogit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nogit = run({ ...queueEnv('a'.repeat(40)), GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    { cwd: dir });
  assert.equal(nogit.status, 2);
  assert.equal(nogit.stdout, '');
});

test('review F1: --check-head requires the queued head to be the pull request\'s headRefOid',
  (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-queued-pr-json-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let n = 0;
    const json = (obj) => {
      n += 1;
      const p = path.join(dir, `pr-${n}.json`);
      writeFileSync(p, JSON.stringify(obj));
      return p;
    };
    const head = 'c'.repeat(40);
    const check = (queued, file) => run({}, { args: ['--check-head', queued, file] });
    assert.equal(check(head, json({ headRefOid: head })).status, 0);
    // pull_request: nothing queued, nothing to compare, whatever the pull request's head is
    // (review N2: without the no-op every pull_request run would exit 2 here)
    for (const oid of [head, 'd'.repeat(40)]) {
      const r = check('', json({ headRefOid: oid }));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
    }
    assert.equal(check('', json({})).status, 0);
    for (const [file, what] of [[json({ headRefOid: 'd'.repeat(40) }), 'another head'],
      [json({ title: 'x' }), 'no headRefOid'], [path.join(dir, 'missing.json'), 'no file']]) {
      const r = check(head, file);
      assert.equal(r.status, 2, what);
      assert.equal(r.stdout, '', what);
    }
    const wrong = check(head, json({ headRefOid: 'd'.repeat(40) }));
    assert.match(wrong.stderr, /the queue merged c{40}, the pull request's head is d{40}/);
    assert.equal(run({}, { args: ['--check-head', head] }).status, 2, 'missing argument');
    assert.equal(run({}, { args: ['--bogus'] }).status, 2, 'unknown argument');
  });

test('review F3: a bad base never reaches eval, on either event', (t) => {
  // the ref names the entry's base, HEAD^1 (review N1)
  const { repo, base } = queue(t);
  const bad = ['main;echo INJECTED', 'x$(echo INJECTED)', 'main`echo INJECTED`', 'a;id',
    'main echo INJECTED', '../main', 'a/../b', '-main', '/main', "main'echo INJECTED'",
    'main\necho INJECTED'];
  for (const b of bad) {
    // pull_request: the event's base
    const r = evalLike({ PR: '385', GITHUB_BASE_REF: b }, repo.dir);
    assert.notEqual(r.status, 0, JSON.stringify(b));
    assert.doesNotMatch(r.stdout, /INJECTED|REACHED/, JSON.stringify(b));
    const direct = run({ PR: '385', GITHUB_BASE_REF: b });
    assert.equal(direct.status, 2, JSON.stringify(b));
    assert.equal(direct.stdout, '', JSON.stringify(b));
  }
  for (const b of bad) {
    // merge_group: the queue's base_ref (the ref's base must equal it, so both carry it)
    const env = queueEnv(base, { QUEUE_BASE: `refs/heads/${b}`,
      QUEUE_REF: `refs/heads/gh-readonly-queue/${b}/pr-385-${base}` });
    const r = evalLike(env, repo.dir);
    assert.notEqual(r.status, 0, JSON.stringify(b));
    assert.doesNotMatch(r.stdout, /INJECTED|REACHED/, JSON.stringify(b));
    const direct = run(env, { cwd: repo.dir });
    assert.equal(direct.status, 2, JSON.stringify(b));
    assert.equal(direct.stdout, '', JSON.stringify(b));
  }
  // and the assign-then-eval form reaches the rest of the step only on a good answer
  const good = evalLike({ PR: '385', GITHUB_BASE_REF: 'main' }, repo.dir);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /REACHED PR=385 BASE=main/);
});

test('review F2: `eval "$(...)"` would carry on after exit 2; the assignment form stops', (t) => {
  const { repo } = queue(t);
  const env = { PATH: process.env.PATH, PR: '38$(id)', GITHUB_BASE_REF: 'main' };
  const sh = (body) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', body],
    { encoding: 'utf8', cwd: repo.dir, env });
  const old = sh(`eval "$(${JSON.stringify(SCRIPT)})"; echo REACHED`);
  assert.match(old.stdout, /REACHED/, 'the old form: the failure is thrown away');
  const now = sh(`vars="$(${JSON.stringify(SCRIPT)})"; eval "$vars"; echo REACHED`);
  assert.equal(now.status, 2);
  assert.doesNotMatch(now.stdout, /REACHED/);
});

test('no pull request at all prints an empty PR, which the rule jobs refuse', () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(vars(r.stdout).PR, '');
});
