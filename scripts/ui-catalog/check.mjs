#!/usr/bin/env node
// The catalogue check (plan issue G001): every clause of the UI catalogue contract, as a pure
// function over the catalogue, the hook census, the allowance and its history, the state table,
// the trace and the test corpus. tests/unit/ui-catalog.test.mjs runs it on the repository and
// on a fixture per negative case; `node scripts/ui-catalog/check.mjs` prints the problems.
//
//   checkCatalog(input) -> [{ id, message }]          empty when the contract holds
//   loadTraces(root) -> { id: entry }                  scripts/ui-catalog/trace/*.mjs, merged
//   testCorpus(root) -> { runs(file), strings(file) }  the files npm test or a script runs
//   allowanceHistory(root) -> [{ sha, allowance }]     every committed copy, newest first
//   namesHook(strings, hook) -> boolean                a string literal names the hook
//   unknownHooks(hooks, catalog, allowance) -> [hook]  a page's hooks neither declared nor allowed
//
// checkCatalog({ catalog, census, allowance, history, baseAllowance, sources, traces,
//   testCorpus, read }):
//   catalog      createCatalog() of src/js/ui/catalog/registry.js
//   census       scanHooks() of scan.mjs: { literals: Map<hook, Set<file>>, sites }
//   allowance    tests/unit/ui-catalog-allowance.json
//   history      its committed copies ([{ sha, allowance }]); baseAllowance adds one more (the
//                base branch's copy); a copy without a section has not opened it
//   sources      the state table (src/js/ui/catalog/sources.js): { has(path) }
//   traces       { id: { docsLong?, source, plan, intents, adrs, tests } }
//   testCorpus   { runs(file) -> boolean, strings(file) -> [string] | null }
//   read(rel)    a repository file's text, or null when it does not exist
//
// A test names a hook when one of its string literals (comments removed) holds the hook as a
// whole token. That is recorded as NAMED: it proves a test addresses the hook, not what the
// test asserts.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { declarationProblems, hooksOf } from '../../src/js/ui/catalog/define.js';
import { stringLiteralsOf } from './scan.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWANCE_REL = 'tests/unit/ui-catalog-allowance.json';
export const TRACE_DIR = 'scripts/ui-catalog/trace';
/** The allowance's sections and the slice that opens each. */
export const SECTIONS = Object.freeze({ undeclared: 'G001', untraced: 'J002', unlinked: 'J004' });

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);

/** True when one of `strings` holds `hook` as a whole token (not a prefix of a longer hook). */
export function namesHook(strings, hook) {
  const re = new RegExp(`(?<![\\w.-])${escape(hook)}(?![\\w-]|\\.\\w)`);
  return strings.some((s) => re.test(s));
}

/** The static parts of a pattern template ('studio.tl.{key}' -> ['studio.tl.']). */
const staticParts = (template) => template.split('{key}').filter(Boolean);

function allowanceShape(allowance) {
  const out = [];
  if (!allowance || typeof allowance !== 'object' || Array.isArray(allowance)) {
    return [{ id: ALLOWANCE_REL, message: `${ALLOWANCE_REL}: must be a JSON object` }];
  }
  for (const [section, entries] of Object.entries(allowance)) {
    if (!(section in SECTIONS)) {
      out.push({ id: section, message: `${section}: not a section of the allowance (${
        Object.keys(SECTIONS).join(', ')})` });
      continue;
    }
    if (!Array.isArray(entries)) {
      out.push({ id: section, message: `${section}: a section is an array of { id, reason }` });
      continue;
    }
    let previous = null;
    for (const e of entries) {
      const id = e && typeof e.id === 'string' ? e.id : '?';
      if (!e || typeof e !== 'object' || Object.keys(e).sort().join() !== 'id,reason') {
        out.push({ id, message: `${id}: an ${section} entry is exactly { id, reason }` });
      }
      if (!e || words(e.reason) < 3) {
        out.push({ id, message: `${id}: the ${section} entry needs a reason of at least three `
          + 'words' });
      }
      if (previous !== null && !(previous < id)) {
        out.push({ id, message: `${id}: the ${section} section is not sorted by id (after ${
          previous})` });
      }
      previous = id;
    }
  }
  return out;
}

