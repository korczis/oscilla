// Knowledge integrity: what the repository's knowledge says is enforced, is enforced.
//
// The project knowledge (docs/CLAIMS.yaml, the project rules, the bootstraps, the .ai/ layer's
// workflows, the feature records and the README) names files, tests and checks. A name that
// resolves to nothing is a claim of enforcement nobody performs. This test makes each of those
// names pay rent, and it runs in CI through `npm test`, so it holds whether or not a
// contributor has Majordomus installed:
//
//   - every claim in docs/CLAIMS.yaml: a known status; for a guaranteed claim, its source,
//     implementation and test exist, and its test is run by a script CI runs; an algorithm
//     id in its prose is a current default, or a retained one on a line that says so; every
//     browser check its note cites is defined in the suite it names (V272 D8);
//   - every ADR from 0011 on is cited by a claim, a feature or a use case, or is listed with
//     the reason it adds no capability of the page (V272 D8);
//   - docs/v4/completion-ledger.md: every completion-matrix row names its claims (or "–"),
//     and no row or open item that names a guaranteed claim reads MISSING, "in review" or
//     "fixing" (V272 D7);
//   - a guaranteed claim whose note admits a skip says that CI fails instead (V272 D9);
//   - every project rule's `x-majordomus` block names tests that exist and that CI runs, and
//     claims that exist;
//   - rule project.rules-name-their-enforcement: every active project rule without such a
//     block either has an `# Enforcement` (or `# Verification`) section whose backticked
//     paths exist, whose test and script files something runs (a workflow step, through an
//     npm script or directly; an npm script; a test CI runs that imports them), and at least
//     one of which is a test or script file CI executes, or is class advisory and says why
//     under `# Why advisory`; a blocking rule's x-majordomus block names tests; the rules
//     index in .ai/repo/rules/project/README.md lists exactly the rules in force; every
//     `project.<id>` the bootstraps, README, docs/, workflows, rules and provider templates
//     name is a rule in force; every "CI runs it" / "run by CI" / "pages.yml executes it" /
//     "Runs in `npm run x`" / "`npm run x` runs it" / "(npm run x: ...)" claim in the leading
//     comments of a JavaScript file directly under tests/browser/ or scripts/ is true of the
//     workflow or npm script it names; an active rule's enforcement section (and
//     docs/WORKTREES.md) names no "Planned" proof and no Majordomus version other than the one
//     CI pins;
//   - tests/README.md has a row for every unit test (tests/unit/*.test.mjs) and every browser
//     suite (tests/browser/*.cjs; lib/ and fixtures/ are helpers), and every file a row lists
//     exists unless the row is DELETED;
//   - every repository path named in the bootstraps, the .ai/ layer's protocol, rules,
//     workflows and skills, the glossary, the README, tests/README.md (whose paths are
//     relative to tests/), the feature front matter and the claims exists, apart from a small
//     allowlist of intentional external references, each with its reason. Only claim tests
//     and rule x-majordomus tests are also checked to be run by CI; other paths only exist.
// The README's storage inventory is tests/unit/storage-inventory.test.mjs.
//
// Exempt: ADR bodies, dated audits and the specifications under docs/specs/ and docs/v3*/.
// They are history: they say what was true, or asked for, when they were written.
//   node --test tests/unit/knowledge-integrity.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALGORITHMS, isKnownAlgorithm } from '../../src/js/measurement/algorithms.js';
import { parseClaims, staleAlgorithmIds, unquote } from './claims-parse.mjs';
import { pinnedVersion } from '../../scripts/majordomus-pin-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const list = (rel) => readdirSync(path.join(ROOT, rel)).sort();
const flowList = (raw) => raw.trim().replace(/^\[|\]$/g, '').split(',').map(unquote)
  .filter(Boolean);

// ---------------------------------------------------------------- what CI runs

const PKG = JSON.parse(read('package.json'));

const NPM = /\bnpm (?:run ([\w:-]+)|test\b)/g;
const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);

/** The npm scripts a text invokes, each expanded through `npm run` / `npm test`. */
function npmExpansion(text, scripts) {
  const roots = new Set([...text.matchAll(NPM)].map(([, n]) => n || 'test'));
  const seen = new Set();
  const expand = (name) => {
    if (seen.has(name) || !scripts[name]) return '';
    seen.add(name);
    const body = scripts[name];
    return [body, ...[...body.matchAll(NPM)].map(([, n]) => expand(n || 'test'))].join(' ');
  };
  return { text: [...roots].map(expand).join(' '), scripts: seen };
}

// A repository file a command line executes: `node [flags] <path>`, `bash <path>`,
// `sh <path>`, or the path itself in command position (`run: .github/scripts/x.sh`).
const REPO_FILE = String.raw`((?:tests|scripts|\.github)\/[\w./@-]+)`;
const INVOKED = new RegExp(
  String.raw`(?:^|[\s;&|(])(?:node|bash|sh)\s+(?:-[\w-]+(?:=\S+)?\s+)*["']?${REPO_FILE}`
  + String.raw`|(?:^|\n)\s*(?:-\s+)?(?:run:\s*)?["']?${REPO_FILE}(?=[\s"']|$)`, 'g');

/** The repository files the command lines of a text execute directly. */
export function invokedFiles(code) {
  return new Set([...code.matchAll(INVOKED)].map((m) => m[1] || m[2]));
}

/**
 * What a text runs: `runs(rel)` for a repository file, `scripts` for the npm scripts reached.
 * The text is the body of an npm script, or a workflow. In a workflow (`workflow: true`) a
 * comment runs nothing, whether it is a whole line or trails a command (`true # npm run x`),
 * and a file counts only when a step executes it: through an npm script the step runs, or
 * directly (`node scripts/x.mjs`). A path a workflow merely names (an artifact to upload, a
 * file passed to `jq -f`) is not run.
 */
