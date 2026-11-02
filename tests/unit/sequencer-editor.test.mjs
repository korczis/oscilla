import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { STOP_RAMP_S, STOP_PAD_S, STOP_LEAD_S } from '../../src/js/sequencer/compiler.js';
import { FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';
import * as timeline from '../../src/js/sequencer/timeline.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ids = (ed) => ed.model.blocks.map((b) => b.id);
const types = (ed) => ed.model.blocks.map((b) => b.type);

function setup(extra = {}) {
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const timers = fakeTimers();
  const log = [];
  const engine = {
    getContext: () => ctx,
    getDestination: () => ctx.destination,
    resume: () => log.push('resume'),
    onStart: (i) => log.push(['start', i]),
    onEnded: (i) => log.push(['ended', i]),
    ...extra,
  };
  const ed = createSequencerEditor({ engine, timers });
  return { ctx, timers, log, ed };
}

const key = (k, mods = {}) => {
  const e = {
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    prevented: false,
    ...mods,
  };
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
};

test('starts with the reference sequence and first block; no Web Audio in state', () => {
  const { ed } = setup();
  assert.deepEqual(types(ed), ['tone', 'sweep', 'silence', 'pulse', 'chirp']);
  assert.equal(ed.selectedId, 'b1');
  assert.equal(ed.selectedBlock.type, 'tone');
  assert.equal(ed.totalDurationS, 2.25);
  assert.deepEqual(ed.blockStarts, [0, 0.5, 1, 1.25, 1.75]);
  assert.equal(ed.sampleRate(), 48000);
  // Only plain data in enumerable state: JSON round trip keeps every data field.
  const json = JSON.parse(JSON.stringify(ed));
  for (const k of ['model', 'selectedId', 'playing', 'error', 'warnings']) assert.ok(k in json, k);
  assert.ok(!JSON.stringify(ed).includes('oscillator'));
});

test('select, add after the selection, delete selects a neighbour, duplicate', () => {
  const { ed } = setup();
  ed.selectBlock('b2');
  assert.equal(ed.addBlock('fm'), 'b6');
  assert.deepEqual(types(ed), ['tone', 'sweep', 'fm', 'silence', 'pulse', 'chirp']);
  assert.equal(ed.selectedId, 'b6');
  assert.equal(ed.addBlock('laser'), null);
  assert.ok(ed.error.includes('Unknown'));
  assert.equal(ed.deleteSelected(), true);
  assert.equal(ed.selectedId, 'b3', 'next block selected');
  assert.equal(ed.duplicateSelected(), 'b6');
  assert.deepEqual(ids(ed), ['b1', 'b2', 'b3', 'b6', 'b4', 'b5']);
  ed.selectBlock('nope');
  assert.equal(ed.selectedId, null);
  assert.equal(ed.deleteSelected(), false);
  ed.addBlock('tone');
  assert.equal(
    ed.model.blocks[ed.model.blocks.length - 1].id,
    ed.selectedId,
    'no selection: append',
  );
});

test('moveSelected and updateParam (sweep editor: start, end, duration, curve)', () => {
  const { ed } = setup();
  ed.selectBlock('b2');
  assert.equal(ed.moveSelected(-1), true);
  assert.deepEqual(ids(ed), ['b2', 'b1', 'b3', 'b4', 'b5']);
  assert.equal(ed.moveSelected(-1), false);
  assert.equal(ed.moveSelected(1), true);
  ed.updateParam('start', 220);
  ed.updateParam('end', '1760');
  ed.updateParam('durationMs', 750);
  ed.updateParam('curve', 'linear');
  assert.deepEqual(ed.selectedBlock.params, { start: 220, end: 1760, curve: 'linear' });
  assert.equal(ed.selectedBlock.durationMs, 750);
  ed.updateParam('end', 99999);
  assert.equal(ed.selectedBlock.params.end, 22800);
  assert.equal(ed.warnings.length, 1);
  ed.updateParam('type', 'chirp');
  assert.equal(ed.selectedBlock.type, 'chirp');
  ed.setDurationUnit('beats');
  assert.equal(ed.selectedBlock.beats, 1.5);
  ed.setTempo(60);
  assert.equal(ed.selectedBlock.durationMs, 1500);
  ed.setWaveform('square');
  assert.equal(ed.model.waveform, 'square');
});

test('keyboard: arrows select, Alt+Arrow moves, Delete removes, Ctrl+D duplicates', () => {
  const { ed } = setup();
  let e = key('ArrowRight');
  assert.equal(ed.onKeydown(e), true);
  assert.equal(e.prevented, true);
  assert.equal(ed.selectedId, 'b2');
  ed.onKeydown(key('End'));
  assert.equal(ed.selectedId, 'b5');
  ed.onKeydown(key('Home'));
  assert.equal(ed.selectedId, 'b1');
  ed.onKeydown(key('ArrowRight', { altKey: true }));
  assert.deepEqual(ids(ed), ['b2', 'b1', 'b3', 'b4', 'b5']);
  ed.onKeydown(key('ArrowDown', { altKey: true }));
  assert.deepEqual(ids(ed), ['b2', 'b3', 'b1', 'b4', 'b5']);
  ed.onKeydown(key('ArrowUp', { altKey: true }));
  assert.deepEqual(ids(ed), ['b2', 'b1', 'b3', 'b4', 'b5']);
  ed.onKeydown(key('Delete'));
  assert.deepEqual(ids(ed), ['b2', 'b3', 'b4', 'b5']);
  assert.equal(ed.selectedId, 'b3');
  ed.onKeydown(key('d', { ctrlKey: true }));
  assert.equal(ed.model.blocks.length, 5);
  ed.onKeydown(key('Backspace'));
  assert.equal(ed.model.blocks.length, 4);
  e = key('x');
  assert.equal(ed.onKeydown(e), false);
  assert.equal(e.prevented, false);
  assert.equal(
    ed.onKeydown(key('Delete', { target: { tagName: 'INPUT' } })),
    false,
    'inputs keep Delete',
  );
  assert.equal(ed.model.blocks.length, 4);
});

test('drag and drop reorders with the timeline insertion index', () => {
  const { ed } = setup();
  ed.dragStart(0);
  assert.equal(ed.selectedId, 'b1');
  ed.dragOver(99);
  assert.equal(ed.dragInsertIndex, 5);
  assert.equal(ed.drop(), true);
  assert.deepEqual(ids(ed), ['b2', 'b3', 'b4', 'b5', 'b1']);
  assert.equal(ed.dragFromIndex, -1);
  ed.dragStart(2);
  assert.equal(ed.drop(3), false, 'dropping right after itself changes nothing');
  ed.dragStart(1);
  ed.onKeydown(key('Escape'));
  assert.equal(ed.dragFromIndex, -1);
  ed.dragOver(2);
  assert.equal(ed.dragInsertIndex, -1, 'no drag in progress');
});

test('play schedules on the audio clock; natural end resets the transport', () => {
  const { ctx, ed, log } = setup();
  assert.equal(ed.play(), true);
  assert.equal(ed.playing, true);
  assert.deepEqual(log[0], 'resume');
  assert.equal(log[1][0], 'start');
  const { t0, duration } = log[1][1];
  assert.ok(t0 >= 5.02 && t0 < 5.0201);
  assert.equal(duration, 2.25);
  assert.equal(ed.stats().activeSourceCount, 1);
  ctx.currentTime = t0 + 0.75;
  assert.equal(ed.playheadTime(), 0.75);
  assert.equal(ed.activeBlockIndex(), 1);
  assert.ok(Math.abs(ed.currentFrequency() - Math.sqrt(440 * 880)) < 1e-6);
  ctx.currentTime = t0 + 1.1;
  assert.equal(ed.currentFrequency(), null, 'silence');
  ctx.advance(t0 + duration + STOP_PAD_S);
  assert.equal(ed.playing, false);
  assert.deepEqual(log[log.length - 1], ['ended', { stopped: false }]);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ed.playheadTime(), null);
});

