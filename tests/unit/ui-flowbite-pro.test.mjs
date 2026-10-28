// Rule project.ui-uses-flowbite-pro (ADR 0061): the UI of OSCILLA is built on Flowbite Pro on
// Tailwind. The interface that predates the rule is recorded as debt that only shrinks.
//
// tests/unit/ui-flowbite-pro-baseline.json records the legacy interface (measure MEASURE), and
// the tree must equal it exactly, so a migration lowers the record in the same change:
//   (a) the record:
//     inputs    what the build bundles (treeInputs): every tracked file under src (src/index.html
//               read as markup, every .css file as a stylesheet, every other file as JavaScript
//               text, whatever its extension), plus every file a relative import of one of them
//               reaches, transitively, wherever it lives in the repository (JavaScript import,
//               export ... from, import(), require(), new URL(); CSS @import, quoted or url(),
//               with or without ./): a reached .css file is a stylesheet, any other a JavaScript
//               text. Packages (bare specifiers, node_modules) are clause (c)'s.
//     surfaces  the UI surfaces of src/index.html (HTML comments removed):
//                 navbar   the element with role="banner"
//                 sidebar  the element with aria-label="Workspace"
//                 main     the <main> element
//                 footer   the element with aria-label="Status and actions"
//                 page     every element whose id starts with "osc-view-" (a workspace)
//                 card     every other <section> element with an id
//                 modal    every <dialog> element with an id
//               A surface is migrated when its root's static class attribute holds every class
//               of one class set PRO_STRUCTURE gives its kind (the Pro admin shell's navbar,
//               sidebar drawer, #main-content, footer card, page gutter, card and modal
//               content) AND the build compiles Tailwind with the flowbite plugin
//               (buildCompilesFlowbite: the tailwindcss and flowbite packages, the plugin in
//               the Tailwind entry or config, a build script that imports Tailwind) AND every
//               class of that set is a Pro class: the committed dist/index.html defines a rule
//               for it and no legacy stylesheet has a selector naming it. Every other surface
//               is pending. Until F001 lands that build, no surface is migrated.
//     classes   every osc-* class token, each name counted apart (BEM variants, shell, view
//               and domain-view classes included; a literal 'osc-' or `osc-x--${...}` prefix
//               of a name built at run time counts as its own name): in src/index.html, the
//               osc-* tokens of class attributes and of Alpine attributes (:..., x-bind:...,
//               @..., x-on:..., x-...) other than the bound id references (:id, :for, :href,
//               :name, :aria-*, x-ref); in every JavaScript text of the inputs, every osc-*
//               token of the text, comments included. A token is not counted when it is an
//               element id (a static id of src/index.html, a literal of :id, a literal assigned
//               to id:, .id = or setAttribute('id', ...) in JavaScript) or a Studio node id
//               (osc- and digits only, as 'osc-1') and never appears in a class position (a
//               class attribute, :class, class: or className: keys, .className =,
//               classList.*(...), setAttribute('class', ...), class="..." inside a string, or a
//               .osc-* selector in JavaScript or the stylesheets).
//     vocabulary  every other class token in a class position (class attributes, the literals
//               of :class not compared with ===/!==, the literals of the JS class positions
//               above), counted per token and per use, unless it is a Pro class (see surfaces):
//               the legacy vocabulary. A token outside it fails, and a token in it may not be
//               used more often than recorded, so a legacy class renamed to another legacy
//               token, or a legacy token reused by new markup, raises a count. A token a legacy
//               stylesheet names stays legacy whatever dist defines, so removing its last
//               legacy rule never turns it into a new class.
//     stylesheets  per stylesheet of the inputs (TAILWIND_ENTRY excepted): its selectors (each
//               comma-separated selector of a rule prelude that is not an at-rule) and its
//               declarations (property: value inside a block), comments removed.
//     inlineStyles  the style, :style and x-bind:style attributes of src/index.html.
//     debt      pending surfaces + every counted osc-* class token + every use of a legacy
//               vocabulary token + every legacy selector.
//   Beside the record: TAILWIND_ENTRY defines no ad-hoc CSS (no selector rule, @layer
//   components and the like included, and no @utility: only @import, @plugin, @source, @theme
//   and similar at-rules), no tailwind.config.* and no local plugin file it or the entry loads
//   calls addComponents, addUtilities, matchComponents, matchUtilities or addBase, and
//   src/index.html holds no <style> element.
//   The record only shrinks: the working tree's record is judged against every committed
//   version of it in its first-parent git history (git log --first-parent, git show), and no
//   number may be above an earlier one of the same measure (debt, a class name or a
//   vocabulary token, absent counts as 0, a stylesheet's selectors or declarations, the
//   inline styles), no vocabulary token, stylesheet or pending surface may be one an earlier
//   version did not list (of any measure that lists them), a surface pending in an earlier
//   version must still be pending or migrated (it never vanishes), a migrated one stays
//   migrated, and the measure never goes back. The numbers of an earlier measure are not
//   compared. Outside CI a missing history skips this check; in CI (with fetch-depth: 0) a
//   git failure or an empty history fails it.
//   (b) every surface the record lists as migrated exists and is migrated as defined above.
//   (c) no other UI kit: no dependency, JavaScript import or CSS @import of a package of
//       OTHER_UI_KITS; no CSS @import of a package (its exact name) outside
//       ALLOWED_CSS_PACKAGES; no stylesheet beyond the recorded ones and TAILWIND_ENTRY; and no
//       module of an ad-hoc component library (an input path with a components, widgets,
//       ui-kit or design-system segment) beyond the recorded stylesheets.
//   (d) no Flowbite Pro source file is tracked: no path with a segment named like a Pro
//       package (PRO_PACKAGE_NAME) or a vendor/flowbite directory, no file whose fingerprint
//       is in tests/unit/flowbite-pro-fingerprints.json (scripts/flowbite-pro-fingerprints.mjs),
//       and no file carrying a marker of the Pro packages (PRO_MARKERS: their licence URL and
//       repository names). OSCILLA is a public repository and a public Pages site.
// What no check here decides (the rule's "What no check decides" lists it for the reviewer):
// a non-osc class reached in JavaScript through a variable, a helper argument or a ternary
// branch that is not a literal of a class position; an osc-* name assembled from parts none of
// which holds "osc-" (['osc', 'btn'].join('-')); styling set from JavaScript (el.style, style:
// keys, injected <style> or insertRule); an osc-* class name that is also an element id and is
// never in a class position; new markup without classes that legacy descendant selectors
// style; a legacy rule rewritten in place at the same counts; whether a surface on the Pro
// class set follows its Pro template in substance; a markup surface that is neither a
// landmark, a section nor a dialog with an id (its classes are still counted); a module the
// build reaches other than by a relative import (an alias, a plugin, a package); a Pro file
// copied with edits (it escapes the fingerprint, and only about 120 of the roughly 1,800 Pro
// files carry a marker) or inlined as a data: URI inside another file, dist/index.html
// included; and a change of MEASURE itself, which resets the numeric comparison with earlier
// versions and is a change of this test.
// Every clause has a fixture mutation beside the check on the real tree that makes it fail.
//   node --test tests/unit/ui-flowbite-pro.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../scripts/flowbite-pro-fingerprints.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_REL = 'tests/unit/ui-flowbite-pro-baseline.json';
const FINGERPRINTS_REL = 'tests/unit/flowbite-pro-fingerprints.json';
const RULE_REL = '.ai/repo/rules/project/ui-uses-flowbite-pro.v1.md';
const ADR_REL = '.ai/repo/adrs/0061-the-ui-is-built-on-flowbite-pro.md';
export const TAILWIND_ENTRY = 'src/styles/tailwind.css';
const DIST_REL = 'dist/index.html';
const SRC_HTML = 'src/index.html';

