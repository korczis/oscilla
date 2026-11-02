#!/usr/bin/env node
// The content-rights check of the music library (plan issue K157, the owner's decisions
// Q079-Q082 of 2026-11-02: original-only, MIT as the code, the method recorded, symbolic only).
//
//   node scripts/content-rights.mjs [--dist dist/index.html]
//
// Fails when an entry of the riff library (src/js/studio/riffs/library.js)
//   - is not origin 'original', authored by 'OSCILLA' and licensed 'MIT' (Q079, Q080),
//   - records no method, or one outside METHODS (Q081),
//   - carries anything but symbolic notes: a field holding a data: URI, base64 audio or a link
//     to media (Q082), or a note that is not [step >= 0, pitch, length > 0, velocity 1..127],
//   - has the same id, or the same notes (its fingerprint), as another entry;
// and when dist/index.html carries audio of any kind: an <audio> element, a data:audio URI or
// the base64 signature of a WAV, MP3, Ogg or FLAC payload (Q082: no embedded audio).
//
// dist is a clean rebuild of src (npm run build:check), so judging the entries in src judges what
// dist ships; the dist scan holds what no entry accounts for. Exit 0 clean, 1 on any problem.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY = 'src/js/studio/riffs/library.js';
export const RULES = Object.freeze({ origin: 'original', author: 'OSCILLA', licence: 'MIT' });

const PITCH = /^[A-G]#?-?\d$/;
// what symbolic data never is: a data: URI, a long base64 run, a link to a media file
const MEDIA = new RegExp(['data:[a-z]+\\/', '[A-Za-z0-9+/]{120,}={0,2}',
  'https?:\\/\\/\\S+\\.(wav|mp3|ogg|flac|m4a|aiff?|mid|midi)\\b'].join('|'), 'i');
// <audio>, a data:audio URI, and the base64 openings of RIFF/WAVE, ID3/MPEG, OggS and fLaC data
export const DIST_AUDIO = [
  [/<audio\b/i, 'an <audio> element'],
  [/data:audio\//i, 'a data:audio URI'],
  [/UklGR[A-Za-z0-9+/]{40,}/, 'base64 RIFF/WAVE data'],
  [/SUQz[A-Za-z0-9+/]{40,}/, 'base64 ID3/MP3 data'],
  [/T2dnUw[A-Za-z0-9+/]{40,}/, 'base64 Ogg data'],
  [/ZkxhQw[A-Za-z0-9+/]{40,}/, 'base64 FLAC data'],
];

/** The entry's notes as one canonical string, hashed: two entries with the same notes are one. */
export function fingerprint(entry) {
  const notes = (entry.notes || []).map((n) => (Array.isArray(n) ? n.join(',') : String(n)));
  return createHash('sha256').update(notes.join(';')).digest('hex');
}

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Problems of the library entries (empty = every entry holds the owner's decisions). */
export function entryProblems(entries, methods) {
  const problems = [];
  const ids = new Map();
  const prints = new Map();
  if (!Array.isArray(entries) || entries.length === 0) return ['the library holds no entries'];
  for (const [i, e] of entries.entries()) {
    const who = `entry ${e && e.id ? e.id : `#${i}`}`;
    for (const [k, v] of Object.entries(RULES)) {
      if (!e || e[k] !== v) {
        problems.push(`${who}: ${k} is ${JSON.stringify(e && e[k])}, not '${v}'`);
      }
    }
    if (!e || !methods.includes(e.method)) {
      problems.push(`${who}: method ${JSON.stringify(e && e.method)} is not one of `
        + `${methods.join(', ')}`);
    }
    const media = strings(e).find((s) => MEDIA.test(s));
    if (media !== undefined) {
      problems.push(`${who}: carries media, not symbolic notes (${media.slice(0, 40)}...)`);
    }
    const notes = e && e.notes;
    if (!Array.isArray(notes) || notes.length === 0) problems.push(`${who}: has no notes`);
    else {
      notes.forEach((n, j) => {
        const ok = Array.isArray(n) && n.length === 4 && Number.isInteger(n[0]) && n[0] >= 0
          && typeof n[1] === 'string' && PITCH.test(n[1]) && n[2] > 0
          && Number.isInteger(n[3]) && n[3] >= 1 && n[3] <= 127;
        if (!ok) {
          problems.push(`${who}: note ${j} ${JSON.stringify(n)} is not `
            + '[step, pitch, length, velocity]');
        }
      });
    }
    if (e && e.id) {
      if (ids.has(e.id)) problems.push(`${who}: the id is also entry #${ids.get(e.id)}'s`);
      else ids.set(e.id, i);
    }
    if (Array.isArray(notes) && notes.length) {
      const fp = fingerprint(e);
      if (prints.has(fp)) problems.push(`${who}: the same notes as entry ${prints.get(fp)}`);
      else prints.set(fp, e.id || `#${i}`);
    }
  }
  return problems;
}

/** Problems of the built page: any audio it carries (Q082). */
export function distProblems(distText) {
  return DIST_AUDIO.filter(([re]) => re.test(distText))
    .map(([, what]) => `dist/index.html carries ${what}: the library is symbolic only (Q082)`);
}

export async function main(argv = process.argv.slice(2), root = ROOT) {
  const at = argv.indexOf('--dist');
  const dist = path.resolve(root, at >= 0 ? argv[at + 1] : 'dist/index.html');
  const lib = await import(pathToFileURL(path.join(root, LIBRARY)).href);
  const problems = [...entryProblems(lib.RIFFS, lib.METHODS),
    ...distProblems(readFileSync(dist, 'utf8'))];
  if (problems.length) {
    for (const p of problems) console.error(`content-rights: ${p}`);
    return 1;
  }
  console.log(`content-rights: ${lib.RIFFS.length} entries original, MIT, method recorded, `
    + `symbolic; ${path.relative(root, dist)} carries no audio (Q079-Q082)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
