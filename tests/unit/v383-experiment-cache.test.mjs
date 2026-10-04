// V383 §241: saved experiments must not stay decoded for the page's lifetime. The experiments
// cache keeps the ones on screen plus a few recently opened, least recently used first out.
import test from 'node:test';
import assert from 'node:assert';

import { CACHE_RECENT, rememberBounded } from '../../src/js/ui/experiments.js';

test('V383: the experiments cache keeps only the most recent unpinned entries', () => {
  const cache = new Map();
  for (let i = 0; i < 50; i++) rememberBounded(cache, `e${i}`, { i });
  assert.equal(cache.size, CACHE_RECENT);
  assert.deepStrictEqual([...cache.keys()], ['e46', 'e47', 'e48', 'e49']);
});

test('V383: an entry shown in detail or compare is never evicted', () => {
  const cache = new Map();
  rememberBounded(cache, 'shown', {});
  for (let i = 0; i < 20; i++) rememberBounded(cache, `e${i}`, {}, ['shown', 'e0']);
  assert.ok(cache.has('shown'));
  assert.ok(cache.has('e0'));
  assert.equal(cache.size, CACHE_RECENT + 2);
});

test('V383: opening a cached experiment again makes it the most recent', () => {
  const cache = new Map();
  for (const id of ['a', 'b', 'c', 'd']) rememberBounded(cache, id, { id });
  rememberBounded(cache, 'a', cache.get('a'));
  rememberBounded(cache, 'e', {});
  assert.deepStrictEqual([...cache.keys()], ['c', 'd', 'a', 'e']);
});
