// Repository hygiene: what a commit must never carry, and where a commit may be made.
//
//   project.no-conflict-markers — no tracked text file contains a git conflict marker line
//     outside tests/unit/fixtures/conflict-marker-allowlist.json, the policy wires
//     `git diff --cached --check` into the pre-commit hook, and .gitattributes turns the
//     whitespace classes of that check off, so it refuses markers and nothing else (a merge
//     commit stages every line the other side added). On 2026-10-04 a chained
//     merge-then-commit put markers into six files (#99); nothing caught it directly and 24
//     unrelated unit tests failed instead. This test names the file and the line.
//   project.worktree-topology — the policy wires `majordomus worktree guard` into the
//     pre-commit hook, docs/WORKTREES.md documents the mechanism, and no line of a tracked
//     script, source file, workflow, rule or document in STASH_SCOPE mentions the stash
//     except to forbid it (refs/stash is one ref shared by every linked worktree).
//
// `majordomus doctor` proves the hook lines exist in a developer checkout; this test proves
// the policy still declares them, and it runs in CI through `npm test`.
//   node --test tests/unit/repo-hygiene.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const ALLOWLIST = 'tests/unit/fixtures/conflict-marker-allowlist.json';

function git(root, args, { allow = [0] } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.ok(!r.error, `git ${args.join(' ')}: ${r.error && r.error.message}`);
  assert.ok(allow.includes(r.status), `git ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

// ---------------------------------------------------------------- conflict markers

// A marker is seven characters at the start of a line: the two sides and the diff3 base
// (seven "|") followed by a space or the end of the line, the separator alone on its line.
// Longer rules (a Markdown or RST underline of eight or more) and indented text are not
// markers. A line may end in a carriage return: a CRLF working file conflicts too.
export const MARKER = '^(<<<<<<<|>>>>>>>|\\|{7})( |\r?$)|^=======\r?$';
// The built artifact is rebuilt from src/ and compared byte for byte by `npm run build:check`.
const NOT_SCANNED = ['dist/index.html'];

/** Marker lines in the tracked text files of a repository: [{ path, line, text }]. */
export function conflictMarkers(root) {
  const out = git(root, ['grep', '-nIE', '-e', MARKER, '--', '.',
    ...NOT_SCANNED.map((p) => `:(exclude)${p}`)], { allow: [0, 1] });
  return out.split('\n').map((row) => row.replace(/\r$/, ''))
    .map((row) => row.match(/^(.*?):(\d+):(.*)$/)).filter(Boolean)
    .map((m) => ({ path: m[1], line: Number(m[2]), text: m[3] }));
}

/** Markers not excused by an allowlist entry ({ path, line: <exact text>, reason }). */
export function unexcused(markers, entries) {
  return markers.filter((m) => !entries.some((e) => e.path === m.path && e.line === m.text));
}

const side = (ch) => ch.repeat(7);

test('no tracked file contains a git conflict marker', () => {
  const { entries } = JSON.parse(read(ALLOWLIST));
  const markers = conflictMarkers(ROOT);
  const bad = unexcused(markers, entries).map((m) => `${m.path}:${m.line}: ${m.text}`);
  assert.deepEqual(bad, [], 'project.no-conflict-markers: conflict markers in tracked files:\n'
    + `  ${bad.join('\n  ')}\n`
    + 'Resolve the merge (rebuild dist, never hand-resolve it); a line that only looks like a '
    + `marker goes into ${ALLOWLIST} with its reason.`);
});

test('every allowlist entry carries a reason and is still needed', () => {
  const { about, entries } = JSON.parse(read(ALLOWLIST));
  assert.ok(about.length > 40, 'the allowlist says what it is');
  assert.ok(Array.isArray(entries) && entries.length <= 10, 'keep the allowlist small');
  const markers = conflictMarkers(ROOT);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), ['line', 'path', 'reason'], JSON.stringify(e));
    assert.ok(e.reason.length >= 30, `${e.path}: the reason says why the line is legitimate`);
    assert.ok(markers.some((m) => m.path === e.path && m.text === e.line),
      `${e.path}: no such marker line any more; drop the entry`);
    // The hook has no allowlist: `git diff --cached --check` refuses the line unless the
    // path's marker size is not seven, so an allowlisted line could never be committed.
    const size = git(ROOT, ['check-attr', 'conflict-marker-size', '--', e.path]);
    assert.match(size, /conflict-marker-size: (?!7$)\d+$/m,
      `${e.path}: an allowlisted path sets conflict-marker-size=<n> (not 7) in .gitattributes, `
      + 'or the pre-commit hook refuses the line the allowlist excuses');
  }
});

// What the pre-commit hook runs, on the staged changes of a repository: { status, stdout }.
const stagedCheck = (root) => spawnSync('git', ['diff', '--cached', '--check'],
  { cwd: root, encoding: 'utf8' });

test('.gitattributes turns the whitespace classes of the staged check off for every path', () => {
  // `git diff --cached --check` reports conflict markers and whitespace errors. In a merge
  // commit the staged diff holds every line the other side added, so a trailing space or a
  // blank line at EOF from main refused a correctly resolved merge. `-whitespace` leaves the
  // marker check, which is the rule.
  const attrs = read('.gitattributes').split('\n').filter((l) => /^\*\s/.test(l));
  assert.ok(attrs.some((l) => /\s-whitespace(\s|$)/.test(l)),
    'project.no-conflict-markers: .gitattributes carries `* ... -whitespace`');
  for (const probe of ['src/js/main.js', 'docs/WORKTREES.md', 'tests/README.md']) {
    assert.match(git(ROOT, ['check-attr', 'whitespace', '--', probe]), /whitespace: unset$/m,
      `${probe}: no later .gitattributes line turns the whitespace check back on`);
  }
});

test('mutation: a committed marker is found with its file and line, and only a real one', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-markers-'));
  try {
    git(dir, ['init', '-q']);
    const conflicted = ['const a = 1;', `${side('<')} HEAD`, 'const b = 2;', side('='),
      'const b = 3;', `${side('>')} origin/main`, ''].join('\n');
    const innocent = ['Heading', '========', `  ${side('=')}`, `x ${side('<')} y`,
      `${side('<')}<`, `${side('>')}tail`, ''].join('\n');
    writeFileSync(path.join(dir, 'conflicted.js'), conflicted);
    writeFileSync(path.join(dir, 'innocent.md'), innocent);
    writeFileSync(path.join(dir, 'untracked.js'), conflicted);
    git(dir, ['add', 'conflicted.js', 'innocent.md']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '-q', '-m', 'x']);
    const found = conflictMarkers(dir);
    assert.deepEqual(found.map((m) => `${m.path}:${m.line}`),
      ['conflicted.js:2', 'conflicted.js:4', 'conflicted.js:6']);
    assert.equal(found[0].text, `${side('<')} HEAD`);
    // A CRLF file and the diff3 base marker are named too, not thrown on.
    writeFileSync(path.join(dir, 'crlf.txt'),
      ['a', `${side('<')} HEAD`, 'b', `${side('|')} base`, 'c', side('='), 'd',
        `${side('>')} theirs`, ''].join('\r\n'));
    git(dir, ['add', 'crlf.txt']);
    assert.deepEqual(conflictMarkers(dir).filter((m) => m.path === 'crlf.txt')
      .map((m) => `${m.line}: ${m.text}`),
    [`2: ${side('<')} HEAD`, `4: ${side('|')} base`, `6: ${side('=')}`, `8: ${side('>')} theirs`]);
    git(dir, ['rm', '-q', '--cached', 'crlf.txt']);
    // An allowlist entry excuses exactly its own line.
    const one = unexcused(found, [{ path: 'conflicted.js', line: side('='), reason: 'r' }]);
    assert.deepEqual(one.map((m) => m.line), [2, 6]);
    // What the pre-commit hook runs refuses the same file while it is only staged.
    writeFileSync(path.join(dir, 'staged.js'), conflicted);
    git(dir, ['add', 'staged.js']);
    const check = stagedCheck(dir);
    assert.notEqual(check.status, 0, 'git diff --cached --check refuses staged markers');
    assert.match(check.stdout, /staged\.js:2: leftover conflict marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mutation: with this repository\'s attributes the staged check refuses markers only', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'osc-check-'));
  try {
    git(dir, ['init', '-q']);
    // The other side of a merge: a Markdown hard break and a blank line at EOF.
    writeFileSync(path.join(dir, 'theirs.md'), 'line with break  \nlast\n\n');
    git(dir, ['add', 'theirs.md']);
    const bare = stagedCheck(dir);
    assert.notEqual(bare.status, 0, 'without the attribute git refuses the whitespace');
    assert.match(bare.stdout, /theirs\.md:1: trailing whitespace/);
    // The first line of this repository's .gitattributes that binds every path.
    const star = read('.gitattributes').split('\n').find((l) => /^\*\s/.test(l));
    writeFileSync(path.join(dir, '.gitattributes'), `${star}\n`);
    assert.equal(stagedCheck(dir).status, 0, 'with it, whitespace from the other side passes');
    writeFileSync(path.join(dir, 'both.txt'), `trailing  \n${side('<')} HEAD\n`);
    git(dir, ['add', 'both.txt']);
    const marked = stagedCheck(dir);
    assert.equal(marked.status, 2);
    assert.equal(marked.stdout.trim(), 'both.txt:2: leftover conflict marker');
    git(dir, ['rm', '-q', '--cached', 'both.txt']);
    // A setext underline of exactly seven is a marker to git; the marker size excuses a path.
    writeFileSync(path.join(dir, 'p.md'), `Purpose\n${side('=')}\n`);
    git(dir, ['add', 'p.md']);
    assert.match(stagedCheck(dir).stdout, /p\.md:2: leftover conflict marker/);
    writeFileSync(path.join(dir, '.gitattributes'), `${star}\np.md conflict-marker-size=32\n`);
    assert.equal(stagedCheck(dir).status, 0, 'conflict-marker-size excuses the path in the hook');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- policy wiring

/** The `enforcement` entries of .ai/repo/policy.yaml: [{ name, path, args, wired_by }]. */
export function enforcementEntries(policyText) {
  const start = policyText.search(/^enforcement:\s*$/m);
  if (start < 0) return [];
  const body = policyText.slice(start).split('\n').slice(1);
  const out = [];
  for (const line of body) {
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const first = line.match(/^ {2}- name:\s*(\S+)/);
    if (first) { out.push({ name: first[1] }); continue; }
    const kv = out.length && line.match(/^ {4}([a-z_]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    out[out.length - 1][kv[1]] = kv[1] === 'args'
      ? kv[2].replace(/^\[|\]$/g, '').split(',').map((a) => a.trim()).filter(Boolean)
      : kv[2];
  }
  return out;
}

const WIRED = [
  { name: 'worktree-guard', path: 'majordomus', args: ['worktree', 'guard'],
    wired_by: 'git-hook:pre-commit' },
  { name: 'diff-check-on-commit', path: 'git', args: ['diff', '--cached', '--check'],
    wired_by: 'git-hook:pre-commit' },
];

test('the policy wires the worktree guard and the staged diff check into pre-commit', () => {
  const entries = enforcementEntries(read('.ai/repo/policy.yaml'));
  assert.ok(entries.length >= 2, 'the enforcement block is read');
  for (const want of WIRED) {
    assert.deepEqual(entries.find((e) => e.name === want.name), want,
      `.ai/repo/policy.yaml enforcement declares ${want.name}; \`majordomus doctor\` then `
      + 'fails a checkout whose pre-commit hook does not name it');
  }
});

