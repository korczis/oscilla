// scripts/install-guard.mjs: what `npm ci --ignore-scripts` would run or fetch of a pull
// request outside the registry is refused before the install (review of #255, R17, R18).
//   node --test tests/unit/install-guard.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync }
  from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
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
    ['bundled with only the root around it', { inBundle: true },
      /is bundled \(inBundle\), and only the root \(the checkout\) encloses it/],
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

// review of #255, round 4: npm resolves again an edge whose spec its locked package does not
// satisfy, so a git spec in a lock entry's own dependency maps (or the root entry's) is cloned
// and its prepare run under --ignore-scripts (R17); npm's ini splits .npmrc on [\r\n]+, so a
// key after a lone CR is a line to npm (R18); a bare tarball name is a file of the checkout
// (R24); a node_modules symlink makes npm ci empty what it points to (R25).
test('round 4: the specs inside lock entries, a lone CR, a tarball name, node_modules', (t) => {
  const GIT = 'git+https://github.com/o/r.git#0123abc';
  const entryWith = (o) => lock({ resolved: TARBALL, integrity: HASH, ...o });
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies',
    'devDependencies']) {
    const found = lockfileProblems(entryWith({ [field]: { b: GIT } }));
    assert.ok(found.some((p) => p.includes(`node_modules/dep: ${field}.b = `)
      && /names git\+https:/.test(p)), `${field}: ${found.join('; ')}`);
    for (const spec of ['file:../b', 'link:../b', 'https://x.example/b.tgz', 'github:o/r',
      'o/r', 'evil.tgz', 'b.tar.gz', '/abs/b', './b']) {
      assert.ok(lockfileProblems(entryWith({ [field]: { b: spec } })).length, `${field} ${spec}`);
    }
  }
  // the root entry "" is read as well
  const root = JSON.stringify({ name: 'x', lockfileVersion: 3, packages: {
    '': { name: 'x', dependencies: { a: '1.0.0' }, optionalDependencies: { b: GIT } },
    'node_modules/a': { version: '1.0.0', resolved: TARBALL, integrity: HASH } } });
  assert.match(lockfileProblems(root).join('\n'),
    /\(the root entry ""\): optionalDependencies\.b = .* names git\+https:/);
  assert.match(lockfileProblems(JSON.stringify({ lockfileVersion: 3, packages: {
    '': { workspaces: ['p/*'] } } })).join('\n'), /root entry ""\): workspaces/);
  // a bundle list is a registry tarball's own (R29); on an entry nothing checks, it is refused
  assert.deepEqual(lockfileProblems(entryWith({ bundleDependencies: ['b'] })), []);
  assert.match(lockfileProblems(lock({ resolved: GIT, bundleDependencies: ['b'] })).join('\n'),
    /node_modules\/dep: bundleDependencies/);
  assert.match(lockfileProblems(entryWith({ dependencies: ['b'] })).join('\n'),
    /dependencies is not a map/);
  // registry specs inside entries pass, as the repository's own lockfile shows
  assert.deepEqual(lockfileProblems(entryWith({ dependencies: { b: '^1.0.0', c: 'npm:d@2' },
    peerDependencies: { e: '*' }, optionalDependencies: { f: '>=1 <3' } })), []);
  // R24: a bare tarball file name, in package.json too
  for (const spec of ['evil.tgz', 'EVIL.TGZ', 'b.tar.gz', 'b.tar']) {
    assert.match(String(nonRegistrySpec(spec)), /a tarball file of the checkout/, spec);
  }
  assert.match(manifestProblems(JSON.stringify({ dependencies: { b: 'evil.tgz' } })).join('\n'),
    /dependencies\.b = "evil\.tgz" is a tarball file/);
  // R18: a lone CR, and the key after it as npm reads it
  for (const text of ['audit=false\rgit=./evil.sh\n', 'fund=false\r\rregistry=https://x/\n']) {
    const found = npmrcProblems(text);
    assert.ok(found.some((p) => /a carriage return/.test(p)), found.join('; '));
    assert.ok(found.some((p) => /:2: (git|registry) names/.test(p)), found.join('; '));
  }
  assert.deepEqual(npmrcProblems('audit=false\r\n').map((p) => /carriage/.test(p)), [true]);
  // R25: before the install any node_modules, a symlink above all; after it, the harness's
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-install-guard-modules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
  writeFileSync(path.join(dir, 'package-lock.json'), lock({ resolved: TARBALL, integrity: HASH }));
  assert.deepEqual(guard(dir, { beforeInstall: true }), []);
  symlinkSync(os.tmpdir(), path.join(dir, 'node_modules'));
  assert.match(guard(dir, { beforeInstall: true }).join('\n'), /node_modules is a symbolic link/);
  assert.deepEqual(guard(dir), [], 'a linked node_modules after the install is the harness\'s');
  rmSync(path.join(dir, 'node_modules'));
  mkdirSync(path.join(dir, 'node_modules'));
  assert.deepEqual(guard(dir), []);
  assert.match(guard(dir, { beforeInstall: true }).join('\n'),
    /node_modules exists before the install/);
  const r = spawnSync(process.execPath, [PROGRAM, '--repo', dir, '--before-install'],
    { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
});

