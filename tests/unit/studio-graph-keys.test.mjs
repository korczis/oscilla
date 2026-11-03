// Studio graph keys of plan K009 (spec §64, §125; ADR 0050): Shift+Delete / Backspace is
// delete-bridge, L is tidy and M is mute in the ONE shortcut table (graph-keys.js
// STUDIO_SHORTCUTS), which the shortcut dialog lists; no graph key takes Space. What the keys do
// is tests/unit/studio-graph-commands.test.mjs.
//   node --test tests/unit/studio-graph-keys.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { STUDIO_SHORTCUTS, resolveStudioKey } from '../../src/js/ui/studio/graph-keys.js';
import { shortcutHelp } from '../../src/js/ui/shortcuts.js';

const key = (k, o = {}) => resolveStudioKey({ key: k, code: '', ctrlKey: false, metaKey: false,
  shiftKey: false, altKey: false, ...o });

test('K009 Shift+Delete bridges, L tidies, M mutes; plain Delete, Space and the timeline keep '
  + 'theirs', () => {
  assert.deepEqual(key('Delete', { shiftKey: true }), { id: 'delete-bridge' });
  assert.deepEqual(key('Backspace', { shiftKey: true }), { id: 'delete-bridge' });
  assert.deepEqual(key('Delete'), { id: 'delete' });
  assert.deepEqual(key('l'), { id: 'tidy' });
  assert.deepEqual(key('m'), { id: 'mute' });
  assert.equal(key('L', { shiftKey: true }), null);
  assert.equal(key('m', { ctrlKey: true }), null);
  assert.deepEqual(key(' ', { code: 'Space' }), { id: 'play-toggle' });
  assert.deepEqual(key(' ', { code: 'Space', shiftKey: true }), { id: 'play-toggle' });
});

test('K009 the shortcut list carries the new keys and no graph key takes Space', () => {
  const ids = STUDIO_SHORTCUTS.map((s) => s.id);
  for (const id of ['delete-bridge', 'tidy', 'mute']) assert.ok(ids.includes(id), id);
  assert.equal(STUDIO_SHORTCUTS.find((s) => s.id === 'tidy').keys, 'L');
  assert.equal(STUDIO_SHORTCUTS.find((s) => s.id === 'mute').keys, 'M');
  assert.equal(STUDIO_SHORTCUTS.find((s) => s.id === 'delete-bridge').keys,
    'Shift Delete / Backspace');
  for (const s of STUDIO_SHORTCUTS) {
    if (s.id !== 'play-toggle') assert.ok(!/Space/.test(s.keys), `${s.id} takes Space`);
  }
  // The dialog's list is generated from the table.
  const listed = shortcutHelp('studio').rows.map((r) => r.id);
  for (const id of ['delete-bridge', 'tidy', 'mute']) assert.ok(listed.includes(id), id);
});
