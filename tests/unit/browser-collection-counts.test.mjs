// Rule project.suite-harness: a browser check takes the size of an application collection from
// the code that defines it, not from a number written into the check.
//
// #367 broke two browser checks that were right when written: v31-studio-graph's `six:
// ids.length === 6` when a seventh Studio template (demo-song) landed, and navigation's
// `twelve: links.length === 12` when Synth became a workspace (Q019). Neither check was about
// the count; each restated a collection the code already defines (STUDIO_TEMPLATES,
// WORKSPACES). The fix reads the collection (an import of src/js, or the page's own state), and
// this test stops a new hard-coded count from landing.
//
// The scan reads every .cjs file under tests/browser, with comments blanked and strings kept
// (the mask of tests/browser/lib/timing-scan.cjs locates code, the original text is read). A
// finding is an equality comparison (===, !==, ==, !=), in either order, of
//   - a size: an operand ending in `.length`, `.size` or `.count()`, or a name ending in
//     `Count` (`templateCount`), with
//   - an integer literal of 2 or more (0 and 1 say "none" and "exactly one", which no growth of
//     a collection breaks),
// that is either
//   - `collection-length`: the operand names a collection. Its identifiers, split at camelCase,
//     `_` and `-`, and the words of any string in it (a selector), contain one of: template(s),
//     workspace(s), nav, link(s), tab(s), route(s), registry, or node followed by type(s)
//     (`nodeTypes`, `NODE_REGISTRY`, `[data-osc="studio.node-type"]`). An operand naming a
//     selection (sel, selected, selection) is not a collection;
//   - `count-word`: the comparison is the value of an object key holding a count word (two to
//     twenty, as the whole key or one of its words: `six`, `twelveLinks`, `'seven-tabs'`), or
//     a string on the same line names a count word followed within two words by a collection
//     word ("six templates", "twelve nav links").
// What it does not read, so that it stays quiet on what is not a collection size:
//   - the nodes, edges or chips of one graph or template (`v.nodes === 6` of the Subtractive
//     Synth): that is the fixture the check judges, and deriving it would make the check judge
//     itself. Only the node registry (the node types) is a collection here;
//   - relational bounds (`>= 3`): a collection that grows does not break them;
//   - a size held in a variable or compared to a named constant, and any collection word it
//     does not list. A reviewer reads those.
// A deliberate fixed count (a layout that has exactly three tabs by design) carries
// `// count-allow: <reason of three words or more>` on its line or on a comment-only line
// directly above; every marker is printed.
//
// The occurrences that predate the scan are recorded in
// tests/browser/collection-count-baseline.json as a file and a stable key: the check it belongs
// to (the nearest `def('<id>'` before it, else the nearest `check('<message>'`, else the nearest
// function's name), then the comparison with its whitespace collapsed (a repeat of both in one
// file gets `#2`); no line number. A finding absent from the record fails `npm test`; a record
// entry no longer found is printed, not failed (the occurrence was converted; delete the
// entry); and no entry may be added after the record was made: every entry is in every
// committed version of the file (the timing baseline's ratchet, by key instead of by count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { mask } = require('../browser/lib/timing-scan.cjs');

const RULE = 'project.suite-harness';
const BASELINE_REL = 'tests/browser/collection-count-baseline.json';

const COUNT_WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty'];
const COLLECTION = new Set(['template', 'templates', 'workspace', 'workspaces', 'nav', 'link',
  'links', 'tab', 'tabs', 'route', 'routes', 'registry']);
const SELECTION = new Set(['sel', 'selected', 'selection']);
const MARKER = /count-allow:[ \t]*(.*)/;
const reasoned = (reason) => reason.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 3;

