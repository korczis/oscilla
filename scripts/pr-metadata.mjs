#!/usr/bin/env node
// project.pr-names-its-plan: a pull request names an existing plan record in its title or
// branch, or waives with a reason; its title is conventional; it carries no closing keyword.
//
//   node scripts/pr-metadata.mjs --pr-json <file> [--repo <dir>] [--base <ref>] [--head <ref>]
//        [--slug <owner/name>] (--check | --facts | --summary <file>)...
//
// <file> is `gh pr view <n> --json title,body,headRefName,number`. <base> is the base branch
// (default origin/main), <head> the commit judged (default HEAD; in the metadata job the merge
// of the pull request with its base). The modes combine: --check prints one line per
// violation and decides the exit status, --facts prints the facts as JSON (pr-facts/v1, the
// seam a later GitHub projection reads), --summary appends them as Markdown to <file>
// ($GITHUB_STEP_SUMMARY), with links under --slug (default $GITHUB_REPOSITORY).
//
// A plan ID is a capital letter and 3 or 4 digits in the title (case-sensitive), or a branch
// segment of that shape (split on / - _ ., any case: feat/v603-x names V603). A candidate
// counts only when its letter begins a record file name under RECORD_DIRS at the base or the
// head (so H264 and v3.12.1 are never IDs), and it is an ID only when <ID>.yaml exists there,
// at the base or the head (a record the pull request adds counts). The violation codes:
//   title-grammar    the title is not `type(scope)!: description` with a declared type
//   plan-id-missing  no ID in the title or the branch, no exemption, no `plan: n/a` line
//   plan-id-unknown  a candidate with a record letter has no record (a typo, a rename)
//   waiver-form      a `plan: n/a` line without a reason, or with the placeholder
//   closing-keyword  the body carries `Closes #N`, `fixes owner/repo#N` and the like
// Exempt from plan-id-missing: a release (branch release/vX.Y.Z, title chore(release): vX.Y.Z),
// a release record (branch chore/release-record-vX.Y.Z) and a train (title train(...) naming
// its members as #N). The waiver is read like fail-first's: in the body's own prose only.
// Each rule below sits between `// rule: <code>` and `// end rule: <code>`, and
// tests/unit/pr-metadata.test.mjs removes each block in turn to prove its fixture fails.
//
// Exit 0: no violation (or no --check). Exit 1: violations, or git failed. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE as FAIL_FIRST_TITLE, proseOf, waiver } from './fail-first.mjs';
import { commitLevel, parseCommit } from './release-analyze.mjs';
import { REVIEWS_DIR, reviewedContent } from './review-verdict.mjs';
import { parseYaml } from './yaml-subset.mjs';

export const SCHEMA = 'pr-facts/v1';
export const RECORD_DIRS = ['.ai/repo/project/issues', '.ai/repo/project/milestones'];
export const CODES = ['title-grammar', 'plan-id-missing', 'plan-id-unknown', 'waiver-form',
  'closing-keyword'];
export const ROLES = ['release', 'release-record', 'train'];
export const PLAN_WAIVER = /^[ \t]*(?:[*-][ \t]+)?plan:[ \t]*n\/a\b[ \t]*(.*)$/im;
export const CLOSING =
  /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)(?::\s*|\s+)([\w.-]+\/[\w.-]+)?#\d+/i;

/**
 * The declared title types: every type release-analyze.mjs gives a level of its own (one it
 * does not call unknown), and `train`, the merge train's.
 */
export const TYPES = new Set(['train', ...['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf',
  'refactor', 'revert', 'style', 'test'].filter((type) => !/^unknown type/.test(
  commitLevel({ conventional: true, type, breaking: false }).why))]);

