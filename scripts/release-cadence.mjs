#!/usr/bin/env node
// node scripts/release-cadence.mjs (there is no npm script: package.json is a build input) —
// rule project.deploy-often: releasable commits on main do not sit unreleased. When
// release:analyze reports a level other than none, the oldest unreleased
// release-relevant commit (any commit release-analyze.mjs gives a level other than none: feat,
// fix, perf, revert, a breaking change, and a commit that is not a conventional commit) may be
// at most MAX_AGE_HOURS old, counted from its committer date, which for a squash merge is the
// time it landed on main.
//
//   node scripts/release-cadence.mjs [--json] [--report] [--issue] [--max-age-hours 24] [--help]
//
//   --help / -h prints the usage and exits 0; an unknown flag or a flag missing its value
//   exits 2 (parseFlags of release-analyze.mjs), before git or gh is asked anything
//   (default)  print the lag; exit 1 when the release is overdue, 2 when it cannot be measured
//   --report   print the lag and always exit 0: a feature branch is not where a release is
//              cut, so the lag is shown there and judged on main. No npm script runs it, and
//              the lag is not a step of verify (rule project.deploy-often);
//              tests/unit/release-cadence.test.mjs prints it as a diagnostic through main()
//   --issue    also keep exactly one open GitHub issue titled ISSUE_TITLE in step with the
//              verdict through gh: opened or updated while overdue, closed once it is not
//              (.github/workflows/cadence.yml, hourly and on every push to main)
//
// cadence() is a pure function over (last tag, dated commits, now); the level comes from
// release-analyze.mjs, so this script and release:analyze cannot disagree about what is
// releasable.
//
// R035: a tag alone is not a release. A publish that fails after pushing its tag leaves no
// deploy and no Release, and counting that tag cleared the cadence. The last release is the
// newest v* tag reachable from HEAD (lastReleaseTag, unchanged and shared with release:analyze
// and release:publish) that has a GitHub Release (gh release view, not a draft) and either its
// record .ai/repo/releases/<tag>.yaml on HEAD or, while that lands, an open record pull request
// (branch chore/release-record-<tag>, the flow's last step) younger than RECORD_PR_HOURS. A tag
// before the record floor (release-record.mjs) needs only its Release. Each newer tag that
// fails is named with what it lacks, and the lag is measured from the release before it.
// GitHub state that cannot be read is no verdict (exit 2). --report reads no GitHub state: it
// measures from the newest tag, as before, and says so.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCommits, lastReleaseTag, parseFlags } from './release-analyze.mjs';
import { boundedRunner, failureReason } from './release-bounded.mjs';
import { ROOT, gitRunner } from './release-metadata.mjs';
import { RECORDS_DIR, needsRecord, recordOnRef } from './release-record.mjs';

export const MAX_AGE_HOURS = 24;
export const ISSUE_TITLE = 'release overdue';
const HOUR = 3_600_000;
// How long an open record pull request stands in for the record (R035): long enough for the
// record PR to land behind a busy queue, not so long that a forgotten one hides a release
// that never finished.
export const RECORD_PR_HOURS = 24;
export const recordBranch = (tag) => `chore/release-record-${tag}`;

/**
 * Pure: why `tag` is not a counted release, or null when it is.
 * @param {{ tag: string, release: boolean, record: boolean,
 *   recordPr?: { number: number, createdAt: string }|null, now: number,
 *   prHours?: number }} f  record: the record is on HEAD (or the tag needs none);
 *   recordPr: the open record pull request, null when there is none
 */
export function releaseGap({ tag, release, record, recordPr = null, now,
  prHours = RECORD_PR_HOURS }) {
  const missing = [];
  if (!release) missing.push('no GitHub Release');
  if (!record) {
    const file = `${RECORDS_DIR}/${tag}.yaml`;
    if (!recordPr) {
      missing.push(`no record ${file} on HEAD and no open record pull request `
        + `(${recordBranch(tag)})`);
    } else {
      const age = (now - Date.parse(recordPr.createdAt)) / HOUR;
      if (!(age <= prHours)) {
        missing.push(`no record ${file} on HEAD, and its record pull request #${recordPr.number} `
          + `has been open ${Math.round(age * 10) / 10} h (limit ${prHours} h)`);
      }
    }
  }
  return missing.length ? `${tag} is not counted as a release: ${missing.join('; ')}` : null;
}

/**
 * The newest tag lastReleaseTag returns that `gap` counts, and the newer ones it does not
 * (newest first). lastReleaseTag is asked again with each refused tag filtered out of the
 * tag list, so the order and the SemVer filter stay its own.
 * @param {{ run: Function, gap: (tag: string) => string|null }} o
 * @returns {{ tag: string|null, skipped: { tag: string, why: string }[] }}
 */
export function countedReleaseTag({ run, gap }) {
  const hidden = new Set();
  const filtered = (args) => {
    const out = run(args);
    return args[0] === 'tag' ? out.split('\n').filter((t) => !hidden.has(t)).join('\n') : out;
  };
  const skipped = [];
  for (let tag = lastReleaseTag(filtered); tag; tag = lastReleaseTag(filtered)) {
    const why = gap(tag);
    if (!why) return { tag, skipped };
    skipped.push({ tag, why });
    hidden.add(tag);
  }
  return { tag: null, skipped };
}

/**
 * What GitHub and HEAD say about `tag`, read through `run` (git) and `sh` (gh, bounded).
 * Throws when GitHub cannot be read: an unread Release is not a missing one.
 */
