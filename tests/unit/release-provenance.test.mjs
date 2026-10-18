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
const TAGGED = { release: 'tagged', distance: 0 }; // the release state of a release commit

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
  has(stampHtml(DIST, { commit: COMMIT, sourceDate: DATE, ...TAGGED }), /must be unstamped/);
});

test('stamp: rewrites only the region, is idempotent, and normalise reverses it', () => {
  const stamped = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE, ...TAGGED });
  const { record, start } = findRegion(stamped);
  assert.deepEqual(record, { ...sourceRecord({ version: PKG.version, sourceDigest: DIGEST }),
    schema: 2, channel: 'production', commit: COMMIT, shortCommit: 'f187f66', sourceDate: DATE,
    artifactSha256: sha256(DIST), ...TAGGED });
  assert.equal(stampHtml(stamped, { commit: COMMIT, sourceDate: DATE, ...TAGGED }), stamped);
  assert.equal(normalizeStamped(stamped), DIST);
  assert.equal(normalizeStamped(DIST), DIST);
  assert.equal(stamped.slice(0, start), DIST.slice(0, start)); // bytes before the region
  const tail = stamped.length - stamped.indexOf('</script>', start);
  assert.equal(stamped.slice(-tail), DIST.slice(-tail)); // bytes after the region
  assert.throws(() => stampHtml(DIST, { commit: 'abc', sourceDate: DATE, ...TAGGED }),
    /refusing to stamp/);
  assert.throws(() => stampHtml(DIST, { commit: COMMIT, sourceDate: 'yesterday', ...TAGGED }),
    /sourceDate/);
});

test('verify-deploy: a correctly stamped deployment passes', () => {
  const html = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE, ...TAGGED });
  const expected = { commit: COMMIT, version: PKG.version, sourceDigest: DIGEST, sourceDate: DATE,
    release: TAGGED };
  assert.deepEqual(checkLive({ html, dist: DIST, url: URL_, expected }), []);
});

