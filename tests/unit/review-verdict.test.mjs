// project.review-verdict: scripts/review-verdict.mjs on fixture PRs. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it and judged by its exit status and
// what it prints.
//   node --test tests/unit/review-verdict.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
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
const content = (repo) => script(repo, '--content', '--base-branch', 'main').out.trim();

function verdict({ content: t, verdict: v = 'merge', reviewer = 'oscilla-25', pr = PR,
  findings = [] }) {
  const row = (f) => `  - { id: ${f.id}, severity: ${f.severity}, status: ${f.status}, title: t }`;
  return ['schema: review-verdict/v1', `pr: ${pr}`, `verdict: ${v}`, `reviewer: ${reviewer}`,
    `content: ${t}`,
    findings.length ? `findings:\n${findings.map(row).join('\n')}` : 'findings: []',
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
  assert.match(content(repo), /^[0-9a-f]{64}$/);
  assert.ok(r.out.includes(`content: ${content(repo)}`), 'the refusal names the digest to record');
});

test('a verdict for the head\'s content with every finding closed is accepted', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  const reviewed = content(repo);
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ content: reviewed,
    findings: [{ id: 'R1', severity: 'P1', status: 'closed' },
      { id: 'R2', severity: 'P3', status: 'open' }] }) });
  assert.equal(content(repo), reviewed, 'committing the verdict does not change the digest');
  const r = check(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /accepted: verdict merge by oscilla-25 for content [0-9a-f]{64} /);
  assert.match(r.out, /\(1 guarded path\(s\)\); 2 finding/);
});

test('a verdict, then one more commit to a guarded path, is refused', (t) => {
  const repo = fixture();
  t.after(() => repo.dispose());
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ content: content(repo) }) });
  assert.equal(check(repo).status, 0, 'accepted before the extra commit');
  repo.commit('one more', { 'src/js/audio/audio-engine.js': 'export const gain = 0.25;\n' });
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the change moved after the review/);
});

