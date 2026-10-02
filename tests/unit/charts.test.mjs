// Unit tests for the pure parts of the chart renderers and lab controllers:
// axis ticks and formats, log mapping, FFT-to-pixel resampling, filter-handle and ADSR drag
// maths, phase/Lissajous model, and the small pure helpers exported by the controllers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  logTicks,
  linearTicks,
  niceStep,
  axisFraction,
  axisValue,
  createAxisScale,
  formatHzTick,
  formatHz,
  formatHzGrouped,
  formatHzStep,
  formatUncertainty,
  formatDbTick,
  formatSecondsTick,
  timeTickStep,
  frequencyTicks,
  parseFrequency,
  parseDurationS,
  formatDuration,
  parseNumber,
  logSliderToValue,
  valueToLogSlider,
} from '../../src/js/charts/axes.js';
import {
  buildPixelMap,
  sampleSpectrum,
  levelNear,
  argMax,
} from '../../src/js/charts/spectrum-data.js';
import {
  cutoffFromX,
  xFromCutoff,
  qFromDrag,
  qFromWheel,
  FILTER_DRAG,
  adsrLayout,
  hitAdsrHandle,
  dragAdsr,
  clampAdsr,
  defaultHoldS,
  ADSR_LIMITS,
} from '../../src/js/charts/drag-math.js';
import {
  relativePhase,
  modelWaves,
  modelLissajous,
  risingZeroCrossing,
  commonPeak,
} from '../../src/js/charts/phase-model.js';
import {
  deviceLimits,
  outputLabel,
  DEFAULT_OUTPUT_LABEL,
} from '../../src/js/charts/device-panel.js';
import { barSlotAt } from '../../src/js/charts/additive-chart.js';
import { shortName, rangeLabel } from '../../src/js/charts/bio-chart.js';
import { fieldsForType } from '../../src/js/labs/sequencer-panel.js';
import { defaultCustomPartials, presetPartials } from '../../src/js/labs/additive.js';
import { formatQ } from '../../src/js/labs/filter-lab.js';
import { HEARING_RANGES, CALL_EXAMPLES } from '../../src/js/data/bioacoustics.js';
import { envelopePoints } from '../../src/js/audio/envelope.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ axes

