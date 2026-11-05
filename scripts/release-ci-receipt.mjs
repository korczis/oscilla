// The CI receipt (ADR 0082, rule project.release-receipt-binds-gate v3): the release pull
// request's own CI run stands in for the local release gate. CI runs every suite of
// `npm run release-gate` (ci.yml: every browser, file:// and /oscilla/, CI's strict skips, the
// visual gate, the .ai doctor) on refs/pull/<n>/merge, so its verdict is the gate's verdict on
// exactly one tree. release:publish accepts it for main's HEAD only when
//   - HEAD is the merge commit of a pull request (parents: base B, pull request head H);
//   - exactly one pull request has H as its head, it is based on main and its merge commit is
//     HEAD; the run judged ran for its head branch (review F1 of #389: CI runs for pull
//     requests into any branch, so a second pull request from the same head must not stand in);
//   - the tree of HEAD is the tree of H, and B is an ancestor of H: H contained every base
//     the CI run could have merged it with (the base only moves forward), so the merge CI
//     tested has H's tree, which is HEAD's tree;
//   - one CI run judged the tree that landed, its newest attempt completed with success:
//       pull_request  the newest run of event pull_request on H from its head branch (CI tested
//                     refs/pull/<n>/merge, whose tree is H's by the two facts above); or
//       merge_group   (ADR 0083, review of af) the newest run of event merge_group whose head is
//                     HEAD itself, the queue's merge commit that main fast-forwarded to, from
//                     the queue ref gh-readonly-queue/main/pr-<N>-... of that same pull request N;
//                     a queue group of more than one pull request fails the base-in-head fact,
//                     since HEAD^1 is then another pull request's queue commit;
//     an older green run, or a run whose latest attempt is red, does not count;
//   - every job ci.yml declares (a matrix job once per value) is in that run's latest jobs, on
//     the run's head, and succeeded: a missing, skipped or cancelled job, or a job no ci.yml
//     declares, refuses (a path-gated job skipped for a non-runtime change too: a release
//     changes package.json, so its run skips none). One exemption, on either event: the job
//     with id flake-ledger whose `if:` is exactly RERUN_ONLY_IF (E010) may be
//     `completed`/`skipped` on its own first attempt, and must succeed from attempt 2; ci.yml
//     must declare exactly one such job and no two jobs may share a name;
//   - the committed roadmap matches the plan (tests/unit/about-current.test.mjs with
//     OSC_ROADMAP_CHECK=1, the one check the local gate ran that CI does not).
// Each fact that cannot be read is a problem of its own, never an empty answer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml-subset.mjs';

export const CI_WORKFLOW = '.github/workflows/ci.yml';
export const REPO_SLUG = 'korczis/oscilla';
export const ROADMAP_CHECK = ['node', ['--test', 'tests/unit/about-current.test.mjs']];
export const TRUNK = 'main';
/** Each GitHub read is bounded and tried twice (review F3 of #389): a hang refuses, never waits. */
export const GH_TIMEOUT_MS = 60_000;
export const GH_ATTEMPTS = 2;
/**
 * The condition of a job that runs only on a re-run (E010's flake ledger). On a run's first
 * attempt such a job is skipped by design, so the receipt accepts that skip there and only
 * there; from the second attempt on it must succeed like every other job.
 */
export const RERUN_ONLY_IF = '${{ always() && fromJSON(github.run_attempt) > 1 }}';
/** The id of the one job that may carry RERUN_ONLY_IF (E010's flake ledger). */
export const RERUN_ONLY_JOB = 'flake-ledger';

