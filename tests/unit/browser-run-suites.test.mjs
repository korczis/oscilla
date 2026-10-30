// Review #330 F5: `npm run test:browser` chained its suites with &&, so the first failing suite
// stopped the chain and the suites after it (layout, qa-regressions, navigation,
// ui-flowbite-pro, midi) never ran in CI. tests/browser/lib/run-suites.cjs runs every suite it is
// given, in order, whatever the one before returned, and exits non-zero when any failed.
//   - test:browser runs its six suites through the runner, with no && between them, and is still
//     a browser suite to rule project.ci-bounded (its CI step keeps its time limit);
//   - runAll runs every suite after a failure, and returns 1 when any failed, 0 when none did;
//   - the runner as a process: a failing suite, a suite that refuses its selection (exit 2) and
//     a suite past its deadline (OSC_SUITE_MS) each fail the run while the suites after them
//     still run; an empty list, a missing file or a bad deadline exit 2 and run nothing;
//   - mutation: the old && chain over the same fixture suites leaves the suite after the failing
//     one unrun, so the assertion that it ran bites.
//   node --test tests/unit/browser-run-suites.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserSuites } from '../../scripts/ci-workflow-rules.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join(ROOT, 'tests', 'browser', 'lib', 'run-suites.cjs');
const { runAll, suiteDeadline, DEFAULT_MS } = require(RUNNER);
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const SUITES = ['app', 'layout', 'qa-regressions', 'navigation', 'ui-flowbite-pro', 'midi']
  .map((s) => `tests/browser/${s}.cjs`);

test('test:browser runs its six suites through the runner, none chained with &&', () => {
  const cmd = pkg.scripts['test:browser'];
  assert.equal(cmd, `node tests/browser/lib/run-suites.cjs ${SUITES.join(' ')}`);
  assert.doesNotMatch(cmd, /&&|\|\||;/, 'no chain: one failing suite cannot hide the rest');
  for (const s of SUITES) assert.ok(existsSync(path.join(ROOT, s)), `${s} exists`);
  assert.ok(browserSuites(pkg).has('test:browser'),
    'still a browser suite to project.ci-bounded (its CI step keeps a time limit)');
});

test('runAll runs every suite after a failure and fails when any did', () => {
  const ran = [];
  const codes = { a: 0, b: 1, c: 0, d: 2 };
  const all = runAll(['a', 'b', 'c', 'd'], (f) => { ran.push(f); return { status: codes[f] }; });
  assert.deepEqual(ran, ['a', 'b', 'c', 'd'], 'every suite ran, the ones after b included');
  assert.equal(all.code, 1);
  assert.deepEqual(all.results.map((r) => r.ok), [true, false, true, false]);
  assert.equal(runAll(['a', 'c'], (f) => ({ status: codes[f] })).code, 0);
  const odd = runAll(['k', 't'], (f) => (f === 'k' ? { status: null, signal: 'SIGKILL' }
    : { status: null, error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }));
  assert.equal(odd.code, 1);
  assert.deepEqual(odd.results.map((r) => r.why), ['killed by SIGKILL', 'timed out']);
});

test('OSC_SUITE_MS: a positive number of ms, 20 minutes by default', () => {
  assert.equal(suiteDeadline({}), DEFAULT_MS);
  assert.equal(DEFAULT_MS, 20 * 60 * 1000);
  assert.equal(suiteDeadline({ OSC_SUITE_MS: '1500' }), 1500);
  for (const bad of ['0', '-1', 'soon', 'NaN']) {
    assert.equal(suiteDeadline({ OSC_SUITE_MS: bad }), null, bad);
  }
});

test('the runner process: every suite runs, any failure fails the run (and the && chain did not)',
  () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-run-suites-'));
    try {
      const mark = (name) => path.join(dir, `${name}.ran`);
      const suite = (name, body) => {
        const file = path.join(dir, `${name}.cjs`);
        const touch = `require('node:fs').writeFileSync(${JSON.stringify(mark(name))}, '');`;
        writeFileSync(file, `${touch}\n${body}\n`);
        return file;
      };
      const fail = suite('fail', 'process.exit(1);');
      const refuse = suite('refuse', 'process.exit(2);');
      const hang = suite('hang', 'setInterval(() => {}, 1000);');
      const pass = suite('pass', 'process.exit(0);');
      const run = (files, env = {}) => spawnSync(process.execPath, [RUNNER, ...files],
        { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });

      const all = run([fail, refuse, hang, pass], { OSC_SUITE_MS: '1500' });
      assert.equal(all.status, 1, all.stdout + all.stderr);
      for (const n of ['fail', 'refuse', 'hang', 'pass']) {
        assert.ok(existsSync(mark(n)), `${n} ran`);
      }
      assert.match(all.stdout, /FAIL .*fail\.cjs \(exit 1, /);
      assert.match(all.stdout, /FAIL .*refuse\.cjs \(exit 2, /);
      assert.match(all.stdout, /FAIL .*hang\.cjs \(timed out, /);
      assert.match(all.stdout, /PASS .*pass\.cjs/);
      assert.match(all.stdout, /3 of 4 suites failed/);

      rmSync(mark('pass'));
      const ok = run([pass, pass]);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /all 2 suites passed/);

      for (const [files, env] of [[[]], [[path.join(dir, 'missing.cjs')]],
        [[pass], { OSC_SUITE_MS: '0' }]]) {
        rmSync(mark('pass'), { force: true });
        const r = run(files, env);
        assert.equal(r.status, 2, `${files} ${JSON.stringify(env)}: ${r.stderr}`);
        assert.ok(!existsSync(mark('pass')), 'nothing ran');
      }

      // Mutation: the chain test:browser used. The suite after the failing one never runs, so
      // the assertion above that every suite ran would fail for it.
      rmSync(mark('pass'), { force: true });
      const chain = spawnSync('sh', ['-c', `node ${JSON.stringify(fail)} && node `
        + `${JSON.stringify(pass)}`], { encoding: 'utf8', timeout: 60000 });
      assert.notEqual(chain.status, 0);
      assert.ok(!existsSync(mark('pass')), 'the && chain left the next suite unrun');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
