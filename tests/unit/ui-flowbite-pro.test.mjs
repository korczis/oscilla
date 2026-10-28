// Rule project.ui-uses-flowbite-pro (ADR 0061): the UI of OSCILLA is built on Flowbite Pro on
// Tailwind. The interface that predates the rule is recorded as debt that only shrinks.
//
// tests/unit/ui-flowbite-pro-baseline.json records the debt, and the tree must equal it:
//   (a) the debt count is the number of UI surfaces of src/index.html (HTML comments removed)
//       whose root element does not carry the Flowbite Pro structure of its kind, plus the
//       number of occurrences of the legacy primitive class names (LEGACY_PRIMITIVES, each
//       matched as a whole name, not as the prefix of a longer one) in src/index.html (HTML
//       comments removed) and in every tracked .js file under src/js. A surface is:
//         navbar   the element with role="banner"
//         sidebar  the element with aria-label="Workspace"
//         main     the <main> element
//         footer   the element with aria-label="Status and actions"
//         page     every element whose id starts with "osc-view-" (a workspace)
//         card     every other <section> element with an id
//         modal    every <dialog> element with an id
//       and it is on Pro when the static class attribute of its root holds every class of
//       one of the class sets PRO_STRUCTURE gives its kind (taken from the Pro admin shell:
//       the navbar, the sidebar drawer, #main-content, the footer card, the page gutter, the
//       card and the modal content). The baseline lists the surfaces not on Pro (pending), the
//       surfaces on Pro (migrated) and the count of each primitive; the tree must hold exactly
//       those, so a new surface that is not on Pro, or a new use of a primitive, fails, and a
//       migration must lower the record in the same change. The record only shrinks: every
//       version of the baseline in its first-parent git history, the working tree's included,
//       is judged against every earlier one (debt, each primitive and the stylesheet list no
//       higher, no pending surface that an earlier version did not list).
//   (b) every surface the baseline lists as migrated exists and is on Pro.
//   (c) no other UI kit: no dependency, JavaScript import or CSS @import of a package of
//       OTHER_UI_KITS; no CSS @import of a package outside ALLOWED_CSS_PACKAGES; no stylesheet
//       under src/styles beyond the legacy ones the baseline lists and TAILWIND_ENTRY; and no
//       module of an ad-hoc component library (a path under src/ with a components, widgets,
//       ui-kit or design-system segment) beyond the legacy stylesheet the baseline lists.
//   (d) no Flowbite Pro source file is tracked: no path with a segment named like a Pro
//       package (PRO_PACKAGE_NAME) or a vendor/flowbite directory, no file whose fingerprint
//       is in tests/unit/flowbite-pro-fingerprints.json (scripts/flowbite-pro-fingerprints.mjs),
//       and no file carrying a marker of the Pro packages (PRO_MARKERS: their licence URL and
//       repository names). OSCILLA is a public repository and a public Pages site.
// Every clause has a fixture case beside the check on the real tree that makes it fail.
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

/** The token-CSS component primitives Flowbite Pro components replace. */
export const LEGACY_PRIMITIVES = [
  'osc-panel', 'osc-panel-header', 'osc-panel-title',
  'osc-dialog', 'osc-dialog-title', 'osc-dialog-body', 'osc-dialog-actions',
  'osc-btn', 'osc-btn-lg', 'osc-btn-primary', 'osc-btn-secondary', 'osc-btn-success',
  'osc-icon-btn', 'osc-chip-btn',
  'osc-tabs', 'osc-tab', 'osc-seg', 'osc-seg-btn',
  'osc-select', 'osc-number', 'osc-toggle', 'osc-slider', 'osc-field-box', 'osc-label',
  'osc-menu', 'osc-menu-item', 'osc-warning', 'osc-divider',
];

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

/** Bare packages a stylesheet may @import. */
export const ALLOWED_CSS_PACKAGES = ['uplot/', 'tailwindcss', 'flowbite'];

/** A path segment named like a licensed Pro package. */
export const PRO_PACKAGE_NAME =
  /^(flowbite-admin-dashboard|flowbite-pro|flowbite-react-blocks|publisher-ui-blocks)([-.\w]*)$/i;

/** Text only the licensed Pro packages carry (built from parts, so this file carries none). */
export const PRO_MARKERS = [
  ['flowbite.com', 'license'].join('/'),
  ...['flowbite-admin-dashboard', 'flowbite-pro', 'flowbite-react-blocks', 'publisher-ui-blocks']
    .map((name) => ['themesberg', name].join('/')),
];

