// R050: a count the code holds is never retyped. The page's copy builds it from the constant
// (an import, a template literal), and the prose that states it (README.md, docs/) is held
// equal to it here, so a change to the constant fails the prose instead of leaving it stale.
// Owner, 2026-11-06: "something is hard-coded, numbers are duplicated, not everything is
// derived". Historical records (docs/reviews/, CHANGELOG) state what was true then and are not
// read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_VOICES } from '../../src/js/synth/voice-pool.js';
import { FM_ALGORITHMS } from '../../src/js/synth/fm-algorithms.js';
import { ENGINE_TAB } from '../../src/js/synth/panels/engines.js';
import { LEARN_CARDS } from '../../src/js/data/learn.js';
import { BARS, TEMPO_BPM } from '../../src/js/studio/templates/demo-song-score.js';
import { DEMO_SONG_SECONDS } from '../../src/js/studio/templates/demo-song.js';
import { SPACE_OWNER } from '../../src/js/ui/shortcuts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen'];
/** A stated count as a number: digits, or a number word up to thirteen. */
const num = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS.indexOf(String(s).toLowerCase()));
const playing = Object.values(SPACE_OWNER).filter((o) => o === 'instrument').length;

/** The counts and the phrases that state them: [name, value, regex with the number as $1]. */
export const COUNTS = [
  ['MAX_VOICES (src/js/synth/voice-pool.js)', MAX_VOICES, /\bup to (\d+) voices\b/g],
  ['FM_ALGORITHMS.length (src/js/synth/fm-algorithms.js)', FM_ALGORITHMS.length,
    /\b(\d+) algorithms\b/g],
  ['TEMPO_BPM (src/js/studio/templates/demo-song-score.js)', TEMPO_BPM,
    /\bA minor at (\d+) BPM\b/g],
  ['BARS (demo-song-score.js)', BARS, /\bA minor at \d+ BPM, (\d+) bars\b/g],
  ['DEMO_SONG_SECONDS (src/js/studio/templates/demo-song.js)', DEMO_SONG_SECONDS,
    /\bA minor at \d+ BPM, \d+ bars \((\d+) s\)/g],
  ['the instrument owners of SPACE_OWNER (src/js/ui/shortcuts.js)', playing,
    new RegExp(`\\b(\\d+|${WORDS.join('|')}) workspaces that play\\b`, 'gi')],
];

function prose() {
  const docs = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return n === 'reviews' ? [] : docs(rel);
    return n.endsWith('.md') ? [rel] : [];
  });
  return ['README.md', 'tests/README.md', 'docs/CLAIMS.yaml', ...docs('docs')];
}

/** Each stated number that differs from its source: 'file:line says N, <name> is M'. */
export function countProblems(files, text = read, counts = COUNTS) {
  const out = [];
  for (const f of files) {
    const t = text(f);
    for (const [name, value, re] of counts) {
      for (const m of t.matchAll(re)) {
        if (num(m[1]) !== value) {
          const line = t.slice(0, m.index).split('\n').length;
          out.push(`${f}:${line} says ${m[1]}, ${name} is ${value}`);
        }
      }
    }
  }
  return out;
}

test('README.md and docs/ state the counts the code holds', () => {
  assert.deepEqual(countProblems(prose()), []);
});

test('the page builds its counts from the constants, never a literal', () => {
  assert.match(ENGINE_TAB.description, new RegExp(`up to ${MAX_VOICES} voices each`));
  const card = LEARN_CARDS.find((c) => c.id === 'synthesis-engines');
  assert.match(card.body, new RegExp(`up to ${MAX_VOICES} voices each`));
  for (const rel of ['src/js/synth/panels/engines.js', 'src/js/data/learn.js']) {
    const code = read(rel).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /up to \d+ voices/, `${rel} types the voice count`);
  }
});

test('mutation: a stated count that differs from its source is named', () => {
  const t = { 'a.md': 'Engines, up to 8 voices each.\nFM, 7 algorithms.\n',
    'b.md': 'up to 16 voices\n' };
  assert.deepEqual(countProblems(Object.keys(t), (f) => t[f], [
    ['V', 16, /\bup to (\d+) voices\b/g], ['A', 6, /\b(\d+) algorithms\b/g]]),
  ['a.md:1 says 8, V is 16', 'a.md:2 says 7, A is 6']);
});
