#!/usr/bin/env node
// npm run release:prepare — turn the current clean tree into a release candidate. Never tags.
//
//   node scripts/release-prepare.mjs [--dry-run] [--prerelease [--preid rc]]
//
//   1. refuse a dirty tree (a release candidate is exactly a commit)
//   2. analyse conventional commits since the last v* tag (release-analyze.mjs)
//   2a. refuse to start (rule project.release-flow-complete), also as a dry run, when
//      - the newest v* tag at or after v3.4.0 has no .ai/repo/releases/<tag>.yaml: the
//        previous release is not finished until its record has landed on main;
//      - the proposed version is the first stable release of a new major (its major is above
//        that of every stable v* tag reachable from HEAD, whatever its minor and patch) and no
//        vX.0.0-rc.N tag has a record on the prerelease channel (ADR 0047).
//        `--no-rc-because <ADR>` overrides it only when it names an RC exemption in
//        .ai/repo/adrs/: status accepted, tagged `rc-exemption` and `major-<N>` for the major
//        being opened, with `adr:adr-0047` (the decision it exempts) under `related`. Any other
//        ADR, accepted or not, is refused (convention: .ai/repo/adrs/README.md).
//   3. bump package.json + package-lock.json ONCE (npm version --no-git-tag-version), or
//      confirm the untagged version package.json already carries
//   4. rebuild dist/index.html, then npm run version:check, npm run release-gate and
//      majordomus doctor
//   5. on any failure restore package.json, package-lock.json and dist/index.html from HEAD
//      (the tree was clean, so that is exact) and exit non-zero, loudly
//   6. on success write the gate receipt into the git directory (never a tracked file, so the
//      tree stays clean) for release:publish: version, source digest, dist sha256 and the gate
//      tree (rule project.release-receipt-binds-gate) at the time the gate passed. Any later
//      change to a tracked file other than a release record (.ai/repo/releases/v*.yaml)
//      invalidates it.
// The receipt also binds how the gate ran (GATE_RUN): every browser and origin, because
// release:prepare refuses to start while OSC_BROWSERS or OSC_ORIGINS narrows the selection,
// and declared skips only, because the gate runs with OSC_STRICT_SKIPS=1 (an undeclared skip
// fails it, as under CI). OSC_LOAD_MAX and OSC_LOAD_WAIT_MS say when a suite may start, not
// what it runs, and stay allowed.
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository, formatAnalysis } from './release-analyze.mjs';
import {
  ROOT, computeSourceDigest, digestEntries, gitRunner, parseSemver, readVersion, sha256,
} from './release-metadata.mjs';
import {
  RECORDS_DIR, hasRecordFile, missingRecords, needsRecord, parseRecord,
} from './release-record.mjs';

export const RECEIPT_NAME = 'oscilla-release-gate.json';
export const RESTORE_PATHS = ['package.json', 'package-lock.json', 'dist/index.html'];
export const GATE_COMMANDS = [
  ['npm', ['run', 'build']],
  ['npm', ['run', 'version:check']],
  ['npm', ['run', 'release-gate']],
  ['majordomus', ['doctor']],
];

/** Absolute path of the gate receipt in the COMMON git directory, so a receipt written by
 *  release:prepare in a linked worktree is found by release:publish in any checkout of the
 *  same repository (the receipt is bound to version, source digest and dist sha, not to a
 *  worktree). */
export function receiptPath(run = gitRunner(), root = ROOT) {
  return path.resolve(root, run(['rev-parse', '--git-common-dir']), RECEIPT_NAME);
}

