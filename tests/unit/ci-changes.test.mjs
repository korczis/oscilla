// E026: path-gated CI. .github/scripts/ci-changes.mjs classifies a pull request as runtime
// (every job of ci.yml runs) or non-runtime (the engine, suites, measure, studio, browser and
// visual jobs are skipped), and ci.yml's `gate` accepts those skips only on the classifier's
// `runtime=false`. Fail closed throughout: these tables hold every case that must run
// everything (renamed, deleted, spaced and control-character names, a .md under tests/, an
// empty diff, links and submodules, any event but a pull request and its merge-queue entry, a
// malformed record, a queue head whose first parent does not contain the base), the
// gate verdict on every combination of results, and the workflow wiring that makes the
// classifier the base branch's copy.
//   node --test tests/unit/ci-changes.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { gitRepo } from './fixtures/git-repo.mjs';
import {
  GATED_BASES, GATED_EVENTS, GATED_JOBS, NON_RUNTIME, baseName, changedRecords, classify,
  isNonRuntimePath, main, parseRawZ, queueRecords,
} from '../../.github/scripts/ci-changes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, '.github/scripts/ci-changes.mjs');
const CI = parseYaml(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const RUNTIME_IF = "needs.changes.outputs.runtime != 'false'";
/** A pull request into main, the one base that is path-gated. */
const INTO_MAIN = { event: 'pull_request', base: 'main' };

const Z40 = '0'.repeat(40);
const B = 'a'.repeat(40);
const C = 'b'.repeat(40);
/** One `git diff --raw -z` record. */
const raw = (status, paths, { src = '100644', dst = '100644' } = {}) => {
  const s = status === 'A' ? '000000' : src;
  const d = status === 'D' ? '000000' : dst;
  return `:${s} ${d} ${status === 'A' ? Z40 : B} ${status === 'D' ? Z40 : C} ${status}\0`
    + paths.map((p) => `${p}\0`).join('');
};
const rec = (status, paths, modes) => parseRawZ(raw(status, paths, modes));

test('the allowlist is exactly the seven non-runtime path classes', () => {
  assert.deepEqual([...NON_RUNTIME], ['.ai/repo/project/', '.ai/repo/reviews/',
    '.ai/repo/releases/', '.ai/repo/adrs/', '.ai/repo/knowledge/', 'docs/', '*.md']);
  assert.deepEqual([...GATED_JOBS], ['engine', 'suites', 'measure', 'studio', 'browser',
    'census', 'visual']);
});

test('isNonRuntimePath: the allowlist, and every near miss is runtime', () => {
  const rows = [
    ['.ai/repo/project/issues/E026.yaml', false],
    ['.ai/repo/project/milestones/M046.yaml', false],
    ['.ai/repo/reviews/255.yaml', false],
    ['.ai/repo/releases/v3.11.0.yaml', false],
    ['.ai/repo/adrs/0088-an-opt-in-loopback-bridge.md', false],
    ['.ai/repo/adrs/README.md', false],
    ['.ai/repo/knowledge/adr-exemptions.yaml', false],
    ['.ai/repo/knowledge/curated/web-audio-scheduling-lateness.md', false],
    ['docs/GLOSSARY.md', false],
    ['docs/v4/performance.md', false],
    ['docs/my notes.md', false],
    ['docs/diagram.svg', false],
    ['README.md', false],
    ['CLAUDE.md', false],
    ['AGENTS.md', false],
    ['tests/README.md', true],
    ['tests/browser/notes.md', true],
    ['src/js/main.js', true],
    ['src/js/my file.js', true],
    ['src/README.md', true],
    ['dist/index.html', true],
    ['scripts/build.mjs', true],
    ['package.json', true],
    ['package-lock.json', true],
    ['.github/workflows/ci.yml', true],
    ['.github/scripts/ci-changes.mjs', true],
    ['.ai/repo/rules/project/ci-bounded.v1.md', true],
    ['.ai/repo/ci/gates.yaml', true],
    ['.ai/README.md', true],
    ['.ai/repo/projects/x.yaml', true],
    ['.ai/repo/adr/0001-x.md', true],
    ['.ai/repo/knowledge', true],
    ['.ai/repo/knowledge-base/x.yaml', true],
    ['.ai/repo/project', true],
    ['docs', true],
    ['docsx/a.md', true],
    ['README.MD', true],
    ['README.markdown', true],
    ['.md', true],
    ['./docs/a.md', true],
    ['docs/../src/a.js', true],
    ['docs//a.md', true],
    ['/docs/a.md', true],
    ['docs/a\nb.md', true],
    ['docs/a\\b.md', true],
    ['', true],
  ];
  for (const [p, runtime] of rows) {
    assert.equal(!isNonRuntimePath(p), runtime, JSON.stringify(p));
  }
  assert.equal(isNonRuntimePath(undefined), false);
});

test('parseRawZ reads plain, renamed, copied, deleted and spaced records, and refuses junk', () => {
  assert.deepEqual(parseRawZ(''), []);
  assert.deepEqual(rec('M', ['docs/a b.md']),
    [{ status: 'M', srcMode: '100644', dstMode: '100644', paths: ['docs/a b.md'] }]);
  assert.deepEqual(rec('D', ['src/x.js']),
    [{ status: 'D', srcMode: '100644', dstMode: '000000', paths: ['src/x.js'] }]);
  assert.deepEqual(parseRawZ(`:100644 100644 ${B} ${C} R087\0docs/a.md\0src/a.md\0`),
    [{ status: 'R', srcMode: '100644', dstMode: '100644', paths: ['docs/a.md', 'src/a.md'] }]);
  assert.deepEqual(parseRawZ(`:100644 100644 ${B} ${C} C100\0docs/a.md\0docs/b.md\0`
    + raw('A', ['README.md'])).map((r) => r.paths), [['docs/a.md', 'docs/b.md'], ['README.md']]);
  for (const junk of ['docs/a.md\0', ':100644 100644 x y M\0a\0', `:100644 100644 ${B} ${C} M\0`,
    `:100644 100644 ${B} ${C} R100\0docs/a.md\0`, `M\tdocs/a.md\n`]) {
    assert.throws(() => parseRawZ(junk), /git diff --raw/, JSON.stringify(junk));
  }
});

test('classify: a table of changes, fail closed', () => {
  const rename = (from, to) => parseRawZ(`:100644 100644 ${B} ${C} R100\0${from}\0${to}\0`);
  const rows = [
    ['docs only', rec('M', ['docs/GLOSSARY.md']), false],
    ['a plan record', rec('A', ['.ai/repo/project/issues/E026.yaml']), false],
    ['a review record', rec('A', ['.ai/repo/reviews/276.yaml']), false],
    ['a release record', rec('A', ['.ai/repo/releases/v3.12.0.yaml']), false],
    ['an ADR with its exemption (E055)', [...rec('A', ['.ai/repo/adrs/0089-x.md']),
      ...rec('M', ['.ai/repo/adrs/README.md']),
      ...rec('M', ['.ai/repo/knowledge/adr-exemptions.yaml'])], false],
    ['top-level markdown', rec('M', ['README.md']), false],
    ['plan, review and docs together', [...rec('M', ['.ai/repo/project/intents/x.yaml']),
      ...rec('A', ['.ai/repo/reviews/1.yaml']), ...rec('M', ['docs/a.md'])], false],
    ['a docs path with spaces', rec('M', ['docs/my notes.md']), false],
    ['a deleted docs file', rec('D', ['docs/old.md']), false],
    ['a rename inside docs', rename('docs/a.md', 'docs/b.md'), false],
    ['an executable docs file', rec('M', ['docs/run.md'], { dst: '100755' }), false],
    ['empty diff', [], true],
    ['a .md inside tests/', rec('M', ['tests/README.md']), true],
    ['a .md deep inside tests/', rec('A', ['tests/browser/notes.md']), true],
    ['docs plus one source file', [...rec('M', ['docs/a.md']), ...rec('M', ['src/js/main.js'])],
      true],
    ['the built file', rec('M', ['dist/index.html']), true],
    ['a script', rec('M', ['scripts/fail-first.mjs']), true],
    ['package.json', rec('M', ['package.json']), true],
    ['the lockfile', rec('M', ['package-lock.json']), true],
    ['the workflow', rec('M', ['.github/workflows/ci.yml']), true],
    ['the classifier itself', rec('M', ['.github/scripts/ci-changes.mjs']), true],
    ['a project rule', rec('M', ['.ai/repo/rules/project/ci-bounded.v1.md']), true],
    ['the CI model', rec('M', ['.ai/repo/ci/gates.yaml']), true],
    ['a deleted source file', rec('D', ['src/js/core/storage.js']), true],
    ['a deleted test', rec('D', ['tests/unit/x.test.mjs']), true],
    ['a source path with spaces', rec('A', ['src/js/my file.js']), true],
    ['renamed out of docs into src', rename('docs/a.md', 'src/a.md'), true],
    ['renamed out of src into docs', rename('src/a.js', 'docs/a.js'), true],
    ['renamed from tests/ to the top level', rename('tests/README.md', 'NOTES.md'), true],
    ['a symbolic link under docs', rec('A', ['docs/link'], { dst: '120000' }), true],
    ['a submodule under docs', rec('A', ['docs/sub'], { dst: '160000' }), true],
    ['a docs link turned into a file', rec('T', ['docs/x'], { src: '120000' }), true],
    ['a type change under docs', rec('T', ['docs/x.md']), true],
    ['an unmerged docs path', rec('U', ['docs/x.md']), true],
    ['a docs name with a newline', rec('M', ['docs/a\nb.md']), true],
    ['an upper-case markdown suffix', rec('M', ['README.MD']), true],
  ];
  for (const [what, records, runtime] of rows) {
    const r = classify(records, INTO_MAIN);
    assert.equal(r.runtime, runtime, `${what}: ${r.reason}`);
    if (runtime && records.length) assert.ok(r.runtimePaths.length, `${what} names its paths`);
    if (!runtime) assert.deepEqual(r.runtimePaths, [], what);
  }
});

test('classify: every event but a pull request and its merge-queue entry runs everything', () => {
  assert.deepEqual([...GATED_EVENTS], ['pull_request', 'merge_group']);
  const docs = rec('M', ['docs/a.md']);
  assert.equal(classify(docs, INTO_MAIN).runtime, false);
  // ADR 0083: the queue's merge of the pull request is judged like the pull request
  assert.equal(classify(docs, { event: 'merge_group', base: 'main' }).runtime, false);
  assert.equal(classify(docs, { event: 'merge_group', base: 'train/x' }).runtime, true);
  assert.equal(classify(rec('M', ['src/x.js']), { event: 'merge_group', base: 'main' }).runtime,
    true);
  for (const event of ['push', 'workflow_dispatch', 'pull_request_target', 'Merge_Group',
    'merge_group ', '']) {
    const r = classify(docs, { event, base: 'main' });
    assert.equal(r.runtime, true, event);
    assert.match(r.reason, /everything runs/);
  }
});

test('classify: only a pull request into main is path-gated; any other base runs everything',
  () => {
    // A train or stacked branch: the head's gate check would satisfy main's required check too
    // (retargeted, or the same head opened against main), so a skip judged there is refused.
    assert.deepEqual([...GATED_BASES], ['main']);
    const docs = rec('M', ['docs/a.md']);
    assert.equal(classify(docs, { event: 'pull_request', base: 'main' }).runtime, false);
    for (const base of ['train/2026-10-17', 'feat/x', 'Main', 'main ', 'refs/heads/main',
      'origin/main', 'refs/remotes/origin/main', '', undefined, null]) {
      const r = classify(docs, { event: 'pull_request', base });
      assert.equal(r.runtime, true, JSON.stringify(base));
      assert.match(r.reason, /is not main: everything runs/);
    }
    assert.equal(classify(docs).runtime, true, 'no base named: everything runs');
    assert.equal(baseName('refs/remotes/origin/main'), 'main');
    assert.equal(baseName('refs/remotes/origin/train/2026-10-17'), 'train/2026-10-17');
    assert.equal(baseName('main'), 'main');
    assert.equal(baseName('refs/heads/main'), 'refs/heads/main');
    assert.equal(baseName('refs/remotes/upstream/main'), 'refs/remotes/upstream/main');
    assert.equal(baseName(undefined), '');
  });

/** A fixture repository: main with a tree, a branch `pr` with `files` and `rm` applied. */
function fixture(t, { files = {}, rm = [], mv = [] } = {}) {
  const repo = gitRepo('oscilla-ci-changes-');
  t.after(() => repo.dispose());
  repo.commit('base', {
    'README.md': 'r\n', 'docs/a.md': 'a\n', 'docs/old.md': 'o\n', 'src/x.js': 'x\n',
    'tests/README.md': 't\n', '.ai/repo/project/issues/E001.yaml': 'id: E001\n',
  });
  repo.branch('pr');
  for (const [from, to] of mv) repo.git('mv', from, to);
  for (const p of rm) repo.git('rm', '-q', p);
  repo.commit('change', files);
  // main moves on with a source change the pull request does not carry
  repo.git('checkout', '-q', 'main');
  repo.commit('main moves', { 'src/y.js': 'y\n' });
  repo.git('checkout', '-q', 'pr');
  return repo;
}
const judge = (repo) => classify(changedRecords(repo.dir, 'HEAD', 'main').records, INTO_MAIN);

test('against git: renames, deletions, spaces, tests/*.md and an empty diff', (t) => {
  const rows = [
    ['docs and a plan record', { files: { 'docs/a.md': 'b\n',
      '.ai/repo/project/issues/E002.yaml': 'id: E002\n' } }, false],
    ['a docs file with spaces in its name', { files: { 'docs/my notes.md': 'n\n' } }, false],
    ['a deleted docs file', { rm: ['docs/old.md'] }, false],
    ['a rename within docs', { mv: [['docs/old.md', 'docs/new.md']] }, false],
    ['a rename from docs into src', { mv: [['docs/old.md', 'src/old.md']] }, true],
    ['a rename from src into docs', { mv: [['src/x.js', 'docs/x.js']] }, true],
    ['a deleted source file', { rm: ['src/x.js'] }, true],
    ['tests/README.md', { files: { 'tests/README.md': 'u\n' } }, true],
    ['a source file with spaces in its name', { files: { 'src/a b.js': 'z\n' } }, true],
    ['an empty diff (only main moved)', {}, true],
  ];
  for (const [what, change, runtime] of rows) {
    const r = judge(fixture(t, change));
    assert.equal(r.runtime, runtime, `${what}: ${r.reason} ${JSON.stringify(r.paths)}`);
  }
  // main's own later change is not the pull request's
  const docs = judge(fixture(t, { files: { 'docs/a.md': 'b\n' } }));
  assert.deepEqual(docs.paths, ['docs/a.md']);
});

/**
 * A merge-queue fixture (ADR 0083): main, a pull request `pr` changing `files`, and the
 * queue's merge commit of it onto main plus `ahead` (a pull request already queued, merged
 * first). Checked out at the queue head, as CI checks out a merge_group run.
 */
function queueFixture(t, { files, ahead = null, shape = 'merge' }) {
  const repo = gitRepo('oscilla-ci-changes-queue-');
  t.after(() => repo.dispose());
  repo.commit('base', { 'README.md': 'r\n', 'docs/a.md': 'a\n', 'src/x.js': 'x\n' });
  if (ahead) {
    repo.branch('ahead');
    repo.commit('ahead', ahead);
    repo.git('checkout', '-q', 'main');
  }
  repo.branch('pr');
  repo.commit('change', files);
  repo.git('checkout', '-q', '-b', 'queue', 'main');
  if (ahead) repo.git('merge', '-q', '--no-ff', '-m', 'queue: ahead', 'ahead');
  // shape: the merge method MERGE (ADR 0083), or what REBASE or an octopus would build
  if (shape === 'merge') repo.git('merge', '-q', '--no-ff', '-m', 'queue: pr', 'pr');
  else if (shape === 'rebase') repo.git('cherry-pick', 'pr');
  else {
    repo.git('branch', 'third', 'main');
    repo.git('checkout', '-q', 'third');
    repo.commit('third', { 'docs/third.md': 't\n' });
    repo.git('checkout', '-q', 'queue');
    repo.git('merge', '-q', '--no-ff', '-m', 'queue: octopus', 'pr', 'third');
  }
  return repo;
}

test('merge_group against git: the queued pull request is HEAD^1..HEAD', (t) => {
  const judgeQueue = (repo) => {
    const q = queueRecords(repo.dir, 'HEAD', 'main');
    return { ...q, ...classify(q.records, { event: 'merge_group', base: 'main' }) };
  };
  const docs = judgeQueue(queueFixture(t, { files: { 'docs/a.md': 'b\n' } }));
  assert.equal(docs.contained, true);
  assert.equal(docs.runtime, false, docs.reason);
  assert.deepEqual(docs.paths, ['docs/a.md']);
  // a runtime pull request ahead in the queue is its own entry's change, not this one's
  const behind = judgeQueue(queueFixture(t, { files: { 'docs/a.md': 'b\n' },
    ahead: { 'src/x.js': 'ahead\n' } }));
  assert.equal(behind.runtime, false, behind.reason);
  assert.deepEqual(behind.paths, ['docs/a.md']);
  // and a runtime queued pull request runs everything behind a docs one
  const src = judgeQueue(queueFixture(t, { files: { 'src/x.js': 'y\n' },
    ahead: { 'docs/a.md': 'ahead\n' } }));
  assert.equal(src.runtime, true);
  assert.deepEqual(src.runtimePaths, ['src/x.js']);
  // main moved past the queue head's first parent: the base is not contained
  const moved = queueFixture(t, { files: { 'docs/a.md': 'b\n' } });
  moved.git('checkout', '-q', 'main');
  moved.commit('main moves', { 'src/y.js': 'y\n' });
  moved.git('checkout', '-q', 'queue');
  assert.equal(queueRecords(moved.dir, 'HEAD', 'main').contained, false);
});

test('merge_group: the program judges the queue head, fails closed, and needs a first parent',
  (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-changes-queue-out-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const run = (repo, out, base = 'main') => spawnSync(process.execPath, [PROGRAM, '--repo',
      repo.dir, '--event', 'merge_group', '--head', 'HEAD', '--base-branch', base,
      '--output', out], { encoding: 'utf8' });

    const docs = queueFixture(t, { files: { 'docs/a.md': 'b\n' } });
    const outDocs = path.join(dir, 'docs');
    const r1 = run(docs, outDocs);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(readFileSync(outDocs, 'utf8'), 'runtime=false\n');
    assert.match(r1.stdout, /merge-queue head [0-9a-f]{12}, first parent [0-9a-f]{12}/);

    // the full remote ref the job passes; a train base runs everything
    docs.git('update-ref', 'refs/remotes/origin/main', 'main');
    docs.git('update-ref', 'refs/remotes/origin/train/x', 'main');
    const outRef = path.join(dir, 'ref');
    assert.equal(run(docs, outRef, 'refs/remotes/origin/main').status, 0);
    assert.equal(readFileSync(outRef, 'utf8'), 'runtime=false\n');
    const outTrain = path.join(dir, 'train');
    assert.equal(run(docs, outTrain, 'refs/remotes/origin/train/x').status, 0);
    assert.equal(readFileSync(outTrain, 'utf8'), 'runtime=true\n');

    // a base the queue head's first parent does not contain runs everything
    const moved = queueFixture(t, { files: { 'docs/a.md': 'b\n' } });
    moved.git('checkout', '-q', 'main');
    moved.commit('main moves', { 'src/y.js': 'y\n' });
    moved.git('checkout', '-q', 'queue');
    const outMoved = path.join(dir, 'moved');
    const r2 = run(moved, outMoved);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(readFileSync(outMoved, 'utf8'), 'runtime=true\n');
    assert.match(r2.stdout, /not an ancestor of the queue head's first parent: everything runs/);

    // review F1: under the rebase method A1 (runtime) then A2 (docs) lands as two linear
    // commits, and HEAD^1..HEAD would be A2 alone; one parent, or three, runs everything
    for (const shape of ['rebase', 'octopus']) {
      const repo = queueFixture(t, { files: { 'src/x.js': 'runtime\n' }, shape });
      if (shape === 'rebase') repo.commit('A2 docs', { 'docs/a.md': 'docs only\n' });
      const out = path.join(dir, shape);
      const r = run(repo, out);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(out, 'utf8'), 'runtime=true\n', shape);
      assert.match(r.stdout, /parent\(s\), not the merge commit of one pull request/, shape);
      assert.equal(queueRecords(repo.dir, 'HEAD', 'main').parents, shape === 'rebase' ? 1 : 3);
    }

    // review F6: a base git cannot read gives no answer, never a skip (an ancestry check that
    // answered "contained" on a git error would let a docs diff skip the browser legs)
    const nobase = queueFixture(t, { files: { 'docs/a.md': 'b\n' } });
    nobase.git('branch', '-D', 'main');
    assert.throws(() => queueRecords(nobase.dir, 'HEAD', 'main'), /merge-base --is-ancestor/);
    const outNobase = path.join(dir, 'nobase');
    const r4 = run(nobase, outNobase);
    assert.equal(r4.status, 1, r4.stdout);
    assert.match(r4.stderr, /::error::git merge-base --is-ancestor main/);
    assert.equal(existsSync(outNobase), false);

    // a root commit has no first parent: no answer, so `changes` fails and gate with it
    const root = gitRepo('oscilla-ci-changes-root-');
    t.after(() => root.dispose());
    root.commit('root', { 'docs/a.md': 'a\n' });
    const outRoot = path.join(dir, 'root');
    const r3 = run(root, outRoot);
    assert.equal(r3.status, 1);
    assert.match(r3.stderr, /::error::/);
    assert.equal(existsSync(outRoot), false);
  });

test('the program writes runtime=<bool> for the job, and exits 1 without an answer', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-changes-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (repo, args, out) => spawnSync(process.execPath, [PROGRAM, '--repo', repo.dir,
    '--head', 'HEAD', '--base-branch', 'main', '--output', out, ...args], { encoding: 'utf8' });

  const docs = fixture(t, { files: { 'docs/a.md': 'b\n' } });
  const outDocs = path.join(dir, 'docs');
  const r1 = run(docs, ['--event', 'pull_request'], outDocs);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(readFileSync(outDocs, 'utf8'), 'runtime=false\n');
  assert.match(r1.stdout, /runtime=false/);
  assert.match(r1.stdout, /skipped for this pull request: engine, suites, measure, studio/);

  const outPush = path.join(dir, 'push');
  const r2 = run(docs, ['--event', 'push'], outPush);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(outPush, 'utf8'), 'runtime=true\n');

  const src = fixture(t, { files: { 'src/x.js': 'changed\n' } });
  const outSrc = path.join(dir, 'src');
  assert.equal(run(src, ['--event', 'pull_request'], outSrc).status, 0);
  assert.equal(readFileSync(outSrc, 'utf8'), 'runtime=true\n');

  // the full remote refs the job passes: main is gated, a train base runs everything
  const trained = fixture(t, { files: { 'docs/a.md': 'b\n' } });
  trained.git('update-ref', 'refs/remotes/origin/main', 'main');
  trained.git('update-ref', 'refs/remotes/origin/train/2026-10-17', 'main');
  const ref = (base, out) => spawnSync(process.execPath, [PROGRAM, '--repo', trained.dir,
    '--event', 'pull_request', '--head', 'HEAD', '--base-branch', base, '--output', out],
  { encoding: 'utf8' });
  const outMain = path.join(dir, 'main');
  assert.equal(ref('refs/remotes/origin/main', outMain).status, 0);
  assert.equal(readFileSync(outMain, 'utf8'), 'runtime=false\n');
  const outTrain = path.join(dir, 'train');
  const r4 = ref('refs/remotes/origin/train/2026-10-17', outTrain);
  assert.equal(r4.status, 0, r4.stderr);
  assert.equal(readFileSync(outTrain, 'utf8'), 'runtime=true\n');
  assert.match(r4.stdout, /base "train\/2026-10-17" is not main/);

  // no base branch to diff against: no answer at all, so `changes` fails and gate with it
  const outBad = path.join(dir, 'bad');
  const r3 = spawnSync(process.execPath, [PROGRAM, '--repo', docs.dir, '--event',
    'pull_request', '--head', 'HEAD', '--base-branch', 'no-such-branch', '--output', outBad],
  { encoding: 'utf8' });
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /::error::/);
  assert.equal(existsSync(outBad), false);
  // an unknown flag is refused rather than ignored
  assert.throws(() => main(['--repo', docs.dir, '--paths-ignore', 'src'], { log: () => {} }),
    /bad argument/);
});

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
const VERDICT = CI.jobs.gate.steps.at(-1).env.VERDICT;
/** The gate's own verdict, run by jq on a `needs` object as toJSON(needs) gives it. */
function gatePasses(needs) {
  const r = spawnSync('jq', ['-e', VERDICT], { input: JSON.stringify(needs), encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(`jq: ${r.stderr}`);
  return r.status === 0;
}

test('the gate verdict: a path-gated skip passes only on the classifier\'s runtime=false',
  { skip: !hasJq && !process.env.CI ? 'jq is not installed (CI has it)' : false }, () => {
    const ALWAYS = ['unit', 'knowledge', 'fail-first', 'review-verdict'];
    const needs = ({ changes = 'success', runtime = 'true', gated = 'success', always = {} }
      = {}) => {
      const out = { changes: { result: changes,
        outputs: runtime === undefined ? {} : { runtime } } };
      for (const j of ALWAYS) out[j] = { result: always[j] ?? 'success', outputs: {} };
      for (const j of GATED_JOBS) {
        out[j] = { result: typeof gated === 'string' ? gated : gated[j] ?? 'success', outputs: {} };
      }
      return out;
    };
    const rows = [
      ['every job succeeded on a runtime change', needs(), true],
      ['every job succeeded on a non-runtime change', needs({ runtime: 'false' }), true],
      ['the gated jobs skipped on runtime=false', needs({ runtime: 'false', gated: 'skipped' }), true],
      ['one of the gated jobs skipped on runtime=false', needs({ runtime: 'false',
        gated: { visual: 'skipped' } }), true],
      ['skipped on runtime=true', needs({ gated: 'skipped' }), false],
      ['one skipped on runtime=true', needs({ gated: { engine: 'skipped' } }), false],
      ['skipped with no runtime output', needs({ runtime: undefined, gated: 'skipped' }), false],
      ['skipped with an empty output', needs({ runtime: '', gated: 'skipped' }), false],
      ['skipped because changes failed', needs({ changes: 'failure', runtime: undefined,
        gated: 'skipped' }), false],
      ['skipped because changes was cancelled', needs({ changes: 'cancelled',
        runtime: 'false', gated: 'skipped' }), false],
      ['changes skipped', needs({ changes: 'skipped', runtime: 'false', gated: 'skipped' }),
        false],
      ['a gated job failed on runtime=false', needs({ runtime: 'false',
        gated: { studio: 'failure' } }), false],
      ['a gated job cancelled on runtime=false', needs({ runtime: 'false',
        gated: { browser: 'cancelled' } }), false],
      ['a gated job failed on runtime=true', needs({ gated: { measure: 'failure' } }), false],
      ...ALWAYS.flatMap((j) => [
        [`${j} skipped on runtime=false`, needs({ runtime: 'false', gated: 'skipped',
          always: { [j]: 'skipped' } }), false],
        [`${j} failed`, needs({ always: { [j]: 'failure' } }), false],
        [`${j} cancelled on runtime=false`, needs({ runtime: 'false',
          always: { [j]: 'cancelled' } }), false],
      ]),
      ['an unknown job skipped on runtime=false', { ...needs({ runtime: 'false',
        gated: 'skipped' }), extra: { result: 'skipped', outputs: {} } }, false],
      ['runtime spelled False', needs({ runtime: 'False', gated: 'skipped' }), false],
      // E010: the ledger's entry is dropped before this rule, whatever it did
      ...['success', 'failure', 'cancelled', 'skipped'].flatMap((r) => [
        [`ledger ${r} on a runtime change`, { ...needs(),
          'flake-ledger': { result: r, outputs: {} } }, true],
        [`ledger ${r}, the gated jobs skipped on runtime=false`, { ...needs({ runtime: 'false',
          gated: 'skipped' }), 'flake-ledger': { result: r, outputs: {} } }, true],
        [`ledger ${r}, the gated jobs skipped on runtime=true`, { ...needs({ gated: 'skipped' }),
          'flake-ledger': { result: r, outputs: {} } }, false],
      ]),
    ];
    for (const [what, input, pass] of rows) assert.equal(gatePasses(input), pass, what);
  });

test('ci.yml wiring: the path-gated jobs wait for changes, the rest always run, gate needs both', () => {
  const jobs = CI.jobs;
  // gate's always() and the flake ledger's re-run condition (E010) are the only other ones;
  // the ledger is never path gated (tests/unit/flake-ledger.test.mjs)
  const OWN = new Set(['gate', 'flake-ledger']);
  const conditioned = Object.entries(jobs).filter(([k, j]) => !OWN.has(k) && j.if !== undefined)
    .map(([k]) => k);
  assert.deepEqual(conditioned.sort(), [...GATED_JOBS].sort());
  assert.equal(jobs['flake-ledger'].if, '${{ always() && fromJSON(github.run_attempt) > 1 }}');
  for (const k of GATED_JOBS) {
    assert.equal(jobs[k].if, RUNTIME_IF, `${k}: runs unless runtime is exactly false`);
    assert.equal(jobs[k].needs, 'changes', `${k}: needs changes`);
  }
  for (const k of ['unit', 'knowledge', 'fail-first', 'review-verdict', 'changes']) {
    assert.ok(jobs[k], `${k} exists`);
    assert.equal(jobs[k].if, undefined, `${k} always runs`);
    assert.equal(jobs[k].needs, undefined, `${k} waits for nothing`);
  }
  assert.ok(jobs.gate.needs.includes('changes'), 'gate needs changes, so it reads its output');
  const listed = /\[([^\]]*)\]\s*\|\s*any\(\. == \$k\)/.exec(VERDICT);
  assert.ok(listed, 'the verdict lists the path-gated jobs');
  assert.deepEqual(JSON.parse(`[${listed[1]}]`), [...GATED_JOBS]);
  // ADR 0083: the same conditions on both events, so the census gating and the ledger's
  // re-run rule apply on merge_group as on pull_request; no job condition reads the event
  assert.equal(CI.on && Object.keys(CI.on).join(), 'pull_request,merge_group');
  for (const [k, j] of Object.entries(jobs)) {
    assert.ok(!/event_name|github\.event\b/.test(String(j.if ?? '')), `${k}: no event condition`);
  }
});

/** ci.yml's jobs that run a browser engine: a matrix over `browser` (#404 R1). */
const browserLegs = (doc) => Object.entries(doc.jobs)
  .filter(([, j]) => j.strategy && j.strategy.matrix && j.strategy.matrix.browser)
  .map(([k]) => k);

test('every browser leg of ci.yml is path-gated, so a plan or record change runs none (#404 R1)', () => {
  const legs = browserLegs(CI);
  assert.ok(legs.includes('browser') && legs.includes('census'), `browser legs found: ${legs}`);
  for (const k of legs) assert.ok(GATED_JOBS.includes(k), `${k} runs a browser and is path-gated`);
});

test('mutation: a browser leg without the runtime gate is refused', () => {
  const doc = JSON.parse(JSON.stringify(CI));
  doc.jobs['probe-leg'] = { 'runs-on': 'ubuntu-24.04', strategy: { matrix: { browser: ['webkit'] } },
    steps: [] };
  const ungated = browserLegs(doc).filter((k) => !GATED_JOBS.includes(k));
  assert.deepEqual(ungated, ['probe-leg'], 'the rule names the ungated browser leg');
});

test('ci.yml wiring: changes runs the base branch\'s classifier and publishes its answer', () => {
  const job = CI.jobs.changes;
  assert.equal(job.outputs.runtime, '${{ steps.classify.outputs.runtime }}');
  const uses = job.steps.map((s) => s.uses).filter(Boolean);
  assert.deepEqual(uses, ['actions/setup-node@v7', 'actions/checkout@v7'],
    'setup-node before the checkout, so nothing of the pull request is read before the judge');
  const checkout = job.steps.find((s) => s.uses === 'actions/checkout@v7');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with['persist-credentials'], false);
  const step = job.steps.at(-1);
  assert.equal(step.id, 'classify');
  assert.equal(step.if, undefined);
  const lines = step.run.trim().split('\n').map((l) => l.trim());
  // the base branch: the pull request's, or on merge_group the queue's base_ref (ADR 0083),
  // checked to be a branch name before it is used
  assert.equal(step.env.QUEUE_BASE, '${{ github.event.merge_group.base_ref }}');
  assert.equal(lines[0], 'name="${GITHUB_BASE_REF:-${QUEUE_BASE#refs/heads/}}"');
  assert.equal(lines[1], 'name_ok=\'^[A-Za-z0-9._/-]+$\'');
  assert.equal(lines[2],
    '[[ "$name" =~ $name_ok ]] || { echo "::error::ci-changes: no base branch"; exit 1; }');
  // the base by its full ref (a tag named origin/main cannot shadow it), checked to exist
  assert.equal(lines[3], 'base="refs/remotes/origin/$name"');
  assert.equal(lines[4], 'prog=.github/scripts/ci-changes.mjs');
  assert.equal(lines[5], 'judge="$RUNNER_TEMP/ci-changes.mjs"');
  assert.equal(lines[6], 'git show-ref --verify --quiet "$base"');
  // the base's blob is the only program that runs; a base without one answers runtime=true
  // and runs nothing of the pull request
  assert.deepEqual(lines.slice(7), [
    'if git cat-file -e "$base:$prog" 2> /dev/null; then',
    'git cat-file blob "$base:$prog" > "$judge"',
    'echo "ci-changes: $prog of $base ($(git rev-parse --short=12 "$base")) classifies"',
    'node "$judge" --repo . --event "$GITHUB_EVENT_NAME" --head HEAD \\',
    '--base-branch "$base" --output "$GITHUB_OUTPUT"',
    'else',
    'echo "::warning::ci-changes: $base has no $prog; runtime=true, everything runs"',
    'echo "runtime=true" >> "$GITHUB_OUTPUT"',
    'fi',
  ], 'the step runs the base branch\'s classifier or answers runtime=true');
  assert.ok(!/\|\|\s*(true|:)|continue-on-error|exit 0|"\$prog"\s+--|node \.github/.test(step.run),
    'nothing is made non-fatal, and the checkout\'s own copy never runs');
});

test('the classifier imports nothing but node built-ins, so one extracted blob runs', () => {
  const text = readFileSync(PROGRAM, 'utf8');
  const imports = [...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length);
  for (const m of imports) assert.match(m, /^node:/, m);
  // the copy that CI extracts runs from anywhere
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-changes-blob-'));
  try {
    const copy = path.join(dir, 'ci-changes.mjs');
    writeFileSync(copy, text);
    const r = spawnSync(process.execPath, [copy, '--event', 'push'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /runtime=true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
