// Build provenance at runtime. The product version is package.json "version"; this module is
// the only place the runtime learns it (scripts/release-metadata.mjs is the build-side twin).
//
// Sources, in order:
//   1. the inline metadata region <script type="application/json" id="oscilla-build"> that the
//      build writes into dist/index.html (channel "source", commit null) and the Pages
//      deployment stamps (channel "production", commit, sourceDate, artifactSha256);
//   2. the esbuild defines __OSCILLA_VERSION__ / __OSCILLA_SOURCE_DIGEST__ (bundle without a
//      region, e.g. a test harness page);
//   3. a dev fallback (node unit tests, unbundled dev previews): version DEV_VERSION, channel
//      "dev". It never claims a real product version.
// BUILD is frozen; window.OSCILLA.build exposes it read-only.

/* global __OSCILLA_VERSION__, __OSCILLA_SOURCE_DIGEST__ */

export const BUILD_REGION_ID = 'oscilla-build';
export const DEV_VERSION = '0.0.0-dev';
export const COMMIT_URL_BASE = 'https://github.com/korczis/oscilla/commit/';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Resolve the build record. Pure: the region text and the defines are arguments.
 * @param {{ regionText?: string|null, defined?: { version?: string|null,
 *   sourceDigest?: string|null } }} [input]
 */
export function resolveBuild({ regionText = null, defined = {} } = {}) {
  let region = null;
  let regionError = null;
  if (typeof regionText === 'string') {
    try {
      const parsed = JSON.parse(regionText);
      if (isObj(parsed) && str(parsed.version)) region = parsed;
      else regionError = 'metadata region has no version';
    } catch (e) {
      regionError = `metadata region is not valid JSON: ${e.message}`;
    }
  }
  const defVersion = str(defined.version);
  const defDigest = str(defined.sourceDigest);
  const src = region || {
    version: defVersion || DEV_VERSION,
    channel: defVersion ? 'source' : 'dev',
    sourceDigest: defDigest,
  };
  const commit = FULL_SHA.test(src.commit || '') ? src.commit : null;
  return Object.freeze({
    version: src.version,
    channel: str(src.channel) || 'source',
    sourceDigest: str(src.sourceDigest),
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    sourceDate: str(src.sourceDate),
    artifactSha256: str(src.artifactSha256),
    commitUrl: commit ? `${COMMIT_URL_BASE}${commit}` : null,
    origin: region ? 'region' : (defVersion ? 'define' : 'fallback'),
    // false when the region and the compiled-in defines disagree (a hand-edited region).
    consistent: !region || !defVersion
      || (region.version === defVersion && (region.sourceDigest || null) === defDigest),
    regionError,
  });
}

function definedValues() {
  return {
    version: typeof __OSCILLA_VERSION__ === 'string' ? __OSCILLA_VERSION__ : null,
    sourceDigest: typeof __OSCILLA_SOURCE_DIGEST__ === 'string' ? __OSCILLA_SOURCE_DIGEST__ : null,
  };
}

function regionText() {
  if (typeof document === 'undefined' || !document.getElementById) return null;
  const el = document.getElementById(BUILD_REGION_ID);
  return el ? el.textContent : null;
}

export const BUILD = resolveBuild({ regionText: regionText(), defined: definedValues() });
