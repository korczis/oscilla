// MEASURE's result view controls (src/js/ui/measure/views.js measureViewPart, spec §44-§49):
// a tab switch keeps the live RTA only on the RTA tab and relayouts the chart it shows; a view
// option outside its choices (RTA mode, averaging, frame length, window, normalization the result
// cannot give, response quantity) is refused and changes nothing; an accepted one mirrors the
// expert field, restarts a running live analysis where it must (mode, averaging: unfrozen; frame
// length, window: the tap is reconfigured) and rebuilds the view it belongs to; the live toggle
// starts or stops; freeze and reset act on the live analysis, else on the stored RTA's averager.
// On a fake component, live analysis and averager.
//   node --test tests/unit/measure-view-controls.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { measureViewPart } from '../../src/js/ui/measure/views.js';

function harness({ live = null, rta = null } = {}) {
  const calls = [];
  const ctx = { live, liveStarting: false, rta, charts: {} };
  const ops = {
    stopLive: () => calls.push('stopLive'),
    startLive: async () => { calls.push('startLive'); return true; },
    reconfigureLive: () => calls.push('reconfigureLive'),
    safely: (what, fn) => { calls.push(['safely', what]); fn(); },
    rebuildResponse: () => calls.push('rebuildResponse'),
    rebuildIr: () => calls.push('rebuildIr'),
    rebuildRta: () => calls.push('rebuildRta'),
    updateRtaFrame: () => calls.push('updateRtaFrame'),
  };
  const ticks = [];
  const c = Object.assign(measureViewPart(ctx, {}, ops), {
    meas: { tab: 'response', readout: { x: 1 }, rtaFrozen: true, normAvail: {},
      view: { rtaMode: 'third', rtaAveraging: 'fast', rtaFftSize: 8192, rtaWindow: 'hann',
        normalization: 'none', quantity: 'magnitude', smoothing: 'none', irSpan: 'auto' },
      values: {} },
    $nextTick: (fn) => ticks.push(fn),
  });
  return { ctx, c, calls, ticks };
}

/** A live analysis that records what it is told. */
function fakeLiveRta() {
  return { frozen: false, told: [],
    setMode(v) { this.told.push(['mode', v]); }, setAveraging(v) { this.told.push(['avg', v]); },
    freeze() { this.frozen = true; }, unfreeze() { this.frozen = false; },
    resetPeaks() { this.told.push('resetPeaks'); } };
}

test('a tab switch stops the live RTA off the RTA tab and relayouts the shown chart', () => {
  const h = harness();
  let relayouts = 0;
  h.ctx.charts.ir = { relayout: () => { relayouts += 1; } };
  h.c.measureSetTab('spectrogram');
  assert.equal(h.c.meas.tab, 'response', 'not a result tab: nothing changes');
  assert.deepEqual(h.calls, []);
  h.c.measureSetTab('ir');
  assert.equal(h.c.meas.tab, 'ir');
  assert.equal(h.c.meas.readout, null);
  assert.deepEqual(h.calls, ['stopLive']);
  h.ticks.forEach((fn) => fn());
  assert.equal(relayouts, 1);
  h.c.measureSetTab('rta');
  assert.deepEqual(h.calls, ['stopLive'], 'the RTA tab keeps the live RTA');
  h.ticks.forEach((fn) => fn()); // no RTA chart yet: nothing to relayout
});

test('a view option outside its choices is refused and changes nothing', () => {
  const h = harness();
  h.c.meas.normAvail = { band: { ok: false } };
  const refused = [['rtaMode', 'ninth'], ['rtaAveraging', 'medium'], ['rtaFftSize', 1000],
    ['rtaFftSize', '8192'], ['rtaWindow', 'kaiser'], ['normalization', 'peak'],
    ['normalization', 'band'], ['quantity', 'group-delay']];
  const before = { ...h.c.meas.view };
  for (const [k, v] of refused) assert.equal(h.c.measureSetView(k, v), false, `${k}=${v}`);
  assert.deepEqual(h.c.meas.view, before);
  assert.deepEqual(h.calls, []);
  h.c.meas.normAvail = { band: { ok: true } };
  assert.equal(h.c.measureSetView('normalization', 'band'), true);
  assert.equal(h.c.measureSetView('normalization', '1k'), true, 'no availability: allowed');
});

