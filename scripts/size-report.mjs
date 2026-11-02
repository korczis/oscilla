#!/usr/bin/env node
// The size of dist/index.html for a pull request (plan issue E009): its raw and gzip size, the
// headroom to the budget of scripts/build-config.mjs and the change from the merge base's
// build, printed as a Markdown table that the `unit` job of .github/workflows/ci.yml appends to
// its step summary. It reports and never fails on a size: the budget is verify-dist's gate.
//
// The number feeds two decisions: the reviewer's acceptance of a size change, and the owner's
// decisions on the gzip budget (1 200 000 B since 2026-10-29, plan issue E027, replacing the
// #114 stopgap) and on p5 (ADR 0013, plan issue E012). A pull request whose gzip growth is more
// than GZIP_THRESHOLD_BYTES names where the bytes come from in its body; that is a review
// convention, not a gate.
//
// Both builds are read from git (`git show <commit>:dist/index.html`): the head's, and the
// merge base's of the head and the base branch. In CI the head is the checkout's HEAD, the pull
// request as GitHub merged it with the base branch, so the merge base is the base branch's tip
// and the change is exactly what the pull request adds to it. Sizes are measured as
// scripts/verify-dist.mjs measures them against the budget: the byte length, and gzip level 9.
//
//   node scripts/size-report.mjs [--base-branch origin/main] [--head HEAD] [--repo <path>]
//
// Exit codes: 0 report printed; 1 a build or the merge base could not be read; 2 usage.
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BUDGET, DIST_HTML } from './build-config.mjs';

/** 1 % of the gzip budget, the binding limit (scripts/build-config.mjs). */
export const GZIP_THRESHOLD_BYTES = BUDGET.gzipBytes / 100;

const USAGE = 'usage: node scripts/size-report.mjs [--base-branch <ref>] [--head <rev>] '
  + '[--repo <path>]\n'
  + '  prints the raw and gzip size of dist/index.html at <rev> (default HEAD), the headroom to\n'
  + '  the budget of scripts/build-config.mjs and the change from the merge base of <rev> and\n'
  + '  <ref> (default origin/main), as Markdown for a CI step summary';

/** The byte length and the level-9 gzip size of a build, as verify-dist measures them. */
export function measure(buf) {
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
}

/** The four numbers: size, budget headroom (negative over it), change from the base. */
export function sizeReport({ head, base, budget = BUDGET, threshold = GZIP_THRESHOLD_BYTES }) {
  return {
    size: { raw: head.raw, gzip: head.gzip },
    budget: { rawBytes: budget.rawBytes, gzipBytes: budget.gzipBytes },
    headroom: { raw: budget.rawBytes - head.raw, gzip: budget.gzipBytes - head.gzip },
    base: { raw: base.raw, gzip: base.gzip },
    change: { raw: head.raw - base.raw, gzip: head.gzip - base.gzip },
    threshold,
    aboveThreshold: head.gzip - base.gzip > threshold,
  };
}

/** 2610384 -> '2 610 384'; with signed, a positive number gets a '+'. */
export function groupBytes(n, { signed = false } = {}) {
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = n < 0 ? '-' : signed && n > 0 ? '+' : '';
  return `${sign}${digits}`;
}

const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)} %`;
const short = (sha) => String(sha).slice(0, 7);

/** The report as Markdown: one table and the threshold sentence. */
export function formatReport(r, { head, base }) {
  const b = (n) => `${groupBytes(n)} B`;
  const d = (n) => `${groupBytes(n, { signed: true })} B`;
  const verdict = r.aboveThreshold
    ? 'This change is **above the threshold**: the pull request body names where the bytes '
      + 'come from.'
    : 'This change is within the threshold.';
  return [
    `### ${DIST_HTML} size`,
    '',
    '| | raw | gzip |',
    '| --- | ---: | ---: |',
    `| size (head \`${short(head)}\`) | ${b(r.size.raw)} | ${b(r.size.gzip)} |`,
    `| budget (scripts/build-config.mjs) | ${b(r.budget.rawBytes)} | ${b(r.budget.gzipBytes)} |`,
    `| headroom | ${b(r.headroom.raw)} (${pct(r.headroom.raw, r.budget.rawBytes)}) `
      + `| ${b(r.headroom.gzip)} (${pct(r.headroom.gzip, r.budget.gzipBytes)}) |`,
    `| merge base \`${short(base)}\` | ${b(r.base.raw)} | ${b(r.base.gzip)} |`,
    `| change from the merge base | ${d(r.change.raw)} | ${d(r.change.gzip)} |`,
    '',
    `A pull request that adds more than ${groupBytes(r.threshold)} B gzip (1 % of the gzip `
      + 'budget) names where the bytes come from in its body; a review convention, not a gate. '
      + verdict,
    '',
    'The number feeds the reviewer\'s acceptance of a size change and the owner\'s '
      + 'decisions on the gzip budget (raised on 2026-10-29, replacing the #114 stopgap) and on '
      + 'p5 (ADR 0013).',
    '',
  ].join('\n');
}

function git(repo, args, { buffer = false } = {}) {
  const r = spawnSync('git', ['-C', repo, ...args],
    { encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 1 << 28 });
  return { ok: r.status === 0, out: r.stdout, err: String(r.stderr ?? '').trim() };
}

class Refusal extends Error {}

function build(repo, commit, what) {
  const r = git(repo, ['show', `${commit}:${DIST_HTML}`], { buffer: true });
  if (!r.ok) throw new Refusal(`size-report: no ${DIST_HTML} at the ${what} ${commit}: ${r.err}`);
  return r.out;
}

function resolve(repo, args, what) {
  const r = git(repo, args);
  if (!r.ok) throw new Refusal(`size-report: cannot resolve the ${what}: ${r.err}`);
  return r.out.trim();
}

/** Run the report for a repository; returns the Markdown. Throws a Refusal. */
export function runReport({ repo = '.', head = 'HEAD', baseBranch = 'origin/main' } = {}) {
  const headSha = resolve(repo, ['rev-parse', '--verify', `${head}^{commit}`], `head ${head}`);
  const baseSha = resolve(repo, ['merge-base', baseBranch, headSha],
    `merge base of ${head} and ${baseBranch}`);
  const report = sizeReport({
    head: measure(build(repo, headSha, 'head')),
    base: measure(build(repo, baseSha, 'merge base')),
  });
  return formatReport(report, { head: headSha, base: baseSha });
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const argv = process.argv.slice(2);
  const opts = {};
  const usage = (msg) => {
    process.stderr.write(`size-report: ${msg}\n${USAGE}\n`);
    process.exit(2);
  };
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--help' || a === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (a === '--repo') opts.repo = value(a);
    else if (a === '--head') opts.head = value(a);
    else if (a === '--base-branch') opts.baseBranch = value(a);
    else usage(`unknown argument ${a}`);
  }
  try {
    process.stdout.write(runReport(opts));
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
