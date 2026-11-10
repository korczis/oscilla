// The `knowledge` job of .github/workflows/ci.yml: a pinned `majordomus doctor` that the
// required `gate` job needs. Its verdict is .github/doctor-verdict.jq, run here on doctor
// outputs so that what passes the gate is decided by a tested program, not by eye:
//   - any FAIL fails, except the git-hook wiring entries a CI runner cannot have;
//   - a line at any level saying the policy lacks a key the pinned Majordomus requires fails
//     (doctor reports it as a WARN; rule project.majordomus-layer-current);
//   - an output with no OK layout line fails (doctor printed nothing usable).
// The download retries, so one transient asset error does not stall every merge.
//   node --test tests/unit/ci-knowledge-job.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const VERDICT = path.join(ROOT, '.github/doctor-verdict.jq');

/** The text of one job of ci.yml: from `  <name>:` to the next top-level job. */
function job(name) {
  const start = CI.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const rest = CI.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;

/** Whether the verdict passes these doctor lines (objects), via `jq -e -s -f`. */
function verdict(lines) {
  const input = lines.map((l) => JSON.stringify(l)).join('\n');
  const r = spawnSync('jq', ['-e', '-s', '-f', VERDICT], { input, encoding: 'utf8' });
  return r.status === 0;
}

const ok = (category, subject) => ({ level: 'OK', category, subject, message: '' });
const fail = (category, subject) => ({ level: 'FAIL', category, subject, message: '' });
const HOOKS = ['doctor-on-commit', 'finish-on-push', 'worktree-guard', 'diff-check-on-commit']
  .map((name) => fail('wiring', name));
const LAYOUT = ok('layout', '.ai/manifest.yaml');

test('the gate needs the knowledge job, and the job runs the verdict program', () => {
  const gate = job('gate');
  assert.match(gate, /needs: \[[^\]]*\bknowledge\b/);
  const k = job('knowledge');
  assert.match(k, /majordomus doctor --json > doctor\.jsonl/);
  assert.match(k, /jq -e -s -f \.github\/doctor-verdict\.jq doctor\.jsonl/);
  assert.ok(existsSync(VERDICT), '.github/doctor-verdict.jq exists');
});

test('the pinned download retries transient errors and checks the digest', () => {
  const k = job('knowledge');
  const curl = k.split('\n').find((l) => /\bcurl\b/.test(l));
  assert.ok(curl, 'the job downloads with curl');
  for (const flag of ['--retry 3', '--retry-all-errors', '--retry-delay 5',
    '--connect-timeout 20', "--proto '=https'", '-f']) {
    assert.ok(curl.includes(flag), `curl ${flag}`);
  }
  assert.match(k, /MJ_SHA256: [0-9a-f]{64}\n/);
  assert.match(k, /sha256sum -c -/);
  // An exact release, a pre-release included (1.0.0-alpha.9): never a range or a moving tag.
  assert.match(k, /MJ_VERSION: \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\n/);
});

// 2026-11-08: the pinned release's public download URLs returned 504 for hours while the API
// served the same assets, and every pull request's knowledge job failed. Where the URL fails,
// the job fetches the same asset of the same tag and repository through the API, bounded and
// retried, and the digest still decides; main-checks.yml carries the same step.
test('a failed public download falls back to the API route, same tag and repository', () => {
  for (const k of [job('knowledge'), readFileSync(path.join(ROOT,
    '.github/workflows/main-checks.yml'), 'utf8')]) {
    assert.match(k, /if ! curl -fsSL/, 'the public URL is tried first and its failure is caught');
    assert.match(k, /gh release download "v\$\{MJ_VERSION\}" -R korczis\/prismatic-majordomus\s*\\\n\s*-p "\$a"/,
      'the fallback names the pinned tag, the repository and the exact asset');
    assert.match(k, /timeout 60 gh release download/, 'each attempt is bounded');
    assert.match(k, /for i in 1 2 3; do/, 'three attempts');
    assert.match(k, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'the API is called with the job token');
    const fallback = k.indexOf('gh release download');
    const digest = k.indexOf('sha256sum -c -');
    assert.ok(fallback > 0 && digest > fallback, 'the digest is checked after either download');
  }
});

// R055 (project.ci-bounded): the public download had --retry 5 but no --max-time, under a
// 5-minute step, so one stalled transfer could use the whole step before the API fallback
// (3 x 60 s) started. Every public attempt is bounded now, and the worst case of both routes
// (each attempt at its bound, each delay taken) fits inside the step's timeout-minutes.
/** The `Install Majordomus` step of a workflow text: from its `- name:` to the next step. */
function installStep(text) {
  const start = text.indexOf('- name: Install Majordomus');
  assert.ok(start >= 0, 'an Install Majordomus step');
  const rest = text.slice(start);
  const next = rest.slice(2).search(/\n {6}- (name|uses):/);
  return next < 0 ? rest : rest.slice(0, next + 2);
}

/** Worst-case seconds of the step's two download routes, read from its own text. */
function downloadBudget(step) {
  const num = (re, what) => {
    const m = re.exec(step);
    assert.ok(m, what);
    return Number(m[1]);
  };
  const curl = step.slice(step.indexOf('curl '), step.indexOf('; then'));
  const max = (() => {
    const m = /--max-time (\d+)/.exec(curl);
    return m ? Number(m[1]) : Infinity;
  })();
  const retries = Number(/--retry (\d+)/.exec(curl)[1]);
  const delay = Number(/--retry-delay (\d+)/.exec(curl)[1]);
  const attempts = (/for i in ([\d ]+); do/.exec(step) || [, ''])[1].trim().split(/\s+/).length;
  const bound = num(/timeout (\d+) gh release download/, 'each fallback attempt bounded');
  const pause = num(/\n\s*sleep (\d+)\n/, 'a pause between fallback attempts');
  const limit = num(/^\s*timeout-minutes: (\d+)$/m, 'the step has timeout-minutes') * 60;
  return { max, retries, limit,
    total: max * (retries + 1) + delay * retries + attempts * bound + (attempts - 1) * pause };
}

test('R055: every public download attempt is bounded and both routes fit the step', () => {
  for (const [file, text] of [['ci.yml', CI], ['main-checks.yml', readFileSync(path.join(ROOT,
    '.github/workflows/main-checks.yml'), 'utf8')]]) {
    const b = downloadBudget(installStep(text));
    assert.ok(Number.isFinite(b.max), `${file}: the public curl carries --max-time`);
    assert.ok(b.total < b.limit, `${file}: ${b.total} s worst case, step bound ${b.limit} s`);
  }
  // the arithmetic itself: without --max-time no total is finite; at --retry 5 and --max-time
  // 20 the six attempts no longer leave the fallback its time
  const step = installStep(CI);
  assert.equal(downloadBudget(step.replace(/--max-time \d+ /, '')).total, Infinity);
  const greedy = downloadBudget(step.replace('--retry 3 ', '--retry 5 '));
  assert.ok(greedy.total >= greedy.limit, `${greedy.total} s at --retry 5`);
});

test('the verdict: hook wiring is excused, any other FAIL and an empty output are not', {
  skip: HAVE_JQ ? false : 'jq is not installed here (CI runners have it)',
}, () => {
  assert.equal(verdict([LAYOUT, ok('policy', 'x'), ...HOOKS]), true, 'hooks only');
  assert.equal(verdict([LAYOUT]), true, 'clean');
  assert.equal(verdict([LAYOUT, ...HOOKS, fail('knowledge', 'a.md')]), false, 'another FAIL');
  assert.equal(verdict([LAYOUT, fail('wiring', 'something-else')]), false, 'other wiring');
  assert.equal(verdict([LAYOUT, { level: 'WARN', category: 'dag', subject: 'M019' }]), true,
    'a WARN is reported, not failed');
  assert.equal(verdict([]), false, 'doctor printed nothing');
  assert.equal(verdict([ok('policy', 'x')]), false, 'no OK layout line');
  assert.equal(verdict([fail('layout', '.ai/manifest.yaml'), ...HOOKS]), false, 'layout FAIL');
});


// What `majordomus doctor --json` 0.13.2 printed for this repository on 2026-10-07, while
// .ai/repo/policy.yaml had no `knowledge:` block: no FAIL, exit 0, and this WARN. The same
// run wrote "majordomus: policy is missing required key knowledge.candidates_max_files" to
// stderr. CI passed it for as long as the verdict looked only at FAIL.
const MISSING_KEY = {
  level: 'WARN', category: 'knowledge', subject: 'candidates',
  message: 'policy declares no knowledge.candidates_max_files',
  reproduce: 'add a knowledge: block to .ai/repo/policy.yaml; see share/skeleton/policy.yaml',
};

// The same situation under the pinned Majordomus: the lines the verdict reads, as
// `majordomus doctor --json` CAPTURED_WITH printed them on 2026-11-10 (first on 2026-10-29 with
// 1.0.0-alpha.9, then 1.0.0 on 2026-11-07, unchanged) for a copy of this repository with the
// `knowledge:` block removed and no git hooks, as on a CI runner. The missing-key WARN is word for word the 0.13.2 line;
// the stderr line gained the policy path.
// Capture again when a pin change alters doctor's output.
const CAPTURED_WITH = '1.0.1';
const PINNED = {
  layout: { level: 'OK', category: 'layout', subject: '.ai/manifest.yaml',
    message: 'schema ai-repository/v1', reproduce: '' },
  hooks: [['doctor-on-commit', 'pre-commit'], ['finish-on-push', 'pre-push'],
    ['worktree-guard', 'pre-commit'], ['diff-check-on-commit', 'pre-commit']]
    .map(([subject, hook]) => ({ level: 'FAIL', category: 'wiring', subject,
      message: `hook .git/hooks/${hook} does not exist`, reproduce: `ls -l .git/hooks/${hook}` })),
  deriver: { level: 'OK', category: 'knowledge', subject: 'wiring',
    message: 'the close path and the compaction adapter call the deriver', reproduce: '' },
  missingKey: { level: 'WARN', category: 'knowledge', subject: 'candidates',
    message: 'policy declares no knowledge.candidates_max_files',
    reproduce: 'add a knowledge: block to .ai/repo/policy.yaml; see share/skeleton/policy.yaml' },
  stderr: 'majordomus: policy is missing required key knowledge.candidates_max_files '
    + '(.ai/repo/policy.yaml)',
};

test('the verdict: a policy missing a required key fails without any FAIL line', {
  skip: HAVE_JQ ? false : 'jq is not installed here (CI runners have it)',
}, () => {
  assert.equal(verdict([LAYOUT, MISSING_KEY]), false, 'the WARN doctor 0.13.2 prints');
  assert.equal(verdict([LAYOUT, ...HOOKS, MISSING_KEY]), false, 'with the hooks excused');
  assert.equal(verdict([LAYOUT, { level: 'INFO', category: 'policy', subject: 'policy.yaml',
    message: 'policy is missing required key knowledge.candidates_max_files' }]), false,
  'the stderr wording, at any level');
  assert.equal(verdict([LAYOUT, { level: 'WARN', category: 'knowledge', subject: 'candidates',
    message: '41 candidates await review, over knowledge.candidates_max_files 40' }]), true,
  'a full review queue is a WARN, not a missing key');
});

test(`the verdict on the lines the pinned doctor (${CAPTURED_WITH}) prints`, {
  skip: HAVE_JQ ? false : 'jq is not installed here (CI runners have it)',
}, () => {
  const runner = [PINNED.layout, ...PINNED.hooks, PINNED.deriver];
  assert.equal(verdict(runner), true, 'a runner without hooks and with the block passes');
  assert.equal(verdict([...runner, PINNED.missingKey]), false, 'the missing-key WARN fails');
  assert.equal(verdict([...runner, { level: 'INFO', category: 'policy', subject: 'stderr',
    message: PINNED.stderr }]), false, 'the stderr wording, with the policy path, fails');
  assert.equal(verdict([PINNED.layout, PINNED.hooks[0], { ...PINNED.hooks[1],
    subject: 'something-else' }]), false, 'a wiring FAIL the policy does not declare fails');
});

test('the policy declares every hook the verdict excuses, and the knowledge block', () => {
  const policy = readFileSync(path.join(ROOT, '.ai/repo/policy.yaml'), 'utf8');
  const hooks = [...policy.matchAll(
    /^ {2}- name: ([\w-]+)\n(?: {4}.*\n)*? {4}wired_by: git-hook:/gm)].map(([, n]) => n).sort();
  const excused = [...readFileSync(VERDICT, 'utf8').matchAll(/\.subject == "([\w-]+)"/g)]
    .map(([, n]) => n).sort();
  assert.deepEqual(excused, hooks, 'the verdict excuses exactly the git-hook entries of policy');
  assert.match(policy, /^knowledge:\n {2}candidates_max_files: \d+/m);
  assert.match(policy, /^ {2}candidate_max_age_minutes: \d+/m);
});