/** The job names a run of the workflow text shows, a matrix job once per value of its one key. */
export function expectedJobs(ciText) {
  let doc;
  try {
    doc = parseYaml(ciText);
  } catch (e) {
    return { name: null, jobs: [], problems: [`${CI_WORKFLOW} does not parse: ${e.message}`] };
  }
  const jobs = [];
  const rerunOnly = [];
  const problems = [];
  for (const [id, job] of Object.entries(doc?.jobs || {})) {
    const name = typeof job.name === 'string' ? job.name : id;
    const matrix = job.strategy?.matrix;
    if (!matrix) {
      jobs.push(name);
      if (job.if === RERUN_ONLY_IF) rerunOnly.push({ id, name });
      continue;
    }
    const keys = Object.keys(matrix);
    if (keys.length !== 1 || !Array.isArray(matrix[keys[0]])) {
      problems.push(`${CI_WORKFLOW} job ${id}: a matrix other than one list cannot be expanded `
        + 'into job names');
      continue;
    }
    const key = keys[0];
    const slot = new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g');
    for (const v of matrix[key]) jobs.push(name.replace(slot, String(v)));
  }
  if (!jobs.length) problems.push(`${CI_WORKFLOW} declares no jobs`);
  const seen = new Set();
  for (const n of jobs) {
    if (seen.has(n)) problems.push(`${CI_WORKFLOW} declares two jobs named "${n}"`);
    seen.add(n);
  }
  // The exemption is keyed by the job id, not its display name (review R4 of #417): exactly one
  // re-run-only job, and it is E010's flake ledger.
  if (jobs.length && (rerunOnly.length !== 1 || rerunOnly[0].id !== RERUN_ONLY_JOB)) {
    problems.push(`${CI_WORKFLOW} must declare exactly one re-run-only job, id ${RERUN_ONLY_JOB} `
      + `(found: ${rerunOnly.map((j) => j.id).join(', ') || 'none'})`);
  }
  return { name: typeof doc?.name === 'string' ? doc.name : null, jobs,
    rerunOnly: rerunOnly.length === 1 && rerunOnly[0].id === RERUN_ONLY_JOB ? [rerunOnly[0].name] : [],
    problems };
}

/**
 * Pure judgement of the gathered facts (empty = the CI receipt verifies).
 * @param {{ head: string, parents: string[]|null, headTree: string|null, prTree: string|null,
 *   baseInPr: boolean|null, workflow: { name: string|null, jobs: string[], problems: string[] },
 *   pulls: object[]|null, runs: object[]|null, jobs: object[]|null, roadmap: boolean }} f
 */
export function ciReceiptProblems(f) {
  const problems = [...(f.workflow?.problems || [])];
  const short = (s) => String(s || '?').slice(0, 7);
  if (!Array.isArray(f.parents) || f.parents.length !== 2) {
    return [...problems, `HEAD ${short(f.head)} is not the merge commit of a pull request `
      + `(${Array.isArray(f.parents) ? f.parents.length : 'unread'} parent(s)): the CI receipt `
      + 'judges the merge of the release pull request'];
  }
  const [base, pr] = f.parents;
  if (!f.headTree || !f.prTree) problems.push('the trees of HEAD and of its pull request head '
    + `${short(pr)} could not be read`);
  else if (f.headTree !== f.prTree) {
    problems.push(`the tree of HEAD ${short(f.headTree)} != the tree of the pull request head `
      + `${short(pr)} (${short(f.prTree)}): main holds more than CI tested`);
  }
  if (f.baseInPr !== true) {
    problems.push(`the pull request head ${short(pr)} does not contain the base ${short(base)} `
      + `it merged into${f.baseInPr === null ? ' (unread)' : ''}: CI tested it merged with an `
      + 'older base');
  }
  if (!f.workflow?.name) problems.push(`${CI_WORKFLOW} has no workflow name to find its runs by`);
  const pulls = Array.isArray(f.pulls) ? f.pulls.filter((p) => p?.head?.sha === pr) : null;
  let branch = null;
  if (!pulls) problems.push(`the pull requests of ${short(pr)} could not be read`);
  else if (pulls.length !== 1) {
    problems.push(`${pulls.length} pull requests have the head ${short(pr)} `
      + `(${pulls.map((p) => `#${p.number}`).join(', ') || 'none'}): the run cannot be bound `
      + 'to one');
  } else {
    const [p] = pulls;
    branch = p.head.ref;
    if (p.base?.ref !== TRUNK) {
      problems.push(`#${p.number} is based on ${p.base?.ref}, not ${TRUNK}`);
    }
    if (p.merge_commit_sha !== f.head) {
      problems.push(`#${p.number} merged as ${short(p.merge_commit_sha)}, not as HEAD `
        + `${short(f.head)}`);
    }
  }
  if (!f.roadmap) {
    problems.push('the committed roadmap does not match the plan (OSC_ROADMAP_CHECK=1 node '
      + '--test tests/unit/about-current.test.mjs)');
  }
  // One of the two runs must verify (ADR 0083): the pull request's own, or its merge-queue run.
  const viaPr = runProblems(f, 'pull_request', f.runs, f.jobs);
  if (!viaPr.length) return problems;
  if (f.queueRuns === undefined) return [...problems, ...viaPr];
  const viaQueue = runProblems(f, 'merge_group', f.queueRuns, f.queueJobs);
  if (!viaQueue.length) return problems;
  return [...problems, ...viaPr.map((p) => `pull_request: ${p}`),
    ...viaQueue.map((p) => `merge_group: ${p}`)];
}

