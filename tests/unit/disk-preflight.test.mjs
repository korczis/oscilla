// scripts/disk-preflight.mjs: a nearly full disk is named as the cause before a gate starts.
//
// On 2026-10-28 the shared Mac fell to 128 MB free; commits and `majordomus doctor` then failed
// with layer FAILs that named no disk, and sessions debugged the layer. `npm run verify` and
// `npm run release-gate` now start with the preflight, which refuses below OSC_DISK_MIN_MB
// (default 2048) free on the repository's file system or the temporary directory's.
//   node --test tests/unit/disk-preflight.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diskPreflight, minFreeMb } from '../../scripts/disk-preflight.mjs';

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

test('OSC_DISK_MIN_MB is a positive number of MB; 0, a negative or a word is refused', () => {
  assert.equal(minFreeMb({}), 2048);
  assert.equal(minFreeMb({ OSC_DISK_MIN_MB: '512' }), 512);
  for (const v of ['0', '-1', 'none', '', '1e9x']) {
    assert.throws(() => minFreeMb({ OSC_DISK_MIN_MB: v }), /OSC_DISK_MIN_MB/, v);
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'disk-preflight.mjs')], {
    encoding: 'utf8', env: { ...process.env, OSC_DISK_MIN_MB: '0' },
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /OSC_DISK_MIN_MB must be a positive number/);
});

test('npm run verify and npm run release-gate start with the disk preflight', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const name of ['verify', 'release-gate']) {
    assert.match(scripts[name], /^node scripts\/disk-preflight\.mjs && /, name);
  }
});
