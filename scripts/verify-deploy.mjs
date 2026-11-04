#!/usr/bin/env node
// Fatal post-deploy verification of the public GitHub Pages site. Exit 0 only when, within the
// retry budget, ONE attempt passes every check; otherwise print every failed check and exit 1.
//
// Checks (each attempt):
//   page      HTTP 200 text/html
//   region    exactly one metadata region that parses and is a well-formed production record
//   bytes     live with the region normalised back == committed dist/index.html, byte for byte
//   artifact  region.artifactSha256 == sha256(committed dist)
//   commit    region.commit == expected commit ($GITHUB_SHA / --commit / git HEAD)
//   date      region.sourceDate == that commit's timestamp (when git knows the commit)
//   version   region.version == package.json version
//   release   region.release/distance == the release state git reports now for that commit
//             (ADR 0059), or "untagged" when the commit is now the tag's: the release commit
//             is deployed when it merges, before release:publish tags it. So the page of a
//             later commit cannot present itself as v<version>, and at release:publish (tag
//             just created on the verified commit) the page must be the release
//   digest    region.sourceDigest == recomputed digest of the build inputs
//   shape     vendor marker (data-vendor="p5@") present, no module script
//   og        og:image meta == <url>og-image.png; og-image.png and apple-touch-icon.png are
//             image/png and byte-equal to site/ (the crawler-only share assets)
//
//   node scripts/verify-deploy.mjs [--url <url>] [--commit <rev>] [--attempts 10] [--delay 10]
//        [--dist dist/index.html] [--site site] [--no-assets] [--no-cache-bust] [--help]
//
// The arguments are parsed against that list first (parseFlags of release-analyze.mjs): --help
// prints the usage and exits 0; an unknown flag, a flag missing its value or a bad --attempts
// or --delay exits 2, before git, a file or the network is asked anything.
// --commit takes a full SHA or any revision git resolves (origin/main, a v* tag); without it
// the expected commit is $GITHUB_SHA, then the checkout's HEAD. The bytes, version and digest
// checks compare with this checkout, so run it in a checkout of the expected commit. The
// release check reads the history and the tags (it fails on a shallow clone).
// Each request is bounded (FETCH_TIMEOUT_MS of scripts/release-bounded.mjs, body included) and
// a failed one fails its attempt; --attempts is the retry.
// Each request carries a unique query string (?oscilla-verify=<commit>.<attempt>) so a stale
// CDN edge cannot satisfy or fail the check; --no-cache-bust fetches the exact URL instead.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags } from './release-analyze.mjs';
import { boundedFetch } from './release-bounded.mjs';
import {
  PUBLIC_URL, ROOT, commitDate, computeSourceDigest, findRegion, gitRunner, isFullSha,
  normalizeStamped, readVersion, releaseLabel, releaseState, sha256, validateRecord,
} from './release-metadata.mjs';

export const SHARE_ASSETS = ['og-image.png', 'apple-touch-icon.png'];

/**
 * Pure check of a fetched page against the committed dist and the expected provenance.
 * @param {object} o
 * @param {string} o.html      live page text
 * @param {string} o.dist      committed (unstamped) dist/index.html text
 * @param {string} o.url       public base URL (with trailing slash)
 * @param {{ commit: string, version: string, sourceDigest: string, sourceDate?: string|null,
 *   release?: { release: string, distance: number|null }|null, releaseError?: string|null }}
 *   o.expected  release: the state git reports now (releaseState()); releaseError: why it
 *   could not be read
 * @returns {string[]} problems (empty = pass)
 */
