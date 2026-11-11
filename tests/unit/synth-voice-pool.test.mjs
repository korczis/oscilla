// K122 (proposed), K180: the Synth engines' voice pool. The voice count and the gain per voice are
// the owner's recorded answer to Q021 (2026-11-03: up to 8 voices at 1/8 gain each), read from
// the plan record by owner-answer.mjs and never retyped; a ninth note steals the voice released
// first, else the oldest; the same note retriggers its own voice; every loop is one pass over the
// slots (#261's R-2); the Web Audio host releases with cancelAndHoldAtTime, stops its sources and
// leaves no node once they have ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VOICES, createVoicePool } from '../../src/js/synth/voice-pool.js';
import { STEAL_RELEASE_S, VOICE_LEVEL_MAX, voicePeak } from '../../src/js/studio/adapters/voices.js';
import { engineVoices } from './owner-answer.mjs';
import { engineEnv } from './engine-fixture.mjs';

const Q021 = engineVoices();
const N = Q021.voices;

test('Q021 as recorded: 8 voices at 1/8 gain, and the pool holds exactly that many', () => {
  assert.equal(N, 8, Q021.result);
  assert.equal(Q021.gain, 1 / 8);
  assert.equal(MAX_VOICES, N, 'MAX_VOICES is the owner\'s recorded voice count');
  assert.equal(createVoicePool().max, N, 'the default pool is that size');
  assert.throws(() => engineVoices('evidence:\n  - covers: owner_decision\n    result: "Mono"\n'),
    /names no voice count/, 'an answer without a count is refused, not defaulted');
});

test('the pool holds N voices; the next note steals the oldest held voice', () => {
  const pool = createVoicePool();
  const slots = Array.from({ length: N }, (_, i) => pool.on(60 + i, i * 0.01).slot);
  assert.equal(new Set(slots).size, N);
  assert.equal(pool.active(1), N);
  const s = pool.on(90, 1);
  assert.equal(s.steal, slots[0], 'the oldest held voice');
  assert.equal(pool.active(1), N);
  assert.ok(!pool.held().includes(60));
});

test('a released voice is stolen before a held one; the same note retriggers its own voice', () => {
  const pool = createVoicePool();
  for (let i = 0; i < N; i++) pool.on(60 + i, i);
  const rel = pool.off(65, 20);
  pool.end(rel, 25);
  assert.equal(pool.on(91, 21).steal, rel, 'the released voice first');
  const again = pool.on(63, 22);
  assert.equal(again.retrigger, true);
  assert.equal(again.steal, null);
  assert.equal(pool.active(22), N);
  assert.equal(pool.on(62, 22).retrigger, true);
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

test('the host: N voices sound, the next steals with a fast release, stop leaves no node', () => {
  const { ctx, h, nodes, sources } = engineEnv('additive-voice');
  const base = nodes.size;
  for (let i = 0; i < N; i++) h.noteOn(0.1, 48 + i, 100);
  assert.equal(h.info.voices(0.1), N);
  const out = h.outputs.audio;
  const firstAmp = ctx.of('gain').find((g) => g.outputs.includes(out));
  assert.ok(firstAmp, 'the first voice amplifier feeds the output');
  h.noteOn(0.2, 90, 100);
  assert.equal(h.info.voices(0.2), N);
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

test('voice peak: 1/8 of full scale at Level 4 and full velocity (Q021); N of them sum to it', () => {
  assert.equal(VOICE_LEVEL_MAX, 4);
  assert.equal(voicePeak(4, 127), Q021.gain, 'each engine voice at 1/8 gain');
  assert.equal(voicePeak(2, 127), Q021.gain / 2);
  assert.ok(Math.abs(voicePeak(4, 127 / 2) - (127 / 2 / 127) ** 2 * Q021.gain) < 0.002);
  assert.equal(voicePeak(0, 127), 0);
  assert.equal(voicePeak(9, 127), Q021.gain, 'a Level above 4 is held at 4');
  assert.ok(Math.abs(N * voicePeak(4, 127) - 1) < 1e-12, 'N voices at 1/N sum to full scale');
});

test('E071: notes at one time are stolen in the order they arrived, not by slot index', () => {
  // WebKit's coarse currentTime gives notes played in one burst the same `t`. A released voice
  // whose release has not ended keeps its slot, so the burst's last note takes the lowest slot
  // (the released one) and the burst's first note a higher one. With equal times the oldest is
  // the one that arrived first, wherever it sits.
  const p = createVoicePool({ max: 3 });
  p.on(60, 0);
  p.off(60, 0.1);
  p.end(0, 0.5); // the release is still sounding at 0.3
  assert.equal(p.on(84, 0.3).slot, 1, 'the first note of the burst: slot 0 still sounds');
  assert.equal(p.on(36, 0.3).slot, 2);
  assert.deepEqual(p.on(37, 0.3), { slot: 0, steal: 0, retrigger: false },
    'the released voice is stolen first');
  assert.deepEqual(p.on(79, 0.3), { slot: 1, steal: 1, retrigger: false },
    'then the note that arrived first (84 in slot 1), not the lowest slot (37 in slot 0)');
  // Released voices at one time go in the order they were released.
  const q = createVoicePool({ max: 2 });
  q.on(50, 0);
  q.on(51, 0);
  q.off(51, 1);
  q.off(50, 1);
  assert.equal(q.on(52, 1).steal, 1, 'the voice released first (51) is stolen first');
  // A schedule time that steps back (the engine's estimate, WebKit) makes no note older.
  const r = createVoicePool({ max: 2 });
  r.on(84, 0.4644);
  r.on(36, 0.4470);
  assert.equal(r.on(79, 0.4700).steal, 0, 'the note that arrived first (84) is the oldest');
});

test('R2-E071-1: an off the timeline scheduled ahead holds the voice until its time', () => {
  // note-player.js strike() calls noteOn(x.time) and noteOff(x.end) together at schedule time,
  // so the call order is the strike order, not the order the voices release in audio time.
  const p = createVoicePool({ max: 2 });
  p.on(60, 0); // A: held until 4 s
  p.off(60, 4);
  p.end(0, 4.5);
  p.on(62, 0.1); // B: released at 0.2 s
  p.off(62, 0.2);
  p.end(1, 0.7);
  assert.deepEqual(p.on(64, 0.3), { slot: 1, steal: 1, retrigger: false },
    'C steals B, which is releasing, never A, which is still held');
  // Two releases due by t: the earlier release time goes first, whatever the call order.
  const q = createVoicePool({ max: 2 });
  q.on(50, 0);
  q.off(50, 0.5);
  q.on(51, 0.1);
  q.off(51, 0.2);
  assert.equal(q.on(52, 1).steal, 1, 'the voice whose release came first (51 at 0.2 s)');
});