export function invocations(text, scripts = PKG.scripts, { workflow = false } = {}) {
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l))
    .map((l) => (workflow ? l.replace(/\s+#(?:\s.*)?$/, '') : l)).join('\n');
  const reached = npmExpansion(code, scripts);
  const all = workflow ? reached.text : `${code} ${reached.text}`;
  const globs = [...all.matchAll(/"([^"]*\*[^"]*)"/g)].map(([, g]) => globRe(g));
  const files = new Set(all.split(/[\s"'&|;]+/)
    .filter((t) => /^(tests|scripts|\.github)\//.test(t)));
  if (workflow) for (const f of invokedFiles(code)) files.add(f);
  return {
    files, globs, scripts: reached.scripts,
    runs: (rel) => files.has(rel) || globs.some((re) => re.test(rel)),
  };
}

// CI is the pull-request workflow: what its steps execute, through npm scripts or directly.
const CI = invocations(read('.github/workflows/ci.yml'), PKG.scripts, { workflow: true });
const CI_GLOBS = CI.globs;
const CI_FILES = CI.files;

/** Whether a test file is executed by a script the CI workflow runs. */
export function runByCi(rel) {
  return CI.runs(rel);
}

// ---------------------------------------------------------------- records

/** docs/CLAIMS.yaml as [{ id, claim, source, implementation, test, status, note }]. */
const claims = () => parseClaims(read('docs/CLAIMS.yaml'));

/** Front matter of a Markdown record: top-level scalars and flow lists, plus x-majordomus. */
function frontMatter(rel, text = read(rel)) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${rel} has front matter`);
  const fm = { 'x-majordomus': null };
  let block = null;
  for (const line of m[1].split('\n')) {
    const top = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (top) {
      block = null;
      if (top[1] === 'x-majordomus') { fm['x-majordomus'] = {}; block = fm['x-majordomus']; continue; }
      fm[top[1]] = top[2].startsWith('[') ? flowList(top[2]) : unquote(top[2]);
      continue;
    }
    const sub = block && line.match(/^ {2}([a-z_]+):\s*(.*)$/);
    if (sub) block[sub[1]] = sub[2].startsWith('[') ? flowList(sub[2]) : unquote(sub[2]);
  }
  return fm;
}

const CLAIMS = claims();
const CLAIM_IDS = new Set(CLAIMS.map((c) => c.id));
const STATUSES = new Set([...read('docs/CLAIMS.yaml')
  .matchAll(/^ {2}- id: (\S+)\n {4}meaning:/gm)].map(([, s]) => s));
const RULE_FILES = list('.ai/repo/rules/project').filter((f) => /\.v\d+\.md$/.test(f))
  .map((f) => `.ai/repo/rules/project/${f}`);

// ---------------------------------------------------------------- claims

test('every claim has a known status, and a guaranteed claim names files that exist', () => {
  assert.ok(CLAIMS.length > 0, 'claims parsed');
  assert.deepEqual([...STATUSES].sort(), ['guaranteed', 'planned']);
  for (const c of CLAIMS) {
    assert.ok(STATUSES.has(c.status), `${c.id}: status ${c.status}`);
    for (const key of ['source', 'implementation', 'test']) {
      const v = c[key];
      if (c.status === 'planned' && (v === '-' || v === undefined)) continue;
      assert.ok(v && v !== '-', `${c.id}: guaranteed claim names a ${key}`);
      assert.ok(exists(v), `${c.id}: ${key} ${v} exists`);
    }
  }
});

test('the test of every guaranteed claim is run by a script the CI workflow runs', () => {
  assert.ok(CI_GLOBS.length > 0 && CI_FILES.size > 0, 'CI scripts resolved');
  for (const c of CLAIMS.filter((x) => x.status === 'guaranteed')) {
    assert.ok(runByCi(c.test), `${c.id}: ${c.test} is run by CI (.github/workflows/ci.yml)`);
  }
});

test('the shared reader gives every claim record of the ledger, with its fields', () => {
  const text = read('docs/CLAIMS.yaml');
  const body = text.slice(text.indexOf('\nclaims:\n'));
  const ids = [...body.matchAll(/^ {2}- id:\s*(\S+)/gm)].map(([, id]) => id);
  assert.deepEqual(CLAIMS.map((c) => c.id), ids);
  assert.equal(new Set(ids).size, ids.length, 'claim ids are unique');
  assert.equal(CLAIMS.filter((c) => c.status === 'guaranteed').length,
    [...body.matchAll(/^ {4}status: guaranteed$/gm)].length);
  for (const c of CLAIMS) {
    for (const key of ['claim', 'source', 'implementation', 'test', 'status']) {
      assert.equal(typeof c[key], 'string', `${c.id}: ${key}`);
    }
  }
  const one = parseClaims(
    "x: 1\nclaims:\n  - id: a-b\n    claim: 'it''s so'\n    status: planned\n");
  assert.deepEqual(one, [{ id: 'a-b', claim: "it's so", status: 'planned' }]);
});

// An algorithm id in claim prose is a statement about the code: a change that can alter a stored
// number gets a new version (ADR 0024), so a claim that names a superseded version without
// saying so describes a method the default no longer runs.
const CURRENT_IDS = new Set(Object.values(ALGORITHMS));
const ID_CHECK = { isCurrent: (id) => CURRENT_IDS.has(id), isKnown: isKnownAlgorithm };

test('the algorithm-id check refuses an unknown id and an unmarked superseded one', () => {
  const stale = (fields) => staleAlgorithmIds([{ id: 'x', ...fields }], ID_CHECK);
  assert.deepEqual(stale({ note: 'The Farina inverse filter (oscilla.ir.farina-inverse.v1) is '
    + 'the test oracle.' }),
  ['x.note: oscilla.ir.farina-inverse.v1 is superseded and the line does not say it is retained']);
  assert.deepEqual(stale({ claim: 'Rated by oscilla.confidence.v9.' }),
    ['x.claim: oscilla.confidence.v9 is not an id this build knows']);
  assert.deepEqual(stale({ note: 'oscilla.confidence.v1 to v3 are retained.' }), []);
  assert.deepEqual(stale({ claim: `Rated by ${ALGORITHMS.quality}.`, test: 'tests/x.mjs' }), []);
});

test('every algorithm id in claim prose is a current default, or retained and said to be', () => {
  assert.deepEqual(staleAlgorithmIds(CLAIMS, ID_CHECK), []);
});

// ---------------------------------------------------------------- rules

test('every project rule is well formed, and an x-majordomus block names tests CI runs', () => {
  assert.ok(RULE_FILES.length > 0, 'project rules found');
  const ids = new Map();
  for (const rel of RULE_FILES) {
    const fm = frontMatter(rel);
    assert.ok(fm.id && fm.version, `${rel}: id and version`);
    assert.match(fm.id, RULE_ID,
      `${rel}: id is project.<words-with-hyphens>, so a reference in prose is recognisable`);
    assert.ok(['active', 'deprecated'].includes(fm.status), `${rel}: status ${fm.status}`);
    assert.ok(['blocking', 'advisory'].includes(fm.class), `${rel}: class ${fm.class}`);
    assert.ok(rel.endsWith(`.v${fm.version}.md`), `${rel}: file name carries version ${fm.version}`);
    const key = `${fm.id}@${fm.version}`;
    assert.ok(!ids.has(key), `${key} is declared once`);
    ids.set(key, rel);
    const xm = fm['x-majordomus'];
    if (!xm) continue;
    const tests = xm.tests || [];
    assert.ok(tests.length > 0 || xm.reviewed_because, `${rel}: x-majordomus names tests`);
    for (const t of tests) {
      assert.ok(exists(t), `${rel}: x-majordomus test ${t} exists`);
      assert.ok(runByCi(t), `${rel}: x-majordomus test ${t} is run by CI`);
    }
    for (const c of xm.claims || []) assert.ok(CLAIM_IDS.has(c), `${rel}: claim ${c} exists`);
  }
  // A rule id is in force at one version only.
  const active = RULE_FILES.map((rel) => frontMatter(rel)).filter((fm) => fm.status === 'active');
  const byId = new Map();
  for (const fm of active) byId.set(fm.id, (byId.get(fm.id) || 0) + 1);
  for (const [id, n] of byId) assert.equal(n, 1, `${id} is active at exactly one version`);
});

test('CLAUDE.md names every project rule in force, and only those', () => {
  const claude = read('CLAUDE.md');
  const hand = claude.slice(0, claude.indexOf('<!-- majordomus:begin'));
  const active = RULE_FILES.map((rel) => frontMatter(rel)).filter((fm) => fm.status === 'active')
    .map((fm) => fm.id);
  for (const id of active) assert.ok(hand.includes(`\`${id}\``), `CLAUDE.md names ${id}`);
  const named = [...hand.matchAll(/`(project\.[a-z0-9-]+)`/g)].map(([, id]) => id);
  for (const id of named) assert.ok(active.includes(id), `CLAUDE.md names ${id}, not in force`);
});

test('every rule a claim cites as its source is a rule file in force', () => {
  const files = new Map(RULE_FILES.map((rel) => [rel, frontMatter(rel)]));
  for (const c of CLAIMS) {
    if (!/^\.ai\/repo\/rules\/project\//.test(c.source || '')) continue;
    assert.equal(files.get(c.source)?.status, 'active', `${c.id}: source rule ${c.source} is active`);
  }
});

// ---------------------------------------------------------------- rules name their enforcement
// Rule project.rules-name-their-enforcement. Three ways a rule, a bootstrap or a script
// header has claimed enforcement nobody performed, each from this repository's history:
// no-fake-science v1 named a grep that nothing ran (ledger K2); the bootstraps named
// project.worktree-topology and docs/WORKTREES.md before either existed (K1); the header of
// tests/browser/live-smoke.cjs said the Pages workflow ran it when nothing did (#146).

const PAGES = invocations(read('.github/workflows/pages.yml'), PKG.scripts, { workflow: true });
const ALL_SCRIPTS = invocations(Object.values(PKG.scripts).join('\n'));

const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * The files reached by relative imports, transitively, from the files `runs` accepts among
 * `candidates`. `readText(rel)` returns a file's text or null. The starting files themselves
 * are not in the result unless something imports them.
 */
export function importedBy(candidates, runs, readText) {
  const seen = new Set();
  const queue = candidates.filter((rel) => runs(rel));
  const visited = new Set(queue);
  while (queue.length) {
    const from = queue.pop();
    const text = readText(from);
    if (text === null) continue;
    for (const [, spec] of text.matchAll(IMPORT_RE)) {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      if (rel.startsWith('..') || readText(rel) === null) continue;
      seen.add(rel);
      if (!visited.has(rel)) { visited.add(rel); queue.push(rel); }
    }
  }
  return seen;
}

const SOURCE_FILE = (n) => /\.(?:mjs|cjs|js)$/.test(n);
const readOrNull = (rel) => (exists(rel) && SOURCE_FILE(rel) ? read(rel) : null);
// A module that a test CI runs imports is executed by CI, as a part of that test. It is not
// a mechanism of its own: a blocking rule still names a file CI executes (the test).
const IMPORTED_BY_CI = importedBy(
  [...walk('tests', SOURCE_FILE), ...walk('scripts', SOURCE_FILE)], CI.runs, readOrNull);
/** A file that is executed (a test or a script), as opposed to one that is only read. */
const RUNNABLE = /^tests\/.+\.(?:test\.mjs|cjs)$|^scripts\/.+\.mjs$|^\.github\/scripts\/.+$/;
const WHY_ADVISORY_MIN = 80;

/** The text under a top-level `# <heading>` of a Markdown body, or null. */
export function section(text, headings) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => headings.some((h) => l.trim() === `# ${h}`));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^# \S/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

const backticked = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map(([, t]) => t.trim());

/**
 * What is wrong with how one rule document names its enforcement; an empty list when it is
 * sound. `env` is the repository: exists(rel), ci / pages / scripts as invocations().
 */
export function ruleEnforcementProblems(rel, text, env = {
  exists, ci: CI, pages: PAGES, scripts: ALL_SCRIPTS, imported: IMPORTED_BY_CI,
}) {
  const fm = frontMatter(rel, text);
  if (fm.status !== 'active') return [];
  const problems = [];
  const body = section(text, ['Enforcement', 'Verification']);
  const why = section(text, ['Why advisory']);
  if (fm.class === 'advisory') {
    if (!why || why.replace(/\s+/g, ' ').trim().length < WHY_ADVISORY_MIN) {
      problems.push(`${rel}: an advisory rule says under "# Why advisory" why no mechanism `
        + 'can decide it');
    }
  } else if (why !== null) {
    problems.push(`${rel}: "# Why advisory" on a rule of class ${fm.class}`);
  }
  if (fm['x-majordomus']) {
    // Its tests are checked with the block (they exist and CI runs them). A blocking rule
    // names at least one: `reviewed_because` is a reviewer's word, which is advisory.
    if (fm.class !== 'advisory' && !(fm['x-majordomus'].tests || []).length) {
      problems.push(`${rel}: a blocking rule's x-majordomus block names tests; `
        + 'reviewed_because alone is for a rule of class advisory');
    }
    return problems;
  }
  if (body === null) {
    if (fm.class !== 'advisory') {
      problems.push(`${rel}: a blocking rule without an x-majordomus block has an `
        + '"# Enforcement" section naming the mechanism, or is class advisory and says why');
    }
    return problems;
  }
  const names = backticked(body);
  const paths = [...new Set(names.flatMap((n) => [...namedPaths(n)]))];
  const imported = env.imported || new Set();
  let byCi = 0;
  for (const p of paths) {
    if (!env.exists(p)) {
      problems.push(`${rel}: enforcement names ${p}, which does not exist`);
    } else if (!RUNNABLE.test(p)) {
      continue; // a fixture, a policy file, a document: read, not run
    } else if (env.ci.runs(p)) {
      byCi += 1;
    } else if (!env.pages.runs(p) && !env.scripts.runs(p) && !imported.has(p)) {
      problems.push(`${rel}: enforcement names ${p}, which no workflow step and no npm script `
        + 'runs and no test CI runs imports');
    }
  }
  // A blocking rule names a test or script FILE that CI executes. `npm test` or
  // `npm run verify-dist` beside it says how the file is reached; alone it is every rule's
  // mechanism and so none of this one's. A module a CI-run test imports is run, and is not
  // the mechanism either: the rule names the test.
  if (fm.class !== 'advisory' && byCi === 0) {
    problems.push(`${rel}: its enforcement section names no test or script file that CI `
      + 'executes (.github/workflows/ci.yml); an npm script alone or an imported helper is '
      + 'not the rule\'s own mechanism. Name the test, or make the rule advisory and say why');
  }
  return problems;
}

/**
 * The rule rows of the tables in the project rules README: [{ id, version, class }]. A row
 * opens with the rule, written `project.<id>` v<n> or `project.<id>@<n>` (linked or not),
 * and its second cell is the class.
 */
export function indexRows(readme) {
  const row = /^\|\s*\[?`(project\.[a-z0-9-]+)(?:@(\d+))?`(?:\]\([^)]*\))?(?:\s+v(\d+))?\s*\|\s*(\w+)\s*\|/gm;
  return [...readme.matchAll(row)]
    .map(([, id, at, v, cls]) => ({ id, version: at || v || '?', class: cls }));
}

/** How the index differs from the rules in force ([{ id, version, class }]); [] when equal. */
export function indexProblems(rows, inForce) {
  const key = (r) => `${r.id} v${r.version} ${r.class}`;
  const want = new Set(inForce.map(key));
  const have = rows.map(key);
  return [
    ...have.filter((k, i) => have.indexOf(k) !== i).map((k) => `listed twice: ${k}`),
    ...have.filter((k) => !want.has(k)).map((k) => `in the index, not a rule in force: ${k}`),
    ...[...want].filter((k) => !have.includes(k)).map((k) => `in force, not in the index: ${k}`),
  ];
}

const RULES_README = '.ai/repo/rules/project/README.md';
const activeRules = () => RULE_FILES.map((rel) => frontMatter(rel))
  .filter((fm) => fm.status === 'active')
  .map((fm) => ({ id: fm.id, version: String(fm.version), class: fm.class }));

test('the rules index lists every project rule in force with its version and class', () => {
  const bad = indexProblems(indexRows(read(RULES_README)), activeRules());
  assert.deepEqual(bad, [], `${RULES_README} "## Index" differs from the rule files:\n  `
    + bad.join('\n  '));
});

test('mutation: an index without a row, with a stale class or with an extra row is refused', () => {
  // Judged against the index's own rows, so that a broken index fails one test, not two.
  const readme = read(RULES_README);
  const active = indexRows(readme);
  assert.ok(active.length >= 13, 'the index rows are read');
  const row = /^\| `project\.no-conflict-markers` v1 \| blocking \|.*\n/m;
  assert.match(readme, row, 'the row to remove exists');
  assert.deepEqual(indexProblems(indexRows(readme.replace(row, '')), active),
    ['in force, not in the index: project.no-conflict-markers v1 blocking']);
  const softer = readme.replace('`project.no-conflict-markers` v1 | blocking',
    '`project.no-conflict-markers` v1 | advisory');
  assert.deepEqual(indexProblems(indexRows(softer), active), [
    'in the index, not a rule in force: project.no-conflict-markers v1 advisory',
    'in force, not in the index: project.no-conflict-markers v1 blocking']);
  const extra = `${readme}| \`project.not-a-rule\` v1 | blocking | nothing | none |\n`;
  assert.deepEqual(indexProblems(indexRows(extra), active),
    ['in the index, not a rule in force: project.not-a-rule v1 blocking']);
  // Both spellings of a row are read; a row without a version is not a match for any rule.
  assert.deepEqual(indexRows('| [`project.a-b@2`](a-b.v2.md) | advisory | x |\n'
    + '| `project.c-d` v1 | blocking | y | z |\n| `project.e-f` | blocking | y |\n'), [
    { id: 'project.a-b', version: '2', class: 'advisory' },
    { id: 'project.c-d', version: '1', class: 'blocking' },
    { id: 'project.e-f', version: '?', class: 'blocking' }]);
});

test('every active rule names enforcement that exists and runs, or says why it is advisory', () => {
  const bad = RULE_FILES.flatMap((rel) => ruleEnforcementProblems(rel, read(rel)));
  assert.deepEqual(bad, [], `rules that claim enforcement nobody performs:\n  ${bad.join('\n  ')}`);
});

const FIXTURE_RULE = (over = {}) => `---
id: project.fixture-rule
version: 1
kind: rule
title: Fixture
description: A fixture.
statement: A fixture.
status: ${over.status || 'active'}
class: ${over.class || 'blocking'}
depends_on: []
tags: []
${over.front || ''}---

# Rationale

None.

# Required behaviour

None.
${over.body === undefined ? `
# Enforcement

\`tests/unit/knowledge-integrity.test.mjs\` checks it.
` : over.body}`;

test('mutation: a rule naming a missing test, an unrun file or no mechanism is refused', () => {
  const rel = '.ai/repo/rules/project/fixture-rule.v1.md';
  const problems = (over) => ruleEnforcementProblems(rel, FIXTURE_RULE(over));
  assert.deepEqual(problems(), [], 'a rule naming a test CI runs is sound');
  const NO_FILE = /names no test or script file that CI executes/;
  // An npm script alone is every rule's mechanism and none of this one's.
  assert.match(problems({ body: '\n# Enforcement\n\n`npm run verify-dist` rejects it.\n' })
    .join('\n'), NO_FILE);
  assert.match(problems({ body: '\n# Enforcement\n\n`npm test` checks it.\n' }).join('\n'),
    NO_FILE);
  // A script a ci.yml step runs directly is run by CI; a comment naming it runs nothing.
  const envWith = (ciText, imported = new Set()) => ({
    exists: () => true, pages: PAGES, scripts: ALL_SCRIPTS, imported,
    ci: invocations(ciText, PKG.scripts, { workflow: true }),
  });
  const direct = '\n# Enforcement\n\n`scripts/x.mjs` refuses it.\n';
  const step = 'jobs:\n  a:\n    steps:\n      - run: |\n          node scripts/x.mjs --pr "$PR"\n';
  assert.deepEqual(ruleEnforcementProblems(rel, FIXTURE_RULE({ body: direct }), envWith(step)),
    [], 'a workflow step `node scripts/x.mjs` runs the script');
  for (const dead of ['      # node scripts/x.mjs\n', '      - run: true # node scripts/x.mjs\n',
    '      - uses: a/upload@v1\n        with:\n          path: scripts/x.mjs\n']) {
    const p = ruleEnforcementProblems(rel, FIXTURE_RULE({ body: direct }),
      envWith(`jobs:\n  a:\n    steps:\n${dead}`));
    assert.match(p.join('\n'), /names scripts\/x\.mjs, which no workflow step/, dead);
  }
  // A helper a CI-run test imports is run, and is not the rule's mechanism on its own.
  const helped = ruleEnforcementProblems(rel, FIXTURE_RULE({ body: direct }),
    envWith('', new Set(['scripts/x.mjs'])));
  assert.equal(helped.length, 1, helped.join('\n'));
  assert.match(helped[0], NO_FILE);
  assert.deepEqual(ruleEnforcementProblems(rel, FIXTURE_RULE({
    body: '\n# Enforcement\n\n`tests/unit/knowledge-integrity.test.mjs`, with `scripts/x.mjs`.\n',
  }), { exists: () => true, ci: CI, pages: PAGES, scripts: ALL_SCRIPTS,
    imported: new Set(['scripts/x.mjs']) }), [], 'named beside the test that imports it');
  // An x-majordomus block on a blocking rule names tests; a reviewer's word is advisory.
  const reviewed = { body: '', front: 'x-majordomus:\n  reviewed_because: trust me\n' };
  assert.match(problems(reviewed).join('\n'), /a blocking rule's x-majordomus block names tests/);
  assert.deepEqual(problems({ ...reviewed,
    front: 'x-majordomus:\n  tests: [tests/unit/knowledge-integrity.test.mjs]\n' }), []);
  // (a) the enforcement section names a test that does not exist.
  const missing = problems({
    body: '\n# Enforcement\n\n`tests/unit/does-not-exist.test.mjs` checks it.\n',
  });
  assert.equal(missing.length, 2, missing.join('\n'));
  assert.match(missing[0], /names tests\/unit\/does-not-exist\.test\.mjs, which does not exist/);
  assert.match(missing[1], NO_FILE);
  // A file that exists and that nothing runs: a helper named as if it were a check.
  const helper = ruleEnforcementProblems(rel, FIXTURE_RULE({
    body: '\n# Enforcement\n\n`tests/unit/knowledge-integrity.test.mjs` and '
      + '`scripts/orphan.mjs`.\n',
  }), { exists: () => true, ci: CI, pages: PAGES, scripts: ALL_SCRIPTS, imported: new Set() });
  assert.deepEqual(helper, [`${rel}: enforcement names scripts/orphan.mjs, which no workflow `
    + 'step and no npm script runs and no test CI runs imports']);
  // Prose with no mechanism, and no section at all.
  assert.match(problems({ body: '\n# Enforcement\n\nA grep enforces it.\n' }).join('\n'), NO_FILE);
  assert.match(problems({ body: '' }).join('\n'), /has an "# Enforcement" section/);
  // A script only `npm run verify` runs exists and runs, but CI does not run it.
  assert.match(problems({
    body: '\n# Enforcement\n\n`scripts/majordomus-pin-check.mjs` refuses it.\n',
  }).join('\n'), NO_FILE);
  // Advisory: the reason is required, and is not available to a blocking rule.
  assert.match(problems({ class: 'advisory', body: '' }).join('\n'), /# Why advisory/);
  assert.match(problems({ class: 'advisory', body: '\n# Why advisory\n\nBecause.\n' }).join('\n'),
    /# Why advisory/);
  const reason = '\n# Why advisory\n\nWhat a session does on a shared machine between two '
    + 'commits leaves no trace in the repository, so no test in it can decide the question.\n';
  assert.deepEqual(problems({ class: 'advisory', body: reason }), []);
  assert.match(problems({
    body: `${reason}\n# Enforcement\n\n\`tests/unit/knowledge-integrity.test.mjs\`.\n`,
  }).join('\n'),
    /"# Why advisory" on a rule of class blocking/);
  assert.deepEqual(problems({ status: 'deprecated', body: '' }), [],
    'a deprecated rule is history');
});