export function checkLive({ html, dist, url, expected }) {
  const problems = [];
  if (!/data-vendor="p5@/.test(html)) {
    problems.push('shape: vendor marker data-vendor="p5@" missing');
  }
  if (/<script\b[^>]*\btype\s*=\s*["']?module/i.test(html)) problems.push('shape: module script');
  const og = `<meta property="og:image" content="${url}og-image.png">`;
  if (!html.includes(og)) problems.push(`og: ${og} missing`);

  let record;
  try {
    ({ record } = findRegion(html));
  } catch (e) {
    problems.push(`region: ${e.message} (an unstamped or pre-provenance deployment?)`);
    if (html !== dist) problems.push('bytes: live page differs from the committed dist');
    return problems;
  }
  problems.push(...validateRecord(record).map((p) => `region: ${p}`));
  if (record.channel !== 'production') {
    problems.push(`region: channel "${record.channel}", expected "production" (not stamped)`);
  }
  let normalised = null;
  try {
    normalised = normalizeStamped(html);
  } catch (e) {
    problems.push(`bytes: cannot normalise the live page: ${e.message}`);
  }
  if (normalised !== null && normalised !== dist) {
    const at = firstDifference(normalised, dist);
    problems.push(`bytes: normalised live page != committed dist (first difference at char ${at}: `
      + `live ${JSON.stringify(normalised.slice(at, at + 40))} vs dist `
      + `${JSON.stringify(dist.slice(at, at + 40))})`);
  }
  if (record.artifactSha256 !== sha256(dist)) {
    problems.push(`artifact: region.artifactSha256 ${record.artifactSha256} != sha256(dist) `
      + `${sha256(dist)}`);
  }
  if (record.commit !== expected.commit) {
    problems.push(`commit: region.commit ${record.commit} != expected ${expected.commit}`);
  }
  if (expected.sourceDate && record.sourceDate !== expected.sourceDate) {
    problems.push(`date: region.sourceDate ${record.sourceDate} != ${expected.sourceDate}`);
  }
  if (record.version !== expected.version) {
    problems.push(`version: region.version ${record.version} != package.json ${expected.version}`);
  }
  problems.push(...releaseProblems(record, expected));
  if (record.sourceDigest !== expected.sourceDigest) {
    problems.push(`digest: region.sourceDigest ${record.sourceDigest} != recomputed `
      + `${expected.sourceDigest}`);
  }
  return problems;
}

const describe = ({ release, distance }) => (release === 'after-tag'
  ? `${distance} commit(s) after its tag` : release);

/** The stamped release state against the one git reports now (empty = they agree). */
export function releaseProblems(record, expected) {
  if (expected.releaseError) return [`release: cannot read the release state from git: `
    + `${expected.releaseError}`];
  const now = expected.release;
  if (!now) return ['release: no expected release state (verify-deploy reads it from git)'];
  const same = record.release === now.release && record.distance === now.distance;
  const taggedSince = record.release === 'untagged' && now.release === 'tagged';
  if (same || taggedSince) return [];
  return [`release: the page says ${describe(record)} (shown as v${releaseLabel(record)}), git `
    + `says ${describe(now)} for ${record.commit}`];
}

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/** Problems with one fetched share asset. */
export function checkAsset({ name, status, contentType, body, expected }) {
  const problems = [];
  if (status !== 200) problems.push(`og: ${name} HTTP ${status}`);
  if (!/^image\/png\b/.test(contentType || '')) {
    problems.push(`og: ${name} content-type ${contentType}`);
  }
  if (expected && !Buffer.from(body).equals(expected)) {
    problems.push(`og: ${name} (${body.length} B) differs from site/${name} `
      + `(${expected.length} B)`);
  }
  return problems;
}

export const USAGE = 'usage: node scripts/verify-deploy.mjs [--url <url>] [--commit <rev>] '
  + '[--attempts 10] [--delay 10] [--dist dist/index.html] [--site site] [--no-assets] '
  + '[--no-cache-bust] [--help]';
const FLAGS = {
  '--url': 'value', '--commit': 'value', '--attempts': 'value', '--delay': 'value',
  '--dist': 'value', '--site': 'value', '--no-assets': 'boolean', '--no-cache-bust': 'boolean',
};

/** The options of `argv` (parseFlags of release-analyze.mjs); throws exitCode 2 on misuse. */
function parseArgs(argv) {
  const f = parseFlags(argv, FLAGS, USAGE);
  if (f.help) return f;
  const refuse = (m) => Object.assign(new Error(`${m}\n${USAGE}`), { exitCode: 2 });
  const o = {
    url: f['--url'] ?? PUBLIC_URL, commit: f['--commit'],
    attempts: '--attempts' in f ? Number(f['--attempts']) : 10,
    delay: '--delay' in f ? Number(f['--delay']) : 10,
    dist: f['--dist'] ?? 'dist/index.html', site: f['--site'] ?? 'site',
    assets: !f['--no-assets'], bust: !f['--no-cache-bust'],
  };
  if (!o.url.endsWith('/')) o.url += '/';
  if (!(Number.isInteger(o.attempts) && o.attempts >= 1)) {
    throw refuse('--attempts must be an integer >= 1');
  }
  if (!(o.delay >= 0)) throw refuse('--delay must be >= 0 seconds');
  return o;
}

// One request, bounded (FETCH_TIMEOUT_MS, body included). It is tried once: --attempts is the
// retry of this script, and a failed request fails its attempt, naming the URL and why.
const get = (url) => boundedFetch(url, { attempts: 1,
  init: { cache: 'no-store', redirect: 'follow' } });

const sleep = (s) => new Promise((r) => { setTimeout(r, s * 1000); });

async function attempt(o, expected, dist, n, root) {
  const q = (u) => (o.bust ? `${u}?oscilla-verify=${expected.commit.slice(0, 12)}.${n}` : u);
  const problems = [];
  let page;
  try {
    page = await get(q(o.url));
  } catch (e) {
    return [`page: GET ${o.url} failed: ${e.message}`];
  }
  if (page.status !== 200) problems.push(`page: HTTP ${page.status}`);
  if (!/^text\/html\b/.test(page.contentType || '')) {
    problems.push(`page: content-type ${page.contentType}`);
  }
  problems.push(...checkLive({ html: page.body.toString('utf8'), dist, url: o.url, expected }));
  if (o.assets) {
    for (const name of SHARE_ASSETS) {
      const local = path.resolve(root, o.site, name);
      const want = existsSync(local) ? readFileSync(local) : null;
      if (!want) problems.push(`og: ${o.site}/${name} missing locally`);
      try {
        const res = await get(q(`${o.url}${name}`));
        problems.push(...checkAsset({ name, ...res, expected: want }));
      } catch (e) {
        problems.push(`og: GET ${name} failed: ${e.message}`);
      }
    }
  }
  return problems;
}

/**
 * The command line; resolves to the exit code (0 verified or usage printed, 1 not verified, 2
 * a usage error). The arguments are parsed first (R-3 of #199): --help prints the usage and an
 * unknown flag is refused before git, a file or the network is asked anything.
 */
export async function main({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), env = process.env,
  log = console.log, err = console.error,
} = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`verify-deploy: ${e.message}`);
    return e.exitCode ?? 2;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  try {
    return await verify(o, { root, run, env, log, err });
  } catch (e) {
    err(`verify-deploy: ${e.message}`);
    return 1;
  }
}

