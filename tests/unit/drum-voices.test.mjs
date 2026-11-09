// K071: the drum voices of the percussion engine (perc-voice, studio/adapters/engines.js) on
// the fake Web Audio context (tests/unit/sequencer-fake-audio.mjs via engine-fixture.mjs): the
// scheduled calls, times and ramps, and the node census.
//   - negative: a hit at velocity 0 sounds nothing: no source starts, no voice is taken and
//     none is stolen
//   - negative: a choke releases only the voices of its group that sound at the hit; an open hat
//     scheduled after the closed one (a clip's look-ahead, a pad struck between) is left whole,
//     and one that has already ended is not touched
//   - every voice has its own decay, tune, level and choke group (perc-voice params, hash epoch
//     3), at defaults that play what the kit played; each acts on its voice only
//   - choke groups 1-4: a hit releases the sounding voices of its own group, never another
//     group's, never with group 0, never with Hat choke off
//   - velocity law (midi/notes.js): a voice's peak at velocity 64 is (64/127)^2 of velocity 127
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineEnv } from './engine-fixture.mjs';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { DECAY_TAU_PER_S, PERC_VOICES } from '../../src/js/synth/perc-recipes.js';

const OPEN = 70; // perc-recipes.js PERC_KEYMAP: A#4 open hat
const CLOSED = 66; // F#4 closed hat
const KICK = 60;
const SNARE = 62;
const CLAP = 61;

/** The nodes one hit builds: everything the context created during `fn`. */
function built(ctx, fn) {
  const n = ctx.created.length;
  fn();
  return ctx.created.slice(n);
}
const taus = (nodes) => nodes.filter((x) => x.kind === 'gain').flatMap((g) => g.gain.calls
  .filter((c) => c[0] === 'setTargetAtTime').map((c) => c[3]));
const firstHz = (nodes) => nodes.filter((x) => x.kind === 'oscillator')
  .map((o) => o.frequency.calls.find((c) => c[0] === 'setValueAtTime')[1]);
/** The level each layer's envelope starts its decay from. */
const levels = (nodes) => nodes.filter((x) => x.kind === 'gain').flatMap((g) => {
  const i = g.gain.calls.findIndex((c) => c[0] === 'setTargetAtTime');
  return i > 0 ? [g.gain.calls[i - 1][1]] : [];
});

/** The voice amp (the gain into the engine's output) created by the latest hit. */
const ampOf = (ctx, h) => ctx.of('gain').filter((g) => g.outputs.includes(h.outputs.audio)).at(-1);
const cutAt = (amp, t) => amp.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime'
  && Math.abs(c[1] - t) < 1e-9);

test('negative: a hit at velocity 0 sounds nothing and takes no voice', () => {
  const { ctx, h, sources, nodes } = engineEnv('perc-voice');
  const before = { sources: sources.size, nodes: nodes.size, oscs: ctx.of('oscillator').length };
  const r = h.noteOn(0.1, KICK, 0);
  assert.equal(r.slot, null, 'no voice');
  assert.equal(r.stolen, false, 'none stolen');
  assert.equal(h.info.voices(0.1), 0, 'the pool is empty');
  assert.deepEqual(h.info.hits(), [], 'no hit recorded');
  assert.equal(sources.size, before.sources, 'no source in the census');
  assert.equal(nodes.size, before.nodes, 'no node left in the census');
  assert.equal(ctx.of('oscillator').length, before.oscs, 'no oscillator built');
  // The kit still plays the next hit at a real velocity.
  assert.ok(h.noteOn(0.2, KICK, 100).slot != null);
});

test('negative: a choke leaves an open hat that starts after it whole', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.5, OPEN, 100); // scheduled ahead: starts at 0.5
  const open = ampOf(ctx, h);
  h.noteOn(0.2, CLOSED, 100); // struck before the open hat sounds
  assert.ok(!cutAt(open, 0.2), 'the open hat is not cut before it starts');
  assert.ok(!open.gain.calls.some((c) => c[0] === 'cancelAndHoldAtTime'), 'nor cut at all');
  const hit = h.info.hits().find((x) => x.note === OPEN);
  assert.equal(hit.released, null, 'the open hat is not released');
  assert.ok(hit.end > 0.5 + 0.4, `it rings its stated decay, ends at ${hit.end}`);
});

test('negative: a choke does not touch an open hat that has already ended', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.1, OPEN, 100);
  const open = ampOf(ctx, h);
  const end = h.info.hits().find((x) => x.note === OPEN).end;
  const calls = open.gain.calls.length;
  h.noteOn(end + 0.5, CLOSED, 100);
  // (The closed hat may take the ended hat's freed slot; that schedules nothing either.)
  assert.equal(open.gain.calls.length, calls, 'no automation on the ended voice');
});

