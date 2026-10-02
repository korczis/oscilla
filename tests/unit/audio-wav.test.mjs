import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeWav,
  parseWav,
  floatToInt16,
  WAVE_FORMAT_PCM,
  WAVE_FORMAT_IEEE_FLOAT,
} from '../../src/js/audio/wav.js';

const ascii = (v, o) => String.fromCharCode(...new Uint8Array(v.buffer, o, 4));

function bufferLike(channels, sampleRate = 48000) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (i) => channels[i],
  };
}

test('floatToInt16: clamping, asymmetric scaling, rounding', () => {
  assert.equal(floatToInt16(1), 32767);
  assert.equal(floatToInt16(-1), -32768);
  assert.equal(floatToInt16(2), 32767);
  assert.equal(floatToInt16(-3), -32768);
  assert.equal(floatToInt16(0), 0);
  assert.equal(floatToInt16(NaN), 0);
  assert.equal(floatToInt16(0.5), 16384); // 16383.5 rounds up
  assert.equal(floatToInt16(-0.5), -16384);
});

test('16-bit PCM header bytes (stereo, 48 kHz)', () => {
  const L = Float32Array.from([0, 0.5, -0.5]);
  const R = Float32Array.from([1, -1, 0.25]);
  const ab = encodeWav(bufferLike([L, R]));
  const v = new DataView(ab);
  assert.equal(ab.byteLength, 44 + 3 * 4);
  assert.equal(ascii(v, 0), 'RIFF');
  assert.equal(v.getUint32(4, true), ab.byteLength - 8);
  assert.equal(ascii(v, 8), 'WAVE');
  assert.equal(ascii(v, 12), 'fmt ');
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), WAVE_FORMAT_PCM);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 4); // byte rate
  assert.equal(v.getUint16(32, true), 4); // block align
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(ascii(v, 36), 'data');
  assert.equal(v.getUint32(40, true), 12);
  // interleaved samples L0 R0 L1 R1 L2 R2
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)),
    [0, 32767, 16384, -32768, -16384, 8192],
  );
  // exact header prefix bytes
  assert.deepEqual([...new Uint8Array(ab, 0, 4)], [0x52, 0x49, 0x46, 0x46]);
  assert.deepEqual([...new Uint8Array(ab, 24, 4)], [0x80, 0xbb, 0x00, 0x00]); // 48000 LE
});

test('32-bit float header: format 3, cbSize, fact chunk, raw floats', () => {
  const M = Float32Array.from([0.1, -1.25, 0.75, 0]);
  const ab = encodeWav(bufferLike([M], 44100), { bitDepth: 32 });
  const v = new DataView(ab);
  assert.equal(ab.byteLength, 58 + 16);
  assert.equal(v.getUint32(16, true), 18);
  assert.equal(v.getUint16(20, true), WAVE_FORMAT_IEEE_FLOAT);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint32(28, true), 44100 * 4);
  assert.equal(v.getUint16(32, true), 4);
  assert.equal(v.getUint16(34, true), 32);
  assert.equal(v.getUint16(36, true), 0);
  assert.equal(ascii(v, 38), 'fact');
  assert.equal(v.getUint32(42, true), 4);
  assert.equal(v.getUint32(46, true), 4);
  assert.equal(ascii(v, 50), 'data');
  assert.equal(v.getUint32(54, true), 16);
  assert.equal(v.getFloat32(58 + 4, true), -1.25, 'float keeps overs');
  assert.equal(v.getUint32(4, true), ab.byteLength - 8);
});

test('round trip through parseWav, and plain { sampleRate, channels } input', () => {
  const n = 1000;
  const x = Float32Array.from({ length: n }, (_, i) => 0.8 * Math.sin(i / 7));
  const p16 = parseWav(encodeWav({ sampleRate: 22050, channels: [x] }));
  assert.equal(p16.sampleRate, 22050);
  assert.equal(p16.frames, n);
  // encode scales positives by 32767, the reader divides by 32768: ≤ 1.5 LSB apart
  for (let i = 0; i < n; i++) assert.ok(Math.abs(p16.data[0][i] - x[i]) <= 1.5 / 32767);
  const p32 = parseWav(encodeWav({ sampleRate: 22050, channels: [x, x] }, { bitDepth: 32 }));
  assert.equal(p32.channels, 2);
  assert.deepEqual(p32.data[1], x);
  assert.throws(
    () => encodeWav({ sampleRate: 48000, channels: [x] }, { bitDepth: 24 }),
    RangeError,
  );
  assert.throws(() => encodeWav({}), TypeError);
  assert.throws(() => parseWav(new ArrayBuffer(12)), /RIFF/);
});
