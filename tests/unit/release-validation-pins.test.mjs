// V272 D1: a plan or intent validation that proves the public page names the commit it proves.
// `npm run release:verify-deploy` without --commit compares the page with the checkout it runs
// in, and `npm run test:live` without --expect-commit accepts whatever Pages serves, so both
// pass on any later main HEAD: M035 ("the public page carries <the release> and the release
// commit") read as met while Pages served 2d56148 under the release's version. Every
// `validation:` entry of a milestone or issue and every `ref:` of an intent criterion with
// `evidence: command` that runs verify-deploy carries `--commit <rev>`, and one that runs the
// live smoke carries `--expect-commit <rev>` (a full SHA, a tag or origin/main; never a
// <placeholder>).
//   node --test tests/unit/release-validation-pins.test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = path.join(ROOT, '.ai/repo/project');
const DIRS = ['milestones', 'issues', 'intents'];

const unquote = (s) => s.trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');

/** The validation commands of one plan file: { line, command }. */
function validations(text) {
  const out = [];
  const lines = text.split('\n');
  let inList = false;
  lines.forEach((l, i) => {
    if (/^validation:\s*$/.test(l)) {
      inList = true;
      return;
    }
    if (inList && !/^\s/.test(l)) inList = false;
    const item = inList && /^\s+-\s+(.*)$/.exec(l);
    if (item) out.push({ line: i + 1, command: unquote(item[1]) });
    const ref = /^\s+ref:\s+(.*)$/.exec(l);
    if (ref && /^\s+evidence:\s+command\s*$/.test(lines[i - 1] || '')) {
      out.push({ line: i + 1, command: unquote(ref[1]) });
    }
  });
  return out;
}

const PIN = (flag) => new RegExp(`(^|\\s)${flag}[ =]+(?!<)["']?[\\w./^{}$()-]+`);

/** Why a validation command does not pin its commit (empty = pinned or not a live check). */
function pinProblems(command) {
  const problems = [];
  if (/release:verify-deploy|verify-deploy\.mjs/.test(command) && !PIN('--commit').test(command)) {
    problems.push('runs verify-deploy without --commit <rev>');
  }
  if (/test:live|live-smoke\.cjs/.test(command) && !PIN('--expect-commit').test(command)) {
    problems.push('runs the live smoke without --expect-commit <rev>');
  }
  return problems;
}

test('V272 D1: pinProblems tells a pinned live check from one that passes on any HEAD', () => {
  assert.deepEqual(pinProblems('npm run release:verify-deploy'),
    ['runs verify-deploy without --commit <rev>']);
  assert.deepEqual(pinProblems('npm run test:live'),
    ['runs the live smoke without --expect-commit <rev>']);
  assert.equal(pinProblems('npm run test:live -- --expect-commit <release commit>').length, 1);
  assert.equal(pinProblems('npm run release:verify-deploy && npm run test:live -- '
    + '--expect-commit origin/main').length, 1);
  for (const ok of ['npm run release:verify-deploy -- --commit origin/main',
    'node scripts/verify-deploy.mjs --commit 2b63ec382d4d4c49efa2553a2a6368cb41068fe2',
    'npm run test:live -- --expect-version 40.0.0 --expect-commit v40.0.0',
    'npm run version:check', 'majordomus doctor']) {
    assert.deepEqual(pinProblems(ok), [], ok);
  }
  assert.deepEqual(validations('id: X\nvalidation:\n  - "npm run test:live"\n  - "a"\n'
    + 'evidence_required:\n  - "npm run test:live"\nsatisfaction:\n  - id: s\n'
    + '    evidence: command\n    ref: "npm run release:verify-deploy"\n'
    + '  - id: t\n    evidence: claim\n    ref: "npm run test:live"\n'), [
    { line: 3, command: 'npm run test:live' }, { line: 4, command: 'a' },
    { line: 10, command: 'npm run release:verify-deploy' }]);
});

test('V272 D1: every plan and intent validation of the public page pins its commit', () => {
  const bad = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(path.join(PROJECT, dir)).filter((f) => f.endsWith('.yaml'))) {
      const rel = `.ai/repo/project/${dir}/${name}`;
      for (const { line, command } of validations(readFileSync(path.join(ROOT, rel), 'utf8'))) {
        for (const p of pinProblems(command)) bad.push(`${rel}:${line} ${p}: ${command}`);
      }
    }
  }
  assert.deepEqual(bad, [], `unpinned live validations:\n${bad.join('\n')}`);
});
