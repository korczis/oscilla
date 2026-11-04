// The CI receipt (ADR 0082, rule project.release-receipt-binds-gate v2): the release pull
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
//   - the newest CI run (workflow `name:` of ci.yml, event pull_request) on H has completed
//     with success: an older green run, or a run whose latest attempt is red, does not count;
//   - every job ci.yml declares (a matrix job once per value) is in that run's latest jobs,
//     on H, and succeeded: a missing, skipped or cancelled job, or a job no ci.yml declares,
//     refuses;
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

/** The job names a run of the workflow text shows, a matrix job once per value of its one key. */
export function expectedJobs(ciText) {
  let doc;
  try {
    doc = parseYaml(ciText);
  } catch (e) {
    return { name: null, jobs: [], problems: [`${CI_WORKFLOW} does not parse: ${e.message}`] };
  }
  const jobs = [];
  const problems = [];
  for (const [id, job] of Object.entries(doc?.jobs || {})) {
    const name = typeof job.name === 'string' ? job.name : id;
    const matrix = job.strategy?.matrix;
    if (!matrix) {
      jobs.push(name);
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
  return { name: typeof doc?.name === 'string' ? doc.name : null, jobs, problems };
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
  if (!Array.isArray(f.runs)) return [...problems, `the CI runs of ${short(pr)} could not be read`];
  const runs = f.runs
    .filter((r) => r.name === f.workflow?.name && r.event === 'pull_request' && r.head_sha === pr
      && (branch === null || r.head_branch === branch))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  if (!runs.length) {
    return [...problems, `no ${f.workflow?.name} pull_request run on ${short(pr)}`
      + (branch ? ` from ${branch}` : '')];
  }
  const newest = runs[0];
  if (newest.status !== 'completed' || newest.conclusion !== 'success') {
    problems.push(`the newest ${f.workflow.name} run ${newest.id} on ${short(pr)} (attempt `
      + `${newest.run_attempt}) is ${newest.status}/${newest.conclusion}`);
  }
  if (!Array.isArray(f.jobs)) {
    return [...problems, `the jobs of run ${newest.id} could not be read`];
  }
  const byName = new Map(f.jobs.map((j) => [j.name, j]));
  for (const name of f.workflow.jobs) {
    const j = byName.get(name);
    if (!j) problems.push(`run ${newest.id} has no job "${name}" (${CI_WORKFLOW} declares it)`);
    else if (j.run_id !== newest.id || j.head_sha !== pr) {
      problems.push(`job "${name}" ran on ${short(j.head_sha)} in run ${j.run_id}, not on `
        + `${short(pr)} in run ${newest.id}`);
    } else if (j.status !== 'completed' || j.conclusion !== 'success') {
      problems.push(`job "${name}" of run ${newest.id} is ${j.status}/${j.conclusion}`);
    }
  }
  for (const j of f.jobs) {
    if (!f.workflow.jobs.includes(j.name)) {
      problems.push(`run ${newest.id} has a job "${j.name}" that ${CI_WORKFLOW} does not declare`);
    }
  }
  return problems;
}

/** The run judged, for the log line of a verified receipt. */
export function judgedRun(f) {
  const pr = f.parents?.[1];
  const pulls = (f.pulls || []).filter((p) => p?.head?.sha === pr);
  const branch = pulls.length === 1 ? pulls[0].head.ref : null;
  return (f.runs || []).filter((r) => r.name === f.workflow?.name && r.head_sha === pr
    && r.event === 'pull_request' && (branch === null || r.head_branch === branch))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0] || null;
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
  const newest = judgedRun(facts);
  if (newest) {
    const jobs = ghJson(sh,
      `repos/${REPO_SLUG}/actions/runs/${newest.id}/jobs?filter=latest&per_page=100`);
    facts.jobs = Array.isArray(jobs?.jobs) ? jobs.jobs : null;
  }
  return facts;
}
