// project.review-verdict: scripts/review-verdict.mjs on fixture PRs. Each fixture is a `main`
// commit and a PR branch; the script is run as CI runs it and judged by its exit status and
// what it prints.
//   node --test tests/unit/review-verdict.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
    'src/js/studio/*', 'src/js/measurement/*', 'src/js/calibration/*', 'src/js/core/storage*',
    'src/js/core/safety*', 'src/js/ui/measure.js', 'src/js/ui/measure/*',
    'src/js/ui/experiments.js', 'src/js/ui/findings.js',
    'scripts/release-*', 'scripts/build*', 'scripts/pack-single-file.mjs',
    'scripts/stamp-build.mjs', 'scripts/verify-deploy.mjs', 'scripts/verify-dist.mjs',
    'tests/unit/release-*', 'tests/unit/version-authority.test.mjs',
    'tests/browser/live-smoke.cjs',
    '.github/*', 'scripts/review-verdict.mjs', 'scripts/fail-first.mjs',
    'scripts/ci-workflow-rules.mjs', 'scripts/yaml-subset.mjs',
    'tests/unit/review-verdict.test.mjs', 'tests/unit/fail-first.test.mjs',
    'tests/unit/ci-workflows.test.mjs', 'tests/unit/ci-knowledge-job.test.mjs',
    'tests/unit/yaml-subset.test.mjs', 'tests/unit/base-rule.test.mjs',
    'tests/unit/fixtures/git-repo.mjs']);
  for (const f of ['src/js/audio/voice.js', 'src/js/analysis/peak.js',
    'src/js/experiments/store.js', 'src/js/studio/runtime/x.js', 'src/js/core/storage.js',
    'src/js/ui/measure/session.js', 'src/js/ui/measure/test-seam.js',
    'src/js/core/storage-inventory.js', 'scripts/release-publish.mjs',
    '.github/workflows/ci.yml', '.github/scripts/ci-install.sh', '.github/scripts/base-rule.sh',
    '.github/actions/setup/action.yml', '.github/doctor-verdict.jq',
    ...GUARDED.filter((g) => !g.endsWith('*'))]) {
    assert.equal(isGuarded(f), true, f);
  }
  for (const f of ['src/js/main.js', 'src/index.html', 'src/js/ui/shell.js',
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

// The incidents the rule's rationale cites, by the src/js files their pull requests changed
// (gh pr view <n> --json files), and the programs and tests that prove a deployment and a
// release. src/js/main.js (#149, the composition root), src/index.html and src/styles/ are
// markup, wiring and style, and stay unguarded on purpose: see the rule's Required behaviour.
const INCIDENT_FILES = {
  139: ['src/js/calibration/level.js', 'src/js/experiments/evidence.js',
    'src/js/experiments/hash.js', 'src/js/experiments/migrate.js',
    'src/js/experiments/schema.js', 'src/js/experiments/semantic-diff.js',
    'src/js/experiments/validate.js', 'src/js/measurement/engine.js',
    'src/js/measurement/quality.js', 'src/js/measurement/views/compare-view.js',
    'src/js/studio/provenance.js', 'src/js/ui/experiments.js', 'src/js/ui/measure.js'],
  140: ['src/js/studio/compiler.js', 'src/js/studio/runtime.js', 'src/js/studio/transport.js'],
  149: ['src/js/experiments/evidence.js', 'src/js/experiments/findings.js',
    'src/js/experiments/store.js', 'src/js/ui/experiments.js', 'src/js/ui/findings.js'],
};
const PROOF_FILES = ['scripts/verify-deploy.mjs', 'scripts/stamp-build.mjs',
  'scripts/verify-dist.mjs', 'scripts/build.mjs', 'scripts/build-config.mjs',
  'scripts/build-analysis-worker.mjs', 'scripts/pack-single-file.mjs',
  'src/js/core/safety.js', 'src/js/measurement/capture.js',
  'tests/unit/release-publish.test.mjs', 'tests/unit/release-analyze.test.mjs',
  'tests/unit/release-record.test.mjs', 'tests/unit/release-cadence.test.mjs',
  'tests/unit/release-provenance.test.mjs', 'tests/unit/version-authority.test.mjs',
  'tests/browser/live-smoke.cjs'];

test('V272 D5: the files of the cited incidents and the deploy and release proof are guarded',
  () => {
    for (const [pr, files] of Object.entries(INCIDENT_FILES)) {
      for (const f of files) assert.equal(isGuarded(f), true, `#${pr}: ${f}`);
    }
    for (const f of PROOF_FILES) {
      assert.equal(isGuarded(f), true, f);
      assert.ok(existsSync(path.join(ROOT, f)), `${f} exists`);
    }
  });

// E002: the MEASURE adapter src/js/ui/measure.js is composed of the modules under
// src/js/ui/measure/; the code that decides what MEASURE runs and saves stays guarded whichever
// of them it lives in.
test('E002: every module of the MEASURE adapter is guarded', () => {
  const dir = path.join(ROOT, 'src', 'js', 'ui', 'measure');
  const modules = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(modules.length > 0, 'src/js/ui/measure/ holds the split modules');
  for (const f of ['src/js/ui/measure.js', ...modules.map((m) => `src/js/ui/measure/${m}`)]) {
    assert.equal(isGuarded(f), true, f);
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

// A train's members (#367: member #303 rode with its own verdict at `changes` and open P1/P2,
// and nothing refused it). The train is known as scripts/fail-first.mjs knows it, by its head
// branch or title, and, for a feature train titled as one feat, by the `| member | what |`
// table of its body; the members are that table's rows. Each member's own verdict at the train
// head must be merge, or the train's verdict names the member under `members:` and judges it.

const TRAIN_BODY = (members) => ['## Members', '', '| member | what |', '|---|---|',
  ...members.map((n) => `| #${n} | chore(x): member ${n} |`), ''].join('\n');

/** The PR JSON the CI step writes (`gh pr view --json title,body,headRefName`), as a file. */
function prJson(t, { title = 'Merge train 2026-11-01: #303, #304', headRefName = 'train/2026-11-01',
  members = [303, 304], body = TRAIN_BODY(members) } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-review-verdict-pr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'pr.json');
  writeFileSync(file, JSON.stringify({ title, body, headRefName }));
  return file;
}
const trainCheck = (repo, file) => script(repo, '--pr', String(PR), '--base-branch', 'main',
  '--pr-json', file);

/** A member's own verdict: `changes` with an open P1, or `merge`. */
const memberVerdict = (n, v) => verdict({ content: 'b'.repeat(64), pr: n, verdict: v,
  findings: v === 'merge' ? [] : [{ id: 'R-1', severity: 'P1', status: 'open' }] });

/** The train's own verdict for its content, with an optional `members:` block. */
function trainVerdict(digest, members) {
  const text = verdict({ content: digest });
  if (!members) return text;
  return `${text}members:\n${members.map((m) => `  - { ${Object.entries(m)
    .map(([k, v]) => `${k}: ${v}`).join(', ')} }`).join('\n')}\n`;
}

/** main with an engine file; a train branch that changes it and carries member verdicts. */
function train(t, memberFiles) {
  const repo = fixture();
  t.after(() => repo.dispose());
  const files = {};
  for (const [n, v] of Object.entries(memberFiles)) {
    files[`.ai/repo/reviews/${n}.yaml`] = memberVerdict(Number(n), v);
  }
  if (Object.keys(files).length) repo.commit('members\' verdicts', files);
  const digest = content(repo);
  return { repo, digest };
}

test('#367: a train whose member\'s own verdict is changes is refused', (t) => {
  const { repo, digest } = train(t, { 303: 'changes' });
  repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest) });
  const r = trainCheck(repo, prJson(t));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /member #303: its own verdict is "changes", not merge/);
  assert.match(r.out, /REFUSED: train member #303/);
  assert.match(r.out, /members:/, 'the refusal says how the train\'s verdict judges it');
  // the same through the environment, which is how the CI step hands the PR over
  const env = spawnSync(process.execPath, [SCRIPT, '--repo', repo.dir, '--pr', String(PR),
    '--base-branch', 'main'], { encoding: 'utf8', env: { ...ENV, PR_JSON: prJson(t) } });
  assert.equal(env.status, 1, `${env.stdout}${env.stderr}`);
  assert.match(env.stdout, /REFUSED: train member #303/);
});

test('#367: the same train passes when its own verdict names and judges that member', (t) => {
  const { repo, digest } = train(t, { 303: 'changes' });
  repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest,
    [{ pr: 303, verdict: 'merge', reason: '"R-1 and R-2 fixed in the train at 3a840b66"' }]) });
  assert.equal(content(repo), digest, 'the members block is not guarded content');
  const r = trainCheck(repo, prJson(t));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /member #303: its own verdict is "changes"; judged merge by this train's/);
  assert.match(r.out, /accepted: verdict merge by oscilla-25/);
});

