// Portable typed-array encoding for large experiment result arrays (spec §56-§57). Pure; no
// DOM, no globals (base64 is implemented here, so neither btoa/atob nor Buffer is needed).
//
//   EncodedArray = { dtype: 'f32'|'f64'|'u8', length, encoding: 'base64-le', data }
//
// `data` is standard base64 (RFC 4648 §4, with '=' padding) of the elements written
// little-endian explicitly (DataView, littleEndian = true), so a file is portable across
// platforms regardless of the host's byte order. `length` is the element count and must match
// the decoded byte count exactly. Plain number arrays stay accepted for small vectors.
//
//   encodeArray(values, dtype?) -> EncodedArray
//   decodeArray(encoded, { dtype?, maxLength? }) -> Float32Array | Float64Array | Uint8Array
//   isEncodedArray(v) -> bool
//   encodeBase64(bytes: Uint8Array) -> string;  decodeBase64(text) -> Uint8Array (strict)
// Decoding errors are thrown as EncodingError (a TypeError) with a readable message.

export const ARRAY_ENCODING = 'base64-le';
export const DTYPES = Object.freeze({
  f32: Object.freeze({ bytes: 4, ctor: Float32Array }),
  f64: Object.freeze({ bytes: 8, ctor: Float64Array }),
  u8: Object.freeze({ bytes: 1, ctor: Uint8Array }),
});
const ENCODED_KEYS = ['data', 'dtype', 'encoding', 'length'];

export class EncodingError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'EncodingError';
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENC = new Uint8Array(64);
const DEC = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  ENC[i] = ALPHABET.charCodeAt(i);
  DEC[ALPHABET.charCodeAt(i)] = i;
}
const PAD = 61; // '='
const CHUNK = 0x8000;

/** The dtype of a typed array, or null. */
export function dtypeOf(values) {
  if (values instanceof Float32Array) return 'f32';
  if (values instanceof Float64Array) return 'f64';
  if (values instanceof Uint8Array) return 'u8';
  return null;
}

/** Base64 length for `bytes` bytes (with padding). */
export function base64Length(bytes) {
  return Math.ceil(bytes / 3) * 4;
}

/** True when v has exactly the EncodedArray keys (the values are checked by decodeArray). */
export function isEncodedArray(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return false;
  const keys = Object.keys(v).sort();
  return keys.length === ENCODED_KEYS.length && keys.every((k, i) => k === ENCODED_KEYS[i]);
}

/**
 * Encode a typed array or a plain number array. dtype defaults to the typed array's own; it is
 * required for plain arrays. Values are converted to the dtype (f32 rounds, u8 must already be
 * integers 0..255). The input is not modified.
 */
export function encodeArray(values, dtype = dtypeOf(values)) {
  const spec = DTYPES[dtype];
  if (!spec) throw new EncodingError(`encodeArray: unknown dtype ${JSON.stringify(dtype)}`);
  if (!(Array.isArray(values) || (ArrayBuffer.isView(values) && !(values instanceof DataView)))) {
    throw new EncodingError('encodeArray: values must be an array or a typed array');
  }
  const n = values.length;
  const bytes = new Uint8Array(n * spec.bytes);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number') throw new EncodingError(`encodeArray: element ${i} is not a number`);
    if (dtype === 'f32') view.setFloat32(i * 4, v, true);
    else if (dtype === 'f64') view.setFloat64(i * 8, v, true);
    else {
      if (!Number.isInteger(v) || v < 0 || v > 255) {
        throw new EncodingError(`encodeArray: element ${i} is not a u8 value`);
      }
      bytes[i] = v;
    }
  }
  return { dtype, length: n, encoding: ARRAY_ENCODING, data: encodeBase64(bytes) };
}

/**
 * Decode an EncodedArray into a new typed array. opts.dtype (string or list) restricts the
 * accepted dtypes; opts.maxLength bounds the declared length BEFORE anything is allocated, and
 * the base64 text length must match the declared length exactly.
 */
