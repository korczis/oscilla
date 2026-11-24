// Studio graph keys of plan K009 (spec §64, §125; ADR 0050): Shift+Delete / Backspace is
// delete-bridge, L is tidy and M is mute in the ONE shortcut table (graph-keys.js
// STUDIO_SHORTCUTS), which the shortcut dialog lists; no graph key takes Space. What the keys do
// is tests/unit/studio-graph-commands.test.mjs. Escape in an Inspector field is the field's own
// (fieldEscape): it restores the field and stops there, so the transport keeps playing.
//   node --test tests/unit/studio-graph-keys.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  STUDIO_SHORTCUTS, fieldEscape, resolveStudioKey,
} from '../../src/js/ui/studio/graph-keys.js';
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

/** A keydown event that records what its listener did with it. */
const keyEvent = (k) => {
  const e = { key: k, stopped: 0, prevented: 0 };
  e.stopPropagation = () => { e.stopped += 1; };
  e.preventDefault = () => { e.prevented += 1; };
  return e;
};

test('Escape in an Inspector field restores the field and stops there; other keys pass', () => {
  let restored = 0;
  const esc = keyEvent('Escape');
  assert.equal(fieldEscape(esc, () => { restored += 1; }), true);
  assert.equal(restored, 1, 'the field shows the model value again');
  assert.equal(esc.stopped, 1, 'neither the Studio Escape nor page.escape (stop all) sees it');
  assert.equal(esc.prevented, 0, 'the default stays (the page key never prevents Escape)');
  for (const k of ['Enter', 'Tab', 'a', ' ', 'ArrowUp']) {
    const e = keyEvent(k);
    assert.equal(fieldEscape(e, () => { restored += 1; }), false, k);
    assert.equal(e.stopped, 0, `${k} propagates`);
  }
  assert.equal(restored, 1, 'no other key restores the field');
});

test('every Escape of the Inspector\'s fields goes through fieldEscape', () => {
  const src = fs.readFileSync(new URL('../../src/js/ui/studio/inspector.js', import.meta.url),
    'utf8');
  const named = src.match(/['"`]Escape['"`]/g) || [];
  assert.deepEqual(named, [], 'an Escape the Inspector handles itself would reach page.escape');
  const routed = src.match(/addEventListener\('keydown', \(e\) => fieldEscape\(e,/g) || [];
  assert.ok(routed.length > 0, 'the Inspector fields route Escape through fieldEscape');
});
