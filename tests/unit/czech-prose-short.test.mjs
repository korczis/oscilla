// Plan U098, rule project.czech-prose (Q104): the short English the app still shows. The
// sentence measure (tests/unit/czech-prose.test.mjs) counts only strings of three or more words
// with two English function words, so labels, buttons, headings and short announcements
// ('Restore normal', 'CABLES', 'Connection cancelled.') escaped it (oscilla-c3's review of the
// Synth bay translation, 2026-11-09). scripts/czech-prose-short.mjs counts them per file into
// tests/unit/czech-prose-short-baseline.json, a ratchet as the sentences' baseline is: a file's
// count only falls, a file not listed has none, and a fall is recorded in the same change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../scripts/czech-prose.mjs';
import {
  SHORT_BASELINE_REL, htmlShort, isShortEnglish, moduleShort, shortCounts,
} from '../../scripts/czech-prose-short.mjs';

const baseline = JSON.parse(readFileSync(path.join(ROOT, SHORT_BASELINE_REL), 'utf8'));

test('no file shows more short English than its baseline, and no new file shows any', () => {
  const rises = Object.entries(shortCounts()).filter(([f, n]) => n > (baseline.counts[f] || 0))
    .map(([f, n]) => `${f}: ${n} short English text(s), the baseline allows `
      + `${baseline.counts[f] || 0}`);
  assert.deepEqual(rises, [], 'write the new label in Czech (rule project.czech-prose, Q104)');
});

test('a file whose short English fell lowers its baseline in the same change', () => {
  const now = shortCounts();
  const falls = Object.entries(baseline.counts).filter(([f, n]) => (now[f] || 0) < n)
    .map(([f, n]) => `${f}: ${now[f] || 0} < ${n}: lower the baseline `
      + '(node scripts/czech-prose-short.mjs --write)');
  assert.deepEqual(falls, []);
  const sum = Object.values(baseline.counts).reduce((a, b) => a + b, 0);
  assert.equal(baseline.total, sum, 'the baseline total is the sum of its counts');
});

test('mutation: short English is found, the shapes of code and Czech text are not', () => {
  for (const t of ['Restore normal', 'CABLES', 'Connection cancelled.', 'Play', 'Remove cable',
    'Synth link copied.', 'Not applied', 'Show ${p.label} lane']) {
    assert.equal(isShortEnglish(t), true, `short English: ${t}`);
  }
  for (const t of ['Obnovit normál', 'KABELY', 'Propojování zrušeno.', 'Studio', 'MIDI',
    'Kick', 'click', 'keydown', 'Enter', 'Escape', 'synthSteps', 'text-gray-900 dark:bg-gray-800',
    'osc-si-${id}-name', 'df0e4cf3bb9a9f8ceafbbaf5cbbeb9aa334ae018733474a083e45f806884a9d7',
    'The output belongs to the measurement: stop it first.']) {
    assert.equal(isShortEnglish(t), false, `not counted: ${t}`);
  }
});

test('mutation: a new short English label in a module or the page is named', () => {
  const mod = 'export const a = \'Kroky\';\nexport const b = \'Restore normal\';\n';
  assert.deepEqual(moduleShort(mod), ['Restore normal']);
  const html = '<button>Uložit</button><button aria-label="Close dialog">x</button><h3>CABLES</h3>';
  assert.deepEqual(htmlShort(html), ['CABLES', 'Close dialog']);
});
