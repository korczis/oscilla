#!/usr/bin/env node
// Deploy-time provenance stamp (GitHub Pages workflow). Rewrites ONLY the inline metadata
// region of a built dist/index.html with
//   { schema: 2, commit, shortCommit, channel: "production", sourceDate (the commit
//     timestamp), artifactSha256 (sha256 of the UNSTAMPED committed dist),
//     release, distance (where the commit stands relative to the tag v<version>, ADR 0059) }
// keeping version and sourceDigest from the build. The release state is read from git
// (releaseState() in release-metadata.mjs), so the clone needs its history and tags: Pages
// checks out with fetch-depth: 0. A commit after its version's tag is stamped "after-tag"
// and shows <version>+<distance>.g<short>, never the bare release version. Every other byte
// is untouched, so normalizeStamped() (release-metadata.mjs, used by verify-deploy.mjs)
// reverses the stamp and the result is byte-equal to the committed dist. Idempotent:
// re-running with the same inputs produces the same bytes, also on an already stamped file.
//
//   node scripts/stamp-build.mjs [in] [out] [--commit <sha>] [--source-date <iso>]
//                                [--channel production] [--no-source-check]
//                                [--release tagged|after-tag|untagged --distance <n>|null]
//                                [--help]
//
// The arguments are parsed against that list first (parseFlags of release-analyze.mjs): --help
// prints the usage and exits 0; an unknown flag, a third positional or a flag missing its
// value exits 2, before git or a file is read; a failed stamp exits 1.
// --release/--distance replace the state read from git (a local dry run of a later build's
// page); verify-deploy compares a deployed stamp with git and refuses one that disagrees.
// in defaults to dist/index.html, out to in (in place). --commit defaults to $GITHUB_SHA, then
// to `git rev-parse HEAD`; --source-date to that commit's timestamp from git. Before stamping
// it refuses a dist whose region names another version than package.json or another source
// digest than the recomputed one (a stale dist must never be deployed with a fresh commit).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags } from './release-analyze.mjs';
import {
  ROOT, commitDate, computeSourceDigest, findRegion, gitRunner, isFullSha, normalizeStamped,
  readVersion, releaseLabel, releaseState, stampHtml,
} from './release-metadata.mjs';

export { normalizeStamped, stampHtml };

export const USAGE = 'usage: node scripts/stamp-build.mjs [in] [out] [--commit <sha>] '
  + '[--source-date <iso>] [--channel production] [--no-source-check] '
  + '[--release tagged|after-tag|untagged --distance <n>|null] [--help]';
const FLAGS = {
  '--commit': 'value', '--source-date': 'value', '--channel': 'value',
  '--no-source-check': 'boolean', '--release': 'value', '--distance': 'value',
};

/**
 * The command line; returns the exit code (0 stamped or usage printed, 1 cannot stamp, 2 a
 * usage error). The arguments are parsed first (parseFlags of release-analyze.mjs, R-3 of
 * #199): --help prints the usage and an unknown flag is refused before git or a file is read.
 */
export function main({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), env = process.env,
  log = console.log, err = console.error,
} = {}) {
  let o;
  try {
    o = parseFlags(argv, FLAGS, USAGE, { positional: 2 });
  } catch (e) {
    err(`stamp-build: ${e.message}`);
    return e.exitCode;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  try {
    stamp(o, { root, run, env, log });
    return 0;
  } catch (e) {
    err(`stamp-build: ${e.message}`);
    return 1;
  }
}

function stamp(o, { root, run, env, log }) {
  const [inArg, outArg] = o._;
  const input = path.resolve(root, inArg || 'dist/index.html');
  const output = path.resolve(root, outArg || inArg || 'dist/index.html');
  const commit = o['--commit'] || env.GITHUB_SHA || run(['rev-parse', 'HEAD']);
  if (!isFullSha(commit)) throw new Error(`--commit must be a full 40-hex SHA, got "${commit}"`);
  const sourceDate = o['--source-date'] || commitDate(commit, run);
  const channel = o['--channel'] ?? 'production';

  const html = readFileSync(input, 'utf8');
  if (!o['--no-source-check']) {
    const { record } = findRegion(html);
    const version = readVersion(root);
    const digest = computeSourceDigest(root);
    const problems = [];
    if (record.version !== version) problems.push(`region version ${record.version} != ${version}`);
    if (record.sourceDigest !== digest) {
      problems.push(`region sourceDigest ${record.sourceDigest} != recomputed ${digest}`);
    }
    if (problems.length) {
      throw new Error(`refusing to stamp a stale dist (${problems.join('; ')}); run npm run build`);
    }
  }
  const distance = o['--distance'] === undefined || o['--distance'] === 'null' ? null
    : Number(o['--distance']);
  const state = o['--release'] !== undefined
    ? { release: o['--release'], distance }
    : releaseState({ version: findRegion(html).record.version, commit, run });
  const stamped = stampHtml(html, { commit, sourceDate, channel,
    release: state.release, distance: state.distance });
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, stamped);
  const { record } = findRegion(stamped);
  const reversible = normalizeStamped(stamped) === normalizeStamped(html);
  log(`stamped ${path.relative(root, output)}: v${record.version} ${record.channel} `
    + `commit ${record.commit} (${record.sourceDate}); release ${record.release}`
    + `${record.distance ? ` +${record.distance}` : ''}, shown as v${releaseLabel(record)}; `
    + `artifact ${record.artifactSha256}; reversible ${reversible}`);
  if (!reversible) throw new Error('stamp is not reversible: normalised bytes differ');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