// ------------------------------------------------------------------------------- gate tree
// Rule project.release-receipt-binds-gate. The verdict of the gate depends on more than the
// build inputs the source digest covers: on the tests, the scripts, the workflows, package.json
// and the .ai layer doctor reads. The gate tree is a digest of every tracked file (`git
// ls-files`, read from the working tree, so the uncommitted bump release:prepare gates is
// included) except what legitimately changes between prepare and publish without changing
// the verdict: the release record files (.ai/repo/releases/v<version>.yaml, written after a
// publish; nothing else in that directory, so its README and any other file added there are
// bound) and checkout-local state (.ai/local/, never tracked). A squash-merged release PR
// whose tree equals the prepared tree still verifies; any other change on main does not.
export const GATE_TREE_EXCLUDE = [/^\.ai\/repo\/releases\/v[^/]+\.yaml$/, /^\.ai\/local\//];

/** Tracked paths the gate tree covers, sorted by git. */
export function gateTreePaths(run = gitRunner(), exclude = GATE_TREE_EXCLUDE) {
  return run(['ls-files', '-z']).split('\0').filter(Boolean)
    .filter((p) => !exclude.some((re) => re.test(p)));
}

/** The bytes a tracked path contributes: file content, a symlink's target, else a marker. */
function treeContent(root, rel) {
  const abs = path.join(root, rel);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return '\0deleted';
  }
  if (st.isSymbolicLink()) return `\0symlink ${readlinkSync(abs)}`;
  if (st.isDirectory()) return '\0gitlink'; // a submodule: its commit is in the index
  return readFileSync(abs);
}

/** sha256 over the sorted (path, content) of the gate tree (the source digest's format). */
export function computeGateTree(root = ROOT, run = gitRunner(root)) {
  return digestEntries(gateTreePaths(run).map((p) => ({ path: p, content: treeContent(root, p) })));
}

/** What the receipt must say for the checkout as it is now. */
export function currentFingerprint(root = ROOT, run = gitRunner(root)) {
  return {
    version: readVersion(root),
    sourceDigest: computeSourceDigest(root),
    distSha256: sha256(readFileSync(path.join(root, 'dist/index.html'))),
    gateTree: computeGateTree(root, run),
  };
}

export const RECEIPT_KEYS = ['version', 'sourceDigest', 'distSha256', 'gateTree'];

// ------------------------------------------------------------------------------- gate run
// How the gate ran, recorded in the receipt and required by receiptProblems(): the full
// browser and origin sets of tests/browser/lib/suite.cjs and CI's skip semantics.
export const GATE_RUN = Object.freeze({
  browsers: Object.freeze(['chromium', 'firefox', 'webkit']),
  origins: Object.freeze(['file', 'http']),
  skips: 'declared-only',
});
export const NARROWING_ENV = ['OSC_BROWSERS', 'OSC_ORIGINS'];

/** Why the gate cannot run in `env` (empty = it can): a variable that narrows a suite. */
export function gateEnvProblems(env = process.env) {
  return NARROWING_ENV.filter((k) => env[k] !== undefined).map((k) => `${k} is set `
    + `(${JSON.stringify(env[k])}): the release gate runs every browser and origin; unset it `
    + '(OSC_LOAD_MAX and OSC_LOAD_WAIT_MS stay allowed)');
}

/** The environment the gate commands run in: `env` with CI's skip semantics. */
export function gateEnv(env = process.env) {
  const out = { ...env, OSC_STRICT_SKIPS: '1' };
  for (const k of NARROWING_ENV) delete out[k];
  return out;
}

const sameList = (a, b) => Array.isArray(a) && a.join(',') === b.join(',');

const present = (v) => typeof v === 'string' && v !== '';

/**
 * Problems comparing a receipt with the current fingerprint (empty = verified). A key that is
 * absent is a problem on either side: two fingerprints that both lack gateTree are not equal,
 * they are both unbound, and `undefined === undefined` must never verify a receipt.
 */
