// E040: a shared unit-test helper has one owner, and a copy of it does not come back.
//
// The in-memory IndexedDB is tests/unit/fixtures/fake-indexeddb.mjs, the YAML scalar unquote
// is tests/unit/claims-parse.mjs, and the shell markup reader is
// tests/unit/fixtures/shell-markup.mjs. v31-studio-patches kept an older inline copy of the
// first (without the open-failure switches, quota at commit or the readonly and inactive
// transaction errors), v31-studio-self-knowledge a byte copy of the second, and about-origin
// and positioning-consistency two copies of the third. Each owner below is the only file under
// tests/ that defines its helper, apart from a named definer whose meaning differs; a mutation
// case proves the scan sees a redefinition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OWNERS = [
  { name: 'fakeIndexedDB', owner: 'tests/unit/fixtures/fake-indexeddb.mjs' },
  {
    name: 'unquote',
    owner: 'tests/unit/claims-parse.mjs',
    // Same name, different meaning, so they stay: one has a length guard and unescapes \",
    // the other reads double quotes only and unescapes \".
    distinct: [
      'tests/unit/plan-evidence-commits.test.mjs',
      'tests/unit/release-validation-pins.test.mjs',
    ],
  },
  { name: 'shellMarkup', owner: 'tests/unit/fixtures/shell-markup.mjs' },
];

/** Every .mjs/.cjs/.js file under tests/, sorted, as repository-relative paths. */
function testFiles(dir = 'tests') {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && !e.name.startsWith('out')) out.push(...testFiles(rel));
    } else if (/\.(mjs|cjs|js)$/.test(e.name)) out.push(rel);
  }
  return out.sort();
}

/** Whether a source text defines `name` as a function or an arrow constant. */
export function defines(text, name) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\s*\\(`
    + `|(?:const|let|var)\\s+${name}\\s*=)`);
  return re.test(text);
}

test('E040: each shared test helper is defined by its owner and no other file under tests/', () => {
  const files = testFiles();
  for (const { name, owner, distinct = [] } of OWNERS) {
    const definers = files.filter((f) => defines(readFileSync(path.join(ROOT, f), 'utf8'), name));
    assert.deepEqual(definers.filter((f) => !distinct.includes(f)), [owner],
      `${name} has one owner, ${owner}`);
    for (const f of distinct) assert.ok(definers.includes(f), `${f} still defines its own ${name}`);
  }
});

test('E040 mutation: the scan sees a function or an arrow redefinition', () => {
  assert.equal(defines('function fakeIndexedDB() {\n  return {};\n}\n', 'fakeIndexedDB'), true);
  assert.equal(defines('const unquote = (v) => {\n  return v;\n};\n', 'unquote'), true);
  assert.equal(defines('export function shellMarkup() { return ""; }', 'shellMarkup'), true);
  assert.equal(defines("import { unquote } from './claims-parse.mjs';\nunquote(x);\n", 'unquote'),
    false);
  assert.equal(defines('const r = shellMarkup();\n', 'shellMarkup'), false);
});
