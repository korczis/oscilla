// E044: .github/workflows/main-checks.yml runs the pull request gate's unit, knowledge and
// browser jobs again on every push to main, so two green pull requests that combine into a red
// main show it on the merge commit (branch protection no longer asks for an up-to-date
// branch). The jobs are ci.yml's: each one must equal the ci.yml job of the same key, field by
// field and step by step, except the steps listed in PR_ONLY_STEPS, which need a pull request.
// So a change to one of those ci.yml jobs (a step, a budget, a browser leg, the Majordomus
// pin) that is not made in main-checks.yml fails here, and the copy cannot drift.
//
// Besides the copy: the workflow starts on a push to main and nothing else; it has no `gate`
// job (project.ci-bounded binds a workflow with one to pull_request, and nothing requires this
// one); its `report` job runs always, needs every other job, writes their results to the step
// summary and fails with an error annotation unless all succeeded; and no copied step reads
// the pull request. project.ci-bounded itself is held by tests/unit/ci-workflows.test.mjs.
// Each disagreement is applied to a copy of the real files and must be named.
//   node --test tests/unit/main-checks.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/yaml-subset.mjs';
import { browserSuites, checkWorkflow } from '../../scripts/ci-workflow-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const MAIN_PATH = '.github/workflows/main-checks.yml';
const CI = read('.github/workflows/ci.yml');
const MAIN = read(MAIN_PATH);

/** The ci.yml jobs main-checks.yml runs again, under the same keys. */
export const MIRRORED = ['unit', 'knowledge', 'browser'];
/** The aggregate of main-checks.yml; deliberately not `gate`. */
export const REPORT = 'report';
/**
 * Steps of a mirrored ci.yml job that main-checks.yml leaves out, by job and step name, with
 * the reason. Each must still exist in ci.yml, or the exception is stale.
 */
export const PR_ONLY_STEPS = {
  unit: {
    'Size of dist/index.html against the budget and the merge base (step summary)':
      'compares with the merge base of a pull request (GITHUB_BASE_REF), which a push has not',
  },
};
/** What a copied step may not read: it is empty or absent on a push. */
const PULL_REQUEST_ONLY =
  /github\.event\.pull_request|GITHUB_BASE_REF|GITHUB_HEAD_REF|github\.base_ref|github\.head_ref/;

const json = (v) => JSON.stringify(v);

