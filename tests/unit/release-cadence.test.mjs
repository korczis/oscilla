// Rule project.deploy-often: releasable commits on main do not sit unreleased. The verdict of
// scripts/release-cadence.mjs is a pure function over (last tag, dated commits, now), tested
// here on fixtures; the CLI runs against a fake git, the "release overdue" issue against a
// fake gh, and the workflow that runs it hourly is checked for the properties the rule names.
// Fixture versions use major 40 so version:check never mistakes them for the product version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ISSUE_TITLE, MAX_AGE_HOURS, RECORD_PR_HOURS, cadence, countedReleaseTag, formatCadence,
  issueBody, main, readDatedCommits, recordBranch, releaseGap, syncIssue,
} from '../../scripts/release-cadence.mjs';
import { lastReleaseTag } from '../../scripts/release-analyze.mjs';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;
const sha = (n) => String(n).repeat(40).slice(0, 40);
/** A commit that landed `hours` ago. */
const c = (subject, hours, n = 1, body = '') => ({ sha: sha(n), subject, body,
  date: NOW - hours * HOUR });
const verdict = (commits, o = {}) => cadence({ lastTag: 'v40.10.3', commits, now: NOW, ...o });

test('a feat that has sat for 48 h is overdue, and the commit is named', () => {
  const r = verdict([c('docs: later', 1, 2), c('feat(x): new panel', 48, 1)]);
  assert.equal(r.overdue, true);
  assert.equal(r.level, 'minor');
  assert.deepEqual(r.oldest, { sha: sha(1), subject: 'feat(x): new panel', level: 'minor',
    date: '2026-10-05T12:00:00.000Z', ageHours: 48 });
  const text = formatCadence(r);
  assert.match(text, /^release cadence: OVERDUE; 1 releasable commit\(s\) since v40\.10\.3 /);
  assert.match(text, /oldest unreleased: 1111111 feat\(x\): new panel/);
  assert.match(text, /48 h ago \(limit 24 h, rule project\.deploy-often\)/);
});

test('the same feat at 2 h is within the limit', () => {
  const r = verdict([c('feat(x): new panel', 2)]);
  assert.equal(r.overdue, false);
  assert.equal(r.oldest.ageHours, 2);
  assert.match(formatCadence(r), /^release cadence: ok; /);
});

