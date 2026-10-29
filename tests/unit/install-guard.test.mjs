// scripts/install-guard.mjs: what `npm ci --ignore-scripts` would run or fetch of a pull
// request outside the registry is refused before the install (review of #255, R17, R18).
//   node --test tests/unit/install-guard.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync }
  from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard, lockfileProblems, manifestProblems, nonRegistrySpec, npmrcProblems }
  from '../../scripts/install-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGRAM = path.join(ROOT, 'scripts', 'install-guard.mjs');
const HASH = `sha512-${'A'.repeat(86)}==`;
const TARBALL = 'https://registry.npmjs.org/dep/-/dep-1.0.0.tgz';

const lock = (entry, extra = {}) => JSON.stringify({ name: 'x', lockfileVersion: 3,
  packages: { '': { name: 'x' }, 'node_modules/dep': { version: '1.0.0', ...entry } },
  ...extra });

test('the repository\'s own lockfile, package.json and .npmrc files pass', () => {
  assert.deepEqual(guard(ROOT), []);
  const r = spawnSync(process.execPath, [PROGRAM, '--repo', ROOT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('lockfile: every entry is a registry tarball with a sha512 integrity', () => {
  assert.deepEqual(lockfileProblems(lock({ resolved: TARBALL, integrity: HASH })), []);
  for (const [name, entry, want] of [
    ['git+ssh', { resolved: 'git+ssh://git@github.com/o/r.git#0123abc', integrity: HASH },
      /resolves to git\+ssh:/],
    ['git+https', { resolved: 'git+https://github.com/o/r.git#0123abc' }, /resolves to git/],
    ['git+file', { resolved: 'git+file:///tmp/r#0123abc' }, /resolves to git\+file/],
    ['github shorthand', { resolved: 'github:o/r#0123abc' }, /resolves to github:/],
    ['file', { resolved: 'file:../dep', integrity: HASH }, /resolves to file:/],
    ['a local tarball', { resolved: 'file:dep-1.0.0.tgz', integrity: HASH }, /file:/],
    ['http', { resolved: 'http://registry.npmjs.org/dep/-/dep-1.0.0.tgz', integrity: HASH },
      /not a tarball of https:\/\/registry\.npmjs\.org\//],
    ['another host', { resolved: 'https://registry.example.com/dep/-/dep-1.0.0.tgz',
      integrity: HASH }, /not a tarball of/],
    ['a look-alike host', { resolved: 'https://registry.npmjs.org.example.com/d.tgz',
      integrity: HASH }, /not a tarball of/],
    ['a GitHub tarball', { resolved: 'https://codeload.github.com/o/r/tar.gz/0123abc',
      integrity: HASH }, /not a tarball of/],
    ['the registry, not a tarball', { resolved: 'https://registry.npmjs.org/dep',
      integrity: HASH }, /not a tarball of/],
    ['no resolved', { integrity: HASH }, /resolves to \(nothing\)/],
    ['no integrity', { resolved: TARBALL }, /has no integrity/],
    ['a sha1 integrity', { resolved: TARBALL, integrity: 'sha1-abcdefabcdefabcdefabcdefabc=' },
      /has integrity sha1-/],
    ['a link', { resolved: 'packages/dep', link: true }, /links packages\/dep of the checkout/],
    ['bundled', { resolved: TARBALL, integrity: HASH, inBundle: true }, /is bundled/],
  ]) {
    const found = lockfileProblems(lock(entry));
    assert.ok(found.some((p) => want.test(p)), `${name}: ${found.join('; ')}`);
  }
  assert.match(lockfileProblems(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))[0],
    /lockfileVersion 1 has no packages map/);
  assert.match(lockfileProblems('{')[0], /not JSON/);
});

test('package.json: no bundled dependency, no workspace, no override outside the registry', () => {
  const pkg = (o) => JSON.stringify({ name: 'x', version: '1.0.0', ...o });
  assert.deepEqual(manifestProblems(pkg({ dependencies: { a: '^1.2.3', b: 'npm:c@^2' },
    devDependencies: { d: 'latest' }, overrides: { a: '1.2.4', e: { f: '$a', g: '~1.0.0' },
      'h@^1': '1.0.1' } })), []);
  for (const [name, o, want] of [
    ['bundleDependencies', { bundleDependencies: ['a'] }, /bundleDependencies/],
    ['bundledDependencies', { bundledDependencies: true }, /bundledDependencies/],
    ['workspaces', { workspaces: ['packages/*'] }, /workspaces/],
    ['override to git', { overrides: { a: 'git+https://github.com/o/r.git' } },
      /overrides\.a = .* names git\+https:/],
    ['override to file', { overrides: { a: 'file:../a' } }, /names file:/],
    ['override to link', { overrides: { a: 'link:../a' } }, /names link:/],
    ['override to http', { overrides: { a: 'http://example.com/a.tgz' } }, /names http:/],
    ['override to https', { overrides: { a: 'https://example.com/a.tgz' } }, /names https:/],
    ['override to github:', { overrides: { a: 'github:o/r' } }, /names github:/],
    ['override to a shorthand', { overrides: { a: 'o/r#main' } }, /owner\/repo shorthand/],
    ['override to a path', { overrides: { a: './a' } }, /a path of the checkout/],
    ['a nested override', { overrides: { a: { b: { c: 'github:o/r' } } } },
      /overrides\.a\.b\.c = /],
    ['a nested "." override', { overrides: { a: { '.': 'git+ssh://x/y.git' } } },
      /overrides\.a\.\. = /],
    ['an alias to git', { overrides: { a: 'npm:b@github:o/r' } }, /names github:/],
    ['a key that names git', { overrides: { 'a@github:o/r': '1.0.0' } }, /key "a@github:o\/r"/],
    ['a non-string override', { overrides: { a: 1 } }, /is not a version/],
    ['a git dependency', { dependencies: { a: 'github:o/r' } }, /dependencies\.a = /],
    ['a file devDependency', { devDependencies: { a: 'file:./a' } }, /devDependencies\.a = /],
    ['an optional tarball', { optionalDependencies: { a: 'https://x.example/a.tgz' } },
      /optionalDependencies\.a = /],
  ]) {
    const found = manifestProblems(pkg(o));
    assert.ok(found.some((p) => want.test(p)), `${name}: ${found.join('; ')}`);
  }
  for (const spec of ['1.2.3', '^1', '~1.0.0', '>=1 <2', '1.x || 2.x', 'latest', 'npm:a@1', '$a',
    '*']) {
    assert.equal(nonRegistrySpec(spec), null, spec);
  }
});

test('.npmrc: no helper program, no other registry, no TLS or script switch', () => {
  assert.deepEqual(npmrcProblems('; a comment\n# another\nfund=false\naudit = false\n'
    + 'ignore-scripts=true\nengine-strict=true\n'), []);
  for (const [text, want] of [
    ['git=./evil.sh', /git names a program npm runs/],
    ['script-shell=./evil.sh', /script-shell names a program/],
    ['script_shell=./evil.sh', /script_shell names a program/],
    ['shell=./evil.sh', /shell names a program/],
    ['node-options=--require ./x.cjs', /node-options names a program/],
    ['onload-script=./x.js', /onload-script names a program/],
    ['GIT=./evil.sh', /GIT names a program/],
    ['"git" = "./evil.sh"', /git names a program/],
    ['ignore-scripts=false', /ignore-scripts=false would run lifecycle scripts/],
    ['ignore-scripts = "false"', /ignore-scripts=false/],
    ['registry=https://registry.example.com/', /registry names another registry/],
    ['@oscilla:registry=https://npm.example.com/', /@oscilla:registry names another registry/],
    ['replace-registry-host=never', /replace-registry-host names another registry/],
    ['strict-ssl=false', /strict-ssl turns a TLS check off/],
    ['globalconfig=./other', /globalconfig is not one the guard knows/],
    ['userconfig=./other', /userconfig is not one/],
    ['//registry.npmjs.org/:_authToken=x', /is not one the guard knows/],
    ['[section]\nfund=false', /a section \[section\]/],
  ]) {
    const found = npmrcProblems(text);
    assert.ok(found.some((p) => want.test(p)), `${text}: ${found.join('; ')}`);
  }
});

test('the checkout: a .npmrc anywhere, the lockfile and package.json, by exit status', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-install-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  const run = () => spawnSync(process.execPath, [PROGRAM, '--repo', dir], { encoding: 'utf8' });
  write('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
  assert.deepEqual(guard(dir), ['no package-lock.json: npm ci would have nothing to check']);
  assert.equal(run().status, 1);
  write('package-lock.json', lock({ resolved: TARBALL, integrity: HASH }));
  assert.deepEqual(guard(dir), []);
  assert.equal(run().status, 0);
  // a workspace's or any directory's .npmrc counts, a symlinked one is refused as such
  write('packages/a/.npmrc', 'git=./evil.sh\n');
  assert.match(guard(dir).join('\n'), /packages\/a\/\.npmrc:1: git names a program/);
  rmSync(path.join(dir, 'packages'), { recursive: true });
  symlinkSync('/dev/null', path.join(dir, '.npmrc'));
  assert.match(guard(dir).join('\n'), /\.npmrc: a symbolic link/);
  rmSync(path.join(dir, '.npmrc'));
  // what node_modules and .git hold is not the checkout's
  write('node_modules/x/.npmrc', 'git=./evil.sh\n');
  write('.git/.npmrc', 'git=./evil.sh\n');
  assert.deepEqual(guard(dir), []);
  // a shrinkwrap is read too, since npm ci prefers it
  write('npm-shrinkwrap.json', lock({ resolved: 'git+ssh://x/y.git#0123abc' }));
  assert.match(guard(dir).join('\n'), /npm-shrinkwrap\.json: node_modules\/dep resolves to git/);
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::install-guard: npm-shrinkwrap\.json/);
  assert.match(r.stdout, /install-guard: REFUSED, 2 problem/);
  assert.equal(spawnSync(process.execPath, [PROGRAM, '--nope']).status, 2);
  assert.ok(readFileSync(PROGRAM, 'utf8').includes('R17'));
});
