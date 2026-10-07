// The startup and large-library budgets stay true to the code and to their measurements
// (ledger P2 "no startup budget or large-library fixture"; docs/v4/performance.md):
//   - tests/browser/fixtures/perf-budgets.json is the one copy: per measurement and browser the
//     pooled measurement (median, min, max, n >= 5) and the budget, and every budget is what the
//     file's own rule gives for its measurement (no budget is a number somebody liked)
//   - the doc's measurement and budget tables equal that file, and its fixture counts equal
//     fixtures/large-library.mjs LIBRARY
//   - "interactive" is one User Timing mark: main.js sets `oscilla:ready` once, directly before
//     html[data-ready], the suite reads that name, and the committed dist carries it once
//   - `npm run test:perf` runs the suite, and release-gate does not (the doc says why)
//   node --test tests/unit/v4-performance-docs.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY } from '../browser/fixtures/large-library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => {
  assert.ok(existsSync(path.join(ROOT, rel)), `${rel} exists`);
  return readFileSync(path.join(ROOT, rel), 'utf8');
};
const budgetFile = () => JSON.parse(read('tests/browser/fixtures/perf-budgets.json'));
const PKG = JSON.parse(read('package.json'));
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const KEYS = ['startup', 'startupLibrary', 'experimentsList', 'experimentDetail', 'compare'];
const MARK = 'oscilla:ready';
const MIN_SAMPLES = 5;

/** The lines between <!-- name:begin --> and <!-- name:end --> (trimmed, non-empty). */
function region(text, name) {
  const m = text.match(new RegExp(`<!-- ${name}:begin -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
  assert.ok(m, `region ${name}`);
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The file's rule: the larger of factor x median and the slowest sample, rounded up. */
function ruled(rule, measured) {
  return Math.ceil(Math.max(rule.factor * measured.median, measured.max) / rule.roundUpTo)
    * rule.roundUpTo;
}

test('the budget file holds a measurement and a budget per measurement and browser', () => {
  const file = budgetFile();
  assert.equal(file.statistic, 'median');
  assert.equal(file.unit, 'ms');
  assert.deepEqual(Object.keys(file.rule), ['factor', 'roundUpTo']);
  assert.ok(file.rule.factor >= 1.5, 'the margin is stated and is not a rubber stamp');
  assert.ok(Number.isInteger(file.rule.roundUpTo) && file.rule.roundUpTo > 0);
  assert.deepEqual(Object.keys(file.measured), KEYS);
  assert.deepEqual(Object.keys(file.budgets), KEYS);
  for (const k of KEYS) {
    assert.deepEqual(Object.keys(file.measured[k]), BROWSERS, `measured ${k}`);
    assert.deepEqual(Object.keys(file.budgets[k]), BROWSERS, `budgets ${k}`);
    for (const b of BROWSERS) {
      const m = file.measured[k][b];
      assert.deepEqual(Object.keys(m), ['median', 'min', 'max', 'n'], `${k}.${b}`);
      assert.ok(m.n >= MIN_SAMPLES, `${k}.${b}: ${m.n} samples`);
      assert.ok(m.min > 0 && m.min <= m.median && m.median <= m.max, `${k}.${b} is ordered`);
    }
  }
});

test('every budget is the rule applied to its measurement', () => {
  const file = budgetFile();
  for (const k of KEYS) {
    for (const b of BROWSERS) {
      assert.equal(file.budgets[k][b], ruled(file.rule, file.measured[k][b]), `${k}.${b}`);
    }
  }
});

test('the performance doc states the measurements and the budgets of the budget file', () => {
  const file = budgetFile();
  const doc = read('docs/v4/performance.md');
  const measured = region(doc, 'measured');
  assert.deepEqual(measured.slice(0, 2), ['| Measurement | Browser | Median (ms) | Min (ms) '
    + '| Max (ms) | Samples |', '| --- | --- | --- | --- | --- | --- |']);
  assert.deepEqual(measured.slice(2), KEYS.flatMap((k) => BROWSERS.map((b) => {
    const m = file.measured[k][b];
    return `| ${k} | ${b} | ${m.median} | ${m.min} | ${m.max} | ${m.n} |`;
  })));
  const budgets = region(doc, 'budgets');
  assert.deepEqual(budgets.slice(0, 2), ['| Measurement (median) | Chromium (ms) | Firefox (ms) '
    + '| WebKit (ms) |', '| --- | --- | --- | --- |']);
  assert.deepEqual(budgets.slice(2), KEYS.map((k) => `| ${k} | ${BROWSERS.map((b) => file
    .budgets[k][b]).join(' | ')} |`));
  assert.deepEqual(region(doc, 'rule'), [`budget = the larger of ${file.rule.factor} x the `
    + `measured median and the slowest sample, rounded up to ${file.rule.roundUpTo} ms`]);
});

test('the performance doc states the fixture the suite builds', () => {
  assert.deepEqual(region(read('docs/v4/performance.md'), 'library'), [
    `${LIBRARY.experiments} experiments, ${LIBRARY.definitions} definitions, ${LIBRARY.studio} `
    + `Studio projects (${LIBRARY.recipes} recipes, ${LIBRARY.measurements} engine measurements)`]);
});

test('"interactive" is one mark: main.js sets it once, directly before html[data-ready]', () => {
  const main = read('src/js/main.js');
  assert.equal(main.split(`performance.mark('${MARK}')`).length - 1, 1, 'one mark call');
  const lines = main.split('\n');
  const at = lines.findIndex((l) => l.includes(`performance.mark('${MARK}')`));
  assert.ok(lines[at + 1].includes("document.documentElement.dataset.ready = 'true'"),
    'the mark and the ready attribute are set together');
  assert.ok(read('tests/browser/perf-budgets.cjs').includes(`const READY_MARK = '${MARK}';`),
    'the suite reads that mark');
  assert.equal(read('dist/index.html').split(MARK).length - 1, 1, 'the committed dist marks once');
  assert.ok(read('docs/v4/performance.md').includes(`\`${MARK}\``), 'the doc names the mark');
});

test('npm run test:perf runs the suite; release-gate does not (docs/v4/performance.md)', () => {
  assert.equal(PKG.scripts['test:perf'], 'node tests/browser/perf-budgets.cjs');
  for (const s of ['release-gate', 'test:release', 'verify', 'test:browser']) {
    assert.ok(!/perf/.test(PKG.scripts[s]), `${s} does not run the budgets`);
  }
  const doc = read('docs/v4/performance.md');
  assert.ok(/^## Why the suite is not in the release gate$/m.test(doc),
    'the decision is recorded');
  assert.ok(read('tests/README.md').includes('`browser/perf-budgets.cjs`'), 'tests/README row');
});