/** The words of an identifier or a string: split at camelCase, digits and punctuation. */
export function words(text) {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

function namesCollection(operand) {
  const ws = words(operand);
  if (ws.some((w) => SELECTION.has(w))) return false;
  return ws.some((w, i) => COLLECTION.has(w)
    || (w === 'node' && (ws[i + 1] === 'type' || ws[i + 1] === 'types')));
}

const isIdent = (c) => /[\w$]/.test(c);

/** Start of the postfix chain (a.b(c)[d].length) that ends just before `end` in masked code. */
function chainStart(code, end) {
  let i = end;
  while (i > 0 && /\s/.test(code[i - 1])) i -= 1;
  for (;;) {
    const c = code[i - 1];
    if (c === ')' || c === ']') {
      // a call or an index; a name directly before it is part of the same unit
      const open = c === ')' ? '(' : '[';
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j -= 1) {
        if (code[j] === c) depth += 1;
        else if (code[j] === open && --depth === 0) break;
      }
      if (j < 0) return i;
      i = j;
      if (isIdent(code[i - 1] || '') || code[i - 1] === ')' || code[i - 1] === ']') continue;
    } else if (c !== undefined && isIdent(c)) {
      while (i > 0 && isIdent(code[i - 1])) i -= 1;
    } else return i;
    // continue through `.` or `?.`
    let k = i;
    while (k > 0 && /\s/.test(code[k - 1])) k -= 1;
    if (code[k - 1] !== '.') return i;
    k -= 1;
    if (code[k - 1] === '?') k -= 1;
    while (k > 0 && /\s/.test(code[k - 1])) k -= 1;
    i = k;
  }
}

/** End of the postfix chain that starts at `start` in masked code. */
function chainEnd(code, start) {
  let i = start;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  if (!isIdent(code[i] || '') && code[i] !== '(' && code[i] !== '[') return start;
  for (;;) {
    while (i < code.length && isIdent(code[i])) i += 1;
    const c = code[i];
    if (c === '(' || c === '[') {
      const close = c === '(' ? ')' : ']';
      let depth = 0;
      for (; i < code.length; i += 1) {
        if (code[i] === c) depth += 1;
        else if (code[i] === close && --depth === 0) break;
      }
      i += 1;
      continue;
    }
    if (c === '.' || (c === '?' && code[i + 1] === '.')) { i += c === '.' ? 1 : 2; continue; }
    return i;
  }
}

/** The operand without wrapping parentheses and a leading await: `(await x.count())`. */
function bare(operand) {
  let s = operand.trim();
  for (;;) {
    s = s.replace(/^await\s+/, '');
    if (!(s.startsWith('(') && s.endsWith(')'))) return s;
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')' && --depth === 0 && i < s.length - 1) { closesAtEnd = false; break; }
    }
    if (!closesAtEnd) return s;
    s = s.slice(1, -1).trim();
  }
}

const isSize = (operand) => /(?:\.\s*(?:length|size)|\.\s*count\s*\(\s*\)|[a-z]Count)$/.test(
  bare(operand));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/** The check a position belongs to: the nearest def('id') before it, else the nearest
 *  check('message'), else the nearest function's name. */
function context(source, code, index) {
  const before = code.slice(0, index);
  const last = (re) => {
    let best = null;
    for (let m = re.exec(before); m; m = re.exec(before)) best = m;
    return best;
  };
  for (const name of ['def', 'check']) {
    const m = last(new RegExp(`\\b${name}\\s*\\(\\s*(['"\`])`, 'g'));
    if (m) {
      const start = m.index + m[0].length;
      return `${name}:${squash(source.slice(start, source.indexOf(m[1], start))).slice(0, 60)}`;
    }
  }
  const fn = last(new RegExp('\\bfunction\\s*\\*?\\s*([\\w$]+)\\s*\\(|\\b(?:const|let)\\s+([\\w$]+)'
    + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^()]*\\)\\s*=>|[\\w$]+\\s*=>)', 'g'));
  return fn ? `fn:${fn[1] || fn[2]}` : '(file)';
}

/** The object key a comparison is the value of (`six: ids.length === 6`), or null. */
function keyBefore(code, source, start) {
  let i = start;
  while (i > 0 && /\s/.test(code[i - 1])) i -= 1;
  if (code[i - 1] !== ':') return null;
  i -= 1;
  while (i > 0 && /\s/.test(code[i - 1])) i -= 1;
  const end = i;
  const q = source[end - 1];
  if (q === '\'' || q === '"') {
    const open = source.lastIndexOf(q, end - 2);
    return source.slice(open + 1, end - 1);
  }
  while (i > 0 && isIdent(code[i - 1])) i -= 1;
  let k = i;
  while (k > 0 && /\s/.test(code[k - 1])) k -= 1;
  if (code[k - 1] === '?') return null; // a ternary's alternative, not a key
  return i < end ? source.slice(i, end) : null;
}

const COUNT_PHRASE = new RegExp(`\\b(?:${COUNT_WORDS.join('|')})\\b(?:[\\s-]+[a-z]+){0,2}?[\\s-]+`
  + '(?:templates?|workspaces?|nav|links?|tabs?|routes?|node[\\s-]types?)\\b', 'i');