const COMPONENT_LIBRARY = /(^|\/)(components?|widgets?|ui-kit|design-system)(\/|\.[a-z]+$)/i;

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

/** The UI surfaces of `html`: [{ key, kind, classes }]. */
export function surfacesOf(html) {
  const out = [];
  for (const { tag, attrs } of openingTags(stripComments(html))) {
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const id = attrs.id || '';
    let kind = null;
    let key = null;
    if (attrs.role === 'banner') [kind, key] = ['navbar', 'shell:navbar'];
    else if (attrs['aria-label'] === 'Workspace') [kind, key] = ['sidebar', 'shell:sidebar'];
    else if (tag === 'main') [kind, key] = ['main', 'shell:main'];
    else if (attrs['aria-label'] === 'Status and actions') [kind, key] = ['footer', 'shell:footer'];
    else if (id.startsWith('osc-view-')) [kind, key] = ['page', `page#${id}`];
    else if (tag === 'section' && id) [kind, key] = ['card', `card#${id}`];
    else if (tag === 'dialog' && id) [kind, key] = ['modal', `modal#${id}`];
    if (kind) out.push({ key, kind, classes });
  }
  return out;
}

export const onPro = (surface) => PRO_STRUCTURE[surface.kind]
  .some((set) => set.every((c) => surface.classes.has(c)));

/** Whole-name occurrences of each primitive in the given texts. */
export function primitiveCounts(texts) {
  const counts = {};
  for (const name of LEGACY_PRIMITIVES) {
    const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
      'g');
    counts[name] = texts.reduce((n, t) => n + (t.match(re) || []).length, 0);
  }
  return counts;
}

/** What the rule measures on a tree: { html, js: [text] } -> debt. */
export function measure({ html, js }) {
  const surfaces = surfacesOf(html);
  const pending = surfaces.filter((s) => !onPro(s)).map((s) => s.key).sort();
  const migrated = surfaces.filter(onPro).map((s) => s.key).sort();
  const primitives = primitiveCounts([stripComments(html), ...js]);
  const debt = pending.length + Object.values(primitives).reduce((a, b) => a + b, 0);
  return { surfaces, pending, migrated, primitives, debt };
}

// ---------------------------------------------------------------- (a), (b): the record

/** Every difference between the measured tree and the baseline. */
export function recordProblems(measured, baseline, stylesheets) {
  const problems = [];
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
      problems.push(`${k}: listed as migrated, but its root no longer carries the Flowbite Pro `
        + `structure of its kind (${structureText(measured, k)})`);
    } else if (!pending.has(k)) {
      problems.push(`${k}: a new surface not on Flowbite Pro; build it from the Pro `
        + `${kindOf(measured, k)} (${structureText(measured, k)})`);
    }
  }
  for (const k of measured.migrated) {
    if (!migrated.has(k)) {
      problems.push(`${k}: on Flowbite Pro but not listed as migrated: move it from pending to `
        + 'migrated in the baseline');
    }
  }
  for (const k of pending) {
    if (!keys.has(k)) problems.push(`${k}: listed as pending, but no such surface: remove it`);
  }
  for (const k of migrated) {
    if (!keys.has(k)) problems.push(`${k}: listed as migrated, but no such surface exists`);
  }
  const want = baseline.primitives || {};
  for (const name of LEGACY_PRIMITIVES) {
    const n = measured.primitives[name];
    if (!Object.hasOwn(want, name)) problems.push(`${name}: not recorded in the baseline`);
    else if (n > want[name]) {
      problems.push(`${name}: ${n} occurrences, above the recorded ${want[name]}: use the `
        + 'Flowbite Pro component instead');
    } else if (n < want[name]) {
      problems.push(`${name}: ${n} occurrences, below the recorded ${want[name]}: lower the `
        + 'record in the same change');
    }
  }
  for (const name of Object.keys(want)) {
    if (!LEGACY_PRIMITIVES.includes(name)) problems.push(`${name}: recorded, but not measured`);
  }
  if (baseline.debt !== measured.debt) {
    problems.push(`debt: the tree has ${measured.debt}, the baseline records ${baseline.debt}`);
  }
  const legacy = new Set(baseline.stylesheets || []);
  for (const f of stylesheets) {
    if (f !== TAILWIND_ENTRY && !legacy.has(f)) {
      problems.push(`${f}: a new stylesheet; style with Tailwind and Flowbite Pro classes (the `
        + `one entry is ${TAILWIND_ENTRY})`);
    }
  }
  for (const f of legacy) {
    if (!stylesheets.includes(f)) problems.push(`${f}: listed, but not a stylesheet: remove it`);
  }
  return problems;
}

