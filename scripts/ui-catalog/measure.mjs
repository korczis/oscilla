#!/usr/bin/env node
// What the UI catalogue would cost the single file (plan issue G001, for the owner's Q037).
// Nothing in the app imports the catalogue yet, so dist/index.html does not carry it; this
// bundles a fixture entry that imports the runtime registry (src/js/ui/catalog/registry.js),
// with the build's esbuild options (scripts/build.mjs: bundle, minify, IIFE, its targets, no
// legal comments, utf8), and gzips it at level 9 as scripts/verify-dist.mjs measures dist.
//
// Two bundles: `full`, the registry with every declaration, and `base`, the same registry with
// each decl/*.js reduced to its imports and an empty list (define, sources, the node faces and
// every module a declaration reads stay). full - base is what the declarations cost: their id,
// kind, label, state, links, docs, hooks, patterns and parameter descriptors. Divided by
// the number of declarations it gives the bytes per declaration, projected onto the 584 distinct
// hooks measured on f887066f (and per declared hook, projected the same way). A standalone
// gzip is not the marginal gzip inside dist/index.html, where the shared modules are already
// present and compress against the rest; it is the figure the issue asks for.
//
//   node scripts/ui-catalog/measure.mjs [--json]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { TARGETS } from '../build-config.mjs';
import { ROOT } from './check.mjs';

export const CENSUS_HOOKS = 584;
const ENTRY = "import { CATALOG } from './src/js/ui/catalog/registry.js';\n"
  + 'globalThis.oscCatalog = CATALOG;\n';

/**
 * Plugin: every src/js/ui/catalog/decl/*.js module keeps its imports (the constants it reads
 * stay in both bundles) and exports an empty list instead of its declarations.
 */
const emptyDeclarations = {
  name: 'empty-declarations',
  setup(build) {
    build.onLoad({ filter: /[\\/]ui[\\/]catalog[\\/]decl[\\/][^\\/]+\.js$/ }, (args) => {
      const text = readFileSync(args.path, 'utf8');
      const imports = text.match(/^import[\s\S]*?;$/gm) || [];
      const names = imports.flatMap((i) => (/\{([^}]*)\}/.exec(i) || ['', ''])[1].split(','))
        .map((n) => n.trim()).filter(Boolean);
      return { contents: `${imports.join('\n')}\nglobalThis.oscKeep = [${names.join(', ')}];\n`
        + 'export default [];\n', loader: 'js', resolveDir: path.dirname(args.path) };
    });
  },
};

async function bundle(plugins = []) {
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'catalog-entry.js', loader: 'js' },
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    platform: 'browser',
    legalComments: 'none',
    charset: 'utf8',
    target: TARGETS,
    logLevel: 'warning',
    plugins,
  });
  const code = Buffer.from(result.outputFiles[0].text);
  return { raw: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

export async function measureCatalog() {
  const { DECLARATIONS } = await import('../../src/js/ui/catalog/registry.js');
  const { hooksOf } = await import('../../src/js/ui/catalog/define.js');
  const full = await bundle();
  const base = await bundle([emptyDeclarations]);
  const declarations = DECLARATIONS.length;
  const hooks = DECLARATIONS.reduce((n, d) => n + hooksOf(d).length, 0);
  const gzip = full.gzip - base.gzip;
  const perDeclaration = gzip / declarations;
  const perHook = gzip / hooks;
  return {
    declarations, hooks,
    full, base,
    declarationsBytes: { raw: full.raw - base.raw, gzip },
    perDeclaration: Math.round(perDeclaration * 10) / 10,
    perHook: Math.round(perHook * 10) / 10,
    projection: {
      censusHooks: CENSUS_HOOKS,
      perDeclaration: Math.round(perDeclaration * CENSUS_HOOKS),
      perHook: Math.round(perHook * CENSUS_HOOKS),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts', 'ui-catalog',
  'measure.mjs')) {
  const m = await measureCatalog();
  if (process.argv.includes('--json')) console.log(JSON.stringify(m, null, 2));
  else {
    console.log(`declarations: ${m.declarations} (${m.hooks} concrete hooks)`);
    console.log(`registry bundle, all declarations: ${m.full.raw} B raw, ${m.full.gzip} B gzip`);
    console.log(`registry bundle, no declarations:  ${m.base.raw} B raw, ${m.base.gzip} B gzip`);
    console.log(`the declarations: ${m.declarationsBytes.raw} B raw, ${m.declarationsBytes.gzip
    } B gzip`);
    console.log(`gzip per declaration: ${m.perDeclaration} B; per declared hook: ${m.perHook} B`);
    console.log(`projection for ${m.projection.censusHooks} hooks: ${m.projection.perDeclaration
    } B gzip at one declaration per hook; ${m.projection.perHook} B at the per-hook rate`);
  }
}