/** The version of what the record measures; the numbers of another measure are not compared. */
export const MEASURE = 3;

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

/** The calls of Tailwind's plugin API that define CSS, in a config or a local plugin file. */
const PLUGIN_CSS_API = new RegExp(String.raw`\b(addComponents|addUtilities|matchComponents|`
  + String.raw`matchUtilities|addBase)\s*\(`, 'g');

/** The ad-hoc CSS a tailwind.config.* or a local plugin file defines: its plugin API calls. */
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
 * scheme, absolute or under node_modules) or a path outside the repository is not one. In a
 * stylesheet, a specifier without ./ is relative too, as the CSS bundler resolves it.
 */
export function resolveRelative(from, spec, exists, css = false) {
  const clean = spec.replace(/[?#].*$/, '');
  if (!clean || /^[a-z][\w+.-]*:/i.test(clean) || clean.startsWith('/')) return null;
  if (!css && !/^\.\.?\//.test(clean)) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
  if (joined.startsWith('../') || joined === '..') return null;
  if (/(^|\/)node_modules\//.test(joined)) return null;
  for (const ext of css ? [''] : JS_EXTENSIONS) {
    if (exists(joined + ext)) return joined + ext;
  }
  return null;
}

/** The repository paths the relative imports of one file reach (see the header). */
export function importsOf(file, text, exists) {
  const css = file.endsWith('.css');
  const specs = css
    ? [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(CSS_IMPORT_ANY)].map((m) => m[2])
    : [...text.matchAll(JS_IMPORT)].map((m) => m[2]);
  return specs.map((s) => resolveRelative(file, s, exists, css)).filter(Boolean);
}

/**
 * What the build bundles: { html, js: [path], css: [path] } from the tracked paths under src,
 * then every file their relative imports reach, transitively (see the header).
 * `read(path)` -> text, `exists(path)` -> whether that file exists.
 */
export function bundledInputs({ paths, read: readFile, exists }) {
  const seen = new Set();
  const queue = paths.filter((p) => p.startsWith('src/') && exists(p));
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    if (p === SRC_HTML) continue;
    for (const next of importsOf(p, readFile(p), exists)) if (!seen.has(next)) queue.push(next);
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
  const out = {};
  const queue = paths.filter((p) => TAILWIND_CONFIG.test(p) && exists(p));
  if (exists(TAILWIND_ENTRY)) {
    queue.push(...importsOf(TAILWIND_ENTRY, readFile(TAILWIND_ENTRY), exists)
      .filter((p) => !p.endsWith('.css')));
  }
  while (queue.length) {
    const p = queue.shift();
    if (Object.hasOwn(out, p)) continue;
    out[p] = readFile(p);
    queue.push(...importsOf(p, out[p], exists).filter((n) => !n.endsWith('.css')));
  }
  return out;
}

// ---------------------------------------------------------------- measuring a tree

const add = (counts, name, n = 1) => { counts[name] = (counts[name] || 0) + n; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const STUDIO_NODE_ID = /^osc-\d+$/;

/**
 * What the rule measures on a tree: { html, js: [text], css: { path: text }, build, tailwind },
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
      } else if (isExpression(name)) {
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
      stylesheets[file] = { selectors: shape.selectors, declarations: shape.declarations };
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
    stylesheets, tailwindAdHoc, inlineStyles, styleElements, debt, build: pro };
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
  const sheets = baseline.stylesheets || {};
  for (const [f, have] of Object.entries(measured.stylesheets)) {
    if (!Object.hasOwn(sheets, f)) {
      problems.push(`${f}: a new stylesheet; style with Tailwind and Flowbite Pro classes (the `
        + `one entry is ${TAILWIND_ENTRY})`);
      continue;
    }
    for (const field of ['selectors', 'declarations']) {
      const w = sheets[f][field];
      if (have[field] > w) {
        problems.push(`${f}: ${have[field]} ${field}, above the recorded ${w}: style with `
          + 'Tailwind and Flowbite Pro classes, not legacy CSS');
      } else if (have[field] < w) {
        problems.push(`${f}: ${have[field]} ${field}, below the recorded ${w}: lower the record `
          + 'in the same change');
      }
    }
  }
  for (const f of Object.keys(sheets)) {
    if (!Object.hasOwn(measured.stylesheets, f)) {
      problems.push(`${f}: listed, but not a stylesheet: remove it`);
    }
  }
  for (const [file, n] of Object.entries(measured.tailwindAdHoc)) {
    problems.push(file === TAILWIND_ENTRY
      ? `${TAILWIND_ENTRY}: ${n} selector rule(s) or @utility rule(s); the Tailwind entry holds `
        + 'only @import, @plugin, @source, @theme and other at-rules: style with Tailwind and '
        + 'Flowbite Pro classes'
      : `${file}: ${n} call(s) of addComponents, addUtilities, matchComponents, matchUtilities `
        + 'or addBase: ad-hoc CSS in the Tailwind configuration; style with Tailwind and '
        + 'Flowbite Pro classes');
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

const sheetNames = (b) => (Array.isArray(b.stylesheets) ? b.stylesheets
  : Object.keys(b.stylesheets || {}));

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
    for (const [f, s] of Object.entries(current.stylesheets || {})) {
      const w = then.stylesheets?.[f];
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

/** { versions } or { error } from git, and whether this runs in CI -> what the check does. */
export function historyGate(history, ci) {
  if (history.error) {
    return ci ? { verdict: 'fail', reason: `git failed in CI: ${history.error}` }
      : { verdict: 'skip', reason: `no git history here (${history.error})` };
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
      if (!bare(spec)) continue;
      if (isKit(packageOf(spec))) problems.push(`${file}: @import ${spec}, another UI kit`);
      else if (!ALLOWED_CSS_PACKAGES.includes(packageOf(spec))) {
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

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

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
function tracked(...paths) {
  const r = spawnSync('git', ['ls-files', '-z', '--', ...paths], { cwd: ROOT, encoding: 'utf8' });
  const files = r.status === 0 && r.stdout ? r.stdout.split('\0').filter(Boolean)
    : (paths.length ? paths : ['.']).flatMap((p) => {
      const full = path.join(ROOT, p);
      if (!existsSync(full)) return [];
      return statSync(full).isDirectory() ? walk(p) : [p];
    });
  return files.filter((f) => existsSync(path.join(ROOT, f)));
}

const readBaseline = () => JSON.parse(read(BASELINE_REL));
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

test('the rule and the ADR exist, name this test and state what no check decides', () => {
  const rule = read(RULE_REL);
  assert.match(rule, /^id: project\.ui-uses-flowbite-pro$/m);
  assert.match(rule, /^class: blocking$/m);
  assert.match(rule, /tests\/unit\/ui-flowbite-pro\.test\.mjs/);
  assert.match(rule, /What no check decides/);
  for (const limit of [/`data:` URI/, /edited/, /el\.style/, /F001/]) assert.match(rule, limit);
  const adr = read(ADR_REL);
  assert.match(adr, /^status: accepted$/m);
  assert.match(adr, /rule:project\.ui-uses-flowbite-pro/);
  assert.match(adr, /What no check decides/);
});

test('(a) the tree holds exactly the record, and (b) every migrated surface is on Pro', (t) => {
  const inputs = treeInputs();
  const measured = treeMeasure(inputs);
  assert.ok(measured.surfaces.length > 50, `surfaces found (${measured.surfaces.length})`);
  for (const kind of Object.keys(PRO_STRUCTURE)) {
    assert.ok(measured.surfaces.some((s) => s.kind === kind), `a ${kind} surface is found`);
  }
  assert.ok(inputs.js.filter((f) => f.startsWith('src/js/')).length > 50,
    'the modules of src/js are read');
  assert.ok(inputs.css.length > 5, 'the stylesheets are read');
  const tokens = sum(measured.classes);
  const words = sum(measured.vocabulary);
  t.diagnostic(`debt ${measured.debt}: ${measured.pending.length} of `
    + `${measured.surfaces.length} surfaces not on Flowbite Pro, ${tokens} osc-* class tokens `
    + `(${Object.keys(measured.classes).length} names), ${words} uses of `
    + `${Object.keys(measured.vocabulary).length} legacy vocabulary tokens, `
    + `${measured.debt - measured.pending.length - tokens - words} legacy selectors; `
    + `${inputs.js.length} JavaScript and ${inputs.css.length} stylesheet inputs; build `
    + `compiles Tailwind with flowbite: ${measured.build.compiles}`);
  const problems = recordProblems(measured, readBaseline());
  assert.deepEqual(problems, [], `the Flowbite Pro record (${BASELINE_REL}):\n  `
    + problems.join('\n  '));
});

test('the record has its fields, and its note states the ratchet', () => {
  const baseline = readBaseline();
  assert.deepEqual(Object.keys(baseline).sort(), ['classes', 'debt', 'inlineStyles', 'measure',
    'measured', 'note', 'rule', 'stylesheets', 'surfaces', 'vocabulary']);
  assert.equal(baseline.rule, 'project.ui-uses-flowbite-pro');
  assert.equal(baseline.measure, MEASURE);
  assert.match(baseline.note, /only shrinks/);
  assert.match(baseline.measured.commit, /^[0-9a-f]{40}$/);
  assert.ok(Number.isInteger(baseline.measured.debt) && baseline.measured.debt > 0);
});

/** Every committed version of the record along the first parents, newest first. */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const head = git('rev-parse', '--verify', '-q', 'HEAD');
  if (head.status !== 0) return { error: `git rev-parse HEAD: ${head.stderr || head.error}` };
  const log = git('log', '--first-parent', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return { error: `git log: ${log.stderr || log.error}` };
  const versions = [];
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const shown = git('show', `${sha}:${BASELINE_REL}`);
    if (shown.status !== 0) return { error: `git show ${sha}: ${shown.stderr}` };
    versions.push({ sha: sha.slice(0, 12), baseline: JSON.parse(shown.stdout) });
  }
  return { versions };
}

test('(a) the record only shrinks: it rises above no committed version of itself', (t) => {
  const history = baselineHistory();
  const gate = historyGate(history, process.env.GITHUB_ACTIONS === 'true');
  if (gate.verdict === 'fail') assert.fail(gate.reason);
  if (gate.verdict === 'skip') { t.skip(gate.reason); return; }
  const problems = historyProblems(readBaseline(), history.versions);
  t.diagnostic(`${history.versions.length} committed version(s) of the record judged`);
  assert.deepEqual(problems, [], `the record rose; it may only shrink:\n  `
    + problems.join('\n  '));
});

test('(c) no other UI kit, no foreign stylesheet import, no ad-hoc component library', () => {
  const inputs = treeInputs();
  const js = Object.fromEntries(inputs.js.map((f) => [f, read(f)]));
  const css = Object.fromEntries(inputs.css.map((f) => [f, read(f)]));
  const problems = kitProblems({ pkg: JSON.parse(read('package.json')), js, css,
    paths: [...new Set([...tracked('src'), ...inputs.js, ...inputs.css])].sort(),
    legacyStylesheets: Object.keys(readBaseline().stylesheets) });
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('(d) no licensed Flowbite Pro source file is tracked', () => {
  const record = JSON.parse(read(FINGERPRINTS_REL));
  assert.ok(record.fingerprints.length > 100, 'the fingerprints are read');
  assert.ok(record.fingerprints.every((p) => /^[0-9a-f]{16}$/.test(p)));
  const files = tracked().map((rel) => ({ path: rel, bytes: readFileSync(path.join(ROOT, rel)) }));
  assert.ok(files.length > 500, `tracked files read (${files.length})`);
  const problems = proSourceProblems(files, new Set(record.fingerprints));
  assert.deepEqual(problems, [], problems.join('\n'));
});

// ---------------------------------------------------------------- mutations (fixtures)

const PRO_CARD = 'bg-white rounded-lg shadow dark:bg-gray-800';
const SHELL = (body, { navbar = 'osc-header' } = {}) => `<body>
  <header class="${navbar}" role="banner">
    <nav class="osc-nav" aria-label="Workspace"></nav></header>
  <main class="osc-main" id="osc-main">${body}</main>
  <footer class="osc-statusbar" aria-label="Status and actions"></footer></body>`;
const FIX_HTML = SHELL(`
  <section class="osc-panel" id="osc-panel-a" x-show="a > b"><div class="osc-panel-header">
    <h2 class="osc-panel-title is-active" id="osc-panel-a-title">A</h2>
    <button class="osc-btn osc-btn-primary" :class="{ 'is-on': mode === 'linear' }"
      @click="openDialog('osc-dlg-a')" aria-controls="osc-dlg-a">Go</button></div>
  </section>
  <section class="osc-panel" id="osc-panel-b" style="width: 1px"></section>
  <!-- <section class="osc-panel" id="osc-commented"></section> -->
  <section class="osc-view" id="osc-view-x"></section>
  <dialog class="osc-dialog" id="osc-dlg-a"></dialog>`);
const FIX_JS = [
  "el.className = 'osc-btn osc-btn-secondary'; // osc-btn-secondaryx is a token of its own",
  "h('p', { class: `osc-note is-${state}`, id: 'osc-only-id' }); byId('osc-only-id');",
];
const FIX_CSS = {
  'src/styles/a.css': '/* .osc-gone { color: red } */\n.osc-panel { color: red; padding: 0 }\n'
    + '.osc-btn, .osc-btn-primary:is(.a, .b) { margin: 0;\n'
    + '  background: url("data:image/svg+xml;utf8,<svg>{;}</svg>") }\n'
    + '@media (max-width: 600px) { .osc-panel { padding: 1px; } }\n',
};
const FIX = { html: FIX_HTML, js: FIX_JS, css: FIX_CSS, build: NO_BUILD };
const record = (m) => ({ rule: 'x', note: 'x', measured: {}, measure: MEASURE, debt: m.debt,
  surfaces: { pending: m.pending, migrated: m.migrated }, classes: m.classes,
  vocabulary: m.vocabulary, stylesheets: m.stylesheets, inlineStyles: m.inlineStyles });
const fixRecord = () => record(measure(FIX));
const has = (problems, re) => assert.ok(problems.some((p) => re.test(p)),
  `expected ${re} in:\n  ${problems.join('\n  ')}`);

test('fixture: surfaces, class tokens, vocabulary, CSS and the debt as the header defines them',
  () => {
    const m = measure(FIX);
    assert.deepEqual(m.surfaces.map((s) => `${s.kind} ${s.key}`), [
      'navbar shell:navbar', 'sidebar shell:sidebar', 'main shell:main', 'card card#osc-panel-a',
      'card card#osc-panel-b', 'page page#osc-view-x', 'modal modal#osc-dlg-a',
      'footer shell:footer']);
    assert.deepEqual(m.migrated, []);
    assert.equal(m.pending.length, 8);
    assert.equal(m.classes['osc-'], undefined, 'only the names that occur are recorded');
    assert.equal(m.classes['osc-panel'], 2, 'a commented-out surface is not counted');
    assert.equal(m.classes['osc-btn'], 2);
    assert.equal(m.classes['osc-btn-secondary'], 1);
    assert.equal(m.classes['osc-btn-secondaryx'], 1, 'every osc-* token in JS counts');
    assert.equal(m.classes['osc-note'], 1);
    assert.equal(m.classes['osc-header'], 1, 'a BEM or shell class counts, not only primitives');
    assert.equal(m.classes['osc-only-id'], undefined, 'an id that is never a class is not one');
    assert.equal(m.classes['osc-dlg-a'], undefined, 'an id referenced from an expression');
    assert.equal(m.classes['osc-panel-a-title'], undefined);
    assert.deepEqual(m.vocabulary, { 'is-': 1, 'is-active': 1, 'is-on': 1 },
      "'linear' is compared, not a class");
    assert.deepEqual(m.stylesheets, { 'src/styles/a.css': { selectors: 4, declarations: 5 } });
    assert.equal(m.inlineStyles, 1);
    const tokens = sum(m.classes);
    assert.equal(m.debt, 8 + tokens + 3 + 4,
      'pending + osc-* tokens + vocabulary uses + selectors');
    assert.deepEqual(recordProblems(m, fixRecord()), []);
  });

test('mutation M2: a div-based surface or a new class family fails', () => {
  const b = fixRecord();
  const fancy = FIX_HTML.replace('</main>', '<div id="osc-fancy" class="my-fancy-card">'
    + '<button class="my-btn">x</button></div></main>');
  const p1 = recordProblems(measure({ ...FIX, html: fancy }), b);
  has(p1, /^my-fancy-card: a class outside the legacy vocabulary/);
  has(p1, /^my-btn: a class outside the legacy vocabulary/);
  const reused = FIX_HTML.replace('</main>', '<div class="osc-panel"></div></main>');
  has(recordProblems(measure({ ...FIX, html: reused }), b),
    /^osc-panel: 3 occurrences, above the recorded 2/);
  const styled = FIX_HTML.replace('</main>', '<div style="background: white"></div></main>');
  has(recordProblems(measure({ ...FIX, html: styled }), b),
    /^inline styles: 2 in src\/index\.html, above the recorded 1/);
  const jsFamily = [...FIX_JS, "h('div', { className: 'card-x ' + (on ? 'card-on' : '') })"];
  const p2 = recordProblems(measure({ ...FIX, js: jsFamily }), b);
  has(p2, /^card-x: a class outside the legacy vocabulary/);
  has(p2, /^card-on: a class outside the legacy vocabulary/);
  const styleEl = FIX_HTML.replace('</main>', '<style>.x { color: red }</style></main>');
  has(recordProblems(measure({ ...FIX, html: styleEl }), b),
    /^src\/index\.html: a <style> element/);
});

test('mutation M3: CSS appended to a legacy stylesheet, or rules in the Tailwind entry, fails',
  () => {
    const b = fixRecord();
    const appended = { 'src/styles/a.css':
      `${FIX_CSS['src/styles/a.css']}.my-card { padding: 4px }` };
    const p1 = recordProblems(measure({ ...FIX, css: appended }), b);
    has(p1, /^src\/styles\/a\.css: 5 selectors, above the recorded 4/);
    has(p1, /^src\/styles\/a\.css: 6 declarations, above the recorded 5/);
    const grown = { 'src/styles/a.css': FIX_CSS['src/styles/a.css']
      .replace('color: red; padding: 0', 'color: red; padding: 0; box-shadow: none') };
    has(recordProblems(measure({ ...FIX, css: grown }), b),
      /^src\/styles\/a\.css: 6 declarations, above the recorded 5/);
    const entry = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
      + '@plugin "flowbite/plugin";\n@theme { --color-primary-500: #000; }\n' };
    assert.deepEqual(recordProblems(measure({ ...FIX, css: entry }), b), []);
    const adHoc = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
      + '@layer components { .my-card { padding: 4px } }\n' };
    has(recordProblems(measure({ ...FIX, css: adHoc }), b),
      new RegExp(`^${TAILWIND_ENTRY}: 1 selector rule\\(s\\)`));
    const newSheet = { ...FIX_CSS, 'src/styles/cards.css': '.c { margin: 0 }' };
    has(recordProblems(measure({ ...FIX, css: newSheet }), b),
      /^src\/styles\/cards\.css: a new stylesheet/);
    const older = { ...b, stylesheets: { 'src/styles/a.css': { selectors: 3, declarations: 5 } } };
    assert.deepEqual(historyProblems(b, [{ sha: 'a1', baseline: older }]),
      ['src/styles/a.css: 4 selectors, above 3 at a1']);
  });

/** A repository of `files` ({ path: text }) of which `tracked` paths are tracked. */
const fakeRepo = (files, tracked = Object.keys(files)) => ({ paths: tracked,
  read: (p) => files[p], exists: (p) => Object.hasOwn(files, p) });

test('mutation M4/M5: a class used from .mjs or built by concatenation is counted', () => {
  const tree = fakeRepo(Object.fromEntries(['src/index.html', 'src/js/a.js', 'src/js/b.mjs',
    'src/js/c.cjs', 'src/js/d.ts', 'src/js/f.json', 'src/extra/e.jsx', 'src/styles/x.css',
    'scripts/s.mjs'].map((p) => [p, ''])));
  assert.deepEqual(bundledInputs(tree), { html: 'src/index.html', js: ['src/extra/e.jsx',
    'src/js/a.js', 'src/js/b.mjs', 'src/js/c.cjs', 'src/js/d.ts', 'src/js/f.json'],
  css: ['src/styles/x.css'] }, 'every tracked file under src, whatever its extension');
  const b = fixRecord();
  const concat = [...FIX_JS, "el.className = 'osc-' + 'btn';"];
  has(recordProblems(measure({ ...FIX, js: concat }), b),
    /^osc-: 1 occurrences, above the recorded 0/);
  const template = [...FIX_JS, 'el.className = `osc-btn--${size}`;'];
  has(recordProblems(measure({ ...FIX, js: template }), b),
    /^osc-btn--: 1 occurrences, above the recorded 0/);
});

test('mutation M7: renaming a legacy class and lowering the record fails against history', () => {
  const was = fixRecord();
  const renamed = FIX_JS.map((s) => s
    .replace("'osc-btn osc-btn-secondary'", "'osc-btn osc-btn-alt'"));
  const now = record(measure({ ...FIX, js: renamed }));
  assert.equal(now.debt, was.debt, 'a rename does not lower the debt');
  assert.deepEqual(recordProblems(measure({ ...FIX, js: renamed }), now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
    ['osc-btn-alt: 1 occurrences, above 0 at a1']);
  const fewer = { ...now, classes: { ...now.classes } };
  delete fewer.classes['osc-btn-alt'];
  fewer.debt -= 1;
  assert.deepEqual(historyProblems(fewer, [{ sha: 'a1', baseline: was }]), []);
  const vocab = { ...was, vocabulary: { ...was.vocabulary, 'is-new': 1 } };
  assert.deepEqual(historyProblems(vocab, [{ sha: 'a1', baseline: was }]),
    ['is-new: a class not in the vocabulary at a1']);
  const styles = { ...was, inlineStyles: was.inlineStyles + 1 };
  assert.deepEqual(historyProblems(styles, [{ sha: 'a1', baseline: was }]),
    [`inline styles: ${was.inlineStyles + 1}, above ${was.inlineStyles} at a1`]);
});

test('mutation M8: a pending surface that vanishes from the record fails', () => {
  const was = fixRecord();
  const gone = FIX_HTML.replace(' id="osc-panel-b"', '');
  const now = record(measure({ ...FIX, html: gone }));
  assert.ok(!now.surfaces.pending.includes('card#osc-panel-b'));
  assert.deepEqual(recordProblems(measure({ ...FIX, html: gone }), now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
    ['card#osc-panel-b: pending at a1, now neither pending nor migrated']);
});

test('mutation M9: a surface on the Pro class set counts as migrated only with the build', () => {
  const was = fixRecord();
  const proHtml = FIX_HTML.replace('class="osc-panel" id="osc-panel-b"',
    `class="p-4 ${PRO_CARD}" id="osc-panel-b"`);
  const unbuilt = measure({ ...FIX, html: proHtml });
  assert.ok(unbuilt.pending.includes('card#osc-panel-b'), 'without the build it stays pending');
  const p1 = recordProblems(unbuilt, was);
  has(p1, /^bg-white: a class outside the legacy vocabulary.*the build does not compile/);
  const claimed = { ...record(unbuilt), surfaces: { pending: unbuilt.pending
    .filter((k) => k !== 'card#osc-panel-b'), migrated: ['card#osc-panel-b'] } };
  has(recordProblems(unbuilt, claimed), /^card#osc-panel-b: listed as migrated, but the build/);
  const dist = `<style>${['p-4', ...PRO_CARD.split(' ')]
    .map((c) => `.${c.replace(/[^\w-]/g, '\\$&')}{x:y}`).join('')}</style>`;
  const built = { compiles: true, defines: definedClasses(dist) };
  const m = measure({ ...FIX, html: proHtml, build: built });
  assert.deepEqual(m.migrated, ['card#osc-panel-b']);
  const now = record(m);
  assert.deepEqual(recordProblems(m, now), []);
  assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]), []);
  const half = { compiles: true, defines: definedClasses('<style>.bg-white{x:y}</style>') };
  assert.ok(measure({ ...FIX, html: proHtml, build: half }).pending.includes('card#osc-panel-b'),
    'a Pro class the compiled CSS does not define keeps the surface pending');
});

test('fixture: the build compiles Tailwind with the flowbite plugin only when all of it is there',
  () => {
    const pkg = { devDependencies: { tailwindcss: '4', flowbite: '2' } };
    const build = "import { compile } from '@tailwindcss/node';";
    const entry = '@import "tailwindcss";\n@plugin "flowbite/plugin";\n';
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: entry } }), true);
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      'tailwind.config.js': "module.exports = { plugins: [require('flowbite/plugin')] };" } }),
    true);
    assert.equal(buildCompilesFlowbite({ pkg: {}, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: entry } }), false, 'no tailwindcss or flowbite dependency');
    assert.equal(buildCompilesFlowbite({ pkg, files: { [TAILWIND_ENTRY]: entry } }), false,
      'no build script runs Tailwind');
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs': build,
      [TAILWIND_ENTRY]: '@import "tailwindcss";\n/* @plugin "flowbite/plugin"; */' } }), false,
    'a commented-out plugin');
    assert.equal(buildCompilesFlowbite({ pkg, files: { 'scripts/build.mjs':
      `// ${build}`, [TAILWIND_ENTRY]: entry } }), false, 'a commented-out compiler');
  });