test('only chore and docs commits never make a release overdue (level none)', () => {
  const r = verdict([c('chore(plan): evidence', 72, 1), c('docs: explain', 72, 2),
    c('ci: cache', 500, 3), c('test: more', 500, 4), c('refactor: tidy', 500, 5)]);
  assert.deepEqual([r.level, r.overdue, r.oldest, r.relevant, r.commits],
    ['none', false, null, 0, 5]);
  assert.match(formatCadence(r), /nothing releasable since v40\.10\.3 \(5 commit\(s\)/);
});

test('the clock is the OLDEST releasable commit; the limit itself is not overdue', () => {
  // a fresh fix does not reset the clock of the feat that has been waiting
  const r = verdict([c('fix: just now', 0.5, 2), c('chore: between', 30, 3),
    c('feat: waiting', 30, 1), c('docs: older still', 90, 4)]);
  assert.equal(r.overdue, true);
  assert.equal(r.oldest.subject, 'feat: waiting');
  assert.equal(r.relevant, 2);
  assert.equal(verdict([c('fix: at the limit', MAX_AGE_HOURS)]).overdue, false);
  assert.equal(verdict([c('fix: past it', MAX_AGE_HOURS + 0.1)]).overdue, true);
  assert.equal(verdict([c('fix: x', 30)], { maxAgeHours: 48 }).overdue, false);
});

test('releasable is what release:analyze counts: fix, perf, breaking, non-conventional', () => {
  for (const [subject, level, body] of [['fix(audio): click', 'patch'], ['perf: faster', 'patch'],
    ['revert: feat', 'patch'], ['Update index.html', 'patch'], ['chore!: drop v=0', 'major'],
    ['chore: x', 'major', 'BREAKING CHANGE: old links fail']]) {
    const r = verdict([c(subject, 25, 1, body)]);
    assert.deepEqual([r.overdue, r.level], [true, level], subject);
  }
});

// ---------------------------------------------------------------- CLI against a fake git

// `records`: the tags whose record file HEAD carries (default: every tag). `ranges` (R035)
// answers git log by its range, as git would, so a cadence measured from another tag reads
// other commits; without it the log must be asked for v40.10.3..HEAD.
const RECORD_AT = (args) => /^HEAD:\.ai\/repo\/releases\/(v[^/]+)\.yaml$/.exec(args[1] || '');
function fakeGit({ tags = 'v40.10.2\nv40.10.3', commits = [], records = null,
  ranges = null } = {}) {
  return (args) => {
    if (args[0] === 'tag') return tags;
    if (args[0] === 'show' && RECORD_AT(args)) {
      const tag = RECORD_AT(args)[1];
      if (records && !records.includes(tag)) throw new Error(`fatal: path does not exist`);
      return `schema: release/v1\ntag: ${tag}\n`;
    }
    if (args[0] === 'log') {
      if (ranges) {
        assert.ok(args.at(-1) in ranges, `unexpected range ${args.at(-1)}`);
        commits = ranges[args.at(-1)];
      } else {
        assert.deepEqual(args, ['log', '--format=%H%x1f%ct%x1f%s%x1f%b%x1e', 'v40.10.3..HEAD']);
      }
      return commits.map((x) => `${x.sha}\x1f${x.date / 1000}\x1f${x.subject}\x1f${x.body}\x1e\n`)
        .join('');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

/**
 * gh for the releases (R035): `releases` the tags with a published GitHub Release (default:
 * every tag; `drafts` are drafts), `prs` the open pull requests by head branch, `unread` makes
 * every release view fail as a network error would. Anything else goes to `rest` (the issue).
 */
function fakeReleases({ releases = null, drafts = [], prs = {}, unread = false,
  rest = () => ({ status: 0, stdout: '[]' }) } = {}) {
  const calls = [];
  const sh = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === 'release' && args[1] === 'view') {
      if (unread) return { status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' };
      if (releases && !releases.includes(args[2])) {
        return { status: 1, stdout: '', stderr: 'release not found' };
      }
      return { status: 0, stdout: JSON.stringify({ tagName: args[2],
        isDraft: drafts.includes(args[2]) }) };
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      return { status: 0, stdout: JSON.stringify(prs[args[args.indexOf('--head') + 1]] || []) };
    }
    return rest(cmd, args);
  };
  return { sh, calls };
}

function cli(argv, git, sh = fakeReleases().sh) {
  const out = [];
  const code = main({ argv, run: fakeGit(git), sh, now: NOW, log: (l) => out.push(l),
    err: (l) => out.push(l) });
  return { code, text: out.join('\n') };
}

test('CLI: exit 1 when overdue, 0 when not, --report never fails, --json is the verdict', () => {
  const overdue = { commits: [c('feat(x): new panel', 48)] };
  assert.equal(cli([], overdue).code, 1);
  assert.match(cli([], overdue).text, /OVERDUE/);
  assert.equal(cli(['--report'], overdue).code, 0);
  assert.match(cli(['--report'], overdue).text, /OVERDUE/, 'the lag is still printed');
  assert.equal(cli([], { commits: [c('feat(x): new panel', 2)] }).code, 0);
  assert.equal(cli([], { commits: [c('chore: x', 72)] }).code, 0);
  assert.equal(cli(['--max-age-hours', '72'], overdue).code, 0);
  assert.equal(cli(['--max-age-hours', 'soon'], overdue).code, 2);
  const json = JSON.parse(cli(['--json'], overdue).text);
  assert.deepEqual([json.overdue, json.lastTag, json.oldest.sha], [true, 'v40.10.3', sha(1)]);
  assert.deepEqual(readDatedCommits('v40.10.3', fakeGit(overdue)),
    [{ sha: sha(1), date: NOW - 48 * HOUR, subject: 'feat(x): new panel', body: '' }]);
});

test('CLI: without a reachable v* tag there is no verdict (2), and --report says why', () => {
  const none = cli([], { tags: '' });
  assert.equal(none.code, 2);
  assert.match(none.text, /no v\* tag is reachable from HEAD/);
  assert.equal(cli(['--report'], { tags: '' }).code, 0);
});

// ------------------------------------------------------- R035: a tag alone is not a release
// A publish that fails after pushing its tag leaves no deploy and no Release; the cadence
// must stay overdue. v40.10.3 is at HEAD with no record and no Release here; v40.10.2 is the
// last release that finished.
const WAITING = [c('chore(release): v40.10.3', 1, 2), c('feat(x): waiting', 30, 1)];
const STRANDED = { tags: 'v40.10.2\nv40.10.3', records: ['v40.10.2'],
  ranges: { 'v40.10.2..HEAD': WAITING, 'v40.10.3..HEAD': [c('fix: fresh', 2, 3)],
    HEAD: [...WAITING, c('feat: first', 900, 4)] } };

test('R035: a tag with no Release and no record does not clear the cadence, and says why', () => {
  const r = cli([], STRANDED, fakeReleases({ releases: ['v40.10.2'] }).sh);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /OVERDUE; 1 releasable commit\(s\) since v40\.10\.2 /);
  assert.match(r.text, new RegExp('v40\\.10\\.3 is not counted as a release: no GitHub Release; '
    + 'no record \\.ai/repo/releases/v40\\.10\\.3\\.yaml on HEAD and no open record pull '
    + 'request \\(chore/release-record-v40\\.10\\.3\\)'));
  // lastReleaseTag, shared with release:analyze and release:publish, still names the tag
  assert.equal(lastReleaseTag(fakeGit(STRANDED)), 'v40.10.3');
  // the issue body carries the same reason
  const json = JSON.parse(cli(['--json'], STRANDED, fakeReleases({ releases: ['v40.10.2'] }).sh)
    .text);
  assert.deepEqual([json.lastTag, json.skipped.map((x) => x.tag)], ['v40.10.2', ['v40.10.3']]);
  assert.match(issueBody(json), /- v40\.10\.3 is not counted as a release: no GitHub Release/);
  // a Release without the record, or a draft, still leaves it overdue
  const noRecord = cli([], STRANDED);
  assert.equal(noRecord.code, 1);
  assert.match(noRecord.text, /v40\.10\.3 is not counted as a release: no record /);
  assert.doesNotMatch(noRecord.text, /no GitHub Release/);
  const draft = cli([], { ...STRANDED, records: null },
    fakeReleases({ drafts: ['v40.10.3'] }).sh);
  assert.match(draft.text, /v40\.10\.3 is not counted as a release: no GitHub Release$/m);
});

test('R035: a Release with its record, or with a young open record PR, clears it as today', () => {
  // since the counted v40.10.3 only a fresh fix is unreleased
  const recorded = cli([], { ...STRANDED, records: null });
  assert.equal(recorded.code, 0, recorded.text);
  assert.match(recorded.text, /since v40\.10\.3 /);
  assert.doesNotMatch(recorded.text, /not counted/);

  const pr = (hours) => ({ [recordBranch('v40.10.3')]: [{ number: 530,
    createdAt: new Date(NOW - hours * HOUR).toISOString() }] });
  const young = cli([], STRANDED, fakeReleases({ prs: pr(3) }).sh);
  assert.equal(young.code, 0, young.text);
  assert.doesNotMatch(young.text, /not counted/);
  const old = cli([], STRANDED, fakeReleases({ prs: pr(RECORD_PR_HOURS + 2) }).sh);
  assert.equal(old.code, 1, old.text);
  assert.match(old.text, new RegExp('v40\\.10\\.3 is not counted as a release: no record '
    + '\\.ai/repo/releases/v40\\.10\\.3\\.yaml on HEAD, and its record pull request #530 has '
    + 'been open 26 h \\(limit 24 h\\)'));
  assert.equal(releaseGap({ tag: 'v40.10.3', release: true, record: false, now: NOW,
    recordPr: { number: 1, createdAt: new Date(NOW - RECORD_PR_HOURS * HOUR).toISOString() } }),
  null, 'the limit itself still counts');
});

test('R035: unreadable GitHub state is no verdict; --report reads none and measures as before',
  () => {
    const unread = cli([], STRANDED, fakeReleases({ unread: true }).sh);
    assert.equal(unread.code, 2, unread.text);
    assert.match(unread.text, /the releases cannot be read.*gh release view v40\.10\.3 failed: /);
    const gh = fakeReleases({ unread: true });
    const report = cli(['--report'], STRANDED, gh.sh);
    assert.equal(report.code, 0, report.text);
    assert.match(report.text, /--report: measured from the newest tag/);
    assert.deepEqual(gh.calls, [], '--report asks GitHub nothing');
    // no tag counts at all: the lag runs over the whole history
    const none = cli([], { ...STRANDED, records: [] }, fakeReleases({ releases: [] }).sh);
    assert.equal(none.code, 1, none.text);
    assert.match(none.text, /since the start of history \(no counted release\)/);
    assert.match(none.text, /v40\.10\.2 is not counted/);
    // the walk keeps lastReleaseTag's order and filter
    const seen = [];
    const mixed = fakeGit({ tags: 'v40.9.0\nnot-a-tag\nv40.10.3\nv40.10.2' });
    assert.deepEqual(countedReleaseTag({ run: mixed,
      gap: (t) => (seen.push(t), t === 'v40.9.0' ? null : 'no') }).tag, 'v40.9.0');
    assert.deepEqual(seen, ['v40.10.3', 'v40.10.2', 'v40.9.0']);
  });

// ---------------------------------------------------------------- the issue, against a fake gh

function fakeGh(open = [], { fail = false } = {}) {
  const calls = [];
  const sh = (cmd, args) => {
    calls.push([cmd, ...args]);
    assert.equal(cmd, 'gh');
    if (fail) return { status: 1, stdout: '', stderr: 'HTTP 403' };
    return { status: 0, stdout: args[1] === 'list' ? JSON.stringify(open) : '' };
  };
  return { sh, calls, acts: () => calls.filter((x) => x[2] !== 'list').map((x) => x.slice(1, 4)) };
}

test('the issue: opened once, updated while overdue, closed when it clears', () => {
  const overdue = verdict([c('feat(x): new panel', 48)]);
  const fine = verdict([c('feat(x): new panel', 2)]);
  const mine = { number: 12, title: ISSUE_TITLE };
  const similar = { number: 9, title: 'release overdue checks are noisy' };

  const first = fakeGh([similar]);
  assert.equal(syncIssue({ result: overdue, sh: first.sh }), 'created');
  assert.deepEqual(first.acts(), [['issue', 'create', '--title']]);
  const created = first.calls.at(-1);
  assert.equal(created[created.indexOf('--title') + 1], ISSUE_TITLE);
  assert.equal(created[created.indexOf('--body') + 1], issueBody(overdue));
  assert.match(issueBody(overdue), /Oldest unreleased commit: `1111111` feat\(x\): new panel/);
  assert.match(issueBody(overdue), /more than 24 hours \(rule `project\.deploy-often`\)/);

  const again = fakeGh([similar, mine]);
  assert.equal(syncIssue({ result: overdue, sh: again.sh }), 'updated');
  assert.deepEqual(again.acts(), [['issue', 'edit', '12']], 'never a second issue');

  const cleared = fakeGh([mine]);
  assert.equal(syncIssue({ result: fine, sh: cleared.sh }), 'closed');
  assert.deepEqual(cleared.acts(), [['issue', 'close', '12']]);
  const quiet = fakeGh([similar]);
  assert.equal(syncIssue({ result: fine, sh: quiet.sh }), 'none');
  assert.deepEqual(quiet.acts(), []);

  assert.throws(() => syncIssue({ result: overdue, sh: fakeGh([], { fail: true }).sh }),
    /gh issue list failed: HTTP 403/);
  const viaCli = fakeGh([]);
  const r = cli(['--issue'], { commits: [c('feat(x): new panel', 48)] },
    fakeReleases({ rest: viaCli.sh }).sh);
  assert.equal(r.code, 1, 'the workflow is red AND the issue exists');
  assert.match(r.text, /release overdue issue: created/);
});

// ---------------------------------------------------------------- the workflow

test('cadence.yml runs the check hourly and on main, bounded, with a minimal token', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cadence.yml', import.meta.url),
    'utf8');
  assert.match(yml, /\n {2}schedule:\n {4}- cron: '\d+ \* \* \* \*'\n/, 'hourly');
  assert.match(yml, /\n {2}push:\n {4}branches: \[main\]\n/);
  assert.match(yml,
    /\npermissions:\n {2}contents: read\n {2}issues: write\n {2}pull-requests: read\n\n/,
    'read-only contents and pull requests (R035: the open record PR); issues: write for the '
    + 'one issue, and nothing else');
  assert.match(yml, /\n {4}timeout-minutes: \d+\n/);
  assert.match(yml, /fetch-depth: 0\n/, 'tags and history: the unreleased range needs both');
  assert.match(yml, /\n {8}run: node scripts\/release-cadence\.mjs --issue\n/);
  assert.doesNotMatch(yml, /continue-on-error|\|\| true/, 'an overdue release fails the run');
  assert.doesNotMatch(yml, /^\s*(- )?if:/m, 'no job or step is conditional: `if: false` on the '
    + 'job would leave a green workflow that checks nothing');
});