test('a choke releases a sounding open hat at the closed hat\'s onset', () => {
  const { ctx, h } = engineEnv('perc-voice');
  h.noteOn(0.1, OPEN, 100);
  const open = ampOf(ctx, h);
  h.noteOn(0.2, CLOSED, 100);
  assert.ok(cutAt(open, 0.2), 'cut at 0.2');
  assert.equal(h.info.hits().find((x) => x.note === OPEN).released, 0.2);
});

// ---------------------------------------------------------------- per-voice parameters

test('every voice has its own decay, tune, level and choke group, at defaults that change nothing',
  () => {
    const def = NODE_REGISTRY.get('perc-voice');
    for (const v of Object.values(PERC_VOICES)) {
      for (const [suffix, d] of [['Decay', 1], ['Tune', 0], ['Level', 1], ['Choke', v.choke]]) {
        const prm = def.params.find((x) => x.key === `${v.id}${suffix}`);
        assert.ok(prm, `${v.id}${suffix} is a parameter`);
        assert.equal(prm.default, d, `${v.id}${suffix} defaults to ${d}`);
        assert.match(prm.label, new RegExp(`^${v.cs}: `), 'named in Czech after its voice');
      }
    }
    assert.deepEqual(Object.values(PERC_VOICES).filter((v) => v.choke).map((v) => v.id),
      ['hatClosed', 'hatOpen'], 'only the hats share a group by default (group 1)');
  });

test('a voice\'s decay, tune and level act on that voice only', () => {
  const kick = PERC_VOICES.kick.layers[0];
  const base = engineEnv('perc-voice');
  const k0 = built(base.ctx, () => base.h.noteOn(0.1, KICK, 127));
  const s0 = built(base.ctx, () => base.h.noteOn(0.1, SNARE, 127));
  const own = engineEnv('perc-voice', { kickDecay: 2, kickTune: 12, kickLevel: 0.5 });
  const k1 = built(own.ctx, () => own.h.noteOn(0.1, KICK, 127));
  const s1 = built(own.ctx, () => own.h.noteOn(0.1, SNARE, 127));
  assert.ok(taus(k1).some((t) => Math.abs(t - kick.decayS * 2 * DECAY_TAU_PER_S) < 1e-12),
    'the kick decays twice as long');
  assert.ok(firstHz(k1).some((f) => Math.abs(f - kick.hz * 2) < 1e-9), 'an octave up');
  assert.deepEqual(levels(k1), levels(k0).map((l) => l * 0.5), 'at half its level');
  assert.deepEqual(taus(s1), taus(s0), 'the snare decays as before');
  assert.deepEqual(firstHz(s1), firstHz(s0), 'at its pitch');
  assert.deepEqual(levels(s1), levels(s0), 'at its level');
});

// ---------------------------------------------------------------- choke groups

/** Whether the voice struck at 0.1 (note `a`) is cut when note `b` is struck at 0.2. */
function chokes(params, a, b) {
  const { ctx, h } = engineEnv('perc-voice', params);
  h.noteOn(0.1, a, 100);
  const amp = ampOf(ctx, h);
  h.noteOn(0.2, b, 100);
  return cutAt(amp, 0.2);
}

test('a choke group releases the sounding voices of its own group only', () => {
  assert.equal(chokes({}, SNARE, CLAP), false, 'group 0 never chokes');
  assert.equal(chokes({ snareChoke: 2, clapChoke: 2 }, SNARE, CLAP), true, 'clap cuts snare in 2');
  assert.equal(chokes({ snareChoke: 2, clapChoke: 3 }, SNARE, CLAP), false, 'another group');
  assert.equal(chokes({ snareChoke: 1 }, SNARE, CLOSED), true, 'a closed hat cuts group 1');
  assert.equal(chokes({ snareChoke: 2, clapChoke: 2, choke: false }, SNARE, CLAP), false,
    'Hat choke off turns every group off');
  assert.equal(chokes({ hatOpenChoke: 0 }, OPEN, CLOSED), false, 'an open hat out of group 1');
  assert.equal(chokes({}, OPEN, CLOSED), true, 'the default: a closed hat cuts the open one');
});

// ---------------------------------------------------------------- the velocity law

test('velocity 64 peaks at (64/127)^2 of velocity 127: 40 log10 rel, -11.9 dB', () => {
  const peak = (vel) => {
    const { ctx, h } = engineEnv('perc-voice');
    h.noteOn(0.1, KICK, vel);
    return ampOf(ctx, h).gain.calls.find((c) => c[0] === 'setValueAtTime' && c[2] === 0.1)[1];
  };
  const db = 20 * Math.log10(peak(64) / peak(127));
  assert.ok(Math.abs(db - 40 * Math.log10(64 / 127)) < 1e-9, `${db} dB`);
});
