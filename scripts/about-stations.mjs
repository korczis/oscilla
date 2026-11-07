#!/usr/bin/env node
// node scripts/about-stations.mjs [--stamp | --check] — the About timeline's stations (R032).
//
// The stations live in src/data/about-stations.json, one entry per step of the project:
// { release?, title, summary, commit?, datetime? }. Only the title and the summary are prose
// someone writes; everything else on the page is derived, never typed twice:
//
//   - the step number "NN ·" is the station's position;
//   - the HH:MM shown is the wall-clock time of its datetime, in the offset it carries;
//   - the "(V3.x)" after the summary is its release line (left out when the title already is
//     that line, as for V1 and V2);
//   - data-state and the "Released" / "Current" / "Recorded" word follow from package.json:
//     the station of package.json's MAJOR.MINOR is current, every earlier one done, and a
//     station with no release (the first commit) is a record;
//   - release, commit and datetime are stamped by `--stamp`, which release:prepare runs after
//     its bump: the release line of package.json, the 7-character id of HEAD (origin/main at
//     prepare, the first parent of the release merge) and that commit's committer date.
//
// A minor or major release therefore adds one entry { title, summary } at the end of the file
// (a station still pending: no release, no commit), and release:prepare stamps it. A patch
// release changes nothing here: its line already has its station.
//
// The build renders the stations where src/index.html carries <!-- @about-stations -->
// (expandStations, before the packer); the unit tests read the same expansion.
//
//   node scripts/about-stations.mjs           print the rendered timeline items
//   node scripts/about-stations.mjs --stamp   stamp the pending station for package.json's line
//   node scripts/about-stations.mjs --check   exit 1 naming each station whose derived fields
//                                             (release order, commit, datetime) are wrong
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const STATIONS_REL = 'src/data/about-stations.json';
export const SCHEMA = 'oscilla-about-stations/v1';
export const MARKER = '<!-- @about-stations -->';
export const NOTE = 'The About timeline, one entry per step. Write only title and summary (a new '
  + 'release line: one entry at the end, without release, commit or datetime); release:prepare '
  + 'stamps release, commit and datetime (scripts/about-stations.mjs --stamp), and the build '
  + 'derives the step number, the time shown, the (Vx.y) label and the done/current state.';
const FIELDS = ['release', 'title', 'summary', 'commit', 'datetime'];
const LINE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHORT = /^[0-9a-f]{7}$/;
// git's %cI writes the offset as +HH:MM, or Z on a host whose zone is UTC (CI runners).
const DATETIME = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}):\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;
const INDENT = '          ';

/** MAJOR.MINOR of a version X.Y.Z or X.Y.Z-pre. */
export function lineOf(version) {
  const m = /^(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(version || '');
  if (!m) throw new Error(`version ${version} is not X.Y.Z`);
  return `${m[1]}.${m[2]}`;
}

/** The label of a release line: V1 for 1.0, V3.1 for 3.1. */
export function lineLabel(release) {
  const [major, minor] = release.split('.');
  return minor === '0' ? `V${major}` : `V${major}.${minor}`;
}

const cmpLine = (a, b) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  return x[0] - y[0] || x[1] - y[1];
};
const isPending = (s) => !s.commit;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function readStations(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, STATIONS_REL), 'utf8'));
}

