#!/usr/bin/env node
// npm run release:record -- --version X.Y.Z [--check]
//
// Writes .ai/repo/releases/vX.Y.Z.yaml, the Majordomus release record (kind release-record,
// contract release/v1) of one PUBLISHED release, from what was actually published:
//   tag, commit   the local tag vX.Y.Z and the commit it points to, which must be the commit
//                 the tag points to on GitHub
//   channel       stable, or prerelease for a SemVer prerelease (the GitHub Release must agree)
//   published_at  publishedAt of the GitHub Release (a draft is not published)
//   notes_url     the GitHub Release page
//   artifacts     the one OSCILLA artifact, with sha256 and size read off the published bytes
//
// The artifact. OSCILLA ships one file: the committed dist/index.html. verify-deploy calls its
// sha256 the artifact digest (artifactSha256 of the deploy stamp), and the Pages copy is that
// file with only the metadata region stamped, so the unstamped committed dist at the tag commit
// is the one byte sequence a release is. release/v1 requires each artifact's url to be a GitHub
// Release download (https://github.com/<owner>/<repo>/releases/download/<tag>/<name>): neither
// the Pages URL (stamped bytes, and it always serves the latest release) nor the raw file at the
// tag satisfies the contract, and naming a download that does not exist would be a false
// record. So release:publish attaches the committed dist to the GitHub Release as
// oscilla-vX.Y.Z.html (target "web": it is a static page that runs in any browser, from
// file:// too), and this script downloads that asset and requires it to be byte-identical to
// `git show vX.Y.Z:dist/index.html` before recording it. Any other asset on the release is
// refused: the distribution has one target and a record lists exactly the targets it had to
// be complete over (required_targets).
//
// A record is immutable evidence, not a plan. Writing refuses to replace a committed record
// that differs; --check regenerates the record in memory and exits 1 naming every field that
// differs from the committed file. Both fail closed (exit 1, with what to do) when gh is
// missing or unauthenticated, the tag or the GitHub Release does not exist, or the asset is
// missing or is not the committed dist. Exit codes: 0 ok, 1 refused, 2 usage.
//
// Version and provenance logic comes from release-metadata.mjs; nothing is recomputed here.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_URL, ROOT, isFullSha, parseSemver, readBanner, sha256 } from './release-metadata.mjs';

export const RECORD_SCHEMA = 'release/v1';
export const RECORDS_DIR = '.ai/repo/releases';
export const WEB_TARGET = 'web';
export const REQUIRED_TARGETS = [WEB_TARGET];
export const DIST_PATH = 'dist/index.html';
export const REPO = new URL(REPO_URL).pathname.replace(/^\/|\/$/g, '');
export const HEADER = [
  '# Written by scripts/release-record.mjs from what was published.',
  '# Evidence, not a plan: every digest and size below was read off the published bytes.',
];

/** The name of the GitHub Release asset that carries the committed dist of `version`. */
export const releaseAssetName = (version) => `oscilla-v${version}.html`;
export const assetUrl = (tag, name, repoUrl = REPO_URL) => (
  `${repoUrl}/releases/download/${tag}/${name}`
);
export const recordFile = (version, root = ROOT) => (
  path.join(root, RECORDS_DIR, `v${version}.yaml`)
);

/** stable, or prerelease for a SemVer prerelease. */
export function channelFor(version) {
  const v = parseSemver(version);
  if (!v) throw new Error(`not a semantic version: ${version}`);
  return v.prerelease.length ? 'prerelease' : 'stable';
}

/** One artifact entry; sha256 and size are read off `bytes`. */
export function artifactEntry({ target, name, url, bytes }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { target, name, url, sha256: sha256(buf), size: buf.length };
}

// ------------------------------------------------------------------------------- contract
// The release/v1 contract (majordomus share/schemas/majordomus/release/release.v1.schema.json),
// restated so the check runs where Majordomus is not installed; the unit test compares these
// lists with the installed schema when it is present.
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
const TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const URL_RE = new RegExp('^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'
  + '/releases/download/v[0-9A-Za-z.-]+/[A-Za-z0-9][A-Za-z0-9._-]*$');
