// C037, the playback bus slice 1: every player starts through one claim. Each of the eight
// players is driven through the entry it already has, with a recording claim injected through
// the options that module already takes (no import of src/js/core/output-bus.js in this part),
// and a start makes exactly one claim naming the player. Fails on the merge base by assertion:
// a note on the engine (midi/notes.js) claims nothing, and Listen on a riff makes three
// claim-like calls (its refusal check, its stop of the others, the guarded play); a loop of the
// sequencer claims again on every pass it queues.
// Then the bus itself (one case per player: the measurement refuses it, the newest action wins,
// release gives the output back) and a static scan: no start of sound outside a claim.
//   node --test tests/unit/output-claims.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withLabOptions } from '../../src/js/audio/lab-play-options.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { sequencerEngine } from '../../src/js/labs/sequencer-panel.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createWorkspaceRuntime } from '../../src/js/ui/studio/workspace/runtime.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { AUDITION_OPTIONS, createRiffAudition } from '../../src/js/studio/riffs/audition.js';
import { createOutputOwner } from '../../src/js/ui/output-owner.js';
import { FakeContext, createFakeAudioEnv, fakeTimers } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

/** A recording claim: each call pushes the player's name and grants. */
function recorder() {
  const claims = [];
  return { claims, as: (name, answer = true) => () => { claims.push(name); return answer; } };
}

/** The guard withLabOptions takes (main.js's place for the claim), recording by owner mark. */
const playGuard = (claims) => (plan, o) => {
  claims.push(o && o.owner === AUDITION_OPTIONS.owner ? 'audition' : 'instrument');
  return false; // granted
};

/** A real Studio transport on the fake audio context, its onClaimOutput recorded. */
function studioRig(claims) {
  globalThis.document ??= { querySelector: () => null, getElementById: () => null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame ??= () => 0;
  const store = panelStore();
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store,
    onClaimOutput: (info) => { claims.push(info.owner); return true; } });
  return { store, engine, transport, fx };
}

// ---------------------------------------------------------------- one claim per start

test('C037 instrument: engine.play through withLabOptions claims once, as the instrument', () => {
  const { claims } = recorder();
  const engine = { play: () => ({ id: 1 }) };
  withLabOptions(engine, () => ({}), playGuard(claims));
  assert.ok(engine.play({ type: 'tone', kind: 'continuous' }, { mode: 'hold' }));
  assert.deepEqual(claims, ['instrument']);
});

test('C037 sequencer: editor.play claims once per start, a loop included', () => {
  for (const loop of [false, true]) {
    const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
    const timers = fakeTimers();
    const { claims, as } = recorder();
    const ed = createSequencerEditor({ timers, engine: { getContext: () => ctx,
      getDestination: () => ctx.destination, claimOutput: as('sequencer'),
      holdOutput: () => true } });
    if (loop) ed.setLoop(true);
    assert.equal(ed.play(), true);
    assert.deepEqual(claims, ['sequencer'], `loop ${loop}: one claim for the start`);
    ed.stop();
  }
});

test('C037 sequencer panel: its engine (onStart included) makes one claim per start', () => {
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const { claims, as } = recorder();
  let levels = 0; // onStart's master-level claim (C012): a level, not an output owner
  const engine = sequencerEngine({ getContext: () => ctx, getDestination: () => ctx.destination,
    claimSequencerOutput: as('sequencer'), holdSequencerOutput: () => true,
    claimOutput: () => { levels += 1; } });
  const ed = createSequencerEditor({ timers: fakeTimers(), engine });
  ed.setLoop(true);
  assert.equal(ed.play(), true);
  assert.deepEqual(claims, ['sequencer']);
  assert.equal(levels, 1, 'onStart ran once, after the pass was scheduled');
  ed.stop();
});

test('C037 Studio transport: PLAY claims once through onClaimOutput', () => {
  const { claims } = recorder();
  const { transport } = studioRig(claims);
  assert.equal(transport.start({ position: 0 }).ok, true);
  assert.deepEqual(claims, ['studio']);
  transport.stop({ fast: true });
});

test('C037 studioPlay: the Studio workspace\'s PLAY claims once, through the transport', () => {
  const { claims } = recorder();
  const { transport, engine } = studioRig(claims);
  const said = [];
  const { part } = createWorkspaceRuntime({ transport, cmp: null, measureRun: null },
    { engine }, { setupAudio() {}, announce: (t) => said.push(t) });
  const cmp = { studio: { measureNote: '' }, measureOwnsOutput: () => false };
  assert.equal(part.studioPlay.call(cmp), true, said.join(' | '));
  assert.deepEqual(claims, ['studio']);
  transport.stop({ fast: true });
});

test('C037 Synth arm: Arm claims once, the Studio transport\'s claim', () => {
  const { claims } = recorder();
  const { store, transport } = studioRig(claims);
  const handle = Object.create(store, { subscribe: { value: () => () => {} } });
  const part = createSynthUi({ get: () => ({ handle, transport }) });
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {}, $watch() {} });
  cmp.synthInit();
  assert.equal(cmp.synthArm(), true);
  assert.deepEqual(claims, ['studio']);
  transport.stop({ fast: true });
});

