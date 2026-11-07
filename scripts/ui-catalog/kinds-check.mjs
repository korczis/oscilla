#!/usr/bin/env node
// The instrument kind check (plan issue W001): every clause of the kind contract that needs the
// rest of the repository, as pure functions over the declarations and the facts read here.
// src/js/ui/catalog/kind.js judges a declaration's shape; tests/unit/ui-kinds.test.mjs runs
// this on the repository and on a fixture per negative case.
//
//   checkKinds({ kinds, facts }) -> { problems: [{ kind, message }], pending: [...] }
//   digestOf(decl) -> 'sha256:<hex>'          the hash of kindShape(decl), canonicalJson
//   pinProblems(kinds, pin, copies) -> [{ kind, message }]   the digest pin and its base copies
//   scanKindModules(files, views) -> [{ file, message }]     the static scan (W001 section 1.5)
//   runtimeImportProblems(files) -> [{ file, message }]      rule 5
//   transportCommands(text), issueScope(text), truthKeys(text)   facts parsed from the sources
//   loadKindFacts(root), kindModuleFiles(root, kinds), checkKindRepository(root)
//   node scripts/ui-catalog/kinds-check.mjs [--pin]   prints the problems; --pin rewrites the pin
//
// Facts. An event's emits target is a Studio action type (ACTION_TYPES of studio/actions.js),
// 'transport.<command>' (a key of the object createStudioTransport returns, studio/transport.js:
// there is no transport-commands.js), 'notes.<call>' (a key of createLiveNotes, the note router
// of studio/live-notes.js) or 'view'. A link resolves as 'route:<workspace>' (shell.js
// WORKSPACE_REGISTRY) or as a catalogue id (registry.js CATALOG): G007's link address grammar
// is not built, so nothing else resolves. A key's row is judged against the Keyboard shortcuts
// dialog (shortcuts.js shortcutHelp) once the kind's modules exist; until then the rows are
// reported as pending on the issue that adds the modules.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, kindProblems, kindShape, MOUNT_BASE }
  from '../../src/js/ui/catalog/kind.js';
import { lexJs } from './scan.mjs';
import { loadTraces, namesHook, reader, testCorpus } from './check.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PIN_REL = 'tests/unit/ui-kinds-digest.json';
export const KINDS_VIEW_DIR = 'src/js/ui/kinds';
const RULES_DIR = '.ai/repo/rules/project';
/** The trace id of a kind (scripts/ui-catalog/trace/kinds.mjs). */
export const traceId = (kind) => `kind:${kind}`;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

// ------------------------------------------------------------------------------ facts
/** The keys of the object createStudioTransport returns (its commands and accessors). */
export function transportCommands(text) {
  const start = text.indexOf('export function createStudioTransport');
  const ret = start < 0 ? -1 : text.indexOf('\n  return Object.freeze({', start);
  if (ret < 0) return [];
  const end = text.indexOf('\n  });', ret);
  const body = text.slice(ret, end < 0 ? text.length : end);
  return [...body.matchAll(/^ {4}(?:get\s+)?([A-Za-z]\w*)\s*(?:[,:(]|$)/gm)].map((m) => m[1]);
}

/** The scope entries of a plan issue's YAML (quoted or not, indented or not). */
export function issueScope(text) {
  const lines = String(text).split('\n');
  const at = lines.findIndex((l) => /^scope:\s*$/.test(l));
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*-\s+"?([^"]+?)"?\s*$/.exec(l);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