test('stop mid-play fades out and releases every node', () => {
  const { ctx, ed, log } = setup();
  ed.play();
  ctx.currentTime += 0.6;
  assert.equal(ed.stop(), true);
  assert.equal(ed.playing, false);
  const fade = STOP_LEAD_S + 128 / 48000 + STOP_RAMP_S + STOP_PAD_S;
  ctx.advance(ctx.currentTime + fade + 1e-6);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ctx.liveSources, 0);
  assert.deepEqual(log[log.length - 1], ['ended', { stopped: true }]);
  assert.equal(ed.stop(), false);
});

test('restart 20x: old voices fade and release, no growth', () => {
  const { ctx, ed } = setup();
  for (let i = 0; i < 20; i++) {
    ed.restart();
    assert.ok(ed.stats().voices <= 2, `voices ${ed.stats().voices}`);
    ctx.advance(ctx.currentTime + 0.1);
  }
  assert.equal(ed.playing, true);
  assert.equal(ed.stats().voices, 1);
  ed.stop();
  ctx.advance(ctx.currentTime + 0.1);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ctx.liveSources, 0);
});

test('loop: the next pass starts exactly at the previous end; stop cancels queued passes', () => {
  const { ctx, ed, timers } = setup();
  ed.setLoop(true);
  ed.play();
  const first = ed.currentPassTiming();
  // LOOKAHEAD 1 s: nothing queued yet (2.25 s pass).
  assert.equal(ed.stats().voices, 1);
  ctx.currentTime = first.t0 + 1.5;
  timers.runUntil(1500);
  assert.equal(ed.stats().voices, 2);
  const carriers = ctx.oscillators;
  assert.equal(carriers[1].startAt, first.t0 + first.duration, 'gapless on the audio clock');
  ctx.advance(first.t0 + first.duration + 0.1);
  assert.equal(ed.playing, true);
  assert.equal(ed.stats().voices, 1);
  assert.equal(ed.currentPassTiming().t0, first.t0 + first.duration);
  assert.ok(Math.abs(ed.playheadTime() - 0.1) < 1e-9);
  ctx.currentTime += 1.5;
  timers.runUntil(3600); // re-armed for (lastEnd - LOOKAHEAD - now) = 2000 ms after 1500
  assert.equal(ed.stats().voices, 2, 'third pass queued');
  ed.stop();
  ctx.advance(ctx.currentTime + 0.1);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(timers.size, 0);
  assert.equal(ed.playing, false);
});

