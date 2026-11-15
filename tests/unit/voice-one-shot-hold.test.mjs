// Review C1-K222-7 (found by K071's real-render choke check): the voice host set a one-shot's
// level behind audio/envelope.js's record, so holdAt held the gain's default 1 and every cut of
// a ringing hit (a choke, all-off, a steal) began with a jump to full scale. The level now goes
// through envelope.js setAt, and a cut holds the voice's own level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineEnv } from './engine-fixture.mjs';

const OPEN = 70; // perc-recipes.js PERC_KEYMAP: A#4 open hat
const CLOSED = 66; // F#4 closed hat

const ampOf = (ctx, h) => ctx.of('gain').filter((g) => g.outputs.includes(h.outputs.audio)).at(-1);

test('a cut one-shot is held at its own level, never at full scale (choke, all-off)', () => {
  for (const cut of [(h) => h.noteOn(0.2, CLOSED, 100), (h) => h.allOff(0.2)]) {
    const { ctx, h } = engineEnv('perc-voice');
    h.noteOn(0.1, OPEN, 100);
    const open = ampOf(ctx, h);
    const peak = open.gain.calls.find((c) => c[0] === 'setValueAtTime' && c[2] === 0.1)[1];
    assert.ok(peak > 0 && peak < 0.1, `the voice peaks at ${peak}`);
    cut(h);
    const at = open.gain.calls.findIndex((c) => c[0] === 'cancelAndHoldAtTime');
    assert.ok(at >= 0, 'the cut holds the gain');
    const held = open.gain.calls.slice(at).find((c) => c[0] === 'setValueAtTime');
    assert.ok(held && Math.abs(held[1] - peak) < 1e-12, `held at ${held && held[1]}, not ${peak}`);
    assert.ok(open.gain.calls.slice(at).every((c) => c[0] === 'cancelAndHoldAtTime'
      || c[1] <= peak + 1e-12), 'nothing above the voice\'s level after the cut');
  }
});
