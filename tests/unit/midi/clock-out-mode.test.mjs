// V510: the clock-out mode (src/js/midi/clock-out-mode.js) on a fake clock, a fake output and a
// fake transport anchor. What it proves:
//   - no output chosen: nothing is sent, nothing wakes;
//   - a run that begins at position 0 sends Start at its origin and then ticks at 24 PPQ on the
//     audio clock, each stamped with its own time, never further ahead than the lookahead;
//   - a run that begins later sends Continue with the first tick on the beat grid at or after now;
//   - a new origin (the transport returned to the start) is a new Start; a re-plan that keeps the
//     origin is not;
//   - a tempo change re-anchors the ticks at the next unsent tick, none sent twice;
//   - no anchor sends Stop once; choosing another output stops the old one; a send that throws
//     drops the output and says so once.
//   node --test tests/unit/midi/clock-out-mode.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockOutMode, CLOCK_OUT_LOOKAHEAD_S } from '../../../src/js/midi/clock-out-mode.js';
import { START, CONTINUE, STOP, TICK, tickS } from '../../../src/js/midi/clock-out.js';

// Context time t maps to performance time t * 1000 + 5000 ms.
const OFFSET_MS = 5000;
const stamp = () => ({ contextTime: 0, performanceTime: OFFSET_MS });
const ctxOf = (ms) => (ms - OFFSET_MS) / 1000;

function rig({ anchor = null } = {}) {
  const env = { now: 10, anchor, wakes: 0, said: [] };
  const clock = { pending: null,
    wake(key, ms, fn) { env.wakes += 1; this.pending = fn; },
    cancel() { this.pending = null; },
    fire() { const f = this.pending; this.pending = null; if (f) f(); } };
  const mode = createClockOutMode({ clock, ctxNow: () => env.now, stamp,
    anchor: () => env.anchor, say: (r) => env.said.push(r) });
  const port = (name) => ({ name, log: [], send(data, at) { this.log.push({ b: data[0], at }); } });
  return { env, clock, mode, port };
}

const statuses = (p) => p.log.map((e) => e.b);
const ticks = (p) => p.log.filter((e) => e.b === TICK);

test('no output chosen: nothing sent, nothing wakes', () => {
  const { env, mode } = rig({ anchor: { origin: 10.05, tempo: 120, fromStart: true } });
  mode.tick();
  assert.equal(env.wakes, 0);
  assert.equal(mode.output(), null);
});

test('a run from position 0: Start at its origin, then ticks at 24 PPQ within the lookahead', () => {
  const { env, clock, mode, port } = rig({ anchor: { origin: 10.05, tempo: 120, fromStart: true } });
  const out = port('A');
  mode.setOutput(out);
  assert.equal(out.log[0].b, START);
  assert.equal(ctxOf(out.log[0].at), 10.05, 'Start is stamped at the run\'s origin');
  const dt = tickS(120);
  const t = ticks(out);
  assert.ok(t.length > 0);
  t.forEach((e, k) => assert.ok(Math.abs(ctxOf(e.at) - (10.05 + k * dt)) < 1e-9, `tick ${k}`));
  assert.ok(ctxOf(t[t.length - 1].at) < env.now + CLOCK_OUT_LOOKAHEAD_S, 'within the lookahead');
  // The next wake sends on from the next tick, none twice.
  const before = t.length;
  env.now = 10.3;
  clock.fire();
  const all = ticks(out);
  assert.ok(all.length > before);
  all.forEach((e, k) => assert.ok(Math.abs(ctxOf(e.at) - (10.05 + k * dt)) < 1e-9, `tick ${k}`));
  assert.equal(statuses(out).filter((b) => b === START).length, 1, 'one Start');
});

test('a run that began earlier sends Continue, the first tick on the grid at or after now', () => {
  const { env, mode, port } = rig({ anchor: { origin: 9.0, tempo: 100 } });
  env.now = 10.0;
  const out = port('A');
  mode.setOutput(out);
  assert.equal(out.log[0].b, CONTINUE);
  const dt = tickS(100);
  const at = ctxOf(out.log[0].at);
  assert.ok(at >= 10.0 - 1e-9 && at < 10.0 + dt, 'the next grid tick');
  assert.ok(Math.abs(((at - 9.0) / dt) - Math.round((at - 9.0) / dt)) < 1e-6, 'on the grid');
});

