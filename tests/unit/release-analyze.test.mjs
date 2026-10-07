// release:analyze and the version bump on fixtures: none, patch, minor, major (both "!" and the
// BREAKING CHANGE footer), prerelease; plus the confirm-the-untagged-version rule.
// Fixture versions use majors 39-41 and 400 so they can never be mistaken for the real product
// version by version:check (the V2 situation, the v1.0.0 tag followed by an untagged V2
// major, is modelled as v39.0.0 -> 40.0.0).
//
// And what release:prepare requires before it starts (rule project.release-flow-complete),
// driven through main() as a dry run against a fake git runner and a fixture checkout: the
// newest release is recorded, and a major release follows a published release candidate.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  analyzeCommits, parseCommit, proposeVersion, readCommits, lastReleaseTag,
} from '../../scripts/release-analyze.mjs';
import { bumpVersion, compareSemver, parseSemver } from '../../scripts/release-metadata.mjs';
import { adrStatus, flowProblems, main as prepare } from '../../scripts/release-prepare.mjs';

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

// ---------------------------------------------------------------- release:prepare preconditions

const record = (version, channel) => `schema: release/v1\nversion: "${version}"\n`
  + `tag: v${version}\nchannel: ${channel}\n`;

/**
 * A fixture checkout (package.json, release records, ADRs) and a fake git that answers what
 * release:prepare asks before it would change anything. Returns the dry run's exit code and
 * everything it printed.
 */
function prepareDryRun({ version, tags, records = {}, adrs = {}, subject = 'feat(x): y',
  argv = [] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-prepare-'));
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  write('package.json', JSON.stringify({ version }));
  for (const [tag, channel] of Object.entries(records)) {
    write(`.ai/repo/releases/${tag}.yaml`, record(tag.slice(1), channel));
  }
  for (const [name, status] of Object.entries(adrs)) {
    write(`.ai/repo/adrs/${name}.md`, `---\nschema: adr/v1\nstatus: ${status}\n---\n\n# x\n`);
  }
  const run = (args) => {
    if (args[0] === 'status') return '';
    if (args[0] === 'tag') return tags.join('\n');
    if (args[0] === 'log') return `${'a'.repeat(40)}\x1f${subject}\x1f\x1e\n`;
    throw new Error(`release:prepare --dry-run must not run git ${args.join(' ')}`);
  };
  const out = [];
  const real = { log: console.log, error: console.error };
  console.log = (l) => out.push(String(l));
  console.error = (l) => out.push(String(l));
  let code;
  try {
    code = prepare(['--dry-run', ...argv], root, run);
  } finally {
    Object.assign(console, real);
  }
  return { code, text: out.join('\n') };
}

const RECORDED = { 'v40.10.2': 'stable', 'v40.10.3': 'stable' };
const TAGS = ['v40.10.2', 'v40.10.3'];

test('prepare starts when the newest release is recorded', () => {
  const r = prepareDryRun({ version: '40.10.3', tags: TAGS, records: RECORDED });
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Dry run: would bump v40\.11\.0 and run:/);
});

test('prepare refuses to start while the newest release has no record', () => {
  const r = prepareDryRun({ version: '40.10.3', tags: TAGS,
    records: { 'v40.10.2': 'stable' } });
  assert.equal(r.code, 1);
  assert.match(r.text, /refusing to start \(rule project\.release-flow-complete\)/);
  assert.match(r.text,
    /the newest release v40\.10\.3 has no \.ai\/repo\/releases\/v40\.10\.3\.yaml/);
  assert.match(r.text, /npm run release:record -- --version 40\.10\.3/);
  assert.doesNotMatch(r.text, /Dry run: would/);
  // an older gap does not stop the next release; the completeness test owns those
  const older = prepareDryRun({ version: '40.10.3', tags: TAGS,
    records: { 'v40.10.3': 'stable' } });
  assert.equal(older.code, 0, older.text);
  // releases before the first recorded one (v3.4.0) never had a record to miss
  const early = prepareDryRun({ version: '3.3.3', tags: ['v3.3.2', 'v3.3.3'] });
  assert.equal(early.code, 0, early.text);
});

