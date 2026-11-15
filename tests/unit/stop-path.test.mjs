// C050, the playback bus slice 2: one stop path. Escape is one key-registry binding, a page hide
// one listener pair and the status-bar stop one action, and each calls the bus's stopAll, which
// stops every owner from its live state in the same event. A scan of src/js refuses a page-level
// Escape, pagehide or visibilitychange listener that stops sound anywhere else; the listeners
// that stop nothing are allow-listed here, each with its reason. The capture still aborts on
// pagehide by itself (spec §169), also when the bus is bypassed. Fails on the merge base, where
// main.js, the Studio, the MIDI part, the on-screen keys and the Synth each stop on their own.
//   node --test tests/unit/stop-path.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputOwner } from '../../src/js/ui/output-owner.js';
import { createKeyRegistry } from '../../src/js/ui/keys/registry.js';
import { bindPageKeys } from '../../src/js/ui/keys/clients.js';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { createMeasurementEngine } from '../../src/js/measurement/engine.js';
import { rig, settle, RECIPE } from './fixtures/capture-rig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

/** Every .js file under src/js, relative to ROOT. */
function jsFiles(dir = path.join(ROOT, 'src', 'js')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(path.relative(ROOT, p));
  }
  return out;
}

/** The page-level listeners that stop nothing, or stop what the bus cannot, with the reason. */
const ALLOW = [
  { file: 'src/js/ui/experiments.js', event: 'visibilitychange',
    reason: 'refreshes the saved-experiments list when the page shows again; stops nothing' },
  { file: 'src/js/ui/app.js', event: 'keydown',
    reason: 'Escape closes the navigation drawer and its menus; the sound stops in page.escape' },
  { file: 'src/js/charts/frame-loop.js', event: 'visibilitychange',
    reason: 'skips the frame after a hidden page: rendering only' },
  { file: 'src/js/visualization/p5-host.js', event: 'visibilitychange',
    reason: 'pauses the p5 draw loop while the page is hidden: rendering only' },
  { file: 'src/js/measurement/capture.js', event: 'pagehide',
    reason: 'the capture aborts on pagehide by itself (spec §169), also when the bus is bypassed' },
  { file: 'src/js/measurement/capture.js', event: 'visibilitychange',
    reason: 'the capture aborts on a hidden document by itself (spec §169, abortOnHidden)' },
  { file: 'src/js/midi/keyboard-ui.js', event: 'keydown',
    reason: 'the armed computer keys play notes; Escape is not theirs (page.escape releases '
      + 'every key through the bus)',
    holds: () => !/e\.key === 'Escape'/.test(read('src/js/midi/keyboard-ui.js')) },
  { file: 'src/js/ui/studio/workspace.js', event: 'keydown',
    reason: 'the Studio editor\'s keys: Escape closes its popup or cancels a gesture first; its '
      + 'stop is page.escape, so the handler stops no sound',
    holds: () => !/ops\.stopStudio\(/.test(read('src/js/ui/studio/workspace/graph.js')) },
];

const PAGE_LISTENER = new RegExp('\\b(?:window|document|win|doc|d|env(?:\\.document)?)'
  + '\\.addEventListener\\(\\s*\'(keydown|pagehide|visibilitychange)\'', 'g');

/** The page-level stop listeners of `files` outside the key registry and the bus. */
function strayStops(files, src = read) {
  const out = [];
  for (const f of files) {
    if (f.startsWith(path.join('src', 'js', 'ui', 'keys') + path.sep)) continue; // the registry
    if (f === path.join('src', 'js', 'core', 'output-bus.js')) continue; // the bus
    const text = src(f);
    for (const m of text.matchAll(PAGE_LISTENER)) {
      const line = text.slice(0, m.index).split('\n').length;
      const around = text.slice(m.index, m.index + 400).split('\n').slice(0, 6).join('\n');
      if (/\bstopAll\(/.test(around)) continue; // the bus's one path
      const ok = ALLOW.find((a) => path.join(...a.file.split('/')) === f && a.event === m[1]
        && (!a.holds || a.holds()));
      if (!ok) out.push(`${f.split(path.sep).join('/')}:${line} ${m[1]}`);
    }
  }
  return out;
}

test('C050: no page-level Escape, pagehide or visibilitychange listener stops sound off the bus',
  () => {
    assert.deepEqual(strayStops(jsFiles()), []);
    for (const a of ALLOW) assert.ok(a.reason.length > 30, `${a.file}: a reason`);
  });

test('C050 mutation: a stop listener re-added outside the bus is named by file and line', () => {
  const f = path.join('src', 'js', 'midi', 'ui.js');
  const src = (x) => (x === f ? `${read(x)}\nwin.addEventListener('pagehide', silence);\n`
    : read(x));
  const found = strayStops([f], src);
  assert.equal(found.length, 1, found.join(' | '));
  assert.match(found[0], /^src\/js\/midi\/ui\.js:\d+ pagehide$/);
  // one that calls the bus passes
  const ok = (x) => `${read(x)}\nwin.addEventListener('pagehide', () => bus.stopAll('x'));\n`;
  assert.deepEqual(strayStops([f], ok), []);
});

test('C050: page.escape, the page hide pair and the status-bar stop each call stopAll', () => {
  const calls = [];
  const keys = createKeyRegistry();
  bindPageKeys({ keys, cmp: { workspace: 'playground', measureAbort() {}, onKeyDown() {} },
    stopSequencer() {}, stopAll: (why) => calls.push(why) });
  const esc = keys.resolve('Escape', { workspace: 'studio', focus: 'text' });
  assert.ok(esc, 'Escape is bound everywhere, in a text field too');
  esc.run({ key: 'Escape', code: 'Escape' });
  assert.deepEqual(calls.splice(0), ['escape'], 'Escape is one stopAll');
  const main = read('src/js/main.js');
  assert.match(main, new RegExp("document\\.addEventListener\\('visibilitychange', \\(\\) => \\{"
    + "\\s*if \\(document\\.hidden\\) bus\\.stopAll\\('hidden'\\);"));
  assert.match(main, /window\.addEventListener\('pagehide', \(\) => bus\.stopAll\('pagehide'\)\);/);
  const wb = createWorkbench({ stopAll: (why) => calls.push(why),
    stopPlayback: () => calls.push('stopPlayback'), sequencerPlaying: () => false });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, { playing: true, playback: { owner: null, since: 0 } });
  cmp.statusPlay();
  assert.deepEqual(calls, ['status-stop'], 'the status-bar stop is one stopAll');
});

/** Every owner sounding, with the engine's census of what sounds. */
function everythingSounding() {
  const log = [];
  const census = { instrument: 3, sequencer: 4, studio: 6, notes: 2 };
  const editor = { playing: true,
    stop() { log.push('sequencer'); this.playing = false; census.sequencer = 0; } };
  const cmp = {
    playing: true, seqPlaying: true, studioPlaying: true, notesSounding: true, alerts: [],
    measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false,
    notify() {},
    stopNow() { log.push('instrument'); this.playing = false; census.instrument = 0; },
    studioOwnsOutput() { return this.studioPlaying; },
    studioStop(o = {}) {
      log.push(`studio${o.fast ? ' fast' : ''}`);
      this.studioPlaying = false;
      census.studio = 0;
    },
    midiAllOff() { log.push('notes'); this.notesSounding = false; census.notes = 0; },
    measureAbort(why) { log.push(`measure ${why}`); return false; },
  };
  const bus = createOutputOwner({ app: () => cmp, sequencer: () => editor });
  bus.claim('instrument', 'play'); // the instrument holds the output...
  // ...while the others sound too (as the arms and a layered start leave them)
  editor.playing = true;
  Object.assign(cmp, { seqPlaying: true, notesSounding: true });
  Object.assign(census, { sequencer: 4, notes: 2 });
  log.length = 0;
  // the Synth's own reaction to a stop (its pending arm), a callback the bus calls
  bus.onStop((why) => log.push(`synth ${why}`));
  return { bus, cmp, log, census, total: () => Object.values(census).reduce((a, b) => a + b, 0) };
}

test('C050: Escape, the status-bar stop and a page hide each stop every owner in one event', () => {
  for (const [why, fast] of [['escape', true], ['status-stop', false], ['pagehide', true],
    ['hidden', true]]) {
    const s = everythingSounding();
    assert.ok(s.total() > 0);
    s.bus.stopAll(why);
    assert.equal(s.total(), 0, `${why}: the census is 0 in the same event (no 150 ms window)`);
    assert.equal(s.bus.owner(), null, `${why}: no owner`);
    assert.deepEqual(s.log, [`synth ${why}`, 'sequencer', 'instrument',
      `studio${fast ? ' fast' : ''}`, 'notes', `measure ${why}`], why);
  }
});

test('C050: the capture still aborts on pagehide by itself, with the bus bypassed', async () => {
  const r = rig({});
  const me = createMeasurementEngine({ io: r.io });
  const res = await settle(r.drive(me.measure(RECIPE),
    { at: () => r.started.length > 0, poke: () => r.listeners.win.pagehide() }));
  assert.equal(res.ok, false);
  assert.equal(me.state, 'ABORTED', 'capture.js aborted the run on its own pagehide listener');
  me.dispose();
});