test('logTicks: 1-2-5 per decade, exact values, inclusive bounds', () => {
  assert.deepEqual(logTicks(20, 20000),
    [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
  assert.deepEqual(logTicks(10, 100000).filter((v) => String(v).startsWith('1')),
    [10, 100, 1000, 10000, 100000]);
  assert.deepEqual(logTicks(0.1, 1), [0.1, 0.2, 0.5, 1]);
  assert.deepEqual(logTicks(0, 10), []);
  assert.deepEqual(logTicks(100, 10), []);
});

test('linearTicks and niceStep', () => {
  assert.deepEqual(linearTicks(-100, 0, { step: 20 }), [-100, -80, -60, -40, -20, 0]);
  assert.deepEqual(linearTicks(0, 20000, { count: 4 }), [0, 5000, 10000, 15000, 20000]);
  assert.equal(niceStep(10, 5), 2);
  assert.equal(niceStep(24000, 4), 10000);
  assert.equal(niceStep(7, 3), 2.5);
  assert.deepEqual(linearTicks(-24.5, 12.1, { step: 12 }), [-24, -12, 0, 12]);
});

test('log mapping: fraction <-> value round trip and pixel scale', () => {
  assert.ok(close(axisFraction(20, 20, 20000), 0));
  assert.ok(close(axisFraction(20000, 20, 20000), 1));
  assert.ok(close(axisFraction(632.455532, 20, 20000), 0.5, 1e-6)); // geometric mean
  for (const u of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
    assert.ok(close(axisFraction(axisValue(u, 20, 20000), 20, 20000), u, 1e-12));
  }
  assert.ok(close(axisValue(0.5, 0, 100, 'linear'), 50));
  const y = createAxisScale({ min: -100, max: 0, px0: 200, px1: 0 });
  assert.equal(y.toPx(-100), 200);
  assert.equal(y.toPx(0), 0);
  assert.equal(y.fromPx(100), -50);
  const x = createAxisScale({ min: 20, max: 20000, px0: 0, px1: 600, scale: 'log' });
  assert.ok(close(x.toPx(632.455532), 300, 1e-4));
  assert.ok(close(x.fromPx(600), 20000, 1e-6));
});

test('frequency, dB and time labels match the reference style', () => {
  assert.deepEqual([20, 50, 500, 1000, 1500, 10000, 20000].map(formatHzTick),
    ['20', '50', '500', '1k', '1.5k', '10k', '20k']);
  assert.equal(formatHz(15500), '15.5 kHz');
  assert.equal(formatHz(440), '440 Hz');
  assert.equal(formatHz(2500), '2.5 kHz');
  assert.equal(formatHz(17600), '17.6 kHz');
  assert.equal(formatHz(120000), '120 kHz');
  assert.equal(formatHz(31), '31 Hz');
  assert.equal(formatHz(NaN), '—');
  assert.equal(formatHzGrouped(48000), '48,000 Hz');
  assert.equal(formatHzGrouped(22800), '22,800 Hz');
  assert.equal(formatDbTick(0), '0 dB');
  assert.equal(formatDbTick(-20), '-20');
  assert.equal(formatDbTick(12, 'all'), '+12 dB');
  assert.equal(formatDbTick(-24, 'all'), '-24 dB');
  assert.equal(formatDbTick(0, 'all'), '0 dB');
  assert.equal(formatDbTick(-80, 'plain'), '-80');
  assert.equal(formatSecondsTick(0), '0s');
  assert.equal(formatSecondsTick(10), '10s');
  assert.equal(timeTickStep(10), 1);
  assert.equal(timeTickStep(5), 0.5);
  assert.equal(timeTickStep(20), 2);
  assert.deepEqual(frequencyTicks(20, 20000, 'log').length, 10);
  assert.deepEqual(frequencyTicks(0, 20000, 'linear'), [0, 5000, 10000, 15000, 20000]);
});

test('formatHzStep never shows more precision than the step', () => {
  assert.equal(formatHzStep(15498.37, 1), '15.498 kHz');
  assert.equal(formatHzStep(15498.37, 10), '15.50 kHz');
  assert.equal(formatHzStep(440.23, 0.1), '440.2 Hz');
  assert.equal(formatHzStep(440.23, 1), '440 Hz');
  assert.equal(formatHzStep(1999.95, 1), '2.000 kHz');
  assert.equal(formatUncertainty(2.93), '± 3 Hz');
  assert.equal(formatUncertainty(0.37), '± 0.4 Hz');
  assert.equal(formatUncertainty(0), '');
});

test('input parsers', () => {
  assert.equal(parseFrequency('2.5 kHz'), 2500);
  assert.equal(parseFrequency('2.5k'), 2500);
  assert.equal(parseFrequency('880 Hz'), 880);
  assert.equal(parseFrequency('1,5 kHz'), 1500);
  assert.equal(parseFrequency('abc'), null);
  assert.equal(parseDurationS('10 ms'), 0.01);
  assert.equal(parseDurationS('0.3 s'), 0.3);
  assert.equal(parseDurationS('300'), 0.3);
  assert.equal(parseDurationS('x'), null);
  assert.equal(formatDuration(0.01), '10 ms');
  assert.equal(formatDuration(0.0055), '5.5 ms');
  assert.equal(formatDuration(1.5), '1.5 s');
  assert.equal(parseNumber('-6 dB'), -6);
  assert.equal(parseNumber('45°'), 45);
  assert.equal(parseNumber('n/a'), null);
});

test('log sliders map both ways', () => {
  assert.equal(valueToLogSlider(20, 20, 20000), 0);
  assert.equal(valueToLogSlider(20000, 20, 20000), 1000);
  assert.ok(close(logSliderToValue(500, 20, 20000), 632.455532, 1e-5));
  const v = logSliderToValue(valueToLogSlider(2500, 20, 20000), 20, 20000);
  assert.ok(Math.abs(v / 2500 - 1) < 0.004); // one slider step on a 3-decade range
  assert.equal(valueToLogSlider(1e9, 20, 20000), 1000); // clamped
});

// ------------------------------------------------------------------ spectrum resampling

test('buildPixelMap: columns with bins take the max, narrow columns interpolate', () => {
  const binHz = 48000 / 8192;
  const map = buildPixelMap({ binCount: 4096, binHz, minHz: 20, maxHz: 20000, scale: 'log',
    count: 600 });
  assert.equal(map.count, 600);
  assert.ok(map.freq[0] > 20 && map.freq[599] < 20000);
  for (let i = 1; i < 600; i++) assert.ok(map.freq[i] > map.freq[i - 1]);
  // Low columns are narrower than a bin (interpolation), high columns span many bins (max).
  assert.equal(map.hi[0], -1);
  assert.ok(map.hi[599] - map.lo[599] >= 10);
  // Every bin from the first covered one to 20 kHz belongs to exactly one max column.
  const covered = new Set();
  for (let i = 0; i < 600; i++) {
    if (map.hi[i] >= map.lo[i]) for (let k = map.lo[i]; k <= map.hi[i]; k++) covered.add(k);
  }
  const first = Math.min(...covered);
  const lastBin = Math.floor(20000 / binHz) - 1;
  for (let k = first; k <= lastBin; k++) assert.ok(covered.has(k), `bin ${k}`);
});

test('sampleSpectrum keeps a single-bin peak in its column and floors -Infinity', () => {
  const binHz = 48000 / 8192;
  const spec = new Float32Array(4096).fill(-Infinity);
  const k = Math.round(15500 / binHz);
  spec[k] = -20;
  spec[k + 1] = -40;
  const map = buildPixelMap({ binCount: 4096, binHz, minHz: 20, maxHz: 20000, scale: 'log',
    count: 565 });
  const out = new Float64Array(565);
  sampleSpectrum(spec, map, out, -100);
  const i = argMax(out);
  assert.equal(out[i], -20);
  assert.ok(map.lo[i] <= k && map.hi[i] >= k);
  assert.ok(Math.abs(map.freq[i] - 15500) / 15500 < 0.013); // within one column
  assert.equal(Math.min(...out), -100);
  assert.equal(levelNear(spec, 15500, binHz), -20);
  assert.equal(levelNear(spec, 1000, binHz), null);
});

test('sampleSpectrum interpolates dB between bins in sub-bin columns (no invented peaks)', () => {
  const spec = new Float32Array(16).map((_, i) => -10 * i);
  const map = buildPixelMap({ binCount: 16, binHz: 1, minHz: 1, maxHz: 3, scale: 'linear',
    count: 8 });
  const out = new Float64Array(8);
  sampleSpectrum(spec, map, out, -1000);
  for (let i = 0; i < 8; i++) {
    const f = map.freq[i];
    if (map.hi[i] < 0) assert.ok(close(out[i], -10 * f, 1e-4), `col ${i}`);
    assert.ok(out[i] <= -10 && out[i] >= -30);
  }
});

test('buildPixelMap marks columns above the analyser Nyquist as no-data', () => {
  const map = buildPixelMap({ binCount: 1024, binHz: 22050 / 1024, minHz: 20, maxHz: 30000,
    scale: 'log', count: 300 });
  assert.equal(map.lo[299], -1);
  const out = new Float64Array(300);
  sampleSpectrum(new Float32Array(1024).fill(-30), map, out, -100);
  assert.equal(out[299], -100);
});

// ------------------------------------------------------------------ filter handle

test('filter handle: cutoff from x on a log axis, round trip, clamped', () => {
  assert.ok(close(cutoffFromX(0, 224), 20));
  assert.ok(close(cutoffFromX(224, 224), 20000, 1e-6));
  assert.ok(close(cutoffFromX(112, 224), 632.455532, 1e-5));
  assert.ok(close(cutoffFromX(-50, 224), 20));
  assert.ok(close(cutoffFromX(999, 224), 20000, 1e-6));
  assert.ok(close(xFromCutoff(cutoffFromX(73, 224), 224), 73, 1e-9));
  assert.ok(close(cutoffFromX(0.6 * 300, 300), 20 * 1000 ** 0.6, 1e-6));
});

test('filter handle: vertical drag and wheel change Q geometrically, clamped', () => {
  assert.ok(close(qFromDrag(0.707, -40), 1.414));
  assert.ok(close(qFromDrag(0.707, 40), 0.3535));
  assert.equal(qFromDrag(0.707, 0), 0.707);
  assert.equal(qFromDrag(10, -1000), FILTER_DRAG.qMax);
  assert.equal(qFromDrag(1, 1000), FILTER_DRAG.qMin);
  assert.ok(close(qFromWheel(2, 400), 1));
  assert.ok(close(qFromWheel(2, -400), 4));
});

// ------------------------------------------------------------------ ADSR drag

const RECT = { x: 7, y: 14, w: 130, h: 100 };

test('adsrLayout places the handles at the envelopePoints corners', () => {
  const adsr = { a: 0.01, d: 0.1, s: 0.6, r: 0.3 };
  const L = adsrLayout(adsr, RECT);
  const hold = defaultHoldS(adsr);
  assert.ok(close(L.totalS, 0.41 + hold));
  assert.ok(close(L.handles.attack.x, RECT.x + 0.01 * L.pxPerS));
  assert.equal(L.handles.attack.y, RECT.y);
  assert.ok(close(L.handles.decay.y, RECT.y + 0.4 * RECT.h));
  assert.ok(close(L.handles.release.x, RECT.x + RECT.w));
  assert.equal(L.handles.release.y, RECT.y + RECT.h);
  // Same corner times as envelope.js envelopePoints (what the voice schedules).
  const pts = envelopePoints(adsr, { holdS: L.holdS });
  assert.ok(close(pts.handles.attack.t, L.handles.attack.t));
  assert.ok(close(pts.handles.decay.t, L.handles.decay.t));
  assert.ok(close(pts.handles.sustainEnd.t, L.handles.sustain.t));
  assert.ok(close(pts.totalS, L.handles.release.t));
});

test('hitAdsrHandle finds the nearest handle within the radius', () => {
  const adsr = { a: 0.2, d: 0.3, s: 0.5, r: 0.4 };
  const L = adsrLayout(adsr, RECT);
  const d = L.handles.decay;
  assert.equal(hitAdsrHandle(L, d.x + 3, d.y - 2), 'decay');
  assert.equal(hitAdsrHandle(L, L.handles.release.x, L.handles.release.y), 'release');
  assert.equal(hitAdsrHandle(L, RECT.x + 1, RECT.y + RECT.h / 2), null);
});

test('dragAdsr: x → time (frozen scale), y → sustain, clamped to limits', () => {
  const start = { a: 0.01, d: 0.1, s: 0.6, r: 0.3 };
  const L = adsrLayout(start, RECT);
  const a = dragAdsr('attack', start, 20, 30, L, RECT.h);
  assert.ok(close(a.a, 0.01 + 20 / L.pxPerS));
  assert.equal(a.s, 0.6); // attack ignores y
  const d = dragAdsr('decay', start, -10, -20, L, RECT.h);
  assert.ok(close(d.d, Math.max(ADSR_LIMITS.d[0], 0.1 - 10 / L.pxPerS)));
  assert.ok(close(d.s, 0.8));
  const s = dragAdsr('sustain', start, 50, 1000, L, RECT.h);
  assert.equal(s.s, 0);
  assert.equal(s.d, 0.1);
  const r = dragAdsr('release', start, -1e6, 0, L, RECT.h);
  assert.equal(r.r, ADSR_LIMITS.r[0]);
  assert.deepEqual(clampAdsr({ a: 9, d: -1, s: 2, r: 0.5 }), { a: 2, d: 0.001, s: 1, r: 0.5 });
});

// ------------------------------------------------------------------ phase model

test('phase model: triggered display shows the drifting relative phase', () => {
  assert.ok(close(relativePhase(440, 440, 90, 5), Math.PI / 2));
  assert.ok(close(relativePhase(440, 442, 0, 0.25), Math.PI)); // half a beat period
  assert.ok(close(relativePhase(440, 442, 0, 0.5), 0, 1e-9)
    || close(relativePhase(440, 442, 0, 0.5), 2 * Math.PI, 1e-9));
  const w = modelWaves({ fA: 100, fB: 100, phaseDeg: 90, points: 101, cycles: 1 });
  assert.ok(close(w.windowS, 0.01));
  assert.ok(close(w.a[0], 0) && close(w.b[0], 1)); // B leads A by 90°
  assert.ok(close(w.a[25], 1, 1e-6));
  const reuse = modelWaves({ fA: 100, fB: 200, points: 101 }, w);
  assert.equal(reuse.a, w.a);
});

test('Lissajous model: equal frequencies give an ellipse x² - 2xy cos φ + y² = sin² φ', () => {
  const phi = Math.PI / 3;
  const l = modelLissajous({ fA: 440, fB: 440, phaseDeg: 60, points: 64 });
  for (let i = 0; i < 64; i++) {
    const { x, y } = { x: l.x[i], y: l.y[i] };
    assert.ok(close(x * x - 2 * x * y * Math.cos(phi) + y * y, Math.sin(phi) ** 2, 1e-5));
  }
  const silent = modelLissajous({ fA: 0, fB: 440 });
  assert.equal(commonPeak(silent.x, silent.y), 0);
});

test('risingZeroCrossing and commonPeak', () => {
  const b = Float32Array.from([0.5, 0.1, -0.2, -0.1, 0.3, 0.6]);
  assert.equal(risingZeroCrossing(b), 4);
  assert.equal(risingZeroCrossing(Float32Array.from([1, 1, 1])), 0);
  assert.ok(close(commonPeak(b, Float32Array.from([-0.9])), 0.9, 1e-7)); // Float32
});

// ------------------------------------------------------------------ controller helpers

test('device limits come only from a real sample rate', () => {
  assert.deepEqual(deviceLimits(48000), { sampleRate: 48000, nyquist: 24000, safeMax: 22800 });
  assert.deepEqual(deviceLimits(null), { sampleRate: null, nyquist: null, safeMax: null });
});

test('output label: never fabricated', () => {
  assert.equal(outputLabel([], undefined), DEFAULT_OUTPUT_LABEL);
  const hidden = [{ kind: 'audiooutput', deviceId: 'default', label: '' }];
  assert.equal(outputLabel(hidden, ''), DEFAULT_OUTPUT_LABEL);
  const devs = [
    { kind: 'audioinput', deviceId: 'm', label: 'Mic' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers (Built-in)' },
    { kind: 'audiooutput', deviceId: 'abc', label: 'USB DAC' },
  ];
  assert.equal(outputLabel(devs, ''), 'Speakers (Built-in)');
  assert.equal(outputLabel(devs, 'abc'), 'USB DAC');
  assert.equal(outputLabel(devs, 'zzz'), DEFAULT_OUTPUT_LABEL);
});

test('additive: bar slots, default table, presets', () => {
  assert.equal(barSlotAt(0, 0, 100, 10), 0);
  assert.equal(barSlotAt(99.9, 0, 100, 10), 9);
  assert.equal(barSlotAt(-1, 0, 100, 10), -1);
  assert.equal(barSlotAt(100, 0, 100, 10), -1);
  const custom = defaultCustomPartials();
  assert.equal(custom.length, 10);
  assert.ok(close(20 * Math.log10(custom[1].gain), -85 * Math.log10(2), 1e-9));
  const sq = presetPartials('square', custom);
  assert.ok(close(sq[0].gain, 4 / Math.PI) && sq[1].gain === 0);
  const keep = presetPartials('custom', custom);
  assert.notEqual(keep, custom);
  assert.deepEqual(keep, custom);
});

test('bio labels use the sourced values', () => {
  const human = HEARING_RANGES.find((r) => r.id === 'human');
  assert.equal(rangeLabel(human), '31 Hz – 17.6 kHz');
  assert.equal(shortName(HEARING_RANGES.find((r) => r.id === 'bat')), 'Bat');
  assert.equal(shortName(HEARING_RANGES.find((r) => r.id === 'dolphin')), 'Dolphin');
  assert.equal(shortName(CALL_EXAMPLES.find((r) => r.id === 'bigBrownBatFm1')), 'Bat FM1');
});

test('sequencer editor fields follow BLOCK_SCHEMA (Sweep: Start, End, Duration, Curve)', () => {
  assert.deepEqual(fieldsForType('sweep').map((f) => f.label),
    ['Start', 'End', 'Duration', 'Curve']);
  assert.deepEqual(fieldsForType('tone').map((f) => f.key), ['freq', 'durationMs']);
  assert.deepEqual(fieldsForType('silence').map((f) => f.key), ['durationMs']);
  assert.deepEqual(fieldsForType('pulse').map((f) => f.key), ['freq', 'durationMs', 'pulseMs',
    'pauseMs']);
  assert.deepEqual(fieldsForType('siren').map((f) => f.key), ['min', 'max', 'rate', 'durationMs',
    'shape']);
  assert.deepEqual(fieldsForType('nope'), []);
});

test('filter Q display', () => {
  assert.equal(formatQ(Math.SQRT1_2), '0.707');
  assert.equal(formatQ(1.414), '1.41');
  assert.equal(formatQ(12.34), '12.3');
});
