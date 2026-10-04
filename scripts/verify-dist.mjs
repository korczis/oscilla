#!/usr/bin/env node
// Static release gate for dist/index.html (the file:// and GitHub Pages artifact).
//
// Fails when the file
//   - is not the only file in dist/ (a .nojekyll marker is tolerated),
//   - references any local or remote resource (src/href/srcset/poster/data/url()/@import,
//     <link href>, <base>, meta refresh) other than data: URLs and #fragments; <a href> may
//     point to absolute http(s)/mailto/tel destinations because following a link loads nothing,
//   - contains a module, importmap or external script (type=module, src=),
//   - in first-party script uses fetch, XMLHttpRequest, dynamic import(), import.meta, a service
//     worker, importScripts, a worker or worklet loaded from a path, WebSocket/EventSource,
//     sendBeacon or localhost,
//   - carries a source map reference,
//   - embeds a vendor script that is not byte-identical to the pinned package file,
//   - lacks the third-party notice for every vendor,
//   - exceeds the raw or gzip size budget,
//   - (provenance, verifyProvenance) lacks the top-of-file banner or the ONE metadata region,
//     or the region does not parse, is not a build-time "source" record, or names a version or
//     source digest other than package.json and the recomputed digest of the build inputs.
//
//   node scripts/verify-dist.mjs [--dist path/to/index.html]
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { guardRawText } from './pack-single-file.mjs';
import { BUDGET, DIST_HTML, VENDOR_SCRIPTS } from './build-config.mjs';
import {
  computeSourceDigest, findRegion, readBanner, readVersion, validateRecord,
} from './release-metadata.mjs';

const require = createRequire(import.meta.url);

const URL_ATTRS = new Set([
  'src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href', 'background',
  'manifest', 'ping', 'imagesrcset', 'lowsrc', 'longdesc', 'codebase', 'archive',
]);
const NAV_TAGS = new Set(['a', 'area']);
const OK_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript']);
const DATA_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json', 'text/plain']);

