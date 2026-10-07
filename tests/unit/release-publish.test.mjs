// release:publish is only ever exercised against fake git/gh/npm runners here: nothing is
// tagged, pushed or released. Also covers the gate receipt (with the gate tree computed on a
// throwaway git repository, rule project.release-receipt-binds-gate), the release notes and
// the diagnosis of a Pages run that never starts (rule project.release-flow-complete).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gitRunner } from '../../scripts/release-metadata.mjs';
import {
  STUCK_AFTER_MIN, WAITING_STATUSES, diagnoseStuckRuns, finishLine, jobStarted,
  preconditionProblems, publish, releaseCreateFlags, releaseNotes, runStarted, stuckPagesRuns,
} from '../../scripts/release-publish.mjs';
import {
  GATE_TREE_EXCLUDE, RECEIPT_KEYS, computeGateTree, currentFingerprint, gateTreePaths,
  receiptProblems,
} from '../../scripts/release-prepare.mjs';

const HEAD = 'f187f664893ce0444c03629b0d8afa66d6d9f715';
const OLDER = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
const FP = { version: '40.0.0', sourceDigest: 'd'.repeat(64), distSha256: 'e'.repeat(64),
  gateTree: 'a'.repeat(64) };
const NOW = Date.parse('2026-10-06T12:00:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const RECEIPT = { ...FP, result: 'passed' };
const COMMITS = `${'a'.repeat(40)}\x1ffeat(labs): new lab\x1f\x1e\n`
  + `${'b'.repeat(40)}\x1ffix!: drop v=0 links\x1fBREAKING CHANGE: old links fail\x1e\n`
  + `${'c'.repeat(40)}\x1fchore: tidy\x1f\x1e\n`;

/**
 * `runs` answers every `gh run list` (an array, or a function of the call's arguments; null
 * makes the command fail); `jobs` answers `gh run view <id> --json jobs` (an object by run id,
 * or a function of the id; a run it does not name has no jobs yet, null makes the command
 * fail); `ancestor` is the exit status of `git merge-base --is-ancestor` (0 yes, 1 no, 128
 * unknown).
 */
function fakes({ branch = 'main', dirty = '', originMain = HEAD, tagRemote = '', ok = true,
  runs = [], jobs = {}, ancestor = 0 } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(['git', ...args]);
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return HEAD;
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return branch;
    if (args[0] === 'status') return dirty;
    if (args[0] === 'tag') return 'v39.0.0';
    if (args[0] === 'log') return COMMITS;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const sh = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'ls-remote' && args[1] === '--tags') {
      return { status: 0, stdout: tagRemote };
    }
    if (cmd === 'git' && args[0] === 'ls-remote') {
      return { status: 0, stdout: `${originMain}\trefs/heads/main` };
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return { status: 1, stdout: '' }; // no local tag
    if (cmd === 'git' && args[0] === 'merge-base') return { status: ancestor, stdout: '' };
    if (cmd === 'gh' && args[0] === 'run' && args[1] === 'list') {
      const answer = typeof runs === 'function' ? runs(args) : runs;
      return answer === null ? { status: 1, stdout: '', stderr: 'HTTP 502' }
        : { status: 0, stdout: typeof answer === 'string' ? answer : JSON.stringify(answer) };
    }
    if (cmd === 'gh' && args[0] === 'run' && args[1] === 'view') {
      const answer = typeof jobs === 'function' ? jobs(args[2]) : jobs[args[2]];
      return answer === null ? { status: 1, stdout: '', stderr: 'HTTP 502' }
        : { status: 0, stdout: JSON.stringify({ jobs: answer || [] }) };
    }
    if (cmd === 'npm' || (cmd === 'gh' && args[0] === 'auth')) {
      return { status: ok ? 0 : 1, stdout: '' };
    }
    return { status: 0, stdout: '' };
  };
  const out = [];
  return { run, sh, calls, out, log: (l) => out.push(l) };
}

