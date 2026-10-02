// release:analyze and the version bump on fixtures: none, patch, minor, major (both "!" and the
// BREAKING CHANGE footer), prerelease; plus the confirm-the-untagged-version rule.
// Fixture versions use majors 39-41 and 400 so they can never be mistaken for the real product
// version by version:check (the V2 situation, the v1.0.0 tag followed by an untagged V2
// major, is modelled as v39.0.0 -> 40.0.0).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeCommits, parseCommit, proposeVersion, readCommits, lastReleaseTag,
} from '../../scripts/release-analyze.mjs';
import { bumpVersion, compareSemver, parseSemver } from '../../scripts/release-metadata.mjs';

const c = (subject, body = '') => ({ sha: `${subject.length}`.padEnd(40, '0'), subject, body });

const FIXTURES = {
  none: [c('chore(plan): record evidence'), c('docs: explain the gate'), c('ci: cache npm'),
    c('test(sequencer): cover loops'), c('refactor(ui): split dialogs')],
  patch: [c('chore: tidy'), c('fix(audio): click-free stop'), c('perf(charts): fewer allocations')],
  minor: [c('fix: a'), c('feat(labs): bioacoustics panel'), c('docs: b')],
  majorBang: [c('feat(config)!: rename oscillaVersion'), c('fix: a')],
  majorFooter: [c('fix(url): drop the v=0 links', 'Long text.\n\nBREAKING CHANGE: v=0 links no '
    + 'longer load')],
  unconventional: [c('Update index.html'), c('chore: x')],
};

test('parseCommit: type, scope, "!" and the breaking footer', () => {
  const p = parseCommit(c('feat(ui)!: new shell'));
  assert.deepEqual([p.conventional, p.type, p.scope, p.breaking, p.description],
    [true, 'feat', 'ui', true, 'new shell']);
  const f = parseCommit(c('fix: x', 'BREAKING-CHANGE: gone'));
  assert.deepEqual([f.breaking, f.breakingNote], [true, 'gone']);
  assert.equal(parseCommit(c('fix: x', 'mentions BREAKING CHANGE: inline only')).breaking, false);
  assert.equal(parseCommit(c('Merge branch main')).conventional, false);
});

test('fixture none -> none', () => {
  const a = analyzeCommits(FIXTURES.none);
  assert.equal(a.level, 'none');
  assert.equal(a.counts.none, 5);
  assert.ok(a.reasons.every((r) => /no release impact/.test(r.why)));
});

test('fixture patch -> patch', () => {
  assert.equal(analyzeCommits(FIXTURES.patch).level, 'patch');
});

test('fixture minor -> minor', () => {
  const a = analyzeCommits(FIXTURES.minor);
  assert.equal(a.level, 'minor');
  assert.match(a.reasons[1].why, /feat/);
});

test('fixture major -> major, by "!" and by footer', () => {
  assert.equal(analyzeCommits(FIXTURES.majorBang).level, 'major');
  const a = analyzeCommits(FIXTURES.majorFooter);
  assert.equal(a.level, 'major');
  assert.match(a.reasons[0].why, /BREAKING CHANGE: v=0 links no longer load/);
});

test('non-conventional commits are never silently dropped (patch)', () => {
  const a = analyzeCommits(FIXTURES.unconventional);
  assert.equal(a.level, 'patch');
  assert.match(a.reasons[0].why, /not a conventional commit/);
});

test('bumpVersion: release levels and prereleases', () => {
  assert.equal(bumpVersion('40.0.0', 'patch'), '40.0.1');
  assert.equal(bumpVersion('40.0.3', 'minor'), '40.1.0');
  assert.equal(bumpVersion('40.4.3', 'major'), '41.0.0');
  assert.equal(bumpVersion('40.0.0', 'prerelease', { preLevel: 'minor' }), '40.1.0-rc.1');
  assert.equal(bumpVersion('40.1.0-rc.1', 'prerelease'), '40.1.0-rc.2');
  assert.equal(bumpVersion('40.1.0-beta.4', 'prerelease'), '40.1.0-rc.1');
  assert.equal(bumpVersion('40.1.0-rc.2', 'minor'), '40.1.0'); // finalise
  assert.equal(bumpVersion('41.0.0-rc.1', 'major'), '41.0.0');
  assert.equal(bumpVersion('40.1.1-rc.1', 'minor'), '40.2.0');
  assert.throws(() => bumpVersion('2.0', 'patch'), /not a semantic version/);
  assert.throws(() => bumpVersion('40.0.0', 'huge'), /unknown release level/);
});