const RECORD_FILE = /^([A-Z])\d+\.yaml$/;
const RECORD_ID = /^[A-Z]\d{3,4}$/;
const VERSION = String.raw`v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/**
 * null when the body carries no `plan: n/a` line of its own prose, else { reason }: read as
 * fail-first's waiver() reads its own line (tests/unit/pr-metadata.test.mjs holds the two to
 * the same answers), the reason empty when it is missing, `<reason>` or punctuation.
 */
export function planWaiver(body) {
  const m = PLAN_WAIVER.exec(proseOf(body));
  if (!m) return null;
  const reason = m[1].trim();
  return { reason: /[\p{L}\p{N}]/u.test(reason.replace(/<[^>]*>/g, '')) ? reason : '' };
}

/** The records among a list of paths: { ids: Map<id, path>, prefixes: Set<letter> }. */
export function recordsOf(paths) {
  const ids = new Map();
  const prefixes = new Set();
  for (const p of paths) {
    const dir = path.posix.dirname(p);
    const name = path.posix.basename(p);
    const m = RECORD_FILE.exec(name);
    if (!RECORD_DIRS.includes(dir) || !m) continue;
    prefixes.add(m[1]);
    const id = name.slice(0, -'.yaml'.length);
    if (RECORD_ID.test(id) && !ids.has(id)) ids.set(id, p);
  }
  return { ids, prefixes };
}

/** The candidate IDs of a title and a branch, in order, without repeats: [{ id, from }]. */
export function candidates({ title = '', branch = '' }) {
  const out = [];
  const add = (id, from) => { if (!out.some((c) => c.id === id)) out.push({ id, from }); };
  for (const m of String(title).matchAll(/\b[A-Z]\d{3,4}\b/g)) add(m[0], 'title');
  for (const seg of String(branch).split(/[/._-]+/)) {
    if (/^[a-z]\d{3,4}$/i.test(seg)) add(seg.toUpperCase(), 'branch');
  }
  return out;
}

/** The role that exempts a pull request from naming a record, or null. */
export function roleOf({ title = '', branch = '' }) {
  const t = String(title).trim();
  const release = new RegExp(`^release/(${VERSION})$`).exec(branch);
  if (release && t === `chore(release): ${release[1]}`) return 'release';
  if (new RegExp(`^chore/release-record-${VERSION}$`).test(branch)) return 'release-record';
  if (/^train\([^)]*\): /.test(t) && /#\d+\b/.test(t)) return 'train';
  return null;
}

/**
 * The violations of one pull request ({ title, branch, body }) against the records:
 * { ids, unknown, role, waived, violations: [{ code, message }] }.
 */
export function judge({ title = '', branch = '', body = '' }, records) {
  const violations = [];
  const flag = (code, message) => violations.push({ code, message });
  const t = String(title).trim();
  const all = candidates({ title: t, branch });
  const known = all.filter((c) => records.prefixes.has(c.id[0]));
  const foreign = all.filter((c) => !records.prefixes.has(c.id[0])).map((c) => c.id);
  const ids = known.filter((c) => records.ids.has(c.id));
  const unknown = known.filter((c) => !records.ids.has(c.id));
  const role = roleOf({ title: t, branch });
  const w = planWaiver(body);

  // rule: title-grammar
  const parsed = parseCommit({ subject: t });
  const written = /^[a-z]+/.exec(t);
  if (!parsed.conventional || !TYPES.has(parsed.type) || !written
    || written[0] !== parsed.type) {
    flag('title-grammar', `the title is not \`type(scope): description\` with a type of`
      + ` ${[...TYPES].join(', ')}: ${JSON.stringify(t)}`);
  }
  // end rule: title-grammar

  // rule: plan-id-missing
  if (!ids.length && !unknown.length && !role && !w) {
    flag('plan-id-missing', 'neither the title nor the branch names a plan record'
      + ` (${[...records.prefixes].sort().join(', ')} and digits, as a file under`
      + ` ${RECORD_DIRS.join(' or ')}); name one, or put \`plan: n/a <reason>\` on a line`
      + ' of the body'
      + `${foreign.length ? ` (${foreign.join(', ')}: no record file begins with that letter)`
        : ''}`);
  }
  // end rule: plan-id-missing

  // rule: plan-id-unknown
  for (const c of unknown) {
    flag('plan-id-unknown', `${c.id} (from the ${c.from}) has the letter of a plan record`
      + ` but no ${c.id}.yaml under ${RECORD_DIRS.join(' or ')} at the base or the head`);
  }
  // end rule: plan-id-unknown

  // rule: waiver-form
  if (w && !w.reason) {
    flag('waiver-form', '`plan: n/a` needs a reason on its line (the placeholder `<reason>`'
      + ' or punctuation is not one)');
  }
  // end rule: waiver-form

  // rule: closing-keyword
  const closing = CLOSING.exec(String(body || ''));
  if (closing) {
    flag('closing-keyword', `the body carries the closing keyword "${closing[0]}": a merge`
      + ' would close that issue outside its record; write `Refs #N`');
  }
  // end rule: closing-keyword

  return { ids: ids.map((c) => c.id), unknown: unknown.map((c) => c.id), role,
    waived: w && w.reason ? w.reason : null, violations };
}

