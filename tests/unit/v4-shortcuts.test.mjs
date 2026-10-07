// One meaning for Space and one shortcut list (ledger W5, ADR 0050):
//   - src/js/ui/shortcuts.js says, for every workspace, who owns Space (the instrument's Hold to
//     Play, the Studio transport, or nobody) and what the one Keyboard shortcuts dialog lists
//   - the Studio part of that list is graph-keys.js STUDIO_SHORTCUTS, in its order
//   - src/index.html has one shortcut dialog, opened from Help, the overflow menu and Studio
//   node --test tests/unit/v4-shortcuts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

// Presets is the instrument's: Load readies it and says "Press TRIGGER (or Space)" (review of
// #159), and the workspace does not change.
const INSTRUMENT = ['playground', 'analyzer', 'filter', 'compare', 'synthesis', 'sequencer',
  'presets'];
const NONE = ['measure', 'experiments', 'learn', 'about'];
const shown = (r) => (r.where ? `${r.keys} ${r.where}` : r.keys);

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
  const listed = [h.space, ...h.rows].map((r) => `${r.keys}|${r.text}`);
  assert.deepEqual(listed, STUDIO_SHORTCUTS.map((s) => `${s.keys}|${s.text}`));
  assert.equal(h.timeline, KEY_HELP);
});

test('a workspace lists only its own shortcuts, plus the global ones', () => {
  const studioIds = new Set(STUDIO_SHORTCUTS.map((s) => s.id));
  studioIds.delete('escape');
  studioIds.delete('focus-next');
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    // The global keys, less any the workspace's own rows already state (each key once).
    const own = new Set(h.rows.map(shown));
    assert.deepEqual(h.global, GLOBAL_SHORTCUTS.filter((g) => !own.has(shown(g))), ws);
    assert.ok(h.global.length > 0, ws);
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
  assert.ok(shortcutHelp('measure').rows.some((r) => r.id === 'measure-abort'));
});

test('review of #159: no row claims a Space for the compact Studio panel', () => {
  // Every focus target in that panel is a button, which keeps Space; nothing there reaches the
  // Studio transport by Space (tests/browser/navigation.cjs space-compact-studio-panel).
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    assert.ok(!h.rows.some((r) => r.id === 'studio-panel-space'), ws);
    if (ws !== 'studio') {
      assert.ok(![...h.rows, ...h.global].some((r) => /Studio/.test(`${shown(r)} ${r.text}`)), ws);
    }
  }
});

test('review of #159: no key is listed twice in one view', () => {
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    const keys = [h.space, ...h.rows, ...h.global].map(shown);
    assert.equal(new Set(keys).size, keys.length, `${ws}: ${keys.join(' | ')}`);
  }
  // Studio's table already has Esc and Tab; Measure's Esc row is the global one plus the abort.
  const ids = (ws) => shortcutHelp(ws).global.map((g) => g.id);
  assert.deepEqual(ids('studio'), ['roving']);
  assert.deepEqual(ids('measure'), ['roving', 'tab']);
  assert.match(shortcutHelp('measure').rows.find((r) => r.id === 'measure-abort').text,
    /^Stop immediately and abort a running measurement/);
  assert.deepEqual(ids('playground'), ['escape', 'roving', 'tab']);
});

test('review of #159: keys are keys; where they apply is stated beside them', () => {
  for (const ws of WORKSPACES) {
    const h = shortcutHelp(ws);
    for (const r of [h.space, ...h.rows, ...h.global]) {
      assert.ok(!/ (on|in) |timeline:/.test(r.keys), `${ws} ${r.id}: prose in keys "${r.keys}"`);
      assert.ok(r.where === undefined || (typeof r.where === 'string' && r.where), r.id);
    }
  }
  assert.equal(SPACE_MEANING.instrument.keys, 'Space');
  assert.equal(SPACE_MEANING.instrument.where, '(hold)');
  // Hold, Trigger and the frequency slider are not on screen in every instrument workspace at
  // every width: their rows say so instead of implying the control is there.
  const play = shortcutHelp('analyzer').rows;
  for (const id of ['trigger', 'octave']) {
    assert.match(play.find((r) => r.id === id).where, /where shown/, id);
  }
});

test('review of #159: Studio keeps the note on keyboard paths; other workspaces have none', () => {
  assert.match(shortcutHelp('studio').note, /Every drag has a keyboard path: arrows move nodes, /);
  assert.match(shortcutHelp('studio').note, /focused timeline item/);
  for (const ws of WORKSPACES) if (ws !== 'studio') assert.equal(shortcutHelp(ws).note, null, ws);
});

test('review of #159: the stated rule is the one implemented', () => {
  // "The Play control of the workspace in view" was false where no Play control is shown
  // (Analyzer, Filter Lab, Compare and Presets at desktop width). No copy may say it.
  const adr = readdirSync(path.join(ROOT, '.ai/repo/adrs')).find((f) => f.startsWith('0050-'));
  const texts = { dialog: read('src/index.html'), guide: read('docs/v31/user-guide.md'),
    adr: read(path.join('.ai/repo/adrs', adr)), ledger: read('docs/v4/completion-ledger.md'),
    code: read('src/js/ui/shortcuts.js') };
  for (const [name, text] of Object.entries(texts)) {
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(!/keyboard for (the|that workspace's) Play control/.test(flat), name);
    assert.ok(!/Play control you can see/.test(flat), name);
    assert.ok(!/Play control of the workspace in view/.test(flat), name);
  }
  const flatAdr = texts.adr.replace(/\s+/g, ' ');
  assert.ok(!/status bar's Play is visible everywhere/.test(flatAdr), 'the status bar claim');
  assert.match(flatAdr, /narrow layout/);
  assert.match(texts.dialog.replace(/\s+/g, ' '), /whether or not a Play control is on screen/);
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