test('mutation N4/N5: a module or a stylesheet the build reaches outside src/js or src counts',
  () => {
    const files = {
      'src/index.html': '<body></body>',
      'src/js/main.js': "import './ui/a.js';\nimport '../extra/card.js';\n"
        + "import { x } from '../../lib/card';\nimport Alpine from 'alpinejs';\n"
        + "import w from './w.worklet.js?raw';\n"
        + "const u = new URL('../../lib/u.js', import.meta.url);"
        + "\nimport('./missing.js');",
      'src/js/ui/a.js': "export const a = require('../../../lib/components/btn.js');",
      'src/js/w.worklet.js': '',
      'src/extra/card.js': "export const card = (el) => { el.className = 'osc-btn my-new-card'; };",
      'lib/card.js': "export * from '../outside/deep.mjs';",
      'lib/u.js': '',
      'lib/components/btn.js': '',
      'outside/deep.mjs': "el.className = 'osc-btn';",
      'src/styles/main.css': '@import "uplot/dist/uPlot.min.css";\n@import "./a.css";\n'
        + '@import "../../assets-ui/x.css";\n@import url(tokens2.css);\n'
        + '/* @import "./commented.css"; */',
      'src/styles/a.css': '',
      'src/styles/tokens2.css': '',
      'src/styles/commented.css': '',
      'assets-ui/x.css': '.my-card { padding: 4px; color: red }\n',
      'node_modules/alpinejs/index.js': '',
    };
    const tracked = Object.keys(files).filter((p) => p.startsWith('src/')
      && !['src/styles/tokens2.css', 'src/styles/commented.css'].includes(p));
    const inputs = bundledInputs(fakeRepo(files, tracked));
    assert.deepEqual(inputs.js, ['lib/card.js', 'lib/components/btn.js', 'lib/u.js',
      'outside/deep.mjs', 'src/extra/card.js', 'src/js/main.js', 'src/js/ui/a.js',
      'src/js/w.worklet.js']);
    assert.deepEqual(inputs.css, ['assets-ui/x.css', 'src/styles/a.css', 'src/styles/main.css',
      'src/styles/tokens2.css'], 'an untracked stylesheet the build reaches is measured too');
    const b = fixRecord();
    const reached = measure({ ...FIX, js: [...FIX_JS, ...inputs.js.map((p) => files[p])],
      css: { ...FIX_CSS, 'assets-ui/x.css': files['assets-ui/x.css'] } });
    const p = recordProblems(reached, b);
    has(p, /^osc-btn: 4 occurrences, above the recorded 2/);
    has(p, /^my-new-card: a class outside the legacy vocabulary/);
    has(p, /^assets-ui\/x\.css: a new stylesheet/);
    assert.deepEqual(kitProblems({ pkg: {}, js: {}, css: {},
      paths: [...inputs.js, ...inputs.css] }),
      ['lib/components/btn.js: an ad-hoc component library; adapt the Flowbite Pro component']);
    assert.equal(resolveRelative('src/js/a.js', '../../../etc/x.js', () => true), null,
      'a path outside the repository is not an input');
    assert.equal(resolveRelative('src/js/a.js', 'alpinejs', () => true), null, 'nor a package');
  });

