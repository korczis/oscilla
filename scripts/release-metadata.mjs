// The ONE helper for the OSCILLA product version and build provenance. build.mjs,
// stamp-build.mjs, verify-dist.mjs, verify-deploy.mjs and the release-*.mjs scripts all consume
// it; nothing else computes a version, a digest or a provenance record.
//
// Version authority: package.json "version" is the only product version. Everything else
// (dist banner and metadata region, the esbuild define behind src/js/core/build-info.js,
// window.OSCILLA.version, the config export's oscillaVersion, tests) is projected from it.
//
// Why package.json carries the plain V2 major (major 2, minor 0, patch 0; previously the
// "-dev" prerelease of it): that version was never tagged and never released (the only
// reachable tag is v1.0.0; there is no GitHub Release), while the public UI has shown it since
// V2 shipped. Policy: main carries the version of the next or most recent release, so the
// first formal V2 release is that version itself and release:prepare confirms it instead of
// bumping. Later bumps happen only in release:prepare. (This note avoids spelling the version
// out: version:check rejects a hard-coded copy of the current version anywhere but
// package.json.)
//
// Product version vs schema versions: config "version": 1, preset schema 1, URL v=1, sequence
// schema 1 and the frozen V1 stamp APP_VERSION '1.0.0' (core/constants.js) are data-format
// versions. They are never derived from, nor bumped with, the product version.
//
// Provenance (the committed dist cannot contain the SHA of the commit that contains it):
//   build time   deterministic record: version, sourceDigest, channel "source", commit null.
//   deploy time  stamp-build.mjs rewrites ONLY the metadata region: commit, shortCommit,
//                channel "production", sourceDate (commit timestamp) and artifactSha256 (sha256
//                of the unstamped committed dist). normalizeStamped() reverses it byte for byte.
//
// Pure functions take their inputs as arguments (file entries, a git runner, env), so the unit
// tests drive them with fixtures; the defaults read the repository this file lives in.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PRODUCT = 'OSCILLA';
export const REPO_URL = 'https://github.com/korczis/oscilla';
export const PUBLIC_URL = 'https://korczis.github.io/oscilla/';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ------------------------------------------------------------------------------- semver
// SemVer 2 core + optional prerelease; build metadata is not used by this project.
const NUM = '0|[1-9]\\d*';
const PRE_ID = `(?:${NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(`^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?$`);

/** '2.1.0-rc.1' -> { major: 2, minor: 1, patch: 0, prerelease: ['rc', 1] }; null if invalid. */
export function parseSemver(text) {
  const m = SEMVER.exec(String(text ?? '').trim());
  if (!m) return null;
  const prerelease = m[4] === undefined ? [] : m[4].split('.')
    .map((id) => (/^\d+$/.test(id) ? Number(id) : id));
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

export function formatSemver(v) {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease && v.prerelease.length ? `${core}-${v.prerelease.join('.')}` : core;
}

/** SemVer precedence: negative, 0 or positive. */
export function compareSemver(a, b) {
  const x = typeof a === 'string' ? parseSemver(a) : a;
  const y = typeof b === 'string' ? parseSemver(b) : b;
  if (!x || !y) throw new Error(`not a semantic version: ${!x ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  const [p, q] = [x.prerelease, y.prerelease];
  if (!p.length || !q.length) return (q.length ? 1 : 0) - (p.length ? 1 : 0) || 0;
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const [n, m] = [typeof p[i] === 'number', typeof q[i] === 'number'];
    if (n && m) return p[i] - q[i];
    if (n !== m) return n ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Next version for a release level. level: 'major' | 'minor' | 'patch' | 'prerelease'.
 * A prerelease of an already-prereleased version increments its counter (2.1.0-rc.1 -> rc.2);
 * a release level applied to a prerelease of that level finalises it (2.1.0-rc.2 + minor ->
 * 2.1.0), as npm version does.
 * @param {string} version
 * @param {string} level
 * @param {{ preid?: string, preLevel?: 'major'|'minor'|'patch' }} [o]
 */
export function bumpVersion(version, level, { preid = 'rc', preLevel = 'patch' } = {}) {
  const v = parseSemver(version);
  if (!v) throw new Error(`not a semantic version: ${version}`);
  const pre = v.prerelease.length > 0;
  const next = { major: v.major, minor: v.minor, patch: v.patch, prerelease: [] };
  if (level === 'major') {
    if (!(pre && v.minor === 0 && v.patch === 0)) {
      Object.assign(next, { major: v.major + 1, minor: 0, patch: 0 });
    }
  } else if (level === 'minor') {
    if (!(pre && v.patch === 0)) Object.assign(next, { minor: v.minor + 1, patch: 0 });
  } else if (level === 'patch') {
    if (!pre) next.patch = v.patch + 1;
  } else if (level === 'prerelease') {
    const last = v.prerelease[v.prerelease.length - 1];
    if (pre && v.prerelease[0] === preid && typeof last === 'number') {
      next.prerelease = [...v.prerelease.slice(0, -1), last + 1];
    } else {
      const base = pre ? next : parseSemver(bumpVersion(version, preLevel));
      Object.assign(next, base, { prerelease: [preid, 1] });
    }
  } else {
    throw new Error(`unknown release level: ${level}`);
  }
  return formatSemver(next);
}

// ------------------------------------------------------------------------------- version
export function readPackage(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/** package.json "version", validated. Throws if it is not a semantic version. */
export function readVersion(root = ROOT) {
  const { version } = readPackage(root);
  if (!parseSemver(version)) throw new Error(`package.json version "${version}" is not SemVer`);
  return version;
}

// ------------------------------------------------------------------------------- digest
// The build inputs: everything that can change dist/index.html. Directories are walked
// recursively; names starting with "." (.DS_Store, editor swap files) are skipped so a local
// checkout and CI hash the same set. node_modules content is pinned by package-lock.json.
export const SOURCE_DIRS = ['src', 'licenses'];
export const SOURCE_FILES = [
  'LICENSE', 'package.json', 'package-lock.json', 'scripts/pack-single-file.mjs',
  'scripts/release-metadata.mjs',
];
export const SOURCE_SCRIPT_PATTERN = /^build[^/]*\.mjs$/; // scripts/build*.mjs

/** Sorted repository-relative POSIX paths of the build inputs. */
export function listSourceInputs(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile()) out.push(child);
    }
  };
  for (const dir of SOURCE_DIRS) if (existsSync(path.join(root, dir))) walk(dir);
  for (const file of SOURCE_FILES) if (existsSync(path.join(root, file))) out.push(file);
  for (const name of readdirSync(path.join(root, 'scripts'))) {
    if (SOURCE_SCRIPT_PATTERN.test(name)) out.push(`scripts/${name}`);
  }
  return [...new Set(out)].sort(byCodeUnit);
}

