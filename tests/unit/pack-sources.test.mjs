// scripts/pack-sources.mjs: the source pack for an LLM project. Every tracked file lands in
// exactly one bundle or one stated exclusion, the areas go where the index says, a fence never
// closes early, and the CLI refuses a bad flag with exit 2 before reading git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLES, MARKDOWN_EXCLUDE, fenceFor, main, parseArgs, planBundles, renderBundle, renderIndex,
} from '../../scripts/pack-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0')
  .filter(Boolean);
const where = (bundles, file) => bundles.filter((b) => b.files.includes(file)).map((b) => b.name);

test('every tracked file is in exactly one bundle or one exclusion', () => {
  const isBinary = (f) => /\.(png|jpe?g|gif|ico|woff2?|wav)$/.test(f);
  const { bundles, excluded } = planBundles(tracked, isBinary);
  const seen = [...bundles.flatMap((b) => b.files), ...excluded.map((e) => e.file)];
  assert.equal(seen.length, tracked.length);
  assert.deepEqual([...seen].sort(), [...tracked].sort());
  assert.ok(bundles.every((b) => b.files.length > 0), 'no empty bundle is written');
});

test('areas: source, tests, rules and plan go to their named bundles', () => {
  const files = ['README.md', 'src/js/studio/model.js', 'src/js/synth/fm.js', 'src/js/ui/shell.js',
    'src/js/newarea/x.js', 'src/js/main.js', 'src/index.html', 'scripts/build.mjs',
    'tests/unit/a.test.mjs', 'tests/unit/b.test.mjs', 'tests/unit/c.test.mjs',
    'tests/browser/app.cjs', '.ai/repo/rules/project/x.md', '.ai/repo/project/issues/K1.yaml',
    '.ai/repo/knowledge/k.md', 'dist/index.html', 'package-lock.json', 'tests/freeze/g.json',
    'tests/visual/reference.png', 'odd.txt'];
  const { bundles, excluded } = planBundles(files, (f) => f.endsWith('.png'));
  const expect = {
    'README.md': '01-overview', 'src/js/studio/model.js': '04-src-js-studio',
    'src/js/synth/fm.js': '02-src-js-core-audio-synth', 'src/js/ui/shell.js': '05-src-js-ui-main',
    'src/js/newarea/x.js': '05-src-js-ui-main', 'src/js/main.js': '05-src-js-ui-main',
    'src/index.html': '06-src-html-css-data', 'scripts/build.mjs': '07-scripts',
    'tests/unit/a.test.mjs': '08-tests-unit-a', 'tests/unit/b.test.mjs': '08-tests-unit-b',
    'tests/unit/c.test.mjs': '08-tests-unit-a', 'tests/browser/app.cjs': '08-tests-browser-visual',
    '.ai/repo/rules/project/x.md': '09-ai-rules-adrs',
    '.ai/repo/project/issues/K1.yaml': '10-ai-plan',
    '.ai/repo/knowledge/k.md': '11-ai-product-knowledge', 'odd.txt': '12-other',
  };
  for (const [file, name] of Object.entries(expect)) {
    assert.deepEqual(where(bundles, file), [name], file);
  }
  assert.deepEqual(excluded.map((e) => [e.file, e.reason]), [
    ['dist/index.html', 'excluded (dist/)'], ['package-lock.json', 'excluded (package-lock.json)'],
    ['tests/freeze/g.json', 'excluded (tests/freeze/)'], ['tests/visual/reference.png', 'binary'],
  ]);
  assert.ok(MARKDOWN_EXCLUDE.includes('dist/'));
  assert.equal(new Set(BUNDLES.map((b) => b.name)).size, BUNDLES.length);
});

test('a fence outlasts any tilde run in the content; each file is fenced and named', () => {
  assert.equal(fenceFor('plain'), '~~~~');
  assert.equal(fenceFor('a\n~~~~~js\nb\n~~~~~\n'), '~~~~~~');
  const md = renderBundle({ name: '07-scripts', files: ['scripts/a.mjs', 'scripts/b.md'] },
    (f) => (f.endsWith('.md') ? 'x\n~~~~\ny' : 'const a = 1;\n'), { version: '9.9.9', sha: 'abc' });
  assert.match(md, /^# OSCILLA v9\.9\.9 \(abc\): 07-scripts\n/);
  assert.match(md, /## `scripts\/a\.mjs`\n\n~~~~mjs\nconst a = 1;\n~~~~\n/);
  assert.match(md, /## `scripts\/b\.md`\n\n~~~~~md\nx\n~~~~\ny\n~~~~~\n/);
});

test('the index names the commit, every bundle with its count, the log and every size', () => {
  const text = renderIndex({ version: '1.2.3', sha: 'abcd1234', fullSha: 'abcd1234ffff',
    date: '2026-11-05T00:00:00Z', repo: 'https://github.com/o/r', packedAt: 'now',
    zip: 'z.zip', log: 'abcd123 2026-11-05 feat: x',
    sizes: [['a', 1], ['b/c', 22]],
    bundles: [{ name: '01-overview', what: 'docs', files: ['a'] },
      { name: '07-scripts', what: 'scripts', files: ['b/c', 'b/d'] }] });
  assert.match(text, /at commit abcd1234ffff/);
  assert.match(text, /- 01-overview\.md: docs \(1 file\)\n/);
  assert.match(text, /- 07-scripts\.md: scripts \(2 files\)\n/);
  assert.match(text, /- z\.zip: /);
  assert.match(text, /abcd123 2026-11-05 feat: x\n/);
  assert.match(text, /\n {7}22 b\/c\n/);
});

test('flags: --help, --out <dir>; an unknown flag or a missing value exits 2', () => {
  assert.deepEqual(parseArgs([]), { help: false, out: null });
  assert.deepEqual(parseArgs(['--out', '/x', '-h']), { help: true, out: '/x' });
  for (const bad of [['--bogus'], ['--out'], ['--out', '--help'], ['--dryrun']]) {
    assert.throws(() => parseArgs(bad), (e) => e.exitCode === 2, bad.join(' '));
  }
  const err = console.error;
  console.error = () => {};
  try { assert.equal(main(['--outdir', 'x']), 2); } finally { console.error = err; }
});
