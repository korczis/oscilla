#!/usr/bin/env node
// npm run release:publish — tag and publish a verified release candidate. DRY RUN unless --yes.
//
//   node scripts/release-publish.mjs [--yes] [--pages-timeout <minutes>]
//
// Preconditions (all checked, all reported, in both modes):
//   on branch main, clean tree, HEAD == origin/main (Pages deploys main), tag v<version>
//   absent locally and on origin, a release-gate receipt (release:prepare) matching the
//   current version, source digest, dist bytes and gate tree (every tracked file except the
//   release records; rule project.release-receipt-binds-gate), committed dist up to date
//   (npm run build:check), gh authenticated, and no pages.yml run of which no job has started
//   for STUCK_AFTER_MIN minutes (rule project.release-flow-complete): such a run holds the
//   `pages` concurrency group, so the deploy this publish waits for would never start. Whether
//   a run has started is read from its jobs (gh run view --json jobs), never from the run
//   status alone: a run reports `queued` while its deploy job has succeeded and a smoke leg
//   waits for a runner. Each stuck run is reported with its id, its commit and the
//   `git merge-base --is-ancestor` verdict against HEAD; a run list that cannot be read is a
//   blocked precondition of its own.
// With --yes:
//   git tag -a v<version> on HEAD; git push origin v<version>; wait for the Pages run of HEAD
//   to start (gh run list + gh run view; a run of which no job has started at --pages-timeout,
//   default PAGES_TIMEOUT_MIN, is diagnosed the same way, never watched forever), then gh run
//   watch;
//   node scripts/verify-deploy.mjs --commit <HEAD>; gh release create
//   with notes generated from the commits since the previous tag and the committed
//   dist/index.html attached as oscilla-v<version>.html (the artifact the release record of
//   scripts/release-record.mjs names); a SemVer prerelease (X.Y.Z-rc.N) is created with
//   --prerelease --latest=false, so GitHub never shows it as the latest release and its record
//   lands on the prerelease channel. A failure after the push stops before the GitHub Release
//   and says how to undo the tag. Both modes print the `majordomus finish` line that closes
//   the release task against the published commit (verify-deploy defaults to the worktree
//   HEAD, which is not the published commit once main has moved).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCommits, lastReleaseTag, parseCommit, readCommits } from './release-analyze.mjs';
import { PUBLIC_URL, REPO_URL, ROOT, gitRunner } from './release-metadata.mjs';
import { currentFingerprint, readReceipt, receiptProblems } from './release-prepare.mjs';
import { DIST_PATH, channelFor, releaseAssetName } from './release-record.mjs';

/**
 * The gh release create flags after the tag and the asset: a SemVer prerelease is marked
 * prerelease and never latest; a stable release keeps GitHub's default (latest by date/SemVer).
 */
export function releaseCreateFlags(version, notesFile) {
  const pre = channelFor(version) === 'prerelease' ? ['--prerelease', '--latest=false'] : [];
  return ['--verify-tag', ...pre, '--title', `OSCILLA v${version}`, '--notes-file', notesFile];
}

/** Release notes from real history (commits since the previous tag), grouped by impact. */
export function releaseNotes({ version, previousTag, commits, commit, sourceDigest,
  repoUrl = REPO_URL, publicUrl = PUBLIC_URL }) {
  const { reasons } = analyzeCommits(commits);
  const groups = { major: [], minor: [], patch: [], none: [] };
  commits.forEach((c, i) => {
    const p = parseCommit(c);
    const scope = p.scope ? `**${p.scope}:** ` : '';
    const text = p.conventional ? `${scope}${p.description}` : c.subject;
    const sha = (c.sha || '').slice(0, 7);
    const link = sha ? ` ([${sha}](${repoUrl}/commit/${c.sha}))` : '';
    const note = p.breakingNote ? ` — ${p.breakingNote}` : '';
    groups[reasons[i].level].push(`- ${text}${note}${link}`);
  });
  const section = (title, items) => (items.length ? [`### ${title}`, '', ...items, ''] : []);
  return [
    `## OSCILLA v${version}`, '',
    ...section('Breaking changes', groups.major),
    ...section('Features', groups.minor),
    ...section('Fixes', groups.patch),
    ...section('Maintenance', groups.none),
    '### Provenance', '',
    `- Commit: [${commit.slice(0, 7)}](${repoUrl}/commit/${commit})`,
    `- Source digest (sha256 of the build inputs): \`${sourceDigest}\``,
    `- Live: ${publicUrl} (verified by scripts/verify-deploy.mjs)`,
    previousTag ? `- Changes: ${repoUrl}/compare/${previousTag}...v${version}`
      : `- Changes: the full history up to v${version}`,
    '',
  ].join('\n');
}