// Anything that would create a tag, push, watch/release on GitHub or hit the live site.
// `gh run list` and `gh run view` only read the runs of pages.yml and their jobs, and the
// precondition check needs them.
const MUTATING = (c) => (c[0] === 'git' && c[1] === 'tag' && !c.includes('--list'))
  || (c[0] === 'git' && c[1] === 'push')
  || (c[0] === 'gh' && c[1] === 'release')
  || (c[0] === 'gh' && c[1] === 'run' && c[2] !== 'list' && c[2] !== 'view')
  || (c[0] === 'node' && /verify-deploy/.test(c[1]));

test('dry run with every precondition met: plans, prints notes, mutates nothing', async () => {
  const f = fakes();
  const code = await publish({ argv: [], run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT,
    fingerprint: FP });
  assert.equal(code, 0);
  assert.deepEqual(f.calls.filter(MUTATING), []);
  const text = f.out.join('\n');
  assert.match(text, /dry run; pass --yes to act/);
  assert.match(text, /OK all preconditions hold/);
  assert.match(text, /git tag -a v40\.0\.0 .* f187f66/);
  assert.match(text, /gh release create v40\.0\.0/);
  assert.match(text, /### Breaking changes\n\n- drop v=0 links — old links fail/);
});

test('the GitHub Release attaches the committed dist; only a prerelease is marked so', async () => {
  const createLine = async (fp) => {
    const f = fakes();
    const code = await publish({ argv: [], run: f.run, sh: f.sh, log: f.log,
      receipt: { ...fp, result: 'passed' }, fingerprint: fp });
    assert.equal(code, 0);
    assert.deepEqual(f.calls.filter(MUTATING), []);
    return f.out.find((l) => /gh release create/.test(l));
  };
  const stable = await createLine(FP);
  assert.match(stable, /gh release create v40\.0\.0 oscilla-v40\.0\.0\.html --verify-tag /);
  assert.match(stable, /the committed dist\/index\.html/);
  assert.doesNotMatch(stable, /--prerelease|--latest/);
  const rc = await createLine({ ...FP, version: '40.1.0-rc.1' });
  assert.match(rc, /gh release create v40\.1\.0-rc\.1 oscilla-v40\.1\.0-rc\.1\.html /);
  assert.match(rc, / --verify-tag --prerelease --latest=false --title OSCILLA v40\.1\.0-rc\.1 /);
  assert.deepEqual(releaseCreateFlags('40.1.0', 'n.md'),
    ['--verify-tag', '--title', 'OSCILLA v40.1.0', '--notes-file', 'n.md']);
  assert.deepEqual(releaseCreateFlags('40.1.0-beta.2', 'n.md').slice(0, 3),
    ['--verify-tag', '--prerelease', '--latest=false']);
});

test('dry run reports every blocked precondition and exits non-zero', async () => {
  const f = fakes({ branch: 'release/x', dirty: ' M a', originMain: 'f'.repeat(40),
    tagRemote: `${HEAD}\trefs/tags/v40.0.0`, ok: false });
  const code = await publish({ argv: [], run: f.run, sh: f.sh, log: f.log, receipt: null,
    fingerprint: FP });
  assert.equal(code, 1);
  const blocked = f.out.filter((l) => l.includes('BLOCKED')).join('\n');
  for (const re of [/branch release\/x/, /not clean/, /origin\/main/, /already exists on origin/,
    /no release-gate receipt/, /build:check failed/, /gh is not authenticated/]) {
    assert.match(blocked, re);
  }
  assert.deepEqual(f.calls.filter(MUTATING), []);
});

test('--yes with a failed precondition refuses before tagging', async () => {
  const f = fakes({ dirty: ' M a' });
  const code = await publish({ argv: ['--yes'], run: f.run, sh: f.sh, log: f.log,
    receipt: RECEIPT, fingerprint: FP });
  assert.equal(code, 1);
  assert.deepEqual(f.calls.filter(MUTATING), []);
  assert.match(f.out.join('\n'), /refused: preconditions do not hold. Nothing was tagged/);
});

test('gate receipt must match version, source digest, dist bytes and gate tree', () => {
  assert.deepEqual(RECEIPT_KEYS, ['version', 'sourceDigest', 'distSha256', 'gateTree']);
  assert.deepEqual(receiptProblems(RECEIPT, FP), []);
  assert.match(receiptProblems(null, FP)[0], /release:prepare first/);
  assert.match(receiptProblems({ ...RECEIPT, sourceDigest: '0'.repeat(64) }, FP).join(),
    /sourceDigest/);
  assert.match(receiptProblems({ ...RECEIPT, result: 'failed' }, FP).join(), /result is failed/);
  // a receipt written before the gate tree existed binds too little: it is refused
  const { gateTree: _g, ...old } = RECEIPT;
  assert.match(receiptProblems(old, FP).join('\n'), /^gate receipt has no gateTree$/m);
  assert.match(receiptProblems(old, FP).join('\n'), /rule project\.release-receipt-binds-gate/);
});

// Verification round 1: with `gateTree` deleted from currentFingerprint() and from an old
// receipt, `undefined !== undefined` was false and the receipt verified. A key that is absent
// (or not a non-empty string) on either side is a problem of its own.
test('a key missing on both sides never verifies a receipt', () => {
  for (const k of RECEIPT_KEYS) {
    const { [k]: _r, ...receipt } = RECEIPT;
    const { [k]: _n, ...now } = FP;
    const both = receiptProblems(receipt, now).join('\n');
    assert.match(both, new RegExp(`^gate receipt has no ${k}$`, 'm'), k);
    assert.match(both, new RegExp(`the current fingerprint has no ${k}$`, 'm'), k);
    assert.match(receiptProblems(RECEIPT, now).join('\n'),
      new RegExp(`the current fingerprint has no ${k}$`, 'm'), k);
    for (const bad of [undefined, null, '', 0, {}]) {
      assert.notDeepEqual(receiptProblems({ ...RECEIPT, [k]: bad }, { ...FP, [k]: bad }), [],
        `${k} = ${JSON.stringify(bad)} on both sides`);
    }
  }
  const { gateTree: _a, ...r } = RECEIPT;
  const { gateTree: _b, ...n } = FP;
  assert.match(receiptProblems(r, n).join('\n'),
    /rule project\.release-receipt-binds-gate\): re-run npm run release:prepare/);
  assert.notDeepEqual(receiptProblems(RECEIPT, undefined), []);
});

