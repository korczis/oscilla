import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildColorLut,
  dbToLutIndex,
  buildRowMap,
  rowValue,
  fillColumn,
  rowFrequency,
  frequencyAtPosition,
  positionAtFrequency,
  createSpectrogram,
  DEFAULT_SPECTROGRAM_STOPS,
} from '../../src/js/analysis/spectrogram.js';

const SR = 48000;
const FFT = 8192;
const BIN = SR / FFT;

test('LUT: 256 RGBA entries, ends equal the end stops, monotone luminance for the default', () => {
  const lut = buildColorLut();
  assert.equal(lut.length, 1024);
  assert.deepEqual([...lut.slice(0, 4)], [...DEFAULT_SPECTROGRAM_STOPS[0].color, 255]);
  assert.deepEqual([...lut.slice(1020, 1024)], [...DEFAULT_SPECTROGRAM_STOPS.at(-1).color, 255]);
  let prev = -1;
  for (let i = 0; i < 256; i++) {
    const y = 0.2126 * lut[i * 4] + 0.7152 * lut[i * 4 + 1] + 0.0722 * lut[i * 4 + 2];
    assert.ok(y >= prev - 1, `luminance drops at ${i}`);
    prev = y;
  }
});

test('LUT: custom stops (hex and tuple forms, unsorted) interpolate linearly', () => {
  const lut = buildColorLut([[1, '#ffffff'], { at: 0, color: [0, 0, 0] }]);
  assert.deepEqual([...lut.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...lut.slice(1020, 1023)], [255, 255, 255]);
  assert.equal(lut[128 * 4], 128);
  assert.throws(() => buildColorLut([]), RangeError);
  assert.throws(() => buildColorLut([{ at: 0, color: 'red' }]), TypeError);
});

test('dbToLutIndex: floor for -Infinity/NaN/below range, 255 at or above max', () => {
  assert.equal(dbToLutIndex(-Infinity, -120, -20), 0);
  assert.equal(dbToLutIndex(NaN, -120, -20), 0);
  assert.equal(dbToLutIndex(-130, -120, -20), 0);
  assert.equal(dbToLutIndex(-20, -120, -20), 255);
  assert.equal(dbToLutIndex(-70, -120, -20), 128);
});

test('axis: log and linear position/frequency are inverse', () => {
  for (const scale of ['log', 'linear']) {
    for (const f of [20, 100, 1000, 15500, 22000]) {
      const u = positionAtFrequency(f, 20, 24000, scale);
      assert.ok(Math.abs(frequencyAtPosition(u, 20, 24000, scale) - f) < 1e-6 * f);
    }
  }
  assert.ok(Math.abs(rowFrequency(0, 100, 20, 20000, 'log') - 20 * 1000 ** 0.995) < 1e-6);
});

test('row map (log): low rows interpolate between bins, high rows take the max over bins', () => {
  const map = buildRowMap({
    rows: 400,
    binCount: FFT / 2,
    binHz: BIN,
    minHz: 20,
    maxHz: 24000,
    scale: 'log',
  });
  // bottom row ~20 Hz: interpolation mode with a sub-bin position
  const yb = 399;
  assert.equal(map.mode[yb], 0);
  const fc = rowFrequency(yb, 400, map.minHz, map.maxHz, 'log');
  assert.equal(map.lo[yb], Math.floor(fc / BIN));
  assert.ok(Math.abs(map.frac[yb] - (fc / BIN - Math.floor(fc / BIN))) < 1e-6);
  // top row: many bins
  assert.equal(map.mode[0], 1);
  assert.ok(map.hi[0] > map.lo[0]);
  assert.equal(map.hi[0], FFT / 2 - 1);
  // rows are ordered: lower rows never map to higher bins
  for (let y = 1; y < 400; y++) assert.ok(map.lo[y] <= map.lo[y - 1]);
  // every bin in the max-mode region belongs to exactly one row (no gaps, no overlap)
  let covered = 0;
  for (let y = 0; y < 400; y++) if (map.mode[y] === 1) covered += map.hi[y] - map.lo[y] + 1;
  assert.ok(covered > 0);
});

