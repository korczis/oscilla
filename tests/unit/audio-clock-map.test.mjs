// V503 (A4) and V510: performance time <-> context time, owned by src/js/audio/clock.js.
//
// What it proves:
//   - clockOffsetS reads one getOutputTimestamp() reading and adds no latency again (a context
//     that reports outputLatency gives the same offset);
//   - without a usable reading (missing, zero, throwing) it falls back to ctx.currentTime
//     against `now`, and it is null with neither;
//   - perfToContextS and contextToPerfMs are inverse: the mapping error is 0 on a fake clock.
//   node --test tests/unit/audio-clock-map.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { clockOffsetS, contextToPerfMs, perfToContextS } from '../../src/js/audio/clock.js';

const ctxWith = (ts, extra = {}) => ({ currentTime: 3, getOutputTimestamp: () => ts, ...extra });

test('one output timestamp reading, no latency added again', () => {
  const ctx = ctxWith({ contextTime: 5, performanceTime: 12_000 });
  assert.equal(clockOffsetS(ctx, 99_999), 5 - 12);
  const lagging = ctxWith({ contextTime: 5, performanceTime: 12_000 },
    { baseLatency: 0.01, outputLatency: 0.022 });
  assert.equal(clockOffsetS(lagging, 99_999), 5 - 12, 'the latencies are not added');
});

test('without a usable reading: currentTime against now, else null', () => {
  assert.equal(clockOffsetS(ctxWith({ contextTime: 0, performanceTime: 0 }), 2000), 3 - 2);
  assert.equal(clockOffsetS(ctxWith(null), 2000), 1);
  const throws = { currentTime: 3, getOutputTimestamp: () => { throw new Error('no'); } };
  assert.equal(clockOffsetS(throws, 2000), 1);
  assert.equal(clockOffsetS({ currentTime: 3 }, 1000), 2, 'no getOutputTimestamp at all');
  assert.equal(clockOffsetS({ currentTime: 3 }, null), null);
  assert.equal(clockOffsetS(null, 1000), null);
});

test('the two mappings are inverse: mapping error 0 on a fake clock', () => {
  const offset = clockOffsetS(ctxWith({ contextTime: 7.25, performanceTime: 4_500 }), 0);
  for (const perf of [0, 4_500, 4_500.125, 123_456.789]) {
    const ctxS = perfToContextS(perf, offset);
    assert.ok(Math.abs(contextToPerfMs(ctxS, offset) - perf) < 1e-9, `${perf}`);
  }
  assert.equal(perfToContextS(4_500, offset), 7.25, 'the reading maps to itself');
});
