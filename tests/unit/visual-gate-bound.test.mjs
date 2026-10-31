// K056: the re-acceptance bound of scripts/visual-gate.mjs --update-baseline. A region's accepted
// mismatch may rise, in one acceptance, by at most the runToRunPct stored in the baseline being
// replaced plus RISE_BOUND_PP (2 pp), never the variance the same run measures; beyond that the
// acceptance passes only with --accept-rise "<reason>", recorded as { region, rise, reason,
// date }. A regenerated tests/visual/reference.png (its sha256 differs from the one stored) is
// refused the same way. The decision is a pure function, driven here on fixtures without a
// browser, and so is the baseline an acceptance writes (acceptEnvironment); the CLI's argument
// path is run as a child process (it refuses before any capture starts). Across a branch, the
// committed baseline.json is judged against the merge base's (branchBound), so repeated
// acceptances on one branch cannot add up past the bound unrecorded.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_NOTE, REFERENCE_REGION, RISE_BOUND_PP, acceptEnvironment, acceptanceBound,
  branchBound, fileDigest, judgeAcceptance, nextAcceptedRises, parseArgs,
} from '../../scripts/visual-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/visual-gate.mjs');
const DATE = '2026-10-30';
const REF_A = 'sha256:aaaa';
const REF_B = 'sha256:bbbb';

/** The environment block being replaced: phase is noisy (2.5 pp), header is still. */
const prev = (extra = {}) => ({
  regions: {
    header: { mismatch: 6.0, mismatchExclData: 6.0, runToRunPct: 0, dataPp: 0.5 },
    phase: { mismatch: 11.0, mismatchExclData: 10.2, runToRunPct: 2.5, dataPp: 3.5 },
  },
  ...extra,
});
/** What this acceptance would write; `runToRunPct` is what this run measured. */
const next = (header, phase, runToRunPct = 0) => ({
  header: { mismatch: header, mismatchExclData: header, runToRunPct },
  phase: { mismatch: phase, mismatchExclData: 10.2, runToRunPct },
});

test('the bound is 2 pp', () => {
  assert.equal(RISE_BOUND_PP, 2);
});

test('a rise within the stored variance plus 2 pp passes, at the edge too', () => {
  // header: 0 + 2 = 2 pp allowed; phase: 2.5 + 2 = 4.5 pp allowed.
  for (const [h, p] of [[6.0, 11.0], [7.5, 14.0], [8.0, 15.5], [3.0, 2.0]]) {
    const r = judgeAcceptance(prev(), next(h, p), { date: DATE });
    assert.equal(r.pass, true, `header ${h} phase ${p}`);
    assert.deepEqual(r.refused, []);
    assert.deepEqual(r.records, []);
  }
});

test('a rise of variance + 2 pp + 0.01 is refused, naming the region, its rise and allowance',
  () => {
    const r = judgeAcceptance(prev(), next(6.0, 15.51), { date: DATE });
    assert.equal(r.pass, false);
    assert.deepEqual(r.refused, [{ region: 'phase', kind: 'rise', from: 11.0, to: 15.51,
      rise: 4.51, runToRunPct: 2.5, allowance: 4.5 }]);
    assert.match(r.error, /phase: 11 % -> 15\.51 %, rise 4\.51 pp > allowance 4\.5 pp/);
    assert.match(r.error, /--accept-rise "<reason>"/);
    assert.doesNotMatch(r.error, /header/);

    const still = judgeAcceptance(prev(), next(8.01, 11.0), { date: DATE });
    assert.equal(still.pass, false);
    assert.deepEqual(still.refused.map((x) => [x.region, x.rise, x.allowance]),
      [['header', 2.01, 2]]);
  });