// C002 (coupling-1, -2, -3): one output owner at a time. The editor asks the adapter for the
// output before it schedules anything, and again before every loop pass.
test('C002: a refused claimOutput plays nothing and says why', () => {
  const { ctx, ed, log } = setup({ claimOutput: () => false });
  assert.equal(ed.play(), false);
  assert.equal(ed.playing, false);
  assert.equal(ctx.oscillators.length, 0, 'no source created on the context');
  assert.ok(ed.error.length > 0, 'a refusal is never silent');
  assert.ok(!log.includes('resume') && !log.some((e) => e[0] === 'start'), 'nothing resumed');
  const named = setup({ claimOutput: () => 'Measurement in progress' });
  assert.equal(named.ed.play(), false);
  assert.equal(named.ed.error, 'Measurement in progress');
  assert.equal(named.ctx.oscillators.length, 0);
  assert.equal(named.ed.togglePlay(), false, 'the toggle is refused the same way');
  assert.equal(named.ed.playing, false);
});

test('C002: claimOutput is asked before the first pass is scheduled', () => {
  const asked = [];
  let ctxRef = null;
  const { ctx, ed } = setup({
    claimOutput: () => {
      asked.push(ctxRef.oscillators.length);
      return true;
    },
  });
  ctxRef = ctx;
  assert.equal(ed.play(), true);
  assert.deepEqual(asked, [0], 'one claim, made while nothing was scheduled');
  assert.equal(ed.error, '');
  assert.ok(ctx.oscillators.length > 0);
  ed.stop();
  ctx.advance(ctx.currentTime + 0.1);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
});

test('C002: every loop pass claims the output; a refusal stops the loop', () => {
  let answer = true;
  let claims = 0;
  const { ctx, ed, timers } = setup({
    claimOutput: () => {
      claims += 1;
      return answer;
    },
  });
  ed.setLoop(true);
  assert.equal(ed.play(), true);
  const first = ed.currentPassTiming();
  const atStart = claims;
  ctx.currentTime = first.t0 + 1.5;
  timers.runUntil(1500);
  assert.equal(ed.stats().voices, 2, 'second pass queued');
  assert.ok(claims > atStart, 'the second pass was claimed');
  answer = 'Measurement in progress';
  ctx.advance(first.t0 + first.duration + 0.1);
  ctx.currentTime += 1.5;
  const before = ctx.oscillators.length;
  timers.runUntil(3600);
  assert.equal(ctx.oscillators.length, before, 'the refused pass is not scheduled');
  assert.equal(ed.playing, false);
  assert.equal(ed.error, 'Measurement in progress');
  ctx.advance(ctx.currentTime + 0.1);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ctx.liveSources, 0);
  assert.equal(timers.size, 0);
});

