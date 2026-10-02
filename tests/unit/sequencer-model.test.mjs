import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  BLOCK_SCHEMA,
  MAX_BLOCKS,
  SEQ_MIN_FREQUENCY,
  DEFAULT_TEMPO_BPM,
  createSequence,
  referenceSequence,
  normalizeBlock,
  normalizeModel,
  defaultParams,
  paramSchema,
  addBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveEarlier,
  moveLater,
  updateBlock,
  updateBlockWithIssues,
  selectBlock,
  neighbourAfterDelete,
  setTempo,
  setDurationUnit,
  setLoop,
  setWaveform,
  totalDuration,
  totalDurationMs,
  blockStartTimes,
  nextBlockId,
  describeBlock,
  serializeSequence,
  parseSequence,
  safeMaximum,
  mulberry32,
  formatCompactFrequency,
  formatFrequencyRange,
} from '../../src/js/sequencer/model.js';

const SR = 48000;
const SAFE_48K = 22800;
const SAFE_44K = 20947.5;

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const ids = (m) => m.blocks.map((b) => b.id);
const types = (m) => m.blocks.map((b) => b.type);

test('safeMaximum is 0.95 x Nyquist of the given rate; invalid rates use 44.1 kHz', () => {
  assert.equal(safeMaximum(48000), SAFE_48K);
  assert.equal(safeMaximum(44100), SAFE_44K);
  assert.equal(safeMaximum(96000), 45600);
  assert.equal(safeMaximum(undefined), SAFE_44K);
  assert.equal(safeMaximum(NaN), SAFE_44K);
  assert.equal(safeMaximum(-1), SAFE_44K);
});

test('every block type has a schema, defaults and validates cleanly', () => {
  assert.deepEqual(BLOCK_TYPES, [
    'tone',
    'silence',
    'sweep',
    'pulse',
    'chirp',
    'burst',
    'siren',
    'am',
    'fm',
    'random',
  ]);
  for (const type of BLOCK_TYPES) {
    const s = BLOCK_SCHEMA[type];
    assert.ok(s, type);
    assert.ok(s.durationMs.min >= 10 && s.durationMs.max >= s.durationMs.default, type);
    const { block, issues } = normalizeBlock(
      { id: 'b1', type, durationMs: s.durationMs.default, params: defaultParams(type) },
      { sampleRate: SR },
    );
    assert.deepEqual(issues, [], `${type}: ${issues.join('; ')}`);
    assert.equal(block.type, type);
    assert.deepEqual(Object.keys(block.params).sort(), s.params.map((p) => p.key).sort());
  }
  assert.deepEqual(defaultParams('sweep'), { start: 440, end: 880, curve: 'log' });
  assert.deepEqual(defaultParams('nope'), {});
  assert.equal(paramSchema('sweep', 'curve').kind, 'enum');
  assert.equal(paramSchema('sweep', 'nope'), null);
});

test('frequencies clamp to [20 Hz, 0.95 x Nyquist] of the given sample rate', () => {
  const hi = normalizeBlock({ type: 'tone', params: { freq: 30000 } }, { sampleRate: SR });
  assert.equal(hi.block.params.freq, SAFE_48K);
  assert.equal(hi.issues.length, 1);
  const hi44 = normalizeBlock({ type: 'tone', params: { freq: 30000 } }, { sampleRate: 44100 });
  assert.equal(hi44.block.params.freq, SAFE_44K);
  const noRate = normalizeBlock({ type: 'tone', params: { freq: 30000 } });
  assert.equal(noRate.block.params.freq, SAFE_44K, 'provisional 44.1 kHz, never 48 kHz');
  const lo = normalizeBlock({ type: 'sweep', params: { start: 5, end: -100 } }, { sampleRate: SR });
  assert.equal(lo.block.params.start, SEQ_MIN_FREQUENCY);
  assert.equal(lo.block.params.end, SEQ_MIN_FREQUENCY);
  const s = normalizeBlock({ type: 'chirp', params: { start: '1k' } }, { sampleRate: SR });
  assert.equal(s.block.params.start, 1000, 'non-numeric strings reset to the default');
  const str = normalizeBlock({ type: 'tone', params: { freq: ' 880 ' } }, { sampleRate: SR });
  assert.equal(str.block.params.freq, 880, 'numeric strings are accepted');
});

