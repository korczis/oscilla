// C050: the playback bus records every event it handles as a step of the one operation trace
// (core/trace.js, ADR 0042): a claim (granted or refused), a release, stopAll with its cause, an
// owner change, a note on and a note off, an arm; the bus records them, never a player. Each
// owner is played through its own entry and stopped, and the cycle leaves the matching steps
// in order. Fails on the merge base, where the bus takes no trace and records nothing.
//   node --test tests/unit/bus-trace.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTrace } from '../../src/js/core/trace.js';
import { createOutputOwner, playOwnerOf } from '../../src/js/ui/output-owner.js';
import { withLabOptions } from '../../src/js/audio/lab-play-options.js';
import { createRiffAudition } from '../../src/js/studio/riffs/audition.js';
import { createMidiNotes } from '../../src/js/midi/notes.js';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { claimStudioOutput } from '../../src/js/ui/studio/workspace.js';
import { createSynthUi } from '../../src/js/synth/ui.js';
import { FakeContext, createFakeAudioEnv, fakeTimers } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

/** A page: the one trace, the bus over a component whose owners keep their live state. */
function page() {
  const trace = createTrace({ now: () => 0 });
  const cmp = {
    playing: false, seqPlaying: false, studioPlaying: false, notesSounding: false,
    measureOwnsOutput: () => false, measureReferenceOwnsOutput: () => false, notify() {},
    stopNow() { this.playing = false; }, studioOwnsOutput() { return this.studioPlaying; },
    studioStop() { this.studioPlaying = false; }, midiAllOff() { this.notesSounding = false; },
    measureAbort: () => false,
  };
  let editor = null;
  const bus = createOutputOwner({ app: () => cmp, sequencer: () => editor, trace });
  let mark = 0;
  /** The bus's steps since the last read: kind, owner entity, outcome and stop cause. */
  const steps = () => {
    const all = trace.steps().filter((s) => s.owner === 'bus');
    const out = all.slice(mark).map((s) => [s.kind, s.entity ? s.entity.id : '-',
      s.outcome || '-', (s.detail && s.detail.cause) || '-'].join(' '));
    mark = all.length;
    return out;
  };
  return { trace, cmp, bus, steps, setEditor: (e) => { editor = e; } };
}

const PLAY = (owner) => [`claim ${owner} granted -`, `owner ${owner} - -`];
const STOPPED = (cause) => [`stopAll - stopped ${cause}`];
const RELEASED = (owner) => [`release ${owner} released -`, 'owner none - -'];

test('C050 trace: the instrument plays (the guarded play) and Escape stops it', () => {
  const p = page();
  const engine = { play: () => ({ id: 1 }) };
  withLabOptions(engine, () => ({}), (plan, o) => !p.bus.claim(playOwnerOf(o), 'play').ok);
  engine.play({ type: 'tone' }, { mode: 'hold' });
  p.cmp.playing = true;
  assert.deepEqual(p.steps(), PLAY('instrument'));
  p.bus.stopAll('escape');
  assert.deepEqual(p.steps(), [...STOPPED('escape'), 'owner none - -']);
});

test('C050 trace: the riff audition plays and its voice ends (released)', () => {
  const p = page();
  const engine = { on: () => () => {}, voice: null, play: () => ({ id: 2 }) };
  withLabOptions(engine, () => ({}), (plan, o) => !p.bus.claim(playOwnerOf(o), 'play').ok);
  assert.equal(createRiffAudition({ engine }).start('mirrorball-octaves').ok, true);
  assert.deepEqual(p.steps(), PLAY('audition'));
  p.bus.release('audition'); // the engine's ended event (main.js)
  assert.deepEqual(p.steps(), RELEASED('audition'));
});

test('C050 trace: the sequencer plays, a status-bar stop ends it', () => {
  const p = page();
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const ed = createSequencerEditor({ timers: fakeTimers(), engine: { getContext: () => ctx,
    getDestination: () => ctx.destination, claimOutput: () => p.bus.claimOutput('sequencer') } });
  p.setEditor(ed);
  assert.equal(ed.play(), true);
  assert.deepEqual(p.steps(), PLAY('sequencer'));
  p.bus.stopAll('status-stop');
  assert.equal(ed.playing, false);
  assert.deepEqual(p.steps(), [...STOPPED('status-stop'), 'owner none - -']);
});

