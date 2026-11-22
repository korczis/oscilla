// MEASURE's live RTA adapter (src/js/ui/measure/live.js, spec §44-§49): startLive opens one tap
// on the measurement input and analyses it on the shared frame loop; a stale start closes what it
// opened; a busy measurement, a failed tap and an aborted one say (or do not say) why; each tick
// analyses unless frozen and rebuilds the view at most every LIVE_VIEW_INTERVAL_MS; a new frame
// length resizes the tap and restarts the analysis; stopLive, the io closing the tap and a
// disconnected track release everything. On a fake tap, io and component, frames driven by hand.
//   node --test tests/unit/measure-live-rta-adapter.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLive, LIVE_RTA_TEXT } from '../../src/js/ui/measure/live.js';
import { LIVE_VIEW_INTERVAL_MS } from '../../src/js/ui/measure/constants.js';
import { MEASUREMENT_ERRORS } from '../../src/js/measurement/engine.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';

const SR = 48000;

/** An AnalyserNode stand-in that counts its time-domain reads. */
function fakeAnalyser(fftSize) {
  return {
    fftSize, reads: 0,
    get frequencyBinCount() { return this.fftSize / 2; },
    getFloatFrequencyData(a) { a.fill(-100); },
    getFloatTimeDomainData(a) {
      this.reads += 1;
      for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
    },
  };
}

function harness({ available = true, busy = false, open = null } = {}) {
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const said = [];
  const counts = { rebuild: 0, reset: 0, init: 0, cancel: 0, opened: 0, closed: 0 };
  const taps = [];
  const engine = { state: S.IDLE, reset() { counts.reset += 1; } };
  const io = {
    cancel() { counts.cancel += 1; },
    openLiveTap: open || (async ({ fftSize, onClosed }) => {
      const tap = { sampleRate: SR, analyser: fakeAnalyser(fftSize), onClosed,
        close() { counts.closed += 1; } };
      taps.push(tap);
      return tap;
    }),
  };
  const meas = { busy, rtaFrozen: true,
    rtaLive: { available, running: false, starting: false, kind: null, error: null },
    view: { rtaFftSize: 4096, rtaWindow: 'hann', rtaMode: 'third', rtaAveraging: 'fast' } };
  const cmp = { meas };
  const ctx = { live: null, liveStarting: false, liveToken: 0, io, ioKind: 'microphone', cmp,
    charts: { rta: null }, rta: null };
  const svc = { engine: { init() { counts.init += 1; } } };
  const ops = {
    rebuildRta() { counts.rebuild += 1; },
    announce: (a) => said.push(a.text),
    ensureEngine: () => engine,
    liveCalibration: () => ({}),
    inputOpened() { counts.opened += 1; },
  };
  const live = createLive(ctx, svc, ops);
  return { ctx, cmp, meas, live, said, counts, taps, frames, engine };
}

test('startLive opens the tap, runs on the frame loop and announces; a second start is refused',
  async () => {
    const h = harness();
    h.engine.state = S.READY; // a checked setup keeps the input open: released first
    assert.equal(await h.live.startLive(h.cmp), true);
    assert.equal(h.counts.reset, 1);
    assert.equal(h.counts.init, 1);
    assert.equal(h.meas.rtaLive.running, true);
    assert.equal(h.meas.rtaLive.kind, 'microphone');
    assert.equal(h.meas.rtaLive.starting, false);
    assert.equal(h.meas.rtaFrozen, false);
    assert.equal(h.ctx.liveStarting, false);
    assert.deepEqual(h.said, [LIVE_RTA_TEXT.started]);
    assert.equal(h.counts.opened, 1);
    assert.equal(h.frames.length, 1, 'subscribed to the frame loop');
    assert.equal(await h.live.startLive(h.cmp), false, 'one live RTA at a time');
    h.live.stopLive();
  });

test('startLive is refused while unavailable or while a measurement is busy', async () => {
  const off = harness({ available: false });
  assert.equal(await off.live.startLive(off.cmp), false);
  assert.equal(off.taps.length, 0);
  const busy = harness({ busy: true });
  assert.equal(await busy.live.startLive(busy.cmp), false);
  assert.equal(busy.meas.rtaLive.error, MEASUREMENT_ERRORS.BUSY);
  assert.equal(busy.taps.length, 0);
});

