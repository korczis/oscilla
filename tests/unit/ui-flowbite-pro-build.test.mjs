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
//     F001 sizes.
//   node --test tests/unit/ui-flowbite-pro-build.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const DIST = 'dist/index.html';
const CONFIG = 'tailwind.config.cjs';
const ENTRY = 'src/styles/tailwind.css';
const COMPONENTS = ['collapse', 'drawer', 'dropdown', 'tabs', 'tooltip'];
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
  const css = styles[0];
  const cut = css.lastIndexOf('\n');
  assert.ok(cut > 0, 'the <style> holds the legacy CSS, a line break, then the Tailwind CSS');
  return { html, legacy: css.slice(0, cut), tailwind: css.slice(cut + 1) };
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

async function compileTailwind(config, from = path.join(ROOT, ENTRY)) {
  const postcss = require('postcss');
  const tailwindcss = require('tailwindcss');
  const result = await postcss([tailwindcss(config)]).process(read(ENTRY), { from });
  return result.css;
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
    assert.ok(/\.dark\\:bg-opacity-80:where\(\[data-theme=["']?dark["']?\]/.test(tailwind),
      'the dark variant matches [data-theme="dark"]');
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
    const config = require(path.join(ROOT, CONFIG));
    const forms = await compileTailwind({
      ...config, content: [{ raw: '<p class="hidden"></p>' }], safelist: [],
      plugins: [require('flowbite/plugin')({ forms: true })],
    });
    const found = bareFormSelectors(forms);
    assert.ok(found.some((s) => /^\[type=/.test(s)), `forms: true has [type] rules: ${found}`);
    assert.ok(found.some((s) => /^select\b/.test(s)), 'and select rules');
    assert.deepEqual(bareFormSelectors('.osc-x input.osc-y{a:b}[data-type=x]{a:b}'), []);
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
