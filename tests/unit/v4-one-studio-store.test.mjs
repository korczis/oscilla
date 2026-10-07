// Rule project.studio-model-is-canonical, ledger W7a: the page builds ONE Studio store, ONE
// runtime and ONE transport on the live AudioEngine, and the STUDIO workspace owns them. A test
// seam that built a second set on the shared engine (window.OSCILLA.studioTimeline, removed) is
// what this file keeps out: a browser suite drives the canonical store through
// window.OSCILLA.studio instead.
//
// Static, over the text of src/js (comments and strings removed). What it does not decide:
// a factory reached through an alias or a re-export is not seen, and whether a module that is
// allowed to build one builds exactly one is the workspace's own unit tests.
//   node --test tests/unit/v4-one-studio-store.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src', 'js');

/** Who may call each factory, with the reason. Every other call site fails the test. */
const ALLOWED = Object.freeze({
  createStudioStore: {
    'src/js/ui/studio/workspace.js': 'the canonical store behind the workspace\'s stable handle',
  },
  createStudioRuntime: {
    'src/js/ui/studio/workspace.js': 'the one runtime on the live engine',
    'src/js/studio/offline.js': 'a WAV render: its own OfflineAudioContext engine, a fixed model',
  },
  createStudioTransport: {
    'src/js/ui/studio/workspace.js': 'the one transport on the live engine',
    'src/js/studio/offline.js': 'a WAV render: its own OfflineAudioContext engine, a fixed model',
  },
});

/** Source text with comments, strings and template text blanked (line structure kept). */
function code(text) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (text[i] === '\'' || text[i] === '"' || text[i] === '`') {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
      out += quote + blank(text.slice(i + 1, j)) + quote;
      i = j + 1;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** Call sites of `name` (not its `export function` definition): [{ file, line }]. */
function callSites(name, files) {
  const sites = [];
  const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g');
  for (const [file, text] of files) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index - 20), m.index);
      if (/function\s+$/.test(before)) continue;
      sites.push({ file, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return sites;
}

const FILES = sources(SRC).map((p) => [rel(p), code(fs.readFileSync(p, 'utf8'))]);

test('the scan reads code, not comments or strings, and skips a definition', () => {
  const text = code([
    '// createStudioStore(a) in a comment',
    'const s = \'createStudioStore(b)\';',
    'export function createStudioStore(m) { return m; }',
    'const store = createStudioStore(model);',
    'const other = api.createStudioStore(model);',
  ].join('\n'));
  assert.deepEqual(callSites('createStudioStore', [['x.js', text]]), [{ file: 'x.js', line: 4 }]);
});

for (const [name, allowed] of Object.entries(ALLOWED)) {
  test(`${name} is called only where the one Studio state is owned`, () => {
    const sites = callSites(name, FILES);
    const outside = sites.filter((s) => !Object.hasOwn(allowed, s.file))
      .map((s) => `${s.file}:${s.line}`);
    assert.deepEqual(outside, [], `project.studio-model-is-canonical: ${name}() builds a second `
      + `Studio ${name.replace('createStudio', '').toLowerCase()} outside ${
        Object.keys(allowed).join(', ')}`);
    // An allowance nobody uses is stale: the list may only describe what exists.
    for (const file of Object.keys(allowed)) {
      assert.ok(sites.some((s) => s.file === file), `${name}: ${file} is allowed and never calls it`);
    }
  });
}

test('the workspace builds each of the three once', () => {
  for (const name of Object.keys(ALLOWED)) {
    const n = callSites(name, FILES).filter((s) => s.file === 'src/js/ui/studio/workspace.js');
    assert.equal(n.length, 1, `${name}: ${n.length} call sites in workspace.js`);
  }
});

test('window.OSCILLA carries no Studio context of its own (studioTimeline is gone)', () => {
  const main = FILES.find(([file]) => file === 'src/js/main.js')[1];
  assert.doesNotMatch(main, /\bstudioTimeline\b/, 'src/js/main.js still names studioTimeline');
  const raw = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  assert.doesNotMatch(raw, /from\s+'[^']*test-seam[^']*'/, 'main.js imports a test-seam module');
  assert.equal(fs.existsSync(path.join(SRC, 'ui', 'studio', 'timeline-test-seam.js')), false,
    'src/js/ui/studio/timeline-test-seam.js still exists');
});
