#!/usr/bin/env node
// project.pr-names-its-plan: a pull request names an existing plan record in its title or
// branch, or waives with a reason; its title is conventional; nothing it lands on main carries
// a closing keyword.
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
// segment of that shape (split on / - _ ., any case: feat/v603-x names V603; a version such as
// v100.0.0 is no segment). A candidate counts only when its letter begins a record file name
// under RECORD_DIRS at the base or the head (so H264 and v3.12.1 are never IDs), and it is an
// ID only when <ID>.yaml exists there, at the base or the head (a record the pull request
// adds counts). The violation codes:
//   title-grammar    the title is not `type(scope)!: description` with a declared type
//   plan-id-missing  no ID in the title or the branch, no exemption, no `plan: n/a` line
//   plan-id-unknown  a title candidate with a record letter has no record (a typo, a rename),
//                    and the pull request names no record at all; with one named, or from
//                    the branch (which an open pull request cannot rename), it is a warning
//   waiver-form      a `plan: n/a` line without a reason, or with the placeholder
//   closing-keyword  the title, the body or a commit message between the merge base and the
//                    head carries `Closes #N`, `fixes owner/repo#N`, `Resolves <issue URL>`
//                    and the like: under owner decision C1 all three reach main
// Exempt from plan-id-missing: a release (branch release/vX.Y.Z or chore/release-vX.Y.Z,
// title chore(release): vX.Y.Z, the head's package.json at X.Y.Z), a release record (branch
// chore/release-record-vX.Y.Z, title chore(release): record vX.Y.Z) and a train (branch
// train/..., title train(...) naming its members as #N). The waiver is read like
// fail-first's: in the body's own prose only.
// Each rule below sits between `// rule: <code>` and `// end rule: <code>`, and
// tests/unit/pr-metadata.test.mjs removes each block in turn to prove its fixture fails.
//
// Exit 0: no violation (or no --check). Exit 1: violations, or git failed. Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE as FAIL_FIRST_TITLE, waiver, waiverOf } from './fail-first.mjs';
import { commitOf } from './git-ref.mjs';
import { commitLevel, parseCommit } from './release-analyze.mjs';
import { commandsOf } from './shell-words.mjs';
import { REVIEWS_DIR, reviewedContent, verdictProblems } from './review-verdict.mjs';
import { parseYaml } from './yaml-subset.mjs';

export const SCHEMA = 'pr-facts/v1';
export const RECORD_DIRS = ['.ai/repo/project/issues', '.ai/repo/project/milestones'];
export const CODES = ['title-grammar', 'plan-id-missing', 'plan-id-unknown', 'waiver-form',
  'closing-keyword'];
export const ROLES = ['release', 'release-record', 'train'];
export const VERDICT_STATES = ['n/a', 'needed', 'refused', 'recorded'];
export const PLAN_WAIVER = /^[ \t]*(?:[*-][ \t]+)?plan:[ \t]*n\/a\b[ \t]*(.*)$/im;
export const CLOSING = new RegExp(String.raw`\b(close[sd]?|fix(e[sd])?|resolve[sd]?)`
  + String.raw`(?::\s*|\s+)(?:([\w.-]+\/[\w.-]+)?#\d+`
  + String.raw`|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)`, 'i');

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
const VERSION_CORE = /v\d+\.\d+\.\d+/gi;

/**
 * null when the body carries no `plan: n/a` line of its own prose, else { reason }: read as
 * fail-first's waiver() reads its own line (tests/unit/pr-metadata.test.mjs holds the two to
 * the same answers), the reason empty when it is missing, `<reason>` or punctuation.
 */
export function planWaiver(body) {
  return waiverOf(PLAN_WAIVER, body);
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
  for (const seg of String(branch).replace(VERSION_CORE, '/').split(/[/._-]+/)) {
    if (/^[a-z]\d{3,4}$/i.test(seg)) add(seg.toUpperCase(), 'branch');
  }
  return out;
}

/**
 * The role that exempts a pull request from naming a record, or null. Each role is held by
 * its branch and its title together; a release also by `version`, the head's package.json
 * version, when the caller knows it (inspect() always passes it).
 */
export function roleOf({ title = '', branch = '', version }) {
  const t = String(title).trim();
  const b = String(branch);
  const release = new RegExp(`^(?:release/|chore/release-)(${VERSION})$`).exec(b);
  if (release && t === `chore(release): ${release[1]}`
    && (version === undefined || `v${version}` === release[1])) return 'release';
  const record = new RegExp(`^chore/release-record-(${VERSION})$`).exec(b);
  if (record && t === `chore(release): record ${record[1]}`) return 'release-record';
  if (/^train\/./.test(b) && /^train\([^)]*\): /.test(t) && /#\d+\b/.test(t)) return 'train';
  return null;
}