test('mutation N7/N2: renaming into, or reusing, a legacy vocabulary token raises its count',
  () => {
    const was = fixRecord();
    const renamed = FIX_JS.map((s) => s
      .replace("'osc-btn osc-btn-secondary'", "'osc-btn is-active'"));
    const m = measure({ ...FIX, js: renamed });
    has(recordProblems(m, was), /^is-active: 2 uses, above the recorded 1/);
    const now = record(m);
    assert.equal(now.debt, was.debt, 'a rename into the vocabulary does not lower the debt');
    assert.deepEqual(historyProblems(now, [{ sha: 'a1', baseline: was }]),
      ['is-active: 2 uses, above 1 at a1']);
    const reused = FIX_HTML.replace('</main>',
      '<div class="is-on x"><b class="is-">y</b></div></main>');
    const p = recordProblems(measure({ ...FIX, html: reused }), was);
    has(p, /^is-on: 2 uses, above the recorded 1/);
    has(p, /^is-: 2 uses, above the recorded 1/);
    has(p, /^x: a class outside the legacy vocabulary/);
    const v2 = { ...was, measure: MEASURE - 1, vocabulary: Object.keys(was.vocabulary) };
    assert.deepEqual(historyProblems({ ...was, vocabulary: { ...was.vocabulary, y: 1 } },
      [{ sha: 'm2', baseline: v2 }]), ['y: a class not in the vocabulary at m2'],
    'a token is new against a version of an earlier measure too');
  });

