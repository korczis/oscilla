#!/usr/bin/env node
// The patch contract coverage matrix (plan K164; the owner's program B of 2026-11-03): for every
// node type of the Studio registry, every port and every parameter, each field of its contract
// is declared, defaulted or missing. Derived from NODE_REGISTRY, never a hand-kept list; the
// table docs/v31/patch-contract.md is written by this script and says so.
//
//   declared   the field has a value on the port or parameter as the registry holds it
//   defaulted  it has a value the declaration derived rather than the node type stating it: a
//              parameter port (registry.js complete(): one per modulatable parameter), or a
//              field the port or parameter names in its own `defaulted` list (V619's derived
//              defaults), so a derived value is counted apart and never called missing
//   missing    no value
//
// The fields follow the program: a port's identity and owner, direction, signal type, role,
// cardinality, whether it is required, its channels, rate, unconnected behaviour, monitor and
// compact eligibility and contract version; a parameter's type, unit, default, range (min and
// max for a number, options for a choice), mapping, automation and modulation eligibility and
// live-update timing. A field that does not apply (a range for a switch) is not counted.
//
//   node scripts/patch-contract.mjs            the matrix as JSON on stdout
//   node scripts/patch-contract.mjs --write    rewrite docs/v31/patch-contract.md
//   node scripts/patch-contract.mjs --check    exit 1 when the table is stale
//
// Exit 0 done, 1 stale (--check), 2 usage.
//
// The missing counts only fall (tests/unit/patch-contract.test.mjs): against the working tree's
// baseline (BASELINE), and against every committed version of it on the base branch's first-
// parent chain (baselineHistory, historyProblems, historyGate: the pattern and the fetch-depth
// handling of scripts/ui-flowbite-pro-measure.mjs), never a commit of the branch itself, so a
// change that raises a count in the registry and in the baseline together is still refused.

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TABLE = 'docs/v31/patch-contract.md';
export const BASELINE = 'tests/unit/patch-contract-baseline.json';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

const has = (v) => v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v));

/** A field that does not apply to this port or parameter: not counted. */
const NA = Symbol('n/a');

/** Port fields: name -> read(port, def) -> the value, undefined, or NA. */
export const PORT_FIELDS = Object.freeze({
  id: (p) => p.id,
  owner: (p, def) => def.type,
  direction: (p) => p.direction,
  type: (p) => p.type,
  role: (p) => p.role,
  cardinality: (p) => (p.direction === 'in' ? p.multiple : true),
  required: (p) => (p.direction === 'in' ? p.required : false),
  channels: (p) => p.channels,
  rate: (p) => p.rate,
  unconnected: (p) => (p.direction === 'in' ? p.unconnected : NA),
  monitor: (p) => p.monitor,
  compact: (p) => p.compact,
  version: (p) => p.version,
});

const RANGED = new Set(['number', 'integer']);

/** Parameter fields: name -> read(param) -> the value, undefined, or NA. */
export const PARAM_FIELDS = Object.freeze({
  type: (q) => q.type,
  unit: (q) => q.unit,
  default: (q) => q.default,
  range: (q) => {
    if (RANGED.has(q.type)) return has(q.min) && has(q.max) ? [q.min, q.max] : undefined;
    if (q.type === 'enum') return q.options && q.options.length ? q.options : undefined;
    return NA;
  },
  mapping: (q) => (RANGED.has(q.type) ? q.scale : NA),
  automatable: (q) => q.automatable,
  modulatable: (q) => q.modulatable,
  live: (q) => q.live,
});

const zero = (fields) => Object.fromEntries(Object.keys(fields).map((f) => [f,
  { declared: 0, defaulted: 0, missing: 0 }]));

/**
 * The matrix of `registry` (anything with list() -> node definitions).
 * -> { types, ports, params, port: { field: counts }, param: { field: counts },
 *      missing: { 'port.<field>' | 'param.<field>': [node type, …] }, rows: [{ type, ports,
 *      params, missing }] }
 */
