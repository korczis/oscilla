// Build provenance: source digest, the metadata region, the deploy stamp and its reversal,
// verify-dist's provenance gate and verify-deploy's live checks. Expected versions come from
// package.json; fixture versions use major 40 so version:check never mistakes them.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  bannerComment, computeSourceDigest, digestEntries, findRegion, gitInfo, listSourceInputs,
  normalizeStamped, readBanner, readRegion, releaseMetadata, renderRegion, sha256, sourceManifest,
  sourceRecord, stampHtml, validateRecord, REGION_OPEN,
} from '../../scripts/release-metadata.mjs';
import { pack } from '../../scripts/pack-single-file.mjs';
import { verifyProvenance } from '../../scripts/verify-dist.mjs';
import { checkAsset, checkLive } from '../../scripts/verify-deploy.mjs';

const ROOT = new URL('../../', import.meta.url);
const PKG = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const DIST = readFileSync(new URL('dist/index.html', ROOT), 'utf8');
const DIGEST = computeSourceDigest();
const COMMIT = 'f187f664893ce0444c03629b0d8afa66d6d9f715';
const DATE = '2026-10-02T03:32:49Z';
const URL_ = 'https://korczis.github.io/oscilla/';

test('source digest: order-independent, sensitive to content and to paths', () => {
  const a = [{ path: 'src/a.js', content: 'x' }, { path: 'package.json', content: '{}' }];
  const b = [...a].reverse();
  assert.equal(digestEntries(a), digestEntries(b));
  assert.notEqual(digestEntries(a), digestEntries([{ ...a[0], content: 'y' }, a[1]]));
  assert.notEqual(digestEntries(a), digestEntries([{ ...a[0], path: 'src/b.js' }, a[1]]));
  assert.equal(sourceManifest(a), `${sha256('{}')}  package.json\n${sha256('x')}  src/a.js\n`);
  assert.throws(() => digestEntries([a[0], a[0]]), /duplicate/);
});

test('source inputs: src/**, licenses/**, LICENSE, package and build files; no dotfiles', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-inputs-'));
  for (const f of ['src/js/a.js', 'src/.DS_Store', 'licenses/x.LICENSE', 'scripts/build.mjs',
    'scripts/build-config.mjs', 'scripts/verify-dist.mjs', 'scripts/pack-single-file.mjs',
    'LICENSE', 'package.json', 'package-lock.json', 'README.md', 'tests/t.mjs']) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), f);
  }
  assert.deepEqual(listSourceInputs(dir), ['LICENSE', 'licenses/x.LICENSE', 'package-lock.json',
    'package.json', 'scripts/build-config.mjs', 'scripts/build.mjs',
    'scripts/pack-single-file.mjs', 'src/js/a.js']);
  const real = listSourceInputs();
  for (const p of ['src/index.html', 'src/js/main.js', 'LICENSE', 'package.json',
    'package-lock.json', 'scripts/build.mjs', 'scripts/build-config.mjs',
    'scripts/pack-single-file.mjs', 'scripts/release-metadata.mjs']) assert.ok(real.includes(p), p);
  assert.ok(!real.some((p) => p.startsWith('dist/') || p.startsWith('tests/')));
});

test('releaseMetadata: version, digest, git facts and channel from injected inputs', () => {
  const run = (args) => {
    if (args[0] === 'rev-parse') return COMMIT;
    if (args[0] === 'status') return ' M src/x.js';
    if (args[0] === 'show') return '1790911969';
    throw new Error(args.join(' '));
  };
  const entries = [{ path: 'src/a.js', content: 'x' }];
  const m = releaseMetadata({ run, env: {}, entries });
  assert.deepEqual(m, { version: PKG.version, sourceDigest: digestEntries(entries), commit: COMMIT,
    shortCommit: 'f187f66', sourceDate: DATE, dirty: true, channel: 'source' });
  assert.deepEqual(gitInfo({ run: () => { throw new Error('no git'); } }),
    { commit: null, shortCommit: null, sourceDate: null, dirty: null });
});

test('region: canonical render, exactly one, validated', () => {
  const rec = sourceRecord({ version: '40.1.0', sourceDigest: DIGEST });
  const html = `<!doctype html>\n<head>${renderRegion(rec)}</head>`;
  assert.deepEqual(findRegion(html).record, rec);
  assert.deepEqual(validateRecord(rec), []);
  assert.throws(() => findRegion(`${html}${renderRegion(rec)}`), /found 2 times/);
  assert.equal(readRegion('<!doctype html>'), null);
  assert.match(validateRecord({ ...rec, commit: COMMIT }).join(), /commit null/);
  assert.match(validateRecord({ ...rec, version: 'v2' }).join(), /version/);
  assert.ok(!renderRegion({ ...rec, version: '</script><b>' }).includes('</script><b>'));
});

test('the committed dist: banner + one source region naming package.json and the digest', () => {
  assert.equal(readBanner(DIST), PKG.version);
  assert.ok(DIST.startsWith(`<!doctype html>\n${bannerComment(PKG.version)}\n<!--\n`));
  assert.deepEqual(verifyProvenance(DIST, { version: PKG.version, sourceDigest: DIGEST }), []);
  const { record } = findRegion(DIST);
  assert.deepEqual(record, sourceRecord({ version: PKG.version, sourceDigest: DIGEST }));
});

