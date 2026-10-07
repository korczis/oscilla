#!/usr/bin/env node
// project.review-verdict: a PR touching a guarded path merges only with a recorded review
// verdict for the content that was reviewed.
//
//   node scripts/review-verdict.mjs --pr <number>
//        [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]
//   node scripts/review-verdict.mjs --content [--list] [--head <ref>] [--base-branch <ref>]
//        # print the digest a verdict records (and, with --list, the paths it covers)
//
// The verdict is .ai/repo/reviews/<pr>.yaml in the head commit:
//
//   schema: review-verdict/v1
//   pr: 160
//   verdict: merge                  # merge | changes-requested
//   reviewer: oscilla-25            # the reviewing session; not the session that built the change
//   content: <sha256>               # printed by `--content` at the reviewed head
//   findings:                       # every finding of the review; [] when there was none
//     - { id: R1, severity: P1, status: closed, title: ... }
//
// `content` is a SHA-256 over the guarded paths the pull request changes: every guarded path
// that differs between the merge base and the head, as its mode, blob and name at the head
// (a deletion as such). It is the PR's own guarded content and not the head's tree, so:
//   - committing the verdict does not change it (the verdict is not a guarded path);
//   - a commit that touches no guarded path does not change it: such a commit would need no
//     verdict on its own, and dist/index.html, rebuilt at every merge of main that touched
//     src/, is tied to its tree by `npm run build:check`;
//   - a merge of main that leaves the PR's guarded paths as they were does not change it (the
//     merge base moves with the head, and the difference between them stays the same);
//   - a commit that changes, adds or drops a guarded path of the PR does, and so does a merge
//     of main that changes a guarded file the PR also changes (conflicting or not), that
//     lands a guarded change the PR carried, or that brings a longer guarded list which now
//     covers a path of the PR.
// Whether the reviewer is independent of the builder is not something this program can know.
//
// Exit 0: no guarded path changed, or a valid verdict. Exit 1: refused. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml as parse } from './yaml-subset.mjs';

export const REVIEWS_DIR = '.ai/repo/reviews';
export const SCHEMA = 'review-verdict/v1';


/**
 * A changed path matching one of these needs a verdict. A trailing `*` matches any suffix;
 * an entry without one is that file. The second group is what enforces the process rules
 * (project.ci-bounded, project.fail-first, project.review-verdict): the workflows and
 * everything else under .github/, the three programs with their parser, and their tests.
 */
export const GUARDED = [
  'src/js/audio/*',
  'src/js/analysis/*',
  'src/js/experiments/*',
  'src/js/studio/*',
  'src/js/core/storage*',
  'scripts/release-*',

  '.github/*',
  'scripts/review-verdict.mjs',
  'scripts/fail-first.mjs',
  'scripts/ci-workflow-rules.mjs',
  'scripts/yaml-subset.mjs',
  'tests/unit/review-verdict.test.mjs',
  'tests/unit/fail-first.test.mjs',
  'tests/unit/ci-workflows.test.mjs',
  'tests/unit/ci-knowledge-job.test.mjs',
  'tests/unit/yaml-subset.test.mjs',
  'tests/unit/base-rule.test.mjs',
  'tests/unit/fixtures/git-repo.mjs',
];

const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
const BLOCKING = new Set(['P0', 'P1']);
const STATUSES = ['open', 'closed'];

export function isGuarded(file) {
  return GUARDED.some((g) => (g.endsWith('*') ? file.startsWith(g.slice(0, -1)) : file === g));
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

/**
 * What <head> changes against <base>: one { path, mode, blob, status } per path, sorted by
 * path. Read with -z, so a name with non-ASCII characters, a quote or a newline is itself.
 * A deleted path has mode 000000 and an all-zero blob.
 */
export function changedPaths(repo, base, head) {
  const fields = git(repo, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, head])
    .split('\0');
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const m = /^:\d+ (\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])/.exec(fields[i]);
    if (!m) throw new Error(`git diff --raw: cannot read ${JSON.stringify(fields[i])}`);
    out.push({ path: fields[i + 1], mode: m[1], blob: m[2], status: m[3] });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The digest a verdict records: SHA-256 over the guarded changed paths, each as
 * "<mode> <blob> <path>\0" at the head. Returns the digest and the paths it covers.
 */