export function contractMatrix(registry) {
  const out = { types: 0, ports: 0, params: 0, port: zero(PORT_FIELDS), param: zero(PARAM_FIELDS),
    missing: {}, rows: [] };
  const miss = (key, type) => {
    const list = out.missing[key] || (out.missing[key] = []);
    if (!list.includes(type)) list.push(type);
  };
  for (const def of registry.list()) {
    out.types++;
    const row = { type: def.type, ports: 0, params: 0, missing: 0 };
    const paramPorts = new Set(def.params.filter((q) => q.modulatable).map((q) => q.key));
    for (const p of [...def.inputs, ...def.outputs]) {
      out.ports++;
      row.ports++;
      const derived = p.role === 'PARAMETER' && p.param && paramPorts.has(p.param.key);
      const named = new Set(Array.isArray(p.defaulted) ? p.defaulted : []);
      for (const [f, read] of Object.entries(PORT_FIELDS)) {
        const v = read(p, def);
        if (v === NA) continue;
        const c = out.port[f];
        if (!has(v)) { c.missing++; row.missing++; miss(`port.${f}`, def.type); }
        else if (derived || named.has(f)) c.defaulted++;
        else c.declared++;
      }
    }
    for (const q of def.params) {
      out.params++;
      row.params++;
      const named = new Set(Array.isArray(q.defaulted) ? q.defaulted : []);
      for (const [f, read] of Object.entries(PARAM_FIELDS)) {
        const v = read(q);
        if (v === NA) continue;
        const c = out.param[f];
        if (!has(v)) { c.missing++; row.missing++; miss(`param.${f}`, def.type); }
        else if (named.has(f)) c.defaulted++;
        else c.declared++;
      }
    }
    out.rows.push(row);
  }
  return out;
}

/**
 * Compatibility and cardinality as a type × type table (program B), from canConnect over every
 * pair of the roles each type allows: { rows: [{ from, fromRole, to, toRole, allowed, code,
 * reason }], fanOut, fanIn } where fanOut says one output feeds many inputs (always) and fanIn
 * counts the input ports of the registry that accept more than one cable.
 */
export function compatibilityMatrix({ canConnect, ROLES_BY_TYPE, PORT_TYPE_LIST }, registry) {
  const rows = [];
  for (const from of PORT_TYPE_LIST) {
    for (const fromRole of ROLES_BY_TYPE[from]) {
      for (const to of PORT_TYPE_LIST) {
        for (const toRole of ROLES_BY_TYPE[to]) {
          const r = canConnect({ id: 'o', direction: 'out', type: from, role: fromRole },
            { id: 'i', direction: 'in', type: to, role: toRole }, { sourceNodeId: 'a',
              targetNodeId: 'b' });
          rows.push({ from, fromRole, to, toRole, allowed: r.allowed, code: r.code,
            reason: r.reason });
        }
      }
    }
  }
  const inputs = registry.list().flatMap((d) => d.inputs);
  return { rows, fanOut: true, fanIn: { many: inputs.filter((p) => p.multiple).length,
    one: inputs.filter((p) => !p.multiple).length } };
}

/** The missing count of every field, the shape of tests/unit/patch-contract-baseline.json. */
export function missingCounts(m) {
  const counts = {};
  for (const [kind, fields] of [['port', m.port], ['param', m.param]]) {
    for (const [f, c] of Object.entries(fields)) counts[`${kind}.${f}`] = c.missing;
  }
  return counts;
}

/**
 * What the missing `counts` (missingCounts of the working tree) raise over each committed version
 * of the baseline in `history` ({ sha, counts }, newest first): a count above an earlier one of
 * the same field, or a field an earlier version counted as missing that is no longer counted (its
 * debt would vanish unfilled). A field an earlier version did not count is new and not compared.
 */
