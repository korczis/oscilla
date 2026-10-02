#!/usr/bin/env node
// Deploy-time provenance stamp (GitHub Pages workflow). Rewrites ONLY the inline metadata
// region of a built dist/index.html with
//   { commit, shortCommit, channel: "production", sourceDate (the commit timestamp),
//     artifactSha256 (sha256 of the UNSTAMPED committed dist) }
// keeping version and sourceDigest from the build. Every other byte is untouched, so
// normalizeStamped() (release-metadata.mjs, used by verify-deploy.mjs) reverses the stamp and
// the result is byte-equal to the committed dist. Idempotent: re-running with the same inputs
// produces the same bytes, also on an already stamped file.
//
//   node scripts/stamp-build.mjs [in] [out] [--commit <sha>] [--source-date <iso>]
//                                [--channel production] [--no-source-check]
//
// in defaults to dist/index.html, out to in (in place). --commit defaults to $GITHUB_SHA, then
// to `git rev-parse HEAD`; --source-date to that commit's timestamp from git. Before stamping
// it refuses a dist whose region names another version than package.json or another source
// digest than the recomputed one (a stale dist must never be deployed with a fresh commit).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, commitDate, computeSourceDigest, findRegion, gitRunner, isFullSha, normalizeStamped,
  readVersion, stampHtml,
} from './release-metadata.mjs';

export { normalizeStamped, stampHtml };

function parseArgs(argv) {
  const opts = { positional: [], sourceCheck: true, channel: 'production' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') opts.commit = argv[++i];
    else if (a === '--source-date') opts.sourceDate = argv[++i];
    else if (a === '--channel') opts.channel = argv[++i];
    else if (a === '--no-source-check') opts.sourceCheck = false;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const input = path.resolve(ROOT, opts.positional[0] || 'dist/index.html');
  const output = path.resolve(ROOT, opts.positional[1] || opts.positional[0] || 'dist/index.html');
  const run = gitRunner(ROOT);
  const commit = opts.commit || process.env.GITHUB_SHA || run(['rev-parse', 'HEAD']);
  if (!isFullSha(commit)) throw new Error(`--commit must be a full 40-hex SHA, got "${commit}"`);
  const sourceDate = opts.sourceDate || commitDate(commit, run);

  const html = readFileSync(input, 'utf8');
  if (opts.sourceCheck) {
    const { record } = findRegion(html);
    const version = readVersion(ROOT);
    const digest = computeSourceDigest(ROOT);
    const problems = [];
    if (record.version !== version) problems.push(`region version ${record.version} != ${version}`);
    if (record.sourceDigest !== digest) {
      problems.push(`region sourceDigest ${record.sourceDigest} != recomputed ${digest}`);
    }
    if (problems.length) {
      throw new Error(`refusing to stamp a stale dist (${problems.join('; ')}); run npm run build`);
    }
  }
  const stamped = stampHtml(html, { commit, sourceDate, channel: opts.channel });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, stamped);
  const { record } = findRegion(stamped);
  const reversible = normalizeStamped(stamped) === normalizeStamped(html);
  console.log(`stamped ${path.relative(ROOT, output)}: v${record.version} ${record.channel} `
    + `commit ${record.commit} (${record.sourceDate}); artifact ${record.artifactSha256}; `
    + `reversible ${reversible}`);
  if (!reversible) throw new Error('stamp is not reversible: normalised bytes differ');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`stamp-build: ${e.message}`);
    process.exit(1);
  }
}
