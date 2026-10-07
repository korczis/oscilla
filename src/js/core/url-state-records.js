// A stored record in the URL hash (ADR 0048): the address of one experiment, definition or
// finding in the Experiments workspace, so that a connected record is a real link
// (ui/navigation.js, ADR 0045) that Back and Forward walk through. Pure.
//
// Format: `m=experiments` and exactly one of
//   exp=<experiment id>        a stored experiment (the saved record; a run is one capture)
//   def=<definition id>        a stored definition
//   finding=<finding id>       a stored finding
// e.g. `#m=experiments&exp=3f2c…`. A link carries an id, never a record: what it opens is what
// this browser stores under that id, and a record that is not stored here is said to be missing.
// Each codec reads only its own keys (the instrument, the recipe `mr`, the Studio keys), and
// withoutRecordParams() lets another workspace's address drop these.
//
// Reading a link is an import of untrusted text, like the Studio and recipe links:
// decodeRecordLink() refuses the whole link, never repairs it, when a key is repeated, more
// than one record is named, an id is empty or not an id (experiments/schema.js ID_PATTERN), or
// `m` names a workspace other than Experiments.
//
//   encodeRecordLink({ kind, id }) -> string         (hash without '#')
//   decodeRecordLink(hash) -> null                   (no record key in the hash)
//                           | { ok: true, kind, id } | { ok: false, errors }
//   withoutRecordParams(hash) -> string              (hash without '#', record keys out)

import { ID_PATTERN } from '../experiments/schema.js';

export const RECORD_LINK_MODE = 'experiments';
/** Record kind -> its hash key. */
export const RECORD_LINK_KEYS = Object.freeze({ experiment: 'exp', definition: 'def',
  finding: 'finding' });
export const RECORD_KINDS = Object.freeze(Object.keys(RECORD_LINK_KEYS));

const KEYS = Object.values(RECORD_LINK_KEYS);
const shown = (v) => JSON.stringify(String(v).slice(0, 32) + (String(v).length > 32 ? '…' : ''));

function params(hash) {
  try {
    return new URLSearchParams(String(hash || '').replace(/^#/, ''));
  } catch (e) {
    return new URLSearchParams();
  }
}

/** The hash (without '#') of a stored record's address; throws RangeError for a bad one. */
export function encodeRecordLink({ kind, id } = {}) {
  if (!RECORD_KINDS.includes(kind)) throw new RangeError(`unknown record kind ${shown(kind)}`);
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new RangeError(`${shown(id)} is not a record id`);
  }
  const q = new URLSearchParams();
  q.set('m', RECORD_LINK_MODE);
  q.set(RECORD_LINK_KEYS[kind], id);
  return q.toString();
}

/** See the header. Never throws. */
export function decodeRecordLink(hash) {
  const q = params(hash);
  const named = KEYS.filter((k) => q.has(k));
  if (!named.length) return null;
  const errors = [];
  for (const k of named) if (q.getAll(k).length > 1) errors.push(`"${k}" appears more than once`);
  if (named.length > 1) errors.push(`a link names one record (${named.join(', ')} given)`);
  const modes = q.getAll('m');
  if (modes.some((m) => m !== RECORD_LINK_MODE)) {
    errors.push(`a record link opens the Experiments workspace (m=${RECORD_LINK_MODE})`);
  }
  const key = named[0];
  const id = q.get(key);
  if (id === '') errors.push('the record id is empty');
  else if (!ID_PATTERN.test(id)) errors.push(`${shown(id)} is not a record id`);
  if (errors.length) return { ok: false, errors };
  const kind = RECORD_KINDS.find((k) => RECORD_LINK_KEYS[k] === key);
  return { ok: true, kind, id };
}

/** The hash (without '#') without the record keys; `m` is kept. */
export function withoutRecordParams(hash) {
  const q = params(hash);
  for (const k of KEYS) q.delete(k);
  return q.toString();
}
