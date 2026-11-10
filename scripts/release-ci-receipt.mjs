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
//   - every job the base's ci.yml declares (R037: read with `git show B:ci.yml`, the gate main
//     had when the release branched; the checkout's copy is the release tree's own, so it can
//     only add) and every job the release tree's ci.yml adds beyond it (a matrix job once per
//     value) is in that run's latest jobs, on the run's head, and succeeded: a missing, skipped
//     or cancelled job, a base job the release tree dropped, or a job neither copy declares,
//     refuses (a path-gated job skipped for a non-runtime change too: a release changes
//     package.json, so its run skips none). One exemption, on either event: the job with id
//     flake-ledger whose `if:` is exactly RERUN_ONLY_IF (E010) may be `completed`/`skipped` on
//     its own first attempt, and must succeed from attempt 2; each copy of ci.yml must declare
//     exactly one such job and no two jobs may share a name. E060: a base job the release
//     tree's copy no longer declares is not required when that copy provably replaces it
//     (replacedJob: each npm script it ran is run for the same matrix value, by name or through
//     the browser legs that run test:release's browser suites); a job of programs only, or one
//     whose scripts are not all run, still refuses;
//   - the committed roadmap matches the plan (tests/unit/about-current.test.mjs with
//     OSC_ROADMAP_CHECK=1, the one check the local gate ran that CI does not).
// Each fact that cannot be read is a problem of its own, never an empty answer.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseYaml } from './yaml-subset.mjs';

// E060: the browser suites the CI legs run, by a package.json (the legs' own plan).
const { releaseSuites } = createRequire(import.meta.url)('../tests/browser/lib/shards.cjs');

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

/** The npm scripts a job's steps run (`npm test` as 'test', `npm run x` as 'x'), in order. */
function npmScripts(job) {
  const out = [];
  for (const st of job.steps || []) {
    for (const m of String(st.run || '').matchAll(/\bnpm\s+(test\b|run\s+([\w:.-]+))/g)) {
      const sc = m[2] || 'test';
      if (!out.includes(sc)) out.push(sc);
    }
  }
  return out;
}

/**
 * The job names a run of the workflow text shows, a matrix job once per value of its one key,
 * and each one's details (E060): [{ name, value (the matrix value, or null), scripts }].
 */
