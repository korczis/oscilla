import test from 'node:test';
import assert from 'node:assert/strict';
import {
  valueAtTime,
  adsrEvents,
  releaseEvents,
  holdEvents,
  applyAdsr,
  releaseAt,
  holdAt,
  getSchedule,
  envelopePoints,
  normalizeAdsr,
  ENVELOPE_FLOOR,
  MIN_SEGMENT_S,
} from '../../src/js/audio/envelope.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

/** Param mock that records calls; optionally exposes cancelAndHoldAtTime. */
function mockParam({ native = false, cancel = true } = {}) {
  const calls = [];
  const p = {
    calls,
    setValueAtTime: (v, t) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => calls.push(['exp', v, t]),
  };
  if (cancel) p.cancelScheduledValues = (t) => calls.push(['cancel', t]);
  if (native) p.cancelAndHoldAtTime = (t) => calls.push(['cancelAndHold', t]);
  return p;
}

test('normalizeAdsr: floors and clamps', () => {
  assert.deepEqual(normalizeAdsr({ a: 0, d: -1, s: 2, r: 'x' }), {
    a: MIN_SEGMENT_S,
    d: MIN_SEGMENT_S,
    s: 1,
    r: 0.2,
  });
});

test('valueAtTime: Web Audio set/linear/exponential semantics', () => {
  const ev = adsrEvents(1, { a: 0.1, d: 0.2, s: 0.5, r: 0.3 }, 1);
  close(valueAtTime(ev, 0.5), ENVELOPE_FLOOR);
  close(valueAtTime(ev, 1), ENVELOPE_FLOOR);
  close(valueAtTime(ev, 1.05), ENVELOPE_FLOOR + (1 - ENVELOPE_FLOOR) * 0.5);
  close(valueAtTime(ev, 1.1), 1);
  close(valueAtTime(ev, 1.2), 0.5 ** 0.5); // exponential halfway: 1·(0.5/1)^0.5
  close(valueAtTime(ev, 1.3), 0.5);
  close(valueAtTime(ev, 99), 0.5);
  // exponential with V0 = 0 holds V0 (spec)
  close(
    valueAtTime(
      [
        { kind: 'set', time: 0, value: 0 },
        { kind: 'exp', time: 1, value: 1 },
      ],
      0.5,
    ),
    0,
  );
  // zero-length ramp is a step
  close(
    valueAtTime(
      [
        { kind: 'set', time: 0, value: 0.2 },
        { kind: 'linear', time: 0, value: 1 },
      ],
      0,
    ),
    1,
  );
});

test('releaseEvents: hold mid-attack continues the line, then exponential to the floor', () => {
  const ev = adsrEvents(0, { a: 0.1, d: 0.1, s: 0.5, r: 0.2 }, 1);
  const vMid = valueAtTime(ev, 0.04);
  const rel = releaseEvents(ev, 0.04, 0.2);
  close(rel.value, vMid);
  close(rel.endTime, 0.24);
  // continuity at t: just before / at / just after
  close(valueAtTime(rel.events, 0.04 - 1e-9), vMid, 1e-6);
  close(valueAtTime(rel.events, 0.04), vMid);
  close(valueAtTime(rel.events, 0.04 + 1e-9), vMid, 1e-6);
  // never rises after release, reaches the floor
  close(valueAtTime(rel.events, 0.14), vMid * (ENVELOPE_FLOOR / vMid) ** 0.5, 1e-9);
  close(valueAtTime(rel.events, 0.24), ENVELOPE_FLOOR);
  close(valueAtTime(rel.events, 5), ENVELOPE_FLOOR);
});

test('releaseEvents: hold mid-decay (exponential) and during sustain', () => {
  const ev = adsrEvents(0, { a: 0.01, d: 0.2, s: 0.25, r: 0.1 }, 0.8);
  const t = 0.11;
  const v = valueAtTime(ev, t);
  close(v, 0.8 * 0.25 ** ((t - 0.01) / 0.2));
  const rel = releaseEvents(ev, t, 0.1);
  close(valueAtTime(rel.events, t - 1e-9), v, 1e-6);
  close(valueAtTime(rel.events, t + 1e-9), v, 1e-6);
  const sus = releaseEvents(ev, 2, 0.1);
  close(sus.value, 0.2);
  // event exactly at t is kept as is
  const atEdge = holdEvents(ev, 0.01);
  close(atEdge.value, 0.8);
  assert.equal(atEdge.events.at(-1).kind, 'linear');
});

