// scripts/disk-preflight.mjs: a nearly full disk is named as the cause before a gate starts.
//
// On 2026-10-28 the shared Mac fell to 128 MB free; commits and `majordomus doctor` then failed
// with layer FAILs that named no disk, and sessions debugged the layer. `npm run verify` and
// `npm run release-gate` (through verify, once) now start with the preflight, which refuses
// below OSC_DISK_MIN_MB (default 2048) free on the repository's file system or the temporary
// directory's.
//   node --test tests/unit/disk-preflight.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diskPreflight, minFreeMb, UnreadableDisk } from '../../scripts/disk-preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MB = 1024 * 1024;
const statfsWith = (freeMb) => () => ({ bsize: 4096, bavail: Math.floor((freeMb * MB) / 4096) });

test('100 MB free is refused and the message names the disk and the remedy', () => {
  const r = diskPreflight({ dirs: ['/repo', '/tmp'], statfs: statfsWith(100), env: {} });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /disk: 100 MB free on \/repo < OSC_DISK_MIN_MB \(2048\)/);
  assert.match(r.lines.join('\n'), /node_modules of landed worktrees/);
});

test('10 GB free passes, and a low temporary directory alone is refused', () => {
  const ok = diskPreflight({ dirs: ['/repo', '/tmp'], statfs: statfsWith(10240), env: {} });
  assert.equal(ok.ok, true, ok.lines.join('\n'));
  const tmpLow = diskPreflight({
    dirs: ['/repo', '/tmp'], env: {},
    statfs: (d) => (d === '/tmp' ? statfsWith(50)() : statfsWith(10240)()),
  });
  assert.equal(tmpLow.ok, false);
  assert.match(tmpLow.lines.join('\n'), /50 MB free on \/tmp/);
});

test('OSC_DISK_MIN_MB is at least 256 MB; 0, a tiny value, a negative or a word is refused', () => {
  assert.equal(minFreeMb({}), 2048);
  assert.equal(minFreeMb({ OSC_DISK_MIN_MB: '512' }), 512);
  assert.equal(minFreeMb({ OSC_DISK_MIN_MB: '256' }), 256);
  for (const v of ['0', '0.001', '1', '255.9', '-1', 'none', '', '1e9x']) {
    assert.throws(() => minFreeMb({ OSC_DISK_MIN_MB: v }), /OSC_DISK_MIN_MB/, v);
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'disk-preflight.mjs')], {
    encoding: 'utf8', env: { ...process.env, OSC_DISK_MIN_MB: '0' },
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /OSC_DISK_MIN_MB must be a number of MB of at least 256/);
});

test('a free space that cannot be read is its own failure, not a bad threshold', () => {
  const statfs = () => {
    throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
  };
  assert.throws(() => diskPreflight({ dirs: ['/gone'], env: {}, statfs }), (e) => e instanceof
    UnreadableDisk && /cannot read the free space of \/gone: ENOENT/.test(e.message));
});

test('npm run verify starts with the disk preflight, and release-gate with verify, once', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(scripts.verify, /^node scripts\/disk-preflight\.mjs && /);
  assert.match(scripts['release-gate'], /^npm run verify && /);
  assert.doesNotMatch(scripts['release-gate'], /disk-preflight/, 'verify already runs it');
});
