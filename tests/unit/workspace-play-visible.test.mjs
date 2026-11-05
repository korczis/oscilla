// C030: a visible Play on every workspace that should sound, on desktop as on the phone.
//
// Before C030 Analyzer, Filter Lab, Compare and Presets had no Play at 1536x1024: Source &
// Pattern (Hold to Play, Trigger) lists only playground sequencer synthesis in data-osc-modes,
// the desktop focus layouts hide every panel a workspace does not list, and the status-bar Play
// was display: none above 767 px. Presets also said "Press TRIGGER" with no Trigger on screen.
// After: every workspace whose Space owner is not null shows one Play control at every width
// (shortcuts.js playControl), and the ready notices name the control that is there. No new
// player: the status-bar Play is the instrument's existing statusPlay.
//
//   node --test tests/unit/workspace-play-visible.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as shortcuts from '../../src/js/ui/shortcuts.js';
import { createInstrument } from '../../src/js/core/instrument.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('src/index.html');
const DIST = read('dist/index.html');
const { SPACE_OWNER } = shortcuts;
const SOUNDING = Object.keys(SPACE_OWNER).filter((ws) => SPACE_OWNER[ws] !== null);

/** The opening tag of the element carrying `attr` (an attribute=value text), or ''. */
function openTag(attr) {
  const at = HTML.indexOf(attr);
  if (at < 0) return '';
  return HTML.slice(HTML.lastIndexOf('<', at), HTML.indexOf('>', at) + 1);
}

/** The text of the element whose opening tag carries `attr`, up to its closing `</tag>`. */
function elementText(attr, tag) {
  const start = HTML.lastIndexOf('<', HTML.indexOf(attr));
  return HTML.slice(start, HTML.indexOf(`</${tag}>`, start));
}

const SOURCE_TAG = openTag('id="osc-panel-source"');
const sourceModes = () => (SOURCE_TAG.match(/data-osc-modes="([^"]*)"/) || [, ''])[1]
  .split(/\s+/).filter(Boolean);
const PLAY_TAG = openTag('id="osc-sb-play"');

/** The instrument and workbench composed as main.js composes them (descriptors, in order). */
function component(workspace) {
  const target = {};
  const parts = [
    createInstrument({ engine: null, location: { hash: '', href: '', search: '' },
      timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
        clearInterval() {} } }),
    createWorkbench({ labSnapshot: () => null, applyLabSnapshot: () => null,
      labsMounted: () => true, sequencerPlaying: () => false, stopPlayback() {} }),
  ];
  for (const part of parts) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(part));
  }
  target.sampleRate = 48000;
  target.workspace = workspace;
  return target;
}

test('the source panel lists exactly SOURCE_PANEL_WORKSPACES and holds Hold and Trigger', () => {
  assert.deepEqual([...sourceModes()].sort(), [...(shortcuts.SOURCE_PANEL_WORKSPACES || [])]
    .sort(), 'shortcuts.js SOURCE_PANEL_WORKSPACES is the data-osc-modes of Source & Pattern');
  const panel = elementText('id="osc-panel-source"', 'section');
  assert.match(panel, /data-osc="source\.hold"/);
  assert.match(panel, /data-osc="source\.trigger"/);
});

test('every workspace whose Space owner is not null has a Play shown at desktop width', () => {
  assert.equal(typeof shortcuts.playControl, 'function', 'shortcuts.js exports playControl');
  // The base rule hides the status-bar Play; only an !important utility the build compiles
  // shows it above 767 px.
  assert.match(read('src/styles/instrument.css'), /\.osc-sb-play \{\n {2}display: none;/);
  assert.match(DIST, /\.\\!inline-flex\{display:inline-flex!important\}/,
    'dist/index.html defines the utility that shows the status-bar Play');
  const missing = [];
  for (const ws of SOUNDING) {
    const kind = shortcuts.playControl(ws);
    const shown = component(ws).statusPlayShown === true;
    if (kind === 'source') {
      // A desktop focus layout hides only the panels a workspace does not list.
      if (!sourceModes().includes(ws) || shown) missing.push(`${ws}: source panel, one Play`);
    } else if (kind === 'status') {
      if (!shown) missing.push(`${ws}: statusPlayShown is false`);
    } else if (kind === 'studio') {
      if (!/data-osc="studio\.play"/.test(elementText('data-osc-modes="studio"', 'section'))) {
        missing.push(`${ws}: no Studio transport Play`);
      }
    } else {
      missing.push(`${ws}: playControl is ${kind}`);
    }
  }
  assert.deepEqual(missing, [], 'each sounding workspace shows exactly one Play');
  assert.match(PLAY_TAG, /:class="statusPlayShown && '!inline-flex[^']*'"/,
    'the status-bar Play binds the !inline-flex utility to statusPlayShown');
  assert.match(PLAY_TAG, /@click="statusPlay\(\)"/, 'it plays through the existing statusPlay');
  for (const ws of Object.keys(SPACE_OWNER).filter((w) => SPACE_OWNER[w] === null)) {
    assert.equal(component(ws).statusPlayShown, false, `${ws} plays nothing: no Play shown`);
  }
});

test('analyzer, filter, compare and presets show the status-bar Play', () => {
  for (const ws of ['analyzer', 'filter', 'compare', 'presets']) {
    assert.equal(component(ws).statusPlayShown, true, ws);
  }
});

/** The control a prompt names, by the words it uses. */
const named = (text) => (/Play in the status bar/.test(text) ? 'status'
  : /TRIGGER|HOLD TO PLAY/.test(text) ? 'source' : null);

test('the preset notice names the Play control the workspace shows', () => {
  const wrong = [];
  for (const ws of SOUNDING.filter((w) => SPACE_OWNER[w] === 'instrument')) {
    for (const programmed of [false, true]) {
      const app = component(ws);
      const cfg = programmed
        ? { source: 'single', pattern: 'pulse', waveform: 'sine', frequency: 440 }
        : { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440 };
      app.applyPreset({ id: `t-${ws}`, name: 'T', cfg });
      const notice = app.alerts.find((a) => /^Loaded/.test(a.title));
      const says = notice ? named(notice.message) : null;
      if (says !== shortcuts.playControl(ws)) {
        wrong.push(`${ws} ${programmed ? 'programmed' : 'tone'}: ${notice && notice.message}`);
      }
      // Where no Hold to Play is shown, the notice says Space plays it too (Hold to Play).
      if (says === 'status' && !/Space/.test(notice.message)) wrong.push(`${ws}: no Space`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the Learn demo notice names the Play of the workspace it opens', () => {
  // runLearnDemo opens the Playground or Synthesis after the notice: Hold to Play and Trigger.
  for (const ws of ['playground', 'synthesis']) {
    assert.equal(shortcuts.playControl(ws), 'source', ws);
  }
  const app = component('learn');
  app.runDemo({ demo: { label: 'D', cfg: { source: 'single', pattern: 'tone',
    waveform: 'sine', frequency: 440 } } });
  const notice = app.alerts.find((a) => /^Demo ready/.test(a.title));
  assert.ok(notice, 'the demo notice is raised');
  assert.equal(named(notice.message), 'source', notice.message);
  assert.equal(named(app.playPrompt('hear it', 'presets')), 'status');
});