test('the bound uses the stored variance, not a larger one the new run reports', () => {
  // This run measured 10 pp of run-to-run noise in every region; the allowance stays 2 pp and
  // 4.5 pp, the stored values, so making a region noisier does not widen its own allowance.
  const r = judgeAcceptance(prev(), next(9.0, 17.0, 10), { date: DATE });
  assert.equal(r.pass, false);
  assert.deepEqual(r.refused.map((x) => [x.region, x.runToRunPct, x.allowance]),
    [['header', 0, 2], ['phase', 2.5, 4.5]]);
});

test('a stored baseline without runToRunPct is bounded by 2 pp alone', () => {
  const old = { regions: { header: { mismatch: 6.0 } } };
  assert.deepEqual(acceptanceBound(old, { header: { mismatch: 8.0, runToRunPct: 5 } }), []);
  assert.deepEqual(acceptanceBound(old, { header: { mismatch: 8.01, runToRunPct: 5 } })
    .map((x) => x.allowance), [2]);
});

test('--accept-rise with a reason passes and records { region, rise, reason, date }', () => {
  const r = judgeAcceptance(prev(), next(9.0, 17.0), { acceptRise: '  Pro card redesign ',
    date: DATE });
  assert.equal(r.pass, true);
  assert.deepEqual(r.records, [
    { region: 'header', rise: 3, reason: 'Pro card redesign', date: DATE },
    { region: 'phase', rise: 6, reason: 'Pro card redesign', date: DATE },
  ]);
  // The record is appended to the environment's earlier accepted rises, which are kept.
  const earlier = { region: 'bio', rise: 5, reason: 'browser bump', date: '2026-10-01' };
  assert.deepEqual(nextAcceptedRises(prev({ acceptedRises: [earlier] }), r.records),
    [earlier, ...r.records]);
  assert.deepEqual(nextAcceptedRises(undefined, []), []);
});

test('--accept-rise records nothing when every region is within the bound', () => {
  const r = judgeAcceptance(prev(), next(7.0, 12.0), { acceptRise: 'browser bump', date: DATE });
  assert.equal(r.pass, true);
  assert.deepEqual(r.records, []);
});

test('an empty or blank --accept-rise reason is refused, with or without a rise', () => {
  for (const acceptRise of ['', '   ', null]) {
    for (const n of [next(6.0, 11.0), next(9.0, 17.0)]) {
      const r = judgeAcceptance(prev(), n, { acceptRise, date: DATE });
      assert.equal(r.pass, false, JSON.stringify(acceptRise));
      assert.match(r.error, /non-empty reason/);
      assert.deepEqual(r.records, []);
    }
  }
});

test('a recorded rise needs the run date as an ISO day', () => {
  const r = judgeAcceptance(prev(), next(9.0, 11.0), { acceptRise: 'redesign',
    date: '30.10.2026' });
  assert.equal(r.pass, false);
  assert.match(r.error, /not an ISO day/);
});

test('a region absent from the baseline being replaced is refused as new, its whole mismatch '
  + 'the rise, and passes only with --accept-rise', () => {
  const n = { ...next(6.0, 11.0), meter: { mismatch: 0.4, mismatchExclData: 0.4 } };
  const r = judgeAcceptance(prev(), n, { date: DATE });
  assert.equal(r.pass, false);
  assert.deepEqual(r.refused, [{ region: 'meter', kind: 'new', from: null, to: 0.4, rise: 0.4,
    runToRunPct: null, allowance: null }]);
  assert.match(r.error, /meter: not in the baseline being replaced/);
  const ok = judgeAcceptance(prev(), n, { acceptRise: 'level meter card', date: DATE });
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.records, [{ region: 'meter', rise: 0.4, reason: 'level meter card',
    date: DATE }]);
});

test('an environment with no earlier acceptance is not bounded (nothing to rise from)', () => {
  assert.equal(judgeAcceptance(undefined, next(40, 50), { date: DATE }).pass, true);
  assert.equal(judgeAcceptance({}, next(40, 50), { date: DATE }).pass, true);
});

