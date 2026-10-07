#!/usr/bin/env node
// project.fail-first: a feat or fix PR's unit tests fail without the change.
//
//   node scripts/fail-first.mjs --title "fix(x): ..." [--body-file <f>]
//   node scripts/fail-first.mjs --pr-json <file>          # {"title": ..., "body": ...}
//        [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]
//
// For a PR whose title starts with feat or fix, the unit test files the PR adds or changes
// (tests/unit/**/*.test.mjs between the merge base and the head) are run twice with
// `node --test`, in two trees extracted with `git archive`:
//   with     the head commit as it is;
//   without  the merge base's tree (src/, dist/, scripts/, everything outside tests/) with the
//            head's tests/ put in its place.
// A file is evidence when it passes `with` and fails `without`. At least one file must be, or
// the PR body carries a line `fail-first: n/a <reason>`, which is printed. A file that fails in
// both trees proves nothing (the harness, not the change, fails it) and is reported as such.
// The kind of each failure without the change is printed (assertion, module-not-found,
// missing-file, error, timeout) with the names of the failing tests, so a test that only fails
// because a new module does not exist yet is visible as that.
//
// Exit 0: nothing to prove, waived, or proven. Exit 1: not proven. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TITLE = /^(feat|fix)(\([^)]*\))?!?:/;
export const WAIVER = /^[ \t>*-]*fail-first:[ \t]*n\/a\b[ \t]*(.*)$/im;
const TEST_FILE = /^tests\/unit\/.+\.test\.mjs$/;
const FILE_TIMEOUT_MS = 180_000;

/** null when the body carries no waiver line, else { reason } (reason may be empty). */
export function waiver(body) {
  const m = WAIVER.exec(String(body || ''));
  return m ? { reason: m[1].trim() } : null;
}

/** The kind of a failed `node --test` run, from its output. */
export function failureKind(output, timedOut) {
  if (timedOut) return 'timeout';
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|does not provide an export named/.test(output)) {
    return 'module-not-found';
  }
  if (/ENOENT/.test(output)) return 'missing-file';
  if (/ERR_ASSERTION|AssertionError/.test(output)) return 'assertion';
  return 'error';
}

function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