export function decodeArray(encoded, opts = {}) {
  if (!isEncodedArray(encoded)) {
    throw new EncodingError('expected { dtype, length, encoding, data } and no other keys');
  }
  const { dtype, length, encoding, data } = encoded;
  const spec = Object.prototype.hasOwnProperty.call(DTYPES, dtype) ? DTYPES[dtype] : null;
  if (!spec) throw new EncodingError(`unknown dtype ${JSON.stringify(String(dtype)).slice(0, 40)}`);
  const allowed = opts.dtype == null ? null : [].concat(opts.dtype);
  if (allowed && !allowed.includes(dtype)) {
    throw new EncodingError(`dtype ${dtype} not allowed here (expected ${allowed.join(' or ')})`);
  }
  if (encoding !== ARRAY_ENCODING) {
    throw new EncodingError(`unsupported encoding (expected "${ARRAY_ENCODING}")`);
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new EncodingError('length must be a non-negative integer');
  }
  const maxLength = opts.maxLength ?? Infinity;
  if (length > maxLength) {
    throw new EncodingError(`length ${length} exceeds the limit of ${maxLength} elements`);
  }
  if (typeof data !== 'string') throw new EncodingError('data must be a base64 string');
  const byteLength = length * spec.bytes;
  if (data.length !== base64Length(byteLength)) {
    throw new EncodingError(`declared length ${length} (${byteLength} bytes) does not match `
      + `the data (${data.length} base64 characters)`);
  }
  const bytes = decodeBase64(data);
  if (bytes.length !== byteLength) {
    throw new EncodingError(`declared length ${length} does not match ${bytes.length} `
      + 'decoded bytes');
  }
  if (dtype === 'u8') return bytes;
  const out = new spec.ctor(length);
  const view = new DataView(bytes.buffer);
  if (dtype === 'f32') for (let i = 0; i < length; i++) out[i] = view.getFloat32(i * 4, true);
  else for (let i = 0; i < length; i++) out[i] = view.getFloat64(i * 8, true);
  return out;
}

/** Standard base64 with padding. */
export function encodeBase64(bytes) {
  const n = bytes.length;
  const out = new Uint8Array(base64Length(n));
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const t = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = ENC[t >>> 18];
    out[o++] = ENC[(t >>> 12) & 63];
    out[o++] = ENC[(t >>> 6) & 63];
    out[o++] = ENC[t & 63];
  }
  if (i < n) {
    const rest = n - i;
    const t = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out[o++] = ENC[t >>> 18];
    out[o++] = ENC[(t >>> 12) & 63];
    out[o++] = rest === 2 ? ENC[(t >>> 6) & 63] : PAD;
    out[o++] = PAD;
  }
  let s = '';
  for (let k = 0; k < out.length; k += CHUNK) {
    s += String.fromCharCode.apply(null, out.subarray(k, k + CHUNK));
  }
  return s;
}

/**
 * Strict standard base64: length a multiple of 4, only the RFC 4648 alphabet, '=' only as the
 * last one or two characters, unused trailing bits zero. Anything else throws EncodingError.
 */
export function decodeBase64(text) {
  if (typeof text !== 'string') throw new EncodingError('base64 data must be a string');
  const len = text.length;
  if (len % 4 !== 0) throw new EncodingError('base64 length is not a multiple of 4');
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (text.charCodeAt(len - 1) === PAD) pad = text.charCodeAt(len - 2) === PAD ? 2 : 1;
  const out = new Uint8Array((len / 4) * 3 - pad);
  const sextet = (k) => {
    const c = text.charCodeAt(k);
    const v = c < 128 ? DEC[c] : -1;
    if (v < 0) throw new EncodingError(`invalid base64 character at offset ${k}`);
    return v;
  };
  let o = 0;
  const full = pad ? len - 4 : len;
  for (let k = 0; k < full; k += 4) {
    const t = (sextet(k) << 18) | (sextet(k + 1) << 12) | (sextet(k + 2) << 6) | sextet(k + 3);
    out[o++] = t >>> 16;
    out[o++] = (t >>> 8) & 255;
    out[o++] = t & 255;
  }
  if (pad) {
    const a = sextet(len - 4);
    const b = sextet(len - 3);
    if (pad === 2) {
      if (b & 15) throw new EncodingError('non-canonical base64 padding');
      out[o++] = (a << 2) | (b >>> 4);
    } else {
      const c = sextet(len - 2);
      if (c & 3) throw new EncodingError('non-canonical base64 padding');
      const t = (a << 18) | (b << 12) | (c << 6);
      out[o++] = t >>> 16;
      out[o++] = (t >>> 8) & 255;
    }
  }
  return out;
}
