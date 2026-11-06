// A test that means "every workspace" reads the product's registry (ui/shell.js WORKSPACE_IDS),
// never a hand-typed copy. Four browser suites typed the twelve workspaces of their day; when
// Synth became the thirteenth, the control census, open-every-workspace and the first-screen
// entries silently skipped it (owner, 2026-11-06: "not everything is derived"). A deliberate
// subset (the playing workspaces, the ones a check is about) stays a literal: it is short of
// the registry by more than two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_IDS } from '../../src/js/ui/shell.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = fileURLToPath(import.meta.url);

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === 'fixtures' ? [] : files(p);
    return /\.(c|m)?js$/.test(n) && p !== SELF ? [p] : [];
  });
}

/** Array literals of quoted strings that name (nearly) every workspace and nothing else. */
export function copiedWorkspaceLists(source, ids = WORKSPACE_IDS) {
  const known = new Set(ids);
  const out = [];
  for (const m of source.matchAll(/\[((?:\s*'[a-z-]+'\s*,?)+)\s*\]/g)) {
    const names = [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
    if (names.length >= ids.length - 2 && names.every((n) => known.has(n))) {
      out.push({ line: source.slice(0, m.index).split('\n').length, count: names.length });
    }
  }
  return out;
}

test('no test types the list of every workspace; it reads WORKSPACE_IDS', () => {
  const found = [];
  for (const f of [...files(path.join(ROOT, 'tests', 'browser')),
    ...files(path.join(ROOT, 'tests', 'unit'))]) {
    for (const hit of copiedWorkspaceLists(readFileSync(f, 'utf8'))) {
      found.push(`${path.relative(ROOT, f)}:${hit.line} types ${hit.count} workspace ids`);
    }
  }
  assert.deepEqual(found, []);
});

test('mutation: a typed twelve or thirteen is found, a deliberate subset is not', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
  const q = (xs) => `const X = [${xs.map((x) => `'${x}'`).join(', ')}];`;
  assert.deepEqual(copiedWorkspaceLists(q(ids), ids), [{ line: 1, count: 13 }]);
  assert.deepEqual(copiedWorkspaceLists(q(ids.slice(0, 12)), ids), [{ line: 1, count: 12 }]);
  assert.deepEqual(copiedWorkspaceLists(q(ids.slice(0, 6)), ids), []);
  assert.deepEqual(copiedWorkspaceLists(q([...ids.slice(0, 12), 'zz']), ids), []);
});