// ------------------------------------------------------------------------------- pages runs
export const PAGES_RUN_FIELDS = 'databaseId,status,conclusion,headSha,createdAt';
export const RULE_FLOW = 'project.release-flow-complete';
/**
 * Run statuses that do not say whether the run has started: awaiting approval, a runner or
 * its turn. They do not say it has NOT started either: GitHub reports `queued` for a run whose
 * deploy job has succeeded while a later job waits for a runner (Pages run 37558326962,
 * 2026-10-07: status `queued`, deploy completed, chromium smoke completed, webkit running).
 * For these the jobs decide.
 */
export const WAITING_STATUSES = ['waiting', 'queued', 'pending', 'requested', 'action_required'];
// pages.yml is one run at a time, and the `pages` concurrency group is held for the whole run:
// the deploy job and then the three public smoke legs (each job timeout-minutes: 10, so a run
// is bounded at about 20 minutes; 27 of 30 runs took under 2, and runs 37558326962 and
// 37554348522 took 14.5 under runner congestion on 2026-10-07). A run of which no job has
// started after STUCK_AFTER_MIN minutes is therefore almost always held, not waiting for its
// turn; the exception, a run queued behind one slow healthy run, is a transient refusal of the
// dry run that clears when the run ahead finishes.
export const STUCK_AFTER_MIN = 15;
// After the tag is pushed the wait must outlast one whole run ahead in the group (about 20
// minutes by the job timeouts), or a healthy deploy behind a slow one would be given up on
// with the tag already on origin.
export const PAGES_TIMEOUT_MIN = 30;

/**
 * Pure: whether a job has run. Its status decides; `startedAt` does not, because gh reports
 * the creation time of the run there for a job that is still queued. A skipped job never ran.
 */
export const jobStarted = (j) => j.status === 'in_progress'
  || (j.status === 'completed' && j.conclusion !== 'skipped');

/**
 * Pure: whether a run has started. Outside WAITING_STATUSES it has (in_progress, completed).
 * Inside, it has when any of its jobs has; `jobs` that could not be read (not an array) count
 * as not started, so the run is reported rather than watched blind.
 */
export function runStarted(r) {
  if (!WAITING_STATUSES.includes(r.status)) return true;
  return Array.isArray(r.jobs) && r.jobs.some(jobStarted);
}

/** Pure: the runs of which no job has started for at least `afterMin` minutes at `now` (ms). */
export function stuckPagesRuns(runs, now, afterMin = STUCK_AFTER_MIN) {
  return runs.filter((r) => !runStarted(r)
    && now - Date.parse(r.createdAt) >= afterMin * 60_000);
}

/**
 * Pure: one line per stuck run, with the run id, its commit and the ancestry verdict.
 * @param {{ stuck: object[], head: string, now: number,
 *   ancestry: (sha: string) => boolean|null }} o  ancestry: null when git cannot tell
 */
export function diagnoseStuckRuns({ stuck, head, now, ancestry }) {
  return stuck.map((r) => {
    const sha = r.headSha || '';
    const minutes = Math.round((now - Date.parse(r.createdAt)) / 60_000);
    const is = sha === head ? true : ancestry(sha);
    const verdict = is === null ? 'unknown (the commit is not in this clone: git fetch)'
      : is ? 'yes' : 'no';
    let meaning = 'fetch, then re-run to see whether it precedes HEAD';
    if (sha === head) meaning = 'this is the deploy of HEAD and none of its jobs has started';
    else if (is) {
      meaning = 'an older deploy holds the pages concurrency group; the deploy of HEAD waits '
        + 'behind it';
    } else if (is === false) meaning = 'the run is for a commit that is not in the history of HEAD';
    const jobs = Array.isArray(r.jobs) ? 'no job started' : 'its jobs could not be read';
    return `Pages run ${r.databaseId} for ${sha} has been '${r.status}' with ${jobs} for `
      + `${minutes} min; `
      + `git merge-base --is-ancestor ${sha.slice(0, 7)} ${head.slice(0, 7)}: ${verdict} `
      + `(${meaning}). Inspect: gh run view ${r.databaseId} (rule ${RULE_FLOW})`;
  });
}

/** The line that closes the release task against the published commit. */
export function finishLine(tag, commit) {
  return `majordomus finish --outcome completed --note "published ${tag}" `
    + `--verify-command "npm run release:verify-deploy -- --commit ${commit}"`;
}

