// K072: the clap, the toms and the FM blip of the percussion engine (perc-voice), on the fake Web
// Audio context (tests/unit/sequencer-fake-audio.mjs via engine-fixture.mjs): the scheduled
// calls, times and ramps.
//   - the clap: three bursts at their stated onsets (0, 11 and 22 ms), its decay from the last
//   - the toms: each sweeps to its tuning (100, 145, 205 Hz), moved by its own Tune
//   - the FM blip on pitch class 11 (B): a sine carrier at 1000 Hz swung by a sine at 350 Hz
//     with a peak deviation of 1 x 350 Hz (index 1)
//   - negative: a tom tuned above 0.95 x Nyquist plays at the limit, never above it; an FM blip
//     whose band would pass it sounds nothing and takes no voice
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineEnv } from './engine-fixture.mjs';
import { PERC_KEYMAP, PERC_VOICES, percNote } from '../../src/js/synth/perc-recipes.js';

const CLAP = 61;
const TOMS = [['tomLow', 64], ['tomMid', 65], ['tomHigh', 67]];
const BLIP = 71;

function built(ctx, fn) {
  const n = ctx.created.length;
  fn();
  return ctx.created.slice(n);
}
const hzEvents = (o) => o.frequency.calls.filter((c) => c[0] !== 'cancelAndHoldAtTime');

test('the clap: three bursts at 0, 11 and 22 ms, its decay from the last one', () => {
  const { ctx, h } = engineEnv('perc-voice');
  const nodes = built(ctx, () => h.noteOn(0.1, CLAP, 100));
  const env = nodes.find((g) => g.kind === 'gain' && g.gain.calls.some((c) => c[0]
    === 'setTargetAtTime'));
  const level = env.gain.calls.find((c) => c[0] === 'setTargetAtTime');
  const ons = env.gain.calls.filter((c) => c[0] === 'setValueAtTime' && c[1] > 0.001)
    .map((c) => +(c[2] - 0.1).toFixed(6));
  assert.deepEqual([...new Set(ons)], [0, 0.011, 0.022]);
  assert.equal(+(level[2] - 0.1).toFixed(6), 0.022, 'the decay starts at the last burst');
  const offs = env.gain.calls.filter((c) => c[0] === 'setValueAtTime' && c[1] === 0.0001)
    .map((c) => +(c[2] - 0.1).toFixed(6));
  assert.deepEqual(offs, [0.008, 0.019], 'the first two gate off after 8 ms');
});

test('each tom sweeps to its tuning, and its own Tune moves it', () => {
  for (const [id, note] of TOMS) {
    const layer = PERC_VOICES[id].layers[0];
    for (const tune of [0, 7]) {
      const { ctx, h } = engineEnv('perc-voice', { [`${id}Tune`]: tune });
      const [o] = built(ctx, () => h.noteOn(0.1, note, 100)).filter((x) => x.kind
        === 'oscillator');
      const ramp = hzEvents(o).find((c) => c[0] === 'exponentialRampToValueAtTime');
      const want = layer.toHz * 2 ** (tune / 12);
      assert.ok(Math.abs(ramp[1] - want) / want < 1e-9, `${id} at ${tune} st: ${ramp[1]} Hz`);
      assert.ok(Math.abs(ramp[2] - (0.1 + layer.sweepS)) < 1e-9, 'at its sweep time');
    }
  }
});

test('the FM blip on B: a 1000 Hz carrier swung by 350 Hz at index 1', () => {
  assert.equal(PERC_KEYMAP[11], 'blip');
  assert.equal(percNote(BLIP).voice.id, 'blip');
  const { ctx, h } = engineEnv('perc-voice');
  const nodes = built(ctx, () => h.noteOn(0.1, BLIP, 100));
  const oscs = nodes.filter((x) => x.kind === 'oscillator');
  assert.equal(oscs.length, 2, 'a carrier and a modulator');
  const [c, m] = oscs;
  assert.deepEqual([c.type, m.type], ['sine', 'sine']);
  assert.equal(hzEvents(c)[0][1], 1000);
  assert.equal(hzEvents(m)[0][1], 350);
  const dev = nodes.find((g) => g.kind === 'gain' && g.outputs.includes(c.frequency));
  assert.ok(dev && m.outputs.includes(dev), 'the modulator drives the carrier frequency');
  assert.equal(dev.gain.value, 350, 'peak deviation = index 1 x 350 Hz');
});

test('negative: a tom tuned above 0.95 x Nyquist plays at the limit, never above it', () => {
  const sampleRate = 48000;
  const limit = 0.95 * (sampleRate / 2);
  const { ctx, h } = engineEnv('perc-voice', { tune: 24, tomHighTune: 24 }, { sampleRate });
  const oscs = built(ctx, () => h.noteOn(0.1, 127, 100)).filter((x) => x.kind === 'oscillator');
  assert.ok(PERC_VOICES[percNote(127).voice.id].layers[0].hz * 2 ** ((48 + 60) / 12) > limit);
  assert.ok(oscs.length > 0, 'it sounds');
  for (const o of oscs) {
    for (const c of hzEvents(o)) assert.ok(c[1] <= limit + 1e-9, `${c[0]} ${c[1]} Hz`);
  }
});

test('negative: an FM blip whose band would pass 0.95 x Nyquist sounds nothing', () => {
  const { ctx, h, sources } = engineEnv('perc-voice', { tune: 24, blipTune: 24 });
  const r = h.noteOn(0.1, 119, 100); // B8 + 48 st: the carrier alone is far above the limit
  assert.equal(r.slot, null, 'no voice');
  assert.equal(sources.size, 0, 'no source');
  assert.equal(ctx.of('oscillator').length, 0, 'no oscillator built');
});
