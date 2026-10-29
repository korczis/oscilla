#!/usr/bin/env node
// project.fail-first: a feat or fix PR's unit tests fail without the change.
//
//   node scripts/fail-first.mjs --title "fix(x): ..." [--body-file <f>]
//   node scripts/fail-first.mjs --pr-json <file>          # {"title": ..., "body": ...}
//        [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]
//
// For a PR whose title starts with feat or fix (in any case, behind bracketed tags), the unit
// test files the PR adds or changes (tests/unit/**/*.test.mjs between the merge base and the
// head) are run twice with `node --test`, in two trees written blob by blob from git (`git
// ls-tree` and `git cat-file`: regular files only, no tar, no link) and made git repositories
// with their files staged (so `git ls-files` answers; there is no history):
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
// Everything the judge reads of the repository it reads before any child runs (review of
// #255, round 8): the head, the merge base, the changed test files and both trees, written and
// staged, all through judgeGit() (scripts/git-ref.mjs: no replace refs, no global or system
// config, no inherited GIT_* variable). A child (install-time code included) may then write the
// checkout's .git as it likes: nothing reads it again.
//
// Every child (each `node --test`, and in CI the install) runs through
// scripts/judge-isolation.mjs: in a process group of its own that is killed when it ends, with
// a whole environment of a fixed PATH and a HOME of its own, so it never sees the runner's
// GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY or RUNNER_TEMP; the judgement is
// made in this process from the children's exit statuses. First the Yama ptrace probe: where a
// same-uid child could ptrace this process the program refuses to judge (off Linux it is
// skipped with a note, outside CI only).
//
// In CI this program is the base commit's copy in $RUNNER_TEMP/judge, and JUDGE_MANIFEST
// carries the sha256 of that copy's .manifest, which its job's `judge` step wrote (review of
// #255, round 4, R12, R22). Then, before any child, the copy is checked against the manifest
// (and again after the last child: a copy that changed refuses), and the judge drives the
// install itself: `npm ci --ignore-scripts` as a child in the extracted head tree, never in the
// checkout (round 8), whose node_modules the other tree links to; then the tests. No step of
// the job runs anything of the pull request before this program has loaded. Install-time code
// (a git dependency's prepare, a program a .npmrc names) is the pull request's code, contained
// exactly as its tests are; no guard tries to tell it apart.
//
// Exit 0: nothing to prove, waived, or proven. Exit 1: not proven, or refused. Exit 2: usage.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitOf, judgeGit } from './git-ref.mjs';
import { copyProblems, isolatedEnv, loadManifest, ptraceProbe, runIsolated, treeOf, writeTree }
  from './judge-isolation.mjs';

