#!/usr/bin/env node
// npm run version:check — the product version has one authority (package.json "version") and
// every projection agrees with it:
//   lock      package-lock.json root "version" and packages[""].version
//   dist      banner, metadata region version and source digest, and the compiled-in esbuild
//             define (the "<version>" literal inside the app bundle)
//   runtime   src/js/core/build-info.js resolves that region/define to the same version
//   literals  no hard-coded copy of the current version anywhere else in the repository
//
// The literal scan is structural: the literal is derived from package.json at run time, so a
// bump never needs an allowlist edit. Allowed: package.json, package-lock.json (its root is
// checked above; other entries are dependency versions), dist/** (generated), .ai/** and
// CHANGELOG.md (append-only history that legitimately names released versions), docs/specs/**
// (the requesters' specifications recorded verbatim; they name target versions as plans and are
// never a version source), binary files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT, computeSourceDigest, findRegion, readBanner, readVersion,
} from './release-metadata.mjs';

export const LITERAL_ALLOW = [
  /^package\.json$/, /^package-lock\.json$/, /^dist\//, /^\.ai\//, /(^|\/)CHANGELOG\.md$/,
  /^docs\/specs\//,
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex matching the version as a standalone literal ("2.3.4", "v2.3.4", "2.3.4-rc.1"). */
export function versionLiteralPattern(version) {
  return new RegExp(`(?<![0-9A-Za-z.@/_+-])v?${escape(version)}(?![0-9A-Za-z_]|\\.[0-9])`, 'g');
}

/**
 * Hard-coded copies of `version` in the given files.
 * @param {{ path: string, content: Buffer|string }[]} files
 * @param {string} version
 * @param {RegExp[]} [allow]
 * @returns {{ path: string, line: number, text: string }[]}
 */
export function findVersionLiterals(files, version, allow = LITERAL_ALLOW) {
  const hits = [];
  const re = versionLiteralPattern(version);
  for (const f of files) {
    if (allow.some((a) => a.test(f.path))) continue;
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((text, i) => {
      re.lastIndex = 0;
      if (re.test(text)) hits.push({ path: f.path, line: i + 1, text: text.trim().slice(0, 120) });
    });
  }
  return hits;
}

// How far ahead of the product findVersionsAhead() looks: the rest of the current major and
// the whole of the next one.
export const AHEAD_MAJORS = 1;

const AHEAD_RE = /(?<![0-9A-Za-z.@/_+-])v?([0-9]+)\.([0-9]+)\.([0-9]+)(?![0-9A-Za-z_]|\.[0-9])/g;

/**
 * Version-shaped literals the product has not reached yet: every X.Y.Z in the scanned files
 * (the shape and the allowlist of findVersionLiterals) that is above `version` and whose major
 * is at most `majorsAhead` above its major. On a candidate, its own X.Y.Z counts as ahead (the
 * release it becomes). Each one is a release that fails version:check on the day the product
 * gets there. A patch, minor or candidate-to-stable bump only narrows the range, so a tree
 * with no hit before such a bump has none after it; the range gains one major only when the
 * product enters a new major.
 * @param {{ path: string, content: Buffer|string }[]} files
 * @param {string} version
 * @param {{ allow?: RegExp[], majorsAhead?: number }} [o]
 * @returns {{ version: string, path: string, line: number, text: string }[]}
 */
export function findVersionsAhead(files, version, {
  allow = LITERAL_ALLOW, majorsAhead = AHEAD_MAJORS,
} = {}) {
  const [base, pre] = version.split('-');
  const cur = base.split('.').map(Number);
  const ahead = (v) => {
    if (v[0] > cur[0] + majorsAhead) return false;
    const i = v.findIndex((n, k) => n !== cur[k]);
    return i === -1 ? Boolean(pre) : v[i] > cur[i];
  };
  const hits = [];
  for (const f of files) {
    if (allow.some((a) => a.test(f.path))) continue;
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    if (buf.includes(0)) continue; // binary
    buf.toString('utf8').split('\n').forEach((text, i) => {
      for (const m of text.matchAll(AHEAD_RE)) {
        if (!ahead([Number(m[1]), Number(m[2]), Number(m[3])])) continue;
        hits.push({ version: `${m[1]}.${m[2]}.${m[3]}`, path: f.path, line: i + 1,
          text: text.trim().slice(0, 120) });
      }
    });
  }
  return hits;
}

/** Tracked plus untracked-but-not-ignored files (a new file is caught before its commit). */
export function repositoryFiles(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' });
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter((p) => existsSync(path.join(root, p)))
    .map((p) => ({ path: p, content: readFileSync(path.join(root, p)) }));
}

/** Every projection check; returns { version, problems, notes }. */
export async function versionCheck(root = ROOT) {
  const problems = [];
  const notes = [];
  const version = readVersion(root);

  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [where, v] of [['version', lock.version],
    ['packages[""].version', lock.packages && lock.packages[''] && lock.packages[''].version]]) {
    if (v !== version) problems.push(`package-lock.json ${where} ${v} != package.json ${version}`);
  }

  const distFile = path.join(root, 'dist/index.html');
  if (!existsSync(distFile)) {
    problems.push('dist/index.html missing: run npm run build');
  } else {
    const html = readFileSync(distFile, 'utf8');
    const banner = readBanner(html);
    if (banner !== version) problems.push(`dist banner v${banner} != package.json ${version}`);
    try {
      const { record, json } = findRegion(html);
      if (record.version !== version) {
        problems.push(`dist region version ${record.version} != package.json ${version}`);
      }
      const digest = computeSourceDigest(root);
      if (record.sourceDigest !== digest) {
        problems.push(`dist region sourceDigest ${record.sourceDigest} != recomputed ${digest} `
          + '(dist is stale: npm run build)');
      }
      const app = /<script data-app>([\s\S]*?)<\/script>/.exec(html);
      if (!app || !app[1].includes(JSON.stringify(version))) {
        problems.push(`app bundle does not carry the compiled-in version "${version}"`);
      }
      const url = pathToFileURL(path.join(root, 'src/js/core/build-info.js')).href;
      const { resolveBuild } = await import(url);
      const defined = { version, sourceDigest: digest };
      const runtime = resolveBuild({ regionText: json, defined });
      if (runtime.version !== version || !runtime.consistent || runtime.origin !== 'region') {
        problems.push(`runtime projection: build-info resolves ${runtime.version} `
          + `(origin ${runtime.origin}, consistent ${runtime.consistent})`);
      }
      notes.push(`dist: banner, region, define and runtime all say ${version}; `
        + `source ${digest.slice(0, 12)}`);
    } catch (e) {
      problems.push(`dist: ${e.message}`);
    }
  }

  const hits = findVersionLiterals(repositoryFiles(root), version);
  for (const h of hits) {
    problems.push(`hard-coded product version ${version} in ${h.path}:${h.line}: ${h.text}`);
  }
  notes.push(`literal scan: no hard-coded ${version} outside package.json, the lock root, `
    + 'dist/, .ai/ and CHANGELOG.md');
  return { version, problems, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  versionCheck().then(({ version, problems, notes }) => {
    console.log(`version:check package.json ${version}`);
    if (problems.length) {
      for (const p of problems) console.error(`  FAIL ${p}`);
      process.exit(1);
    }
    for (const n of notes) console.log(`  PASS ${n}`);
  }, (e) => {
    console.error(`version:check: ${e.message}`);
    process.exit(1);
  });
}