/** Each section only shrinks: no longer than, and no id absent from, any copy that opened it. */
function allowanceMonotonic(allowance, copies) {
  const out = [];
  for (const section of Object.keys(SECTIONS)) {
    const now = Array.isArray(allowance[section]) ? allowance[section] : null;
    if (!now) continue;
    const ids = now.map((e) => e && e.id);
    for (const { sha, allowance: then } of copies) {
      const was = then && Array.isArray(then[section]) ? then[section] : null;
      if (!was) continue; // not opened in that copy
      const before = new Set(was.map((e) => e && e.id));
      if (now.length > was.length) {
        out.push({ id: section, message: `${section}: ${now.length} entries, ${was.length} at ${
          sha}: the section only shrinks` });
      }
      for (const id of ids) {
        if (!before.has(id)) {
          out.push({ id, message: `${id}: ${was.length ? 'not' : 'closed section, so not'} in `
            + `the ${section} section at ${sha}; an entry is never added or returned` });
        }
      }
    }
  }
  return out;
}

function traceProblems(decl, entry, { census, testCorpus, read }) {
  const out = [];
  const bad = (message) => out.push({ id: decl.id, message: `${decl.id}: ${message}` });
  if (!entry || typeof entry !== 'object') {
    bad(`no trace entry in ${TRACE_DIR}`);
    return out;
  }
  const known = ['docsLong', 'source', 'plan', 'intents', 'adrs', 'tests'];
  for (const k of Object.keys(entry)) if (!known.includes(k)) bad(`unknown trace field ${k}`);
  const hooks = hooksOf(decl);
  // The source module contains the hook (a pattern: the static parts of its template).
  const text = typeof entry.source === 'string' ? read(entry.source) : null;
  if (text === null) bad(`trace source ${entry.source} does not exist`);
  else if (decl.pattern) {
    if (!decl.pattern.sites.includes(entry.source)) {
      bad(`trace source ${entry.source} is not one of the pattern's sites`);
    }
    for (const part of staticParts(decl.pattern.template)) {
      if (!text.includes(part)) bad(`trace source ${entry.source} does not contain "${part}"`);
    }
  } else {
    for (const h of hooks) {
      const files = census.literals.get(h);
      if (!text.includes(h) || !(files && files.has(entry.source))) {
        bad(`trace source ${entry.source} does not carry the hook ${h}`);
      }
    }
  }
  for (const id of Array.isArray(entry.plan) ? entry.plan : []) {
    if (read(`.ai/repo/project/issues/${id}.yaml`) === null) bad(`plan issue ${id} does not exist`);
  }
  if (!Array.isArray(entry.plan) || !entry.plan.length) bad('the trace names no plan issue');
  for (const ref of Array.isArray(entry.intents) ? entry.intents : []) {
    const [intent, criterion] = String(ref).split('#');
    const yaml = read(`.ai/repo/project/intents/${intent}.yaml`);
    if (yaml === null || !criterion
      || !new RegExp(`^- id: ${escape(criterion)}\\s*$`, 'm').test(yaml)) {
      bad(`intent criterion ${ref} does not exist`);
    }
  }
  for (const adr of Array.isArray(entry.adrs) ? entry.adrs : []) {
    const m = /^adr-(\d{4})$/.exec(adr);
    if (!m || read(`.ai/repo/adrs/${m[1]}`) === null) bad(`ADR ${adr} does not exist`);
  }
  // Every hook is named by a listed test that npm test or a script runs.
  const tests = Array.isArray(entry.tests) ? entry.tests : [];
  if (!tests.length) bad('the trace names no test');
  const usable = [];
  for (const file of tests) {
    const strings = testCorpus.strings(file);
    if (strings === null) bad(`test ${file} does not exist`);
    else if (!testCorpus.runs(file)) bad(`test ${file} is run by neither npm test nor a script`);
    else if (!hooks.some((h) => namesHook(strings, h))) {
      bad(`test ${file} names none of its hooks in a string literal (comments do not count)`);
    } else usable.push(strings);
  }
  if (tests.length) {
    for (const h of hooks) {
      if (!usable.some((strings) => namesHook(strings, h))) {
        bad(`no listed test names the hook ${h} in a string literal (comments do not count)`);
      }
    }
  }
  return out;
}