/** Every hard-coded collection count in `source`, as { file, line, kind, key, text }. */
export function scan(source, { file = '<text>' } = {}) {
  const { code, comments } = mask(source);
  const lines = source.split('\n');
  const allowed = (line) => [line, line - 1].some((ln) => {
    const note = comments.get(ln);
    if (!note || !MARKER.test(note)) return false;
    if (ln === line - 1 && !/^\s*(?:\/\/|\/\*)/.test(lines[ln - 1] || '')) return false;
    return reasoned(MARKER.exec(note)[1]);
  });
  const out = [];
  const op = /(?<![=!<>])(===|!==|==|!=)(?!=)/g;
  for (let m = op.exec(code); m; m = op.exec(code)) {
    const at = m.index;
    const after = at + m[0].length;
    const lit = /^\s*(\d+)(?![\w.])/.exec(code.slice(after));
    const litBefore = /(?<![\w.$])(\d+)\s*$/.exec(code.slice(Math.max(0, at - 24), at));
    let operand;
    let value;
    let start;
    let end;
    if (lit) {
      start = chainStart(code, at);
      operand = source.slice(start, at);
      value = Number(lit[1]);
      end = after + lit[0].length;
    } else if (litBefore) {
      start = at - litBefore[0].length;
      end = chainEnd(code, after);
      operand = source.slice(after, end);
      value = Number(litBefore[1]);
    } else continue;
    if (!operand.trim() || value < 2 || !isSize(operand)) continue;
    const line = lineOf(source, at);
    let kind = null;
    if (namesCollection(operand)) kind = 'collection-length';
    else {
      const key = keyBefore(code, source, start);
      const keyHasCount = key && words(key).some((w) => COUNT_WORDS.includes(w));
      if (keyHasCount || COUNT_PHRASE.test(lines[line - 1])) kind = 'count-word';
    }
    if (!kind || allowed(line)) continue;
    const key = keyBefore(code, source, start);
    const text = squash(`${key ? `${key}: ` : ''}${source.slice(start, end)}`);
    out.push({ file, line, kind, key: `${context(source, code, start)} :: ${text}`, text });
  }
  const seen = new Map();
  for (const f of out) {
    const n = (seen.get(f.key) || 0) + 1;
    seen.set(f.key, n);
    if (n > 1) f.key = `${f.key} #${n}`;
  }
  return out;
}

/** Every count-allow marker of `source`, with its reason. */
export function markers(source, { file = '<text>' } = {}) {
  const { comments } = mask(source);
  return [...comments].filter(([, note]) => MARKER.test(note))
    .map(([line, note]) => ({ file, line, reason: MARKER.exec(note)[1].trim() }));
}

const format = (f) => `${f.file}:${f.line}: [${f.kind}] ${f.text}`;

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.cjs')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'tests', 'browser'));
  return out.map((full) => path.relative(ROOT, full).split(path.sep).join('/')).sort();
}

const scanTree = () => sources().flatMap((file) => scan(readFileSync(path.join(ROOT, file),
  'utf8'), { file }));

const entryId = (e) => `${e.file} | ${e.key}`;

/** Findings absent from the record (`fresh`) and record entries no longer found (`stale`). */
export function compare(findings, entries) {
  const recorded = new Set(entries.map(entryId));
  const found = new Set(findings.map(entryId));
  return { fresh: findings.filter((f) => !recorded.has(entryId(f))),
    stale: entries.filter((e) => !found.has(entryId(e))) };
}

/** Entries of `entries` absent from a committed version in `history`: [entry, sha]. */
export function addedEntries(entries, history) {
  const added = [];
  for (const { sha, entries: then } of history) {
    const had = new Set(then.map(entryId));
    for (const e of entries) if (!had.has(entryId(e))) added.push([entryId(e), sha]);
  }
  return added;
}

const readBaseline = () => JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'));

function baselineHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', BASELINE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).map((sha) => ({ sha: sha.slice(0, 12),
    entries: JSON.parse(git('show', `${sha}:${BASELINE_REL}`).stdout).entries }));
}

const kinds = (source) => scan(source, { file: 'x.cjs' }).map((f) => `${f.line}:${f.kind}`);

