#!/usr/bin/env node
// The recorded sessions of tests/browser/perf-budgets.cjs and everything derived from them:
// the measurements and budgets of perf-budgets.json and the tables of docs/v4/performance.md.
// perf-sessions.json holds the single samples of every session; nothing published is typed in
// by hand, and tests/unit/v4-performance-docs.test.mjs recomputes all of it with this module.
//
//   node tests/browser/fixtures/perf-sessions.mjs [--new] [--measured s1.json s2.json ...]
//        [--asserting <head> a.json]...
//
//   --measured   --json outputs of `perf-budgets.cjs --measure-only`, appended in the order
//                given: the sessions the budgets are derived from
//   --asserting  the --json output of an asserting session (`npm run test:perf`) and the
//                commit it ran on: recorded beside the measurements, not part of the rule
//   --new        forget the recorded sessions first (budgets for a changed product or machine)
// Without arguments it rewrites perf-budgets.json and the doc's tables from what is recorded.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
export const SESSIONS_FILE = path.join(HERE, 'perf-sessions.json');
export const BUDGETS_FILE = path.join(HERE, 'perf-budgets.json');
export const DOC_FILE = path.join(ROOT, 'docs', 'v4', 'performance.md');

export const BROWSERS = ['chromium', 'firefox', 'webkit'];
/** Budget key -> the suite's check that measures it. */
export const CHECKS = { startup: 'startup', startupLibrary: 'startup-library',
  experimentsList: 'experiments-list', experimentDetail: 'experiment-detail',
  compare: 'compare' };
export const KEYS = Object.keys(CHECKS);
/** The margin is a factor in this range: below it a budget is noise, above it it holds nothing. */
export const FACTOR_RANGE = [1.5, 3];
const MACHINE_KEYS = ['platform', 'arch', 'cpus', 'cpu', 'node', 'playwright'];

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const round = (x) => Math.round(x * 10) / 10;
const spread = (xs) => ({ median: round(median(xs)), min: round(Math.min(...xs)),
  max: round(Math.max(...xs)), n: xs.length });
const perBrowser = (fn) => Object.fromEntries(BROWSERS.map((b) => [b, fn(b)]));

/** One --json output of the suite, reduced to what is published from it. */
export function reduceSession(raw, extra = {}) {
  const result = (b, check) => {
    const r = raw.results && raw.results[b] && raw.results[b][check];
    if (!r) throw new Error(`the session has no ${b} ${check}`);
    return r;
  };
  const samples = (b, check, pick = (r) => r) => {
    const s = pick(result(b, check));
    if (!s || !Array.isArray(s.samples) || !s.samples.length) {
      throw new Error(`the session has no samples of ${b} ${check}`);
    }
    return s.samples.map(round);
  };
  const leg = (b) => (raw.legs && raw.legs[b]
    ? { start: raw.legs[b].loadStart, end: raw.legs[b].loadEnd } : null);
  return {
    ...extra,
    measureOnly: raw.measureOnly === true,
    load: { start: raw.machine.loadavgStart[0], end: raw.machine.loadavgEnd[0] },
    legs: raw.legs ? perBrowser(leg) : null,
    samples: Object.fromEntries(KEYS.map((k) => [k, perBrowser((b) => samples(b, CHECKS[k]))])),
    select: perBrowser((b) => samples(b, 'compare', (r) => r.select)),
    storeGet: perBrowser((b) => samples(b, 'experiment-detail', (r) => r.storeGet)),
    rawGet: perBrowser((b) => samples(b, 'experiment-detail', (r) => r.rawGet)),
    seedMs: perBrowser((b) => result(b, 'library-seed').seedMs),
    readyGap: perBrowser((b) => round(result(b, 'ready-mark').facts.gap)),
  };
}

export const machineOf = (raw) => Object.fromEntries(MACHINE_KEYS.map((k) => [k, raw.machine[k]]));

/** A session's result for a measurement: the median of its samples. */
export const sessionMedian = (session, key, browser) => round(median(session.samples[key][browser]));

/** `measured` of perf-budgets.json: over the session medians of the measuring sessions. */
export function measuredOf(sessions) {
  return Object.fromEntries(KEYS.map((k) => [k, perBrowser((b) => spread(sessions.measured
    .map((s) => sessionMedian(s, k, b))))]));
}

/** The rule: factor x the median of the session medians, rounded up. */
export const ruled = (rule, measured) => Math.ceil((rule.factor * measured.median)
  / rule.roundUpTo) * rule.roundUpTo;

export function budgetsOf(rule, measured) {
  return Object.fromEntries(KEYS.map((k) => [k, perBrowser((b) => ruled(rule, measured[k][b]))]));
}

/** perf-budgets.json as the recorded sessions and the rule give it. */
export function budgetFileOf(sessions, rule) {
  const measured = measuredOf(sessions);
  return { statistic: 'median', unit: 'ms', rule, measured, budgets: budgetsOf(rule, measured) };
}