test('an accepted option mirrors its expert field and rebuilds the view it belongs to', () => {
  const h = harness();
  assert.equal(h.c.measureSetView('quantity', 'phase'), true);
  assert.equal(h.c.measureSetView('smoothing', '1/6'), true);
  assert.equal(h.c.measureSetView('irSpan', 'long'), true);
  assert.equal(h.c.measureSetView('rtaMode', 'octave'), true);
  assert.equal(h.c.measureSetView('rtaPeakHold', true), true);
  assert.equal(h.c.measureSetView('other', 1), true);
  assert.deepEqual(h.calls, [['safely', 'frequency response'], 'rebuildResponse',
    ['safely', 'frequency response'], 'rebuildResponse', ['safely', 'impulse response'],
    'rebuildIr', ['safely', 'RTA'], 'rebuildRta', ['safely', 'RTA'], 'rebuildRta']);
  assert.equal(h.c.meas.view.quantity, 'phase');
  assert.deepEqual(h.c.meas.values, { rtaMode: 'octave' }, 'only the live RTA fields mirror');
  h.c.measureSetView('rtaFftSize', 16384);
  h.c.measureSetView('rtaWindow', 'blackman-harris');
  h.c.measureSetView('rtaAveraging', 'slow');
  assert.deepEqual(h.c.meas.values, { rtaMode: 'octave', fftSize: 16384,
    window: 'blackman-harris', averaging: 'slow' });
});

test('with a live analysis: mode and averaging restart it unfrozen, frame and window reconfigure',
  () => {
    const rta = fakeLiveRta();
    const h = harness({ live: { rta } });
    h.c.measureSetView('rtaMode', 'fft');
    assert.equal(h.c.meas.rtaFrozen, false);
    h.c.meas.rtaFrozen = true;
    h.c.measureSetView('rtaAveraging', 'instant');
    assert.equal(h.c.meas.rtaFrozen, false);
    assert.deepEqual(rta.told, [['mode', 'fft'], ['avg', 'instant']]);
    h.calls.length = 0;
    assert.equal(h.c.measureSetView('rtaFftSize', 32768), true);
    assert.equal(h.c.measureSetView('rtaWindow', 'hann'), true);
    assert.deepEqual(h.calls, ['reconfigureLive', 'reconfigureLive'], 'no rebuild of its own');
  });

test('the live toggle stops a running or starting live RTA, else starts one', async () => {
  const h = harness();
  assert.equal(await h.c.measureRtaLiveToggle(), true);
  h.ctx.liveStarting = true;
  assert.equal(await h.c.measureRtaLiveToggle(), false);
  h.ctx.liveStarting = false;
  h.ctx.live = { rta: fakeLiveRta() };
  assert.equal(await h.c.measureRtaLiveToggle(), false);
  assert.deepEqual(h.calls, ['startLive', 'stopLive', 'stopLive']);
});

test('freeze and reset act on the live analysis first, else on the stored RTA', () => {
  const rta = fakeLiveRta();
  const live = harness({ live: { rta } });
  live.c.measureRtaFreeze();
  assert.equal(rta.frozen, true);
  assert.equal(live.c.meas.rtaFrozen, true);
  live.c.measureRtaFreeze();
  assert.equal(rta.frozen, false);
  assert.equal(live.c.meas.rtaFrozen, false);
  live.c.measureRtaReset();
  assert.deepEqual(rta.told, ['resetPeaks']);
  assert.deepEqual(live.calls, ['rebuildRta', 'rebuildRta', 'rebuildRta']);

  const averager = { frozen: false, resets: 0, freeze() { this.frozen = true; },
    unfreeze() { this.frozen = false; }, reset() { this.resets += 1; } };
  const stored = harness({ rta: { averager, lastPower: null } });
  stored.c.measureRtaFreeze();
  assert.equal(averager.frozen, true);
  assert.equal(stored.c.meas.rtaFrozen, true);
  stored.c.measureRtaFreeze();
  assert.equal(stored.c.meas.rtaFrozen, false);
  stored.c.measureRtaReset();
  assert.equal(averager.resets, 1);
  assert.deepEqual(stored.calls, ['rebuildRta', 'rebuildRta', 'rebuildRta']);
  stored.ctx.rta.lastPower = new Float64Array(4);
  stored.c.measureRtaReset();
  assert.deepEqual(stored.calls.slice(-2), ['updateRtaFrame', 'rebuildRta']);

  const none = harness();
  none.c.measureRtaFreeze();
  none.c.measureRtaReset();
  assert.deepEqual(none.calls, [], 'nothing to freeze or reset');
});
