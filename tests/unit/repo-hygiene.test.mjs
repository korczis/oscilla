// Repository hygiene: what a commit must never carry, and where a commit may be made.
//
//   project.no-conflict-markers — no tracked text file contains a git conflict marker line
//     outside tests/unit/fixtures/conflict-marker-allowlist.json, and the policy wires
//     `git diff --cached --check` into the pre-commit hook. On 2026-10-04 a chained
//     merge-then-commit put markers into six files (#99); nothing caught it directly and 24
//     unrelated unit tests failed instead. This test names the file and the line.
//   project.worktree-topology — the policy wires `majordomus worktree guard` into the
//     pre-commit hook, docs/WORKTREES.md documents the mechanism, and no tracked script,
//     source file, workflow or document recommends `git stash` (refs/stash is one ref shared
//     by every linked worktree).
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

// A marker is seven characters at the start of a line: the two sides followed by a space or
// the end of the line, the separator alone on its line. Longer rules (a Markdown or RST
// underline of eight or more) and indented text are not markers.
export const MARKER = '^(<<<<<<<|>>>>>>>)( |$)|^=======$';
// The built artifact is rebuilt from src/ and compared byte for byte by `npm run build:check`.
const NOT_SCANNED = ['dist/index.html'];

/** Marker lines in the tracked text files of a repository: [{ path, line, text }]. */
export function conflictMarkers(root) {
  const out = git(root, ['grep', '-nIE', '-e', MARKER, '--', '.',
    ...NOT_SCANNED.map((p) => `:(exclude)${p}`)], { allow: [0, 1] });
  return out.split('\n').filter(Boolean).map((row) => {
    const m = row.match(/^(.*?):(\d+):(.*)$/);
    return { path: m[1], line: Number(m[2]), text: m[3] };
  });
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
  assert.deepEqual(bad, [], `conflict markers in tracked files:\n  ${bad.join('\n  ')}\n`
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
    // An allowlist entry excuses exactly its own line.
    const one = unexcused(found, [{ path: 'conflicted.js', line: side('='), reason: 'r' }]);
    assert.deepEqual(one.map((m) => m.line), [2, 6]);
    // What the pre-commit hook runs refuses the same file while it is only staged.
    writeFileSync(path.join(dir, 'staged.js'), conflicted);
    git(dir, ['add', 'staged.js']);
    const check = spawnSync('git', ['diff', '--cached', '--check'],
      { cwd: dir, encoding: 'utf8' });
    assert.notEqual(check.status, 0, 'git diff --cached --check refuses staged markers');
    assert.match(check.stdout, /staged\.js:2: leftover conflict marker/);
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
  assert.ok(entries.length >= 4, 'the enforcement block is read');
  for (const want of WIRED) {
    assert.deepEqual(entries.find((e) => e.name === want.name), want,
      `.ai/repo/policy.yaml enforcement declares ${want.name}; \`majordomus doctor\` then `
      + 'fails a checkout whose pre-commit hook does not run it');
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
    'majordomus worktree migrate', 'refs/stash', 'project.worktree-topology', 'detached']) {
    assert.ok(doc.includes(part), `docs/WORKTREES.md mentions ${part}`);
  }
});

// ---------------------------------------------------------------- git stash wording

// A line may mention the stash only to forbid it or to name the shared ref. Anything else
// reads as advice, and advice to stash is advice to write into a ref every worktree shares.
// The prohibition has to govern the word: in the same clause, before it ("never use the
// stash") or after it ("the stash is never used"). A "not" in another clause does not count:
// "the tree is not clean; commit or stash first" is the message this scan was written for.
const STASH = /\bstash(?:ed|es|ing)?\b/i;
const NEG = String.raw`(?:never|not|no|nor|without|forbid\w*|refus\w*)`;
const FORBIDS = new RegExp(String.raw`\b${NEG}\b[^.;:]{0,80}\bstash`
  + String.raw`|\bstash\w*[^.;:]{0,40}\b${NEG}\b|refs\/stash`, 'i');

/** The lines of a text that mention the stash without forbidding it: [{ line, text }]. */
export function stashAdvice(text) {
  return text.split('\n').map((t, i) => ({ line: i + 1, text: t }))
    .filter(({ text: t }) => STASH.test(t) && !FORBIDS.test(t));
}

const STASH_SCOPE = ['scripts', 'src', 'docs', '.github', ':(glob)*.md'];

test('no tracked script, source file, workflow or document recommends git stash', () => {
  const files = git(ROOT, ['grep', '-lIiE', '-e', 'stash', '--', ...STASH_SCOPE],
    { allow: [0, 1] }).split('\n').filter(Boolean);
  const bad = files.flatMap((f) => stashAdvice(read(f))
    .map(({ line, text }) => `${f}:${line}: ${text.trim()}`));
  assert.deepEqual(bad, [], `git stash is recommended:\n  ${bad.join('\n  ')}\n`
    + 'refs/stash is shared by every linked worktree: say "commit or copy aside".');
  assert.ok(git(ROOT, ['ls-files', '--', ...STASH_SCOPE]).split('\n').length > 100,
    'the scope is read');
});

test('mutation: the old release:prepare message is refused, a prohibition is not', () => {
  const now = read('scripts/release-prepare.mjs');
  assert.deepEqual(stashAdvice(now), []);
  const old = now.replace('commit or copy aside first', 'commit or stash first');
  assert.notEqual(old, now, 'the message to revert exists');
  assert.equal(stashAdvice(old).length, 1);
  assert.match(stashAdvice(old)[0].text, /commit or stash first/);
  assert.deepEqual(stashAdvice('Never use `git stash` in a linked worktree.'), []);
  assert.deepEqual(stashAdvice('refs/stash is one ref for every worktree'), []);
  assert.equal(stashAdvice('Stash your changes, then pull.').length, 1);
  assert.equal(stashAdvice('This is not hard: stash it.').length, 1, 'another clause');
  assert.deepEqual(stashAdvice('The stash is therefore never used here.'), []);
  assert.deepEqual(stashAdvice('a mustache is no part of this'), []);
});
