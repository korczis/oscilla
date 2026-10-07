#!/usr/bin/env node
// project.review-verdict: a PR touching a guarded path merges only with a recorded review
// verdict for the tree that was reviewed.
//
//   node scripts/review-verdict.mjs --pr <number>
//        [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]
//   node scripts/review-verdict.mjs --tree [--head <ref>]    # print the hash a verdict records
//
// The verdict is .ai/repo/reviews/<pr>.yaml in the head commit:
//
//   schema: review-verdict/v1
//   pr: 160
//   verdict: merge                  # merge | changes-requested
//   reviewer: oscilla-25            # the reviewing session; not the session that built the change
//   tree: <git tree hash>           # `node scripts/review-verdict.mjs --tree` at the reviewed head
//   findings:                       # every finding of the review; [] when there was none
//     - { id: R1, severity: P1, status: closed, title: ... }
//
// `tree` is the head's git tree with .ai/repo/reviews/ removed, so committing the verdict does
// not change the hash it records, and any other commit after the review does. Whether the
// reviewer is independent of the builder is not something this program can know.
//
// Exit 0: no guarded path changed, or a valid verdict. Exit 1: refused. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from './yaml-subset.mjs';

export const REVIEWS_DIR = '.ai/repo/reviews';
export const SCHEMA = 'review-verdict/v1';

/** A changed path under one of these needs a verdict. A trailing `*` matches any suffix. */
export const GUARDED = [
  'src/js/audio/*',
  'src/js/analysis/*',
  'src/js/experiments/*',
  'src/js/studio/*',
  'src/js/core/storage*',
  'scripts/release-*',
  '.github/workflows/*',
];

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const BLOCKING = new Set(['P0', 'P1']);
const STATUSES = ['open', 'closed'];

export function isGuarded(file) {
  return GUARDED.some((g) => file.startsWith(g.slice(0, -1)));
}

function git(repo, args, env) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env,
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

/** The tree hash of <ref> without .ai/repo/reviews/ (computed in a throwaway index). */
export function reviewedTree(repo, ref = 'HEAD') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'review-verdict-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
    git(repo, ['read-tree', `${ref}^{tree}`], env);
    git(repo, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', REVIEWS_DIR], env);
    return git(repo, ['write-tree'], env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The problems of a parsed verdict for this PR and tree; [] when it allows the merge. */
export function verdictProblems(doc, { pr, tree }) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['the verdict file is not a YAML mapping'];
  }
  if (doc.schema !== SCHEMA) {
    problems.push(`schema is ${JSON.stringify(doc.schema)}, not ${SCHEMA}`);
  }
  if (Number(doc.pr) !== Number(pr)) problems.push(`pr is ${JSON.stringify(doc.pr)}, not ${pr}`);
  if (typeof doc.reviewer !== 'string' || !doc.reviewer.trim()) {
    problems.push('reviewer (the reviewing session) is missing');
  }
  if (doc.verdict !== 'merge') {
    problems.push(`verdict is ${JSON.stringify(doc.verdict)}, not merge`);
  }
  if (typeof doc.tree !== 'string' || !/^[0-9a-f]{40,64}$/.test(doc.tree)) {
    problems.push('tree (the reviewed git tree hash) is missing');
  } else if (doc.tree !== tree) {
    problems.push(`the verdict is for tree ${doc.tree}, the head's is ${tree}:`
      + ' the change moved after the review');
  }
  if (!Array.isArray(doc.findings)) {
    problems.push('findings must be a list ([] when the review found nothing)');
  } else {
    doc.findings.forEach((f, i) => {
      const id = f && typeof f === 'object' && f.id ? String(f.id) : `#${i + 1}`;
      if (!f || typeof f !== 'object') {
        problems.push(`finding ${id} is not a mapping`);
        return;
      }
      if (!SEVERITIES.includes(f.severity)) {
        problems.push(`finding ${id}: severity ${JSON.stringify(f.severity)} is not one of`
          + ` ${SEVERITIES.join(', ')}`);
      }
      if (!STATUSES.includes(f.status)) {
        problems.push(`finding ${id}: status ${JSON.stringify(f.status)} is not open or closed`);
      }
      // An unreadable severity or status is a problem above, so nothing unknown passes.
      if (BLOCKING.has(f.severity) && f.status === 'open') {
        problems.push(`finding ${id} (${f.severity}) is open`);
      }
    });
  }
  return problems;
}

