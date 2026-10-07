// Rule project.deploy-often: releasable commits on main do not sit unreleased. The verdict of
// scripts/release-cadence.mjs is a pure function over (last tag, dated commits, now), tested
// here on fixtures; the CLI runs against a fake git, the "release overdue" issue against a
// fake gh, and the workflow that runs it hourly is checked for the properties the rule names.
// Fixture versions use major 40 so version:check never mistakes them for the product version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ISSUE_TITLE, MAX_AGE_HOURS, cadence, formatCadence, issueBody, main, readDatedCommits,
  syncIssue,
} from '../../scripts/release-cadence.mjs';

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

function fakeGit({ tags = 'v40.10.2\nv40.10.3', commits = [] } = {}) {
  return (args) => {
    if (args[0] === 'tag') return tags;
    if (args[0] === 'log') {
      assert.deepEqual(args, ['log', '--format=%H%x1f%ct%x1f%s%x1f%b%x1e', 'v40.10.3..HEAD']);
      return commits.map((x) => `${x.sha}\x1f${x.date / 1000}\x1f${x.subject}\x1f${x.body}\x1e\n`)
        .join('');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

function cli(argv, git, sh) {
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
  const r = cli(['--issue'], { commits: [c('feat(x): new panel', 48)] }, viaCli.sh);
  assert.equal(r.code, 1, 'the workflow is red AND the issue exists');
  assert.match(r.text, /release overdue issue: created/);
});

// ---------------------------------------------------------------- the workflow

test('cadence.yml runs the check hourly and on main, bounded, with a minimal token', () => {
  const yml = readFileSync(new URL('../../.github/workflows/cadence.yml', import.meta.url),
    'utf8');
  assert.match(yml, /\n {2}schedule:\n {4}- cron: '\d+ \* \* \* \*'\n/, 'hourly');
  assert.match(yml, /\n {2}push:\n {4}branches: \[main\]\n/);
  assert.match(yml, /\npermissions:\n {2}contents: read\n {2}issues: write\n\n/,
    'read-only contents; issues: write for the one issue, and nothing else');
  assert.match(yml, /\n {4}timeout-minutes: \d+\n/);
  assert.match(yml, /fetch-depth: 0\n/, 'tags and history: the unreleased range needs both');
  assert.match(yml, /\n {8}run: node scripts\/release-cadence\.mjs --issue\n/);
  assert.doesNotMatch(yml, /continue-on-error|\|\| true/, 'an overdue release fails the run');
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