test('C050 trace: the MIDI and on-screen keys: claim, note on, note off, release', () => {
  const p = page();
  const engine = { noteOn: () => ({ ok: true, id: 3 }), noteOff: () => true, notesOff: () => 0,
    resume() {} };
  const notes = createMidiNotes({ engine, settings: () => ({ a4: 440 }),
    claim: (why) => p.bus.claim('notes', why), release: () => p.bus.release('notes'),
    noted: (on, note, source) => p.bus.note(on, { note, input: String(source) }) });
  notes.noteOn(60, 100, 'kbd-keys');
  notes.noteOff(60, 'kbd-keys');
  assert.deepEqual(p.steps(), [...PLAY('notes'), 'note-on notes - -', 'note-off notes - -',
    ...RELEASED('notes')]);
});

/** A real Studio transport whose claim is the workspace's, through the bus. */
function studio(p) {
  globalThis.document ??= { querySelector: () => null, getElementById: () => null };
  globalThis.window ??= { addEventListener() {}, location: { href: 'http://x/' } };
  globalThis.requestAnimationFrame ??= () => 0;
  const store = panelStore();
  const engine = new AudioEngine({ env: createFakeAudioEnv({ sampleRate: 48000 }).env });
  assert.ok(engine.init());
  const transport = createStudioTransport({ runtime: createStudioRuntime({ engine }), engine,
    store, onClaimOutput: () => claimStudioOutput(p.cmp, { claim: p.bus.claim }, () => {}) });
  return { store, transport };
}

test('C050 trace: Studio PLAY claims through the bus; a page hide stops it', () => {
  const p = page();
  const { transport } = studio(p);
  assert.equal(transport.start({ position: 0 }).ok, true);
  p.cmp.studioPlaying = true;
  assert.deepEqual(p.steps(), PLAY('studio'));
  p.bus.stopAll('pagehide');
  assert.deepEqual(p.steps(), [...STOPPED('pagehide'), 'owner none - -']);
  transport.stop({ fast: true });
});

test('C050 trace: the Synth\'s Arm is a step, its claim the Studio transport\'s', () => {
  const p = page();
  const { store, transport } = studio(p);
  const handle = Object.create(store, { subscribe: { value: () => () => {} } });
  const part = createSynthUi({ get: () => ({ handle, transport }) });
  const cmp = Object.assign(part, { workspace: 'synth', ensureAudio() {}, $watch() {},
    busArmed: (owner, on) => p.bus.armed(owner, on) });
  cmp.synthInit();
  assert.equal(cmp.synthArm(), true);
  assert.deepEqual(p.steps(), ['arm studio - -', ...PLAY('studio')]);
  transport.stop({ fast: true });
});

test('C050 trace: MEASURE takes the output (stopPlayback) and Escape aborts it', () => {
  const p = page();
  p.cmp.playing = true;
  p.bus.claim('instrument', 'play');
  p.steps();
  const aborted = [];
  p.cmp.measureAbort = (why) => { aborted.push(why); return true; };
  p.bus.stopPlayback(p.cmp); // MEASURE's Measure (C016)
  assert.deepEqual(p.steps(), [...STOPPED('measure'), 'owner none - -']);
  p.bus.stopAll('escape');
  assert.deepEqual(aborted, ['escape']);
  assert.deepEqual(p.steps(), STOPPED('escape'));
});

test('C050 trace: a refused claim is a step with who refused it', () => {
  const p = page();
  p.cmp.measureOwnsOutput = () => true;
  assert.equal(p.bus.claim('instrument', 'play').ok, false);
  assert.deepEqual(p.steps(), ['claim instrument refused -']);
  const step = p.trace.steps().at(-1);
  assert.equal(step.detail.by, 'measurement');
});

test('C050 trace: the arms run through the bus (a mutation that bypasses it fails)', () => {
  const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const SYNTH_ARM = /synthArm\(\) \{[\s\S]*?this\.busArmed\('studio', true\)[\s\S]*?t\.arm\(\)/;
  const KEYS_ARM = /kbdToggle\(\) \{[\s\S]*?bus\.armed\(OWNER\.notes, this\.kbdArmed\[v\]\)/;
  const arms = [
    ['src/js/synth/ui.js', SYNTH_ARM, `this.busArmed('studio', true);`],
    ['src/js/midi/keyboard-ui.js', KEYS_ARM, 'bus.armed(OWNER.notes, this.kbdArmed[v]);'],
  ];
  for (const [f, re, call] of arms) {
    assert.match(src(f), re, `${f} arms through the bus`);
    const mutated = src(f).replace(call, '');
    assert.doesNotMatch(mutated, re, `${f}: the mutation is caught`);
  }
});
