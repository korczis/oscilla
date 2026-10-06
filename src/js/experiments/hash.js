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
//
// Result hash (spec §101), version 4 (current, ADR 0043): version 3 plus the recipe and the
// definition reference (schema.js `definition`: id, version, hash, derived and the execution
// it hashes), so a run cannot be moved to another definition, nor its recipe edited, without
// the hash failing:
//   { v: 4, results, quality, calibration, input, output, measurement, build, recipe,
//     definition }
// Version 3 (ADR 0040) = SHA-256 (lowercase hex) of the canonical JSON of
//   { v: 3, results, quality, calibration, input, output, measurement, build }
// (each serializeExperiment()'d; build = provenance.build), i.e. version 2 plus the measurement
// block (startedAt, sampleRate, the runs with their ids, notes) and the build that ran it
// (version, commit, sourceDigest, artifactSha256), so a run cannot be added, dropped,
// reordered or renamed, nor the result moved to another build, without the hash failing.
// Name, annotations, experimentId and lineage (repeatOf, duplicateOf) are not covered: a
// duplicate of a run keeps its hash. Version 2 (M11 of the V3 review):
//   { v: 2, results, quality, calibration, input, output }
// so the stored quality verdict and its mask, the calibration the result was shown with, the
// input it was captured from and the output level / master gain cannot be edited without the
// hash failing — version 1 covered the results only, so a file whose verdict was changed from
// POOR to GOOD still verified. provenance.resultHashVersion (2, 3, 4) says which version a file
// carries; a file without it is version 1 and is still verified as version 1:
//   { v: 1, results: serializeExperiment(e.results) }
// i.e. the results block { transfer, ir, rta, aggregate?, runTransfers? } (optional fields only
// when present, so a result without them hashes as before; for a repeated measurement the
// G20 marker transfer.derivedFrom and every stored run transfer are covered) with every
// typed array in its EncodedArray form (dtype + little-endian bytes, encode.js), so the hash covers the exact stored bits and the
// dtype, and does not depend on key order. It detects corruption of a stored or exported file;
// it is not a signature (anyone can recompute it). withResultHash stamps provenance.resultHash
// and provenance.resultHashVersion; schema.js withResults clears the hash when results or
// quality change; validate.js recomputes it (in the file's version) over the decoded experiment
// on import and rejects a mismatch as 'corrupt'.
//
//   resultCanonical(e, { version }) -> string;  resultHash(e, { sha256Hex, version }) -> hex
//   withResultHash(e, hex, version = RESULT_HASH_VERSION) -> a copy with provenance.resultHash
//     and provenance.resultHashVersion set (version 1 leaves resultHashVersion absent, the form
//     of a version-1 file)
//   resultHashVersionOf(e) -> 1 | 2 | 3 | 4
//
// Studio provenance hash (V3.1 spec §109, §162, ADR 0038): studioExecutionHash(execution) =
// SHA-256 (lowercase hex) of the canonical JSON of an experiment's studio.execution, which is
// studio/schema.js executionState(model); it therefore equals studio/schema.js studioHash(model)
// of the model that ran. It is NOT part of configHash: the recipe alone identifies "the same
// experiment setup" (ADR 0019), so a measurement run from Studio and the same measurement run
// from the Measure workspace share a configHash; the Studio block is provenance beside it.
//
//   studioExecutionHash(execution, { sha256Hex }) -> hex
//
// Measured path hash (ledger D3, ADR 0038 resolution 2026-10-06): an experiment's
// studio.measured = { v, nodes, edges, clips, hash } names, by id, the part of the recorded
// execution state the measurement depended on (studio/provenance.js measuredPath: the Sweep, its
// route to the Master Output, its reference into the Transfer Analyzer, the analyzer's observed
// chain and the measurement clips). measuredSelection(execution, ids) picks those records out of
// the execution state exactly as stored (and its schema version); measuredPathHash is the
// SHA-256 of its canonical JSON. Two runs with the same measured hash used the same Studio
// measurement whatever else their graphs held. Like studioHash it is outside configHash and every
// result hash; validate.js recomputes it, and studio/provenance.js verifyExperimentStudio checks
// that the ids are the path the graph really has.
//
//   measuredSelection(execution, { nodes, edges, clips }) -> plain data
//   measuredPathHash(execution, { nodes, edges, clips }, { sha256Hex }) -> hex

