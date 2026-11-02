// ADR 0083 (E045): .github/scripts/queued-pr.sh names the pull request a CI run judges: the
// event's own on pull_request, the N of the queue ref on merge_group (with HEAD^1 to measure
// against), and refuses a ref that is not a merge-queue ref, so its `eval` runs nothing else.
//   node --test tests/unit/queued-pr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../.github/scripts/queued-pr.sh', import.meta.url));
const run = (env) => spawnSync('bash', [SCRIPT], { encoding: 'utf8',
  env: { PATH: process.env.PATH, ...env } });
const vars = (out) => Object.fromEntries(out.trim().split('\n').map((l) => l.split(/=(.*)/s)
  .slice(0, 2)));

test('pull_request: the event\'s pull request, measured against its base branch', () => {
  const r = run({ PR: '385', GITHUB_BASE_REF: 'main' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(vars(r.stdout), { PR: '385', BASE: 'main', DIFF_BASE: 'origin/main' });
});

test('merge_group: the pull request the queue ref names, measured against HEAD^1', () => {
  const r = run({ QUEUE_REF: 'refs/heads/gh-readonly-queue/main/pr-385-24b36ce2aaaa',
    QUEUE_BASE: 'refs/heads/main' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(vars(r.stdout), { PR: '385', BASE: 'main', DIFF_BASE: 'HEAD^1' });
});

test('a ref that is not a merge-queue ref, or a base that disagrees, refuses with exit 2', () => {
  for (const env of [{ QUEUE_REF: 'refs/heads/evil;rm -rf /' },
    { QUEUE_REF: 'refs/heads/gh-readonly-queue/main/pr-x-abc1234' },
    { QUEUE_REF: 'refs/heads/gh-readonly-queue/main/pr-385-24b36ce2aaaa',
      QUEUE_BASE: 'refs/heads/other' },
    { PR: '38$(id)', GITHUB_BASE_REF: 'main' }]) {
    const r = run(env);
    assert.equal(r.status, 2, JSON.stringify(env));
    assert.equal(r.stdout, '', 'nothing to eval');
  }
});

test('no pull request at all prints an empty PR, which the rule jobs refuse', () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(vars(r.stdout).PR, '');
});