/** The readout keys of docs/v3/readout-truth.yaml. */
export function truthKeys(text) {
  return [...String(text).matchAll(/^ {2}- key:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/** Everything checkKinds needs from the repository at `root`. */
export async function loadKindFacts(root = ROOT) {
  const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const read = reader(root);
  const { ACTION_TYPES } = await imp('src/js/studio/actions.js');
  const { createLiveNotes } = await imp('src/js/studio/live-notes.js');
  const { WORKSPACE_IDS } = await imp('src/js/ui/shell.js');
  const { shortcutHelp } = await imp('src/js/ui/shortcuts.js');
  const { CATALOG } = await imp('src/js/ui/catalog/registry.js');
  const sources = await imp('src/js/ui/catalog/sources.js');
  const router = createLiveNotes({ getModel: () => null, handleOf: () => null });
  return {
    actionTypes: new Set(ACTION_TYPES),
    transportCommands: new Set(transportCommands(read('src/js/studio/transport.js') || '')),
    noteRouterCalls: new Set(Object.keys(router)),
    sources,
    workspaces: new Set(WORKSPACE_IDS),
    catalog: CATALOG,
    truthKeys: new Set(truthKeys(read('docs/v3/readout-truth.yaml') || '')),
    exists: (rel) => existsSync(path.join(root, rel)),
    issueScope: (id) => {
      const text = read(`.ai/repo/project/issues/${id}.yaml`);
      return text === null ? null : issueScope(text);
    },
    shortcutRows: (ws) => {
      const help = shortcutHelp(ws);
      return new Set([...help.rows, ...help.global].map((r) => r.id));
    },
    rules: new Set(readdirSync(path.join(root, RULES_DIR))
      .map((n) => /^([a-z][\w-]*)\.v\d+\.md$/.exec(n)).filter(Boolean).map((m) => m[1])),
    traces: await loadTraces(root),
    testCorpus: testCorpus(root),
    read,
  };
}

// ------------------------------------------------------------------------------ the contract
function emitProblems(decl, facts) {
  const out = [];
  for (const e of decl.events || []) {
    for (const t of e.emits || []) {
      const [head, call] = t.split('.');
      const ok = t === 'view'
        || (head === 'transport' ? facts.transportCommands.has(call)
          : head === 'notes' ? facts.noteRouterCalls.has(call) : facts.actionTypes.has(t));
      if (!ok) {
        out.push(`event ${e.name} emits ${t}, which is neither a Studio action type `
          + '(studio/actions.js ACTION_TYPES), a transport command (studio/transport.js), a '
          + 'note-router call (studio/live-notes.js) nor view');
      }
    }
  }
  return out;
}

const inScope = (scope, rel) => scope.some((s) => s === rel || rel.startsWith(`${s}/`));

function traceProblems(decl, entry, facts) {
  const out = [];
  if (!entry || typeof entry !== 'object') return [`no trace entry ${traceId(decl.kind)}`];
  const known = ['plan', 'serves', 'rules', 'adrs', 'tests', 'since'];
  for (const k of Object.keys(entry)) if (!known.includes(k)) out.push(`unknown trace field ${k}`);
  const plan = Array.isArray(entry.plan) ? entry.plan : [];
  if (!plan.includes('W001')) out.push('the trace names W001, the kind contract');
  for (const id of plan) {
    if (facts.read(`.ai/repo/project/issues/${id}.yaml`) === null) {
      out.push(`plan issue ${id} does not exist`);
    }
  }
  const serves = Array.isArray(entry.serves) ? entry.serves : [];
  if (!serves.includes('instrument-kinds#kind-contract')) {
    out.push('the trace serves instrument-kinds#kind-contract');
  }
  for (const ref of serves) {
    const [intent, criterion] = String(ref).split('#');
    const yaml = facts.read(`.ai/repo/project/intents/${intent}.yaml`);
    if (yaml === null || !criterion
      || !new RegExp(`^- id: ${escape(criterion)}\\s*$`, 'm').test(yaml)) {
      out.push(`intent criterion ${ref} does not exist`);
    }
  }
  const rules = Array.isArray(entry.rules) ? entry.rules : [];
  if (!rules.length) out.push('the trace names no rule');
  for (const r of rules) {
    const m = /^project\.([a-z][\w-]*)$/.exec(r);
    if (!m || !facts.rules.has(m[1])) out.push(`rule ${r} is not a project rule`);
  }
  const adrs = Array.isArray(entry.adrs) ? entry.adrs : [];
  if (!adrs.length) out.push('the trace names no ADR');
  for (const a of adrs) {
    const m = /^adr-(\d{4})$/.exec(a);
    if (!m || facts.read(`.ai/repo/adrs/${m[1]}`) === null) out.push(`ADR ${a} does not exist`);
  }
  const tests = Array.isArray(entry.tests) ? entry.tests : [];
  if (!tests.length) out.push('the trace names no test');
  for (const file of tests) {
    const strings = facts.testCorpus.strings(file);
    if (strings === null) out.push(`test ${file} does not exist`);
    else if (!facts.testCorpus.runs(file)) out.push(`test ${file} is run by neither npm test nor `
      + 'a script');
    else if (!namesHook(strings, decl.kind)) {
      out.push(`test ${file} does not name ${decl.kind} in a string literal`);
    }
  }
  if (!DATE.test(entry.since || '')) out.push('since must be the day of the last change');
  return out;
}

/** Every problem of the declared kinds against the repository's facts, and the pending rows. */
export function checkKinds({ kinds, facts }) {
  const problems = [];
  const pending = [];
  const seen = new Set();
  for (const decl of kinds) {
    const bad = (message) => problems.push({ kind: decl.kind,
      message: `${decl.kind}: ${message}` });
    for (const p of kindProblems(decl)) bad(p);
    if (seen.has(decl.kind)) bad('the kind is declared twice');
    seen.add(decl.kind);
    for (const p of emitProblems(decl, facts)) bad(p);
    for (const s of decl.state || []) {
      if (!facts.sources.has(s)) bad(`state ${s} is not a path of sources.js`);
    }
    const links = decl.links || {};
    for (const t of [...(links.opens || []), ...(links.openedBy || [])]) {
      const route = /^route:(.+)$/.exec(t);
      if (route ? !facts.workspaces.has(route[1]) : !facts.catalog.has(t)) {
        bad(`link ${t} resolves to no workspace route and no catalogue id (G007's grammar is `
          + 'not built)');
      }
    }
    for (const ws of decl.workspaces || []) {
      if (!facts.workspaces.has(ws)) bad(`workspace ${ws} is not a workspace of shell.js`);
    }
    if (Array.isArray(decl.truth)) {
      for (const k of decl.truth) {
        if (!facts.truthKeys.has(k)) bad(`truth row ${k} is not in docs/v3/readout-truth.yaml`);
      }
    }
    const impl = decl.impl || { modules: [] };
    const scope = impl.issue ? facts.issueScope(impl.issue) : null;
    if (impl.issue && scope === null) bad(`impl issue ${impl.issue} does not exist`);
    const missing = (impl.modules || []).filter((m) => !facts.exists(m));
    for (const m of missing) {
      if (!scope || !inScope(scope, m)) {
        bad(`impl module ${m} does not exist and no issue that adds it names it in its scope`);
      }
    }
    // The keys are listed in the Keyboard shortcuts dialog once the view exists.
    for (const ws of decl.workspaces || []) {
      const rows = missing.length ? null : facts.shortcutRows(ws);
      for (const row of [...new Set((decl.keys || []).map((k) => k.row))]) {
        if (!rows) pending.push({ kind: decl.kind, workspace: ws, row, issue: impl.issue });
        else if (!rows.has(row)) bad(`key row ${row} is not in the shortcuts table of ${ws}`);
      }
    }
    for (const p of traceProblems(decl, facts.traces[traceId(decl.kind)], facts)) bad(p);
  }
  for (const id of Object.keys(facts.traces)) {
    if (id.startsWith('kind:') && !seen.has(id.slice(5))) {
      problems.push({ kind: id, message: `${id}: trace entry for an undeclared kind` });
    }
  }
  return { problems, pending };
}

// ------------------------------------------------------------------------------ the digest pin
/** The hash of a kind's shape (props, events, keys) serialised with sorted keys, no functions. */
export const digestOf = (decl) => `sha256:${createHash('sha256')
  .update(canonicalJson(kindShape(decl))).digest('hex')}`;

/** The pin a set of kinds has now. */
export const pinOf = (kinds) => Object.fromEntries([...kinds]
  .sort((a, b) => (a.kind < b.kind ? -1 : 1))
  .map((d) => [d.kind, { version: d.version, digest: digestOf(d) }]));

/**
 * The pin holds each kind's version and digest; a shape changed without a version bump fails,
 * against the committed pin and against each earlier copy (the base branch's).
 */
export function pinProblems(kinds, pin, copies = []) {
  const out = [];
  const bad = (kind, message) => out.push({ kind, message: `${kind}: ${message}` });
  const now = pinOf(kinds);
  for (const [kind, { version, digest }] of Object.entries(now)) {
    for (const { sha, pin: then } of [{ sha: 'the pin', pin }, ...copies]) {
      const was = then && then[kind];
      if (!was) continue;
      if (version < was.version) bad(kind, `version ${version} is below ${was.version} at ${sha}`);
      else if (version === was.version && digest !== was.digest) {
        bad(kind, `its shape (props, events, keys) changed without a version bump (version ${
          version} at ${sha})`);
      }
    }
    const p = pin && pin[kind];
    if (!p) bad(kind, `no pin in ${PIN_REL}; run node scripts/ui-catalog/kinds-check.mjs --pin`);
    else if (p.version !== version) {
      bad(kind, `version ${version}, pinned ${p.version}: re-pin with --pin after the bump`);
    }
  }
  for (const kind of Object.keys(pin || {})) {
    if (!(kind in now)) bad(kind, `pinned in ${PIN_REL} but not declared`);
  }
  const sorted = Object.keys(pin || {});
  if (sorted.join() !== [...sorted].sort().join()) bad(PIN_REL, 'the pin is not sorted by kind');
  return out;
}

/** The committed copies of the pin on the base branch (newest first; [] outside git). */
export function pinCopies(root = ROOT) {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  for (const ref of ['origin/main', 'main']) {
    const show = git('show', `${ref}:${PIN_REL}`);
    if (show.status === 0) return [{ sha: ref, pin: JSON.parse(show.stdout) }];
  }
  return [];
}

// ------------------------------------------------------------------------------ the modules
const resolveSpec = (file, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(file),
  spec));
const SPECIFIER = new RegExp(String.raw`\b(?:import|export)\b[^'"\`;]*?\bfrom\s*(['"])([^'"]+)\1`
  + String.raw`|\bimport\s*\(?\s*(['"])([^'"]+)\3`, 'g');

/** The relative import specifiers of a module, resolved against it, comments removed. */
export function importsOf(file, text) {
  return [...lexJs(text).code.matchAll(SPECIFIER)].map((m) => m[2] || m[4])
    .filter((s) => s.startsWith('.')).map((s) => resolveSpec(file, s));
}

/** The code of a module with comments and the contents of its strings blanked. */
function bareCode(text) {
  const { code, strings } = lexJs(text);
  const out = code.split('');
  for (const s of strings) for (let k = s.start + 1; k < s.end - 1; k += 1) out[k] = ' ';
  return { bare: out.join(''), code, strings };
}

const FORBIDDEN_IMPORTS = [
  [(r) => r === 'src/js/studio/actions.js', 'studio/actions.js (the store and its action types)'],
  [(r) => r === 'src/js/studio/history.js', 'studio/history.js (the store\'s history)'],
  [(r) => /(?:store|storage)[^/]*\.js$/i.test(r), 'a store module'],
  [(r) => r === 'src/js/ui/catalog/sources.js', 'sources.js (the state table)'],
  [(r) => r.startsWith('src/js/labs/'), 'a lab module'],
];
const FORBIDDEN_CODE = [
  [/\bdispatch\s*\(/, 'a dispatch: the owner commits, the view builds a plain action'],
  [/\bstore\s*\.\s*\w+\s*\(/, 'a store call: the owner commits, the view builds a plain action'],
  [/\bnew\s+(?:webkit)?(?:Offline)?AudioContext\b/, 'an AudioContext (one AudioEngine)'],
  [/\b(?:AudioNode|AudioWorkletNode|AudioWorklet)\b|\.audioWorklet\b/,
    'an AudioNode or a worklet (one AudioEngine)'],
  [new RegExp(String.raw`\.create(?:Oscillator|Gain|BiquadFilter|Analyser|BufferSource|Buffer`
    + String.raw`|ConstantSource|Delay|Dynamics\w*|Convolver|WaveShaper|StereoPanner|Panner`
    + String.raw`|ChannelSplitter|ChannelMerger|Media\w*Source|IIRFilter|ScriptProcessor`
    + String.raw`|PeriodicWave)\s*\(`), 'an audio node created (one AudioEngine)'],
  [/\b(?:requestAnimationFrame|setInterval|setTimeout)\b/,
    'a timer or an animation frame outside src/js/charts/frame-loop.js'],
  [/\.style\b|\bcssText\b/, 'an el.style write (rule 3)'],
];
const CLASS_CONTEXT = new RegExp(String.raw`(?:\bclassName\s*\+?=|['"]?\bclass['"]?\s*:`
  + String.raw`|\bclassList\.\w+\(|setAttribute\(\s*['"]class['"]\s*,)\s*$`);

/**
 * The static scan of src/js/ui/kinds and the kinds' model modules (W001 section 1.5) and rules 3
 * and 4. `views` maps a view module to its kind declaration, whose mount it is held to.
 */
export function scanKindModules(files, views = {}) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    const bad = (message) => out.push({ file, message: `${file}: ${message}` });
    for (const r of importsOf(file, text)) {
      for (const [test, what] of FORBIDDEN_IMPORTS) if (test(r)) bad(`imports ${what}`);
    }
    const { bare, code, strings } = bareCode(text);
    for (const [re, what] of FORBIDDEN_CODE) if (re.test(bare)) bad(`calls ${what}`);
    if (/setAttribute\(\s*['"]style['"]/.test(code) || /(?:^|[{,]\s*)['"]?style['"]?\s*:/m
      .test(code) || strings.some((s) => /\sstyle\s*=/.test(s.text))) {
      bad('writes a style attribute (rule 3)');
    }
    for (const s of strings) {
      const before = code.slice(Math.max(0, s.start - 60), s.start);
      if (!CLASS_CONTEXT.test(before)) continue;
      if (s.interpolated || /^\s*\+/.test(code.slice(s.end, s.end + 3))) {
        bad(`builds a class name at run time (\`${s.text.slice(0, 40)}\`): class names are `
          + 'literal strings (rule 3)');
      }
    }
    if (/\bclassName\s*\+=/.test(bare)) {
      bad('appends to className: class names are literal strings (rule 3)');
    }
    const decl = views[file];
    if (decl) {
      const name = `mount${decl.kind.split('-').map((w) => w[0].toUpperCase() + w.slice(1))
        .join('')}`;
      if (!new RegExp(`export\\s+function\\s+${name}\\b`).test(bare)) {
        bad(`exports no ${name} (rule 4)`);
      }
      for (const k of [...MOUNT_BASE, ...decl.mount.extras]) {
        if (!new RegExp(`\\b${k}\\b`).test(bare)) bad(`its mount returns no ${k} (rule 4)`);
      }
    }
  }
  return out;
}

/** Rule 5: no module under src/ outside the catalogue imports a kind declaration. */
export function runtimeImportProblems(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (file.startsWith('src/js/ui/catalog/')) continue;
    for (const r of importsOf(file, text)) {
      if (r === 'src/js/ui/catalog/kind.js' || r.startsWith('src/js/ui/catalog/kinds/')) {
        out.push({ file, message: `${file}: imports ${r}; no runtime module interprets a kind `
          + 'declaration (rule 5)' });
      }
    }
  }
  return out;
}

function walkJs(root, dir) {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir)).sort().flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) return walkJs(root, rel);
    return name.endsWith('.js') ? [rel] : [];
  });
}

