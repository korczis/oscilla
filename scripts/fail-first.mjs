#!/usr/bin/env node
// project.fail-first: a feat or fix PR's unit tests fail without the change.
//
//   node scripts/fail-first.mjs --title "fix(x): ..." [--body-file <f>]
//   node scripts/fail-first.mjs --pr-json <file>          # {"title": ..., "body": ...}
//        [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]
//
// For a PR whose title starts with feat or fix (in any case, behind bracketed tags), the unit
// test files the PR adds or changes (tests/unit/**/*.test.mjs between the merge base and the
// head) are run twice with `node --test`, in two trees extracted with `git archive` and made
// git repositories with their files staged (so `git ls-files` answers; there is no history):
//   with     the head commit as it is;
//   without  the merge base's tree (src/, dist/, scripts/, everything outside tests/) with the
//            head's tests/ put in its place.
// A file is evidence when it passes `with` and fails `without`. At least one file must be, or
// the PR body carries a line `fail-first: n/a <reason>`, which is printed: a line of the body's
// own prose (not in a code block, an HTML comment or a blockquote) with a reason that is not
// the placeholder. A file that fails in
// both trees proves nothing (the harness, not the change, fails it) and is reported as such;
// a failure with the change is retried once and printed, so a load-sensitive test is not
// mistaken for that.
// The kind of each failure without the change is printed (assertion, module-not-found,
// missing-file, error, timeout) with the names of the failing tests, so a test that only fails
// because a new module does not exist yet is visible as that.
//
// Exit 0: nothing to prove, waived, or proven. Exit 1: not proven. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync }
  from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitOf } from './git-ref.mjs';

// Any case, any spacing, and behind bracketed tags ("[WIP] Fix (x) : ..."): a title that reads
// as feat or fix is one, whatever a stricter parser downstream makes of it.
export const TITLE = /^\s*(?:\[[^\]]*\]\s*)*(feat|fix)\s*(\([^)]*\))?\s*!?\s*:/i;
export const WAIVER = /^[ \t]*(?:[*-][ \t]+)?fail-first:[ \t]*n\/a\b[ \t]*(.*)$/im;
const TEST_FILE = /^tests\/unit\/.+\.test\.mjs$/;
const FILE_TIMEOUT_MS = 180_000;

// what an inline code span leaves in the prose: a mark (U+0001), its index, U+0002 on its
// first line and the bare marks on each further one. No letter or digit outside the index,
// so code is no waiver reason (R16), and a line that continues a span starts with a mark, so
// a waiver inside the span is no line of its own (R5). An inline HTML comment leaves the bare
// marks on each line after its first.
const SPAN_MARK = /\u0001(\d*)\u0002/g;
const MORE = '\n\u0001\u0002';
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** A line with each tab expanded to the next multiple of 4 columns. */
function expandTabs(line) {
  let out = '';
  for (const c of line) out += c === '\t' ? ' '.repeat(4 - (out.length % 4)) : c;
  return out;
}

const indentOf = (s) => /^ */.exec(s)[0].length;

/**
 * The inline text of a paragraph or a heading (CommonMark 0.31, 6.1-6.6) with each code span
 * replaced by its marks and its source pushed to `spans`, and each HTML comment by its marks.
 * A backslash escapes the punctuation after it, so `\`` opens no span; a run of backticks
 * closes at the next run of the same length in the same block, else it is literal; a comment
 * that starts before a backtick wins over it (review of #255, R5, R21).
 */
function inline(text, spans) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const k = text.startsWith('<!-->', i) ? i + 2 : text.startsWith('<!--->', i) ? i + 3
        : text.indexOf('-->', i + 4);
      if (k >= 0) {
        out += MORE.repeat(text.slice(i, k + 3).split('\n').length - 1);
        i = k + 3;
        continue;
      }
    }
    if (c === '`') {
      const open = /^`+/.exec(text.slice(i))[0];
      const run = /`+/g;
      run.lastIndex = i + open.length;
      let close = null;
      for (let m = run.exec(text); m; m = run.exec(text)) {
        if (m[0].length === open.length) {
          close = m.index;
          break;
        }
      }
      if (close === null) {
        out += open;
        i += open.length;
        continue;
      }
      const source = text.slice(i, close + open.length);
      const n = spans.push(source.replace(/\s*\n\s*/g, ' ')) - 1;
      out += `\u0001${n}\u0002${MORE.repeat(source.split('\n').length - 1)}`;
      i = close + open.length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const THEMATIC = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^(?:=+|-+)[ \t]*$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;
const ITEM = /^([*+-]|(\d{1,9})[.)])( *)(.*)$/;