function git(repo, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

const show = (repo, rev, file) => git(repo, ['show', `${rev}:${file}`], { allowFail: true });

function yamlOrNull(text) {
  if (text === null) return null;
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

/** The records at the base and the head, the head's file winning where both have one. */
export function recordsAt(repo, revs) {
  const paths = revs.flatMap((rev) => git(repo, ['ls-tree', '-r', '-z', '--name-only', rev,
    '--', ...RECORD_DIRS]).split('\0').filter(Boolean));
  return recordsOf(paths);
}

/** Whether the pull request adds or changes the `evidence:` of a project record. */
function changesEvidence(repo, base, head) {
  const files = git(repo, ['diff', '--name-only', '-z', '--no-renames', base, head, '--',
    '.ai/repo/project']).split('\0').filter((f) => f.endsWith('.yaml'));
  return files.some((f) => {
    const after = yamlOrNull(show(repo, head, f));
    const before = yamlOrNull(show(repo, base, f));
    const evidence = after && Array.isArray(after.evidence) ? after.evidence : [];
    return evidence.length > 0
      && JSON.stringify(evidence) !== JSON.stringify((before && before.evidence) || []);
  });
}

/** The verdict state: n/a without a guarded path, recorded when it matches the digest. */
function verdictState(repo, head, pr, guarded, content) {
  if (!guarded.length) return 'n/a';
  const doc = yamlOrNull(show(repo, head, `${REVIEWS_DIR}/${pr}.yaml`));
  return doc && doc.verdict === 'merge' && doc.content === content ? 'recorded' : 'needed';
}

/**
 * Everything the program knows of one pull request: the judgement and the facts.
 * `pr` is { title, body, headRefName, number }.
 */
export function inspect({ repo, pr, base = 'origin/main', head = 'HEAD' }) {
  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const baseSha = git(repo, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  const mergeBase = git(repo, ['merge-base', baseSha, headSha]).trim();
  const records = recordsAt(repo, [headSha, baseSha]);
  const title = String(pr.title || '').trim();
  const branch = String(pr.headRefName || '');
  const body = String(pr.body || '');
  const verdict = judge({ title, branch, body }, records);

  const facts = verdict.ids.map((id) => {
    const rel = records.ids.get(id);
    const doc = yamlOrNull(show(repo, headSha, rel)) || yamlOrNull(show(repo, baseSha, rel))
      || {};
    const milestone = rel.includes('/milestones/') ? id : doc.milestone ?? null;
    return { id, path: rel, title: doc.title ?? null, milestone,
      serves: Array.isArray(doc.serves) ? doc.serves : [], priority: doc.priority ?? null };
  });
  const commit = parseCommit({ subject: title, body });
  const level = commitLevel(commit).level;
  const { content, paths: guarded } = reviewedContent(repo, mergeBase, headSha);
  const ff = waiver(body);
  const failFirst = !FAIL_FIRST_TITLE.test(title) ? 'n/a'
    : ff && ff.reason ? `waived ${ff.reason}` : 'applies';
  const evidence = changesEvidence(repo, mergeBase, headSha);
  return {
    schema: SCHEMA,
    pr: pr.number ?? null,
    title,
    branch,
    head: headSha,
    base: baseSha,
    mergeBase,
    ids: facts,
    unknown: verdict.unknown,
    milestone: facts.find((f) => f.milestone)?.milestone ?? null,
    role: verdict.role,
    waived: verdict.waived,
    level,
    breaking: commit.breaking,
    guarded,
    content,
    verdict: verdictState(repo, headSha, pr.number, guarded, content),
    failFirst,
    evidence,
    // Merge commits are the repository's only landing method (owner decision C1, 2026-10-29),
    // so a pull request carrying plan evidence and one carrying none land the same way.
    land: 'merge',
    violations: verdict.violations,
  };
}

/** The --check lines. */
export function checkLines(facts) {
  const lines = [`pr-metadata: PR #${facts.pr ?? '?'} ${facts.branch}: ${facts.title}`];
  const named = facts.ids.map((f) => `${f.id} (${f.path})`).join(', ');
  lines.push(`pr-metadata: plan records: ${named || 'none'}`
    + `${facts.role ? `; exempt as ${facts.role}` : ''}`
    + `${facts.waived ? `; waived: plan: n/a ${facts.waived}` : ''}`);
  if (!facts.violations.length) {
    lines.push('pr-metadata: no violation');
    return lines;
  }
  lines.push(`pr-metadata: ${facts.violations.length} violation(s):`);
  for (const v of facts.violations) lines.push(`  ${v.code}: ${v.message}`);
  return lines;
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The --summary Markdown: one table of the facts, the violations below it. */
export function summary(facts, slug) {
  const link = (f) => (slug ? `[${f.id}](https://github.com/${slug}/blob/main/${f.path})`
    : `\`${f.id}\``);
  const ids = facts.ids.map((f) => `${link(f)} ${cell(f.title || '')}`).join('<br>');
  const rows = [
    ['Plan records', ids || (facts.role ? `none (exempt as ${facts.role})`
      : facts.waived ? `none (plan: n/a ${cell(facts.waived)})` : 'none')],
    ['Milestone', facts.milestone || '-'],
    ['Serves', [...new Set(facts.ids.flatMap((f) => f.serves))].map(cell).join('<br>') || '-'],
    ['Level', `${facts.level}${facts.breaking ? ' (breaking)' : ''}`],
    ['Guarded paths', facts.guarded.length ? `${facts.guarded.length}; verdict ${facts.verdict}`
      : 'none'],
    ['Fail-first', cell(facts.failFirst)],
    ['Plan evidence', facts.evidence ? 'changed' : 'none'],
    ['Lands by', facts.land],
  ];
  const out = ['### Pull request metadata (project.pr-names-its-plan)', '',
    '| Fact | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`), ''];
  if (facts.violations.length) {
    out.push(`**${facts.violations.length} violation(s)**`, '');
    for (const v of facts.violations) out.push(`- \`${v.code}\`: ${cell(v.message)}`);
  } else {
    out.push('No violation.');
  }
  return `${out.join('\n')}\n`;
}

/** The read-only judge job, as .ai/repo/ci/pr-meta.yaml declares it. */
function judgeModel(modelText) {
  const doc = parseYaml(modelText);
  return doc && doc.judge ? doc.judge : null;
}

/**
 * What makes the workflow differ from the model's `judge:` block, or leaves its job unable to
 * refuse: [] when the two agree and the last command of the last step is exactly the call.
 */
export function workflowModelProblems(workflowText, modelText) {
  const out = [];
  const model = judgeModel(modelText);
  if (!model) return ['the model has no judge: block'];
  const wf = parseYaml(workflowText) || {};
  const on = wf.on || {};
  const triggers = Object.keys(typeof on === 'object' && !Array.isArray(on) ? on : {});
  if (triggers.join() !== 'pull_request') {
    out.push(`triggers are ${JSON.stringify(triggers)}, not ["pull_request"] only`);
  }
  const types = [].concat(on.pull_request?.types || []).map(String);
  const want = [].concat(model.triggers?.pull_request?.types || []).map(String);
  if (JSON.stringify([...types].sort()) !== JSON.stringify([...want].sort())) {
    out.push(`pull_request types are ${JSON.stringify(types)}, the model's`
      + ` ${JSON.stringify(want)}`);
  }
  const perms = wf.permissions || {};
  if (JSON.stringify(perms) !== JSON.stringify(model.permissions || {})) {
    out.push(`permissions are ${JSON.stringify(perms)}, the model's`
      + ` ${JSON.stringify(model.permissions)}`);
  }
  const jobs = Object.keys(wf.jobs || {});
  if (jobs.join() !== model.job) out.push(`jobs are ${JSON.stringify(jobs)}, not [${model.job}]`);
  const job = (wf.jobs || {})[model.job] || {};
  if (job.name !== model.job) out.push(`the job's name is ${JSON.stringify(job.name)}`);
  if (job.permissions !== undefined) out.push('the job widens or narrows the permissions');
  if (Number(job['timeout-minutes']) !== Number(model.bound)) {
    out.push(`timeout-minutes is ${job['timeout-minutes']}, the model's bound ${model.bound}`);
  }
  if (job.if !== undefined || job['continue-on-error'] !== undefined) {
    out.push('the job is conditional or non-fatal');
  }
  const steps = job.steps || [];
  if (steps.some((s) => s.if !== undefined || s['continue-on-error'] !== undefined)) {
    out.push('a step is conditional or non-fatal');
  }
  const last = steps.at(-1) || {};
  if (last.env?.PR !== '${{ github.event.pull_request.number }}') {
    out.push('PR is not the event\'s');
  }
  const run = String(last.run || '').replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#'));
  if (run.at(-1) !== model.call) out.push(`the last command is not the call: ${run.at(-1)}`);
  if (!run.some((l) => /^if \[ -z "\$PR" \]; then .*exit 1; fi$/.test(l))) {
    out.push('it does not fail when there is no pull request');
  }
  if (run.some((l) => /\bexit 0\b|\bset \+e\b|\|\|\s*true\b/.test(l))) {
    out.push('an early or forced success');
  }
  return out;
}

function usage(message) {
  if (message) console.error(`pr-metadata: ${message}`);
  console.error('usage: node scripts/pr-metadata.mjs --pr-json <file> [--repo <dir>]'
    + ' [--base <ref>] [--head <ref>] [--slug <owner/name>]'
    + ' (--check | --facts | --summary <file>)...');
  process.exit(2);
}

// (real paths: started through a symlink, the program must still know it is the one run,
// or it would do nothing and exit 0)
const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = { repo: process.cwd(), slug: process.env.GITHUB_REPOSITORY || '' };
  const modes = { check: false, facts: false, summary: null };
  let prFile = null;
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--pr-json') prFile = value(a);
    else if (a === '--repo') opts.repo = path.resolve(value(a));
    else if (a === '--base') opts.base = value(a);
    else if (a === '--head') opts.head = value(a);
    else if (a === '--slug') opts.slug = value(a);
    else if (a === '--check') modes.check = true;
    else if (a === '--facts') modes.facts = true;
    else if (a === '--summary') modes.summary = value(a);
    else usage(`unknown argument ${a}`);
  }
  if (!prFile) usage('--pr-json <file> is required');
  if (!modes.check && !modes.facts && !modes.summary) usage('name --check, --facts or --summary');
  let pr;
  try {
    pr = JSON.parse(readFileSync(prFile, 'utf8'));
  } catch (e) {
    usage(`cannot read ${prFile}: ${e.message}`);
  }
  if (!pr || typeof pr !== 'object' || typeof pr.title !== 'string') {
    usage(`${prFile} carries no pull request title`);
  }
  let facts;
  try {
    facts = inspect({ repo: opts.repo, pr, base: opts.base, head: opts.head });
  } catch (e) {
    console.error(`pr-metadata: ${e.message}`);
    process.exit(1);
  }
  if (modes.facts) console.log(JSON.stringify(facts, null, 2));
  if (modes.summary) appendFileSync(modes.summary, summary(facts, opts.slug));
  if (modes.check) {
    const say = modes.facts ? console.error : console.log;
    for (const l of checkLines(facts)) say(l);
    process.exit(facts.violations.length ? 1 : 0);
  }
}
