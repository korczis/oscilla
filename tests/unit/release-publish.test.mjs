// release:publish is only ever exercised as a dry run here, against fake git/gh/npm runners:
// nothing is tagged, pushed or released. Also covers the gate receipt and the release notes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  preconditionProblems, publish, releaseCreateFlags, releaseNotes,
} from '../../scripts/release-publish.mjs';
import { receiptProblems } from '../../scripts/release-prepare.mjs';

const HEAD = 'f187f664893ce0444c03629b0d8afa66d6d9f715';
const FP = { version: '40.0.0', sourceDigest: 'd'.repeat(64), distSha256: 'e'.repeat(64) };
const RECEIPT = { ...FP, result: 'passed' };
const COMMITS = `${'a'.repeat(40)}\x1ffeat(labs): new lab\x1f\x1e\n`
  + `${'b'.repeat(40)}\x1ffix!: drop v=0 links\x1fBREAKING CHANGE: old links fail\x1e\n`
  + `${'c'.repeat(40)}\x1fchore: tidy\x1f\x1e\n`;

function fakes({ branch = 'main', dirty = '', originMain = HEAD, tagRemote = '', ok = true } = {}) {
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
    if (cmd === 'npm' || (cmd === 'gh' && args[0] === 'auth')) {
      return { status: ok ? 0 : 1, stdout: '' };
    }
    return { status: 0, stdout: '' };
  };
  const out = [];
  return { run, sh, calls, out, log: (l) => out.push(l) };
}

// Anything that would create a tag, push, watch/release on GitHub or hit the live site.
const MUTATING = (c) => (c[0] === 'git' && c[1] === 'tag' && !c.includes('--list'))
  || (c[0] === 'git' && c[1] === 'push')
  || (c[0] === 'gh' && ['release', 'run'].includes(c[1]))
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

test('gate receipt must match version, source digest and dist bytes', () => {
  assert.deepEqual(receiptProblems(RECEIPT, FP), []);
  assert.match(receiptProblems(null, FP)[0], /release:prepare first/);
  assert.match(receiptProblems({ ...RECEIPT, sourceDigest: '0'.repeat(64) }, FP).join(),
    /sourceDigest/);
  assert.match(receiptProblems({ ...RECEIPT, result: 'failed' }, FP).join(), /result is failed/);
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
