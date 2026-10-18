// V272 D6 (rule project.release-receipt-binds-gate): the receipt binds how the gate ran, not
// only the tree it ran on. release:prepare refuses a browser or origin selection narrowed by
// the environment, runs the gate with CI's skip semantics (an undeclared skip fails) and
// records the browser set; release:publish refuses a receipt whose gate ran anything else.
// Driven through main() as a dry run against a fake git and a fixture checkout: no gate runs.
//   node --test tests/unit/release-gate-env.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as prep from '../../scripts/release-prepare.mjs';

const require = createRequire(import.meta.url);
const suite = require('../browser/lib/suite.cjs');

/** release:prepare --dry-run on a fixture checkout with `env`; its exit code and output. */
function prepareDryRun(env) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-gate-env-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.3.3' }));
  const run = (args) => {
    if (args[0] === 'status') return '';
    if (args[0] === 'tag') return 'v3.3.3'; // before the record floor: no record needed
    if (args[0] === 'log') return `${'a'.repeat(40)}\x1ffix(x): y\x1f\x1e\n`;
    throw new Error(`release:prepare --dry-run must not run git ${args.join(' ')}`);
  };
  const out = [];
  const real = { log: console.log, error: console.error };
  console.log = (l) => out.push(String(l));
  console.error = (l) => out.push(String(l));
  let code;
  try {
    code = prep.main(['--dry-run'], root, run, env);
  } finally {
    Object.assign(console, real);
  }
  return { code, text: out.join('\n') };
}

test('V272 D6: release:prepare refuses a gate narrowed by OSC_BROWSERS or OSC_ORIGINS', () => {
  for (const env of [{ OSC_BROWSERS: 'chromium' }, { OSC_BROWSERS: '' },
    { OSC_ORIGINS: 'file' }, { OSC_BROWSERS: 'chromium,firefox,webkit' }]) {
    const r = prepareDryRun({ PATH: process.env.PATH, ...env });
    const name = Object.keys(env)[0];
    assert.equal(r.code, 1, `${JSON.stringify(env)}: ${r.text}`);
    assert.match(r.text, new RegExp(`${name} is set`), r.text);
    assert.match(r.text, /nothing was changed/);
  }
  // the load knobs say when the gate may start, not what it runs: they stay allowed
  const quiet = prepareDryRun({ PATH: process.env.PATH, OSC_LOAD_MAX: '40',
    OSC_LOAD_WAIT_MS: '1800000' });
  assert.equal(quiet.code, 0, quiet.text);
});

test('V272 D6: the gate runs with CI skip semantics and the receipt names its browsers', () => {
  assert.equal(typeof prep.gateEnv, 'function', 'release-prepare exports gateEnv');
  const env = prep.gateEnv({ PATH: '/bin', OSC_LOAD_MAX: '40', CI: '' });
  assert.equal(env.OSC_STRICT_SKIPS, '1');
  assert.equal(env.OSC_LOAD_MAX, '40');
  assert.equal(env.CI, '', 'CI is not switched on: the load gate still holds a busy machine');
  assert.ok(!('OSC_BROWSERS' in env) && !('OSC_ORIGINS' in env));

  // a skip the README does not declare fails under the gate's environment, as under CI
  const readme = path.join(mkdtempSync(path.join(os.tmpdir(), 'oscilla-gate-env-')), 'R.md');
  writeFileSync(readme, '# Tests\n\n## Declared skips\n\n| Skip | Reason |\n| --- | --- |\n');
  const strict = suite.createRun({ name: 's', browsers: ['webkit'], env, readme, log() {} });
  assert.throws(() => strict.skip('webkit', 'undeclared', 'because'), /Declared skips/);

  const fp = { version: '40.1.0', sourceDigest: 'a'.repeat(64), distSha256: 'b'.repeat(64),
    gateTree: 'c'.repeat(64) };
  const ran = prep.GATE_RUN;
  assert.deepEqual(ran, { browsers: ['chromium', 'firefox', 'webkit'],
    origins: ['file', 'http'], skips: 'declared-only' });
  assert.deepEqual(prep.receiptProblems({ ...fp, ...ran, result: 'passed' }, fp), []);
  const refused = (over, re) => {
    const p = prep.receiptProblems({ ...fp, ...ran, result: 'passed', ...over }, fp).join('\n');
    assert.match(p, re, JSON.stringify(over));
  };
  refused({ browsers: ['chromium'] }, /gate receipt browsers chromium != chromium,firefox,webkit/);
  refused({ origins: ['file'] }, /gate receipt origins file != file,http/);
  refused({ skips: 'any' }, /gate receipt skips any != declared-only/);
  const old = { ...fp, result: 'passed' }; // a receipt from before this rule names no browsers
  assert.match(prep.receiptProblems(old, fp).join('\n'), /gate receipt has no browsers/);
});