test('errors: no engine, empty sequence; record only when the adapter provides it', () => {
  const noEngine = createSequencerEditor({ timers: null });
  assert.equal(noEngine.play(), false);
  assert.ok(noEngine.error.length > 0);
  assert.equal(noEngine.recordAvailable, false);
  assert.equal(noEngine.record(), false);
  const { ed } = setup();
  ed.clear();
  assert.equal(ed.play(), false);
  assert.equal(ed.error, 'Add a block first.');
  const got = [];
  const rec = setup({ onRecord: (json) => got.push(json) }).ed;
  assert.equal(rec.recordAvailable, true);
  assert.equal(rec.record(), true);
  assert.equal(got[0].blocks.length, 5);
});

test('serialize / load', () => {
  const { ed } = setup();
  ed.addBlock('random');
  const json = ed.serialize();
  const other = setup().ed;
  assert.deepEqual(other.load(JSON.stringify(json)), []);
  assert.deepEqual(other.model, ed.model);
  assert.equal(other.selectedId, 'b1');
  assert.ok(other.load('{bad').length === 1);
});

test('dispose releases everything', () => {
  const { ctx, ed } = setup();
  ed.play();
  ed.dispose();
  assert.equal(ed.playing, false);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.ok(ctx.created.every((n) => n.kind === 'destination' || n.disconnected));
});

// ---------------------------------------------------------------- K001: engine accounting

/** An editor whose engine adapter counts into a real AudioEngine (as main.js wires it). */
function counted() {
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const timers = fakeTimers();
  const engine = new AudioEngine({ env: { setTimeout, clearTimeout } });
  assert.equal(typeof engine.stageAccounting, 'function', 'the engine owns the stage accounting');
  const accounting = engine.stageAccounting();
  const ed = createSequencerEditor({
    engine: { getContext: () => ctx, getDestination: () => ctx.destination, accounting },
    timers,
  });
  return { ctx, timers, engine, ed, accounting };
}

test('K001: AudioEngine.stageAccounting counts a stage in the engine census', () => {
  const engine = new AudioEngine({ env: { setTimeout, clearTimeout } });
  const a = engine.stageAccounting();
  const node = {};
  const osc = {};
  assert.equal(a.track(node), node);
  assert.equal(a.source(osc), osc);
  assert.equal(engine.activeNodeCount, 2);
  assert.equal(engine.activeSourceCount, 1);
  assert.equal(a.held, 2);
  a.untrack(osc);
  assert.equal(engine.activeNodeCount, 1);
  assert.equal(engine.activeSourceCount, 0);
  a.source({});
  a.release();
  assert.equal(engine.activeNodeCount, 0, 'release() untracks whatever the stage still holds');
  assert.equal(engine.activeSourceCount, 0);
  assert.equal(a.held, 0);
});

test('K001: a pass whose build throws part-way leaves nothing counted', () => {
  const ctx = new FakeContext({ sampleRate: 48000, currentTime: 5 });
  const engine = new AudioEngine({ env: { setTimeout, clearTimeout } });
  const inner = engine.stageAccounting();
  let calls = 0;
  // The first scheduled source is counted, then the build throws.
  const failing = { track: inner.track, untrack: inner.untrack, source: (n) => {
    inner.source(n);
    calls++;
    throw new Error('build failed');
  } };
  const ed = createSequencerEditor({
    engine: { getContext: () => ctx, getDestination: () => ctx.destination, accounting: failing },
    timers: fakeTimers(),
  });
  // Play reports a build that throws instead of throwing into the click handler (C003 R-7).
  assert.equal(ed.play(), false);
  assert.match(ed.error, /build failed/);
  assert.equal(ed.playing, false);
  assert.ok(calls >= 1, 'the build reached the accounting');
  assert.equal(engine.activeNodeCount, 0, 'engine nodes after a failed build');
  assert.equal(engine.activeSourceCount, 0);
});

