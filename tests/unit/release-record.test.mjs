// release:record against fake git/gh runners (nothing is read from GitHub here), and every
// committed .ai/repo/releases/*.yaml against release/v1 and against git where the tag is known.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, bannerComment } from '../../scripts/release-metadata.mjs';
import {
  ARTIFACT_KEYS, RECORD_KEYS, RECORD_REQUIRED, RECORDS_DIR, REQUIRED_TARGETS, WEB_TARGET,
  artifactEntry, assetUrl, channelFor, gatherRecord, main, parseRecord, recordDifferences,
  recordFile, recordProblems, releaseAssetName, renderRecord,
} from '../../scripts/release-record.mjs';

const COMMIT = 'f187f664893ce0444c03629b0d8afa66d6d9f715';
const hex = (b) => createHash('sha256').update(b).digest('hex');
const distFor = (version) => Buffer.from(`<!doctype html>\n${bannerComment(version)}\n<p>x</p>\n`);

/** Fake git + gh for one published release; `o` overrides what each side answers. */
function fakeIo(version, o = {}) {
  const tag = `v${version}`;
  const dist = o.dist || distFor(version);
  const name = releaseAssetName(version);
  const published = o.asset === undefined ? dist : o.asset;
  const assets = o.assets || (published ? [{
    name, size: published.length, digest: `sha256:${hex(published)}`, url: assetUrl(tag, name),
  }] : []);
  const release = {
    tagName: tag, publishedAt: '2026-10-04T10:03:45Z', isDraft: false,
    isPrerelease: o.isPrerelease ?? /-/.test(version),
    url: `https://github.com/korczis/oscilla/releases/tag/${tag}`, assets, ...o.release,
  };
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr) => ({ status: 1, stdout: '', stderr });
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') {
      return o.ghMissing ? { status: 127, missing: true, stdout: '', stderr: 'ENOENT' } : ok('');
    }
    if (cmd === 'gh' && args[0] === 'auth') return o.ghAuth === false ? fail('no') : ok('');
    if (cmd === 'git' && args[0] === 'rev-parse') return o.noTag ? fail('') : ok(COMMIT);
    if (cmd === 'gh' && args[0] === 'api') return ok(o.remoteCommit || COMMIT);
    if (cmd === 'gh' && args[0] === 'release' && args[1] === 'view') {
      return o.noRelease ? fail('release not found') : ok(JSON.stringify(release));
    }
    if (cmd === 'git' && args[0] === 'show') return ok(dist);
    throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
  };
  return { run, download: () => published, calls };
}

test('channel: stable for a release, prerelease for a SemVer prerelease', () => {
  assert.equal(channelFor('40.1.0'), 'stable');
  assert.equal(channelFor('40.1.0-rc.1'), 'prerelease');
  assert.equal(channelFor('40.1.0-alpha'), 'prerelease');
  assert.throws(() => channelFor('40.1'), /not a semantic version/);
});

test('artifact sha256 and size are read off the bytes', () => {
  const bytes = Buffer.from('héllo\n');
  const a = artifactEntry({ target: WEB_TARGET, name: 'x.html', url: 'u', bytes });
  assert.equal(a.sha256, hex(bytes));
  assert.equal(a.size, 7); // bytes, not characters
  assert.deepEqual(Object.keys(a), ARTIFACT_KEYS);
});

