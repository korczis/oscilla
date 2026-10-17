// The repository's skills (.ai/repo/skills/<id>/SKILL.md) name only what exists.
//
// A skill is a short procedure a worker runs step by step, so every step has to resolve: a
// command that does not exist, an npm script that was renamed or a path that moved turns the
// procedure into a description of nothing. For every SKILL.md this test checks:
//   - the front matter says `schema: skill/v1` and an `id` equal to its directory, the body
//     has the sections # Purpose, # Procedure and # Output, and every `related` id is a skill;
//   - every `npm run <script>` names a script of package.json;
//   - every repository path it names (the roots .ai/, .github/, src/, tests/, scripts/, docs/,
//     dist/) exists, apart from placeholders (`<pr>`, `vX.Y.Z`) and globs, and every relative
//     Markdown link resolves from the skill's directory;
//   - every `project.<id>` is a project rule, and every "ADR NNNN" an ADR file;
//   - every `majordomus <command>` in its code (inline or fenced) is a command of the
//     installed tool, a second plain word is one that command's help names, and every
//     `--flag` is one that command's help (or its subcommand's) names. This needs the tool:
//     where `majordomus` is not on PATH (the CI unit job) that test is skipped and says so;
//     `npm run verify`, which needs the tool for its doctor anyway, runs it.
// The format itself is also checked by `majordomus skills check` and doctor (doctrine
// majordomus.skill-integrity). Not checked: git and gh subcommands and their flags, and
// whether a step is the right step.
//   node --test tests/unit/skills.test.mjs
//
// The skills this test exercises, by id. Majordomus's skill lifecycle counts such a marker
// only on a case or crate test with a recorded run, which a node test is not, so the skills
// stay `status: draft` (.ai/repo/skills/README.md says why):
// majordomus-skill: add-a-browser-check
// majordomus-skill: fail-first-change
// majordomus-skill: majordomus-upgrade
// majordomus-skill: merge-train
// majordomus-skill: release
// majordomus-skill: review-a-guarded-pr

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const SKILLS = '.ai/repo/skills';
const SECTIONS = ['Purpose', 'Procedure', 'Output'];

/** Every skill file, as a repository-relative path. */
function skillFiles() {
  return readdirSync(path.join(ROOT, SKILLS), { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(`${SKILLS}/${d.name}/SKILL.md`))
    .map((d) => `${SKILLS}/${d.name}/SKILL.md`).sort();
}

/** The front matter as flat `key: value` pairs, and the body below it. */
export function splitSkill(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/\s+#.*$/, '').trim();
  }
  return { fm, body: m[2] };
}

const flowList = (raw) => String(raw || '').replace(/^\[|\]$/g, '').split(',')
  .map((s) => s.trim()).filter(Boolean);

/** The text of every code span and fenced code line, prose left out. */
export function codeOf(body) {
  const out = [];
  const prose = body.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm, (_, block) => {
    out.push(...block.split('\n'));
    return '';
  });
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  return out;
}

const PATH_RE =
  /(?<![\w./@~$-])((?:\.ai|\.github|src|tests|scripts|docs|dist)\/[\w./@-]*)/g;

/** Repository paths a text names, without placeholders, globs or line suffixes. */
export function namedPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(PATH_RE)) {
    if (/[*{<$\\]/.test(text[m.index + m[0].length] || '')) continue;
    const p = m[1].replace(/[.-]+$/, '').replace(/:\d+$/, '');
    if (/X\.Y\.Z|\.\.\./.test(p)) continue; // a version placeholder, vX.Y.Z
    if (/^\.ai\/local(\/|$)/.test(p)) continue; // checkout-local state, never tracked
    out.add(p.replace(/\/$/, ''));
  }
  return out;
}