test('K001: V2 playback is counted by the engine and leaves 0 nodes after stop()', () => {
  const { ctx, engine, ed } = counted();
  assert.equal(engine.activeNodeCount, 0);
  assert.equal(ed.play(), true);
  assert.ok(engine.activeNodeCount > 0, `engine nodes during play: ${engine.activeNodeCount}`);
  assert.equal(engine.activeNodeCount, ed.stats().activeNodeCount, 'every voice node is counted');
  assert.equal(engine.activeSourceCount, ed.stats().activeSourceCount);
  ctx.currentTime += 0.6;
  assert.equal(ed.stop(), true);
  assert.ok(engine.activeNodeCount > 0, 'the fading voice is still counted');
  const fade = STOP_LEAD_S + 128 / 48000 + STOP_RAMP_S + STOP_PAD_S;
  ctx.advance(ctx.currentTime + fade + 1e-6);
  assert.equal(engine.activeNodeCount, 0, 'engine nodes after stop');
  assert.equal(engine.activeSourceCount, 0, 'engine sources after stop');
});

test('K001: natural end, looped passes, restarts and dispose all return the engine to 0', () => {
  let { ctx, engine, ed } = counted();
  ed.play();
  const { t0, duration } = ed.currentPassTiming();
  ctx.advance(t0 + duration + STOP_PAD_S);
  assert.equal(ed.playing, false);
  assert.equal(engine.activeNodeCount, 0, 'natural end');
  const loop = counted();
  loop.ed.setLoop(true);
  loop.ed.play();
  const first = loop.ed.currentPassTiming();
  loop.ctx.currentTime = first.t0 + 1.5;
  loop.timers.runUntil(1500);
  assert.equal(loop.ed.stats().voices, 2);
  assert.equal(loop.engine.activeNodeCount, loop.ed.stats().activeNodeCount, 'queued pass counted');
  loop.ed.stop();
  loop.ctx.advance(loop.ctx.currentTime + 0.1);
  assert.equal(loop.engine.activeNodeCount, 0, 'looped run stopped');
  ({ ctx, engine, ed } = counted());
  for (let i = 0; i < 20; i++) {
    ed.restart();
    ctx.advance(ctx.currentTime + 0.1);
  }
  assert.equal(engine.activeNodeCount, ed.stats().activeNodeCount, 'no growth over restarts');
  ed.dispose();
  assert.equal(engine.activeNodeCount, 0, 'dispose');
  assert.equal(engine.activeSourceCount, 0);
});

test('K001: without accounting hooks the editor still plays (lab fixtures)', () => {
  const { ed } = setup();
  assert.equal(ed.play(), true);
  ed.dispose();
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
});

// ---------------------------------------------------------------- K003: Space, undo, copy

const ctrl = (k, mods = {}) => key(k, { ctrlKey: true, ...mods });
const snap = (ed) => JSON.stringify(ed.serialize());

test('K003: Space on the timeline plays and stops; repeats and modifiers do not', () => {
  const { ctx, ed } = setup();
  let e = key(' ', { code: 'Space' });
  assert.equal(ed.onKeydown(e), true);
  assert.equal(e.prevented, true, 'the timeline claims Space');
  assert.equal(ed.playing, true);
  e = key(' ', { code: 'Space', repeat: true });
  assert.equal(ed.onKeydown(e), true, 'an auto-repeat is claimed');
  assert.equal(ed.playing, true, 'and does not toggle');
  assert.equal(ed.onKeydown(key('Spacebar')), true, 'the legacy key name');
  assert.equal(ed.playing, false);
  ctx.advance(ctx.currentTime + 0.1);
  assert.deepEqual(ed.stats(), { voices: 0, activeSourceCount: 0, activeNodeCount: 0 });
  assert.equal(ed.onKeydown(key(' ', { code: 'Space', shiftKey: true })), false, 'Shift+Space');
  assert.equal(ed.onKeydown(ctrl(' ')), false, 'Ctrl+Space');
  assert.equal(ed.onKeydown(key(' ', { target: { tagName: 'INPUT' } })), false, 'a field keeps it');
  assert.equal(ed.playing, false);
});

