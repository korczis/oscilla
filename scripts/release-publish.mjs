#!/usr/bin/env node
// npm run release:publish — tag and publish a verified release candidate. DRY RUN unless --yes.
//
//   node scripts/release-publish.mjs [--yes] [--pages-timeout <minutes>] [--help]
//
// The arguments are parsed against that list first (parseFlags of release-analyze.mjs):
// --help / -h prints the usage and exits 0; an unknown flag, a flag missing its value or a
// --pages-timeout that is not a positive number exits 2, before any git, gh or npm call.
// Preconditions (all checked, all reported, in both modes):
//   on branch main, clean tree, HEAD == origin/main (Pages deploys main), tag v<version>
//   absent locally and on origin (or, to resume, present on origin at HEAD; below), a
//   release-gate receipt (release:prepare) matching the
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
//   watch; then redeploy Pages so the page of the release commit names its tag (the deploy
//   of the merge stamped it `untagged`, before the tag existed; ADR 0059): gh workflow run
//   pages.yml --ref main, and wait, under the same --pages-timeout, for that dispatched run
//   (a workflow_dispatch run of HEAD that was not listed before the dispatch) to complete
//   with success, polling gh run list, never watching it; a run that has not completed by
//   then fails the publish with its id and state, before any GitHub Release;
//   node scripts/verify-deploy.mjs --commit <HEAD>, and the live metadata region must say
//   release `tagged` for HEAD (verify-deploy alone also accepts the untagged page of the
//   release commit); gh release create
//   with notes generated from the commits since the previous tag and the committed
//   dist/index.html attached as oscilla-v<version>.html (the artifact the release record of
//   scripts/release-record.mjs names); a SemVer prerelease (X.Y.Z-rc.N) is created with
//   --prerelease --latest=false, so GitHub never shows it as the latest release and its record
//   lands on the prerelease channel. A failure after the push stops before the GitHub Release
//   and says how to undo the tag. Both modes print the `majordomus finish` line that closes
//   the release task against the published commit (verify-deploy defaults to the worktree
//   HEAD, which is not the published commit once main has moved).
// Resume (R021): when the tag is already on origin at HEAD (and a local tag, if any, too), an
// earlier publish was interrupted after the push. The run skips the tag, the push and the wait
// for the merge's deploy; it redeploys unless the live page already says tagged for HEAD,
// adopting a dispatched run of HEAD that is still waiting instead of dispatching another, then
// verifies and creates the Release. A tag at another commit, or a Release that already
// exists, refuses.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeCommits, lastReleaseTag, parseCommit, parseFlags, readCommits,
} from './release-analyze.mjs';
import { PUBLIC_URL, REPO_URL, ROOT, findRegion, gitRunner } from './release-metadata.mjs';
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

// The redeploy after the tag: pages.yml dispatched for main, found by its event and commit.
export const DISPATCH_ARGS = ['workflow', 'run', 'pages.yml', '--ref', 'main'];
export const dispatchedListArgs = (head) => ['--event', 'workflow_dispatch', '--commit', head,
  '--limit', '5'];
// Reads of the live page after verify-deploy passed, 10 s apart: a CDN edge that still serves
// the previous stamp gets that long to catch up, and no longer.
export const TAGGED_ATTEMPTS = 3;

/**
 * Pure: why the live page does not name the tag of `commit` (null when its metadata region
 * says release `tagged` for that commit).
 */
export function taggedPageProblem(html, commit) {
  let record;
  try {
    ({ record } = findRegion(html));
  } catch (e) {
    return `the live page has no readable metadata region: ${e.message}`;
  }
  if (record.commit === commit && record.release === 'tagged') return null;
  return `the live page says release '${record.release}' for ${record.commit}, expected `
    + `'tagged' for ${commit}`;
}

async function defaultFetchPage(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow',
    signal: AbortSignal.timeout(30_000) });
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}

/** The line that closes the release task against the published commit. */
export function finishLine(tag, commit) {
  return `majordomus finish --outcome completed --note "published ${tag}" `
    + `--verify-command "npm run release:verify-deploy -- --commit ${commit}"`;
}

/**
 * The commit a tag names in `git ls-remote --tags origin refs/tags/<tag> refs/tags/<tag>^{}`
 * output: the peeled line of an annotated tag, else the tag's own line; null when absent.
 */
export function remoteTagCommit(stdout, tag) {
  let plain = null;
  let peeled = null;
  for (const line of String(stdout || '').split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === `refs/tags/${tag}^{}`) peeled = sha;
    else if (ref === `refs/tags/${tag}`) plain = sha;
  }
  return peeled || plain;
}

/**
 * R021: a publish interrupted after its tag reached origin resumes when that tag names HEAD
 * (and a local tag, if any, does too): the tag and push are done, the rest is not.
 */
export function resumable(f) {
  return !!f.tagRemote && f.tagRemoteCommit === f.head
    && (!f.tagLocal || f.tagLocalCommit === f.head);
}