const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`)];
const range = (s) => `${s.median} (${s.min}-${s.max})`;
const legLoad = (l) => (l ? `${l.start} -> ${l.end}` : 'not recorded');

/** Every generated region of docs/v4/performance.md: name -> lines. */
export function docRegions(sessions, budgetFile) {
  const m = sessions.measured;
  const pooled = (pick) => spread(m.flatMap(pick));
  const each = (fn) => KEYS.flatMap((k) => BROWSERS.map((b) => fn(k, b)));
  return {
    measured: table(['Measurement', 'Browser', 'Median (ms)', 'Fastest (ms)', 'Slowest (ms)',
      'Sessions'], each((k, b) => {
      const x = budgetFile.measured[k][b];
      return [k, b, x.median, x.min, x.max, x.n];
    })),
    sessions: table(['Measurement', 'Browser', ...m.map((s, i) => i + 1)],
      each((k, b) => [k, b, ...m.map((s) => sessionMedian(s, k, b))])),
    samples: table(['Measurement', 'Browser', 'Median', 'Min', 'Max', 'Samples'],
      each((k, b) => {
        const x = pooled((s) => s.samples[k][b]);
        return [k, b, x.median, x.min, x.max, x.n];
      })),
    load: table(['Session', '1-minute load at start', 'at end', 'Chromium leg', 'Firefox leg',
      'WebKit leg'], m.map((s, i) => [i + 1, s.load.start, s.load.end,
      ...BROWSERS.map((b) => legLoad(s.legs && s.legs[b]))])),
    reads: table(['Browser', 'store `get()` median (min-max), ms',
      'bare IndexedDB read median (min-max), ms', 'Samples'], BROWSERS.map((b) => {
      const store = pooled((s) => s.storeGet[b]);
      return [b, range(store), range(pooled((s) => s.rawGet[b])), store.n];
    })),
    select: table(['Browser', 'click on a row\'s checkbox, median (min-max), ms', 'Samples'],
      BROWSERS.map((b) => {
        const x = pooled((s) => s.select[b]);
        return [b, range(x), x.n];
      })),
    rule: [`budget = ${budgetFile.rule.factor} x the median of the session medians, rounded up `
      + `to ${budgetFile.rule.roundUpTo} ms`],
    budgets: table(['Measurement (median)', 'Chromium (ms)', 'Firefox (ms)', 'WebKit (ms)'],
      KEYS.map((k) => [k, ...BROWSERS.map((b) => budgetFile.budgets[k][b])])),
    asserting: table(['Commit', 'Browser', 'Leg load', ...KEYS.map((k) => `${k} (% of budget)`)],
      sessions.asserting.flatMap((s) => BROWSERS.map((b) => [`\`${s.head}\``, b,
        legLoad(s.legs && s.legs[b]), ...KEYS.map((k) => {
          const x = sessionMedian(s, k, b);
          return `${x} (${Math.round((100 * x) / budgetFile.budgets[k][b])} %)`;
        })]))),
  };
}

/** The lines between <!-- name:begin --> and <!-- name:end --> (trimmed, non-empty). */
export function region(text, name) {
  const m = text.match(new RegExp(`<!-- ${name}:begin -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
  if (!m) throw new Error(`docs/v4/performance.md has no region ${name}`);
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

/** JSON with every array of numbers on one line. */
export const compactJson = (value) => `${JSON.stringify(value, null, 2)
  .replace(/\[\n\s+(-?[\d.e+-]+(?:,\n\s+-?[\d.e+-]+)*)\n\s+\]/g,
    (all, body) => `[${body.split(/,\n\s+/).join(', ')}]`)}\n`;

function main(argv) {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  if (argv.includes('--new')) {
    sessions.measured = [];
    sessions.asserting = [];
  }
  const load = (file) => JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  const same = (raw, file) => {
    const machine = machineOf(raw);
    if (!sessions.measured.length && !sessions.asserting.length) sessions.machine = machine;
    if (JSON.stringify(machine) !== JSON.stringify(sessions.machine)) {
      throw new Error(`${file} is of another machine or toolchain: ${JSON.stringify(machine)}`);
    }
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--measured') {
      for (i += 1; i < argv.length && !argv[i].startsWith('--'); i++) {
        const raw = load(argv[i]);
        if (raw.measureOnly !== true) throw new Error(`${argv[i]} is not a --measure-only session`);
        same(raw, argv[i]);
        sessions.measured.push(reduceSession(raw));
      }
      i -= 1;
    } else if (argv[i] === '--asserting') {
      const [head, file] = [argv[i + 1], argv[i + 2]];
      if (!head || !file) throw new Error('--asserting <head> <file>');
      const raw = load(file);
      same(raw, file);
      sessions.asserting.push(reduceSession(raw, { head }));
      i += 2;
    } else if (argv[i] !== '--new') {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  const { rule } = JSON.parse(readFileSync(BUDGETS_FILE, 'utf8'));
  const budgetFile = budgetFileOf(sessions, rule);
  writeFileSync(SESSIONS_FILE, compactJson(sessions));
  writeFileSync(BUDGETS_FILE, `${JSON.stringify(budgetFile, null, 2)}\n`);
  let doc = readFileSync(DOC_FILE, 'utf8');
  for (const [name, lines] of Object.entries(docRegions(sessions, budgetFile))) {
    region(doc, name);
    doc = doc.replace(new RegExp(`(<!-- ${name}:begin -->\\n)[\\s\\S]*?(\\n<!-- ${name}:end -->)`),
      (all, a, b) => `${a}${lines.join('\n')}${b}`);
  }
  writeFileSync(DOC_FILE, doc);
  console.log(`${sessions.measured.length} measuring and ${sessions.asserting.length} asserting `
    + 'sessions: perf-sessions.json, perf-budgets.json and docs/v4/performance.md written');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
}
