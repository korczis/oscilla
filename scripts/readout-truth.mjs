#!/usr/bin/env node
// The readout truth table (T026, P05 audit): every value the interface shows has a row in
// docs/v3/readout-truth.yaml that states what it is (quantity and unit), where it comes from
// (source paths and algorithm), how fine and how calibrated it is, its limitations, the tests
// that pin it and its evidence label, and every defect it still carries names a plan issue.
//
//   node scripts/readout-truth.mjs           # write docs/v3/readout-truth.md from the YAML
//   node scripts/readout-truth.mjs --check   # exit 1 when the table or the Markdown is wrong
//
// The check is part of `npm test`, and so of `npm run verify`: the unit test
// tests/unit/readout-provenance.test.mjs calls this file with --check, holds the same contract
// on the tree and proves it on mutated fixtures. (package.json is not edited for it: it is a
// build input of dist/index.html, and a script entry there would restamp the artifact.)
//
// A readout is a start tag of src/index.html or of an .html file under src/partials (comments
// removed) with a static data-osc value that shows a value: it binds x-text or
// :aria-valuetext, or carries role="meter", role="img" or aria-live. A control that shows no
// value of its own is not a readout: a button, link, select, option or textarea, an element
// with a control role (button, link, radio, tab, checkbox, switch, menuitem, option), and an
// input without an aria-valuetext. Its key is the data-osc value (one key for every element
// that shares it). A declared chart is a data-osc-chart value; its key is `chart:<id>`.
//
// Keys that have no row yet are listed in tests/unit/readout-provenance-baseline.json; that
// list equals the undescribed keys of the tree and only shrinks (the unit test checks it
// against the file's git history).
//
// What it does not decide: that a row's prose is true. The rows are quoted from the P05 audit
// and its fixtures; the reviewer reads them against the code and the named tests.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-subset.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TABLE_REL = 'docs/v3/readout-truth.yaml';
export const MARKDOWN_REL = 'docs/v3/readout-truth.md';
export const BASELINE_REL = 'tests/unit/readout-provenance-baseline.json';
export const SCHEMA = 'readout-truth/v1';

/** The evidence labels of the P05 audit (MASTER Step 6); nothing else is a label. */
export const LABELS = Object.freeze(['VERIFIED', 'DERIVED', 'INFERRED', 'PROPOSED', 'UNKNOWN',
  'BLOCKED']);

/** The text fields every row states, in the order the Markdown shows them. */
export const TEXT_FIELDS = Object.freeze(['readout', 'quantity', 'unit', 'algorithm',
  'resolution', 'calibration', 'limitations']);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
const CONTROL_TAGS = new Set(['button', 'a', 'select', 'option', 'textarea']);
const CONTROL_ROLE = /\srole="(?:button|link|radio|tab|checkbox|switch|menuitem|option)"/;

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/** Why a start tag is a readout, or null: ['x-text', 'valuetext', 'meter', 'img', 'live']. */
export function readoutReasons(tag, name) {
  const why = [];
  if (/\sx-text=/.test(tag)) why.push('x-text');
  if (/\s:?aria-valuetext=/.test(tag)) why.push('valuetext');
  if (/\srole="meter"/.test(tag)) why.push('meter');
  if (/\srole="img"/.test(tag)) why.push('img');
  if (/\saria-live=/.test(tag)) why.push('live');
  if (!why.length) return null;
  const lower = name.toLowerCase();
  if (CONTROL_TAGS.has(lower) || CONTROL_ROLE.test(tag)) return null;
  if (lower === 'input' && !why.includes('valuetext')) return null;
  return why;
}

/** The readout and chart keys of one HTML text: [{ key, line, why }], one entry per key. */
export function readoutsOf(html) {
  const text = String(html).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const out = new Map();
  const add = (key, index, why) => {
    if (!out.has(key)) out.set(key, { key, line: text.slice(0, index).split('\n').length, why });
  };
  for (const m of text.matchAll(START_TAG)) {
    const tag = m[0];
    const chart = attr(tag, 'data-osc-chart');
    if (chart) add(`chart:${chart}`, m.index, ['chart']);
    const osc = attr(tag, 'data-osc');
    if (!osc) continue;
    const why = readoutReasons(tag, m[1]);
    if (why) add(osc, m.index, why);
  }
  return [...out.values()];
}

/** The markup files readouts are enumerated from, relative to `root`, sorted. */
export function markupFiles(root = ROOT) {
  const files = ['src/index.html'];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.html')) files.push(child);
    }
  };
  walk('src/partials');
  return files.sort();
}