export function historyProblems(counts, history) {
  const problems = [];
  for (const { sha, counts: then } of history) {
    for (const [f, n] of Object.entries(then || {})) {
      if (!(f in counts)) {
        if (n > 0) problems.push(`${f}: ${n} missing at ${sha}, no longer counted`);
      } else if (counts[f] > n) {
        problems.push(`${f}: ${counts[f]} missing, above ${n} at ${sha}`);
      }
    }
  }
  return [...new Set(problems)];
}

/** The base branch the history is read from: GITHUB_BASE_REF in CI, main otherwise. */
export const baseBranch = (env = process.env) => env.GITHUB_BASE_REF || 'main';

/**
 * Every committed version of BASELINE on the base branch's first-parent chain, newest first:
 * from the fork backwards, never a commit of the branch itself (the walk of
 * scripts/ui-flowbite-pro-measure.mjs baselineHistory). The base is origin/<base>, or <base>
 * without the remote ref; the fork is the newest commit of that chain HEAD contains.
 * -> { versions: [{ sha, counts }], base, fork, baseHolds } or { error }.
 */
export function baselineHistory({ root = ROOT, base = baseBranch() } = {}) {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--verify', '-q', 'HEAD^{commit}');
  if (head.status !== 0) return { error: `git rev-parse HEAD: ${head.stderr || head.error}` };
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    return { error: 'a shallow clone: the base branch history is cut (fetch-depth: 0)' };
  }
  const ref = [`origin/${base}`, base].find((r) => git('rev-parse', '--verify', '-q',
    `${r}^{commit}`).status === 0);
  if (!ref) return { error: `no base branch: neither origin/${base} nor ${base} resolves` };
  // The base's chain commits HEAD does not contain are a prefix of the chain (ancestry is
  // monotone along first parents); the fork is the first parent of the oldest of them.
  const ahead = git('rev-list', '--first-parent', ref, '^HEAD');
  if (ahead.status !== 0) return { error: `git rev-list ${ref} ^HEAD: ${ahead.stderr}` };
  const oldest = ahead.stdout.split('\n').filter(Boolean).pop();
  const at = oldest ? git('rev-parse', '--verify', '-q', `${oldest}^1`) : git('rev-parse', ref);
  if (at.status !== 0) return { versions: [], base: ref, fork: '(none)', baseHolds: false };
  const fork = at.stdout.trim();
  if (git('merge-base', '--is-ancestor', fork, 'HEAD').status !== 0) {
    return { error: `the fork ${fork.slice(0, 12)} of ${ref} is not an ancestor of HEAD` };
  }
  const log = git('log', '--first-parent', '--format=%H', fork, '--', BASELINE);
  if (log.status !== 0) return { error: `git log: ${log.stderr || log.error}` };
  const versions = [];
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const shown = git('show', `${sha}:${BASELINE}`);
    if (shown.status !== 0) return { error: `git show ${sha}: ${shown.stderr}` };
    versions.push({ sha: sha.slice(0, 12), counts: JSON.parse(shown.stdout).counts });
  }
  const baseHolds = git('cat-file', '-e', `${fork}:${BASELINE}`).status === 0;
  return { versions, base: ref, fork: fork.slice(0, 12), baseHolds };
}

/**
 * The history from baselineHistory and whether this runs in CI -> { verdict, reason }: 'judge'
 * when versions were read, 'introduce' when the base's tree at the fork holds no baseline,
 * 'skip' outside CI without history, and 'fail' in CI on a git failure, a shallow clone, a
 * missing base or an empty history of a base that holds the baseline.
 */
export function historyGate(history, ci) {
  if (history.error) {
    return ci ? { verdict: 'fail', reason: `git failed in CI: ${history.error}` }
      : { verdict: 'skip', reason: `no git history here (${history.error})` };
  }
  if (!history.versions.length && history.baseHolds === false) {
    return { verdict: 'introduce', reason: `the base ${history.base} holds no baseline at the `
      + `fork ${history.fork}: this change introduces it` };
  }
  if (!history.versions.length) {
    return ci ? { verdict: 'fail', reason: `no commit holds ${BASELINE}: the CI unit job checks `
      + 'out with fetch-depth: 0' } : { verdict: 'skip', reason: 'no committed version' };
  }
  return { verdict: 'judge', reason: '' };
}

