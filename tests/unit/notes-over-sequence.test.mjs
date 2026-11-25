// U139 (journey J8, docs/reconstruction/03b-journeys.md; owner decision Q114): the keys play
// over a running sequence. The sequencer row of the one output table (src/js/core/output-bus.js)
// admits the notes: a note's claim, and the instrument's claim a key makes while it arms it (the
// notes row's `arming` probe, midi/ui.js midiArming), are granted without stopping the sequence,
// which keeps the output and its name; a note's release leaves the sequence untouched; the host
// hands the output to a guest that still sounds when it releases; Escape (stopAll) stops both.
// The refusal sentence "... dokud hraje sekvencer" is gone from the table and from src/js.
// Fails on the merge base, where every note is refused while the sequencer plays and the keys'
// arm of the Studio stops the sequence. Mutation cases: the table without `admits`, and the notes
// row without `arming`, each fail the scenario.
//   node --test tests/unit/notes-over-sequence.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as bus from '../../src/js/core/output-bus.js';
import { MIDI_REFUSED } from '../../src/js/midi/ui.js';
import { KEYBOARD_REFUSED } from '../../src/js/midi/keyboard-ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUS_FILE = path.join(ROOT, 'src', 'js', 'core', 'output-bus.js');

/** A page of one running sequence and the one instrument (the Studio transport), with probes. */
function page(mod) {
  const calls = [];
  const editor = { playing: false, play() { this.playing = true; },
    stop() { this.playing = false; calls.push('sequence-stop'); } };
  let studio = false;
  let arming = false;
  const cmp = {
    playback: null, playing: false, notesSounding: false, notify: () => calls.push('notify'),
    stopNow: () => calls.push('instrument-stop'),
    midiAllOff: () => { calls.push('notes-off'); cmp.notesSounding = false; return 0; },
    studioOwnsOutput: () => studio,
    studioStop: () => { studio = false; calls.push('studio-stop'); },
    midiArming: () => arming,
    measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false,
    measureAbort: () => {},
  };
  const steps = [];
  const trace = { record: (owner, kind, f) => steps.push({ kind, ...f }) };
  const b = mod.createOutputBus({ app: () => cmp, sequencer: () => editor, trace });
  /** The keys' first note arms the instrument: its claim runs while a key is arming it. */
  const arm = () => {
    arming = true;
    try {
      const r = b.claim(mod.OWNER.studio, 'play', { notify: false });
      if (r.ok) studio = true;
      return r;
    } finally { arming = false; }
  };
  /** The sequencer starts: the editor plays and claims the output (claimSequencerOutput). */
  const startSequence = () => {
    editor.play();
    return b.claim(mod.OWNER.sequencer, 'claimOutput');
  };
  return { b, cmp, editor, calls, steps, arm, startSequence,
    studioOn: () => studio, owner: () => cmp.playback && cmp.playback.owner };
}

/** The U139 scenario on bus module `mod`: what a note and an arm do over a running sequence. */
function scenario(mod) {
  const p = page(mod);
  p.startSequence();
  const note = p.b.claim(mod.OWNER.notes, 'note-on');
  p.cmp.notesSounding = note.ok;
  const afterNote = { ok: note.ok, owner: p.owner(), playing: p.editor.playing,
    calls: [...p.calls] };
  p.cmp.notesSounding = false;
  p.b.release(mod.OWNER.notes);
  const afterRelease = { owner: p.owner(), playing: p.editor.playing, calls: [...p.calls] };
  const arm = p.arm();
  const afterArm = { ok: arm.ok, owner: p.owner(), playing: p.editor.playing,
    studio: p.studioOn(), calls: [...p.calls] };
  return { afterNote, afterRelease, afterArm, steps: p.steps };
}

const EXPECTED = Object.freeze({
  afterNote: { ok: true, owner: 'sequencer', playing: true, calls: [] },
  afterRelease: { owner: 'sequencer', playing: true, calls: [] },
});

/** The verdicts of a scenario, each true where U139 holds. */
function verdicts(s) {
  return {
    'a note sounds over the sequence': s.afterNote.ok === true,
    'the note stops nothing': s.afterNote.calls.length === 0 && s.afterNote.playing === true,
    'the sequence keeps the output': s.afterNote.owner === 'sequencer',
    'the release leaves the sequence': s.afterRelease.playing === true
      && s.afterRelease.owner === 'sequencer' && s.afterRelease.calls.length === 0,
    'the keys arm the instrument over it': s.afterArm.ok === true && s.afterArm.studio === true
      && s.afterArm.playing === true && !s.afterArm.calls.includes('sequence-stop')
      && s.afterArm.owner === 'sequencer',
  };
}

test('U139: the sequencer row admits the notes and refuses none; its sentence is gone', () => {
  const row = bus.ownerRow(bus.OWNER.sequencer);
  assert.deepEqual(row.admits, ['notes']);
  assert.ok(Object.isFrozen(row.admits));
  assert.equal(row.refuses, undefined, 'the sequencer refuses no note');
  assert.equal(row.notes, undefined, 'and has no refusal sentence');
  assert.equal(bus.ownerRow(bus.OWNER.notes).arming, 'midiArming');
  // the table's other rows still refuse the notes: a measurement, a reference, the Studio
  assert.deepEqual(Object.keys(MIDI_REFUSED), ['measurement', 'reference', 'studio']);
  assert.deepEqual(Object.keys(KEYBOARD_REFUSED), ['measurement', 'reference', 'studio']);
  const probes = { measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false,
    studioOwnsOutput: () => false };
  assert.equal(bus.notesRefusalOf(probes, { sequencerPlaying: () => true }), null);
  assert.equal(bus.notesRefusalOf({ ...probes, studioOwnsOutput: () => true },
    { sequencerPlaying: () => true }), 'studio');
});

