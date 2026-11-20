// Offline rendering's tone and sweep builders (src/js/audio/offline-renderer.js render,
// renderToWav, toneBuilder, sweepBuilder, renderTone, renderSweep, bufferStats, fitEnvelope): on
// a fake OfflineAudioContext, render builds the master gain into the destination and a context of
// the asked channels, length and rate (the older positional constructor too); a tone sets its
// frequency at 0 and a sweep ramps exponentially (log) or linearly to its end over the whole
// duration; an additive table replaces the waveform and a silent one is refused; a filter is
// inserted only when enabled; the envelope is fitted into the note; a frequency at or above
// 0.95 x Nyquist is refused, never clamped; no OfflineAudioContext is an error.
//   node --test tests/unit/offline-renderer-builders.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bufferStats, fitEnvelope, render, renderSweep, renderTone, renderToWav, sweepBuilder,
  toneBuilder,
} from '../../src/js/audio/offline-renderer.js';
import { fakeOfflineCtor } from './sequencer-fake-audio.mjs';

const kinds = (ctx) => ctx.created.map((n) => n.kind);
const osc = (ctx) => ctx.created.find((n) => n.kind === 'oscillator');
const callNames = (param) => param.calls.map((c) => c[0]);

test('render builds a context of the asked size and a master gain into the destination',
  async () => {
    const made = [];
    let seen = null;
    const buf = await render((ctx, master, info) => { seen = { ctx, master, info }; }, {
      duration: 0.5, sampleRate: 44100, channels: 1, masterGain: 0.25,
      OfflineAudioContext: fakeOfflineCtor(made) });
    assert.equal(made.length, 1);
    assert.equal(made[0].numberOfChannels, 1);
    assert.equal(made[0].length, Math.ceil(0.5 * 44100));
    assert.equal(seen.master.gain.value, 0.25);
    assert.deepEqual(seen.master.outputs, [made[0].destination]);
    assert.deepEqual(seen.info, { duration: 0.5, sampleRate: 44100 });
    assert.equal(buf.length, made[0].length);
    // masterGain defaults to unity.
    await render((ctx, master) => { assert.equal(master.gain.value, 1); }, {
      duration: 0.1, OfflineAudioContext: fakeOfflineCtor([]) });
  });

test('render falls back to the positional constructor and needs an OfflineAudioContext',
  async () => {
    const made = [];
    const Modern = fakeOfflineCtor(made);
    class Positional extends Modern {
      constructor(a, b, c) {
        if (typeof a === 'object') throw new TypeError('old browser');
        super({ numberOfChannels: a, length: b, sampleRate: c });
      }
    }
    await render(() => {}, { duration: 0.2, sampleRate: 48000, OfflineAudioContext: Positional });
    assert.equal(made.at(-1).length, Math.ceil(0.2 * 48000));
    assert.equal(made.at(-1).numberOfChannels, 2);
    const saved = globalThis.OfflineAudioContext;
    delete globalThis.OfflineAudioContext;
    try {
      await assert.rejects(render(() => {}, { duration: 0.1 }),
        { message: 'OfflineAudioContext is not available in this browser' });
    } finally {
      if (saved) globalThis.OfflineAudioContext = saved;
    }
  });

test('a tone sets its frequency at 0, plays the waveform for the duration, fitted envelope',
  async () => {
    const made = [];
    await renderTone({ frequency: 1000, duration: 0.2, waveform: 'square', gain: 0.3,
      envelope: { a: 0.1, d: 0.1, s: 0.5, r: 0.1 }, OfflineAudioContext: fakeOfflineCtor(made) });
    const ctx = made[0];
    const o = osc(ctx);
    assert.equal(o.type, 'square');
    assert.deepEqual(o.frequency.calls[0], ['setValueAtTime', 1000, 0]);
    assert.equal(o.startAt, 0);
    assert.equal(o.stopAt, 0.2);
    const gains = ctx.created.filter((n) => n.kind === 'gain');
    assert.ok(gains.some((g) => g.gain.value === 0.3), 'the level gain');
    assert.equal(kinds(ctx).includes('biquad'), false, 'no filter unless asked');
    // The envelope (0.3 s of a + d + r) is scaled into 90 % of the 0.2 s note.
    const fit = fitEnvelope({ a: 0.1, d: 0.1, s: 0.5, r: 0.1 }, 0.2);
    assert.ok(Math.abs(fit.adsr.a + fit.adsr.d + fit.adsr.r - 0.18) < 1e-9);
    assert.ok(Math.abs(fit.releaseStart - (0.2 - fit.adsr.r)) < 1e-12);
    // A negative gain is silence, not an inverted signal; no gain is the default 0.5.
    const neg = [];
    await renderTone({ frequency: 440, duration: 0.1, gain: -2,
      OfflineAudioContext: fakeOfflineCtor(neg) });
    assert.ok(neg[0].created.some((n) => n.kind === 'gain' && n.gain.value === 0));
    const def = [];
    await renderTone({ frequency: 440, duration: 0.1, OfflineAudioContext: fakeOfflineCtor(def) });
    assert.equal(osc(def[0]).type, 'sine');
    assert.ok(def[0].created.some((n) => n.kind === 'gain' && n.gain.value === 0.5));
  });

