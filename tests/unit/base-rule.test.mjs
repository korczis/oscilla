// project.fail-first and project.review-verdict are judged by the BASE branch's copy of their
// programs: .github/scripts/base-rule.sh on fixture pull requests that rewrite the program
// that would judge them. Each fixture's `main` carries the real programs of this checkout.
//   node --test tests/unit/base-rule.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = path.join(ROOT, '.github', 'scripts', 'base-rule.sh');
const PROGRAMS = ['scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
  'scripts/yaml-subset.mjs'];
const real = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_TEST_CONTEXT']) delete ENV[k];

const sh = (repo, ...args) => {
  const r = spawnSync('bash', [WRAPPER, ...args], { cwd: repo.dir, encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const own = (repo, program, ...args) => {
  const r = spawnSync(process.execPath, [path.join(repo.dir, program), '--repo', repo.dir,
    ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** main: the real programs, an engine file, a value with its test. On a PR branch. */
function fixture(t, { programs = PROGRAMS } = {}) {
  const repo = gitRepo('oscilla-base-rule-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    ...Object.fromEntries(programs.map((p) => [p, real(p)])),
    'src/js/audio/audio-engine.js': 'export const gain = 1;\n',
    'src/value.mjs': 'export const value = () => 1;\n',
    'README.md': 'fixture\n',
  });
  repo.branch('pr');
  return repo;
}
const VERDICT = ['--pr', '42', '--base-branch', 'main'];

test('a PR that deletes the audio entry from GUARDED is judged by main\'s list', (t) => {
  const repo = fixture(t);
  const edited = real('scripts/review-verdict.mjs').replace("  'src/js/audio/*',\n", '');
  assert.notEqual(edited, real('scripts/review-verdict.mjs'));
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': edited,
  });
  const r = sh(repo, 'main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /base-rule: scripts\/review-verdict\.mjs of main \([0-9a-f]{12}\) judges/);
  assert.match(r.out, /src\/js\/audio\/audio-engine\.js/);
  assert.match(r.out, /REFUSED: \.ai\/repo\/reviews\/42\.yaml is not in the head commit/);
  // and the edited copy still sees its own file as guarded, since the list names it
  const self = own(repo, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(self.status, 1, self.out);
  assert.doesNotMatch(self.out, /audio-engine/);
});

test('a PR that replaces the program with one that always accepts is refused', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': "console.log('review-verdict: accepted');\n",
    'scripts/fail-first.mjs': "console.log('fail-first: proven');\n",
    'tests/unit/tidy.test.mjs': "import test from 'node:test';\ntest('nothing', () => {});\n",
  });
  assert.equal(own(repo, 'scripts/review-verdict.mjs', ...VERDICT).status, 0,
    'the PR\'s own copy lets it through: this is what must not judge');
  const verdict = sh(repo, 'main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(verdict.status, 1, verdict.out);
  assert.match(verdict.out, /scripts\/review-verdict\.mjs\n/);
  assert.match(verdict.out, /REFUSED/);

  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ title: 'fix(x): tidy', body: '' }));
  const first = sh(repo, 'main', 'scripts/fail-first.mjs', '--pr-json', pr,
    '--base-branch', 'main');
  assert.equal(first.status, 1, first.out);
  assert.match(first.out, /base-rule: scripts\/fail-first\.mjs of main/);
  assert.match(first.out, /tidy\.test\.mjs: passes without the change - not evidence/);
});

test('the program\'s exit status and output pass through when it accepts', (t) => {
  const repo = fixture(t);
  repo.commit('docs', { 'README.md': 'fixture, documented\n' });
  const r = sh(repo, 'main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /none of the 1 changed path\(s\) is guarded; no verdict needed/);
});

test('only where the base has no program does the checkout\'s copy judge, with a warning', (t) => {
  const repo = fixture(t, { programs: [] });
  repo.commit('introduce', {
    ...Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])),
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
  });
  const r = sh(repo, 'main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::warning::base-rule: main \([0-9a-f]{12}\) has no scripts\/review-verdict/);
  assert.match(r.out, /REFUSED/);
});

test('any other program, and a base that does not exist, are refused', (t) => {
  const repo = fixture(t);
  assert.equal(sh(repo, 'main', 'scripts/build.mjs').status, 2);
  assert.notEqual(sh(repo, 'no-such-ref', 'scripts/review-verdict.mjs', ...VERDICT).status, 0);
  assert.notEqual(sh(repo).status, 0);
});

test('a program started through a symlinked directory still runs, not exit 0 unrun', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-base-rule-link-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'));
  for (const program of ['review-verdict.mjs', 'fail-first.mjs']) {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', program)],
      { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 2, `${program}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage: node scripts\//);
  }
  const rules = spawnSync(process.execPath, [path.join(dir, 'scripts', 'ci-workflow-rules.mjs')],
    { encoding: 'utf8', env: ENV });
  assert.match(rules.stdout + rules.stderr, /project\.ci-bounded:/);
});
