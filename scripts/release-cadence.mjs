#!/usr/bin/env node
// npm run release:cadence — rule project.deploy-often: releasable commits on main do not sit
// unreleased. When release:analyze reports a level other than none, the oldest unreleased
// release-relevant commit (any commit release-analyze.mjs gives a level other than none: feat,
// fix, perf, revert, a breaking change, and a commit that is not a conventional commit) may be
// at most MAX_AGE_HOURS old, counted from its committer date, which for a squash merge is the
// time it landed on main.
//
//   node scripts/release-cadence.mjs [--json] [--report] [--issue] [--max-age-hours 24]
//
//   (default)  print the lag; exit 1 when the release is overdue, 2 when it cannot be measured
//   --report   print the lag and always exit 0 (npm run verify: a feature branch is not where
//              a release is cut, so the lag is shown there and judged on main)
//   --issue    also keep exactly one open GitHub issue titled ISSUE_TITLE in step with the
//              verdict through gh: opened or updated while overdue, closed once it is not
//              (.github/workflows/cadence.yml, hourly and on every push to main)
//
// cadence() is a pure function over (last tag, dated commits, now); the level comes from
// release-analyze.mjs, so this script and release:analyze cannot disagree about what is
// releasable.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCommits, lastReleaseTag } from './release-analyze.mjs';
import { ROOT, gitRunner } from './release-metadata.mjs';

export const MAX_AGE_HOURS = 24;
export const ISSUE_TITLE = 'release overdue';
const HOUR = 3_600_000;

/**
 * Pure verdict.
 * @param {{ lastTag: string|null,
 *   commits: { sha?: string, subject: string, body?: string, date: number }[],
 *   now: number, maxAgeHours?: number }} o  commits since lastTag, newest first; ms
 * @returns {{ lastTag, level, commits, relevant, oldest, maxAgeHours, overdue }}
 */
export function cadence({ lastTag, commits, now, maxAgeHours = MAX_AGE_HOURS }) {
  const { level, reasons } = analyzeCommits(commits);
  const relevant = commits.map((c, i) => ({ ...c, level: reasons[i].level }))
    .filter((c) => c.level !== 'none');
  const first = relevant.reduce((a, c) => (!a || c.date < a.date ? c : a), null);
  const oldest = first && {
    sha: first.sha || '', subject: first.subject, level: first.level,
    date: new Date(first.date).toISOString(),
    ageHours: Math.round(((now - first.date) / HOUR) * 10) / 10,
  };
  return {
    lastTag, level, commits: commits.length, relevant: relevant.length, oldest, maxAgeHours,
    overdue: !!oldest && now - first.date > maxAgeHours * HOUR,
  };
}

/** Commits in (since, HEAD] with their committer dates, newest first. */
export function readDatedCommits(since, run = gitRunner()) {
  const out = run(['log', '--format=%H%x1f%ct%x1f%s%x1f%b%x1e', `${since}..HEAD`]);
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim())
    .map((r) => {
      const [sha, seconds, subject, body] = r.split('\x1f');
      return { sha, date: Number(seconds) * 1000, subject, body: (body || '').trim() };
    });
}

export function formatCadence(c) {
  if (!c.oldest) {
    return `release cadence: nothing releasable since ${c.lastTag} `
      + `(${c.commits} commit(s), level none)`;
  }
  const o = c.oldest;
  return [
    `release cadence: ${c.overdue ? 'OVERDUE' : 'ok'}; ${c.relevant} releasable commit(s) since `
      + `${c.lastTag} need a ${c.level} release`,
    `  oldest unreleased: ${o.sha.slice(0, 7)} ${o.subject}`,
    `  landed ${o.date}, ${o.ageHours} h ago (limit ${c.maxAgeHours} h, rule `
      + 'project.deploy-often)',
    ...(c.overdue ? ['  ship it: npm run release:prepare, land the chore(release) PR, '
      + 'npm run release:publish -- --yes, npm run release:record'] : []),
  ].join('\n');
}

export function issueBody(c) {
  const o = c.oldest;
  return [
    `Releasable commits have sat on \`main\` for more than ${c.maxAgeHours} hours `
      + '(rule `project.deploy-often`).',
    '',
    `- Last release: \`${c.lastTag}\``,
    `- Required level: **${c.level}** (${c.relevant} releasable of ${c.commits} commit(s))`,
    `- Oldest unreleased commit: \`${o.sha.slice(0, 7)}\` ${o.subject}`,
    `- Landed: ${o.date} (${o.ageHours} h ago)`,
    '',
    'Clear it by shipping: `npm run release:prepare` on a clean tree, land the '
      + '`chore(release)` PR, `npm run release:publish -- --yes`, then '
      + '`npm run release:record` and its PR. This issue is kept by '
      + '`scripts/release-cadence.mjs --issue` (`.github/workflows/cadence.yml`) and closes '
      + 'itself once nothing releasable is older than the limit.',
  ].join('\n');
}

/**
 * Keep exactly one open issue titled ISSUE_TITLE in step with the verdict.
 * @param {{ result: object, sh: (cmd: string, args: string[]) => { status: number,
 *   stdout: string, stderr?: string } }} o
 * @returns {'created'|'updated'|'closed'|'none'}
 */
export function syncIssue({ result, sh }) {
  const must = (args) => {
    const r = sh('gh', args);
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  const open = JSON.parse(must(['issue', 'list', '--state', 'open', '--search',
    `"${ISSUE_TITLE}" in:title`, '--json', 'number,title', '--limit', '50']) || '[]')
    .filter((i) => i.title === ISSUE_TITLE).sort((a, b) => a.number - b.number);
  if (result.overdue) {
    const body = issueBody(result);
    if (open.length) {
      must(['issue', 'edit', String(open[0].number), '--body', body]);
      return 'updated';
    }
    must(['issue', 'create', '--title', ISSUE_TITLE, '--body', body]);
    return 'created';
  }
  for (const i of open) {
    must(['issue', 'close', String(i.number), '--comment', result.oldest
      ? `No longer overdue: the oldest releasable commit is ${result.oldest.ageHours} h old.`
      : `Nothing releasable since ${result.lastTag}.`]);
  }
  return open.length ? 'closed' : 'none';
}

function defaultSh(root) {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
    return { status: r.error ? 127 : r.status, stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || (r.error ? r.error.message : '')).trim() };
  };
}

/** @returns {number} exit code: 0 ok, 1 overdue, 2 cannot measure */
export function main({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), sh = defaultSh(root),
  now = Date.now(), log = console.log, err = console.error,
} = {}) {
  const report = argv.includes('--report');
  const hi = argv.indexOf('--max-age-hours');
  const maxAgeHours = hi >= 0 ? Number(argv[hi + 1]) : MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    err('release:cadence: --max-age-hours needs a positive number');
    return 2;
  }
  const lastTag = lastReleaseTag(run);
  if (!lastTag) {
    // A shallow clone or one without tags: the unreleased range is unknown, so no verdict.
    const why = 'release cadence: no v* tag is reachable from HEAD (a shallow clone, or tags '
      + 'not fetched): the lag cannot be measured here';
    (report ? log : err)(why);
    return report ? 0 : 2;
  }
  const result = cadence({ lastTag, commits: readDatedCommits(lastTag, run), now, maxAgeHours });
  log(argv.includes('--json') ? JSON.stringify(result, null, 2) : formatCadence(result));
  if (argv.includes('--issue')) log(`release overdue issue: ${syncIssue({ result, sh })}`);
  return result.overdue && !report ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`release:cadence: ${e.message}`);
    process.exit(2);
  }
}