export function tagFacts(tag, { run, sh, now }) {
  const view = sh('gh', ['release', 'view', tag, '--json', 'tagName,isDraft']);
  let release;
  if (view.status === 0) {
    let parsed = null;
    try { parsed = JSON.parse(view.stdout || 'null'); } catch { /* below */ }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`gh release view ${tag}: the output is not a JSON object`);
    }
    release = parsed.isDraft !== true;
  } else if (/release not found|not found/i.test(String(view.stderr || ''))) {
    release = false;
  } else {
    throw new Error(`gh release view ${tag} failed: ${failureReason(view)}`);
  }
  const record = !needsRecord(tag) || recordOnRef(tag, run, 'HEAD');
  let recordPr = null;
  if (!record) {
    const args = ['pr', 'list', '--state', 'open', '--head', recordBranch(tag), '--json',
      'number,createdAt', '--limit', '5'];
    const list = sh('gh', args);
    if (list.status !== 0) throw new Error(`gh pr list failed: ${failureReason(list)}`);
    let prs;
    try { prs = JSON.parse(list.stdout || '[]'); } catch { prs = null; }
    if (!Array.isArray(prs)) throw new Error('gh pr list: the output is not a JSON list');
    // The youngest, if several: it is the one still being landed.
    recordPr = prs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
  }
  return { tag, release, record, recordPr, now };
}

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

/** Commits in (since, HEAD] with their committer dates, newest first; all of HEAD's when null. */
export function readDatedCommits(since, run = gitRunner()) {
  const out = run(['log', '--format=%H%x1f%ct%x1f%s%x1f%b%x1e', since ? `${since}..HEAD` : 'HEAD']);
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim())
    .map((r) => {
      const [sha, seconds, subject, body] = r.split('\x1f');
      return { sha, date: Number(seconds) * 1000, subject, body: (body || '').trim() };
    });
}

const since = (c) => c.lastTag || 'the start of history (no counted release)';
const skippedLines = (c) => (c.skipped || []).map((s) => `  ${s.why}`);

export function formatCadence(c) {
  if (!c.oldest) {
    return [`release cadence: nothing releasable since ${since(c)} `
      + `(${c.commits} commit(s), level none)`, ...skippedLines(c)].join('\n');
  }
  const o = c.oldest;
  return [
    `release cadence: ${c.overdue ? 'OVERDUE' : 'ok'}; ${c.relevant} releasable commit(s) since `
      + `${since(c)} need a ${c.level} release`,
    `  oldest unreleased: ${o.sha.slice(0, 7)} ${o.subject}`,
    `  landed ${o.date}, ${o.ageHours} h ago (limit ${c.maxAgeHours} h, rule `
      + 'project.deploy-often)',
    ...skippedLines(c),
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
    `- Last release: \`${c.lastTag || '(none counted)'}\``,
    ...(c.skipped || []).map((s) => `- ${s.why}`),
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
    if (r.status !== 0) {
      const tries = r.attempts > 1 ? ` (${r.attempts} attempts)` : '';
      throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${failureReason(r)}${tries}`);
    }
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

// Every gh call bounded and retried on a transient failure (scripts/release-bounded.mjs).
const defaultSh = (root) => boundedRunner({ cwd: root });

export const USAGE = 'usage: node scripts/release-cadence.mjs [--json] [--report] [--issue] '
  + '[--max-age-hours <h>] [--help]';
const FLAGS = {
  '--json': 'boolean', '--report': 'boolean', '--issue': 'boolean', '--max-age-hours': 'value',
};

/** @returns {number} exit code: 0 ok, 1 overdue, 2 cannot measure or usage */
export function main({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), sh = defaultSh(root),
  now = Date.now(), log = console.log, err = console.error,
} = {}) {
  let o;
  try {
    o = parseFlags(argv, FLAGS, USAGE);
  } catch (e) {
    err(`release-cadence: ${e.message}`);
    return e.exitCode;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const report = !!o['--report'];
  const maxAgeHours = '--max-age-hours' in o ? Number(o['--max-age-hours']) : MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    err('release-cadence: --max-age-hours needs a positive number');
    return 2;
  }
  const newest = lastReleaseTag(run);
  if (!newest) {
    // A shallow clone or one without tags: the unreleased range is unknown, so no verdict.
    const why = 'release cadence: no v* tag is reachable from HEAD (a shallow clone, or tags '
      + 'not fetched): the lag cannot be measured here';
    (report ? log : err)(why);
    return report ? 0 : 2;
  }
  // R035: judged runs count only a recorded, released tag; --report reads no GitHub state.
  let counted = { tag: newest, skipped: [] };
  if (!report) {
    try {
      counted = countedReleaseTag({ run,
        gap: (tag) => releaseGap(tagFacts(tag, { run, sh, now })) });
    } catch (e) {
      err(`release cadence: the releases cannot be read, so the lag is not measured: ${e.message}`);
      return 2;
    }
  }
  const lastTag = counted.tag;
  const result = { ...cadence({ lastTag, commits: readDatedCommits(lastTag, run), now,
    maxAgeHours }), skipped: counted.skipped };
  log(o['--json'] ? JSON.stringify(result, null, 2) : formatCadence(result));
  if (report) {
    log('  (--report: measured from the newest tag; whether it has its Release and record is '
      + 'judged on main by .github/workflows/cadence.yml, R035)');
  }
  if (o['--issue']) log(`release overdue issue: ${syncIssue({ result, sh })}`);
  return result.overdue && !report ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`release-cadence: ${e.message}`);
    process.exit(2);
  }
}
