// E003 (engineering-integrity#studio-workspace-split): the Studio workspace keeps room for the
// capabilities that extend it (V601's group commands, V604's draft recovery, V605's open from
// the Signal Path): src/js/ui/studio/workspace.js and every part split from it
// (src/js/ui/studio/workspace/*.js) keep at least 10 000 B of room under their cap. The cap is
// the file's entry in tests/unit/source-size-baseline.json, or the source-size budget's
// 40 000 B for a file without one.
//   node --test tests/unit/studio-workspace-headroom.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNCAPPED } from './fixtures/source-size.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKSPACE = 'src/js/ui/studio/workspace.js';
const DIR = 'src/js/ui/studio/workspace';
const DEFAULT_CAP = UNCAPPED; // the budget's own default (fixtures/source-size.mjs)
const ROOM = 10_000;

/** What leaves a workspace module with less than ROOM bytes under its cap ([] = all have it). */
export function headroomProblems(sizes, caps) {
  return Object.entries(sizes).filter(([file, size]) => (caps[file] ?? DEFAULT_CAP) - size < ROOM)
    .map(([file, size]) => `${file}: ${size} B leaves ${(caps[file] ?? DEFAULT_CAP) - size} B `
      + `under its cap ${caps[file] ?? DEFAULT_CAP} B, less than ${ROOM} B`);
}

test('workspace.js and every workspace/*.js part have at least 10 000 B of room under the cap',
  () => {
    const { caps } = JSON.parse(readFileSync(`${ROOT}tests/unit/source-size-baseline.json`,
      'utf8'));
    const files = [WORKSPACE, ...readdirSync(`${ROOT}${DIR}`).filter((f) => f.endsWith('.js'))
      .map((f) => `${DIR}/${f}`)];
    const sizes = Object.fromEntries(files.map((f) => [f, statSync(`${ROOT}${f}`).size]));
    assert.ok(files.length >= 8, 'workspace.js and its parts, split by responsibility');
    assert.deepEqual(headroomProblems(sizes, caps), []);
  });

test('mutation: the unsplit workspace.js of b7d0777a (86 145 of 86 000 B) and a full part fail',
  () => {
    assert.equal(headroomProblems({ [WORKSPACE]: 86_145 }, { [WORKSPACE]: 86_000 }).length, 1);
    assert.equal(headroomProblems({ [WORKSPACE]: 30_001 }, {}).length, 1, 'the default cap');
    assert.equal(headroomProblems({ [`${DIR}/x.js`]: 30_001 }, {}).length, 1, 'a part');
    assert.deepEqual(headroomProblems({ [WORKSPACE]: 30_000, [`${DIR}/x.js`]: 30_000 }, {}), []);
  });