// [pattern, message]. Applied to first-party (non-vendor) executable script text.
//
// Workers and worklets from data: URLs pass, and that is still ONE runtime file: the analysis
// Worker's script is the analysis library (scripts/build-analysis-worker.mjs, gap M10; ADR 0026
// resolution note of 2026-10-04), the first-party inline <script data-analysis> that also runs on
// the page before the app; analysis-runner.js starts the Worker from
// `data:text/javascript;charset=utf-8,<that element's text>` (workerDataUrl), the way the capture
// worklet starts from its embedded text. Nothing is requested from a path or a server, and
// because the Worker's script is a first-party script of the page it is scanned by every
// pattern below like the app script (an importScripts or fetch in the Worker fails here like one
// in the page).
const FORBIDDEN_JS = [
  [/(^|[^.\w$])import\s*\(/, 'dynamic import()'],
  [/\bimport\.meta\b/, 'import.meta (module-only)'],
  [/(^|[^.\w$])fetch\s*\(|\b(window|self|globalThis)\.fetch\b/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bserviceWorker\b/, 'service worker'],
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/\bnew\s+(?:Shared)?Worker\s*\(\s*(['"`])(?!data:|blob:)/, 'worker loaded from a path'],
  [/\baddModule\s*\(\s*(['"`])(?!data:|blob:)/, 'worklet loaded from a path'],
  [/\bnew\s+(?:WebSocket|EventSource)\s*\(/, 'WebSocket/EventSource'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\blocalhost\b|\b127\.0\.0\.1\b/, 'localhost reference'],
];

const TOKEN = new RegExp([
  '<!--[\\s\\S]*?-->',                                              // comment
  '<(script|style)\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>([\\s\\S]*?)</\\1\\s*>', // raw text element
  '<([a-zA-Z][\\w:-]*)\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)/?>',     // start tag
].join('|'), 'g');

function parseAttrs(src) {
  const attrs = new Map();
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function isInert(url, { nav = false } = {}) {
  const v = url.trim();
  if (v === '' || v.startsWith('#') || /^data:/i.test(v)) return true;
  return nav && /^(https?:|mailto:|tel:)/i.test(v);
}

function cssProblems(css, where) {
  const out = [];
  if (/@import\b/i.test(css)) out.push(`${where}: CSS @import (must be bundled)`);
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!isInert(m[2])) out.push(`${where}: CSS url(${m[2].slice(0, 60)}) is not a data: URL`);
  }
  return out;
}

/**
 * Pure check of an HTML document. Returns a list of problems (empty = pass).
 * @param {string} html
 * @param {object} [opts]
 * @param {Map<string, string>} [opts.vendors]  vendor id ("p5@1.11.3") -> expected verbatim code
 * @param {{rawBytes: number, gzipBytes: number}} [opts.budget]
 */
export function verifyHtml(html, { vendors = new Map(), budget = BUDGET } = {}) {
  const problems = [];
  const seenVendors = new Set();
  let appScripts = 0;

  if (!/^<!doctype html>/i.test(html)) problems.push('document does not start with a doctype');
  if (!/<meta\s+charset=["']?utf-8/i.test(html)) problems.push('missing <meta charset="utf-8">');
  if (/sourceMappingURL\s*=/.test(html)) problems.push('source map reference (sourceMappingURL)');

  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    if (m[0].startsWith('<!--')) continue;

    if (m[1]) { // <script> / <style> with raw text
      const tag = m[1].toLowerCase();
      const attrs = parseAttrs(m[2]);
      const body = m[3];
      if (tag === 'style') {
        problems.push(...cssProblems(body, '<style>'));
        continue;
      }
      if (attrs.has('src')) problems.push(`external script src="${attrs.get('src')}"`);
      const type = (attrs.get('type') || '').toLowerCase();
      if (DATA_SCRIPT_TYPES.has(type)) continue;
      if (!OK_SCRIPT_TYPES.has(type)) {
        problems.push(`script type="${type}" (only classic scripts are allowed)`);
        continue;
      }
      if (attrs.has('nomodule')) problems.push('nomodule script');
      const vendorId = attrs.get('data-vendor');
      if (vendorId !== undefined) {
        seenVendors.add(vendorId);
        const expected = vendors.get(vendorId);
        if (expected === undefined) problems.push(`unknown vendor script ${vendorId}`);
        else if (guardRawText(expected, 'script', vendorId) !== body) {
          problems.push(`vendor script ${vendorId} is not byte-identical to the pinned file`);
        }
        continue; // vendor code is verified by identity, not by pattern scan
      }
      appScripts += 1;
      for (const [re, what] of FORBIDDEN_JS) {
        const hit = body.match(re);
        if (hit) {
          const at = body.indexOf(hit[0]);
          const context = body.slice(Math.max(0, at - 40), at + 40);
          problems.push(`first-party script uses ${what}: …${context}…`);
        }
      }
      continue;
    }

    const tag = m[4].toLowerCase();
    const attrs = parseAttrs(m[5]);
    if (tag === 'script' || tag === 'style') {
      problems.push(`unterminated <${tag}>`);
      continue;
    }
    if (tag === 'base') problems.push('<base> element changes URL resolution');
    if (tag === 'link') {
      const href = attrs.get('href') || '';
      if (!isInert(href)) problems.push(`<link rel="${attrs.get('rel')}" href="${href}">`);
      continue;
    }
    if (tag === 'meta' && /refresh/i.test(attrs.get('http-equiv') || '')) {
      problems.push('meta refresh');
    }
    for (const [name, value] of attrs) {
      if (name === 'style') problems.push(...cssProblems(value, `<${tag} style>`));
      if (!URL_ATTRS.has(name)) continue;
      const values = name.endsWith('srcset')
        ? value.split(',').map((s) => s.trim().split(/\s+/)[0])
        : [value];
      for (const v of values) {
        if (!isInert(v, { nav: NAV_TAGS.has(tag) && name === 'href' })) {
          problems.push(`<${tag} ${name}="${v.slice(0, 80)}"> references a file`);
        }
      }
    }
  }
  if (appScripts === 0) problems.push('no first-party script found');

  for (const id of vendors.keys()) {
    if (!seenVendors.has(id)) problems.push(`vendor script ${id} missing`);
    const [pkg, version] = [id.slice(0, id.lastIndexOf('@')), id.slice(id.lastIndexOf('@') + 1)];
    const htmlTag = html.search(/<html[\s>]/i);
    const head = htmlTag < 0 ? html.slice(0, html.indexOf('-->') + 3) : html.slice(0, htmlTag);
    if (!head.includes(`== ${pkg}@${version} - `)) {
      problems.push(`third-party notice for ${id} missing`);
    }
  }

  const raw = Buffer.byteLength(html);
  const gzip = gzipSync(html, { level: 9 }).length;
  if (raw > budget.rawBytes) problems.push(`size ${raw} B exceeds raw budget ${budget.rawBytes} B`);
  if (gzip > budget.gzipBytes) {
    problems.push(`gzip size ${gzip} B exceeds budget ${budget.gzipBytes} B`);
  }
  return { problems, raw, gzip, appScripts, vendors: [...seenVendors] };
}

/**
 * Provenance of a built (unstamped) dist: banner and metadata region against the expected
 * product version and source digest. Returns a list of problems (empty = pass).
 * @param {string} html
 * @param {{ version: string, sourceDigest: string, allowStamped?: boolean }} expected
 */
export function verifyProvenance(html, { version, sourceDigest, allowStamped = false }) {
  const problems = [];
  const banner = readBanner(html);
  if (banner === null) problems.push('top-of-file banner comment missing');
  else if (banner !== version) problems.push(`banner names v${banner}, package.json is ${version}`);
  let record;
  try {
    ({ record } = findRegion(html));
  } catch (e) {
    problems.push(e.message);
    return problems;
  }
  problems.push(...validateRecord(record));
  if (record.version !== version) {
    problems.push(`region version ${record.version} != package.json ${version}`);
  }
  if (record.sourceDigest !== sourceDigest) {
    problems.push(`region sourceDigest ${record.sourceDigest} != recomputed ${sourceDigest}`);
  }
  if (!allowStamped && record.channel !== 'source') {
    problems.push(`committed dist must be unstamped (channel "source"), found "${record.channel}"`);
  }
  return problems;
}

export function pinnedVendors(resolve = require.resolve) {
  return new Map(VENDOR_SCRIPTS.map(({ pkg, file }) => {
    const version = JSON.parse(readFileSync(resolve(`${pkg}/package.json`), 'utf8')).version;
    const code = readFileSync(resolve(file), 'utf8').replace(/\r\n/g, '\n').trim();
    return [`${pkg}@${version}`, code];
  }));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const i = process.argv.indexOf('--dist');
  const file = path.resolve(root, i > 0 ? process.argv[i + 1] : DIST_HTML);
  const problems = [];
  if (i < 0) {
    const extra = readdirSync(path.dirname(file))
      .filter((f) => !['index.html', '.nojekyll'].includes(f));
    if (extra.length) {
      problems.push(`dist/ must contain only index.html; found ${extra.join(', ')}`);
    }
  }
  const html = readFileSync(file, 'utf8');
  const result = verifyHtml(html, { vendors: pinnedVendors() });
  problems.push(...result.problems);
  const version = readVersion(root);
  const sourceDigest = computeSourceDigest(root);
  problems.push(...verifyProvenance(html, { version, sourceDigest }));
  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
  console.log(`${path.relative(root, file)}: raw ${kib(result.raw)} / ${kib(BUDGET.rawBytes)}, `
    + `gzip ${kib(result.gzip)} / ${kib(BUDGET.gzipBytes)}; app scripts ${result.appScripts}; `
    + `vendors ${result.vendors.join(', ') || 'none'} (verified byte-identical)`);
  if (problems.length) {
    for (const p of problems) console.error(`  FAIL ${p}`);
    process.exit(1);
  }
  console.log('  PASS no file/remote references, no module/fetch/import()/service worker; '
    + 'budget ok');
  console.log(`  PASS provenance: banner and metadata region name v${version}, `
    + `source digest ${sourceDigest} (recomputed), channel "source"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
