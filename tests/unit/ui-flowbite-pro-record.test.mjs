// The record writer of rule project.ui-uses-flowbite-pro (scripts/ui-flowbite-pro-record.mjs):
// --check passes on the committed record and fails, naming the difference, on a record the tree
// does not hold or in another format; writing reproduces the committed record byte for byte;
// a bad flag exits 2.
//   node --test tests/unit/ui-flowbite-pro-record.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BASELINE_REL, ROOT } from '../../scripts/ui-flowbite-pro-measure.mjs';

const WRITER = path.join(ROOT, 'scripts/ui-flowbite-pro-record.mjs');
const RECORD = path.join(ROOT, BASELINE_REL);
const run = (...args) => spawnSync(process.execPath, [WRITER, ...args], { cwd: ROOT,
  encoding: 'utf8' });

test('--check exits 0 on the committed record', () => {
  const r = run('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /the record equals the tree/);
});

test('--check exits 1 on a record the tree does not hold, and writing restores it', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-ui-record-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const copy = path.join(dir, 'record.json');
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  writeFileSync(copy, `${JSON.stringify({ ...record, debt: record.debt + 1,
    inlineStyles: record.inlineStyles - 1 }, null, 2)}\n`);
  const bad = run('--check', '--record', copy);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stderr, /the record differs from the tree/);
  assert.match(bad.stderr, new RegExp(`debt: the tree has ${record.debt}, the record says `
    + `${record.debt + 1}`));
  assert.match(bad.stderr, /inline styles: \d+ in src\/index\.html, above the recorded/);
  const written = run('--record', copy);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(RECORD, 'utf8'),
    'the writer reproduces the committed record');
  const minified = path.join(dir, 'minified.json');
  writeFileSync(minified, JSON.stringify(record));
  const text = run('--check', '--record', minified);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /its text differs/);
});

test('a bad flag or a record of another measure without --measured exits 2', (t) => {
  assert.equal(run('--frobnicate').status, 2);
  assert.equal(run('--measured', 'abc').status, 2);
  const dir = mkdtempSync(path.join(tmpdir(), 'osc-ui-record-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'old.json');
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  writeFileSync(old, JSON.stringify({ ...record, measure: record.measure - 1 }));
  const r = run('--check', '--record', old);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /pass --measured <commit>/);
});
