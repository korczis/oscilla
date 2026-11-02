// project.a-phone-sounds v1: the browser proof that a phone sounds stays in the gate, with the
// browser's user-gesture rule on (owner report 2026-11-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('touch-audio.cjs is a suite of test:browser, so the release and CI gates run it', () => {
  const pkg = JSON.parse(read('package.json'));
  // a suite of test:browser: run by node itself, or an argument of the runner (run-suites.cjs)
  const runs = pkg.scripts['test:browser'].split('&&').map((c) => c.trim().split(/\s+/));
  assert.ok(runs.some((c) => c[0] === 'node' && (c[1] === 'tests/browser/touch-audio.cjs'
    || (c[1] === 'tests/browser/lib/run-suites.cjs'
      && c.slice(2).includes('tests/browser/touch-audio.cjs')))),
  'touch-audio.cjs runs in test:browser');
});

test('touch-audio.cjs keeps Chromium\'s user-gesture rule on and both of its checks', () => {
  // the code, not the header comment that explains why every other suite switches it off
  const suite = read('tests/browser/touch-audio.cjs').split('\n')
    .filter((line) => !line.trimStart().startsWith('//')).join('\n');
  assert.match(suite, /--autoplay-policy=user-gesture-required/);
  assert.doesNotMatch(suite, /no-user-gesture-required/,
    'the suite that proves a phone sounds must not switch the gesture rule off');
  assert.match(suite, /check\('audio-session-playback'/);
  assert.match(suite, /check\('tap-unlocks-audio'/);
});