test('a region the new acceptance drops is not judged', () => {
  const r = judgeAcceptance(prev(), { header: { mismatch: 6.0 } }, { date: DATE });
  assert.equal(r.pass, true);
});

test('parseArgs: the gate and the update paths parse as before, --accept-rise takes its reason',
  () => {
    assert.deepEqual(parseArgs(['dist']), { target: 'dist', out: undefined, update: false,
      runs: 3, acceptRise: undefined, help: false });
    assert.deepEqual(parseArgs([]).target, 'dist');
    assert.deepEqual(parseArgs(['--update-baseline', '--runs', '4', '--out', 'x', 'site']),
      { target: 'site', out: 'x', update: true, runs: 4, acceptRise: undefined, help: false });
    assert.equal(parseArgs(['--runs', '1']).runs, 2);
    assert.equal(parseArgs(['--runs', '0']).runs, 2);
    assert.throws(() => parseArgs(['--runs', 'x']), /--runs needs a whole number/);
    const o = parseArgs(['dist', '--update-baseline', '--accept-rise', 'browser bump 154']);
    assert.equal(o.acceptRise, 'browser bump 154');
    assert.equal(o.target, 'dist');
  });

test('parseArgs refuses a missing or empty reason, --accept-rise without --update-baseline and '
  + 'an unknown flag', () => {
  for (const argv of [
    ['--update-baseline', '--accept-rise'],
    ['--update-baseline', '--accept-rise', ''],
    ['--update-baseline', '--accept-rise', '  '],
    ['--update-baseline', '--accept-rise', '--runs', '3'],
    ['dist', '--accept-rise', 'redesign'],
    ['dist', '--accept-rice', 'redesign'],
  ]) {
    assert.throws(() => parseArgs(argv), /accept-rise|unknown flag/, argv.join(' '));
  }
});

test('CLI: an empty --accept-rise exits 2 before any capture; --help exits 0', () => {
  const run = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: ROOT,
    encoding: 'utf8', timeout: 30_000 });
  const empty = run('dist', '--update-baseline', '--accept-rise', '');
  assert.equal(empty.status, 2, empty.stderr);
  assert.match(empty.stderr, /--accept-rise needs a non-empty reason/);
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--accept-rise "<reason>"/);
});