const proBuild = (css) => ({ compiles: true, defines: definedClasses(`<style>${css}</style>`) });

test('mutation N10: ad-hoc CSS in the Tailwind entry, its config or a local plugin fails', () => {
  const b = fixRecord();
  const html = FIX_HTML.replace('</main>', '<div class="my-card"></div></main>');
  const utility = { ...FIX_CSS, [TAILWIND_ENTRY]: '@import "tailwindcss";\n'
    + '@plugin "flowbite/plugin";\n@utility my-card { padding: 4px; border: 1px solid red; }\n' };
  const built = proBuild('.my-card{padding:4px}');
  assert.deepEqual(recordProblems(measure({ ...FIX, html, css: utility, build: built }), b), [
    `${TAILWIND_ENTRY}: 1 selector rule(s) or @utility rule(s); the Tailwind entry holds only `
      + '@import, @plugin, @source, @theme and other at-rules: style with Tailwind and Flowbite '
      + 'Pro classes'], 'the class it defines is in dist, but the entry defines it');
  const config = { 'tailwind.config.cjs': "const plugin = require('tailwindcss/plugin');\n"
    + 'module.exports = { plugins: [plugin(({ addComponents }) => {\n'
    + "  addComponents({ '.my-card': { padding: '4px' } });\n  // addUtilities({})\n})] };" };
  has(recordProblems(measure({ ...FIX, html, build: built, tailwind: config }), b),
    /^tailwind\.config\.cjs: 1 call\(s\) of addComponents/);
  const files = {
    [TAILWIND_ENTRY]: '@import "tailwindcss";\n@plugin "./cards.js";\n@plugin "flowbite/plugin";',
    'src/styles/cards.js': "export default ({ matchUtilities }) => matchUtilities({});",
    'tailwind.config.js': "module.exports = { plugins: [require('./tw/base.cjs')] };",
    'tw/base.cjs': 'module.exports = ({ addBase }) => addBase({ h1: {} });',
  };
  const loaded = tailwindFiles(fakeRepo(files));
  assert.deepEqual(Object.keys(loaded).sort(), ['src/styles/cards.js', 'tailwind.config.js',
    'tw/base.cjs']);
  const p = recordProblems(measure({ ...FIX, tailwind: loaded }), b);
  has(p, /^src\/styles\/cards\.js: 1 call/);
  has(p, /^tw\/base\.cjs: 1 call/);
});