/** A list item's marker at `text` (indent stripped): { width, blank, start } or null. */
function itemOf(text, indent) {
  if (THEMATIC.test(text)) return null;
  const m = ITEM.exec(text);
  if (!m || (m[3] === '' && m[4] !== '')) return null;
  const blank = m[4].trim() === '';
  const spaces = blank || m[3].length > 4 ? 1 : m[3].length;
  return { width: indent + m[1].length + spaces, blank, start: m[2] };
}

/** Whether `text` (after the containers) starts a block that ends a paragraph. */
function interrupts(text) {
  const indent = indentOf(text);
  if (indent >= 4) return false;
  const t = text.slice(indent);
  const fence = FENCE_OPEN.exec(t);
  if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) return true;
  if (t.startsWith('>') || HEADING.test(t) || THEMATIC.test(t) || t.startsWith('<!--')) return true;
  const item = itemOf(t, indent);
  return Boolean(item && !item.blank && (item.start === undefined || Number(item.start) === 1));
}

/**
 * The body as a reader of GitHub's rendering sees it: each line is kept when it is a line of
 * a paragraph or a heading outside any blockquote (code spans and HTML comments in it
 * replaced by their marks, each span's source pushed to `spans`), and blank otherwise. The
 * blocks follow CommonMark's container rules (0.31, 5.1-5.2), so fenced code (a fence
 * indented at most 3 columns past its container's content, a backtick fence whose info holds
 * no backtick, to its closing fence or the container's end), indented code, HTML comments
 * and blockquotes with their lazy continuation lines are code or quotes in a list item as at
 * the top level, and a fence indented 4 columns outside a list is no fence (review of #255,
 * R5, R15, R21).
 */
export function proseOf(body, spans = []) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
  const out = lines.map(() => '');
  let stack = [];
  let leaf = null;
  const close = () => {
    if (leaf && leaf.type === 'para' && !leaf.quoted) {
      const text = inline(leaf.lines.map((l) => l.text).join('\n'), spans).split('\n');
      leaf.lines.forEach((l, j) => {
        out[l.n] = `${l.prefix}${text[j]}`;
      });
    }
    leaf = null;
  };
  const para = (n, prefix, text) => {
    if (!leaf || leaf.type !== 'para') {
      close();
      leaf = { type: 'para', quoted: stack.some((c) => c.type === 'quote'), lines: [] };
    }
    leaf.lines.push({ n, prefix, text });
  };
  lines.forEach((line, n) => {
    let pos = 0;
    let matched = 0;
    for (const c of stack) {
      const rest = line.slice(pos);
      const indent = indentOf(rest);
      if (c.type === 'quote') {
        if (indent > 3 || rest[indent] !== '>') break;
        pos += indent + 1 + (rest[indent + 1] === ' ' ? 1 : 0);
      } else if (rest.trim() !== '') {
        if (indent < c.width) break;
        pos += c.width;
      }
      matched += 1;
    }
    let rest = line.slice(pos);
    if (matched === stack.length && leaf && leaf.type === 'fence') {
      const indent = indentOf(rest);
      const t = rest.slice(indent);
      if (indent <= 3 && t.startsWith(leaf.fence) && new RegExp(`^\\${leaf.fence[0]}+[ ]*$`)
        .test(t)) leaf = null;
      return;
    }
    if (matched === stack.length && leaf && leaf.type === 'html') {
      if (rest.includes('-->')) leaf = null;
      return;
    }
    if (matched < stack.length) {
      // a lazy continuation line of a paragraph keeps its containers
      if (leaf && leaf.type === 'para' && rest.trim() !== '' && !interrupts(rest)) {
        para(n, line.slice(0, pos), rest);
        return;
      }
      close();
      stack = stack.slice(0, matched);
    }
    // new containers
    for (;;) {
      rest = line.slice(pos);
      const indent = indentOf(rest);
      if (indent >= 4) break;
      const t = rest.slice(indent);
      if (t.startsWith('>')) {
        close();
        stack.push({ type: 'quote' });
        pos += indent + 1 + (t[1] === ' ' ? 1 : 0);
        continue;
      }
      const item = itemOf(t, indent);
      if (!item) break;
      if (leaf && leaf.type === 'para'
        && (item.blank || (item.start !== undefined && Number(item.start) !== 1))) break;
      close();
      stack.push({ type: 'item', width: item.width });
      pos += Math.min(item.width, rest.length);
      if (item.blank) break;
    }
    rest = line.slice(pos);
    const prefix = line.slice(0, pos);
    if (rest.trim() === '') {
      if (leaf && leaf.type === 'para') close();
      return;
    }
    const indent = indentOf(rest);
    if (indent >= 4) {
      if (leaf && leaf.type === 'para') para(n, prefix, rest);
      else leaf = { type: 'code' };
      return;
    }
    if (leaf && leaf.type === 'code') leaf = null;
    const t = rest.slice(indent);
    const fence = FENCE_OPEN.exec(t);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      close();
      leaf = { type: 'fence', fence: fence[1] };
      return;
    }
    if (t.startsWith('<!--')) {
      close();
      if (!t.slice(4).includes('-->')) leaf = { type: 'html' };
      return;
    }
    if (HEADING.test(t)) {
      close();
      if (!stack.some((c) => c.type === 'quote')) out[n] = `${prefix}${inline(rest, spans)}`;
      return;
    }
    if (leaf && leaf.type === 'para' && SETEXT.test(t)) {
      close();
      return;
    }
    if (THEMATIC.test(t)) {
      close();
      return;
    }
    para(n, prefix, rest);
  });
  close();
  return out.join('\n');
}