test('applyAdsr + releaseAt (emulated): schedules re-end the in-progress segment', () => {
  const p = mockParam();
  const info = applyAdsr(p, 1, { a: 0.1, d: 0.2, s: 0.5, r: 0.3 }, 1);
  close(info.attackEnd, 1.1);
  close(info.decayEnd, 1.3);
  close(info.sustainLevel, 0.5);
  assert.deepEqual(p.calls.slice(0, 5), [
    ['cancel', 1],
    ['set', ENVELOPE_FLOOR, 0], // fresh param: floor pinned from time 0
    ['set', ENVELOPE_FLOOR, 1],
    ['linear', 1, 1.1],
    ['exp', 0.5, 1.3],
  ]);
  p.calls.length = 0;
  const r = releaseAt(p, 1.05, 0.3);
  const mid = ENVELOPE_FLOOR + (1 - ENVELOPE_FLOOR) * 0.5;
  close(r.value, mid);
  close(r.endTime, 1.35);
  assert.equal(p.calls[0][0], 'cancel');
  assert.deepEqual(p.calls[1].slice(0, 1), ['linear']);
  close(p.calls[1][1], mid);
  close(p.calls[1][2], 1.05);
  assert.deepEqual(p.calls[2], ['exp', ENVELOPE_FLOOR, 1.35]);
  // recorded schedule now equals releaseEvents of the original
  const expected = releaseEvents(
    [{ kind: 'set', time: 0, value: ENVELOPE_FLOOR }].concat(
      adsrEvents(1, { a: 0.1, d: 0.2, s: 0.5, r: 0.3 }, 1),
    ),
    1.05,
    0.3,
  ).events;
  assert.deepEqual(getSchedule(p), expected);
});

test('releaseAt (native): uses cancelAndHoldAtTime, same returned value', () => {
  const p = mockParam({ native: true });
  applyAdsr(p, 0, { a: 0.1, d: 0.1, s: 0.5, r: 0.2 });
  p.calls.length = 0;
  const r = releaseAt(p, 0.15, 0.2);
  assert.deepEqual(p.calls[0], ['cancelAndHold', 0.15]);
  // anchor: cancelAndHoldAtTime adds no event after the last one (sustain), so the hold is
  // pinned explicitly before the release ramp
  assert.equal(p.calls[1][0], 'set');
  close(p.calls[1][1], 0.5 ** 0.5);
  assert.equal(p.calls[1][2], 0.15);
  assert.equal(p.calls[2][0], 'exp');
  close(r.value, 0.5 ** 0.5);
  p.calls.length = 0;
  releaseAt(p, 0.2, 0.2, { native: false });
  assert.equal(p.calls[0][0], 'cancel');
});

test('works through a V1-style logging wrapper (no cancel methods, no .value)', () => {
  const p = mockParam({ cancel: false });
  applyAdsr(p, 0, { a: 0.05, d: 0.05, s: 0.6, r: 0.1 });
  const r = releaseAt(p, 0.5, 0.1);
  close(r.value, 0.6);
  assert.ok(p.calls.every((c) => ['set', 'linear', 'exp'].includes(c[0])));
});

test('retrigger: attack starts from the held current value, not from the floor', () => {
  const p = mockParam();
  applyAdsr(p, 0, { a: 0.1, d: 0.1, s: 0.5, r: 0.2 });
  releaseAt(p, 1, 1);
  const vAt = getSchedule(p);
  const expect = valueAtTime(vAt, 1.5);
  p.calls.length = 0;
  applyAdsr(p, 1.5, { a: 0.1, d: 0.1, s: 0.5, r: 0.2 }, 1, { retrigger: true });
  const set = p.calls.find((c) => c[0] === 'set' && c[2] === 1.5);
  close(set[1], expect);
  assert.ok(expect > ENVELOPE_FLOOR * 10, 'still sounding when re-attacked');
});

test('holdAt without a schedule holds the param value', () => {
  const p = { ...mockParam(), value: 0.3 };
  close(holdAt(p, 2), 0.3);
});

test('envelopePoints: exact corners, monotone segments, handles', () => {
  const g = envelopePoints({ a: 0.1, d: 0.2, s: 0.5, r: 0.4 }, { holdS: 0.3, samples: 64 });
  close(g.totalS, 1.0);
  assert.equal(g.t.length, g.v.length);
  const at = (t) => g.v[Array.from(g.t).findIndex((x) => Math.abs(x - t) < 1e-6)];
  close(at(0.1), 1, 1e-6);
  close(at(0.3), 0.5, 1e-6);
  close(at(0.6), 0.5, 1e-6);
  close(at(1.0), ENVELOPE_FLOOR, 1e-6);
  for (let i = 1; i < g.t.length; i++) assert.ok(g.t[i] >= g.t[i - 1]);
  assert.deepEqual(g.handles.decay, { t: 0.30000000000000004, v: 0.5 });
  assert.ok(Math.min(...g.v) >= ENVELOPE_FLOOR * 0.999);
});