test('a new origin is a new Start; a re-plan that keeps it is not', () => {
  const { env, clock, mode, port } = rig({ anchor: { origin: 10.05, tempo: 120, fromStart: true } });
  const out = port('A');
  mode.setOutput(out);
  env.now = 10.2;
  env.anchor = { origin: 10.0505, tempo: 120, fromStart: true }; // within ORIGIN_EPS_S: the same run
  clock.fire();
  assert.equal(statuses(out).filter((b) => b === START).length, 1);
  env.anchor = { origin: 10.25, tempo: 120, fromStart: true }; // returned to the start
  clock.fire();
  assert.equal(statuses(out).filter((b) => b === START).length, 2);
  assert.ok(Math.abs(ctxOf(out.log.filter((e) => e.b === START)[1].at) - 10.25) < 1e-9);
});

test('a tempo change re-anchors at the next unsent tick, none sent twice', () => {
  const { env, clock, mode, port } = rig({ anchor: { origin: 10.0, tempo: 120, fromStart: true } });
  env.now = 10.0;
  const out = port('A');
  mode.setOutput(out);
  env.now = 10.5;
  env.anchor = { origin: 10.0, tempo: 60, fromStart: true };
  clock.fire();
  env.now = 11.0;
  clock.fire();
  const at = ticks(out).map((e) => ctxOf(e.at));
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] > at[i - 1], 'strictly later');
  const gaps = at.slice(1).map((v, i) => v - at[i]);
  assert.ok(Math.abs(gaps[0] - tickS(120)) < 1e-9, 'the old tempo first');
  assert.ok(Math.abs(gaps[gaps.length - 1] - tickS(60)) < 1e-9, 'the new tempo after');
});

test('no anchor sends Stop once; another output stops the old one; none sends nothing', () => {
  const { env, clock, mode, port } = rig({ anchor: { origin: 10.05, tempo: 120, fromStart: true } });
  const a = port('A');
  const b = port('B');
  mode.setOutput(a);
  env.anchor = null;
  clock.fire();
  clock.fire();
  assert.equal(statuses(a).filter((s) => s === STOP).length, 1, 'one Stop');
  env.anchor = { origin: 10.5, tempo: 120, fromStart: true };
  env.now = 10.4;
  clock.fire();
  mode.setOutput(b);
  assert.equal(statuses(a).filter((s) => s === STOP).length, 2, 'the old output is stopped');
  assert.equal(b.log[0].b, START);
  const n = b.log.length;
  mode.setOutput(null);
  env.now = 11;
  clock.fire();
  assert.equal(b.log.length, n + 1, 'Stop on leaving it, then nothing');
  assert.equal(b.log[n].b, STOP);
  assert.equal(clock.pending, null, 'nothing wakes');
});

test('a send that throws drops the output and says so once', () => {
  const { env, clock, mode } = rig({ anchor: { origin: 10.05, tempo: 120, fromStart: true } });
  const bad = { name: 'gone', send() { throw new Error('InvalidStateError'); } };
  mode.setOutput(bad);
  clock.fire();
  assert.deepEqual(env.said, ['send-failed']);
  assert.equal(mode.output(), null);
  assert.equal(clock.pending, null);
});

test('from position 0 with its origin passed: Start at the origin, missed ticks at once', () => {
  const { env, mode, port } = rig({ anchor: { origin: 9.9, tempo: 120, fromStart: true } });
  env.now = 10.0;
  const out = port('A');
  mode.setOutput(out);
  assert.equal(out.log[0].b, START);
  assert.ok(Math.abs(ctxOf(out.log[0].at) - 9.9) < 1e-9, 'stamped at its origin, in the past');
  const t = ticks(out);
  assert.ok(Math.abs(ctxOf(t[0].at) - 9.9) < 1e-9, 'tick 0 at the origin');
  t.forEach((e, k) => assert.ok(Math.abs(ctxOf(e.at) - (9.9 + k * tickS(120))) < 1e-9));
});

test('steadyStamp starts at the first reading and slews toward the later ones', async () => {
  const { steadyStamp, STAMP_SLEW_S } = await import('../../../src/js/midi/clock-out-mode.js');
  const readings = [2.0, 2.015, 1.985, 2.0 + STAMP_SLEW_S / 2];
  let i = 0;
  const s = steadyStamp(() => readings[i++]);
  const off = () => -s().performanceTime / 1000;
  assert.equal(off(), 2.0);
  assert.ok(Math.abs(off() - (2.0 + STAMP_SLEW_S)) < 1e-12, 'a 15 ms outlier moves it one slew');
  assert.ok(Math.abs(off() - 2.0) < 1e-12, 'and back');
  assert.ok(Math.abs(off() - (2.0 + STAMP_SLEW_S / 2)) < 1e-12, 'a near reading is reached');
  assert.equal(steadyStamp(() => null)(), null);
});
