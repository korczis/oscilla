// Rule project.no-inert-surfaces v1: nothing a user can be shown is placeholder copy, and no
// control is disabled without a stated reason. The third check of the rule, a data-osc
// control in the running page with no handler registered for it, runs in the browser:
// `no-inert-controls` in tests/browser/qa-regressions.cjs.
//
// (a) placeholder copy: TODO, FIXME, TBD, lorem ipsum, coming soon, not implemented, mock,
//     mockup, placeholder, dummy, fake or sample data, work in progress, under construction,
//     in what a user can be shown: src/index.html (its text and attribute values, not its
//     comments or attribute names, so the HTML placeholder attribute is not a match), the
//     string literals of every module under src/js (not the comments), and the stylesheets
//     under src/styles without their comments.
// (b) a disabled control with no stated reason: a start tag of src/index.html that carries
//     disabled, aria-disabled or a binding of either, and no title, aria-describedby or
//     aria-description (static or bound) that says why.
//
// Existing matches are listed in tests/unit/no-inert-surfaces-allowance.json with a reason
// each. The tree must hold exactly what the allowance lists, and the allowance only shrinks:
// no entry is above its value in any earlier commit that changed the file.
//   node --test tests/unit/no-inert-surfaces.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const RULE = 'project.no-inert-surfaces';
const RULE_DOC = '.ai/repo/rules/project/no-inert-surfaces.v1.md';
const ALLOWANCE_REL = 'tests/unit/no-inert-surfaces-allowance.json';
const CHECKS = Object.freeze(['placeholder-copy', 'disabled-without-reason', 'inert-control']);

/** Placeholder copy, by term: the term is the allowance key, the pattern its spellings. */
export const TERMS = Object.freeze([
  ['todo', /\btodo\b/gi],
  ['fixme', /\bfixme\b/gi],
  ['tbd', /\btbd\b/gi],
  ['lorem ipsum', /\blorem\b|\bipsum\b/gi],
  ['coming soon', /\bcoming\s+soon\b/gi],
  ['not implemented', /\bnot\s+(?:yet\s+)?implemented\b|\bunimplemented\b/gi],
  ['mock', /\bmock(?:s|ed|ing|ups?|-ups?)?\b/gi],
  ['placeholder', /\bplace-?holders?\b/gi],
  ['dummy', /\bdumm(?:y|ies)\b/gi],
  ['fake data', /\bfake\s+(?:data|values?|readings?|results?)\b/gi],
  ['sample data', /\bsample\s+data\b/gi],
  ['work in progress', /\bwork\s+in\s+progress\b|\bwip\b/gi],
  ['under construction', /\bunder\s+construction\b/gi],
]);

// A position-preserving view of a source: what is not read becomes spaces (line breaks are
// kept, so a finding has its line), and a boundary between two unrelated texts becomes '|',
// which no term crosses.
const SEP = '|';
const blankOf = (s) => s.replace(/[^\n]/g, ' ');

function keepOnly(src, spans) {
  const out = blankOf(src).split('');
  let prevEnd = -1;
  for (const [start, end, joined] of spans) {
    for (let k = start; k < end; k += 1) out[k] = src[k];
    if (prevEnd >= 0 && !joined) {
      const gap = out.slice(prevEnd, start).findIndex((ch) => ch !== '\n');
      if (gap >= 0) out[prevEnd + gap] = SEP;
    }
    prevEnd = end;
  }
  return out.join('');
}

/**
 * src/index.html as a reader sees it: text and attribute values, comments and names blank. A
 * class list (class, :class, x-bind:class) is never shown: its names are styling, and Tailwind's
 * placeholder-* utilities (the Pro search field's) name the placeholder attribute's colour.
 */