test('C037 notes: a note on the engine claims once, as the notes (none before the bus)', () => {
  const { claims } = recorder();
  const started = [];
  const engine = { noteOn: (key) => { started.push(key); return { ok: true, id: 1 }; },
    noteOff: () => true, notesOff: () => 0, resume() {} };
  const notes = createMidiNotes({ engine, settings: () => ({ a4: 440 }),
    claim: () => { claims.push('notes'); return { ok: true }; } });
  assert.ok(notes.noteOn(60, 100, 'kbd-keys').ok);
  assert.deepEqual(claims, ['notes']);
  assert.equal(started.length, 1);
  // a refused claim starts nothing and says who refused it, once per run
  const refused = [];
  const busy = createMidiNotes({ engine, refused: (by) => refused.push(by),
    claim: () => ({ ok: false, by: 'measurement' }) });
  assert.equal(busy.noteOn(62, 100, 'kbd-keys').ok, false);
  busy.noteOn(64, 100, 'kbd-keys');
  assert.deepEqual(refused, ['measurement']);
  assert.equal(started.length, 1, 'nothing started while refused');
});

test('C037 audition: Listen claims once, the guarded play (three claim-like calls before)', () => {
  const { claims } = recorder();
  const engine = { on: () => () => {}, voice: null, play: () => ({ id: 7 }) };
  withLabOptions(engine, () => ({}), playGuard(claims));
  const audition = createRiffAudition({ engine,
    refused: () => { claims.push('refusal check'); return null; },
    stopOthers: () => { claims.push('stop others'); } });
  assert.deepEqual(audition.start('mirrorball-octaves'), { ok: true });
  assert.deepEqual(claims, ['audition']);
});

// ---------------------------------------------------------------- the bus, one case per player

/** A component with every owner's live state, recording what a claim stops. */
function component(fields = {}) {
  const log = [];
  const editor = { playing: false, stop() { log.push('sequencer.stop'); this.playing = false; } };
  const cmp = {
    playing: false, seqPlaying: false, studioPlaying: false, notesSounding: false, alerts: [],
    measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false,
    notify(kind, title, text) { this.alerts.push(title); },
    stopNow() { log.push('instrument.stop'); this.playing = false; },
    studioOwnsOutput() { return this.studioPlaying; },
    studioStop() { log.push('studio.stop'); this.studioPlaying = false; },
    midiAllOff() { log.push('notes.off'); this.notesSounding = false; },
    ...fields,
  };
  const bus = createOutputOwner({ app: () => cmp, sequencer: () => editor });
  return { bus, cmp, editor, log };
}

const PLAYERS = ['instrument', 'audition', 'sequencer', 'studio', 'notes'];

test('C037 bus: a measurement refuses every player\'s claim and stops nothing', () => {
  for (const p of PLAYERS) {
    const { bus, cmp, log } = component({ measureOwnsOutput: () => true, playing: true });
    const r = bus.claim(p, 'test');
    assert.equal(r.ok, false, p);
    assert.equal(r.by, 'measurement', p);
    assert.deepEqual(log, [], `${p}: nothing stopped`);
    assert.equal(bus.owner(), null, `${p}: nobody took the output`);
    assert.deepEqual(cmp.alerts, p === 'notes' ? [] : ['Measurement in progress'],
      `${p}: said once (the notes say their own sentence)`);
  }
});

test('C037 bus: the newest action wins, one case per player', () => {
  const cases = {
    instrument: [{ seq: true, notesSounding: true }, ['sequencer.stop', 'notes.off']],
    audition: [{ seq: true, playing: true, studioPlaying: true },
      ['sequencer.stop', 'instrument.stop', 'studio.stop', 'notes.off']],
    sequencer: [{ playing: true, studioPlaying: true }, ['instrument.stop', 'studio.stop']],
    studio: [{ seq: true, playing: true }, ['sequencer.stop', 'instrument.stop', 'notes.off']],
    // a note and an instrument voice: the engine fades the older (ADR 0002); the bus stops none
    notes: [{ playing: true }, []],
  };
  for (const [p, [state, stopped]] of Object.entries(cases)) {
    const { seq, ...fields } = state;
    const { bus, editor, log } = component(fields);
    editor.playing = !!seq;
    assert.equal(bus.claim(p, 'test').ok, true, p);
    assert.deepEqual(log, stopped, `${p} stops what it yields`);
  }
  // the notes are refused while the sequencer or the Studio plays (C002), not newest-wins
  const seq = component();
  seq.editor.playing = true;
  assert.equal(seq.bus.claim('notes').by, 'sequencer');
  assert.equal(component({ studioPlaying: true }).bus.claim('notes').by, 'studio');
});