// ------------------------------------------------------------------------------ the scan
test('the two counts #367 broke are findings, with a stable key', () => {
  const graph = [
    "  def('templates-dialog', async ({ page }) => {",
    '    const ids = await page.evaluate(() => [1]);',
    '    return { ...H.verdict({',
    '      six: ids.length === 6,',
    '    }) };',
    '  });',
  ].join('\n');
  const found = scan(graph, { file: 'tests/browser/v31-studio-graph.cjs' });
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].line, found[0].kind, found[0].key],
    [4, 'count-word', 'def:templates-dialog :: six: ids.length === 6']);
  assert.equal(format(found[0]),
    'tests/browser/v31-studio-graph.cjs:4: [count-word] six: ids.length === 6');
  const nav = "  def('nav-links', async () => ({\n    twelve: links.length === 12,\n  }));\n";
  assert.deepEqual(kinds(nav), ['2:collection-length']);
});

test('each collection is read: templates, node types, workspaces, nav, links, tabs, routes', () => {
  for (const operand of ['templates.length', 'window.OSCILLA.studio.templates.length',
    'STUDIO_TEMPLATES.length', 'templateCount', 'NODE_REGISTRY.size', 'nodeTypes.length',
    'Object.keys(registry).length', 'WORKSPACES.length', 'app.workspaces.length',
    "document.querySelectorAll('#osc-nav a').length", 'navItems.length', 'links.length',
    "page.locator('[role=\"tab\"]').count()", 'studioTabs.length', 'routes.size',
    "[...document.querySelectorAll('[data-osc^=\"nav.\"]')].length"]) {
    assert.deepEqual(kinds(`x(${operand} === 7);\n`), ['1:collection-length'], operand);
    assert.deepEqual(kinds(`x(7 === ${operand});\n`), ['1:collection-length'], `7 === ${operand}`);
    assert.deepEqual(kinds(`x(${operand} !== 13);\n`), ['1:collection-length'], operand);
  }
});

test('a count word names the collection: as a key, or in a message on the same line', () => {
  assert.deepEqual(kinds('const v = { twelveLinks: ids.length === 12 };\n'), ['1:count-word']);
  assert.deepEqual(kinds("const v = { 'seven-items': ids.length === 7 };\n"), ['1:count-word']);
  assert.deepEqual(kinds("check('the six templates open', ids.length === 6);\n"),
    ['1:count-word']);
  assert.deepEqual(kinds("check('twelve nav links', items.size === 12);\n"), ['1:count-word']);
  assert.deepEqual(kinds('const v = { ok: ids.length === 6 };\n'), [],
    'no count word, no collection');
  assert.deepEqual(kinds("check('two tabs share a store', ids.length === 0);\n"), [], 'literal 0');
});

test('what is not a collection size stays quiet', () => {
  const quiet = [
    'x(templates.length === 0);', 'x(tabs.length === 1);', // none, exactly one
    'x(tabs.length >= 3);', 'x(links.length > 2);', // relational bounds
    'x(sel.nodes.length === 2);', 'x(selectedTabs.length === 2);', // a selection
    'x(v.nodes === 6);', 'x(rt.modelNodeCount === 7);', 'x(chips.length === 7);', // a graph
    'x(tabs.length === N);', 'x(n === 6);', // a named count, or not a size
    "x(template.id === 'basic-tone');", 'x(a.length === b.length);',
    "const s = 'links.length === 12';", '// templates.length === 6',
    '/* nav.length === 12 */ x(1);', 'const r = /tabs.length === 3/;',
  ];
  for (const line of quiet) assert.deepEqual(kinds(`${line}\n`), [], line);
});

test('a count-allow marker with a reason of three words silences one line', () => {
  assert.deepEqual(kinds('x(tabs.length === 3); // count-allow: the phone layout has three\n'),
    []);
  assert.deepEqual(kinds('// count-allow: the phone layout has three\nx(tabs.length === 3);\n'),
    []);
  assert.deepEqual(kinds('x(tabs.length === 3); // count-allow: why\n'), ['1:collection-length'],
    'a reason of one word is no reason');
  assert.deepEqual(
    kinds('// count-allow: the phone layout has three\nx(1);\nx(tabs.length === 3);\n'),
    ['3:collection-length'], 'only the next line');
});

