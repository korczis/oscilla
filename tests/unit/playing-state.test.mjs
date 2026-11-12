// C051, the playback bus slice 3: one observable playing state. The bus publishes
// { owner, since } on the component (`playback`) in the same event as the claim, release or stop
// that changed it, and the playing mirrors are reads of it: cmp.seqPlaying is a getter (never
// assigned), the 150 ms poll that copied editor.playing is gone, and the sequencer editor
// releases the output in its own stop. Built on seams of the merge base (the workbench, the
// output owner and the sequencer panel's engine adapter wired as main.js wires them), the
// first case fails there: after editor.stop() cmp.seqPlaying stays true until the poll runs.
//   node --test tests/unit/playing-state.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbench } from '../../src/js/ui/workbench.js';
import { createOutputOwner } from '../../src/js/ui/output-owner.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { sequencerEngine } from '../../src/js/labs/sequencer-panel.js';
import { FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The workbench state, the bus and the sequencer editor, wired as main.js wires them. */
function app() {
  const wb = createWorkbench({ engine: { analyser: { fftSize: 8192 } },
    sequencerPlaying: () => !!(editor && editor.playing), stopPlayback() {} });
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(wb));
  Object.assign(cmp, { status: 'READY', playing: false, studio: { playing: false },
    studioOwnsOutput() { return false; }, notify() {}, stopNow() { this.playing = false; },
    measureOwnsOutput: () => false, source: 'single', tabs: { analysis: 'waveform' } });
  let editor = null;
  const bus = createOutputOwner({ app: () => cmp, sequencer: () => editor });
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const adapter = { getContext: () => ctx, getDestination: () => ctx.destination,
    claimSequencerOutput: () => bus.claimOutput('sequencer'),
    releaseSequencerOutput: () => bus.release('sequencer') };
  editor = createSequencerEditor({ timers: fakeTimers(), engine: sequencerEngine(adapter) });
  return { cmp, bus, editor, ctx };
}

test('C051: editor.stop() clears seqPlaying in the same event (no poll tick)', () => {
  const { cmp, editor } = app();
  assert.equal(editor.play(), true);
  assert.equal(cmp.seqPlaying, true, 'the claim published it');
  editor.stop();
  assert.equal(editor.playing, false);
  assert.equal(cmp.seqPlaying, false, 'the stop released it at once, not at the next poll');
});

test('C051: a claim and a release change every mirror in the same event', () => {
  const { cmp, bus } = app();
  const mirrors = () => ({ seqPlaying: cmp.seqPlaying, isSounding: cmp.isSounding,
    anySounding: cmp.anySounding, outputOwner: cmp.outputOwner, label: cmp.statusLabel,
    playback: cmp.playback.owner });
  assert.deepEqual(mirrors(), { seqPlaying: false, isSounding: false, anySounding: false,
    outputOwner: null, label: 'PŘIPRAVENO', playback: null });
  bus.claim('sequencer', 'play');
  assert.deepEqual(mirrors(), { seqPlaying: true, isSounding: true, anySounding: true,
    outputOwner: 'sequencer', label: 'HRAJE', playback: 'sequencer' });
  const before = cmp.playback.since;
  bus.release('sequencer');
  assert.deepEqual(mirrors(), { seqPlaying: false, isSounding: false, anySounding: false,
    outputOwner: null, label: 'PŘIPRAVENO', playback: null });
  assert.ok(cmp.playback.since > before, 'since counts the changes');
  // and the bus's subscribers hear the same state in the same event
  const heard = [];
  bus.subscribe((st) => heard.push(st.owner));
  bus.claim('instrument', 'play');
  bus.stopAll('escape');
  assert.deepEqual(heard, ['instrument', null]);
});

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

const MIRROR = new RegExp('\\b(?:app|cmp|this|wb)\\.(seqPlaying|studioPlaying|isSounding|'
  + 'anySounding|outputOwner)\\s*=(?!=)', 'g');
// An interval's callback (one line or a block up to its `}, ms)`) that reads a playing state.
const INTERVAL = /setInterval\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\d+\s*\)/g;
const COPIES = /\.playing\b|seqPlaying/;

/** Assignments to a playing mirror and polls that copy a playing state, outside the bus. */
function mirrorWrites(files, read = (f) => readFileSync(path.join(ROOT, f), 'utf8')) {
  const out = [];
  for (const f of files) {
    if (f === path.join('src', 'js', 'core', 'output-bus.js')) continue; // the one writer
    const text = read(f);
    for (const m of text.matchAll(MIRROR)) {
      out.push(`${f.split(path.sep).join('/')}:${text.slice(0, m.index).split('\n').length} `
        + `assigns ${m[1]}`);
    }
    for (const m of text.matchAll(INTERVAL)) {
      if (!COPIES.test(m[1])) continue;
      out.push(`${f.split(path.sep).join('/')}:${text.slice(0, m.index).split('\n').length} `
        + 'polls a playing state');
    }
  }
  return out;
}

test('C051 scan: no playing mirror is assigned and no poll copies a playing state', () => {
  assert.deepEqual(mirrorWrites(jsFiles()), []);
});

test('C051 scan mutation: a re-added poll or assignment is named', () => {
  const main = path.join('src', 'js', 'main.js');
  const poll = `${readFileSync(path.join(ROOT, main), 'utf8')}\nsetInterval(() => {\n`
    + '  const on = !!labs.sequencer.editor.playing;\n  if (app) app.seqPlaying = on;\n}, 150);\n';
  const found = mirrorWrites([main], () => poll);
  const named = (re) => assert.ok(found.some((x) => re.test(x)), found.join(' | '));
  named(/^src\/js\/main\.js:\d+ assigns seqPlaying$/);
  named(/^src\/js\/main\.js:\d+ polls a playing state$/);
  assert.deepEqual(mirrorWrites([main], () => 'const x = cmp.seqPlaying === true;'), []);
});
