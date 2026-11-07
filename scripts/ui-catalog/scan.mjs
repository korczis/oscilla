// The data-osc census of the source tree (plan issue G001): every hook src/index.html and src/js
// write or name, split into literal hooks and the sites that build a value at run time. Pure
// apart from reading files; the unit test (tests/unit/ui-catalog.test.mjs) and the catalogue
// check (check.mjs) import it.
//
//   scanHooks(root) -> { literals: Map<hook, Set<file>>, sites: [{ file, line, expr }],
//                        occurrences: [{ hook | null, expr, file, index, form }] }
//     (form: 'attr' an HTML attribute, 'key' an element description key, 'call' setAttribute,
//     'dataset' an assignment, 'string' inside a string; index: the offset of the value)
//   scanSources({ html: { file: text }, js: { file: text } }) -> the same, for fixtures
//   lexJs(text) -> { code, strings }   comments blanked (newlines kept); every string literal
//   stringLiteralsOf(text) -> [text]   the contents of a file's string literals, comments removed
//
// What counts, with comments removed:
//   src/index.html  a static data-osc="..." attribute, and a bound :data-osc="<expr>" or
//                   x-bind:data-osc="<expr>" (HTML comments are removed; data-osc-* attributes
//                   are other attributes). A bound expression that is only quoted string
//                   literals chosen by conditionals (`c ? 'a' : 'b'`, nested or in parentheses)
//                   yields each literal as a literal hook; any other bound expression is a site;
//   src/js          'data-osc': <expr> and "data-osc": <expr> (an element description),
//                   setAttribute('data-osc', <expr>), .dataset.osc = <expr>, dataOsc: <expr>, and
//                   data-osc="..." inside a string or template (markup, or a selector).
// A string literal without an interpolation is a literal hook; anything else (a template with
// ${...}, a variable, a call) is a site, which a pattern declaration must cover.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const HTML_FILE = 'src/index.html';
export const JS_DIR = 'src/js';

const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+',
  '-', '*', '%', '<', '>', '~', '^', '']);
const REGEX_AFTER_WORDS = new RegExp('(?:^|[^\\w$])(?:return|typeof|case|do|else|in|of|new|delete'
  + '|void|throw|yield|await)$');

/**
 * Lex JavaScript far enough to tell code, comments, strings, templates and regular expressions
 * apart. `code` is the text with every comment replaced by spaces (newlines kept, so offsets and
 * line numbers hold); `strings` lists each string literal and template: { start, end, text,
 * interpolated }, where a template's text keeps its ${...} parts verbatim. The literals inside an
 * interpolation are listed too.
 */
export function lexJs(src) {
  const out = src.split('');
  const strings = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  // Last significant character before `i` in the comment-free output, for the regex test.
  const before = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    return k < 0 ? '' : out[k];
  };
  const wordBefore = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k])) k -= 1;
    return out.slice(Math.max(0, k - 9), k + 1).join('');
  };
  const quoted = (i) => {
    const q = src[i];
    let j = i + 1;
    while (j < src.length && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    strings.push({ start: i, end: j + 1, text: src.slice(i + 1, j), interpolated: false });
    return j + 1;
  };
  const regex = (i) => {
    let j = i + 1;
    let cls = false;
    while (j < src.length && src[j] !== '\n') {
      if (src[j] === '\\') j += 2;
      else if (cls) { if (src[j] === ']') cls = false; j += 1; }
      else if (src[j] === '[') { cls = true; j += 1; }
      else if (src[j] === '/') break;
      else j += 1;
    }
    j += 1;
    while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
    return j;
  };
  // Code from `i` until a `}` at depth 0 (an interpolation) or the end; returns the index after.
  const code = (i, inInterpolation) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        const j = src.indexOf('\n', i);
        const end = j < 0 ? src.length : j;
        blank(i, end);
        i = end;
      } else if (c === '/' && src[i + 1] === '*') {
        const j = src.indexOf('*/', i + 2);
        const end = j < 0 ? src.length : j + 2;
        blank(i, end);
        i = end;
      } else if (c === "'" || c === '"') {
        i = quoted(i);
      } else if (c === '`') {
        i = template(i);
      } else if (c === '/'
        && (REGEX_BEFORE.has(before(i)) || REGEX_AFTER_WORDS.test(wordBefore(i)))) {
        i = regex(i);
      } else if (c === '{') {
        depth += 1;
        i += 1;
      } else if (c === '}') {
        if (inInterpolation && depth === 0) return i + 1;
        depth -= 1;
        i += 1;
      } else i += 1;
    }
    return i;
  };
  const template = (i) => {
    let j = i + 1;
    let interpolated = false;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '$' && src[j + 1] === '{') {
        interpolated = true;
        j = code(j + 2, true);
      } else j += 1;
    }
    strings.push({ start: i, end: j + 1, text: src.slice(i + 1, j), interpolated });
    return j + 1;
  };
  code(0, false);
  strings.sort((a, b) => a.start - b.start);
  return { code: out.join(''), strings };
}

/** The contents of every string literal and template of a JavaScript file, comments removed. */
export const stringLiteralsOf = (src) => lexJs(src).strings.map((s) => s.text);

/** End of the expression that starts at `i` (a `,`, `;`, closing bracket at depth 0). */
function expressionEnd(code, i) {
  let depth = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let inner = 0;
      while (j < code.length && !(code[j] === '`' && inner === 0)) {
        if (code[j] === '\\') j += 1;
        else if (code[j] === '$' && code[j + 1] === '{') { inner += 1; j += 1; }
        else if (code[j] === '}' && inner > 0) inner -= 1;
        j += 1;
      }
      i = j + 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
      i += 1;
    } else if (')]}'.includes(c)) {
      if (depth === 0) return i;
      depth -= 1;
      i += 1;
    } else if ((c === ',' || c === ';') && depth === 0) {
      return i;
    } else i += 1;
  }
  return i;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** A literal hook's value, or null when `expr` is not one string literal. */
