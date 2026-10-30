#!/usr/bin/env node
// project.definition-of-done: a pull request that changes src/ meets the owner's definition of
// done (2026-10-29: extends, cross-links, dynamics, docs and routes, tested, deployed) as far as
// a pull request can show it.
//
//   node scripts/definition-of-done.mjs --pr-json <file>  # {title, body, headRefName} of gh
//        [--repo <dir>] [--head <ref>] [--head-branch <name>]
//        [--base <ref> | --base-branch <ref>]
//   node scripts/definition-of-done.mjs --title <t> [--body-file <f>] [...the same]
//
// When the pull request changes a path under src/ (between the merge base and the head), each
// clause below must hold, and each one that does not prints a line that starts with
// `project.definition-of-done: <clause>:`:
//   section          the body's own prose has a `Definition of done` heading whose section lists
//                    the six items extends, cross-links, dynamics, docs and routes, tested and
//                    deployed (`- <item>: <text>` or a `| <item> | <text> |` row), each text
//                    naming a repository path the head holds (git cat-file -e <head>:<path>; a
//                    `dir/` by git ls-tree) or a plan id with its record at the head
//                    (.ai/repo/project/issues/<id>.yaml or milestones/<id>.yaml). Without
//                    --head the working tree of --repo is read instead (a local run). A
//                    placeholder `<...>`, a glob and a path through `..` name nothing
//   browser          an added or changed tests/browser/*.cjs, or `dod-browser: n/a <reason>`
//   docs             a changed file under docs/, README.md or .ai/repo/features/, or
//                    `dod-docs: n/a <reason>`
//   tests-readme     every tests/unit/*.test.mjs or tests/browser/*.cjs the pull request adds
//                    has a row in the head's tests/README.md
//   url-state        a src/js/core/url-state*.js that gains a key comes with a changed
//                    tests/unit/url-state*.test.mjs or tests/browser/navigation.cjs. A key is a
//                    static string (quoted, or a template literal with no substitution) that
//                    is: the first argument of set, get, getAll, has, delete or append, given
//                    as itself or as a constant bound to it; the value of a constant named
//                    *KEY (RECIPE_HASH_KEY = 'mr'); a property name or string value of a KEYS
//                    or *KEYS object; or a name in `new URLSearchParams({...})` or `([[...]])`
//   integration-map  every new link producer (a data-osc-link attribute or a dataset.oscLink
//                    assignment under src/, an openIn or sendTo call under src/js/) has its row
//                    in the integration map of K075 (tests/browser/integration-map.json at the
//                    head): a literal target must equal a string of the map, any other producer
//                    (a computed call, dataset.oscLink, and an attribute that is bare, empty or
//                    holds `${` or `{{`) needs the map changed. Until the base holds the map,
//                    the clause says 'integration map not on the base' and passes.
// The key and producer scans read a file without its comments (`//` and `/* */` in a script,
// `<!-- -->` in HTML), so a commented call counts for nothing.
// A waiver is a line of the body's own prose (not in a code block, an HTML comment or a
// blockquote, the same reading as scripts/fail-first.mjs), with a reason that is not the
// placeholder. Whether the deployment happened is not judged here: the release cadence
// (scripts/release-cadence.mjs, project.deploy-often) holds it after the merge.
//
// A merge train (a head branch train/..., scripts/fail-first.mjs's TRAIN_BRANCH, and a title
// that is not feat or fix) is judged by its members, each of which was judged as its own pull
// request: its body's `| member | what |` table must list at least one member, each as `#<n>`.
// A train title on another branch is no train here: it is judged as any pull request.
//
// Exit 0: no src/ change, a train with its members, or every clause holds. Exit 1: refused.
// Exit 2: usage.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE, TRAIN_BRANCH, proseOf, trainMembers } from './fail-first.mjs';

export const RULE = 'project.definition-of-done';
export const ITEMS = ['extends', 'cross-links', 'dynamics', 'docs and routes', 'tested',
  'deployed'];
export const INTEGRATION_MAP = 'tests/browser/integration-map.json';

