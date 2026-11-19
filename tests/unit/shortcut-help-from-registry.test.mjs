// D05 (owner, 2026-11-17: stop duplicating code): the Keyboard shortcuts dialog lists the key
// registry. Every row of ui/shortcuts.js shortcutHelp is a declaration of its SHORTCUT_KEYS,
// read through ui/keys/registry.js helpRows; the page keys ui/keys/clients.js binds are those
// same declarations, so a binding and its help row are one object. The rows the dialog shows
// are the ones it showed before the tables became declarations
// (tests/unit/fixtures/shortcut-help-rows.json, captured from origin/main 8e087873 before the
// change): nothing was lost, added or reworded.
//
//   node --test tests/unit/shortcut-help-from-registry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { WORKSPACES } from '../../src/js/ui/app.js';
import { createKeyRegistry, helpRows, keyLabel, listedIn } from '../../src/js/ui/keys/registry.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';
import { PAGE_KEYS, SHORTCUT_KEYS, shortcutHelp } from '../../src/js/ui/shortcuts.js';

const SNAPSHOT = JSON.parse(readFileSync(fileURLToPath(
  new URL('./fixtures/shortcut-help-rows.json', import.meta.url)), 'utf8'));

/** The page bindings the dialog does not list (Alt+K, K171: shown on the keyboard's handle). */
const UNLISTED = ['keys.dock'];

/** Every row `help` shows: the Space meaning, the workspace's rows and the global ones. */
const rowsOf = (help) => [help.space, ...help.rows, ...help.global];

/**
 * The rows of `help` that no declaration of `registry` listed in its workspace says, by
 * row id, keys, words beside them and text: 'workspace/id'.
 */
export function undeclared(help, registry) {
  const decls = registry.list().filter((b) => listedIn(b, help.workspace));
  const says = (b, r) => (b.row || b.id) === r.id && b.label === r.text
    && (b.place || undefined) === r.where
    && (b.shown || b.keys.map(keyLabel).join(' / ')) === r.keys;
  return rowsOf(help).filter((r) => !decls.some((b) => says(b, r)))
    .map((r) => `${help.workspace}/${r.id}`);
}

test('the dialog shows exactly the rows it showed before they became declarations', () => {
  assert.deepEqual(Object.keys(SNAPSHOT).sort(), [...WORKSPACES].sort());
  for (const ws of WORKSPACES) {
    assert.deepEqual(JSON.parse(JSON.stringify(shortcutHelp(ws))), SNAPSHOT[ws], ws);
  }
});

test('every row of the dialog is a declaration of the key registry, in every workspace', () => {
  for (const ws of WORKSPACES) {
    assert.deepEqual(undeclared(shortcutHelp(ws), SHORTCUT_KEYS), [], ws);
  }
  // One Space meaning per workspace, from the declarations of section 'space'.
  for (const ws of WORKSPACES) {
    const spaces = helpRows(SHORTCUT_KEYS, undefined, { workspace: ws })
      .flatMap((g) => g.rows).filter((r) => r.section === 'space');
    assert.equal(spaces.length, 1, ws);
  }
});

test('mutation: a hand-typed row, or a dropped declaration, is named', () => {
  const help = shortcutHelp('sequencer');
  const typed = { ...help, rows: [...help.rows, { id: 'hand', keys: 'H', text: 'Typed by hand' }] };
  assert.deepEqual(undeclared(typed, SHORTCUT_KEYS), ['sequencer/hand']);
  const reworded = { ...help, rows: help.rows.map((r) => (r.id === 'octave'
    ? { ...r, text: 'O oktávu' } : r)) };
  assert.deepEqual(undeclared(reworded, SHORTCUT_KEYS), ['sequencer/octave']);
  const fewer = createKeyRegistry();
  for (const b of SHORTCUT_KEYS.list()) if (b.id !== 'sequencer-history') fewer.declare(b);
  assert.deepEqual(undeclared(help, fewer), ['sequencer/sequencer-history']);
});

test('a page key and its help row are one declaration', () => {
  const keys = createKeyRegistry();
  bindPageKeys({ keys, cmp: { workspace: 'playground' }, stopSequencer() {} });
  const declared = new Map(SHORTCUT_KEYS.list().map((b) => [b.id, b]));
  const bound = keys.list();
  assert.deepEqual(bound.filter((b) => !declared.has(b.id)).map((b) => b.id), UNLISTED,
    'a new page key declares its help row in ui/shortcuts.js PAGE_KEYS');
  for (const d of Object.values(PAGE_KEYS)) {
    const b = bound.find((x) => x.id === d.id);
    const h = declared.get(d.id);
    assert.ok(b && h, d.id);
    for (const k of ['keys', 'label', 'scope', 'row', 'place', 'shownIn', 'section', 'group']) {
      assert.deepEqual(b[k], h[k], `${d.id}.${k}`);
    }
    assert.equal(h.help, true, `${d.id}: the dialog's copy is help-only`);
    assert.equal(typeof b.run, 'function', `${d.id}: the page's copy runs`);
  }
});

test('a help-only declaration is listed, never resolved, and owns no chord', () => {
  const keys = createKeyRegistry();
  keys.declare({ id: 'grid.toggle', shown: 'Enter', label: 'Toggle',
    scope: { workspace: 'synth' } });
  keys.declare({ id: 'grid.copy', keys: ['Ctrl+KeyC'], label: 'Copy',
    scope: { workspace: '*' }, shownIn: ['studio'] });
  let ran = 0;
  keys.bind({ id: 'copy', keys: ['Ctrl+KeyC'], scope: { workspace: '*' }, label: 'Copy',
    run: () => { ran += 1; } });
  assert.equal(keys.resolve('Ctrl+KeyC', { workspace: 'studio' }).id, 'copy');
  assert.equal(keys.resolve('Enter', { workspace: 'synth' }), null);
  assert.equal(ran, 0);
  assert.throws(() => keys.declare({ id: 'copy', shown: 'C', label: 'x',
    scope: { workspace: '*' } }), /already bound/);
  assert.throws(() => keys.declare({ id: 'nokeys', label: 'x', scope: { workspace: '*' } }),
    /has no keys/);
  assert.throws(() => keys.bind({ id: 'norun', shown: 'X', label: 'x',
    scope: { workspace: '*' } }), /has no keys/, 'a binding still needs chords');
  const rows = (ws) => helpRows(keys, undefined, { workspace: ws }).flatMap((g) => g.rows)
    .map((r) => `${r.id}:${r.shown}:${r.section}`);
  assert.deepEqual(rows('synth'), ['grid.toggle:Enter:workspace', 'copy:Ctrl+C:everywhere']);
  assert.deepEqual(rows('studio'), ['grid.copy:Ctrl+C:workspace', 'copy:Ctrl+C:everywhere']);
});