test('prepare refuses a major release that no published release candidate preceded', () => {
  const major = { version: '41.0.0', tags: TAGS, records: RECORDED };
  const bare = prepareDryRun(major);
  assert.equal(bare.code, 1);
  assert.match(bare.text,
    /v41\.0\.0 is the first stable release of major 41 and has no published release candidate/);
  assert.match(bare.text, /publish a candidate first \(npm run release:prepare -- --prerelease; /);
  assert.match(bare.text, /set it to 41\.0\.0-rc\.1 for the candidate\), or pass --no-rc-because /);

  // an rc tag alone is not a published candidate: its record must be on the prerelease channel
  const rcTags = [...TAGS, 'v41.0.0-rc.1'];
  const tagOnly = prepareDryRun({ ...major, tags: rcTags });
  assert.equal(tagOnly.code, 1);
  assert.match(tagOnly.text, /newest release v41\.0\.0-rc\.1 has no /);
  assert.match(tagOnly.text, /no published release candidate/);
  const wrongChannel = prepareDryRun({ ...major, tags: rcTags,
    records: { ...RECORDED, 'v41.0.0-rc.1': 'stable' } });
  assert.equal(wrongChannel.code, 1);
  const published = prepareDryRun({ ...major, tags: rcTags,
    records: { ...RECORDED, 'v41.0.0-rc.1': 'prerelease' } });
  assert.equal(published.code, 0, published.text);
  assert.match(published.text, /Dry run: would confirm v41\.0\.0/);
  // a candidate of another major does not count
  const other = prepareDryRun({ ...major, tags: [...TAGS, 'v40.0.0-rc.1'],
    records: { ...RECORDED, 'v40.0.0-rc.1': 'prerelease' } });
  assert.equal(other.code, 1);

  // the release candidate itself, and minors and patches, need none
  const rc = prepareDryRun({ ...major, argv: ['--prerelease'], subject: 'feat!: new contract',
    version: '40.10.3' });
  assert.equal(rc.code, 0, rc.text);
  assert.match(rc.text, /would bump v41\.0\.0-rc\.1/);
  // the owner already set the major in package.json: the candidate is that version's rc.1
  const set = prepareDryRun({ ...major, argv: ['--prerelease'], version: '41.0.0-rc.1' });
  assert.equal(set.code, 0, set.text);
  assert.match(set.text, /would confirm v41\.0\.0-rc\.1/);
  // and the published candidate is finalised without an invented commit after it
  const final = prepareDryRun({ version: '41.0.0-rc.1', tags: rcTags, subject: 'docs: notes',
    records: { ...RECORDED, 'v41.0.0-rc.1': 'prerelease' } });
  assert.equal(final.code, 0, final.text);
  assert.match(final.text, /would bump v41\.0\.0 and run:/);
});

// The hole of verification round 1: a new major typed into package.json as X.0.1 or X.1.0 took
// the "confirm an untagged version" path, and the X.0.0 shape was the only trigger.
test('a new major line needs its candidate whatever minor and patch it starts at', () => {
  for (const version of ['41.0.1', '41.1.0', '41.2.3', '42.0.0']) {
    const typed = prepareDryRun({ version, tags: TAGS, records: RECORDED,
      subject: 'feat!: break it' });
    assert.equal(typed.code, 1, `${version}: ${typed.text}`);
    const major = version.split('.')[0];
    assert.match(typed.text, /refusing to start \(rule project\.release-flow-complete\)/);
    assert.match(typed.text, new RegExp(`v${version.replaceAll('.', '\\.')} is the first `
      + `stable release of major ${major} and has no published release candidate \\(no `
      + `v${major}\\.0\\.0-rc\\.N tag`));
    assert.match(typed.text, new RegExp(`set it to ${major}\\.0\\.0-rc\\.1 for the candidate`));
    assert.doesNotMatch(typed.text, /Dry run: would/);
  }
  // the candidate of that major, published, opens the line for any first stable version
  const rcTags = [...TAGS, 'v41.0.0-rc.1'];
  const rcRecords = { ...RECORDED, 'v41.0.0-rc.1': 'prerelease' };
  const after = prepareDryRun({ version: '41.0.1', tags: rcTags, records: rcRecords });
  assert.equal(after.code, 0, after.text);
  assert.match(after.text, /Dry run: would confirm v41\.0\.1/);
  // a candidate numbered after the typed version is not the candidate of the major
  const odd = prepareDryRun({ version: '41.1.0', tags: [...TAGS, 'v41.1.0-rc.1'],
    records: { ...RECORDED, 'v41.1.0-rc.1': 'prerelease' } });
  assert.equal(odd.code, 1);
  // once the major has a stable release, its patches and minors need none
  const line = { tags: [...TAGS, 'v41.0.0'], records: { ...RECORDED, 'v41.0.0': 'stable' } };
  for (const [version, subject, want] of [['41.0.0', 'fix: a', /would bump v41\.0\.1/],
    ['41.0.1', 'fix: a', /would confirm v41\.0\.1/], ['41.0.0', 'feat: a', /would bump v41\.1\.0/],
    ['41.1.0', 'feat: a', /would confirm v41\.1\.0/]]) {
    const ok = prepareDryRun({ ...line, version, subject });
    assert.equal(ok.code, 0, ok.text);
    assert.match(ok.text, want);
  }
  // pure: the trigger is the major of the stable tags, not the shape of the proposal
  const f = { lastTag: 'v40.10.3', tags: TAGS, hasRecord: () => true, channelOf: () => null };
  assert.equal(flowProblems({ ...f, proposed: '41.0.1' }).length, 1);
  assert.equal(flowProblems({ ...f, proposed: '41.1.0' }).length, 1);
  assert.deepEqual(flowProblems({ ...f, proposed: '40.11.0' }), []);
  assert.deepEqual(flowProblems({ ...f, proposed: '41.0.1', tags: [...TAGS, 'v41.0.0'] }), []);
  // a prerelease tag of the new major is not a stable release of it
  assert.equal(flowProblems({ ...f, proposed: '41.0.1', tags: [...TAGS, 'v41.0.0-rc.1'] }).length,
    1);
  assert.deepEqual(flowProblems({ ...f, proposed: '41.0.1', tags: [...TAGS, 'v41.0.0-rc.1'],
    channelOf: (t) => (t === 'v41.0.0-rc.1' ? 'prerelease' : null) }), []);
  // no stable tag at all: the X.0.0 shape decides (a first 0.1.0 needs no candidate)
  assert.deepEqual(flowProblems({ ...f, lastTag: null, tags: [], proposed: '0.1.0' }), []);
  assert.equal(flowProblems({ ...f, lastTag: null, tags: [], proposed: '1.0.0' }).length, 1);
});

