// One product version: package.json "version". The runtime (core/build-info.js, ui/version.js),
// the committed dist and the config export all derive from it, and no hard-coded copy of the
// current version exists anywhere else. Every expected value here is read from package.json at
// test time, so a version bump needs no edit to this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  findVersionLiterals, findVersionsAhead, repositoryFiles, versionLiteralPattern,
} from '../../scripts/release-version-check.mjs';
import {
  bumpVersion, computeSourceDigest, findRegion, readBanner,
} from '../../scripts/release-metadata.mjs';
import { buildConfigExport, parseConfigImport } from '../../src/js/ui/config-file.js';

const ROOT = new URL('../../', import.meta.url);
const PKG = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const DIGEST = 'a'.repeat(64);

// Simulate the esbuild defines BEFORE build-info.js is first evaluated in this process.
globalThis.__OSCILLA_VERSION__ = PKG.version;
globalThis.__OSCILLA_SOURCE_DIGEST__ = DIGEST;
const { BUILD, resolveBuild, DEV_VERSION } = await import('../../src/js/core/build-info.js');
const { OSCILLA_VERSION } = await import('../../src/js/ui/version.js');
const { APP_VERSION } = await import('../../src/js/core/constants.js');

test('the runtime version is the compiled-in package.json version', () => {
  assert.equal(BUILD.origin, 'define');
  assert.equal(BUILD.version, PKG.version);
  assert.equal(OSCILLA_VERSION, PKG.version);
  assert.equal(BUILD.sourceDigest, DIGEST);
  assert.equal(BUILD.channel, 'source');
  assert.equal(BUILD.commit, null);
  assert.ok(Object.isFrozen(BUILD));
});

test('APP_VERSION is the frozen legacy V1 stamp, not the product version', () => {
  assert.equal(APP_VERSION, '1.0.0');
  assert.notEqual(APP_VERSION, PKG.version);
});

test('resolveBuild: region first, then defines, then the dev fallback', () => {
  const commit = 'c'.repeat(40);
  const region = JSON.stringify({ version: '40.8.7', channel: 'production', sourceDigest: DIGEST,
    commit, shortCommit: commit.slice(0, 7), sourceDate: '2026-10-02T03:32:49Z',
    artifactSha256: 'b'.repeat(64) });
  const defined = { version: '40.8.7', sourceDigest: DIGEST };
  const r = resolveBuild({ regionText: region, defined });
  assert.equal(r.origin, 'region');
  assert.equal(r.version, '40.8.7');
  assert.equal(r.commitUrl, `https://github.com/korczis/oscilla/commit/${commit}`);
  assert.equal(r.shortCommit, 'ccccccc');
  assert.equal(r.consistent, true);

  const d = resolveBuild({ defined: { version: '40.8.7', sourceDigest: DIGEST } });
  assert.deepEqual([d.origin, d.version, d.channel, d.commitUrl],
    ['define', '40.8.7', 'source', null]);

  const f = resolveBuild({});
  assert.deepEqual([f.origin, f.version, f.channel, f.sourceDigest],
    ['fallback', DEV_VERSION, 'dev', null]);
});

test('resolveBuild: a malformed or disagreeing region is reported, never trusted silently', () => {
  const bad = resolveBuild({ regionText: '{nope', defined: { version: '40.8.7' } });
  assert.equal(bad.origin, 'define');
  assert.match(bad.regionError, /not valid JSON/);
  const noVersion = resolveBuild({ regionText: '{}', defined: { version: '40.8.7' } });
  assert.match(noVersion.regionError, /no version/);
  const edited = resolveBuild({
    regionText: JSON.stringify({ version: '40.9.9', sourceDigest: DIGEST }),
    defined: { version: '40.8.7', sourceDigest: DIGEST },
  });
  assert.equal(edited.consistent, false);
  const shortSha = resolveBuild({
    regionText: JSON.stringify({ version: '40.8.7', commit: 'abc' }),
  });
  assert.equal(shortSha.commit, null); // only a full SHA becomes a commit link
});

test('the committed dist projects package.json: banner, region and the bundle define', () => {
  const html = readFileSync(new URL('dist/index.html', ROOT), 'utf8');
  assert.equal(readBanner(html), PKG.version);
  const { record, json } = findRegion(html);
  assert.equal(record.version, PKG.version);
  assert.equal(record.sourceDigest, computeSourceDigest());
  assert.equal(record.channel, 'source');
  assert.equal(record.commit, null);
  const app = /<script data-app>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(app.includes(JSON.stringify(PKG.version)), 'compiled-in version');
  const runtime = resolveBuild({ regionText: json, defined: { version: PKG.version,
    sourceDigest: record.sourceDigest } });
  assert.deepEqual([runtime.origin, runtime.version, runtime.consistent],
    ['region', PKG.version, true]);
});

test('package-lock.json root carries the package.json version', () => {
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', ROOT), 'utf8'));
  assert.equal(lock.version, PKG.version);
  assert.equal(lock.packages[''].version, PKG.version);
});

test('no hard-coded current product version outside package.json, the lock and dist/', () => {
  const hits = findVersionLiterals(repositoryFiles(), PKG.version);
  assert.deepEqual(hits, [], `hard-coded ${PKG.version}:\n${hits.map((h) => `${h.path}:${h.line}`
    + ` ${h.text}`).join('\n')}`);
});