test('mutation: a policy without the guard entry, or with a weaker one, is refused', () => {
  const policy = read('.ai/repo/policy.yaml');
  const without = policy.replace(/^ {2}- name: worktree-guard\n(?: {4}.*\n)+/m, '');
  assert.notEqual(without, policy, 'the entry to remove exists');
  assert.equal(enforcementEntries(without).find((e) => e.name === 'worktree-guard'), undefined);
  const manual = policy.replace(
    /(- name: worktree-guard\n(?: {4}.*\n)*? {4}wired_by: )git-hook:pre-commit/, '$1manual');
  assert.notDeepEqual(enforcementEntries(manual).find((e) => e.name === 'worktree-guard'),
    WIRED[0], 'wired_by: manual is documented, not verified');
});

test('docs/WORKTREES.md documents the layout, the guard and what the guard cannot see', () => {
  assert.ok(existsSync(path.join(ROOT, 'docs/WORKTREES.md')), 'docs/WORKTREES.md exists');
  const doc = read('docs/WORKTREES.md');
  for (const part of ['-wt/', 'majordomus worktree create', 'majordomus worktree guard',
    'majordomus worktree migrate', 'refs/stash', 'project.worktree-topology', 'detached',
    'git reset --soft HEAD~1', 'worktree.path_mismatch', 'does not execute the hook']) {
    assert.ok(doc.includes(part), `docs/WORKTREES.md mentions ${part}`);
  }
  // Round 1 of the review: the documents prescribed a second branch in the same worktree as
  // the way to set work aside, and the guard this rule wires refuses a commit there.
  for (const rel of ['docs/WORKTREES.md', '.ai/repo/rules/project/worktree-topology.v1.md',
    '.ai/repo/rules/project/shared-machine-discipline.v1.md']) {
    assert.doesNotMatch(read(rel).replace(/\s+/g, ' '), /throwaway branch/i,
      `${rel}: a throwaway branch in a canonical worktree is refused by the guard`);
  }
});

