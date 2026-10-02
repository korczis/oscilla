// Pure numeric and encoding helpers, extracted from V1 (index.html@a7b7a23, section 2 HELPERS).
// Bodies are unchanged.

// V1: clamp, isNum, deepCopy, toNumber, toInt, pick, round, sig (index.html@a7b7a23)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const deepCopy = (o) => JSON.parse(JSON.stringify(o));

/** Coerce to a finite number inside [lo, hi]; anything else becomes the fallback. */
export function toNumber(v, fallback, lo = -Infinity, hi = Infinity) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isNum(n) ? clamp(n, lo, hi) : fallback;
}
export function toInt(v, fallback, lo, hi) {
  return Math.round(toNumber(v, fallback, lo, hi));
}
export function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}
export function round(v, digits) {
  const m = 10 ** digits;
  return Math.round((v + Number.EPSILON) * m) / m;
}
/** Significant-digit formatting without trailing zeros: 2.2727 -> "2.27", 50.0 -> "50". */
export function sig(v, digits = 3) {
  return String(Number(v.toPrecision(digits)));
}

// V1: base64UrlEncode, base64UrlDecode (index.html@a7b7a23). UTF-8 safe; uses the global
// TextEncoder/TextDecoder and btoa/atob (browsers, Node >= 16).
export function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64UrlDecode(text) {
  let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// V1: mulberry32 (index.html@a7b7a23)
/** Deterministic PRNG so the random pattern's preview equals what plays next. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
