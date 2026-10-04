// One copy of the offline analysis in dist/index.html (ADR 0026, resolution note of 2026-10-04):
// the analysis library (scripts/build-analysis-worker.mjs) is the one <script data-analysis>
// that runs on the page AND is the Worker's script; the app bundle imports it through the
// library's global and carries no copy. Checked:
//   - the committed dist: one library element, before the app; every marker literal below (one
//     distinctive error message per large analysis module, unique in src/) appears in dist
//     exactly once, inside the library and not in the app. A second bundled copy of the analysis
//     (the pre-resolution Worker string, or the modules bundled into the app again) repeats them;
//     string literals survive minification, identifiers do not, hence literals as markers;
//   - bundleWithAnalysisLibrary: the page bundle has no analysis module and imports only what
//     the library exposes, a page bundle that bundles an analysis module anyway fails the build,
//     a pass 2 that uses an export pass 1 did not see fails the build, and a page without the
//     library script fails at boot with a clear error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

import {
  ANALYSIS_LIBRARY_GLOBAL, bundleWithAnalysisLibrary, scanAnalysisLibrary,
} from '../../scripts/build-analysis-worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');

// [module, literal]: an error message that exists once in src/ and only in that module.
const MARKERS = [
  ['src/js/measurement/analysis-task.js',
    'message.captures must be a non-empty array of Float32Array'],
  ['src/js/measurement/transfer.js', 'alignment must be an align() result'],
  ['src/js/measurement/align.js', 'align needs a sample rate'],
  ['src/js/measurement/impulse-response.js',
    'inverse must have the stimulus length (time-reversed sweep)'],
  ['src/js/measurement/aggregate.js', 'aggregateRuns needs at least one run'],
  ['src/js/measurement/smoothing.js', 'mask must have the length of frequencies'],
];

const count = (text, needle) => text.split(needle).length - 1;

function srcFiles(dir = path.join(ROOT, 'src', 'js')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? srcFiles(path.join(dir, e.name))
    : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

function scripts(html) {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ attrs: m[1].trim(), text: m[2] }));
}

test('markers are distinctive: each is in its library module once, nowhere else', async () => {
  const { inputs } = await scanAnalysisLibrary();
  const files = srcFiles();
  for (const [module, literal] of MARKERS) {
    assert.ok(inputs.includes(module), `${module} is a library module`);
    const hits = files.map((f) => [path.relative(ROOT, f).split(path.sep).join('/'),
      count(readFileSync(f, 'utf8'), literal)]).filter(([, n]) => n > 0);
    assert.deepEqual(hits, [[module, 1]], literal);
  }
});

test('dist: one analysis library script, before the app script', () => {
  const list = scripts(DIST).filter((s) => !/type="application\/json"/.test(s.attrs));
  const order = list.map((s) => s.attrs.split(/\s|=/)[0]);
  assert.deepEqual(order.slice(-2), ['data-analysis', 'data-app']);
  assert.equal(order.filter((a) => a === 'data-analysis').length, 1);
  const lib = list.find((s) => s.attrs === 'data-analysis').text;
  assert.ok(lib.includes(`globalThis.${ANALYSIS_LIBRARY_GLOBAL}=`), 'assigns the global');
  assert.ok(lib.includes('document.currentScript'), 'captures its own text for the Worker');
});

test('dist: the analysis code is embedded exactly once (in the library, not in the app)', () => {
  const list = scripts(DIST);
  const lib = list.find((s) => s.attrs === 'data-analysis').text;
  const app = list.find((s) => s.attrs === 'data-app').text;
  for (const [module, literal] of MARKERS) {
    assert.equal(count(DIST, literal), 1, `${module}: "${literal}" in dist`);
    assert.equal(count(lib, literal), 1, `${module}: "${literal}" in the library`);
    assert.equal(count(app, literal), 0, `${module}: "${literal}" in the app`);
  }
  // The app neither embeds a Worker script string nor bundles the Worker entry itself.
  assert.equal(count(app, 'WorkerGlobalScope'), 0);
  assert.equal(count(lib, 'WorkerGlobalScope') > 0, true);
});

// ----------------------------------------------------------------- bundleWithAnalysisLibrary
const ENTRY = `
import { analyzeInline } from './measurement/analysis-task.js';
import { nextPowerOfTwo, ZERO_POWER_DB } from './measurement/transfer.js';
globalThis.out = { analyzeInline, n: nextPowerOfTwo(1000), floor: ZERO_POWER_DB };
`;
const pageBuild = (contents, extra = {}) => (plugin) => esbuild.build({
  stdin: { contents, resolveDir: path.join(ROOT, 'src', 'js'), sourcefile: 'page.js' },
  bundle: true, write: false, metafile: true, format: 'iife', logLevel: 'silent',
  plugins: plugin ? [plugin] : [], ...extra,
});

test('bundleWithAnalysisLibrary: the page imports exactly what it uses from it', async () => {
  const { library, result } = await bundleWithAnalysisLibrary({ bundle: pageBuild(ENTRY) });
  assert.deepEqual(library.modules, {
    'src/js/measurement/analysis-task.js': ['analyzeInline'],
    'src/js/measurement/transfer.js': ['ZERO_POWER_DB', 'nextPowerOfTwo'],
  });
  const page = result.outputFiles[0].text;
  assert.ok(!Object.keys(result.metafile.inputs).some((i) => library.inputs.includes(i)));
  for (const [, literal] of MARKERS) assert.equal(count(page, literal), 0, literal);
  // Library then page, in one realm: the page's functions are the library's.
  const ctx = vm.createContext({});
  vm.runInContext(library.code, ctx);
  vm.runInContext(page, ctx);
  const lib = ctx[ANALYSIS_LIBRARY_GLOBAL];
  assert.equal(ctx.out.analyzeInline,
    lib.modules['src/js/measurement/analysis-task.js'].analyzeInline);
  assert.equal(ctx.out.n, 1024);
  assert.equal(lib.source, null, 'no document: no script text');
});

test('bundleWithAnalysisLibrary: a page bundle that bundles an analysis module fails', async () => {
  // A bundle that ignores the plugin bundles the analysis modules itself.
  const bundle = (plugin) => pageBuild(ENTRY)(plugin.name === 'analysis-library' ? null : plugin);
  await assert.rejects(bundleWithAnalysisLibrary({ bundle }), /bundled twice/);
});

test('bundleWithAnalysisLibrary: an export pass 1 did not see fails the build', async () => {
  let pass = 0;
  const more = `${ENTRY}import { welch } from './measurement/spectrum.js';\n`
    + 'globalThis.w = welch;\n';
  const bundle = (plugin) => pageBuild((pass++ === 0) ? ENTRY : more)(plugin);
  await assert.rejects(bundleWithAnalysisLibrary({ bundle }), /does not expose/);
});

test('a page bundle without the library script fails at boot with a clear error', async () => {
  const { result } = await bundleWithAnalysisLibrary({ bundle: pageBuild(ENTRY) });
  assert.throws(() => vm.runInContext(result.outputFiles[0].text, vm.createContext({})),
    /analysis library script did not run/);
});
