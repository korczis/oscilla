// C048: the engine's own Nyquist backstops, held at both common context rates.
//   - noteOn refuses a frequency at or above safeMaximum with { ok: false, reason: 'frequency' }
//     (src/js/audio/audio-engine.js noteOn guard) and schedules nothing for it;
//   - _f clamps once more against the running context, so _osc and _carrier asked for
//     0.99 x Nyquist schedule safeMaximum on the oscillator's frequency.
// The upstream clamps (buildPlan, the Studio compiler's cap) are held elsewhere; C026 holds the
// release-clamp half of the same backstop criterion (c011-safety-limits.test.mjs) and is not
// repeated here.
//
// Expected values are literal, derived here and not read from SAFE_NYQUIST_FACTOR or the engine
// (a broken constant must not loosen its own check). safeMaximum = (rate / 2) x 0.95:
//   44.1 kHz: Nyquist 22050 Hz; 0.95 x 22050 = 20947.5 Hz; 0.99 x 22050 = 21829.5 Hz
//   48 kHz:   Nyquist 24000 Hz; 0.95 x 24000 = 22800 Hz;   0.99 x 24000 = 23760 Hz
// All four products are exact in binary floating point (checked: node prints them unrounded).
// The accepted control note sits 1 Hz below safeMaximum: 20946.5 Hz and 22799 Hz.
//   node --test tests/unit/engine-nyquist-backstops.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FREEZE_DIR = path.resolve(process.env.OSCILLA_FREEZE_DIR || path.join(here, '../freeze'));
const hasMock = fs.existsSync(path.join(FREEZE_DIR, 'extract.cjs'));
const skip = hasMock ? false : `mock AudioContext not found in ${FREEZE_DIR}`;
const require = createRequire(import.meta.url);
const { makeMockAudio } = hasMock ? require(path.join(FREEZE_DIR, 'extract.cjs')) : {};

const RATES = [
  { rate: 44100, nyquist: 22050, safeMax: 20947.5, near: 21829.5, below: 20946.5 },
  { rate: 48000, nyquist: 24000, safeMax: 22800, near: 23760, below: 22799 },
];

function engineAt(sampleRate) {
  const audio = makeMockAudio({ sampleRate });
  let seq = 0;
  const env = {
    AudioContext: audio.AudioContext,
    setTimeout: () => ++seq,
    clearTimeout: () => {},
  };
  const eng = new AudioEngine({ env });
  assert.equal(eng.init(), true, 'the engine starts on the mock context');
  assert.equal(eng.sampleRate, sampleRate, 'the context runs at the stated rate');
  return eng;
}

const oscillators = (eng) => eng.ctx._nodes.filter((n) => n.kind === 'oscillator');
const freqSets = (o) => o.frequency.events.filter((e) => e[0] === 'set').map((e) => e[1]);

for (const r of RATES) {
  const kHz = `${r.rate / 1000} kHz`;

  test(`C048 ${kHz}: safeMaximum is ${r.safeMax} Hz (0.95 x ${r.nyquist})`, { skip }, () => {
    const eng = engineAt(r.rate);
    assert.equal(eng.nyquist, r.nyquist);
    assert.equal(eng.safeMaximum, r.safeMax);
  });

  test(`C048 ${kHz}: noteOn refuses safeMaximum and above with reason 'frequency', `
    + 'and schedules no oscillator', { skip }, () => {
    for (const freq of [r.safeMax, r.near, r.nyquist, r.nyquist * 2]) {
      const eng = engineAt(r.rate);
      const res = eng.noteOn('k', { freq });
      assert.deepEqual(res, { ok: false, reason: 'frequency' }, `${freq} Hz is refused`);
      assert.equal(oscillators(eng).length, 0, `${freq} Hz creates no oscillator`);
      assert.equal(eng.noteCount, 0, `${freq} Hz holds no note`);
    }
  });

  test(`C048 ${kHz}: noteOn 1 Hz below safeMaximum (${r.below} Hz) sounds at that frequency`,
    { skip }, () => {
      const eng = engineAt(r.rate);
      const res = eng.noteOn('k', { freq: r.below });
      assert.equal(res.ok, true, 'accepted below the limit');
      const oscs = oscillators(eng);
      assert.equal(oscs.length, 1);
      assert.deepEqual(freqSets(oscs[0]), [r.below]);
    });

  test(`C048 ${kHz}: _osc at 0.99 x Nyquist (${r.near} Hz) schedules ${r.safeMax} Hz`,
    { skip }, () => {
      const eng = engineAt(r.rate);
      const o = eng._osc('sine', r.near, 0.1);
      assert.deepEqual(freqSets(o), [r.safeMax]);
      assert.equal(o.startAt, 0.1);
    });

  test(`C048 ${kHz}: _carrier at 0.99 x Nyquist (${r.near} Hz) schedules ${r.safeMax} Hz`,
    { skip }, () => {
      const eng = engineAt(r.rate);
      const o = eng._carrier({}, 'sawtooth', r.near, 0.1);
      assert.equal(o.type, 'sawtooth');
      assert.deepEqual(freqSets(o), [r.safeMax]);
    });

  test(`C048 ${kHz}: _f passes ${r.below} Hz and clamps ${r.near} Hz and Infinity`,
    { skip }, () => {
      const eng = engineAt(r.rate);
      assert.equal(eng._f(r.below), r.below);
      assert.equal(eng._f(r.near), r.safeMax);
      assert.equal(eng._f(Infinity), r.safeMax);
    });
}
