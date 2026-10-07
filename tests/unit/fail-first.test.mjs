// project.fail-first: scripts/fail-first.mjs on fixture repositories. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it (a process, a title, a body) and
// judged by its exit status and what it prints.
//   node --test tests/unit/fail-first.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'fail-first.mjs');

const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

const VALUE_TEST = (expected) => `import test from 'node:test';
import assert from 'node:assert/strict';
import { value } from '../../src/value.mjs';
test('value is ${expected}', () => assert.equal(value(), ${expected}));
`;

/** main: src/value.mjs returns 1 and its test says so. Returns the repository on a PR branch. */
function fixture() {
  const repo = gitRepo('oscilla-fail-first-');
  repo.commit('base', {
    'src/value.mjs': 'export const value = () => 1;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(1),
    'README.md': 'fixture\n',
  });
  repo.branch('pr');
  return repo;
}

function run(repo, title, body) {
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  writeFileSync(pr, JSON.stringify({ title, body: body ?? '' }));
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, '--pr-json', pr,
    '--base-branch', 'main'], { encoding: 'utf8', env: ENV });
  spawnSync('rm', ['-f', pr]);
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('a fix whose new test also passes on the merge base is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 1; // tidied\n',
    'tests/unit/tidy.test.mjs': VALUE_TEST(1),
  });
  const r = run(repo, 'fix(x): tidy the value');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /tests\/unit\/tidy\.test\.mjs: passes without the change - not evidence/);
  assert.match(r.out, /none of the 1 added or changed unit test file\(s\) fails on the/);
});

test('a fix whose changed test fails on the merge base passes, and the kind is printed', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2),
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /value\.test\.mjs: fails without the change \(assertion\), passes with it/);
  assert.match(r.out, /not ok: value is 2/);
  assert.match(r.out, /proven by 1 of 1 file\(s\)/);
});

test('one proving file is enough, and the others are listed as not evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('feat', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(2),
    'tests/unit/always.test.mjs': "import test from 'node:test';\ntest('always', () => {});\n",
  });
  const r = run(repo, 'feat(x)!: the value is 2');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /always\.test\.mjs: passes without the change - not evidence/);
  assert.match(r.out, /proven by 1 of 2 file\(s\)/);
});

test('the waiver passes a PR that proves nothing, and its reason is printed', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', { 'tests/unit/tidy.test.mjs': VALUE_TEST(1) });
  const title = 'fix(x): tidy the value';
  assert.equal(run(repo, title).status, 1, 'refused without the waiver');
  const r = run(repo, title, 'Summary.\n\nfail-first: n/a docs-only\n\nMore text.');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^fail-first: n\/a docs-only$/m);
  const bare = run(repo, title, 'fail-first: n/a\n');
  assert.equal(bare.status, 1, 'a waiver without a reason is not one');
  assert.match(bare.out, /a waiver needs one/);
});

test('a title that is not feat or fix has nothing to prove', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('docs', { 'README.md': 'fixture, documented\n' });
  for (const title of ['docs(x): say more', 'chore(release): v1.2.3', 'refactor: move',
    'feature: not a conventional type', 'fixes the thing']) {
    const r = run(repo, title);
    assert.equal(r.status, 0, `${title}: ${r.out}`);
    assert.match(r.out, /not a feat or fix PR; nothing to prove/);
  }
});

test('a feat or fix that adds or changes no unit test is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', { 'src/value.mjs': 'export const value = () => 2;\n' });
  const r = run(repo, 'fix: the value is 2');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /adds or changes no tests\/unit\/\*\*\/\*\.test\.mjs file/);
});

test('a test of a module the merge base does not have counts, named as module-not-found', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('feat', {
    'src/extra.mjs': 'export const extra = () => 3;\n',
    'tests/unit/extra.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { extra } from '../../src/extra.mjs';
test('extra is 3', () => assert.equal(extra(), 3));
`,
  });
  const r = run(repo, 'feat(x): extra');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /extra\.test\.mjs: fails without the change \(module-not-found\)/);
  assert.match(r.out, /failure kind\(s\)\s+without the change: module-not-found/);
});

test('a test that fails with the change too is not evidence', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('fix', {
    'src/value.mjs': 'export const value = () => 2;\n',
    'tests/unit/value.test.mjs': VALUE_TEST(3),
  });
  const r = run(repo, 'fix(x): the value is 2');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /value\.test\.mjs: FAILS WITH THE CHANGE TOO \(assertion\) - not evidence/);
});

test('the change is everything outside tests/: a script test fails on the base script', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('base script', { 'scripts/tool.mjs': 'export const tool = () => "old";\n' });
  repo.git('checkout', '-q', 'main');
  repo.git('merge', '-q', '--ff-only', 'pr');
  repo.git('checkout', '-q', 'pr');
  repo.commit('fix', {
    'scripts/tool.mjs': 'export const tool = () => "new";\n',
    'tests/unit/tool.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { tool } from '../../scripts/tool.mjs';
test('tool is new', () => assert.equal(tool(), 'new'));
`,
  });
  const r = run(repo, 'fix(scripts): the tool is new');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /tool\.test\.mjs: fails without the change \(assertion\), passes with it/);
});