function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The digest manifest: one "<sha256(content)>  <path>\n" line per input (the sha256sum
 * format), sorted by path. The source digest is sha256(manifest), so it can be reproduced with
 * `sha256sum <files> | sort -k2 | sha256sum` style tooling.
 * @param {{ path: string, content: Buffer|string }[]} entries
 */
export function sourceManifest(entries) {
  const sorted = [...entries].sort((a, b) => byCodeUnit(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].path === sorted[i - 1].path) throw new Error(`duplicate input ${sorted[i].path}`);
  }
  return sorted.map((e) => `${sha256(e.content)}  ${e.path}\n`).join('');
}

export function digestEntries(entries) {
  return sha256(sourceManifest(entries));
}

export function readSourceInputs(root = ROOT) {
  return listSourceInputs(root)
    .map((p) => ({ path: p, content: readFileSync(path.join(root, p)) }));
}

/** sha256 over the sorted (path, content) of the build inputs. Deterministic, no clock. */
export function computeSourceDigest(root = ROOT) {
  return digestEntries(readSourceInputs(root));
}

// ------------------------------------------------------------------------------- git
export function gitRunner(root = ROOT) {
  return (args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const SHA = /^[0-9a-f]{40}$/;
export const isFullSha = (s) => typeof s === 'string' && SHA.test(s);

/** Commit timestamp of `rev` as an ISO-8601 UTC string without milliseconds. */
export function commitDate(rev, run = gitRunner()) {
  const seconds = Number(run(['show', '-s', '--format=%ct', rev]));
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`no commit date for ${rev}`);
  return isoSeconds(seconds);
}

export const isoSeconds = (s) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');

/**
 * Git facts; every field is null when git (or the repository) is unavailable.
 * @param {{ run?: (args: string[]) => string, rev?: string }} [o]
 */
export function gitInfo({ run = gitRunner(), rev = 'HEAD' } = {}) {
  try {
    const commit = run(['rev-parse', '--verify', `${rev}^{commit}`]);
    if (!isFullSha(commit)) throw new Error(`unexpected rev-parse output ${commit}`);
    const dirty = run(['status', '--porcelain', '--untracked-files=normal']) !== '';
    return { commit, shortCommit: commit.slice(0, 7), sourceDate: commitDate(commit, run), dirty };
  } catch {
    return { commit: null, shortCommit: null, sourceDate: null, dirty: null };
  }
}

/**
 * Everything a script may want to know about this checkout.
 * channel: "source" for local and committed builds; "production" only once stamped for Pages.
 * @param {{ root?: string, run?: Function, env?: object, entries?: object[] }} [o]
 * @returns {{ version, sourceDigest, commit, shortCommit, sourceDate, dirty, channel }}
 */
export function releaseMetadata({
  root = ROOT, run = gitRunner(root), env = process.env, entries,
} = {}) {
  const version = readVersion(root);
  const sourceDigest = entries ? digestEntries(entries) : computeSourceDigest(root);
  const git = gitInfo({ run });
  const channel = env.OSCILLA_CHANNEL || 'source';
  return { version, sourceDigest, ...git, channel };
}

// ------------------------------------------------------------------------------- region
// dist/index.html carries exactly one metadata region, in <head>:
//   <script type="application/json" id="oscilla-build">{…}</script>
// with these keys, in this order. src/js/core/build-info.js parses it at runtime.
export const REGION_ID = 'oscilla-build';
export const REGION_OPEN = `<script type="application/json" id="${REGION_ID}">`;
export const REGION_CLOSE = '</script>';
export const REGION_SCHEMA = 1;
export const REGION_KEYS = [
  'schema', 'product', 'version', 'channel', 'sourceDigest', 'commit', 'shortCommit',
  'sourceDate', 'artifactSha256',
];
export const CHANNELS = ['source', 'production'];

/** The deterministic build-time record: no commit, no date, channel "source". */
export function sourceRecord({ version, sourceDigest }) {
  return {
    schema: REGION_SCHEMA, product: PRODUCT, version, channel: 'source', sourceDigest,
    commit: null, shortCommit: null, sourceDate: null, artifactSha256: null,
  };
}

/** Problems with a parsed region record (empty = well-formed). */
export function validateRecord(r) {
  const problems = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['region is not a JSON object'];
  const keys = Object.keys(r);
  if (keys.join() !== REGION_KEYS.join()) {
    problems.push(`region keys ${JSON.stringify(keys)} != ${JSON.stringify(REGION_KEYS)}`);
  }
  if (r.schema !== REGION_SCHEMA) problems.push(`region schema ${r.schema} != ${REGION_SCHEMA}`);
  if (r.product !== PRODUCT) problems.push(`region product ${JSON.stringify(r.product)}`);
  const hex64 = (v) => /^[0-9a-f]{64}$/.test(v || '');
  if (!parseSemver(r.version)) problems.push(`region version ${JSON.stringify(r.version)} invalid`);
  if (!hex64(r.sourceDigest)) problems.push('region sourceDigest is not sha256 hex');
  if (!CHANNELS.includes(r.channel)) problems.push(`region channel ${JSON.stringify(r.channel)}`);
  if (r.channel === 'source') {
    for (const k of ['commit', 'shortCommit', 'sourceDate', 'artifactSha256']) {
      if (r[k] !== null) problems.push(`source-channel region must have ${k} null`);
    }
  } else {
    if (!isFullSha(r.commit)) problems.push('region commit is not a full SHA');
    if (!r.commit || r.shortCommit !== r.commit.slice(0, 7)) {
      problems.push('region shortCommit mismatch');
    }
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.sourceDate || '')) {
      problems.push('region sourceDate is not ISO-8601 UTC');
    }
    if (!hex64(r.artifactSha256)) problems.push('region artifactSha256 is not sha256 hex');
  }
  return problems;
}

