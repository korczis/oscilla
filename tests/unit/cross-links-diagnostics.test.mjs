// C028 slice 1: a cross-links round trip that misses its deadline says what it saw. The wait
// keeps the last state it read (tests/browser/lib/last-state.cjs), and every Back / Forward /
// traverse failure of tests/browser/cross-links.cjs names it: workspace, hash, focusTag,
// focusOsc, focusBody, headingOf. Before, H.until caught the timeout and returned null, so the
// log said only "did not return".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { untilState, describeState, ROUND_TRIP_FIELDS } =
  require('../browser/lib/last-state.cjs');
const SUITE = readFileSync(new URL('../browser/cross-links.cjs', import.meta.url), 'utf8');

// A WebKit P8 keyboard miss as it could look: the Sequencer is back, focus on <body>.
const BODY_FOCUS = { workspace: 'sequencer', hash: '#m=sequencer', histLen: 7,
  focusTag: 'BODY', focusBody: true, focusOsc: null, headingOf: false,
  studioTitle: 'Sequencer pattern', learnTopic: null };

test('a forced timeout reports the last state read, not null', async () => {
  let reads = 0;
  const r = await untilState(async () => { reads += 1; return { ...BODY_FOCUS }; },
    (s) => s.workspace === 'sequencer' && !s.focusBody,
    { ms: 120, what: 'Studio Back returns to the Sequencer with focus on a control' });
  assert.equal(r.state, null, 'the predicate never held');
  assert.ok(reads >= 1);
  assert.deepEqual(r.last, BODY_FOCUS, 'the last state read is kept');
  assert.match(r.error.message, /not reached within 120 ms/);
  const text = describeState(r);
  for (const f of ROUND_TRIP_FIELDS) assert.match(text, new RegExp(`"${f}":`), f);
  assert.match(text, /"workspace":"sequencer"/);
  assert.match(text, /"hash":"#m=sequencer"/);
  assert.match(text, /"focusTag":"BODY"/);
  assert.match(text, /"focusOsc":null/);
  assert.match(text, /"focusBody":true/);
  assert.match(text, /"headingOf":false/);
});

test('the last state is the latest one read, as the page changed under the wait', async () => {
  const seq = [{ workspace: 'studio', hash: '#m=studio' },
    { workspace: 'sequencer', hash: '#m=sequencer', focusTag: 'BODY', focusBody: true }];
  let i = 0;
  const r = await untilState(async () => seq[Math.min(i++, seq.length - 1)],
    (s) => s.headingOf, { ms: 120, what: 'history.back() opens sequencer' });
  assert.equal(r.state, null);
  assert.equal(r.last.workspace, 'sequencer');
  assert.match(describeState(r), /"focusTag":"BODY".*"focusOsc":null/,
    'a field the state lacks is named as null');
});

test('a passing wait returns the state that held, unchanged', async () => {
  const s = { workspace: 'learn', hash: '#m=learn', focusTag: 'H2', focusBody: false,
    focusOsc: null, headingOf: true };
  const r = await untilState(async () => s, (x) => x.headingOf,
    { ms: 1000, what: 'Back opens Learn' });
  assert.equal(r.state, s);
  assert.equal(r.error, null);
});

test('a read that fails before any state says so instead of printing null', async () => {
  const r = await untilState(async () => { throw new Error('Target page closed'); },
    () => true, { ms: 200, what: 'page gone' });
  assert.equal(r.state, null);
  assert.equal(r.last, null);
  assert.match(describeState(r), /none read \(Target page closed\)/);
  assert.match(describeState(undefined), /no wait recorded/);
});

test('cross-links.cjs keeps the last state and names it in every round-trip failure', () => {
  assert.match(SUITE, /require\('\.\/lib\/last-state\.cjs'\)/);
  const h = SUITE.slice(SUITE.indexOf('async until(page, w, pred, what)'));
  const body = h.slice(0, h.indexOf('\n  },'));
  assert.match(body, /untilState\(/, 'H.until polls through untilState');
  assert.doesNotMatch(body, /\.catch\(\(\) => null\)/, 'H.until no longer drops the state');
  assert.match(body, /ms: NAV_MS/, 'H.until keeps its deadline');
  // Every failure that follows an H.until / arrived / traverse / setWorkspace names the state.
  const pushes = SUITE.match(/wrong\.push\(`[^]*?\);/g) || [];
  const roundTrip = pushes.filter((p) => /(did not (return|reopen|open)|could not open)/.test(p)
    && !/untouched demo notice/.test(p));
  assert.ok(roundTrip.length >= 15, `round-trip failure messages found: ${roundTrip.length}`);
  const bare = roundTrip.filter((p) => !/H\.seen\(page\)/.test(p));
  assert.deepEqual(bare, [], 'each Back / Forward / traverse failure carries H.seen(page)');
});