test('CLI: started through a symlink (macOS /tmp, a symlinked checkout) it still runs: a bad '
  + 'flag exits 2, never a silent 0', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'visual-gate-link-'));
  try {
    const link = path.join(dir, 'visual-gate.mjs');
    symlinkSync(SCRIPT, link);
    const r = spawnSync(process.execPath, [link, '--bogus-flag'], { cwd: dir, encoding: 'utf8',
      timeout: 30_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unknown flag --bogus-flag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a regenerated reference.png (another digest) is refused, in either direction of the '
  + 'mismatch, and passes only with --accept-rise, recording from and to', () => {
  const p = prev({ reference: REF_A });
  // Every region falls towards 0: no rise, yet the identity image changed.
  const r = judgeAcceptance(p, next(0.1, 0.2), { date: DATE, reference: REF_B });
  assert.equal(r.pass, false);
  assert.deepEqual(r.refused, [{ region: REFERENCE_REGION, kind: 'reference', from: REF_A,
    to: REF_B, rise: null, runToRunPct: null, allowance: null }]);
  assert.match(r.error, /reference\.png: regenerated \(sha256:aaaa -> sha256:bbbb\)/);
  const ok = judgeAcceptance(p, next(0.1, 0.2), { acceptRise: 'F011 reference', date: DATE,
    reference: REF_B });
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.records, [{ region: REFERENCE_REGION, rise: null, reason: 'F011 reference',
    date: DATE, from: REF_A, to: REF_B }]);
  // The same digest, or a baseline that stored none, is no regeneration.
  assert.equal(judgeAcceptance(p, next(6.0, 11.0), { date: DATE, reference: REF_A }).pass, true);
  assert.equal(judgeAcceptance(prev(), next(6.0, 11.0), { date: DATE, reference: REF_B }).pass,
    true);
});

/** The block one acceptance measured, as updateBaseline hands it to acceptEnvironment. */
const block = (regions) => ({ browser: { name: 'chromium', version: '154' },
  viewport: { width: 1536, height: 1024 }, runs: 3, total: 15, totalExclData: 7, regions,
  controls: { play: [1, 2, 3, 4] } });

test('acceptEnvironment: a refused acceptance writes nothing; a passing one writes the block, '
  + 'its reference digest and acceptedRises (earlier kept), and keeps other environments', () => {
  const earlier = { region: 'bio', rise: 5, reason: 'browser bump', date: '2026-10-01' };
  const base = { schema: 1, environments: { 'darwin-arm64': { regions: {} },
    'linux-x64': prev({ reference: REF_A, acceptedRises: [earlier] }) }, note: 'old',
  tolerance: { chromePp: 0.5 } };
  const snapshot = JSON.stringify(base);

  const refused = acceptEnvironment(base, 'linux-x64', block(next(9.0, 17.0)),
    { date: DATE, reference: REF_A });
  assert.equal(refused.pass, false);
  assert.equal(refused.baseline, null);
  assert.match(refused.error, /header: 6 % -> 9 %/);

  const ok = acceptEnvironment(base, 'linux-x64', block(next(9.0, 17.0)),
    { acceptRise: 'Pro card redesign', date: DATE, reference: REF_A, tol: { chromePp: 0.5 } });
  assert.equal(ok.pass, true);
  assert.equal(JSON.stringify(base), snapshot, 'the input baseline is not mutated');
  const env = ok.baseline.environments['linux-x64'];
  assert.equal(env.reference, REF_A);
  assert.deepEqual(env.regions, next(9.0, 17.0));
  assert.deepEqual(env.acceptedRises, [earlier,
    { region: 'header', rise: 3, reason: 'Pro card redesign', date: DATE },
    { region: 'phase', rise: 6, reason: 'Pro card redesign', date: DATE }]);
  assert.deepEqual(ok.baseline.environments['darwin-arm64'], { regions: {} });
  assert.deepEqual(Object.keys(ok.baseline), ['schema', 'environments', 'note', 'tolerance']);
  assert.deepEqual(Object.keys(ok.baseline.environments), ['darwin-arm64', 'linux-x64']);
  assert.equal(ok.baseline.note, BASELINE_NOTE);
  assert.match(BASELINE_NOTE, new RegExp(`runToRunPct \\+ ${RISE_BOUND_PP} pp`));

  // Within the bound: no acceptedRises key appears where there was none.
  const quiet = acceptEnvironment({ environments: { x: prev() } }, 'x', block(next(7.0, 12.0)),
    { date: DATE, reference: REF_A });
  assert.equal(quiet.pass, true);
  assert.equal('acceptedRises' in quiet.baseline.environments.x, false);
});

/** A baseline.json with one environment. */
const file = (env) => ({ schema: 1, environments: { 'linux-x64': env } });

test('branchBound: two acceptances on one branch cannot add up past the bound unrecorded', () => {
  // Acceptance 1 measured 10 pp of noise and wrote it; acceptance 2 used it: each step passed
  // judgeAcceptance against the file it replaced, the branch as a whole rose 16.5 pp.
  const base = file(prev());
  const step1 = { ...prev(), regions: { ...prev().regions,
    phase: { mismatch: 15.5, mismatchExclData: 10.2, runToRunPct: 10, dataPp: 10.5 } } };
  assert.equal(judgeAcceptance(prev(), step1.regions, { date: DATE }).pass, true);
  const step2 = { ...step1, regions: { ...step1.regions,
    phase: { mismatch: 27.5, mismatchExclData: 10.2, runToRunPct: 10, dataPp: 10.5 } } };
  assert.equal(judgeAcceptance(step1, step2.regions, { date: DATE }).pass, true);
  assert.deepEqual(branchBound(base, file(step2)).map((x) => [x.env, x.region, x.rise,
    x.allowance]), [['linux-x64', 'phase', 16.5, 4.5]]);
  // Recorded on the branch, it passes; within the bound it passes; an untouched file passes.
  const recorded = { ...step2, acceptedRises: [{ region: 'phase', rise: 12, reason: 'redesign',
    date: DATE }] };
  assert.deepEqual(branchBound(base, file(recorded)), []);
  assert.deepEqual(branchBound(base, file(step1)), []);
  assert.deepEqual(branchBound(base, base), []);
  // An environment new on the branch has nothing to rise from.
  assert.deepEqual(branchBound({ environments: {} }, file(step2)), []);
});

test('branchBound: a record the merge base had covers nothing new and may not be dropped', () => {
  const old = { region: 'phase', rise: 6, reason: 'redesign', date: '2026-10-01' };
  const base = file(prev({ acceptedRises: [old] }));
  const risen = { ...prev({ acceptedRises: [old] }), regions: { ...prev().regions,
    phase: { mismatch: 20, runToRunPct: 2.5 } } };
  assert.deepEqual(branchBound(base, file(risen)).map((x) => x.region), ['phase']);
  assert.deepEqual(branchBound(base, file(prev())).map((x) => [x.region, x.kind]),
    [['phase', 'dropped-record']]);
});

test('branchBound: a changed reference.png needs a record in each re-accepted environment, '
  + 'and a re-acceptance', () => {
  const base = file(prev({ reference: REF_A }));
  const reaccepted = prev({ reference: REF_B });
  assert.deepEqual(branchBound(base, file(reaccepted), { referenceChanged: true })
    .map((x) => [x.env, x.region, x.kind]), [['linux-x64', REFERENCE_REGION, 'reference']]);
  const recorded = prev({ reference: REF_B, acceptedRises: [{ region: REFERENCE_REGION,
    rise: null, reason: 'F011', date: DATE, from: REF_A, to: REF_B }] });
  assert.deepEqual(branchBound(base, file(recorded), { referenceChanged: true }), []);
  // Regenerated without re-accepting anything: the baseline no longer means anything.
  assert.deepEqual(branchBound(base, base, { referenceChanged: true })
    .map((x) => [x.env, x.region]), [[null, REFERENCE_REGION]]);
});

/** git in the repository, or null when it is unavailable. */
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

test('the committed baseline.json is within the bound of the merge base\'s, or records each '
  + 'rise and each reference regeneration it accepted', (t) => {
  const baseRef = `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
  const mergeBase = git('merge-base', 'HEAD', baseRef);
  if (!mergeBase) {
    // CI checks out full history (ci.yml unit job, fetch-depth 0): there it must not skip.
    assert.ok(!process.env.CI, `no merge base with ${baseRef}; the bound cannot be judged`);
    t.skip(`no merge base with ${baseRef} (not a full git checkout)`);
    return;
  }
  const baseText = git('show', `${mergeBase}:tests/visual/baseline.json`);
  assert.ok(baseText, `tests/visual/baseline.json at ${mergeBase}`);
  const head = JSON.parse(readFileSync(path.join(ROOT, 'tests/visual/baseline.json'), 'utf8'));
  const refPath = 'tests/visual/reference.png';
  const referenceChanged = git('rev-parse', `${mergeBase}:${refPath}`)
    !== git('hash-object', refPath);
  const uncovered = branchBound(JSON.parse(baseText), head, { referenceChanged });
  assert.deepEqual(uncovered, [], 'run node scripts/visual-gate.mjs --update-baseline '
    + '--accept-rise "<reason>" for each, and repeat the reason in the pull request');
  // Every environment stores the digest of the reference it was accepted against.
  for (const [env, e] of Object.entries(head.environments)) {
    assert.equal(e.reference, fileDigest(path.join(ROOT, refPath)), env);
  }
});
