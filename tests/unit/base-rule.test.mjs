// project.fail-first, project.review-verdict and project.pr-names-its-plan are judged by the
// BASE branch's copy of their programs: .github/scripts/base-rule.sh on fixture pull requests
// that rewrite the program that would judge them. Each fixture's `main` carries the real
// programs of this checkout.
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
  'scripts/git-ref.mjs', 'scripts/yaml-subset.mjs', 'scripts/pr-metadata.mjs',
  'scripts/release-analyze.mjs', 'scripts/release-metadata.mjs'];
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
  // what actions/checkout fetches: the base branch as a remote-tracking ref
  repo.git('update-ref', BASE, 'main');
  repo.branch('pr');
  return repo;
}
const BASE = 'refs/remotes/origin/main';
const VERDICT = ['--pr', '42', '--base-branch', BASE];
const judged = (program) => new RegExp(`base-rule: scripts/${program}\\.mjs of ${BASE}`
  + ' \\([0-9a-f]{12}\\) judges this pull request');

test('a PR that deletes the audio entry from GUARDED is judged by main\'s list', (t) => {
  const repo = fixture(t);
  const edited = real('scripts/review-verdict.mjs').replace("  'src/js/audio/*',\n", '');
  assert.notEqual(edited, real('scripts/review-verdict.mjs'));
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': edited,
  });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('review-verdict'));
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
  const verdict = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(verdict.status, 1, verdict.out);
  assert.match(verdict.out, /scripts\/review-verdict\.mjs\n/);
  assert.match(verdict.out, /REFUSED/);

  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.pr.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ title: 'fix(x): tidy', body: '' }));
  const first = sh(repo, BASE, 'scripts/fail-first.mjs', '--pr-json', pr,
    '--base-branch', BASE);
  assert.equal(first.status, 1, first.out);
  assert.match(first.out, judged('fail-first'));
  assert.match(first.out, /tidy\.test\.mjs: passes without the change - not evidence/);
});

test('a PR that replaces pr-metadata.mjs with one that always passes is refused (R022)', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'scripts/pr-metadata.mjs': "console.log('pr-metadata: no violation');\n",
  });
  const pr = path.join(repo.dir, '..', `${path.basename(repo.dir)}.meta.json`);
  t.after(() => spawnSync('rm', ['-f', pr]));
  writeFileSync(pr, JSON.stringify({ number: 42, title: 'chore(x): tidy', headRefName: 'pr',
    body: '' }));
  const args = ['--pr-json', pr, '--head', 'HEAD', '--base', BASE, '--check'];
  assert.equal(own(repo, 'scripts/pr-metadata.mjs', ...args).status, 0,
    'the PR\'s own copy lets it through: this is what must not judge');
  const r = sh(repo, BASE, 'scripts/pr-metadata.mjs', ...args);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('pr-metadata'));
  assert.match(r.out, /plan-id-missing: /);
});

test('the program\'s exit status and output pass through when it accepts', (t) => {
  const repo = fixture(t);
  repo.commit('docs', { 'README.md': 'fixture, documented\n' });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /none of the 1 changed path\(s\) is guarded; no verdict needed/);
});

test('only where the base has no program does the checkout\'s copy judge, with a warning', (t) => {
  const repo = fixture(t, { programs: [] });
  repo.commit('introduce', {
    ...Object.fromEntries(PROGRAMS.map((p) => [p, real(p)])),
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
  });
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out,
    /::warning::base-rule: refs\/remotes\/origin\/main \([0-9a-f]{12}\) has no scripts\/review/);
  assert.match(r.out, /REFUSED/);
});

test('any other program, and a base that does not exist, are refused', (t) => {
  const repo = fixture(t);
  assert.equal(sh(repo, BASE, 'scripts/build.mjs').status, 2);
  assert.notEqual(sh(repo, 'refs/remotes/origin/no-such-ref', 'scripts/review-verdict.mjs',
    ...VERDICT).status, 0);
  assert.notEqual(sh(repo).status, 0);
});

// R2 (review of #255): git looks a short name up in refs/tags/ before refs/remotes/, and the
// checkout fetches tags, so a pushed tag named origin/main shadowed the base branch and the
// pull request's own program judged it.
test('a tag named origin/main does not let the PR\'s own program judge (R2)', (t) => {
  const repo = fixture(t);
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n',
    'scripts/review-verdict.mjs': "console.log('review-verdict: accepted');\n",
  });
  repo.git('tag', 'origin/main', 'HEAD');
  const accepted = /review-verdict: accepted/;
  // the unqualified name every caller passed: refused before anything runs
  const short = sh(repo, 'origin/main', 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(short.status, 2, short.out);
  assert.match(short.out,
    /base-rule: origin\/main is not a remote-tracking ref \(refs\/remotes\/\.\.\.\)/);
  assert.doesNotMatch(short.out, accepted);
  // qualified, while the tag shadows its short name: refused as ambiguous
  const shadowed = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(shadowed.status, 2, shadowed.out);
  assert.match(shadowed.out,
    /base-rule: refs\/remotes\/origin\/main is ambiguous: refs\/tags\/origin\/main shadows/);
  assert.doesNotMatch(shadowed.out, accepted);
  // without the tag the base's program judges, by its ref or by its full commit name
  repo.git('tag', '-d', 'origin/main');
  const r = sh(repo, BASE, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, judged('review-verdict'));
  assert.match(r.out, /REFUSED/);
  const sha = repo.git('rev-parse', 'main');
  const bySha = sh(repo, sha, 'scripts/review-verdict.mjs', ...VERDICT);
  assert.equal(bySha.status, 1, bySha.out);
  assert.match(bySha.out, /REFUSED/);
  // nothing else names a base: a branch, a tag, HEAD, an abbreviated commit, an expression
  repo.git('tag', 'v1', 'main');
  for (const ref of ['main', 'refs/heads/main', 'refs/tags/v1', 'HEAD', sha.slice(0, 12),
    `${BASE}~0`, `${BASE}/`]) {
    const x = sh(repo, ref, 'scripts/review-verdict.mjs', ...VERDICT);
    assert.equal(x.status, 2, `${ref}: ${x.out}`);
    assert.doesNotMatch(x.out, accepted, ref);
  }
});

test('a program started through a symlinked directory still runs, not exit 0 unrun', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-base-rule-link-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'));
  for (const program of ['review-verdict.mjs', 'fail-first.mjs', 'pr-metadata.mjs']) {
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', program)],
      { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 2, `${program}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage: node scripts\//);
  }
  const rules = spawnSync(process.execPath, [path.join(dir, 'scripts', 'ci-workflow-rules.mjs')],
    { encoding: 'utf8', env: ENV });
  assert.match(rules.stdout + rules.stderr, /project\.ci-bounded:/);
});
