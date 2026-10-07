// The startup and large-library budgets stay true to the code and to their measurements
// (ledger P2 "no startup budget or large-library fixture"; docs/v4/performance.md):
//   - tests/browser/fixtures/perf-sessions.json holds the single samples of every recorded
//     session of the suite; perf-budgets.json's measurements are what those sessions give (the
//     median, fastest and slowest of the medians of n >= 5 measuring sessions), and every budget
//     is the file's own rule applied to its measurement, with a factor of 1.5 to 3. What this
//     does not hold: that the recorded samples are what a browser measured; they are the
//     suite's --json output reduced by fixtures/perf-sessions.mjs, and only a new session can
//     check them
//   - every generated table of the doc (measurements, session medians, pooled samples, load,
//     store reads, selection, asserting sessions, rule, budgets) is what the recorded sessions
//     give, and its fixture counts equal fixtures/large-library.mjs LIBRARY
//   - "interactive" is one User Timing mark: main.js sets `oscilla:ready` once, directly before
//     html[data-ready], the suite reads that name, and the committed dist carries it once
//   - `npm run test:perf` runs the suite; release-gate, verify and the workflows do not
//   - the suite refuses an --only name that is not a check (a misspelt selection ran nothing
//     but no-console-errors and printed PASS)
//   - every selector, element id and field of the Experiments state the suite reads is in
//     src/ (nothing runs the suite automatically, so nothing else would notice a rename)
//   node --test tests/unit/v4-performance-docs.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY } from '../browser/fixtures/large-library.mjs';
import { BROWSERS, FACTOR_RANGE, KEYS, budgetFileOf, compactJson, docRegions, measuredOf,
  region, ruled } from '../browser/fixtures/perf-sessions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => {
  assert.ok(existsSync(path.join(ROOT, rel)), `${rel} exists`);
  return readFileSync(path.join(ROOT, rel), 'utf8');
};
const budgetFile = () => JSON.parse(read('tests/browser/fixtures/perf-budgets.json'));
const sessionsFile = () => JSON.parse(read('tests/browser/fixtures/perf-sessions.json'));
const PKG = JSON.parse(read('package.json'));
const SUITE = 'tests/browser/perf-budgets.cjs';
const MARK = 'oscilla:ready';
const MIN_SESSIONS = 5;
const SAMPLES = { startup: 7, startupLibrary: 7, experimentsList: 5, experimentDetail: 5,
  compare: 5 };
const CHECK_NAMES = ['ready-mark', 'startup', 'library-seed', 'startup-library',
  'experiments-list', 'experiment-detail', 'compare', 'no-console-errors'];

test('the recorded sessions hold the samples of every measurement and browser', () => {
  const file = sessionsFile();
  assert.equal(file.unit, 'ms');
  assert.ok(file.machine && file.machine.cpu && file.machine.playwright, 'the machine is named');
  assert.equal(read('tests/browser/fixtures/perf-sessions.json'), compactJson(file),
    'the file is in the form perf-sessions.mjs writes');
  const all = [...file.measured.map((s, i) => [`measured ${i + 1}`, s]),
    ...file.asserting.map((s) => [`asserting ${s.head}`, s])];
  for (const [label, s] of all) {
    assert.deepEqual(Object.keys(s.samples), KEYS, label);
    for (const k of KEYS) {
      assert.deepEqual(Object.keys(s.samples[k]), BROWSERS, `${label} ${k}`);
      for (const b of BROWSERS) {
        const xs = s.samples[k][b];
        assert.equal(xs.length, SAMPLES[k], `${label} ${k}.${b}: samples`);
        assert.ok(xs.every((x) => Number.isFinite(x) && x > 0), `${label} ${k}.${b}: positive`);
      }
    }
    for (const extra of ['select', 'storeGet', 'rawGet', 'seedMs', 'readyGap']) {
      assert.deepEqual(Object.keys(s[extra]), BROWSERS, `${label} ${extra}`);
    }
  }
  assert.ok(file.measured.every((s) => s.measureOnly === true && !('head' in s)),
    'the budgets come from --measure-only sessions');
  assert.ok(file.asserting.every((s) => s.measureOnly === false && /^[0-9a-f]{7,40}$/.test(s.head)),
    'an asserting session judged the budgets and names its commit');
});

