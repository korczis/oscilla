// Issue F001 (ADR 0061, rule project.ui-uses-flowbite-pro): Tailwind and flowbite are compiled
// at build time into the one dist/index.html, so the file stays self-contained (ADR 0012).
//   - package.json pins tailwindcss 3.4.x, postcss and flowbite 2.5.x exactly, as build-time
//     (dev) dependencies;
//   - tailwind.config.cjs carries the Pro theme of the flowbite-pro reference, section 0
//     (primary = the Tailwind blue scale, Inter first and then the system stack, no font
//     downloaded, transitionProperty width, the shell's safelist), darkMode on
//     [data-theme="dark"], preflight off, the flowbite plugin with forms: false;
//   - src/styles/tailwind.css holds at-rules only, scripts/build.mjs compiles it through
//     Tailwind's PostCSS API, and the config and the entry are inputs of the source digest;
//   - dist/index.html carries the compiled Tailwind after the legacy CSS in the one <style>,
//     with the theme, the dark selector and the safelist, without preflight and without a
//     flowbite rule for a bare input, select, textarea, [type] or [multiple] selector (a
//     fixture compile with forms: true shows that check finds them);
//   - the app script carries the five flowbite components the shell uses (drawer, dropdown,
//     collapse, tooltip, tabs) and no other, started on 'alpine:initialized';
//   - the notice names flowbite and tailwindcss (MIT), and verify-dist refuses a dist that
//     lacks a build-time package's notice;
//   - npm run build:check reproduces dist, and dist is within BUDGET, whose comment states the
//     F001 sizes;
//   - the two parts of the <style> are split on TAILWIND_BOUNDARY, which pack() emits once and
//     refuses inside either part;
//   - the plugin's hard-coded .dark ancestor is rewritten to [data-theme="dark"], the selector
//     OSCILLA sets (it never sets class="dark");
//   - no class the legacy CSS styles is also a class the compiled Tailwind defines, because the
//     Tailwind part follows it in the cascade and would win silently;
//   - verify-dist examines every url() the plugin emits (forms: true included) and finds data:
//     URLs only;
//   - every class the five bundled components add at run time (their Default class options,
//     their classList literals and the drawer's placement classes, read from their own source
//     under node_modules/flowbite) is defined in the compiled Tailwind, because the content
//     globs scan exactly those five files (review #253, R-1).
//
// Order: this PR lands only after #250 (ADR 0061, rule project.ui-uses-flowbite-pro and the
// ratchet tests/unit/ui-flowbite-pro.test.mjs), which this file and src/js/ui/flowbite.js cite.
//   node --test tests/unit/ui-flowbite-pro-build.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pack, splitStyle, TAILWIND_BOUNDARY } from '../../scripts/pack-single-file.mjs';
import { darkThemeSelector } from '../../scripts/build-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const DIST = 'dist/index.html';
const CONFIG = 'tailwind.config.cjs';
const ENTRY = 'src/styles/tailwind.css';
const COMPONENTS = ['collapse', 'drawer', 'dropdown', 'tabs', 'tooltip'];
const COMPONENT_DIR = 'node_modules/flowbite/lib/esm/components';
const INITIALISERS = ['initCollapses', 'initDrawers', 'initDropdowns', 'initTabs', 'initTooltips'];
// The initialisers of every other flowbite component: none of them may reach the bundle.
const OTHER_INITIALISERS = ['initAccordions', 'initCarousels', 'initCopyClipboards',
  'initDatepickers', 'initDials', 'initDismisses', 'initInputCounters', 'initModals',
  'initPopovers'];

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const installed = (pkg) => require(`${pkg}/package.json`).version;

/** The one <style> of dist and its two parts: the legacy CSS, then the compiled Tailwind. */
function distStyle() {
  const html = read(DIST);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.equal(styles.length, 1, 'dist has exactly one <style>');
  const { legacy, tailwind } = splitStyle(styles[0]);
  assert.ok(legacy && tailwind, 'the <style> holds the legacy CSS, then the Tailwind CSS');
  return { html, legacy, tailwind };
}