/** Every readout key of the tree under `root`, sorted, each once. */
export function treeKeys(root = ROOT) {
  const keys = new Set();
  for (const f of markupFiles(root)) {
    for (const r of readoutsOf(readFileSync(path.join(root, f), 'utf8'))) keys.add(r.key);
  }
  return [...keys].sort();
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The problems of a parsed table against the tree: an array of strings, empty when sound.
 * keys: the readout keys of the tree; baseline: the keys recorded as undescribed;
 * exists(rel): whether a repository path exists; issueExists(id): whether a plan issue does.
 */
export function problemsOf(table, { keys, baseline, exists, issueExists }) {
  const out = [];
  if (!table || typeof table !== 'object') return ['the table is not a mapping'];
  if (table.schema !== SCHEMA) out.push(`schema must be ${SCHEMA}`);
  const rows = Array.isArray(table.readouts) ? table.readouts : null;
  if (!rows) return [...out, 'readouts must be a list'];
  const tree = new Set(keys);
  const listed = new Set(baseline);
  const seen = new Set();
  for (const [i, row] of rows.entries()) {
    const where = row && nonEmpty(row.key) ? row.key : `row ${i + 1}`;
    if (!row || typeof row !== 'object' || !nonEmpty(row.key)) {
      out.push(`${where}: no key`);
      continue;
    }
    if (seen.has(row.key)) out.push(`${where}: described twice`);
    seen.add(row.key);
    if (!tree.has(row.key)) out.push(`${where}: no such readout in the markup (row is stale)`);
    if (listed.has(row.key)) out.push(`${where}: described and still listed in ${BASELINE_REL}`);
    for (const f of TEXT_FIELDS) if (!nonEmpty(row[f])) out.push(`${where}: ${f} is missing`);
    if (!LABELS.includes(row.label)) {
      out.push(`${where}: label ${JSON.stringify(row.label)} is not one of ${LABELS.join(', ')}`);
    }
    if (!Array.isArray(row.source) || !row.source.length) out.push(`${where}: source is missing`);
    for (const p of Array.isArray(row.source) ? row.source : []) {
      if (!nonEmpty(p) || !exists(p)) out.push(`${where}: source path ${p} does not exist`);
    }
    if (!Array.isArray(row.tests)) out.push(`${where}: tests must be a list`);
    else if (!row.tests.length && !nonEmpty(row.untested)) {
      out.push(`${where}: no tests and no untested reason`);
    }
    for (const p of Array.isArray(row.tests) ? row.tests : []) {
      if (!nonEmpty(p) || !exists(p)) out.push(`${where}: test path ${p} does not exist`);
    }
    const defects = row.defects === undefined ? [] : row.defects;
    if (!Array.isArray(defects)) out.push(`${where}: defects must be a list`);
    for (const d of Array.isArray(defects) ? defects : []) {
      const id = d && d.issue;
      if (!nonEmpty(id) || !/^[A-Z]+[0-9]+$/.test(id) || !issueExists(id)) {
        out.push(`${where}: defect ${JSON.stringify(id)} names no plan issue`);
      }
      if (!d || !nonEmpty(d.summary)) out.push(`${where}: defect ${id} has no summary`);
    }
  }
  for (const k of keys) {
    if (!seen.has(k) && !listed.has(k)) {
      out.push(`${k}: a readout with no row and not in ${BASELINE_REL}`);
    }
  }
  for (const k of baseline) {
    if (!tree.has(k)) out.push(`${k}: listed in ${BASELINE_REL} but no longer a readout`);
  }
  return out;
}

const cell = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
const code = (list) => list.map((p) => `\`${p}\``).join(', ');

/** The Markdown view of a parsed table: deterministic, rows sorted by key. */
export function renderMarkdown(table, baseline) {
  const rows = [...table.readouts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const lines = [
    '# Readout truth table',
    '',
    `Generated by \`scripts/readout-truth.mjs\` from \`${TABLE_REL}\`; do not edit by hand.`,
    `Regenerate with \`node scripts/readout-truth.mjs\`. ${rows.length} readouts are described,`,
    `${baseline.length} are not yet (\`${BASELINE_REL}\`, which only shrinks).`,
    '',
    `Labels: ${LABELS.join(', ')}.`,
    'A defect names the plan issue that fixes it.',
    '',
    '| Key | Readout | Quantity · unit | Source → algorithm | Resolution · calibration '
      + '| Limitations | Tests | Label | Defects |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const tests = r.tests.length ? code(r.tests) : `none: ${r.untested}`;
    const defects = (r.defects || []).map((d) => `${d.issue}: ${d.summary}`).join('; ') || 'none';
    lines.push(`| \`${cell(r.key)}\` | ${cell(r.readout)} | ${cell(r.quantity)} · ${cell(r.unit)} `
      + `| ${code(r.source)} → ${cell(r.algorithm)} | ${cell(r.resolution)} · `
      + `${cell(r.calibration)} | ${cell(r.limitations)} | ${cell(tests)} | ${r.label} `
      + `| ${cell(defects)} |`);
  }
  lines.push('', '## Not yet described', '');
  lines.push(baseline.length ? baseline.map((k) => `\`${k}\``).join(', ') : 'none');
  lines.push('');
  return lines.join('\n');
}

/** Read the table, baseline and tree under `root`; returns { table, baseline, keys, problems }. */
export function load(root = ROOT) {
  const table = parseYaml(readFileSync(path.join(root, TABLE_REL), 'utf8'));
  const base = JSON.parse(readFileSync(path.join(root, BASELINE_REL), 'utf8'));
  const baseline = Array.isArray(base.undescribed) ? base.undescribed : [];
  const keys = treeKeys(root);
  const problems = problemsOf(table, {
    keys, baseline,
    exists: (rel) => existsSync(path.join(root, rel)),
    issueExists: (id) => existsSync(path.join(root, '.ai/repo/project/issues', `${id}.yaml`)),
  });
  return { table, baseline, keys, problems };
}

function main(argv) {
  const check = argv.includes('--check');
  const { table, baseline, problems } = load();
  if (problems.length) {
    console.error(`readout-truth: ${problems.length} problem(s) in ${TABLE_REL}:`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  const md = renderMarkdown(table, baseline);
  const target = path.join(ROOT, MARKDOWN_REL);
  if (check) {
    const now = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (now !== md) {
      console.error(`readout-truth: ${MARKDOWN_REL} is stale; run node scripts/readout-truth.mjs`);
      return 1;
    }
    console.log(`readout-truth: ${table.readouts.length} described, ${baseline.length} listed`);
    return 0;
  }
  writeFileSync(target, md);
  console.log(`readout-truth: wrote ${MARKDOWN_REL} (${table.readouts.length} rows)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