/** The pull request HEAD merges, when exactly one has its head. */
function pullOf(f) {
  const pr = f.parents?.[1];
  const pulls = Array.isArray(f.pulls) ? f.pulls.filter((p) => p?.head?.sha === pr) : [];
  return pulls.length === 1 ? pulls[0] : null;
}

/** The runs of `event` that may judge HEAD, newest first. */
function candidateRuns(f, event, runs) {
  const pr = f.parents?.[1];
  const pull = pullOf(f);
  const queueRef = pull ? new RegExp(`^gh-readonly-queue/${TRUNK}/pr-${pull.number}-[0-9a-f]+$`)
    : null;
  return (runs || []).filter((r) => r.name === f.workflow?.name && r.event === event
    && (event === 'pull_request'
      ? r.head_sha === pr && (pull === null || r.head_branch === pull.head.ref)
      : r.head_sha === f.head && queueRef !== null && queueRef.test(String(r.head_branch))))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
}

/** What keeps the newest run of `event` from standing for HEAD's tree ([] = it does). */
function runProblems(f, event, allRuns, allJobs) {
  const short = (s) => String(s || '?').slice(0, 7);
  const pr = f.parents?.[1];
  const sha = event === 'pull_request' ? pr : f.head;
  if (!Array.isArray(allRuns)) return [`the ${event} runs of ${short(sha)} could not be read`];
  const runs = candidateRuns(f, event, allRuns);
  if (!runs.length) {
    const pull = pullOf(f);
    return [`no ${f.workflow?.name} ${event} run on ${short(sha)}`
      + (event === 'pull_request' && pull ? ` from ${pull.head.ref}` : '')
      + (event === 'merge_group' && pull ? ` from gh-readonly-queue/${TRUNK}/pr-${pull.number}-`
        : '')];
  }
  const problems = [];
  const newest = runs[0];
  if (newest.status !== 'completed' || newest.conclusion !== 'success') {
    problems.push(`the newest ${f.workflow.name} run ${newest.id} on ${short(sha)} (attempt `
      + `${newest.run_attempt}) is ${newest.status}/${newest.conclusion}`);
  }
  if (!Array.isArray(allJobs)) {
    return [...problems, `the jobs of run ${newest.id} could not be read`];
  }
  const byName = new Map(allJobs.map((j) => [j.name, j]));
  for (const name of f.workflow.jobs) {
    const j = byName.get(name);
    if (!j) problems.push(`run ${newest.id} has no job "${name}" (${CI_WORKFLOW} declares it)`);
    else if (j.run_id !== newest.id || j.head_sha !== sha) {
      problems.push(`job "${name}" ran on ${short(j.head_sha)} in run ${j.run_id}, not on `
        + `${short(sha)} in run ${newest.id}`);
    } else if (j.status === 'completed' && j.conclusion === 'skipped'
      && (f.workflow.rerunOnly || []).includes(name)
      && Number(j.run_attempt ?? newest.run_attempt) === 1) {
      // a re-run-only job is skipped on a first attempt by its own condition (E010)
    } else if (j.status !== 'completed' || j.conclusion !== 'success') {
      problems.push(`job "${name}" of run ${newest.id} is ${j.status}/${j.conclusion}`);
    }
  }
  for (const j of allJobs) {
    if (!f.workflow.jobs.includes(j.name)) {
      problems.push(`run ${newest.id} has a job "${j.name}" that ${CI_WORKFLOW} does not declare`);
    }
  }
  return problems;
}

