#!/usr/bin/env node
// OSCILLA build: esbuild bundles src/styles/main.css and src/js/main.js (IIFE), then
// pack-single-file.mjs assembles ONE static dist/index.html.
//
//   node scripts/build.mjs           write dist/index.html
//   node scripts/build.mjs --check   rebuild in memory; exit 1 if dist/index.html differs
//   node scripts/build.mjs --debug   unminified + inline source maps -> .debug/index.html
//
// Deterministic by construction: pinned esbuild, no timestamps, no absolute paths, sorted
// notices, LF output. dist/index.html is committed, so CI runs --check on every push.
//
// Provenance (scripts/release-metadata.mjs): the product version (package.json) and the source
// digest (sha256 over the build inputs) are compiled into the bundle as esbuild defines
// (__OSCILLA_VERSION__, __OSCILLA_SOURCE_DIGEST__, read by src/js/core/build-info.js) and
// written into ONE inline metadata region with commit null and channel "source", plus the
// top-of-file banner. No git state and no clock enter the file; the deploy stamp adds the
// commit later (scripts/stamp-build.mjs).
//
// Analysis Worker (gap M10): scripts/build-analysis-worker.mjs bundles the offline analysis into
// one Worker script first; its text enters the app bundle as the string define
// __OSCILLA_ANALYSIS_WORKER__ and is started at runtime from a data: URL (analysis-runner.js).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { pack } from './pack-single-file.mjs';
import { ANALYSIS_WORKER_DEFINE, buildAnalysisWorker } from './build-analysis-worker.mjs';
import {
  bannerComment, computeSourceDigest, readVersion, renderRegion, sourceRecord,
} from './release-metadata.mjs';
import {
  BUILD_TIME_ASSETS, CSS_ENTRY, DIST_HTML, JS_ENTRY, SRC_HTML, TARGETS, VENDOR_SCRIPTS,
} from './build-config.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const DEBUG = process.argv.includes('--debug');
const OUT = path.join(ROOT, DEBUG ? '.debug/index.html' : DIST_HTML);
const VERSION = readVersion(ROOT);
const SOURCE_DIGEST = computeSourceDigest(ROOT);

// ------------------------------------------------------------------------------- plugins
// `import text from './x.worklet.js?raw'` -> the file's text (minified when it is JS). Used for
// AudioWorklet processors, which are loaded at runtime from a data: URL, never from a file.
const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.join(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => {
      let text = readFileSync(args.path, 'utf8');
      if (args.path.endsWith('.js') && !DEBUG) {
        text = (await esbuild.transform(text, {
          minify: true, target: TARGETS, legalComments: 'none', charset: 'utf8',
        })).code;
      }
      return { contents: text, loader: 'text', watchFiles: [args.path] };
    });
  },
};

