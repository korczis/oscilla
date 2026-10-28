// The measure of rule project.ui-uses-flowbite-pro (ADR 0061): the library that reads a tree and
// judges the record. The header of tests/unit/ui-flowbite-pro.test.mjs defines every term; that
// test and the record writer (scripts/ui-flowbite-pro-record.mjs) import it from here, so the
// writer measures without running the test.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './flowbite-pro-fingerprints.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_REL = 'tests/unit/ui-flowbite-pro-baseline.json';
export const FINGERPRINTS_REL = 'tests/unit/flowbite-pro-fingerprints.json';
export const RULE_REL = '.ai/repo/rules/project/ui-uses-flowbite-pro.v1.md';
export const ADR_REL = '.ai/repo/adrs/0061-the-ui-is-built-on-flowbite-pro.md';
export const TAILWIND_ENTRY = 'src/styles/tailwind.css';
export const DIST_REL = 'dist/index.html';
const SRC_HTML = 'src/index.html';

/** The version of what the record measures; the numbers of another measure are not compared. */
export const MEASURE = 4;

/**
 * The domain views' own stylesheets (ADR 0061 decision 3: the charts, the Studio graph and
 * timeline keep their own rendering inside Pro cards) and tokens.css, the custom properties
 * they read. Recorded apart (domainViews) and ratcheted like the legacy stylesheets, but their
 * selectors are not debt.
 */
export const DOMAIN_VIEW_STYLESHEETS = ['src/styles/charts.css', 'src/styles/studio-timeline.css',
  'src/styles/studio.css', 'src/styles/tokens.css'];

/** The Flowbite Pro structure of each surface kind: alternatives, each a set of classes. */
export const PRO_STRUCTURE = {
  navbar: [['bg-white', 'border-b', 'border-gray-200', 'dark:bg-gray-800', 'dark:border-gray-700']],
  sidebar: [['flex-col', 'w-64', 'h-full', 'transition-width']],
  main: [['bg-gray-50', 'dark:bg-gray-900', 'lg:ml-64']],
  footer: [['bg-white', 'rounded-lg', 'shadow', 'dark:bg-gray-800']],
  page: [['px-4', 'pt-6']],
  card: [['bg-white', 'rounded-lg', 'shadow', 'dark:bg-gray-800']],
  modal: [['bg-white', 'rounded-lg', 'shadow', 'dark:bg-gray-800']],
};

/** Packages of another UI kit (an exact name, or a scope ending in '/'). */
export const OTHER_UI_KITS = [
  'bootstrap', 'react-bootstrap', 'bootstrap-vue', 'bulma', 'foundation-sites',
  'materialize-css', 'material-components-web', '@material/', '@mui/', '@material-ui/',
  'antd', '@ant-design/', '@chakra-ui/', 'daisyui', 'semantic-ui-css', 'semantic-ui-react',
  'fomantic-ui', 'uikit', 'primereact', 'primevue', 'primeng', 'vuetify', 'element-ui',
  'element-plus', 'quasar', '@shoelace-style/', '@headlessui/', '@radix-ui/', 'tw-elements',
  'tailwind-elements', 'preline', '@tailwindui/', 'spectre.css', '@picocss/', 'milligram',
  'purecss', 'tachyons', '@blueprintjs/', '@fluentui/', 'carbon-components', '@carbon/',
  '@mantine/', '@nextui-org/', '@heroui/', '@ark-ui/', 'mdb-ui-kit', '@coreui/',
  '@tabler/core', '@ionic/core', 'onsenui', 'framework7', '@arco-design/', 'naive-ui',
  '@angular/material', 'w3-css', 'halfmoon', 'kendo-ui-core', '@progress/',
];

/** Bare packages a stylesheet may @import, by exact package name. */
export const ALLOWED_CSS_PACKAGES = ['uplot', 'tailwindcss', 'flowbite'];

/** A path segment named like a licensed Pro package (its directory, a version or -main). */
export const PRO_PACKAGE_NAME = new RegExp('^(flowbite-admin-dashboard|flowbite-pro-(nextjs|react)'
  + '-admin-dashboard|flowbite-react-blocks|publisher-ui-blocks)(-v?\\d[\\w.-]*|-main|-beta)?'
  + '(\\.(zip|tgz|tar\\.gz))?$', 'i');

/** Text only the licensed Pro packages carry (built from parts, so this file carries none). */
export const PRO_MARKERS = [
  ['flowbite.com', 'license'].join('/'),
  ...['flowbite-admin-dashboard', 'flowbite-pro', 'flowbite-react-blocks', 'publisher-ui-blocks']
    .map((name) => ['themesberg', name].join('/')),
];

export { fingerprint };

const COMPONENT_LIBRARY = /(^|\/)(components?|widgets?|ui-kit|design-system)(\/|\.[a-z]+$)/i;

/** A build that does not compile Tailwind: no class is defined by it. */
export const NO_BUILD = Object.freeze({ compiles: false, defines: () => false });

// ---------------------------------------------------------------- reading JavaScript

function stringEnd(t, i) {
  const q = t[i];
  for (i += 1; i < t.length; i += 1) {
    if (t[i] === '\\') i += 1;
    else if (t[i] === q) return i + 1;
    else if (t[i] === '\n') return i;
  }
  return i;
}

/** After the '${' at i - 2: the index after its closing brace. */
function interpolationEnd(t, i) {
  let depth = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'") { i = stringEnd(t, i); continue; }
    if (c === '`') { i = templateEnd(t, i); continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { if (depth === 0) return i + 1; depth -= 1; }
    i += 1;
  }
  return i;
}

function templateEnd(t, i) {
  for (i += 1; i < t.length; i += 1) {
    if (t[i] === '\\') i += 1;
    else if (t[i] === '`') return i + 1;
    else if (t[i] === '$' && t[i + 1] === '{') i = interpolationEnd(t, i + 2) - 1;
  }
  return i;
}

