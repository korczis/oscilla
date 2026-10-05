// The `knowledge` job of .github/workflows/ci.yml: a pinned `majordomus doctor` that the
// required `gate` job needs. Its verdict is .github/doctor-verdict.jq, run here on doctor
// outputs so that what passes the gate is decided by a tested program, not by eye:
//   - any FAIL fails, except the two git-hook wiring entries a CI runner cannot have;
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
const HOOKS = [fail('wiring', 'doctor-on-commit'), fail('wiring', 'finish-on-push')];
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
  for (const flag of ['--retry 5', '--retry-all-errors', '--retry-delay 5',
    '--connect-timeout 20', "--proto '=https'", '-f']) {
    assert.ok(curl.includes(flag), `curl ${flag}`);
  }
  assert.match(k, /MJ_SHA256: [0-9a-f]{64}\n/);
  assert.match(k, /sha256sum -c -/);
  assert.match(k, /MJ_VERSION: \d+\.\d+\.\d+\n/);
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