export function receiptProblems(receipt, now) {
  if (!receipt) return ['no release-gate receipt: run npm run release:prepare first'];
  const problems = [];
  for (const k of RECEIPT_KEYS) {
    if (!present(receipt[k])) problems.push(`gate receipt has no ${k}`);
    if (!present(now?.[k])) problems.push(`gate receipt ${k}: the current fingerprint has no ${k}`);
    if (present(receipt[k]) && present(now?.[k]) && receipt[k] !== now[k]) {
      problems.push(`gate receipt ${k} ${receipt[k]} != current ${now[k]}`);
    }
  }
  if (problems.some((p) => /^gate receipt (has no )?gateTree/.test(p))) {
    problems.push('a tracked file changed since the gate passed (rule '
      + 'project.release-receipt-binds-gate): re-run npm run release:prepare on this tree');
  }
  if (receipt.result !== 'passed') problems.push(`gate receipt result is ${receipt.result}`);
  for (const k of ['browsers', 'origins']) {
    if (receipt[k] === undefined) problems.push(`gate receipt has no ${k}`);
    else if (!sameList(receipt[k], GATE_RUN[k])) {
      problems.push(`gate receipt ${k} ${[].concat(receipt[k]).join(',')} != `
        + `${GATE_RUN[k].join(',')}: the gate did not run every ${k.slice(0, -1)}`);
    }
  }
  if (receipt.skips === undefined) problems.push('gate receipt has no skips');
  else if (receipt.skips !== GATE_RUN.skips) {
    problems.push(`gate receipt skips ${receipt.skips} != ${GATE_RUN.skips}`);
  }
  return problems;
}

// ------------------------------------------------------------------------------- flow
// Rule project.release-flow-complete: what must be true before a release starts.

/** The items of the YAML list `key` in front matter `fm`, block (`  - a`) or flow (`[a, b]`). */
function frontMatterList(fm, key) {
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return [];
  const inline = lines[at].slice(key.length + 1).trim();
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => !/^\s*-/.test(l));
  const items = inline.startsWith('[') ? inline.replace(/^\[|\]$/g, '').split(',')
    : rest.slice(0, end < 0 ? rest.length : end).map((l) => l.replace(/^\s*-/, ''));
  return items.map((i) => i.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

/**
 * Status, tags and related references of ADR `ref` ("0047", "adr-0047", "ADR 0047"), or null
 * when there is none.
 */
export function adrStatus(ref, root = ROOT) {
  const m = /(\d{1,4})\s*$/.exec(String(ref ?? '').trim());
  if (!m) return null;
  const dir = path.join(root, '.ai/repo/adrs');
  const prefix = `${m[1].padStart(4, '0')}-`;
  const file = existsSync(dir) && readdirSync(dir).find((f) => f.startsWith(prefix)
    && f.endsWith('.md'));
  if (!file) return null;
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path.join(dir, file), 'utf8'));
  const status = fm && /^status:\s*(\S+)\s*$/m.exec(fm[1]);
  return { id: `adr-${m[1].padStart(4, '0')}`, file, status: status ? status[1] : null,
    tags: fm ? frontMatterList(fm[1], 'tags') : [],
    related: fm ? frontMatterList(fm[1], 'related') : [] };
}

/**
 * Why `adr` is not an RC exemption for `major` (empty = it is): the convention of
 * .ai/repo/adrs/README.md, within what `majordomus adr check` accepts. An exemption carries the
 * tags `rc-exemption` and `major-<N>` and names the decision it exempts, ADR 0047, as
 * `adr:adr-0047` under `related`. Its status is judged by the caller.
 */
export function rcExemptionProblems(adr, major) {
  const tags = adr.tags || [];
  const related = adr.related || [];
  return [
    !tags.includes('rc-exemption') && 'no tag rc-exemption',
    !related.includes('adr:adr-0047') && 'related does not name adr:adr-0047',
    !tags.includes(`major-${major}`) && `no tag major-${major}`,
  ].filter(Boolean);
}

/** The channel of the committed record of `tag`, or null when there is none. */
export function recordChannel(tag, root = ROOT) {
  if (!hasRecordFile(tag, root)) return null;
  try {
    return parseRecord(readFileSync(path.join(root, RECORDS_DIR, `${tag}.yaml`), 'utf8')).channel;
  } catch {
    return null;
  }
}

/**
 * Pure: the reasons release:prepare refuses to start (empty = it may start).
 * `tags` are the v* tags reachable from HEAD: a candidate or a release on another line does
 * not count.
 * @param {{ lastTag: string|null, proposed: string|null, tags: string[],
 *   hasRecord: (tag: string) => boolean, channelOf: (tag: string) => string|null,
 *   noRcBecause?: string|null, adr?: { id: string, status: string|null }|null }} f
 */