/**
 * The violations of one pull request against the records:
 * { ids, unknown, warnings, role, waived, violations: [{ code, message }] }. The input is
 * { title, branch, body, commits: [{ sha, message }], version }; commits are those between
 * the merge base and the head, whose messages land on main with a merge commit.
 */
export function judge({ title = '', branch = '', body = '', commits = [], version }, records) {
  const violations = [];
  const flag = (code, message) => violations.push({ code, message });
  const t = String(title).trim();
  const all = candidates({ title: t, branch });
  const known = all.filter((c) => records.prefixes.has(c.id[0]));
  const foreign = all.filter((c) => !records.prefixes.has(c.id[0])).map((c) => c.id);
  const ids = known.filter((c) => records.ids.has(c.id));
  const unknown = known.filter((c) => !records.ids.has(c.id));
  // A title candidate without a record is refused only when nothing else is named: then it is
  // the pull request's one link, and it points nowhere. Every other one is a warning.
  const refusedUnknown = ids.length ? [] : unknown.filter((c) => c.from === 'title');
  const warnings = unknown.filter((c) => !refusedUnknown.includes(c)).map((c) => `${c.id}`
    + ` (from the ${c.from}) has the letter of a plan record but no ${c.id}.yaml; it counts`
    + ' for nothing');
  const role = roleOf({ title: t, branch, version });
  const w = planWaiver(body);

  // rule: title-grammar
  const parsed = parseCommit({ subject: t });
  const written = /^[a-z]+/.exec(t);
  if (!parsed.conventional || !TYPES.has(parsed.type) || !written
    || written[0] !== parsed.type) {
    flag('title-grammar', `the title is not \`type(scope): description\` with a type of`
      + ` ${[...TYPES].join(', ')}: ${JSON.stringify(t)} (it is the subject of the merge`
      + ' commit on main)');
  }
  // end rule: title-grammar

  // rule: plan-id-missing
  if (!ids.length && !refusedUnknown.length && !role && !w) {
    flag('plan-id-missing', 'neither the title nor the branch names a plan record'
      + ` (${[...records.prefixes].sort().join(', ')} and digits, as a file under`
      + ` ${RECORD_DIRS.join(' or ')}); name one in the title, or put \`plan: n/a <reason>\``
      + ' on a line of the body'
      + `${foreign.length ? ` (${foreign.join(', ')}: no record file begins with that letter)`
        : ''}`
      + `${unknown.length ? ` (${unknown.map((c) => c.id).join(', ')}: no such record)` : ''}`);
  }
  // end rule: plan-id-missing

  // rule: plan-id-unknown
  for (const c of refusedUnknown) {
    flag('plan-id-unknown', `${c.id} (from the title) has the letter of a plan record but no`
      + ` ${c.id}.yaml under ${RECORD_DIRS.join(' or ')} at the base or the head, and the pull`
      + ' request names no other record: correct the title');
  }
  // end rule: plan-id-unknown

  // rule: waiver-form
  if (w && !w.reason) {
    flag('waiver-form', '`plan: n/a` needs a reason on its line (the placeholder `<reason>`'
      + ' or punctuation is not one)');
  }
  // end rule: waiver-form

  // rule: closing-keyword
  const sources = [['title', t], ['body', String(body || '')], ...commits.map((c) => [
    `message of commit ${String(c.sha || '').slice(0, 12)}`, String(c.message || '')])];
  const closing = sources.map(([where, text]) => [where, CLOSING.exec(text)])
    .filter(([, m]) => m);
  if (closing.length) {
    flag('closing-keyword', `${closing.map(([where, m]) => `the ${where} carries the closing`
      + ` keyword "${m[0]}"`).join('; ')}: on main it would close that issue outside its`
      + ' record; write `Refs #N` (a commit message is changed by rewording the commit)');
  }
  // end rule: closing-keyword

  return { ids: ids.map((c) => c.id), unknown: unknown.map((c) => c.id), warnings, role,
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

/** The records at the given revisions, the first revision's file winning where both have one. */
export function recordsAt(repo, revs) {
  const paths = revs.flatMap((rev) => git(repo, ['ls-tree', '-r', '-z', '--name-only', rev,
    '--', ...RECORD_DIRS]).split('\0').filter(Boolean));
  return recordsOf(paths);
}

/**
 * The commits between the merge base and the head: [{ sha, message }]. Each message is read
 * whole from its commit object by its byte size (git cat-file --batch), so no byte a message
 * may carry (a record separator, a NUL) can end it early or hide the rest of it.
 */
export function commitsOf(repo, mergeBase, head) {
  const shas = git(repo, ['rev-list', `${mergeBase}..${head}`]).split('\n').filter(Boolean);
  if (!shas.length) return [];
  const r = spawnSync('git', ['-C', repo, 'cat-file', '--batch'],
    { input: `${shas.join('\n')}\n`, maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    throw new Error(`git cat-file --batch: ${String(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  const out = r.stdout;
  const commits = [];
  let at = 0;
  for (const sha of shas) {
    const eol = out.indexOf(0x0a, at);
    const header = out.subarray(at, eol).toString('utf8').split(' ');
    if (header[0] !== sha || header[1] !== 'commit') {
      throw new Error(`git cat-file --batch: ${header.join(' ')} where commit ${sha} was asked`);
    }
    const object = out.subarray(eol + 1, eol + 1 + Number(header[2]));
    at = eol + 1 + Number(header[2]) + 1;
    const blank = object.indexOf('\n\n');
    commits.push({ sha, message: blank < 0 ? '' : object.subarray(blank + 2).toString('utf8') });
  }
  return commits;
}

/** The head's package.json version, or '' when it has none (then no release is exempt). */
function versionAt(repo, head) {
  try {
    const v = JSON.parse(show(repo, head, 'package.json') ?? 'null')?.version;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
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

/**
 * The verdict state, by review-verdict's own test: n/a without a guarded path, needed without
 * a verdict file, refused when verdictProblems() finds any (a stale digest, an open P0 or P1,
 * a missing field), recorded otherwise.
 */
function verdictState(repo, head, pr, guarded, content) {
  if (!guarded.length) return 'n/a';
  const text = show(repo, head, `${REVIEWS_DIR}/${pr}.yaml`);
  if (text === null) return 'needed';
  return verdictProblems(yamlOrNull(text), { pr, content }).length ? 'refused' : 'recorded';
}

/**
 * Everything the program knows of one pull request: the judgement and the facts.
 * `pr` is { title, body, headRefName, number }.
 */
export function inspect({ repo, pr, base = 'origin/main', head = 'HEAD' }) {
  const headSha = git(repo, ['rev-parse', '--verify', `${head}^{commit}`]).trim();
  const baseSha = commitOf(repo, base);
  const mergeBase = git(repo, ['merge-base', baseSha, headSha]).trim();
  const records = recordsAt(repo, [headSha, baseSha]);
  const onBase = recordsAt(repo, [baseSha]).ids;
  const title = String(pr.title || '').trim();
  const branch = String(pr.headRefName || '');
  const body = String(pr.body || '');
  const commits = commitsOf(repo, mergeBase, headSha);
  const verdict = judge({ title, branch, body, commits, version: versionAt(repo, headSha) },
    records);

  const facts = verdict.ids.map((id) => {
    const rel = records.ids.get(id);
    const doc = yamlOrNull(show(repo, headSha, rel)) || yamlOrNull(show(repo, baseSha, rel))
      || {};
    const milestone = rel.includes('/milestones/') ? id : doc.milestone ?? null;
    return { id, path: rel, title: doc.title ?? null, milestone,
      serves: Array.isArray(doc.serves) ? doc.serves : [], priority: doc.priority ?? null,
      onBase: onBase.has(id) };
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
    warnings: verdict.warnings,
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
  for (const w of facts.warnings || []) lines.push(`pr-metadata: warning: ${w}`);
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
  // a record only the head adds is not on main yet: link it at the head
  const link = (f) => (slug ? `[${f.id}](https://github.com/${slug}/blob/`
    + `${f.onBase ? 'main' : facts.head}/${f.path})` : `\`${f.id}\``);
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
  for (const w of facts.warnings || []) out.push(`Warning: ${cell(w)}`, '');
  if (facts.violations.length) {
    out.push(`**${facts.violations.length} violation(s)**`, '');
    for (const v of facts.violations) out.push(`- \`${v.code}\`: ${cell(v.message)}`);
  } else {
    out.push('No violation.');
  }
  return `${out.join('\n')}\n`;
}

const FORCED = /\bset[ \t]+\+(?:e\b|o[ \t]+errexit\b)|\|\|[ \t]*(?:true|:)(?![\w-])/;
const SHELLS = /^(?:ba|z|da|k|a|fi)?sh$/;

/** Whether a command, as shell-words reads it, can end the step green without the call. */
function forcesSuccess(cmd, line) {
  if (cmd.wrappers.includes('exec')) return true;
  const p = cmd.program;
  if (!p) return false;
  if (p.dynamic) return true;
  const name = p.text.slice(p.text.lastIndexOf('/') + 1);
  const [first] = cmd.args;
  if (name === 'exit' || name === 'return') {
    return !first || first.dynamic || !/^\d+$/.test(first.text) || BigInt(first.text) % 256n === 0n;
  }
  if (['eval', 'source', '.', 'alias', 'shopt', 'enable', 'trap'].includes(name)) {
    return name !== 'trap' || cmd.args.some((a) => a.dynamic || FORCED_SUCCESS.test(a.text));
  }
  if (name === 'set') {
    return cmd.args.some((a, i) => a.dynamic || /^\+[A-Za-z]*e/.test(a.text)
      || (/^\+[A-Za-z]*o$/.test(a.text) && cmd.args[i + 1]?.text === 'errexit'));
  }
  if ((name === 'true' || name === ':') && line.includes('||')) return true;
  if (SHELLS.test(name)) {
    const c = cmd.args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a.text));
    if (c >= 0) {
      const script = cmd.args[c + 1];
      return !script || script.dynamic || FORCED_SUCCESS.test(script.text)
        || commandsOf(script.text).some((x) => x.program && /^(?:true|:)$/.test(x.program.text));
    }
  }
  return false;
}

/**
 * A line of the judge's step that can end it green without the call deciding, as a matcher
 * (`FORCED_SUCCESS.test(line)`), read as bash reads it (scripts/shell-words.mjs), so quoting
 * inside a word does not hide it (`e\\xit 0`, `ex''it 0`, `ex\\ec true`, review of #255, R7):
 * an `exit` or `return` whose status is not a number that bash leaves nonzero (bash exits with
 * it modulo 256, so `exit 256` succeeds; a bare `exit` passes the last status on, 0 after an
 * `if`; `exit "$s"` is whatever $s holds), any `exec` (it replaces the step's shell, so what it
 * starts ends the step: `exec true`), `eval`, `source`, `.`, `alias`, `shopt` and `enable`
 * (each can make any word mean anything), a `trap` that does any of these, `set +e` or
 * `set +o errexit`, `|| true`, `|| :`, a program named by a variable or a substitution, and a
 * shell's `-c` text that does any of these.
 */
export const FORCED_SUCCESS = {
  test(line) {
    const text = String(line);
    if (FORCED.test(text)) return true;
    return commandsOf(text).some((cmd) => forcesSuccess(cmd, text));
  },
};

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
  // compared as sets of key and value: the order of the keys means nothing to GitHub
  const sorted = (o) => JSON.stringify(Object.entries(o && typeof o === 'object' ? o : {})
    .map(([k, v]) => [k, String(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const perms = wf.permissions || {};
  if (sorted(perms) !== sorted(model.permissions)) {
    out.push(`permissions are ${JSON.stringify(perms)}, the model's`
      + ` ${JSON.stringify(model.permissions)}`);
  }
  if (sorted(wf.concurrency) !== sorted(model.concurrency)) {
    out.push(`concurrency is ${JSON.stringify(wf.concurrency)}, the model's`
      + ` ${JSON.stringify(model.concurrency)}`);
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
  // how the judge is reached: setup-node before the checkout, then the step that takes the
  // judge from the base commit (review of #255, R12)
  const order = [].concat(model.steps || []).map(String);
  const shape = steps.slice(0, order.length).map((st) => (st.uses
    ? String(st.uses).replace(/@.*$/, '') : st.id || st.name || '(run)'));
  if (JSON.stringify(shape) !== JSON.stringify(order)) {
    out.push(`the first steps are ${JSON.stringify(shape)}, the model's ${JSON.stringify(order)}`);
  }
  const node = steps[0]?.with || {};
  if (['cache', 'node-version-file', 'package-manager-cache'].some((k) => k in node)) {
    out.push('setup-node reads a file of the checkout (cache, node-version-file)');
  }
  // the judge fetches nothing after the checkout, which keeps no token in .git/config for the
  // pull request's code to read (review of #255, round 8, P3)
  const persist = model.checkout?.['persist-credentials'];
  const checkout = steps.find((st) => /^actions\/checkout@/.test(String(st.uses))) || {};
  if (checkout.with?.['persist-credentials'] !== persist) {
    out.push(`the checkout persists its credentials (persist-credentials:`
      + ` ${JSON.stringify(checkout.with?.['persist-credentials'] ?? null)}, the model's`
      + ` ${JSON.stringify(persist ?? null)})`);
  }
  const last = steps.at(-1) || {};
  if (last.shell !== model.shell) out.push(`the judge's shell is ${JSON.stringify(last.shell)}`);
  if (last.env?.PR !== '${{ github.event.pull_request.number }}') {
    out.push('PR is not the event\'s');
  }
  const run = String(last.run || '').replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#'));
  if (run.at(-1) !== model.call) out.push(`the last command is not the call: ${run.at(-1)}`);
  if (!run.some((l) => /^if \[ -z "\$PR" \]; then .*exit 1; fi$/.test(l))) {
    out.push('it does not fail when there is no pull request');
  }
  if (run.some((l) => FORCED_SUCCESS.test(l))) out.push('an early or forced success');
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