test('prepare reads the tags reachable from HEAD, not every tag of the clone', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-prepare-tags-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.3.3' }));
  const asked = [];
  const run = (args) => {
    if (args[0] === 'status') return '';
    if (args[0] === 'tag') { asked.push(args.join(' ')); return 'v3.3.2\nv3.3.3'; }
    if (args[0] === 'log') return '';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const real = console.log;
  console.log = () => {};
  try {
    prepare(['--dry-run'], root, run);
  } finally {
    console.log = real;
  }
  assert.deepEqual([...new Set(asked)], ['tag --merged HEAD --list v*']);
});

test('proposeVersion: a published candidate is finalised even with no releasable commit', () => {
  const p = (current, last, o = {}) => proposeVersion({ current, lastTagVersion: last,
    level: 'none', ...o });
  const va = (r) => [r.version, r.action];
  assert.deepEqual(va(p('41.0.0-rc.2', '41.0.0-rc.2')), ['41.0.0', 'bump']);
  assert.deepEqual(va(p('41.0.0', '41.0.0-rc.1')), ['41.0.0', 'confirm']);
  assert.match(p('41.0.0-rc.2', '41.0.0-rc.2').why, /finalises the candidate v41\.0\.0-rc\.2/);
  // another candidate is asked for explicitly and still needs something to ship
  assert.equal(p('41.0.0-rc.2', '41.0.0-rc.2', { prerelease: true }).version, null);
  // a stable last tag with nothing releasable is still no release
  assert.equal(p('41.0.0', '41.0.0').version, null);
});

test('--no-rc-because overrides only by naming an accepted ADR', () => {
  const major = { version: '41.0.0', tags: TAGS, records: RECORDED,
    adrs: { '0098-skip-the-candidate': 'proposed', '0099-skip-the-candidate': 'accepted' } };
  const proposed = prepareDryRun({ ...major, argv: ['--no-rc-because', '0098'] });
  assert.equal(proposed.code, 1);
  assert.match(proposed.text, /--no-rc-because 0098: adr-0098 is proposed, not accepted/);
  const missing = prepareDryRun({ ...major, argv: ['--no-rc-because', 'ADR-0097'] });
  assert.equal(missing.code, 1);
  assert.match(missing.text, /--no-rc-because ADR-0097 names no ADR in \.ai\/repo\/adrs\//);
  const empty = prepareDryRun({ ...major, argv: ['--no-rc-because'] });
  assert.equal(empty.code, 1);
  for (const ref of ['0099', 'adr-0099', 'ADR 0099']) {
    const ok = prepareDryRun({ ...major, argv: ['--no-rc-because', ref] });
    assert.equal(ok.code, 0, ok.text);
  }
  // the repository's own ADR 0047 is the rule, not an exemption from it
  assert.equal(adrStatus('0047').id, 'adr-0047');
  assert.notEqual(adrStatus('0047').status, 'accepted');
});

test('flowProblems is pure: both refusals from facts alone', () => {
  const f = { lastTag: 'v40.10.3', proposed: '41.0.0', tags: TAGS, hasRecord: () => false,
    channelOf: () => null };
  assert.equal(flowProblems(f).length, 2);
  assert.deepEqual(flowProblems({ ...f, proposed: '40.11.0', hasRecord: () => true }), []);
  assert.deepEqual(flowProblems({ ...f, lastTag: null, proposed: null }), []);
});
