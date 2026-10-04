// Build sub-step: the analysis library, ONE copy of the offline analysis that runs both on the
// page and in the analysis Worker (gap M10; ADR 0026, resolution note of 2026-10-04).
//
// The library is the closure of src/js/measurement/analysis-worker.js (analysis-task.js and its
// pure dependencies: align, transfer, impulse response, aggregate, spectrum, smoothing, fft,
// ...). esbuild bundles it into ONE classic script (IIFE) that assigns the global
// globalThis[ANALYSIS_LIBRARY_GLOBAL] = { modules, source }:
//   modules  { [repository path]: { [export]: value } }: the exports of the closure the page
//            bundle uses, keyed by module ("src/js/measurement/transfer.js");
//   source   on the page, the text of the <script> element the library ran from
//            (document.currentScript.text, read while it runs); null in a Worker.
// pack-single-file.mjs places that script as <script data-analysis> between the vendor scripts
// and the app script. The app is bundled by bundleWithAnalysisLibrary():
//   pass 1  the app with every library export replaced by a pure marker call: esbuild's tree
//           shaking leaves exactly the markers of the exports the app uses;
//   library the closure with the Worker entry plus those exports (tree-shaken like any bundle);
//   pass 2  the app with analysisLibraryPlugin: every import of a library module resolves to
//           that module's entry in the global, so the app bundle carries none of the analysis
//           code (build.mjs also checks its inputs).
// analysis-runner.js starts the Worker from a data: URL of `source`, the very text the page
// executed; inside the Worker the same script runs and the entry guard of analysis-worker.js (a
// WorkerGlobalScope) serves the analysis. Nothing is written to disk and nothing is loaded from
// a path: dist/index.html stays the only runtime file (rule project.single-file-deliverable),
// and the analysis code is in it exactly once.
//
// Deterministic like the main build: pinned esbuild, no timestamps, no absolute paths (inputs
// are relative to the repository root, sorted), no source map. The library may not import
// packages (their licence notices would have to be added) and may not use import.meta; both
// fail the build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { TARGETS } from './build-config.mjs';

export const ANALYSIS_WORKER_ENTRY = 'src/js/measurement/analysis-worker.js';
/** The global the library assigns; analysis-runner.js reads the same name. */
export const ANALYSIS_LIBRARY_GLOBAL = '__oscillaAnalysis';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMESPACE = 'oscilla-analysis-library';
const ROOT_MODULE = `${NAMESPACE}:root`;
const ENTRY_NAME = '<analysis-library>'; // the generated library entry (stdin)
const USED = 'oscilla-analysis-used:'; // pass-1 marker literal: USED + path + '#' + export
const UNUSED = 'oscilla-analysis-unused:'; // pass-2 placeholder literal; must not survive

const toPosix = (p) => p.split(path.sep).join('/');
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/**
 * scanAnalysisLibrary({ root }) → { inputs, modules }: the closure of the Worker entry (paths
 * relative to root, sorted) and every module's export names (sorted).
 */
export async function scanAnalysisLibrary({ root = ROOT } = {}) {
  const base = { absWorkingDir: root, write: false, metafile: true, logLevel: 'silent',
    platform: 'browser', target: TARGETS, format: 'esm' };
  const scan = await esbuild.build({ ...base, entryPoints: [ANALYSIS_WORKER_ENTRY],
    outfile: 'scan.js', bundle: true });
  const inputs = Object.keys(scan.metafile.inputs).map(toPosix).sort();
  const packages = inputs.filter((i) => i.includes('node_modules/'));
  if (packages.length) {
    throw new Error(`the analysis library must not bundle packages: ${packages.join(', ')}`);
  }
  const exportScan = await esbuild.build({ ...base, entryPoints: inputs, outdir: 'exports',
    outbase: '.', bundle: false });
  const modules = {};
  for (const out of Object.values(exportScan.metafile.outputs)) {
    if (!out.entryPoint) continue;
    if (out.exports.includes('default')) {
      throw new Error(`${out.entryPoint}: a library module may not have a default export`);
    }
    modules[toPosix(out.entryPoint)] = [...out.exports].sort();
  }
  return { inputs, modules: sorted(modules) };
}

// The library's own entry: the Worker entry (for its guard), then the global with the used
// exports and, on the page, the script's own text.
function libraryEntry(used) {
  const paths = Object.keys(used);
  const lines = [`import ${JSON.stringify(`./${ANALYSIS_WORKER_ENTRY}`)};`];
  paths.forEach((p, i) => lines.push(`import * as m${i} from ${JSON.stringify(`./${p}`)};`));
  lines.push(`globalThis.${ANALYSIS_LIBRARY_GLOBAL} = {`, '  modules: {');
  paths.forEach((p, i) => lines.push(`    ${JSON.stringify(p)}: { ${used[p]
    .map((n) => `${n}: m${i}.${n}`).join(', ')} },`));
  lines.push('  },');
  // A classic script sees itself as document.currentScript only while it runs: read it now.
  lines.push('  source: typeof document !== "undefined" && document && document.currentScript'
    + ' ? document.currentScript.text : null,', '};');
  return `${lines.join('\n')}\n`;
}

/**
 * buildAnalysisLibrary({ root, minify = true, used }) → { code, inputs, modules }
 * code: the library script (page and Worker); inputs: the bundled modules, relative to root,
 * sorted; modules: { [path]: export names } it exposes: `used` (from the app's pass 1), or every
 * export of the closure when omitted (a page that needs the Worker only, the unit tests).
 */
