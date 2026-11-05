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
//     sendBeacon or localhost, assigns an absolute URL to .src/.href/.srcset/.poster (or by
//     setAttribute), sets new Image().src or new Audio()/Video() from anything but a data:/blob:
//     literal, writes an absolute URL into a resource attribute of an HTML string, or reaches
//     fetch by a computed member (window["fe"+"tch"], x["fetch"]),
//   - embeds a vendor whose network sites (fetch, XMLHttpRequest, ..., an i18n loadPath) are not
//     each in VENDOR_NETWORK, or whose inventoried site is reachable: the vendor references its
//     entry more often than the inventory proves, or first-party script calls its entry API,
//   - carries a source map reference,
//   - embeds a vendor script that is not byte-identical to the pinned package file,
//   - lacks the third-party notice for every vendor and every build-time package
//     (BUILD_TIME_ASSETS: the Lucide icons, and tailwindcss and flowbite, whose compiled CSS is
//     in the <style>, ADR 0061),
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
import { BUDGET, BUILD_TIME_ASSETS, DIST_HTML, VENDOR_SCRIPTS } from './build-config.mjs';
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
  // Runtime loads through the DOM (R040): each of these ran with rc=0 before. A static scan sees
  // literals only; a URL built from parts and assigned through a variable stays outside it,
  // which is why the constructors that load whatever they are given are refused unless the
  // argument is a data:/blob: literal.
  [/\.(?:src|href|srcset|poster)\s*=\s*(['"`])\s*(?:https?:)?\/\//i,
    'an absolute URL assigned to .src/.href/.srcset/.poster'],
  [/\bsetAttribute\s*\(\s*(['"`])(?:src|href|srcset|poster)\1\s*,\s*(['"`])\s*(?:https?:)?\/\//i,
    'an absolute URL set by setAttribute(src/href/srcset/poster)'],
  [/\bnew\s+Image\s*\([^()]*\)\s*\.src\s*=\s*(?!(['"`])(?:data|blob):)/,
    'new Image().src from anything but a data:/blob: literal'],
  [/\bnew\s+(?:Audio|Video)\s*\(\s*(?!\)|(['"`])(?:data|blob):)/,
    'new Audio()/Video() from anything but a data:/blob: literal'],
  // A resource attribute inside an HTML string (innerHTML, insertAdjacentHTML, a template).
  // <a>/<area> href is a destination, not a load, as in markup; their ping is a load.
  [new RegExp('<(?:(?!(?:a|area)[\\s/>])[a-z][\\w:-]*\\s[^<>]*?(?<![\\w:-])(?:src|srcset|href'
    + '|poster|data|action|formaction|background|xlink:href|imagesrcset|lowsrc|longdesc|ping'
    + '|manifest|codebase|archive)|(?:a|area)\\s[^<>]*?(?<![\\w:-])ping)\\s*=\\s*\\\\?["\'`]?'
    + '\\s*(?:https?:)?\\/\\/', 'i'), 'an absolute URL in a resource attribute of an HTML string'],
  // A literal ["fetch"] on anything, or a global's member whose key is built from strings.
  [new RegExp('\\[\\s*([\'"`])fetch\\1\\s*\\]|\\b(?:window|self|globalThis|top|parent|frames)'
    + '\\s*\\[\\s*(?:([\'"`])[^\'"`\\]]*\\2\\s*\\+|`[^`\\]]*\\$\\{)'),
  'computed fetch (window["fe"+"tch"], x["fetch"])'],
];

// The network sites of every pinned vendor (R040). Vendor code is verified by identity, not by
// the FORBIDDEN_JS scan, so each place a vendor can reach the network is listed here with the
// proof that the shipped page never reaches it:
//   - `markers`: verbatim fragments of the site in the vendor bytes. Every NETWORK_PRIMITIVES
//     occurrence in the vendor must fall inside a marker of this inventory, so a new site in a
//     vendor upgrade (or a stale inventory) fails until it is listed and proven;
//   - `refs` [pattern, n]: the site's entry is referenced exactly n times in the vendor (its
//     definition and export), so no vendor code calls, aliases or exports it further;
//   - `firstParty`: the vendor API names whose call reaches the site; first-party script may
//     call none of them.
// p5@1.11.3 carries the i18next HTTP backend with a loadPath on cdn.jsdelivr.net. Only the
// translator's initialize() starts it; the unminified build calls it from init.js, the minified
// build that ships here replaces that call by Promise.resolve() (`n=Promise.resolve()`), and
// the module is private to the bundle (no global exposes it), so the count of 2 is the proof.
const P5_FETCH_API = ['httpDo', 'httpGet', 'httpPost', 'loadJSON', 'loadStrings', 'loadXML',
  'loadTable', 'loadBytes', 'loadShader', 'loadImage', 'loadModel'];
export const NETWORK_PRIMITIVES = [
  [/(?<![\w$])fetch\s*\(/g, 'fetch('],
  [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
  [/\bsendBeacon\b/g, 'sendBeacon'],
  [/\b(?:WebSocket|EventSource)\b/g, 'WebSocket/EventSource'],
  [/\bimportScripts\s*\(/g, 'importScripts('],
  [/\bloadPath\b/g, 'loadPath'],
];
export const VENDOR_NETWORK = new Map([['p5', [
  {
    site: 'the i18next HTTP backend (translations from cdn.jsdelivr.net)',
    markers: ['loadPath:"https://cdn.jsdelivr.net/npm/p5/translations/',
      'var o=this.options.loadPath', 'Promise.race([fetch(e,t)'],
    refs: [/(?<![\w$])initialize(?![\w$])/g, 2, "the translator's initialize()"],
  },
  { site: 'loadImage', markers: ['mode:"cors"});return fetch(o,e)'], firstParty: ['loadImage'] },
  { site: 'httpDo', markers: [':fetch(p))'], firstParty: P5_FETCH_API },
  { site: 'loadModel (HEAD)', markers: ['fetch(t,{method:"HEAD"})'], firstParty: ['loadModel'] },
  {
    site: 'opentype.js load (loadFont)',
    markers: ['kr(e,t){var r=new XMLHttpRequest'],
    firstParty: ['loadFont'],
  },
  {
    site: 'the whatwg-fetch polyfill behind every fetch site',
    markers: ['n=new XMLHttpRequest;n.onload'],
    firstParty: P5_FETCH_API,
  },
]]]);

const callOf = (names) => new RegExp(`(?:^|[^\\w$])(?:${names.join('|')})\\s*\\(`);

/**
 * Problems of one vendor's network inventory against its verbatim code.
 * @param {string} id  "pkg@version"
 * @param {string} code
 * @param {Map<string, object[]>} inventory
 */
export function vendorNetworkProblems(id, code, inventory = VENDOR_NETWORK) {
  const sites = inventory.get(id.slice(0, id.lastIndexOf('@'))) || [];
  const problems = [];
  const spans = [];
  for (const { site, markers, refs } of sites) {
    for (const marker of markers) {
      const at = code.indexOf(marker);
      if (at < 0) problems.push(`vendor ${id}: ${site} marker not found (stale inventory)`);
      else spans.push([at, at + marker.length]);
    }
    if (refs) {
      const [re, n, entry] = refs;
      const seen = (code.match(re) || []).length;
      if (seen !== n) {
        problems.push(`vendor ${id}: ${site} is reachable: ${entry} is referenced ${seen} `
          + `times, the inventory proves ${n} (definition and export)`);
      }
    }
  }
  for (const [re, what] of NETWORK_PRIMITIVES) {
    for (const m of code.matchAll(re)) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      problems.push(`vendor ${id}: ${what} at ${m.index} is in no VENDOR_NETWORK site: `
        + `…${code.slice(Math.max(0, m.index - 40), m.index + 40)}…`);
    }
  }
  return problems;
}

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

// A url() in either quote style (the other quote may occur inside: mini-svg-data-uri's SVGs
// carry xmlns='…' inside url("…")), or unquoted; each quote style is matched on its own.
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s'"()]*))\s*\)/gi;
const CSS_STRING = /"([^"]*)"|'([^']*)'/g;

// Characters the reference scan reads as syntax. Escaped, the browser takes them as part of a
// name or a string (\( never opens a function, \" never ends a string), so the decoded copy
// writes them percent-encoded and keeps the scan's view of the structure the browser's.
const CSS_SYNTAX = /["'()\\@\s]/u;

/**
 * A copy of a stylesheet with its CSS escapes decoded (CSS Syntax 3, "consume an escaped code
 * point"): `\` and 1-6 hex digits with one optional whitespace after, `\` and any other
 * character, and `\` before a newline (a line continuation, dropped). A decoded character the
 * scan treats as syntax is written as %XX instead, so `\75 rl(` reads as `url(`, `@\69mport` as
 * `@import` and `\69mage-set(` as `image-set(`, as the browser reads them, while an escaped
 * quote or parenthesis cannot end a string or open a function. Code point 0, surrogates and
 * values past U+10FFFF become U+FFFD. The copy is only scanned, never emitted.
 * @param {string} css
 */
export function decodeCssEscapes(css) {
  const pct = (ch) => [...Buffer.from(ch, 'utf8')]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  return css.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_, hex, newline, other) => {
      if (newline !== undefined) return '';
      let ch = other;
      if (hex !== undefined) {
        const cp = parseInt(hex, 16);
        ch = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
          ? '\ufffd' : String.fromCodePoint(cp);
      }
      return CSS_SYNTAX.test(ch) ? pct(ch) : ch;
    });
}

/**
 * Every reference a stylesheet makes: the target of each url(), the bare strings inside each
 * image-set() / -webkit-image-set() (which takes them as well as url()), and the number of
 * url( openings the scan could not parse, so nothing is skipped in silence. It scans the
 * stylesheet with its escapes decoded (decodeCssEscapes), so an escape does not hide one.
 * @param {string} source
 * @returns {{urls: string[], imageSet: string[], unparsed: number}}
 */
export function cssReferences(source) {
  const css = decodeCssEscapes(source);
  const urls = [];
  for (const m of css.matchAll(CSS_URL)) urls.push(m[1] ?? m[2] ?? m[3]);
  const unparsed = (css.match(/url\(/gi) || []).length - urls.length;
  const imageSet = [];
  for (const m of css.matchAll(/image-set\(/gi)) {
    // The argument list up to its closing parenthesis, skipping strings and nested url().
    let depth = 1;
    let i = m.index + m[0].length;
    let args = '';
    while (i < css.length && depth > 0) {
      const c = css[i];
      if (c === '"' || c === "'") {
        const end = css.indexOf(c, i + 1);
        const stop = end < 0 ? css.length : end + 1;
        args += css.slice(i, stop);
        i = stop;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      if (depth > 0) args += c;
      i += 1;
    }
    const bare = args.replace(CSS_URL, '');
    for (const s of bare.matchAll(CSS_STRING)) imageSet.push(s[1] ?? s[2]);
  }
  return { urls, imageSet, unparsed };
}

// CSS may reference data: URLs (and #fragments) only (isInert). The flowbite plugin emits data:
// SVGs only (mini-svg-data-uri, forms: true included), so ADR 0061 adds no allowance; every
// url() and image-set() string is examined, whichever quote it uses and whatever CSS escape
// spells it (review #253, R-7). Entity-encoded style attributes, SVG presentation attributes
// that take url() and data:text/css stylesheets are not scanned here (R-9, a follow-up).
function cssProblems(css, where) {
  const out = [];
  if (/@import\b/i.test(decodeCssEscapes(css))) out.push(`${where}: CSS @import (must be bundled)`);
  const { urls, imageSet, unparsed } = cssReferences(css);
  for (const u of urls) {
    if (!isInert(u)) out.push(`${where}: CSS url(${u.slice(0, 60)}) is not a data: URL`);
  }
  for (const u of imageSet) {
    if (!isInert(u)) out.push(`${where}: CSS image-set("${u.slice(0, 60)}") is not a data: URL`);
  }
  if (unparsed > 0) out.push(`${where}: ${unparsed} CSS url( the scan cannot parse`);
  return out;
}

/**
 * Pure check of an HTML document. Returns a list of problems (empty = pass).
 * @param {string} html
 * @param {object} [opts]
 * @param {Map<string, string>} [opts.vendors]  vendor id ("p5@1.11.3") -> expected verbatim code
 * @param {{rawBytes: number, gzipBytes: number}} [opts.budget]
 * @param {string[]} [opts.notices]  "pkg@version" of the build-time packages the notice must name
 * @param {Map<string, object[]>} [opts.vendorNetwork]  package -> its network sites (R040)
 */
export function verifyHtml(html, {
  vendors = new Map(), budget = BUDGET, notices = [], vendorNetwork = VENDOR_NETWORK,
} = {}) {
  const problems = [];
  const seenVendors = new Set();
  const appBodies = [];
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
        problems.push(...vendorNetworkProblems(vendorId, body, vendorNetwork));
        continue; // vendor code is verified by identity and its network inventory, not by scan
      }
      appScripts += 1;
      appBodies.push(body);
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
  for (const id of seenVendors) {
    for (const { site, firstParty } of vendorNetwork.get(id.slice(0, id.lastIndexOf('@'))) || []) {
      if (!firstParty) continue;
      const re = callOf(firstParty);
      for (const body of appBodies) {
        const hit = body.match(re);
        if (!hit) continue;
        const context = body.slice(Math.max(0, hit.index - 40), hit.index + 40);
        problems.push(`first-party script reaches vendor ${id} ${site}: …${context}…`);
      }
    }
  }

  const htmlTag = html.search(/<html[\s>]/i);
  const head = htmlTag < 0 ? html.slice(0, html.indexOf('-->') + 3) : html.slice(0, htmlTag);
  for (const id of vendors.keys()) {
    if (!seenVendors.has(id)) problems.push(`vendor script ${id} missing`);
  }
  for (const id of [...vendors.keys(), ...notices]) {
    if (!head.includes(`== ${id} - `)) problems.push(`third-party notice for ${id} missing`);
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

/** "pkg@version" of every BUILD_TIME_ASSETS package, at its installed (pinned) version. */
export function buildTimeNotices(resolve = require.resolve) {
  return BUILD_TIME_ASSETS.map((pkg) => (
    `${pkg}@${JSON.parse(readFileSync(resolve(`${pkg}/package.json`), 'utf8')).version}`));
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
  const result = verifyHtml(html, { vendors: pinnedVendors(), notices: buildTimeNotices() });
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
  console.log('  PASS no file/remote references, no module/fetch/import()/service worker/DOM '
    + 'runtime load; every vendor network site inventoried and unreachable; budget ok');
  console.log(`  PASS provenance: banner and metadata region name v${version}, `
    + `source digest ${sourceDigest} (recomputed), channel "source"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