/** Pure precondition check over gathered facts. */
export function preconditionProblems(f) {
  const problems = [];
  if (f.branch !== 'main') problems.push(`on branch ${f.branch}, releases are cut from main`);
  if (f.dirty) problems.push('working tree is not clean');
  if (f.originMain && f.head !== f.originMain) {
    problems.push(`HEAD ${f.head.slice(0, 7)} != origin/main ${f.originMain.slice(0, 7)} `
      + '(push/merge first: Pages deploys main)');
  }
  if (!f.originMain) problems.push('could not read origin/main');
  if (f.tagLocal) problems.push(`tag ${f.tag} already exists locally`);
  if (f.tagRemote) problems.push(`tag ${f.tag} already exists on origin`);
  problems.push(...f.receiptProblems);
  if (!f.buildCheck) problems.push('npm run build:check failed: dist/index.html is stale');
  if (!f.ghAuth) problems.push('gh is not authenticated (gh auth status)');
  problems.push(...(f.stuckRuns || []));
  return problems;
}

function defaultSh(root) {
  return (cmd, args, { inherit = false } = {}) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8',
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    return { status: r.error ? 127 : r.status, stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || (r.error ? r.error.message : '')).trim() };
  };
}

/**
 * @param {{ argv?: string[], root?: string, run?: Function, sh?: Function, log?: Function,
 *   receipt?: object|null, fingerprint?: object, sleep?: Function, clock?: () => number }} [o]
 * @returns {Promise<number>} exit code
 */