test('mutation: after F001 a legacy class stays legacy whatever dist defines (is-active, N8)',
  () => {
    const legacy = '.osc-panel-title.is-active { color: red }\n';
    const css = { 'src/styles/a.css': FIX_CSS['src/styles/a.css'] + legacy };
    const f001 = proBuild('.osc-panel-title.is-active{color:red}');
    const atF001 = measure({ ...FIX, css, build: f001 });
    assert.equal(atF001.vocabulary['is-active'], 1, 'a legacy stylesheet names it: legacy');
    const recF001 = record(atF001);
    assert.deepEqual(recordProblems(atF001, recF001), []);
    const later = measure({ ...FIX, build: proBuild('') });
    assert.equal(later.vocabulary['is-active'], 1, 'its last legacy rule removed: still legacy');
    const recLater = record(later);
    assert.deepEqual(recordProblems(later, recLater), []);
    assert.deepEqual(historyProblems(recLater, [{ sha: 'f001', baseline: recF001 }]), [],
      'removing legacy CSS never turns a used legacy class into a new one');
    const flowbiteToo = measure({ ...FIX, build: proBuild('.is-active{color:blue}') });
    has(recordProblems(flowbiteToo, recLater),
      /^is-active: in the recorded vocabulary, but now a Pro class/);
    const renamed = FIX_JS.map((s) => s
      .replace("'osc-btn osc-btn-secondary'", "'osc-btn btn-secondary'"));
    const n8 = measure({ ...FIX, js: renamed, build: proBuild('.btn-secondary{color:red}'),
      css: { 'src/styles/a.css': `${FIX_CSS['src/styles/a.css']}.btn-secondary { color: red }` } });
    has(recordProblems(n8, fixRecord()),
      /^btn-secondary: a class outside the legacy vocabulary of the record, and it is not a Pro/);
    const proHtml = FIX_HTML.replace('class="osc-panel" id="osc-panel-b"',
      `class="p-4 ${PRO_CARD}" id="osc-panel-b"`);
    const fake = measure({ ...FIX, html: proHtml, build: proBuild('.bg-white{x:y}.rounded-lg{x:y}'
      + '.shadow{x:y}.dark\\:bg-gray-800{x:y}'), css: { 'src/styles/a.css':
      `${FIX_CSS['src/styles/a.css']}.bg-white { color: white }` } });
    assert.ok(fake.pending.includes('card#osc-panel-b'),
      'a Pro class a legacy stylesheet defines does not migrate a surface');
  });