export function htmlShown(src) {
  const text = src.replace(/<!--[\s\S]*?-->/g, blankOf);
  const out = text.split('');
  for (const m of text.matchAll(/<\/?[a-zA-Z][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>/g)) {
    const tag = m[0];
    const at = m.index;
    for (let k = 0; k < tag.length; k += 1) if (tag[k] !== '\n') out[at + k] = ' ';
    for (const v of tag.matchAll(/=\s*(["'])([\s\S]*?)\1/g)) {
      const name = tag.slice(0, v.index).match(/([^\s=]+)\s*$/);
      if (name && /^(?:class|:class|x-bind:class)$/.test(name[1])) continue;
      const q = at + v.index + v[0].indexOf(v[1]);
      out[q] = SEP;
      for (let k = 0; k < v[2].length; k += 1) out[q + 1 + k] = v[2][k];
      out[q + 1 + v[2].length] = SEP;
    }
  }
  return out.join('');
}

// After these a '/' opens a regular expression literal; after anything else it divides.
const REGEX_AFTER = new RegExp('^(?:[(,=:[!&|?{};+\\-*%<>~^]|return|typeof|case|do|else|in|of'
  + '|void|yield|await|delete|instanceof|new|throw)?$');

/**
 * The string literals of a JavaScript module, comments and code blank: quoted strings and the
 * text of template literals, including the strings inside their `${…}` expressions. Literals
 * joined by `+` read as one text. A literal that is only an attribute name `placeholder` (as
 * in setAttribute('placeholder', …)) is the HTML placeholder attribute, not copy.
 */
export function jsShown(src) {
  const spans = [];
  const n = src.length;
  const stack = [];
  let depth = 0;
  let last = '';
  let i = 0;
  let lastLiteralEnd = -1;
  const push = (start, end) => {
    if (end <= start) return;
    const body = src.slice(start, end);
    if (/^placeholder$/.test(body)) return;
    const joined = lastLiteralEnd >= 0
      && /^\s*["'`]?\s*\+\s*["'`]?\s*$/.test(src.slice(lastLiteralEnd, start));
    spans.push([start, end, joined]);
    lastLiteralEnd = end;
  };
  const template = (j) => {
    let from = j;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { push(from, j); last = 'str'; return j + 1; }
      if (src[j] === '$' && src[j + 1] === '{') {
        push(from, j);
        stack.push(depth);
        depth += 1;
        last = '{';
        return j + 2;
      }
      j += 1;
    }
    push(from, n);
    return n;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      push(i + 1, Math.min(j, n));
      last = 'str';
      i = j + 1;
      continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '/' && REGEX_AFTER.test(last)) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j += 1;
      }
      i = j + 1;
      while (i < n && /[a-z]/.test(src[i])) i += 1;
      last = 're';
      continue;
    }
    if (c === '{') { depth += 1; last = '{'; i += 1; continue; }
    if (c === '}') {
      depth -= 1;
      if (stack.length && stack[stack.length - 1] === depth) {
        stack.pop();
        i = template(i + 1);
        continue;
      }
      last = '}';
      i += 1;
      continue;
    }
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j += 1;
      last = src.slice(i, j);
      i = j;
      continue;
    }
    last = c;
    i += 1;
  }
  return keepOnly(src, spans);
}

/**
 * A stylesheet without its comments. `::placeholder` and `:placeholder-shown` style the HTML
 * placeholder attribute and are blank too.
 */
