// Knowledge integrity: what the repository's knowledge says is enforced, is enforced.
//
// The project knowledge (docs/CLAIMS.yaml, the project rules, the bootstraps, the .ai/ layer's
// workflows, the feature records and the README) names files, tests and checks. A name that
// resolves to nothing is a claim of enforcement nobody performs. This test makes each of those
// names pay rent, and it runs in CI through `npm test`, so it holds whether or not a
// contributor has Majordomus installed:
//
//   - every claim in docs/CLAIMS.yaml: a known status; for a guaranteed claim, its source,
//     implementation and test exist, and its test is run by a script CI runs;
//   - every project rule's `x-majordomus` block names tests that exist and that CI runs, and
//     claims that exist;
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


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(path.join(ROOT, rel));
const list = (rel) => readdirSync(path.join(ROOT, rel)).sort();
const unquote = (v) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
};
const flowList = (raw) => raw.trim().replace(/^\[|\]$/g, '').split(',').map(unquote)
  .filter(Boolean);

// ---------------------------------------------------------------- what CI runs

const PKG = JSON.parse(read('package.json'));

/** The npm scripts the CI workflow invokes, expanded through `npm run` / `npm test`. */
function ciScriptText() {
  const ci = read('.github/workflows/ci.yml');
  const NPM = /\bnpm (?:run ([\w:-]+)|test\b)/g;
  const roots = new Set([...ci.matchAll(NPM)].map(([, n]) => n || 'test'));
  const seen = new Set();
  const expand = (name) => {
    if (seen.has(name) || !PKG.scripts[name]) return '';
    seen.add(name);
    const body = PKG.scripts[name];
    return [body, ...[...body.matchAll(NPM)].map(([, n]) => expand(n || 'test'))].join(' ');
  };
  return [...roots].map(expand).join(' ');
}

const CI_TEXT = ciScriptText();
const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);
const CI_GLOBS = [...CI_TEXT.matchAll(/"([^"]*\*[^"]*)"/g)].map(([, g]) => globRe(g));
const CI_FILES = new Set(CI_TEXT.split(/[\s"'&|;]+/).filter((t) => /^(tests|scripts)\//.test(t)));

/** Whether a test file is executed by a script the CI workflow runs. */
export function runByCi(rel) {
  return CI_FILES.has(rel) || CI_GLOBS.some((re) => re.test(rel));
}

// ---------------------------------------------------------------- records

/** docs/CLAIMS.yaml as [{ id, claim, source, implementation, test, status, note }]. */
function claims() {
  const out = [];
  let cur = null;
  const text = read('docs/CLAIMS.yaml');
  for (const line of text.slice(text.indexOf('\nclaims:\n')).split('\n')) {
    const start = line.match(/^ {2}- id:\s*(\S+)/);
    if (start) { cur = { id: start[1] }; out.push(cur); continue; }
    const kv = cur && line.match(/^ {4}([a-z_]+):\s*(.*)$/);
    if (kv) cur[kv[1]] = unquote(kv[2]);
  }
  return out;
}

/** Front matter of a Markdown record: top-level scalars and flow lists, plus x-majordomus. */
function frontMatter(rel) {
  const m = read(rel).match(/^---\n([\s\S]*?)\n---\n/);
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

// ---------------------------------------------------------------- rules

test('every project rule is well formed, and an x-majordomus block names tests CI runs', () => {
  assert.ok(RULE_FILES.length > 0, 'project rules found');
  const ids = new Map();
  for (const rel of RULE_FILES) {
    const fm = frontMatter(rel);
    assert.ok(fm.id && fm.version, `${rel}: id and version`);
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
  const active = RULE_FILES.map(frontMatter).filter((fm) => fm.status === 'active');
  const byId = new Map();
  for (const fm of active) byId.set(fm.id, (byId.get(fm.id) || 0) + 1);
  for (const [id, n] of byId) assert.equal(n, 1, `${id} is active at exactly one version`);
});

test('CLAUDE.md names every project rule in force, and only those', () => {
  const claude = read('CLAUDE.md');
  const hand = claude.slice(0, claude.indexOf('<!-- majordomus:begin'));
  const active = RULE_FILES.map(frontMatter).filter((fm) => fm.status === 'active')
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
