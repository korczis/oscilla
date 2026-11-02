// K157, the owner's decisions Q079-Q082: every library entry is original, MIT, records its method
// and is symbolic notes only, and the built page carries no audio.
//   node --test tests/unit/content-rights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  distProblems, entryProblems, fingerprint, main,
} from '../../scripts/content-rights.mjs';
import { METHODS, RIFFS } from '../../src/js/studio/riffs/library.js';

const DIST = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
const good = (over = {}) => ({ id: 'probe', origin: 'original', author: 'OSCILLA',
  licence: 'MIT', method: 'human', title: 'Probe', notes: [[0, 'A2', 2, 100], [4, 'C3', 2, 90]],
  ...over });
const only = (entries, re) => {
  const p = entryProblems(entries, METHODS);
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], re);
};

test('the shipped library and dist hold the owner\'s decisions', async () => {
  assert.deepEqual(entryProblems(RIFFS, METHODS), []);
  assert.deepEqual(distProblems(DIST), []);
  assert.equal(await main([]), 0);
});

test('Q079/Q080: an entry that is not original, OSCILLA\'s and MIT is refused', () => {
  assert.deepEqual(entryProblems([good()], METHODS), []);
  only([good({ licence: 'CC-BY-4.0' })], /licence is "CC-BY-4.0", not 'MIT'/);
  only([good({ licence: undefined })], /licence is undefined/);
  only([good({ origin: 'verified-open' })], /origin is "verified-open"/);
  // a third-party work relabelled original still names its author
  only([good({ author: 'Somebody Else' })], /author is "Somebody Else", not 'OSCILLA'/);
});

test('Q081: an entry without a method, or with one outside METHODS, is refused', () => {
  only([good({ method: undefined })], /method undefined is not one of/);
  only([good({ method: 'transcribed' })], /method "transcribed" is not one of/);
});

test('Q082: anything but symbolic notes in an entry is refused', () => {
  only([good({ preview: 'data:audio/wav;base64,UklGRiQAAABXQVZF' })], /carries media/);
  only([good({ sample: `${'QUJD'.repeat(40)}==` })], /carries media/);
  only([good({ source: 'https://example.com/loop.wav' })], /carries media/);
  only([good({ notes: [] })], /has no notes/);
  only([good({ notes: [[0, 'H2', 2, 100]] })],
    /note 0 .* is not \[step, pitch, length, velocity\]/);
  only([good({ notes: [[-1, 'A2', 2, 100]] })], /note 0/);
  only([good({ notes: [[0, 'A2', 0, 100]] })], /note 0/);
  only([good({ notes: [[0, 'A2', 2, 200]] })], /note 0/);
});

test('an id or a set of notes is one entry\'s only', () => {
  const both = entryProblems([good(), good()], METHODS);
  assert.equal(both.length, 2, both.join('\n'));
  assert.match(both[0], /the id is also entry #0's/);
  assert.match(both[1], /the same notes as entry probe/);
  const twin = good({ id: 'twin' });
  only([good(), twin], /entry twin: the same notes as entry probe/);
  assert.equal(fingerprint(good()), fingerprint(twin));
  assert.notEqual(fingerprint(good()), fingerprint(good({ notes: [[0, 'A2', 2, 101]] })));
  assert.deepEqual(entryProblems([], METHODS), ['the library holds no entries']);
});

test('Q082: a built page carrying audio is refused, whatever form the audio takes', () => {
  const clean = '<html><body>export.wav</body></html>';
  assert.deepEqual(distProblems(clean), [], 'a file name is not audio');
  for (const [bad, re] of [
    ['<audio src="x">', /an <audio> element/],
    ['url(data:audio/mpeg;base64,AAAA)', /a data:audio URI/],
    [`"UklGR${'A'.repeat(60)}"`, /RIFF\/WAVE/],
    [`"SUQz${'A'.repeat(60)}"`, /ID3\/MP3/],
    [`"T2dnUw${'A'.repeat(60)}"`, /Ogg/],
    [`"ZkxhQw${'A'.repeat(60)}"`, /FLAC/],
  ]) {
    const p = distProblems(clean + bad);
    assert.equal(p.length, 1, bad);
    assert.match(p[0], re);
  }
});
