// Every `npm run <name>` (and `npm test:<name>`) the plan names is a script of package.json.
//
// About seventy plan files named `npm run test:synth` while package.json had no such script
// (coordinator audit, K075): an acceptance criterion that names a command nobody can run is
// unprovable. This scans .ai/repo/project/**/*.yaml (issues, milestones, intents, critiques,
// gaps) for the mentions and refuses a name package.json does not define. A name an issue will
// add is listed in PLANNED with the issue that adds it; a listed name that package.json now
// defines, or that no plan file names any more, fails until it is removed from the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PLAN = path.join(ROOT, '.ai', 'repo', 'project');

/** Names an issue adds with itself, each with that issue: they are not scripts yet. */
const PLANNED = Object.freeze({
  'kb:components': 'J003 adds it (scripts/ui-catalog.mjs writes .ai/repo/knowledge/components)',
  'docs:ui': 'G014 adds it (docs/ui-catalog.md); N010 extends it',
  'docs:controls': 'N010 adds it (the controls reference)',
  'docs:nodes': 'V619 adds it (the node reference)',
});

/** The script names a text runs through npm: `npm run <name>`, `npm test:<name>`. */
export function npmMentions(text) {
  const out = [];
  for (const m of text.matchAll(/\bnpm\s+(?:run(?:-script)?\s+(?:-{1,2}[\w-]+\s+)*([\w:.-]+)|(test:[\w:.-]+))/g)) {
    out.push((m[1] || m[2]).replace(/[:.]+$/, ''));
  }
  return out;
}

function yamlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...yamlFiles(p));
    else if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(p);
  }
  return out;
}

/** { name: [files] } of every mention whose name package.json does not define. */
export function undefinedMentions(files, scripts, planned = {}) {
  const out = {};
  for (const { file, text } of files) {
    for (const name of npmMentions(text)) {
      if (Object.hasOwn(scripts, name) || Object.hasOwn(planned, name)) continue;
      (out[name] ||= []).includes(file) || out[name].push(file);
    }
  }
  return out;
}

const FILES = yamlFiles(PLAN).map((p) => ({ file: path.relative(ROOT, p),
  text: readFileSync(p, 'utf8') }));

test('the plan names only npm scripts package.json defines', () => {
  const bad = undefinedMentions(FILES, PKG.scripts, PLANNED);
  assert.deepEqual(Object.entries(bad).map(([n, f]) => `${n}: ${f.slice(0, 3).join(', ')}`), []);
});

test('test:synth is defined, and the plan names it (K075, M071, M072)', () => {
  assert.ok(PKG.scripts['test:synth'], 'package.json defines test:synth');
  assert.ok(FILES.some((f) => npmMentions(f.text).includes('test:synth')));
});

test('PLANNED lists only names that are still undefined and still named', () => {
  for (const name of Object.keys(PLANNED)) {
    assert.ok(!Object.hasOwn(PKG.scripts, name), `${name} is defined now: remove it from PLANNED`);
    assert.ok(FILES.some((f) => npmMentions(f.text).includes(name)),
      `no plan file names ${name}: remove it from PLANNED`);
  }
});

test('mutation: a plan file naming an undefined script fails', () => {
  const files = [...FILES, { file: '.ai/repo/project/issues/X999.yaml',
    text: 'validation:\n  - "npm run test:nowhere"\n  - "npm test:elsewhere passes"\n' }];
  const bad = undefinedMentions(files, PKG.scripts, PLANNED);
  assert.deepEqual(Object.keys(bad).sort(), ['test:elsewhere', 'test:nowhere']);
  // Without test:synth in package.json, the seventy mentions fail again (the merge base).
  const { 'test:synth': gone, ...without } = PKG.scripts;
  assert.ok(gone);
  assert.ok(undefinedMentions(FILES, without, PLANNED)['test:synth'].length >= 60);
});

test('the reader takes the name, not the punctuation after it', () => {
  assert.deepEqual(npmMentions('npm run test:measure: v3-measure.cjs; npm run build:check.'),
    ['test:measure', 'build:check']);
  assert.deepEqual(npmMentions('npm run -s release-gate and npm run docs:ui -- --check'),
    ['release-gate', 'docs:ui']);
  assert.deepEqual(npmMentions('npm test and npm ci'), []);
});