export async function buildAnalysisLibrary({ root = ROOT, minify = true, used = null,
  scan = null } = {}) {
  const lib = scan || await scanAnalysisLibrary({ root });
  const modules = used ? sorted(used) : lib.modules;
  for (const [p, names] of Object.entries(modules)) {
    const missing = names.filter((n) => !(lib.modules[p] || []).includes(n));
    if (missing.length) throw new Error(`${p} does not export ${missing.join(', ')}`);
  }
  const result = await esbuild.build({
    absWorkingDir: root,
    stdin: { contents: libraryEntry(modules), resolveDir: root, sourcefile: ENTRY_NAME,
      loader: 'js' },
    outfile: 'analysis-library.js', // virtual (write: false)
    bundle: true,
    write: false,
    metafile: true,
    minify,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    target: TARGETS,
    format: 'iife',
    platform: 'browser',
    logLevel: 'warning',
  });
  if (result.warnings.some((w) => /import\.meta/.test(w.text))) {
    throw new Error('import.meta used in the analysis library bundle');
  }
  const inputs = Object.keys(result.metafile.inputs).map(toPosix)
    .filter((i) => i !== ENTRY_NAME).sort();
  const outside = inputs.filter((i) => !lib.inputs.includes(i));
  if (outside.length) throw new Error(`analysis library bundled ${outside.join(', ')}`);
  return { code: result.outputFiles[0].text.trim(), inputs, modules };
}

// Each library module as a virtual module of the page bundle. `exportsFor(path)` returns
// { used, unused }: used names come from the global, unused names are pure placeholders that
// tree shaking removes (pass 2) or every name is a pure marker call (pass 1).
function virtualModulesPlugin(scan, contentsFor, { root }) {
  return {
    name: 'analysis-library',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, async (args) => {
        if (args.pluginData === NAMESPACE) return undefined;
        if (args.namespace !== 'file' && args.namespace !== '') return undefined; // '' = stdin
        const r = await build.resolve(args.path, { kind: args.kind, importer: args.importer,
          resolveDir: args.resolveDir, pluginData: NAMESPACE });
        if (r.errors.length || !r.path) return undefined;
        const rel = toPosix(path.relative(root, r.path));
        return scan.modules[rel] ? { path: rel, namespace: NAMESPACE } : undefined;
      });
      build.onResolve({ filter: new RegExp(`^${ROOT_MODULE}$`) }, () => ({
        path: ':root', namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({
        loader: 'js', contents: contentsFor(args.path),
      }));
    },
  };
}

const marker = (fn, prefix, p, n) => `/* @__PURE__ */ ${fn}(`
  + `${JSON.stringify(`${prefix}${p}#${n}`)})`;

/** Pass 1: every export is a pure marker call; the bundle keeps the markers of used exports. */
function usagePlugin(scan, { root }) {
  return virtualModulesPlugin(scan, (p) => (p === ':root'
    ? 'export const use = (key) => key;\n'
    : `import { use } from '${ROOT_MODULE}';\n${scan.modules[p].map((n) => `export const ${n} = `
      + `${marker('use', USED, p, n)};`).join('\n')}\n`), { root });
}

/**
 * esbuild plugin for a bundle that runs on a page AFTER the library script: an import of a
 * library module becomes that module's entry in the global, so the bundle carries no copy of
 * it. The names the library does not expose are pure placeholders: tree shaking removes them,
 * and bundleWithAnalysisLibrary fails if one survives. A page without the library fails at boot
 * with a clear error instead of running without its analysis.
 */
export function analysisLibraryPlugin(library, scan, { root = ROOT } = {}) {
  return virtualModulesPlugin(scan, (p) => {
    if (p === ':root') {
      return `const lib = globalThis.${ANALYSIS_LIBRARY_GLOBAL};
if (!lib || !lib.modules) throw new Error('OSCILLA: the analysis library script did not run');
export const modules = lib.modules;
export const unused = (key) => { throw new Error(key); };\n`;
    }
    const used = library.modules[p] || [];
    const lines = [`import { modules, unused } from '${ROOT_MODULE}';`];
    if (used.length) {
      lines.push(`export const { ${used.join(', ')} } = modules[${JSON.stringify(p)}];`);
    }
    for (const n of scan.modules[p].filter((x) => !used.includes(x))) {
      lines.push(`export const ${n} = ${marker('unused', UNUSED, p, n)};`);
    }
    return `${lines.join('\n')}\n`;
  }, { root });
}

/**
 * bundleWithAnalysisLibrary({ root, minify, bundle }) → { library, result }
 * bundle(plugin) runs the page bundle's esbuild build with `plugin` added and returns its result
 * (write: false, metafile: true). Runs pass 1, builds the library from the exports it uses, runs
 * pass 2, and fails if the page bundle still contains a library module.
 */
export async function bundleWithAnalysisLibrary({ root = ROOT, minify = true, bundle }) {
  const scan = await scanAnalysisLibrary({ root });
  const probe = await bundle(usagePlugin(scan, { root }));
  const used = {};
  const re = new RegExp(`${USED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^"'\`#]+)#([\\w$]+)`, 'g');
  for (const out of probe.outputFiles) {
    for (const [, p, n] of out.text.matchAll(re)) (used[p] ||= new Set()).add(n);
  }
  const library = await buildAnalysisLibrary({ root, minify, scan, used: Object.fromEntries(
    Object.entries(used).map(([p, names]) => [p, [...names].sort()])) });
  const result = await bundle(analysisLibraryPlugin(library, scan, { root }));
  // One copy: a library module bundled into the page bundle as well ships the analysis twice.
  const twice = Object.keys(result.metafile.inputs).map(toPosix)
    .filter((i) => library.inputs.includes(i));
  if (twice.length) throw new Error(`analysis modules bundled twice: ${twice.join(', ')}`);
  for (const out of result.outputFiles) {
    if (out.text.includes(UNUSED)) {
      throw new Error('the page bundle uses an analysis export the library does not expose');
    }
  }
  return { library, result };
}
