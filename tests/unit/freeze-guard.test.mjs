// Claim patterns-match-v1 rests on tests/unit/freeze.test.mjs replaying the V1 golden vectors.
// Where the freeze files are missing (or OSCILLA_FREEZE_DIR points where they are not) that
// test skips, which is right in a partial local checkout and wrong in CI: a skipped test passes
// the gate, so the claim could pass without one vector being replayed. Under GITHUB_ACTIONS or
// CI the missing files are a failure, as tests/unit/about.test.mjs does for a shallow history.
// This file runs freeze.test.mjs as a child with the freeze directory pointed at nothing.
//   node --test tests/unit/freeze-guard.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FREEZE = path.join(ROOT, 'tests/unit/freeze.test.mjs');

/** Run freeze.test.mjs with these variables over an environment without CI markers. */
function runFreeze(extra) {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  delete env.CI;
  delete env.NODE_TEST_CONTEXT; // set by the parent runner; the child is a run of its own
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', FREEZE], {
    cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test('without the freeze files the V1 freeze fails in CI and skips elsewhere', () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'osc-freeze-'));
  try {
    const local = runFreeze({ OSCILLA_FREEZE_DIR: empty });
    assert.equal(local.status, 0, `a local checkout skips:\n${local.out}`);
    assert.match(local.out, /# SKIP freeze files not found/);
    for (const marker of [{ GITHUB_ACTIONS: 'true' }, { CI: 'true' }]) {
      const ci = runFreeze({ OSCILLA_FREEZE_DIR: empty, ...marker });
      assert.notEqual(ci.status, 0, `${JSON.stringify(marker)} fails:\n${ci.out}`);
      assert.match(ci.out, /freeze files not found/);
      assert.doesNotMatch(ci.out, /# SKIP/, `${JSON.stringify(marker)}: not a skip`);
    }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('with the freeze files the V1 freeze runs its vectors, in CI too', () => {
  const r = runFreeze({ GITHUB_ACTIONS: 'true' });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /# SKIP freeze files not found/);
  const pass = Number((r.out.match(/^# pass (\d+)/m) || [])[1]);
  assert.ok(pass > 1, `the vectors ran (${pass} passing tests)`);
});