// review of #255, round 5, R29: Tailwind 4 (ADR 0061) brings @tailwindcss/oxide-wasm32-wasi,
// whose six bundled packages npm records with no resolved and no integrity; they arrive inside
// their parent's tarball, which its sha512 checks, so an inBundle entry is accepted exactly
// when its bundling parent (the nearest enclosing entry that is not bundled) is a registry
// tarball with a sha512. The fixture is the closure @tailwindcss/cli adds, merged offline into
// this repository's own lockfile (tests/unit/fixtures/install-guard/tailwind4-cli.json.gz;
// the fixtures are gzipped, so that their third-party version literals are no product
// version to tests/unit/version-authority.test.mjs, which skips binary files).
const FIXTURES = path.join(ROOT, 'tests', 'unit', 'fixtures', 'install-guard');
const WASI = 'node_modules/@tailwindcss/oxide-wasm32-wasi';
/** A gzipped fixture's bytes. */
const fixture = (name) => gunzipSync(readFileSync(path.join(FIXTURES, `${name}.gz`)));
const TAILWIND4 = () => JSON.parse(fixture('tailwind4-cli.json').toString('utf8'));
/** git's object name of a blob. */
const blob = (data) => createHash('sha1').update(`blob ${data.length}\0`).update(data)
  .digest('hex');

/** This repository's lockfile with the Tailwind 4 closure added (its own entries win). */
function withTailwind4(edit = (packages) => packages) {
  const own = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const tw = TAILWIND4();
  own.packages[''].devDependencies = { ...own.packages[''].devDependencies,
    ...tw.devDependencies };
  own.packages = edit({ ...structuredClone(tw.packages), ...own.packages });
  return JSON.stringify(own);
}