/** The markdown table of the matrix. */
export function contractTable(m, compat = null) {
  const line = (kind, fields) => Object.entries(fields).map(([f, c]) =>
    `| ${kind} | \`${f}\` | ${c.declared} | ${c.defaulted} | ${c.missing} |`).join('\n');
  const worst = [...m.rows].filter((r) => r.missing).sort((a, b) => b.missing - a.missing
    || a.type.localeCompare(b.type));
  return [
    '# The patch contract coverage matrix',
    '',
    'Derived by `node scripts/patch-contract.mjs --write` from the Studio node registry',
    '(`src/js/studio/registry.js`; plan K164, the owner\'s program B). Do not edit by hand:',
    '`--check` fails when it is stale, and `tests/unit/patch-contract.test.mjs` holds the missing',
    'counts to `tests/unit/patch-contract-baseline.json`, which only fall.',
    '',
    `${m.types} node types, ${m.ports} ports, ${m.params} parameters. A field is declared,`,
    'defaulted (derived by the declaration: a parameter port, or a field the port or parameter',
    'lists as defaulted) or missing; a field that does not apply is not counted.',
    '',
    '| Kind | Field | Declared | Defaulted | Missing |',
    '|---|---|---:|---:|---:|',
    line('port', m.port),
    line('parameter', m.param),
    '',
    ...(compat ? ['## Compatibility and cardinality', '',
      'From `canConnect` (`src/js/studio/ports.js`) over every pair of port types and the',
      'roles each allows.',
      `One output feeds many inputs. ${compat.fanIn.many} input ports take more than one cable, `
        + `${compat.fanIn.one} take one.`, '',
      '| From | To | Connects | Refusal |', '|---|---|---|---|',
      ...compat.rows.map((r) => `| ${r.from} ${r.fromRole} | ${r.to} ${r.toRole} | `
        + `${r.allowed ? 'yes' : 'no'} | ${r.allowed ? '' : r.reason} |`), ''] : []),
    '## Node types with missing fields',
    '',
    worst.length ? '| Node type | Ports | Parameters | Missing fields |\n|---|---:|---:|---:|\n'
      + worst.map((r) => `| \`${r.type}\` | ${r.ports} | ${r.params} | ${r.missing} |`)
        .join('\n') : 'None.',
    '',
  ].join('\n');
}

async function main(argv) {
  const known = new Set(['--write', '--check']);
  if (argv.some((a) => !known.has(a))) {
    process.stderr.write('usage: node scripts/patch-contract.mjs [--write | --check]\n');
    return 2;
  }
  const { NODE_REGISTRY } = await import(new URL('../src/js/studio/registry.js',
    import.meta.url));
  const ports = await import(new URL('../src/js/studio/ports.js', import.meta.url));
  const m = contractMatrix(NODE_REGISTRY);
  const compat = compatibilityMatrix(ports, NODE_REGISTRY);
  const table = contractTable(m, compat);
  const file = `${ROOT}${TABLE}`;
  if (argv.includes('--write')) {
    writeFileSync(file, table);
    process.stdout.write(`patch-contract: wrote ${TABLE}\n`);
    return 0;
  }
  if (argv.includes('--check')) {
    let now = '';
    try { now = readFileSync(file, 'utf8'); } catch { /* absent: stale */ }
    if (now === table) {
      process.stdout.write(`patch-contract: ${TABLE} is current\n`);
      return 0;
    }
    process.stderr.write(`patch-contract: ${TABLE} is stale; run node scripts/patch-contract.mjs `
      + '--write\n');
    return 1;
  }
  process.stderr.write(`patch-contract: ${m.types} node types, ${m.ports} ports, ${m.params} `
    + `parameters, ${compat.rows.length} type pairs\n`);
  process.stdout.write(`${JSON.stringify({ ...m, counts: missingCounts(m), compat }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