test('U139: no source in src/js says the keys are muted while the sequencer plays', () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (f.endsWith('.js')) files.push(f);
    }
  };
  walk(path.join(ROOT, 'src', 'js'));
  const hits = files.filter((f) => /dokud hraje sekvencer/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
});

test('U139: a note over a running sequence sounds, stops nothing, and its release leaves it',
  () => {
    const s = scenario(bus);
    assert.deepEqual(s.afterNote, EXPECTED.afterNote);
    assert.deepEqual(s.afterRelease, EXPECTED.afterRelease);
    const admitted = s.steps.filter((x) => x.outcome === 'admitted');
    assert.deepEqual(admitted.map((x) => [x.entity.id, x.detail.over]),
      [['notes', 'sequencer'], ['studio', 'sequencer']], 'the trace names each admission');
    for (const [what, ok] of Object.entries(verdicts(s))) assert.ok(ok, what);
  });

test('U139: the keys arm the instrument over the sequence; PLAY still takes the output', () => {
  const p = page(bus);
  p.startSequence();
  assert.equal(p.arm().ok, true);
  assert.equal(p.editor.playing, true, 'the sequence plays on');
  assert.equal(p.owner(), 'sequencer', 'and is what the views name');
  // the sequencer's own claim again (a restart while it plays) stops nothing of its guest
  assert.equal(p.b.claim(bus.OWNER.sequencer, 'claimOutput').ok, true);
  assert.equal(p.studioOn(), true, 'the keys\' armed run is not stopped by its host');
  // the sequence ends while the keys' run still sounds: the run takes the output
  p.editor.stop();
  p.b.release(bus.OWNER.sequencer);
  assert.equal(p.owner(), 'studio');
  // Studio PLAY (no key arming) is no guest: it stops a running sequence as before
  const q = page(bus);
  q.startSequence();
  assert.equal(q.b.claim(bus.OWNER.studio, 'play', { notify: false }).ok, true);
  assert.equal(q.editor.playing, false, 'PLAY stops the sequence');
  assert.equal(q.owner(), 'studio');
  // a note with nothing playing takes the output under its own name, as before
  const r = page(bus);
  assert.equal(r.b.claim(bus.OWNER.notes, 'note-on').ok, true);
  assert.equal(r.owner(), 'notes');
});

test('U139: the host releases to a guest only while it still sounds', () => {
  const p = page(bus);
  p.startSequence();
  p.b.claim(bus.OWNER.notes, 'note-on');
  p.cmp.notesSounding = true;
  p.editor.stop();
  p.b.release(bus.OWNER.sequencer);
  assert.equal(p.owner(), 'notes', 'a key held past the sequence names the notes');
  const q = page(bus);
  q.startSequence();
  q.b.claim(bus.OWNER.notes, 'note-on'); // its key already up: nothing sounds any more
  q.editor.stop();
  q.b.release(bus.OWNER.sequencer);
  assert.equal(q.owner(), null);
});

test('U139: Escape (stopAll) stops the sequence and the notes over it', () => {
  const p = page(bus);
  p.startSequence();
  p.b.claim(bus.OWNER.notes, 'note-on');
  p.cmp.notesSounding = true;
  p.arm();
  p.calls.length = 0;
  p.b.stopAll('escape');
  assert.equal(p.editor.playing, false);
  assert.equal(p.studioOn(), false);
  assert.ok(p.calls.includes('sequence-stop') && p.calls.includes('studio-stop')
    && p.calls.includes('notes-off'), JSON.stringify(p.calls));
  assert.equal(p.owner(), null);
  // nothing is left admitted: a later note takes the output under its own name
  p.cmp.notesSounding = false;
  p.b.claim(bus.OWNER.notes, 'note-on');
  assert.equal(p.owner(), 'notes');
});

/** The bus module with its source rewritten by `edit`, imported from a scratch file. */
async function mutated(edit) {
  const src = readFileSync(BUS_FILE, 'utf8');
  const out = edit(src);
  assert.notEqual(out, src, 'the mutation applies');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'u139-bus-'));
  try {
    const f = path.join(dir, 'output-bus.mjs');
    writeFileSync(f, out);
    return await import(pathToFileURL(f).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ADMITS = /admits: Object\.freeze\(\['notes'\]\),\s*/;

test('U139 mutation: the table without `admits`, or without the notes\' `arming`, fails',
  async () => {
    const noAdmits = await mutated((s) => s.replace(ADMITS, ''));
    const a = verdicts(scenario(noAdmits));
    assert.equal(a['the sequence keeps the output'], false, 'a note takes the name from it');
    assert.equal(a['the keys arm the instrument over it'], false, 'the arm stops the sequence');
    const noArming = await mutated((s) => s.replace("arming: 'midiArming',", ''));
    const b = verdicts(scenario(noArming));
    assert.equal(b['a note sounds over the sequence'], true);
    assert.equal(b['the keys arm the instrument over it'], false, 'the arm stops the sequence');
    // the base's refusal row: every note is refused while the sequencer plays
    const refusing = await mutated((s) => s.replace(ADMITS,
      "refuses: 'notes', notes: Object.freeze({ midi: 'x', keyboard: 'x' }), "));
    assert.equal(verdicts(scenario(refusing))['a note sounds over the sequence'], false);
  });