test('row map: narrow tone not diluted (max); interpolation stays between neighbours', () => {
  const map = buildRowMap({ rows: 200, binCount: FFT / 2, binHz: BIN, minHz: 20, maxHz: 24000 });
  const spec = new Float32Array(FFT / 2).fill(-140);
  const k = Math.round(15500 / BIN);
  spec[k] = -30;
  const y = map.mode.findIndex((m, i) => m === 1 && map.lo[i] <= k && map.hi[i] >= k);
  assert.ok(y >= 0);
  assert.equal(rowValue(spec, map, y, -120), -30);
  // interpolation row between two bins of different level
  const yi = map.mode.lastIndexOf(0);
  const s2 = new Float32Array(FFT / 2).fill(-140);
  s2[map.lo[yi]] = -60;
  s2[map.lo[yi] + 1] = -40;
  const v = rowValue(s2, map, yi, -120);
  assert.ok(v >= -60 && v <= -40);
  assert.ok(Math.abs(v - (-60 + 20 * map.frac[yi])) < 1e-4);
});

test('row map (linear) and fillColumn: silence/null writes only the floor colour', () => {
  const map = buildRowMap({
    rows: 64,
    binCount: 1024,
    binHz: 23.4375,
    minHz: 0,
    maxHz: 24000,
    scale: 'linear',
  });
  const lut = buildColorLut();
  const px = new Uint8ClampedArray(64 * 4);
  fillColumn(px, null, map, lut, -120, -20);
  for (let y = 0; y < 64; y++)
    assert.deepEqual([...px.slice(y * 4, y * 4 + 4)], [...lut.slice(0, 4)]);
  fillColumn(px, new Float32Array(1024).fill(-Infinity), map, lut, -120, -20);
  for (let y = 0; y < 64; y++) assert.equal(px[y * 4], lut[0]);
  const loud = new Float32Array(1024).fill(0);
  fillColumn(px, loud, map, lut, -120, -20);
  assert.deepEqual([...px.slice(0, 4)], [...lut.slice(1020, 1024)]);
});

// ---------- renderer with a mock canvas (scroll strategy; no OffscreenCanvas in node) ----------

function mockCanvas(w, h) {
  const calls = [];
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    drawImage: (...a) => calls.push(['drawImage', ...a.slice(1)]),
    putImageData: (img, x, y) => calls.push(['put', x, y, img.data[0]]),
    createImageData: (cw, ch) => ({
      width: cw,
      height: ch,
      data: new Uint8ClampedArray(cw * ch * 4),
    }),
  };
  return { width: w, height: h, getContext: () => ctx, calls };
}

test('renderer: columns follow wall time, freeze and hidden pause, null writes floor', () => {
  const cv = mockCanvas(100, 50);
  let hidden = false;
  const sg = createSpectrogram(cv, {
    sampleRate: SR,
    fftSize: FFT,
    timeSpanS: 1,
    isHidden: () => hidden,
  });
  assert.equal(sg.strategy, 'scroll');
  const spec = new Float32Array(FFT / 2).fill(-140);
  assert.equal(sg.push(spec, 0), 1, 'first push writes one column');
  assert.equal(sg.push(spec, 10), 1, '100 px per 1000 ms → 1 column per 10 ms');
  assert.equal(sg.push(spec, 15), 0);
  assert.equal(sg.push(spec, 55), 4);
  assert.equal(sg.push(spec, 10000), 100, 'capped at the width');
  sg.freeze(true);
  assert.equal(sg.push(spec, 10010), 0);
  sg.freeze(false);
  assert.equal(sg.push(spec, 20000), 1, 'no backfill after unfreeze');
  hidden = true;
  assert.equal(sg.push(spec, 20010), 0);
  hidden = false;
  assert.equal(sg.push(spec, 30000), 1, 'no backfill after hidden');
  cv.calls.length = 0;
  sg.push(null, 30010);
  const put = cv.calls.find((c) => c[0] === 'put');
  assert.equal(put[3], sg.lut[0], 'null spectrum → floor colour');
  assert.ok(Math.abs(sg.yForFrequency(sg.rowFrequency(10)) - 10.5) < 1e-6);
});
