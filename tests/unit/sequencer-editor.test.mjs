import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSequencerEditor } from '../../src/js/sequencer/editor.js';
import { STOP_RAMP_S, STOP_PAD_S, STOP_LEAD_S } from '../../src/js/sequencer/compiler.js';
import { FakeContext, fakeTimers } from './sequencer-fake-audio.mjs';

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
