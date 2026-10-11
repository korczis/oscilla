// project.majordomus-layer-current: the `majordomus` a developer checkout runs (git hooks,
// `npm run verify`) is the version the CI `knowledge` job pins, and a difference is refused
// with the migration procedure. The comparison is scripts/majordomus-pin-check.mjs; this test
// runs it on fixture versions, so it needs no Majordomus installed, and checks that
// `npm run verify` runs it before `majordomus doctor`.
//   node --test tests/unit/majordomus-pin.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pinnedVersion, reportedVersion, pinProblems, PROCEDURE,
} from '../../scripts/majordomus-pin-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/majordomus-pin-check.mjs');
const CI = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const workflow = (version) => `jobs:\n  knowledge:\n    env:\n      MJ_VERSION: ${version}\n`;

/** Run the script on a fixture workflow and a fixture `majordomus version` answer. */
function run(version, answer) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-pin-'));
  try {
    const file = path.join(dir, 'ci.yml');
    writeFileSync(file, workflow(version));
    return spawnSync(process.execPath, [SCRIPT, '--ci', file, '--local', answer],
      { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the pin and the tool\'s answer are read', () => {
  assert.match(pinnedVersion(CI) || '', /^\d+\.\d+\.\d+/, 'ci.yml pins MJ_VERSION');
  assert.equal(pinnedVersion(workflow('0.13.2')), '0.13.2');
  assert.equal(pinnedVersion(workflow('"0.14.0-rc.1"')), '0.14.0-rc.1');
  assert.equal(pinnedVersion('jobs: {}\n'), null);
  assert.equal(reportedVersion('majordomus 0.13.2\n'), '0.13.2');
  assert.equal(reportedVersion('zsh: command not found: majordomus'), null);
  assert.equal(reportedVersion(''), null);
});

test('equal versions pass; a difference names both versions and the procedure', () => {
  assert.deepEqual(pinProblems({ pinned: '0.13.2', local: '0.13.2' }), []);
  const lines = pinProblems({ pinned: '0.12.0', local: '0.13.2' });
  assert.match(lines[0], /on PATH is 0\.13\.2.*pins MJ_VERSION 0\.12\.0/);
  for (const step of PROCEDURE) assert.ok(lines.includes(step), step);
  const text = PROCEDURE.join('\n');
  for (const part of ['on a branch', 'BOTH', 'pull request', 'MJ_VERSION and MJ_SHA256',
    'owner flip']) {
    assert.ok(text.includes(part), `the procedure says "${part}"`);
  }
  assert.ok(pinProblems({ pinned: null, local: '0.13.2' }).length > 0, 'no pin is a problem');
  assert.ok(pinProblems({ pinned: '0.13.2', local: null }).length > 0, 'no tool is a problem');
});

test('the script exits 0 on a match and 1, naming the procedure, on a mismatch', () => {
  const same = run('0.13.2', 'majordomus 0.13.2');
  assert.equal(same.status, 0, same.stderr);
  const differ = run('0.12.0', 'majordomus 0.13.2');
  assert.equal(differ.status, 1);
  assert.match(differ.stderr, /MAJORDOMUS PIN {2}the majordomus on PATH is 0\.13\.2/);
  assert.match(differ.stderr, /Migrating the \.ai\/ layer to another Majordomus version/);
  assert.match(differ.stderr, /owner flip/);
  assert.equal(run('0.13.2', '').status, 1, 'a missing tool is refused');
});

test('npm run verify runs the pin check before majordomus doctor', () => {
  const verify = PKG.scripts.verify;
  const pin = verify.indexOf('node scripts/majordomus-pin-check.mjs');
  const doctor = verify.indexOf('majordomus doctor');
  assert.ok(pin >= 0, 'verify runs scripts/majordomus-pin-check.mjs');
  assert.ok(doctor > pin, 'and runs it before majordomus doctor');
  assert.match(verify.slice(pin, doctor), /^node scripts\/majordomus-pin-check\.mjs && $/,
    'chained with &&, so a mismatch stops verify');
});