/** Extract <ref> (or one path of it) of <repo> into <dir>. */
function extract(repo, ref, dir, sub) {
  const r = spawnSync('sh', ['-c',
    'set -e; mkdir -p "$3"; if [ -n "$4" ]; then git -C "$1" archive "$2" -- "$4" | tar -x -C "$3";'
    + ' else git -C "$1" archive "$2" | tar -x -C "$3"; fi', 'sh', repo, ref, dir, sub || ''],
  { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git archive ${ref} ${sub || ''}: ${r.stderr.trim()}`);
}

function runFile(tree, file) {
  const env = { ...process.env };
  // A `node --test` started from inside a test file would otherwise run nothing.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    cwd: tree, env, encoding: 'utf8', timeout: FILE_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const failed = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
    .filter((name) => name !== file && !name.endsWith(path.basename(file)));
  return { ok: r.status === 0, output, timedOut, failed };
}

/**
 * @returns {{ status: 'not-applicable'|'waived'|'proven'|'not-proven', lines: string[] }}
 */
export function failFirst({ repo, title, body, head = 'HEAD', base, baseBranch = 'origin/main',
  keep = false }) {
  const lines = [];
  const say = (s) => lines.push(s);
  const t = String(title || '').trim();
  say(`fail-first: PR title: ${t || '(none)'}`);
  if (!TITLE.test(t)) {
    say('fail-first: not a feat or fix PR; nothing to prove');
    return { status: 'not-applicable', lines };
  }
  const w = waiver(body);
  if (w && w.reason) {
    say(`fail-first: n/a ${w.reason}`);
    say('fail-first: waived by the PR body; whether the reason holds is for the reviewer');
    return { status: 'waived', lines };
  }
  if (w) say('fail-first: the PR body says `fail-first: n/a` without a reason; a waiver needs one');

  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]);
  const baseSha = base ? git(repo, ['rev-parse', '--verify', `${base}^{commit}`])
    : git(repo, ['merge-base', baseBranch, headSha]);
  say(`fail-first: head ${headSha.slice(0, 12)}, merge base ${baseSha.slice(0, 12)}`);
  const files = git(repo, ['diff', '--name-only', '--no-renames', '--diff-filter=AM',
    baseSha, headSha, '--', 'tests/unit']).split('\n').filter((f) => TEST_FILE.test(f));
  if (!files.length) {
    say('fail-first: the PR adds or changes no tests/unit/**/*.test.mjs file, so nothing fails'
      + ' without the change');
    say('fail-first: add a unit test that fails on the merge base, or put'
      + ' `fail-first: n/a <reason>` in the PR body');
    return { status: 'not-proven', lines };
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fail-first-'));
  const evidence = [];
  try {
    const withTree = path.join(tmp, 'with');
    const withoutTree = path.join(tmp, 'without');
    extract(repo, headSha, withTree);
    extract(repo, baseSha, withoutTree);
    rmSync(path.join(withoutTree, 'tests'), { recursive: true, force: true });
    extract(repo, headSha, withoutTree, 'tests');
    const modules = path.join(repo, 'node_modules');
    if (existsSync(modules)) {
      for (const tree of [withTree, withoutTree]) {
        symlinkSync(modules, path.join(tree, 'node_modules'));
      }
    }
    for (const file of files) {
      const withRun = runFile(withTree, file);
      const withoutRun = runFile(withoutTree, file);
      if (!withRun.ok) {
        const kind = failureKind(withRun.output, withRun.timedOut);
        say(`  ${file}: FAILS WITH THE CHANGE TOO (${kind}) - not evidence`);
        continue;
      }
      if (withoutRun.ok) {
        say(`  ${file}: passes without the change - not evidence`);
        continue;
      }
      const kind = failureKind(withoutRun.output, withoutRun.timedOut);
      evidence.push({ file, kind });
      say(`  ${file}: fails without the change (${kind}), passes with it`);
      for (const name of withoutRun.failed.slice(0, 12)) say(`      not ok: ${name}`);
      if (withoutRun.failed.length > 12) say(`      ... and ${withoutRun.failed.length - 12} more`);
    }
  } finally {
    if (keep) say(`fail-first: trees kept in ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
  if (!evidence.length) {
    say(`fail-first: none of the ${files.length} added or changed unit test file(s) fails on the`
      + ' merge base and passes on the head');
    say('fail-first: make a test exercise the path the change fixes, or put'
      + ' `fail-first: n/a <reason>` in the PR body');
    return { status: 'not-proven', lines };
  }
  const kinds = [...new Set(evidence.map((e) => e.kind))].join(', ');
  say(`fail-first: proven by ${evidence.length} of ${files.length} file(s); failure kind(s)`
    + ` without the change: ${kinds}`);
  return { status: 'proven', lines, evidence };
}

function usage(message) {
  if (message) console.error(`fail-first: ${message}`);
  console.error('usage: node scripts/fail-first.mjs (--title <t> [--body-file <f>] | --pr-json <f>)'
    + ' [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>] [--keep]');
  process.exit(2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = { repo: process.cwd() };
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--title') opts.title = value(a);
    else if (a === '--body-file') opts.body = readFileSync(value(a), 'utf8');
    else if (a === '--pr-json') {
      const pr = JSON.parse(readFileSync(value(a), 'utf8'));
      opts.title = pr.title;
      opts.body = pr.body;
    } else if (a === '--repo') opts.repo = path.resolve(value(a));
    else if (a === '--head') opts.head = value(a);
    else if (a === '--base') opts.base = value(a);
    else if (a === '--base-branch') opts.baseBranch = value(a);
    else if (a === '--keep') opts.keep = true;
    else usage(`unknown argument ${a}`);
  }
  if (typeof opts.title !== 'string') usage('a PR title is required');
  let result;
  try {
    result = failFirst(opts);
  } catch (e) {
    console.error(`fail-first: ${e.message}`);
    process.exit(1);
  }
  for (const l of result.lines) console.log(l);
  process.exit(result.status === 'not-proven' ? 1 : 0);
}
