// project.ci-bounded: every job of every workflow is bounded, every step that installs,
// downloads or runs a browser suite is bounded by itself, installs go through
// .github/scripts/ci-install.sh, downloads retry and are digest-checked, actions are pinned and
// `gate` needs every other job of ci.yml. The checker is scripts/ci-workflow-rules.mjs; this
// file runs it on the repository (no violation) and on mutated copies of the real workflows
// (each mutation is found, by rule and by job), so the checker cannot pass by checking nothing.
// It generalises what tests/unit/ci-knowledge-job.test.mjs asserts of the `knowledge` job.
//   node --test tests/unit/ci-workflows.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from '../../scripts/yaml-subset.mjs';
import {
  browserSuites, checkRepository, checkScript, checkWorkflow, format, logicalLines,
  stepNeedsTimeout,
} from '../../scripts/ci-workflow-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const PKG = JSON.parse(read('package.json'));
const SUITES = browserSuites(PKG);
const CI = read('.github/workflows/ci.yml');
const PAGES = read('.github/workflows/pages.yml');
const INSTALL = read('.github/scripts/ci-install.sh');

/** Replace exactly one occurrence, so a mutation that no longer applies fails loudly. */
function mutate(text, from, to) {
  const parts = text.split(from);
  assert.ok(parts.length >= 2, `the mutation target is in the file: ${from}`);
  return parts[0] + to + parts.slice(1).join(from);
}
const rules = (violations) => violations.map((v) => `${v.rule}@${v.job ?? '-'}`);
const ci = (text) => checkWorkflow('.github/workflows/ci.yml', text, SUITES);

test('the repository has no violation', () => {
  const found = checkRepository(ROOT);
  assert.deepEqual(found.map(format), []);
});

test('every workflow file is read, and the checker sees their jobs and steps', () => {
  const files = readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes('ci.yml') && files.includes('pages.yml'));
  let jobs = 0;
  let bounded = 0;
  for (const f of files) {
    const doc = parse(read(`.github/workflows/${f}`));
    for (const job of Object.values(doc.jobs)) {
      jobs += 1;
      for (const step of job.steps || []) {
        if (typeof step.run === 'string' && stepNeedsTimeout(step.run, SUITES)) bounded += 1;
      }
    }
  }
  assert.ok(jobs >= 11, `jobs parsed: ${jobs}`);
  assert.ok(bounded >= 20, `steps recognised as install, download or browser suite: ${bounded}`);
});

test('the browser suites are derived from package.json', () => {
  for (const s of ['test:engine', 'test:dsp', 'test:labs', 'test:sequencer', 'test:measure',
    'test:studio', 'test:browser', 'test:visual', 'test:live', 'test:release', 'release-gate',
    'visual']) {
    assert.ok(SUITES.has(s), s);
  }
  for (const s of ['test', 'verify', 'build', 'version:check']) assert.ok(!SUITES.has(s), s);
  // every suite of the release gate is run by some job of ci.yml
  const runs = CI.match(/npm run [\w:.-]+/g).map((m) => m.slice(8));
  for (const s of PKG.scripts['test:release'].match(/npm run [\w:.-]+/g).map((m) => m.slice(8))) {
    assert.ok(runs.includes(s), `ci.yml runs ${s}`);
  }
});

test('mutation: a job without timeout-minutes', () => {
  const head = '    name: unit, build, artifact rules\n    runs-on: ubuntu-latest\n';
  const text = mutate(CI, `${head}    timeout-minutes: 10\n`, head);
  assert.deepEqual(rules(ci(text)), ['job-timeout@unit']);
  const zero = mutate(CI, '    runs-on: ubuntu-latest\n    timeout-minutes: 5\n',
    '    runs-on: ubuntu-latest\n    timeout-minutes: 0\n');
  assert.deepEqual(rules(ci(zero)), ['job-timeout@gate']);
});

test('mutation: a bare `npx playwright install --with-deps` step', () => {
  const text = mutate(CI, '      - name: Unit and freeze suites\n',
    '      - name: Install browsers\n        run: npx playwright install --with-deps\n'
    + '      - name: Unit and freeze suites\n');
  assert.deepEqual(rules(ci(text)), ['install-wrapper@unit', 'step-timeout@unit']);
  const bounded = mutate(CI, '      - name: Unit and freeze suites\n',
    '      - name: Install browsers\n        run: npx playwright install --with-deps\n'
    + '        timeout-minutes: 15\n      - name: Unit and freeze suites\n');
  assert.deepEqual(rules(ci(bounded)), ['install-wrapper@unit'], 'a timeout does not excuse it');
});

test('mutation: a bare apt install, in a workflow and in a helper script', () => {
  const text = mutate(CI, '          .github/scripts/ci-install.sh apt pulseaudio\n',
    '          sudo apt-get update -q && sudo apt-get install -y pulseaudio\n');
  assert.deepEqual(rules(ci(text)), ['install-wrapper@engine']);
  assert.deepEqual(checkScript('.github/scripts/other.sh', 'sudo apt-get -y install jq\n')
    .map((v) => v.rule), ['install-wrapper']);
  assert.deepEqual(checkScript('.github/scripts/ci-install.sh', INSTALL), []);
  assert.deepEqual(checkScript('.github/scripts/ci-install.sh',
    INSTALL.replaceAll('timeout --kill-after', 'env')).map((v) => v.rule), ['install-wrapper']);
});

