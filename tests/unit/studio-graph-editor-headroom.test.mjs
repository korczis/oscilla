// K006 (playable-instrument#editor-headroom): the Studio graph editor keeps room for the gestures
// still to come (K007-K009, M080): graph-editor.js at least 12 000 B under its cap and every
// module split from it (src/js/ui/studio/graph-*.js) at least 10 000 B. The cap is the file's
// entry in tests/unit/source-size-baseline.json, or the source-size budget's 40 000 B.
//   node --test tests/unit/studio-graph-editor-headroom.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNCAPPED } from './fixtures/source-size.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = 'src/js/ui/studio';
const EDITOR = `${DIR}/graph-editor.js`;
const DEFAULT_CAP = UNCAPPED; // the budget's own default (fixtures/source-size.mjs)

/** What leaves a graph module with less room than it needs ([] = every one has it). */
export function headroomProblems(sizes, caps) {
  return Object.entries(sizes).flatMap(([file, size]) => {
    const cap = caps[file] ?? DEFAULT_CAP;
    const need = file === EDITOR ? 12_000 : 10_000;
    return cap - size < need ? [`${file}: ${size} B leaves ${cap - size} B under its cap `
      + `${cap} B, less than ${need} B`] : [];
  });
}

test('graph-editor.js has 12 000 B of room and every graph-*.js split from it 10 000 B', () => {
  const { caps } = JSON.parse(readFileSync(`${ROOT}tests/unit/source-size-baseline.json`, 'utf8'));
  const sizes = Object.fromEntries(readdirSync(`${ROOT}${DIR}`)
    .filter((f) => /^graph-[a-z-]+\.js$/.test(f))
    .map((f) => [`${DIR}/${f}`, statSync(`${ROOT}${DIR}/${f}`).size]));
  assert.ok(sizes[EDITOR] > 0 && sizes[`${DIR}/graph-gestures.js`] > 0, 'the editor and its gestures');
  assert.deepEqual(headroomProblems(sizes, caps), []);
});

test('mutation: graph-gestures.js at 30 153 B (main before K006 finished) and a full editor fail',
  () => {
    assert.equal(headroomProblems({ [`${DIR}/graph-gestures.js`]: 30_153 }, {}).length, 1);
    assert.equal(headroomProblems({ [EDITOR]: 28_001 }, {}).length, 1, 'the editor needs 12 000');
    assert.deepEqual(headroomProblems({ [EDITOR]: 28_000, [`${DIR}/graph-x.js`]: 30_000 }, {}), []);
  });
