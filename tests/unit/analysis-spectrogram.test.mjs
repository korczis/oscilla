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
  createSpectrogramFeed,
  readoutAtRow,
  SPECTROGRAM_FEEDS,
  DEFAULT_SPECTROGRAM_STOPS,
} from '../../src/js/analysis/spectrogram.js';
import { createAnalyserReader } from '../../src/js/analysis/analyser.js';
import { blackmanWindow, createFft, spectrumDb } from '../../src/js/analysis/fft.js';
import { RELATIVE_UNIT } from '../../src/js/calibration/level.js';
import { createSpectrogramView, readoutLines } from '../../src/js/charts/spectrogram-view.js';

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
  assert.equal(sg.push(spec, 255), 20, 'dropped frames within the gap bound repeat the snapshot');
  assert.equal(sg.push(spec, 10000), 1, 'a gap over the bound restarts the axis: no backfill');
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

// ---------- K015: the hover readout and the unsmoothed feed ----------
// Synthetic frames only: a fake AnalyserNode implements the Web Audio analysis (Web Audio API
// §1.8.6: Blackman window, |X[k]|/N, smoothing over time on the magnitude, 20·log10) so the
// analyser's smoothed feed and the unsmoothed feed read the same samples through the real
// createAnalyserReader.

const K_FFT = 4096;