test('R29: Tailwind 4\'s bundled packages pass under a sha512-checked registry parent', () => {
  const tw = TAILWIND4();
  const bundled = Object.keys(tw.packages).filter((k) => tw.packages[k].inBundle);
  assert.equal(bundled.length, 6, 'the fixture carries the six bundled entries');
  assert.ok(bundled.every((k) => k.startsWith(`${WASI}/node_modules/`)
    && !('resolved' in tw.packages[k]) && !('integrity' in tw.packages[k])));
  assert.ok(Array.isArray(tw.packages[WASI].bundleDependencies));
  assert.deepEqual(lockfileProblems(withTailwind4()), []);
  // a bundled entry under a bundled one: the nearest parent that is not bundled checks it
  assert.deepEqual(lockfileProblems(withTailwind4((p) => ({ ...p,
    [`${bundled[0]}/node_modules/x`]: { version: '1.0.0', inBundle: true } }))), []);
  // the same bundled packages under a parent nothing checks are refused, each of them
  for (const [what, parent, want] of [
    ['a git parent', { resolved: 'git+https://github.com/o/r.git#0123abc' },
      /its bundling parent node_modules\/@tailwindcss\/oxide-wasm32-wasi resolves to git\+https:/],
    ['a parent of another host', { resolved: 'https://registry.example.com/w/-/w-1.0.0.tgz' },
      /resolves to https:\/\/registry\.example\.com\/.*not a tarball of/],
    ['a parent without integrity', { integrity: undefined }, /has no integrity/],
    ['a parent with a sha1', { integrity: 'sha1-abcdefabcdefabcdefabcdefabc=' },
      /has integrity sha1-/],
    ['a linked parent', { link: true, resolved: 'vendor/wasi' }, /is a link of the checkout/],
  ]) {
    const found = lockfileProblems(withTailwind4((p) => ({ ...p,
      [WASI]: { ...p[WASI], ...parent } })));
    for (const k of bundled) {
      assert.ok(found.some((f) => f.includes(`${k} is bundled (inBundle), and`) && want.test(f)),
        `${what}: ${k}: ${found.join('; ')}`);
    }
  }
  // a bundled entry that only the root encloses, or one that records a source of its own
  // outside the registry, is refused
  assert.match(lockfileProblems(withTailwind4((p) => ({ ...p,
    'node_modules/stray': { version: '1.0.0', inBundle: true } }))).join('\n'),
  /node_modules\/stray is bundled \(inBundle\), and only the root/);
  assert.match(lockfileProblems(withTailwind4((p) => ({ ...p,
    [bundled[0]]: { ...p[bundled[0]], resolved: 'git+ssh://x/y.git#0123abc' } }))).join('\n'),
  /oxide-wasm32-wasi\/node_modules\/\S+ resolves to git\+ssh:/);
  // and a bundled package's own specs are read as any entry's
  assert.match(lockfileProblems(withTailwind4((p) => ({ ...p,
    [bundled[0]]: { ...p[bundled[0]], dependencies: { b: 'github:o/r' } } }))).join('\n'),
  /dependencies\.b = "github:o\/r" names github:/);
});

// R29 too: the lockfile of #253 (F001: tailwindcss 3.4.19, postcss, flowbite 2.5.2), copied
// from its branch at 7b4b439f into the fixtures (the blobs `git rev-parse
// 7b4b439f:package-lock.json` and `:package.json` name), and this repository's own, pass.
test('R29: the lockfiles of #253 (F001) and of main pass the guard, by API and exit status',
  (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-install-guard-f001-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const [name, to, oid] of [
      ['f001-package.json', 'package.json', '43d9ce485b1c6a681100a5943995049d02d416fc'],
      ['f001-package-lock.json', 'package-lock.json', '33232f66aea9114fade9c52cef6086c97867124a'],
    ]) {
      const data = fixture(name);
      assert.equal(blob(data), oid, `${name} is #253's ${to} at 7b4b439f`);
      writeFileSync(path.join(dir, to), data);
    }
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.match(String(pkg.devDependencies?.tailwindcss), /3\.4\.19/);
    assert.ok(pkg.devDependencies?.flowbite || pkg.dependencies?.flowbite);
    assert.deepEqual(guard(dir, { beforeInstall: true }), []);
    for (const repo of [dir, ROOT]) {
      const r = spawnSync(process.execPath, [PROGRAM, '--repo', repo], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${repo}: ${r.stdout}${r.stderr}`);
    }
  });

// R32: npm reads a spec with a slash that is no owner/repo shorthand and no scoped
// `@scope/name@version` as a directory of the checkout
test('R32: relative directory specs are not the registry', () => {
  for (const spec of ['vendor/sub/evil', 'rel/', './x', '../x', 'a/b/', 'x/y/z#main', 'a\\b',
    '@scope/name', 'vendor//evil']) {
    assert.ok(nonRegistrySpec(spec), spec);
    assert.ok(lockfileProblems(lock({ resolved: TARBALL, integrity: HASH,
      dependencies: { b: spec } })).length, `in a lock entry: ${spec}`);
    assert.match(manifestProblems(JSON.stringify({ dependencies: { b: spec } })).join('\n'),
      /dependencies\.b = /, `in package.json: ${spec}`);
  }
  assert.match(nonRegistrySpec('vendor/sub/evil'), /a relative path of the checkout/);
  assert.match(nonRegistrySpec('rel/'), /a relative path of the checkout/);
  for (const spec of ['@scope/name@1.0.0', '@scope/name@^2', 'npm:@scope/name@1', '^1.2.3']) {
    assert.equal(nonRegistrySpec(spec), null, spec);
  }
});