import { canonicalJson } from './canonical-json.js';
import { sha256Hex as defaultSha256Hex } from '../calibration/sha256.js';
import { HEX64_PATTERN, serializeExperiment } from './schema.js';

export const CONFIG_HASH_VERSION = 1;
/** Current result hash version (see the header); RESULT_HASH_VERSIONS are verifiable. */
export const RESULT_HASH_VERSION = 4;
export const RESULT_HASH_VERSIONS = Object.freeze([1, 2, 3, 4]);

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

/** The result hash version an experiment's provenance declares (absent: 1). */
export function resultHashVersionOf(e) {
  const v = e && e.provenance ? e.provenance.resultHashVersion : undefined;
  return v === undefined ? 1 : v;
}

function checkVersion(version) {
  if (!RESULT_HASH_VERSIONS.includes(version)) {
    throw new RangeError(`result hash version must be one of ${RESULT_HASH_VERSIONS.join(', ')}`);
  }
  return version;
}

/** Canonical JSON of what result hash `version` covers (see the header). */
export function resultCanonical(e, { version = RESULT_HASH_VERSION } = {}) {
  checkVersion(version);
  const results = e && e.results ? e.results : { transfer: null, ir: null, rta: null };
  if (version === 1) {
    return canonicalJson({ v: 1, results: serializeExperiment(results) });
  }
  const part = (k) => (e && e[k] !== undefined ? serializeExperiment(e[k]) : null);
  const block = { v: version, results: serializeExperiment(results), quality: part('quality'),
    calibration: part('calibration'), input: part('input'), output: part('output') };
  if (version >= 3) {
    block.measurement = part('measurement');
    block.build = e && e.provenance && e.provenance.build
      ? serializeExperiment(e.provenance.build) : null;
  }
  if (version === 4) {
    block.recipe = part('recipe');
    block.definition = part('definition');
  }
  return canonicalJson(block);
}

/** SHA-256 hex of the canonical block of result hash `version` (spec §101). */
export function resultHash(e, { sha256Hex = defaultSha256Hex, version = RESULT_HASH_VERSION }
  = {}) {
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('resultHash: sha256Hex must be a function');
  }
  return sha256Hex(resultCanonical(e, { version }));
}

/**
 * A copy of e with provenance.resultHash = hex (64 lowercase hex digits) and
 * provenance.resultHashVersion = version (omitted for version 1, the form of a v1 file).
 */
export function withResultHash(e, hex, version = RESULT_HASH_VERSION) {
  if (typeof hex !== 'string' || !HEX64_PATTERN.test(hex)) {
    throw new TypeError('withResultHash: expected a 64-digit lowercase hex SHA-256');
  }
  checkVersion(version);
  const provenance = { ...e.provenance, resultHash: hex };
  if (version === 1) delete provenance.resultHashVersion;
  else provenance.resultHashVersion = version;
  return { ...e, provenance };
}

/** SHA-256 hex of the canonical JSON of a Studio execution state (see the header). */
export function studioExecutionHash(execution, { sha256Hex = defaultSha256Hex } = {}) {
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('studioExecutionHash: sha256Hex must be a function');
  }
  return sha256Hex(canonicalJson(execution));
}

/** Version of the measured path selection and hash (the `v` of studio.measured). */
export const MEASURED_PATH_VERSION = 1;

/** The records of a Studio execution state that a measured path names (see the header). */
export function measuredSelection(execution, { nodes = [], edges = [], clips = [] } = {}) {
  const x = execution || {};
  const pick = (list, ids) => {
    const want = new Set(ids);
    return (Array.isArray(list) ? list : []).filter((r) => r && want.has(r.id));
  };
  return {
    v: MEASURED_PATH_VERSION,
    kind: 'oscilla-studio-measured-path',
    schemaVersion: x.schemaVersion ?? null,
    nodes: pick(x.nodes, nodes),
    edges: pick(x.edges, edges),
    clips: pick(x.timeline && x.timeline.clips, clips),
  };
}

/** SHA-256 hex of the canonical JSON of measuredSelection (see the header). */
export function measuredPathHash(execution, ids, { sha256Hex = defaultSha256Hex } = {}) {
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('measuredPathHash: sha256Hex must be a function');
  }
  return sha256Hex(canonicalJson(measuredSelection(execution, ids)));
}
