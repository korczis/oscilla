// Build provenance at runtime. The product version is package.json "version"; this module is
// the only place the runtime learns it (scripts/release-metadata.mjs is the build-side twin).
//
// Sources, in order:
//   1. the inline metadata region <script type="application/json" id="oscilla-build"> that the
//      build writes into dist/index.html (channel "source", commit null) and the Pages
//      deployment stamps (channel "production", commit, sourceDate, artifactSha256, and the
//      release state: release "tagged" | "after-tag" | "untagged" with distance, ADR 0059);
//   2. the esbuild defines __OSCILLA_VERSION__ / __OSCILLA_SOURCE_DIGEST__ (bundle without a
//      region, e.g. a test harness page);
//   3. a dev fallback (node unit tests, unbundled dev previews): version DEV_VERSION, channel
//      "dev". It never claims a real product version.
// BUILD is frozen; window.OSCILLA.build exposes it read-only. BUILD.version is package.json's;
// BUILD.label is what the page shows as its version: the bare version, except for a deployed
// commit after its version's tag, which is <version>+<distance>.g<shortCommit> (git-describe
// style), so a later build never presents itself as the release (releaseLabel() in
// scripts/release-metadata.mjs is the build-side twin; tests/unit/release-provenance.test.mjs
// holds them equal).

/* global __OSCILLA_VERSION__, __OSCILLA_SOURCE_DIGEST__ */

export const BUILD_REGION_ID = 'oscilla-build';
export const DEV_VERSION = '0.0.0-dev';
export const COMMIT_URL_BASE = 'https://github.com/korczis/oscilla/commit/';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_STATES = ['tagged', 'after-tag', 'untagged'];

/** One line for the About page: whether this build is the release its version names. */
function releaseText(version, release, distance) {
  if (release === 'tagged') return `the v${version} release`;
  if (release === 'after-tag' && distance > 0) {
    return `${distance} commit${distance === 1 ? '' : 's'} after the v${version} release`;
  }
  if (release === 'untagged') return `v${version}, not yet tagged when deployed`;
  return 'not a deployed release (source build)';
}

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
  const release = RELEASE_STATES.includes(src.release) ? src.release : null;
  const distance = Number.isInteger(src.distance) ? src.distance : null;
  const after = release === 'after-tag' && distance > 0 && commit;
  return Object.freeze({
    version: src.version,
    channel: str(src.channel) || 'source',
    sourceDigest: str(src.sourceDigest),
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    sourceDate: str(src.sourceDate),
    artifactSha256: str(src.artifactSha256),
    commitUrl: commit ? `${COMMIT_URL_BASE}${commit}` : null,
    release,
    distance,
    label: after ? `${src.version}+${distance}.g${commit.slice(0, 7)}` : src.version,
    releaseText: releaseText(src.version, release, distance),
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