export function cssShown(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, blankOf)
    .replace(/::?placeholder(?:-shown)?\b/g, blankOf);
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Each placeholder term in a shown text: [{ file, line, term, text }]. */
export function placeholderFindings(file, shown) {
  const found = [];
  for (const [term, re] of TERMS) {
    for (const m of shown.matchAll(new RegExp(re.source, re.flags))) {
      found.push({ file, line: lineAt(shown, m.index), term, text: m[0] });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

const DISABLING = new Set(['disabled', ':disabled', 'x-bind:disabled', 'aria-disabled',
  ':aria-disabled', 'x-bind:aria-disabled']);
const REASONS = new Set(['title', 'aria-describedby', 'aria-description'].flatMap((a) =>
  [a, `:${a}`, `x-bind:${a}`]));

/**
 * Each start tag of an HTML text that disables its control (statically or by binding) and
 * states no reason on it: [{ file, line, key, attr }]. The key names the control by its
 * data-osc, else its id, else its tag and the disabling attribute.
 */
export function disabledFindings(file, html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, blankOf);
  const found = [];
  for (const m of text.matchAll(/<([a-zA-Z][\w-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attrs = new Map();
    for (const a of m[2].matchAll(/([^\s=>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs.set(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    const disabling = [...attrs.keys()].filter((a) => DISABLING.has(a)
      && !(a === 'aria-disabled' && attrs.get(a) === 'false'));
    if (!disabling.length || [...attrs.keys()].some((a) => REASONS.has(a))) continue;
    const key = attrs.get('data-osc') || (attrs.get('id') ? `#${attrs.get('id')}`
      : `${m[1].toLowerCase()} ${disabling[0]}="${attrs.get(disabling[0])}"`);
    found.push({ file, line: lineAt(text, m.index), key, attr: disabling[0] });
  }
  return found;
}

function files(rel, ext) {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const p = `${rel}/${d.name}`;
    if (d.isDirectory()) return files(p, ext);
    return p.endsWith(ext) ? [p] : [];
  }).sort();
}

// The extraction of an unchanged text is reused, so a mutation re-reads only its own file.
const SHOWN = new Map();
const shownOf = (extract, text) => {
  const key = `${extract.name}\0${text}`;
  if (!SHOWN.has(key)) SHOWN.set(key, extract(text));
  return SHOWN.get(key);
};

/** What a user can be shown, per file: [{ file, shown }]. */
export function shownSources(readText = read) {
  return [
    { file: 'src/index.html', shown: shownOf(htmlShown, readText('src/index.html')) },
    ...files('src/js', '.js').map((file) => ({ file, shown: shownOf(jsShown, readText(file)) })),
    ...files('src/styles', '.css').map((file) => ({ file,
      shown: shownOf(cssShown, readText(file)) })),
  ];
}

/** The findings of checks (a) and (b) on the tree (or on texts `readText` hands back). */
export function treeFindings(readText = read) {
  return {
    'placeholder-copy': shownSources(readText)
      .flatMap(({ file, shown }) => placeholderFindings(file, shown)),
    'disabled-without-reason': disabledFindings('src/index.html', readText('src/index.html')),
  };
}

/** Findings counted per allowance entry: { 'check\tfile\tkey': n }. */
export function countFindings(findings) {
  const counts = {};
  const add = (check, file, key) => {
    const k = `${check}\t${file}\t${key}`;
    counts[k] = (counts[k] || 0) + 1;
  };
  for (const f of findings['placeholder-copy'] || []) add('placeholder-copy', f.file, f.term);
  for (const f of findings['disabled-without-reason'] || []) {
    add('disabled-without-reason', f.file, f.key);
  }
  return counts;
}

/**
 * An allowance as flat entries { 'check\tfile\tkey': count }. A placeholder or disabled entry
 * is per file and key with its count; an inert control is its data-osc value, counted 1.
 */
export function flatten(allowance) {
  const flat = {};
  for (const check of ['placeholder-copy', 'disabled-without-reason']) {
    for (const [file, byKey] of Object.entries(allowance[check] || {})) {
      for (const [key, entry] of Object.entries(byKey)) {
        flat[`${check}\t${file}\t${key}`] = entry.count;
      }
    }
  }
  for (const id of Object.keys(allowance['inert-control'] || {})) {
    flat[`inert-control\t\t${id}`] = 1;
  }
  return flat;
}

/** How a tree's counts differ from the allowance: { over: [...], under: [...] }. */
export function judge(counts, allowance) {
  const allowed = flatten(allowance);
  const over = [];
  const under = [];
  for (const [k, n] of Object.entries(counts)) {
    if (n > (allowed[k] || 0)) over.push([...k.split('\t'), n, allowed[k] || 0]);
  }
  for (const [k, n] of Object.entries(allowed)) {
    if (k.startsWith('inert-control\t')) continue; // judged in the browser
    if ((counts[k] || 0) < n) under.push([...k.split('\t'), counts[k] || 0, n]);
  }
  return { over, under };
}

/** Entries above their value in a commit of `history`: [check, file, key, n, was, sha]. */
export function widened(allowance, history) {
  const now = flatten(allowance);
  const out = [];
  for (const { sha, allowance: then } of history) {
    const was = flatten(then);
    for (const [k, n] of Object.entries(now)) {
      if (n > (was[k] || 0)) out.push([...k.split('\t'), n, was[k] || 0, sha]);
    }
  }
  return out;
}

/** What is wrong with the allowance's form: every entry has a count and a reason. */
export function shapeProblems(allowance) {
  const bad = [];
  if (allowance.rule !== RULE) bad.push(`"rule" is ${JSON.stringify(allowance.rule)}, not ${RULE}`);
  for (const k of Object.keys(allowance)) {
    if (!['rule', 'about', ...CHECKS].includes(k)) bad.push(`unknown key ${k}`);
  }
  const reasoned = (where, entry) => {
    if (!entry || typeof entry.reason !== 'string'
      || entry.reason.trim().split(/\s+/).length < 3) {
      bad.push(`${where}: a reason of at least three words`);
    }
  };
  for (const check of ['placeholder-copy', 'disabled-without-reason']) {
    for (const [file, byKey] of Object.entries(allowance[check] || {})) {
      if (!existsSync(path.join(ROOT, file))) bad.push(`${check} ${file}: no such file`);
      for (const [key, entry] of Object.entries(byKey)) {
        if (!(Number.isInteger(entry.count) && entry.count > 0)) {
          bad.push(`${check} ${file} ${key}: a positive integer count`);
        }
        reasoned(`${check} ${file} ${key}`, entry);
      }
    }
  }
  for (const [id, entry] of Object.entries(allowance['inert-control'] || {})) {
    reasoned(`inert-control ${id}`, entry);
  }
  return bad;
}

const readAllowance = () => JSON.parse(read(ALLOWANCE_REL));
const fmt = ([check, file, key, n, was]) =>
  `${check} ${file ? `${file} ` : ''}"${key}": ${n}, allowed ${was}`;

// ------------------------------------------------------------------------------ the rule
test('the rule document is in force and names this test, the browser check and the reviewer',
  () => {
    assert.ok(existsSync(path.join(ROOT, RULE_DOC)), `${RULE_DOC} exists`);
    const doc = read(RULE_DOC);
    assert.match(doc, new RegExp(`^id: ${RULE.replace(/\./g, '\\.')}$`, 'm'));
    assert.match(doc, /^status: active$/m);
    assert.match(doc, /^class: blocking$/m);
    const enforcement = doc.split(/^# Enforcement$/m)[1] || '';
    assert.match(enforcement, /`tests\/unit\/no-inert-surfaces\.test\.mjs`/);
    assert.match(enforcement, /`tests\/browser\/qa-regressions\.cjs`/);
    assert.match(enforcement, /`tests\/unit\/no-inert-surfaces-allowance\.json`/);
    // What no mechanism decides is said, so nothing above is read as more than it is.
    assert.match(doc, /stays with the reviewer/);
    assert.match(doc, /literal/);
    assert.match(doc, /placeholder copy in substance/);
  });

// ------------------------------------------------------------------------------ the tree
test('the allowance has a reason for every entry and names files that exist', () => {
  assert.deepEqual(shapeProblems(readAllowance()), []);
});

test('src holds exactly the placeholder copy and reasonless disabled controls it allows', () => {
  const findings = treeFindings();
  const counts = countFindings(findings);
  const { over, under } = judge(counts, readAllowance());
  const where = (check, file, key) => findings[check]
    .filter((f) => f.file === file && (f.term || f.key) === key)
    .map((f) => `${f.file}:${f.line}${f.text ? ` "${f.text}"` : ''}`).join(', ');
  assert.deepEqual(over.map(fmt), [], `${RULE}: beyond the allowance (${ALLOWANCE_REL}):\n  `
    + over.map((o) => `${fmt(o)} at ${where(...o)}`).join('\n  ')
    + '\nRemove the placeholder or state the reason (title, aria-describedby); the allowance '
    + 'is not a place for a new entry.');
  assert.deepEqual(under.map(fmt), [], `${RULE}: the allowance lists more than the tree holds; `
    + `lower these entries in ${ALLOWANCE_REL}:\n  ${under.map(fmt).join('\n  ')}`);
});

// ------------------------------------------------------------------------------ mutations
const mutated = (file, edit) => (rel) => (rel === file ? edit(read(rel)) : read(rel));
const inBody = (html) => mutated('src/index.html', (t) => t.replace('</body>', `${html}\n</body>`));
const appended = (file, text) => mutated(file, (t) => `${t}\n${text}\n`);
const overOf = (readText) => judge(countFindings(treeFindings(readText)), readAllowance())
  .over.map(([check, file, key]) => `${check} ${file} ${key}`);

test('mutation (a): placeholder copy added to the shell, a module or a stylesheet is refused',
  () => {
    assert.deepEqual(overOf(inBody('<p class="osc-muted">Coming soon</p>')),
      ['placeholder-copy src/index.html coming soon']);
    assert.deepEqual(overOf(inBody('<button type="button" title="TODO">Go</button>')),
      ['placeholder-copy src/index.html todo']);
    assert.deepEqual(overOf(appended('src/js/ui/app.js', 'export const X = `Lorem ${1} ipsum`;')),
      ['placeholder-copy src/js/ui/app.js lorem ipsum']);
    assert.deepEqual(overOf(appended('src/js/experiments/evidence.js',
      "const y = 'This feature is ' + 'not implemented';")),
    ['placeholder-copy src/js/experiments/evidence.js not implemented']);
    assert.deepEqual(overOf(appended('src/js/ui/app.js', "const z = 'mock data';")),
      ['placeholder-copy src/js/ui/app.js mock']);
    assert.deepEqual(overOf(appended('src/styles/base.css',
      ".x::after { content: 'Placeholder'; }")),
    ['placeholder-copy src/styles/base.css placeholder']);
  });

test('mutation (a): comments, attribute names and code are not copy', () => {
  for (const readText of [
    inBody('<!-- TODO: lorem ipsum -->'),
    inBody('<input type="text" placeholder="e.g. 440">'),
    // A class list is styling: Tailwind's placeholder-* utilities colour the attribute (F002).
    inBody('<input class="placeholder-gray-500 dark:placeholder-gray-400" '
      + ':class="{ \'placeholder-gray-500\': a }" placeholder="Find a workspace">'),
    appended('src/js/ui/app.js', '// TODO coming soon\n/* mock */\nconst mockup = 1;'),
    appended('src/js/ui/app.js', "const a = { placeholder: 'Search nodes' };\n"
      + "b.setAttribute('placeholder', 'x');"),
    appended('src/js/ui/app.js', "const r = /'todo'/g;\nconst q = a / 2 / b;"),
    appended('src/styles/base.css', '/* TODO */\ninput::placeholder { color: red; }'),
  ]) {
    assert.deepEqual(overOf(readText), []);
  }
});

test('the extractors keep lines and read what a reader reads', () => {
  const js = jsShown("const a = 'one';\n// two\nconst b = `three ${x ? 'four' : y} five`;\n");
  assert.equal(js.split('\n').length, 4);
  assert.match(js, /one/);
  assert.doesNotMatch(js, /two|const/);
  assert.match(js, /three/);
  assert.match(js, /four/);
  assert.match(js, /five/);
  // Two unrelated strings never read as one phrase; a concatenation does.
  assert.deepEqual(placeholderFindings('x.js', jsShown("f('not', 'implemented');")), []);
  assert.equal(placeholderFindings('x.js', jsShown("f('not ' +\n  'implemented');")).length, 1);
  const html = htmlShown('<p title="a">Coming <b>soon</b></p>\n<i title="coming">soon</i>');
  assert.deepEqual(placeholderFindings('x.html', html).map((f) => [f.line, f.term]),
    [[1, 'coming soon']]);
});

test('mutation (b): a control disabled without a stated reason is refused', () => {
  assert.deepEqual(overOf(inBody(
    '<button type="button" data-osc="fixture.go" :disabled="busy">Go</button>')),
  ['disabled-without-reason src/index.html fixture.go']);
  assert.deepEqual(overOf(inBody('<button type="button" id="osc-fixture" disabled>Go</button>')),
    ['disabled-without-reason src/index.html #osc-fixture']);
  assert.deepEqual(overOf(inBody(
    '<button type="button" :aria-disabled="String(busy)">Go</button>')),
  ['disabled-without-reason src/index.html button :aria-disabled="String(busy)"']);
  // A stated reason on the control passes: a title, aria-describedby or aria-description.
  for (const reason of ['title="Busy measuring"', ':title="why"', 'aria-describedby="osc-why"',
    ':aria-describedby="whyId"', 'aria-description="Busy"']) {
    assert.deepEqual(overOf(inBody(
      `<button type="button" data-osc="fixture.go" :disabled="busy" ${reason}>Go</button>`)),
    [], reason);
  }
  assert.deepEqual(overOf(inBody('<button type="button" aria-disabled="false">Go</button>')), []);
});

// ------------------------------------------------------------------------------ the allowance
/** The allowance of every commit that changed it, newest first; null without history. */
function allowanceHistory() {
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return null;
  const log = git('log', '--format=%H', '--', ALLOWANCE_REL);
  if (log.status !== 0) return null;
  return log.stdout.split('\n').filter(Boolean).map((sha) => ({ sha: sha.slice(0, 12),
    allowance: JSON.parse(git('show', `${sha}:${ALLOWANCE_REL}`).stdout) }));
}

test('the allowance only shrinks: no entry is above its value in an earlier commit', (t) => {
  const history = allowanceHistory();
  if (!history || !history.length) {
    if (history && process.env.GITHUB_ACTIONS === 'true') {
      assert.fail(`no commit holds ${ALLOWANCE_REL}: the CI unit job checks out with `
        + 'fetch-depth: 0');
    }
    t.skip('no git history of the allowance here');
    return;
  }
  const raised = widened(readAllowance(), history);
  assert.deepEqual(raised, [], `${RULE}: the allowance grew; it may only shrink:\n  `
    + raised.map(([c, f, k, n, was, sha]) => `${c} ${f} "${k}" ${n}, was ${was} at ${sha}`)
      .join('\n  '));
});

test('mutation: an added entry, a widened one or one listed again after removal is refused', () => {
  const entry = (count) => ({ count, reason: 'a reason of words' });
  const history = [
    { sha: 'lowered', allowance: { 'placeholder-copy': { 'a.js': { todo: entry(1) } },
      'inert-control': { 'x.a': { reason: 'r e a' } } } },
    { sha: 'original', allowance: { 'placeholder-copy': { 'a.js': { todo: entry(2) },
      'b.js': { mock: entry(1) } }, 'inert-control': { 'x.a': { reason: 'r e a' },
      'x.b': { reason: 'r e a' } } } },
  ];
  const now = (pc, ic) => ({ 'placeholder-copy': pc, 'inert-control': ic });
  const same = { 'x.a': { reason: 'r e a' } };
  assert.deepEqual(widened(now({ 'a.js': { todo: entry(1) } }, same), history), []);
  assert.deepEqual(widened(now({}, {}), history), [], 'paid off');
  assert.deepEqual(widened(now({ 'a.js': { todo: entry(2) } }, same), history),
    [['placeholder-copy', 'a.js', 'todo', 2, 1, 'lowered']], 'widened above a later record');
  assert.deepEqual(widened(now({ 'a.js': { todo: entry(1), tbd: entry(1) } }, same), history),
    [['placeholder-copy', 'a.js', 'tbd', 1, 0, 'lowered'],
      ['placeholder-copy', 'a.js', 'tbd', 1, 0, 'original']], 'a new entry');
  assert.deepEqual(widened(now({ 'b.js': { mock: entry(1) } }, {}), history),
    [['placeholder-copy', 'b.js', 'mock', 1, 0, 'lowered']], 'removed, then listed again');
  assert.deepEqual(widened(now({}, { 'x.c': { reason: 'r e a' } }), history),
    [['inert-control', '', 'x.c', 1, 0, 'lowered'], ['inert-control', '', 'x.c', 1, 0, 'original']],
    'a new inert control');
  assert.deepEqual(widened(now({}, { 'x.b': { reason: 'r e a' } }), history),
    [['inert-control', '', 'x.b', 1, 0, 'lowered']], 'an inert control listed again');
});

test('mutation: an entry without a reason or a count is refused', () => {
  const a = readAllowance();
  const file = Object.keys(a['placeholder-copy'])[0];
  const key = Object.keys(a['placeholder-copy'][file])[0];
  const broken = structuredClone(a);
  broken['placeholder-copy'][file][key] = { count: 0, reason: 'x' };
  assert.deepEqual(shapeProblems(broken), [
    `placeholder-copy ${file} ${key}: a positive integer count`,
    `placeholder-copy ${file} ${key}: a reason of at least three words`]);
  const inert = structuredClone(a);
  inert['inert-control']['fixture.inert'] = { reason: '' };
  assert.deepEqual(shapeProblems(inert),
    ['inert-control fixture.inert: a reason of at least three words']);
});
