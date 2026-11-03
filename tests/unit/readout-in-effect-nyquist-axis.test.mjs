// T006 (truth-table row SPC-04): "Max: Nyquist" follows the sample rate once audio starts.
//
// The spectrum controller (src/js/labs/analysis.js) is mounted on a fake shell (the Max select
// and its Nyquist option) and a fake engine adapter whose sample rate is null until audio
// starts, as engine.sampleRate is before an AudioContext exists. The chart is injected through
// the controller's createChart option, so the test reads the axis maximum the controller asked
// for. The defect: choosing Nyquist before audio left the axis at 20 kHz after a 48 kHz context
// started, because nothing re-applied Max when the rate became known. The controller now
// follows the adapter's change notification, which main.js fires when cmp.sampleRate changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mount, maxFrequencyFor } from '../../src/js/labs/analysis.js';

function fakeEl(props = {}) {
  const listeners = new Map();
  return {
    ...props,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatch(type, detail) {
      for (const fn of [...(listeners.get(type) || [])]) fn({ type, detail });
    },
  };
}

function setup({ value = '20000', rate = null } = {}) {
  const nyquist = { value: 'nyquist', textContent: 'Max: Nyquist' };
  const select = fakeEl({
    value,
    querySelector: (sel) => (sel === 'option[value="nyquist"]' ? nyquist : null),
  });
  const host = {};
  const root = fakeEl({
    querySelector: (sel) => ({ '#osc-chart-spectrum': host, '#osc-spec-max': select })[sel]
      || null,
    querySelectorAll: () => [],
  });
  const engine = { rate };
  const listeners = new Set();
  const adapter = {
    getSampleRate: () => engine.rate,
    getAnalyser: () => null,
    requestedFrequency: () => null,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const chart = { maxHz: null, setMaxHz(hz) { this.maxHz = hz; }, setScale() {},
    refreshTheme() {}, dispose() {} };
  const createChart = (el, opts) => {
    assert.equal(el, host);
    chart.maxHz = opts.maxHz;
    return chart;
  };
  const lab = mount(root, adapter, { createChart });
  return {
    lab,
    chart,
    select,
    nyquist,
    listeners,
    choose(v) {
      select.value = v;
      select.dispatch('change');
    },
    // The engine's context starts: the rate becomes known and the composition root notifies
    // the adapter's listeners (main.js: the effect that reads cmp.sampleRate).
    startAudio(sr) {
      engine.rate = sr;
      for (const fn of [...listeners]) fn();
    },
  };
}

test('T006: Max Nyquist chosen before audio follows a 48 kHz context once it starts', () => {
  const t = setup();
  assert.equal(t.chart.maxHz, 20000, 'the default Max is 20 kHz');
  t.choose('nyquist');
  assert.equal(t.chart.maxHz, 20000, 'no rate yet: the axis is not moved to a guessed Nyquist');
  t.startAudio(48000);
  assert.equal(t.chart.maxHz, 24000, 'Nyquist of the running 48 kHz context');
});

test('T006: at 44.1 kHz Max Nyquist is 22050 Hz', () => {
  const t = setup({ value: 'nyquist' });
  t.startAudio(44100);
  assert.equal(t.chart.maxHz, 22050);
});

test('T006: a later rate change re-applies Nyquist (48 kHz, then 44.1 kHz)', () => {
  const t = setup({ value: 'nyquist' });
  t.startAudio(48000);
  assert.equal(t.chart.maxHz, 24000);
  t.startAudio(44100);
  assert.equal(t.chart.maxHz, 22050);
});

for (const [value, hz] of [['20000', 20000], ['2000', 2000]]) {
  test(`T006 negative: Max ${hz} Hz is unchanged before and after audio`, () => {
    const t = setup({ value });
    assert.equal(t.chart.maxHz, hz, 'before audio');
    t.startAudio(48000);
    assert.equal(t.chart.maxHz, hz, 'after a 48 kHz context');
    t.startAudio(44100);
    assert.equal(t.chart.maxHz, hz, 'after a 44.1 kHz context');
  });
}

test('T006: until a rate is known the Nyquist option says it is pending', () => {
  const t = setup();
  assert.equal(t.nyquist.textContent, 'Max: Nyquist (pending audio)');
  t.startAudio(48000);
  assert.equal(t.nyquist.textContent, 'Max: Nyquist (24 kHz)');
  t.startAudio(44100);
  assert.equal(t.nyquist.textContent, 'Max: Nyquist (22.05 kHz)');
});

test('T006: a notification without a rate change leaves a chosen Max alone', () => {
  const t = setup({ value: 'nyquist', rate: 48000 });
  assert.equal(t.chart.maxHz, 24000);
  t.chart.setMaxHz(12345); // stands in for anything else that set the axis
  t.startAudio(48000);
  assert.equal(t.chart.maxHz, 12345, 'the same rate re-applies nothing');
});

test('T006: dispose stops following the adapter', () => {
  const t = setup({ value: 'nyquist' });
  assert.equal(t.listeners.size, 1, 'the controller listens to the adapter');
  t.lab.dispose();
  assert.equal(t.listeners.size, 0);
});

test('T006: maxFrequencyFor keeps its contract', () => {
  assert.equal(maxFrequencyFor('nyquist', null), null);
  assert.equal(maxFrequencyFor('nyquist', 48000), 24000);
  assert.equal(maxFrequencyFor('20000', 32000), 16000);
  assert.equal(maxFrequencyFor('2000', null), 2000);
});