test('the key names the check (def, else check, else function); a repeat gets its own', () => {
  const found = scan("def('a', () => [tabs.length === 3, tabs.length === 3]);\n");
  assert.deepEqual(found.map((f) => f.key),
    ['def:a :: tabs.length === 3', 'def:a :: tabs.length === 3 #2']);
  assert.deepEqual(scan("check('tabs  open', tabs.length === 3);\n").map((f) => f.key),
    ['check:tabs open :: tabs.length === 3']);
  assert.deepEqual(scan('async function census(p) {\n  return routes.size !== 4;\n}\n')
    .map((f) => f.key), ['fn:census :: routes.size !== 4']);
  assert.deepEqual(scan('x(routes.size === 4);\n').map((f) => f.key),
    ['(file) :: routes.size === 4']);
});

// ------------------------------------------------------------------------- the tree
test('tests/browser holds no hard-coded collection count beyond its record', (t) => {
  const { entries } = readBaseline();
  const { fresh, stale } = compare(scanTree(), entries);
  for (const s of stale) {
    t.diagnostic(`recorded but no longer found (delete it from ${BASELINE_REL}): ${entryId(s)}`);
  }
  assert.deepEqual(fresh.map(format), [], `${RULE}: a browser check compares a collection's size `
    + 'to a number. Read the collection from its source (import STUDIO_TEMPLATES, WORKSPACES, '
    + 'NODE_REGISTRY from src/js, or read it in the page), or mark a deliberate count with '
    + `// count-allow: <reason>. ${BASELINE_REL} is not a place for a new one.`);
});

test('the record names .cjs files of tests/browser and keys that look like the scan\'s', () => {
  const { entries } = readBaseline();
  const files = new Set(sources());
  for (const e of entries) {
    assert.ok(files.has(e.file), `${e.file} is a scanned file`);
    assert.match(e.key, / :: /, `${entryId(e)} has a context and a comparison`);
  }
  assert.equal(new Set(entries.map(entryId)).size, entries.length, 'no entry twice');
});

test('every count-allow marker of tests/browser gives its reason, printed for review', (t) => {
  for (const file of sources()) {
    for (const m of markers(readFileSync(path.join(ROOT, file), 'utf8'), { file })) {
      assert.ok(reasoned(m.reason), `${m.file}:${m.line}: a reason of three words`);
      t.diagnostic(`count-allow ${m.file}:${m.line}: ${m.reason}`);
    }
  }
});

test('the record only shrinks: no entry is absent from an earlier commit of it', (t) => {
  const history = baselineHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${BASELINE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the record here');
    return;
  }
  const added = addedEntries(readBaseline().entries, history);
  assert.deepEqual(added, [], `${RULE}: an entry was added to ${BASELINE_REL}; it may only lose `
    + `entries:\n  ${added.map(([id, sha]) => `${id} (absent at ${sha})`).join('\n  ')}`);
});

test('mutation: an entry added to the record is refused, a removed one is not', () => {
  const a = { file: 'tests/browser/a.cjs', key: 'def:x :: tabs.length === 3' };
  const b = { file: 'tests/browser/a.cjs', key: 'def:y :: links.length === 4' };
  const history = [{ sha: 'new', entries: [a, b] }, { sha: 'old', entries: [a, b] }];
  assert.deepEqual(addedEntries([a], history), [], 'paid down');
  const c = { file: 'tests/browser/b.cjs', key: 'def:z :: routes.length === 5' };
  assert.deepEqual(addedEntries([a, c], history), [[entryId(c), 'new'], [entryId(c), 'old']]);
  assert.deepEqual(compare([{ ...a, line: 1 }, { ...c, line: 2 }], [a, b]).fresh.map(entryId),
    [entryId(c)]);
  assert.deepEqual(compare([{ ...a, line: 1 }], [a, b]).stale, [b]);
});

test('mutation: a new hard-coded count appended to navigation.cjs fails the tree check', () => {
  const file = 'tests/browser/navigation.cjs';
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const { entries } = readBaseline();
  for (const extra of [
    "def('more', async () => ({ thirteen: links.length === 13 }));",
    "def('more', async () => ({ ok: STUDIO_TEMPLATES.length === 7 }));",
    "def('more', async () => ({ ok: (await page.locator('[role=\"tab\"]').count()) === 3 }));",
    "def('more', async () => ({ seven: ids.length === 7 }));",
  ]) {
    const mutated = `${text}\n${extra}\n`;
    const last = mutated.split('\n').length - 1;
    const { fresh } = compare(scan(mutated, { file }), entries);
    assert.deepEqual(fresh.map((f) => f.line), [last], extra);
  }
});