test('compareSemver follows SemVer precedence', () => {
  const sorted = ['40.0.0', '40.0.0-rc.1', '39.9.9', '40.0.0-alpha', '40.0.0-rc.10', '40.0.0-rc.2',
    '40.0.0-alpha.1', '400.0.0'].sort(compareSemver);
  assert.deepEqual(sorted, ['39.9.9', '40.0.0-alpha', '40.0.0-alpha.1', '40.0.0-rc.1',
    '40.0.0-rc.2',
    '40.0.0-rc.10', '40.0.0', '400.0.0']);
  assert.equal(parseSemver('01.2.3'), null);
});

test('proposeVersion: confirm the untagged initial version, bump otherwise', () => {
  // The V2 situation, shifted: v39.0.0 is the last tag, package.json an untagged 40.0.0.
  const initial = proposeVersion({ current: '40.0.0', lastTagVersion: '39.0.0', level: 'minor' });
  assert.deepEqual([initial.version, initial.action], ['40.0.0', 'confirm']);
  // Untagged but not enough: a feat since v40.0.0 needs 40.1.0, not the 40.0.1 on main.
  const short = proposeVersion({ current: '40.0.1', lastTagVersion: '40.0.0', level: 'minor' });
  assert.deepEqual([short.version, short.action], ['40.1.0', 'bump']);
  const tagged = proposeVersion({ current: '40.0.0', lastTagVersion: '40.0.0', level: 'patch' });
  assert.deepEqual([tagged.version, tagged.action], ['40.0.1', 'bump']);
  const none = proposeVersion({ current: '40.0.0', lastTagVersion: '40.0.0', level: 'none' });
  assert.deepEqual([none.version, none.action], [null, 'none']);
  const first = proposeVersion({ current: '0.1.0', lastTagVersion: null, level: 'none' });
  assert.deepEqual([first.version, first.action], ['0.1.0', 'confirm']);
  assert.throws(() => proposeVersion({ current: '39.0.0', lastTagVersion: '40.0.0',
    level: 'patch' }),
    /older than the last tag/);
});

test('fixture prerelease: rc counters advance, then the release finalises', () => {
  const rc = (current, last, level) => proposeVersion({ current, lastTagVersion: last, level,
    prerelease: true });
  assert.equal(rc('40.0.0', '40.0.0', 'minor').version, '40.1.0-rc.1');
  assert.equal(rc('40.1.0-rc.1', '40.1.0-rc.1', 'patch').version, '40.1.0-rc.2');
  const final = proposeVersion({ current: '40.1.0-rc.2', lastTagVersion: '40.1.0-rc.2',
    level: 'minor' });
  assert.equal(final.version, '40.1.0');
});

test('git readers: last v* tag by SemVer, commits since it', () => {
  const run = (args) => {
    if (args[0] === 'tag') return 'v39.0.0\nv39.10.0\nv39.9.0\nvnext\nv40.0.0-rc.1';
    if (args[0] === 'log') {
      assert.equal(args[2], 'v40.0.0-rc.1..HEAD');
      return `${'a'.repeat(40)}\x1ffeat: x\x1fbody line\x1e\n${'b'.repeat(40)}\x1ffix: y\x1f\x1e\n`;
    }
    throw new Error(args.join(' '));
  };
  assert.equal(lastReleaseTag(run), 'v40.0.0-rc.1');
  const commits = readCommits('v40.0.0-rc.1', run);
  assert.deepEqual(commits.map((x) => [x.subject, x.body]),
    [['feat: x', 'body line'], ['fix: y', '']]);
  assert.equal(lastReleaseTag(() => ''), null);
});