test('K003: Ctrl+Z restores the exact serialized model of every edit; Shift+Ctrl+Z redoes', () => {
  const { ed } = setup();
  const states = [snap(ed)];
  const edits = [
    () => ed.addBlock('fm'),
    () => ed.updateParam('freq', 523.25),
    () => ed.onKeydown(key('ArrowLeft', { altKey: true })),
    () => ed.onKeydown(ctrl('d')),
    () => ed.setTempo(90),
    () => ed.setLoop(true),
    () => {
      ed.dragStart(0);
      ed.drop(4);
    },
    () => ed.onKeydown(key('Delete')),
    () => ed.setDurationUnit('ms'),
    () => ed.clear(),
  ];
  for (const edit of edits) {
    edit();
    states.push(snap(ed));
    assert.notEqual(states.at(-1), states.at(-2), `edit ${states.length - 1} changed the model`);
  }
  assert.equal(ed.canUndo, true);
  for (let i = states.length - 2; i >= 0; i--) {
    const e = ctrl('z');
    assert.equal(ed.onKeydown(e), true);
    assert.equal(e.prevented, true);
    assert.equal(snap(ed), states[i], `undo to state ${i}`);
  }
  assert.equal(ed.canUndo, false);
  assert.equal(ed.onKeydown(ctrl('z')), false, 'nothing to undo: the key is not claimed');
  assert.equal(ed.selectedId, 'b1', 'the selection comes back with the model');
  for (let i = 1; i < states.length; i++) {
    assert.equal(ed.onKeydown(ctrl('Z', { shiftKey: true })), true);
    assert.equal(snap(ed), states[i], `redo to state ${i}`);
  }
  assert.equal(ed.onKeydown(ctrl('z', { shiftKey: true })), false, 'nothing to redo');
  // Cmd on macOS; a new edit drops the redo branch.
  ed.onKeydown(key('z', { metaKey: true }));
  assert.equal(snap(ed), states.at(-2));
  ed.addBlock('tone');
  assert.equal(ed.canRedo, false);
  // An edit that changes nothing is no step; loading a sequence starts a new history.
  const depth = ed.historyDepth;
  ed.setTempo(ed.model.tempoBpm);
  ed.moveBlockTo(0, 0);
  assert.equal(ed.historyDepth, depth);
  ed.load(ed.serialize());
  assert.equal(ed.canUndo, false);
});

test('K003: a field committed with its current value is no undo step', () => {
  const { ed } = setup();
  ed.selectBlock('b1');
  const b = ed.selectedBlock;
  const [k, v] = Object.entries(b.params)[0];
  ed.updateParam(k, v);
  ed.updateSelected({ params: { ...b.params } });
  assert.equal(ed.canUndo, false, 'an unchanged field records nothing');
  ed.updateParam(k, typeof v === 'number' ? v + 1 : v);
  assert.equal(ed.canUndo, typeof v === 'number', 'a changed one does');
});

test('K003: the waveform mirrored from the instrument is no undo step and survives undo', () => {
  const { ed } = setup();
  const w0 = ed.model.waveform;
  const w1 = w0 === 'square' ? 'triangle' : 'square';
  ed.setWaveform(w1);
  assert.equal(ed.model.waveform, w1);
  assert.equal(ed.canUndo, false, 'the mirror records no step');
  ed.setWaveform(w0);
  ed.setTempo(60); // the step before it holds w0
  ed.setWaveform(w1);
  assert.equal(ed.historyDepth, 1);
  ed.undo();
  assert.equal(ed.model.tempoBpm, 120);
  assert.equal(ed.model.waveform, w1, 'an undo never brings back an older waveform');
  ed.setWaveform(w0); // the redo step holds w1
  assert.equal(ed.canRedo, true, 'the mirror keeps the redo branch');
  ed.redo();
  assert.equal(ed.model.tempoBpm, 60);
  assert.equal(ed.model.waveform, w0, 'nor does a redo');
});

