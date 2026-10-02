import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEARING_RANGES, CALL_EXAMPLES, DISCLAIMER, rangeToLogFraction,
} from '../../src/js/data/bioacoustics.js';

const ALL = [...HEARING_RANGES, ...CALL_EXAMPLES];
const hasLink = (s) => typeof s === 'string' && /^(https?:\/\/|10\.\d{4,}\/)/.test(s);

test('disclaimer text', () => {
  assert.equal(DISCLAIMER, 'Ranges are approximate and vary by source and individual.');
});

test('required species present', () => {
  const ids = HEARING_RANGES.map((r) => r.id);
  for (const id of ['human', 'dog', 'cat', 'bat', 'elephant', 'mouse', 'dolphin']) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(new Set(ALL.map((r) => r.id)).size, ALL.length, 'ids unique');
});

for (const e of ALL) {
  test(`entry ${e.id}: shape, source, range`, () => {
    for (const k of ['id', 'label', 'species', 'basis', 'notes']) {
      assert.ok(typeof e[k] === 'string' && e[k].length > 0, k);
    }
    assert.ok(e.minHz > 0 && e.maxHz > 0, 'positive');
    assert.ok(Number.isFinite(e.minHz) && Number.isFinite(e.maxHz));
    assert.ok(e.minHz < e.maxHz, 'min < max');
    const s = e.source;
    assert.ok(s.authors && s.title && s.venue, 'source fields');
    assert.ok(Number.isInteger(s.year) || s.year === null);
    assert.ok(hasLink(s.doi_or_url), 'source URL or DOI');
    const f = rangeToLogFraction(e.minHz, e.maxHz);
    assert.ok(f, 'fraction exists');
    assert.ok(f.start >= 0 && f.end <= 1 && f.start < f.end, 'valid axis fraction');
  });
}

test('hearing entries carry a criterion and sourced alternatives', () => {
  for (const r of HEARING_RANGES) {
    assert.ok('criterionDbSpl' in r);
    assert.ok(r.criterionDbSpl === null || r.criterionDbSpl > 0);
    assert.ok(Array.isArray(r.alternatives));
    for (const a of r.alternatives) {
      assert.ok(a.minHz > 0 && a.minHz < a.maxHz);
      assert.ok(hasLink(a.source.doi_or_url));
    }
  }
});

test('rangeToLogFraction geometry', () => {
  const full = rangeToLogFraction(10, 100000);
  assert.deepEqual([full.start, full.end, full.width], [0, 1, 1]);
  const mid = rangeToLogFraction(100, 1000);
  assert.ok(Math.abs(mid.start - 0.25) < 1e-12 && Math.abs(mid.end - 0.5) < 1e-12);
  const clamped = rangeToLogFraction(1, 1e6);
  assert.deepEqual([clamped.start, clamped.end], [0, 1]);
  assert.equal(rangeToLogFraction(0, 100), null);
  assert.equal(rangeToLogFraction(100, 100), null);
  assert.equal(rangeToLogFraction(200, 100), null);
  assert.equal(rangeToLogFraction(NaN, 100), null);
  assert.equal(rangeToLogFraction(1, 5), null, 'entirely below axis');
  assert.equal(rangeToLogFraction(2e5, 3e5), null, 'entirely above axis');
  assert.ok(rangeToLogFraction(20, 20000, 20, 20000).width === 1);
});
