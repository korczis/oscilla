// C053, the playback bus: one leave-workspace policy and the table's refusal sentences. What
// leaving a workspace does to each owner is one table (core/output-bus.js LEAVE_POLICY, a row
// per owner: keep or stop, with the sentence the status bar says), applied by the bus in the
// same event as the workspace change (main.js's one watcher calls bus.leave); no workspace
// watcher elsewhere stops, releases or disarms. Every refusal sentence of the owners lives in
// the one owner table and is copied nowhere.
// U133 revises the rows under the owner's Q114 of 2026-11-24 (docs/reconstruction/
// 08-owner-decision-q114.md), answer 'Sound survives (Recommended)': "Whatever plays keeps
// playing across places; the strip always shows it and stops it. Measurement still stops when
// leaving Měření, to protect run integrity." Before it, leaving disarmed an armed Synth or
// keys' Studio run and released held notes; the U133 tests below fail on that merge base.
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
    assert.ok(['keep', 'stop'].includes(r.effect), r.owner);
    assert.equal(typeof r.applies, 'function', r.owner);
    assert.equal(typeof r.sounding, 'function', r.owner);
    assert.equal(r.effect === 'keep', r.act === null, `${r.owner}: a keep row does nothing`);
    assert.ok(r.sentence.length > 10, `${r.owner}: its sentence`);
  }
});

test('U133 (Q114): only a measurement stops on a place change; everything else sounds on', () => {
  const effects = Object.fromEntries(bus.LEAVE_POLICY.map((r) => [r.owner, r.effect]));
  assert.deepEqual(effects, { measurement: 'stop', reference: 'stop', instrument: 'keep',
    audition: 'keep', sequencer: 'keep', studio: 'keep', synth: 'keep', notes: 'keep',
    'lab-microphone': 'keep' });
});

test('U133 (Q114): Synth -> Analyzátor keeps an armed Synth run and its held note', () => {
  const s = sounding({ playing: false, micActive: false, measureOwnsOutput: () => false });
  s.cmp.notesSounding = true; // a key held on the armed Synth
  const met = s.b.leave('synth', 'analyzer');
  assert.deepEqual(s.log.filter((l) => !l.startsWith('measure.abort')), [],
    'nothing disarms, releases or stops');
  assert.ok(met.includes('synth') && met.includes('notes'), `met: ${met}`);
  assert.ok(!met.includes('studio'), 'the Synth\'s Arm is named once, by the synth row');
  const said = s.cmp.announceText;
  for (const owner of ['synth', 'notes']) {
    const row = bus.LEAVE_POLICY.find((r) => r.owner === owner);
    assert.ok(said.includes(row.sentence), `${owner}: ${said}`);
  }
});

test('U133 (Q114): Sekvencer -> Studio keeps the sequence playing', () => {
  const s = sounding({ playing: false, notesSounding: false, micActive: false,
    synth: { armed: false }, studioOwnsOutput: () => false, measureOwnsOutput: () => false });
  const met = s.b.leave('sequencer', 'studio');
  assert.ok(met.includes('sequencer'), `met: ${met}`);
  assert.ok(!s.log.includes('sequencer.stop'), s.log.join());
  const row = bus.LEAVE_POLICY.find((r) => r.owner === 'sequencer');
  assert.ok(s.cmp.announceText.includes(row.sentence), s.cmp.announceText);
});

test('U133 (Q114): leaving Měření with a running measurement still stops it', () => {
  const s = sounding({ playing: false, notesSounding: false, micActive: false,
    synth: { armed: false }, studioOwnsOutput: () => false });
  const met = s.b.leave('measure', 'filter');
  assert.deepEqual(s.log, ['measure.abort workspace', 'measure.abort workspace'],
    'the measurement and the reference rows abort it, as before U133; nothing else acts');
  assert.ok(met.includes('measurement'), `met: ${met}`);
  const row = bus.LEAVE_POLICY.find((r) => r.owner === 'measurement');
  assert.ok(s.cmp.announceText.includes(row.sentence), s.cmp.announceText);
  const into = sounding();
  into.b.leave('synth', 'measure');
  assert.deepEqual(into.log, [], 'into Měření: nothing aborts, the Synth and the keys sound on');
});

test('C053: a workspace change applies every row in the same event', () => {
  // Every owner sounds: only the measurement's rows act (U133, Q114), whatever the places.
  for (const [from, to] of [['studio', 'playground'], ['synth', 'filter'],
    ['playground', 'synth'], ['measure', 'filter']]) {
    const s = sounding();
    s.b.leave(from, to);
    assert.deepEqual(s.log, ['measure.abort workspace', 'measure.abort workspace'],
      `${from} -> ${to}: stop the measurement; the instrument, the sequence, the Studio, the `
      + 'Synth and the held keys sound on');
  }
  const same = sounding();
  assert.deepEqual(same.b.leave('studio', 'studio'), [], 'no change, nothing applies');
  assert.deepEqual(same.log, []);
  // the status bar says what each sounding owner's row did
  const s = sounding();
  s.b.leave('playground', 'studio');
  for (const owner of ['measurement', 'instrument', 'sequencer', 'synth', 'notes',
    'lab-microphone']) {
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