/** The class names a stylesheet's selectors name (unescaped). */
function classesOf(css) {
  const out = new Set();
  for (const sel of selectorsOf(css)) {
    for (const m of sel.matchAll(/\.((?:[\w-]|\\.)+)/g)) out.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** Every selector of a stylesheet (the comma-separated parts of each rule prelude). */
function selectorsOf(css) {
  const out = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    let depth = 0;
    let part = '';
    for (const c of prelude) {
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      if (c === ',' && depth === 0) { out.push(part.trim()); part = ''; } else part += c;
    }
    out.push(part.trim());
  }
  return out;
}

/**
 * Selectors that style a form control by element or attribute alone: a compound whose subject
 * names input, select or textarea without a class, or a bare [type] or [multiple].
 */
function bareFormSelectors(css) {
  return selectorsOf(css).filter((sel) => sel.split(/\s*[\s>+~]\s*/).some((compound) => (
    /^(?:input|select|textarea)(?![\w-])(?![^.]*\.)/i.test(compound)
    || /^\[(?:type|multiple)\b/i.test(compound))));
}

async function compileTailwind(config, { from = path.join(ROOT, ENTRY), dark = false } = {}) {
  const postcss = require('postcss');
  const tailwindcss = require('tailwindcss');
  const plugins = [tailwindcss(config), ...(dark ? [darkThemeSelector()] : [])];
  const result = await postcss(plugins).process(read(ENTRY), { from });
  return result.css;
}

/**
 * Every class a bundled flowbite component adds at run time, read from its own source: the
 * class options of its Default (backdropClasses, activeClasses, inactiveClasses, edgeOffset),
 * the literal arguments of its classList.add / classList.remove calls, and the drawer's
 * placement classes (base, active, inactive).
 * @returns {Map<string, string[]>} component -> its classes
 */
function componentClasses() {
  const out = new Map();
  for (const name of COMPONENTS) {
    const src = read(`${COMPONENT_DIR}/${name}/index.js`);
    const strings = [];
    const literals = (list) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const defaults = src.match(/^var Default = \{([\s\S]*?)^\};$/m);
    assert.ok(defaults, `${name}: its Default options are found`);
    for (const m of defaults[1].matchAll(/^\s*(\w+):\s*'([^']*)',?$/gm)) {
      if (/Classes$/.test(m[1]) || m[1] === 'edgeOffset') strings.push(m[2]);
    }
    for (const m of src.matchAll(/\.classList\.(?:add|remove)\(([^)]*)\)/g)) {
      strings.push(...literals(m[1]));
    }
    for (const m of src.matchAll(/^\s*(?:base|active|inactive):\s*\[([^\]]*)\]/gm)) {
      strings.push(...literals(m[1]));
    }
    out.set(name, [...new Set(strings.flatMap((s) => s.split(/\s+/)).filter(Boolean))].sort());
  }
  return out;
}

/** A .dark class selector (not the escaped dark: variant class, e.g. .dark\:bg-gray-900\/80). */
const DARK_CLASS = /\.dark(?![\w\\-])/;

/** The flowbite plugin with its form base styles on, compiled with the shipped config. */
async function compileForms(opts) {
  const config = require(path.join(ROOT, CONFIG));
  return compileTailwind({
    ...config, content: [{ raw: '<p class="hidden"></p>' }], safelist: [],
    plugins: [require('flowbite/plugin')({ forms: true })],
  }, opts);
}

test('package.json pins tailwindcss 3.4, postcss and flowbite 2.5 exactly, at build time', () => {
  const pkg = JSON.parse(read('package.json'));
  const dev = pkg.devDependencies || {};
  assert.match(dev.tailwindcss || '', /^3\.4\.\d+$/, 'tailwindcss: an exact 3.4.x devDependency');
  assert.match(dev.flowbite || '', /^2\.5\.\d+$/, 'flowbite: an exact 2.5.x devDependency');
  assert.match(dev.postcss || '', /^\d+\.\d+\.\d+$/, 'postcss: an exact devDependency');
  for (const name of ['tailwindcss', 'flowbite', 'postcss']) {
    assert.equal((pkg.dependencies || {})[name], undefined, `${name} is not a runtime dependency`);
    assert.equal(installed(name), dev[name], `${name}: installed version is the pin`);
  }
});

