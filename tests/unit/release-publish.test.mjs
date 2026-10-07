// release:publish is only ever exercised against fake git/gh/npm runners here: nothing is
// tagged, pushed or released. Also covers the gate receipt (with the gate tree computed on a
// throwaway git repository, rule project.release-receipt-binds-gate), the release notes and
// the diagnosis of a Pages run that never starts (rule project.release-flow-complete).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gitRunner } from '../../scripts/release-metadata.mjs';
import {
  STUCK_AFTER_MIN, diagnoseStuckRuns, finishLine, preconditionProblems, publish,
  releaseCreateFlags, releaseNotes, stuckPagesRuns,
} from '../../scripts/release-publish.mjs';
import {
  RECEIPT_KEYS, computeGateTree, gateTreePaths, receiptProblems,
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
 * `runs` answers every `gh run list` (an array, or a function of the call's arguments);
 * `ancestor` is the exit status of `git merge-base --is-ancestor` (0 yes, 1 no, 128 unknown).
 */
function fakes({ branch = 'main', dirty = '', originMain = HEAD, tagRemote = '', ok = true,
  runs = [], ancestor = 0 } = {}) {
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
      return { status: 0, stdout: JSON.stringify(typeof runs === 'function' ? runs(args) : runs) };
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
// `gh run list` only reads the runs of pages.yml, and the precondition check needs it.
const MUTATING = (c) => (c[0] === 'git' && c[1] === 'tag' && !c.includes('--list'))
  || (c[0] === 'git' && c[1] === 'push')
  || (c[0] === 'gh' && c[1] === 'release')
  || (c[0] === 'gh' && c[1] === 'run' && c[2] !== 'list')
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
  assert.match(receiptProblems(old, FP).join('\n'), /gate receipt gateTree undefined != current a/);
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
  write('.ai/repo/releases/x.yaml', 'schema: release/v1\n');
  write('.ai/repo/rules/project/r.v1.md', '# rule\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return { root, write, run: gitRunner(root),
    add: () => execFileSync('git', ['add', '-A'], { cwd: root }) };
}

test('the gate tree covers every tracked file except the release records', () => {
  const f = fixtureRepo();
  assert.deepEqual(gateTreePaths(f.run), ['.ai/repo/rules/project/r.v1.md',
    '.github/workflows/ci.yml', 'package.json', 'scripts/gate.mjs', 'src/app.js',
    'tests/unit/a.test.mjs']);
  const prepared = computeGateTree(f.root, f.run);
  assert.match(prepared, /^[0-9a-f]{64}$/);
  assert.equal(computeGateTree(f.root, f.run), prepared, 'deterministic');
  const receipt = { ...RECEIPT, gateTree: prepared };
  const now = () => ({ ...FP, gateTree: computeGateTree(f.root, f.run) });
  assert.deepEqual(receiptProblems(receipt, now()), []);

  // a release record landing between prepare and publish changes nothing the gate judged
  f.write('.ai/repo/releases/x.yaml', 'schema: release/v1\nversion: "40.0.0"\n');
  f.write('.ai/repo/releases/v39.0.0.yaml', 'schema: release/v1\n');
  f.add();
  assert.deepEqual(receiptProblems(receipt, now()), []);

  // each of these is outside the source digest (build inputs) and inside the gate's verdict
  for (const [rel, text] of [['tests/unit/a.test.mjs', "import 'node:test'; // un-skipped\n"],
    ['.github/workflows/ci.yml', 'name: CI\njobs: {}\n'], ['scripts/gate.mjs', '// gate 2\n'],
    ['.ai/repo/rules/project/r.v1.md', '# rule, changed\n'],
    ['tests/unit/new.test.mjs', '// a new test\n']]) {
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
test('stuckPagesRuns: only runs that have not started for the threshold', () => {
  const runs = [
    { databaseId: 1, status: 'waiting', headSha: OLDER, createdAt: ago(30) },
    { databaseId: 2, status: 'queued', headSha: HEAD, createdAt: ago(STUCK_AFTER_MIN) },
    { databaseId: 3, status: 'queued', headSha: HEAD, createdAt: ago(2) },
    { databaseId: 4, status: 'in_progress', headSha: HEAD, createdAt: ago(40) },
    { databaseId: 5, status: 'completed', headSha: OLDER, createdAt: ago(600) },
  ];
  assert.deepEqual(stuckPagesRuns(runs, NOW).map((r) => r.databaseId), [1, 2]);
  assert.deepEqual(stuckPagesRuns(runs, NOW, 0).map((r) => r.databaseId), [1, 2, 3]);
  const line = (sha, verdict) => diagnoseStuckRuns({ head: HEAD, now: NOW,
    ancestry: () => verdict, stuck: [{ ...runs[0], headSha: sha }] })[0];
  assert.match(line(OLDER, true), /^Pages run 1 for 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 /);
  assert.match(line(OLDER, true), /has been 'waiting' for 30 min; /);
  assert.match(line(OLDER, true), /git merge-base --is-ancestor 0a1b2c3 f187f66: yes \(an older/);
  assert.match(line(OLDER, false), /is-ancestor 0a1b2c3 f187f66: no \(the run is for a commit/);
  assert.match(line(OLDER, null), /: unknown \(the commit is not in this clone/);
  assert.match(line(HEAD, false), /: yes \(this is the deploy of HEAD/);
  assert.match(line(OLDER, true), /Inspect: gh run view 1$/);
});

test('a Pages run stuck in waiting blocks the publish, with its id and ancestry', async () => {
  const stuck = [{ databaseId: 7001, status: 'waiting', headSha: OLDER, createdAt: ago(30) }];
  for (const argv of [[], ['--yes']]) {
    const f = fakes({ runs: stuck });
    const code = await publish({ argv, run: f.run, sh: f.sh, log: f.log, receipt: RECEIPT,
      fingerprint: FP, clock: () => NOW });
    assert.equal(code, 1, argv.join(' ') || 'dry run');
    const text = f.out.join('\n');
    assert.match(text, /BLOCKED Pages run 7001 for 0a1b2c3d4e5f60718293a4b5c6d7e8f901234567 /);
    assert.match(text, /'waiting' for 30 min; git merge-base --is-ancestor 0a1b2c3 f187f66: yes/);
    assert.deepEqual(f.calls.filter(MUTATING), [], 'nothing is tagged behind a stuck deploy');
    assert.ok(f.calls.some((c) => c[0] === 'git' && c[1] === 'merge-base'
      && c[2] === '--is-ancestor' && c[3] === OLDER && c[4] === HEAD));
  }
  // not an ancestor, and a run that is merely young, are told apart
  const other = fakes({ runs: stuck, ancestor: 1 });
  await publish({ argv: [], run: other.run, sh: other.sh, log: other.log, receipt: RECEIPT,
    fingerprint: FP, clock: () => NOW });
  assert.match(other.out.join('\n'), /BLOCKED Pages run 7001 .*f187f66: no /);
  const young = fakes({ runs: [{ ...stuck[0], createdAt: ago(3) }] });
  assert.equal(await publish({ argv: [], run: young.run, sh: young.sh, log: young.log,
    receipt: RECEIPT, fingerprint: FP, clock: () => NOW }), 0);
});

// A clock the fake sleep advances, so the Pages wait runs to its deadline instantly.
function fakeTime() {
  let t = NOW;
  return { clock: () => t, sleep: async (s) => { t += s * 1000; } };
}

test('--yes: a Pages run of HEAD that never starts is diagnosed, not watched', async () => {
  // Young enough to pass the precondition; it then sits in "queued" past --pages-timeout.
  const f = fakes({ runs: [{ databaseId: 7002, status: 'queued', headSha: HEAD,
    createdAt: ago(1) }] });
  const code = await publish({ argv: ['--yes', '--pages-timeout', '5'], run: f.run, sh: f.sh,
    log: f.log, receipt: RECEIPT, fingerprint: FP, ...fakeTime() });
  assert.equal(code, 1);
  const text = f.out.join('\n');
  assert.match(text, /STUCK Pages run 7002 for f187f664893ce0444c03629b0d8afa66d6d9f715 /);
  assert.match(text, /'queued' for 6 min; .*: yes \(this is the deploy of HEAD/);
  assert.match(text, /RELEASE:PUBLISH FAILED: Pages run 7002 .* is still 'queued' after 5 min/);
  assert.match(text, /npm run release:verify-deploy -- --commit f187f664893ce0444c03629b0d8afa66/);
  assert.ok(!f.calls.some((c) => c[0] === 'gh' && c[1] === 'run' && c[2] === 'watch'),
    'gh run watch has no timeout: a run that has not started is never watched');
  assert.ok(!f.calls.some((c) => c[0] === 'gh' && c[1] === 'release'));
});

test('--yes: tags, waits for the Pages run to start, verifies, releases', async () => {
  let polls = 0;
  const f = fakes({ runs: (args) => (args.includes('--commit')
    ? [{ databaseId: 7003, status: (polls += 1) < 3 ? 'queued' : 'in_progress', headSha: HEAD,
      createdAt: ago(1) }] : []) });
  const code = await publish({ argv: ['--yes'], run: f.run, sh: f.sh, log: f.log,
    receipt: RECEIPT, fingerprint: FP, ...fakeTime() });
  assert.equal(code, 0, f.out.join('\n'));
  const acted = f.calls.filter(MUTATING).map((c) => c.slice(0, 3).join(' '));
  assert.deepEqual(acted, ['git tag -a', 'git push origin', 'gh run watch',
    'node scripts/verify-deploy.mjs --commit', 'gh release create']);
  assert.equal(polls, 3);
  assert.ok(f.out.join('\n').includes(`\n  ${finishLine('v40.0.0', HEAD)}`));
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