/**
 * null when the body carries no waiver line of its own, else { reason }. The reason is empty
 * when none was given, or when it is only a placeholder (`<reason>`) or punctuation.
 */
export function waiver(body) {
  return waiverOf(WAIVER, body);
}

/**
 * The waiver `pattern` (its group 1 the reason) finds on a line of the body's own prose, as
 * waiver() reads it: null, or { reason }. The reason is words of the author's own, outside
 * code (review of #255, R16) and outside a placeholder, else ''; its code is printed as written.
 */
export function waiverOf(pattern, body) {
  const spans = [];
  const m = pattern.exec(proseOf(body, spans));
  if (!m) return null;
  const reason = m[1].trim();
  const words = reason.replace(SPAN_MARK, '').replace(/<[^>]*>/g, '');
  return { reason: /[\p{L}\p{N}]/u.test(words)
    ? reason.replace(SPAN_MARK, (_, k) => spans[Number(k)] ?? '').trim() : '' };
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

/** Make an extracted tree a git repository with its files staged (no commit, no hooks). */
function stage(tree) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A']]) {
    const r = spawnSync('git', ['-C', tree, ...args], { encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${tree}: ${r.stderr.trim()}`);
  }
  // node_modules is linked in afterwards; a `node_modules/` ignore pattern does not match a
  // symlink, and it must stay as invisible to `git ls-files --others` as the real directory.
  appendFileSync(path.join(tree, '.git', 'info', 'exclude'), '\n/node_modules\n');
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
  if (w) {
    say('fail-first: the PR body says `fail-first: n/a` without a reason (a placeholder such as'
      + ' `<reason>` is not one); a waiver needs one');
  }

  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]);
  const baseSha = base ? commitOf(repo, base)
    : git(repo, ['merge-base', commitOf(repo, baseBranch), headSha]);
  say(`fail-first: head ${headSha.slice(0, 12)}, merge base ${baseSha.slice(0, 12)}`);
  // -z: a name with non-ASCII characters is itself, not a quoted, escaped form
  const files = git(repo, ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=AM',
    baseSha, headSha, '--', 'tests/unit']).split('\0').filter((f) => TEST_FILE.test(f));
  if (!files.length) {
    say('fail-first: the PR adds or changes no tests/unit/**/*.test.mjs file, so nothing fails'
      + ' without the change');
    say('fail-first: add a unit test that fails on the merge base, or put'
      + ' `fail-first: n/a` and the reason on one line of the PR body');
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
    // A test that asks git for the tracked files (`git ls-files`) must find them in both
    // trees: each becomes a repository with everything staged and no history.
    for (const tree of [withTree, withoutTree]) stage(tree);
    const modules = path.join(repo, 'node_modules');
    if (existsSync(modules)) {
      for (const tree of [withTree, withoutTree]) {
        symlinkSync(modules, path.join(tree, 'node_modules'));
      }
    }
    for (const file of files) {
      let withRun = runFile(withTree, file);
      if (!withRun.ok) {
        // The head run is the control for the harness. One retry, said out loud: a test that
        // is sensitive to a loaded machine must not turn real evidence into "not evidence".
        say(`  ${file}: failed with the change (${failureKind(withRun.output, withRun.timedOut)});`
          + ' running it once more');
        withRun = runFile(withTree, file);
      }
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
      + ' `fail-first: n/a` and the reason on one line of the PR body');
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

// (real paths: started through a symlink, the program must still know it is the one run,
// or it would do nothing and exit 0)
const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
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