test('K003: Ctrl+C copies the selected block; Ctrl+V pastes it after the selection', () => {
  const { ed } = setup();
  ed.selectBlock('b2');
  const before = snap(ed);
  assert.equal(ed.onKeydown(ctrl('c')), true);
  assert.equal(snap(ed), before, 'copy does not change the model');
  assert.equal(ed.canUndo, false, 'copy is not an edit');
  ed.selectBlock('b4');
  const e = ctrl('v');
  assert.equal(ed.onKeydown(e), true);
  assert.equal(e.prevented, true);
  assert.deepEqual(ids(ed), ['b1', 'b2', 'b3', 'b4', 'b6', 'b5']);
  assert.equal(ed.selectedId, 'b6', 'the pasted block is selected');
  const src = ed.model.blocks[1];
  const pasted = ed.selectedBlock;
  assert.deepEqual({ ...pasted, id: src.id }, src, 'an exact copy but its id');
  ed.onKeydown(ctrl('v', { metaKey: true, ctrlKey: false }));
  assert.equal(ed.model.blocks.length, 7, 'pastes again');
  ed.onKeydown(ctrl('z'));
  ed.onKeydown(ctrl('z'));
  assert.equal(snap(ed), before, 'each paste is one undo step');
  // A tempo-locked block pasted after a tempo change takes the current tempo.
  ed.setTempo(60);
  ed.onKeydown(ctrl('v'));
  assert.equal(ed.selectedBlock.beats, 1);
  assert.equal(ed.selectedBlock.durationMs, 1000);
  // Nothing selected: copy is not claimed; a full sequence refuses the paste with a reason.
  ed.selectBlock(null);
  assert.equal(ed.onKeydown(ctrl('c')), false);
  const empty = setup().ed;
  assert.equal(empty.onKeydown(ctrl('v')), false, 'empty clipboard: not claimed');
  for (let i = ed.model.blocks.length; i < 64; i++) ed.addBlock('tone');
  const full = snap(ed);
  assert.equal(ed.onKeydown(ctrl('v')), true);
  assert.equal(snap(ed), full);
  assert.match(ed.error, /full/);
});

// C004 (findings dup-stale-3, persist-6): the instrument owns the sequence waveform (main.js
// mirrors it in with setWaveform). A load or a clear keeps the mirrored value, so a file whose
// sequencer.waveform differs from the instrument's can never leave playback on a stale one.
test('C004: load and clear keep the instrument waveform the editor follows', () => {
  const { ctx, ed } = setup();
  ed.setWaveform('sine'); // the instrument's, mirrored in
  const file = { ...ed.serialize(), waveform: 'square' };
  assert.deepEqual(ed.load(file), []);
  assert.equal(ed.model.waveform, 'sine', 'a load keeps the instrument waveform');
  assert.equal(ed.play(), true);
  const types = ctx.oscillators.map((o) => o.type);
  assert.ok(types.length > 0 && types.every((t) => t === 'sine'), `played ${types}`);
  ed.stop();
  ed.setWaveform('triangle');
  ed.clear();
  assert.equal(ed.model.waveform, 'triangle', 'a clear keeps the instrument waveform');
  assert.equal(ed.serialize().waveform, 'triangle', 'the file writes the derived value');
});

// C004 (finding dup-stale-6): the editor notifies every change of its model, so a view that
// reads the non-reactive model (the status bar Duration) can be invalidated by a counter.
test('C004: onChange fires for every edit and load, and unsubscribes', () => {
  const { ed } = setup();
  const seen = [];
  const off = ed.onChange((model) => seen.push(model));
  ed.setLoop(true);
  ed.addBlock('tone');
  ed.setTempo(90);
  ed.load(ed.serialize());
  ed.clear();
  assert.equal(seen.length, 5);
  assert.equal(seen[1].blocks.length, 6);
  assert.ok(seen.every((m, i) => i === seen.length - 1 || m !== seen[i + 1]));
  assert.equal(seen[seen.length - 1], ed.model);
  off();
  ed.setLoop(false);
  assert.equal(seen.length, 5, 'no call after unsubscribing');
  assert.throws(() => ed.onChange('x'), TypeError);
});

// C006 (finding vis-divergence-3): edits during playback apply from the next pass, so the
// playhead must follow the sounding pass's own layout, not the edited model's timeline.
const laneOf = (ed) => {
  const scale = timeline.createTimeScale({ durationS: ed.totalDurationS, widthPx: 600,
    minSpanS: 3.75, headroomRatio: 0.1 });
  return timeline.layoutBlocks(ed.model, scale, { gapPx: 4 });
};
const rectUnder = (rects, x) => rects.find((r) => x >= r.x && x < r.x + r.w) || null;