export function literalValue(expr) {
  const e = expr.trim();
  const m = e.match(/^'([^'\\]*)'$/) || e.match(/^"([^"\\]*)"$/) || e.match(/^`([^`\\$]*)`$/);
  return m ? m[1] : null;
}

const JS_FORMS = [
  [/(['"])data-osc\1\s*:\s*/g, 'key'],
  [/\bsetAttribute\s*\(\s*(['"])data-osc\1\s*,\s*/g, 'call'],
  [/\.dataset\s*\.\s*osc\b\s*=(?!=)\s*/g, 'dataset'],
  [/(?<![\w$.'"-])dataOsc\s*:\s*/g, 'key'],
];
const IN_STRING = /data-osc\s*=\s*\\?(["'])(.*?)\\?\1/g;
const HTML_ATTR = /(?<![\w:@.-])data-osc="([^"]*)"/g;
const HTML_BOUND = /(?<![\w:@.-])(?:x-bind)?:data-osc="([^"]*)"/g;

/**
 * The index of the first `ch` at depth 0 of `e` from `from`, outside strings (a `:` skips the
 * ones of nested conditionals; a closing bracket is the one that leaves depth 0); -1 if none.
 */
function topLevel(e, ch, from = 0) {
  let depth = 0;
  let nested = 0; // conditionals opened inside the one being matched
  for (let i = from; i < e.length; i += 1) {
    const c = e[i];
    if (c === "'" || c === '"' || c === '`') {
      const j = e.indexOf(c, i + 1);
      if (j < 0) return -1;
      i = j;
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c) && depth === 0 && c === ch) return i;
    else if (')]}'.includes(c)) depth -= 1;
    else if (depth === 0 && c === '?' && (e[i + 1] === '?' || e[i + 1] === '.')) i += 1;
    else if (depth === 0 && c === ':' && ch === ':' && nested > 0) nested -= 1;
    else if (depth === 0 && c === ch) return i;
    else if (depth === 0 && c === '?' && ch === ':') nested += 1;
  }
  return -1;
}

/**
 * The hooks of a bound expression that only chooses between string literals
 * (`a ? 'x' : b ? 'y' : 'z'`, parentheses allowed), or null for any other expression.
 */
export function conditionalLiterals(expr) {
  let e = expr.trim();
  // Outer parentheses go when the first one closes at the end: '(a ? b : c)', not '(a) ? b : c'.
  while (e.startsWith('(') && topLevel(e.slice(1), ')') === e.length - 2) e = e.slice(1, -1).trim();
  const value = literalValue(e);
  if (value !== null) return value.includes('${') ? null : [value];
  const q = topLevel(e, '?');
  if (q < 0) return null;
  const colon = topLevel(e, ':', q + 1);
  if (colon < 0) return null;
  const yes = conditionalLiterals(e.slice(q + 1, colon));
  const no = conditionalLiterals(e.slice(colon + 1));
  return yes && no ? [...yes, ...no] : null;
}

/** The census of in-memory sources: { html: { file: text }, js: { file: text } }. */
export function scanSources({ html = {}, js = {} }) {
  const literals = new Map();
  const sites = [];
  const occurrences = [];
  const add = (hook, file) => {
    if (!literals.has(hook)) literals.set(hook, new Set());
    literals.get(hook).add(file);
  };
  const seen = (hook, expr, file, index, form) => {
    occurrences.push({ hook, expr, file, index, form });
    if (hook !== null) add(hook, file);
  };
  for (const [file, text] of Object.entries(html)) {
    const markup = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of markup.matchAll(HTML_ATTR)) {
      const dynamic = m[1].includes('${') || m[1].includes('{{');
      if (dynamic) sites.push({ file, line: lineAt(markup, m.index), expr: m[1] });
      seen(dynamic ? null : m[1], m[1], file, m.index, 'attr');
    }
    for (const m of markup.matchAll(HTML_BOUND)) {
      const hooks = conditionalLiterals(m[1]);
      if (!hooks) {
        sites.push({ file, line: lineAt(markup, m.index), expr: m[1] });
        seen(null, m[1], file, m.index, 'attr');
      } else for (const h of hooks) seen(h, m[1], file, m.index, 'attr');
    }
  }
  for (const [file, text] of Object.entries(js)) {
    const { code, strings } = lexJs(text);
    for (const [re, form] of JS_FORMS) {
      for (const m of code.matchAll(re)) {
        const start = m.index + m[0].length;
        const expr = code.slice(start, expressionEnd(code, start)).trim();
        const value = literalValue(expr);
        if (value === null) sites.push({ file, line: lineAt(code, m.index), expr });
        seen(value, expr, file, start, form);
      }
    }
    for (const s of strings) {
      for (const m of s.text.matchAll(IN_STRING)) {
        const dynamic = m[2].includes('${');
        const index = s.start + 1 + m.index;
        if (dynamic) sites.push({ file, line: lineAt(text, index), expr: m[2] });
        seen(dynamic ? null : m[2], m[2], file, index, 'string');
      }
    }
  }
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { literals, sites, occurrences };
}

/** Every .js file under `dir` (relative to root), sorted. */
export function jsFiles(root, dir = JS_DIR) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(root, child)).isDirectory()) walk(child);
      else if (name.endsWith('.js')) out.push(child);
    }
  };
  walk(dir);
  return out;
}

/** The census of the tree at `root`. */
export function scanHooks(root) {
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const js = {};
  for (const file of jsFiles(root)) js[file] = read(file);
  return scanSources({ html: { [HTML_FILE]: read(HTML_FILE) }, js });
}
