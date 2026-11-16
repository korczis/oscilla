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
import { createClockOutMode, CLOCK_OUT_LOOKAHEAD_S, CATCHUP_S }
  from '../../../src/js/midi/clock-out-mode.js';
import { START, CONTINUE, STOP, TICK, SONG_POSITION, tickS } from '../../../src/js/midi/clock-out.js';

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
  const port = (name) => ({ name, log: [],
    send(data, at) { this.log.push({ b: data[0], at, data: Array.from(data) }); } });
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
  const st = statuses(out).filter((b) => b !== TICK);
  assert.deepEqual(st, [START, STOP, START], 'Stop between the two runs (C3-572 P3)');
  assert.ok(Math.abs(ctxOf(out.log.filter((e) => e.b === START)[1].at) - 10.25) < 1e-9);
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

// The song tick of a Song Position Pointer message (14 bits of sixteenths, 6 clocks each).
const sppTick = (e) => ((e.data[2] << 7) | e.data[1]) * 6;
// Context times of the receiver's beats: every 24th tick after the last Start or Continue.
const beatsOf = (p) => {
  const out = [];
  let n = 0;
  for (const e of p.log) {
    if (e.b === START) n = 0;
    else if (e.b === SONG_POSITION) n = sppTick(e);
    else if (e.b === TICK) { if (n % 24 === 0) out.push(ctxOf(e.at)); n += 1; }
  }
  return out;
};

test('joining a run 600 s in (C3-572 P1): SPP and Continue on the grid, no catch-up', () => {
  const { env, mode, port } = rig({ anchor: { origin: 10.0, tempo: 120, fromStart: true } });
  env.now = 610.0;
  const out = port('A');
  mode.setOutput(out);
  assert.ok(out.log.length < 20, `a bounded burst (${out.log.length} sends)`);
  assert.equal(out.log[0].b, SONG_POSITION);
  assert.equal(out.log[1].b, CONTINUE);
  const s = sppTick(out.log[0]);
  assert.equal(s % 6, 0, 'a sixteenth');
  const at = ctxOf(out.log[1].at);
  assert.ok(Math.abs(at - (10.0 + s * tickS(120))) < 1e-9, 'Continue where the grid puts it');
  assert.ok(at >= 610.0 - 1e-9 && at < 610.0 + 6 * tickS(120), 'the next sixteenth after now');
  assert.ok(ticks(out).every((e) => ctxOf(e.at) >= at - 1e-9), 'no tick before it');
});

test('a run from 0 found later than CATCHUP_S (the view returns to the Studio): joined, not replayed', () => {
  const { env, clock, mode, port } = rig({ anchor: { origin: 10.0, tempo: 120, fromStart: true } });
  env.now = 10.0;
  const out = port('A');
  mode.setOutput(out);
  env.anchor = null; // the Sequencer in view, nothing playing there
  env.now = 30.0;
  clock.fire();
  env.anchor = { origin: 10.0, tempo: 120, fromStart: true }; // back in the Studio, still playing
  env.now = 70.0;
  const before = out.log.length;
  clock.fire();
  const fresh = out.log.slice(before);
  assert.ok(fresh.length < 20, `a bounded burst (${fresh.length} sends)`);
  assert.deepEqual(fresh.slice(0, 2).map((e) => e.b), [SONG_POSITION, CONTINUE]);
  assert.ok(70.0 - 10.0 > CATCHUP_S);
});

test('a Studio tempo change keeps the receiver on the transport\'s beats (C3-572 P2)', () => {
  // The Studio's grid: a tempo change moves every later tick, beats at multiples of 60/tempo.
  const { env, clock, mode, port } = rig({ anchor: { origin: 0.5, tempo: 120, fromStart: true } });
  env.now = 0.5;
  const out = port('A');
  mode.setOutput(out);
  for (let t = 0.525; t < 1.1; t += 0.025) { env.now = t; clock.fire(); }
  env.now = 1.1;
  env.anchor = { origin: 0.5, tempo: 100, fromStart: true };
  for (let t = 1.1; t < 3.2; t += 0.025) { env.now = t; clock.fire(); }
  const after = beatsOf(out).filter((b) => b > 1.2);
  assert.ok(after.length >= 3);
  for (const b of after) {
    const q = (b - 0.5) / 0.6;
    assert.ok(Math.abs(q - Math.round(q)) < 1e-6, `beat ${b.toFixed(3)} on the 100 BPM grid`);
  }
  const st = statuses(out).filter((b) => b !== TICK);
  assert.deepEqual(st, [START, STOP, SONG_POSITION, CONTINUE], 'relocated: FC, SPP, FB');
});

test('a Sequencer tempo segment relocates onto its grid with the song position', () => {
  // The new tempo begins at a pass boundary, song tick 48 at 1.5 s.
  const { env, clock, mode, port } = rig({ anchor: { run: 1, origin: 0.5, tempo: 120, tick0: 0,
    fromStart: true } });
  env.now = 0.5;
  const out = port('A');
  mode.setOutput(out);
  for (let t = 0.525; t < 1.5; t += 0.025) { env.now = t; clock.fire(); }
  env.now = 1.5;
  env.anchor = { run: 1, origin: 1.5, tempo: 60, tick0: 48, fromStart: true };
  for (let t = 1.5; t < 3.6; t += 0.025) { env.now = t; clock.fire(); }
  const st = out.log.filter((e) => e.b !== TICK);
  assert.deepEqual(st.map((e) => e.b), [START, STOP, SONG_POSITION, CONTINUE]);
  const spp = sppTick(st[2]);
  assert.ok(spp >= 48 && spp % 6 === 0, `the song position (${spp}) is past the segment start`);
  assert.ok(Math.abs(ctxOf(st[3].at) - (1.5 + (spp - 48) * tickS(60))) < 1e-9, 'on its grid');
  for (const b of beatsOf(out).filter((x) => x > 1.6)) {
    assert.ok(Math.abs((b - 1.5) - Math.round(b - 1.5)) < 1e-6, `beat ${b.toFixed(3)} at 60 BPM`);
  }
});
test('a port that closes is said once and sent to no more (C3-572 P3)', () => {
  const { env, clock, mode } = rig({ anchor: { origin: 10.0, tempo: 120, fromStart: true } });
  env.now = 10.0;
  let calls = 0;
  let open = true;
  const p = { name: 'gone', send() { calls += 1; if (!open) throw new Error('InvalidStateError'); } };
  mode.setOutput(p);
  open = false;
  const before = calls;
  env.now = 11.0; // a late wake: many ticks due at once
  clock.fire();
  assert.equal(calls - before, 1, 'the first failing send ends them');
  assert.deepEqual(env.said, ['send-failed']);
});

test('the mode wakes every 25 ms while a run is sent and every 100 ms while nothing plays', () => {
  const ms = [];
  let fn = null;
  const clock = { wake(key, m, f) { ms.push(m); fn = f; }, cancel() {} };
  let a = null;
  const mode = createClockOutMode({ clock, ctxNow: () => 10, stamp, anchor: () => a });
  mode.setOutput({ name: 'A', send() {} });
  a = { origin: 10, tempo: 120, fromStart: true };
  fn();
  a = null;
  fn();
  assert.deepEqual(ms, [100, 25, 100]);
});
