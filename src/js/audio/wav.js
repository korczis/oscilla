// RIFF/WAVE encoder (and a minimal parser for verification). Pure: no Web Audio objects
// needed; anything shaped like an AudioBuffer works ({ numberOfChannels, sampleRate, length,
// getChannelData(ch) }), as does { sampleRate, channels: Float32Array[] }.
//
// 16-bit: WAVE_FORMAT_PCM (1), 16-byte fmt chunk, interleaved little-endian int16. Samples are
// clamped to [−1, 1] and scaled asymmetrically (×32768 below zero, ×32767 above) so that −1 and
// +1 both map to the extreme codes; rounding to nearest, no dither (quantisation noise ≈ −98 dBFS).
// 32-bit float: WAVE_FORMAT_IEEE_FLOAT (3), 18-byte fmt chunk (cbSize = 0) and a 'fact' chunk
// with the frame count, as the format specification requires for non-PCM data. Samples are
// written unclamped (float keeps overs).

export const WAVE_FORMAT_PCM = 1;
export const WAVE_FORMAT_IEEE_FLOAT = 3;

function channelsOf(buffer) {
  if (buffer && Array.isArray(buffer.channels)) {
    const len = buffer.channels.reduce((m, c) => Math.max(m, c.length), 0);
    return { sampleRate: buffer.sampleRate, channels: buffer.channels, length: len };
  }
  if (buffer && typeof buffer.getChannelData === 'function') {
    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    return { sampleRate: buffer.sampleRate, channels, length: buffer.length };
  }
  throw new TypeError('encodeWav needs an AudioBuffer or { sampleRate, channels }');
}

function writeAscii(view, offset, s) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/** int16 code for a float sample (clamped, asymmetric scaling, round to nearest). */
export function floatToInt16(x) {
  const s = x > 1 ? 1 : x < -1 ? -1 : x || 0;
  return s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
}

/**
 * encodeWav(buffer, { bitDepth = 16 }) → ArrayBuffer
 * bitDepth 16 (PCM int16) or 32 (IEEE float32).
 */
export function encodeWav(buffer, options = {}) {
  const bitDepth = options.bitDepth || 16;
  if (bitDepth !== 16 && bitDepth !== 32) throw new RangeError('bitDepth must be 16 or 32');
  const { sampleRate, channels, length } = channelsOf(buffer);
  const nch = channels.length;
  if (!(nch >= 1)) throw new RangeError('encodeWav needs at least one channel');
  if (!(sampleRate > 0) || !Number.isInteger(sampleRate))
    throw new RangeError('invalid sample rate');
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = nch * bytesPerSample;
  const dataBytes = length * blockAlign;
  const fmtBytes = isFloat ? 18 : 16;
  const factBytes = isFloat ? 12 : 0;
  const headerBytes = 12 + 8 + fmtBytes + factBytes + 8;
  if (headerBytes + dataBytes - 8 > 0xffffffff)
    throw new RangeError('audio too long for a WAV file');
  const ab = new ArrayBuffer(headerBytes + dataBytes);
  const v = new DataView(ab);
  let o = 0;
  writeAscii(v, o, 'RIFF');
  o += 4;
  v.setUint32(o, headerBytes + dataBytes - 8, true);
  o += 4;
  writeAscii(v, o, 'WAVE');
  o += 4;
  writeAscii(v, o, 'fmt ');
  o += 4;
  v.setUint32(o, fmtBytes, true);
  o += 4;
  v.setUint16(o, isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM, true);
  o += 2;
  v.setUint16(o, nch, true);
  o += 2;
  v.setUint32(o, sampleRate, true);
  o += 4;
  v.setUint32(o, sampleRate * blockAlign, true);
  o += 4;
  v.setUint16(o, blockAlign, true);
  o += 2;
  v.setUint16(o, bitDepth, true);
  o += 2;
  if (isFloat) {
    v.setUint16(o, 0, true);
    o += 2; // cbSize
    writeAscii(v, o, 'fact');
    o += 4;
    v.setUint32(o, 4, true);
    o += 4;
    v.setUint32(o, length, true);
    o += 4;
  }
  writeAscii(v, o, 'data');
  o += 4;
  v.setUint32(o, dataBytes, true);
  o += 4;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < nch; ch++) {
      const x = i < channels[ch].length ? channels[ch][i] : 0;
      if (isFloat) {
        v.setFloat32(o, x, true);
        o += 4;
      } else {
        v.setInt16(o, floatToInt16(x), true);
        o += 2;
      }
    }
  }
  return ab;
}

/** Wrap encoded bytes in a Blob (browser only). */
export function wavBlob(arrayBuffer) {
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/** encodeWav + wavBlob. */
export function audioBufferToWavBlob(buffer, options) {
  return wavBlob(encodeWav(buffer, options));
}

/**
 * parseWav(arrayBuffer) → { format, channels, sampleRate, byteRate, blockAlign, bitDepth,
 *   frames, data: Float32Array[] } — reads what encodeWav writes (PCM16, float32), for tests
 * and import checks. Throws on anything else.
 */
export function parseWav(ab) {
  const v = new DataView(ab);
  const tag = (o) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let o = 12;
  let fmt = null;
  let frames = null;
  while (o + 8 <= ab.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        byteRate: v.getUint32(body + 8, true),
        blockAlign: v.getUint16(body + 12, true),
        bitDepth: v.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      const n = Math.floor(size / fmt.blockAlign);
      frames = n;
      const data = [];
      for (let ch = 0; ch < fmt.channels; ch++) data.push(new Float32Array(n));
      let p = body;
      for (let i = 0; i < n; i++) {
        for (let ch = 0; ch < fmt.channels; ch++) {
          if (fmt.format === WAVE_FORMAT_IEEE_FLOAT && fmt.bitDepth === 32) {
            data[ch][i] = v.getFloat32(p, true);
            p += 4;
          } else if (fmt.format === WAVE_FORMAT_PCM && fmt.bitDepth === 16) {
            data[ch][i] = v.getInt16(p, true) / 32768;
            p += 2;
          } else {
            throw new Error(`unsupported WAV format ${fmt.format}/${fmt.bitDepth}`);
          }
        }
      }
      return { ...fmt, frames, data };
    }
    o = body + size + (size & 1);
  }
  throw new Error('no data chunk');
}