/** Pure precondition check over gathered facts. */
export function preconditionProblems(f) {
  const problems = [];
  const short = (sha) => String(sha || 'an unreadable commit').slice(0, 7);
  const resume = resumable(f);
  if (f.branch !== 'main') problems.push(`on branch ${f.branch}, releases are cut from main`);
  if (f.dirty) problems.push('working tree is not clean');
  if (f.originMain && f.head !== f.originMain) {
    problems.push(`HEAD ${f.head.slice(0, 7)} != origin/main ${f.originMain.slice(0, 7)} `
      + '(push/merge first: Pages deploys main)');
  }
  if (!f.originMain) problems.push('could not read origin/main');
  if (f.tagLocal && !resume) {
    problems.push(`tag ${f.tag} already exists locally`
      + (f.tagLocalCommit ? ` at ${short(f.tagLocalCommit)}, not HEAD ${short(f.head)}` : ''));
  }
  if (f.tagRemote && !resume) {
    problems.push(`tag ${f.tag} already exists on origin at ${short(f.tagRemoteCommit)}, `
      + `not HEAD ${short(f.head)}`);
  }
  if (resume && f.releaseExists) {
    problems.push(`the GitHub Release ${f.tag} already exists: nothing to publish`);
  }
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

export const USAGE = 'usage: node scripts/release-publish.mjs [--yes] '
  + '[--pages-timeout <minutes>] [--help]';
const FLAGS = { '--yes': 'boolean', '--pages-timeout': 'value' };

/**
 * @param {{ argv?: string[], root?: string, run?: Function, sh?: Function, log?: Function,
 *   receipt?: object|null, fingerprint?: object, sleep?: Function, clock?: () => number,
 *   fetchPage?: (url: string) => Promise<string> }} [o]  fetchPage: the live page's text
 * @returns {Promise<number>} exit code
 */
export async function publish({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), sh = defaultSh(root),
  log = console.log, receipt, fingerprint, sleep = (s) => new Promise((r) => {
    setTimeout(r, s * 1000);
  }), clock = Date.now, fetchPage = defaultFetchPage,
} = {}) {
  let o;
  try {
    o = parseFlags(argv, FLAGS, USAGE);
  } catch (e) {
    log(`release:publish: ${e.message}`);
    return e.exitCode;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const yes = !!o['--yes'];
  const pagesTimeoutMin = '--pages-timeout' in o ? Number(o['--pages-timeout'])
    : PAGES_TIMEOUT_MIN;
  if (!Number.isFinite(pagesTimeoutMin) || pagesTimeoutMin <= 0) {
    log(`release:publish: --pages-timeout needs a positive number of minutes\n${USAGE}`);
    return 2;
  }
  const now = fingerprint || currentFingerprint(root, run);
  const version = now.version;
  const tag = `v${version}`;
  const asset = releaseAssetName(version);
  const head = run(['rev-parse', 'HEAD']);
  const remoteMain = sh('git', ['ls-remote', 'origin', 'refs/heads/main']);
  const remoteTag = sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`]);
  const localTag = sh('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
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
    tagLocal: localTag.status === 0,
    tagLocalCommit: localTag.status === 0 ? localTag.stdout || null : null,
    tagRemote: remoteTag.status === 0 && remoteTag.stdout !== '',
    tagRemoteCommit: remoteTag.status === 0 ? remoteTagCommit(remoteTag.stdout, tag) : null,
    receiptProblems: receiptProblems(receipt === undefined ? readReceipt(run, root) : receipt, now),
    buildCheck: sh('npm', ['run', '--silent', 'build:check']).status === 0,
    ghAuth: sh('gh', ['auth', 'status']).status === 0,
    stuckRuns: diagnose(STUCK_AFTER_MIN),
  };
  const resume = resumable(facts);
  // Only a resumed publish can find its Release already made; asked only then.
  facts.releaseExists = resume && sh('gh', ['release', 'view', tag, '--json', 'tagName'])
    .status === 0;
  const previousTag = lastReleaseTag(run);
  const commits = readCommits(previousTag, run);
  const notes = releaseNotes({ version, previousTag, commits, commit: head,
    sourceDigest: now.sourceDigest });
  const problems = preconditionProblems(facts);

  log(`release:publish ${tag} at ${head} (${yes ? 'LIVE' : 'dry run; pass --yes to act'})`);
  log(`previous tag: ${previousTag || '(none)'}; ${commits.length} commit(s) in the notes`);
  for (const p of problems) log(`  BLOCKED ${p}`);
  if (!problems.length) log('  OK all preconditions hold');
  if (resume) {
    log(`  RESUME ${tag} is on origin at ${head.slice(0, 7)}: the tag, its push and the deploy `
      + 'of the merge are done; this run continues with the redeploy, verify-deploy and the '
      + 'GitHub Release (R021)');
  }
  const allSteps = [
    ['git', ['tag', '-a', tag, '-m', `OSCILLA ${tag}`, head]],
    ['git', ['push', 'origin', `refs/tags/${tag}`]],
    ['gh', ['run', 'list', '--workflow', 'pages.yml', '--commit', head, '--limit', '1', '--json',
      PAGES_RUN_FIELDS], '(poll, with gh run view <id> --json jobs, until one of its jobs has '
      + 'started; then gh run watch --exit-status)'],
    ['gh', DISPATCH_ARGS, '(redeploy: the page of the release commit is re-stamped with its '
      + 'tag)'],
    ['gh', ['run', 'list', '--workflow', 'pages.yml', ...dispatchedListArgs(head), '--json',
      PAGES_RUN_FIELDS], `(poll the dispatched run until it has completed with success, at most `
      + `${pagesTimeoutMin} min)`],
    ['node', ['scripts/verify-deploy.mjs', '--commit', head],
      '(then the live page must say release tagged)'],
    ['gh', ['release', 'create', tag, asset, ...releaseCreateFlags(version, '<generated notes>')],
      `(${asset} = the committed ${DIST_PATH})`],
  ];
  // Resuming skips the tag, its push and the wait for the merge's deploy.
  const steps = resume ? allSteps.slice(3) : allSteps;
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
  let pushed = resume;
  try {
    if (!resume) {
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
    }
    // A resumed publish whose live page already says tagged for HEAD needs no redeploy.
    let redeployed = false;
    if (resume) {
      try {
        redeployed = taggedPageProblem(await fetchPage(`${PUBLIC_URL}?oscilla-publish=`
          + `${head.slice(0, 12)}.0`), head) === null;
      } catch { /* unread: redeploy */ }
      if (redeployed) {
        log(`  the live page already says ${tag} tagged for ${head.slice(0, 7)}`);
      }
    }
    if (!redeployed) {
      // That run stamped the release commit `untagged`: it deployed before the tag existed.
      // Redeploy main, now tagged, and wait for that run to finish under the same bound. It is
      // polled, not watched (gh run watch has no timeout), and told from earlier dispatches of
      // the same commit by the runs listed before the dispatch.
      const dispatchList = dispatchedListArgs(head);
      const before = listRuns(dispatchList);
      if (!before) {
        throw new Error('could not list the dispatched pages.yml runs (gh run list --workflow '
          + `pages.yml ${dispatchList.join(' ')}), so the redeploy could not be told apart`);
      }
      // R021: a dispatched run of HEAD that an interrupted publish left waiting is adopted, not
      // dispatched a second time behind it.
      const waiting = resume ? before.find((r) => r.status !== 'completed') : null;
      const earlier = new Set(before.filter((r) => r !== waiting).map((r) => r.databaseId));
      if (waiting) {
        log(`  adopting the dispatched Pages run ${waiting.databaseId} ('${waiting.status}') `
          + 'left by the interrupted publish');
      } else {
        must('gh', DISPATCH_ARGS, 'dispatching the Pages redeploy');
      }
      let redeploy = null;
      const redeployDeadline = clock() + pagesTimeoutMin * 60_000;
      while (clock() < redeployDeadline) {
        const fresh = (listRuns(dispatchList) || []).find((r) => !earlier.has(r.databaseId));
        redeploy = fresh || redeploy;
        if (redeploy && redeploy.status === 'completed') break;
        await sleep(15);
      }
      if (!redeploy) {
        throw new Error(`no dispatched Pages run for ${head} appeared within ${pagesTimeoutMin} `
          + `min (gh ${DISPATCH_ARGS.join(' ')})`);
      }
      if (redeploy.status !== 'completed') {
        throw new Error(`dispatched Pages run ${redeploy.databaseId} for ${head} is still `
          + `'${redeploy.status}' after ${pagesTimeoutMin} min. Inspect: gh run view `
          + `${redeploy.databaseId}`);
      }
      if (redeploy.conclusion !== 'success') {
        throw new Error(`dispatched Pages run ${redeploy.databaseId} for ${head} completed `
          + `'${redeploy.conclusion}'. Inspect: gh run view ${redeploy.databaseId}`);
      }
    }
    must('node', ['scripts/verify-deploy.mjs', '--commit', head], 'deployment verification');
    let tagged = 'not read';
    for (let n = 1; n <= TAGGED_ATTEMPTS; n++) {
      try {
        tagged = taggedPageProblem(await fetchPage(`${PUBLIC_URL}?oscilla-publish=`
          + `${head.slice(0, 12)}.${n}`), head);
      } catch (e) {
        tagged = `the live page could not be read: ${e.message}`;
      }
      if (tagged === null) break;
      if (n < TAGGED_ATTEMPTS) await sleep(10);
    }
    if (tagged !== null) throw new Error(`after the redeploy of ${tag}, ${tagged}`);
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
      log(`The tag ${tag} is on origin but no GitHub Release was created. Fix the cause and `
        + 're-run npm run release:publish -- --yes, which resumes after the tag (R021), or undo '
        + `with: git push origin :refs/tags/${tag} && git tag -d ${tag}`);
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
