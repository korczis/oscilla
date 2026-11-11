// The /lab/ milestone status against the tool itself (P015, option B of oscilla-43, 2026-11-10):
// every milestone's status in the facts (scripts/facts.mjs milestoneStatuses with
// requireMajordomus, then plan) equals what `majordomus plan roadmap --json` derives, mapped by a
// table written out here, not imported. It runs where majordomus is: the knowledge job of ci.yml
// and main-checks.yml runs this file with the pinned majordomus on PATH and
// OSC_FACTS_MAJORDOMUS=1, under which a missing majordomus fails; elsewhere (the unit job, a
// developer without majordomus, the fail-first tree without history) the comparison is skipped
// with its reason. The guard below runs everywhere: both knowledge jobs must keep that step,
// after the step that checks the installed majordomus, with the variable set.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROOT, milestoneStatuses, plan } from '../../scripts/facts.mjs';

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const HAS_HISTORY = (() => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: REPO_ROOT,
      stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const MAJORDOMUS = spawnSync('majordomus', ['version'], { encoding: 'utf8' });
const HAS_MAJORDOMUS = !MAJORDOMUS.error && MAJORDOMUS.status === 0;
const REQUIRED = process.env.OSC_FACTS_MAJORDOMUS === '1';

test('every milestone\'s status is the one `majordomus plan roadmap --json` derives',
  { skip: !HAS_HISTORY ? 'this checkout has no commit history (a git archive tree)'
    : !HAS_MAJORDOMUS && !REQUIRED && 'majordomus is not on PATH; the knowledge job runs this '
      + 'with the pinned one (OSC_FACTS_MAJORDOMUS=1), where its absence fails' },
  () => {
    assert.ok(HAS_MAJORDOMUS, 'majordomus is on PATH (OSC_FACTS_MAJORDOMUS=1 requires it)');
    const r = spawnSync('majordomus', ['plan', 'roadmap', '--json'], { cwd: REPO_ROOT,
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
    assert.equal(r.status, 0, r.stderr);
    // DONE and CANCELLED as they are, ACTIVE and VERIFY in progress (now), PLANNED (next) and
    // BLOCKED (later) open
    const want = { DONE: ['DONE', null], CANCELLED: ['CANCELLED', null], ACTIVE: ['ACTIVE', 'now'],
      VERIFY: ['ACTIVE', 'now'], PLANNED: ['OPEN', 'next'], BLOCKED: ['OPEN', 'later'] };
    const tool = new Map(JSON.parse(r.stdout).milestones.map((m) => [m.id, want[m.status]
      ?? ['OPEN', 'next']]));
    const st = milestoneStatuses(REPO_ROOT, { requireMajordomus: true });
    assert.equal(st.source, 'majordomus plan roadmap --json');
    assert.match(st.tool.version, /^\d+\.\d+\.\d+/);
    const page = plan(REPO_ROOT, st).items;
    assert.equal(page.length, tool.size);
    for (const m of page) assert.deepEqual([m.status, m.phase], tool.get(m.id), m.id);
  });

const RUN = '        run: node --test tests/unit/facts-majordomus.test.mjs\n';
const VERSION_CHECK = '        run: test "$(majordomus version)" = "majordomus ${MJ_VERSION}"\n';

/**
 * What a workflow's knowledge job lacks for this comparison to run there: the step that runs
 * this file with OSC_FACTS_MAJORDOMUS '1', after the step that checks the installed majordomus.
 */
export function knowledgeRunsComparison(text) {
  const at = text.indexOf('\n  knowledge:\n');
  if (at < 0) return ['no knowledge job'];
  const next = text.slice(at + 1).search(/\n {2}[a-z][\w-]*:\n/);
  const job = text.slice(at, next < 0 ? text.length : at + 1 + next);
  const steps = job.split(/\n(?= {6}- )/);
  const run = steps.findIndex((s) => `${s}\n`.includes(RUN));
  const check = steps.findIndex((s) => `${s}\n`.includes(VERSION_CHECK));
  const problems = [];
  if (run < 0) return ['no step runs tests/unit/facts-majordomus.test.mjs'];
  if (!/\n {8}env:\n(?: {10}.*\n)*? {10}OSC_FACTS_MAJORDOMUS: '1'\n/.test(`${steps[run]}\n`)) {
    problems.push('the step does not set OSC_FACTS_MAJORDOMUS: \'1\'');
  }
  if (check < 0 || check > run) problems.push('the step runs before majordomus is installed');
  return problems;
}

test('the knowledge jobs of ci.yml and main-checks.yml run the comparison with majordomus', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/main-checks.yml']) {
    assert.deepEqual(knowledgeRunsComparison(read(f)), [], f);
  }
});

test('mutation: the step dropped, its variable dropped, or moved before the install', () => {
  const ci = read('.github/workflows/ci.yml');
  const stepAt = ci.indexOf('      - name: The /lab/ milestone status is majordomus plan roadmap');
  const stepEnd = ci.indexOf(RUN, stepAt) + RUN.length;
  const step = ci.slice(stepAt, stepEnd);
  assert.ok(stepAt > 0 && step.includes(RUN));
  const dropped = ci.slice(0, stepAt) + ci.slice(stepEnd);
  assert.deepEqual(knowledgeRunsComparison(dropped),
    ['no step runs tests/unit/facts-majordomus.test.mjs']);
  const noVar = ci.replace("          OSC_FACTS_MAJORDOMUS: '1'\n", "          OTHER: '1'\n");
  assert.deepEqual(knowledgeRunsComparison(noVar),
    ['the step does not set OSC_FACTS_MAJORDOMUS: \'1\'']);
  const install = ci.indexOf('      - name: Install Majordomus', ci.indexOf('\n  knowledge:\n'));
  const early = ci.slice(0, install) + step + ci.slice(install, stepAt) + ci.slice(stepEnd);
  assert.deepEqual(knowledgeRunsComparison(early),
    ['the step runs before majordomus is installed']);
});