// ---------------------------------------------------------------- enforcement text current
// A proof that is "Planned" is not enforcement, and a mechanism described by the behaviour of
// a Majordomus version CI no longer pins describes a tool nobody runs. Both were found in
// rules whose planned proofs had landed and whose doctor was sixteen minor releases old.

const PINNED_MAJORDOMUS = pinnedVersion(read('.github/workflows/ci.yml'));
// "majordomus 0.13.2", "doctor 0.13.2", "Majordomus version 0.13.2", and a bare "Version 0.13.2",
// which in an enforcement text is the tool's: product versions there are written v3.2.0.
const TOOL_VERSION = new RegExp(String.raw`(?:\b(?:[Mm]ajordomus|doctor)\`?\s+(?:[Vv]ersion\s+)?v?`
  + String.raw`|\b[Vv]ersion\s+)(\d+\.\d+\.\d+(?:-[\w.]+)?)\b`, 'g');
const PLANNED = /\bPlanned\b|\bplanned \(/;
// Documents outside the rules that describe how a rule is enforced, read whole.
const ENFORCEMENT_DOCUMENTS = ['docs/WORKTREES.md'];

/** Majordomus versions a text names that are not the pinned one: ['0.13.2', ...]. */
export function staleToolVersions(text, pinned = PINNED_MAJORDOMUS) {
  const prose = text.replace(/\s+/g, ' ');
  return [...new Set([...prose.matchAll(TOOL_VERSION)].map(([, v]) => v))]
    .filter((v) => v !== pinned);
}

/** What is out of date in how one rule describes its enforcement; [] when current. */
export function enforcementTextProblems(rel, text, pinned = PINNED_MAJORDOMUS) {
  const fm = frontMatter(rel, text);
  if (fm.status !== 'active') return [];
  const body = section(text, ['Enforcement', 'Verification']);
  if (body === null) return [];
  const problems = staleToolVersions(body, pinned).map((v) => `${rel}: its enforcement `
    + `describes Majordomus ${v}, and CI pins ${pinned}; describe what the pinned tool does `
    + 'without naming a version, or name the pinned one');
  if (PLANNED.test(body.replace(/\s+/g, ' '))) {
    problems.push(`${rel}: its enforcement names a planned proof; a proof that does not exist `
      + 'is not enforcement. Name the test that exists, or say what no check holds');
  }
  return problems;
}

test('rules name no planned proof and no Majordomus version but the pinned one', () => {
  assert.ok(PINNED_MAJORDOMUS, 'MJ_VERSION is read from .github/workflows/ci.yml');
  const bad = [
    ...RULE_FILES.flatMap((rel) => enforcementTextProblems(rel, read(rel))),
    ...ENFORCEMENT_DOCUMENTS.flatMap((rel) => staleToolVersions(read(rel))
      .map((v) => `${rel}: describes Majordomus ${v}, and CI pins ${PINNED_MAJORDOMUS}`)),
  ];
  assert.deepEqual(bad, [], `enforcement described out of date:\n  ${bad.join('\n  ')}`);
});

test('mutation: a planned proof or a stale doctor version in an enforcement section is refused',
  () => {
    const rel = '.ai/repo/rules/project/fixture-rule.v1.md';
    const problems = (body) => enforcementTextProblems(rel, FIXTURE_RULE({ body }), '9.9.9');
    assert.deepEqual(problems('\n# Enforcement\n\n`majordomus doctor` 9.9.9 fails it.\n'), []);
    assert.match(problems('\n# Enforcement\n\n`majordomus doctor` 0.13.2 fails it.\n')
      .join('\n'), /describes Majordomus 0\.13\.2, and CI pins 9\.9\.9/);
    assert.match(problems('\n# Verification\n\nUnder Majordomus\n0.13.2 it fails.\n').join('\n'),
      /describes Majordomus 0\.13\.2/, 'across a line break');
    assert.match(problems('\n# Enforcement\n\n`majordomus doctor` reads the hook. Version 1.0.0 '
      + 'fails a checkout.\n').join('\n'), /describes Majordomus 1\.0\.0/, 'a bare "Version"');
    assert.match(problems('\n# Verification\n\nPlanned (V430): a browser test.\n').join('\n'),
      /names a planned proof/);
    assert.deepEqual(problems('\n# Rationale\n\nUnder 0.13.2 doctor printed a WARN.\n'
      + '\n# Enforcement\n\n`tests/unit/knowledge-integrity.test.mjs`.\n'), [],
    'history outside the enforcement section is not judged');
    assert.deepEqual(staleToolVersions('majordomus 0.29.0 and doctor 0.13.2', '0.29.0'),
      ['0.13.2']);
    assert.deepEqual(staleToolVersions('the v3.2.0 release, 1.2.3 of anything', '0.29.0'), [],
      'a product version or a number with no tool beside it is not read');
  });

// A rule id in prose: `project.` and hyphenated words. Every id carries a hyphen (checked
// with the front matter above), which keeps `project.yaml` and `project.name` out.
const RULE_ID = /^project\.[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const RULE_REF = /(?<![\w./-])project\.[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g;

/** The rule ids a text names. */
export function ruleReferences(text) {
  return new Set([...text.matchAll(RULE_REF)].map(([id]) => id));
}

/** The files under a directory whose name `keep` accepts, sorted; [] when it is absent. */
function walk(rel, keep) {
  if (!exists(rel)) return [];
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => {
      if (e.isDirectory()) return walk(`${rel}/${e.name}`, keep);
      return keep(e.name) ? [`${rel}/${e.name}`] : [];
    });
}

/** Every document that may name a project rule: bootstraps, README, docs/, the layer, CI. */
function ruleReferenceDocuments() {
  const md = (n) => n.endsWith('.md');
  return [
    'README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'tests/README.md', '.ai/README.md',
    '.ai/repo/policy.yaml', '.github/doctor-verdict.jq',
    ...walk('docs', md),
    ...walk('.ai/repo/rules/project', md),
    ...walk('.ai/repo/workflows', md),
    ...walk('.ai/repo/providers', (n) => md(n) || n.endsWith('.tmpl')),
    ...walk('.github/workflows', (n) => /\.ya?ml$/.test(n)),
  ];
}

/** `<file>: <id>` for every named rule id that is not in `inForce`. */
export function unresolvedRuleReferences(file, text, inForce) {
  return [...ruleReferences(text)].filter((id) => !inForce.has(id)).map((id) => `${file}: ${id}`);
}

const rulesInForce = () => new Set(RULE_FILES.map((rel) => frontMatter(rel))
  .filter((fm) => fm.status === 'active').map((fm) => fm.id));

test('every project rule a bootstrap, document, workflow or template names is in force', () => {
  const inForce = rulesInForce();
  const docs = ruleReferenceDocuments();
  for (const d of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'README.md', 'docs/WORKTREES.md']) {
    assert.ok(docs.includes(d), `${d} is scanned`);
  }
  const bad = docs.flatMap((f) => unresolvedRuleReferences(f, read(f), inForce));
  assert.deepEqual(bad, [], `rules named and not in force:\n  ${bad.join('\n  ')}`);
  const named = new Set(docs.flatMap((f) => [...ruleReferences(read(f))]));
  assert.ok(named.size >= inForce.size, 'the references are read');
});

test('mutation: a bootstrap naming a rule that does not exist is refused', () => {
  const inForce = rulesInForce();
  const agents = read('AGENTS.md');
  assert.deepEqual(unresolvedRuleReferences('AGENTS.md', agents, inForce), []);
  // (b) the same file with one more sentence, as a template or a hand edit would add it.
  const mutated = `${agents}\nThe rule is \`project.no-such-rule\`; see .ai/repo/project.yaml.\n`;
  assert.deepEqual(unresolvedRuleReferences('AGENTS.md', mutated, inForce),
    ['AGENTS.md: project.no-such-rule']);
  assert.deepEqual([...ruleReferences('project.single-file-deliverable@2, project.typed-ports.')],
    ['project.single-file-deliverable', 'project.typed-ports']);
  assert.deepEqual([...ruleReferences('my-project.some-thing subproject.x-y a/project.b-c')], []);
});

// ---------------------------------------------------------------- script header claims

/** The comment lines a script opens with, up to its first line of code, as one line of prose. */
export function headerProse(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (/^\s*$/.test(line) || /^#!/.test(line)) continue; // a second block is header too
    const m = line.match(/^\s*(?:\/\/|\*\/?|\/\*+)\s?(.*)$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

const WORKFLOW_DIR = String.raw`(?:\.github\/workflows\/)?`;
const SELF = String.raw`(?:it|this(?: file| script| suite| check| smoke)?)\b`;
const DOES = String.raw`(?:runs|executes)`;
const DONE_BY = String.raw`\b(?:[Rr]un|[Rr]uns|[Ee]xecuted) (?:by|in|on) (?:the )?`;
const CLAIMS_OF_BEING_RUN = [
  { by: 'pages', re: new RegExp(String.raw`\b${WORKFLOW_DIR}pages\.yml ${DOES} ${SELF}`, 'gi') },
  { by: 'pages', re: new RegExp(String.raw`\bPages(?: workflow)? ${DOES} ${SELF}`, 'g') },
  { by: 'pages',
    re: new RegExp(String.raw`${DONE_BY}(?:Pages\b|${WORKFLOW_DIR}pages\.yml)`, 'g') },
  { by: 'ci', re: new RegExp(String.raw`\b${WORKFLOW_DIR}ci\.yml ${DOES} ${SELF}`, 'gi') },
  { by: 'ci', re: new RegExp(String.raw`\bCI ${DOES} (?:${SELF}|--check\b)`, 'g') },
  { by: 'ci', re: new RegExp(String.raw`${DONE_BY}(?:CI\b|${WORKFLOW_DIR}ci\.yml)`, 'g') },
  { by: 'npm', script: 'release-gate',
    re: new RegExp(String.raw`\b[Tt]he (?:release[- ])?gate ${DOES} ${SELF}`, 'g') },
  { by: 'npm', re: /\bRuns in `npm run ([\w:-]+)`/g },
  { by: 'npm', re: new RegExp(String.raw`\`?npm run ([\w:-]+)\`? ${DOES} ${SELF}`, 'g') },
  // A parenthesis that names the npm script a flag or mode is for: "--report ... (npm run
  // verify: ...)". A colon that ends the script name and is followed by a space, so
  // "(npm run build:check)" names a script and claims nothing.
  { by: 'npm', re: /\(`?npm run ([\w:-]+?)`?:\s/g },
];

/** The claims a header makes about what runs its file: [{ by, script, phrase }]. */
export function headerClaims(prose) {
  return CLAIMS_OF_BEING_RUN.flatMap(({ by, script, re }) => [...prose.matchAll(re)]
    .map((m) => ({ by, script: script || m[1], phrase: m[0] })));
}

/**
 * The header claims that are false. `files` is { rel: text }; `ci` and `pages` are the
 * workflow texts and `scripts` the npm scripts they are checked against.
 */
export function headerClaimProblems({ files, ci, pages, scripts }) {
  const runners = {
    ci: invocations(ci, scripts, { workflow: true }),
    pages: invocations(pages, scripts, { workflow: true }),
  };
  const problems = [];
  for (const [rel, text] of Object.entries(files)) {
    for (const c of headerClaims(headerProse(text))) {
      if (c.by === 'npm') {
        if (!scripts[c.script]) {
          problems.push(`${rel}: "${c.phrase}", and there is no npm script ${c.script}`);
        } else if (!invocations(`npm run ${c.script}`, scripts).runs(rel)) {
          problems.push(`${rel}: "${c.phrase}", and npm run ${c.script} does not run it`);
        }
      } else if (!runners[c.by].runs(rel)) {
        problems.push(`${rel}: "${c.phrase}", and .github/workflows/${c.by}.yml does not run it`);
      }
    }
  }
  return problems;
}

const headerFiles = () => Object.fromEntries([
  ...list('tests/browser').filter(SOURCE_FILE).map((f) => `tests/browser/${f}`),
  ...list('scripts').filter(SOURCE_FILE).map((f) => `scripts/${f}`),
].map((rel) => [rel, read(rel)]));

const WORKFLOW_TEXT = () => ({
  ci: read('.github/workflows/ci.yml'), pages: read('.github/workflows/pages.yml'),
});

test('a script header that says CI, Pages or an npm script runs the file is right', () => {
  const files = headerFiles();
  assert.deepEqual(headerClaimProblems({ files, ...WORKFLOW_TEXT(), scripts: PKG.scripts }), []);
  const claims = Object.entries(files)
    .flatMap(([rel, text]) => headerClaims(headerProse(text)).map((c) => `${rel} ${c.by}`));
  for (const want of ['tests/browser/live-smoke.cjs pages', 'scripts/build.mjs ci',
    'tests/browser/v31-studio-transport.cjs npm']) {
    assert.ok(claims.includes(want), `the claim "${want}" is read (found: ${claims.join(', ')})`);
  }
});

test('mutation: a header claim outlives the workflow step or npm script it names', () => {
  const files = headerFiles();
  const { ci, pages } = WORKFLOW_TEXT();
  // (c) pages.yml without the smoke step, while live-smoke.cjs still says Pages runs it.
  const noSmoke = pages.replace(/npm run test:live\b/, 'echo skipped');
  assert.notEqual(noSmoke, pages, 'pages.yml runs npm run test:live');
  assert.match(noSmoke, /tests\/browser\/live-smoke\.cjs/, 'its comments still name the file');
  const p = headerClaimProblems({ files, ci, pages: noSmoke, scripts: PKG.scripts });
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], /^tests\/browser\/live-smoke\.cjs: ".*pages\.yml runs it", and /);
  assert.match(p[0], /and \.github\/workflows\/pages\.yml does not run it$/);
  // The npm script no longer runs the file; the CI workflow no longer runs the build check.
  const transport = 'tests/browser/v31-studio-transport.cjs';
  const studio = PKG.scripts['test:studio'].replace(`node ${transport}`, 'true');
  assert.notEqual(studio, PKG.scripts['test:studio'], 'test:studio runs the transport suite');
  const scripts = { ...PKG.scripts, 'test:studio': studio };
  assert.deepEqual(headerClaimProblems({ files, ci, pages, scripts }),
    [`${transport}: "Runs in \`npm run test:studio\`", and npm run test:studio does not run it`]);
  const noCheck = ci.replace(/npm run build:check\b/, 'true');
  assert.match(headerClaimProblems({ files, ci: noCheck, pages, scripts: PKG.scripts }).join('\n'),
    /scripts\/build\.mjs: "CI runs --check", and \.github\/workflows\/ci\.yml does not run it/);
  // Wording the scan must read, and wording that claims nothing.
  const by = (prose) => headerClaims(prose).map((c) => `${c.by}:${c.script || ''}`);
  assert.deepEqual(by('Smoke. .github/workflows/pages.yml runs it, one per job.'), ['pages:']);
  assert.deepEqual(by('The Pages workflow runs this smoke after deploy.'), ['pages:']);
  assert.deepEqual(by('The release gate runs it; it runs in CI too.'), ['ci:', 'npm:release-gate']);
  assert.deepEqual(by('Runs in CI.'), ['ci:']);
  assert.deepEqual(by('CI runs the visual job in the Playwright container.'), []);
  assert.deepEqual(by('Run by CI on every pull request.'), ['ci:']);
  assert.deepEqual(by('The Pages workflow executes it after the deploy.'), ['pages:']);
  assert.deepEqual(by('Executed by .github/workflows/ci.yml.'), ['ci:']);
  assert.deepEqual(by('`npm run verify` runs it; a test pins that.'), ['npm:verify']);
  assert.deepEqual(by('--report  always exit 0 (npm run verify: shown there)'), ['npm:verify']);
  assert.deepEqual(by('committed dist up to date (npm run build:check), gh authenticated'), []);
  assert.deepEqual(by('The git hooks and `npm run verify` run whatever is on PATH.'), []);
  // The --report flag of release-cadence.mjs once said `npm run verify` used it; verify does not.
  const cadence = { 'scripts/cadence-probe.mjs':
    '//   --report   print the lag (npm run verify: shown, never judged)\nexport const x = 1;\n' };
  assert.deepEqual(headerClaimProblems({ files: cadence, ci, pages, scripts: PKG.scripts }),
    ['scripts/cadence-probe.mjs: "(npm run verify: ", and npm run verify does not run it']);
  // The header is every comment line before the first line of code, not the first block.
  assert.equal(headerProse('#!/usr/bin/env node\n// a\n// b\n\n// later\nconst x = 1;\n// no\n'),
    'a b later');
  const second = { 'scripts/probe.mjs': '// A probe.\n\n// CI runs it.\nexport const x = 1;\n' };
  assert.deepEqual(headerClaimProblems({ files: second, ci, pages, scripts: PKG.scripts }),
    ['scripts/probe.mjs: "CI runs it", and .github/workflows/ci.yml does not run it']);
  // (c') the step is still there in a trailing comment only: `true # npm run test:live`.
  const inline = pages.replace(/npm run test:live\b/, 'true # npm run test:live');
  const q = headerClaimProblems({ files, ci, pages: inline, scripts: PKG.scripts });
  assert.equal(q.length, 1, q.join('\n'));
  assert.match(q[0], /^tests\/browser\/live-smoke\.cjs: /);
  // A step that runs a script directly makes the header true.
  const stepped = `${ci}\n      - run: node scripts/probe.mjs --pr 1\n`;
  assert.deepEqual(headerClaimProblems({ files: second, ci: stepped, pages, scripts: PKG.scripts }),
    []);
});

// ---------------------------------------------------------------- path references

// Intentional references to files outside this repository. Each says whose file it is.
const EXTERNAL = new Map([
  ['test/run.sh', "Majordomus's own test runner, in the tool's source tree, not this repository"],
]);
// Outputs the scripts write and git ignores (.gitignore); named as places, never committed.
const GENERATED = [/^tests\/visual\/out[^/]*(\/|$)/];

// The documents that state how the repository works now. ADR bodies, audits and
// specifications are history and are not scanned.
function scannedDocuments() {
  const docs = [
    'README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.ai/README.md', 'docs/GLOSSARY.md',
    'docs/CLAIMS.yaml',
    'tests/README.md', '.ai/repo/adrs/README.md', '.ai/repo/skills/README.md',
    ...RULE_FILES, '.ai/repo/rules/project/README.md',
    ...list('.ai/repo/workflows').filter((f) => f.endsWith('.md'))
      .map((f) => `.ai/repo/workflows/${f}`),
  ];
  return docs.filter((d) => d !== 'docs/GLOSSARY.md' || exists(d));
}

const PATH_RE = /(?<![\w./@-])((?:\.ai|\.github|src|tests?|scripts|docs|dist|licenses|site)\/[\w./@-]*)/g;

/** Repository paths a text names, without placeholders, globs or line suffixes. */
export function namedPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(PATH_RE)) {
    // A path cut short by a glob, a placeholder or a regex escape is a pattern, not a name.
    if (/[*{<\\]/.test(text[m.index + m[0].length] || '')) continue;
    const p = m[1].replace(/[.-]+$/, '').replace(/:\d+$/, '');
    if (/X\.Y\.Z|\.\.\.|\/\.\//.test(p)) continue;
    if (/^\.ai\/local(\/|$)/.test(p)) continue; // checkout-local state, never tracked
    out.add(p);
  }
  return out;
}

function unresolved(file, text) {
  const bad = [];
  for (const p of namedPaths(text)) {
    if (exists(p) || EXTERNAL.has(p) || GENERATED.some((re) => re.test(p))) continue;
    bad.push(`${file}: ${p}`);
  }
  return bad;
}

test('the external-reference allowlist is small, explained and still needed', () => {
  assert.ok(EXTERNAL.size <= 5, 'keep the allowlist small');
  const corpus = [...scannedDocuments(), ...useCaseFiles()].map(read).join('\n');
  for (const [p, why] of EXTERNAL) {
    assert.ok(why.length > 20, `${p} says why it is external`);
    assert.ok(!exists(p), `${p} exists here; drop it from the allowlist`);
    assert.ok(corpus.includes(p), `${p} is still referenced somewhere scanned`);
  }
});

test('every repository path the current-state documents name resolves', () => {
  const bad = scannedDocuments().flatMap((f) => unresolved(f, read(f)));
  assert.deepEqual(bad, [], `unresolved references:\n  ${bad.join('\n  ')}`);
});

/**
 * tests/README.md names its files relative to tests/ (`unit/…`, `browser/…`) in the first
 * cell of each table row. A row's files must exist, except on a DELETED row, whose files must
 * not. Returns the problems, one string each.
 */
export function testsReadmeProblems(text, fileExists = exists) {
  const problems = [];
  for (const row of text.split('\n').filter((l) => l.startsWith('| `'))) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const deleted = /^DELETED\b/.test(cells[1] || '');
    for (const [, rel] of cells[0].matchAll(/`((?:unit|browser|visual|freeze)\/[^`*{}<>\s]+)`/g)) {
      const p = `tests/${rel}`;
      if (deleted && fileExists(p)) problems.push(`${p} is listed as DELETED but exists`);
      if (!deleted && !fileExists(p)) problems.push(`${p} is listed but does not exist`);
    }
  }
  return problems;
}

test('every file tests/README.md lists, relative to tests/, exists unless it is DELETED', () => {
  const text = read('tests/README.md');
  assert.deepEqual(testsReadmeProblems(text), []);
  assert.ok((text.match(/^\| `unit\//gm) || []).length > 20, 'the relative rows are read');
});

test('mutation: a tests/README.md row renamed to a missing file is caught', () => {
  const text = read('tests/README.md');
  const renamed = text.replace('| `unit/about.test.mjs` |', '| `unit/abuot.test.mjs` |');
  assert.notEqual(renamed, text, 'the row to rename exists');
  assert.deepEqual(testsReadmeProblems(renamed),
    ['tests/unit/abuot.test.mjs is listed but does not exist']);
  // The general path scan alone does not see a relative path: that is why this check exists.
  assert.ok(!namedPaths(renamed).has('tests/unit/abuot.test.mjs'));
});

/**
 * The unit tests and browser suites (`files`, repository paths) that no row of tests/README.md
 * lists in its first cell. Each one needs a row that says what it proves.
 */
export function unlistedTestFiles(text, files) {
  const listed = new Set();
  for (const row of text.split('\n').filter((l) => l.startsWith('| `'))) {
    const first = row.split('|')[1] || '';
    for (const [, rel] of first.matchAll(/`((?:unit|browser)\/[^`*{}<>\s]+)`/g)) {
      listed.add(`tests/${rel}`);
    }
  }
  return files.filter((f) => !listed.has(f));
}

const TEST_FILES = () => [
  ...list('tests/unit').filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/unit/${f}`),
  ...list('tests/browser').filter((f) => f.endsWith('.cjs')).map((f) => `tests/browser/${f}`),
];

test('tests/README.md lists every unit test and every browser suite', () => {
  const files = TEST_FILES();
  assert.ok(files.length > 100, `the test files are read (${files.length})`);
  const missing = unlistedTestFiles(read('tests/README.md'), files);
  assert.deepEqual(missing, [], `tests/README.md has no row for:\n  ${missing.join('\n  ')}`);
});

test('mutation: a test file with no tests/README.md row is named', () => {
  const text = read('tests/README.md');
  const files = [...TEST_FILES(), 'tests/unit/brand-new.test.mjs'];
  const before = new Set(unlistedTestFiles(text, TEST_FILES()));
  assert.deepEqual(unlistedTestFiles(text, files).filter((f) => !before.has(f)),
    ['tests/unit/brand-new.test.mjs']);
  // A file named only in a later cell (as a helper of another row) is not listed.
  const helperOnly = text.replace(/^\| `unit\/about\.test\.mjs` \|/m, '| `unit/abuot.test.mjs` |');
  assert.ok(unlistedTestFiles(helperOnly, files).includes('tests/unit/about.test.mjs'));
});

test('every path a claim names, in its fields or its note, resolves', () => {
  const bad = CLAIMS.flatMap((c) => unresolved(`docs/CLAIMS.yaml ${c.id}`,
    [c.source, c.implementation, c.test, c.note || ''].join(' ')));
  assert.deepEqual(bad, [], `unresolved references:\n  ${bad.join('\n  ')}`);
});

const useCaseFiles = () => list('.ai/repo/use-cases')
  .filter((x) => x.endsWith('.md') && x !== 'README.md').map((f) => `.ai/repo/use-cases/${f}`);

test('every path in feature front matter and in a use case resolves', () => {
  const bad = [];
  for (const f of list('.ai/repo/features').filter((x) => x.endsWith('.md') && x !== 'README.md')) {
    const fm = read(`.ai/repo/features/${f}`).match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${f} has front matter`);
    bad.push(...unresolved(`.ai/repo/features/${f}`, fm[1]));
  }
  for (const f of useCaseFiles()) bad.push(...unresolved(f, read(f)));
  assert.deepEqual(bad, [], `unresolved references:\n  ${bad.join('\n  ')}`);
});

// ---------------------------------------------------------------- checks a claim cites (V272 D8)

// A guaranteed claim's note names browser checks as "Check a", "checks a, b and c" or
// "check a in tests/browser/x" ("of" for "in" too). A name with a hyphen is a check id; a
// one-word name counts only when the suite follows it ("check findings in tests/browser/v3-ui"),
// because "check from both origins" is prose. Without a named suite the check must be defined
// in a browser suite the note names or in the claim's own test. A suite defines a check with
// `def('id', ...)`, `check('id', ...)` or `{ name: 'id', fn: ... }`. Renaming a check then
// fails here, not only in the suite's own run.
const CHECK_NAME = String.raw`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`;
const CHECK_CITE = new RegExp(String.raw`\b[Cc]hecks? (${CHECK_NAME}`
  + String.raw`(?:(?:, and |, | and )(?!(?:in|of) tests\/)${CHECK_NAME})*)`
  + String.raw`(?:,? (?:in|of) (tests\/browser\/[\w-]+)(?:\.cjs)?)?`, 'g');
const BROWSER_SUITE = /tests\/browser\/[\w-]+\.cjs/g;
const CHECK_DEF = /(?:\b(?:def|check)\(\s*'([a-z0-9-]+)'|\{\s*name:\s*'([a-z0-9-]+)',\s*fn:)/g;

/** The checks a claim's note cites: [{ name, suites }], suites the files that may define it. */
export function citedChecks(claim) {
  const note = claim.note || '';
  const named = new Set([...note.matchAll(BROWSER_SUITE)].map(([p]) => p));
  if (/^tests\/browser\/[\w-]+\.cjs$/.test(claim.test || '')) named.add(claim.test);
  const out = [];
  for (const m of note.matchAll(CHECK_CITE)) {
    let names = m[1].split(/, and |, | and /);
    if (!m[2]) {
      const prose = names.findIndex((n) => !n.includes('-'));
      if (prose >= 0) names = names.slice(0, prose);
    }
    for (const name of names) out.push({ name, suites: m[2] ? [`${m[2]}.cjs`] : [...named] });
  }
  return out;
}

/** The check ids a browser suite's source defines. */
export const definedChecks = (text) => new Set([...text.matchAll(CHECK_DEF)]
  .map(([, a, b]) => a || b));

/** One problem per check a guaranteed claim cites that no suite it may live in defines. */
export function missingCitedChecks(claims, readSuite) {
  const problems = [];
  for (const c of claims.filter((x) => x.status === 'guaranteed')) {
    for (const { name, suites } of citedChecks(c)) {
      if (suites.length === 0) {
        problems.push(`${c.id}: check ${name} names no browser suite`);
        continue;
      }
      const found = suites.some((s) => {
        const text = readSuite(s);
        return text !== null && definedChecks(text).has(name);
      });
      if (!found) problems.push(`${c.id}: check ${name} is not defined in ${suites.join(' or ')}`);
    }
  }
  return problems;
}

const readSuite = (rel) => (exists(rel) ? read(rel) : null);

test('V272 D8: every check a guaranteed claim cites is defined in the suite it names', () => {
  const cited = CLAIMS.filter((c) => c.status === 'guaranteed').flatMap(citedChecks);
  assert.ok(cited.length >= 40, `cited checks parsed (${cited.length})`);
  assert.deepEqual(missingCitedChecks(CLAIMS, readSuite), []);
});

test('V272 D8 mutation: a renamed check, a wrong suite and prose are told apart', () => {
  const suite = 'tests/browser/v3-ui.cjs';
  const renamed = read(suite).replace("def('loopback-workflow',", "def('loopback-flow',");
  assert.notEqual(renamed, read(suite), 'the check to rename exists');
  const problems = missingCitedChecks(CLAIMS, (rel) => (rel === suite ? renamed : readSuite(rel)));
  const ids = problems.filter((p) => p.includes('loopback-workflow')).map((p) => p.split(':')[0]);
  assert.deepEqual(ids.sort(), ['measurement-workbench', 'reproducible-experiments']);
  const one = (note, test = 'tests/unit/x.test.mjs') => citedChecks({ note, test });
  assert.deepEqual(one('Check about-page, in Chromium', 'tests/browser/app.cjs'),
    [{ name: 'about-page', suites: ['tests/browser/app.cjs'] }]);
  assert.deepEqual(one('checks experiments and persistence in tests/browser/v3-ui.cjs')
    .map((x) => [x.name, x.suites[0]]),
  [['experiments', 'tests/browser/v3-ui.cjs'], ['persistence', 'tests/browser/v3-ui.cjs']]);
  assert.deepEqual(one('the check from both origins; check is in tests/unit/v3-x'), []);
  assert.deepEqual(missingCitedChecks([{ id: 'x', status: 'guaranteed', test: 'tests/unit/a.mjs',
    note: 'Check hold-plays-release-zero-nodes in tests/browser/v3-ui.cjs' }], readSuite),
  ['x: check hold-plays-release-zero-nodes is not defined in tests/browser/v3-ui.cjs']);
  assert.deepEqual(missingCitedChecks([{ id: 'y', status: 'guaranteed', test: 'tests/unit/a.mjs',
    note: 'Check no-such-suite' }], readSuite), ['y: check no-such-suite names no browser suite']);
});

// ------------------------------------------------------------ decisions with no claim (V272 D8)

// Every ADR from 0011 on (the V2 line and later) is cited by a claim (its source or its note),
// by a feature's front matter or by a use case, so a shipped capability a decision describes is
// claimed with the test that proves it. A decision that adds no capability of the page is listed
// here with its reason; an entry that becomes cited is refused as stale.
const ADR_NOT_A_CAPABILITY = new Map([
  ['0028', 'release provenance (the source digest and the Pages stamp): intent release-provenance'
    + ' and tests/unit/release-provenance.test.mjs hold it'],
  ['0029', 'the release gate\'s visual regression check: a gate, not a capability of the page'],
  ['0047', 'release process: a major release is preceded by a release candidate'],
  ['0051', 'a descoping decision: no knowledge explorer is built, and the method claims it names'
    + ' are not built yet (docs/v4/completion-ledger.md)'],
  ['0053', 'vocabulary: the names the stored records and the page use, held by'
    + ' tests/unit/vocabulary.test.mjs; it adds no capability'],
  ['0054', 'repository operation: the Majordomus mesh of OSCILLA\'s runtimes'],
  ['0055', 'repository operation: how a merge train lands'],
  ['0056', 'repository operation: when the Majordomus CI pin moves'],
  ['0057', 'release evidence: what proves a static Pages deployment'],
  ['0060', 'a product-path decision (Q003): no commercial path before v4.0; it adds no'
    + ' capability of the page'],
]);

/** ADR numbers (from 0011 on) that `corpus` never cites, and exemptions it does cite. */
export function uncitedAdrs(numbers, corpus, exempt) {
  const cites = (n) => new RegExp(String.raw`adrs\/${n}-|\badr-${n}\b|\bADRs? ${n}\b`).test(corpus);
  return {
    uncited: numbers.filter((n) => Number(n) >= 11 && !exempt.has(n) && !cites(n)),
    stale: [...exempt.keys()].filter(cites),
  };
}

const ADR_NUMBERS = () => list('.ai/repo/adrs').map((f) => f.match(/^(\d{4})-.+\.md$/))
  .filter(Boolean).map(([, n]) => n);
const featureFiles = () => list('.ai/repo/features')
  .filter((x) => x.endsWith('.md') && x !== 'README.md').map((f) => `.ai/repo/features/${f}`);
const ADR_CORPUS = () => [
  ...CLAIMS.map((c) => Object.values(c).join(' ')),
  ...featureFiles().map((f) => (read(f).match(/^---\n([\s\S]*?)\n---\n/) || ['', ''])[1]),
  ...useCaseFiles().map(read),
].join('\n');

test('V272 D8: every ADR from 0011 on is claimed, or says why it adds no capability', () => {
  const numbers = ADR_NUMBERS();
  assert.ok(numbers.length > 50, `ADRs listed (${numbers.length})`);
  for (const [n, why] of ADR_NOT_A_CAPABILITY) {
    assert.ok(numbers.includes(n), `ADR ${n} exists`);
    assert.ok(why.length > 30, `ADR ${n} says why it adds no capability`);
  }
  const { uncited, stale } = uncitedAdrs(numbers, ADR_CORPUS(), ADR_NOT_A_CAPABILITY);
  assert.deepEqual(uncited, [], `ADRs no claim, feature or use case cites: ${uncited.join(', ')}`);
  assert.deepEqual(stale, [], `exempt ADRs that are cited now: ${stale.join(', ')}`);
});

test('V272 D8 mutation: an ADR cited nowhere is named, a cited exemption is stale', () => {
  const corpus = 'source: .ai/repo/adrs/0012-x.md adrs: [adr-0013] ADR 0014. ADRs 0015';
  assert.deepEqual(uncitedAdrs(['0010', '0012', '0013', '0014', '0015', '0016'], corpus,
    new Map([['0015', 'why']])), { uncited: ['0016'], stale: ['0015'] });
  assert.deepEqual(uncitedAdrs(['0120'], 'ADR 01201', new Map()).uncited, ['0120']);
});

// ------------------------------------------------------- the v4.0 completion ledger (V272 D7)

// docs/v4/completion-ledger.md says it is updated as items close. Its completion matrix has a
// Claims column naming the docs/CLAIMS.yaml claims of each capability (or "–"), and a
// numbered item of its current part ("What v4.0 still lacks entirely") names its claims in
// backticks. A row or an item that names a guaranteed claim cannot read MISSING, "in review"
// or "fixing": the claim says it is shipped and tested. The dated "## Update" sections after
// the current part are history and are not read.
const LEDGER = 'docs/v4/completion-ledger.md';
// MISSING is the status word; a lower-case "missing" names a gap of an existing capability.
const NOT_SHIPPED = /\bMISSING\b|\b[Ii]n review\b|\b[Ff]ixing\b/;

const cellsOf = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
const claimIdsIn = (text) => [...text.matchAll(/`([a-z][a-z0-9-]+)`/g)].map(([, id]) => id);

/** One problem per ledger row or item that contradicts a claim, or names one that is not. */
export function ledgerProblems(text, claims) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const current = text.split(/\n## Update /)[0];
  const problems = [];
  const matrix = current.match(/\n## Completion matrix\n\n((?:\|.*\n)+)/);
  if (!matrix) return ['no "## Completion matrix" table'];
  const [header, , ...rows] = matrix[1].trim().split('\n');
  const head = cellsOf(header);
  const at = { claims: head.indexOf('Claims'), status: head.indexOf('Status') };
  if (at.claims < 0 || at.status < 0) {
    return ['the completion matrix has no Claims or Status column'];
  }
  const judge = (where, ids, status) => {
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) problems.push(`${where}: claim ${id} is not in docs/CLAIMS.yaml`);
      else if (c.status === 'guaranteed' && NOT_SHIPPED.test(status)) {
        problems.push(`${where}: reads "${status.match(NOT_SHIPPED)[0]}" but claim ${id} is `
          + 'guaranteed');
      }
    }
  };
  for (const row of rows) {
    const cells = cellsOf(row);
    const named = cells[at.claims] || '';
    if (named !== '–' && claimIdsIn(named).length === 0) {
      problems.push(`${cells[0]}: the Claims cell names no claim and is not "–"`);
    }
    judge(cells[0], claimIdsIn(named), cells[at.status] || '');
  }
  // A numbered item with its indented continuation lines.
  for (const [item] of current.matchAll(/^\d+\. .*(?:\n {3}\S.*)*/gm)) {
    judge(item.slice(0, 60), claimIdsIn(item).filter((id) => byId.has(id)), item);
  }
  return problems;
}

test('V272 D7: the completion ledger agrees with the claims ledger', () => {
  const text = read(LEDGER);
  assert.ok(/updated as items close/.test(text), 'the ledger still says it is kept current');
  assert.deepEqual(ledgerProblems(text, CLAIMS), []);
});

test('V272 D7 mutation: a shipped capability read MISSING or in review is refused', () => {
  const text = read(LEDGER);
  const row = text.split('\n').find((l) => l.startsWith('| Findings |'));
  assert.ok(row, 'the Findings row exists');
  const cells = row.split('|');
  cells[cells.length - 3] = ' MISSING ';
  const missing = text.replace(row, cells.join('|'));
  assert.deepEqual(ledgerProblems(missing, CLAIMS),
    ['Findings: reads "MISSING" but claim findings-linked-to-evidence is guaranteed']);
  const item = text.split('\n').find((l) => /^ {3}.*`connected-records`/.test(l));
  assert.ok(item, 'the Trace item names its claim');
  assert.match(ledgerProblems(text.replace(item, `${item} In review.`), CLAIMS)[0],
    /reads "In review" but claim connected-records is guaranteed/);
  assert.deepEqual(ledgerProblems(text.replace('| Claims |', '| Claim ids |'), CLAIMS),
    ['the completion matrix has no Claims or Status column']);
  const unknown = text.replace('`findings-linked-to-evidence`', '`findings-linked`');
  assert.match(ledgerProblems(unknown, CLAIMS).join('\n'),
    /claim findings-linked is not in docs\/CLAIMS\.yaml/);
});

// ------------------------------------------------------------- skips a claim admits (V272 D9)

// A guaranteed claim's test is run by CI, so a claim whose note says the test skips somewhere
// (a shallow clone, missing tags or freeze files) must also say that it fails instead under
// GitHub Actions or CI, as tests/unit/about.test.mjs and freeze-guard do. A note that says the
// check is skipped in CI states the opposite of what the gate does.
const SKIPS = /\bskip(?:s|ped|ping)?\b/i;
const FAILS_IN_CI = /\bfails?\b[^.;]*\b(?:under|in) (?:GitHub Actions|GITHUB_ACTIONS|CI)\b/;

/** One problem per guaranteed claim that admits a skip without saying CI fails instead. */
export function skipProblems(claims) {
  return claims.filter((c) => c.status === 'guaranteed' && SKIPS.test(c.note || '')
    && !FAILS_IN_CI.test(c.note)).map((c) => `${c.id}: says its test skips, not that CI fails`);
}

test('V272 D9: a claim that admits a skip says CI fails instead', () => {
  assert.deepEqual(skipProblems(CLAIMS), []);
});

test('V272 D9 mutation: "skipped where tags are not fetched (CI)" is refused', () => {
  const claim = (note) => ({ id: 'a', status: 'guaranteed', note });
  const ci = claim('the tag check is skipped where tags are not fetched (CI)');
  assert.deepEqual(skipProblems([ci]), ['a: says its test skips, not that CI fails']);
  assert.deepEqual(skipProblems([claim('it skips locally and fails under GITHUB_ACTIONS')]), []);
  assert.deepEqual(skipProblems([claim('a shallow clone skips it; it fails under GitHub Actions')]),
    []);
  assert.deepEqual(skipProblems([{ ...claim('skipped in CI'), status: 'planned' }]), []);
});