test('fixture: a Studio node id that is never in a class position is not counted', () => {
  const js = [...FIX_JS, "node('osc-1', 'oscillator'); edge('e-1', 'osc-1', 'audio', 'env-1');",
    "el.className = 'osc-2'; const n = 'osc-3';", '.osc-3 {}'];
  const m = measure({ ...FIX, js });
  assert.equal(m.classes['osc-1'], undefined, 'a node id');
  assert.equal(m.classes['osc-2'], 1, 'in a class position');
  assert.equal(m.classes['osc-3'], 2, 'a selector names it');
});

test('fixture: the history gate fails in CI when git fails, and skips only outside CI', () => {
  assert.equal(historyGate({ error: 'git log failed' }, true).verdict, 'fail');
  assert.equal(historyGate({ versions: [] }, true).verdict, 'fail');
  assert.equal(historyGate({ error: 'git log failed' }, false).verdict, 'skip');
  assert.equal(historyGate({ versions: [{ sha: 'a1', baseline: {} }] }, true).verdict, 'judge');
});

test('fixture: the working tree is judged against each committed version, not each pair', () => {
  const was = fixRecord();
  const high = { ...was, debt: was.debt + 5 };
  const history = [{ sha: 'b2', baseline: high }, { sha: 'a1', baseline: was }];
  assert.deepEqual(historyProblems(was, history), [],
    'an earlier version above a still earlier one is not judged again');
  assert.deepEqual(historyProblems({ ...was, debt: was.debt + 1 }, history),
    [`debt ${was.debt + 1} is above ${was.debt} at a1`]);
  const v1 = { debt: 1, surfaces: { pending: was.surfaces.pending }, primitives: { 'osc-btn': 0 },
    stylesheets: ['src/styles/a.css'] };
  assert.deepEqual(historyProblems(was, [{ sha: 'v1', baseline: v1 }]), [],
    'the numbers of an earlier measure are not compared');
  const v1Sheets = { ...v1, stylesheets: [] };
  assert.deepEqual(historyProblems(was, [{ sha: 'v1', baseline: v1Sheets }]),
    ['src/styles/a.css: a legacy stylesheet not listed at v1']);
  assert.deepEqual(historyProblems({ ...was, measure: 1 }, [{ sha: 'a1', baseline: was }]),
    [`measure 1 is below ${MEASURE} at a1`]);
});

