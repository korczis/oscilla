// The lab link key: `lab=` carries the Filter, Envelope (ADSR), Additive and Phase & Stereo
// settings of a config link as base64url JSON of the lab sections (ui/config-file.js
// buildLabSections shape). One more codec of the shared hash (ADR 0045), outside the V1
// instrument keys (core/url-state.js serializeHash is unchanged and never reads it). The
// sequence is not carried: it is a workspace document, and a link holds no large state
// (spec section 200); it travels in the config file.
//
// This module only encodes and decodes; the sections are validated where they are applied
// (ui/config-file.js parseLabSections, the path the config file and the stored records take).
//
//   encodeLabParam(sections) -> string
//   decodeLabParam(hash) -> null (no key) | { ok: true, sections } | { ok: false, error }
//   withoutLabParam(hash) -> string (hash without '#' and without the key)

import { base64UrlDecode, base64UrlEncode } from './math.js';

export const LAB_HASH_KEY = 'lab';
/** A link longer than this is refused, not parsed (the sections fit in well under 2 kB). */
export const LAB_PARAM_MAX = 4096;

const strip = (hash) => String(hash || '').replace(/^#/, '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The `lab=` value of a set of lab sections. */
export function encodeLabParam(sections) {
  if (!isObj(sections)) throw new TypeError('encodeLabParam: the lab sections are an object');
  return base64UrlEncode(JSON.stringify(sections));
}

/** The lab sections a hash carries; null when it has no `lab=` key. Never throws. */
export function decodeLabParam(hash) {
  let q;
  try {
    q = new URLSearchParams(strip(hash));
  } catch (e) {
    return null;
  }
  const all = q.getAll(LAB_HASH_KEY);
  if (!all.length) return null;
  if (all.length > 1) return { ok: false, error: 'the link names `lab` more than once' };
  const raw = all[0];
  if (!raw || raw.length > LAB_PARAM_MAX) {
    return { ok: false, error: `the \`lab\` value is empty or longer than ${LAB_PARAM_MAX}` };
  }
  let sections;
  try {
    sections = JSON.parse(base64UrlDecode(raw));
  } catch (e) {
    return { ok: false, error: 'the `lab` value is not base64url JSON' };
  }
  if (!isObj(sections)) return { ok: false, error: 'the `lab` value is not an object' };
  return { ok: true, sections };
}

/** The hash (without '#') with the `lab=` key removed, every other key kept. */
export function withoutLabParam(hash) {
  const q = new URLSearchParams(strip(hash));
  q.delete(LAB_HASH_KEY);
  return q.toString();
}