/** Every disagreement of a main-checks.yml text with a ci.yml text, one line each. */
export function mainChecksProblems(ciText, mainText) {
  const found = [];
  const ci = parseYaml(ciText);
  const main = parseYaml(mainText);
  const jobs = main?.jobs ?? {};

  // the trigger: a push to main, nothing else and no filter
  const on = main?.on;
  const triggers = typeof on === 'string' ? [on]
    : Array.isArray(on) ? on.map(String) : Object.keys(on ?? {});
  if (triggers.join() !== 'push') {
    found.push(`triggers: main-checks.yml starts on ${triggers.join(', ') || '(nothing)'}, `
      + 'not push alone');
  }
  const push = on && typeof on === 'object' && !Array.isArray(on) ? on.push : undefined;
  if (json(push?.branches) !== json(['main'])) {
    found.push(`triggers: push.branches is ${json(push?.branches)}, not ["main"]`);
  }
  for (const key of Object.keys(push ?? {})) {
    if (key !== 'branches') found.push(`triggers: push filters by ${key}; every push to main runs`);
  }

  // the job set: the mirrored jobs and the report, and never a gate
  for (const [key, job] of Object.entries(jobs)) {
    if (key === 'gate' || String(job?.name ?? '').trim() === 'gate') {
      found.push(`jobs: ${key} is a gate job; this workflow requires nothing and has none`);
    }
  }
  const want = [...MIRRORED, REPORT].sort();
  if (json(Object.keys(jobs).sort()) !== json(want)) {
    found.push(`jobs: main-checks.yml has ${Object.keys(jobs).sort().join(', ')}, `
      + `not ${want.join(', ')}`);
  }

  // the copies
  for (const key of MIRRORED) {
    const source = ci?.jobs?.[key];
    const copy = jobs[key];
    if (!source) { found.push(`mirror: ci.yml has no job ${key}`); continue; }
    if (!copy) continue; // named under jobs
    const skip = PR_ONLY_STEPS[key] ?? {};
    const sourceSteps = source.steps ?? [];
    for (const name of Object.keys(skip)) {
      if (!sourceSteps.some((s) => s.name === name)) {
        found.push(`mirror: ${key}: the left-out step "${name}" is no step of ci.yml's job`);
      }
    }
    const fields = new Set([...Object.keys(source), ...Object.keys(copy)]);
    fields.delete('steps');
    for (const field of [...fields].sort()) {
      if (json(source[field]) !== json(copy[field])) {
        found.push(`mirror: ${key}.${field} is ${json(copy[field])} here and `
          + `${json(source[field])} in ci.yml`);
      }
    }
    const expected = sourceSteps.filter((s) => !(s.name in skip));
    const steps = copy.steps ?? [];
    for (let i = 0; i < Math.max(expected.length, steps.length); i += 1) {
      if (json(expected[i]) !== json(steps[i])) {
        const label = steps[i]?.name ?? steps[i]?.uses ?? steps[i]?.run
          ?? expected[i]?.name ?? expected[i]?.uses ?? expected[i]?.run;
        found.push(`mirror: ${key} step ${i + 1} ("${label}") differs from ci.yml's`);
        break;
      }
    }
    if (PULL_REQUEST_ONLY.test(json(copy))) {
      found.push(`mirror: ${key} reads the pull request, which a push to main has not`);
    }
  }

  // the report: always, every other job, a summary and a failure that is loud
  const report = jobs[REPORT];
  if (report) {
    if (String(report.if ?? '').replace(/\s/g, '') !== 'always()') {
      found.push('report: runs without `if: always()`, so a failed job would skip it');
    }
    const needs = new Set([].concat(report.needs ?? []));
    const missing = Object.keys(jobs).filter((k) => k !== REPORT && !needs.has(k));
    if (missing.length) found.push(`report: needs does not list ${missing.join(', ')}`);
    const run = (report.steps ?? []).map((s) => s.run ?? '').join('\n');
    const env = json((report.steps ?? []).map((s) => s.env ?? {}));
    if (!env.includes('toJSON(needs)')) found.push('report: does not read the needs results');
    if (!run.includes('GITHUB_STEP_SUMMARY')) found.push('report: writes no step summary');
    if (!/select\(\.value\.result != "success"\)/.test(run)) {
      found.push('report: does not select the jobs that did not succeed');
    }
    if (!/::error::/.test(run) || !/\bexit 1\b/.test(run)) {
      found.push('report: a failure neither annotates the commit nor fails the job');
    }
  }
  return found;
}

/** Replace exactly one occurrence, so a mutation that no longer applies fails loudly. */
function mutate(text, from, to) {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `the mutation target is in the file once: ${from}`);
  return parts.join(to);
}

/** The one problem a mutation must produce, matched by its prefix. */
function onlyProblem(ciText, mainText, prefix) {
  const found = mainChecksProblems(ciText, mainText);
  assert.equal(found.length, 1, `exactly one problem, got:\n${found.join('\n')}`);
  assert.ok(found[0].startsWith(prefix), `"${found[0]}" starts with "${prefix}"`);
  return found[0];
}

test('main-checks.yml runs ci.yml\'s unit, knowledge and browser jobs on a push to main', () => {
  assert.deepEqual(mainChecksProblems(CI, MAIN), []);
});

test('main-checks.yml obeys project.ci-bounded and is not bound to a pull request', () => {
  const suites = browserSuites(JSON.parse(read('package.json')));
  assert.deepEqual(checkWorkflow(MAIN_PATH, MAIN, suites), []);
  const doc = parseYaml(MAIN);
  assert.deepEqual(doc.jobs.browser.strategy.matrix.browser, ['chromium', 'firefox', 'webkit']);
  assert.equal(doc.concurrency, undefined, 'no concurrency group: every merge gets its verdict');
});

test('mutation: a copied step drifts, here or in ci.yml', () => {
  const here = mutate(MAIN, '        run: npm test\n', '        run: npm test || true\n');
  assert.match(onlyProblem(CI, here, 'mirror: unit step'), /step 4/);
  const there = mutate(CI,
    'npm run test:browser 2>&1 | tee logs/browser-${{ matrix.browser }}.log\n'
    + '        timeout-minutes: 20\n',
    'npm run test:browser 2>&1 | tee logs/browser-${{ matrix.browser }}.log\n'
    + '        timeout-minutes: 25\n');
  onlyProblem(there, MAIN, 'mirror: browser step 6');
  const dropped = mutate(MAIN, '      - name: Committed dist/index.html matches a clean rebuild\n'
    + '        run: npm run build:check\n', '');
  onlyProblem(CI, dropped, 'mirror: unit step 6');
});