/** The run judged, for the log line of a verified receipt: the pull request's, else the queue's. */
export function judgedRun(f) {
  if (!runProblems(f, 'pull_request', f.runs, f.jobs).length) {
    return candidateRuns(f, 'pull_request', f.runs)[0] || null;
  }
  return candidateRuns(f, 'merge_group', f.queueRuns)[0]
    || candidateRuns(f, 'pull_request', f.runs)[0] || null;
}

const json = (r) => {
  if (!r || r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || 'null');
  } catch {
    return null;
  }
};

/** A bounded GitHub read, tried GH_ATTEMPTS times; null when no attempt answered with JSON. */
function ghJson(sh, path) {
  for (let i = 0; i < GH_ATTEMPTS; i += 1) {
    const v = json(sh('gh', ['api', path], { timeout: GH_TIMEOUT_MS }));
    if (v !== null) return v;
  }
  return null;
}

/** Gather the facts through `sh` (cmd, args, opts) => { status, stdout }. */
export function gatherCiReceipt({ sh, root, head }) {
  const line = sh('git', ['rev-list', '--parents', '-n', '1', head]);
  const parents = line.status === 0 && line.stdout ? line.stdout.split(/\s+/).slice(1) : null;
  const tree = (sha) => {
    const r = sh('git', ['rev-parse', `${sha}^{tree}`]);
    return r.status === 0 && r.stdout ? r.stdout : null;
  };
  let ciText = '';
  try {
    ciText = readFileSync(path.join(root, CI_WORKFLOW), 'utf8');
  } catch { /* judged as no jobs */ }
  const facts = { head, parents, headTree: tree(head), prTree: null, baseInPr: null,
    workflow: expectedJobs(ciText), pulls: null, runs: null, jobs: null, roadmap: false };
  const [cmd, args] = ROADMAP_CHECK;
  facts.roadmap = sh(cmd, args, { env: { OSC_ROADMAP_CHECK: '1' } }).status === 0;
  if (!parents || parents.length !== 2) return facts;
  const [base, pr] = parents;
  facts.prTree = tree(pr);
  const anc = sh('git', ['merge-base', '--is-ancestor', base, pr]).status;
  facts.baseInPr = anc === 0 ? true : anc === 1 ? false : null;
  const pulls = ghJson(sh, `repos/${REPO_SLUG}/commits/${pr}/pulls?per_page=100`);
  facts.pulls = Array.isArray(pulls) ? pulls : null;
  const runs = ghJson(sh,
    `repos/${REPO_SLUG}/actions/runs?head_sha=${pr}&event=pull_request&per_page=100`);
  facts.runs = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : null;
  const jobsOf = (run) => {
    if (!run) return null;
    const j = ghJson(sh, `repos/${REPO_SLUG}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    return Array.isArray(j?.jobs) ? j.jobs : null;
  };
  facts.jobs = jobsOf(candidateRuns(facts, 'pull_request', facts.runs)[0]);
  // The merge queue's run on HEAD itself (ADR 0083), read only when the pull request's own run
  // does not verify, so a release outside the queue costs no extra read.
  if (runProblems(facts, 'pull_request', facts.runs, facts.jobs).length) {
    const q = ghJson(sh,
      `repos/${REPO_SLUG}/actions/runs?head_sha=${head}&event=merge_group&per_page=100`);
    facts.queueRuns = Array.isArray(q?.workflow_runs) ? q.workflow_runs : null;
    facts.queueJobs = jobsOf(candidateRuns(facts, 'merge_group', facts.queueRuns)[0]);
  }
  return facts;
}
