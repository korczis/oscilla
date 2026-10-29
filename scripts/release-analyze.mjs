#!/usr/bin/env node
// Release analysis: conventional commits since the last reachable v* tag (else since the root
// commit) -> the SemVer level the next release needs, with one reason per commit.
//
//   node scripts/release-analyze.mjs [--json] [--prerelease [--preid rc]] [--help]
//
// Levels (SemVer policy of this project):
//   major  "type!:" or a "BREAKING CHANGE:" / "BREAKING-CHANGE:" footer: incompatible config,
//          user or public contract change
//   minor  feat: a new compatible capability
//   patch  fix, perf, revert; and any commit that is not a conventional commit (it may change
//          the artifact, so it is never silently dropped)
//   none   build, chore, ci, docs, refactor, style, test only
// The proposal: when package.json already carries an untagged version that satisfies the
// required level (the initial V2 major after v1.0.0 covers any level), the release confirms
// it; otherwise the version is bumped once from the last tag (or from package.json when that
// version is the tagged one). A published release candidate is finalised even when nothing
// release-relevant followed it: after vX.Y.Z-rc.N with no such commit the proposal is X.Y.Z
// (rule project.release-flow-complete makes the candidate mandatory before a major, so the
// step from it to the release must not need an invented commit). Pure functions are exported
// for the unit tests. parseFlags() is the argument parser of every release script.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, bumpVersion, compareSemver, formatSemver, gitRunner, parseSemver, readVersion,
} from './release-metadata.mjs';

export const LEVELS = ['none', 'patch', 'minor', 'major'];
const PATCH_TYPES = new Set(['fix', 'perf', 'revert']);
const NONE_TYPES = new Set(['build', 'chore', 'ci', 'docs', 'refactor', 'style', 'test']);
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]*)\))?(?<bang>!)?: (?<desc>\S.*)$/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: *(\S.*)$/m;

/** Parse one commit message ({ sha, subject, body }). */
export function parseCommit({ sha = '', subject = '', body = '' }) {
  const m = HEADER.exec(subject.trim());
  const footer = BREAKING_FOOTER.exec(body || '');
  if (!m) {
    return { sha, subject, conventional: false, type: null, scope: null,
      breaking: !!footer, breakingNote: footer ? footer[1] : null };
  }
  const { type, scope, bang, desc } = m.groups;
  return { sha, subject, conventional: true, type: type.toLowerCase(), scope: scope ?? null,
    description: desc, breaking: !!bang || !!footer, breakingNote: footer ? footer[1] : null };
}

/** SemVer level and the reason for one parsed commit. */
export function commitLevel(c) {
  if (c.breaking) {
    return { level: 'major', why: c.breakingNote ? `BREAKING CHANGE: ${c.breakingNote}`
      : `breaking change marker "!" on ${c.type}` };
  }
  if (!c.conventional) {
    return { level: 'patch', why: 'not a conventional commit; counted as patch' };
  }
  if (c.type === 'feat') return { level: 'minor', why: 'feat: new capability' };
  if (PATCH_TYPES.has(c.type)) return { level: 'patch', why: `${c.type}: fix-level change` };
  if (NONE_TYPES.has(c.type)) return { level: 'none', why: `${c.type}: no release impact` };
  return { level: 'patch', why: `unknown type "${c.type}"; counted as patch` };
}

/**
 * @param {{ sha?: string, subject: string, body?: string }[]} commits  newest first
 * @returns {{ level: string, reasons: object[], counts: object }}
 */
export function analyzeCommits(commits) {
  const counts = { none: 0, patch: 0, minor: 0, major: 0 };
  let level = 'none';
  const reasons = commits.map((raw) => {
    const c = parseCommit(raw);
    const r = commitLevel(c);
    counts[r.level] += 1;
    if (LEVELS.indexOf(r.level) > LEVELS.indexOf(level)) level = r.level;
    return { sha: (raw.sha || '').slice(0, 7), subject: raw.subject, ...r };
  });
  return { level, reasons, counts };
}

/**
 * The version the next release carries, or null when there is nothing to release.
 * @param {{ current: string, lastTagVersion: string|null, level: string,
 *   prerelease?: boolean, preid?: string }} o
 * @returns {{ version: string|null, action: 'confirm'|'bump'|'none', why: string }}
 */
export function proposeVersion({
  current, lastTagVersion, level, prerelease = false, preid = 'rc',
}) {
  if (!parseSemver(current)) throw new Error(`package.json version ${current} is not SemVer`);
  if (!lastTagVersion) {
    return { version: current, action: 'confirm', why: 'no v* tag yet: the first release is the '
      + `version package.json carries (${current})` };
  }
  const cmp = compareSemver(current, lastTagVersion);
  if (cmp < 0) {
    throw new Error(`package.json ${current} is older than the last tag v${lastTagVersion}`);
  }
  if (level === 'none') {
    const last = parseSemver(lastTagVersion);
    const final = formatSemver({ ...last, prerelease: [] });
    if (!prerelease && last.prerelease.length && compareSemver(current, final) <= 0) {
      return { version: final, action: current === final ? 'confirm' : 'bump',
        why: `finalises the candidate v${lastTagVersion} (no release-relevant commit since it)` };
    }
    return { version: null, action: 'none',
      why: `no release-relevant commit since v${lastTagVersion}` };
  }
  const bump = (from) => (prerelease
    ? bumpVersion(from, 'prerelease', { preid, preLevel: level })
    : bumpVersion(from, level));
  if (cmp > 0) {
    const required = bump(lastTagVersion);
    if (compareSemver(current, required) >= 0) {
      return { version: current, action: 'confirm', why: `package.json ${current} is untagged and `
        + `already covers the required ${level} step from v${lastTagVersion} (${required})` };
    }
    return { version: required, action: 'bump', why: `${level} step from v${lastTagVersion}` };
  }
  return { version: bump(current), action: 'bump', why: `${level} step from v${current}` };
}

