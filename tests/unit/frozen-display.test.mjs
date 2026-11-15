// U114 (oscilla-c3 under Q090, 2026-11-15): the frozen V1 sentences that name a control by its
// old label stay byte-exact as data (tests/freeze/golden-a7b7a23.json), and the page shows
// each through core/frozen-display.js in Czech, naming the control as it is on screen. The
// sentences are derived from the golden, never typed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FROZEN_DISPLAY, shownText } from '../../src/js/core/frozen-display.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GOLDEN = JSON.parse(readFileSync(`${ROOT}tests/freeze/golden-a7b7a23.json`, 'utf8'));

/** The old labels of controls that are now Czech on screen (U114). */
const OLD_LABELS = /HOLD TO PLAY|TRIGGER|^Trigger duration$/;

/** Every string value of the golden, recursively. */
function strings(v, out = new Set()) {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const FROZEN = [...strings(GOLDEN)].filter((s) => OLD_LABELS.test(s));

test('the golden pins sentences that name the old labels (the derivation reads something)', () => {
  assert.ok(FROZEN.length >= 4, FROZEN.join(' | '));
});

test('every frozen sentence naming an old label has its Czech form, and only those are mapped',
  () => {
    for (const s of FROZEN) assert.ok(Object.hasOwn(FROZEN_DISPLAY, s), `no Czech form: ${s}`);
    for (const k of Object.keys(FROZEN_DISPLAY)) {
      assert.ok(strings(GOLDEN).has(k), `mapped but not frozen: ${k}`);
    }
  });

test('the shown text never names an old label, alone or inside a longer notice', () => {
  for (const s of FROZEN) {
    assert.doesNotMatch(shownText(s), OLD_LABELS, s);
    const joined = shownText(`Odkaz neobsahoval 2 položky. ${s}`);
    assert.ok(joined.startsWith('Odkaz neobsahoval 2 položky. '), joined);
    assert.doesNotMatch(joined, /HOLD TO PLAY|TRIGGER/, joined);
  }
  assert.equal(shownText('Hraje'), 'Hraje');
  assert.equal(shownText(''), '');
  assert.equal(shownText(undefined), undefined);
});

test('the page reads notices, plan warnings and pattern field labels through shownText', () => {
  const html = readFileSync(`${ROOT}src/index.html`, 'utf8');
  assert.match(html, /x-text="shownText\(a\.title\)"/);
  assert.match(html, /x-text="shownText\(a\.message\)"/);
  assert.match(html, /planWarnings\.map\(shownText\)/);
  const wb = readFileSync(`${ROOT}src/js/ui/workbench.js`, 'utf8');
  assert.match(wb, /ppLabel\(d\) \{ return this\.ppSweep \? this\.sweepLabel\(d\) : shownText\(d\.label\); \}/);
});
