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
//     id in its prose is a current default, or a retained one on a line that says so;
//   - every project rule's `x-majordomus` block names tests that exist and that CI runs, and
//     claims that exist;
//   - rule project.rules-name-their-enforcement: every active project rule without such a
//     block either has an `# Enforcement` (or `# Verification`) section whose backticked
//     paths exist, whose test and script files something runs, and at least one of whose
//     mechanisms CI runs, or is class advisory and says why under `# Why advisory`; every
//     `project.<id>` the bootstraps, README, docs/, workflows, rules and provider templates
//     name is a rule in force; every "CI runs" / "pages.yml runs it" / "Runs in `npm run x`"
//     claim in the header of a tests/browser/*.cjs or scripts/*.mjs file is true of the
//     workflow or npm script it names;
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

/**
 * What a text runs: `runs(rel)` for a repository file, `scripts` for the npm scripts reached.
 * The text is a workflow (its YAML comments dropped: a comment that names a file runs
 * nothing) or the body of an npm script; `own` also counts files the text itself invokes
 * (`node scripts/x.mjs` in a workflow step), not only those its npm scripts invoke.
 */
export function invocations(text, scripts = PKG.scripts, { own = true } = {}) {
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const reached = npmExpansion(code, scripts);
  const all = own ? `${code} ${reached.text}` : reached.text;
  const globs = [...all.matchAll(/"([^"]*\*[^"]*)"/g)].map(([, g]) => globRe(g));
  const files = new Set(all.split(/[\s"'&|;]+/)
    .filter((t) => /^(tests|scripts|\.github)\//.test(t)));
  return {
    files, globs, scripts: reached.scripts,
    runs: (rel) => files.has(rel) || globs.some((re) => re.test(rel)),
  };
}

// CI is the pull-request workflow, through the npm scripts it runs (as before this helper
// was shared: a file ci.yml names outside an npm script is an installer, not a test).
const CI = invocations(read('.github/workflows/ci.yml'), PKG.scripts, { own: false });
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

const PAGES = invocations(read('.github/workflows/pages.yml'));
const ALL_SCRIPTS = invocations(Object.values(PKG.scripts).join('\n'));
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
  exists, ci: CI, pages: PAGES, scripts: ALL_SCRIPTS,
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
  if (fm['x-majordomus']) return problems; // its tests are checked with the block
  if (body === null) {
    if (fm.class !== 'advisory') {
      problems.push(`${rel}: a blocking rule without an x-majordomus block has an `
        + '"# Enforcement" section naming the mechanism, or is class advisory and says why');
    }
    return problems;
  }
  const names = backticked(body);
  const paths = [...new Set(names.flatMap((n) => [...namedPaths(n)]))];
  let byCi = 0;
  for (const p of paths) {
    if (!env.exists(p)) {
      problems.push(`${rel}: enforcement names ${p}, which does not exist`);
    } else if (!RUNNABLE.test(p)) {
      continue; // a fixture, a policy file, a document: read, not run
    } else if (env.ci.runs(p)) {
      byCi += 1;
    } else if (!env.pages.runs(p) && !env.scripts.runs(p)) {
      problems.push(`${rel}: enforcement names ${p}, which no workflow and no npm script runs`);
    }
  }
  // `npm run verify-dist`, `npm test`: an npm script CI runs is a mechanism CI runs.
  for (const n of names) {
    for (const [, script] of n.matchAll(NPM)) if (env.ci.scripts.has(script || 'test')) byCi += 1;
  }
  if (fm.class !== 'advisory' && byCi === 0) {
    problems.push(`${rel}: nothing its enforcement section names is run by CI `
      + '(.github/workflows/ci.yml); name the test, or make the rule advisory and say why');
  }
  return problems;
}

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
---

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
  assert.deepEqual(problems({ body: '\n# Enforcement\n\n`npm run verify-dist` rejects it.\n' }), [],
    'so is one naming an npm script CI runs');
  // (a) the enforcement section names a test that does not exist.
  const missing = problems({
    body: '\n# Enforcement\n\n`tests/unit/does-not-exist.test.mjs` checks it.\n',
  });
  assert.equal(missing.length, 2, missing.join('\n'));
  assert.match(missing[0], /names tests\/unit\/does-not-exist\.test\.mjs, which does not exist/);
  assert.match(missing[1], /nothing its enforcement section names is run by CI/);
  // A file that exists and that nothing runs: a helper named as if it were a check.
  const helper = ruleEnforcementProblems(rel, FIXTURE_RULE({
    body: '\n# Enforcement\n\n`tests/unit/knowledge-integrity.test.mjs` and '
      + '`scripts/orphan.mjs`.\n',
  }), { exists: () => true, ci: CI, pages: PAGES, scripts: ALL_SCRIPTS });
  assert.deepEqual(helper, [`${rel}: enforcement names scripts/orphan.mjs, which no workflow `
    + 'and no npm script runs']);
  // Prose with no mechanism, and no section at all.
  assert.match(problems({ body: '\n# Enforcement\n\nA grep enforces it.\n' }).join('\n'),
    /nothing its enforcement section names is run by CI/);
  assert.match(problems({ body: '' }).join('\n'), /has an "# Enforcement" section/);
  // A script only `npm run verify` runs exists and runs, but CI does not run it.
  assert.match(problems({
    body: '\n# Enforcement\n\n`scripts/majordomus-pin-check.mjs` refuses it.\n',
  }).join('\n'), /nothing its enforcement section names is run by CI/);
  // Advisory: the reason is required, and is not available to a blocking rule.
  assert.match(problems({ class: 'advisory', body: '' }).join('\n'), /# Why advisory/);
  assert.match(problems({ class: 'advisory', body: '\n# Why advisory\n\nBecause.\n' }).join('\n'),
    /# Why advisory/);
  const reason = '\n# Why advisory\n\nWhat a session does on a shared machine between two '
    + 'commits leaves no trace in the repository, so no test in it can decide the question.\n';
  assert.deepEqual(problems({ class: 'advisory', body: reason }), []);
  assert.match(problems({ body: `${reason}\n# Enforcement\n\n\`npm test\`.\n` }).join('\n'),
    /"# Why advisory" on a rule of class blocking/);
  assert.deepEqual(problems({ status: 'deprecated', body: '' }), [],
    'a deprecated rule is history');
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

/** The comment block a script opens with, as one line of prose. */
export function headerProse(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const blank = /^\s*$/.test(line);
    if (blank && out.length) break; // the block ends at the first blank line after it began
    if (blank || /^#!/.test(line)) continue;
    const m = line.match(/^\s*(?:\/\/|\*|\/\*+)\s?(.*)$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

const WORKFLOW_DIR = String.raw`(?:\.github\/workflows\/)?`;
const SELF = String.raw`(?:it|this(?: file| script| suite| check| smoke)?)\b`;
const CLAIMS_OF_BEING_RUN = [
  { by: 'pages', re: new RegExp(String.raw`\b${WORKFLOW_DIR}pages\.yml runs ${SELF}`, 'gi') },
  { by: 'pages', re: new RegExp(String.raw`\bPages(?: workflow)? runs ${SELF}`, 'g') },
  { by: 'ci', re: new RegExp(String.raw`\b${WORKFLOW_DIR}ci\.yml runs ${SELF}`, 'gi') },
  { by: 'ci', re: new RegExp(String.raw`\bCI runs (?:${SELF}|--check\b)`, 'g') },
  { by: 'ci', re: /\b[Rr]uns in CI\b/g },
  { by: 'npm', script: 'release-gate',
    re: new RegExp(String.raw`\b[Tt]he (?:release[- ])?gate runs ${SELF}`, 'g') },
  { by: 'npm', re: /\bRuns in `npm run ([\w:-]+)`/g },
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
    ci: invocations(ci, scripts, { own: false }),
    pages: invocations(pages, scripts),
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
  ...list('tests/browser').filter((f) => f.endsWith('.cjs')).map((f) => `tests/browser/${f}`),
  ...list('scripts').filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
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
  assert.deepEqual(by('CI runs the visual job in the Playwright container.'), []);
  assert.equal(headerProse('#!/usr/bin/env node\n// a\n// b\n\n// later\nconst x = 1;\n'),
    'a b');
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