/** Why `file` is not the budget file the recorded `sessions` give; [] when it is. */
function budgetProblems(file, sessions) {
  const problems = [];
  const rule = file.rule || {};
  if (JSON.stringify(Object.keys(file)) !== JSON.stringify(['statistic', 'unit', 'rule',
    'measured', 'budgets']) || file.statistic !== 'median' || file.unit !== 'ms') {
    problems.push('shape');
  }
  if (!(rule.factor >= FACTOR_RANGE[0] && rule.factor <= FACTOR_RANGE[1])) {
    problems.push(`the margin is a factor of ${FACTOR_RANGE.join(' to ')}, not ${rule.factor}`);
  }
  if (!(Number.isInteger(rule.roundUpTo) && rule.roundUpTo > 0 && rule.roundUpTo <= 10)) {
    problems.push(`rounding adds at most 10 ms, not ${rule.roundUpTo}`);
  }
  if (sessions.measured.length < MIN_SESSIONS) {
    problems.push(`${sessions.measured.length} measuring sessions`);
  }
  const measured = measuredOf(sessions);
  for (const k of KEYS) {
    for (const b of BROWSERS) {
      const m = file.measured && file.measured[k] && file.measured[k][b];
      if (JSON.stringify(m) !== JSON.stringify(measured[k][b])) {
        problems.push(`measured ${k}.${b} is not what the sessions give`);
      } else if (file.budgets[k][b] !== ruled(rule, m)) {
        problems.push(`budget ${k}.${b} is not the rule applied to its measurement`);
      }
    }
  }
  return problems;
}

test('the budget file is what the recorded sessions and its rule give', () => {
  const file = budgetFile();
  assert.deepEqual(FACTOR_RANGE, [1.5, 3], 'the range is not widened with the factor');
  assert.deepEqual(budgetProblems(file, sessionsFile()), []);
  assert.deepEqual(file, budgetFileOf(sessionsFile(), file.rule));
});

test('a factor outside the range, or a measurement no session gives, is refused', () => {
  const sessions = sessionsFile();
  // A reviewer's mutation of the previous guard, which passed it: factor 50, budgets
  // regenerated by the rule.
  for (const factor of [50, 3.5, 1.2]) {
    const wide = budgetFileOf(sessions, { factor, roundUpTo: 10 });
    assert.deepEqual(budgetProblems(wide, sessions),
      [`the margin is a factor of 1.5 to 3, not ${factor}`]);
  }
  assert.deepEqual(budgetProblems(budgetFileOf(sessions, { factor: 3, roundUpTo: 10 }),
    sessions), []);
  // A measurement and its budget raised together.
  const edited = structuredClone(budgetFile());
  edited.measured.experimentsList.firefox.median += 500;
  edited.budgets.experimentsList.firefox = ruled(edited.rule, edited.measured.experimentsList
    .firefox);
  assert.deepEqual(budgetProblems(edited, sessions),
    ['measured experimentsList.firefox is not what the sessions give']);
  // A budget alone.
  const loose = structuredClone(budgetFile());
  loose.budgets.startup.chromium += 10;
  assert.deepEqual(budgetProblems(loose, sessions),
    ['budget startup.chromium is not the rule applied to its measurement']);
  // Fewer sessions than a median of sessions needs.
  const few = { ...sessions, measured: sessions.measured.slice(0, MIN_SESSIONS - 1) };
  assert.ok(budgetProblems(budgetFileOf(few, { factor: 2, roundUpTo: 10 }), few)
    .includes(`${MIN_SESSIONS - 1} measuring sessions`));
});

test('every generated table of the performance doc is what the recorded sessions give', () => {
  const doc = read('docs/v4/performance.md');
  const expected = docRegions(sessionsFile(), budgetFile());
  assert.deepEqual(Object.keys(expected), ['measured', 'sessions', 'samples', 'load', 'reads',
    'select', 'rule', 'budgets', 'asserting']);
  for (const [name, lines] of Object.entries(expected)) {
    assert.deepEqual(region(doc, name), lines, `region ${name}`);
  }
  // No table of numbers outside a generated region except the two that define terms.
  const outside = doc.replace(/<!-- (\w+):begin -->[\s\S]*?<!-- \1:end -->/g, '');
  const heads = outside.split('\n').filter((l, i, a) => l.startsWith('|')
    && !(a[i - 1] || '').startsWith('|'));
  assert.deepEqual(heads, ['| Measurement | From | To |'], 'hand-written tables');
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
  assert.ok(read(SUITE).includes(`const READY_MARK = '${MARK}';`), 'the suite reads that mark');
  assert.equal(read('dist/index.html').split(MARK).length - 1, 1, 'the committed dist marks once');
  assert.ok(read('docs/v4/performance.md').includes(`\`${MARK}\``), 'the doc names the mark');
});

