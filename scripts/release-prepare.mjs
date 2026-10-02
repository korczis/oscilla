#!/usr/bin/env node
// npm run release:prepare — turn the current clean tree into a release candidate. Never tags.
//
//   node scripts/release-prepare.mjs [--dry-run] [--prerelease [--preid rc]]
//
//   1. refuse a dirty tree (a release candidate is exactly a commit)
//   2. analyse conventional commits since the last v* tag (release-analyze.mjs)
//   3. bump package.json + package-lock.json ONCE (npm version --no-git-tag-version), or
//      confirm the untagged version package.json already carries
//   4. rebuild dist/index.html, then npm run version:check, npm run release-gate and
//      majordomus doctor
//   5. on any failure restore package.json, package-lock.json and dist/index.html from HEAD
//      (the tree was clean, so that is exact) and exit non-zero, loudly
//   6. on success write the gate receipt into the git directory (never a tracked file, so the
//      tree stays clean) for release:publish: version, source digest and dist sha256 at the
//      time the gate passed. Any later source change invalidates it.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository, formatAnalysis } from './release-analyze.mjs';
import { ROOT, computeSourceDigest, gitRunner, readVersion, sha256 } from './release-metadata.mjs';

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

/** What the receipt must say for the checkout as it is now. */
export function currentFingerprint(root = ROOT) {
  return {
    version: readVersion(root),
    sourceDigest: computeSourceDigest(root),
    distSha256: sha256(readFileSync(path.join(root, 'dist/index.html'))),
  };
}

/** Problems comparing a receipt with the current fingerprint (empty = verified). */
export function receiptProblems(receipt, now) {
  if (!receipt) return ['no release-gate receipt: run npm run release:prepare first'];
  const problems = [];
  for (const k of ['version', 'sourceDigest', 'distSha256']) {
    if (receipt[k] !== now[k]) {
      problems.push(`gate receipt ${k} ${receipt[k]} != current ${now[k]}`);
    }
  }
  if (receipt.result !== 'passed') problems.push(`gate receipt result is ${receipt.result}`);
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

export function main(argv = process.argv.slice(2), root = ROOT) {
  const run = gitRunner(root);
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
    ...currentFingerprint(root), result: 'passed', base: run(['rev-parse', 'HEAD']),
    gate: GATE_COMMANDS.map(([c, a]) => `${c} ${a.join(' ')}`), at: new Date().toISOString(),
  };
  if (receipt.version !== proposal.version) {
    loud([`package.json says ${receipt.version}, expected ${proposal.version}`]);
    return 1;
  }
  writeFileSync(receiptPath(run, root), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`\nRelease candidate v${receipt.version} passed the gate `
    + `(source ${receipt.sourceDigest.slice(0, 12)}, dist ${receipt.distSha256.slice(0, 12)}).`);
  if (proposal.action === 'bump') {
    console.log('Next: commit it, e.g. git commit -am "chore(release): v'
      + `${receipt.version}", land it on main, then npm run release:publish (dry run) and `
      + 'npm run release:publish -- --yes.');
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