// release:prepare bumps package.json and then runs version:check, so a literal of a version
// the product has not reached yet is a release that fails in its gate on the day it is cut
// (round 2 of #163: a code comment named the next major's first three versions; round 3: a
// third-party version in docs/ sat two patches ahead). The horizon is the rest of the current
// major and the whole of the next one (rule project.release-flow-complete), so the finding
// lands on the pull request that writes the literal, not inside the release before it.
test('no version-shaped literal ahead of the product, up to the end of the next major', () => {
  const hits = findVersionsAhead(repositoryFiles(ROOT.pathname), PKG.version)
    .map((h) => `${h.version} in ${h.path}:${h.line}: ${h.text}`);
  assert.deepEqual(hits, [], 'version:check will refuse these once the product gets there. '
    + 'Write X.Y.Z; a third-party version as package@1.2.3 (or @1.2.3); a fixture version on '
    + 'major 40');
});

test('the ahead scan: above the current version, within one major, same shape rules', () => {
  const at = (version, text, o) => findVersionsAhead([{ path: 'docs/x.md', content: text }],
    version, o).map((h) => h.version);
  const text = ['40.2.3 v40.2.4 40.2.5-rc.1 40.3.0 41.0.0 41.9.9 42.0.0 40.2.2 40.1.9 39.9.9',
    'lib@40.9.9 @40.9.8 140.9.7 40.9.6.1 /40.9.5 a40.9.4 40.9'].join('\n');
  assert.deepEqual(at('40.2.3', text), ['40.2.4', '40.2.5', '40.3.0', '41.0.0', '41.9.9']);
  // a candidate: the release it becomes is ahead of it
  assert.deepEqual(at('40.2.3-rc.1', '40.2.3 40.2.3-rc.2 40.2.2'), ['40.2.3', '40.2.3']);
  // a bump inside a major only narrows the range; entering a major adds the one after it
  assert.deepEqual(at('40.3.0', text), ['41.0.0', '41.9.9']);
  assert.deepEqual(at('41.0.0-rc.1', text), ['41.0.0', '41.9.9', '42.0.0']);
  assert.deepEqual(at('40.2.3', text, { majorsAhead: 0 }), ['40.2.4', '40.2.5', '40.3.0']);
  // the allowlist of the current-version scan applies
  for (const path of ['package.json', 'dist/index.html', '.ai/repo/x.md', 'CHANGELOG.md',
    'docs/specs/v4.md']) {
    assert.deepEqual(findVersionsAhead([{ path, content: '40.2.4' }], '40.2.3'), []);
  }
  assert.deepEqual(findVersionsAhead([{ path: 'a.png', content: Buffer.from('\u000040.2.4') }],
    '40.2.3'), []);
  const [hit] = findVersionsAhead([{ path: 'src/a.js', content: 'a\n  x 40.2.4 y\n' }], '40.2.3');
  assert.deepEqual(hit, { version: '40.2.4', path: 'src/a.js', line: 2, text: 'x 40.2.4 y' });
});

test('the literal scan catches plain and v-prefixed copies and ignores look-alikes', () => {
  const v = '40.8.7';
  const files = [
    { path: 'src/a.js', content: `export const V = '${v}';` },
    { path: 'src/b.html', content: `<span>v${v}</span>` },
    { path: 'tests/c.cjs', content: `x === "${v}-rc.1"` },
    { path: 'src/ok.js', content: `lib@${v} 1${v} ${v}.1 ${v}0 a${v} /${v}` },
    { path: 'package.json', content: `"version": "${v}"` },
    { path: 'dist/index.html', content: `OSCILLA v${v}` },
    { path: '.ai/repo/decisions.md', content: `released v${v}` },
    { path: 'site/x.png', content: Buffer.from([0, 57, 46, 56, 46, 55]) },
  ];
  const hits = findVersionLiterals(files, v).map((h) => h.path);
  assert.deepEqual(hits, ['src/a.js', 'src/b.html', 'tests/c.cjs']);
  assert.ok(versionLiteralPattern(v).test(`'${v}'`));
});

test('config export stamps the product version; the schema version stays 1', () => {
  const doc = buildConfigExport({ oscillaVersion: BUILD.version, instrument: {},
    now: new Date(0) });
  assert.equal(doc.oscillaVersion, PKG.version);
  assert.equal(doc.version, 1);
});

test('config import accepts other 2.x (and later) product versions', () => {
  const siblings = ['patch', 'minor', 'major'].map((l) => bumpVersion(PKG.version, l));
  const pre = bumpVersion(PKG.version, 'prerelease', { preLevel: 'minor' });
  for (const other of [...siblings, pre, '']) {
    const doc = buildConfigExport({ oscillaVersion: other, instrument: { frequency: 440 },
      now: new Date(0) });
    const parsed = parseConfigImport(JSON.stringify(doc));
    assert.equal(parsed.ok, true, `${other}: ${parsed.errors.join('; ')}`);
  }
  const wrongSchema = parseConfigImport(JSON.stringify({ version: 2, oscillaVersion: '2.1.0' }));
  assert.equal(wrongSchema.ok, false); // the schema version, not the product version, gates
});