export async function publish({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), sh = defaultSh(root),
  log = console.log, receipt, fingerprint, sleep = (s) => new Promise((r) => {
    setTimeout(r, s * 1000);
  }), clock = Date.now,
} = {}) {
  const yes = argv.includes('--yes');
  const ti = argv.indexOf('--pages-timeout');
  const pagesTimeoutMin = ti >= 0 ? Number(argv[ti + 1]) : PAGES_TIMEOUT_MIN;
  const now = fingerprint || currentFingerprint(root, run);
  const version = now.version;
  const tag = `v${version}`;
  const asset = releaseAssetName(version);
  const head = run(['rev-parse', 'HEAD']);
  const remoteMain = sh('git', ['ls-remote', 'origin', 'refs/heads/main']);
  const remoteTag = sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  // null when the list cannot be read: an unreadable list is not an empty one.
  const listRuns = (extra) => {
    const r = sh('gh', ['run', 'list', '--workflow', 'pages.yml', ...extra, '--json',
      PAGES_RUN_FIELDS]);
    if (r.status !== 0) return null;
    try {
      const runs = JSON.parse(r.stdout || '[]');
      return Array.isArray(runs) ? runs : null;
    } catch {
      return null;
    }
  };
  // The jobs of every run whose status alone does not say whether it started (null: unread).
  const withJobs = (runs) => runs.map((r) => {
    if (!WAITING_STATUSES.includes(r.status)) return r;
    const v = sh('gh', ['run', 'view', String(r.databaseId), '--json', 'jobs']);
    let jobs = null;
    try {
      const parsed = v.status === 0 ? JSON.parse(v.stdout || '{}').jobs : null;
      jobs = Array.isArray(parsed) ? parsed : null;
    } catch { /* unread */ }
    return { ...r, jobs };
  });
  const ancestry = (sha) => {
    const { status } = sh('git', ['merge-base', '--is-ancestor', sha, head]);
    return status === 0 ? true : status === 1 ? false : null;
  };
  const diagnose = (afterMin) => {
    const runs = listRuns(['--limit', '20']);
    if (!runs) {
      return ['could not list the pages.yml runs (gh run list --workflow pages.yml): whether a '
        + `deploy is stuck cannot be checked (rule ${RULE_FLOW})`];
    }
    const aged = runs.filter((r) => clock() - Date.parse(r.createdAt) >= afterMin * 60_000);
    return diagnoseStuckRuns({ head, now: clock(), ancestry,
      stuck: stuckPagesRuns(withJobs(aged), clock(), afterMin) });
  };
  const facts = {
    tag, head,
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: run(['status', '--porcelain', '--untracked-files=normal']) !== '',
    originMain: remoteMain.status === 0 ? (remoteMain.stdout.split(/\s/)[0] || null) : null,
    tagLocal: sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0,
    tagRemote: remoteTag.status === 0 && remoteTag.stdout !== '',
    receiptProblems: receiptProblems(receipt === undefined ? readReceipt(run, root) : receipt, now),
    buildCheck: sh('npm', ['run', '--silent', 'build:check']).status === 0,
    ghAuth: sh('gh', ['auth', 'status']).status === 0,
    stuckRuns: diagnose(STUCK_AFTER_MIN),
  };
  const previousTag = lastReleaseTag(run);
  const commits = readCommits(previousTag, run);
  const notes = releaseNotes({ version, previousTag, commits, commit: head,
    sourceDigest: now.sourceDigest });
  const problems = preconditionProblems(facts);

  log(`release:publish ${tag} at ${head} (${yes ? 'LIVE' : 'dry run; pass --yes to act'})`);
  log(`previous tag: ${previousTag || '(none)'}; ${commits.length} commit(s) in the notes`);
  for (const p of problems) log(`  BLOCKED ${p}`);
  if (!problems.length) log('  OK all preconditions hold');
  const steps = [
    ['git', ['tag', '-a', tag, '-m', `OSCILLA ${tag}`, head]],
    ['git', ['push', 'origin', `refs/tags/${tag}`]],
    ['gh', ['run', 'list', '--workflow', 'pages.yml', '--commit', head, '--limit', '1', '--json',
      PAGES_RUN_FIELDS], '(poll, with gh run view <id> --json jobs, until one of its jobs has '
      + 'started; then gh run watch --exit-status)'],
    ['node', ['scripts/verify-deploy.mjs', '--commit', head]],
    ['gh', ['release', 'create', tag, asset, ...releaseCreateFlags(version, '<generated notes>')],
      `(${asset} = the committed ${DIST_PATH})`],
  ];
  if (!yes) {
    log('\nWould run:');
    for (const [cmd, args, note] of steps) {
      log(`  ${cmd} ${args.join(' ')}${note ? ` ${note}` : ''}`);
    }
    log(`\nThen close the release task against the published commit:\n  ${finishLine(tag, head)}`);
    log(`\nRelease notes:\n${notes}`);
    return problems.length ? 1 : 0;
  }
  if (problems.length) {
    log('\nrelease:publish refused: preconditions do not hold. Nothing was tagged or pushed.');
    return 1;
  }

  const must = (cmd, args, what) => {
    const r = sh(cmd, args, { inherit: true });
    if (r.status !== 0) throw new Error(`${what} failed (${cmd} ${args.join(' ')})`);
    return r;
  };
  let pushed = false;
  try {
    must('git', ['tag', '-a', tag, '-m', `OSCILLA ${tag}`, head], 'tagging');
    must('git', ['push', 'origin', `refs/tags/${tag}`], 'pushing the tag');
    pushed = true;
    // Wait for the Pages run of HEAD to START: for one of its jobs to have run. A run of
    // which no job has started is not watched: `gh run watch` has no timeout, and a run
    // awaiting approval or held behind another run would hold this publish for as long as it
    // sits there. A run whose deploy job is under way or done is watched whatever the run
    // status says, so a slow but healthy run (smoke legs waiting for a runner) is waited for.
    let runId = null;
    let seen = null;
    const deadline = clock() + pagesTimeoutMin * 60_000;
    while (!runId && clock() < deadline) {
      const [first] = withJobs(listRuns(['--commit', head, '--limit', '1']) || []);
      seen = first || seen;
      if (first && runStarted(first)) runId = String(first.databaseId);
      else await sleep(15);
    }
    if (!runId) {
      for (const line of diagnose(0)) log(`  STUCK ${line}`);
      throw new Error(seen
        ? `Pages run ${seen.databaseId} for ${head} is still '${seen.status}' with no job `
          + `started after ${pagesTimeoutMin} min`
        : `no Pages run for ${head} within ${pagesTimeoutMin} min`);
    }
    must('gh', ['run', 'watch', runId, '--exit-status'], `Pages run ${runId}`);
    must('node', ['scripts/verify-deploy.mjs', '--commit', head], 'deployment verification');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-release-'));
    const notesFile = path.join(dir, 'notes.md');
    writeFileSync(notesFile, notes);
    // The clean tree and build:check above make the working-tree dist the committed one.
    const assetFile = path.join(dir, asset);
    writeFileSync(assetFile, readFileSync(path.join(root, DIST_PATH)));
    must('gh', ['release', 'create', tag, assetFile, ...releaseCreateFlags(version, notesFile)],
      'creating the GitHub Release');
  } catch (e) {
    log(`\nRELEASE:PUBLISH FAILED: ${e.message}`);
    if (pushed) {
      log(`The tag ${tag} is on origin but no GitHub Release was created. Fix and re-run the `
        + `failed step, or undo with: git push origin :refs/tags/${tag} && git tag -d ${tag}`);
      log(`Once the page is live, prove it with: npm run release:verify-deploy -- --commit ${head}`);
    }
    return 1;
  }
  log(`\nPublished ${tag}: ${REPO_URL}/releases/tag/${tag}`);
  log(`Record it: npm run release:record -- --version ${version}, then land the record by PR `
    + `(branch chore/release-record-${tag}); release:prepare refuses the next release without it.`);
  log(`Close the release task against the published commit, not the worktree HEAD:\n  `
    + `${finishLine(tag, head)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish().then((code) => process.exit(code), (e) => {
    console.error(`release:publish: ${e.message}`);
    process.exit(1);
  });
}
