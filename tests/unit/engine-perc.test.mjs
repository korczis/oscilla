// K123 (proposed, from K071's recipes): the percussion engine. Every pitch class plays a voice;
// each layer decays exponentially to −60 dB rel at its stated decay (τ = decay / ln 1000); a
// closed hat chokes a sounding open hat when Hat choke is on; the tone knob never silences a
// voice of one kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECAY_TAU_PER_S, PERC_KEYMAP, PERC_VOICES, layerLevel, percDecays, percNote,
} from '../../src/js/synth/perc-recipes.js';
import { CHOKE_RELEASE_S } from '../../src/js/studio/adapters/voices.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { engineEnv } from './engine-fixture.mjs';

test('every pitch class plays a voice; the octave tunes by 12 st', () => {
  assert.equal(PERC_KEYMAP.length, 12);
  for (const id of PERC_KEYMAP) assert.ok(PERC_VOICES[id], id);
  assert.equal(percNote(60).voice.id, 'kick');
  assert.equal(percNote(60).octaveSt, 0);
  assert.equal(percNote(48).octaveSt, -12);
  assert.equal(percNote(70).voice.id, 'hatOpen');
  assert.equal(percNote(66).voice.id, 'hatClosed');
});

test('decay: τ = decay / ln 1000, so the level is −60 dB at the stated decay', () => {
  assert.ok(Math.abs(20 * Math.log10(Math.exp(-1 / DECAY_TAU_PER_S)) + 60) < 1e-9);
  const { ctx, h } = engineEnv('perc-voice', { decay: 2 });
  const r = h.noteOn(0.1, 60, 127); // kick
  assert.ok(r.slot >= 0);
  const envs = ctx.of('gain').filter((g) => g.gain.calls.some((c) => c[0] === 'setTargetAtTime'));
  const kick = PERC_VOICES.kick.layers[0];
  const tone = envs.find((g) => g.gain.calls.some((c) => c[0] === 'setTargetAtTime'
    && Math.abs(c[3] - kick.decayS * 2 * DECAY_TAU_PER_S) < 1e-12));
  assert.ok(tone, 'the tone layer decays with τ = 2 × 0.5 s / ln 1000');
  const kickDecay = percDecays(2).find((d) => d.id === 'kick').decayS;
  assert.equal(kickDecay, 1);
  assert.match(NODE_REGISTRY.get('perc-voice').facts({ decay: 2 }), /Kick 1 s/);
  ctx.advance(0.1 + kickDecay + 0.05);
  assert.equal(h.info.voices(ctx.currentTime), 0, 'the hit has ended');
});

test('a closed hat chokes a sounding open hat; with Hat choke off it does not', () => {
  for (const choke of [true, false]) {
    const { ctx, h } = engineEnv('perc-voice', { choke });
    h.noteOn(0.1, 70, 100); // open hat
    const openAmp = ctx.of('gain').find((g) => g.outputs.includes(h.outputs.audio));
    h.noteOn(0.2, 66, 100); // closed hat
    const held = openAmp.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime' && c[1] === 0.2);
    assert.equal(held, choke, `choke ${choke}`);
    if (choke) {
      const end = openAmp.gain.calls.at(-1);
      assert.ok(end[2] - 0.2 <= CHOKE_RELEASE_S + 1e-9, 'released within the choke time');
    }
  }
});

test('the tone knob balances voices that mix tone and noise, and never silences one kind', () => {
  const snareNoise = PERC_VOICES.snare.layers.find((l) => l.noise);
  assert.equal(layerLevel(PERC_VOICES.snare, snareNoise, 1), 0);
  assert.equal(layerLevel(PERC_VOICES.snare, snareNoise, 0.5), snareNoise.level);
  const clap = PERC_VOICES.clap.layers[0];
  assert.equal(layerLevel(PERC_VOICES.clap, clap, 1), clap.level);
  const hat = PERC_VOICES.hatOpen.layers[0];
  assert.equal(layerLevel(PERC_VOICES.hatOpen, hat, 0), hat.level);
});
