// The Flowbite Pro class lists of src/js/ui/pro-classes.js (PRO) reach the built page: every class
// of every entry is defined by dist's compiled CSS. If Tailwind's content globs stopped reading
// src/js, the pages that bind PRO would lose their Pro styling without any other check failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRO, proClassesPart } from '../../src/js/ui/pro-classes.js';
import { definedClasses } from '../../scripts/ui-flowbite-pro-measure.mjs';

const dist = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');

test('every class of every PRO entry is defined by the built CSS', () => {
  const defines = definedClasses(dist);
  const missing = Object.entries(PRO).flatMap(([key, list]) => list.split(/\s+/)
    .filter(Boolean).filter((c) => !defines(c)).map((c) => `${key}: ${c}`));
  assert.deepEqual(missing, []);
});

test('PRO is frozen, non-empty and composed into the page as one part', () => {
  assert.ok(Object.isFrozen(PRO));
  assert.ok(Object.keys(PRO).length > 0);
  for (const [key, list] of Object.entries(PRO)) {
    assert.equal(typeof list, 'string', key);
    assert.ok(list.trim().length > 0, key);
    assert.doesNotMatch(list, /\bosc-/, `${key} carries no legacy class`);
  }
  assert.equal(proClassesPart().PRO, PRO);
  assert.match(readFileSync(new URL('../../src/js/main.js', import.meta.url), 'utf8'),
    /\bproClassesPart\(\)/, 'main.js composes the part');
});

test('a missing class is reported (the check is not vacuous)', () => {
  const defines = definedClasses('<style>.bg-white{color:red}</style>');
  assert.equal(defines('bg-white'), true);
  assert.equal(defines('bg-primary-700'), false);
});