function fakeAnalyser({ sampleRate, fftSize = K_FFT, smoothing = 0.55 }) {
  const buf = new Float32Array(fftSize);
  const smoothed = new Float64Array(fftSize / 2);
  const win = blackmanWindow(fftSize);
  const fft = createFft(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  return {
    context: { sampleRate },
    fftSize,
    frequencyBinCount: fftSize / 2,
    smoothingTimeConstant: smoothing,
    write(frame) {
      buf.set(frame);
    },
    getFloatTimeDomainData(out) {
      out.set(buf);
    },
    getFloatFrequencyData(out) {
      for (let i = 0; i < fftSize; i++) {
        re[i] = buf[i] * win[i];
        im[i] = 0;
      }
      fft.forward(re, im);
      for (let k = 0; k < fftSize / 2; k++) {
        const mag = Math.hypot(re[k], im[k]) / fftSize;
        smoothed[k] = smoothing * smoothed[k] + (1 - smoothing) * mag;
        out[k] = smoothed[k] > 0 ? 20 * Math.log10(smoothed[k]) : -Infinity;
      }
    },
  };
}

function tone(sampleRate, hz, amplitude, n = K_FFT) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/**
 * Frames whose tone-bin level is within 30 dB of the burst's peak, for one feed mode, when each
 * read sees a whole new window (no overlap): the limiting case of the smoothing tail alone.
 */
function smearColumns(sampleRate, mode) {
  const an = fakeAnalyser({ sampleRate });
  const reader = createAnalyserReader(an);
  const feed = createSpectrogramFeed(reader, { mode });
  const k = Math.round((1000 * K_FFT) / sampleRate);
  const silence = new Float32Array(K_FFT);
  const burst = tone(sampleRate, 1000, 0.5);
  const levels = [];
  for (let i = 0; i < 40; i++) {
    an.write(i === 10 ? burst : silence); // a transient one analysis frame long
    levels.push(feed.read(i * 16 + 1)[k]);
  }
  const peak = Math.max(...levels);
  return { count: levels.filter((v) => v > peak - 30).length, peak, levels };
}

for (const sampleRate of [44100, 48000]) {
  test(`K015 feed at ${sampleRate} Hz, disjoint windows: a transient smears less`, () => {
    const smoothed = smearColumns(sampleRate, 'analyser');
    const raw = smearColumns(sampleRate, 'unsmoothed');
    assert.ok(raw.count < smoothed.count,
      `unsmoothed ${raw.count} frames vs smoothed (0.55) ${smoothed.count}`);
    assert.equal(raw.count, 1, 'the unsmoothed feed shows the burst in its own frame only');
    assert.ok(smoothed.count >= 5, `0.55 smoothing decays 5.2 dB per frame: ${smoothed.count}`);
    assert.equal(raw.levels[11], -Infinity, 'silence after the burst is silence, not a tail');
  });
}

test('K015 feed: the unsmoothed feed equals the AnalyserNode analysis with smoothing off', () => {
  const sampleRate = 48000;
  const an = fakeAnalyser({ sampleRate, smoothing: 0 });
  const reader = createAnalyserReader(an);
  const feed = createSpectrogramFeed(reader);
  assert.equal(feed.mode, 'unsmoothed', 'unsmoothed is the default feed');
  const x = tone(sampleRate, 2345.6, 0.3);
  an.write(x);
  const a = Float32Array.from(feed.read(1));
  const ref = new Float32Array(K_FFT / 2);
  an.getFloatFrequencyData(ref);
  let worst = 0;
  for (let k = 0; k < K_FFT / 2; k++)
    if (ref[k] > -200) worst = Math.max(worst, Math.abs(a[k] - ref[k]));
  assert.ok(worst < 1e-3, `same scale as getFloatFrequencyData: worst ${worst} dB`);
  assert.equal(feed.read(1), feed.read(1), 'one reused buffer');
  assert.deepEqual([...SPECTROGRAM_FEEDS], ['unsmoothed', 'analyser']);
  assert.throws(() => createSpectrogramFeed(reader, { mode: 'magic' }), TypeError);
});

test('K015 feed: an fftSize change reallocates the unsmoothed analysis', () => {
  const an = fakeAnalyser({ sampleRate: 48000 });
  const reader = createAnalyserReader(an);
  const feed = createSpectrogramFeed(reader);
  assert.equal(feed.read(1).length, K_FFT / 2);
  const big = fakeAnalyser({ sampleRate: 48000, fftSize: K_FFT * 2 });
  an.fftSize = big.fftSize;
  an.frequencyBinCount = big.frequencyBinCount;
  an.getFloatTimeDomainData = big.getFloatTimeDomainData;
  reader.sync();
  assert.equal(feed.read(2).length, K_FFT);
});

for (const sampleRate of [44100, 48000]) {
  for (const scale of ['log', 'linear']) {
    for (const hz of [61.3, 997.1, 3150.7, 15500]) {
      test(`K015 readout at ${sampleRate} Hz, ${scale}: a ${hz} Hz tone reads its bin ±1`, () => {
        const sg = createSpectrogram(mockCanvas(400, 300), {
          sampleRate, fftSize: K_FFT, minHz: scale === 'log' ? 20 : 0, scale, timeSpanS: 1,
        });
        const spec = spectrumDb(tone(sampleRate, hz, 0.25), K_FFT);
        sg.push(spec, 0);
        const y = Math.floor(sg.yForFrequency(hz));
        const r = sg.readout(y);
        const expected = (hz * K_FFT) / sampleRate;
        assert.ok(Math.abs(r.bin - expected) <= 1, `bin ${r.bin} vs ${expected.toFixed(2)}`);
        assert.equal(r.frequencyHz, r.bin * (sampleRate / K_FFT));
        assert.equal(r.db, spec[r.bin], 'the dB of the bin read, not an interpolated value');
        assert.ok(r.db > -30, `the tone's own level: ${r.db}`);
      });
    }
  }
}

test('K015 readout: before data, after a null column and while frozen', () => {
  const sampleRate = 48000;
  const sg = createSpectrogram(mockCanvas(200, 100), { sampleRate, fftSize: K_FFT, timeSpanS: 1 });
  assert.equal(sg.readout(50).db, null, 'no column written yet');
  const spec = spectrumDb(tone(sampleRate, 1000, 0.25), K_FFT);
  sg.push(spec, 0);
  const y = Math.floor(sg.yForFrequency(1000));
  const live = sg.readout(y);
  sg.freeze(true);
  sg.push(new Float32Array(K_FFT / 2).fill(-140), 500);
  assert.deepEqual(sg.readout(y), live, 'frozen: the readout stays on the shown column');
  sg.freeze(false);
  sg.push(null, 600);
  sg.push(null, 700);
  const none = sg.readout(y);
  assert.equal(none.db, null, 'a null spectrum is no data, never a level');
  assert.ok(none.rowHz > 0);
  assert.equal(sg.readout(-1), null);
  assert.equal(sg.readout(100), null);
});

test('K015 readoutAtRow: max rows take the strongest bin, interpolated rows the nearer one', () => {
  const binHz = 48000 / K_FFT;
  const map = buildRowMap({ rows: 200, binCount: K_FFT / 2, binHz, minHz: 20, maxHz: 24000 });
  const spec = new Float32Array(K_FFT / 2).fill(-120);
  const top = 0;
  assert.equal(map.mode[top], 1);
  const k = map.lo[top] + 1;
  spec[k] = -12;
  assert.equal(readoutAtRow(spec, map, top).bin, k);
  const low = map.rows - 1;
  assert.equal(map.mode[low], 0);
  const r = readoutAtRow(spec, map, low);
  assert.equal(r.bin, map.frac[low] <= 0.5 ? map.lo[low] : map.lo[low] + 1);
  assert.equal(readoutAtRow(null, map, top).bin, null);
});

test('K015 label: relative dB, the bin and the newest column; never SPL', () => {
  const lines = readoutLines({
    rowHz: 1001, bin: 171, frequencyHz: 171 * (48000 / 8192), binHz: 48000 / 8192, db: -42.14,
  });
  const text = lines.join('\n');
  assert.match(text, /dB relative/);
  assert.ok(text.includes(RELATIVE_UNIT), text);
  assert.match(text, /−42\.1 dB/);
  assert.match(text, /bin 171/);
  assert.match(text, /newest column/);
  assert.doesNotMatch(text, /SPL/);
  const silent = readoutLines({
    rowHz: 1001, bin: 171, frequencyHz: 1002, binHz: 5.86, db: -Infinity,
  });
  assert.match(silent.join('\n'), /−∞ dB relative/);
  const empty = readoutLines({ rowHz: 1001, bin: null, frequencyHz: null, binHz: 5.86, db: null });
  assert.match(empty.join('\n'), /No analyser data/);
  assert.doesNotMatch(empty.join('\n'), /dB/);
});

/**
 * The app's regime: each frame reads the newest fftSize samples of one continuous stream that
 * advances by a 60 fps hop, so the analysis windows overlap and a short burst sits in many of
 * them. Returns the frames within 30 dB of the peak, the frames whose window holds any burst
 * sample, and the per-frame tone-bin levels.
 */
function slidingSmear(sampleRate, mode, { fftSize = 8192, burstMs = 20, frames = 50 } = {}) {
  const hop = Math.round(sampleRate / 60);
  const burstAt = 10 * hop;
  const burstLen = Math.round((burstMs / 1000) * sampleRate);
  const stream = new Float32Array(frames * hop + fftSize);
  for (let i = 0; i < burstLen; i++)
    stream[fftSize + burstAt + i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  const an = fakeAnalyser({ sampleRate, fftSize });
  const feed = createSpectrogramFeed(createAnalyserReader(an), { mode });
  const k = Math.round((1000 * fftSize) / sampleRate);
  const levels = [];
  let holding = 0;
  for (let f = 0; f < frames; f++) {
    const end = fftSize + f * hop; // the window is stream[end - fftSize, end)
    an.write(stream.subarray(end - fftSize, end));
    levels.push(feed.read(f * 16 + 1)[k]);
    const b0 = fftSize + burstAt;
    if (b0 < end && b0 + burstLen > end - fftSize) holding += 1;
  }
  const peak = Math.max(...levels);
  return { count: levels.filter((v) => v > peak - 30).length, holding, levels, hop };
}

for (const sampleRate of [44100, 48000]) {
  test(`K015 feed at ${sampleRate} Hz, overlapping 60 fps windows: a 20 ms burst smears less`,
    () => {
      const smoothed = slidingSmear(sampleRate, 'analyser');
      const raw = slidingSmear(sampleRate, 'unsmoothed');
      assert.ok(raw.count < smoothed.count,
        `unsmoothed ${raw.count} frames vs smoothed (0.55) ${smoothed.count}`);
      assert.ok(raw.count > 1, `overlapping windows: the burst in several frames (${raw.count})`);
      assert.ok(raw.count <= raw.holding,
        `unsmoothed: only frames whose window holds the burst (${raw.count} <= ${raw.holding})`);
      const after = raw.levels.findIndex((v, i) => i > 10 && v === -Infinity);
      assert.ok(after > 10, 'once the window has passed the burst, the unsmoothed feed is silent');
      assert.ok(Number.isFinite(smoothed.levels[after]),
        `the 0.55 feed still shows a tail there: ${smoothed.levels[after]}`);
    });
}

// ---------- K015: the view's hover path on a stubbed DOM (no browser) ----------

function stubCanvas() {
  const style = {};
  let styleWrites = 0;
  const texts = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    textAlign: 'left', textBaseline: 'top', imageSmoothingEnabled: true,
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    save() {}, restore() {}, setLineDash() {}, fillRect() {}, drawImage() {}, putImageData() {},
    fillText: (txt) => texts.push(txt),
    measureText: (txt) => ({ width: String(txt).length * 6 }),
    createImageData: (cw, ch) => ({
      width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4),
    }),
  };
  return {
    width: 300,
    height: 150,
    style: new Proxy(style, {
      set(o, key, v) {
        styleWrites += 1;
        o[key] = v;
        return true;
      },
    }),
    texts,
    get styleWrites() {
      return styleWrites;
    },
    setAttribute() {},
    remove() {},
    getContext: () => ctx,
  };
}

