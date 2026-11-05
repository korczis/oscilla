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
  // The keyboard's rows (K026) follow Studio's own; tests/unit/midi/keyboard.test.mjs pins them.
  const listed = [h.space, ...h.rows.filter((r) => !r.id.startsWith('keyboard-'))]
    .map((r) => `${r.keys}|${r.text}`);
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
  // K003: the focused Sequencer timeline (a listbox, which keeps Space from the instrument)
  // plays and stops the sequence, undoes and redoes, copies and pastes blocks.
  const seq = Object.fromEntries(shortcutHelp('sequencer').rows.map((r) => [r.id, r]));
  assert.deepEqual(seq['sequencer-space'], { id: 'sequencer-space', keys: 'Space',
    where: 'on the Sequencer timeline', text: 'Play / stop the sequence' });
  assert.equal(seq['sequencer-history'].keys, 'Ctrl/⌘ Z, Shift + Ctrl/⌘ Z');
  assert.equal(seq['sequencer-clipboard'].keys, 'Ctrl/⌘ C, Ctrl/⌘ V');
  assert.equal(shortcutHelp('sequencer').space, SPACE_MEANING.instrument,
    'with nothing focused Space is still the instrument\'s (ADR 0050)');
  for (const ws of WORKSPACES.filter((w) => w !== 'sequencer')) {
    assert.ok(!shortcutHelp(ws).rows.some((r) => r.id.startsWith('sequencer-')), ws);
  }
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
  // The ADR quotes the first wording once, as a rejected alternative: that section is not read.
  const whole = read(path.join('.ai/repo/adrs', adr));
  const from = whole.indexOf('## Alternatives rejected');
  const to = whole.indexOf('## Consequences');
  assert.ok(from > 0 && to > from, 'the ADR has both sections');
  const texts = { dialog: read('src/index.html'), guide: read('docs/v31/user-guide.md'),
    adr: whole.slice(0, from) + whole.slice(to), ledger: read('docs/v4/completion-ledger.md'),
    code: read('src/js/ui/shortcuts.js') };
  for (const [name, text] of Object.entries(texts)) {
    const flat = text.replace(/\s+/g, ' ');
    assert.ok(!/keyboard for (the|that workspace's) Play control/.test(flat), name);
    assert.ok(!/Play control you can see/.test(flat), name);
    assert.ok(!/Play control of the workspace in view/.test(flat), name);
  }
  const flatAdr = whole.replace(/\s+/g, ' ');
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

// C032: the status bar's Play key acts on what the workspace on screen plays, read from
// SPACE_OWNER through one function of shortcuts.js (no table of its own), not always the
// Playground tone. The Studio keeps the instrument's meaning (ADR 0050, C001, C012) until U012.
// Namespace imports, so that on a base without these members only these tests fail.
import * as SC from '../../src/js/ui/shortcuts.js';
import * as WB from '../../src/js/ui/workbench.js';

const STATUS_TARGET = { measure: 'measure', synth: 'synth', experiments: null, about: null,
  learn: 'instrument', studio: 'instrument' };

test('C032: the status Play target of every workspace', () => {
  assert.equal(typeof SC.statusPlayTarget, 'function', 'shortcuts.js exports statusPlayTarget');
  for (const ws of WORKSPACES) {
    const want = Object.hasOwn(STATUS_TARGET, ws) ? STATUS_TARGET[ws] : 'instrument';
    if (!Object.hasOwn(STATUS_TARGET, ws)) assert.equal(spaceOwner(ws), 'instrument', ws);
    assert.equal(SC.statusPlayTarget(ws), want, ws);
  }
  assert.equal(SC.statusPlayTarget('bogus'), null);
  assert.equal(SC.statusPlayTarget('__proto__'), null);
  const code = read('src/js/ui/shortcuts.js');
  assert.ok(!/STATUS_PLAY_TARGET|STATUS_OWNER/.test(code), 'no second owner table');
});

/** The workbench over fakes of the Synth part, MEASURE's flow and the instrument. */
function statusRig(workspace, state = {}) {
  const calls = [];
  const svc = { sequencerPlaying: () => false,
    stopPlayback(cmp) { calls.push('stopPlayback'); cmp.playing = false; } };
  const wb = WB.createWorkbench(svc);
  Object.assign(wb, { workspace, playing: false, seqPlaying: false, continuousAllowed: false,
    isProgrammed: false, synth: { armed: false },
    meas: { active: false, flow: { primaryAction: { id: 'preflight', label: 'Check setup',
      enabled: true, reason: '' } } },
    trigger() { calls.push('trigger'); this.playing = true; },
    toggleLatch() { calls.push('toggleLatch'); this.playing = true; },
    synthArm() { calls.push('synthArm'); this.synth.armed = true; return true; },
    synthDisarm() { calls.push('synthDisarm'); this.synth.armed = false; },
    measureRunPrimary() { calls.push('measureRunPrimary'); } }, state);
  return { wb, calls };
}

test('C032: isSounding includes the armed Synth (the Studio stays out until U012)', () => {
  const { wb } = statusRig('synth');
  assert.equal(wb.isSounding, false);
  wb.synth.armed = true;
  assert.equal(wb.isSounding, true, 'the armed Synth sounds through the one output');
});

test('C032: in the Synth the status Play arms, then disarms, the Synth', () => {
  const { wb, calls } = statusRig('synth');
  assert.equal(wb.statusKey.label, 'Arm Synth');
  assert.equal(wb.statusKey.pressed, false);
  wb.statusPlay();
  assert.deepEqual(calls, ['synthArm'], 'the Synth\'s own arm path, never the instrument');
  assert.equal(wb.playing, false, 'the Playground tone does not start');
  assert.equal(wb.statusKey.label, 'Disarm Synth');
  assert.equal(wb.statusKey.pressed, true);
  wb.statusPlay();
  assert.deepEqual(calls, ['synthArm', 'synthDisarm']);
});

test('C032: in MEASURE the status Play is the primary flow action, with its label', () => {
  const { wb, calls } = statusRig('measure');
  assert.equal(wb.statusKey.label, 'Check setup');
  assert.equal(wb.statusKey.disabled, false);
  wb.statusPlay();
  assert.deepEqual(calls, ['measureRunPrimary'], 'MEASURE\'s own action, not the instrument');
  wb.meas.flow.primaryAction = { id: 'measure', label: 'Measure', enabled: false,
    reason: 'Check setup first.' };
  assert.equal(wb.statusKey.disabled, true);
  assert.equal(wb.statusKey.reason, 'Check setup first.');
});

test('C032: Experiments and About show no status Play, and a press starts nothing', () => {
  for (const ws of ['experiments', 'about']) {
    const { wb, calls } = statusRig(ws);
    assert.equal(wb.statusKey.target, null, ws);
    wb.statusPlay();
    assert.deepEqual(calls, [], ws);
  }
  const html = read('src/index.html');
  const key = html.match(/<button[^>]*data-osc="status\.play"[\s\S]*?>/);
  assert.ok(key, 'the status Play key');
  assert.match(key[0], /x-show="statusKey\.target !== null"/, 'hidden where it plays nothing');
  assert.match(key[0], /:aria-label="statusKey\.label"/, 'its name follows the owner');
  assert.match(key[0], /:aria-pressed="String\(statusKey\.pressed\)"/);
});

test('C032: the instrument workspaces keep latch or trigger, and Stop starts nothing', () => {
  for (const ws of ['playground', 'analyzer', 'learn', 'studio']) {
    const { wb, calls } = statusRig(ws, { continuousAllowed: true });
    assert.equal(wb.statusKey.label, 'Play continuously', ws);
    wb.statusPlay();
    assert.deepEqual(calls, ['toggleLatch'], ws);
    assert.equal(wb.statusKey.label, 'Stop playback', ws);
    wb.statusPlay();
    assert.deepEqual(calls, ['toggleLatch', 'stopPlayback'], ws);
  }
  const src = read('src/js/ui/workbench.js');
  assert.match(src, /statusPlayTarget\(this\.workspace\)/, 'statusPlay reads the one function');
});
