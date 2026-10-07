// project.review-verdict: scripts/review-verdict.mjs on fixture PRs. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it and judged by its exit status and
// what it prints.
//   node --test tests/unit/review-verdict.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from './fixtures/git-repo.mjs';
import { GUARDED, isGuarded, verdictProblems } from '../../scripts/review-verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'review-verdict.mjs');
const PR = 42;
const VERDICT_FILE = `.ai/repo/reviews/${PR}.yaml`;

const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[k];

function script(repo, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, ...args],
    { encoding: 'utf8', env: ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const check = (repo) => script(repo, '--pr', String(PR), '--base-branch', 'main');
const tree = (repo) => script(repo, '--tree').out.trim();

function verdict({ tree: t, verdict: v = 'merge', reviewer = 'oscilla-25', pr = PR,
  findings = [] }) {
  const row = (f) => `  - { id: ${f.id}, severity: ${f.severity}, status: ${f.status}, title: t }`;
  return ['schema: review-verdict/v1', `pr: ${pr}`, `verdict: ${v}`, `reviewer: ${reviewer}`,
    `tree: ${t}`, findings.length ? `findings:\n${findings.map(row).join('\n')}` : 'findings: []',
    ''].join('\n');
}

/** main with an engine file, and a PR branch that changes it. */
function fixture(change = { 'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n' }) {
  const repo = gitRepo('oscilla-review-verdict-');
  repo.commit('base', {
    'src/js/audio/audio-engine.js': 'export const gain = 1;\n',
    'README.md': 'fixture\n',
  });
  repo.branch('pr');
  repo.commit('change', change);
  return repo;
}

test('a PR changing the audio engine with no verdict file is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /src\/js\/audio\/audio-engine\.js/);
  assert.match(r.out, /REFUSED: \.ai\/repo\/reviews\/42\.yaml is not in the head commit/);
  assert.ok(r.out.includes(`tree: ${tree(repo)}`), 'the refusal names the hash to record');
});

test('a verdict at the head tree with every finding closed is accepted', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const reviewed = tree(repo);
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ tree: reviewed,
    findings: [{ id: 'R1', severity: 'P1', status: 'closed' },
      { id: 'R2', severity: 'P3', status: 'open' }] }) });
  assert.equal(tree(repo), reviewed, 'committing the verdict does not change the reviewed tree');
  const r = check(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /accepted: verdict merge by oscilla-25 for tree [0-9a-f]{40}; 2 finding/);
});

test('a verdict for the previous tree, then one more source commit, is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ tree: tree(repo) }) });
  assert.equal(check(repo).status, 0, 'accepted before the extra commit');
  repo.commit('one more', { 'src/js/audio/audio-engine.js': 'export const gain = 0.25;\n' });
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the change moved after the review/);
});

test('a verdict at the head tree listing an open P0 or P1 is refused', (t) => {
  for (const severity of ['P0', 'P1']) {
    const repo = fixture();
    t.after(() => repo.dispose());
    repo.commit('verdict', { [VERDICT_FILE]: verdict({ tree: tree(repo),
      findings: [{ id: 'R1', severity, status: 'open' }] }) });
    const r = check(repo);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, new RegExp(`finding R1 \\(${severity}\\) is open`));
  }
});

test('a docs-only PR passes without a verdict', (t) => {
  const repo = fixture({ 'docs/notes.md': 'notes\n', 'src/js/ui/shell.js': '// ui\n' });
  t.after(() => repo.dispose());
  const r = check(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /none of the 2 changed path\(s\) is guarded; no verdict needed/);
});

test('changes-requested, another PR number, no reviewer, no findings list: refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const reviewed = tree(repo);
  const cases = [
    [verdict({ tree: reviewed, verdict: 'changes-requested' }),
      /verdict is "changes-requested", not merge/],
    [verdict({ tree: reviewed, pr: 41 }), /pr is 41, not 42/],
    [verdict({ tree: reviewed, reviewer: '""' }), /reviewer \(the reviewing session\) is missing/],
    [verdict({ tree: reviewed }).replace('findings: []\n', ''), /findings must be a list/],
    [verdict({ tree: reviewed }).replace('review-verdict/v1', 'other/v9'), /schema is "other\/v9"/],
    [verdict({ tree: reviewed, findings: [{ id: 'R1', severity: 'high', status: 'closed' }] }),
      /severity "high" is not one of P0, P1, P2, P3/],
    [verdict({ tree: reviewed, findings: [{ id: 'R1', severity: 'P0', status: 'wontfix' }] }),
      /status "wontfix" is not open or closed/],
    ['verdict: [merge\n', /is not valid YAML/],
  ];
  for (const [text, expected] of cases) {
    repo.commit('verdict', { [VERDICT_FILE]: text });
    const r = check(repo);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, expected);
  }
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ tree: reviewed }) });
  assert.equal(check(repo).status, 0, 'and the plain verdict is accepted on the same tree');
});

test('a deleted guarded file needs a verdict too', (t) => {
  const repo = gitRepo('oscilla-review-verdict-');
  t.after(() => repo.dispose());
  repo.commit('base', { 'scripts/release-old.mjs': '// old\n', 'README.md': 'fixture\n' });
  repo.branch('pr');
  repo.git('rm', '-q', 'scripts/release-old.mjs');
  repo.commit('remove', {});
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /scripts\/release-old\.mjs/);
});

test('the guarded paths are the rule\'s list', () => {
  assert.deepEqual(GUARDED, ['src/js/audio/*', 'src/js/analysis/*', 'src/js/experiments/*',
    'src/js/studio/*', 'src/js/core/storage*', 'scripts/release-*', '.github/workflows/*']);
  for (const f of ['src/js/audio/voice.js', 'src/js/analysis/peak.js',
    'src/js/experiments/store.js', 'src/js/studio/runtime/x.js', 'src/js/core/storage.js',
    'src/js/core/storage-inventory.js', 'scripts/release-publish.mjs',
    '.github/workflows/ci.yml']) {
    assert.equal(isGuarded(f), true, f);
  }
  for (const f of ['src/js/core/safety.js', 'src/js/ui/findings.js', 'scripts/build.mjs',
    '.github/scripts/ci-install.sh', 'tests/unit/v3-engine.test.mjs', 'docs/src/js/audio/x.md',
    '.ai/repo/reviews/1.yaml']) {
    assert.equal(isGuarded(f), false, f);
  }
});

test('verdictProblems is empty only for a complete verdict', () => {
  const ok = { schema: 'review-verdict/v1', pr: 7, verdict: 'merge', reviewer: 'r',
    tree: 'a'.repeat(40), findings: [] };
  assert.deepEqual(verdictProblems(ok, { pr: 7, tree: 'a'.repeat(40) }), []);
  assert.equal(verdictProblems(null, { pr: 7, tree: 'a'.repeat(40) }).length, 1);
  assert.equal(verdictProblems([], { pr: 7, tree: 'a'.repeat(40) }).length, 1);
  const at = { pr: 7, tree: 'a'.repeat(40) };
  assert.equal(verdictProblems({ ...ok, tree: undefined }, at).length, 1);
  assert.equal(verdictProblems({ ...ok, findings: ['R1'] }, at).length, 1);
});
