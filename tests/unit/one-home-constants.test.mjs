// R050: a constant two programs need has one home, and the other imports it or is held equal
// to it here. The visual gates each typed MAX_MISMATCH_PCT = 0.5, two headroom tests typed the
// source-size budget's 40 000-byte default, and the build-metadata region id is declared by the
// build (scripts/release-metadata.mjs REGION_ID) and by the runtime reader (build-info.js
// BUILD_REGION_ID) and was typed a third time by the live smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_ID } from '../../scripts/release-metadata.mjs';
import { BUILD_REGION_ID } from '../../src/js/core/build-info.js';
import { MAX_MISMATCH_PCT } from '../../scripts/visual-limits.mjs';
import { UNCAPPED } from './fixtures/source-size.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('the build and the runtime name one build-metadata region, and the smoke reads it', () => {
  assert.equal(REGION_ID, BUILD_REGION_ID);
  const smoke = read('tests/browser/live-smoke.cjs');
  assert.match(smoke, /require\('\.\.\/\.\.\/src\/js\/core\/build-info\.js'\)/);
  assert.equal(smoke.includes(`'${BUILD_REGION_ID}'`), false, 'the smoke types the id');
});

test('the visual gates import their mismatch limit from scripts/visual-limits.mjs', () => {
  assert.equal(typeof MAX_MISMATCH_PCT, 'number');
  const gates = readdirSync(path.join(ROOT, 'scripts'))
    .filter((n) => /^visual-.*\.mjs$/.test(n) && n !== 'visual-limits.mjs');
  for (const f of gates) {
    const src = read(`scripts/${f}`);
    assert.doesNotMatch(src, /const MAX_MISMATCH_PCT\s*=/, `scripts/${f} declares its own limit`);
  }
});

test('no unit test retypes the source-size budget default', () => {
  assert.equal(UNCAPPED, 40_000);
  for (const f of readdirSync(path.join(ROOT, 'tests/unit')).filter((n) => n.endsWith('.mjs'))) {
    if (f === path.basename(fileURLToPath(import.meta.url))) continue;
    assert.doesNotMatch(read(`tests/unit/${f}`), /=\s*40_?000\s*;/, `tests/unit/${f} types it`);
  }
});