async function verify(o, { root, run, env, log, err }) {
  let commit = o.commit || env.GITHUB_SHA;
  if (!commit) commit = run(['rev-parse', 'HEAD']);
  if (!isFullSha(commit)) {
    try {
      commit = run(['rev-parse', '--verify', `${commit}^{commit}`]);
    } catch {
      throw new Error(`expected commit "${commit}" is neither a full SHA nor a revision git `
        + 'resolves here');
    }
  }
  let sourceDate = null;
  try {
    sourceDate = commitDate(commit, run);
  } catch { /* commit unknown to this clone: the date check is skipped */ }
  const version = readVersion(root);
  let release = null;
  let releaseError = null;
  try {
    release = releaseState({ version, commit, run });
  } catch (e) {
    releaseError = e.message;
  }
  const expected = {
    commit, sourceDate, version, sourceDigest: computeSourceDigest(root), release, releaseError,
  };
  const dist = readFileSync(path.resolve(root, o.dist), 'utf8');
  log(`verify-deploy ${o.url}: expecting v${expected.version}, commit ${commit}, `
    + `release ${release ? describe(release) : `unknown (${releaseError})`}, `
    + `source ${expected.sourceDigest}, artifact ${sha256(dist)}`);

  let problems = [];
  for (let n = 1; n <= o.attempts; n++) {
    problems = await attempt(o, expected, dist, n, root);
    if (!problems.length) {
      log(`  PASS attempt ${n}/${o.attempts}: live page is the committed dist stamped `
        + `with commit ${commit}; version, release state, digest, shape and share assets `
        + 'verified');
      return 0;
    }
    log(`  attempt ${n}/${o.attempts}: ${problems.length} problem(s); `
      + `first: ${problems[0]}`);
    if (n < o.attempts) await sleep(o.delay);
  }
  err(`FAIL ${o.url} after ${o.attempts} attempt(s):`);
  for (const p of problems) err(`  FAIL ${p}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