test('validation is NaN-safe for every field', () => {
  const bad = [NaN, Infinity, -Infinity, null, 'abc', {}, [], undefined];
  for (const v of bad) {
    for (const type of BLOCK_TYPES) {
      const params = {};
      for (const p of BLOCK_SCHEMA[type].params) params[p.key] = v;
      const { block } = normalizeBlock(
        { type, durationMs: v, beats: v, params },
        { sampleRate: SR },
      );
      assert.ok(Number.isFinite(block.durationMs), `${type} duration ${String(v)}`);
      for (const p of BLOCK_SCHEMA[type].params) {
        const out = block.params[p.key];
        if (p.kind === 'enum') assert.ok(p.options.some((o) => o[0] === out));
        else assert.ok(Number.isFinite(out), `${type}.${p.key} = ${String(v)} -> ${out}`);
      }
      assert.equal(block.beats, null);
    }
  }
  const m = normalizeModel({ tempoBpm: NaN, blocks: 'x', loop: 'yes', seed: NaN, waveform: 1 });
  assert.equal(m.model.tempoBpm, DEFAULT_TEMPO_BPM);
  assert.deepEqual(m.model.blocks, []);
  assert.equal(m.model.loop, false);
  assert.equal(m.model.waveform, 'sine');
  assert.ok(m.issues.length >= 1);
});

test('durations, enums and integers clamp to their bounds', () => {
  const n = (raw) => normalizeBlock(raw, { sampleRate: SR }).block;
  assert.equal(n({ type: 'tone', durationMs: 1 }).durationMs, 10);
  assert.equal(n({ type: 'tone', durationMs: 1e9 }).durationMs, 30000);
  assert.equal(n({ type: 'sweep', durationMs: 15 }).durationMs, 20, 'V1 sweep minimum 20 ms');
  assert.equal(n({ type: 'chirp', durationMs: 9000 }).durationMs, 5000, 'V1 chirp maximum 5 s');
  assert.equal(n({ type: 'sweep', params: { curve: 'cubic' } }).params.curve, 'log');
  assert.equal(n({ type: 'am', params: { depth: 55.6 } }).params.depth, 56);
  assert.equal(n({ type: 'am', params: { depth: 500 } }).params.depth, 100);
  assert.equal(n({ type: 'siren', params: { rate: 100 } }).params.rate, 20);
  assert.equal(n({ type: 'pulse', params: { pulseMs: 1 } }).params.pulseMs, 5);
  assert.equal(n({ type: 'random', params: { seed: -5 } }).params.seed, 0);
});

test('constraints: FM depth inside 20 Hz … safe max; burst interval >= burst', () => {
  const n = (raw) => normalizeBlock(raw, { sampleRate: SR });
  const lowCarrier = n({ type: 'fm', params: { freq: 100, depthHz: 500 } });
  assert.equal(lowCarrier.block.params.depthHz, 80);
  assert.ok(lowCarrier.issues.some((i) => /depth limited/.test(i)));
  const highCarrier = n({ type: 'fm', params: { freq: 22000, depthHz: 5000 } });
  assert.equal(highCarrier.block.params.depthHz, 800);
  const burst = n({ type: 'burst', params: { burstMs: 300, intervalMs: 100 } }).block.params;
  assert.equal(burst.intervalMs, 300);
});

test('unknown types become tone with an issue', () => {
  const r = normalizeBlock({ type: 'laser' }, { sampleRate: SR });
  assert.equal(r.block.type, 'tone');
  assert.ok(r.issues[0].includes('unknown type'));
});

test('reference sequence: blocks, durations, start times and labels', () => {
  const m = referenceSequence({ sampleRate: SR });
  assert.deepEqual(types(m), ['tone', 'sweep', 'silence', 'pulse', 'chirp']);
  assert.equal(m.tempoBpm, 120);
  assert.equal(totalDurationMs(m), 2250);
  assert.equal(totalDuration(m), 2.25);
  assert.deepEqual(blockStartTimes(m), [0, 0.5, 1, 1.25, 1.75]);
  assert.deepEqual(m.blocks.map(describeBlock), [
    { label: 'Tone', detail: '440 Hz' },
    { label: 'Sweep', detail: '440 → 880 Hz' },
    { label: 'Silence', detail: '' },
    { label: 'Pulse', detail: '1.2 kHz' },
    { label: 'Chirp', detail: '1 → 8 kHz' },
  ]);
});

test('formatters', () => {
  assert.equal(formatCompactFrequency(440), '440 Hz');
  assert.equal(formatCompactFrequency(1200), '1.2 kHz');
  assert.equal(formatCompactFrequency(15500), '15.5 kHz');
  assert.equal(formatCompactFrequency(NaN), '—');
  assert.equal(formatFrequencyRange(440, 8000), '440 Hz → 8 kHz');
  assert.equal(formatFrequencyRange(200, 4000, '–'), '200 Hz–4 kHz');
});

