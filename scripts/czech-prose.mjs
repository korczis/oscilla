#!/usr/bin/env node
// node scripts/czech-prose.mjs [--write] — the English prose the app still shows (Q104,
// rule project.czech-prose).
//
// The owner's order of 2026-11-07: every visible text of the app is Czech. What the app shows is
// the text of src/index.html (text nodes and the aria-label, title, placeholder and alt
// attributes) and the string literals of src/js, comments excluded. A string is English prose
// when it has three words or more, two of them English function words, and no Czech letter with
// a diacritic. That is a measure, not a translator: it finds sentences, not single labels, and
// it errs on the side of a sentence. The counts per file are a ratchet
// (tests/unit/czech-prose-baseline.json): a file's count only falls, a file not listed has none,
// so no new English sentence can land while the old ones are translated file by file.
//
//   node scripts/czech-prose.mjs           print the counts and the total
//   node scripts/czech-prose.mjs --write   write the baseline (only to lower it, in the change
//                                          that translates; a raise is refused by the test)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lexJs } from './ui-catalog/scan.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_REL = 'tests/unit/czech-prose-baseline.json';
const STOP = new Set(['the', 'and', 'of', 'to', 'is', 'a', 'an', 'in', 'for', 'with', 'on', 'it',
  'this', 'that', 'or', 'by', 'from', 'are', 'be', 'not', 'no', 'its', 'as', 'at', 'when', 'what',
  'you', 'your', 'until', 'then', 'there', 'can', 'will', 'has', 'have', 'was', 'were', 'which',
  'if', 'into', 'only', 'all', 'each', 'every', 'here', 'after', 'before', 'than', 'nothing',
  'does', 'do', 'how', 'why', 'where', 'while', 'so', 'but', 'they', 'them', 'one', 'first']);
const CZECH = /[áčďéěíňóřšťúůýž]/i;

/** Whether `text` reads as an English sentence the app shows. */
export function isEnglishProse(text) {
  const t = String(text).replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ').trim();
  if (CZECH.test(t)) return false;
  // A hex digest (a pinned SHA-256) is no sentence, whatever letters its digits leave (K022).
  if (/^[0-9a-f]{16,}$/i.test(t)) return false;
  const words = t.toLowerCase().match(/[a-z']+/g) || [];
  return words.length >= 3 && words.filter((w) => STOP.has(w)).length >= 2;
}

/** The English sentences of an HTML template: text nodes and user-facing attributes. */
export function htmlProse(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of body.matchAll(/>([^<>]+)</g)) if (isEnglishProse(m[1])) out.push(m[1].trim());
  for (const m of body.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"]+)"/g)) {
    if (isEnglishProse(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The English sentences among the string literals and templates of a module. The literals come
 * from the repository's one JavaScript lexer (scripts/ui-catalog/scan.mjs lexJs), which tells
 * comments, strings, templates and regular expressions apart, so a short template can never pair
 * with the next one's backtick and turn a span of code into a "sentence" (a3's review of #469).
 */
export function moduleProse(source) {
  return lexJs(source).strings.map((s) => s.text)
    .filter((t) => t.length >= 12 && isEnglishProse(t));
}

function jsFiles(root, dir) {
  return readdirSync(path.join(root, dir)).flatMap((n) => {
    const rel = path.join(dir, n);
    if (statSync(path.join(root, rel)).isDirectory()) return jsFiles(root, rel);
    return n.endsWith('.js') ? [rel] : [];
  });
}

/** { file: count } of English sentences the app shows, files with none left out. */
export function proseCounts(root = ROOT) {
  const counts = {};
  const html = htmlProse(readFileSync(path.join(root, 'src/index.html'), 'utf8')).length;
  if (html) counts['src/index.html'] = html;
  for (const f of jsFiles(root, 'src/js').sort()) {
    const n = moduleProse(readFileSync(path.join(root, f), 'utf8')).length;
    if (n) counts[f.split(path.sep).join('/')] = n;
  }
  return counts;
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  const counts = proseCounts(root);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (argv.includes('--write')) {
    writeFileSync(path.join(root, BASELINE_REL), `${JSON.stringify({ note: 'English prose the '
      + 'app still shows, per file (scripts/czech-prose.mjs, rule project.czech-prose, Q104): '
      + 'a count only falls and a file not listed has none. Lower it in the change that '
      + 'translates; never raise it.', total, counts }, null, 2)}\n`);
  }
  console.log(`czech-prose: ${total} English sentence(s) in ${Object.keys(counts).length} file(s)`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main();