test('a gathered record satisfies release/v1: required fields, types, one web artifact', () => {
  const io = fakeIo('40.0.0');
  const r = gatherRecord({ version: '40.0.0', io });
  assert.deepEqual(recordProblems(r), []);
  for (const k of RECORD_REQUIRED) assert.ok(k in r, `${k} present`);
  assert.equal(r.schema, 'release/v1');
  assert.equal(r.version, '40.0.0');
  assert.equal(r.tag, 'v40.0.0');
  assert.equal(r.channel, 'stable');
  assert.equal(r.commit, COMMIT);
  assert.match(r.published_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.match(r.notes_url, /^https:\/\/github\.com\/korczis\/oscilla\/releases\/tag\/v40\.0\.0$/);
  assert.deepEqual(r.required_targets, REQUIRED_TARGETS);
  assert.equal(r.artifacts.length, 1);
  const [a] = r.artifacts;
  assert.equal(a.target, 'web');
  assert.equal(a.name, 'oscilla-v40.0.0.html');
  assert.equal(a.url,
    'https://github.com/korczis/oscilla/releases/download/v40.0.0/oscilla-v40.0.0.html');
  assert.equal(a.sha256, hex(distFor('40.0.0')));
  assert.equal(a.size, distFor('40.0.0').length);
  assert.ok(Number.isInteger(a.size));
  // the record reads git and GitHub only; it never writes to either
  assert.ok(io.calls.every((c) => !['upload', 'create', 'edit', 'delete', 'push', 'tag']
    .includes(c[2]) && c[1] !== 'push'));
});

test('a SemVer prerelease is recorded on the prerelease channel', () => {
  const r = gatherRecord({ version: '40.1.0-rc.1', io: fakeIo('40.1.0-rc.1') });
  assert.equal(r.channel, 'prerelease');
  assert.equal(r.tag, 'v40.1.0-rc.1');
  assert.deepEqual(recordProblems(r), []);
  assert.throws(() => gatherRecord({ version: '40.1.0-rc.1',
    io: fakeIo('40.1.0-rc.1', { isPrerelease: false }) }), /^Error: channel: /);
  assert.throws(() => gatherRecord({ version: '40.1.0',
    io: fakeIo('40.1.0', { isPrerelease: true }) }), /^Error: channel: /);
});

test('render and parse round-trip; the file carries the evidence header', () => {
  const r = gatherRecord({ version: '40.0.0', io: fakeIo('40.0.0') });
  const text = renderRecord(r);
  assert.match(text, /^# Written by scripts\/release-record\.mjs from what was published\.\n/);
  assert.match(text, /\n# Evidence, not a plan: /);
  assert.match(text, /\nversion: "40\.0\.0"\n/);
  assert.deepEqual(parseRecord(text), r);
  assert.deepEqual(recordDifferences(parseRecord(text), r), []);
  assert.throws(() => parseRecord(`${text}  stray: 1\n`), /line \d+: unexpected/);
});

test('recordProblems names the field for each release/v1 violation', () => {
  const r = gatherRecord({ version: '40.0.0', io: fakeIo('40.0.0') });
  const bad = (patch, re) => assert.match(recordProblems({ ...r, ...patch }).join('\n'), re);
  bad({ commit: 'abc' }, /^commit: /m);
  bad({ tag: 'v40.0.1' }, /^tag: v40\.0\.1 is not v40\.0\.0/m);
  bad({ channel: 'beta' }, /^channel: /m);
  bad({ published_at: '2026-10-04T10:03:45.123Z' }, /^published_at: /m);
  bad({ extra: 1 }, /^extra: not in release\/v1/m);
  bad({ artifacts: [] }, /^artifacts: not a non-empty list/m);
  bad({ artifacts: [{ ...r.artifacts[0], url: 'https://korczis.github.io/oscilla/' }] },
    /^artifacts\.0\.url: /m);
  bad({ artifacts: [{ ...r.artifacts[0], size: '12' }] }, /^artifacts\.0\.size: /m);
  bad({ artifacts: [{ ...r.artifacts[0], target: 'macos' }] }, /^artifacts: targets macos/m);
  const { schema: _s, ...noSchema } = r;
  assert.match(recordProblems(noSchema).join(), /schema: required/);
});

test('fails closed with what to do', () => {
  const refuse = (o, re, version = '40.0.0') => assert.throws(
    () => gatherRecord({ version, io: fakeIo(version, o) }), re);
  refuse({ ghMissing: true }, /gh \(GitHub CLI\) is required/);
  refuse({ ghAuth: false }, /gh is not authenticated: run gh auth login/);
  refuse({ noTag: true }, /tag v40\.0\.0 does not exist in this clone: git fetch --tags/);
  refuse({ remoteCommit: 'a'.repeat(40) }, /is f187f664893c here but aaaaaaaaaaaa on GitHub/);
  refuse({ noRelease: true }, /no GitHub Release for v40\.0\.0/);
  refuse({ release: { isDraft: true } }, /is a draft: not published/);
  const upload = 'gh release upload v40\\.0\\.0 oscilla-v40\\.0\\.0\\.html';
  refuse({ asset: null }, new RegExp(`has no asset oscilla-v40\\.0\\.0\\.html.*sha256 `
    + `${hex(distFor('40.0.0'))}[\\s\\S]*${upload}`));
  refuse({ asset: Buffer.from('other bytes') }, /is not the committed dist\/index\.html at/);
  refuse({ dist: distFor('39.0.0') }, /at v40\.0\.0 is the build of v39\.0\.0/);
  refuse({ assets: [
    { name: 'oscilla-v40.0.0.html', size: 1, url: assetUrl('v40.0.0', 'oscilla-v40.0.0.html') },
    { name: 'notes.txt', size: 1, url: assetUrl('v40.0.0', 'notes.txt') },
  ] }, /carries notes\.txt, which is not a target/);
  assert.throws(() => gatherRecord({ version: 'x', io: fakeIo('40.0.0') }), /not a semantic/);
});

test('write, --check, and a modified record is refused naming the field', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oscilla-record-test-'));
  const io = fakeIo('40.0.0');
  const out = [];
  const err = [];
  const cli = (argv) => main({ argv, root, io, log: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(cli(['--version', '40.0.0', '--check']), 1);
  assert.match(err.pop(), /v40\.0\.0\.yaml is missing/);
  assert.equal(cli(['--version', '40.0.0']), 0);
  const file = recordFile('40.0.0', root);
  assert.equal(path.relative(root, file), `${RECORDS_DIR}/v40.0.0.yaml`);
  assert.match(out.pop(), /written: v40\.0\.0 stable/);
  assert.equal(cli(['--version', '40.0.0', '--check']), 0);
  assert.equal(cli(['--version', '40.0.0']), 0);
  assert.match(out.pop(), /unchanged/);

  const good = readFileSync(file, 'utf8');
  const sha = gatherRecord({ version: '40.0.0', io }).artifacts[0].sha256;
  writeFileSync(file, good.replace(sha, '0'.repeat(64)));
  assert.equal(cli(['--version', '40.0.0', '--check']), 1);
  assert.match(err.pop(), /immutable evidence:\n {2}artifacts\.0\.sha256 /);
  assert.equal(cli(['--version', '40.0.0']), 1, 'writing never replaces a differing record');
  err.pop();
  writeFileSync(file, good.replace('published_at: "2026-10-04T10:03:45Z"',
    'published_at: "2026-10-05T10:03:45Z"'));
  assert.equal(cli(['--version', '40.0.0', '--check']), 1);
  assert.match(err.pop(), /published_at /);
  writeFileSync(file, `${good}\n`);
  assert.equal(cli(['--version', '40.0.0', '--check']), 1);
  assert.match(err.pop(), /formatting/);

  assert.equal(cli([]), 2);
  assert.match(err.pop(), /--version X\.Y\.Z is required/);
  assert.equal(cli(['--bogus']), 2);
});

// The contract lists restated in the script equal the installed Majordomus schema, when one
// is installed (CI has none; the knowledge index checks the records there instead).
test('the restated contract equals the installed release/v1 schema', (t) => {
  const base = path.join(os.homedir(), '.local/share/majordomus/versions');
  const rel = 'share/schemas/majordomus/release/release.v1.schema.json';
  const file = existsSync(base) && readdirSync(base).sort().reverse()
    .map((v) => path.join(base, v, rel)).find((f) => existsSync(f));
  if (!file) {
    t.skip('Majordomus is not installed here');
    return;
  }
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([...RECORD_REQUIRED].sort(), [...schema.required].sort());
  assert.deepEqual([...RECORD_KEYS].sort(), Object.keys(schema.properties).sort());
  const item = schema.properties.artifacts.items;
  assert.deepEqual([...ARTIFACT_KEYS].sort(), [...item.required].sort());
  assert.deepEqual([...ARTIFACT_KEYS].sort(), Object.keys(item.properties).sort());
  const r = gatherRecord({ version: '40.0.0', io: fakeIo('40.0.0') });
  assert.match(r.artifacts[0].url, new RegExp(item.properties.url.pattern));
  assert.match(r.version, new RegExp(schema.properties.version.pattern));
  assert.match(r.published_at, new RegExp(schema.properties.published_at.pattern));
});

const git = (args) => {
  try {
    // dist/index.html is larger than execFileSync's 1 MiB default buffer
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

test('every committed release record is valid, canonical and agrees with git', () => {
  const dir = path.join(ROOT, RECORDS_DIR);
  assert.ok(existsSync(path.join(dir, 'README.md')), `${RECORDS_DIR}/README.md exists`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  for (const f of files) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    const r = parseRecord(text);
    assert.deepEqual(recordProblems(r), [], f);
    for (const k of RECORD_REQUIRED) assert.ok(r[k] !== undefined, `${f}: ${k}`);
    assert.equal(f, `${r.tag}.yaml`, `${f}: file name is the tag`);
    assert.equal(r.tag, `v${r.version}`, f);
    assert.equal(r.channel, channelFor(r.version), `${f}: channel`);
    assert.equal(renderRecord(r), text, `${f}: the bytes release-record.mjs writes`);
    const web = r.artifacts.find((a) => a.target === WEB_TARGET);
    assert.ok(web, `${f}: a web artifact`);
    assert.equal(web.name, releaseAssetName(r.version), f);
    assert.equal(web.url, assetUrl(r.tag, web.name), f);
    // where this clone has the tag (CI checks out without tags), the record agrees with git
    const tagged = git(['rev-parse', '-q', '--verify', `refs/tags/${r.tag}^{commit}`]);
    if (!tagged) continue;
    assert.equal(tagged.toString().trim(), r.commit, `${f}: commit is the tag's`);
    const dist = git(['show', `${r.commit}:dist/index.html`]);
    assert.ok(dist, `${f}: dist/index.html is readable at the tag`);
    assert.equal(hex(dist), web.sha256, `${f}: sha256 of dist/index.html at the tag`);
    assert.equal(dist.length, web.size, `${f}: size of dist/index.html at the tag`);
    const pkg = JSON.parse(git(['show', `${r.commit}:package.json`]).toString());
    assert.equal(pkg.version, r.version, `${f}: package.json version at the tag`);
  }
});