test('verify-dist provenance: missing banner/region, wrong version, stale digest, stamped', () => {
  const ok = { version: PKG.version, sourceDigest: DIGEST };
  const has = (html, re, o = ok) => assert.ok(verifyProvenance(html, o).some((p) => re.test(p)),
    `${re} in ${JSON.stringify(verifyProvenance(html, o))}`);
  has(DIST.replace(bannerComment(PKG.version), '<!-- x -->'), /banner comment missing/);
  has(DIST, /banner names/, { ...ok, version: '40.0.0' });
  has(DIST, /region version .* != package\.json 40\.0\.0/, { ...ok, version: '40.0.0' });
  has(DIST, /sourceDigest .* != recomputed/, { ...ok, sourceDigest: 'b'.repeat(64) });
  has(DIST.replace(REGION_OPEN, '<script type="application/json" id="other">'), /found 0 times/);
  has(stampHtml(DIST, { commit: COMMIT, sourceDate: DATE }), /must be unstamped/);
});

test('stamp: rewrites only the region, is idempotent, and normalise reverses it', () => {
  const stamped = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE });
  const { record, start } = findRegion(stamped);
  assert.deepEqual(record, { ...sourceRecord({ version: PKG.version, sourceDigest: DIGEST }),
    channel: 'production', commit: COMMIT, shortCommit: 'f187f66', sourceDate: DATE,
    artifactSha256: sha256(DIST) });
  assert.equal(stampHtml(stamped, { commit: COMMIT, sourceDate: DATE }), stamped);
  assert.equal(normalizeStamped(stamped), DIST);
  assert.equal(normalizeStamped(DIST), DIST);
  assert.equal(stamped.slice(0, start), DIST.slice(0, start)); // bytes before the region
  const tail = stamped.length - stamped.indexOf('</script>', start);
  assert.equal(stamped.slice(-tail), DIST.slice(-tail)); // bytes after the region
  assert.throws(() => stampHtml(DIST, { commit: 'abc', sourceDate: DATE }), /refusing to stamp/);
  assert.throws(() => stampHtml(DIST, { commit: COMMIT, sourceDate: 'yesterday' }), /sourceDate/);
});

test('verify-deploy: a correctly stamped deployment passes', () => {
  const html = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE });
  const expected = { commit: COMMIT, version: PKG.version, sourceDigest: DIGEST, sourceDate: DATE };
  assert.deepEqual(checkLive({ html, dist: DIST, url: URL_, expected }), []);
});

test('verify-deploy: every mismatch is a problem', () => {
  const html = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE });
  const expected = { commit: COMMIT, version: PKG.version, sourceDigest: DIGEST, sourceDate: DATE };
  const has = (o, re) => {
    const p = checkLive({ html, dist: DIST, url: URL_, expected, ...o });
    assert.ok(p.some((x) => re.test(x)), `${re} in ${JSON.stringify(p)}`);
  };
  has({ html: DIST }, /channel "source", expected "production"/); // deployed unstamped
  has({ html: DIST.replace(/<script type="application\/json" id="oscilla-build">.*?<\/script>/,
    '') }, /region: .*found 0 times/); // a pre-provenance deployment
  has({ expected: { ...expected, commit: 'e'.repeat(40) } }, /^commit:/);
  has({ expected: { ...expected, version: '40.0.0' } }, /^version:/);
  has({ expected: { ...expected, sourceDigest: 'b'.repeat(64) } }, /^digest:/);
  has({ expected: { ...expected, sourceDate: '2020-01-01T00:00:00Z' } }, /^date:/);
  has({ html: html.replace('</body>', ' </body>') }, /^bytes:/);
  has({ html: html.replace(/data-vendor="p5@/g, 'data-x="p5@') }, /vendor marker/);
  has({ html: html.replace('</body>', '<script type="module">1</script></body>') },
    /module script/);
  has({ url: 'https://example.org/' }, /^og:/);
  has({ dist: `${DIST} ` }, /^artifact:/);
});

test('verify-deploy: share assets must be PNG and byte-equal', () => {
  const png = Buffer.from([137, 80, 78, 71]);
  assert.deepEqual(checkAsset({ name: 'og-image.png', status: 200, contentType: 'image/png',
    body: png, expected: png }), []);
  assert.equal(checkAsset({ name: 'og-image.png', status: 404, contentType: 'text/html',
    body: Buffer.from('x'), expected: png }).length, 3);
});

test('pack: banner first, then the notice; the build-info marker is required when given', () => {
  const template = '<!doctype html>\n<html><head><!-- @build-info --><!-- @inline-css --></head>'
    + '<body><!-- @inline-js --></body></html>\n';
  const region = renderRegion(sourceRecord({ version: '40.0.0', sourceDigest: DIGEST }));
  const html = pack({ template, css: '', js: '', notice: 'n', banner: bannerComment('40.0.0'),
    buildInfo: region, icon: () => '' });
  assert.ok(html.startsWith('<!doctype html>\n<!-- OSCILLA v40.0.0 — generated from src/, do not '
    + 'edit -->\n<!--\nn\n-->\n<html><head><script type="application/json"'));
  assert.equal(readBanner(html), '40.0.0');
  assert.throws(() => pack({ template, css: '', js: '', icon: () => '' }), /no buildInfo/);
  assert.throws(() => pack({ template, css: '', js: '', buildInfo: '<script>x</script>',
    icon: () => '' }), /inert/);
  assert.throws(() => pack({ template, css: '', js: '', buildInfo: region, banner: '<!-- a --> -->',
    icon: () => '' }), /single-line/);
});
