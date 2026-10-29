// scripts/git-ref.mjs: the base commit of a pull-request rule is named so that nothing else
// answers for it (review of #255, R2). On a fixture repository: a remote-tracking ref, a
// branch and a full commit name resolve; a tag that shadows origin/main, a branch named like a
// tag and a ref named like a commit are refused as ambiguous, by the programs too.
//   node --test tests/unit/git-ref.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidates, commitOf } from '../../scripts/git-ref.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_TEST_CONTEXT']) delete ENV[k];

function fixture(t) {
  const repo = gitRepo('oscilla-git-ref-');
  t.after(() => repo.dispose());
  const base = repo.commit('base', { 'README.md': 'fixture\n' });
  repo.git('update-ref', 'refs/remotes/origin/main', base);
  repo.branch('pr');
  const head = repo.commit('change', { 'README.md': 'fixture, changed\n' });
  return { repo, base, head };
}

test('git\'s order of the refs a short name may mean', () => {
  assert.deepEqual(candidates('origin/main'), ['refs/origin/main', 'refs/tags/origin/main',
    'refs/heads/origin/main', 'refs/remotes/origin/main', 'refs/remotes/origin/main/HEAD']);
});

test('one ref, or a full commit name, resolves to its commit', (t) => {
  const { repo, base, head } = fixture(t);
  for (const ref of ['refs/remotes/origin/main', 'origin/main', 'main', 'refs/heads/main', base]) {
    assert.equal(commitOf(repo.dir, ref), base, ref);
  }
  for (const ref of ['HEAD', 'pr', 'HEAD~0', head.slice(0, 12)]) {
    assert.equal(commitOf(repo.dir, ref), head, ref);
  }
  for (const ref of ['refs/remotes/origin/nope', 'nope', '', 'refs/remotes/origin/main~1']) {
    assert.throws(() => commitOf(repo.dir, ref), /does not exist|names no commit/, ref);
  }
});

test('a tag named origin/main shadows nothing: it is refused as ambiguous', (t) => {
  const { repo, base, head } = fixture(t);
  repo.git('tag', 'origin/main', head);
  // git itself takes the tag: what the unqualified rev-parse of base-rule.sh did
  assert.equal(repo.git('rev-parse', 'origin/main^{commit}'), head);
  for (const ref of ['origin/main', 'refs/remotes/origin/main']) {
    assert.throws(() => commitOf(repo.dir, ref),
      /is ambiguous: refs\/tags\/origin\/main/, ref);
  }
  // a branch named like a tag, and a ref named like a commit, are ambiguous too
  repo.git('tag', 'tidy', base);
  repo.git('branch', 'tidy', head);
  assert.throws(() => commitOf(repo.dir, 'tidy'), /ambiguous/);
  assert.throws(() => commitOf(repo.dir, 'refs/heads/tidy'), /refs\/tags\/tidy shadows/);
  repo.git('update-ref', `refs/heads/${base}`, head);
  assert.throws(() => commitOf(repo.dir, base), /refs\/heads\/[0-9a-f]{40} has the same name/);
});

test('the three programs refuse a shadowed base of their own accord', (t) => {
  const { repo, head } = fixture(t);
  repo.git('tag', 'origin/main', head);
  const run = (program, ...args) => spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', program), '--repo', repo.dir, ...args],
    { encoding: 'utf8', env: ENV });
  const pr = path.join(repo.dir, '.git', 'pr.json');
  spawnSync('sh', ['-c', `printf '%s' '{"title":"fix(x): y","body":""}' > "${pr}"`]);
  for (const [program, args] of [
    ['review-verdict.mjs', ['--pr', '1', '--base-branch', 'origin/main']],
    ['review-verdict.mjs', ['--content', '--base-branch', 'refs/remotes/origin/main']],
    ['fail-first.mjs', ['--pr-json', pr, '--base-branch', 'origin/main']],
    ['pr-metadata.mjs', ['--pr-json', pr, '--base', 'refs/remotes/origin/main', '--check']],
  ]) {
    const r = run(program, ...args);
    assert.equal(r.status, 1, `${program} ${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /origin\/main is ambiguous: refs\/tags\/origin\/main/, program);
  }
});
