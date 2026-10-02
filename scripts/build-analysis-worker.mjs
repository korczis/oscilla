// Build sub-step: the analysis Worker script (gap M10; ADR 0026).
//
// esbuild bundles src/js/measurement/analysis-worker.js with analysis-task.js and its pure
// dependencies into ONE classic script (IIFE). build.mjs compiles that text into the app bundle
// as the define __OSCILLA_ANALYSIS_WORKER__ (a string literal), and analysis-runner.js starts it
// at runtime from a data: URL. Nothing is written to disk and nothing is loaded from a path:
// dist/index.html stays the only runtime file (rule project.single-file-deliverable).
//
// Deterministic like the main build: pinned esbuild, no timestamps, no absolute paths (inputs
// are relative to the repository root), no source map. The Worker may not import packages
// (their licence notices would have to be added) and may not use import.meta; both fail the
// build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { TARGETS } from './build-config.mjs';

export const ANALYSIS_WORKER_ENTRY = 'src/js/measurement/analysis-worker.js';
export const ANALYSIS_WORKER_DEFINE = '__OSCILLA_ANALYSIS_WORKER__';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * buildAnalysisWorker({ root, minify = true }) → { code, inputs }
 * code: the Worker script; inputs: the bundled files, relative to root.
 */
export async function buildAnalysisWorker({ root = ROOT, minify = true } = {}) {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [ANALYSIS_WORKER_ENTRY],
    outfile: 'analysis-worker.js', // virtual (write: false)
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
  const inputs = Object.keys(result.metafile.inputs);
  const packages = inputs.filter((i) => i.includes('node_modules/'));
  if (packages.length) {
    throw new Error(`the analysis Worker must not bundle packages: ${packages.join(', ')}`);
  }
  if (result.warnings.some((w) => /import\.meta/.test(w.text))) {
    throw new Error('import.meta used in the analysis Worker bundle');
  }
  return { code: result.outputFiles[0].text.trim(), inputs };
}