export function flowProblems({
  lastTag, proposed, tags, hasRecord, channelOf, noRcBecause = null, adr = null,
}) {
  const problems = [];
  if (lastTag && needsRecord(lastTag)
    && missingRecords({ tags: [{ tag: lastTag, date: 0 }], hasRecord, now: 0, windowHours: 0 })
      .length) {
    problems.push(`the newest release ${lastTag} has no ${RECORDS_DIR}/${lastTag}.yaml that `
      + 'parses and carries its tag: finish it first (npm run release:record -- --version '
      + `${lastTag.slice(1)}, land the record PR)`);
  }
  const v = proposed ? parseSemver(proposed) : null;
  const parsed = tags.map((t) => ({ t, p: t.startsWith('v') ? parseSemver(t.slice(1)) : null }))
    .filter(({ p }) => p);
  // The first stable release of a new major, whatever its minor and patch: X.0.1 or X.1.0
  // typed into package.json while every stable tag is below major X opens that major exactly
  // as X.0.0 does. With no stable tag at all there is no line to compare with, and the X.0.0
  // shape decides. (No concrete version here: version:check would refuse this file on the day
  // the product reaches it.)
  const stableMajors = parsed.filter(({ p }) => !p.prerelease.length).map(({ p }) => p.major);
  const opensMajor = v && !v.prerelease.length && (stableMajors.length
    ? v.major > Math.max(...stableMajors) : v.minor === 0 && v.patch === 0);
  if (opensMajor) {
    const published = parsed.filter(({ p }) => p.major === v.major && p.minor === 0
      && p.patch === 0 && p.prerelease[0] === 'rc')
      .filter(({ t }) => channelOf(t) === 'prerelease');
    if (!published.length) {
      const rc = `${v.major}.0.0-rc.1`;
      const why = `v${proposed} is the first stable release of major ${v.major} and has no `
        + `published release candidate (no v${v.major}.0.0-rc.N tag with a prerelease record `
        + `in ${RECORDS_DIR}/; ADR 0047)`;
      if (!noRcBecause) {
        problems.push(`${why}: publish a candidate first (npm run release:prepare -- `
          + `--prerelease; when package.json already carries a ${v.major}.x version, set it to `
          + `${rc} for the candidate), or pass --no-rc-because <ADR> naming an `
          + `accepted RC exemption for major ${v.major}`);
      } else if (!adr) {
        problems.push(`${why}: --no-rc-because ${noRcBecause} names no ADR in .ai/repo/adrs/`);
      } else {
        const not = rcExemptionProblems(adr, v.major);
        const reasons = [
          adr.status !== 'accepted' && `${adr.id} is ${adr.status}, not accepted`,
          not.length && `${adr.id} is not an RC exemption for major ${v.major} (${not.join('; ')}`
            + '; see .ai/repo/adrs/README.md)',
        ].filter(Boolean);
        if (reasons.length) {
          problems.push(`${why}: --no-rc-because ${noRcBecause}: ${reasons.join('; ')}`);
        }
      }
    }
  }
  return problems;
}

export function readReceipt(run = gitRunner(), root = ROOT) {
  try {
    return JSON.parse(readFileSync(receiptPath(run, root), 'utf8'));
  } catch {
    return null;
  }
}

function sh(cmd, args, root, env = process.env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env });
  if (r.error) return { ok: false, why: `${cmd}: ${r.error.message}` };
  return { ok: r.status === 0, why: `${cmd} ${args.join(' ')} exited ${r.status}` };
}

function loud(lines) {
  const bar = '='.repeat(78);
  console.error(`\n${bar}\n${lines.map((l) => `RELEASE:PREPARE FAILED  ${l}`).join('\n')}\n${bar}`);
}

