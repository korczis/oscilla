// E041: the sequencer's numeric helpers have one owner, core/math.js and core/frequency.js.
//
// sequencer/model.js carried its own copy of the V1 helpers. Its round() was the pre-S079 body,
// so a decimal tie stored just under its decimal value rounded down in the sequencer and up in
// core (S079 fixed core only). normalizeBlock runs on every sequencer block and, through
// studio/validate.js, on every Studio clip, so the stored model kept the tie bug. The sequencer
// compiler also kept a copy of audio/patterns.js lfoShape, and model.js a copy of formatMs.
//
// The first group pins what must not change: the helpers' results on ordinary values, the
// sequencer floor of normalizedToFrequency, and the random block's frequencies. The second
// group is the fix: ties round as core rounds them (fails on the merge base). The third pins
// one owner by identity, so a copy cannot come back unnoticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as seq from '../../src/js/sequencer/model.js';
import { createSequence, normalizeBlock, setTempo, SEQ_MIN_FREQUENCY } from '../../src/js/sequencer/model.js';
import { lfoShape as compilerLfoShape } from '../../src/js/sequencer/compiler.js';
import * as math from '../../src/js/core/math.js';
import * as freq from '../../src/js/core/frequency.js';
import { lfoShape as patternsLfoShape } from '../../src/js/audio/patterns.js';

const ODD = [NaN, Infinity, -Infinity, 0, -0, -5, 1e-9, 0.25, 1, 2.5, 440, 1e6, undefined, null, '7', ''];

test('E041 pin: clamp, isNum, toNumber, toInt, pick and sig give the core results', () => {
  for (const v of ODD) {
    assert.ok(Object.is(seq.isNum(v), math.isNum(v)), `isNum(${v})`);
    if (typeof v === 'number') {
      assert.ok(Object.is(seq.clamp(v, 0, 10), math.clamp(v, 0, 10)), `clamp(${v})`);
      if (Number.isFinite(v) && v !== 0) {
        assert.equal(seq.sig(v, 3), math.sig(v, 3), `sig(${v})`);
      }
    }
    assert.ok(Object.is(seq.toNumber(v, 3, -1, 99), math.toNumber(v, 3, -1, 99)), `toNumber(${v})`);
    assert.ok(Object.is(seq.toInt(v, 3, -1, 99), math.toInt(v, 3, -1, 99)), `toInt(${v})`);
  }
  assert.equal(seq.pick('b', ['a', 'b'], 'a'), 'b');
  assert.equal(seq.pick('z', ['a', 'b'], 'a'), 'a');
});

test('E041 pin: round agrees with core off the ties, and stored 3-decimal values are fixed points', () => {
  for (const v of [0, 1, 2.5, 440, 440.0004, 440.0006, -3.2, 120.125, 31.075, 1234.5678]) {
    assert.equal(seq.round(v, 3), math.round(v, 3), `round(${v}, 3)`);
  }
  for (let i = 0; i <= 300000; i += 7) {
    const v = i / 1000;
    assert.equal(seq.round(v, 3), v, `round(${v}, 3) keeps a stored value`);
  }
});

test('E041 pin: mulberry32 draws the same stream as core', () => {
  for (const s of [0, 1, 42, 20261001, 2 ** 31, 4294967295]) {
    const a = seq.mulberry32(s);
    const b = math.mulberry32(s);
    for (let i = 0; i < 8; i++) assert.equal(a(), b(), `seed ${s} draw ${i}`);
  }
});

test('E041 pin: the log mapping is core\'s, with the sequencer floor for an invalid range', () => {
  const ranges = [[20, 20000], [20, 8000], [100, 100], [0, 1000], [-5, 1000], [NaN, 1000], [20, NaN]];
  const xs = [NaN, -1, 0, 0.25, 0.5, 1, 1.5, Infinity, 440, 19, 25000];
  for (const [lo, hi] of ranges) {
    for (const x of xs) {
      assert.ok(Object.is(seq.frequencyToNormalized(x, lo, hi), freq.frequencyToNormalized(x, lo, hi)),
        `frequencyToNormalized(${x}, ${lo}, ${hi})`);
      const got = seq.normalizedToFrequency(x, lo, hi);
      const want = lo > 0 ? freq.normalizedToFrequency(x, lo, hi) : SEQ_MIN_FREQUENCY;
      assert.ok(Object.is(got, want), `normalizedToFrequency(${x}, ${lo}, ${hi}) = ${got}`);
    }
  }
});

test('E041 pin: formatMs and lfoShape give the owners\' results', () => {
  for (const v of [NaN, 0, 5, 999.4, 1000, 1500, 30000]) assert.equal(seq.formatMs(v), freq.formatMs(v));
  for (const shape of ['sine', 'triangle', 'other']) {
    for (let k = -8; k <= 24; k++) {
      const p = k / 8 + 0.03;
      assert.equal(compilerLfoShape(shape, p), patternsLfoShape(shape, p), `${shape} ${p}`);
    }
  }
});

test('E041 pin: a seeded sequence with a random block normalizes to itself', () => {
  const m = createSequence({ seed: 7, blocks: [{ type: 'random', params: {} }, { type: 'sweep', params: { startHz: 20, endHz: 8000 } }] },
    { sampleRate: 48000 });
  assert.equal(m.blocks.length, 2);
  const again = createSequence(JSON.parse(JSON.stringify(m)), { sampleRate: 48000 });
  assert.deepEqual(again, m);
});

test('E041 fix: a decimal tie rounds up in a sequencer block, as core rounds it (S079 carry-over)', () => {
  const { block } = normalizeBlock({ type: 'tone', durationMs: 16.0005, params: { freq: 32.0025 } });
  assert.equal(block.params.freq, 32.003);
  assert.equal(block.durationMs, 16.001);
  assert.equal(seq.round(8.575, 2), 8.58);
  assert.equal(seq.round(32.0055, 3), 32.006);
});

test('E041 fix: a tempo tie rounds as core rounds it', () => {
  assert.equal(setTempo(createSequence(), 32.0025).tempoBpm, 32.003);
});

test('E041: one owner, the sequencer re-exports core\'s helpers and the patterns lfoShape', () => {
  for (const name of ['clamp', 'isNum', 'toNumber', 'toInt', 'pick', 'round', 'sig', 'mulberry32']) {
    assert.equal(seq[name], math[name], `sequencer/model.js ${name} is core/math.js ${name}`);
  }
  assert.equal(seq.frequencyToNormalized, freq.frequencyToNormalized);
  assert.equal(seq.formatMs, freq.formatMs);
  assert.equal(compilerLfoShape, patternsLfoShape);
});