function withStubDom(dpr, fn) {
  const saved = ['document', 'window', 'getComputedStyle'].map((k) => [k, globalThis[k]]);
  const canvases = [];
  globalThis.document = {
    hidden: false,
    documentElement: { dataset: {} },
    createElement: () => {
      const c = stubCanvas();
      canvases.push(c);
      return c;
    },
  };
  globalThis.window = { devicePixelRatio: dpr, addEventListener() {}, removeEventListener() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  try {
    return fn(canvases);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

function stubHost(w, h) {
  const listeners = {};
  let sizeReads = 0;
  return {
    get clientWidth() {
      sizeReads += 1;
      return w;
    },
    get clientHeight() {
      sizeReads += 1;
      return h;
    },
    get sizeReads() {
      return sizeReads;
    },
    offsetParent: {},
    appendChild() {},
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: (type) => {
      delete listeners[type];
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    dispatch: (type, clientX, clientY) => listeners[type]({ type, clientX, clientY }),
  };
}

for (const dpr of [1, 2]) {
  for (const sampleRate of [44100, 48000]) {
    test(`K015 view at dpr ${dpr}, ${sampleRate} Hz: hovering a tone's row reads its bin`, () => {
      withStubDom(dpr, (canvases) => {
        const hz = 997.1;
        const an = fakeAnalyser({ sampleRate, smoothing: 0 });
        const host = stubHost(440, 333);
        const view = createSpectrogramView(host, { getAnalyser: () => an, autoFrame: false });
        const [axes, plot] = canvases; // created in that order
        assert.equal(view.options.feed, 'analyser', 'the 0.55-smoothing feed stays the default');
        assert.equal(plot.height, Math.round(view.plotRect.h * dpr), 'device-pixel plot rows');
        an.write(tone(sampleRate, hz, 0.25));
        view.frame(1000);
        const rect = view.plotRect;
        const y = view.yForFrequency(hz); // CSS px from the plot top
        host.dispatch('pointermove', rect.x + 10, rect.y + y);
        const r = view.readout;
        const expected = (hz * K_FFT) / sampleRate;
        assert.ok(Math.abs(r.bin - expected) <= 1, `bin ${r.bin} vs ${expected.toFixed(2)}`);
        assert.ok(r.db > -30, `the tone's own level: ${r.db}`);
        const [line1, line2] = readoutLines(r);
        assert.ok(axes.texts.includes(line1) && axes.texts.includes(line2),
          'the label is drawn on the axes canvas');
        // Next frame with the cursor held: the readout is redrawn without touching the DOM.
        const reads = host.sizeReads;
        const writes = axes.styleWrites;
        axes.texts.length = 0;
        view.frame(1100);
        assert.equal(host.sizeReads, reads, 'no host size read in the frame path');
        assert.equal(axes.styleWrites, writes, 'no axes style write in the frame path');
        assert.ok(axes.texts.includes(readoutLines(view.readout)[0]), 'the label is redrawn');
        host.dispatch('pointermove', rect.x + 10, rect.y + rect.h + 2);
        assert.equal(view.readout, null, 'below the plot: no readout');
        host.dispatch('pointermove', rect.x + 10, rect.y + y);
        host.dispatch('pointerleave', 0, 0);
        assert.equal(view.readout, null, 'pointerleave clears the readout');
        view.dispose();
      });
    });
  }
}

test('K015 view: the unsmoothed feed is opt-in and skips its FFT while frozen', () => {
  withStubDom(1, () => {
    const sampleRate = 48000;
    const an = fakeAnalyser({ sampleRate, smoothing: 0.55 });
    let timeReads = 0;
    const read = an.getFloatTimeDomainData;
    an.getFloatTimeDomainData = (out) => {
      timeReads += 1;
      read(out);
    };
    const host = stubHost(440, 333);
    const view = createSpectrogramView(host, {
      getAnalyser: () => an, autoFrame: false, feed: 'unsmoothed',
    });
    assert.equal(view.options.feed, 'unsmoothed');
    an.write(tone(sampleRate, 3150.7, 0.25));
    view.frame(1000);
    assert.equal(timeReads, 1, 'the unsmoothed feed reads the time domain');
    host.dispatch('pointermove', view.plotRect.x + 5, view.plotRect.y + view.yForFrequency(3150.7));
    const live = view.readout;
    assert.ok(Math.abs(live.bin - (3150.7 * K_FFT) / sampleRate) <= 1);
    view.setFreeze(true);
    view.frame(1100);
    view.frame(1200);
    assert.equal(timeReads, 1, 'frozen: no read and no FFT');
    assert.deepEqual(view.readout, live, 'frozen: the readout holds the shown column');
    view.setFreeze(false);
    view.frame(1300);
    assert.equal(timeReads, 2);
    view.dispose();
  });
});

// C014 (finding vis-divergence-2): a paused or hidden interval is never painted with the first
// spectrum read after it. The frame loop stops calling push() while it is paused or the page is
// hidden, so push() itself must not turn the gap into columns of one snapshot.
test('renderer: a gap between pushes writes at most one column, never the gap (C014)', () => {
  const cv = mockCanvas(400, 50);
  const sg = createSpectrogram(cv, { sampleRate: SR, fftSize: FFT, timeSpanS: 10,
    isHidden: () => false });
  const spec = new Float32Array(FFT / 2).fill(-30);
  assert.equal(sg.push(spec, 1000), 1);
  for (let t = 1016; t <= 1160; t += 16) sg.push(spec, t);
  // 4 s with no push at all (a paused frame loop or a hidden page): 160 columns would be due.
  const n = sg.push(spec, 5160);
  assert.ok(n <= 1, `push after a 4 s gap wrote ${n} columns; at most 1 can be real`);
  assert.equal(sg.push(spec, 5176), 0, 'the axis runs on from the resume, not from before it');
  assert.equal(sg.push(spec, 5260), 4, '10 s across 400 px: 100 ms is 4 columns');
});

test('renderer: dropped frames below the gap bound still fill, capped at the width', () => {
  const cv = mockCanvas(100, 50);
  const sg = createSpectrogram(cv, { sampleRate: SR, fftSize: FFT, timeSpanS: 0.1,
    isHidden: () => false });
  const spec = new Float32Array(FFT / 2).fill(-140);
  assert.equal(sg.push(spec, 0), 1);
  assert.equal(sg.push(spec, 200), 100, '200 ms at 1 column per ms is capped at the width');
});