test('a train\'s judgement of a member needs verdict merge and a reason, for that member', (t) => {
  const { repo, digest } = train(t, { 303: 'changes' });
  for (const [members, expected] of [
    [[{ pr: 303, verdict: 'changes', reason: 'x' }], /REFUSED: train member #303/],
    [[{ pr: 303, verdict: 'merge' }], /members entry 1: reason .* is missing/],
    [[{ pr: 330, verdict: 'merge', reason: 'x' }], /REFUSED: train member #303/],
  ]) {
    repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest, members) });
    const r = trainCheck(repo, prJson(t));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, expected);
  }
  repo.commit('train verdict', { [VERDICT_FILE]: verdict({ content: digest })
    .concat('members: judged\n') });
  assert.match(trainCheck(repo, prJson(t)).out, /members must be a list/);
});

test('a train member with no verdict file of its own (no guarded path) passes', (t) => {
  const { repo, digest } = train(t, {});
  repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest) });
  const r = trainCheck(repo, prJson(t));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /member #303: no verdict of its own/);
  assert.match(r.out, /member #304: no verdict of its own/);
});

test('a train whose members\' own verdicts are all merge passes', (t) => {
  const { repo, digest } = train(t, { 303: 'merge', 304: 'merge' });
  repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest) });
  const r = trainCheck(repo, prJson(t));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /member #303: its own verdict is merge/);
  assert.match(r.out, /member #304: its own verdict is merge/);
});

test('a feature train titled as one feat is judged by its member table too', (t) => {
  const { repo, digest } = train(t, { 303: 'changes' });
  repo.commit('train verdict', { [VERDICT_FILE]: trainVerdict(digest) });
  const feature = prJson(t, { title: 'feat(instrument): feature train 2026-10-31',
    headRefName: 'feat/train-2026-10-31-features' });
  const r = trainCheck(repo, feature);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /REFUSED: train member #303/);
  // a pull request with no member table is no train: other PRs' verdicts are not its concern
  const plain = prJson(t, { title: 'fix(audio): x', headRefName: 'fix/x', body: 'see #303' });
  assert.equal(trainCheck(repo, plain).status, 0);
});