export function expectedJobs(ciText) {
  let doc;
  try {
    doc = parseYaml(ciText);
  } catch (e) {
    return { name: null, jobs: [], problems: [`${CI_WORKFLOW} does not parse: ${e.message}`] };
  }
  const jobs = [];
  const details = [];
  const rerunOnly = [];
  const problems = [];
  for (const [id, job] of Object.entries(doc?.jobs || {})) {
    const name = typeof job.name === 'string' ? job.name : id;
    const matrix = job.strategy?.matrix;
    const scripts = npmScripts(job);
    if (!matrix) {
      jobs.push(name);
      details.push({ name, value: null, scripts });
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
    for (const v of matrix[key]) {
      jobs.push(name.replace(slot, String(v)));
      details.push({ name: jobs.at(-1), value: String(v), scripts });
    }
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
  return { name: typeof doc?.name === 'string' ? doc.name : null, jobs, details,
    rerunOnly: rerunOnly.length === 1 && rerunOnly[0].id === RERUN_ONLY_JOB ? [rerunOnly[0].name] : [],
    problems };
}

/**
 * Pure judgement of the gathered facts (empty = the CI receipt verifies).
 * @param {{ head: string, parents: string[]|null, headTree: string|null, prTree: string|null,
 *   baseInPr: boolean|null, workflow: { name: string|null, jobs: string[], problems: string[] },
 *   baseWorkflow: { jobs: string[], rerunOnly?: string[], problems: string[] }|null,
 *   pulls: object[]|null, runs: object[]|null, jobs: object[]|null, roadmap: boolean }} f
 *   workflow is the release tree's ci.yml (the checkout's, HEAD's); baseWorkflow the base's,
 *   read from the merge's first parent (R037), null when it could not be read.
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
  // R037: the job set is the base's ci.yml, the gate main had when the release branched. It is
  // a fact of its own, read from the first parent; unreadable or broken, it refuses.
  if (!f.baseWorkflow) problems.push(`${CI_WORKFLOW} of the base ${short(base)} could not be read`);
  else problems.push(...(f.baseWorkflow.problems || []).map((p) => `base ${short(base)}: ${p}`));
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
  const { by, rerunOnly } = declaredJobs(f);
  const base = f.parents?.[0];
  const copy = (name) => (by.get(name) === 'base'
    ? `${CI_WORKFLOW} of the base ${short(base)}` : CI_WORKFLOW);
  for (const [name] of by) {
    const j = byName.get(name);
    if (!j) problems.push(`run ${newest.id} has no job "${name}" (${copy(name)} declares it)`);
    else if (j.run_id !== newest.id || j.head_sha !== sha) {
      problems.push(`job "${name}" ran on ${short(j.head_sha)} in run ${j.run_id}, not on `
        + `${short(sha)} in run ${newest.id}`);
    } else if (j.status === 'completed' && j.conclusion === 'skipped' && rerunOnly.has(name)
      && Number(j.run_attempt ?? newest.run_attempt) === 1) {
      // a re-run-only job is skipped on a first attempt by its own condition (E010)
    } else if (j.status !== 'completed' || j.conclusion !== 'success') {
      problems.push(`job "${name}" of run ${newest.id} is ${j.status}/${j.conclusion}`);
    }
  }
  for (const j of allJobs) {
    if (!by.has(j.name)) {
      problems.push(`run ${newest.id} has a job "${j.name}" that ${CI_WORKFLOW} does not declare, `
        + `at the base ${short(base)} or at HEAD`);
    }
  }
  return problems;
}

/**
 * The jobs a run must carry and which copy of ci.yml declares each (R037): every job of the
 * base's copy, the gate main had when the release branched (`base`), and every job the release
 * tree's own copy adds beyond it (`head`); a run job in neither is undeclared. A base job the
 * release tree dropped is still required, and its refusal names the base, unless the release
 * tree's copy provably replaces it (E060, replacedJob). The re-run-only exemption (E010) holds
 * for the ledger either copy names.
 */
function declaredJobs(f) {
  const by = new Map();
  for (const name of f.workflow?.jobs || []) by.set(name, 'head');
  for (const name of f.baseWorkflow?.jobs || []) {
    if (by.has(name) || !replacedJob(f, name)) by.set(name, 'base');
  }
  const rerunOnly = new Set([...(f.workflow?.rerunOnly || []),
    ...(f.baseWorkflow?.rerunOnly || [])]);
  return { by, rerunOnly };
}

/**
 * E060: whether base job `name`, which the release tree's ci.yml does not declare, is replaced
 * by it: the base job ran at least one npm script and nothing it ran is lost. Each of its
 * scripts is run, for the same matrix value (a job of no matrix serves every value), by a job
 * of the release tree's copy, by name or through the browser legs: a job running `test:leg`
 * runs every browser suite of test:release but the visual gate (tests/browser/lib/shards.cjs,
 * by the release tree's package.json, f.pkg), so a script whose suites all lie among them is
 * run there. A base job of programs only, or a fact not read (no package.json), is not replaced.
 */
export function replacedJob(f, name) {
  const b = (f.baseWorkflow?.details || []).find((d) => d.name === name);
  const head = f.workflow?.details || [];
  if (!b || !b.scripts.length || !f.pkg || !f.pkg.scripts) return false;
  const same = (d) => d.value === null || b.value === null || d.value === b.value;
  let legged;
  try {
    legged = new Set(releaseSuites(f.pkg));
  } catch {
    return false;
  }
  const suitesOf = (sc) => (String(f.pkg.scripts[sc] || '').match(/tests\/browser\/[\w.-]+\.cjs/g)
    || []).filter((x) => x !== 'tests/browser/lib/run-suites.cjs');
  return b.scripts.every((sc) => head.some((d) => same(d) && (d.scripts.includes(sc)
    || (d.scripts.includes('test:leg') && suitesOf(sc).length > 0
      && suitesOf(sc).every((x) => legged.has(x))))));
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
  // E060: the release tree's package.json, whose test:release the CI legs run (replacedJob).
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch { /* no package.json: nothing is known to be replaced */ }
  const facts = { head, parents, headTree: tree(head), prTree: null, baseInPr: null,
    workflow: expectedJobs(ciText), baseWorkflow: null, pkg, pulls: null, runs: null,
    jobs: null, roadmap: false };
  const [cmd, args] = ROADMAP_CHECK;
  facts.roadmap = sh(cmd, args, { env: { OSC_ROADMAP_CHECK: '1' } }).status === 0;
  if (!parents || parents.length !== 2) return facts;
  const [base, pr] = parents;
  // R037: the job set is the base's ci.yml, read from the merge's first parent; the checkout's
  // copy (ciText) is the release tree's own and says only what it adds.
  const shown = sh('git', ['show', `${base}:${CI_WORKFLOW}`]);
  facts.baseWorkflow = shown.status === 0 ? expectedJobs(shown.stdout || '') : null;
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