// Any case, any spacing, and behind bracketed tags ("[WIP] Fix (x) : ..."): a title that reads
// as feat or fix is one, whatever a stricter parser downstream makes of it.
export const TITLE = /^\s*(?:\[[^\]]*\]\s*)*(feat|fix)\s*(\([^)]*\))?\s*!?\s*:/i;
export const WAIVER = /^[ \t]*(?:[*-][ \t]+)?fail-first:[ \t]*n\/a\b[ \t]*(.*)$/im;
const TEST_FILE = /^tests\/unit\/.+\.test\.mjs$/;
const FILE_TIMEOUT_MS = 180_000;
const INSTALL_TIMEOUT_MS = 300_000;

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
    // an inline tag: its attributes, across lines too, are not rendered (round 4, R5)
    const tag = c === '<' ? INLINE_TAG.exec(text.slice(i)) : null;
    if (tag) {
      out += MORE.repeat(tag[0].split('\n').length - 1);
      i += tag[0].length;
      continue;
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
    // an image shows none of its alt text, and a link its title only as an attribute (round
    // 5, R5): neither is prose, across lines too. Read loosely, so that it hides more rather
    // than less: a `](...)` whose `[` is missing is hidden as well, and a waiver hidden so is
    // no waiver, which only asks the pull request for its evidence.
    if (c === '!' && text[i + 1] === '[') {
      const close = bracketEnd(text, i + 1);
      if (close !== null) {
        const end = (text[close + 1] === '(' && linkTail(text, close + 1))
          || (text[close + 1] === '[' && (bracketEnd(text, close + 1) ?? close) + 1) || close + 1;
        out += MORE.repeat(text.slice(i, end).split('\n').length - 1);
        i = end;
        continue;
      }
    }
    if (c === ']' && text[i + 1] === '(') {
      const end = linkTail(text, i + 1);
      if (end) {
        out += `]${MORE.repeat(text.slice(i, end).split('\n').length - 1)}`;
        i = end;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The index past a run of spaces and tabs with at most one line ending in it, from `k`. */
const skipSpace = (text, k) => k + /^[ \t]*\n?[ \t]*/.exec(text.slice(k))[0].length;

/**
 * The index of the `]` that closes the `[` at `at` (nested brackets, backslash escapes and
 * code spans skipped), or null.
 */
function bracketEnd(text, at) {
  let depth = 0;
  for (let k = at; k < text.length; k++) {
    const c = text[k];
    if (c === '\\') {
      k++;
    } else if (c === '`') {
      const run = /^`+/.exec(text.slice(k))[0];
      const shut = text.indexOf(run, k + run.length);
      k = (shut < 0 ? k : shut) + run.length - 1;
    } else if (c === '[') {
      depth++;
    } else if (c === ']' && --depth === 0) {
      return k;
    }
  }
  return null;
}

/**
 * The index past an inline link's or image's `(destination "title")` that opens at `at`
 * (CommonMark 0.31, 6.3: the destination in <> or without spaces, its parentheses balanced;
 * the title in "", '' or (), across lines), or null when there is none.
 */
function linkTail(text, at) {
  let k = skipSpace(text, at + 1);
  if (text[k] === '<') {
    const e = text.indexOf('>', k + 1);
    if (e < 0 || text.slice(k, e).includes('\n')) return null;
    k = e + 1;
  } else {
    let depth = 0;
    while (k < text.length && !/[\s\x00-\x1f]/.test(text[k])) {
      if (text[k] === '\\') k++;
      else if (text[k] === '(') depth++;
      else if (text[k] === ')' && depth-- === 0) break;
      k++;
    }
  }
  const dest = k;
  k = skipSpace(text, k);
  if (k > dest && /["'(]/.test(text[k] ?? '')) {
    const shut = text[k] === '(' ? ')' : text[k];
    let j = k + 1;
    while (j < text.length && text[j] !== shut) j += text[j] === '\\' ? 2 : 1;
    if (j >= text.length) return null;
    k = skipSpace(text, j + 1);
  }
  return text[k] === ')' ? k + 1 : null;
}

const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`;
const OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\s*\/?>`;
const INLINE_TAG = new RegExp(`^(?:${OPEN_TAG}|<\\/[A-Za-z][A-Za-z0-9-]*\\s*>)`);
const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col'
  + '|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame'
  + '|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav'
  + '|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th'
  + '|thead|title|tr|track|ul';
/**
 * The HTML blocks of CommonMark 0.31 (4.6): [start, end] per kind, `end` null for a block
 * that ends at a blank line; the 7th kind (a lone complete tag) cannot interrupt a paragraph.
 */
const HTML_BLOCKS = [
  [/^<(?:script|pre|style|textarea)(?:[\s>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Za-z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/],
  [new RegExp(`^<\\/?(?:${BLOCK_TAGS})(?:[\\s>]|\\/>|$)`, 'i'), null],
];
const HTML_BLOCK_7 = new RegExp(`^(?:${OPEN_TAG}|<\\/[A-Za-z][A-Za-z0-9-]*\\s*>)\\s*$`);

/** The HTML block `t` opens, or null: { end, rest } (`rest` the text after the start). */
function htmlBlockOf(t, inParagraph) {
  for (const [start, end] of HTML_BLOCKS) {
    if (start.test(t)) return { end, rest: t.slice(4) };
  }
  if (!inParagraph && HTML_BLOCK_7.test(t)) return { end: null, rest: '' };
  return null;
}

/**
 * Where the link reference definitions at the start of a paragraph's text end (CommonMark
 * 0.31, 4.7): GitHub renders none of a definition, its title across lines included (round 4,
 * R5). 0 when the paragraph starts with none.
 */
function definitionsEnd(text) {
  let pos = 0;
  for (;;) {
    const rest = text.slice(pos);
    const label = /^ {0,3}\[((?:[^\\[\]]|\\.){1,999})\]:/.exec(rest);
    if (!label || !label[1].trim()) return pos;
    let k = label[0].length;
    const space = /^[ \t]*\n?[ \t]*/.exec(rest.slice(k))[0];
    k += space.length;
    const dest = /^(?:<[^<>\n]*>|[^\s<][^\s]*)/.exec(rest.slice(k));
    if (!dest) return pos;
    k += dest[0].length;
    const lineEnd = (at) => {
      const n = rest.indexOf('\n', at);
      return n < 0 ? rest.length : n + 1;
    };
    const afterDest = lineEnd(k);
    const restOfLine = rest.slice(k, afterDest).replace(/\n$/, '');
    const gap = /^[ \t]*\n?[ \t]*/.exec(rest.slice(k))[0];
    const open = rest[k + gap.length];
    let end = null;
    if (gap.length && /["'(]/.test(open ?? '')) {
      const close = open === '(' ? ')' : open;
      let j = k + gap.length + 1;
      while (j < rest.length && rest[j] !== close) j += rest[j] === '\\' ? 2 : 1;
      if (rest[j] === close && /^[ \t]*(?:\n|$)/.test(rest.slice(j + 1))) end = lineEnd(j + 1);
    }
    if (end === null) {
      // no title (or none that closes): the definition is its destination's line, if nothing
      // else is on it
      if (restOfLine.trim() !== '') return pos;
      end = afterDest;
    }
    pos += end;
  }
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
  if (t.startsWith('>') || HEADING.test(t) || THEMATIC.test(t) || htmlBlockOf(t, true)) return true;
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
      // the link reference definitions at its start are no prose (round 4, R5)
      const raw = leaf.lines.map((l) => l.text).join('\n');
      const defs = raw.slice(0, definitionsEnd(raw)).split('\n').length - 1
        + (definitionsEnd(raw) === raw.length && raw.length ? 1 : 0);
      const lines = leaf.lines.slice(defs);
      const text = inline(lines.map((l) => l.text).join('\n'), spans).split('\n');
      lines.forEach((l, j) => {
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
      if (leaf.end ? leaf.end.test(rest) : rest.trim() === '') leaf = null;
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
    // an HTML block (round 4, R5: a type-6 block's attribute across lines is no prose)
    const html = htmlBlockOf(t, Boolean(leaf && leaf.type === 'para'));
    if (html) {
      close();
      if (!(html.end && html.end.test(html.rest))) leaf = { type: 'html', end: html.end };
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

/** One git call of the judge (judgeGit): its trimmed output, or a throw. */
function git(repo, args, opts = {}) {
  const r = judgeGit(repo, args, opts);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

const inTests = (rel) => rel === 'tests' || rel.startsWith('tests/');

/**
 * Make a written tree a git repository with its files staged (no commit, no hooks), by
 * judgeGit: its .git is new, so no configuration of the checkout's applies.
 */
function stage(tree) {
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A']]) {
    const r = judgeGit(tree, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${tree}: ${r.stderr.trim()}`);
  }
  // node_modules is linked or installed afterwards; a `node_modules/` ignore pattern does not
  // match a symlink, and it must stay as invisible to `git ls-files --others` as the real
  // directory.
  mkdirSync(path.join(tree, '.git', 'info'), { recursive: true });
  appendFileSync(path.join(tree, '.git', 'info', 'exclude'), '\n/node_modules\n');
}

/** One `node --test` of `file` in `tree`, as an isolated child with the environment `env`. */
async function runFile(tree, file, env) {
  const r = await runIsolated(process.execPath, ['--test', '--test-reporter=tap', file], {
    cwd: tree, env, timeoutMs: FILE_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  const failed = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
    .filter((name) => name !== file && !name.endsWith(path.basename(file)));
  return { ok: r.status === 0, output, timedOut: r.timedOut, failed };
}

/** The flags and settings of the judge's own install: no script, no audit, no network chatter. */
const NPM_ENV = { npm_config_ignore_scripts: 'true', npm_config_audit: 'false',
  npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_progress: 'false' };

/**
 * The judge's install (review of #255, round 4, R12, R22; round 8): `npm ci --ignore-scripts`
 * (the npm beside this node) as an isolated child in `tree`, the extracted head tree, never the
 * checkout. Install-time code is the pull request's code, contained as its tests are. Returns
 * the refusals, [] when the packages are installed.
 */
async function install(tree, home, say) {
  const npm = path.join(path.dirname(process.execPath), 'npm');
  if (!existsSync(npm)) return [`no npm beside the judge's node (${npm})`];
  const r = await runIsolated(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: tree, env: isolatedEnv({ home, extra: NPM_ENV }), timeoutMs: INSTALL_TIMEOUT_MS,
  });
  const tail = `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-6);
  for (const l of tail) say(`  npm: ${l}`);
  if (r.status !== 0) {
    return [`npm ci --ignore-scripts failed (${r.timedOut ? 'timed out' : r.signal
      || `exit ${r.status}`})`];
  }
  say('fail-first: installed with `npm ci --ignore-scripts` by the judge, as its own child, in'
    + ' the extracted head tree');
  return [];
}

/**
 * The judgement of a pull request. `judge` ({ dir, digest }): this program is the CI judge,
 * the base commit's copy at `dir` with the manifest digest its job's `judge` step recorded;
 * the copy is checked before the first child and after the last, and the judge installs the
 * packages itself. `probe` is the ptrace probe (scripts/judge-isolation.mjs ptraceProbe).
 * @returns {Promise<{ status: 'not-applicable'|'waived'|'proven'|'not-proven'|'refused',
 *   lines: string[] }>}
 */
export async function failFirst({ repo, title, body, head = 'HEAD', base,
  baseBranch = 'origin/main', keep = false, judge = null, probe = ptraceProbe }) {
  const lines = [];
  const say = (s) => lines.push(s);
  const refuse = (why) => {
    say(`fail-first: REFUSED to judge: ${why}`);
    return { status: 'refused', lines };
  };
  const ptrace = probe();
  say(`fail-first: ${ptrace.message}`);
  if (!ptrace.ok) return refuse('the judge cannot keep its children out of its memory');
  let manifest = null;
  if (judge) {
    const m = loadManifest(judge.dir, judge.digest);
    if (m.problem) return refuse(`the judge copy: ${m.problem}`);
    const changed = copyProblems(judge.dir, m);
    if (changed.length) {
      return refuse(`the judge copy is not the one extracted: ${changed.join('; ')}`);
    }
    manifest = m;
    say(`fail-first: the judge copy matches its manifest (${m.entries.size} files)`);
  }
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
  const files = git(repo, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff',
    '--no-textconv', '--diff-filter=AM', baseSha, headSha, '--', 'tests/unit']).split('\0')
    .filter((f) => TEST_FILE.test(f));
  if (!files.length) {
    say('fail-first: the PR adds or changes no tests/unit/**/*.test.mjs file, so nothing fails'
      + ' without the change');
    say('fail-first: add a unit test that fails on the merge base, or put'
      + ' `fail-first: n/a` and the reason on one line of the PR body');
    return { status: 'not-proven', lines };
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fail-first-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'fail-first-home-'));
  const installHome = mkdtempSync(path.join(os.tmpdir(), 'fail-first-install-home-'));
  const evidence = [];
  let refused = null;
  try {
    const withTree = path.join(tmp, 'with');
    const withoutTree = path.join(tmp, 'without');
    // Everything of the repository the judgement uses is read now, before any child runs
    // (round 8): the trees, from git objects only; nothing reads the checkout again.
    const headTree = treeOf(repo, headSha);
    const baseTree = treeOf(repo, baseSha);
    for (const [what, sha, tree] of [['the head commit', headSha, headTree],
      ['the merge base', baseSha, baseTree]]) {
      if (!refused && tree.problems.length) {
        refused = `${what} ${sha.slice(0, 12)}: ${tree.problems.join('; ')}`;
      }
    }
    if (!refused) {
      writeTree(repo, headTree, withTree);
      // without: the merge base outside tests/, the head's tests/ in its place
      writeTree(repo, { files: [...baseTree.files.filter((f) => !inTests(f.path)),
        ...headTree.files.filter((f) => inTests(f.path))],
      dirs: [...baseTree.dirs.filter((d) => !inTests(d)), ...headTree.dirs.filter(inTests)] },
      withoutTree);
      // A test that asks git for the tracked files (`git ls-files`) must find them in both
      // trees: each becomes a repository with everything staged and no history.
      for (const tree of [withTree, withoutTree]) stage(tree);
      if (judge) {
        // the judge installs into the head tree; the other tree links to what it installs
        // (linked first: the link is the judge's, made before any child)
        rmSync(path.join(withoutTree, 'node_modules'), { recursive: true, force: true });
        symlinkSync(path.join(withTree, 'node_modules'), path.join(withoutTree, 'node_modules'));
      } else {
        // a local run installs nothing: both trees link to the checkout's packages
        const modules = path.join(repo, 'node_modules');
        if (existsSync(modules)) {
          for (const tree of [withTree, withoutTree]) {
            symlinkSync(modules, path.join(tree, 'node_modules'));
          }
        }
      }
    }
    // after this, the judge only starts children and checks its copy
    if (judge && !refused) {
      const problems = await install(withTree, installHome, say);
      if (problems.length) refused = `the install: ${problems.join('; ')}`;
    }
    const env = isolatedEnv({ home });
    for (const file of refused ? [] : files) {
      let withRun = await runFile(withTree, file, env);
      if (!withRun.ok) {
        // The head run is the control for the harness. One retry, said out loud: a test that
        // is sensitive to a loaded machine must not turn real evidence into "not evidence".
        say(`  ${file}: failed with the change (${failureKind(withRun.output, withRun.timedOut)});`
          + ' running it once more');
        withRun = await runFile(withTree, file, env);
      }
      const withoutRun = await runFile(withoutTree, file, env);
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
    rmSync(home, { recursive: true, force: true });
    rmSync(installHome, { recursive: true, force: true });
  }
  // after the last child: the copy this process loaded from is still the one extracted
  // (defence in depth: what decides is already in memory)
  if (manifest) {
    const changed = copyProblems(judge.dir, manifest);
    if (changed.length) {
      return refuse(`the judge copy changed while the children ran: ${changed.join('; ')}`);
    }
  }
  if (refused) return refuse(refused);
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
  // the CI judge: the copy its job extracted, whose manifest digest the `judge` step recorded
  if (process.env.JUDGE_MANIFEST !== undefined) {
    opts.judge = { dir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      digest: process.env.JUDGE_MANIFEST };
  }
  let result;
  try {
    result = await failFirst(opts);
  } catch (e) {
    console.error(`fail-first: ${e.message}`);
    process.exit(1);
  }
  for (const l of result.lines) console.log(l);
  // the verdict is this exit status alone (nothing downstream reads the log)
  process.exit(result.status === 'not-proven' || result.status === 'refused' ? 1 : 0);
}