/** The modules the scan reads: src/js/ui/kinds and every existing impl module of a kind. */
export function kindModuleFiles(root, kinds) {
  const rels = new Set(walkJs(root, KINDS_VIEW_DIR));
  for (const d of kinds) {
    for (const m of d.impl.modules) if (existsSync(path.join(root, m))) rels.add(m);
  }
  return Object.fromEntries([...rels].sort()
    .map((r) => [r, readFileSync(path.join(root, r), 'utf8')]));
}

/** The view module of each kind whose view exists (its first impl module). */
export function viewsOf(root, kinds) {
  return Object.fromEntries(kinds.filter((d) => existsSync(path.join(root, d.impl.modules[0])))
    .map((d) => [d.impl.modules[0], d]));
}

/** The whole check on the repository at `root`. */
export async function checkKindRepository(root = ROOT) {
  const { KIND_DECLARATIONS: kinds } = await import(pathToFileURL(path.join(root,
    'src/js/ui/catalog/kinds/index.js')).href);
  const facts = await loadKindFacts(root);
  const { problems, pending } = checkKinds({ kinds, facts });
  const pinPath = path.join(root, PIN_REL);
  const pin = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, 'utf8')) : {};
  const src = Object.fromEntries(walkJs(root, 'src/js')
    .map((r) => [r, readFileSync(path.join(root, r), 'utf8')]));
  return {
    kinds,
    pending,
    problems: [...problems.map((p) => p.message),
      ...pinProblems(kinds, pin, pinCopies(root)).map((p) => p.message),
      ...scanKindModules(kindModuleFiles(root, kinds), viewsOf(root, kinds)).map((p) => p.message),
      ...runtimeImportProblems(src).map((p) => p.message)],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--pin')) {
    const { KIND_DECLARATIONS } = await import('../../src/js/ui/catalog/kinds/index.js');
    const text = `${JSON.stringify(pinOf(KIND_DECLARATIONS), null, 2)}\n`;
    writeFileSync(path.join(ROOT, PIN_REL), text);
    console.log(`ui-kinds: pinned ${KIND_DECLARATIONS.length} kind(s) in ${PIN_REL}`);
  }
  const { problems, pending } = await checkKindRepository();
  for (const p of problems) console.log(p);
  for (const p of pending) {
    console.log(`pending: ${p.kind} key row ${p.row} in ${p.workspace}, with ${p.issue}'s view`);
  }
  console.log(problems.length ? `${problems.length} problem(s)` : 'ui-kinds: the contract holds');
  process.exit(problems.length ? 1 : 0);
}