export function readVersion(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/** What is wrong with the file's shape (empty = nothing). Needs no git and no version. */
export function stationsShapeProblems(doc) {
  if (!doc || typeof doc !== 'object') return ['the stations file is not an object'];
  const problems = [];
  if (doc.schema !== SCHEMA) problems.push(`schema is ${doc.schema}, not ${SCHEMA}`);
  if (!Array.isArray(doc.stations) || !doc.stations.length) {
    return [...problems, 'stations is not a non-empty list'];
  }
  let last = null;
  doc.stations.forEach((s, i) => {
    const at = `station ${i + 1}`;
    const extra = Object.keys(s || {}).filter((k) => !FIELDS.includes(k));
    if (extra.length) problems.push(`${at}: unknown field ${extra.join(', ')}`);
    for (const k of ['title', 'summary']) {
      if (typeof s?.[k] !== 'string' || !s[k].trim()) problems.push(`${at}: no ${k}`);
    }
    if (/\(V\d+(?:\.\d+)?\)\s*$/.test(s?.summary || '')) {
      problems.push(`${at}: the summary ends with its release label, which the build derives`);
    }
    if (isPending(s || {})) {
      if (i !== doc.stations.length - 1) problems.push(`${at}: a pending station is not last`);
      if (s.release || s.datetime) problems.push(`${at}: pending, yet carries release or datetime`);
      return;
    }
    if (!SHORT.test(s.commit)) problems.push(`${at}: commit ${s.commit} is not a 7-character id`);
    if (!DATETIME.test(s.datetime || '')) {
      problems.push(`${at}: datetime ${s.datetime} is not an ISO time with its offset`);
    }
    if (s.release === undefined) {
      if (i !== 0) problems.push(`${at}: only the first station may have no release`);
      return;
    }
    if (!LINE.test(s.release)) {
      problems.push(`${at}: release ${s.release} is not MAJOR.MINOR (the file never holds X.Y.Z)`);
      return;
    }
    if (last && cmpLine(last, s.release) >= 0) {
      problems.push(`${at}: release ${s.release} does not follow ${last}`);
    }
    last = s.release;
  });
  return problems;
}

/** The stamped stations with their derived fields, for package.json's `version`. */
export function deriveStations(doc, version) {
  const shape = stationsShapeProblems(doc);
  if (shape.length) throw new Error(`${STATIONS_REL}: ${shape.join('; ')}`);
  const line = lineOf(version);
  const stamped = doc.stations.filter((s) => !isPending(s));
  const current = stamped.findIndex((s) => s.release === line);
  if (current < 0) {
    throw new Error(`${STATIONS_REL} has no station for release line ${line} (package.json `
      + `${version}): add { title, summary } at its end, then run release:prepare (or `
      + 'node scripts/about-stations.mjs --stamp)');
  }
  if (current !== stamped.length - 1) {
    throw new Error(`${STATIONS_REL}: release line ${line} is not the last station`);
  }
  return stamped.map((s, i) => {
    const state = i === current ? 'current' : 'done';
    const label = s.release ? lineLabel(s.release) : null;
    return {
      ...s,
      step: String(i + 1).padStart(2, '0'),
      time: DATETIME.exec(s.datetime)[1],
      text: label && s.title !== label ? `${s.summary} (${label})` : s.summary,
      state,
      word: !s.release ? 'Recorded' : state === 'current' ? 'Current' : 'Released',
    };
  });
}

/** The <li> items of the timeline <ol>, one per stamped station. */
export function renderStations(doc, version) {
  return deriveStations(doc, version).map((s) => [
    `${INDENT}<li data-state="${s.state}"${s.release ? ` data-osc-release="${s.release}"` : ''}>`,
    `${INDENT}  <span>${s.step} · <time data-osc-commit="${s.commit}" datetime="${s.datetime}">`
      + `${s.time}</time></span>`,
    `${INDENT}  <strong>${esc(s.title)}</strong>`,
    `${INDENT}  <span>${esc(s.text)}</span>`,
    `${INDENT}  <em>${s.word}</em>`,
    `${INDENT}</li>`,
  ].join('\n')).join('\n');
}

/** `html` with its one <!-- @about-stations --> line replaced by the rendered stations. */
export function expandStations(html, { doc = readStations(), version = readVersion() } = {}) {
  const at = html.indexOf(MARKER);
  if (at < 0) throw new Error(`the template has no ${MARKER} marker`);
  if (html.indexOf(MARKER, at + 1) >= 0) throw new Error(`the template has ${MARKER} twice`);
  const start = html.lastIndexOf('\n', at) + 1;
  const end = html.indexOf('\n', at);
  if (html.slice(start, at).trim() || html.slice(at + MARKER.length, end).trim()) {
    throw new Error(`${MARKER} must stand alone on its line`);
  }
  return html.slice(0, start) + renderStations(doc, version) + html.slice(end);
}

/**
 * Stamp the pending station for `version`'s line with `head` ({ commit, datetime }).
 * Returns { doc, stamped }: stamped false when the line already has its station (a patch).
 */
export function stampStations(doc, version, head) {
  const shape = stationsShapeProblems(doc);
  if (shape.length) throw new Error(`${STATIONS_REL}: ${shape.join('; ')}`);
  const line = lineOf(version);
  if (doc.stations.some((s) => s.release === line)) return { doc, stamped: false };
  const pending = doc.stations.at(-1);
  if (!isPending(pending)) {
    throw new Error(`release line ${line} has no station: add { "title", "summary" } as the last `
      + `entry of ${STATIONS_REL} (a docs(about) commit) before release:prepare`);
  }
  if (!SHORT.test(head.commit) || !DATETIME.test(head.datetime)) {
    throw new Error(`cannot stamp with commit ${head.commit} at ${head.datetime}`);
  }
  const { title, summary } = pending;
  const stations = [...doc.stations.slice(0, -1),
    { release: line, title, summary, commit: head.commit, datetime: head.datetime }];
  const next = { ...doc, stations };
  const problems = stationsShapeProblems(next);
  if (problems.length) throw new Error(`${STATIONS_REL}: ${problems.join('; ')}`);
  return { doc: next, stamped: true };
}

export function formatStations(doc) {
  return `${JSON.stringify({ schema: SCHEMA, note: NOTE, stations: doc.stations }, null, 2)}\n`;
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** HEAD as a station names it: its 7-character id and its committer date with offset. */
export function headStamp(root = ROOT) {
  return { commit: git(root, 'rev-parse', '--short=7', 'HEAD'),
    datetime: git(root, 'show', '-s', '--format=%cI', 'HEAD') };
}

/** The derived fields judged against git (empty = they hold). */
export function stationsGitProblems(doc, root = ROOT, run = (...a) => git(root, ...a)) {
  const problems = [];
  doc.stations.forEach((s, i) => {
    if (isPending(s)) return;
    let committed = null;
    try {
      committed = run('show', '-s', '--format=%cI', `${s.commit}^{commit}`);
    } catch {
      problems.push(`station ${i + 1}: commit ${s.commit} is not in this repository`);
      return;
    }
    if (Date.parse(committed) !== Date.parse(s.datetime)) {
      problems.push(`station ${i + 1}: datetime ${s.datetime}, commit ${s.commit} says `
        + `${committed}`);
    }
  });
  return problems;
}

export function main(argv = process.argv.slice(2), root = ROOT) {
  const [flag] = argv;
  const doc = readStations(root);
  const version = readVersion(root);
  if (flag === '--stamp') {
    const { doc: next, stamped } = stampStations(doc, version, headStamp(root));
    if (!stamped) {
      console.log(`about-stations: release line ${lineOf(version)} already has its station`);
      return 0;
    }
    writeFileSync(path.join(root, STATIONS_REL), formatStations(next));
    const s = next.stations.at(-1);
    console.log(`about-stations: stamped "${s.title}" as ${s.release} at ${s.commit} `
      + `${s.datetime}`);
    return 0;
  }
  if (flag === '--check') {
    const problems = [...stationsShapeProblems(doc), ...stationsGitProblems(doc, root)];
    try {
      deriveStations(doc, version);
    } catch (e) {
      problems.push(e.message);
    }
    for (const p of problems) console.error(`about-stations: ${p}`);
    if (!problems.length) console.log(`about-stations: ${doc.stations.length} station(s) hold`);
    return problems.length ? 1 : 0;
  }
  if (flag) {
    console.error('usage: node scripts/about-stations.mjs [--stamp | --check]');
    return 2;
  }
  console.log(renderStations(doc, version));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`about-stations: ${e.message}`);
    process.exitCode = 1;
  }
}