test('a verdict for the head\'s content listing an open P0 or P1 is refused', (t) => {
  for (const severity of ['P0', 'P1']) {
    const repo = fixture();
    t.after(() => repo.dispose());
    repo.commit('verdict', { [VERDICT_FILE]: verdict({ content: content(repo),
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
  const reviewed = content(repo);
  const cases = [
    [verdict({ content: reviewed, verdict: 'changes-requested' }),
      /verdict is "changes-requested", not merge/],
    [verdict({ content: reviewed, pr: 41 }), /pr is 41, not 42/],
    [verdict({ content: reviewed, reviewer: '""' }),
      /reviewer \(the reviewing session\) is missing/],
    [verdict({ content: reviewed }).replace('findings: []\n', ''), /findings must be a list/],
    [verdict({ content: reviewed }).replace('review-verdict/v1', 'other/v9'),
      /schema is "other\/v9"/],
    [verdict({ content: reviewed, findings: [{ id: 'R1', severity: 'high', status: 'closed' }] }),
      /severity "high" is not one of P0, P1, P2, P3/],
    [verdict({ content: reviewed, findings: [{ id: 'R1', severity: 'P0', status: 'wontfix' }] }),
      /status "wontfix" is not open or closed/],
    ['verdict: [merge\n', /is not valid YAML/],
  ];
  for (const [text, expected] of cases) {
    repo.commit('verdict', { [VERDICT_FILE]: text });
    const r = check(repo);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, expected);
  }
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ content: reviewed }) });
  assert.equal(check(repo).status, 0, 'and the plain verdict is accepted on the same content');
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
    'src/js/studio/*', 'src/js/core/storage*', 'scripts/release-*',
    '.github/*', 'scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
    'scripts/ci-workflow-rules.mjs', 'scripts/yaml-subset.mjs',
    'tests/unit/review-verdict.test.mjs', 'tests/unit/fail-first.test.mjs',
    'tests/unit/ci-workflows.test.mjs', 'tests/unit/ci-knowledge-job.test.mjs',
    'tests/unit/yaml-subset.test.mjs', 'tests/unit/base-rule.test.mjs',
    'tests/unit/fixtures/git-repo.mjs']);
  for (const f of ['src/js/audio/voice.js', 'src/js/analysis/peak.js',
    'src/js/experiments/store.js', 'src/js/studio/runtime/x.js', 'src/js/core/storage.js',
    'src/js/core/storage-inventory.js', 'scripts/release-publish.mjs',
    '.github/workflows/ci.yml', '.github/scripts/ci-install.sh', '.github/scripts/base-rule.sh',
    '.github/actions/setup/action.yml', '.github/doctor-verdict.jq',
    ...GUARDED.filter((g) => !g.endsWith('*'))]) {
    assert.equal(isGuarded(f), true, f);
  }
  for (const f of ['src/js/core/safety.js', 'src/js/ui/findings.js', 'scripts/build.mjs',
    'scripts/review-verdict.mjs.bak', 'tests/unit/v3-engine.test.mjs', 'docs/src/js/audio/x.md',
    'docs/.github/workflows/ci.yml', '.ai/repo/reviews/1.yaml']) {
    assert.equal(isGuarded(f), false, f);
  }
  // every guarded file that is not a pattern exists: a renamed program would otherwise leave
  // the list guarding a name nothing has
  for (const f of GUARDED.filter((g) => !g.endsWith('*'))) {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} exists`);
  }
});

test('a PR changing what enforces the process rules needs a verdict', (t) => {
  for (const file of ['scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
    'scripts/ci-workflow-rules.mjs', 'scripts/yaml-subset.mjs', '.github/scripts/ci-install.sh',
    '.github/actions/setup/action.yml', '.github/doctor-verdict.jq',
    'tests/unit/review-verdict.test.mjs', 'tests/unit/fixtures/git-repo.mjs']) {
    const repo = gitRepo('oscilla-review-verdict-');
    t.after(() => repo.dispose());
    repo.commit('base', { [file]: '# base\n', 'README.md': 'fixture\n' });
    repo.branch('pr');
    repo.commit('change', { [file]: '# changed\n' });
    const r = check(repo);
    assert.equal(r.status, 1, `${file}: ${r.out}`);
    assert.ok(r.out.includes(`  ${file}\n`), r.out);
    assert.match(r.out, /REFUSED: \.ai\/repo\/reviews\/42\.yaml is not in the head commit/);
  }
});

test('verdictProblems is empty only for a complete verdict', () => {
  const digest = 'a'.repeat(64);
  const ok = { schema: 'review-verdict/v1', pr: 7, verdict: 'merge', reviewer: 'r',
    content: digest, findings: [] };
  const at = { pr: 7, content: digest };
  assert.deepEqual(verdictProblems(ok, at), []);
  assert.equal(verdictProblems(null, at).length, 1);
  assert.equal(verdictProblems([], at).length, 1);
  assert.equal(verdictProblems({ ...ok, content: undefined }, at).length, 1);
  // a git tree hash (the field's first form) is not a content digest
  assert.equal(verdictProblems({ ...ok, content: 'a'.repeat(40) }, at).length, 1);
  assert.equal(verdictProblems({ ...ok, content: undefined, tree: digest }, at).length, 1);
  assert.equal(verdictProblems({ ...ok, findings: ['R1'] }, at).length, 1);
});

// What a merge of main, and a commit outside the guarded paths, do to a recorded verdict.

/** A reviewed PR: main has two engine files and a README; the PR changes one engine file. */
function reviewed(t) {
  const repo = gitRepo('oscilla-review-verdict-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    'src/js/audio/audio-engine.js': 'export const gain = 1;\n\n\n\n\nexport const pan = 0;\n',
    'src/js/audio/voice.js': 'export const voices = 1;\n',
    'src/js/ui/shell.js': '// ui\n',
    'dist/index.html': '<!-- built from base -->\n',
    'README.md': 'fixture\n',
  });
  repo.branch('pr');
  repo.commit('change', {
    'src/js/audio/audio-engine.js': 'export const gain = 0.5;\n\n\n\n\nexport const pan = 0;\n',
    'dist/index.html': '<!-- built from the change -->\n',
  });
  const digest = content(repo);
  repo.commit('verdict', { [VERDICT_FILE]: verdict({ content: digest }) });
  assert.equal(check(repo).status, 0, 'accepted as reviewed');
  return { repo, digest };
}
function mainMoves(repo, files) {
  repo.git('checkout', '-q', 'main');
  repo.commit('main moves', files);
  repo.git('checkout', '-q', 'pr');
}

test('a merge of main that leaves the PR\'s guarded paths alone keeps the verdict', (t) => {
  const { repo, digest } = reviewed(t);
  // main changes another guarded file, an unguarded one, and the artifact (a conflict the
  // PR resolves by rebuilding, as every src PR does when main moved)
  mainMoves(repo, { 'src/js/audio/voice.js': 'export const voices = 8;\n',
    'README.md': 'fixture, edited on main\n', 'dist/index.html': '<!-- built from main -->\n' });
  assert.throws(() => repo.git('merge', '-q', '--no-edit', 'main'), 'dist conflicts');
  repo.commit('merge main, rebuild dist', { 'dist/index.html': '<!-- rebuilt on the merge -->\n' });
  assert.equal(repo.git('rev-list', '--count', '--merges', 'main..HEAD'), '1', 'a merge commit');
  assert.equal(content(repo), digest, 'the digest is the PR\'s content, not the tree');
  const r = check(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 guarded path\(s\) changed:\n {2}src\/js\/audio\/audio-engine\.js\n/);
});

test('a merge of main that changes a guarded file of the PR makes the verdict stale', (t) => {
  const { repo, digest } = reviewed(t);
  // another region of the same file: git merges it without a conflict, and nobody reviewed
  // the combination
  mainMoves(repo, { 'src/js/audio/audio-engine.js':
    'export const gain = 1;\n\n\n\n\nexport const pan = 1;\n' });
  repo.git('merge', '-q', '--no-edit', 'main');
  assert.notEqual(content(repo), digest);
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the change moved after the review/);
});

test('a merge commit that slips in a guarded change is stale too', (t) => {
  const { repo } = reviewed(t);
  mainMoves(repo, { 'README.md': 'fixture, edited on main\n' });
  repo.git('merge', '-q', '--no-edit', '--no-commit', 'main');
  repo.commit('merge main', { 'src/js/audio/voice.js': 'export const voices = 99;\n' });
  const r = check(repo);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /2 guarded path\(s\) changed/);
  assert.match(r.out, /the change moved after the review/);
});

test('a later commit outside the guarded paths keeps the verdict; a new guarded path does not',
  (t) => {
    const { repo, digest } = reviewed(t);
    repo.commit('ui and artifact', { 'src/js/ui/shell.js': '// ui, edited\n',
      'dist/index.html': '<!-- rebuilt -->\n', 'docs/notes.md': 'notes\n' });
    assert.equal(content(repo), digest);
    assert.equal(check(repo).status, 0);
    repo.commit('one more guarded file', { 'src/js/analysis/peak.js': '// new\n' });
    const r = check(repo);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /the change moved after the review/);
  });

test('a guarded change reverted to the base needs no verdict any more', (t) => {
  const { repo } = reviewed(t);
  repo.commit('revert', {
    'src/js/audio/audio-engine.js': 'export const gain = 1;\n\n\n\n\nexport const pan = 0;\n' });
  const r = check(repo);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /no verdict needed/);
});

test('a guarded file with a non-ASCII or quoted name is seen', (t) => {
  for (const name of ['src/js/audio/v\u00fdstup.js', 'src/js/audio/a "b".js']) {
    const repo = fixture({ [name]: '// new\n' });
    t.after(() => repo.dispose());
    const r = check(repo);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`  ${name}\n`), r.out);
  }
});

test('the digest covers mode and deletion, and nothing but the guarded paths', (t) => {
  const { repo, digest } = reviewed(t);
  assert.deepEqual(script(repo, '--content', '--list', '--base-branch', 'main').out.split('\n')
    .filter(Boolean), [digest, '  src/js/audio/audio-engine.js']);
  chmodSync(path.join(repo.dir, 'src/js/audio/audio-engine.js'), 0o755);
  repo.commit('mode', {});
  const executable = content(repo);
  assert.notEqual(executable, digest, 'a mode change is a change');
  repo.git('rm', '-q', 'src/js/audio/audio-engine.js');
  repo.commit('delete', {});
  assert.notEqual(content(repo), executable, 'a deletion is not the file');
  assert.notEqual(content(repo), digest);
});
