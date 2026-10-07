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
//      - the proposed version is a stable X.0.0 and no vX.0.0-rc.N tag has a record on the
//        prerelease channel (ADR 0047). `--no-rc-because <ADR>` overrides it only when it names
//        an ADR in .ai/repo/adrs/ whose status is accepted.
//   3. bump package.json + package-lock.json ONCE (npm version --no-git-tag-version), or
//      confirm the untagged version package.json already carries
//   4. rebuild dist/index.html, then npm run version:check, npm run release-gate and
//      majordomus doctor
//   5. on any failure restore package.json, package-lock.json and dist/index.html from HEAD
//      (the tree was clean, so that is exact) and exit non-zero, loudly
//   6. on success write the gate receipt into the git directory (never a tracked file, so the
//      tree stays clean) for release:publish: version, source digest, dist sha256 and the gate
//      tree (rule project.release-receipt-binds-gate) at the time the gate passed. Any later
//      change to a tracked file outside .ai/repo/releases/ invalidates it.
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
// included) except the two directories that legitimately change between prepare and publish
// without changing the verdict: the release records (.ai/repo/releases/, written after a
// publish) and checkout-local state (.ai/local/, never tracked). A squash-merged release PR
// whose tree equals the prepared tree still verifies; any other change on main does not.
export const GATE_TREE_EXCLUDE = [/^\.ai\/repo\/releases\//, /^\.ai\/local\//];

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

/** Problems comparing a receipt with the current fingerprint (empty = verified). */
export function receiptProblems(receipt, now) {
  if (!receipt) return ['no release-gate receipt: run npm run release:prepare first'];
  const problems = [];
  for (const k of RECEIPT_KEYS) {
    if (receipt[k] !== now[k]) {
      problems.push(`gate receipt ${k} ${receipt[k]} != current ${now[k]}`);
    }
  }
  if (problems.some((p) => p.startsWith('gate receipt gateTree'))) {
    problems.push('a tracked file changed since the gate passed (rule '
      + 'project.release-receipt-binds-gate): re-run npm run release:prepare on this tree');
  }
  if (receipt.result !== 'passed') problems.push(`gate receipt result is ${receipt.result}`);
  return problems;
}

// ------------------------------------------------------------------------------- flow
// Rule project.release-flow-complete: what must be true before a release starts.

/** Status of ADR `ref` ("0047", "adr-0047", "ADR 0047"), or null when there is none. */
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
  return { id: `adr-${m[1].padStart(4, '0')}`, file, status: status ? status[1] : null };
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
    problems.push(`the newest release ${lastTag} has no ${RECORDS_DIR}/${lastTag}.yaml: finish `
      + `it first (npm run release:record -- --version ${lastTag.slice(1)}, land the record PR)`);
  }
  const v = proposed ? parseSemver(proposed) : null;
  if (v && !v.prerelease.length && v.minor === 0 && v.patch === 0) {
    const rcs = tags.filter((t) => {
      const p = t.startsWith('v') && parseSemver(t.slice(1));
      return p && p.major === v.major && p.minor === 0 && p.patch === 0
        && p.prerelease[0] === 'rc';
    });
    const published = rcs.filter((t) => channelOf(t) === 'prerelease');
    if (!published.length) {
      const why = `v${proposed} is a major release with no published release candidate (no `
        + `v${v.major}.0.0-rc.N tag with a prerelease record in ${RECORDS_DIR}/; ADR 0047)`;
      if (!noRcBecause) {
        problems.push(`${why}: publish a candidate first (npm run release:prepare -- `
          + `--prerelease; when package.json already says ${proposed}, set it to `
          + `${proposed}-rc.1 for the candidate), or pass --no-rc-because <ADR> naming an `
          + 'accepted ADR');
      } else if (!adr) {
        problems.push(`${why}: --no-rc-because ${noRcBecause} names no ADR in .ai/repo/adrs/`);
      } else if (adr.status !== 'accepted') {
        problems.push(`${why}: --no-rc-because ${noRcBecause}: ${adr.id} is ${adr.status}, `
          + 'not accepted');
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

function sh(cmd, args, root) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.error) return { ok: false, why: `${cmd}: ${r.error.message}` };
  return { ok: r.status === 0, why: `${cmd} ${args.join(' ')} exited ${r.status}` };
}

function loud(lines) {
  const bar = '='.repeat(78);
  console.error(`\n${bar}\n${lines.map((l) => `RELEASE:PREPARE FAILED  ${l}`).join('\n')}\n${bar}`);
}

export function main(argv = process.argv.slice(2), root = ROOT, run = gitRunner(root)) {
  const dirty = run(['status', '--porcelain', '--untracked-files=normal']);
  if (dirty) {
    loud(['the working tree is not clean; commit or stash first:', ...dirty.split('\n')]);
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
    tags: run(['tag', '--list', 'v*']).split('\n').filter(Boolean),
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
    const r = sh(cmd, args, root);
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
    ...currentFingerprint(root, run), result: 'passed', base: run(['rev-parse', 'HEAD']),
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