const kindOf = (measured, key) => measured.surfaces.find((s) => s.key === key).kind;
const structureText = (measured, key) => PRO_STRUCTURE[kindOf(measured, key)]
  .map((set) => set.join(' ')).join(' | ');

/**
 * What `current` raises over the earlier versions in `history` (newest first, each
 * { sha, baseline }): debt, a primitive or the stylesheet list above an earlier value, a
 * pending surface an earlier version did not list, a primitive dropped from the record.
 */
export function historyProblems(current, history) {
  const problems = [];
  for (const { sha, baseline: then } of history) {
    if (current.debt > then.debt) {
      problems.push(`debt ${current.debt} is above ${then.debt} at ${sha}`);
    }
    const was = new Set(then.surfaces?.pending || []);
    for (const k of current.surfaces?.pending || []) {
      if (!was.has(k)) problems.push(`${k}: pending, but not pending at ${sha}`);
    }
    for (const [name, n] of Object.entries(then.primitives || {})) {
      const now = current.primitives?.[name];
      if (now === undefined) problems.push(`${name}: recorded at ${sha}, dropped from the record`);
      else if (now > n) problems.push(`${name}: ${now} is above ${n} at ${sha}`);
    }
    const sheets = new Set(then.stylesheets || []);
    for (const f of current.stylesheets || []) {
      if (!sheets.has(f)) problems.push(`${f}: a legacy stylesheet not listed at ${sha}`);
    }
  }
  return [...new Set(problems)];
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
      else if (!ALLOWED_CSS_PACKAGES.some((p) => spec === p || spec.startsWith(p))) {
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
const jsFiles = () => tracked('src/js').filter((f) => f.endsWith('.js'));
const stylesheets = () => tracked('src/styles').filter((f) => f.endsWith('.css'));
const treeMeasure = () => measure({ html: read('src/index.html'), js: jsFiles().map(read) });

test('the rule and the ADR exist and name this test', () => {
  const rule = read(RULE_REL);
  assert.match(rule, /^id: project\.ui-uses-flowbite-pro$/m);
  assert.match(rule, /^class: blocking$/m);
  assert.match(rule, /tests\/unit\/ui-flowbite-pro\.test\.mjs/);
  const adr = read(ADR_REL);
  assert.match(adr, /^status: accepted$/m);
  assert.match(adr, /rule:project\.ui-uses-flowbite-pro/);
});

test('(a) the tree holds exactly the recorded debt, and (b) every migrated surface is on Pro',
  (t) => {
    const measured = treeMeasure();
    assert.ok(measured.surfaces.length > 50, `surfaces found (${measured.surfaces.length})`);
    for (const kind of Object.keys(PRO_STRUCTURE)) {
      assert.ok(measured.surfaces.some((s) => s.kind === kind), `a ${kind} surface is found`);
    }
    assert.ok(jsFiles().length > 50, 'the modules of src/js are read');
    const baseline = readBaseline();
    const problems = recordProblems(measured, baseline, stylesheets());
    t.diagnostic(`debt ${measured.debt}: ${measured.pending.length} of `
      + `${measured.surfaces.length} surfaces not on Flowbite Pro, `
      + `${measured.debt - measured.pending.length} legacy primitive occurrences`);
    assert.deepEqual(problems, [], `the Flowbite Pro record (${BASELINE_REL}):\n  `
      + problems.join('\n  '));
  });

test('the baseline has its fields, and its note states the ratchet', () => {
  const baseline = readBaseline();
  assert.deepEqual(Object.keys(baseline).sort(),
    ['debt', 'measured', 'note', 'primitives', 'rule', 'stylesheets', 'surfaces']);
  assert.equal(baseline.rule, 'project.ui-uses-flowbite-pro');
  assert.match(baseline.note, /only shrinks/);
  assert.match(baseline.measured.commit, /^[0-9a-f]{40}$/);
  assert.ok(Number.isInteger(baseline.measured.debt) && baseline.measured.debt > 0);
});

/** The baseline of every commit that changed it, newest first, along the first parents. */
function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--first-parent', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).flatMap((sha) => {
    const shown = git('show', `${sha}:${BASELINE_REL}`);
    return shown.status === 0 ? [{ sha: sha.slice(0, 12), baseline: JSON.parse(shown.stdout) }]
      : [];
  });
}

test('(a) the debt only shrinks: no version of the baseline rises above an earlier one', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the baseline here');
    return;
  }
  const problems = historyProblems(readBaseline(), history);
  t.diagnostic(`${history.length} recorded version(s) of the baseline judged`);
  assert.deepEqual(problems, [], `the debt rose; it may only shrink:\n  ${problems.join('\n  ')}`);
});