test('a tick analyses, redraws, and rebuilds the view at most every interval; frozen skips it',
  async () => {
    const h = harness();
    let redraws = 0;
    h.ctx.charts.rta = { redraw: () => { redraws += 1; } };
    await h.live.startLive(h.cmp);
    const L = h.ctx.live;
    const a = L.tap.analyser;
    const rebuilt = h.counts.rebuild;
    h.live.liveTick(1000);
    assert.equal(a.reads, 1);
    assert.equal(L.lastAt, 1000);
    assert.equal(h.counts.rebuild, rebuilt + 1, 'the first tick builds the view');
    h.live.liveTick(1000 + LIVE_VIEW_INTERVAL_MS - 1);
    assert.equal(h.counts.rebuild, rebuilt + 1, 'not again within the interval');
    h.live.liveTick(1000 + LIVE_VIEW_INTERVAL_MS);
    assert.equal(h.counts.rebuild, rebuilt + 2);
    assert.equal(redraws, 3);
    L.rta.freeze();
    h.live.liveTick(5000);
    assert.equal(a.reads, 3, 'a frozen analysis reads no frame');
    h.live.stopLive();
    h.live.liveTick(6000); // after the stop a tick does nothing
    assert.equal(a.reads, 3);
  });

test('reconfigureLive resizes the tap\'s analyser and restarts the analysis', async () => {
  const h = harness();
  h.live.reconfigureLive(h.meas); // nothing runs: nothing to do
  await h.live.startLive(h.cmp);
  const L = h.ctx.live;
  const before = L.rta;
  h.live.liveTick(10);
  h.meas.rtaFrozen = true;
  h.meas.view.rtaFftSize = 8192;
  h.live.reconfigureLive(h.meas);
  assert.equal(L.tap.analyser.fftSize, 8192);
  assert.notEqual(L.rta, before);
  assert.equal(L.lastAt, null);
  assert.equal(h.meas.rtaFrozen, false);
  h.live.stopLive();
});

test('stopLive releases the tap once and says it stopped; with nothing running it is false',
  async () => {
    const h = harness();
    assert.equal(h.live.stopLive(), false);
    await h.live.startLive(h.cmp);
    assert.equal(h.live.stopLive(), true);
    assert.equal(h.counts.closed, 1);
    assert.equal(h.ctx.live, null);
    assert.equal(h.meas.rtaLive.running, false);
    assert.equal(h.meas.rtaLive.kind, null);
    assert.equal(h.said.at(-1), LIVE_RTA_TEXT.stopped);
    assert.equal(h.live.stopLive(), false);
  });

test('the io closing the tap ends the run; a disconnected track says so; a stale close is ignored',
  async () => {
    const h = harness();
    await h.live.startLive(h.cmp);
    const tap = h.taps[0];
    h.live.liveClosed(999, 'page-hide'); // another run's token
    assert.notEqual(h.ctx.live, null);
    tap.onClosed('track-ended');
    assert.equal(h.ctx.live, null);
    assert.equal(h.meas.rtaLive.error, LIVE_RTA_TEXT.trackEnded);
    assert.equal(h.counts.closed, 0, 'the io closed it itself');

    const g = harness();
    await g.live.startLive(g.cmp);
    g.taps[0].onClosed('page-hide');
    assert.equal(g.ctx.live, null);
    assert.equal(g.meas.rtaLive.error, null);
  });

test('a stop during the pending start cancels it; the start closes the tap it opened', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ open: async ({ fftSize }) => {
    await gate;
    const tap = { sampleRate: SR, analyser: fakeAnalyser(fftSize),
      close() { h.counts.closed += 1; } };
    return tap;
  } });
  const p = h.live.startLive(h.cmp);
  assert.equal(h.meas.rtaLive.starting, true);
  assert.equal(h.live.stopLive(), true);
  assert.equal(h.counts.cancel, 1);
  assert.equal(h.meas.rtaLive.starting, false);
  release();
  assert.equal(await p, false);
  assert.equal(h.counts.closed, 1);
  assert.equal(h.ctx.live, null);
});

test('a failed tap says why, an aborted one says nothing', async () => {
  const fail = harness({ open: async () => {
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  } });
  assert.equal(await fail.live.startLive(fail.cmp), false);
  assert.equal(typeof fail.meas.rtaLive.error, 'string');
  assert.ok(fail.meas.rtaLive.error.length > 0);
  assert.equal(fail.ctx.liveStarting, false);

  const abort = harness({ open: async () => {
    throw Object.assign(new Error('stop'), { code: 'ABORTED' });
  } });
  assert.equal(await abort.live.startLive(abort.cmp), false);
  assert.equal(abort.meas.rtaLive.error, null);
});

test('LIVE_RTA_TEXT: every text the live RTA says is Czech (Q104), so the imports above cannot '
  + 'pass on an English copy', () => {
  const values = Object.values(LIVE_RTA_TEXT);
  assert.equal(values.length, 3);
  for (const v of values) assert.match(v, /[áčďéěíňóřšťúůýž]/i, v);
});
