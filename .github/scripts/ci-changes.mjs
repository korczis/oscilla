#!/usr/bin/env node
// E026: does a pull request change anything the browser and visual legs of CI could observe?
// The `changes` job of .github/workflows/ci.yml runs the BASE branch's copy of this file (taken
// with `git cat-file blob`, so a pull request cannot edit the allowlist and benefit in the same
// run) and writes `runtime=true|false` to $GITHUB_OUTPUT. The engine, suites, measure, studio,
// browser and visual jobs run unless the answer is exactly `false`, and `gate` accepts their
// skip only when this job succeeded with `false`.
//
//   node .github/scripts/ci-changes.mjs --repo <dir> --event <name> --head <rev>
//        --base-branch <ref> [--output <file>]
//
// Fail closed: a change is non-runtime only when it has at least one changed path and EVERY
// changed path, on both sides of a rename and including a deleted one, is a regular file (mode
// 100644 or 100755, or deleted) under one of NON_RUNTIME. Everything else is runtime: src/,
// dist/, tests/ (a .md there too: tests/browser/lib/suite.cjs reads tests/README.md), scripts/,
// package*.json, .github/ (this file included), .ai/repo/rules/, any other path, a symbolic
// link or submodule anywhere, a name with a control character, an empty diff, any event
// that is not a pull request, and a pull request into any base but main (GATED_BASES). A
// path that changes the build changes dist/index.html too, which the always-running `unit`
// job holds to a clean rebuild (npm run build:check), so the allowlist does not need to know
// the build's inputs.
//
// Dependency-free on purpose: the job runs it as one extracted file, before `npm ci`.
// Tested by tests/unit/ci-changes.test.mjs.

import { spawnSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The non-runtime paths: a directory prefix (ending in `/`) or `*.md` at the top level. */
export const NON_RUNTIME = Object.freeze([
  '.ai/repo/project/',
  '.ai/repo/reviews/',
  '.ai/repo/releases/',
  'docs/',
  '*.md',
]);

/**
 * The base branches a pull request may be path-gated into. A pull request into any other
 * branch (a train or a stacked branch) runs everything: its `gate` check lands on the head
 * commit, which branch protection on main reads too, so a skip judged against another base
 * would let a head whose own content never ran in a browser satisfy main's required check
 * (retargeted to main, or the same head opened against main as well).
 */
export const GATED_BASES = Object.freeze(['main']);

/** The branch name of a --base-branch value: `refs/remotes/origin/<name>` or a bare name. */
export function baseName(ref) {
  if (typeof ref !== 'string') return '';
  return ref.startsWith('refs/remotes/origin/') ? ref.slice('refs/remotes/origin/'.length) : ref;
}

/** The jobs of ci.yml that run only for a runtime change. */
export const GATED_JOBS = Object.freeze(['engine', 'suites', 'measure', 'studio', 'browser',
  'visual']);

const REGULAR = new Set(['100644', '100755']);
const ABSENT = '000000';

/** Whether one repository-relative path, as git prints it with -z, is non-runtime. */
export function isNonRuntimePath(p) {
  if (typeof p !== 'string' || p === '') return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return false;
  if (p.startsWith('/') || p.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return false;
  }
  for (const pattern of NON_RUNTIME) {
    if (pattern === '*.md') {
      if (!p.includes('/') && p.endsWith('.md') && p.length > 3) return true;
    } else if (p.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * The records of `git diff --raw -z` (with or without rename detection): one
 * { status, srcMode, dstMode, paths } each; a rename or copy carries both paths.
 * Anything that is not a record throws, so output this does not understand is never read as
 * "nothing changed".
 */
export function parseRawZ(text) {
  const fields = text.split('\0');
  if (fields[fields.length - 1] === '') fields.pop();
  const out = [];
  let i = 0;
  while (i < fields.length) {
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([ACDMRTUX])(\d*)$/.exec(fields[i]);
    if (!m) throw new Error(`git diff --raw: cannot read ${JSON.stringify(fields[i])}`);
    const two = m[3] === 'R' || m[3] === 'C';
    const paths = fields.slice(i + 1, i + (two ? 3 : 2));
    if (paths.length !== (two ? 2 : 1)) {
      throw new Error(`git diff --raw: record ${JSON.stringify(fields[i])} has no path`);
    }
    out.push({ status: m[3], srcMode: m[1], dstMode: m[2], paths });
    i += two ? 3 : 2;
  }
  return out;
}

/** Why one record is runtime-relevant, or null when it is not. */
function recordReason(r) {
  for (const mode of [r.srcMode, r.dstMode]) {
    if (mode !== ABSENT && !REGULAR.has(mode)) return `mode ${mode} (not a regular file)`;
  }
  if (r.status !== 'A' && r.status !== 'D' && r.status !== 'M' && r.status !== 'R'
    && r.status !== 'C') {
    return `status ${r.status}`;
  }
  const outside = r.paths.find((p) => !isNonRuntimePath(p));
  return outside === undefined ? null : 'outside the non-runtime paths';
}

/**
 * Classify a pull request's changed records.
 * @returns {{ runtime: boolean, reason: string, runtimePaths: string[], paths: string[] }}
 */
export function classify(records, { event = 'pull_request', base } = {}) {
  const paths = records.flatMap((r) => r.paths);
  if (event !== 'pull_request') {
    return { runtime: true, reason: `event ${event || '(none)'}: everything runs`, runtimePaths: [],
      paths };
  }
  if (!GATED_BASES.includes(base)) {
    return { runtime: true,
      reason: `base ${JSON.stringify(base ?? null)} is not ${GATED_BASES.join(', ')}: `
        + 'everything runs',
      runtimePaths: [], paths };
  }
  if (!records.length) {
    return { runtime: true, reason: 'no changed path: nothing shows the change is non-runtime',
      runtimePaths: [], paths };
  }
  const runtimePaths = [];
  const reasons = new Set();
  for (const r of records) {
    const why = recordReason(r);
    if (why) {
      reasons.add(why);
      for (const p of r.paths) runtimePaths.push(p);
    }
  }
  if (runtimePaths.length) {
    return { runtime: true, reason: [...reasons].join('; '), runtimePaths, paths };
  }
  return { runtime: false, reason: `all ${paths.length} changed path(s) are non-runtime`,
    runtimePaths, paths };
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/** The records <head> changes against its merge base with <baseBranch>. */
export function changedRecords(repo, head, baseBranch) {
  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const baseSha = git(repo, ['merge-base', baseBranch, headSha]).trim();
  const raw = git(repo, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff',
    '--no-textconv', baseSha, headSha]);
  return { headSha, baseSha, records: parseRawZ(raw) };
}

function parseArgs(argv) {
  const opts = { repo: '.', event: '', head: 'HEAD', baseBranch: 'origin/main', output: null };
  const keys = { '--repo': 'repo', '--event': 'event', '--head': 'head',
    '--base-branch': 'baseBranch', '--output': 'output' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = keys[argv[i]];
    if (!key || i + 1 >= argv.length) throw new Error(`ci-changes: bad argument ${argv[i]}`);
    opts[key] = argv[i += 1];
  }
  return opts;
}

export function main(argv, { log = console.log } = {}) {
  const opts = parseArgs(argv);
  let result;
  if (opts.event !== 'pull_request') {
    result = classify([], { event: opts.event });
  } else {
    const { headSha, baseSha, records } = changedRecords(opts.repo, opts.head, opts.baseBranch);
    log(`ci-changes: head ${headSha.slice(0, 12)}, merge base ${baseSha.slice(0, 12)}, `
      + `${records.length} changed path record(s)`);
    result = classify(records, { event: opts.event, base: baseName(opts.baseBranch) });
  }
  log(`ci-changes: runtime=${result.runtime} (${result.reason})`);
  for (const p of result.runtimePaths.slice(0, 20)) log(`  runtime: ${JSON.stringify(p)}`);
  if (result.runtimePaths.length > 20) log(`  ... and ${result.runtimePaths.length - 20} more`);
  if (!result.runtime) {
    log(`ci-changes: skipped for this pull request: ${GATED_JOBS.join(', ')}`);
  }
  if (opts.output) appendFileSync(opts.output, `runtime=${result.runtime}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