/** Every problem of the catalogue contract; empty when it holds. */
export function checkCatalog({ catalog, census, allowance, history = [], baseAllowance = null,
  sources, traces = {}, testCorpus, read }) {
  const out = [];
  const decls = catalog.list();
  const undeclared = Array.isArray(allowance && allowance.undeclared) ? allowance.undeclared : [];
  const allowed = new Set(undeclared.map((e) => e && e.id));

  // Census: every literal hook is declared or allowed; every built value has a pattern.
  for (const [hook, files] of census.literals) {
    if (!catalog.covers(hook) && !allowed.has(hook)) {
      out.push({ id: hook, message: `${hook}: undeclared data-osc hook (${[...files].join(', ')
      }); declare it in src/js/ui/catalog/decl` });
    }
  }
  for (const id of allowed) {
    if (catalog.covers(id)) {
      out.push({ id, message: `${id}: declared, so it leaves the undeclared allowance` });
    } else if (!census.literals.has(id)) {
      out.push({ id, message: `${id}: no such data-osc hook in the source; remove the entry` });
    }
  }
  const patterns = decls.filter((d) => d.pattern);
  for (const s of census.sites) {
    if (!patterns.some((d) => d.pattern.sites.includes(s.file))) {
      out.push({ id: `${s.file}:${s.line}`, message: `${s.file}:${s.line}: data-osc value ${
        s.expr} is built at run time and no pattern declaration names this site` });
    }
  }
  for (const d of patterns) {
    for (const file of d.pattern.sites) {
      if (!census.sites.some((s) => s.file === file)) {
        out.push({ id: d.id, message: `${d.id}: pattern site ${file} builds no data-osc value` });
      }
    }
  }

  // Each declaration: its shape, a unique docs sentence, a state that resolves, its links.
  const docs = new Map();
  for (const d of decls) {
    for (const p of declarationProblems(d, { derived: d.kind === 'node-face' })) {
      out.push({ id: d.id, message: `${d.id}: ${p}` });
    }
    const key = typeof d.docs === 'string' ? d.docs.trim().toLowerCase() : '';
    if (docs.has(key)) {
      out.push({ id: d.id, message: `${d.id}: docs repeat the docs of ${docs.get(key)}` });
    } else docs.set(key, d.id);
    if (typeof d.state === 'string' && !sources.has(d.state)) {
      out.push({ id: d.id, message: `${d.id}: state ${d.state} is not a path of sources.js` });
    }
    const targets = [...(d.links ? [...(d.links.opens || []), ...(d.links.openedBy || [])] : []),
      ...(d.related || []), ...(d.in ? [d.in] : [])];
    for (const t of targets) {
      if (!catalog.has(t)) out.push({ id: d.id, message: `${d.id}: link to missing id ${t}` });
    }
  }

  // The trace part: one entry per declared id (node faces are derived, never traced by hand).
  const declared = decls.filter((d) => d.kind !== 'node-face');
  for (const d of declared) {
    out.push(...traceProblems(d, traces[d.id], { census, testCorpus, read }));
  }
  for (const id of Object.keys(traces)) {
    if (!catalog.has(id)) out.push({ id, message: `${id}: trace entry for an undeclared id` });
  }

  // The allowance: its shape, and each section only shrinks.
  out.push(...allowanceShape(allowance));
  const copies = [...history, ...(baseAllowance ? [{ sha: 'base', allowance: baseAllowance }]
    : [])];
  if (allowance && typeof allowance === 'object') {
    out.push(...allowanceMonotonic(allowance, copies));
  }
  return out;
}

/**
 * The hooks of the running page that neither the catalogue covers nor the undeclared allowance
 * lists, sorted (the hook census of tests/browser/qa-regressions.cjs no-inert-controls).
 */
