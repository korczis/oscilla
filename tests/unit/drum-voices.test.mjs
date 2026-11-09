// K071: the drum voices of the percussion engine (perc-voice, studio/adapters/engines.js) on
// the fake Web Audio context (tests/unit/sequencer-fake-audio.mjs via engine-fixture.mjs): the
// scheduled calls, times and ramps, and the node census.
//   - negative: a hit at velocity 0 sounds nothing: no source starts, no voice is taken and
//     none is stolen
//   - negative: a choke releases only the voices of its group that sound at the hit; an open hat
//     scheduled after the closed one (a clip's look-ahead, a pad struck between) is left whole,
//     and one that has already ended is not touched
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineEnv } from './engine-fixture.mjs';

const OPEN = 70; // perc-recipes.js PERC_KEYMAP: A#4 open hat
const CLOSED = 66; // F#4 closed hat
const KICK = 60;

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
