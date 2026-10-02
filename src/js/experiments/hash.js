// Experiment configuration hash (spec §100). Pure; no DOM, no globals.
//
// configHash = SHA-256 (lowercase hex) of the canonical JSON (canonical-json.js) of
//   { v: 1, recipe, calibration: { frequency: id|null, level: { referenceHz, referenceDbSpl,
//     observedDbRelative, offsetDb }|null }, sampleRate, algorithms, build: { version, commit } }
// i.e. what was configured and by which software — NOT timestamps, name, notes, input device,
// results, quality or UI state. Two experiments with equal hashes ran the same configuration.
//
//   configSelection(e) -> plain object;  configCanonical(e) -> string
//   configHash(e, { sha256Hex }) -> hex string (or a Promise of it for an async sha256Hex)
//   withConfigHash(e, hex) -> a copy with provenance.configHash set
//
// sha256Hex defaults to the bundled synchronous calibration/sha256.js (WebCrypto is async and
// missing in some file:// contexts); callers may inject another implementation.

import { canonicalJson } from './canonical-json.js';
import { sha256Hex as defaultSha256Hex } from '../calibration/sha256.js';
import { HEX64_PATTERN } from './schema.js';

export const CONFIG_HASH_VERSION = 1;

/** The configuration subset that the hash covers. */
export function configSelection(e) {
  const cal = e.calibration || {};
  const l = cal.level;
  const algorithms = {};
  for (const [role, id] of Object.entries(e.algorithms || {})) algorithms[role] = id;
  return {
    v: CONFIG_HASH_VERSION,
    recipe: e.recipe ?? null,
    calibration: {
      frequency: cal.frequency ? cal.frequency.id ?? null : null,
      level: l ? {
        referenceHz: l.referenceHz, referenceDbSpl: l.referenceDbSpl,
        observedDbRelative: l.observedDbRelative, offsetDb: l.offsetDb,
      } : null,
    },
    sampleRate: e.measurement ? e.measurement.sampleRate ?? null : null,
    algorithms,
    build: { version: e.oscillaVersion ?? null, commit: e.oscillaCommit ?? null },
  };
}

/** Canonical JSON of configSelection(e). */
export function configCanonical(e) {
  return canonicalJson(configSelection(e));
}

/** SHA-256 hex of the canonical configuration. */
export function configHash(e, { sha256Hex = defaultSha256Hex } = {}) {
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('configHash: sha256Hex must be a function');
  }
  return sha256Hex(configCanonical(e));
}

/** A copy of e with provenance.configHash = hex (validated as 64 lowercase hex digits). */
export function withConfigHash(e, hex) {
  if (typeof hex !== 'string' || !HEX64_PATTERN.test(hex)) {
    throw new TypeError('withConfigHash: expected a 64-digit lowercase hex SHA-256');
  }
  return { ...e, provenance: { ...e.provenance, configHash: hex } };
}
