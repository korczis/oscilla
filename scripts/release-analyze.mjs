#!/usr/bin/env node
// Release analysis: conventional commits since the last reachable v* tag (else since the root
// commit) -> the SemVer level the next release needs, with one reason per commit.
//
//   node scripts/release-analyze.mjs [--json] [--prerelease [--preid rc]]
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
// version is the tagged one). Pure functions are exported for the unit tests.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, bumpVersion, compareSemver, gitRunner, parseSemver, readVersion,
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

// ------------------------------------------------------------------------------- git
/** Highest SemVer v* tag reachable from HEAD, or null. */
export function lastReleaseTag(run = gitRunner()) {
  let tags = [];
  try {
    tags = run(['tag', '--merged', 'HEAD', '--list', 'v*']).split('\n').filter(Boolean);
  } catch { return null; }
  const valid = tags.filter((t) => parseSemver(t.slice(1)));
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--preid');
  try {
    const a = analyzeRepository({ prerelease: argv.includes('--prerelease'),
      preid: i >= 0 ? argv[i + 1] : 'rc' });
    console.log(argv.includes('--json') ? JSON.stringify(a, null, 2) : formatAnalysis(a));
  } catch (e) {
    console.error(`release:analyze: ${e.message}`);
    process.exit(1);
  }
}
