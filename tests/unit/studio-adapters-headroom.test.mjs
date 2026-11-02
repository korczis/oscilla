// K005 (playable-instrument#editor-headroom): every Studio node adapter file keeps at least
// 10 000 B of room under its cap, so K010 to K013 add their adapters to files with room. The cap
// is the file's entry in tests/unit/source-size-baseline.json, or the source-size budget's
// 40 000 B for a file without one.
//   node --test tests/unit/studio-adapters-headroom.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = 'src/js/studio/adapters';
const DEFAULT_CAP = 40_000;
const ROOM = 10_000;

/** What leaves an adapter file with less than ROOM bytes under its cap ([] = every file has it). */
export function headroomProblems(sizes, caps) {
  return Object.entries(sizes).filter(([file, size]) => (caps[file] ?? DEFAULT_CAP) - size < ROOM)
    .map(([file, size]) => `${file}: ${size} B leaves ${(caps[file] ?? DEFAULT_CAP) - size} B `
      + `under its cap ${caps[file] ?? DEFAULT_CAP} B, less than ${ROOM} B`);
}

test('every Studio node adapter file has at least 10 000 B of room under its cap', () => {
  const { caps } = JSON.parse(readFileSync(`${ROOT}tests/unit/source-size-baseline.json`, 'utf8'));
  const sizes = Object.fromEntries(readdirSync(`${ROOT}${DIR}`).filter((f) => f.endsWith('.js'))
    .map((f) => [`${DIR}/${f}`, statSync(`${ROOT}${DIR}/${f}`).size]));
  assert.ok(Object.keys(sizes).length >= 6, 'the adapters are split by category');
  assert.deepEqual(headroomProblems(sizes, caps), []);
});

test('mutation: the unsplit nodes.js of e2720e07 (40 583 of 45 000 B) and a full file fail', () => {
  assert.equal(headroomProblems({ [`${DIR}/nodes.js`]: 40_583 },
    { [`${DIR}/nodes.js`]: 45_000 }).length, 1);
  assert.equal(headroomProblems({ [`${DIR}/x.js`]: 30_001 }, {}).length, 1, 'default cap');
  assert.deepEqual(headroomProblems({ [`${DIR}/x.js`]: 30_000 }, {}), []);
});