export function reviewedContent(repo, base, head) {
  const bound = changedPaths(repo, base, head).filter((c) => isGuarded(c.path));
  const hash = createHash('sha256');
  for (const c of bound) hash.update(`${c.mode} ${c.blob} ${c.path}\0`);
  return { content: hash.digest('hex'), paths: bound.map((c) => c.path) };
}

/** The problems of a parsed verdict for this PR and content; [] when it allows the merge. */
export function verdictProblems(doc, { pr, content }) {
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
  if (typeof doc.content !== 'string' || !/^[0-9a-f]{64}$/.test(doc.content)) {
    problems.push('content (the SHA-256 of the reviewed change, from --content) is missing');
  } else if (doc.content !== content) {
    problems.push(`the verdict is for content ${doc.content}, the pull request's is ${content}:`
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
  const changed = changedPaths(repo, baseSha, headSha).map((c) => c.path);
  const guarded = changed.filter(isGuarded);
  if (!guarded.length) {
    say(`review-verdict: none of the ${changed.length} changed path(s) is guarded;`
      + ' no verdict needed');
    return { status: 'not-required', lines };
  }
  say(`review-verdict: ${guarded.length} guarded path(s) changed:`);
  for (const f of guarded.slice(0, 20)) say(`  ${f}`);
  if (guarded.length > 20) say(`  ... and ${guarded.length - 20} more`);

  const { content, paths } = reviewedContent(repo, baseSha, headSha);
  const file = `${REVIEWS_DIR}/${pr}.yaml`;
  const show = spawnSync('git', ['-C', repo, 'show', `${headSha}:${file}`], { encoding: 'utf8' });
  if (show.status !== 0) {
    say(`review-verdict: REFUSED: ${file} is not in the head commit`);
    say(`review-verdict: an independent reviewer records it with \`content: ${content}\``
      + ` (${paths.length} guarded path(s); schema in scripts/review-verdict.mjs)`);
    return { status: 'refused', lines, content };
  }
  let doc;
  try {
    doc = parse(show.stdout);
  } catch (e) {
    say(`review-verdict: REFUSED: ${file} is not valid YAML: ${e.message}`);
    return { status: 'refused', lines, content };
  }
  const problems = verdictProblems(doc, { pr, content });
  if (problems.length) {
    say(`review-verdict: REFUSED: ${file}:`);
    for (const p of problems) say(`  - ${p}`);
    return { status: 'refused', lines, content };
  }
  const n = doc.findings.length;
  say(`review-verdict: accepted: verdict merge by ${doc.reviewer.trim()} for content ${content}`
    + ` (${paths.length} guarded path(s)); ${n} finding(s), no open P0 or P1`);
  return { status: 'accepted', lines, content };
}

function usage(message) {
  if (message) console.error(`review-verdict: ${message}`);
  console.error('usage: node scripts/review-verdict.mjs (--pr <number> | --content [--list])'
    + ' [--repo <dir>] [--head <ref>] [--base <ref> | --base-branch <ref>]');
  process.exit(2);
}

// (real paths: started through a symlink, the program must still know it is the one run,
// or it would do nothing and exit 0)
const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = { repo: process.cwd() };
  let contentOnly = false;
  let list = false;
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--pr') opts.pr = value(a);
    else if (a === '--content') contentOnly = true;
    else if (a === '--list') list = true;
    else if (a === '--repo') opts.repo = path.resolve(value(a));
    else if (a === '--head') opts.head = value(a);
    else if (a === '--base') opts.base = value(a);
    else if (a === '--base-branch') opts.baseBranch = value(a);
    else usage(`unknown argument ${a}`);
  }
  try {
    if (contentOnly) {
      const head = git(opts.repo, ['rev-parse', '--verify', `${opts.head || 'HEAD'}^{commit}`]);
      const base = opts.base ? git(opts.repo, ['rev-parse', '--verify', `${opts.base}^{commit}`])
        : git(opts.repo, ['merge-base', opts.baseBranch || 'origin/main', head]);
      const { content, paths } = reviewedContent(opts.repo, base, head);
      console.log(content);
      if (list) for (const p of paths) console.log(`  ${p}`);
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