test('a tone with an enabled filter routes through it; a disabled filter is left out', async () => {
  const on = [];
  await renderTone({ frequency: 440, duration: 0.1, filter: { type: 'lowpass', frequency: 800 },
    OfflineAudioContext: fakeOfflineCtor(on) });
  assert.ok(kinds(on[0]).includes('biquad'));
  const off = [];
  await renderTone({ frequency: 440, duration: 0.1, filter: { type: 'lowpass', enabled: false },
    OfflineAudioContext: fakeOfflineCtor(off) });
  assert.equal(kinds(off[0]).includes('biquad'), false);
});

test('an additive table replaces the waveform; a silent table is refused', async () => {
  const made = [];
  await renderTone({ frequency: 220, duration: 0.1, waveform: 'square',
    partials: [{ n: 1, gain: 1, phase: 0 }, { n: 3, gain: 0.3, phase: 0 }],
    OfflineAudioContext: fakeOfflineCtor(made) });
  const o = osc(made[0]);
  assert.ok(o.wave, 'a PeriodicWave is set');
  assert.equal(o.type, 'sine', 'the waveform field is not applied');
  await assert.rejects(renderTone({ frequency: 220, duration: 0.1,
    partials: [{ n: 1, gain: 0, phase: 0 }],
    OfflineAudioContext: fakeOfflineCtor([]) }), { name: 'RangeError',
    message: 'The additive table is silent' });
});

test('a sweep ramps from start to end over the whole duration: log by default, or linear',
  async () => {
    const log = [];
    await renderSweep({ startHz: 100, endHz: 1000, duration: 0.5,
      OfflineAudioContext: fakeOfflineCtor(log) });
    assert.deepEqual(osc(log[0]).frequency.calls.slice(0, 2), [['setValueAtTime', 100, 0],
      ['exponentialRampToValueAtTime', 1000, 0.5]]);
    const lin = [];
    await renderSweep({ startHz: 100, endHz: 1000, duration: 0.5, curve: 'linear',
      OfflineAudioContext: fakeOfflineCtor(lin) });
    assert.deepEqual(callNames(osc(lin[0]).frequency).slice(0, 2),
      ['setValueAtTime', 'linearRampToValueAtTime']);
  });

test('a frequency at or above 0.95 x Nyquist of the render rate is refused, never clamped',
  async () => {
    // 0.95 x 24 kHz = 22 800 Hz at 48 kHz.
    await assert.rejects(renderTone({ frequency: 22800, duration: 0.1, sampleRate: 48000,
      OfflineAudioContext: fakeOfflineCtor([]) }), { name: 'RangeError',
      message: /^Frequency 22800 Hz is at or above the safe maximum/ });
    await renderTone({ frequency: 22799, duration: 0.1, sampleRate: 48000,
      OfflineAudioContext: fakeOfflineCtor([]) });
    await assert.rejects(renderSweep({ startHz: 20, endHz: 30000, duration: 0.1,
      OfflineAudioContext: fakeOfflineCtor([]) }), { message: /^End frequency 30000 Hz/ });
    await assert.rejects(renderSweep({ startHz: 0, endHz: 300, duration: 0.1,
      OfflineAudioContext: fakeOfflineCtor([]) }), { message: 'Start frequency must be positive' });
    // The builders check against the rate render passes them.
    const build = toneBuilder({ frequency: 5000 });
    assert.throws(() => build(null, null, { duration: 1, sampleRate: 8000 }), RangeError);
    assert.throws(() => sweepBuilder({ startHz: 100, endHz: 4000 })(null, null,
      { duration: 1, sampleRate: 8000 }), { message: /^End frequency 4000 Hz/ });
  });

test('renderToWav renders, encodes a WAV and measures the buffer', async () => {
  const r = await renderToWav((ctx, master) => master, { duration: 0.05, channels: 1,
    OfflineAudioContext: fakeOfflineCtor([]) }, { bitDepth: 16 });
  assert.ok(r.wav instanceof ArrayBuffer);
  const head = new Uint8Array(r.wav, 0, 4);
  assert.equal(String.fromCharCode(...head), 'RIFF');
  assert.deepEqual(r.stats, bufferStats(r.buffer));
  assert.equal(r.stats.peak, 0);
  assert.equal(r.stats.peakDbfs, -Infinity);
});
