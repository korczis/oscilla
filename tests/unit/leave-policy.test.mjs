// C053, the playback bus: one leave-workspace policy and the table's refusal sentences. What
// leaving a workspace does to each owner is one table (core/output-bus.js LEAVE_POLICY, a row
// per owner: keep, stop or disarm, with the sentence the status bar says), applied by the bus in
// the same event as the workspace change (main.js's one watcher calls bus.leave); no workspace
// watcher elsewhere stops, releases or disarms. Every refusal sentence of the owners lives in
// the one owner table and is copied nowhere. Fails on the merge base, where no row exists and
// the leave handlers live in main.js, the keys, the MIDI part and the Synth.
//   node --test tests/unit/leave-policy.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bus from '../../src/js/ui/output-owner.js';

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

/** A component where every owner sounds, recording what the leave policy does to it. */
function sounding(fields = {}) {
  const log = [];
  const cmp = {
    playing: true, notesSounding: true, micActive: true, synth: { armed: true },
    announceText: '', notify() {},
    measureOwnsOutput: () => true, measureReferenceOwnsOutput: () => false,
    studioOwnsOutput: () => true, stopNow() { log.push('instrument.stop'); },
    measureAbort(why) { log.push(`measure.abort ${why}`); return true; },
    kbdReleaseAll() { log.push('keys.release'); },
    synthLeave() { log.push('synth.disarm'); },
    midiRouteLeave(from) { log.push(`route.leave ${from}`); },
    ...fields,
  };
  const editor = { playing: true, stop() { log.push('sequencer.stop'); } };
  const b = bus.createOutputBus({ app: () => cmp, sequencer: () => editor });
  return { b, cmp, log };
}

test('C053: leaving the Playground while the instrument sounds applies its declared row', () => {
  const { b, cmp, log } = sounding({ notesSounding: false, micActive: false,
    synth: { armed: false }, studioOwnsOutput: () => false, measureOwnsOutput: () => false });
  const met = b.leave('playground', 'studio');
  assert.ok(met.includes('instrument'), `met: ${met}`);
  const row = bus.LEAVE_POLICY.find((r) => r.owner === 'instrument');
  assert.equal(row.effect, 'keep');
  assert.ok(!log.includes('instrument.stop'), 'the tone sounds on');
  assert.ok(cmp.announceText.includes(row.sentence), cmp.announceText);
});

test('C053: one table, a row per owner, each with its effect and sentence', () => {
  const t = bus.LEAVE_POLICY;
  assert.ok(Array.isArray(t) && Object.isFrozen(t));
  assert.deepEqual(t.map((r) => r.owner).sort(), ['audition', 'instrument', 'lab-microphone',
    'measurement', 'notes', 'reference', 'sequencer', 'studio', 'synth']);
  for (const r of t) {
    assert.ok(['keep', 'stop', 'disarm'].includes(r.effect), r.owner);
    assert.equal(typeof r.applies, 'function', r.owner);
    assert.equal(typeof r.sounding, 'function', r.owner);
    assert.equal(r.effect === 'keep', r.act === null, `${r.owner}: a keep row does nothing`);
    assert.ok(r.sentence.length > 10, `${r.owner}: its sentence`);
  }
});

test('C053: a workspace change applies every row in the same event', () => {
  const fromStudio = sounding();
  fromStudio.b.leave('studio', 'playground');
  assert.deepEqual(fromStudio.log, ['measure.abort workspace', 'measure.abort workspace',
    'route.leave studio', 'keys.release'], 'stop the measurement, disarm the Studio keys, '
    + 'release held keys; the instrument and the sequence sound on');
  const fromSynth = sounding();
  fromSynth.b.leave('synth', 'measure');
  assert.deepEqual(fromSynth.log, ['synth.disarm', 'keys.release'],
    'into MEASURE: no abort; out of the Synth: Arm off');
  const same = sounding();
  assert.deepEqual(same.b.leave('studio', 'studio'), [], 'no change, nothing applies');
  assert.deepEqual(same.log, []);
  // the status bar says what each sounding owner's row did
  const s = sounding();
  s.b.leave('playground', 'studio');
  for (const owner of ['measurement', 'instrument', 'sequencer', 'notes', 'lab-microphone']) {
    const row = bus.LEAVE_POLICY.find((r) => r.owner === owner);
    assert.ok(s.cmp.announceText.includes(row.sentence), `${owner}: ${s.cmp.announceText}`);
  }
});

// ---------------------------------------------------------------- the scans

const STOPS = new RegExp('kbdRelease|measureAbort|disarm\\(|synthLeave|midiRouteLeave|'
  + '\\.leave\\(\\)|\\[leave\\]\\(|stopNow|studioStop|midiAllOff|\\.stop\\(');
const WATCH = /\$watch\('workspace',\s*\(([^)]*)\)\s*=>\s*(\{[\s\S]*?\n\s*\}|[^\n]*)\)/g;

/** Workspace watchers that stop, release or disarm outside the bus's one leave call. */
function strayLeaves(files, src = read) {
  const out = [];
  for (const f of files) {
    const text = src(f);
    for (const m of text.matchAll(WATCH)) {
      const body = m[2].replace(/\/\/[^\n]*/g, ''); // its code, not its comments
      if (/\bbus\.leave\(/.test(body)) continue; // main.js: the bus's one leave call
      if (STOPS.test(body)) {
        out.push(`${f.split(path.sep).join('/')}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  return out;
}

test('C053 scan: no workspace watcher stops, releases or disarms outside the bus', () => {
  assert.deepEqual(strayLeaves(jsFiles()), []);
});

test('C053 scan mutation: a leave handler re-added outside the bus is named', () => {
  const f = path.join('src', 'js', 'midi', 'keyboard-ui.js');
  const src = () => "cmp.$watch('workspace', () => { kbdRelease(); if (view) view.resize(); });";
  assert.deepEqual(strayLeaves([f], src), ['src/js/midi/keyboard-ui.js:1']);
  assert.deepEqual(strayLeaves([f], () => "cmp.$watch('workspace', (ws) => resize(ws));"), []);
});

/** Every refusal sentence of the owners, from the one table. */
const SENTENCES = bus.OUTPUT_OWNER_TABLE.flatMap((r) => [r.text, r.notes && r.notes.midi,
  r.notes && r.notes.keyboard]).filter(Boolean);

test('C053: the owners\' refusal sentences are written once, in the owner table', () => {
  const joined = (s) => s.replace(/'\s*\+\s*'/g, '');
  const copies = jsFiles().filter((f) => f !== path.join('src', 'js', 'core', 'output-bus.js'))
    .filter((f) => SENTENCES.some((t) => joined(read(f)).includes(t.slice(0, 40))));
  assert.deepEqual(copies, []);
  // the riff audition and the MIDI part say the table's sentence, not one of their own
  assert.doesNotMatch(read('src/js/studio/riffs/audition.js'), /measurement is running/);
  assert.match(read('src/js/midi/ui.js'), /notesRefusedSentences\('midi'\)/);
});