/**
 * @returns {{ status: 'not-required'|'accepted'|'refused', lines: string[] }}
 */
export function reviewVerdict({ repo, pr, head = 'HEAD', base, baseBranch = 'origin/main' }) {
  const lines = [];
  const say = (s) => lines.push(s);
  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]);
  const baseSha = base ? git(repo, ['rev-parse', '--verify', `${base}^{commit}`])
    : git(repo, ['merge-base', baseBranch, headSha]);
  say(`review-verdict: PR ${pr}, head ${headSha.slice(0, 12)}, merge base ${baseSha.slice(0, 12)}`);
  const changed = git(repo, ['diff', '--name-only', '--no-renames', baseSha, headSha])
    .split('\n').filter(Boolean);
  const guarded = changed.filter(isGuarded);
  if (!guarded.length) {
    say(`review-verdict: none of the ${changed.length} changed path(s) is guarded;`
      + ' no verdict needed');
    return { status: 'not-required', lines };
  }
  say(`review-verdict: ${guarded.length} guarded path(s) changed:`);
  for (const f of guarded.slice(0, 20)) say(`  ${f}`);
  if (guarded.length > 20) say(`  ... and ${guarded.length - 20} more`);

  const tree = reviewedTree(repo, headSha);
  const file = `${REVIEWS_DIR}/${pr}.yaml`;
  const show = spawnSync('git', ['-C', repo, 'show', `${headSha}:${file}`], { encoding: 'utf8' });
  if (show.status !== 0) {
    say(`review-verdict: REFUSED: ${file} is not in the head commit`);
    say(`review-verdict: an independent reviewer records it with \`tree: ${tree}\``
      + ' (schema in scripts/review-verdict.mjs)');
    return { status: 'refused', lines, tree };
  }
  let doc;
  try {
    doc = parse(show.stdout);
  } catch (e) {
    say(`review-verdict: REFUSED: ${file} is not valid YAML: ${e.message}`);
    return { status: 'refused', lines, tree };
  }
  const problems = verdictProblems(doc, { pr, tree });
  if (problems.length) {
    say(`review-verdict: REFUSED: ${file}:`);
    for (const p of problems) say(`  - ${p}`);
    return { status: 'refused', lines, tree };
  }
  const n = doc.findings.length;
  say(`review-verdict: accepted: verdict merge by ${doc.reviewer.trim()} for tree ${tree};`
    + ` ${n} finding(s), no open P0 or P1`);
  return { status: 'accepted', lines, tree };
}

function usage(message) {
  if (message) console.error(`review-verdict: ${message}`);
  console.error('usage: node scripts/review-verdict.mjs (--pr <number> | --tree) [--repo <dir>]'
    + ' [--head <ref>] [--base <ref> | --base-branch <ref>]');
  process.exit(2);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = { repo: process.cwd() };
  let treeOnly = false;
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--pr') opts.pr = value(a);
    else if (a === '--tree') treeOnly = true;
    else if (a === '--repo') opts.repo = path.resolve(value(a));
    else if (a === '--head') opts.head = value(a);
    else if (a === '--base') opts.base = value(a);
    else if (a === '--base-branch') opts.baseBranch = value(a);
    else usage(`unknown argument ${a}`);
  }
  try {
    if (treeOnly) {
      console.log(reviewedTree(opts.repo, opts.head || 'HEAD'));
      process.exit(0);
    }
    if (!/^\d+$/.test(String(opts.pr || ''))) usage('--pr <number> is required');
    const result = reviewVerdict(opts);
    for (const l of result.lines) console.log(l);
    process.exit(result.status === 'refused' ? 1 : 0);
  } catch (e) {
    console.error(`review-verdict: ${e.message}`);
    process.exit(1);
  }
}