export const RECORD_REQUIRED = [
  'schema', 'version', 'tag', 'channel', 'commit', 'published_at', 'artifacts',
];
export const RECORD_KEYS = [
  'schema', 'version', 'tag', 'channel', 'commit', 'published_at', 'notes_url', 'yanked',
  'required_targets', 'artifacts',
];
export const ARTIFACT_KEYS = ['target', 'name', 'url', 'sha256', 'size'];

/** Problems with a record against release/v1, each naming its field (empty = valid). */
export function recordProblems(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['record: not a mapping'];
  const p = [];
  const str = (k, re, what) => {
    if (r[k] === undefined) return;
    if (typeof r[k] !== 'string') p.push(`${k}: not a string`);
    else if (re && !re.test(r[k])) p.push(`${k}: ${JSON.stringify(r[k])} is not ${what}`);
  };
  for (const k of RECORD_REQUIRED) if (r[k] === undefined) p.push(`${k}: required`);
  for (const k of Object.keys(r)) if (!RECORD_KEYS.includes(k)) p.push(`${k}: not in release/v1`);
  if (r.schema !== undefined && r.schema !== RECORD_SCHEMA) {
    p.push(`schema: ${JSON.stringify(r.schema)} is not ${RECORD_SCHEMA}`);
  }
  str('version', VERSION_RE, 'a semantic version');
  str('tag', TAG_RE, 'v followed by a version');
  if (typeof r.version === 'string' && typeof r.tag === 'string' && r.tag !== `v${r.version}`) {
    p.push(`tag: ${r.tag} is not v${r.version}`);
  }
  if (r.channel !== undefined && !['stable', 'prerelease'].includes(r.channel)) {
    p.push(`channel: ${JSON.stringify(r.channel)} is not stable or prerelease`);
  }
  str('commit', /^[0-9a-f]{40}$/, 'a full commit sha');
  str('published_at', DATE_RE, 'an ISO-8601 UTC time without fractions');
  str('notes_url', /^https:\/\//, 'an https URL');
  if (r.yanked !== undefined && typeof r.yanked !== 'boolean') p.push('yanked: not a boolean');
  if (r.required_targets !== undefined) {
    const t = r.required_targets;
    if (!Array.isArray(t) || !t.length) p.push('required_targets: not a non-empty list');
    else if (t.some((x) => typeof x !== 'string' || !x)) {
      p.push('required_targets: every entry must be a non-empty string');
    }
  }
  if (r.artifacts !== undefined) {
    if (!Array.isArray(r.artifacts) || !r.artifacts.length) {
      p.push('artifacts: not a non-empty list');
    } else {
      r.artifacts.forEach((a, i) => p.push(...artifactProblems(a, `artifacts.${i}`)));
      const targets = r.artifacts.map((a) => a && a.target);
      if (new Set(targets).size !== targets.length) p.push('artifacts: a target appears twice');
      if (Array.isArray(r.required_targets)) {
        const want = [...r.required_targets].sort().join();
        if ([...targets].sort().join() !== want) {
          p.push(`artifacts: targets ${targets.join(',')} != required_targets ${want}`);
        }
      }
    }
  }
  return p;
}

function artifactProblems(a, at) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return [`${at}: not a mapping`];
  const p = [];
  for (const k of ARTIFACT_KEYS) if (a[k] === undefined) p.push(`${at}.${k}: required`);
  for (const k of Object.keys(a)) {
    if (!ARTIFACT_KEYS.includes(k)) p.push(`${at}.${k}: not in release/v1`);
  }
  const check = (k, re, what) => {
    if (a[k] === undefined) return;
    if (typeof a[k] !== 'string') p.push(`${at}.${k}: not a string`);
    else if (re && !re.test(a[k])) p.push(`${at}.${k}: ${JSON.stringify(a[k])} is not ${what}`);
  };
  check('target', null, '');
  check('name', NAME_RE, 'a plain file name');
  check('url', URL_RE, 'a GitHub Release download URL');
  check('sha256', /^[0-9a-f]{64}$/, 'sha256 hex');
  if (a.size !== undefined && !(Number.isInteger(a.size) && a.size >= 1)) {
    p.push(`${at}.size: not an integer >= 1`);
  }
  return p;
}

