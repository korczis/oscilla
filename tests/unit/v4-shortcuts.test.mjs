// One meaning for Space and one shortcut list (ledger W5, ADR 0050):
//   - src/js/ui/shortcuts.js says, for every workspace, who owns Space (the instrument's Hold to
//     Play, the Studio transport, or nobody) and what the one Keyboard shortcuts dialog lists
//   - the Studio part of that list is graph-keys.js STUDIO_SHORTCUTS, in its order
//   - src/index.html has one shortcut dialog, opened from Help, the overflow menu and Studio
//   node --test tests/unit/v4-shortcuts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKSPACES } from '../../src/js/ui/app.js';
import { STUDIO_SHORTCUTS } from '../../src/js/ui/studio/graph-keys.js';
import { KEY_HELP } from '../../src/js/ui/studio/transport-view.js';
import {
  GLOBAL_SHORTCUTS, SPACE_MEANING, SPACE_OWNER, WORKSPACE_LABELS, instrumentTakesSpace, isSpace,
  shortcutHelp, spaceOwner,
} from '../../src/js/ui/shortcuts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const INSTRUMENT = ['playground', 'analyzer', 'filter', 'compare', 'synthesis', 'sequencer'];
const NONE = ['measure', 'experiments', 'learn', 'presets', 'about'];

test('every workspace has exactly one Space owner, and every owner is known', () => {
  assert.deepEqual(Object.keys(SPACE_OWNER).sort(), [...WORKSPACES].sort());
  assert.deepEqual(Object.keys(WORKSPACE_LABELS).sort(), [...WORKSPACES].sort());
  for (const ws of INSTRUMENT) assert.equal(spaceOwner(ws), 'instrument', ws);
  assert.equal(spaceOwner('studio'), 'studio');
  for (const ws of NONE) assert.equal(spaceOwner(ws), null, ws);
  assert.equal(spaceOwner('bogus'), null);
  assert.equal(spaceOwner('__proto__'), null);
});

test('the instrument hears Space only in its own workspaces', () => {
  for (const ws of WORKSPACES) {
    assert.equal(instrumentTakesSpace(ws), INSTRUMENT.includes(ws), ws);
  }
});

test('isSpace recognises the key by character or by code, nothing else', () => {
  assert.equal(isSpace({ key: ' ', code: 'Space' }), true);
  assert.equal(isSpace({ key: 'Unidentified', code: 'Space' }), true);
  assert.equal(isSpace({ key: ' ', code: '' }), true);
  assert.equal(isSpace({ key: 'Enter', code: 'Enter' }), false);
  assert.equal(isSpace(null), false);
});

test('the dialog names the Space meaning of the workspace in view', () => {
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    const owner = spaceOwner(ws);
    assert.equal(h.workspace, ws);
    assert.equal(h.title, WORKSPACE_LABELS[ws]);
    assert.deepEqual(h.space, SPACE_MEANING[owner || 'none'], ws);
  }
  // Studio's own table says the same as the model: one text for one meaning.
  const play = STUDIO_SHORTCUTS.find((s) => s.id === 'play-toggle');
  assert.equal(play.keys, SPACE_MEANING.studio.keys);
  assert.equal(play.text, SPACE_MEANING.studio.text);
});

test('Studio lists STUDIO_SHORTCUTS in order (Space first) and the timeline keys', () => {
  const h = shortcutHelp('studio');
  const shown = [h.space, ...h.rows].map((r) => `${r.keys}|${r.text}`);
  assert.deepEqual(shown, STUDIO_SHORTCUTS.map((s) => `${s.keys}|${s.text}`));
  assert.equal(h.timeline, KEY_HELP);
});

test('a workspace lists only its own shortcuts, plus the global ones', () => {
  const studioIds = new Set(STUDIO_SHORTCUTS.map((s) => s.id));
  studioIds.delete('escape');
  studioIds.delete('focus-next');
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    assert.deepEqual(h.global, GLOBAL_SHORTCUTS);
    const ids = h.rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${ws}: duplicate rows`);
    if (ws !== 'studio') {
      assert.ok(!ids.some((id) => studioIds.has(id)), `${ws} lists Studio editing keys`);
      assert.equal(h.timeline, null, ws);
    }
    if (spaceOwner(ws) !== 'instrument') {
      assert.ok(!ids.includes('trigger') && !ids.includes('octave'), `${ws} lists instrument keys`);
    }
  }
  assert.ok(shortcutHelp('sequencer').rows.some((r) => r.id === 'sequencer-timeline'));
  assert.ok(!shortcutHelp('playground').rows.some((r) => r.id === 'sequencer-timeline'));
  // The compact Studio panel sits in the Playground and the Sequencer: Space there is Studio's.
  for (const ws of ['playground', 'sequencer']) {
    assert.ok(shortcutHelp(ws).rows.some((r) => r.id === 'studio-panel-space'), ws);
  }
  assert.ok(shortcutHelp('measure').rows.some((r) => r.id === 'measure-abort'));
});

test('index.html: one shortcut dialog, opened by Help, the overflow menu and Studio', () => {
  const html = read('src/index.html');
  const dialogs = html.split('<dialog').slice(1).filter((d) => d.split('</dialog>')[0]
    .includes('osc-shortcuts'));
  assert.equal(dialogs.length, 1, 'one dialog lists shortcuts');
  assert.ok(dialogs[0].startsWith(' class="osc-dialog') && dialogs[0].includes('id="osc-dlg-help"'));
  assert.ok(!html.includes('osc-dlg-studio-keys'), 'the Studio-only dialog is gone');
  for (const osc of ['header.help', 'header.shortcuts', 'studio.keys']) {
    const m = html.match(new RegExp(`data-osc="${osc.replace('.', '\\.')}"[\\s\\S]*?@click="([^"]+)"`));
    assert.ok(m, osc);
    assert.equal(m[1], "openDialog('help')", osc);
  }
});