test('tailwind.config.cjs carries the Pro theme, the data-theme dark mode and no preflight',
  () => {
    const config = require(path.join(ROOT, CONFIG));
    assert.deepEqual(config.darkMode, ['selector', '[data-theme="dark"]']);
    assert.equal(config.corePlugins && config.corePlugins.preflight, false, 'preflight is off');
    const files = Array.isArray(config.content) ? config.content : config.content.files;
    assert.ok(config.content.relative === true, 'content globs resolve from the config file');
    assert.ok(files.includes('./src/index.html'), 'content: src/index.html');
    assert.ok(files.some((f) => /^\.\/src\/js\/\*\*\/\*\.js$/.test(f)), 'content: src/js');
    for (const cls of ['lg:w-16', 'lg:ml-16', 'lg:hidden', 'lg:absolute', 'w-64', 'pl-11']) {
      assert.ok(config.safelist.includes(cls), `safelist: ${cls}`);
    }
    assert.deepEqual(config.safelist.filter((c) => /opacity/.test(c)), [],
      'no flowbite 1 bg-opacity-* classes: flowbite 2.5 writes bg-gray-900/50');
    assert.deepEqual(files.filter((f) => f.includes('node_modules')),
      [`./${COMPONENT_DIR}/{${['drawer', 'dropdown', 'collapse', 'tooltip', 'tabs']}}/index.js`],
      'content: exactly the five bundled components, nothing else of node_modules');
    assert.equal(config.plugins.length, 1, 'one plugin: flowbite');
    assert.deepEqual(config.plugins[0].__options, { forms: false },
      'the flowbite plugin runs with forms: false');
    assert.equal(config.plugins[0].handler.toString(),
      require('flowbite/plugin')({ forms: false }).handler.toString(), 'it is flowbite/plugin');
    assert.match(read(CONFIG), /\bplugins\s*:\s*\[\s*require\('flowbite\/plugin'\)/);

    const theme = require('tailwindcss/resolveConfig')(config).theme;
    const blue = require('tailwindcss/colors').blue;
    for (const shade of Object.keys(blue)) {
      assert.equal(theme.colors.primary[shade], blue[shade], `primary-${shade} is Tailwind blue`);
    }
    assert.equal(theme.colors.gray['200'].toLowerCase(), '#e5e7eb', 'the gray surface palette');
    assert.equal(theme.fontFamily.sans[0], 'Inter', 'Inter leads the sans stack');
    const system = read('src/styles/tokens.css').match(/--osc-font:\s*([^;]+);/)[1]
      .split(',').map((s) => s.trim());
    assert.deepEqual(theme.fontFamily.sans.slice(1), system, 'then the existing system stack');
    assert.equal(theme.transitionProperty.width, 'width', 'transitionProperty width');
  });

test('the Tailwind entry holds at-rules only and the build compiles it through PostCSS', () => {
  const entry = stripCssComments(read(ENTRY)).trim();
  assert.ok(entry.length > 0, `${ENTRY} is not empty`);
  for (const line of entry.split('\n').map((l) => l.trim()).filter(Boolean)) {
    assert.match(line, /^@tailwind (?:base|components|utilities);$/, `${ENTRY}: ${line}`);
  }
  const build = read('scripts/build.mjs');
  assert.match(build, /^import postcss from 'postcss';$/m, 'build.mjs imports postcss');
  assert.match(build, /^import tailwindcss from 'tailwindcss';$/m, 'build.mjs imports Tailwind');
  const config = read('scripts/build-config.mjs');
  assert.match(config, new RegExp(`TAILWIND_ENTRY = '${ENTRY}'`));
  assert.match(config, new RegExp(`TAILWIND_CONFIG = '${CONFIG.replace('.', '\\.')}'`));
});

test('the Tailwind config and entry are inputs of the source digest', async () => {
  const { listSourceInputs } = await import('../../scripts/release-metadata.mjs');
  const inputs = listSourceInputs(ROOT);
  assert.ok(inputs.includes(CONFIG), `${CONFIG} is a build input`);
  assert.ok(inputs.includes(ENTRY), `${ENTRY} is a build input`);
});

test('dist carries the compiled Tailwind after the legacy CSS, with the theme and safelist',
  () => {
    const { legacy, tailwind } = distStyle();
    assert.ok(tailwind.startsWith('*,:before,:after{--tw-'),
      'the Tailwind part starts with its base (variable defaults), after the legacy CSS');
    assert.ok(!/--tw-/.test(legacy), 'no Tailwind output inside the legacy part');
    assert.ok(/\.osc-/.test(legacy), 'the legacy part is the OSCILLA stylesheet');
    assert.ok(/@media\s*\(min-width:\s*1024px\)\s*\{(?:[^{}]*\{[^{}]*\})*?[^{}]*\.lg\\:w-16\{width:4rem\}/
      .test(tailwind), 'safelisted lg:w-16 at the lg breakpoint');
    for (const cls of ['lg\\:ml-16', 'lg\\:hidden', 'lg\\:absolute', 'w-64', 'pl-11']) {
      assert.ok(tailwind.includes(`.${cls}{`), `safelisted .${cls}`);
    }
    assert.ok(/\.dark\\:bg-gray-900\\\/80:where\(\[data-theme=["']?dark["']?\]/.test(tailwind),
      'the dark variant (the drawer backdrop\'s) matches [data-theme="dark"]');
    assert.ok(!/prefers-color-scheme/.test(tailwind), 'dark mode is never the media query');
    assert.ok(/\.tooltip-arrow/.test(tailwind), 'the flowbite plugin base (tooltip arrows) is in');
    // Preflight would reset html, body, headings, buttons and form controls.
    assert.ok(!/(?:^|[},])html,:host\{|-webkit-text-size-adjust:100%/.test(tailwind),
      'no preflight');
    assert.ok(!/@import|url\((?!\s*["']?data:)/.test(tailwind), 'no import and no remote url()');
    assert.ok(!/@font-face|fonts\.googleapis/.test(tailwind), 'no font is downloaded');
  });

test('the built CSS carries no flowbite rule for a bare input, select or [type] selector',
  async () => {
    const { tailwind } = distStyle();
    assert.deepEqual(bareFormSelectors(tailwind), [], 'no bare form-control selector');
    // The check bites: the same plugin with its form base styles on produces such rules.
    const forms = await compileForms();
    const found = bareFormSelectors(forms);
    assert.ok(found.some((s) => /^\[type=/.test(s)), `forms: true has [type] rules: ${found}`);
    assert.ok(found.some((s) => /^select\b/.test(s)), 'and select rules');
    assert.deepEqual(bareFormSelectors('.osc-x input.osc-y{a:b}[data-type=x]{a:b}'), []);
  });

test('the <style> parts are split on TAILWIND_BOUNDARY, which pack() emits exactly once', () => {
  const template = '<!doctype html><html><head><!-- @inline-css --></head><body>'
    + '<!-- @inline-js --></body></html>';
  const base = { template, js: '1', icon: () => '' };
  const one = pack({ ...base, css: 'a{b:c}', tailwind: '.x{y:z}' })
    .match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.deepEqual(splitStyle(one), { legacy: 'a{b:c}', tailwind: '.x{y:z}' });
  // An unminified (--debug) build keeps line breaks: the split does not depend on them.
  const debug = pack({ ...base, css: 'a {\n  b: c;\n}\n', tailwind: '.x {\n  y: z;\n}\n' })
    .match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.deepEqual(splitStyle(debug),
    { legacy: 'a {\n  b: c;\n}\n', tailwind: '.x {\n  y: z;\n}\n' });
  assert.deepEqual(splitStyle('a{b:c}'), { legacy: 'a{b:c}', tailwind: '' }, 'no Tailwind part');
  assert.throws(() => splitStyle(`a${TAILWIND_BOUNDARY}b${TAILWIND_BOUNDARY}c`), /boundary/);
  assert.throws(() => pack({ ...base, css: `a${TAILWIND_BOUNDARY}`, tailwind: 'b' }), /boundary/);
  assert.throws(() => pack({ ...base, css: 'a', tailwind: `${TAILWIND_BOUNDARY}b` }), /boundary/);
});

test('the plugin\'s .dark ancestor is rewritten to the data-theme selector OSCILLA sets',
  async () => {
    const { tailwind } = distStyle();
    assert.ok(!DARK_CLASS.test(tailwind), 'no .dark class selector in the Tailwind part');
    assert.match(tailwind, /\[data-theme=["']?dark["']?\] \[role=tooltip\]>\[data-popper-arrow\]/,
      'the tooltip arrow\'s dark rule follows data-theme');
    // The plugin does hard-code .dark, and with forms: true on many more rules (F002).
    const raw = await compileForms();
    assert.ok(DARK_CLASS.test(raw), 'the plugin emits .dark selectors');
    const fixed = await compileForms({ dark: true });
    assert.ok(!DARK_CLASS.test(fixed), 'darkThemeSelector rewrites every one of them');
    assert.match(fixed, /\[data-theme="dark"\] \[type=['"]?checkbox/, 'the form rules too');
    assert.ok(/\.dark\\:bg-gray-900\\\/80/.test(tailwind), 'the dark: variant class is untouched');
  });

test('no class the legacy CSS styles is a class the compiled Tailwind defines', () => {
  const { legacy, tailwind } = distStyle();
  const utilities = classesOf(tailwind);
  assert.ok(utilities.has('lg:w-16') && utilities.has('tooltip-arrow'),
    'classesOf reads the utilities');
  const shared = [...classesOf(legacy)].filter((c) => utilities.has(c));
  assert.deepEqual(shared, [], 'a legacy class of the same name would lose to the utility');
});

test('verify-dist examines every url() the plugin emits and finds data: URLs only', async () => {
  const { cssReferences } = await import('../../scripts/verify-dist.mjs');
  const forms = await compileForms({ dark: true });
  const refs = cssReferences(forms);
  assert.ok(refs.unparsed === 0, 'every url( parses');
  assert.equal(refs.urls.length, (forms.match(/url\(/g) || []).length, 'every url( is examined');
  assert.ok(refs.urls.length > 0 && refs.urls.every((u) => /^data:image\/svg\+xml,/.test(u)),
    `the plugin's url()s are data: SVGs: ${refs.urls.map((u) => u.slice(0, 30))}`);
  assert.ok(refs.urls.some((u) => u.includes("'")), 'with the other quote inside');
  const { tailwind } = distStyle();
  assert.deepEqual(cssReferences(tailwind).urls.filter((u) => !/^data:/.test(u)), []);
});

test('every class the bundled components add at run time is in the compiled Tailwind', () => {
  const { tailwind } = distStyle();
  const defined = classesOf(tailwind);
  const classes = componentClasses();
  for (const name of COMPONENTS) {
    assert.ok(classes.get(name).length > 0, `${name}: its run-time classes are read`);
  }
  const all = new Set([...classes.values()].flat());
  // The ones the review names (R-1): the scan reads them, so the check is not vacuous.
  for (const cls of ['bg-gray-900/50', 'dark:bg-gray-900/80', 'fixed', 'inset-0', 'z-30',
    'transition-transform', '-translate-x-full', 'transform-none', 'overflow-hidden',
    'bottom-[60px]', 'opacity-0', 'opacity-100', 'invisible', 'visible', 'hidden', 'block',
    'text-blue-600', 'hover:text-blue-600', 'dark:border-transparent',
    'hover:border-gray-300', 'dark:hover:text-gray-300']) {
    assert.ok(all.has(cls), `the scan reads ${cls}`);
  }
  for (const name of COMPONENTS) {
    const missing = classes.get(name).filter((c) => !defined.has(c));
    assert.deepEqual(missing, [], `${name}: every run-time class is compiled`);
  }
});

test('the app script carries the five flowbite components, started after Alpine', () => {
  const src = read('src/js/ui/flowbite.js');
  const imports = [...src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)';$/gm)];
  assert.deepEqual(imports.map((m) => m[2]).sort(),
    COMPONENTS.map((c) => `flowbite/lib/esm/components/${c}`), 'exactly the five components');
  assert.deepEqual(imports.map((m) => m[1].trim()).sort(), INITIALISERS);
  assert.ok(!/from\s+'flowbite'/.test(src), 'never the whole flowbite index');

  const main = read('src/js/main.js');
  assert.match(main, /^import \{ startFlowbiteAfterAlpine \} from '\.\/ui\/flowbite\.js';$/m);
  const start = main.indexOf('\nstartFlowbiteAfterAlpine();');
  assert.ok(start > 0 && start < main.indexOf('\nAlpine.start();'),
    'main.js registers flowbite before Alpine.start()');

  // flowbite's ESM build is not loadable by Node (extensionless imports), so this reads it.
  assert.match(src, /\.addEventListener\('alpine:initialized', initFlowbite, \{ once: true \}\)/,
    'the components start once, on alpine:initialized');
  const table = src.match(/FLOWBITE_COMPONENTS = Object\.freeze\(\{([^}]+)\}\)/);
  assert.ok(table, 'flowbite.js lists its components in FLOWBITE_COMPONENTS');
  assert.deepEqual([...table[1].matchAll(/(\w+):\s*(\w+)/g)].map((m) => m[1]).sort(), COMPONENTS);
  assert.deepEqual([...table[1].matchAll(/(\w+):\s*(\w+)/g)].map((m) => m[2]).sort(),
    INITIALISERS);

  const { html } = distStyle();
  const app = html.match(/<script data-app>([\s\S]*?)<\/script>/)[1];
  for (const name of INITIALISERS) assert.ok(app.includes(name), `the bundle has ${name}`);
  for (const name of OTHER_INITIALISERS) assert.ok(!app.includes(name), `no ${name}`);
});

test('the notice names flowbite and tailwindcss (MIT); verify-dist requires it', async () => {
  const { html } = distStyle();
  const head = html.slice(0, html.search(/<html[\s>]/i));
  for (const pkg of ['flowbite', 'tailwindcss']) {
    assert.ok(head.includes(`== ${pkg}@${installed(pkg)} - MIT\n`), `notice: ${pkg} (MIT)`);
  }
  const { verifyHtml, buildTimeNotices } = await import('../../scripts/verify-dist.mjs');
  const notices = buildTimeNotices();
  for (const pkg of ['flowbite', 'tailwindcss']) {
    assert.ok(notices.includes(`${pkg}@${installed(pkg)}`), `verify-dist requires ${pkg}`);
  }
  const doc = (notice) => `<!doctype html>\n<!--\n${notice}\n-->\n<html><head>`
    + '<meta charset="utf-8"><style>a{b:c}</style></head><body>'
    + '<script data-app>1</script></body></html>';
  const budget = { rawBytes: 1e6, gzipBytes: 1e6 };
  assert.deepEqual(verifyHtml(doc('== tw@1.0.0 - MIT'), { budget, notices: ['tw@1.0.0'] })
    .problems, []);
  assert.deepEqual(verifyHtml(doc('none'), { budget, notices: ['tw@1.0.0'] }).problems,
    ['third-party notice for tw@1.0.0 missing']);
});

test('npm run build:check reproduces dist byte for byte', () => {
  const r = spawnSync(process.execPath, ['scripts/build.mjs', '--check'], {
    cwd: ROOT, encoding: 'utf8', timeout: 170_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `build --check: ${r.error || ''}${r.stdout}${r.stderr}`);
});

test('dist is within BUDGET, and the BUDGET comment states the F001 sizes', async () => {
  const { BUDGET } = await import('../../scripts/build-config.mjs');
  const html = readFileSync(path.join(ROOT, DIST));
  assert.ok(html.length <= BUDGET.rawBytes, `raw ${html.length} <= ${BUDGET.rawBytes}`);
  const gzip = gzipSync(html, { level: 9 }).length;
  assert.ok(gzip <= BUDGET.gzipBytes, `gzip ${gzip} <= ${BUDGET.gzipBytes}`);
  const comment = read('scripts/build-config.mjs').split('export const BUDGET')[0];
  assert.match(comment, /F001[\s\S]*before[\s\S]*B raw[\s\S]*B gzip[\s\S]*after/,
    'the BUDGET comment states the size before and after F001');
});
