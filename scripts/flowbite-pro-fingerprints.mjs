#!/usr/bin/env node
// Fingerprints of the licensed Flowbite Pro sources, for rule project.ui-uses-flowbite-pro
// (ADR 0061): OSCILLA is a public repository, so no Pro source file may be committed in it.
// tests/unit/ui-flowbite-pro.test.mjs imports fingerprint() from here and refuses every tracked
// file whose fingerprint is in tests/unit/flowbite-pro-fingerprints.json. A fingerprint is the
// first 16 hex characters of the SHA-256 of the file (a text file with CRLF read as LF), so
// the record names no Pro content and cannot be turned back into it.
//
//   node scripts/flowbite-pro-fingerprints.mjs <licensed-flowbite-vendor-dir> [--out <file>]
//
// <licensed-flowbite-vendor-dir> is the owner's licensed copy (the directory holding
// flowbite-admin-dashboard-*, flowbite-pro-*, flowbite-react-blocks-*, publisher-ui-blocks-*).
// Files under node_modules and .git, and files below MIN_BYTES, are not fingerprinted: a
// small file (an empty module, a two-line PostCSS config) is common to many projects and
// would refuse OSCILLA's own. Without --out the record is printed.
//
// Exit 0: written or printed. Exit 2: usage.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_BYTES = 512;
export const DIGEST_CHARS = 16;
const TEXT = /\.(html?|[cm]?js|jsx|tsx?|css|json|md|svg|txt|ya?ml|heex|astro|vue)$/i;

/** The fingerprint of a file's bytes, or null for a file below MIN_BYTES. */
export function fingerprint(name, bytes) {
  let data = Buffer.from(bytes);
  if (TEXT.test(name)) data = Buffer.from(data.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
  if (data.length < MIN_BYTES) return null;
  return createHash('sha256').update(data).digest('hex').slice(0, DIGEST_CHARS);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** The record of every fingerprintable file under `root`. */
export function fingerprintsOf(root) {
  const packages = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const files = walk(root);
  const prints = new Set();
  for (const f of files) {
    if (!statSync(f).size) continue;
    const p = fingerprint(f, readFileSync(f));
    if (p) prints.add(p);
  }
  return {
    note: 'Fingerprints of the licensed Flowbite Pro sources (rule project.ui-uses-flowbite-pro, '
      + 'ADR 0061): the first 16 hex characters of the SHA-256 of each file of at least '
      + `${MIN_BYTES} bytes (text with CRLF read as LF), node_modules and .git excluded. `
      + 'tests/unit/ui-flowbite-pro.test.mjs refuses every tracked file whose fingerprint is '
      + 'listed. Regenerate with node scripts/flowbite-pro-fingerprints.mjs <vendor-dir> --out '
      + 'tests/unit/flowbite-pro-fingerprints.json when the licensed set changes; a '
      + 'regeneration only adds fingerprints.',
    packages,
    min_bytes: MIN_BYTES,
    digest_chars: DIGEST_CHARS,
    fingerprints: [...prints].sort(),
  };
}

function main(argv) {
  const out = argv.indexOf('--out');
  const target = out >= 0 ? argv[out + 1] : null;
  const dirs = argv.filter((a, i) => out < 0 || (i !== out && i !== out + 1));
  if (dirs.length !== 1 || (out >= 0 && !target)) {
    process.stderr.write('usage: node scripts/flowbite-pro-fingerprints.mjs '
      + '<licensed-flowbite-vendor-dir> [--out <file>]\n');
    return 2;
  }
  const text = `${JSON.stringify(fingerprintsOf(dirs[0]), null, 2)}\n`;
  if (target) writeFileSync(target, text);
  else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
