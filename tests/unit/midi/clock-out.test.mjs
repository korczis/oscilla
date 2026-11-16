// V510: MIDI clock and transport out (src/js/midi/clock-out.js).
//
// What it proves:
//   - ticksIn places tick k at k0At + (k - k0) * 60 / (bpm * CLOCK_PPQ), in [from, to), 24 per
//     quarter note (transport.js CLOCK_PPQ, the one constant);
//   - toPerf maps a context time to performance.now() ms from one getOutputTimestamp reading;
//   - createClockOut: Start (FA) or Continue (FB) at the run's start, then every tick exactly
//     once over any split of lookahead passes, a late pass sending the ticks it missed rather
//     than skipping them, a tempo change keeping the count (no tick twice, none skipped), Stop
//     (FC) now and nothing after it; only realtime bytes are ever sent (no SysEx).
//   node --test tests/unit/midi/clock-out.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUE, START, STOP, TICK, createClockOut, tickS, ticksIn, toPerf }
  from '../../../src/js/midi/clock-out.js';
import { CLOCK_PPQ } from '../../../src/js/midi/transport.js';

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test('ticksIn: 24 per quarter note on the audio clock, in [from, to)', () => {
  assert.equal(CLOCK_PPQ, 24);
  near(tickS(120), 60 / (120 * 24), '120 BPM');
  const run = { bpm: 120, k0: 0, k0At: 10 };
  const beat = ticksIn(10, 10.5, run); // one beat at 120 BPM
  assert.equal(beat.length, 24);
  assert.equal(beat[0].k, 0);
  near(beat[0].at, 10, 'the first tick at the start');
  near(beat[23].at, 10 + 23 * tickS(120), 'tick 23');
  assert.equal(ticksIn(10.5, 11, run)[0].k, 24, 'the next window goes on counting');
  assert.deepEqual(ticksIn(9, 9.9, run), [], 'nothing before the start');
  assert.deepEqual(ticksIn(11, 10, run), []);
  assert.deepEqual(ticksIn(10, 11, { ...run, bpm: 0 }), []);
});

test('toPerf maps a context time through one output timestamp reading', () => {
  const stamp = { contextTime: 2, performanceTime: 5000 };
  assert.equal(toPerf(2, stamp), 5000);
  assert.equal(toPerf(2.25, stamp), 5250);
  assert.equal(toPerf(2, null), undefined, 'no reading: send now');
});

function rig() {
  const sent = [];
  const clock = createClockOut({ send: (bytes, at) => sent.push({ b: bytes[0], at }),
    stamp: () => ({ contextTime: 0, performanceTime: 1000 }) });
  return { sent, clock };
}

test('Start, every tick exactly once over any split of passes, then Stop and nothing after', () => {
  const { sent, clock } = rig();
  assert.equal(clock.running(), false);
  assert.equal(clock.pass(1), 0, 'stopped: nothing');
  clock.start(1, 120);
  assert.equal(clock.running(), true);
  assert.deepEqual(sent[0], { b: START, at: 2000 });
  // Uneven passes over two beats.
  for (const to of [1.1, 1.13, 1.4, 1.4, 1.75, 2]) clock.pass(to);
  const ticks = sent.filter((s) => s.b === TICK);
  assert.equal(ticks.length, 48, 'two beats');
  ticks.forEach((t, k) => near(t.at, 2000 + k * tickS(120) * 1000, `tick ${k}`));
  const endAt = clock.stop();
  assert.ok(Math.abs(endAt - (1 + 48 * tickS(120))) < 1e-9, 'the first unsent tick\'s time');
  near(sent[sent.length - 1].at, 2000 + 48 * tickS(120) * 1000, 'Stop after every queued tick');
  assert.equal(sent[sent.length - 1].b, STOP);
  assert.equal(clock.pass(3), 0, 'after Stop nothing');
  assert.equal(clock.stop(), false);
  assert.ok(sent.every((s) => [START, CONTINUE, STOP, TICK].includes(s.b)), 'realtime only');
});

test('a late pass sends the ticks it missed, stamped at their own time', () => {
  const { sent, clock } = rig();
  clock.resume(0, 60); // Continue; one tick every 1/24 s
  assert.equal(sent[0].b, CONTINUE);
  clock.pass(0.1); // ticks 0, 1, 2 (0, 0.0417, 0.0833)
  clock.pass(0.5); // the main thread was late: 3..11 still go, none skipped
  const ticks = sent.filter((s) => s.b === TICK);
  assert.equal(ticks.length, 12);
  ticks.forEach((t, k) => near(t.at, 1000 + (k / 24) * 1000, `tick ${k}`));
});

test('a tempo change keeps the count: the next tick is the first unsent one', () => {
  const { sent, clock } = rig();
  clock.start(0, 120);
  clock.pass(0.5); // one beat: ticks 0-23
  clock.tempo(0.5, 60); // half the tempo from here
  clock.pass(1.5); // one beat at 60 BPM: ticks 24-47
  const ticks = sent.filter((s) => s.b === TICK);
  assert.equal(ticks.length, 48);
  near(ticks[24].at, 1500, 'tick 24 where the change is');
  near(ticks[25].at - ticks[24].at, tickS(60) * 1000, 'the new spacing');
  const gaps = ticks.slice(1).map((t, i) => t.at - ticks[i].at);
  assert.ok(gaps.every((g) => g > 0), 'no tick twice, none out of order');
});

test('a tempo change ahead of the sent ticks keeps the old tempo until it, with no gap', () => {
  const { sent, clock } = rig();
  clock.start(0, 120);
  clock.pass(0.25); // ticks 0-11
  clock.tempo(0.5, 60); // from 0.5 on: ticks 12-23 still at 120 BPM
  clock.pass(1.5);
  const ticks = sent.filter((s) => s.b === TICK);
  assert.equal(ticks.length, 48, 'one beat at 120, one at 60');
  near(ticks[23].at, 1000 + 23 * tickS(120) * 1000, 'tick 23 at the old tempo');
  near(ticks[24].at, 1500, 'tick 24 at the change');
  near(ticks[47].at, 1500 + 23 * tickS(60) * 1000, 'tick 47 at the new tempo');
});


test('Song Position Pointer only while stopped, in sixteenths; resume counts from a song tick', async () => {
  const { createClockOut: make, SONG_POSITION, SPP_MAX } = await import('../../../src/js/midi/clock-out.js');
  const sent = [];
  const co = make({ send: (b, at) => sent.push({ b: Array.from(b), at }),
    stamp: () => ({ contextTime: 0, performanceTime: 0 }) });
  assert.equal(co.locate(7), false, 'not a sixteenth');
  assert.equal(co.locate(6 * 200), true);
  assert.deepEqual(sent[0].b, [SONG_POSITION, 200 & 0x7f, 200 >> 7]);
  co.locate(6 * (SPP_MAX + 5));
  assert.deepEqual(sent[1].b, [SONG_POSITION, 0x7f, 0x7f], 'clamped to 14 bits');
  assert.equal(co.resume(1.0, 120, 1200), true);
  assert.equal(co.locate(0), false, 'not while running');
  co.pass(1.0 + 3 * (60 / (120 * 24)) + 1e-6);
  assert.equal(sent.filter((e) => e.b[0] === 0xf8).length, 4, 'ticks from the resumed song tick');
  assert.equal(co.resume(2.0, 120, 7.5), false, 'an integer song tick');
});