/** Canonical bytes of a region. "<" is escaped so the JSON can never end the element. */
export function renderRegion(record) {
  const ordered = Object.fromEntries(REGION_KEYS.map((k) => [k, record[k] ?? null]));
  return `${REGION_OPEN}${JSON.stringify(ordered).replace(/</g, '\\u003c')}${REGION_CLOSE}`;
}

/**
 * Locate the one region. Throws unless there is exactly one.
 * @returns {{ start: number, end: number, json: string, record: object }}
 */
export function findRegion(html) {
  const count = html.split(REGION_OPEN).length - 1;
  if (count !== 1) {
    throw new Error(`metadata region ${REGION_OPEN} found ${count} times, expected 1`);
  }
  const start = html.indexOf(REGION_OPEN);
  const close = html.indexOf(REGION_CLOSE, start + REGION_OPEN.length);
  if (close < 0) throw new Error('metadata region is not terminated');
  const json = html.slice(start + REGION_OPEN.length, close);
  let record;
  try {
    record = JSON.parse(json);
  } catch (e) {
    throw new Error(`metadata region is not valid JSON: ${e.message}`);
  }
  return { start, end: close + REGION_CLOSE.length, json, record };
}

/** Parsed region record, or null when the document has none (or a malformed one). */
export function readRegion(html) {
  try {
    return findRegion(html).record;
  } catch {
    return null;
  }
}

