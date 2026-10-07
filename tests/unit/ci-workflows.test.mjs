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
  format, logicalLines, stepNeedsTimeout,
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

test('mutation: ci.yml started by anything but a pull request', () => {
  assert.deepEqual(Object.keys(parse(CI).on), ['pull_request']);
  const manual = mutate(CI, '\non:\n  pull_request:\n',
    '\non:\n  pull_request:\n  workflow_dispatch:\n');
  assert.deepEqual(rules(ci(manual)), ['triggers@-']);
  assert.match(ci(manual)[0].message, /not by: pull_request, workflow_dispatch/);
  const push = mutate(CI, '\non:\n  pull_request:\n', '\non: [push]\n');
  assert.deepEqual(rules(ci(push)), ['triggers@-']);
  // pages.yml has no gate: it deploys main and may be started by hand
  assert.deepEqual(checkWorkflow('pages.yml', PAGES, SUITES), []);
});

test('the pull-request rules are judged by the base branch\'s programs, and need a PR', () => {
  const jobs = parse(CI).jobs;
  for (const [job, call] of [
    ['fail-first', '.github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF" scripts/fail-first.mjs'
      + ' --pr-json "$RUNNER_TEMP/pr.json" --head "$HEAD_SHA"'
      + ' --base-branch "origin/$GITHUB_BASE_REF"'],
    ['review-verdict', '.github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF"'
      + ' scripts/review-verdict.mjs --pr "$PR" --head HEAD'
      + ' --base-branch "origin/$GITHUB_BASE_REF"'],
  ]) {
    assert.deepEqual(problemsOfRuleJob(jobs[job], call), [], job);
  }
});

/** What stops a rule job from judging: [] when its last command is exactly `call`. */
function problemsOfRuleJob(job, call) {
  const out = [];
  if (job.if !== undefined) out.push('the job is conditional');
  const last = job.steps.at(-1);
  if (job.steps.some((s) => s.if !== undefined)) out.push('a step is conditional');
  if (last.env?.PR !== '${{ github.event.pull_request.number }}') {
    out.push('PR is not the event\'s');
  }
  if (last.shell !== undefined) out.push('the step sets its own shell');
  const run = logicalLines(last.run).map((l) => l.replace(/\s+/g, ' '));
  // the whole line: no `|| true`, no `;`, no `if` around it, no other arguments
  if (run.at(-1) !== call) out.push(`the last command is not the call: ${run.at(-1)}`);
  if (!run.some((l) => /^if \[ -z "\$PR" \]; then .*exit 1; fi$/.test(l))) {
    out.push('it does not fail when there is no pull request');
  }
  if (run.some((l) => /\bexit 0\b|\bset \+e\b/.test(l))) out.push('an early success');
  return out;
}

test('mutation: a rule job whose call can no longer refuse', () => {
  const real = parse(CI).jobs['review-verdict'];
  const call = logicalLines(real.steps.at(-1).run).at(-1).replace(/\s+/g, ' ');
  assert.deepEqual(problemsOfRuleJob(real, call), []);
  const edited = (from, to) => parse(mutate(CI, from, to)).jobs['review-verdict'];
  const tail = '--pr "$PR" --head HEAD --base-branch "origin/$GITHUB_BASE_REF"\n';
  for (const [name, job] of [
    ['|| true', edited(tail, `${tail.trimEnd()} || true\n`)],
    ['judges the base against itself', edited('--head HEAD --base-branch',
      '--head "origin/$GITHUB_BASE_REF" --base-branch')],
    ['another base', edited(tail, tail.replace('--base-branch "origin/$GITHUB_BASE_REF"',
      '--base HEAD'))],
    ['a command after it', edited(tail, `${tail}          echo done\n`)],
    ['wrapped in if', edited('          .github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF"'
      + ' scripts/review-verdict.mjs', '          if true; then exit 0; fi\n'
      + '          .github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF"'
      + ' scripts/review-verdict.mjs')],
    ['conditional job', edited('    name: review-verdict (guarded paths need a recorded review)\n',
      '    name: review-verdict (guarded paths need a recorded review)\n'
      + '    if: github.actor != \'x\'\n')],
    ['conditional step', edited(
      '      - name: A guarded change carries a verdict for the content it changes\n',
      '      - name: A guarded change carries a verdict for the content it changes\n'
      + '        if: false\n')],
    ['own copy', edited('.github/scripts/base-rule.sh "origin/$GITHUB_BASE_REF" scripts/review',
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
