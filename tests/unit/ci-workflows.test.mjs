// project.ci-bounded: every job of every workflow is bounded, every step that installs,
// downloads or runs a browser suite is bounded by itself, installs go through
// .github/scripts/ci-install.sh, downloads retry and are digest-checked, actions are pinned and
// `gate` needs every other job of ci.yml, nothing is made non-fatal, and ci.yml starts on a
// pull request only. The checker is scripts/ci-workflow-rules.mjs; this
// file runs it on the repository (no violation) and on mutated copies of the real workflows
// (each mutation is found, by rule and by job), so the checker cannot pass by checking nothing.
// It generalises what tests/unit/ci-knowledge-job.test.mjs asserts of the `knowledge` job.
//   node --test tests/unit/ci-workflows.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync }
  from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from '../../scripts/yaml-subset.mjs';
import {
  actionNeedsTimeout, browserSuites, checkAction, checkRepository, checkScript, checkWorkflow,
  format, logicalLines, QUEUE_SAFE_CANCEL, stepNeedsTimeout,
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

/** ci.yml with one more step at the head of the `unit` job (bounded unless `timeout` is 0). */
function withStep(run, { timeout = 3, extra = '' } = {}) {
  const body = run.split('\n').map((l) => `          ${l}\n`).join('');
  return mutate(CI, '      - name: Unit and freeze suites\n',
    `      - name: Probe\n${timeout ? `        timeout-minutes: ${timeout}\n` : ''}${extra}`
    + `        run: |\n${body}      - name: Unit and freeze suites\n`);
}
const CURL = 'curl -fsSL --retry 3 --connect-timeout 5';

/** A scratch copy of .github and package.json, with more files; removed after the test. */
function scratch(t, files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-ci-rules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(ROOT, '.github'), path.join(dir, '.github'), { recursive: true });
  cpSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

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
  const head = '    name: unit, build, artifact rules\n    runs-on: ubuntu-24.04\n';
  const text = mutate(CI, `${head}    timeout-minutes: 10\n`, head);
  assert.deepEqual(rules(ci(text)), ['job-timeout@unit']);
  const zero = mutate(CI, '    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n',
    '    runs-on: ubuntu-24.04\n    timeout-minutes: 0\n');
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
  const added = `${CI}\n  extra:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n`
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

test('mutation: a runner image that moves (runs-on ubuntu-latest) is refused', () => {
  const head = '    name: unit, build, artifact rules\n    runs-on: ubuntu-24.04\n';
  const latest = mutate(CI, head, head.replace('ubuntu-24.04', 'ubuntu-latest'));
  assert.deepEqual(rules(ci(latest)), ['pinned@unit']);
  const listed = mutate(CI, head, head.replace('ubuntu-24.04', '[self-hosted, ubuntu-latest]'));
  assert.deepEqual(rules(ci(listed)), ['pinned@unit']);
  const pages = mutate(PAGES, '    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-latest\n');
  const found = checkWorkflow('.github/workflows/pages.yml', pages, SUITES);
  assert.deepEqual(found.map((v) => v.rule), ['pinned'], 'pages.yml on ubuntu-latest');
});

test('mutation: a moving runner hidden in a matrix, a group, an expression or another OS', () => {
  // One job, every other rule satisfied, so only `pinned` can fire.
  const job = (runsOn, extra = '') => 'on: pull_request\njobs:\n  probe:\n'
    + `    runs-on: ${runsOn}\n    timeout-minutes: 5\n${extra}    steps:\n      - run: echo ok\n`;
  const pinned = (text) => checkWorkflow('.github/workflows/probe.yml', text, SUITES)
    .filter((v) => v.rule === 'pinned').map((v) => v.message);
  const matrix = (os) => `    strategy:\n      matrix:\n        os: [${os}]\n`;
  assert.deepEqual(pinned(job('ubuntu-24.04')), [], 'a pinned literal passes');
  assert.deepEqual(pinned(job('${{ matrix.os }}', matrix('ubuntu-24.04, macos-15'))), [],
    'a matrix of pinned images passes');
  for (const [what, text] of [
    ['matrix value', job('${{ matrix.os }}', matrix('ubuntu-24.04, macos-latest'))],
    ['matrix include row', job('${{ matrix.os }}', '    strategy:\n      matrix:\n'
      + '        browser: [chromium]\n        include:\n          - os: windows-latest\n')],
    ['runner group labels', job('{ group: hosted, labels: [ubuntu-latest] }')],
    ['macos-latest', job('macos-latest')],
    ['windows-latest', job('windows-latest')],
    ['another case', job('Ubuntu-Latest')],
    ['a container job', job('ubuntu-latest', '    container:\n      image: node:22.11.0\n')],
  ]) assert.equal(pinned(text).length, 1, what);
  assert.match(pinned(job('${{ inputs.os }}'))[0], /cannot resolve/, 'an unresolvable expression');
  assert.match(pinned(job('${{ matrix.os }}'))[0], /no values/, 'a matrix key with no values');
});

test('the gate fails on any job that did not succeed, but a skip E026 path gating made', () => {
  // The verdict itself is run with jq on every combination of results in
  // tests/unit/ci-changes.test.mjs; here, that the gate's step applies it and fails on it.
  const gate = parse(CI).jobs.gate;
  const run = gate.steps.map((s) => s.run || '').join('\n');
  assert.match(gate.steps.at(-1).env.VERDICT, /all\(\.value\.result == "success"/);
  assert.match(run, /jq -e "\$VERDICT"/);
  assert.match(run, /exit 1/);
});

test('shell lines: continuations are one command, comments are not commands', () => {
  assert.deepEqual(logicalLines('curl -f \\\n  --retry 3 x\n# curl y\n\necho ok # curl z\n'),
    ['curl -f    --retry 3 x', 'echo ok']);
  const commented = '# sudo apt-get install -y pulseaudio\necho ok\n';
  assert.deepEqual(checkScript('.github/scripts/x.sh', commented), []);
});

test('mutation: apt behind an option that takes a value, or any other apt command', () => {
  for (const run of [
    'sudo apt-get -o Acquire::Retries=3 install -y pulseaudio',
    'sudo apt-get -t noble install -y pulseaudio',
    'sudo apt-get --option Acquire::Retries=3 update',
    'sudo DEBIAN_FRONTEND=noninteractive apt install pulseaudio',
    'sh -c "apt-get -o Dpkg::Use-Pty=0 install -y jq"',
    'sudo dpkg --force-all -i pulseaudio.deb',
  ]) {
    assert.deepEqual(rules(ci(withStep(run, { timeout: 0 }))),
      ['install-wrapper@unit', 'step-timeout@unit'], run);
    assert.deepEqual(rules(ci(withStep(run))), ['install-wrapper@unit'], run);
    assert.deepEqual(checkScript('scripts/setup-ci.sh', `${run}\n`).map((v) => v.rule),
      ['install-wrapper'], run);
  }
  // the wrapper's own mode word and a path that contains the name are not the program
  for (const run of ['.github/scripts/ci-install.sh apt pulseaudio', 'ls /etc/apt/sources.list.d',
    'dpkg -l pulseaudio']) {
    assert.deepEqual(rules(ci(withStep(run))), [], run);
  }
});

test('mutation: a download kept by a redirect, a tee or the log, with no digest check', () => {
  for (const run of [
    `${CURL} https://x.example/t.tgz > t.tgz\ntar xzf t.tgz`,
    `${CURL} https://x.example/t.tgz >> t.tgz`,
    `${CURL} https://x.example/t.tgz | tee t.tgz > /dev/null`,
    `${CURL} https://x.example/version.txt`,
    `${CURL} -o i.sh https://x.example/i.sh && sh i.sh`,
    'wget --tries=3 --connect-timeout=5 https://x.example/t.tgz',
  ]) {
    assert.deepEqual(rules(ci(withStep(run))), ['download-digest@unit'], run);
  }
  const checked = `${CURL} https://x.example/t.tgz > t.tgz\n`
    + `echo "${'a'.repeat(64)}  t.tgz" | sha256sum -c -`;
  assert.deepEqual(rules(ci(withStep(checked))), [], 'checked against a pinned digest');
  // a probe that says it keeps nothing needs only the flags, and still its own time limit
  const probe = `${CURL} -o /dev/null https://x.example/health`;
  assert.deepEqual(rules(ci(withStep(probe))), []);
  assert.deepEqual(rules(ci(withStep(probe, { timeout: 0 }))), ['step-timeout@unit']);
  assert.deepEqual(rules(ci(withStep(`${CURL} -o /dev/null https://x.example/i.sh | sh`))),
    ['pipe-to-shell@unit'], 'a discarded output that is piped on is not discarded');
});

test('mutation: a download that is executed, in every form', () => {
  for (const run of [
    `bash <(${CURL} https://x.example/install.sh)`,
    `sh -c "$(${CURL} https://x.example/install.sh)"`,
    `s=$(${CURL} https://x.example/install.sh); eval "$s"`,
    `s=\`${CURL} https://x.example/install.sh\``,
    `${CURL} https://x.example/install.sh > i.txt\neval "$(cat i.txt)"`,
    `${CURL} https://x.example/install.py | python3 -`,
    `${CURL} https://x.example/install.js | node`,
    `${CURL} https://x.example/install.pl | perl`,
    `${CURL} https://x.example/install.rb | ruby`,
    `${CURL} https://x.example/install.sh | sudo -E bash -s -- --yes`,
    `${CURL} https://x.example/install.sh | env A=1 /bin/sh`,
    `${CURL} https://x.example/install.sh.gz | gunzip | zsh`,
    'wget --tries=3 --connect-timeout=5 -qO- https://x.example/install.sh | sh',
  ]) {
    assert.deepEqual(rules(ci(withStep(run))), ['pipe-to-shell@unit'], run);
  }
  // a digest check does not excuse running what was fetched before it was checked
  const late = `${CURL} https://x.example/i.sh | bash\n`
    + `echo "${'a'.repeat(64)}  i.sh" | sha256sum -c -`;
  assert.deepEqual(rules(ci(withStep(late))), ['pipe-to-shell@unit']);
});

test('mutation: a job, a step or a suite made non-fatal', () => {
  const job = mutate(CI, '    name: review-verdict (guarded paths need a recorded review)\n',
    '    name: review-verdict (guarded paths need a recorded review)\n'
    + '    continue-on-error: true\n');
  assert.deepEqual(rules(ci(job)), ['non-fatal@review-verdict']);
  const stepName = '      - name: A guarded change carries a verdict for the content it changes\n';
  const step = mutate(CI, stepName, stepName
    + '        continue-on-error: true\n');
  assert.deepEqual(rules(ci(step)), ['non-fatal@review-verdict']);
  const expression = mutate(CI, '      - name: Unit and freeze suites\n',
    '      - name: Unit and freeze suites\n        continue-on-error: ${{ matrix.soft }}\n');
  assert.deepEqual(rules(ci(expression)), ['non-fatal@unit']);
  for (const run of ['npm run test:studio 2>&1 || true | tee studio.log',
    'npm run test:engine || :', '.github/scripts/ci-install.sh browser webkit || true',
    'node tests/browser/dsp.cjs || true']) {
    assert.deepEqual(rules(ci(withStep(run))), ['non-fatal@unit'], run);
  }
  assert.deepEqual(rules(ci(withStep('rm -f old.log || true'))), [], 'cleanup may fail');
  const pages = mutate(PAGES, '    name: Public smoke (${{ matrix.browser }})\n',
    '    name: Public smoke (${{ matrix.browser }})\n    continue-on-error: true\n');
  assert.deepEqual(rules(checkWorkflow('pages.yml', pages, SUITES)), ['non-fatal@smoke']);
});

test('mutation: a browser suite started without its npm script, or gh, with no step limit', () => {
  for (const run of ['cd tests/browser && node dsp.cjs', 'npx playwright test',
    'node tests/visual/compare.mjs', '(cd tests/browser; node engine.cjs)',
    'gh search prs --repo x/y', 'n=$(gh label list | wc -l)']) {
    assert.deepEqual(rules(ci(withStep(run, { timeout: 0 }))), ['step-timeout@unit'], run);
    assert.deepEqual(rules(ci(withStep(run))), [], run);
  }
});

test('mutation: an install in a composite action or in a script outside .github', (t) => {
  const action = 'name: setup\nruns:\n  using: composite\n  steps:\n'
    + '    - name: Browsers\n      shell: bash\n      run: npx playwright install --with-deps\n'
    + '    - uses: actions/setup-node@main\n';
  assert.deepEqual(checkAction('.github/actions/setup/action.yml', action, SUITES)
    .map((v) => `${v.rule}@${v.step}`),
  ['install-wrapper@Browsers', 'pinned@actions/setup-node@main']);
  assert.match(actionNeedsTimeout(action, SUITES), /uses an action that runs playwright install/);

  const wrapped = 'name: setup\nruns:\n  using: composite\n  steps:\n'
    + '    - shell: bash\n      run: .github/scripts/ci-install.sh browser chromium\n';
  const uses = (limit) => mutate(CI, '      - name: Unit and freeze suites\n',
    `      - uses: ./.github/actions/setup\n${limit}      - name: Unit and freeze suites\n`);
  const root = scratch(t, {
    '.github/actions/setup/action.yml': wrapped,
    '.github/workflows/ci.yml': uses(''),
    'scripts/setup-ci.sh': '#!/bin/sh\nnpx playwright install --with-deps\n',
    'scripts/fetch.sh': `${CURL} https://x.example/i.sh | sh\n`,
  });
  assert.deepEqual(checkRepository(root).map((v) => `${v.rule}@${v.file}`).sort(), [
    'install-wrapper@scripts/setup-ci.sh',
    'pipe-to-shell@scripts/fetch.sh',
    'step-timeout@.github/workflows/ci.yml',
  ]);
  const bounded = scratch(t, {
    '.github/actions/setup/action.yml': wrapped,
    '.github/workflows/ci.yml': uses('        timeout-minutes: 15\n'),
  });
  assert.deepEqual(checkRepository(bounded).map(format), []);
  const bare = scratch(t, { '.github/actions/setup/action.yml': action });
  assert.deepEqual(checkRepository(bare).map((v) => v.rule), ['install-wrapper', 'pinned']);
});

test('a job that calls a reusable workflow carries no limit of its own, but is pinned', () => {
  const job = (uses) => mutate(CI, '\n  gate:\n', `\n  reuse:\n    uses: ${uses}\n\n  gate:\n`)
    .replace('needs: [unit,', 'needs: [reuse, unit,');
  assert.deepEqual(rules(ci(job('./.github/workflows/pages.yml'))), []);
  assert.deepEqual(rules(ci(job('octo/shared/.github/workflows/x.yml@v2'))), []);
  assert.deepEqual(rules(ci(job('octo/shared/.github/workflows/x.yml@main'))), ['pinned@reuse']);
});

test('mutation: ci.yml started by anything but a pull request and its merge queue', () => {
  assert.deepEqual(Object.keys(parse(CI).on), ['pull_request', 'merge_group']);
  const manual = mutate(CI, '\non:\n  pull_request:\n  merge_group:\n',
    '\non:\n  pull_request:\n  merge_group:\n  workflow_dispatch:\n');
  assert.deepEqual(rules(ci(manual)), ['triggers@-']);
  assert.match(ci(manual)[0].message, /not by: pull_request, merge_group, workflow_dispatch/);
  const push = mutate(CI, '\non:\n  pull_request:\n  merge_group:\n', '\non: [push]\n');
  assert.deepEqual(rules(ci(push)), ['triggers@-']);
  const queueOnly = mutate(CI, '\non:\n  pull_request:\n  merge_group:\n',
    '\non:\n  merge_group:\n');
  assert.deepEqual(rules(ci(queueOnly)), ['triggers@-'], 'the queue alone judges no pull request');
  // review F4 (w2): push beside both is refused too; the set is exactly these two
  for (const extra of ['push', 'workflow_dispatch', 'pull_request_target', 'schedule']) {
    const more = mutate(CI, '\non:\n  pull_request:\n  merge_group:\n',
      `\non:\n  pull_request:\n  merge_group:\n  ${extra}:\n`);
    assert.deepEqual(rules(ci(more)), ['triggers@-'], extra);
  }
  assert.deepEqual(rules(ci(mutate(CI, '\non:\n  pull_request:\n  merge_group:\n',
    '\non: [pull_request, merge_group, push]\n'))), ['triggers@-'], 'flow list');
  const prOnly = mutate(CI, '\non:\n  pull_request:\n  merge_group:\n', '\non:\n  pull_request:\n');
  assert.deepEqual(rules(ci(prOnly)), [], 'without the queue (ADR 0083 not yet switched on)');
  // pages.yml has no gate: it deploys main and may be started by hand
  assert.deepEqual(checkWorkflow('pages.yml', PAGES, SUITES), []);
});

/** What keeps the size step of `unit` from reporting a pull request over the budget. */
function problemsOfSizeStep(text) {
  const steps = parse(text).jobs.unit.steps.filter((s) => typeof s.run === 'string'
    && s.run.includes('scripts/size-report.mjs'));
  if (steps.length !== 1) return [`${steps.length} size steps in the unit job`];
  const [step] = steps;
  const out = [];
  if (step.if !== '${{ !cancelled() }}') out.push(`if is ${JSON.stringify(step.if)}`);
  if (!(Number(step['timeout-minutes']) > 0)) out.push('no timeout-minutes');
  if (step['continue-on-error'] !== undefined) out.push('continue-on-error');
  // it only reports: the program and its tee into the summary, nothing that gates on a size
  const run = 'node scripts/size-report.mjs --base-branch'
    + ' "origin/${GITHUB_BASE_REF:-${QUEUE_BASE#refs/heads/}}" \\\n'
    + '  | tee -a "$GITHUB_STEP_SUMMARY"\n';
  if (step.run !== run) out.push(`run is ${JSON.stringify(step.run)}`);
  return out;
}

test('E022: the size step reports a pull request over the budget, bounded and never gating',
  () => {
    // #208 R-2: verify-dist fails the job over the budget; the size step still writes the
    // summary then, because it runs unless the run was cancelled.
    assert.deepEqual(problemsOfSizeStep(CI), []);
    const name = '      - name: Size of dist/index.html against the budget and the merge base '
      + '(step summary)\n';
    const always = '        if: ${{ !cancelled() }}\n';
    assert.deepEqual(problemsOfSizeStep(mutate(CI, always, '')), ['if is undefined']);
    assert.deepEqual(problemsOfSizeStep(mutate(CI, always, '        if: success()\n')),
      ['if is "success()"']);
    assert.deepEqual(problemsOfSizeStep(mutate(CI, '        timeout-minutes: 2\n        run: |\n'
      + '          node scripts/size-report.mjs', '        run: |\n'
      + '          node scripts/size-report.mjs')), ['no timeout-minutes']);
    const gated = mutate(CI, '| tee -a "$GITHUB_STEP_SUMMARY"\n',
      '| tee -a "$GITHUB_STEP_SUMMARY"\n          grep -q "within the threshold" '
      + '"$GITHUB_STEP_SUMMARY"\n');
    assert.equal(problemsOfSizeStep(gated).length, 1);
    assert.match(problemsOfSizeStep(gated)[0], /^run is /);
    assert.ok(CI.includes(name), 'the step keeps its name');
  });

test('the pull-request rules are judged by the base branch\'s programs, and need a PR', () => {
  const jobs = parse(CI).jobs;
  for (const [job, call] of [
    ['fail-first', '.github/scripts/base-rule.sh "origin/$BASE" scripts/fail-first.mjs'
      + ' --pr-json "$RUNNER_TEMP/pr.json" --head "$HEAD_SHA"'
      + ' --base-branch "origin/$BASE"'],
    ['review-verdict', '.github/scripts/base-rule.sh "origin/$BASE"'
      + ' scripts/review-verdict.mjs --pr "$PR" --head HEAD'
      + ' --base-branch "$DIFF_BASE"'],
  ]) {
    assert.deepEqual(problemsOfRuleJob(jobs[job], call), [], job);
  }
  // fail-first judges the pull request's head: the event's on pull_request, else headRefOid,
  // which --check-head has just held equal to the queue's HEAD^2 (review F1, mutant y5)
  const ff = logicalLines(jobs['fail-first'].steps.at(-1).run).map((l) => l.replace(/\s+/g, ' '));
  const fallback = '[ -n "$HEAD_SHA" ] || HEAD_SHA="$(jq -r .headRefOid "$RUNNER_TEMP/pr.json")"';
  assert.equal(ff.at(-2), fallback, 'the head fallback just before the call');
  assert.equal(ff.at(-3), CHECK_HEAD('"$RUNNER_TEMP/pr.json"'), 'checked against the queue');
  assert.equal(jobs['fail-first'].steps.at(-1).env.HEAD_SHA,
    '${{ github.event.pull_request.head.sha }}');
});

test('mutation: fail-first without its head fallback or its queue check (review F1, y5)', () => {
  const lines = (text) => logicalLines(parse(text).jobs['fail-first'].steps.at(-1).run)
    .map((l) => l.replace(/\s+/g, ' '));
  const fallback = '          [ -n "$HEAD_SHA" ] || HEAD_SHA="$(jq -r .headRefOid'
    + ' "$RUNNER_TEMP/pr.json")"\n';
  const call = logicalLines(parse(CI).jobs['fail-first'].steps.at(-1).run).at(-1)
    .replace(/\s+/g, ' ');
  const without = parse(mutate(CI, fallback, '')).jobs['fail-first'];
  assert.ok(!lines(mutate(CI, fallback, '')).some((l) => l.includes('headRefOid "$RUNNER')));
  assert.notDeepEqual(problemsOfRuleJob(without, call, '"$RUNNER_TEMP/pr.json"', true), []);
  const unchecked = parse(mutate(CI, '          .github/scripts/queued-pr.sh --check-head'
    + ' "$QUEUED_HEAD" "$RUNNER_TEMP/pr.json"\n', '')).jobs['fail-first'];
  assert.match(problemsOfRuleJob(unchecked, call, '"$RUNNER_TEMP/pr.json"', true).join(),
    /does not check the queued head/);
});

// scripts/fail-first.mjs knows a train by its head branch (train/...) as well as its title, and
// reads the branch from the PR JSON this step writes: without headRefName in the --json list
// the branch rule silently stops in CI and only the title is left.
/** The fields the fail-first job's `gh pr view --json` asks for, or [] when it asks none. */
function failFirstPrFields(job) {
  const run = String(job.steps.at(-1).run || '');
  const m = run.match(/\bgh pr view\b[^\n]*?--json[ =]([\w,]+)/);
  return m ? m[1].split(',') : [];
}

test('the fail-first job reads the PR\'s title, body and head branch', () => {
  const fields = failFirstPrFields(parse(CI).jobs['fail-first']);
  for (const f of ['title', 'body', 'headRefName']) assert.ok(fields.includes(f), f);
  const without = parse(mutate(CI, '--json title,body,headRefName', '--json title,body'))
    .jobs['fail-first'];
  assert.ok(!failFirstPrFields(without).includes('headRefName'));
});

// scripts/review-verdict.mjs knows a train, and reads its members, from the PR JSON this step
// writes and names in PR_JSON (#303 rode #367 with its own verdict at `changes`): without the
// file, or with the variable gone, the member check silently stops in CI.
/** What keeps the review-verdict step from handing the PR to the program: [] when nothing. */
function problemsOfVerdictPrJson(job) {
  const out = [];
  const last = job.steps.at(-1);
  const fields = failFirstPrFields(job);
  for (const f of ['title', 'body', 'headRefName']) {
    if (!fields.includes(f)) out.push(`gh pr view does not ask for ${f}`);
  }
  if (last.env?.PR_JSON !== '${{ runner.temp }}/pr.json') out.push('PR_JSON is not the file');
  if (!/--json[ =][\w,]+ > "\$PR_JSON"/.test(String(last.run || ''))) {
    out.push('gh pr view does not write $PR_JSON');
  }
  if (job.permissions?.['pull-requests'] !== 'read') out.push('no pull-requests: read');
  return out;
}

test('the review-verdict job hands the PR\'s title, body and head branch over in PR_JSON', () => {
  assert.deepEqual(problemsOfVerdictPrJson(parse(CI).jobs['review-verdict']), []);
  const edited = (from, to) => problemsOfVerdictPrJson(parse(mutate(CI, from, to))
    .jobs['review-verdict']);
  const env = '          PR_JSON: ${{ runner.temp }}/pr.json\n';
  assert.deepEqual(edited(env, ''), ['PR_JSON is not the file']);
  assert.deepEqual(edited('--json title,body,headRefName,headRefOid > "$PR_JSON"',
    '--json title,headRefName,headRefOid > "$PR_JSON"'), ['gh pr view does not ask for body']);
  assert.deepEqual(edited('--json title,body,headRefName,headRefOid > "$PR_JSON"',
    '--json title,body,headRefName,headRefOid > /dev/null'),
  ['gh pr view does not write $PR_JSON']);
});

/** The line that holds the queue's HEAD^2 to the pull request's headRefOid (review F1). */
const CHECK_HEAD = (json) => `.github/scripts/queued-pr.sh --check-head "$QUEUED_HEAD" ${json}`;
/** The one form of the queued-pr.sh call: assigned first, so its exit 2 fails the step (F2). */
const QUEUED_PR = 'vars="$(.github/scripts/queued-pr.sh)"; eval "$vars"';

/**
 * What stops a rule job from judging: [] when its last command is exactly `call`. `json` is
 * the file its `gh pr view` writes, which --check-head reads; fail-first (`withFallback`) also
 * keeps its headRefOid fallback just before the call.
 */
function problemsOfRuleJob(job, call, json = job?.name?.startsWith('fail-first')
  ? '"$RUNNER_TEMP/pr.json"' : '"$PR_JSON"', withFallback = job?.name?.startsWith('fail-first')) {
  const out = [];
  if (job.if !== undefined) out.push('the job is conditional');
  const last = job.steps.at(-1);
  if (job.steps.some((s) => s.if !== undefined)) out.push('a step is conditional');
  if (last.env?.PR !== '${{ github.event.pull_request.number }}') {
    out.push('PR is not the event\'s');
  }
  // ADR 0083: in the merge queue the pull request is the one the queue ref names
  if (last.env?.QUEUE_REF !== '${{ github.event.merge_group.head_ref }}') {
    out.push('QUEUE_REF is not the merge group\'s');
  }
  if (last.shell !== undefined) out.push('the step sets its own shell');
  const run = logicalLines(last.run).map((l) => l.replace(/\s+/g, ' '));
  // the whole line: no `|| true`, no `;`, no `if` around it, no other arguments
  if (run.at(-1) !== call) out.push(`the last command is not the call: ${run.at(-1)}`);
  if (!run.some((l) => /^if \[ -z "\$PR" \]; then .*exit 1; fi$/.test(l))) {
    out.push('it does not fail when there is no pull request');
  }
  if (!run.some((l) => l === QUEUED_PR)) out.push('it does not read the queued pull request');
  // `eval "$(...)"` carries on after the script's exit 2 under bash -e (review F2)
  if (run.some((l) => /\beval\s+"\$\(/.test(l))) out.push('an eval of a command substitution');
  const at = run.indexOf(CHECK_HEAD(json));
  const view = run.findIndex((l) => /^until gh pr view /.test(l));
  if (at < 0 || view < 0 || at < view) out.push('it does not check the queued head');
  if (withFallback && run.at(-2) !== '[ -n "$HEAD_SHA" ] || HEAD_SHA="$(jq -r .headRefOid'
    + ' "$RUNNER_TEMP/pr.json")"') {
    out.push('no head fallback before the call');
  }
  if (!/--json[ =][\w,]*\bheadRefOid\b/.test(run.find((l) => /gh pr view/.test(l)) || '')) {
    out.push('gh pr view does not ask for headRefOid');
  }
  if (run.some((l) => /\bexit 0\b|\bset \+e\b/.test(l))) out.push('an early success');
  return out;
}

test('mutation: a rule job whose call can no longer refuse', () => {
  const real = parse(CI).jobs['review-verdict'];
  const call = logicalLines(real.steps.at(-1).run).at(-1).replace(/\s+/g, ' ');
  assert.deepEqual(problemsOfRuleJob(real, call), []);
  const edited = (from, to) => parse(mutate(CI, from, to)).jobs['review-verdict'];
  const tail = '--pr "$PR" --head HEAD --base-branch "$DIFF_BASE"\n';
  for (const [name, job] of [
    ['|| true', edited(tail, `${tail.trimEnd()} || true\n`)],
    ['judges the base against itself', edited('--head HEAD --base-branch',
      '--head "origin/$BASE" --base-branch')],
    ['another base', edited(tail, tail.replace('--base-branch "$DIFF_BASE"',
      '--base HEAD'))],
    ['no queued pull request', edited('          vars="$(.github/scripts/queued-pr.sh)"; eval'
      + ' "$vars"\n          if [ -z "$PR" ]; then echo "::error::review-verdict',
      '          if [ -z "$PR" ]; then echo "::error::review-verdict')],
    ['eval of a substitution (F2)', edited('          vars="$(.github/scripts/queued-pr.sh)";'
      + ' eval "$vars"\n          if [ -z "$PR" ]; then echo "::error::review-verdict',
      '          vars="$(.github/scripts/queued-pr.sh)"; eval "$vars"\n'
      + '          eval "$(.github/scripts/queued-pr.sh)"\n'
      + '          if [ -z "$PR" ]; then echo "::error::review-verdict')],
    ['eval alone (F2)', edited('          vars="$(.github/scripts/queued-pr.sh)"; eval'
      + ' "$vars"\n          if [ -z "$PR" ]; then echo "::error::review-verdict',
      '          eval "$(.github/scripts/queued-pr.sh)"\n'
      + '          if [ -z "$PR" ]; then echo "::error::review-verdict')],
    ['no queued-head check (F1)', edited('          .github/scripts/queued-pr.sh --check-head'
      + ' "$QUEUED_HEAD" "$PR_JSON"\n', '')],
    ['no headRefOid (F1)', edited('--json title,body,headRefName,headRefOid > "$PR_JSON"',
      '--json title,body,headRefName > "$PR_JSON"')],
    ['a command after it', edited(tail, `${tail}          echo done\n`)],
    ['wrapped in if', edited('          .github/scripts/base-rule.sh "origin/$BASE"'
      + ' scripts/review-verdict.mjs', '          if true; then exit 0; fi\n'
      + '          .github/scripts/base-rule.sh "origin/$BASE"'
      + ' scripts/review-verdict.mjs')],
    ['conditional job', edited('    name: review-verdict (guarded paths need a recorded review)\n',
      '    name: review-verdict (guarded paths need a recorded review)\n'
      + '    if: github.actor != \'x\'\n')],
    ['conditional step', edited(
      '      - name: A guarded change carries a verdict for the content it changes\n',
      '      - name: A guarded change carries a verdict for the content it changes\n'
      + '        if: false\n')],
    ['own copy', edited('.github/scripts/base-rule.sh "origin/$BASE" scripts/review',
      'node scripts/review')],
  ]) {
    assert.notDeepEqual(problemsOfRuleJob(job, call), [], name);
  }
  const ff = parse(mutate(CI, '--pr-json "$RUNNER_TEMP/pr.json"', '--title "chore: x"'))
    .jobs['fail-first'];
  assert.match(problemsOfRuleJob(ff, 'x').join('\n'), /the last command is not the call/);
});

test('mutation: an install behind an npm script', (t) => {
  for (const [name, cmd] of [['browsers', 'playwright install --with-deps chromium'],
    ['postinstall', 'npx playwright install --with-deps'],
    ['prepare', 'sudo apt-get install -y pulseaudio']]) {
    const pkg = { ...PKG, scripts: { ...PKG.scripts, [name]: cmd } };
    const root = scratch(t, { 'package.json': JSON.stringify(pkg) });
    assert.deepEqual(checkRepository(root).map((v) => `${v.rule}@${v.file}:${v.step}`),
      [`install-wrapper@package.json:scripts.${name}`], name);
  }
});

test('mutation: apt by its path; a suite behind npm options, node --run or yarn', () => {
  for (const run of ['sudo /usr/bin/apt-get install -y x', '/usr/local/sbin/dpkg -i x.deb',
    '/bin/apt update']) {
    assert.deepEqual(rules(ci(withStep(run))), ['install-wrapper@unit'], run);
  }
  assert.deepEqual(rules(ci(withStep('ls /etc/apt /var/lib/dpkg'))), []);
  for (const run of ['npm run -s test:studio', 'npm --silent run test:studio',
    'npm run-script --silent test:engine', 'node --run test:studio', 'yarn test:studio',
    'yarn run test:studio', 'pnpm run test:studio']) {
    assert.deepEqual(rules(ci(withStep(run, { timeout: 0 }))), ['step-timeout@unit'], run);
    assert.deepEqual(rules(ci(withStep(run))), [], run);
  }
  assert.deepEqual(rules(ci(withStep('yarn install --frozen-lockfile', { timeout: 0 }))), []);
});

test('mutation: a failure thrown away in other spellings', () => {
  const sum = `echo "${'a'.repeat(64)}  a.tgz" | sha256sum -c -`;
  for (const run of ['npm run test:studio || exit 0', 'npm run test:studio; true',
    'npm run test:studio || echo "studio failed"', 'set +e\nnpm run test:studio',
    'set +o errexit\n.github/scripts/ci-install.sh browser webkit',
    `${CURL} -o a.tgz https://x.example/a.tgz\n${sum} || true`]) {
    assert.deepEqual(rules(ci(withStep(run))), ['non-fatal@unit'], run);
  }
  for (const run of ['npm run test:studio || { echo "::error::studio"; exit 1; }',
    'set +e\nrm -f old.log', 'npm run test:studio || exit 1',
    `${CURL} -o a.tgz https://x.example/a.tgz\n${sum}`]) {
    assert.deepEqual(rules(ci(withStep(run))), [], run);
  }
});

test('mutation: a download behind a quoted #', () => {
  assert.deepEqual(logicalLines('echo "see issue #12"; curl x | sh # why\n# only a comment\n'
    + "echo 'a #b' c"), ['echo "see issue #12"; curl x | sh', "echo 'a #b' c"]);
  const run = 'echo "see issue #12"; curl https://x.example/i.sh | sh';
  assert.deepEqual(rules(ci(withStep(run, { timeout: 0 }))).sort(),
    ['curl-flags@unit', 'pipe-to-shell@unit', 'step-timeout@unit']);
});

test('lines that only name a program are not commands', (t) => {
  for (const run of ['echo "::notice::the apt mirror was slow last run"',
    'echo "curl failed, see the wget log"', 'printf "%s\\n" "install with apt-get or dpkg -i"',
    'command -v curl > /dev/null', 'which wget', 'type curl',
    'curl -fsS --retry "$RETRIES" --connect-timeout "${WAIT}" -o /dev/null https://x.example/',
  ]) {
    assert.deepEqual(rules(ci(withStep(run, { timeout: run.startsWith('curl') ? 3 : 0 }))), [],
      run);
  }
  // an echo with anything after it is still read
  assert.deepEqual(rules(ci(withStep('echo start; sudo apt-get install -y x'))),
    ['install-wrapper@unit']);
  assert.deepEqual(rules(ci(withStep('echo "$(curl https://x.example/)"', { timeout: 0 })))
    .includes('pipe-to-shell@unit'), true);
  const root = scratch(t, { 'scripts/hint.sh': '#!/bin/sh\necho "install with apt or brew"\n' });
  assert.deepEqual(checkRepository(root).map(format), []);
  const pre = mutate(CI, 'actions/setup-node@v7', 'actions/setup-node@v7.1.0-rc.1');
  assert.deepEqual(rules(ci(pre)), []);
  assert.deepEqual(rules(ci(mutate(CI, 'actions/setup-node@v7', 'actions/setup-node@next'))),
    ['pinned@unit']);
});

test('mutation: a merge-queue run that can be cancelled (ADR 0083, review F4 y2)', () => {
  // the real workflow: an older pull request run is cancelled, a queue run never is
  assert.equal(parse(CI).concurrency['cancel-in-progress'], QUEUE_SAFE_CANCEL);
  assert.equal(QUEUE_SAFE_CANCEL, "${{ github.event_name == 'pull_request' }}");
  const real = `cancel-in-progress: ${QUEUE_SAFE_CANCEL}`;
  for (const v of ['true', "${{ github.event_name != 'push' }}", "${{ always() }}", "'true'"]) {
    const text = mutate(CI, real, `cancel-in-progress: ${v}`);
    assert.deepEqual(rules(ci(text)), ['queue-cancel@-'], v);
    assert.match(ci(text)[0].message, /never be cancelled/);
  }
  assert.deepEqual(rules(ci(mutate(CI, real, 'cancel-in-progress: false'))), [], 'off is fine');
  // a job's own concurrency is read too
  const job = mutate(CI, '    name: unit, build, artifact rules\n',
    '    name: unit, build, artifact rules\n'
    + '    concurrency:\n      group: g\n      cancel-in-progress: true\n');
  assert.deepEqual(rules(ci(job)), ['queue-cancel@unit']);
  // without merge_group (the queue not switched on) the rule has nothing to protect
  const prOnly = mutate(mutate(CI, '\non:\n  pull_request:\n  merge_group:\n',
    '\non:\n  pull_request:\n'), real, 'cancel-in-progress: true');
  assert.deepEqual(rules(ci(prOnly)), []);
});
