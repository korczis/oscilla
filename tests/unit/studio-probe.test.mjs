// The probe tap contract (plan V616, V621's budget) through its stub: windowMs is converted with
// the probe's sample rate (44.1 kHz in CI, 48 kHz on the Mac), a lease reads honest frames,
// the budget refuses rather than fakes, and release() leaves nothing active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProbeStub, windowMsOf, windowSamples } from '../../src/js/studio/probe.js';

test('windowMs becomes the next power of two an AnalyserNode accepts, at the given rate', () => {
  assert.equal(windowSamples(20, 48000), 1024);
  assert.equal(windowSamples(20, 44100), 1024);
  assert.equal(windowSamples(50, 48000), 4096);
  assert.equal(windowSamples(0, 48000), 32);
  assert.equal(windowSamples(10000, 48000), 32768);
  assert.ok(Math.abs(windowMsOf(1024, 44100) - 23.22) < 0.01);
});

for (const sampleRate of [44100, 48000]) {
  test(`a lease reads a frame of the chosen window at ${sampleRate} Hz and says what it chose`, () => {
    const probe = createProbeStub({ sampleRate });
    const lease = probe.tap('node:filter-1/audio', { windowMs: 20 });
    const r = lease.read();
    assert.equal(r.live, true);
    assert.equal(r.sampleRate, sampleRate);
    assert.equal(r.window, r.frame.length);
    assert.ok(Math.abs(r.windowMs - (r.window / sampleRate) * 1000) < 1e-9);
    assert.ok(r.frame.some((v) => v !== 0));
    lease.release();
    assert.deepEqual(probe.active(), { analysers: 0, leases: 0 });
    assert.equal(lease.read().live, false);
  });
}

test('the budget refuses a tap with a reason instead of a fake frame', () => {
  const probe = createProbeStub({ budget: 1 });
  const a = probe.tap('output:master', { windowMs: 10 });
  const b = probe.tap('node:osc-1/audio', { windowMs: 10 });
  const r = b.read();
  assert.equal(r.live, false);
  assert.equal(r.reason, 'budget');
  assert.equal(r.frame, null);
  a.release();
  assert.equal(probe.active().leases, 0);
});

test('points are listed and an unknown point is refused, also on retarget', () => {
  const probe = createProbeStub();
  assert.ok(probe.points().some((p) => p.id === 'output:master'));
  assert.throws(() => probe.tap('node:nope/out'), /no tap point/);
  const lease = probe.tap('output:master');
  assert.throws(() => lease.retarget('edge:nope'), /no tap point/);
  lease.retarget('node:lfo-1/control');
  assert.equal(lease.id, 'node:lfo-1/control');
});
