// K122 (proposed): the Synth engines' voice pool. 16 voices (Q021); a 17th note steals the voice
// released first, else the oldest; the same note retriggers its own voice; every loop is one
// pass over the slots (#261's R-2); the Web Audio host releases with cancelAndHoldAtTime, stops
// its sources and leaves no node once they have ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VOICES, createVoicePool } from '../../src/js/synth/voice-pool.js';
import { STEAL_RELEASE_S, voicePeak } from '../../src/js/studio/adapters/voices.js';
import { engineEnv } from './engine-fixture.mjs';

test('16 voices; a 17th steals the oldest held voice', () => {
  assert.equal(MAX_VOICES, 16);
  const pool = createVoicePool();
  const slots = Array.from({ length: 16 }, (_, i) => pool.on(60 + i, i * 0.01).slot);
  assert.equal(new Set(slots).size, 16);
  assert.equal(pool.active(1), 16);
  const s = pool.on(90, 1);
  assert.equal(s.steal, slots[0], 'the oldest held voice');
  assert.equal(pool.active(1), 16);
  assert.ok(!pool.held().includes(60));
});

test('a released voice is stolen before a held one; the same note retriggers its own voice', () => {
  const pool = createVoicePool();
  for (let i = 0; i < 16; i++) pool.on(60 + i, i);
  const rel = pool.off(70, 20);
  pool.end(rel, 25);
  assert.equal(pool.on(91, 21).steal, rel, 'the released voice first');
  const again = pool.on(65, 22);
  assert.equal(again.retrigger, true);
  assert.equal(again.steal, null);
  assert.equal(pool.active(22), 16);
  assert.equal(pool.on(64, 22).retrigger, true);
});

test('the allocator is bounded: 1000 notes leave at most max voices and every call returns', () => {
  const pool = createVoicePool({ max: 4 });
  for (let i = 0; i < 1000; i++) {
    const r = pool.on(i % 128, i);
    assert.ok(r.slot >= 0 && r.slot < 4);
    if (i % 3 === 0) pool.off(i % 128, i);
  }
  assert.ok(pool.active(1000) <= 4);
  pool.allOff(1000);
  assert.deepEqual(pool.held(), []);
});

test('the host: 16 voices sound, a 17th steals with a fast release, stop leaves no node', () => {
  const { ctx, h, nodes, sources } = engineEnv('additive-voice');
  const base = nodes.size;
  for (let i = 0; i < 16; i++) h.noteOn(0.1, 48 + i, 100);
  assert.equal(h.info.voices(0.1), 16);
  const out = h.outputs.audio;
  const firstAmp = ctx.of('gain').find((g) => g.outputs.includes(out));
  assert.ok(firstAmp, 'the first voice amplifier feeds the output');
  h.noteOn(0.2, 90, 100);
  assert.equal(h.info.voices(0.2), 16);
  assert.ok(firstAmp.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime' && c[1] === 0.2),
    'the stolen voice holds its value and releases');
  const end = firstAmp.gain.calls.filter((c) => c[0] === 'exponentialRampToValueAtTime').at(-1);
  assert.ok(Math.abs(end[2] - (0.2 + STEAL_RELEASE_S)) < 1e-9, 'released in STEAL_RELEASE_S');
  h.allOff(0.3, true);
  ctx.advance(5);
  assert.equal(sources.size, 0, 'every voice source ended');
  assert.equal(nodes.size, base, 'only the engine output remains');
  assert.equal(h.info.voices(5), 0);
});

test('a note off releases with the Release time through cancelAndHoldAtTime', () => {
  const { ctx, h } = engineEnv('fm-voice', { release: 0.5 });
  h.noteOn(0.1, 69, 127);
  const amp = ctx.of('gain').find((g) => g.outputs.includes(h.outputs.audio));
  assert.equal(h.noteOff(0.4, 69), true);
  assert.ok(amp.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime' && c[1] === 0.4));
  const last = amp.gain.calls.at(-1);
  assert.equal(last[0], 'exponentialRampToValueAtTime');
  assert.ok(Math.abs(last[2] - 0.9) < 1e-9);
  assert.equal(h.noteOff(0.5, 69), false, 'a released note is not released twice');
});

test('voice peak: Level / 64 times the velocity law; 16 at Level 4 sum to full scale', () => {
  assert.equal(voicePeak(4, 127), 1 / 16);
  assert.equal(voicePeak(2, 127), 1 / 32);
  assert.ok(Math.abs(voicePeak(4, 127 / 2) - (127 / 2 / 127) ** 2 / 16) < 0.002);
  assert.equal(voicePeak(0, 127), 0);
  assert.equal(voicePeak(9, 127), 1 / 16, 'a Level above 4 is held at 4');
});