test('verify-deploy: every mismatch is a problem', () => {
  const html = stampHtml(DIST, { commit: COMMIT, sourceDate: DATE, ...TAGGED });
  const expected = { commit: COMMIT, version: PKG.version, sourceDigest: DIGEST, sourceDate: DATE,
    release: TAGGED };
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

// ---------------------------------------------------------------- V272 D1: release state
// Pages deploys every push to main and stamps the version of package.json, so after a release
// every later commit carried the release's bare version (review V272: 2d56148, 20 commits after
// the tag, labelled with the release's version). The stamp now records where the commit
// stands relative to v<version>, and only the tag's own commit (or the release commit
// deployed before its tag existed) shows the bare version; any later commit is
// <version>+<distance>.g<short> (git-describe style).
const OLDER = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';

/** A git runner for releaseState(): v40.1.0 at `tagAt`, `count` commits from it to COMMIT. */
function fakeGit({ shallow = 'false', tags = 'v40.0.0\nv40.1.0', tagAt = COMMIT, ancestor = true,
  count = '3' } = {}) {
  return (args) => {
    const a = args.join(' ');
    if (a === 'rev-parse --is-shallow-repository') return shallow;
    if (a === 'tag --list v*') return tags;
    if (a.startsWith('rev-parse -q --verify refs/tags/v40.1.0')) {
      if (!tagAt) throw new Error('exit 1');
      return tagAt;
    }
    if (a.startsWith('rev-parse -q --verify refs/tags/')) throw new Error('exit 1');
    if (a === `merge-base --is-ancestor ${tagAt} ${COMMIT}`) {
      if (!ancestor) throw new Error('exit 1');
      return '';
    }
    if (a === `rev-list --count ${tagAt}..${COMMIT}`) return count;
    throw new Error(`unexpected git ${a}`);
  };
}

test('V272 D1: the stamp records the release state and a later build does not show the bare '
  + 'version', async () => {
  const meta = await import('../../scripts/release-metadata.mjs');
  const { resolveBuild } = await import('../../src/js/core/build-info.js');
  assert.equal(typeof meta.releaseState, 'function', 'release-metadata exports releaseState');
  const state = (o, version = '40.1.0') => meta.releaseState({ version, commit: COMMIT,
    run: fakeGit(o) });
  assert.deepEqual(state({}), { release: 'tagged', distance: 0, tag: 'v40.1.0' });
  assert.deepEqual(state({ tagAt: OLDER }), { release: 'after-tag', distance: 3,
    tag: 'v40.1.0' });
  assert.deepEqual(state({}, '40.2.0'), { release: 'untagged', distance: null, tag: 'v40.2.0' });
  assert.throws(() => state({ shallow: 'true' }), /shallow/);
  assert.throws(() => state({ tags: '' }), /no v\* tag/);
  assert.throws(() => state({ tagAt: OLDER, ancestor: false }), /not an ancestor/);

  const stamp = (release, distance) => stampHtml(DIST, { commit: COMMIT, sourceDate: DATE,
    release, distance });
  const after = stamp('after-tag', 3);
  const rec = findRegion(after).record;
  assert.equal(rec.schema, 2);
  assert.equal(rec.release, 'after-tag');
  assert.equal(rec.distance, 3);
  assert.deepEqual(validateRecord(rec), []);
  assert.equal(normalizeStamped(after), DIST, 'the stamp stays region-only and reversible');
  const label = `${PKG.version}+3.gf187f66`;
  assert.equal(meta.releaseLabel(rec), label);
  const build = resolveBuild({ regionText: JSON.stringify(rec) });
  assert.equal(build.label, label, 'the page names itself a post-release build');
  assert.equal(build.version, PKG.version, 'window.OSCILLA.version stays package.json');
  for (const [release, distance] of [['tagged', 0], ['untagged', null]]) {
    const r = findRegion(stamp(release, distance)).record;
    assert.equal(meta.releaseLabel(r), PKG.version);
    assert.equal(resolveBuild({ regionText: JSON.stringify(r) }).label, PKG.version);
  }
  assert.equal(resolveBuild({ regionText: JSON.stringify(findRegion(DIST).record) }).label,
    PKG.version, 'a source build keeps its version');
  for (const [release, distance] of [['tagged', 2], ['after-tag', 0], ['after-tag', null],
    ['untagged', 0], ['released', 0]]) {
    assert.ok(validateRecord({ ...rec, release, distance }).some((p) => /release|distance/.test(p)),
      `${release}/${distance} is refused`);
  }
  assert.throws(() => stampHtml(DIST, { commit: COMMIT, sourceDate: DATE }), /release/);

  // verify-deploy compares the stamp with what git says now
  const expected = { commit: COMMIT, version: PKG.version, sourceDigest: DIGEST,
    sourceDate: DATE };
  const live = (html, release, distance) => checkLive({ html, dist: DIST, url: URL_,
    expected: { ...expected, release: { release, distance } } });
  assert.deepEqual(live(after, 'after-tag', 3), []);
  assert.deepEqual(live(stamp('tagged', 0), 'tagged', 0), []);
  // the release commit is deployed when its chore(release) merges, before release:publish
  // tags it; once tagged, that page is the release
  assert.deepEqual(live(stamp('untagged', null), 'tagged', 0), []);
  assert.deepEqual(live(stamp('untagged', null), 'untagged', null), []);
  const refused = (html, release, distance) => assert.ok(
    live(html, release, distance).some((p) => /^release:/.test(p)),
    `${findRegion(html).record.release} vs ${release}`);
  refused(after, 'tagged', 0); // a later build that says it is the release
  refused(stamp('tagged', 0), 'after-tag', 3);
  refused(stamp('untagged', null), 'after-tag', 3); // the tag landed on another commit
  refused(after, 'after-tag', 4);
  // a page stamped before this rule (schema 1, no release state) is refused
  const old = DIST.replace(findRegion(DIST).json, JSON.stringify({ ...findRegion(DIST).record,
    channel: 'production', commit: COMMIT, shortCommit: 'f187f66', sourceDate: DATE,
    artifactSha256: sha256(DIST) }));
  assert.ok(live(old, 'after-tag', 3).length > 0);
});