/** The record object, validated. Throws when it would not satisfy release/v1. */
export function buildRecord({
  version, commit, publishedAt, notesUrl, artifacts, requiredTargets = REQUIRED_TARGETS,
}) {
  const record = {
    schema: RECORD_SCHEMA, version, tag: `v${version}`, channel: channelFor(version), commit,
    published_at: publishedAt,
  };
  if (notesUrl) record.notes_url = notesUrl;
  record.required_targets = [...requiredTargets];
  record.artifacts = artifacts.map((a) => Object.fromEntries(ARTIFACT_KEYS.map((k) => [k, a[k]])));
  const problems = recordProblems(record);
  if (problems.length) throw new Error(`refusing an invalid record: ${problems.join('; ')}`);
  return record;
}

// ------------------------------------------------------------------------------- yaml
// The record is written in one fixed YAML shape (the one scripts/release-record writes in the
// Majordomus repository) and read back by a parser for exactly that shape, which refuses
// anything else, so no YAML dependency is needed.
const scalar = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(v) && !/^(true|false|null|~|[0-9.]+)$/.test(v)
    ? v : JSON.stringify(v);
};

/** Canonical bytes of a record. */
export function renderRecord(r) {
  const lines = [...HEADER];
  for (const k of RECORD_KEYS) {
    if (r[k] === undefined) continue;
    if (k === 'required_targets') {
      lines.push(`${k}:`, ...r[k].map((t) => `  - ${scalar(t)}`));
    } else if (k === 'artifacts') {
      lines.push(`${k}:`);
      for (const a of r[k]) {
        ARTIFACT_KEYS.forEach((f, i) => lines.push(`${i ? '    ' : '  - '}${f}: ${scalar(a[f])}`));
      }
    } else if (k === 'version' || k === 'published_at') {
      lines.push(`${k}: ${JSON.stringify(r[k])}`);
    } else {
      lines.push(`${k}: ${scalar(r[k])}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const parseScalar = (s) => {
  if (s.startsWith('"')) return JSON.parse(s);
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  return s;
};

/** Parse a record file of the shape renderRecord writes. Throws naming the line otherwise. */
export function parseRecord(text) {
  const r = {};
  let list = null;
  let item = null;
  String(text).split('\n').forEach((line, i) => {
    const bad = () => new Error(`line ${i + 1}: unexpected ${JSON.stringify(line)}`);
    if (!line.trim() || /^\s*#/.test(line)) return;
    let m = /^([a-z_]+):(?: (.+))?$/.exec(line);
    if (m) {
      if (m[1] in r) throw new Error(`line ${i + 1}: ${m[1]} given twice`);
      item = null;
      if (m[2] === undefined) {
        list = m[1];
        r[list] = [];
      } else {
        list = null;
        r[m[1]] = parseScalar(m[2]);
      }
      return;
    }
    if (!list) throw bad();
    m = /^ {2}- ([a-z0-9_]+): (.+)$/.exec(line);
    if (m && list === 'artifacts') {
      item = { [m[1]]: parseScalar(m[2]) };
      r[list].push(item);
      return;
    }
    m = /^ {4}([a-z0-9_]+): (.+)$/.exec(line);
    if (m && item) {
      if (m[1] in item) throw new Error(`line ${i + 1}: ${m[1]} given twice`);
      item[m[1]] = parseScalar(m[2]);
      return;
    }
    m = /^ {2}- (.+)$/.exec(line);
    if (m && list !== 'artifacts') {
      r[list].push(parseScalar(m[1]));
      return;
    }
    throw bad();
  });
  return r;
}

/** Dotted paths of the fields where two records differ (empty = equal). */
export function recordDifferences(a, b) {
  const out = [];
  const walk = (x, y, at) => {
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) {
        out.push(`${at} (${x.length} vs ${y.length} entries)`);
        return;
      }
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
      for (const k of keys) walk(x[k], y[k], at ? `${at}.${k}` : k);
    } else if (x !== y) {
      out.push(`${at} (${JSON.stringify(x)} vs ${JSON.stringify(y)})`);
    }
  };
  walk(a, b, '');
  return out;
}

// ------------------------------------------------------------------------------- gather
export function defaultIo(root = ROOT) {
  const run = (cmd, args, { binary = false } = {}) => {
    const r = spawnSync(cmd, args, {
      cwd: root, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const missing = Boolean(r.error && r.error.code === 'ENOENT');
    return {
      status: r.error ? 127 : r.status, missing,
      stdout: binary ? r.stdout : String(r.stdout || '').trim(),
      stderr: String(r.stderr || (r.error ? r.error.message : '')).trim(),
    };
  };
  const download = (tag, name) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'oscilla-record-'));
    try {
      const file = path.join(dir, name);
      const r = run('gh', ['release', 'download', tag, '-R', REPO, '--pattern', name,
        '--output', file]);
      if (r.status !== 0) throw new Error(`gh release download ${tag} ${name}: ${r.stderr}`);
      return readFileSync(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  return { run, download };
}

const short = (s) => s.slice(0, 12);

/**
 * Everything the record states, read from git and the GitHub Release. Throws with what to do
 * when anything cannot be read or does not agree.
 * @param {{ version: string, io?: { run: Function, download: Function } }} o
 */
export function gatherRecord({ version, io = defaultIo() }) {
  if (!parseSemver(version)) throw new Error(`--version ${version} is not a semantic version`);
  const tag = `v${version}`;
  const { run } = io;

  const ghv = run('gh', ['--version']);
  if (ghv.missing || ghv.status !== 0) {
    throw new Error('gh (GitHub CLI) is required to read the GitHub Release: '
      + 'install it (https://cli.github.com) and run gh auth login');
  }
  if (run('gh', ['auth', 'status']).status !== 0) {
    throw new Error('gh is not authenticated: run gh auth login');
  }

  const local = run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
  const commit = local.status === 0 ? local.stdout : '';
  if (!isFullSha(commit)) {
    throw new Error(`tag ${tag} does not exist in this clone: git fetch --tags origin, `
      + 'or the version was never tagged (release:publish tags it)');
  }
  const remote = run('gh', ['api', `repos/${REPO}/commits/refs/tags/${tag}`, '--jq', '.sha']);
  if (remote.status !== 0) {
    throw new Error(`tag ${tag} is not on GitHub (${REPO}): ${remote.stderr || 'not found'}`);
  }
  if (remote.stdout !== commit) {
    throw new Error(`tag ${tag} is ${short(commit)} here but ${short(remote.stdout)} on GitHub`);
  }

  const view = run('gh', ['release', 'view', tag, '-R', REPO, '--json',
    'tagName,publishedAt,url,isDraft,isPrerelease,assets']);
  if (view.status !== 0) {
    throw new Error(`no GitHub Release for ${tag} (${view.stderr || 'not found'}); `
      + 'release:publish creates it after the deploy is verified');
  }
  const rel = JSON.parse(view.stdout);
  if (rel.tagName !== tag) throw new Error(`GitHub Release names tag ${rel.tagName}, not ${tag}`);
  if (rel.isDraft) throw new Error(`the GitHub Release of ${tag} is a draft: not published`);
  const channel = channelFor(version);
  if (Boolean(rel.isPrerelease) !== (channel === 'prerelease')) {
    throw new Error(`channel: ${tag} is ${channel} by SemVer but the GitHub Release is `
      + `${rel.isPrerelease ? '' : 'not '}marked prerelease`);
  }
  if (!DATE_RE.test(rel.publishedAt || '')) {
    throw new Error(`published_at: GitHub Release publishedAt ${rel.publishedAt} is not UTC`);
  }

  const shown = run('git', ['show', `${commit}:${DIST_PATH}`], { binary: true });
  if (shown.status !== 0) throw new Error(`${DIST_PATH} does not exist at ${tag} (${commit})`);
  const dist = shown.stdout;
  const banner = readBanner(dist.toString('utf8'));
  if (banner !== version) {
    throw new Error(`${DIST_PATH} at ${tag} is the build of v${banner}, not v${version}`);
  }

  const name = releaseAssetName(version);
  const assets = rel.assets || [];
  const extra = assets.filter((a) => a.name !== name).map((a) => a.name);
  if (extra.length) {
    throw new Error(`artifacts: the GitHub Release of ${tag} carries ${extra.join(', ')}, which `
      + `is not a target of this distribution (only ${name}, target ${WEB_TARGET})`);
  }
  const asset = assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`artifacts: the GitHub Release of ${tag} has no asset ${name}, so there is `
      + `nothing published to record. Attach the committed dist at the tag (sha256 `
      + `${sha256(dist)}, ${dist.length} bytes), then run this again:\n`
      + `  git show ${tag}:${DIST_PATH} > ${name} && gh release upload ${tag} ${name} `
      + `-R ${REPO}`);
  }
  const url = assetUrl(tag, name);
  if (asset.url !== url) throw new Error(`artifacts.0.url: GitHub serves ${asset.url}, not ${url}`);
  const bytes = io.download(tag, name);
  const entry = artifactEntry({ target: WEB_TARGET, name, url, bytes });
  if (asset.size !== entry.size) {
    throw new Error(`artifacts.0.size: downloaded ${entry.size} bytes, GitHub says ${asset.size}`);
  }
  if (asset.digest && asset.digest !== `sha256:${entry.sha256}`) {
    throw new Error(`artifacts.0.sha256: downloaded ${entry.sha256}, GitHub says ${asset.digest}`);
  }
  if (!Buffer.from(bytes).equals(dist)) {
    throw new Error(`artifacts.0: ${name} (sha256 ${short(entry.sha256)}) is not the committed `
      + `${DIST_PATH} at ${tag} (sha256 ${short(sha256(dist))})`);
  }
  return buildRecord({
    version, commit, publishedAt: rel.publishedAt, notesUrl: rel.url, artifacts: [entry],
  });
}

// ------------------------------------------------------------------------------- cli
function parseArgs(argv) {
  const o = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') {
      o.version = argv[++i];
      if (o.version === undefined) throw usage('--version needs a value');
    } else if (a === '--check') {
      o.check = true;
    } else if (a === '--help' || a === '-h') {
      o.help = true;
    } else {
      throw usage(`unknown argument ${a}`);
    }
  }
  if (!o.help && !o.version) throw usage('--version X.Y.Z is required');
  return o;
}

const USAGE = 'usage: node scripts/release-record.mjs --version X.Y.Z [--check]';

function usage(message) {
  const e = new Error(`${message}\n${USAGE}`);
  e.exitCode = 2;
  return e;
}

/**
 * Write (or with --check, verify) the record. Returns the exit code.
 * @param {{ argv?: string[], root?: string, io?: object, log?: Function, err?: Function }} [o]
 */
export function main({
  argv = process.argv.slice(2), root = ROOT, io, log = console.log, err = console.error,
} = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`release:record: ${e.message}`);
    return e.exitCode || 2;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const file = recordFile(o.version, root);
  const rel = path.relative(root, file);
  let record;
  try {
    record = gatherRecord({ version: o.version, io: io || defaultIo(root) });
  } catch (e) {
    err(`release:record: ${e.message}`);
    return 1;
  }
  const text = renderRecord(record);
  const committed = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (committed !== null && committed !== text) {
    let fields;
    try {
      fields = recordDifferences(parseRecord(committed), record);
    } catch (e) {
      fields = [`(the committed file does not parse: ${e.message})`];
    }
    if (!fields.length) fields = ['(formatting: not the bytes this script writes)'];
    err(`release:record: ${rel} differs from what was published; a record is immutable `
      + `evidence:\n${fields.map((f) => `  ${f}`).join('\n')}`);
    return 1;
  }
  if (o.check) {
    if (committed === null) {
      err(`release:record: ${rel} is missing; write it with --version ${o.version}`);
      return 1;
    }
    log(`release:record: ${rel} matches what was published`);
    return 0;
  }
  if (committed === null) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const [a] = record.artifacts;
  log(`release:record: ${rel} ${committed === null ? 'written' : 'unchanged'}: ${record.tag} `
    + `${record.channel} at ${record.commit}; ${a.name} sha256 ${a.sha256} (${a.size} bytes)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