// ---------------------------------------------------------------- the gate tree
// A throwaway repository: tracked files only need to be in the index (`git ls-files`).
function fixtureRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-gate-tree-'));
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  write('package.json', '{"version":"40.0.0"}\n');
  write('src/app.js', 'export const a = 1;\n');
  write('tests/unit/a.test.mjs', "import 'node:test';\n");
  write('scripts/gate.mjs', '// gate\n');
  write('.github/workflows/ci.yml', 'name: CI\n');
  write('.ai/repo/releases/v38.0.0.yaml', 'schema: release/v1\n');
  write('.ai/repo/releases/README.md', '# Releases\n');
  write('.ai/repo/rules/project/r.v1.md', '# rule\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return { root, write, run: gitRunner(root),
    add: () => execFileSync('git', ['add', '-A'], { cwd: root }) };
}

test('the gate tree covers every tracked file except the release records', () => {
  const f = fixtureRepo();
  assert.deepEqual(gateTreePaths(f.run), ['.ai/repo/releases/README.md',
    '.ai/repo/rules/project/r.v1.md',
    '.github/workflows/ci.yml', 'package.json', 'scripts/gate.mjs', 'src/app.js',
    'tests/unit/a.test.mjs']);
  const prepared = computeGateTree(f.root, f.run);
  assert.match(prepared, /^[0-9a-f]{64}$/);
  assert.equal(computeGateTree(f.root, f.run), prepared, 'deterministic');
  const receipt = { ...RECEIPT, gateTree: prepared };
  const now = () => ({ ...FP, gateTree: computeGateTree(f.root, f.run) });
  assert.deepEqual(receiptProblems(receipt, now()), []);

  // a release record landing between prepare and publish changes nothing the gate judged
  f.write('.ai/repo/releases/v38.0.0.yaml', 'schema: release/v1\nversion: "38.0.0"\n');
  f.write('.ai/repo/releases/v39.0.0.yaml', 'schema: release/v1\n');
  f.add();
  assert.deepEqual(receiptProblems(receipt, now()), []);

  // each of these is outside the source digest (build inputs) and inside the gate's verdict
  for (const [rel, text] of [['tests/unit/a.test.mjs', "import 'node:test'; // un-skipped\n"],
    ['.github/workflows/ci.yml', 'name: CI\njobs: {}\n'], ['scripts/gate.mjs', '// gate 2\n'],
    ['.ai/repo/rules/project/r.v1.md', '# rule, changed\n'],
    ['tests/unit/new.test.mjs', '// a new test\n'],
    // the exemption is the record files, not the directory they live in
    ['.ai/repo/releases/README.md', '# Releases, changed\n'],
    ['.ai/repo/releases/sub/x.test.mjs', '// a test hidden beside the records\n'],
    ['.ai/repo/releases/notes.yaml', 'not: a record\n'],
    ['.ai/repo/releases/sub/v1.0.0.yaml', 'schema: release/v1\n']]) {
    const g = fixtureRepo();
    const before = computeGateTree(g.root, g.run);
    g.write(rel, text);
    g.add();
    const problems = receiptProblems({ ...RECEIPT, gateTree: before },
      { ...FP, gateTree: computeGateTree(g.root, g.run) });
    assert.match(problems[0], /^gate receipt gateTree [0-9a-f]{64} != current [0-9a-f]{64}$/, rel);
    assert.match(problems[1], /re-run npm run release:prepare/, rel);
  }
});