// `import p5 from 'p5'` -> window.p5, provided by the verbatim vendor <script>.
const vendorGlobalsPlugin = {
  name: 'vendor-globals',
  setup(build) {
    const byPkg = new Map(VENDOR_SCRIPTS.map((v) => [v.pkg, v.global]));
    const escaped = [...byPkg.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    build.onResolve({ filter: new RegExp(`^(${escaped.join('|')})$`) }, (args) => ({
      path: args.path, namespace: 'vendor-global',
    }));
    build.onLoad({ filter: /.*/, namespace: 'vendor-global' }, (args) => ({
      contents: `module.exports = window[${JSON.stringify(byPkg.get(args.path))}];`,
      loader: 'js',
    }));
  },
};

// ------------------------------------------------------------------------------- licences
function licenceText(pkg) {
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  const names = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license.txt', 'license', 'LICENCE'];
  for (const name of names) {
    const file = path.join(dir, name);
    if (existsSync(file)) return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
  }
  // Some tarballs (alpinejs) ship no licence file: keep the upstream text in licenses/.
  const local = path.join(ROOT, 'licenses', `${pkg.replace('/', '__')}.LICENSE`);
  if (existsSync(local)) return readFileSync(local, 'utf8').replace(/\r\n/g, '\n').trim();
  throw new Error(`no licence text for ${pkg}: add licenses/${pkg.replace('/', '__')}.LICENSE`);
}

const PKG_IN_PATH = /node_modules\/((?:@[^/]+\/)?[^/]+)\//;
const packageOf = (input) => (input.match(PKG_IN_PATH) || [])[1];

// Packages pre-bundled inside another package's dist (alpinejs ships @vue/reactivity and
// @vue/shared inlined). esbuild/rollup leave "// node_modules/<pkg>/…" path comments there.
function embeddedPackages(inputs) {
  const found = new Set();
  for (const input of inputs.filter((i) => PKG_IN_PATH.test(i))) {
    const text = readFileSync(path.join(ROOT, input), 'utf8');
    for (const m of text.matchAll(/^\/\/ node_modules\/((?:@[^/]+\/)?[^/]+)\//gm)) {
      if (m[1] !== packageOf(input)) found.add(m[1]);
    }
  }
  return [...found];
}

function notice(pkgs) {
  const vendorByPkg = new Map(VENDOR_SCRIPTS.map((v) => [v.pkg, v]));
  const sections = [...pkgs].sort().map((pkg) => {
    const meta = require(`${pkg}/package.json`);
    const vendor = vendorByPkg.get(pkg);
    const how = vendor
      ? `Embedded unmodified as <script data-vendor="${pkg}@${meta.version}">; it may be replaced `
        + `by any compatible build.\nSource: ${vendor.source.replace('{version}', meta.version)}`
      : 'Bundled (minified) into this file.';
    return `== ${pkg}@${meta.version} - ${meta.license}\n${how}\n\n${licenceText(pkg)}`;
  });
  return 'OSCILLA - third-party software contained in this file.\n\n'
    + sections.join('\n\n----------------------------------------------------------------\n\n');
}

// ------------------------------------------------------------------------------- build
const common = {
  absWorkingDir: ROOT,
  bundle: true,
  write: false,
  metafile: true,
  minify: !DEBUG,
  sourcemap: DEBUG ? 'inline' : false,
  sourcesContent: DEBUG,
  legalComments: 'none', // full licence texts are emitted once, in the notice comment
  charset: 'utf8',
  target: TARGETS,
  logLevel: 'warning',
};

async function buildCss() {
  const result = await esbuild.build({
    ...common,
    entryPoints: [CSS_ENTRY],
    outfile: 'out.css', // virtual (write: false); needed to name the output
    loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.png': 'dataurl' },
  });
  return { code: result.outputFiles[0].text.trim(), inputs: Object.keys(result.metafile.inputs) };
}

async function buildJs(worker) {
  const result = await esbuild.build({
    ...common,
    entryPoints: [JS_ENTRY],
    outfile: 'out.js',
    format: 'iife',
    platform: 'browser',
    // An IIFE has no import.meta: fail instead of silently getting `{}`.
    define: {
      'process.env.NODE_ENV': DEBUG ? '"development"' : '"production"',
      __OSCILLA_VERSION__: JSON.stringify(VERSION),
      __OSCILLA_SOURCE_DIGEST__: JSON.stringify(SOURCE_DIGEST),
      [ANALYSIS_WORKER_DEFINE]: JSON.stringify(worker.code),
    },
    plugins: [rawPlugin, vendorGlobalsPlugin],
  });
  const warnings = result.warnings.filter((w) => /import\.meta/.test(w.text));
  if (warnings.length) throw new Error(`import.meta used in an IIFE bundle: ${warnings[0].text}`);
  return { code: result.outputFiles[0].text.trim(), inputs: Object.keys(result.metafile.inputs) };
}

async function main() {
  const t0 = performance.now();
  const worker = await buildAnalysisWorker({ root: ROOT, minify: !DEBUG });
  const [css, js] = await Promise.all([buildCss(), buildJs(worker)]);
  const vendors = VENDOR_SCRIPTS.map(({ pkg, file }) => ({
    id: `${pkg}@${require(`${pkg}/package.json`).version}`,
    code: readFileSync(require.resolve(file), 'utf8').replace(/\r\n/g, '\n').trim(),
  }));
  const pkgs = new Set([
    ...css.inputs.map(packageOf), ...js.inputs.map(packageOf), ...embeddedPackages(js.inputs),
    ...VENDOR_SCRIPTS.map((v) => v.pkg), ...BUILD_TIME_ASSETS,
  ].filter(Boolean));

  const html = pack({
    template: readFileSync(path.join(ROOT, SRC_HTML), 'utf8').replace(/\r\n/g, '\n'),
    css: css.code,
    js: js.code,
    vendors,
    notice: notice(pkgs),
    banner: bannerComment(VERSION),
    buildInfo: renderRegion(sourceRecord({ version: VERSION, sourceDigest: SOURCE_DIGEST })),
  });

  const rel = path.relative(ROOT, OUT);
  if (CHECK) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== html) {
      console.error(`${rel} is stale or not reproducible: run "npm run build" and commit it`);
      process.exit(1);
    }
    console.log(`${rel} is up to date (${html.length} bytes; v${VERSION}, `
      + `source ${SOURCE_DIGEST.slice(0, 12)})`);
    return;
  }
  rmSync(path.dirname(OUT), { recursive: true, force: true });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  console.log(`analysis worker: ${(Buffer.byteLength(worker.code) / 1024).toFixed(1)} KiB from `
    + `${worker.inputs.length} modules (data: URL Worker)`);
  console.log(`built ${rel}: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB in `
    + `${(performance.now() - t0).toFixed(0)} ms; v${VERSION}, source ${SOURCE_DIGEST}; `
    + `contains ${[...pkgs].sort().join(', ')}`);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
