#!/usr/bin/env node
// Refuse to start a gate on a nearly full disk, and say that the disk is the cause.
//
//   node scripts/disk-preflight.mjs        # first command of `npm run verify` and `release-gate`
//
// On 2026-10-28 the shared Mac fell to 128 MB free. Commits and `majordomus doctor` then failed
// with Majordomus-layer FAILs that named no disk, and sessions debugged the layer instead. This
// checks the free space (fs.statfsSync, bytes available to this user) on the repository's file
// system and on os.tmpdir() (where the gates' browsers, fail-first trees and builds write) and
// exits 1 below OSC_DISK_MIN_MB (default 2048) on either. OSC_DISK_MIN_MB must be a positive
// number: 0 would turn the check off, so it is refused (exit 2) rather than obeyed.
// Majordomus I4323 (ENOSPC named in doctor) and I4324 (reclaim build output) own the general
// fix; this is the repository's guard until they land.
//
// Exit 0: enough space. Exit 1: too little. Exit 2: bad OSC_DISK_MIN_MB.

import { existsSync, realpathSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIN_MB = 2048;
const MB = 1024 * 1024;

/** The threshold in MB from the environment; throws on a value that is not a positive number. */
export function minFreeMb(env = process.env) {
  if (env.OSC_DISK_MIN_MB === undefined) return DEFAULT_MIN_MB;
  const raw = String(env.OSC_DISK_MIN_MB).trim();
  const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!(n > 0)) {
    throw new Error(`OSC_DISK_MIN_MB must be a positive number of MB, not ${JSON.stringify(raw)}`
      + ' (the check has no off switch)');
  }
  return n;
}

/** @returns {{ ok: boolean, lines: string[] }} */
export function diskPreflight({ dirs, statfs = statfsSync, env = process.env }) {
  const min = minFreeMb(env);
  const lines = [];
  let ok = true;
  for (const dir of [...new Set(dirs)]) {
    const s = statfs(dir);
    const free = Math.floor((Number(s.bavail) * Number(s.bsize)) / MB);
    if (free < min) {
      ok = false;
      lines.push(`disk: ${free} MB free on ${dir} < OSC_DISK_MIN_MB (${min}); the gate would fail`
        + ' with errors that do not name the disk');
    } else {
      lines.push(`disk: ${free} MB free on ${dir}`);
    }
  }
  if (!ok) {
    lines.push('disk: free space first: the node_modules of landed worktrees under'
      + ' ../oscilla-wt (about 100 MB each; `majordomus worktree list` shows which are landed),'
      + ' tests/visual/out-*, then retry');
  }
  return { ok, lines };
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let result;
  try {
    result = diskPreflight({ dirs: [root, os.tmpdir()] });
  } catch (e) {
    console.error(`disk-preflight: ${e.message}`);
    process.exit(2);
  }
  for (const l of result.lines) (result.ok ? console.log : console.error)(l);
  process.exit(result.ok ? 0 : 1);
}
