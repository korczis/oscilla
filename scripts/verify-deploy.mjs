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
//   digest    region.sourceDigest == recomputed digest of the build inputs
//   shape     vendor marker (data-vendor="p5@") present, no module script
//   og        og:image meta == <url>og-image.png; og-image.png and apple-touch-icon.png are
//             image/png and byte-equal to site/ (the crawler-only share assets)
//
//   node scripts/verify-deploy.mjs [--url <url>] [--commit <sha>] [--attempts 10] [--delay 10]
//        [--dist dist/index.html] [--site site] [--no-assets] [--no-cache-bust]
//
// Each request carries a unique query string (?oscilla-verify=<commit>.<attempt>) so a stale
// CDN edge cannot satisfy or fail the check; --no-cache-bust fetches the exact URL instead.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_URL, ROOT, commitDate, computeSourceDigest, findRegion, gitRunner, isFullSha,
  normalizeStamped, readVersion, sha256, validateRecord,
} from './release-metadata.mjs';

export const SHARE_ASSETS = ['og-image.png', 'apple-touch-icon.png'];

/**
 * Pure check of a fetched page against the committed dist and the expected provenance.
 * @param {object} o
 * @param {string} o.html      live page text
 * @param {string} o.dist      committed (unstamped) dist/index.html text
 * @param {string} o.url       public base URL (with trailing slash)
 * @param {{ commit: string, version: string, sourceDigest: string, sourceDate?: string|null }}
 *   o.expected
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
  if (record.sourceDigest !== expected.sourceDigest) {
    problems.push(`digest: region.sourceDigest ${record.sourceDigest} != recomputed `
      + `${expected.sourceDigest}`);
  }
  return problems;
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

function parseArgs(argv) {
  const o = {
    url: PUBLIC_URL, attempts: 10, delay: 10, dist: 'dist/index.html', site: 'site',
    assets: true, bust: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--url') o.url = next();
    else if (a === '--commit') o.commit = next();
    else if (a === '--attempts') o.attempts = Number(next());
    else if (a === '--delay') o.delay = Number(next());
    else if (a === '--dist') o.dist = next();
    else if (a === '--site') o.site = next();
    else if (a === '--no-assets') o.assets = false;
    else if (a === '--no-cache-bust') o.bust = false;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.url.endsWith('/')) o.url += '/';
  if (!(Number.isInteger(o.attempts) && o.attempts >= 1)) {
    throw new Error('--attempts must be an integer >= 1');
  }
  if (!(o.delay >= 0)) throw new Error('--delay must be >= 0 seconds');
  return o;
}

async function get(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  return {
    status: res.status, contentType: res.headers.get('content-type'),
    body: Buffer.from(await res.arrayBuffer()),
  };
}

const sleep = (s) => new Promise((r) => { setTimeout(r, s * 1000); });

async function attempt(o, expected, dist, n) {
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
      const local = path.resolve(ROOT, o.site, name);
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

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const run = gitRunner(ROOT);
  let commit = o.commit || process.env.GITHUB_SHA;
  if (!commit) commit = run(['rev-parse', 'HEAD']);
  if (!isFullSha(commit)) throw new Error(`expected commit must be a full SHA, got "${commit}"`);
  let sourceDate = null;
  try {
    sourceDate = commitDate(commit, run);
  } catch { /* commit unknown to this clone: the date check is skipped */ }
  const expected = {
    commit, sourceDate, version: readVersion(ROOT), sourceDigest: computeSourceDigest(ROOT),
  };
  const dist = readFileSync(path.resolve(ROOT, o.dist), 'utf8');
  console.log(`verify-deploy ${o.url}: expecting v${expected.version}, commit ${commit}, `
    + `source ${expected.sourceDigest}, artifact ${sha256(dist)}`);

  let problems = [];
  for (let n = 1; n <= o.attempts; n++) {
    problems = await attempt(o, expected, dist, n);
    if (!problems.length) {
      console.log(`  PASS attempt ${n}/${o.attempts}: live page is the committed dist stamped `
        + `with commit ${commit}; version, digest, shape and share assets verified`);
      return;
    }
    console.log(`  attempt ${n}/${o.attempts}: ${problems.length} problem(s); `
      + `first: ${problems[0]}`);
    if (n < o.attempts) await sleep(o.delay);
  }
  console.error(`FAIL ${o.url} after ${o.attempts} attempt(s):`);
  for (const p of problems) console.error(`  FAIL ${p}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`verify-deploy: ${e.message}`);
    process.exit(1);
  });
}