test('mutation (c): another UI kit, a foreign @import, a new stylesheet or a component library',
  () => {
    const clean = { pkg: { dependencies: { alpinejs: '3', flowbite: '2' },
      devDependencies: { tailwindcss: '3' } },
    js: { 'src/js/a.js': "import Alpine from 'alpinejs';" },
    css: { 'src/styles/main.css': '@import "uplot/dist/uPlot.min.css";\n@import "./a.css";\n'
      + '@import "flowbite";' }, paths: ['src/js/a.js', 'src/styles/a.css'] };
    assert.deepEqual(kitProblems(clean), []);
    assert.deepEqual(kitProblems({ ...clean, pkg: { dependencies: { bootstrap: '5',
      '@mui/material': '6' } } }), ['package.json dependencies: bootstrap is another UI kit',
      'package.json dependencies: @mui/material is another UI kit']);
    assert.deepEqual(kitProblems({ ...clean, js: { 'src/js/b.js':
      "import { Button } from '@chakra-ui/react';\nconst d = await import('daisyui');" } }),
    ['src/js/b.js: imports @chakra-ui/react, another UI kit',
      'src/js/b.js: imports daisyui, another UI kit']);
    assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/x.css':
      '@import url("bulma/css/bulma.css");\n@import "animate.css";\n/* @import "uikit"; */' } }),
    ['src/styles/x.css: @import bulma/css/bulma.css, another UI kit',
      `src/styles/x.css: @import animate.css, a package outside ${ALLOWED_CSS_PACKAGES}`]);
    assert.deepEqual(kitProblems({ ...clean, paths: ['src/js/ui/components/button.js',
      'src/styles/widgets.css', 'src/styles/components.css'],
    legacyStylesheets: ['src/styles/components.css'] }), [
      'src/js/ui/components/button.js: an ad-hoc component library; adapt the Flowbite Pro '
        + 'component',
      'src/styles/widgets.css: an ad-hoc component library; adapt the Flowbite Pro component']);
    assert.deepEqual(kitProblems({ ...clean, css: { 'src/styles/y.css': '@import "flowbite-x";\n'
      + '@import "tailwindcss-forms/x.css";\n@import "uplotted";\n@import "tailwindcss/base";\n'
      + '@import "flowbite/plugin";' } }), [
      `src/styles/y.css: @import flowbite-x, a package outside ${ALLOWED_CSS_PACKAGES}`,
      `src/styles/y.css: @import tailwindcss-forms/x.css, a package outside `
        + `${ALLOWED_CSS_PACKAGES}`,
      `src/styles/y.css: @import uplotted, a package outside ${ALLOWED_CSS_PACKAGES}`],
    'a package is allowed by its exact name, never by a prefix');
  });

test('mutation (d): a Pro package path, a fingerprinted file or a Pro marker fails', () => {
  const pro = Buffer.from(`${'<div class="p-4 bg-white rounded-lg shadow">x</div>\n'.repeat(20)}`);
  const prints = new Set([fingerprint('a.html', pro)]);
  const ok = Buffer.from('<p>OSCILLA</p>');
  assert.deepEqual(proSourceProblems([{ path: 'src/index.html', bytes: ok }], prints), []);
  assert.deepEqual(proSourceProblems([
    { path: 'vendor/flowbite-admin-dashboard-1.1.1/src/html/index.html', bytes: ok },
    { path: 'assets/vendor/flowbite/app.js', bytes: ok },
    { path: 'src/pages/copied.html', bytes: Buffer.from(pro.toString().replace(/\n/g, '\r\n')) },
    { path: 'docs/notes.md', bytes: Buffer.from(`see ${PRO_MARKERS[0]}/ for terms`) },
    { path: 'package.json',
      bytes: Buffer.from(`"url": "git+https://github.com/${PRO_MARKERS[1]}"`) },
  ], prints), [
    'vendor/flowbite-admin-dashboard-1.1.1/src/html/index.html: a path named like a licensed '
      + 'Flowbite Pro package',
    'assets/vendor/flowbite/app.js: a path named like a licensed Flowbite Pro package',
    `src/pages/copied.html: a licensed Flowbite Pro source file (fingerprint ${[...prints][0]})`,
    `docs/notes.md: carries ${PRO_MARKERS[0]}, a marker of the licensed Pro packages`,
    `package.json: carries ${PRO_MARKERS[1]}, a marker of the licensed Pro packages`,
  ]);
  for (const own of ['scripts/flowbite-pro-fingerprints.mjs', FINGERPRINTS_REL,
    'tests/unit/ui-flowbite-pro.test.mjs']) {
    assert.deepEqual(proSourceProblems([{ path: own, bytes: ok }], prints), [], own);
  }
  for (const pkg of ['flowbite-admin-dashboard-1.1.1', 'flowbite-pro-nextjs-admin-dashboard-1.2.2',
    'flowbite-pro-react-admin-dashboard-main', 'flowbite-react-blocks-1.5.0-beta',
    'publisher-ui-blocks-v1.0.0', 'flowbite-react-blocks-main.zip']) {
    assert.match(pkg, PRO_PACKAGE_NAME, pkg);
  }
  assert.equal(fingerprint('small.js', Buffer.from('module.exports = {};')), null,
    'a file below the minimum is not fingerprinted');
});
