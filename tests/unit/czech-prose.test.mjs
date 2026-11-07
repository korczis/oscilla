// Rule project.czech-prose (Q104, the owner's order of 2026-11-07): the app's visible prose is
// Czech. The English sentences it still shows are a ratchet per file
// (tests/unit/czech-prose-baseline.json, written by scripts/czech-prose.mjs): a file's count
// only falls, and a file not listed may hold none, so a new English sentence fails here while
// the old ones are translated file by file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BASELINE_REL, ROOT, htmlProse, isEnglishProse, moduleProse, proseCounts,
} from '../../scripts/czech-prose.mjs';

const baseline = JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'));

/** Each file whose English prose rose above its baseline (or appeared): 'file: N > M'. */
export function proseRises(counts, base) {
  return Object.entries(counts).filter(([f, n]) => n > (base[f] || 0))
    .map(([f, n]) => `${f}: ${n} English sentence(s), the baseline allows ${base[f] || 0}`);
}

/** Each file whose count fell under its baseline: the baseline must fall with it. */
export function proseFalls(counts, base) {
  return Object.entries(base).filter(([f, n]) => (counts[f] || 0) < n)
    .map(([f, n]) => `${f}: ${counts[f] || 0} < ${n}: lower the baseline `
      + '(node scripts/czech-prose.mjs --write)');
}

test('no file shows more English prose than its baseline, and no new file shows any', () => {
  assert.deepEqual(proseRises(proseCounts(), baseline.counts), [],
    'write the new text in Czech (rule project.czech-prose, Q104)');
});

test('a file that was translated lowers its baseline in the same change', () => {
  assert.deepEqual(proseFalls(proseCounts(), baseline.counts), []);
  const sum = Object.values(baseline.counts).reduce((a, b) => a + b, 0);
  assert.equal(baseline.total, sum, 'the baseline total is the sum of its counts');
});

test('the measure: English sentences are found, Czech ones and short labels are not', () => {
  assert.equal(isEnglishProse('The output belongs to the measurement: stop it first.'), true);
  assert.equal(isEnglishProse('Výstup patří měření: nejdřív ho zastavte.'), false);
  assert.equal(isEnglishProse('Play'), false);
  assert.equal(isEnglishProse('Kick'), false);
  assert.equal(isEnglishProse('Open in Studio'), false, 'a three-word label, one function word');
  assert.deepEqual(htmlProse('<p>Press Play to hear the tone.</p><b>Přehrát</b>'
    + '<button aria-label="Close the dialog and return">x</button>'),
  ['Press Play to hear the tone.', 'Close the dialog and return']);
  const src = "// the comment is not shown\nconst t = 'Nothing plays until you press Play.';";
  assert.deepEqual(moduleProse(src), ['Nothing plays until you press Play.']);
});

test('mutation: a new English sentence in a file is named', () => {
  assert.deepEqual(proseRises({ 'src/js/a.js': 3, 'src/js/b.js': 1 }, { 'src/js/a.js': 3 }),
    ['src/js/b.js: 1 English sentence(s), the baseline allows 0']);
  assert.deepEqual(proseRises({ 'src/js/a.js': 4 }, { 'src/js/a.js': 3 }),
    ['src/js/a.js: 4 English sentence(s), the baseline allows 3']);
  assert.deepEqual(proseFalls({ 'src/js/a.js': 1 }, { 'src/js/a.js': 3 }),
    ['src/js/a.js: 1 < 3: lower the baseline (node scripts/czech-prose.mjs --write)']);
});
