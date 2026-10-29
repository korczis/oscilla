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

// review of #255, round 2. R13: a ref name may hold characters outside [\w./-] ('+', '@',
// non-ASCII), and such a name was handed to git's own lookup, tags first. R14: the existence
// check of a full ref name and the peel to a commit each had no test that failed without them.
test('a name with any character a ref may hold is checked like any other (R13)', (t) => {
  const { repo, base, head } = fixture(t);
  for (const short of ['origin/a+b', 'origin/r@1', 'origin/výstup', 'origin/a,b', 'origin/a=b']) {
    repo.git('update-ref', `refs/remotes/${short}`, base);
    assert.equal(commitOf(repo.dir, short), base, short);
    assert.equal(commitOf(repo.dir, `refs/remotes/${short}`), base, short);
    repo.git('tag', short, head);
    assert.equal(repo.git('rev-parse', `${short}^{commit}`), head, `git takes the tag: ${short}`);
    for (const ref of [short, `refs/remotes/${short}`, `${short}~0`, `${short}^0`]) {
      assert.throws(() => commitOf(repo.dir, ref), /is ambiguous: refs\/tags\//, ref);
    }
  }
  // an expression on a name that one ref answers is that ref's commit, moved as it says
  assert.equal(commitOf(repo.dir, 'pr~1'), base);
  assert.equal(commitOf(repo.dir, 'refs/remotes/origin/main^0'), base);
});

// review of #255, round 3 (R13): the suffixes were a list (~ and ^ steps), so `^{/re}` and
// `@{n}` sent a shadowed name to git's tags-first lookup and skipped the ambiguity check
test('a shadowed name is refused whatever revision suffix follows it (R13)', (t) => {
  const { repo, base, head } = fixture(t);
  repo.git('update-ref', '-m', 'move', 'refs/remotes/origin/main', head);
  repo.git('update-ref', '-m', 'back', 'refs/remotes/origin/main', base);
  const suffixes = ['^{/base}', '@{0}', '@{1}', '~0', '^0', '^{commit}', '^{}'];
  // without a shadow each resolves as git resolves it on the one ref
  for (const s of suffixes) {
    for (const name of ['origin/main', 'refs/remotes/origin/main']) {
      assert.equal(commitOf(repo.dir, `${name}${s}`),
        repo.git('rev-parse', '--verify', `refs/remotes/origin/main${s}^{commit}`), `${name}${s}`);
    }
  }
  assert.equal(commitOf(repo.dir, 'refs/remotes/origin/main@{1}'), head);
  assert.equal(commitOf(repo.dir, `${base}~0`), base);
  // with a tag that shadows it, git takes the tag; here each form is refused
  repo.git('tag', 'origin/main', head);
  assert.equal(repo.git('rev-parse', 'origin/main^{/change}'), head);
  for (const s of [...suffixes, '^{/change}']) {
    for (const name of ['origin/main', 'refs/remotes/origin/main']) {
      assert.throws(() => commitOf(repo.dir, `${name}${s}`), /is ambiguous/, `${name}${s}`);
    }
  }
  // a path after the name is no commit
  repo.git('tag', '-d', 'origin/main');
  assert.throws(() => commitOf(repo.dir, 'refs/remotes/origin/main:README.md'),
    /names no commit/);
});

test('a full ref name must exist as itself, and names a commit (R14)', (t) => {
  const { repo, base, head } = fixture(t);
  // refs/tags/refs/remotes/origin/ghost: git's lookup finds it for refs/remotes/origin/ghost
  repo.git('tag', 'refs/remotes/origin/ghost', head);
  assert.equal(repo.git('rev-parse', 'refs/remotes/origin/ghost^{commit}'), head);
  assert.throws(() => commitOf(repo.dir, 'refs/remotes/origin/ghost'),
    /refs\/remotes\/origin\/ghost does not exist \(git show-ref --verify\)/);
  assert.throws(() => commitOf(repo.dir, 'refs/remotes/origin/nope'), /does not exist/);
  // an annotated tag is peeled to its commit, by its ref or by its object's full name
  repo.git('tag', '-a', '-m', 'release', 'rel', base);
  const tag = repo.git('rev-parse', 'refs/tags/rel');
  assert.notEqual(tag, base);
  repo.git('update-ref', 'refs/remotes/origin/rel', tag);
  assert.equal(commitOf(repo.dir, 'refs/remotes/origin/rel'), base);
  assert.equal(commitOf(repo.dir, tag), base);
  // a ref to a tree names no commit
  const tree = repo.git('rev-parse', `${base}^{tree}`);
  repo.git('update-ref', 'refs/remotes/origin/tree', tree);
  assert.throws(() => commitOf(repo.dir, 'refs/remotes/origin/tree'), /names no commit/);
  assert.throws(() => commitOf(repo.dir, tree), /names no commit/);
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