// The item names as people write them: `Cross links`, `**Docs & routes**`, `docs/routes`.
const ITEM_NAME = new RegExp('^[*_`\\s]*(extends|cross[- ]?links?|dynamics'
  + '|docs\\s*(?:and|&|\\/)\\s*routes|tested|deployed)[*_`\\s]*', 'i');
const ROOTS = new Set(['src', 'tests', 'test', 'docs', 'scripts', 'dist', 'site', 'licenses',
  '.ai', '.github']);
const PLAN_ID = /\b[A-Z]\d{3}\b/g;
const PLAN_DIRS = ['.ai/repo/project/issues', '.ai/repo/project/milestones'];
const BROWSER_TEST = /^tests\/browser\/[^/]+\.cjs$/;
const ROW_TEST = /^tests\/(unit\/[^/]+\.test\.mjs|browser\/[^/]+\.cjs)$/;
const DOCS = /^(docs\/|README\.md$|\.ai\/repo\/features\/)/;
const URL_STATE = /^src\/js\/core\/url-state[^/]*\.js$/;
const ROUTE_TEST = /^(tests\/unit\/url-state[^/]*\.test\.mjs|tests\/browser\/navigation\.cjs)$/;

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/** A file at a commit, or null when the commit does not hold it. */
function show(repo, rev, file) {
  const r = spawnSync('git', ['-C', repo, 'show', `${rev}:${file}`],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

/** What <head> changes against <base>: [{ path, status }] (A, M, D, T), read with -z. */
export function changes(repo, base, head) {
  const fields = git(repo, ['diff', '--name-status', '-z', '--no-renames', base, head])
    .split('\0');
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    out.push({ status: fields[i], path: fields[i + 1] });
  }
  return out;
}

/**
 * null when the body's own prose has no `<name>: n/a` line, else { reason }; the reason is
 * empty when none was given or it is only a placeholder or punctuation (as fail-first reads it).
 */
export function waiverOf(body, name) {
  const re = new RegExp(`^[ \\t]*(?:[*-][ \\t]+)?${name}:[ \\t]*n\\/a\\b[ \\t]*(.*)$`, 'im');
  const m = re.exec(proseOf(body));
  if (!m) return null;
  const reason = m[1].trim();
  return { reason: /[\p{L}\p{N}]/u.test(reason.replace(/<[^>]*>/g, '')) ? reason : '' };
}

/**
 * The words of a text that look like a repository path (a known root, a `dir/`, or a file name
 * with an extension), with a trailing `.`, `:` or `:<line>` dropped. A glob or a path through
 * `.` or `..` is none.
 */
export function pathsNamed(text) {
  const out = [];
  for (let t of String(text).split(/[\s`'"(),;[\]]+/)) {
    t = t.replace(/(?::\d+)+$/, '').replace(/[.:]+$/, '');
    if (!t || t.includes('*') || t.split('/').some((s) => s === '.' || s === '..')) continue;
    if (/^[\w.-]+\.(md|mjs|cjs|js|json|ya?ml|html|css|sh|jq)$/.test(t)) {
      out.push(t);
      continue;
    }
    if (!/^\.?[\w-]+(\/[\w.@-]*)+$/.test(t)) continue;
    const segments = t.split('/');
    if (ROOTS.has(segments[0]) || /\.\w{1,6}$/.test(segments.at(-1)) || t.endsWith('/')) {
      out.push(t);
    }
  }
  return out;
}

/** Whether a text looks like it names a repository path (pathsNamed, whether or not it exists). */
export function namesPath(text) {
  return pathsNamed(text).length > 0;
}

/**
 * What a checkout holds, for the evidence of an item: { path(p), plan(id) }. With a head, the
 * commit decides (git cat-file -e <head>:<path>; a `dir/` holds something by git ls-tree);
 * without one, the working tree of <repo> (a local run, the tests).
 */
export function evidenceLookup(repo, head = null) {
  const seen = new Map();
  const atHead = (p) => {
    if (p.endsWith('/')) {
      const r = spawnSync('git', ['-C', repo, 'ls-tree', head, '--', p], { encoding: 'utf8' });
      return r.status === 0 && r.stdout.trim() !== '';
    }
    return spawnSync('git', ['-C', repo, 'cat-file', '-e', `${head}:${p}`]).status === 0;
  };
  const inTree = (p) => {
    try {
      const st = statSync(path.join(repo, p));
      return p.endsWith('/') ? st.isDirectory() : st.isFile() || st.isDirectory();
    } catch {
      return false;
    }
  };
  const has = (p) => {
    if (!seen.has(p)) seen.set(p, head ? atHead(p) : inTree(p));
    return seen.get(p);
  };
  return {
    path: has,
    plan: (id) => PLAN_DIRS.some((d) => has(`${d}/${id}.yaml`)),
  };
}

/**
 * Whether an item's text names a path or a plan id that the lookup (evidenceLookup) holds;
 * placeholders `<...>` name nothing, and neither does a word that only looks like a file
 * (`Node.js`) or an id (`A440`).
 */
export function itemEvidence(text, lookup) {
  const t = String(text).replace(/<[^>]*>/g, ' ');
  return [...t.matchAll(PLAN_ID)].some(([id]) => lookup.plan(id))
    || pathsNamed(t).some((p) => lookup.path(p));
}

function canonicalItem(name) {
  const n = name.toLowerCase();
  if (n.startsWith('cross')) return 'cross-links';
  if (n.startsWith('docs')) return 'docs and routes';
  return n;
}

/**
 * The `Definition of done` section of the body's own prose: null without the heading, else a
 * Map item -> text (the items it lists, the first line of each counting).
 */
export function dodSection(body) {
  const lines = proseOf(body).split('\n');
  const start = lines.findIndex((l) => /^\s{0,3}#{1,6}\s+definition of done\b/i.test(l));
  if (start < 0) return null;
  const level = /^\s{0,3}(#+)/.exec(lines[start])[1].length;
  const items = new Map();
  for (const line of lines.slice(start + 1)) {
    const h = /^\s{0,3}(#{1,6})\s/.exec(line);
    if (h && h[1].length <= level) break;
    let name = null;
    let text = '';
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (li) {
      const m = ITEM_NAME.exec(li[1]);
      if (m && /^[:–—-]/.test(li[1].slice(m[0].length))) {
        name = m[1];
        text = li[1].slice(m[0].length).replace(/^[:–—-]\s*/, '');
      }
    } else if (/^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
        .map((c) => c.trim());
      const m = ITEM_NAME.exec(cells[0]);
      if (m && m[0].length === cells[0].length) {
        name = m[1];
        text = cells.slice(1).join(' | ');
      }
    }
    if (name && !items.has(canonicalItem(name))) items.set(canonicalItem(name), text.trim());
  }
  return items;
}

// A static string: quoted, or a template literal with no substitution (a backtick and no `$`).
// Named groups, so that each regular expression below can embed it once: `v` is the value.
const STR = '(?<q>[\'"\\x60])(?<v>(?:(?!\\k<q>)[^\\n$\\\\])*)\\k<q>';
const STR_ONLY = new RegExp(`^${STR}$`);
const CONSTS = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${STR}`, 'g');
const KEY_CONST = /(?:KEY|Key)$/;
const ACCESS = /\.(?:set|get|getAll|has|delete|append)\(\s*([^,()\n]+?)\s*[,)]/g;
const KEY_OBJECT = /\b[A-Z0-9_]*KEYS\s*=\s*(?:Object\.freeze\(\s*)?\{([^}]*)\}/g;
const PARAMS_INIT = /new\s+URLSearchParams\(\s*([[{])([^)]*)\)/g;
const PROP_NAME = new RegExp(`(?:^|[,{\\s])(?:${STR}|([A-Za-z_$][\\w$]*))\\s*:`, 'g');
const PROP_VALUE = new RegExp(`:\\s*${STR}`, 'g');
const PAIR_NAME = new RegExp(`\\[\\s*${STR}\\s*,`, 'g');

/** The property names (and, with `values`, the string values) of an object literal's text. */
function objectStrings(inner, keys, { values = true } = {}) {
  for (const m of inner.matchAll(PROP_NAME)) keys.add(m.groups.v ?? m[3]);
  if (values) for (const m of inner.matchAll(PROP_VALUE)) keys.add(m.groups.v);
}

/**
 * A script's text without its `//` and `/* *\/` comments (each replaced by a space, newlines
 * kept). Quotes and template literals are skipped so that `'http://x'` survives; a quote does
 * not span a line, and an escaped character outside a string is kept as it is, so a regular
 * expression such as `/\/\//` is not read as a comment. A heuristic, not a parser.
 */
export function stripComments(text) {
  const s = String(text || '');
  let out = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += s[i + 1] ?? '';
        i++;
      } else if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      continue;
    }
    if (c === '\\') {
      out += c + (s[i + 1] ?? '');
      i++;
    } else if (c === '/' && s[i + 1] === '/') {
      const end = s.indexOf('\n', i);
      out += ' ';
      i = (end < 0 ? s.length : end) - 1;
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const gone = s.slice(i, end < 0 ? s.length : end + 2);
      out += ` ${gone.replace(/[^\n]/g, '')}`;
      i += gone.length - 1;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

/** A source file's text without its comments: HTML loses `<!-- -->`, a script `//` and `/* *\/`. */
function uncommented(file, text) {
  const s = String(text || '');
  if (/\.html?$/i.test(file)) return s.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  if (/\.[cm]?js$/i.test(file)) return stripComments(s);
  return s;
}

/** The URL keys a url-state module names (see the header), its comments left out. */
export function urlKeys(text) {
  const keys = new Set();
  const src = stripComments(text);
  // every constant bound to a static string; one named *KEY is a key of its own
  const consts = new Map();
  for (const m of src.matchAll(CONSTS)) {
    consts.set(m[1], m.groups.v);
    if (KEY_CONST.test(m[1])) keys.add(m.groups.v);
  }
  // the first argument of a URLSearchParams access: a static string or a constant bound to one
  for (const [, arg] of src.matchAll(ACCESS)) {
    const literal = STR_ONLY.exec(arg);
    if (literal) keys.add(literal.groups.v);
    else if (consts.has(arg)) keys.add(consts.get(arg));
  }
  // a KEYS or *KEYS object: its property names and its string values
  for (const [, inner] of src.matchAll(KEY_OBJECT)) objectStrings(inner, keys);
  // new URLSearchParams({ k: v }) or new URLSearchParams([['k', v]]): the names
  for (const [, open, inner] of src.matchAll(PARAMS_INIT)) {
    if (open === '{') objectStrings(inner, keys, { values: false });
    else for (const m of inner.matchAll(PAIR_NAME)) keys.add(m.groups.v);
  }
  return keys;
}

const PRODUCER_FILE = /data-osc-link|oscLink|openIn|sendTo/;
const LINK_ATTR = /data-osc-link(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+)))?/g;
const LINK_DATASET = /\.dataset\.oscLink\s*=(?!=)/g;
const LINK_CALL = /(?<!function\s+)\b(openIn|sendTo)\s*\(([^()]*)\)(\s*\{)?/g;

/**
 * Whether a producer identity (producersOf) has a computed target, which the map rows by
 * changing rather than by naming it: a call that is not a literal, a dataset.oscLink
 * assignment, and an attribute that is bare (`setAttribute('data-osc-link', t)` reads so too),
 * empty or a template (`${...}`, `{{...}}`).
 */
export function computedProducer(id) {
  return /^(openIn|sendTo)\(/.test(id) || id === 'dataset.oscLink' || id === 'data-osc-link'
    || id.startsWith('data-osc-link=');
}

/**
 * The link producers of one file's text, its comments left out, as identities: the literal
 * target, or for a computed one (computedProducer) the call, the assignment or the attribute.
 */
export function producersOf(file, text) {
  const out = [];
  const src = uncommented(file, text);
  for (const m of src.matchAll(LINK_ATTR)) {
    const v = m[1] ?? m[2] ?? m[3];
    if (v === undefined) out.push('data-osc-link');
    else if (v === '' || v.includes('${') || v.includes('{{')) out.push(`data-osc-link="${v}"`);
    else out.push(v);
  }
  for (const m of src.matchAll(LINK_DATASET)) out.push('dataset.oscLink');
  if (!/^src\/js\//.test(file)) return out;
  for (const m of src.matchAll(LINK_CALL)) {
    const arg = m[2].split(',')[0].trim();
    const literal = /^(['"`])([^'"`$]*)\1$/.exec(arg);
    if (literal) out.push(literal[2]);
    else if (!m[3]) out.push(`${m[1]}(${m[2].trim()})`); // `openIn(x) {` defines a method
  }
  return out;
}

/** Identity -> count over the producer files under src/ at a commit. */
function producerCounts(repo, rev) {
  const r = spawnSync('git', ['-C', repo, 'grep', '-l', '-I', '-E', PRODUCER_FILE.source, rev,
    '--', 'src'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git grep: ${r.stderr.trim()}`);
  const counts = new Map();
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const file = line.slice(line.indexOf(':') + 1);
    for (const id of producersOf(file, show(repo, rev, file) || '')) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

/** Every string (keys and values) of a parsed JSON document. */
function stringsOf(doc, out = []) {
  if (typeof doc === 'string') out.push(doc);
  else if (Array.isArray(doc)) for (const v of doc) stringsOf(v, out);
  else if (doc && typeof doc === 'object') {
    for (const [k, v] of Object.entries(doc)) {
      out.push(k);
      stringsOf(v, out);
    }
  }
  return out;
}

/** The test files a tests/README.md table lists in the first cell of a row. */
export function readmeRows(text) {
  const listed = new Set();
  for (const row of String(text || '').split('\n').filter((l) => l.startsWith('| `'))) {
    const first = row.split('|')[1] || '';
    for (const [, rel] of first.matchAll(/`((?:unit|browser)\/[^`*{}<>\s]+)`/g)) {
      listed.add(`tests/${rel}`);
    }
  }
  return listed;
}

function judgeTrain(body, say) {
  const rows = trainMembers(body);
  const refuse = (why) => {
    say(`${RULE}: train: ${why}; a train lists each member as \`| #<n> | <its title> |\` under a`
      + ' `| member | what |` table (.ai/repo/skills/merge-train/SKILL.md)');
    return 'refused';
  };
  if (rows === null) return refuse('its body has no `| member | what |` table');
  if (!rows.length) return refuse('the member table lists no member');
  const bad = rows.filter((r) => !/^#\d+$/.test(r.member));
  if (bad.length) {
    return refuse(`member(s) ${bad.map((r) => JSON.stringify(r.member)).join(', ')}`
      + ' are not pull request numbers');
  }
  say(`definition-of-done: a train of ${rows.length} member(s)`
    + ` (${rows.map((r) => r.member).join(', ')}), each judged as its own pull request`);
  return 'accepted';
}

/**
 * @returns {{ status: 'not-applicable'|'accepted'|'refused', lines: string[] }}
 */
export function judge({ repo, title, body, head, headBranch = '', base,
  baseBranch = 'origin/main' }) {
  const lines = [];
  const say = (s) => lines.push(s);
  const headSha = git(repo, ['rev-parse', '--verify', `${head || 'HEAD'}^{commit}`]).trim();
  const baseRef = base || baseBranch;
  const baseSha = base ? git(repo, ['rev-parse', '--verify', `${base}^{commit}`]).trim()
    : git(repo, ['merge-base', baseBranch, headSha]).trim();
  say(`definition-of-done: head ${headSha.slice(0, 12)}, merge base ${baseSha.slice(0, 12)}`);
  const changed = changes(repo, baseSha, headSha);
  const src = changed.filter((c) => c.path.startsWith('src/'));
  if (!src.length) {
    say(`definition-of-done: none of the ${changed.length} changed path(s) is under src/;`
      + ' nothing to judge');
    return { status: 'not-applicable', lines };
  }
  say(`definition-of-done: ${src.length} path(s) under src/ changed`);
  const t = String(title || '').trim();
  const branch = String(headBranch || '').trim();
  // only the branch makes a train here: a `Trains: ...` chore on another branch is judged
  if (!TITLE.test(t) && TRAIN_BRANCH.test(branch)) {
    say(`definition-of-done: a train (branch ${branch}), judged by its members`);
    return { status: judgeTrain(body, say), lines };
  }

  const refusals = [];
  const refuse = (clause, why) => refusals.push(`${RULE}: ${clause}: ${why}`);
  const live = changed.filter((c) => c.status !== 'D').map((c) => c.path);
  const added = changed.filter((c) => c.status === 'A').map((c) => c.path);

  // section: the six items, each with a path or a plan id the head holds (without --head, the
  // working tree: a local run)
  const items = dodSection(body);
  const lookup = evidenceLookup(repo, head ? headSha : null);
  if (items === null) {
    refuse('section', 'the body has no `Definition of done` heading with the six items'
      + ` (${ITEMS.join(', ')}; .github/pull_request_template.md)`);
  } else {
    const missing = ITEMS.filter((i) => !items.has(i));
    if (missing.length) refuse('section', `the Definition of done lists no ${missing.join(', ')}`);
    const bare = ITEMS.filter((i) => items.has(i) && !itemEvidence(items.get(i), lookup));
    if (bare.length) {
      refuse('section', `the item(s) ${bare.join(', ')} name no repository path and no plan id`
        + ` that the ${head ? 'head' : 'working tree'} holds (a path, or`
        + ' .ai/repo/project/issues|milestones/<id>.yaml)');
    }
    if (!missing.length && !bare.length) say('definition-of-done: section: the six items');
  }

  // browser and docs: a changed file, or a reasoned waiver
  for (const [clause, has, what] of [
    ['browser', live.some((p) => BROWSER_TEST.test(p)), 'adds or changes no tests/browser/*.cjs'],
    ['docs', changed.some((c) => DOCS.test(c.path)),
      'changes nothing under docs/, README.md or .ai/repo/features/'],
  ]) {
    if (has) {
      say(`definition-of-done: ${clause}: changed`);
      continue;
    }
    const w = waiverOf(body, `dod-${clause}`);
    if (w && w.reason) {
      say(`definition-of-done: ${clause}: n/a ${w.reason}`);
    } else if (w) {
      refuse(clause, `\`dod-${clause}: n/a\` without a reason (a placeholder is none)`);
    } else {
      refuse(clause, `the pull request ${what}, and its body has no`
        + ` \`dod-${clause}: n/a <reason>\``);
    }
  }

  // tests-readme: every added test file has its row
  const newTests = added.filter((p) => ROW_TEST.test(p));
  if (newTests.length) {
    const rows = readmeRows(show(repo, headSha, 'tests/README.md'));
    const unlisted = newTests.filter((p) => !rows.has(p));
    if (unlisted.length) {
      refuse('tests-readme', `no tests/README.md row for ${unlisted.join(', ')}`);
    } else {
      say(`definition-of-done: tests-readme: ${newTests.length} added test file(s) listed`);
    }
  }

  // url-state: a new key comes with a route test
  const gained = [];
  for (const c of changed.filter((x) => URL_STATE.test(x.path) && x.status !== 'D')) {
    const before = urlKeys(show(repo, baseSha, c.path));
    const keys = [...urlKeys(show(repo, headSha, c.path))].filter((k) => !before.has(k));
    if (keys.length) gained.push(`${c.path} (${keys.join(', ')})`);
  }
  if (gained.length) {
    if (live.some((p) => ROUTE_TEST.test(p))) {
      say(`definition-of-done: url-state: new key(s) in ${gained.join('; ')}, with a route test`);
    } else {
      refuse('url-state', `new URL key(s) in ${gained.join('; ')} and no changed`
        + ' tests/unit/url-state*.test.mjs or tests/browser/navigation.cjs');
    }
  }

  // integration-map: a row per new link producer, once the base holds the map
  const was = producerCounts(repo, baseSha);
  const fresh = [];
  for (const [id, n] of producerCounts(repo, headSha)) {
    if (n > (was.get(id) || 0)) fresh.push(id);
  }
  if (fresh.length) {
    if (show(repo, baseRef, INTEGRATION_MAP) === null) {
      say('definition-of-done: integration-map: integration map not on the base'
        + ` (${INTEGRATION_MAP}, K075); ${fresh.length} new link producer(s) not judged:`
        + ` ${fresh.join(', ')}`);
    } else {
      const text = show(repo, headSha, INTEGRATION_MAP);
      let strings = null;
      try {
        strings = text === null ? null : stringsOf(JSON.parse(text));
      } catch {
        strings = null;
      }
      const mapChanged = changed.some((c) => c.path === INTEGRATION_MAP && c.status !== 'D');
      const rowless = fresh.filter((id) => {
        if (strings === null) return true;
        return computedProducer(id) ? !mapChanged : !strings.includes(id);
      });
      if (strings === null) {
        refuse('integration-map', `the head has no readable ${INTEGRATION_MAP}`
          + ' (the base has one: merge the base branch)');
      } else if (rowless.length) {
        refuse('integration-map', `no ${INTEGRATION_MAP} row for the new link producer(s)`
          + ` ${rowless.join(', ')}`);
      } else {
        say(`definition-of-done: integration-map: ${fresh.length} new producer(s) have rows`);
      }
    }
  }

  say('definition-of-done: deployed is not judged by the pull request; the release cadence'
    + ' holds it after the merge (project.deploy-often)');
  if (refusals.length) {
    for (const r of refusals) say(r);
    say(`definition-of-done: REFUSED: ${refusals.length} clause failure(s); the rule is`
      + ' .ai/repo/rules/project/definition-of-done.v1.md');
    return { status: 'refused', lines };
  }
  say('definition-of-done: accepted');
  return { status: 'accepted', lines };
}

function usage(message) {
  if (message) console.error(`definition-of-done: ${message}`);
  console.error('usage: node scripts/definition-of-done.mjs (--pr-json <f> | --title <t>'
    + ' [--body-file <f>]) [--repo <dir>] [--head <ref>] [--head-branch <name>]'
    + ' [--base <ref> | --base-branch <ref>]');
  process.exit(2);
}

// (real paths: started through a symlink, the program must still know it is the one run,
// or it would do nothing and exit 0)
const isMain = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = { repo: process.cwd() };
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const v = argv.shift();
    if (v === undefined) usage(`${flag} needs a value`);
    return v;
  };
  while (argv.length) {
    const a = argv.shift();
    if (a === '--title') opts.title = value(a);
    else if (a === '--body-file') opts.body = readFileSync(value(a), 'utf8');
    else if (a === '--pr-json') {
      const pr = JSON.parse(readFileSync(value(a), 'utf8'));
      opts.title = pr.title;
      opts.body = pr.body;
      if (typeof pr.headRefName === 'string') opts.headBranch = pr.headRefName;
    } else if (a === '--repo') opts.repo = path.resolve(value(a));
    else if (a === '--head') opts.head = value(a);
    else if (a === '--head-branch') opts.headBranch = value(a);
    else if (a === '--base') opts.base = value(a);
    else if (a === '--base-branch') opts.baseBranch = value(a);
    else usage(`unknown argument ${a}`);
  }
  if (typeof opts.title !== 'string') usage('a PR title is required');
  let result;
  try {
    result = judge(opts);
  } catch (e) {
    console.error(`definition-of-done: ${e.message}`);
    process.exit(1);
  }
  for (const l of result.lines) console.log(l);
  process.exit(result.status === 'refused' ? 1 : 0);
}