// ------------------------------------------------------------------------------- cli
/**
 * Parse a release script's argv against its declared flags (`spec`: flag -> 'boolean' or
 * 'value'). Returns { help: true } when --help or -h is given, else an object keyed by flag (a
 * boolean flag true, a value flag its string) whose `_` lists the positional arguments, of
 * which a script accepts at most `positional` (0 unless it says so). An argument the spec does
 * not declare, a positional beyond that count, a value flag followed by nothing or by another
 * flag, or a value flag given an empty value throws an Error with exitCode 2 that ends in
 * `usage`, so a typo is refused before the script touches git, a file or the network (R-4 of
 * the #198 review). A value that starts with "-" but is no flag ("-5") is a value, which the
 * script then judges (R-1 of #199); an empty one is never silently replaced by a default
 * (R-2 of #199).
 */
export function parseFlags(argv, spec, usage, { positional = 0 } = {}) {
  const refuse = (m) => Object.assign(new Error(`${m}\n${usage}`), { exitCode: 2 });
  const isFlag = (v) => v.startsWith('--') || /^-[A-Za-z]/.test(v);
  const o = { _: [] };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (!Object.hasOwn(spec, a)) {
      if (isFlag(a) || o._.length >= positional) throw refuse(`unknown argument ${a}`);
      o._.push(a);
    } else if (spec[a] === 'boolean') {
      o[a] = true;
    } else {
      const v = argv[i + 1];
      if (v === undefined || isFlag(v)) throw refuse(`${a} needs a value`);
      if (v === '') throw refuse(`${a} needs a non-empty value`);
      o[a] = v;
      i++;
    }
  }
  return help ? { help: true } : o;
}

// ------------------------------------------------------------------------------- git
/**
 * Highest SemVer v* tag reachable from HEAD, or null. `exclude` names a tag that is never the
 * answer: release:publish leaves out the tag it publishes, which a resumed publish finds at HEAD.
 */
export function lastReleaseTag(run = gitRunner(), { exclude = null } = {}) {
  let tags = [];
  try {
    tags = run(['tag', '--merged', 'HEAD', '--list', 'v*']).split('\n').filter(Boolean);
  } catch { return null; }
  const valid = tags.filter((t) => t !== exclude && parseSemver(t.slice(1)));
  valid.sort((a, b) => compareSemver(b.slice(1), a.slice(1)));
  return valid[0] || null;
}

/** Commits in (since, HEAD], newest first; all of history when since is null. */
export function readCommits(since, run = gitRunner()) {
  const range = since ? `${since}..HEAD` : 'HEAD';
  const out = run(['log', '--format=%H%x1f%s%x1f%b%x1e', range]);
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim())
    .map((r) => {
      const [sha, subject, body] = r.split('\x1f');
      return { sha, subject, body: (body || '').trim() };
    });
}

/** Full analysis of a checkout. */
export function analyzeRepository({ root = ROOT, run = gitRunner(root), prerelease = false,
  preid = 'rc' } = {}) {
  const current = readVersion(root);
  const lastTag = lastReleaseTag(run);
  const commits = readCommits(lastTag, run);
  const analysis = analyzeCommits(commits);
  const proposal = proposeVersion({
    current, lastTagVersion: lastTag ? lastTag.slice(1) : null, level: analysis.level,
    prerelease, preid,
  });
  return { current, lastTag, since: lastTag || 'root', commits: commits.length, ...analysis,
    proposal };
}

export function formatAnalysis(a) {
  const lines = [
    `package.json version: ${a.current}`,
    `last release tag:     ${a.lastTag || '(none reachable from HEAD)'}`,
    `commits analysed:     ${a.commits} (since ${a.since})`,
    `required level:       ${a.level}  (major ${a.counts.major}, minor ${a.counts.minor}, `
      + `patch ${a.counts.patch}, none ${a.counts.none})`,
    `proposal:             ${a.proposal.version ? `v${a.proposal.version}` : 'no release'} `
      + `[${a.proposal.action}] - ${a.proposal.why}`,
    '',
    'reasons:',
    ...a.reasons.map((r) => `  ${r.level.padEnd(5)} ${r.sha}  ${r.subject}  (${r.why})`),
  ];
  return lines.join('\n');
}

export const USAGE = 'usage: node scripts/release-analyze.mjs [--json] '
  + '[--prerelease [--preid <id>]] [--help]';
const FLAGS = { '--json': 'boolean', '--prerelease': 'boolean', '--preid': 'value' };

/** The command line; returns the exit code (0 ok, 1 cannot analyse, 2 usage). */
export function main({
  argv = process.argv.slice(2), root = ROOT, run = gitRunner(root), log = console.log,
  err = console.error,
} = {}) {
  let o;
  try {
    o = parseFlags(argv, FLAGS, USAGE);
  } catch (e) {
    err(`release:analyze: ${e.message}`);
    return e.exitCode;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  try {
    const a = analyzeRepository({ root, run, prerelease: !!o['--prerelease'],
      preid: o['--preid'] ?? 'rc' });
    log(o['--json'] ? JSON.stringify(a, null, 2) : formatAnalysis(a));
    return 0;
  } catch (e) {
    err(`release:analyze: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(); // not process.exit(): a long --json must reach a pipe whole
}