export function replaceRegion(html, record) {
  const { start, end } = findRegion(html);
  return html.slice(0, start) + renderRegion(record) + html.slice(end);
}

/** Reverse a deploy stamp: the region goes back to its build-time (source) record. */
export function normalizeStamped(html) {
  const { record } = findRegion(html);
  return replaceRegion(html, sourceRecord(record));
}

/**
 * Deploy-time stamp. Rewrites ONLY the region. Idempotent: stamping a stamped file with the
 * same inputs returns the same bytes, because the stamp is computed from the normalised file.
 * @param {string} html  unstamped (or already stamped) dist/index.html
 * @param {{ commit: string, sourceDate: string, channel?: string }} o
 */
export function stampHtml(html, { commit, sourceDate, channel = 'production' }) {
  const unstamped = normalizeStamped(html);
  const base = findRegion(unstamped).record;
  const record = {
    ...base, channel, commit, shortCommit: isFullSha(commit) ? commit.slice(0, 7) : null,
    sourceDate, artifactSha256: sha256(unstamped),
  };
  const problems = validateRecord(record);
  if (problems.length) throw new Error(`refusing to stamp: ${problems.join('; ')}`);
  return replaceRegion(unstamped, record);
}

// ------------------------------------------------------------------------------- banner
export const bannerComment = (version) => (
  `<!-- ${PRODUCT} v${version} — generated from src/, do not edit -->`
);

/** Version named by the top-of-file banner, or null. */
export function readBanner(html) {
  const m = /^<!doctype html>\n<!-- OSCILLA v(\S+) — generated from src\/, do not edit -->\n/i
    .exec(html);
  return m ? m[1] : null;
}