/**
 * The end of the JavaScript expression that starts at `i`: a ; (or a , when `commas`) or a
 * closing bracket at depth 0, or a line break that neither ends nor starts with an operator.
 */
function expressionEnd(t, i, commas = true) {
  let depth = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'") { i = stringEnd(t, i); continue; }
    if (c === '`') { i = templateEnd(t, i); continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) { if (depth === 0) return i; depth -= 1; }
    else if (depth === 0 && (c === ';' || (commas && c === ','))) return i;
    else if (depth === 0 && c === '\n' && !/[?:+|&(,[{=]\s*$/.test(t.slice(Math.max(0, i - 40), i))
      && !/^\s*[?:+|&.]/.test(t.slice(i + 1, i + 40))) return i;
    i += 1;
  }
  return i;
}

/**
 * The string contents of an expression: its literals and the static parts of its templates
 * (interpolations searched too), without a literal compared with ===, !==, == or != and without
 * the members of an array searched with .includes or .indexOf.
 */
export function literalsIn(expr) {
  const t = expr.replace(/\[[^[\]]*\]\s*\.\s*(?:includes|indexOf)\s*\(/g,
    (m) => ' '.repeat(m.length));
  const out = [];
  const compared = (from, to) => /[=!]==?\s*$/.test(t.slice(0, from))
    || /^\s*[=!]==?/.test(t.slice(to));
  const scan = (from, to) => {
    let i = from;
    while (i < to) {
      const c = t[i];
      if (c === '"' || c === "'") {
        const e = stringEnd(t, i);
        if (!compared(i, e)) out.push(t.slice(i + 1, e - 1));
        i = e;
      } else if (c === '`') {
        const e = templateEnd(t, i);
        let chunk = '';
        for (let j = i + 1; j < e - 1; j += 1) {
          if (t[j] === '\\') {
            chunk += t[j + 1] || '';
            j += 1;
          } else if (t[j] === '$' && t[j + 1] === '{') {
            out.push(chunk);
            chunk = '';
            const k = interpolationEnd(t, j + 2);
            scan(j + 2, k - 1);
            j = k - 1;
          } else chunk += t[j];
        }
        out.push(chunk);
        i = e;
      } else i += 1;
    }
  };
  scan(0, t.length);
  return out;
}

/** The whitespace-separated class tokens of string contents. */
const tokensOf = (strings) => strings.flatMap((s) => s.split(/\s+/))
  .filter((s) => /^[!-]?[A-Za-z_@][^\s"'`$\\{}<>,;]*$/.test(s));

/** Expressions of `text` that follow `re` (each to its end, see expressionEnd). */
function expressionsAfter(text, re, commas = true) {
  return [...text.matchAll(re)].map((m) => {
    const start = m.index + m[0].length;
    return text.slice(start, expressionEnd(text, start, commas));
  });
}

const CLASS_KEY = /(?<![\w$.-])['"]?class(?:Name)?['"]?\s*:(?!:)/g;
const CLASS_ASSIGN = /\.className\s*\+?=(?!=)/g;
const CLASS_LIST = /\.classList\s*\.\s*(?:add|remove|toggle|replace|contains)\s*\(/g;
const CLASS_ATTR = /\bsetAttribute\s*\(\s*['"]class['"]\s*,/g;
const CLASS_IN_STRING = /\bclass\s*=\s*\\?["']([^"'\\$]*)/g;
const ID_KEY = /(?<![\w$.-])['"]?id['"]?\s*:(?!:)/g;
const ID_ASSIGN = /\.id\s*=(?!=)/g;
const ID_ATTR = /\bsetAttribute\s*\(\s*['"]id['"]\s*,/g;
const OSC = /(?<![\w-])osc-[\w-]*/g;
const OSC_SELECTOR = /(?<![\w$])\.(osc-[\w-]*)/g;

/** The class tokens of the class positions of a JavaScript text (see the header). */
export function jsClassTokens(text) {
  return tokensOf([
    ...expressionsAfter(text, CLASS_KEY).flatMap(literalsIn),
    ...expressionsAfter(text, CLASS_ASSIGN).flatMap(literalsIn),
    ...expressionsAfter(text, CLASS_LIST, false).flatMap(literalsIn),
    ...expressionsAfter(text, CLASS_ATTR).flatMap(literalsIn),
    ...[...text.matchAll(CLASS_IN_STRING)].map((m) => m[1]),
  ]);
}

/** The osc-* id names a JavaScript text assigns (prefixes of built ids included). */
function jsIds(text) {
  return tokensOf([ID_KEY, ID_ASSIGN, ID_ATTR]
    .flatMap((re) => expressionsAfter(text, re).flatMap(literalsIn)))
    .filter((s) => s.startsWith('osc-'));
}

// ---------------------------------------------------------------- reading the markup

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Every opening tag of `html` as { tag, attrs }, quotes respected. */
export function openingTags(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(html))) {
    let i = re.lastIndex;
    let quote = null;
    while (i < html.length) {
      const c = html[i];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      i += 1;
    }
    const raw = html.slice(re.lastIndex, i);
    const attrs = {};
    const ar = /([^\s=/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let a;
    while ((a = ar.exec(raw))) {
      const v = a[2] === undefined ? '' : a[2].replace(/^["']|["']$/g, '');
      if (!Object.hasOwn(attrs, a[1])) attrs[a[1]] = v;
    }
    out.push({ tag: m[1].toLowerCase(), attrs });
    re.lastIndex = i;
  }
  return out;
}

const bound = (name) => name.replace(/^(?::|x-bind:)/, '');
const isBound = (name) => /^(?::|x-bind:)/.test(name);
const isClassBinding = (name) => isBound(name) && bound(name) === 'class';
const isStyle = (name) => name === 'style' || (isBound(name) && bound(name) === 'style');
const ID_REFERENCE = /^(id|for|href|name|form|list|headers|aria-[\w-]+)$/;
const STATIC_ID_REFERENCE = /^(id|for|form|list|headers|aria-[\w-]+|x-ref)$/;
/** An attribute whose value only names element ids (see the header): its osc-* are not counted. */
const isIdReference = (name, value) => (isBound(name) ? ID_REFERENCE.test(bound(name))
  : STATIC_ID_REFERENCE.test(name) || (/^(xlink:)?href$/.test(name) && value.startsWith('#')));
/** An Alpine attribute whose value is an expression that may name classes. */
const isExpression = (name) => (isBound(name) && !ID_REFERENCE.test(bound(name)))
  || /^(@|x-on:)/.test(name) || (/^x-/.test(name) && name !== 'x-ref' && !isBound(name));

/** The kind and key of a surface root, or null. */
function surfaceOf(tag, attrs) {
  const id = attrs.id || '';
  if (attrs.role === 'banner') return ['navbar', 'shell:navbar'];
  if (attrs['aria-label'] === 'Workspace') return ['sidebar', 'shell:sidebar'];
  if (tag === 'main') return ['main', 'shell:main'];
  if (attrs['aria-label'] === 'Status and actions') return ['footer', 'shell:footer'];
  if (id.startsWith('osc-view-')) return ['page', `page#${id}`];
  if (tag === 'section' && id) return ['card', `card#${id}`];
  if (tag === 'dialog' && id) return ['modal', `modal#${id}`];
  return null;
}

/** The Pro class set of a surface's kind it carries, or null. */
const proSetOf = (surface) => PRO_STRUCTURE[surface.kind]
  .find((set) => set.every((c) => surface.classes.has(c))) || null;

/** On Pro: the root carries a Pro class set, the build compiles it and defines every class. */
export const onPro = (surface, build) => build.compiles && PRO_STRUCTURE[surface.kind]
  .some((set) => set.every((c) => surface.classes.has(c) && build.defines(c)));

// ---------------------------------------------------------------- reading the stylesheets

function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const c of prelude) {
    if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.filter((s) => s.trim());
}

/**
 * { selectors, declarations, classes, names, utilities } of a stylesheet, comments removed (see
 * the header): classes are the osc-* class names of its selectors, names every class name of
 * them, utilities its @utility rules.
 */
export function cssShape(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let selectors = 0;
  let declarations = 0;
  let utilities = 0;
  const classes = new Set();
  const names = new Set();
  let buf = '';
  let paren = 0;
  let quote = null;
  let depth = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (quote) {
      buf += c;
      if (c === '\\') { buf += t[i + 1] || ''; i += 1; } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(') paren += 1;
    else if (c === ')') paren = Math.max(0, paren - 1);
    if (paren === 0 && c === '{') {
      const prelude = buf.trim();
      if (/^@utility\b/.test(prelude)) utilities += 1;
      if (prelude && !prelude.startsWith('@')) {
        selectors += splitSelectors(prelude).length;
        for (const [, name] of prelude.matchAll(/\.(osc-[\w-]*)/g)) classes.add(name);
        for (const [, name] of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(name);
      }
      depth += 1;
      buf = '';
    } else if (paren === 0 && (c === ';' || c === '}')) {
      const d = buf.trim();
      if (depth > 0 && /^[\w-]+\s*:/.test(d)) declarations += 1;
      if (c === '}') depth = Math.max(0, depth - 1);
      buf = '';
    } else buf += c;
  }
  return { selectors, declarations, classes, names, utilities };
}

// ---------------------------------------------------------------- the build

const stripJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const TAILWIND_CONFIG = /^tailwind\.config\.(?:js|cjs|mjs|ts)$/;

/**
 * Whether the build compiles Tailwind with the flowbite plugin: package.json depends on
 * tailwindcss (or an @tailwindcss/ package) and flowbite, the plugin is in TAILWIND_ENTRY
 * (@plugin "flowbite/plugin") or in the plugins of a tailwind.config.*, and a script under
 * scripts/ imports Tailwind. Comments do not count. `files`: { path: text }.
 */
export function buildCompilesFlowbite({ pkg, files }) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const names = Object.keys(deps);
  if (!names.some((n) => n === 'tailwindcss' || n.startsWith('@tailwindcss/'))) return false;
  if (!names.includes('flowbite')) return false;
  const entry = files[TAILWIND_ENTRY];
  const inEntry = entry !== undefined && /@plugin\s+["']flowbite\/plugin["']/
    .test(entry.replace(/\/\*[\s\S]*?\*\//g, ''));
  const inConfig = Object.entries(files).some(([f, text]) => TAILWIND_CONFIG.test(f)
    && /\bplugins\s*:\s*\[[^\]]*["']flowbite\/plugin["']/.test(stripJsComments(text)));
  if (!inEntry && !inConfig) return false;
  const compiler = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)`
    + String.raw`["'](?:tailwindcss|@tailwindcss\/[\w-]+)(?:\/[\w./-]*)?["']`);
  return Object.entries(files).some(([f, text]) => f.startsWith('scripts/')
    && compiler.test(stripJsComments(text)));
}

/**
 * The names of Tailwind's plugin API that define CSS: any mention, so a call through an alias
 * (({ addComponents: ac }) => ac(...)) or a property access counts too.
 */
const PLUGIN_CSS_API = new RegExp(String.raw`\b(addComponents|addUtilities|matchComponents|`
  + String.raw`matchUtilities|addBase)\b`, 'g');

/** The ad-hoc CSS a tailwind.config.* or a local plugin file may define: its plugin API names. */
export const pluginApiCalls = (text) => (stripJsComments(text).match(PLUGIN_CSS_API) || []).length;

/** class -> whether the <style> of a built page defines a rule for it (Tailwind escapes). */
export function definedClasses(distHtml) {
  const css = [...distHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
    .join('\n');
  return (cls) => {
    const selector = `.${cls.replace(/[^\w-]/g, (c) => `\\${c}`)}`;
    let i = css.indexOf(selector);
    while (i !== -1) {
      if (!/[\w\\-]/.test(css[i + selector.length] || '')) return true;
      i = css.indexOf(selector, i + 1);
    }
    return false;
  };
}

// ---------------------------------------------------------------- what the build bundles

const JS_IMPORT = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|`
  + String.raw`\bnew\s+URL\s*\(\s*)(['"${'`'}])([^'"${'`'}\n]+)\1`, 'g');
const CSS_IMPORT_ANY = /@(?:import|plugin|config)\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g;
const JS_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.json', '/index.js',
  '/index.mjs'];

/**
 * The repository path a relative specifier of `from` names, or null: a package (bare, with a
 * scheme, absolute, or an untracked file under node_modules) or a path outside the repository
 * is not one. In a stylesheet, a specifier without ./ is relative too, as the CSS bundler
 * resolves it. `isTracked(path)`: whether git tracks that file (a tracked file under a
 * node_modules directory is the repository's own, and an input).
 */
export function resolveRelative(from, spec, exists, css = false, isTracked = () => false) {
  const clean = spec.replace(/[?#].*$/, '');
  if (!clean || /^[a-z][\w+.-]*:/i.test(clean) || clean.startsWith('/')) return null;
  if (!css && !/^\.\.?\//.test(clean)) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  if (joined.startsWith('../') || joined === '..') return null;
  for (const ext of css ? [''] : JS_EXTENSIONS) {
    const p = joined + ext;
    if (!exists(p)) continue;
    return /(^|\/)node_modules\//.test(p) && !isTracked(p) ? null : p;
  }
  return null;
}

/** The repository paths the relative imports of one file reach (see the header). */
export function importsOf(file, text, exists, isTracked = () => false) {
  const css = file.endsWith('.css');
  const specs = css
    ? [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(CSS_IMPORT_ANY)].map((m) => m[2])
    : [...text.matchAll(JS_IMPORT)].map((m) => m[2]);
  return specs.map((s) => resolveRelative(file, s, exists, css, isTracked)).filter(Boolean);
}

/**
 * What the build bundles: { html, js: [path], css: [path] } from the tracked paths under src,
 * then every file their relative imports reach, transitively (see the header).
 * `read(path)` -> text, `exists(path)` -> whether that file exists.
 */
export function bundledInputs({ paths, read: readFile, exists }) {
  const known = new Set(paths);
  const isTracked = (p) => known.has(p);
  const seen = new Set();
  const queue = paths.filter((p) => p.startsWith('src/') && exists(p));
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    if (p === SRC_HTML) continue;
    for (const next of importsOf(p, readFile(p), exists, isTracked)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  const all = [...seen].sort();
  return { html: seen.has(SRC_HTML) ? SRC_HTML : null,
    js: all.filter((p) => p !== SRC_HTML && !p.endsWith('.css')),
    css: all.filter((p) => p.endsWith('.css')) };
}

/**
 * The Tailwind configuration files and the local plugin files they and TAILWIND_ENTRY load
 * (relative imports, @plugin and @config, transitively): { path: text }.
 */
export function tailwindFiles({ paths, read: readFile, exists }) {
  const known = new Set(paths);
  const isTracked = (p) => known.has(p);
  const out = {};
  const queue = paths.filter((p) => TAILWIND_CONFIG.test(p) && exists(p));
  if (exists(TAILWIND_ENTRY)) {
    queue.push(...importsOf(TAILWIND_ENTRY, readFile(TAILWIND_ENTRY), exists, isTracked)
      .filter((p) => !p.endsWith('.css')));
  }
  while (queue.length) {
    const p = queue.shift();
    if (Object.hasOwn(out, p)) continue;
    out[p] = readFile(p);
    queue.push(...importsOf(p, out[p], exists, isTracked).filter((n) => !n.endsWith('.css')));
  }
  return out;
}

// ---------------------------------------------------------------- measuring a tree

const add = (counts, name, n = 1) => { counts[name] = (counts[name] || 0) + n; };
export const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const STUDIO_NODE_ID = /^osc-\d+$/;

/**
 * What the rule measures on a tree: { html, js: [text], css: { path: text }, build, tailwind },
 * the stylesheets of DOMAIN_VIEW_STYLESHEETS returned as domainViews, outside the debt,
 * where build is { compiles, defines(class) } (NO_BUILD without Tailwind) and tailwind is
 * { path: text } of the Tailwind configuration and local plugin files (tailwindFiles).
 */
export function measure({ html, js, css = {}, build = NO_BUILD, tailwind = {} }) {
  const tags = openingTags(stripComments(html));
  const surfaces = [];
  const classPositions = new Set();
  const ids = new Set();
  const uses = {};
  const counted = [];
  let inlineStyles = 0;
  let styleElements = 0;
  const token = (v) => (v.startsWith('osc-') ? classPositions.add(v) : add(uses, v));
  for (const { tag, attrs } of tags) {
    if (tag === 'style') styleElements += 1;
    const s = surfaceOf(tag, attrs);
    if (s) {
      surfaces.push({ kind: s[0], key: s[1], classes: new Set((attrs.class || '').split(/\s+/)
        .filter(Boolean)) });
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (isStyle(name)) inlineStyles += 1;
      if (name === 'id' && value.startsWith('osc-')) ids.add(value);
      let tokens = [];
      if (name === 'class') tokens = tokensOf([value]);
      else if (isClassBinding(name)) tokens = tokensOf(literalsIn(value));
      else if (isExpression(name)) tokens = jsClassTokens(value);
      else if (isBound(name) && bound(name) === 'id') {
        for (const v of tokensOf(literalsIn(value))) if (v.startsWith('osc-')) ids.add(v);
      }
      tokens.forEach(token);
      if (name === 'class' || isClassBinding(name)) {
        counted.push(...(value.match(OSC) || []).map((v) => [v, true]));
      } else if (!isIdReference(name, value)) {
        counted.push(...(value.match(OSC) || []).map((v) => [v, false]));
      }
    }
  }
  for (const text of js) {
    jsClassTokens(text).forEach(token);
    for (const [, v] of text.matchAll(OSC_SELECTOR)) classPositions.add(v);
    for (const v of jsIds(text)) ids.add(v);
    counted.push(...(text.match(OSC) || []).map((v) => [v, false]));
  }
  const stylesheets = {};
  const domainViews = {};
  const legacyNames = new Set();
  const tailwindAdHoc = {};
  for (const [file, text] of Object.entries(css).sort(([a], [b]) => a.localeCompare(b))) {
    const shape = cssShape(text);
    for (const c of shape.classes) classPositions.add(c);
    if (file === TAILWIND_ENTRY) {
      if (shape.selectors + shape.utilities) {
        tailwindAdHoc[file] = shape.selectors + shape.utilities;
      }
    } else {
      const sheet = { selectors: shape.selectors, declarations: shape.declarations };
      if (DOMAIN_VIEW_STYLESHEETS.includes(file)) domainViews[file] = sheet;
      else stylesheets[file] = sheet;
      for (const c of shape.names) legacyNames.add(c);
    }
  }
  for (const [file, text] of Object.entries(tailwind)) {
    const n = pluginApiCalls(text);
    if (n) tailwindAdHoc[file] = (tailwindAdHoc[file] || 0) + n;
  }
  const classes = {};
  for (const [v, inClassAttr] of counted) {
    if (!inClassAttr && (ids.has(v) || STUDIO_NODE_ID.test(v)) && !classPositions.has(v)) continue;
    add(classes, v);
  }
  // A Pro class: the build compiles Tailwind, dist defines it and no legacy stylesheet does.
  const pro = { compiles: build.compiles,
    defines: (c) => build.compiles && build.defines(c) && !legacyNames.has(c) };
  const pending = surfaces.filter((s) => !onPro(s, pro)).map((s) => s.key).sort();
  const migrated = surfaces.filter((s) => onPro(s, pro)).map((s) => s.key).sort();
  const vocabulary = sorted(Object.fromEntries(Object.entries(uses)
    .filter(([v]) => !pro.defines(v))));
  const proClasses = sorted(Object.fromEntries(Object.entries(uses)
    .filter(([v]) => pro.defines(v))));
  const debt = pending.length + sum(classes) + sum(vocabulary)
    + sum(Object.fromEntries(Object.entries(stylesheets).map(([f, s]) => [f, s.selectors])));
  return { surfaces, pending, migrated, classes: sorted(classes), vocabulary, proClasses,
    stylesheets, domainViews, tailwindAdHoc, inlineStyles, styleElements, debt, build: pro };
}

// ---------------------------------------------------------------- (a), (b): the record

const kindOf = (measured, key) => measured.surfaces.find((s) => s.key === key).kind;
const structureText = (measured, key) => PRO_STRUCTURE[kindOf(measured, key)]
  .map((set) => set.join(' ')).join(' | ');
const NO_COMPILE = 'the build does not compile Tailwind with the flowbite plugin yet (F001)';

function whyNotMigrated(measured, key) {
  const surface = measured.surfaces.find((s) => s.key === key);
  const set = proSetOf(surface);
  if (!set) {
    return `its root does not carry the Flowbite Pro structure of its kind (${structureText(
      measured, key)})`;
  }
  if (!measured.build.compiles) return `${NO_COMPILE}, so its Pro classes do nothing`;
  return `the compiled CSS of ${DIST_REL} defines none of ${set
    .filter((c) => !measured.build.defines(c)).join(' ')}`;
}

/** token -> recorded uses (null when a record of an earlier measure lists the token only). */
export function vocabularyOf(record) {
  const v = record.vocabulary;
  if (Array.isArray(v)) return new Map(v.map((name) => [name, null]));
  return new Map(Object.entries(v || {}));
}

/** The differences between measured stylesheets and recorded ones (field: the record's key). */
function sheetProblems(have, want, field, unlisted) {
  const problems = [];
  for (const [f, sheet] of Object.entries(have)) {
    if (!Object.hasOwn(want, f)) {
      problems.push(`${f}: ${unlisted}`);
      continue;
    }
    for (const count of ['selectors', 'declarations']) {
      const w = want[f][count];
      if (sheet[count] > w) {
        problems.push(`${f}: ${sheet[count]} ${count}, above the recorded ${w}: style with `
          + 'Tailwind and Flowbite Pro classes, not legacy CSS');
      } else if (sheet[count] < w) {
        problems.push(`${f}: ${sheet[count]} ${count}, below the recorded ${w}: lower the record `
          + 'in the same change');
      }
    }
  }
  for (const f of Object.keys(want)) {
    if (!Object.hasOwn(have, f)) {
      problems.push(`${f}: listed under ${field}, but not one: remove it`);
    }
  }
  return problems;
}

/** Every difference between the measured tree and the record. */
export function recordProblems(measured, baseline) {
  const problems = [];
  if (baseline.measure !== MEASURE) {
    problems.push(`measure: the record is of measure ${baseline.measure}, this test measures `
      + `${MEASURE}: re-measure it`);
  }
  const keys = new Set(measured.surfaces.map((s) => s.key));
  const dup = measured.surfaces.map((s) => s.key).filter((k, i, all) => all.indexOf(k) !== i);
  for (const k of new Set(dup)) problems.push(`${k}: two surfaces have this key`);
  for (const shell of ['shell:navbar', 'shell:sidebar', 'shell:main', 'shell:footer']) {
    if (!keys.has(shell)) {
      problems.push(`${shell}: not found; the shell keeps its landmark (see the header of this `
        + 'test), or the definition changes with the rule');
    }
  }
  const pending = new Set(baseline.surfaces?.pending || []);
  const migrated = new Set(baseline.surfaces?.migrated || []);
  for (const k of measured.pending) {
    if (migrated.has(k)) {
      problems.push(`${k}: listed as migrated, but ${whyNotMigrated(measured, k)}`);
    } else if (!pending.has(k)) {
      problems.push(`${k}: a new surface not on Flowbite Pro; build it from the Pro `
        + `${kindOf(measured, k)} (${whyNotMigrated(measured, k)})`);
    }
  }
  for (const k of measured.migrated) {
    if (!migrated.has(k)) {
      problems.push(`${k}: on Flowbite Pro but not listed as migrated: move it from pending to `
        + 'migrated in the record');
    }
  }
  for (const k of pending) {
    if (!keys.has(k)) {
      problems.push(`${k}: listed as pending, but no such surface; a pending surface leaves the `
        + 'record only into migrated');
    }
  }
  for (const k of migrated) {
    if (!keys.has(k)) problems.push(`${k}: listed as migrated, but no such surface exists`);
  }
  const want = baseline.classes || {};
  for (const name of [...new Set([...Object.keys(measured.classes), ...Object.keys(want)])]
    .sort()) {
    const n = measured.classes[name] || 0;
    const w = want[name] || 0;
    if (Object.hasOwn(want, name) && want[name] === 0) {
      problems.push(`${name}: recorded with 0 occurrences: remove it from the record`);
    } else if (n > w) {
      problems.push(`${name}: ${n} occurrences, above the recorded ${w}: use the Flowbite Pro `
        + 'component instead');
    } else if (n < w) {
      problems.push(`${name}: ${n} occurrences, below the recorded ${w}: lower the record in the `
        + 'same change');
    }
  }
  const words = vocabularyOf(baseline);
  for (const v of [...new Set([...Object.keys(measured.vocabulary), ...words.keys()])].sort()) {
    const n = measured.vocabulary[v] || 0;
    const w = words.get(v);
    if (w === undefined) {
      problems.push(`${v}: a class outside the legacy vocabulary of the record, and ${measured
        .build.compiles ? `it is not a Pro class (the compiled CSS of ${DIST_REL} does not `
          + 'define it, or a legacy stylesheet does)'
        : `${NO_COMPILE}, so no new class does anything: build from Flowbite Pro once it does`}`);
    } else if (w === null) {
      continue;
    } else if (w === 0) {
      problems.push(`${v}: recorded with 0 uses: remove it from the vocabulary`);
    } else if (n === 0) {
      problems.push(`${v}: in the recorded vocabulary, but ${measured.proClasses[v]
        ? 'now a Pro class (dist defines it and no legacy stylesheet does)'
        : 'no longer used'}: remove it`);
    } else if (n > w) {
      problems.push(`${v}: ${n} uses, above the recorded ${w}: a legacy class token is not `
        + 'reused or renamed into; use the Flowbite Pro classes instead');
    } else if (n < w) {
      problems.push(`${v}: ${n} uses, below the recorded ${w}: lower the record in the same `
        + 'change');
    }
  }
  problems.push(...sheetProblems(measured.stylesheets, baseline.stylesheets || {}, 'stylesheets',
    `a new stylesheet; style with Tailwind and Flowbite Pro classes (the one entry is `
      + `${TAILWIND_ENTRY})`));
  problems.push(...sheetProblems(measured.domainViews, baseline.domainViews || {}, 'domainViews',
    'a domain-view stylesheet the record does not list; a domain view keeps its own stylesheet, '
      + 'it gains none'));
  for (const [file, n] of Object.entries(measured.tailwindAdHoc)) {
    problems.push(file === TAILWIND_ENTRY
      ? `${TAILWIND_ENTRY}: ${n} selector rule(s) or @utility rule(s); the Tailwind entry holds `
        + 'only @import, @plugin, @source, @theme and other at-rules: style with Tailwind and '
        + 'Flowbite Pro classes'
      : `${file}: ${n} mention(s) of addComponents, addUtilities, matchComponents, `
        + 'matchUtilities or addBase: ad-hoc CSS in the Tailwind configuration; style with '
        + 'Tailwind and Flowbite Pro classes');
  }
  if (measured.styleElements > 0) {
    problems.push(`src/index.html: a <style> element (${measured.styleElements}); style with `
      + 'Tailwind and Flowbite Pro classes');
  }
  if (measured.inlineStyles > baseline.inlineStyles) {
    problems.push(`inline styles: ${measured.inlineStyles} in src/index.html, above the recorded `
      + `${baseline.inlineStyles}: style with Tailwind and Flowbite Pro classes`);
  } else if (measured.inlineStyles < baseline.inlineStyles) {
    problems.push(`inline styles: ${measured.inlineStyles} in src/index.html, below the recorded `
      + `${baseline.inlineStyles}: lower the record in the same change`);
  }
  if (baseline.debt !== measured.debt) {
    problems.push(`debt: the tree has ${measured.debt}, the record says ${baseline.debt}`);
  }
  return problems;
}

const sheetNames = (b) => [...(Array.isArray(b.stylesheets) ? b.stylesheets
  : Object.keys(b.stylesheets || {})), ...Object.keys(b.domainViews || {})];
/** A stylesheet's counts in a record, wherever it lists them, or null. */
const sheetOf = (b, f) => b.domainViews?.[f]
  || (Array.isArray(b.stylesheets) ? null : b.stylesheets?.[f]) || null;

/**
 * What `current` (the working tree's record) raises over each committed version in `history`
 * ({ sha, baseline }, newest first). See the header for what is compared.
 */
export function historyProblems(current, history) {
  const problems = [];
  const curM = current.measure ?? 1;
  const curPending = new Set(current.surfaces?.pending || []);
  const curMigrated = new Set(current.surfaces?.migrated || []);
  const curWords = vocabularyOf(current);
  for (const { sha, baseline: then } of history) {
    const thenM = then.measure ?? 1;
    if (curM < thenM) {
      problems.push(`measure ${curM} is below ${thenM} at ${sha}`);
      continue;
    }
    const was = new Set(then.surfaces?.pending || []);
    for (const k of curPending) {
      if (!was.has(k)) problems.push(`${k}: pending, but not pending at ${sha}`);
    }
    for (const k of was) {
      if (!curPending.has(k) && !curMigrated.has(k)) {
        problems.push(`${k}: pending at ${sha}, now neither pending nor migrated`);
      }
    }
    for (const k of then.surfaces?.migrated || []) {
      if (!curMigrated.has(k)) problems.push(`${k}: migrated at ${sha}, now not migrated`);
    }
    const sheets = new Set(sheetNames(then));
    for (const f of sheetNames(current)) {
      if (!sheets.has(f)) problems.push(`${f}: a legacy stylesheet not listed at ${sha}`);
    }
    const words = vocabularyOf(then);
    if (then.vocabulary !== undefined) {
      for (const v of curWords.keys()) {
        if (!words.has(v)) problems.push(`${v}: a class not in the vocabulary at ${sha}`);
      }
    }
    if (curM !== thenM) continue;
    if (current.debt > then.debt) {
      problems.push(`debt ${current.debt} is above ${then.debt} at ${sha}`);
    }
    for (const [name, n] of Object.entries(current.classes || {})) {
      const w = then.classes?.[name] || 0;
      if (n > w) problems.push(`${name}: ${n} occurrences, above ${w} at ${sha}`);
    }
    for (const [v, n] of curWords) {
      const w = words.get(v);
      if (n !== null && w !== null && w !== undefined && n > w) {
        problems.push(`${v}: ${n} uses, above ${w} at ${sha}`);
      }
    }
    for (const [f, s] of Object.entries({ ...current.stylesheets, ...current.domainViews })) {
      const w = sheetOf(then, f);
      if (!w) continue;
      for (const field of ['selectors', 'declarations']) {
        if (s[field] > w[field]) {
          problems.push(`${f}: ${s[field]} ${field}, above ${w[field]} at ${sha}`);
        }
      }
    }
    if (current.inlineStyles > then.inlineStyles) {
      problems.push(`inline styles: ${current.inlineStyles}, above ${then.inlineStyles} at ${sha}`);
    }
  }
  return [...new Set(problems)];
}

/**
 * { versions, baseHolds } or { error } from baselineHistory, and whether this runs in CI -> what
 * the check does: 'introduce' when the base's tree at the fork holds no record (the change that
 * brings the record), 'judge' when it does and versions were read.
 */
export function historyGate(history, ci) {
  if (history.error) {
    return ci ? { verdict: 'fail', reason: `git failed in CI: ${history.error}` }
      : { verdict: 'skip', reason: `no git history here (${history.error})` };
  }
  if (!history.versions.length && history.baseHolds === false) {
    return { verdict: 'introduce', reason: `the base ${history.base} holds no record at the fork `
      + `${history.fork}: this change introduces it` };
  }
  if (!history.versions.length) {
    return ci ? { verdict: 'fail', reason: `no commit holds ${BASELINE_REL}: the CI unit job `
      + 'checks out with fetch-depth: 0' } : { verdict: 'skip', reason: 'no committed version' };
  }
  return { verdict: 'judge', reason: '' };
}

// ---------------------------------------------------------------- (c): no other UI kit

const isKit = (name) => OTHER_UI_KITS.some((k) => (k.endsWith('/') ? name.startsWith(k)
  : name === k || name.startsWith(`${k}/`)));
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/')
  : spec.split('/')[0]);
const bare = (spec) => !/^(\.|\/|[a-z]+:)/i.test(spec);

/** { pkg, js: { path: text }, css: { path: text }, paths: [src path] } -> problems. */
export function kitProblems({ pkg, js, css, paths, legacyStylesheets = [] }) {
  const problems = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies',
    'optionalDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (isKit(name)) problems.push(`package.json ${field}: ${name} is another UI kit`);
    }
  }
  const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const [file, text] of Object.entries(js)) {
    for (const [, spec] of text.matchAll(IMPORT)) {
      if (bare(spec) && isKit(packageOf(spec))) {
        problems.push(`${file}: imports ${spec}, another UI kit`);
      }
    }
  }
  const CSS_IMPORT = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g;
  for (const [file, text] of Object.entries(css)) {
    for (const [, spec] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(CSS_IMPORT)) {
      if (/^\.\.?\//.test(spec)) continue;
      const shown = spec.length > 48 ? `${spec.slice(0, 48)}...` : spec;
      if (!bare(spec)) {
        problems.push(`${file}: @import ${shown}, neither a relative path nor an allowed package`
          + ` (a data: URI, a URL or an absolute path)`);
      } else if (isKit(packageOf(spec))) {
        problems.push(`${file}: @import ${spec}, another UI kit`);
      } else if (!ALLOWED_CSS_PACKAGES.includes(packageOf(spec))) {
        problems.push(`${file}: @import ${spec}, a package outside ${ALLOWED_CSS_PACKAGES}`);
      }
    }
  }
  for (const p of paths) {
    if (COMPONENT_LIBRARY.test(p) && !legacyStylesheets.includes(p)) {
      problems.push(`${p}: an ad-hoc component library; adapt the Flowbite Pro component`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- (d): no Pro source file

/** [{ path, bytes }] -> problems: a Pro package path, a fingerprint, a marker. */
export function proSourceProblems(files, fingerprints) {
  const problems = [];
  for (const { path: rel, bytes } of files) {
    const segments = rel.split('/');
    if (segments.some((s) => PRO_PACKAGE_NAME.test(s)) || /(^|\/)vendor\/flowbite(\/|$)/i
      .test(rel)) {
      problems.push(`${rel}: a path named like a licensed Flowbite Pro package`);
      continue;
    }
    const print = fingerprint(rel, bytes);
    if (print && fingerprints.has(print)) {
      problems.push(`${rel}: a licensed Flowbite Pro source file (fingerprint ${print})`);
      continue;
    }
    const text = bytes.toString('utf8');
    const marker = PRO_MARKERS.find((m) => text.includes(m));
    if (marker) problems.push(`${rel}: carries ${marker}, a marker of the licensed Pro packages`);
  }
  return problems;
}

// ---------------------------------------------------------------- the tree

export const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(rel) {
  const dir = path.join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name === '.git') return [];
    const child = rel === '.' ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) return walk(child);
    return d.isFile() ? [child] : [];
  });
}

/** Tracked files under `paths` (every tracked file without), from git or the disk. */
export function tracked(...paths) {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...paths], { cwd: ROOT, encoding: 'utf8' });
  const files = r.status === 0 && r.stdout ? r.stdout.split('\0').filter(Boolean)
    : (paths.length ? paths : ['.']).flatMap((p) => {
      const full = path.join(ROOT, p);
      if (!existsSync(full)) return [];
      return statSync(full).isDirectory() ? walk(p) : [p];
    });
  return files.filter((f) => existsSync(path.join(ROOT, f)));
}

export const readBaseline = () => JSON.parse(read(BASELINE_REL));
const isFile = (rel) => {
  const full = path.join(ROOT, rel);
  return existsSync(full) && statSync(full).isFile();
};
const repo = () => ({ paths: tracked(), read, exists: isFile });

/** What the build bundles in this tree (see bundledInputs). */
export const treeInputs = () => bundledInputs(repo());

function treeBuild() {
  const pkg = JSON.parse(read('package.json'));
  const files = {};
  for (const f of [...readdirSync(ROOT).filter((n) => TAILWIND_CONFIG.test(n)), TAILWIND_ENTRY,
    ...tracked('scripts').filter((n) => /\.[cm]?js$/.test(n))]) {
    if (existsSync(path.join(ROOT, f))) files[f] = read(f);
  }
  if (!buildCompilesFlowbite({ pkg, files })) return NO_BUILD;
  return { compiles: true, defines: definedClasses(existsSync(path.join(ROOT, DIST_REL))
    ? read(DIST_REL) : '') };
}

/** The measure of this tree (exported so a tool can write the record from it). */
export function treeMeasure(inputs = treeInputs()) {
  return measure({ html: read(SRC_HTML), js: inputs.js.map(read),
    css: Object.fromEntries(inputs.css.map((f) => [f, read(f)])), build: treeBuild(),
    tailwind: tailwindFiles(repo()) });
}
/** The selectors of a { path: { selectors } } map. */
const selectorsOf = (sheets) => sum(Object.fromEntries(Object.entries(sheets)
  .map(([f, x]) => [f, x.selectors])));

/**
 * The record of a measure `m`, its rule, note and measured block kept from `previous` unless
 * given: `measured` (a commit) rewrites the measured block, as when a new measure is first
 * taken. The key order is the record's.
 */
export function recordOf(m, previous, { note, measured } = {}) {
  const block = measured ? { commit: measured, measure: MEASURE, debt: m.debt,
    surfaces: m.surfaces.length, pending: m.pending.length, classTokens: sum(m.classes),
    classNames: Object.keys(m.classes).length, vocabularyUses: sum(m.vocabulary),
    vocabularyNames: Object.keys(m.vocabulary).length, selectors: selectorsOf(m.stylesheets),
    domainViewSelectors: selectorsOf(m.domainViews) } : previous.measured;
  return { rule: previous.rule || 'project.ui-uses-flowbite-pro', note: note || previous.note,
    measure: measured ? MEASURE : previous.measure, measured: block, debt: m.debt,
    surfaces: { pending: m.pending, migrated: m.migrated }, classes: m.classes,
    vocabulary: m.vocabulary, stylesheets: m.stylesheets, domainViews: m.domainViews,
    inlineStyles: m.inlineStyles };
}

/** The record file's text: two-space JSON with a final newline. */
export const recordText = (record) => `${JSON.stringify(record, null, 2)}\n`;

/** The base branch the record is judged against: the pull request's base in CI, else main. */
export const baseBranch = (env = process.env) => env.GITHUB_BASE_REF || 'main';

/**
 * Every committed version of the record on the base branch's first-parent chain, newest first:
 * from the fork (git merge-base HEAD origin/<base>, or <base> without the remote ref)
 * backwards, never a commit of the branch itself. { versions, base, fork, baseHolds } or
 * { error }; a shallow clone is an error, since its chain is cut.
 */
export function baselineHistory({ root = ROOT, base = baseBranch() } = {}) {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--verify', '-q', 'HEAD^{commit}');
  if (head.status !== 0) return { error: `git rev-parse HEAD: ${head.stderr || head.error}` };
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    return { error: 'a shallow clone: the base branch history is cut (fetch-depth: 0)' };
  }
  const ref = [`origin/${base}`, base].find((r) => git('rev-parse', '--verify', '-q',
    `${r}^{commit}`).status === 0);
  if (!ref) return { error: `no base branch: neither origin/${base} nor ${base} resolves` };
  const mb = git('merge-base', 'HEAD', ref);
  if (mb.status !== 0) return { error: `git merge-base HEAD ${ref}: ${mb.stderr || 'no fork'}` };
  const fork = mb.stdout.trim();
  const log = git('log', '--first-parent', '--format=%H', fork, '--', BASELINE_REL);
  if (log.status !== 0) return { error: `git log: ${log.stderr || log.error}` };
  const versions = [];
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const shown = git('show', `${sha}:${BASELINE_REL}`);
    if (shown.status !== 0) return { error: `git show ${sha}: ${shown.stderr}` };
    versions.push({ sha: sha.slice(0, 12), baseline: JSON.parse(shown.stdout) });
  }
  const baseHolds = git('cat-file', '-e', `${fork}:${BASELINE_REL}`).status === 0;
  return { versions, base: ref, fork: fork.slice(0, 12), baseHolds };
}