export function main(argv = process.argv.slice(2), root = ROOT, run = gitRunner(root),
  env = process.env) {
  const narrowed = gateEnvProblems(env);
  if (narrowed.length) {
    loud(['refusing to start (rule project.release-receipt-binds-gate):', ...narrowed,
      'nothing was changed']);
    return 1;
  }
  const dirty = run(['status', '--porcelain', '--untracked-files=normal']);
  if (dirty) {
    loud(['the working tree is not clean; commit or copy aside first:', ...dirty.split('\n')]);
    return 1;
  }
  const i = argv.indexOf('--preid');
  const analysis = analyzeRepository({ root, run, prerelease: argv.includes('--prerelease'),
    preid: i >= 0 ? argv[i + 1] : 'rc' });
  console.log(formatAnalysis(analysis));
  const { proposal, current } = analysis;
  const ni = argv.indexOf('--no-rc-because');
  const noRcBecause = ni >= 0 ? (argv[ni + 1] || '') : null;
  const refused = flowProblems({
    lastTag: analysis.lastTag, proposed: proposal.version,
    tags: run(['tag', '--merged', 'HEAD', '--list', 'v*']).split('\n').filter(Boolean),
    hasRecord: (tag) => hasRecordFile(tag, root), channelOf: (tag) => recordChannel(tag, root),
    noRcBecause, adr: noRcBecause === null ? null : adrStatus(noRcBecause, root),
  });
  if (refused.length) {
    loud(['refusing to start (rule project.release-flow-complete):', ...refused,
      'nothing was changed']);
    return 1;
  }
  if (!proposal.version) {
    console.log('\nNothing to release.');
    return 0;
  }
  const plan = proposal.action === 'bump'
    ? [['npm', ['version', proposal.version, '--no-git-tag-version']], ...GATE_COMMANDS]
    : GATE_COMMANDS;
  if (argv.includes('--dry-run')) {
    console.log(`\nDry run: would ${proposal.action} v${proposal.version} and run:`);
    for (const [cmd, args] of plan) console.log(`  ${cmd} ${args.join(' ')}`);
    return 0;
  }
  console.log(`\n${proposal.action === 'bump' ? `Bumping ${current} -> ${proposal.version}`
    : `Confirming the untagged v${current}`}; then the full gate.`);
  for (const [cmd, args] of plan) {
    const r = sh(cmd, args, root, gateEnv(env));
    if (!r.ok) {
      const restore = spawnSync('git', ['checkout', 'HEAD', '--', ...RESTORE_PATHS],
        { cwd: root, stdio: 'inherit' });
      loud([
        r.why,
        restore.status === 0
          ? `restored ${RESTORE_PATHS.join(', ')} from HEAD; package.json is back at ${current}`
          : `COULD NOT restore ${RESTORE_PATHS.join(', ')}: run git checkout HEAD -- by hand`,
        'no tag was created; nothing was pushed',
      ]);
      return 1;
    }
  }
  const receipt = {
    ...currentFingerprint(root, run), ...GATE_RUN, result: 'passed',
    base: run(['rev-parse', 'HEAD']),
    gate: GATE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`), at: new Date().toISOString(),
  };
  if (receipt.version !== proposal.version) {
    loud([`package.json says ${receipt.version}, expected ${proposal.version}`]);
    return 1;
  }
  writeFileSync(receiptPath(run, root), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nRelease candidate v${receipt.version} passed the gate `
    + `(source ${receipt.sourceDigest.slice(0, 12)}, dist ${receipt.distSha256.slice(0, 12)}, `
    + `gate tree ${receipt.gateTree.slice(0, 12)}).`);
  if (proposal.action === 'bump') {
    console.log('Next: commit it, e.g. git commit -am "chore(release): v'
      + `${receipt.version}", land it on main, then npm run release:publish (dry run) and `
      + 'npm run release:publish -- --yes. Any other PR merged to main before the publish '
      + 'invalidates this receipt: arm auto-merge on other PRs only after the publish.');
  } else {
    console.log('No file changed. Next: on main, npm run release:publish (dry run), then '
      + 'npm run release:publish -- --yes.');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    loud([e.message]);
    process.exit(1);
  }
}
