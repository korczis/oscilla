// The static ES-module import graph of src/js has no cycle (plan issue E006, intent
// engineering-integrity criterion acyclic-imports).
//
// esbuild (the build's own parser) reads every module under src/js as an entry point and
// reports, in its metafile, each module's import records. Only `import-statement` records are
// edges: `import ... from`, a bare `import '...'` and `export ... from`. A dynamic import() is
// not part of the static graph. Packages (alpinejs, p5, uplot) are external and are not nodes.
// The cycles are the strongly connected components with more than one module, or a module that
// imports itself, and each is printed as one closed path so a failure names the modules.
//
// The fixtures prove the detector: a two-module cycle and a three-module cycle (through each
// edge form) are found, and an acyclic graph, or a loop closed only by a dynamic import, is not.
//   node --test tests/unit/src-imports-acyclic.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** Map of module path (relative to `cwd`, '/' separated) -> the modules it imports statically. */
async function importGraph(dir, cwd = ROOT) {
  const result = await esbuild.build({
    absWorkingDir: cwd,
    entryPoints: jsFiles(dir),
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    format: 'esm',
    outdir: path.join(cwd, '.import-graph-unused'),
    logLevel: 'silent',
  });
  const graph = new Map();
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    graph.set(file, input.imports
      .filter((i) => i.kind === 'import-statement' && !i.external)
      .map((i) => i.path));
  }
  return graph;
}

/** Every cycle of `graph` as a closed path [a, b, ..., a], one per strongly connected part. */
function findCycles(graph) {
  let next = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const parts = [];
  const visit = (v) => {
    index.set(v, next);
    low.set(v, next++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const part = new Set();
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      part.add(w);
    } while (w !== v);
    if (part.size > 1 || (graph.get(v) || []).includes(v)) parts.push(part);
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v);
  return parts.map((part) => closedPath(graph, part));
}

/** A shortest closed path through the smallest member of a strongly connected `part`. */
function closedPath(graph, part) {
  const start = [...part].sort()[0];
  const from = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const v = queue.shift();
    for (const w of graph.get(v) || []) {
      if (!part.has(w)) continue;
      if (w === start) {
        const route = [start];
        for (let x = v; x !== start; x = from.get(x)) route.splice(1, 0, x);
        return [...route, start];
      }
      if (!from.has(w)) {
        from.set(w, v);
        queue.push(w);
      }
    }
  }
  throw new Error(`no closed path through ${start}`);
}

/** Write `files` ({ 'a.js': source }) into a new directory and return its import cycles. */
async function fixtureCycles(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oscilla-imports-'));
  try {
    for (const [name, src] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), src);
    }
    return findCycles(await importGraph(dir, dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the static import graph of src/js has no cycle', async () => {
  const graph = await importGraph(path.join(ROOT, 'src', 'js'));
  const modules = jsFiles(path.join(ROOT, 'src', 'js'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const missing = modules.filter((m) => !graph.has(m));
  assert.deepEqual(missing, [], 'every module under src/js is a node of the graph');
  const cycles = findCycles(graph).map((c) => c.join(' -> '));
  assert.deepEqual(cycles, [], `src/js has import cycles:\n  ${cycles.join('\n  ')}`);
});

test('a two-module cycle is found', async () => {
  const cycles = await fixtureCycles({
    'a.js': "import { b } from './b.js';\nexport const a = () => b;\n",
    'b.js': "import { a } from './a.js';\nexport const b = () => a;\n",
    'leaf.js': "import { a } from './a.js';\nexport const leaf = a;\n",
  });
  assert.deepEqual(cycles, [['a.js', 'b.js', 'a.js']]);
});

test('a three-module cycle through every static edge form is found', async () => {
  const cycles = await fixtureCycles({
    'x/a.js': "import { b } from './b.js';\nexport const a = () => b;\n",
    'x/b.js': "export * from '../c.js';\nexport const b = 1;\n",
    'c.js': "import './x/a.js';\nexport const c = 2;\n",
    'd.js': "import { a } from './x/a.js';\nexport const d = a;\n",
  });
  assert.deepEqual(cycles, [['c.js', 'x/a.js', 'x/b.js', 'c.js']]);
});

test('an acyclic graph and a loop closed only by import() have no cycle', async () => {
  const cycles = await fixtureCycles({
    'a.js': "import { b } from './b.js';\nimport { c } from './c.js';\nexport const a = b + c;\n",
    'b.js': "import { c } from './c.js';\nexport const b = c;\n",
    'c.js': "export const c = 1;\nexport const later = () => import('./a.js');\n",
  });
  assert.deepEqual(cycles, []);
});