export function unknownHooks(hooks, catalog, allowance) {
  const allowed = new Set((allowance && Array.isArray(allowance.undeclared)
    ? allowance.undeclared : []).map((e) => e && e.id));
  return [...new Set(hooks)].filter((h) => !catalog.covers(h) && !allowed.has(h)).sort();
}

// ------------------------------------------------------------------------------ the repository
/** The trace entries of scripts/ui-catalog/trace/*.mjs, merged (a repeated id throws). */
export async function loadTraces(root = ROOT) {
  const dir = path.join(root, TRACE_DIR);
  const out = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()) {
    const { default: entries } = await import(pathToFileURL(path.join(dir, name)).href);
    for (const [id, entry] of Object.entries(entries)) {
      if (id in out) throw new Error(`trace: ${id} in ${name} is traced twice`);
      out[id] = entry;
    }
  }
  return out;
}

/** The files `npm test` (tests/unit/**\/*.test.mjs) and the package.json scripts run. */
export function runnableFiles(root = ROOT) {
  const files = new Set();
  const walk = (rel) => {
    for (const d of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(child);
      else if (d.name.endsWith('.test.mjs')) files.add(child);
    }
  };
  walk('tests/unit');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const script of Object.values(pkg.scripts || {})) {
    for (const m of script.matchAll(/\bnode\s+([\w./-]+\.(?:c|m)?js)\b/g)) files.add(m[1]);
  }
  return files;
}

/** The test corpus of the repository: which files run, and their string literals. */
export function testCorpus(root = ROOT) {
  const runs = runnableFiles(root);
  const cache = new Map();
  return {
    runs: (file) => runs.has(file),
    strings(file) {
      if (!cache.has(file)) {
        const abs = path.join(root, file);
        cache.set(file, existsSync(abs) ? stringLiteralsOf(readFileSync(abs, 'utf8')) : null);
      }
      return cache.get(file);
    },
  };
}

/** A reader of repository files; a directory prefix like '.ai/repo/adrs/0081' matches a file. */
export function reader(root = ROOT) {
  return (rel) => {
    const abs = path.join(root, rel);
    if (existsSync(abs)) return readFileSync(abs, 'utf8');
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    if (!existsSync(dir)) return null;
    const hit = readdirSync(dir).find((n) => n.startsWith(`${base}-`));
    return hit ? readFileSync(path.join(dir, hit), 'utf8') : null;
  };
}

/** Every committed copy of the allowance, newest first ([] outside git or before the first). */
export function allowanceHistory(root = ROOT, rel = ALLOWANCE_REL) {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return [];
  const copies = [];
  const log = git('log', '--format=%H', '--', rel);
  for (const sha of log.status === 0 ? log.stdout.split('\n').filter(Boolean) : []) {
    const show = git('show', `${sha}:${rel}`);
    if (show.status === 0) {
      copies.push({ sha: sha.slice(0, 12), allowance: JSON.parse(show.stdout) });
    }
  }
  // The base branch's copy, when it has one that the local history does not hold.
  for (const ref of ['origin/main', 'main']) {
    const show = git('show', `${ref}:${rel}`);
    if (show.status === 0) {
      copies.push({ sha: ref, allowance: JSON.parse(show.stdout) });
      break;
    }
  }
  return copies;
}

/** The whole check on the repository at `root`. */
export async function checkRepository(root = ROOT) {
  const { scanHooks } = await import('./scan.mjs');
  const registry = await import(pathToFileURL(path.join(root,
    'src/js/ui/catalog/registry.js')).href);
  const sources = await import(pathToFileURL(path.join(root,
    'src/js/ui/catalog/sources.js')).href);
  const allowance = JSON.parse(readFileSync(path.join(root, ALLOWANCE_REL), 'utf8'));
  return checkCatalog({ catalog: registry.CATALOG, census: scanHooks(root), allowance,
    history: allowanceHistory(root), sources, traces: await loadTraces(root),
    testCorpus: testCorpus(root), read: reader(root) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = await checkRepository();
  for (const p of problems) console.log(p.message);
  console.log(problems.length ? `${problems.length} problem(s)` : 'ui-catalog: the contract holds');
  process.exit(problems.length ? 1 : 0);
}