test('mutation: the Majordomus pin or a job budget differs from ci.yml', () => {
  const sha = MAIN.match(/MJ_SHA256: ([0-9a-f]{64})/)[1];
  const pin = mutate(MAIN, `MJ_SHA256: ${sha}`, `MJ_SHA256: ${'0'.repeat(64)}`);
  onlyProblem(CI, pin, 'mirror: knowledge.env');
  const pinned = CI.match(/\n {6}MJ_VERSION: (\S+)\n/)[1];
  const version = mutate(CI, `      MJ_VERSION: ${pinned}\n`, `      MJ_VERSION: ${pinned}.1\n`);
  onlyProblem(version, MAIN, 'mirror: knowledge.env');
  const budget = mutate(MAIN, '    name: unit, build, artifact rules\n    runs-on: ubuntu-latest\n'
    + '    timeout-minutes: 10\n', '    name: unit, build, artifact rules\n'
    + '    runs-on: ubuntu-latest\n    timeout-minutes: 30\n');
  onlyProblem(CI, budget, 'mirror: unit.timeout-minutes');
});

test('mutation: a browser leg is dropped', () => {
  const two = MAIN.replace('        browser: [chromium, firefox, webkit]\n',
    '        browser: [chromium, firefox]\n');
  assert.notEqual(two, MAIN);
  onlyProblem(CI, two, 'mirror: browser.strategy');
});

test('mutation: the pull-request-only size report is copied, or its exception goes stale', () => {
  const step = '      - name: Size of dist/index.html against the budget and the merge base'
    + ' (step summary)\n        if: ${{ !cancelled() }}\n        timeout-minutes: 2\n'
    + '        run: node scripts/size-report.mjs --base-branch "origin/$GITHUB_BASE_REF"\n';
  const copied = mutate(MAIN, '\n  knowledge:\n', `${step}\n  knowledge:\n`);
  const found = mainChecksProblems(CI, copied);
  assert.equal(found.length, 2, found.join('\n'));
  assert.ok(found[0].startsWith('mirror: unit step 8 ("Size of dist'), found[0]);
  assert.equal(found[1], 'mirror: unit reads the pull request, which a push to main has not');
  const renamed = mutate(CI,
    '- name: Size of dist/index.html against the budget and the merge base',
    '- name: Size of dist/index.html against the budget');
  const stale = mainChecksProblems(renamed, MAIN);
  assert.ok(stale.some((f) => f.startsWith('mirror: unit: the left-out step "Size of dist')),
    stale.join('\n'));
});

test('mutation: another trigger, another branch or a path filter', () => {
  const pr = mutate(MAIN, 'on:\n  push:\n', 'on:\n  pull_request:\n  push:\n');
  onlyProblem(CI, pr, 'triggers: main-checks.yml starts on pull_request, push');
  const manual = mutate(MAIN, '    branches: [main]\n',
    '    branches: [main]\n  workflow_dispatch:\n');
  onlyProblem(CI, manual, 'triggers: main-checks.yml starts on push, workflow_dispatch');
  const branch = mutate(MAIN, '    branches: [main]\n', '    branches: [main, develop]\n');
  onlyProblem(CI, branch, 'triggers: push.branches');
  const paths = mutate(MAIN, '    branches: [main]\n',
    '    branches: [main]\n    paths: [src/**]\n');
  onlyProblem(CI, paths, 'triggers: push filters by paths');
});

test('mutation: a gate job, an extra job, or a report that is quiet or blind', () => {
  const gate = mutate(MAIN, '\n  report:\n', '\n  gate:\n');
  const found = mainChecksProblems(CI, gate);
  assert.ok(found.some((f) => f.startsWith('jobs: gate is a gate job')), found.join('\n'));
  assert.ok(found.some((f) => f.startsWith('jobs: main-checks.yml has')), found.join('\n'));
  const named = mutate(MAIN, '    name: main is green (unit, knowledge, browser gate)\n',
    '    name: gate\n');
  onlyProblem(CI, named, 'jobs: report is a gate job');
  const needs = mutate(MAIN, '    needs: [unit, knowledge, browser]\n',
    '    needs: [unit, browser]\n');
  onlyProblem(CI, needs, 'report: needs does not list knowledge');
  const sometimes = mutate(MAIN, '    if: always()\n    needs:', '    needs:');
  onlyProblem(CI, sometimes, 'report: runs without `if: always()`');
  const quiet = mutate(MAIN, '            exit 1\n', '            exit 0\n');
  onlyProblem(CI, quiet, 'report: a failure neither annotates');
  const blind = MAIN.replaceAll('GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT');
  onlyProblem(CI, blind, 'report: writes no step summary');
});