test('npm run test:perf runs the suite; release-gate, verify and the workflows do not', () => {
  assert.equal(PKG.scripts['test:perf'], 'node tests/browser/perf-budgets.cjs');
  for (const s of ['release-gate', 'test:release', 'verify', 'test:browser']) {
    assert.ok(!/perf/.test(PKG.scripts[s]), `${s} does not run the budgets`);
  }
  const dir = path.join(ROOT, '.github', 'workflows');
  const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(workflows.includes('ci.yml'), 'the CI workflow is read');
  for (const f of workflows) {
    assert.ok(!/test:perf|perf-budgets/.test(readFileSync(path.join(dir, f), 'utf8')),
      `.github/workflows/${f} does not run the budgets`);
  }
  const doc = read('docs/v4/performance.md');
  assert.ok(/^## Why the suite is not in the release gate$/m.test(doc),
    'the decision is recorded');
  const readme = read('tests/README.md');
  for (const row of ['`browser/perf-budgets.cjs`', '`browser/fixtures/perf-sessions.json`',
    '`browser/fixtures/perf-sessions.mjs`', '`browser/fixtures/perf-dom.json`']) {
    assert.ok(readme.includes(`| ${row} |`), `tests/README row ${row}`);
  }
  assert.ok(!/pooled median/.test(readme), 'the budget file holds session medians, not a pool');
});

test('the suite refuses an --only name that is not a check, before any browser', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, SUITE),
    '--browsers', 'chromium', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000,
    // Were the name accepted, the suite would go on to its load gate: one that cannot pass
    // and gives up at once keeps this test from ever launching a browser.
    env: { ...process.env, OSC_LOAD_MAX: '0.000001', OSC_LOAD_WAIT_MS: '1', CI: '',
      GITHUB_ACTIONS: '' } });
  for (const args of [['--only', 'bogus'], ['--only', 'ready-mark,experiment-details'],
    ['--only']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--only: (unknown check\(s\)|no check named)/, args.join(' '));
    for (const name of CHECK_NAMES) assert.ok(r.stderr.includes(name), `names ${name}`);
    assert.doesNotMatch(r.stdout, /PASS/, 'nothing passed');
  }
  // A known name gets past the selection (and stops at the load gate this test closed).
  const known = run('--only', 'ready-mark');
  assert.notEqual(known.status, 2, known.stderr);
  assert.match(`${known.stdout}${known.stderr}`, /load gate/);
});

test('every selector, id and state field the suite reads exists in src/', () => {
  const dom = JSON.parse(read('tests/browser/fixtures/perf-dom.json'));
  const suite = read(SUITE);
  const html = read('src/index.html');
  const experiments = read('src/js/ui/experiments.js');
  assert.equal(dom.attribute, 'data-osc');
  assert.ok(Object.keys(dom.osc).length >= 7 && Object.keys(dom.ids).length >= 5);
  for (const [name, value] of Object.entries(dom.osc)) {
    assert.ok(html.includes(`${dom.attribute}="${value}"`), `src/index.html has ${value}`);
    assert.ok(suite.includes(`sel('${name}')`), `the suite uses selector ${name}`);
  }
  for (const [name, id] of Object.entries(dom.ids)) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `src/index.html has one #${id}`);
    assert.ok(new RegExp(`\\bids\\.${name}\\b`).test(suite), `the suite uses id ${name}`);
  }
  // The table is the only place the suite names an element: a literal elsewhere would be a
  // selector this test does not see.
  assert.doesNotMatch(suite, /data-osc|['"`\\#]osc-[a-z]/, 'no selector or id literal');
  assert.doesNotMatch(suite, /\bsel\((?!name\b)(?!'[A-Za-z]+'\))/, 'sel() takes a literal name');
  const used = new Set([...suite.matchAll(/\bexps\.([A-Za-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), [...dom.state].sort(), 'the state fields the suite reads');
  for (const field of dom.state) {
    assert.ok(new RegExp(`\\bexps\\.${field}\\b`).test(experiments),
      `src/js/ui/experiments.js has exps.${field}`);
  }
});