test('mutation: an install, a download or a browser suite step without its own timeout', () => {
  const step = '        run: .github/scripts/ci-install.sh browser ${{ matrix.browser }}\n';
  const install = mutate(CI, `${step}        timeout-minutes: 15\n`, step);
  assert.deepEqual(rules(ci(install)), ['step-timeout@engine']);
  const suite = mutate(CI, 'logs/studio-${{ matrix.browser }}.log\n        timeout-minutes: 15\n',
    'logs/studio-${{ matrix.browser }}.log\n');
  assert.deepEqual(rules(ci(suite)), ['step-timeout@studio']);
  const download = mutate(CI, '(pinned version and digest)\n        timeout-minutes: 5\n',
    '(pinned version and digest)\n');
  assert.deepEqual(rules(ci(download)), ['step-timeout@knowledge']);
  const smoke = mutate(PAGES, '      - name: Public smoke of the deployed page (fatal)\n'
    + '        timeout-minutes: 5\n', '      - name: Public smoke of the deployed page (fatal)\n');
  assert.deepEqual(rules(checkWorkflow('pages.yml', smoke, SUITES)), ['step-timeout@smoke']);
});

test('mutation: a curl without --retry or --connect-timeout', () => {
  const noRetry = mutate(CI, " --retry 5 --retry-all-errors --retry-delay 5", '');
  assert.deepEqual(rules(ci(noRetry)), ['curl-flags@knowledge']);
  assert.match(ci(noRetry)[0].message, /curl without --retry <n>/);
  const noConnect = mutate(CI, ' --connect-timeout 20', '');
  assert.deepEqual(rules(ci(noConnect)), ['curl-flags@knowledge']);
  assert.match(ci(noConnect)[0].message, /curl without --connect-timeout <s>/);
  assert.deepEqual(checkScript('.github/scripts/x.sh', 'wget https://example.org/a.tgz\n')
    .map((v) => v.rule), ['curl-flags', 'download-digest']);
});

test('mutation: a download that is not checked against a pinned digest', () => {
  const unchecked = mutate(CI,
    '          echo "${MJ_SHA256}  $RUNNER_TEMP/$a" | sha256sum -c -\n', '');
  assert.deepEqual(rules(ci(unchecked)), ['download-digest@knowledge']);
  const unpinned = CI.replace(/\n {6}MJ_SHA256: [0-9a-f]{64}\n/, '\n');
  assert.notEqual(unpinned, CI);
  assert.deepEqual(rules(ci(unpinned)), ['download-digest@knowledge']);
  const piped = mutate(CI, '      - name: The installed version is the pinned one\n',
    '      - name: Installer\n        timeout-minutes: 5\n        run: curl -fsSL --retry 3'
    + ' --connect-timeout 20 https://majordomus.dev/install.sh | sh\n'
    + '      - name: The installed version is the pinned one\n');
  assert.deepEqual(rules(ci(piped)), ['pipe-to-shell@knowledge']);
});

test('mutation: a job that gate does not need', () => {
  for (const job of Object.keys(parse(CI).jobs).filter((j) => j !== 'gate')) {
    const text = CI.replace(/(\n {4}needs: \[)([^\]]*)(\])/, (_, a, list, c) => a
      + list.split(',').map((s) => s.trim()).filter((s) => s !== job).join(', ') + c);
    assert.notEqual(text, CI, `${job} is in gate.needs`);
    const found = ci(text);
    assert.deepEqual(rules(found), ['gate-needs@gate'], job);
    assert.ok(found[0].message.endsWith(`: ${job}`), found[0].message);
  }
  const added = `${CI}\n  extra:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n`
    + '    steps:\n      - run: echo extra\n';
  assert.deepEqual(rules(ci(added)), ['gate-needs@gate'], 'a new job nobody added to needs');
  const conditional = mutate(CI, '    name: gate\n    if: always()\n', '    name: gate\n');
  assert.deepEqual(rules(ci(conditional)), ['gate-needs@gate'], 'gate that a failed job skips');
});

test('mutation: an action on a branch, an image without a tag', () => {
  const branch = mutate(CI, 'uses: actions/checkout@v7', 'uses: actions/checkout@main');
  assert.deepEqual(rules(ci(branch)), ['pinned@unit']);
  const latest = mutate(CI, 'playwright:v1.63.0-noble', 'playwright:latest');
  assert.deepEqual(rules(ci(latest)), ['pinned@visual']);
  const untagged = mutate(CI, 'playwright:v1.63.0-noble', 'playwright');
  assert.deepEqual(rules(ci(untagged)), ['pinned@visual']);
});

test('the gate fails on any job that did not succeed', () => {
  const gate = parse(CI).jobs.gate;
  const run = gate.steps.map((s) => s.run || '').join('\n');
  assert.match(run, /all\(\.value\.result == "success"\)/);
  assert.match(run, /exit 1/);
});

test('shell lines: continuations are one command, comments are not commands', () => {
  assert.deepEqual(logicalLines('curl -f \\\n  --retry 3 x\n# curl y\n\necho ok # curl z\n'),
    ['curl -f    --retry 3 x', 'echo ok']);
  const commented = '# sudo apt-get install -y pulseaudio\necho ok\n';
  assert.deepEqual(checkScript('.github/scripts/x.sh', commented), []);
});