/** Each `majordomus ...` invocation in the code: its words up to the end of the command. */
export function majordomusCalls(code) {
  const calls = [];
  for (const line of code) {
    for (const m of line.matchAll(/(?:^|[\s"'(])(?:[^\s"'(]*\/)?majordomus\s+([^\n]*)/g)) {
      const words = m[1].split(/\s+(?:&&|\|\||[|;]|<<|2>&1|>>?)(?=\s)|[)`]/)[0]
        .match(/"[^"]*"|'[^']*'|\S+/g) || [];
      if (words.length && /^[a-z][a-z-]*$/.test(words[0])) calls.push(words);
    }
  }
  return calls;
}

/**
 * The problems of one skill. `help(args)` answers `{ known, text }` for `majordomus <args>
 * --help`; without it the majordomus commands are not judged.
 */
export function skillProblems(file, text, { scripts, rules, adrs, skills, help } = {}) {
  const problems = [];
  const at = (msg) => problems.push(`${file}: ${msg}`);
  const { fm, body } = splitSkill(text);
  const dir = path.posix.dirname(file);
  if (!fm) {
    at('no front matter');
  } else {
    if (fm.schema !== 'skill/v1') at(`schema is ${fm.schema || 'absent'}, not skill/v1`);
    if (fm.id !== path.posix.basename(dir)) at(`id ${fm.id} is not its directory`);
    for (const r of flowList(fm.related)) {
      if (!skills.includes(r)) at(`related skill ${r} does not exist`);
    }
  }
  for (const s of SECTIONS) {
    const sec = body.match(new RegExp(`^# ${s}\\n([\\s\\S]*?)(?=^# |$(?![\\s\\S]))`, 'm'));
    if (!sec || !sec[1].trim()) at(`section # ${s} is missing or empty`);
  }
  const code = codeOf(body);
  for (const line of code) {
    for (const [, name] of line.matchAll(/\bnpm run ([\w:-]+)/g)) {
      if (!scripts[name]) at(`npm run ${name}: package.json has no such script`);
    }
  }
  for (const p of namedPaths(body)) if (!exists(p)) at(`${p} does not exist`);
  for (const [, href] of body.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/.test(href)) continue;
    const target = path.posix.normalize(path.posix.join(dir, href));
    if (!exists(target)) at(`link ${href} resolves to ${target}, which does not exist`);
  }
  for (const [, id] of body.matchAll(/\bproject\.([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
    if (!rules.includes(`project.${id}`)) at(`project.${id} is not a project rule`);
  }
  for (const [, n] of body.matchAll(/\bADR (\d{4})\b/g)) {
    if (!adrs.some((f) => f.startsWith(`${n}-`))) at(`ADR ${n} has no file in .ai/repo/adrs`);
  }
  if (help) {
    for (const words of majordomusCalls(code)) {
      const [cmd, second] = words;
      const top = help([cmd]);
      if (!top.known) {
        at(`majordomus ${cmd}: no such command`);
        continue;
      }
      let text = top.text;
      if (second && /^[a-z][a-z-]+$/.test(second)) {
        if (!new RegExp(`\\b${second}\\b`).test(top.text)) {
          at(`majordomus ${cmd} ${second}: the help of ${cmd} names no ${second}`);
        }
        text += help([cmd, second]).text;
      }
      for (const w of words) {
        const flag = w.match(/^(--[a-z][a-z-]*)/);
        if (flag && !text.includes(flag[1])) {
          at(`majordomus ${words.slice(0, 2).join(' ')}: no option ${flag[1]}`);
        }
      }
    }
  }
  return problems;
}

/** What the repository offers a skill to name. */
function inventory() {
  const rules = readdirSync(path.join(ROOT, '.ai/repo/rules/project'))
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => (read(`.ai/repo/rules/project/${f}`).match(/^id: (\S+)$/m) || [])[1])
    .filter(Boolean);
  return {
    scripts: JSON.parse(read('package.json')).scripts,
    rules,
    adrs: readdirSync(path.join(ROOT, '.ai/repo/adrs')),
    skills: skillFiles().map((f) => path.posix.basename(path.posix.dirname(f))),
  };
}

const HELP = new Map();
/** `majordomus <args> --help`, cached; null when the tool is not on PATH. */
function majordomusHelp(args) {
  const key = args.join(' ');
  if (!HELP.has(key)) {
    const r = spawnSync('majordomus', [...args, '--help'], { cwd: ROOT, encoding: 'utf8' });
    if (r.error) return null;
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    HELP.set(key, { known: !/unknown command/.test(text), text });
  }
  return HELP.get(key);
}

test('the repository has skills, each under its own directory', () => {
  const files = skillFiles();
  assert.ok(files.length > 0, `${SKILLS} holds no <id>/SKILL.md`);
});

test('every skill names only npm scripts, paths, links, rules and ADRs that exist', () => {
  const inv = inventory();
  const bad = skillFiles().flatMap((f) => skillProblems(f, read(f), inv));
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}`);
});

test('every majordomus command a skill names is one the installed tool has', (t) => {
  if (!majordomusHelp([])) {
    t.skip('majordomus is not on PATH here; `npm run verify` checks the commands');
    return;
  }
  const inv = inventory();
  const bad = skillFiles().flatMap((f) => skillProblems(f, read(f),
    { ...inv, help: majordomusHelp })).filter((p) => p.includes(': majordomus '));
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}`);
});

// ---------------------------------------------------------------- mutation cases

const GOOD = `---
schema: skill/v1
id: probe
version: 1
title: Probe
description: A conforming skill.
status: active
related: []
---

# Purpose

Shows the checks pass on a conforming text.

# Procedure

1. Run \`npm run verify\` and read [the lifecycle](../../workflows/task-lifecycle.md).
2. Hold rule \`project.fail-first\` (ADR 0055) with \`node scripts/fail-first.mjs\`.

   \`\`\`bash
   majordomus finish --outcome completed --note <file> 2>&1 | tail -1
   majordomus worktree create train/<date>
   \`\`\`

# Output

Nothing.
`;

const FIXTURE = '.ai/repo/skills/probe/SKILL.md';
const fakeHelp = (args) => {
  const known = { finish: '--outcome --verify-command --note', worktree: 'create migrate' };
  return { known: args[0] in known, text: known[args[0]] || '' };
};
const probe = (text) => skillProblems(FIXTURE, text, { ...inventory(), skills: ['probe'],
  help: fakeHelp });

test('mutation: a conforming skill has no problem', () => {
  assert.deepEqual(probe(GOOD), []);
});

test('mutation: each broken reference is reported', () => {
  const cases = [
    ['`npm run verify`', '`npm run verify:all`', /npm run verify:all: package.json/],
    ['`node scripts/fail-first.mjs`', '`node scripts/fail-last.mjs`',
      /scripts\/fail-last\.mjs does not exist/],
    ['../../workflows/task-lifecycle.md', '../../workflows/lifecycle.md',
      /link \.\.\/\.\.\/workflows\/lifecycle\.md resolves/],
    ['project.fail-first', 'project.fail-last', /project\.fail-last is not a project rule/],
    ['ADR 0055', 'ADR 0999', /ADR 0999 has no file/],
    ['related: []', 'related: [nothing]', /related skill nothing does not exist/],
    ['id: probe', 'id: other', /id other is not its directory/],
    ['# Output\n\nNothing.\n', '# Output\n\n', /section # Output is missing or empty/],
    ['majordomus finish --outcome', 'majordomus finnish --outcome',
      /majordomus finnish: no such command/],
    ['--note <file>', '--notes <file>', /majordomus finish --outcome: no option --notes/],
    ['worktree create', 'worktree make', /majordomus worktree make: the help of worktree/],
  ];
  for (const [from, to, re] of cases) {
    assert.ok(GOOD.includes(from), `the fixture holds ${from}`);
    const found = probe(GOOD.replace(from, to));
    assert.ok(found.some((p) => re.test(p)), `${to}: ${found.join('; ') || 'nothing reported'}`);
  }
});

test('mutation: placeholders, globs and prose are not taken for names', () => {
  const text = GOOD.replace('Nothing.', 'Writes `.ai/repo/reviews/<pr>.yaml` and '
    + '`scripts/release-*` and `.ai/repo/releases/vX.Y.Z.yaml`; majordomus decides in prose; '
    + '~/.local/share/x/scripts/y.');
  assert.deepEqual(probe(text), []);
});