// ---------------------------------------------------------------- git stash wording

// A line may mention the stash only to forbid it, to name the shared ref, or to name the
// thing as a noun ("stash advice", "a stash entry"). Anything else reads as advice, and
// advice to stash is advice to write into a ref every worktree shares.
//
// Every mention on the line is judged on its own, and the prohibition has to govern the
// word: directly before it in the same clause, with nothing between them but the verb and
// an article ("never use the stash", "do not `git stash`"), or directly after it as a
// passive ("the stash is never used"). A negation elsewhere on the line does not count.
// "the tree is not clean; commit or stash first" is the message this scan was written for,
// and round 1 of its review showed the first version accepting that message with a comma or
// a dash in place of the semicolon, and "Run `git stash` if the tree is not clean".
const STASH = /\bstash(?:ed|es|ing)?\b/gi;
const NEG = String.raw`(?:\b(?:never|not|no|nor|nothing|nobody|without|forbid\w*|refus\w*)|n't)`;
const BETWEEN = String.raw`(?:use[sd]?|using|runs?|running|recommend\w*|advis\w*|suggest\w*`
  + String.raw`|mention\w*|to|an?|the|any|ever)`;
// A clause ends at . ; : , ( ) # and at a dash that stands between words.
const CLAUSE_BREAK = /[.;:,()#—–]|\s-+\s/g;
const GOVERNED = new RegExp(String.raw`${NEG}\s+(?:${BETWEEN}\s+){0,4}` + '`?(?:git\\s+)?`?$', 'i');
const PASSIVE = new RegExp(
  String.raw`^\w*` + '`?' + String.raw`\s+(?:is|are|was|were|must|may)\s+(?:therefore\s+)?`
  + String.raw`(?:never|not|forbidden|refused)\b`, 'i');
const NOUN = /^\w*\s+(?:advice|scan|entry|entries|wording)\b/i;

/** Whether the mention of the stash at `at` in `line` is forbidden, named or a noun. */
function stashMentionIsSafe(line, at) {
  const before = line.slice(0, at);
  if (/refs\/$/.test(before)) return true;
  const clause = before.split(CLAUSE_BREAK).pop();
  const after = line.slice(at);
  return GOVERNED.test(clause) || PASSIVE.test(after) || NOUN.test(after);
}

/** The lines of a text that mention the stash without forbidding it: [{ line, text }]. */
export function stashAdvice(text) {
  return text.split('\n').map((t, i) => ({ line: i + 1, text: t }))
    .filter(({ text: t }) => [...t.matchAll(STASH)]
      .some((m) => !stashMentionIsSafe(t, m.index)));
}

// What states how the repository works now, and what a user or a session reads as an
// instruction: scripts and their messages, source, documents, workflows, the root Markdown
// files, tests/README.md, and the layer's rules, workflows and provider templates. ADR
// bodies and dated specifications are history and say what happened. The test files hold
// the refused wordings as fixtures.
export const STASH_SCOPE = ['scripts', 'src', 'docs', '.github', ':(glob)*.md', 'tests/README.md',
  '.ai/README.md', '.ai/repo/rules', '.ai/repo/workflows', '.ai/repo/providers', '.ai/repo/skills'];

test('no tracked script, source file, workflow, rule or document recommends git stash', () => {
  const files = git(ROOT, ['grep', '-lIiE', '-e', 'stash', '--', ...STASH_SCOPE],
    { allow: [0, 1] }).split('\n').filter(Boolean);
  const bad = files.flatMap((f) => stashAdvice(read(f))
    .map(({ line, text }) => `${f}:${line}: ${text.trim()}`));
  assert.deepEqual(bad, [], 'project.worktree-topology: a line mentions the stash without '
    + `forbidding it:\n  ${bad.join('\n  ')}\n`
    + 'refs/stash is shared by every linked worktree: say "commit or copy aside".');
  for (const must of ['scripts/release-prepare.mjs', 'docs/WORKTREES.md', 'tests/README.md',
    'CLAUDE.md', '.ai/repo/rules/project/worktree-topology.v1.md',
    '.ai/repo/workflows/task-lifecycle.md']) {
    assert.equal(git(ROOT, ['ls-files', '--', ...STASH_SCOPE]).split('\n').includes(must), true,
      `${must} is in the scanned scope`);
  }
});

test('mutation: the old release:prepare message is refused in every punctuation, a prohibition is not', () => {
  const now = read('scripts/release-prepare.mjs');
  assert.deepEqual(stashAdvice(now), []);
  const old = now.replace('commit or copy aside first', 'commit or stash first');
  assert.notEqual(old, now, 'the message to revert exists');
  assert.equal(stashAdvice(old).length, 1);
  assert.match(stashAdvice(old)[0].text, /commit or stash first/);
  const refused = [
    'the working tree is not clean; commit or stash first:',
    'the working tree is not clean, commit or stash first:',
    'the working tree is not clean - commit or stash first',
    'the working tree is not clean commit or stash first',
    'Run `git stash` if the tree is not clean, then pull.',
    'If you have no time, git stash and switch branches.',
    'git stash -u   # no changes are lost',
    'You can stash your changes without losing them.',
    'Dirty tree? Do not panic, just git stash.',
    'Use git stash (not git reset) to set work aside.',
    'No problem, just git stash and pull',
    'If you do not want to commit, stash your changes',
    'run git stash, then git stash pop',
    'Stash your changes, then pull.',
    'This is not hard: stash it.',
    'Never use `git stash` here; when in a hurry, git stash anyway.',
    'refs/stash is shared, so stash carefully.',
  ];
  for (const line of refused) assert.equal(stashAdvice(line).length, 1, `refused: ${line}`);
  const accepted = [
    'Never use `git stash` in a linked worktree.',
    'Do not stash; copy the files aside.',
    "Don't use the stash.",
    'refs/stash is one ref for every worktree',
    'The stash is therefore never used here.',
    'The stash is never recommended by a tracked script or document.',
    'no pattern kills, no stash, no chained merge-and-commit',
    'a stash entry met in another worktree (#136)',
    'reintroduces stash advice',
    'a mustache is no part of this',
  ];
  for (const line of accepted) assert.deepEqual(stashAdvice(line), [], `accepted: ${line}`);
  // The scope: the same advice in a file the first version did not read.
  for (const rel of ['tests/README.md', '.ai/repo/workflows/task-lifecycle.md']) {
    const hit = stashAdvice(`${read(rel)}\nIf the tree is dirty, git stash first.\n`);
    assert.equal(hit.length, 1, `${rel} with stash advice appended is refused`);
  }
});