test('(c) no other UI kit, no foreign stylesheet import, no ad-hoc component library', () => {
  const js = Object.fromEntries(jsFiles().map((f) => [f, read(f)]));
  const css = Object.fromEntries(stylesheets().map((f) => [f, read(f)]));
  const problems = kitProblems({ pkg: JSON.parse(read('package.json')), js, css,
    paths: tracked('src'), legacyStylesheets: readBaseline().stylesheets });
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
  <header class="${navbar}" role="banner"><nav class="osc-nav" aria-label="Workspace"></nav></header>
  <main class="osc-main" id="osc-main">${body}</main>
  <footer class="osc-statusbar" aria-label="Status and actions"></footer></body>`;
const FIX_HTML = SHELL(`
  <section class="osc-panel" id="osc-panel-a" x-show="a > b"><div class="osc-panel-header">
    <h2 class="osc-panel-title">A</h2><button class="osc-btn osc-btn-primary">Go</button></div>
  </section>
  <section class="p-4 ${PRO_CARD}" id="osc-panel-b"></section>
  <!-- <section class="osc-panel" id="osc-commented"></section> -->
  <section class="osc-view" id="osc-view-x"></section>
  <dialog class="osc-dialog" id="osc-dlg-a"></dialog>`);
const FIX_JS = ["el.className = 'osc-btn osc-btn-secondary'; // osc-btn-secondaryx is not one"];

function fixtureBaseline() {
  const m = measure({ html: FIX_HTML, js: FIX_JS });
  return { pending: m.pending, migrated: m.migrated, primitives: m.primitives, debt: m.debt };
}
const asBaseline = (b, stylesheets = ['src/styles/a.css']) => ({ rule: 'x', note: 'x',
  measured: {}, debt: b.debt, surfaces: { pending: b.pending, migrated: b.migrated },
  primitives: b.primitives, stylesheets });

test('fixture: surfaces, kinds and the debt are measured as the header defines them', () => {
  const m = measure({ html: FIX_HTML, js: FIX_JS });
  assert.deepEqual(m.surfaces.map((s) => `${s.kind} ${s.key}`), [
    'navbar shell:navbar', 'sidebar shell:sidebar', 'main shell:main', 'card card#osc-panel-a',
    'card card#osc-panel-b', 'page page#osc-view-x', 'modal modal#osc-dlg-a',
    'footer shell:footer']);
  assert.deepEqual(m.migrated, ['card#osc-panel-b']);
  assert.equal(m.pending.length, 7);
  assert.equal(m.primitives['osc-btn'], 2);
  assert.equal(m.primitives['osc-btn-secondary'], 1, 'a longer name is not an occurrence');
  assert.equal(m.primitives['osc-panel'], 1, 'a commented-out surface is not counted');
  assert.equal(m.debt, 7 + 1 + 1 + 1 + 2 + 1 + 1 + 1);
  const b = asBaseline(fixtureBaseline());
  assert.deepEqual(recordProblems(m, b, ['src/styles/a.css']), []);
});

test('mutation (a): a new surface not on Pro, a new primitive use, or a stale record fails', () => {
  const b = asBaseline(fixtureBaseline());
  const added = FIX_HTML.replace('</main>', '<section class="osc-panel" id="osc-new"></section>'
    + '</main>');
  const m1 = measure({ html: added, js: FIX_JS });
  const p1 = recordProblems(m1, b, ['src/styles/a.css']);
  assert.ok(p1.some((p) => /^card#osc-new: a new surface not on Flowbite Pro/.test(p)), p1);
  assert.ok(p1.some((p) => /^osc-panel: 2 occurrences, above the recorded 1/.test(p)), p1);
  assert.ok(p1.some((p) => /^debt: /.test(p)), p1);
  const m2 = measure({ html: FIX_HTML, js: [...FIX_JS, "'osc-tab'"] });
  assert.ok(recordProblems(m2, b, ['src/styles/a.css'])
    .some((p) => /^osc-tab: 1 occurrences, above the recorded 0/.test(p)));
  const lowered = measure({ html: FIX_HTML, js: [] });
  assert.ok(recordProblems(lowered, b, ['src/styles/a.css'])
    .some((p) => /^osc-btn: 1 occurrences, below the recorded 2: lower the record/.test(p)));
  const pro = SHELL('', { navbar: `fixed z-30 w-full bg-white border-b border-gray-200 `
    + 'dark:bg-gray-800 dark:border-gray-700' });
  const m3 = measure({ html: pro, js: [] });
  const b3 = asBaseline({ ...measure({ html: SHELL(''), js: [] }) });
  assert.ok(recordProblems(m3, b3, ['src/styles/a.css']).some((p) =>
    /^shell:navbar: on Flowbite Pro but not listed as migrated/.test(p)));
  assert.ok(recordProblems(measure({ html: '<main></main>', js: [] }), b3, [])
    .some((p) => /^shell:navbar: not found/.test(p)));
});

test('mutation (a): a rise against any earlier version of the baseline fails', () => {
  const was = asBaseline(fixtureBaseline());
  const older = { ...was, debt: was.debt - 1, primitives: { ...was.primitives, 'osc-btn': 1 } };
  const history = [{ sha: 'b2', baseline: was }, { sha: 'a1', baseline: older }];
  assert.deepEqual(historyProblems(was, [{ sha: 'b2', baseline: was }]), []);
  assert.deepEqual(historyProblems(was, history), [
    `debt ${was.debt} is above ${was.debt - 1} at a1`, 'osc-btn: 2 is above 1 at a1']);
  const swapped = { ...was, surfaces: { ...was.surfaces,
    pending: [...was.surfaces.pending.slice(1), 'card#osc-other'] } };
  assert.deepEqual(historyProblems(swapped, [{ sha: 'b2', baseline: was }]),
    ['card#osc-other: pending, but not pending at b2']);
  const dropped = { ...was, primitives: { ...was.primitives } };
  delete dropped.primitives['osc-tab'];
  assert.deepEqual(historyProblems(dropped, [{ sha: 'b2', baseline: was }]),
    ['osc-tab: recorded at b2, dropped from the record']);
  const sheet = { ...was, stylesheets: [...was.stylesheets, 'src/styles/new.css'] };
  assert.deepEqual(historyProblems(sheet, [{ sha: 'b2', baseline: was }]),
    ['src/styles/new.css: a legacy stylesheet not listed at b2']);
});

test('mutation (b): a migrated surface that stops using the Pro structure fails', () => {
  const b = asBaseline(fixtureBaseline());
  const regressed = FIX_HTML.replace(`p-4 ${PRO_CARD}`, 'p-4 bg-white rounded-lg');
  const p = recordProblems(measure({ html: regressed, js: FIX_JS }), b, ['src/styles/a.css']);
  assert.ok(p.some((x) => /^card#osc-panel-b: listed as migrated, but its root no longer/.test(x)),
    p);
  const gone = FIX_HTML.replace(`<section class="p-4 ${PRO_CARD}" id="osc-panel-b"></section>`, '');
  assert.ok(recordProblems(measure({ html: gone, js: FIX_JS }), b, ['src/styles/a.css'])
    .some((x) => /^card#osc-panel-b: listed as migrated, but no such surface exists/.test(x)));
});

test('mutation (c): another UI kit, a foreign @import, a new stylesheet or a component library',
  () => {
    const clean = { pkg: { dependencies: { alpinejs: '3', flowbite: '2' },
      devDependencies: { tailwindcss: '3' } }, js: { 'src/js/a.js': "import Alpine from 'alpinejs';" },
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
    const m = measure({ html: FIX_HTML, js: FIX_JS });
    const b = asBaseline(fixtureBaseline());
    assert.deepEqual(recordProblems(m, b, ['src/styles/a.css', 'src/styles/cards.css']),
      ['src/styles/cards.css: a new stylesheet; style with Tailwind and Flowbite Pro classes '
        + `(the one entry is ${TAILWIND_ENTRY})`]);
    assert.deepEqual(recordProblems(m, b, ['src/styles/a.css', TAILWIND_ENTRY]), []);
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
    { path: 'package.json', bytes: Buffer.from(`"url": "git+https://github.com/${PRO_MARKERS[1]}"`) },
  ], prints), [
    'vendor/flowbite-admin-dashboard-1.1.1/src/html/index.html: a path named like a licensed '
      + 'Flowbite Pro package',
    'assets/vendor/flowbite/app.js: a path named like a licensed Flowbite Pro package',
    `src/pages/copied.html: a licensed Flowbite Pro source file (fingerprint ${[...prints][0]})`,
    `docs/notes.md: carries ${PRO_MARKERS[0]}, a marker of the licensed Pro packages`,
    `package.json: carries ${PRO_MARKERS[1]}, a marker of the licensed Pro packages`,
  ]);
  assert.equal(fingerprint('small.js', Buffer.from('module.exports = {};')), null,
    'a file below the minimum is not fingerprinted');
});
