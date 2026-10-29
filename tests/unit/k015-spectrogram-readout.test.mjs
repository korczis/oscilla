// K015: the spectrogram hover readout (frequency and relative dB of the newest column, drawn on
// the canvas) and the unsmoothed feed computed from readTime(). Synthetic frames only: a fake
// AnalyserNode implements the Web Audio analysis (Web Audio API §1.8.6: Blackman window,
// |X[k]|/N, smoothing over time on the magnitude, 20·log10) so the analyser's smoothed feed and
// the unsmoothed feed read the same samples through the real createAnalyserReader.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRowMap,
  createSpectrogram,
  createSpectrogramFeed,
  readoutAtRow,
  SPECTROGRAM_FEEDS,
} from '../../src/js/analysis/spectrogram.js';
import { createAnalyserReader } from '../../src/js/analysis/analyser.js';
import { blackmanWindow, createFft, spectrumDb } from '../../src/js/analysis/fft.js';
import { RELATIVE_UNIT } from '../../src/js/calibration/level.js';
import { readoutLines } from '../../src/js/charts/spectrogram-view.js';

const FFT = 4096;

function fakeAnalyser({ sampleRate, fftSize = FFT, smoothing = 0.55 }) {
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

function tone(sampleRate, hz, amplitude, n = FFT) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function mockCanvas(w, h) {
  const ctx = {
    fillStyle: '',
    fillRect() {},
    drawImage() {},
    putImageData() {},
    createImageData: (cw, ch) => ({
      width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4),
    }),
  };
  return { width: w, height: h, getContext: () => ctx };
}

/** Columns whose tone-bin level is within 30 dB of the burst's peak, for one feed mode. */
function smearColumns(sampleRate, mode) {
  const an = fakeAnalyser({ sampleRate });
  const reader = createAnalyserReader(an);
  const feed = createSpectrogramFeed(reader, { mode });
  const k = Math.round((1000 * FFT) / sampleRate);
  const silence = new Float32Array(FFT);
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
  test(`K015 feed at ${sampleRate} Hz: a transient smears over fewer columns unsmoothed`, () => {
    const smoothed = smearColumns(sampleRate, 'analyser');
    const raw = smearColumns(sampleRate, 'unsmoothed');
    assert.ok(raw.count < smoothed.count,
      `unsmoothed ${raw.count} columns vs smoothed (0.55) ${smoothed.count}`);
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
  const ref = new Float32Array(FFT / 2);
  an.getFloatFrequencyData(ref);
  let worst = 0;
  for (let k = 0; k < FFT / 2; k++)
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
  assert.equal(feed.read(1).length, FFT / 2);
  const big = fakeAnalyser({ sampleRate: 48000, fftSize: FFT * 2 });
  an.fftSize = big.fftSize;
  an.frequencyBinCount = big.frequencyBinCount;
  an.getFloatTimeDomainData = big.getFloatTimeDomainData;
  reader.sync();
  assert.equal(feed.read(2).length, FFT);
});

for (const sampleRate of [44100, 48000]) {
  for (const scale of ['log', 'linear']) {
    for (const hz of [61.3, 997.1, 3150.7, 15500]) {
      test(`K015 readout at ${sampleRate} Hz, ${scale}: a ${hz} Hz tone reads its bin ±1`, () => {
        const sg = createSpectrogram(mockCanvas(400, 300), {
          sampleRate, fftSize: FFT, minHz: scale === 'log' ? 20 : 0, scale, timeSpanS: 1,
        });
        const spec = spectrumDb(tone(sampleRate, hz, 0.25), FFT);
        sg.push(spec, 0);
        const y = Math.floor(sg.yForFrequency(hz));
        const r = sg.readout(y);
        const expected = (hz * FFT) / sampleRate;
        assert.ok(Math.abs(r.bin - expected) <= 1, `bin ${r.bin} vs ${expected.toFixed(2)}`);
        assert.equal(r.frequencyHz, r.bin * (sampleRate / FFT));
        assert.equal(r.db, spec[r.bin], 'the dB of the bin read, not an interpolated value');
        assert.ok(r.db > -30, `the tone's own level: ${r.db}`);
      });
    }
  }
}

test('K015 readout: before data, after a null column and while frozen', () => {
  const sampleRate = 48000;
  const sg = createSpectrogram(mockCanvas(200, 100), { sampleRate, fftSize: FFT, timeSpanS: 1 });
  assert.equal(sg.readout(50).db, null, 'no column written yet');
  const spec = spectrumDb(tone(sampleRate, 1000, 0.25), FFT);
  sg.push(spec, 0);
  const y = Math.floor(sg.yForFrequency(1000));
  const live = sg.readout(y);
  sg.freeze(true);
  sg.push(new Float32Array(FFT / 2).fill(-140), 500);
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
  const binHz = 48000 / FFT;
  const map = buildRowMap({ rows: 200, binCount: FFT / 2, binHz, minHz: 20, maxHz: 24000 });
  const spec = new Float32Array(FFT / 2).fill(-120);
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