test('the gate-tree exemption is exactly the record files and checkout-local state', () => {
  assert.deepEqual(GATE_TREE_EXCLUDE.map(String),
    [String(/^\.ai\/repo\/releases\/v[^/]+\.yaml$/), String(/^\.ai\/local\//)]);
});

// A real checkout for the real currentFingerprint(): a commit on main, a dist, a build input.
function fingerprintRepo() {
  const g = fixtureRepo();
  g.write('dist/index.html', '<!doctype html>\n<p>40.0.0</p>\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t',
    '-c', 'commit.gpgsign=false', ...args], { cwd: g.root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('checkout', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'feat: one');
  return { ...g, head: g.run(['rev-parse', 'HEAD']) };
}

// The enforcement line the rule names. No fingerprint is injected anywhere below: deleting
// `gateTree` (or any other key) from currentFingerprint() fails this test.
test('currentFingerprint binds every receipt key, and a test changed after the gate refuses',
  () => {
    const g = fingerprintRepo();
    const prepared = currentFingerprint(g.root, g.run);
    assert.deepEqual(Object.keys(prepared).sort(), [...RECEIPT_KEYS].sort());
    assert.equal(prepared.version, '40.0.0');
    for (const k of RECEIPT_KEYS.filter((x) => x !== 'version')) {
      assert.match(prepared[k], /^[0-9a-f]{64}$/, k);
    }
    assert.equal(prepared.gateTree, computeGateTree(g.root, g.run));
    const receipt = { ...prepared, result: 'passed' };
    assert.deepEqual(receiptProblems(receipt, currentFingerprint(g.root, g.run)), []);

    // #144/#147: a test changes after the gate passed; no build input does
    appendFileSync(path.join(g.root, 'tests/unit/a.test.mjs'), '// un-skipped after the gate\n');
    const now = currentFingerprint(g.root, g.run);
    assert.equal(now.sourceDigest, prepared.sourceDigest, 'a test is not a build input');
    assert.equal(now.distSha256, prepared.distSha256);
    const problems = receiptProblems(receipt, now);
    assert.equal(problems.length, 2, problems.join('\n'));
    assert.match(problems[0], /^gate receipt gateTree [0-9a-f]{64} != current [0-9a-f]{64}$/);
    assert.match(problems[1], /rule project\.release-receipt-binds-gate/);
  });

test('publish computes the fingerprint itself and refuses a tree changed after the gate',
  async () => {
    const g = fingerprintRepo();
    const receipt = { ...currentFingerprint(g.root, g.run), result: 'passed' };
    // git answers from the fixture checkout; gh, npm and the remote are fakes
    const drive = async (argv) => {
      const f = fakes({ originMain: g.head });
      const code = await publish({ argv, root: g.root, run: g.run, sh: f.sh, log: f.log,
        receipt });
      return { code, text: f.out.join('\n'), calls: f.calls };
    };
    const clean = await drive([]);
    assert.equal(clean.code, 0, clean.text);
    assert.match(clean.text, /OK all preconditions hold/);

    appendFileSync(path.join(g.root, 'tests/unit/a.test.mjs'), '// changed after the gate\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c',
      'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-am', 'test: un-skip'],
    { cwd: g.root });
    for (const argv of [[], ['--yes']]) {
      const f = fakes({ originMain: g.run(['rev-parse', 'HEAD']) });
      const code = await publish({ argv, root: g.root, run: g.run, sh: f.sh, log: f.log,
        receipt });
      const text = f.out.join('\n');
      assert.equal(code, 1, text);
      assert.match(text, /BLOCKED gate receipt gateTree [0-9a-f]{64} != current [0-9a-f]{64}/);
      assert.match(text, /BLOCKED a tracked file changed since the gate passed \(rule /);
      assert.deepEqual(f.calls.filter(MUTATING), []);
      assert.equal(g.run(['tag', '--list']), '', 'no tag was created in the checkout');
    }
  });

test('publish refuses a receipt whose gate tree is not the current tree', async () => {
  const g = fixtureRepo();
  const receipt = { ...RECEIPT, gateTree: computeGateTree(g.root, g.run) };
  g.write('tests/unit/a.test.mjs', "import 'node:test'; // changed after the gate\n");
  const fingerprint = { ...FP, gateTree: computeGateTree(g.root, g.run) };
  for (const argv of [[], ['--yes']]) {
    const f = fakes();
    const code = await publish({ argv, run: f.run, sh: f.sh, log: f.log, receipt, fingerprint });
    assert.equal(code, 1);
    assert.match(f.out.join('\n'), /BLOCKED gate receipt gateTree [0-9a-f]{64} != current /);
    assert.deepEqual(f.calls.filter(MUTATING), []);
  }
  const ok = fakes();
  assert.equal(await publish({ argv: [], run: ok.run, sh: ok.sh, log: ok.log, receipt,
    fingerprint: { ...FP, gateTree: receipt.gateTree } }), 0);
});

// ---------------------------------------------------------------- a Pages run that never starts
const job = (name, status, conclusion = '') => ({ name, status, conclusion,
  // gh reports the creation time of the run as startedAt of a job that is still queued
  startedAt: ago(20), completedAt: status === 'completed' ? ago(1) : '0001-01-01T00:00:00Z' });
// Pages run 37558326962, 2026-10-07: run status `queued`; deploy done, a smoke leg waiting.
const SLOW_HEALTHY = [job('deploy', 'completed', 'success'),
  job('Public smoke (chromium)', 'completed', 'success'),
  job('Public smoke (webkit)', 'in_progress'), job('Public smoke (firefox)', 'queued')];
// 2026-10-06: the deploy job waits for an environment approval; nothing has run.
const NEVER_STARTED = [job('deploy', 'waiting'), job('Public smoke (chromium)', 'queued')];

test('a run has started when one of its jobs has, whatever the run status says', () => {
  assert.deepEqual(WAITING_STATUSES,
    ['waiting', 'queued', 'pending', 'requested', 'action_required']);
  assert.deepEqual(['queued', 'waiting', 'pending', 'in_progress', 'completed']
    .map((status) => jobStarted({ status, conclusion: '' })), [false, false, false, true, true]);
  assert.equal(jobStarted({ status: 'completed', conclusion: 'skipped' }), false);
  assert.equal(jobStarted(job('x', 'queued')), false, 'startedAt of a queued job is not a start');
  for (const status of WAITING_STATUSES) {
    assert.equal(runStarted({ status, jobs: SLOW_HEALTHY }), true, status);
    assert.equal(runStarted({ status, jobs: NEVER_STARTED }), false, status);
    assert.equal(runStarted({ status, jobs: [] }), false, `${status}, no jobs yet`);
    assert.equal(runStarted({ status, jobs: null }), false, `${status}, jobs unread`);
    assert.equal(runStarted({ status }), false, `${status}, jobs unread`);
  }
  assert.equal(runStarted({ status: 'queued', jobs: [job('deploy', 'in_progress')] }), true);
  assert.equal(runStarted({ status: 'in_progress' }), true);
  assert.equal(runStarted({ status: 'completed' }), true);
});

test('stuckPagesRuns: only runs of which no job has started for the threshold', () => {
  const runs = [
    { databaseId: 1, status: 'waiting', headSha: OLDER, createdAt: ago(30), jobs: NEVER_STARTED },
    { databaseId: 2, status: 'queued', headSha: HEAD, createdAt: ago(STUCK_AFTER_MIN), jobs: [] },
    { databaseId: 3, status: 'queued', headSha: HEAD, createdAt: ago(2), jobs: [] },
    { databaseId: 4, status: 'in_progress', headSha: HEAD, createdAt: ago(40) },
    { databaseId: 5, status: 'completed', headSha: OLDER, createdAt: ago(600) },
    // slow and healthy: `queued` for 20 minutes with its deploy done
    { databaseId: 6, status: 'queued', headSha: HEAD, createdAt: ago(20), jobs: SLOW_HEALTHY },
    { databaseId: 7, status: 'action_required', headSha: OLDER, createdAt: ago(20), jobs: [] },
    { databaseId: 8, status: 'queued', headSha: OLDER, createdAt: ago(20), jobs: null },
  ];
  assert.deepEqual(stuckPagesRuns(runs, NOW).map((r) => r.databaseId), [1, 2, 7, 8]);
  assert.deepEqual(stuckPagesRuns(runs, NOW, 0).map((r) => r.databaseId), [1, 2, 3, 7, 8]);
  const line = (sha, verdict, run = runs[0]) => diagnoseStuckRuns({ head: HEAD, now: NOW,
    ancestry: () => verdict, stuck: [{ ...run, headSha: sha }] })[0];
  assert.match(line(OLDER, true), /^Pages run 1 for 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 /);
  assert.match(line(OLDER, true), /has been 'waiting' with no job started for 30 min; /);
  assert.match(line(OLDER, true), /git merge-base --is-ancestor 0a1b2c3 f187f66: yes \(an older/);
  assert.match(line(OLDER, false), /is-ancestor 0a1b2c3 f187f66: no \(the run is for a commit/);
  assert.match(line(OLDER, null), /: unknown \(the commit is not in this clone/);
  assert.match(line(HEAD, false), /: yes \(this is the deploy of HEAD and none of its jobs has /);
  assert.match(line(OLDER, true),
    /Inspect: gh run view 1 \(rule project\.release-flow-complete\)$/);
  assert.match(line(OLDER, true, runs[7]), /'queued' with its jobs could not be read for 20 min/);
});

test('a Pages run stuck in waiting blocks the publish, with its id and ancestry', async () => {
  const stuck = [{ databaseId: 7001, status: 'waiting', headSha: OLDER, createdAt: ago(30) }];
  for (const argv of [[], ['--yes']]) {
    const f = fakes({ runs: stuck, jobs: { 7001: NEVER_STARTED } });
    const code = await publish({ argv, run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT,
      fingerprint: FP, clock: () => NOW });
    assert.equal(code, 1, argv.join(' ') || 'dry run');
    const text = f.out.join('\n');
    assert.match(text, /BLOCKED Pages run 7001 for 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 /);
    assert.match(text, /'waiting' with no job started for 30 min; git merge-base --is-ancestor /);
    assert.match(text, /--is-ancestor 0a1b2c3 f187f66: yes/);
    assert.match(text, /BLOCKED Pages run 7001 .*\(rule project\.release-flow-complete\)/);
    assert.deepEqual(f.calls.filter(MUTATING), [], 'nothing is tagged behind a stuck deploy');
    assert.ok(f.calls.some((c) => c[0] === 'git' && c[1] === 'merge-base'
      && c[2] === '--is-ancestor' && c[3] === OLDER && c[4] === HEAD));
    assert.ok(f.calls.some((c) => c.join(' ') === 'gh run view 7001 --json jobs'));
  }
  // not an ancestor, and a run that is merely young, are told apart
  const other = fakes({ runs: stuck, ancestor: 1 });
  await publish({ argv: [], run: other.run, sh: other.sh, log: other.log, receipt: RECEIPT,
    fingerprint: FP, clock: () => NOW });
  assert.match(other.out.join('\n'), /BLOCKED Pages run 7001 .*f187f66: no /);
  const young = fakes({ runs: [{ ...stuck[0], createdAt: ago(3) }] });
  assert.equal(await publish({ argv: [], run: young.run, sh: young.sh, log: young.log,
    receipt: RECEIPT, fingerprint: FP, clock: () => NOW }), 0);
  // jobs that cannot be read: the run is reported, not assumed healthy
  const unread = fakes({ runs: stuck, jobs: { 7001: null } });
  assert.equal(await publish({ argv: [], run: unread.run, sh: unread.sh, log: unread.log,
    receipt: RECEIPT, fingerprint: FP, clock: () => NOW }), 1);
  assert.match(unread.out.join('\n'), /BLOCKED Pages run 7001 .* its jobs could not be read /);
});

// Verification round 1, live: a run whose status is `queued` 20 minutes after it was created,
// with its deploy job done and smoke legs waiting for a runner, is slow, not stuck.
test('a queued run whose deploy job has run is not stuck', async () => {
  const slow = [{ databaseId: 7004, status: 'queued', headSha: OLDER, createdAt: ago(20) }];
  const f = fakes({ runs: slow, jobs: { 7004: SLOW_HEALTHY } });
  const code = await publish({ argv: [], run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT,
    fingerprint: FP, clock: () => NOW });
  assert.equal(code, 0, f.out.join('\n'));
  assert.match(f.out.join('\n'), /OK all preconditions hold/);
  assert.ok(f.calls.some((c) => c.join(' ') === 'gh run view 7004 --json jobs'));
  // the same run with no job started is the stuck one
  const g = fakes({ runs: slow, jobs: { 7004: NEVER_STARTED } });
  assert.equal(await publish({ argv: [], run: g.run, sh: g.sh, log: g.log, receipt: RECEIPT,
    fingerprint: FP, clock: () => NOW }), 1);
});

test('a pages.yml run list that cannot be read blocks; it is not an empty list', async () => {
  for (const runs of [null, 'gh: not json', '{"message":"rate limited"}']) {
    for (const argv of [[], ['--yes']]) {
      const f = fakes({ runs });
      const code = await publish({ argv, run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT,
        fingerprint: FP, clock: () => NOW });
      assert.equal(code, 1, String(runs));
      assert.match(f.out.join('\n'), /BLOCKED could not list the pages\.yml runs \(gh run list /);
      assert.match(f.out.join('\n'), /cannot be checked \(rule project\.release-flow-complete\)/);
      assert.deepEqual(f.calls.filter(MUTATING), []);
    }
  }
});

// A clock the fake sleep advances, so the Pages wait runs to its deadline instantly.
function fakeTime() {
  let t = NOW;
  return { clock: () => t, sleep: async (s) => { t += s * 1000; } };
}

test('--yes: a Pages run of HEAD that never starts is diagnosed, not watched', async () => {
  // Young enough to pass the precondition; then no job of it starts before --pages-timeout.
  const f = fakes({ runs: [{ databaseId: 7002, status: 'queued', headSha: HEAD,
    createdAt: ago(1) }], jobs: { 7002: NEVER_STARTED } });
  const code = await publish({ argv: ['--yes', '--pages-timeout', '5'], run: f.run, sh: f.sh,
    log: f.log, receipt: RECEIPT, fingerprint: FP, ...fakeTime() });
  assert.equal(code, 1);
  const text = f.out.join('\n');
  assert.match(text, /STUCK Pages run 7002 for f187f664893ce0444c03629b0d8afa66d6d9f715 /);
  assert.match(text, /'queued' with no job started for 6 min; .*: yes \(this is the deploy of /);
  assert.match(text,
    /RELEASE:PUBLISH FAILED: Pages run 7002 .* is still 'queued' with no job started after 5 min/);
  assert.match(text, /npm run release:verify-deploy -- --commit f187f664893ce0444c03629b0d8afa66/);
  assert.ok(!f.calls.some((c) => c[0] === 'gh' && c[1] === 'run' && c[2] === 'watch'),
    'gh run watch has no timeout: a run of which no job has started is never watched');
  assert.ok(!f.calls.some((c) => c[0] === 'gh' && c[1] === 'release'));
});

test('--yes: tags, waits for a job of the Pages run to start, verifies, releases', async () => {
  // The run status says `queued` on every poll, as GitHub does while smoke legs wait for a
  // runner; the deploy job starts on the third. Before this was read from the jobs, the
  // publish waited out --pages-timeout and failed with the tag already on origin.
  let polls = 0;
  const f = fakes({
    runs: (args) => (args.includes('--commit')
      ? [{ databaseId: 7003, status: 'queued', headSha: HEAD, createdAt: ago(1) }] : []),
    jobs: () => ((polls += 1) < 3 ? NEVER_STARTED
      : [job('deploy', 'in_progress'), job('Public smoke (chromium)', 'queued')]),
  });
  const code = await publish({ argv: ['--yes'], run: f.run, sh: f.sh, log: f.log,
    receipt: RECEIPT, fingerprint: FP, ...fakeTime() });
  assert.equal(code, 0, f.out.join('\n'));
  const acted = f.calls.filter(MUTATING).map((c) => c.slice(0, 3).join(' '));
  assert.deepEqual(acted, ['git tag -a', 'git push origin', 'gh run watch',
    'node scripts/verify-deploy.mjs --commit', 'gh release create']);
  assert.equal(polls, 3);
  assert.ok(f.calls.some((c) => c.join(' ') === 'gh run watch 7003 --exit-status'));
  assert.ok(f.out.join('\n').includes(`\n  ${finishLine('v40.0.0', HEAD)}`));
  // a run that is already in_progress is watched without asking for its jobs
  const direct = fakes({ runs: (args) => (args.includes('--commit')
    ? [{ databaseId: 7005, status: 'in_progress', headSha: HEAD, createdAt: ago(1) }] : []) });
  assert.equal(await publish({ argv: ['--yes'], run: direct.run, sh: direct.sh, log: direct.log,
    receipt: RECEIPT, fingerprint: FP, ...fakeTime() }), 0);
  assert.ok(!direct.calls.some((c) => c[0] === 'gh' && c[1] === 'run' && c[2] === 'view'));
});

test('the finish line verifies the published commit, not the worktree HEAD', async () => {
  assert.equal(finishLine('v40.0.0', HEAD), 'majordomus finish --outcome completed --note '
    + '"published v40.0.0" --verify-command "npm run release:verify-deploy -- --commit '
    + `${HEAD}"`);
  const f = fakes();
  await publish({ argv: [], run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT, fingerprint: FP });
  assert.ok(f.out.join('\n').includes(finishLine('v40.0.0', HEAD)));
});

test('preconditions: an unreadable origin/main blocks', () => {
  const p = preconditionProblems({ branch: 'main', dirty: false, head: HEAD, originMain: null,
    tagLocal: false, tagRemote: false, receiptProblems: [], buildCheck: true, ghAuth: true,
    tag: 'v40.0.0' });
  assert.deepEqual(p, ['could not read origin/main']);
});

test('release notes come from the real commit list, grouped by impact', () => {
  const notes = releaseNotes({
    version: '40.1.0', previousTag: 'v40.0.0', commit: HEAD, sourceDigest: FP.sourceDigest,
    commits: [{ sha: 'a'.repeat(40), subject: 'feat(labs): new lab', body: '' },
      { sha: 'b'.repeat(40), subject: 'fix: stop click', body: '' },
      { sha: 'c'.repeat(40), subject: 'Update README', body: '' }],
  });
  assert.match(notes, /^## OSCILLA v40\.1\.0/);
  assert.match(notes, /### Features\n\n- \*\*labs:\*\* new lab \(\[aaaaaaa\]/);
  assert.match(notes, /### Fixes\n\n- stop click .*\n- Update README/);
  assert.match(notes, /compare\/v40\.0\.0\.\.\.v40\.1\.0/);
  assert.match(notes, new RegExp(FP.sourceDigest));
});