// Rule project.release-flow-complete: ci.yml runs the record-completeness test for pull
// requests only, so main itself is judged here, hourly and on every push and tag.
test('cadence.yml also judges the release records of main, with a read-only token', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cadence.yml', import.meta.url),
    'utf8');
  const job = /\n {2}records:\n([\s\S]*?)(?=\n {2}\S|$)/.exec(yml);
  assert.ok(job, 'a records job');
  assert.match(job[1], /\n {4}permissions:\n {6}contents: read\n(?! {6})/, 'contents: read only');
  assert.match(job[1], /\n {4}timeout-minutes: \d+\n/);
  assert.match(job[1], /fetch-depth: 0\n/, 'the tags reachable from HEAD are the list');
  assert.match(job[1], /\n {8}run: node scripts\/release-record\.mjs --complete\n/);
});

// package.json is a build input (its digest is stamped into dist/index.html), so the lag is
// surfaced by this test's diagnostic line rather than by a new step in the `verify` script:
// `npm test`, `npm run verify` and the release gate all print it, and none of them fails on it.
// A feature branch is not where a release is cut; the verdict belongs to cadence.yml on main.
test('this checkout: the release lag is printed, never judged here', (t) => {
  const out = [];
  const code = main({ argv: ['--report'], log: (l) => out.push(l), err: (l) => out.push(l) });
  assert.equal(code, 0);
  assert.match(out.join('\n'), /^release cadence: /);
  for (const line of out.join('\n').split('\n')) t.diagnostic(line);
});