test('C037 bus: the owner is the newest claim while it sounds; release gives it back', () => {
  const { bus, cmp, editor } = component();
  assert.equal(bus.owner(), null);
  bus.claim('sequencer', 'play');
  editor.playing = true;
  assert.equal(bus.owner(), 'sequencer');
  assert.equal(bus.holds('sequencer'), true, 'a loop pass may go on');
  cmp.playing = true;
  bus.claim('instrument', 'play'); // stops the sequence
  assert.equal(editor.playing, false);
  assert.equal(bus.owner(), 'instrument');
  bus.release('sequencer');
  assert.equal(bus.owner(), 'instrument', 'another owner\'s release changes nothing');
  bus.release('instrument');
  assert.equal(bus.owner(), null);
  cmp.measureOwnsOutput = () => true;
  assert.notEqual(bus.holds('sequencer'), true, 'a measurement ends a loop at its next pass');
  assert.throws(() => bus.claim('measurement'), /unknown owner/);
  assert.throws(() => bus.claim('radio'), /unknown owner/);
});

// ---------------------------------------------------------------- no sound outside a claim

const SRC = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

/** The body of the function or method `name` in `src` (balanced braces), with its offset. */
function bodyOf(src, name) {
  const re = new RegExp(`(?:function\\s+${name}|\\b${name})\\s*\\([^)]*\\)\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        return { body: src.slice(m.index, i + 1), at: m.index };
      }
    }
  }
  return null;
}

/** Each start of sound and the claim that must come before it in the same function. */
const STARTS = [
  { file: 'src/js/audio/lab-play-options.js', fn: 'withLabOptions',
    claim: /guard\(plan, o\)/, sound: /return base\(plan/ },
  // main.js hands withLabOptions its guard: the region of that call, to its closing `});`
  { file: 'src/js/main.js', region: /withLabOptions\(engine,[\s\S]*?\n\}\);/,
    fn: 'withLabOptions', claim: /bus\.claim\(playOwnerOf\(o\)/, sound: /\n\}\);/ },
  { file: 'src/js/midi/notes.js', fn: 'noteOn', claim: /refusedBy\(\)/,
    sound: /startOnEngine\(key/ },
  { file: 'src/js/midi/notes.js', fn: 'refusedBy', claim: /claim\('note-on'\)/,
    sound: /return c &&/ },
  { file: 'src/js/sequencer/editor.js', fn: 'play', claim: /this\._claimOutput\(\)/,
    sound: /_schedulePass\(/ },
  { file: 'src/js/studio/transport.js', fn: 'playNow', claim: /onClaimOutput\(\{/,
    sound: /runtime\.apply\(/ },
  { file: 'src/js/studio/transport.js', fn: 'armLive', claim: /start\(\{ position: 0 \}\)/,
    sound: /armedRun = true/ },
  { file: 'src/js/ui/studio/workspace/runtime.js', fn: 'studioPlay',
    claim: /ctx\.transport\.start\(\)/, sound: /onTransport\('state', \{ reason: 'play' \}\)/ },
  { file: 'src/js/synth/ui.js', fn: 'synthArm', claim: /t\.arm\(\)/, sound: /armedText\(\)/ },
  { file: 'src/js/ui/studio/workspace.js', fn: 'claimStudioOutput',
    claim: /svc\.claim\(OWNER\.studio/, sound: /return r\.ok;/ },
];

/** The starts in `read` (file -> source) whose claim is missing or comes after the sound. */
function unclaimed(read = SRC) {
  const out = [];
  for (const s of STARTS) {
    const src = read(s.file);
    const r = s.region ? s.region.exec(src) : null;
    const fn = s.region ? (r && { body: r[0], at: r.index }) : bodyOf(src, s.fn);
    if (!fn) { out.push(`${s.file}: no ${s.fn}`); continue; }
    const c = fn.body.search(s.claim);
    const k = fn.body.search(s.sound);
    if (c < 0 || k < 0 || c > k) {
      const line = src.slice(0, fn.at + Math.max(k, 0)).split('\n').length;
      out.push(`${s.file}:${line}: ${s.fn} starts sound without the claim first`);
    }
  }
  return out;
}

test('C037 scan: every start of sound calls the bus\'s claim first', () => {
  assert.deepEqual(unclaimed(), []);
});

test('C037 scan mutation: a removed claim call is named by file and line', () => {
  for (const s of STARTS) {
    // the claim call removed from the function's own body (a doc comment may quote it)
    const mutate = (src) => {
      const r = s.region ? s.region.exec(src) : null;
      const fn = s.region ? (r && { body: r[0], at: r.index }) : bodyOf(src, s.fn);
      return src.slice(0, fn.at) + fn.body.replace(s.claim, '/* claim removed */')
        + src.slice(fn.at + fn.body.length);
    };
    const read = (f) => (f === s.file ? mutate(SRC(f)) : SRC(f));
    const found = unclaimed(read);
    assert.equal(found.length, 1, `${s.file} ${s.fn}: ${found.join(' | ')}`);
    assert.match(found[0], new RegExp(`^${s.file.replace(/[./]/g, '\\$&')}:\\d+: ${s.fn} `));
  }
});