test('addBlock appends or inserts, assigns fresh ids, and is pure', () => {
  const m = deepFreeze(referenceSequence({ sampleRate: SR }));
  const a = addBlock(m, 'fm', { sampleRate: SR });
  assert.notEqual(a, m);
  assert.deepEqual(ids(a), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  assert.equal(a.blocks[5].type, 'fm');
  assert.equal(a.blocks[5].durationMs, BLOCK_SCHEMA.fm.durationMs.default);
  const b = addBlock(m, 'silence', { index: 1, durationMs: 120 });
  assert.deepEqual(types(b), ['tone', 'silence', 'sweep', 'silence', 'pulse', 'chirp']);
  assert.equal(b.blocks[1].durationMs, 120);
  const c = addBlock(m, 'tone', { params: { freq: 99999 }, sampleRate: SR });
  assert.equal(c.blocks[5].params.freq, SAFE_48K);
  assert.equal(addBlock(m, 'laser'), m, 'unknown type: unchanged');
  assert.equal(m.blocks.length, 5);
});

test('addBlock refuses beyond MAX_BLOCKS', () => {
  let m = createSequence();
  for (let i = 0; i < MAX_BLOCKS; i++) m = addBlock(m, 'tone');
  assert.equal(m.blocks.length, MAX_BLOCKS);
  assert.equal(addBlock(m, 'tone'), m);
  assert.equal(duplicateBlock(m, 'b1'), m);
});

test('deleteBlock, duplicateBlock', () => {
  const m = deepFreeze(referenceSequence({ sampleRate: SR }));
  assert.deepEqual(ids(deleteBlock(m, 'b3')), ['b1', 'b2', 'b4', 'b5']);
  assert.equal(deleteBlock(m, 'zz'), m);
  const d = duplicateBlock(m, 'b2');
  assert.deepEqual(ids(d), ['b1', 'b2', 'b6', 'b3', 'b4', 'b5']);
  assert.deepEqual(d.blocks[2].params, m.blocks[1].params);
  assert.notEqual(d.blocks[2].params, m.blocks[1].params, 'deep copy');
  assert.equal(duplicateBlock(m, 'zz'), m);
});

test('moveEarlier, moveLater and move(from, to)', () => {
  const m = deepFreeze(referenceSequence({ sampleRate: SR }));
  assert.deepEqual(ids(moveEarlier(m, 'b3')), ['b1', 'b3', 'b2', 'b4', 'b5']);
  assert.deepEqual(ids(moveLater(m, 'b3')), ['b1', 'b2', 'b4', 'b3', 'b5']);
  assert.equal(moveEarlier(m, 'b1'), m);
  assert.equal(moveLater(m, 'b5'), m);
  assert.equal(moveEarlier(m, 'zz'), m);
  assert.deepEqual(ids(moveBlock(m, 0, 4)), ['b2', 'b3', 'b4', 'b5', 'b1']);
  assert.deepEqual(ids(moveBlock(m, 4, 0)), ['b5', 'b1', 'b2', 'b3', 'b4']);
  assert.deepEqual(ids(moveBlock(m, 1, 99)), ['b1', 'b3', 'b4', 'b5', 'b2'], 'clamped');
  assert.equal(moveBlock(m, 2, 2), m);
  assert.equal(moveBlock(m, -1, 2), m);
  assert.equal(moveBlock(m, NaN, 2), m);
  assert.deepEqual(blockStartTimes(moveBlock(m, 2, 0)), [0, 0.25, 0.75, 1.25, 1.75]);
});

test('updateBlock merges params, validates, and handles type changes', () => {
  const m = deepFreeze(referenceSequence({ sampleRate: SR }));
  const a = updateBlock(m, 'b2', { params: { end: 1760 } }, { sampleRate: SR });
  assert.deepEqual(a.blocks[1].params, { start: 440, end: 1760, curve: 'log' });
  const r = updateBlockWithIssues(
    m,
    'b2',
    { params: { end: 1e6 }, durationMs: 0 },
    { sampleRate: SR },
  );
  assert.equal(r.model.blocks[1].params.end, SAFE_48K);
  assert.equal(r.model.blocks[1].durationMs, 20);
  assert.equal(r.issues.length, 2);
  const t = updateBlock(m, 'b1', { type: 'fm' });
  assert.equal(t.blocks[0].type, 'fm');
  assert.deepEqual(t.blocks[0].params, defaultParams('fm'));
  assert.equal(t.blocks[0].durationMs, 500, 'type change keeps the duration');
  assert.equal(updateBlock(m, 'zz', { durationMs: 5 }), m);
  assert.equal(m.blocks[1].params.end, 880, 'original untouched');
});

test('tempo-locked durations: beats lock, ms unlock, setTempo rescales only locked blocks', () => {
  let m = referenceSequence({ sampleRate: SR });
  m = setDurationUnit(m, 'b1', 'beats');
  assert.equal(m.blocks[0].beats, 1);
  assert.equal(m.blocks[0].durationMs, 500);
  m = updateBlock(m, 'b2', { beats: 2 });
  assert.equal(m.blocks[1].durationMs, 1000);
  const slow = setTempo(m, 60);
  assert.equal(slow.tempoBpm, 60);
  assert.equal(slow.blocks[0].durationMs, 1000);
  assert.equal(slow.blocks[1].durationMs, 2000);
  assert.equal(slow.blocks[2].durationMs, 250, 'ms block unaffected');
  assert.equal(slow.blocks[1].params.end, 880, 'tempo changes never touch params');
  const clamped = setTempo(m, 5000);
  assert.equal(clamped.tempoBpm, 300);
  assert.equal(setTempo(m, 'x'), m);
  const unlocked = updateBlock(slow, 'b1', { durationMs: 300 });
  assert.equal(unlocked.blocks[0].beats, null);
  assert.equal(setDurationUnit(slow, 'b2', 'ms').blocks[1].beats, null);
  const chirp = updateBlock(createSequence({ blocks: [{ type: 'chirp' }] }), 'b1', { beats: 100 });
  assert.equal(chirp.blocks[0].durationMs, 5000, 'beats clamp to the type maximum');
  assert.equal(chirp.blocks[0].beats, 10);
});

test('selection helpers', () => {
  const m = referenceSequence({ sampleRate: SR });
  assert.equal(selectBlock(m, 'b2'), 'b2');
  assert.equal(selectBlock(m, 'zz'), null);
  assert.equal(selectBlock(m, null), null);
  assert.equal(neighbourAfterDelete(m, 'b2'), 'b3');
  assert.equal(neighbourAfterDelete(m, 'b5'), 'b4');
  assert.equal(neighbourAfterDelete(createSequence({ blocks: [{ type: 'tone' }] }), 'b1'), null);
});

test('ids: next id from the largest suffix, duplicates and missing ids are reassigned', () => {
  assert.equal(nextBlockId([]), 'b1');
  assert.equal(nextBlockId([{ id: 'b7' }, { id: 'x' }, { id: 'b2' }]), 'b8');
  const m = normalizeModel({
    blocks: [{ id: 'b2', type: 'tone' }, { id: 'b2', type: 'tone' }, { type: 'tone' }],
  }).model;
  assert.deepEqual(ids(m), ['b2', 'b3', 'b4']);
});

test('loop and waveform setters', () => {
  const m = referenceSequence();
  assert.equal(setLoop(m, true).loop, true);
  assert.equal(setLoop(m, false), m);
  assert.equal(setWaveform(m, 'square').waveform, 'square');
  assert.equal(setWaveform(m, 'noise'), m);
});

test('serialise / parse round trip, and robust import', () => {
  let m = referenceSequence({ sampleRate: SR });
  m = addBlock(m, 'random', { sampleRate: SR });
  m = setLoop(setTempo(m, 90), true);
  const json = JSON.stringify(serializeSequence(m));
  const back = parseSequence(json, { sampleRate: SR });
  assert.deepEqual(back.issues, []);
  assert.deepEqual(back.model, m);
  assert.deepEqual(parseSequence(serializeSequence(m), { sampleRate: SR }).model, m);
  const broken = parseSequence('{nope', { sampleRate: SR });
  assert.deepEqual(broken.model.blocks, []);
  assert.equal(broken.issues.length, 1);
  const future = parseSequence({ version: 9, blocks: [{ type: 'tone' }] });
  assert.ok(future.issues[0].includes('version'));
  const tooMany = parseSequence({ blocks: Array(80).fill({ type: 'tone' }) });
  assert.equal(tooMany.model.blocks.length, MAX_BLOCKS);
  const noNodes = JSON.parse(JSON.stringify(serializeSequence(m)));
  assert.deepEqual(Object.keys(noNodes).sort(), [
    'blocks',
    'loop',
    'seed',
    'tempoBpm',
    'version',
    'waveform',
  ]);
});

test('random blocks get a deterministic seed from the model seed and block id', () => {
  const m = referenceSequence({ sampleRate: SR });
  const a = addBlock(m, 'random');
  const b = addBlock(m, 'random');
  assert.equal(a.blocks[5].params.seed, b.blocks[5].params.seed, 'same inputs, same seed');
  const c = addBlock(a, 'random');
  assert.notEqual(c.blocks[6].params.seed, c.blocks[5].params.seed, 'different id, different seed');
  const other = addBlock({ ...m, seed: 7 }, 'random');
  assert.notEqual(other.blocks[5].params.seed, a.blocks[5].params.seed);
  const explicit = addBlock(m, 'random', { params: { seed: 42 } });
  assert.equal(explicit.blocks[5].params.seed, 42);
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
});