test('C006: after lengthening block 0 during pass 1, the playhead marks the Pulse that sounds',
  () => {
    const { ctx, ed } = setup();
    ed.selectBlock('b1');
    assert.equal(ed.play(), true);
    const pass = ed.currentPassTiming();
    ctx.currentTime = pass.t0 + 0.1; // inside the Tone of pass 1
    assert.deepEqual(ed.currentPassState(), { durationS: 2.25, nextDurationS: 2.25,
      current: true, layoutCurrent: true });
    ed.updateParam('durationMs', 3000); // the edit lands while pass 1 sounds
    assert.equal(ed.model.blocks[0].durationMs, 3000);
    ctx.currentTime = pass.t0 + 1.3; // pass 1: Pulse 1.2 kHz, 1.25-1.75 s, first pulse
    assert.equal(ed.currentFrequency(), 1200, 'the Pulse sounds');
    assert.equal(ed.currentPassTiming().t0, pass.t0, 'the pass was not restarted');
    const pb = ed.currentPassBlock();
    assert.equal(pb.id, 'b4', 'the sounding block is the Pulse');
    assert.equal(pb.index, ed.activeBlockIndex());
    near(pb.startS, 1.25);
    near(pb.endS, 1.75);
    near(pb.t, 1.3);
    assert.deepEqual(ed.currentPassState(), { durationS: 2.25, nextDurationS: 4.75,
      current: false, layoutCurrent: false });
    const rects = laneOf(ed);
    const x = timeline.passPlayheadX(rects, pb);
    assert.equal(rectUnder(rects, x).id, 'b4', 'the playhead sits on the Pulse rect');
    // The linear mapping of the pass clock onto the edited lane lands in the 3 s Tone: the
    // defect this replaces.
    const scale = timeline.createTimeScale({ durationS: ed.totalDurationS, widthPx: 600,
      minSpanS: 3.75, headroomRatio: 0.1 });
    assert.equal(rectUnder(rects, scale.secToPx(pb.t)).id, 'b1');
    ed.stop();
  });

test('C006: moves and deletes during playback map by block id; a deleted block gives null',
  () => {
    const { ctx, ed } = setup();
    ed.play();
    const { t0 } = ed.currentPassTiming();
    ed.selectBlock('b4');
    ed.moveSelected(-1); // Pulse before Silence in the edited model
    ed.moveSelected(-1); // and before the Sweep
    ctx.currentTime = t0 + 1.4;
    const pb = ed.currentPassBlock();
    assert.equal(pb.id, 'b4');
    assert.equal(pb.index, 3, 'its place in the sounding pass');
    const state = ed.currentPassState();
    assert.equal(state.layoutCurrent, false);
    assert.equal(state.nextDurationS, 2.25);
    const rects = laneOf(ed);
    assert.equal(rects[1].id, 'b4', 'moved in the edited lane');
    assert.equal(rectUnder(rects, timeline.passPlayheadX(rects, pb)).id, 'b4');
    ed.deleteSelected();
    assert.equal(timeline.passPlayheadX(laneOf(ed), ed.currentPassBlock()), null);
    ed.stop();
    assert.equal(ed.currentPassBlock(), null, 'stopped: no sounding block');
    assert.equal(ed.currentPassState(), null);
  });

test('C006: a parameter-only edit keeps the layout but waits for the next pass; a loop pass '
  + 'compiled after the edit is current', () => {
  const { ctx, ed, timers } = setup();
  ed.setLoop(true);
  ed.play();
  const first = ed.currentPassTiming();
  ed.selectBlock('b1');
  ed.updateParam('freq', 660);
  ctx.currentTime = first.t0 + 0.2;
  assert.deepEqual(ed.currentPassState(), { durationS: 2.25, nextDurationS: 2.25,
    current: false, layoutCurrent: true });
  ed.setTempo(ed.model.tempoBpm); // no change: still the same wait, not a new one
  assert.equal(ed.currentPassState().current, false);
  ctx.currentTime = first.t0 + 1.5;
  timers.runUntil(1500); // the next pass is compiled from the edited model
  ctx.advance(first.t0 + first.duration + 0.1);
  assert.deepEqual(ed.currentPassState(), { durationS: 2.25, nextDurationS: 2.25,
    current: true, layoutCurrent: true });
  assert.equal(ed.currentPassBlock().id, 'b1');
  ed.stop();
});
