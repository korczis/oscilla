#!/usr/bin/env node
// Visual regression gate: the deterministic --play scene (scripts/visual-compare.mjs) at the
// reference viewport (1536x1024) in Playwright's Chromium, judged against the ACCEPTED values in
// tests/visual/baseline.json. Fails closed: a missing baseline for this environment, a different
// Chromium build, a page error, a missing panel or any threshold breach exits 1.
//
//   node scripts/visual-gate.mjs [target] [--out <dir>]
//   node scripts/visual-gate.mjs [target] --update-baseline [--runs 3] [--out <dir>]
//
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// --out   artifacts (default tests/visual/out-gate): current.png, reference.png, diff.png,
//         side-by-side.png, report.json (the raw comparison) and gate.json (the verdict).
// --update-baseline  deliberately re-accept this environment's values: runs the scene --runs
//         times (default 3), refuses if the chrome (data hosts excluded) is not reproducible,
//         measures the run-to-run variance of every region and writes the accepted values and
//         tolerances for this environment into baseline.json (other environments are kept).
//
// Rules per region (mismatch = % of the region's pixels that differ from reference.png):
//   geometry   every panel's DOM box within +-geometryPx of its reference box (regions.json)
//   chrome     mismatch with the data hosts excluded <= accepted + chromePp
//   data       mismatch including the data hosts    <= accepted + that region's dataPp, which is
//              the measured run-to-run pixel variance + chromePp, rounded up to 0.5 pp (the
//              phase plot moves 3-3.5 % between runs, so it gets 4 pp)
//   controls   every control's DOM box within +-geometryPx of its accepted box
//   total      full frame, with and without data hosts, <= accepted + totalPp
//
// The environment key is <platform>-<arch> (CI runs the visual job in the Playwright container
// image pinned to the lockfile's version, linux-x64); system-ui renders differently per OS, so
// every environment carries its own accepted values.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, REGIONS_FILE } from './visual-compare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(ROOT, 'tests/visual/baseline.json');
const requireHere = createRequire(import.meta.url);
const { PNG } = requireHere('pngjs');
const pixelmatchMod = requireHere('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const DEFAULT_TOLERANCE = { chromePp: 0.5, totalPp: 0.5, geometryPx: 2 };
// --update-baseline refuses when the chrome is not reproducible between runs (it measured 0.00
// in every region): a moving chrome would make baseline + 0.5 pp meaningless.
const MAX_CHROME_RUN_VARIANCE_PP = 0.25;

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--')
  && !['--out', '--runs'].includes(args[i - 1]));
const TARGET = positional[0] || 'dist';
const OUT = path.resolve(option('--out') || path.join(ROOT, 'tests/visual/out-gate'));
const UPDATE = args.includes('--update-baseline');
const RUNS = Math.max(2, Number(option('--runs') || 3));
const ENV = `${process.platform}-${process.arch}`;

const ceilHalf = (v) => Math.ceil(v * 2 - 1e-9) / 2;
const round2 = (v) => +v.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return { schema: 1, environments: {} };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

/** Pixel-diff two captures and return the per-region % of differing pixels. */
function runToRun(fileA, fileB, regions) {
  const a = PNG.sync.read(readFileSync(fileA));
  const b = PNG.sync.read(readFileSync(fileB));
  const { width: W, height: H } = a;
  const diff = new PNG({ width: W, height: H });
  pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.12, includeAA: false, diffMask: true });
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    const [x, y, w, h] = r.box;
    let n = 0;
    for (let yy = y; yy < Math.min(H, y + h); yy++) {
      for (let xx = x; xx < Math.min(W, x + w); xx++) if (diff.data[(yy * W + xx) * 4 + 3] > 0) n++;
    }
    out[name] = 100 * n / (w * h);
  }
  return out;
}

async function updateBaseline() {
  const cfg = JSON.parse(readFileSync(REGIONS_FILE, 'utf8'));
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    const dir = path.join(OUT, `run-${i}`);
    const { report } = await compare({ target: TARGET, out: dir, play: true, quiet: true });
    if (report.errors.length) {
      throw new Error(`run ${i}: page errors, refusing to accept:\n  ${report.errors.join('\n  ')}`);
    }
    runs.push({ report, png: path.join(dir, 'current.png') });
    console.log(`run ${i}/${RUNS}: total ${report.total} %, chrome ${report.totalExclData} %`);
  }
  const versions = new Set(runs.map((r) => r.report.browser.version));
  if (versions.size !== 1) throw new Error(`browser version changed between runs: ${[...versions]}`);

  // Worst run-to-run pixel variance per region over every pair of runs.
  const variance = Object.fromEntries(Object.keys(cfg.regions).map((n) => [n, 0]));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const v = runToRun(runs[i].png, runs[j].png, cfg.regions);
      for (const n of Object.keys(v)) variance[n] = Math.max(variance[n], v[n]);
    }
  }

  const base = readBaseline();
  const tol = { ...DEFAULT_TOLERANCE, ...(base.tolerance || {}) };
  const regions = {};
  const unstable = [];
  for (const name of Object.keys(cfg.regions)) {
    const rs = runs.map((r) => r.report.regions[name]);
    if (rs.some((r) => !r.dom || !r.dom[2] || !r.dom[3])) throw new Error(`${name}: panel missing`);
    const chrome = rs.map((r) => r.mismatchExclData);
    const chromeSpread = Math.max(...chrome) - Math.min(...chrome);
    if (chromeSpread > MAX_CHROME_RUN_VARIANCE_PP) unstable.push(`${name} chrome ${chrome.join(' / ')}`);
    const geom = Math.max(...rs.map((r) => r.maxAbsDelta));
    if (geom > tol.geometryPx) {
      throw new Error(`${name}: DOM box ${geom} px from the reference box (limit `
        + `${tol.geometryPx}); fix the layout before accepting a baseline`);
    }
    regions[name] = {
      mismatch: Math.max(...rs.map((r) => r.mismatch)),
      mismatchExclData: Math.max(...chrome),
      runToRunPct: round2(variance[name]),
      dataPp: Math.max(tol.chromePp, ceilHalf(variance[name] + tol.chromePp)),
    };
  }
  if (unstable.length) {
    throw new Error(`chrome is not reproducible between runs, refusing to accept:\n  `
      + unstable.join('\n  '));
  }
  const controls = {};
  for (const name of Object.keys(runs[0].report.controls)) {
    const boxes = runs.map((r) => r.report.controls[name].dom);
    if (boxes.some((b) => !b)) throw new Error(`control ${name}: missing`);
    const spread = Math.max(...boxes[0].map((_, k) => Math.max(...boxes.map((b) => b[k]))
      - Math.min(...boxes.map((b) => b[k]))));
    if (spread > 0.5) throw new Error(`control ${name}: box moves between runs (${spread} px)`);
    controls[name] = boxes[0].map((v) => round2(v));
  }
  const first = runs[0].report;
  base.schema = 1;
  base.note = 'Accepted visual values per environment, written only by '
    + 'node scripts/visual-gate.mjs --update-baseline. Percentages are pixels that differ from '
    + 'tests/visual/reference.png (pixelmatch threshold 0.12). See scripts/visual-gate.mjs.';
  base.tolerance = tol;
  base.environments = base.environments || {};
  base.environments[ENV] = {
    browser: first.browser,
    viewport: first.viewport,
    runs: RUNS,
    total: Math.max(...runs.map((r) => r.report.total)),
    totalExclData: Math.max(...runs.map((r) => r.report.totalExclData)),
    regions,
    controls,
  };
  base.environments = Object.fromEntries(Object.entries(base.environments).sort());
  writeFileSync(BASELINE_FILE, `${JSON.stringify(base, null, 2)}\n`);
  console.log(`accepted ${ENV} (${first.browser.name} ${first.browser.version}, ${RUNS} runs) `
    + `-> ${path.relative(ROOT, BASELINE_FILE)}`);
  for (const [n, r] of Object.entries(regions)) {
    console.log(`  ${pad(n, 12)} data ${lpad(r.mismatch, 6)} % (+${r.dataPp})  chrome `
      + `${lpad(r.mismatchExclData, 6)} % (+${tol.chromePp})  run-to-run ${r.runToRunPct} %`);
  }
}

async function gate() {
  const base = readBaseline();
  const tol = { ...DEFAULT_TOLERANCE, ...(base.tolerance || {}) };
  const accepted = base.environments && base.environments[ENV];
  const failures = [];
  const { report } = await compare({ target: TARGET, out: OUT, play: true, quiet: true });
  copyFileSync(path.join(path.dirname(REGIONS_FILE), 'reference.png'), path.join(OUT, 'reference.png'));

  if (!accepted) {
    failures.push(`no accepted baseline for ${ENV} in ${path.relative(ROOT, BASELINE_FILE)} `
      + `(have: ${Object.keys(base.environments || {}).join(', ') || 'none'}); record one `
      + 'deliberately with --update-baseline');
  } else if (accepted.browser.version !== report.browser.version) {
    failures.push(`baseline for ${ENV} was accepted with chromium ${accepted.browser.version}, `
      + `this run is ${report.browser.version}; re-accept with --update-baseline`);
  }
  for (const e of report.errors) failures.push(`page: ${e}`);

  const rows = [];
  for (const [name, r] of Object.entries(report.regions)) {
    const a = accepted && accepted.regions[name];
    const row = { name, geom: r.maxAbsDelta, data: r.mismatch, chrome: r.mismatchExclData, bad: [] };
    if (!r.dom || !r.dom[2] || !r.dom[3]) row.bad.push('missing');
    else if (r.maxAbsDelta > tol.geometryPx) row.bad.push(`geometry ${r.delta.join(',')}`);
    if (a) {
      row.chromeLimit = round2(a.mismatchExclData + tol.chromePp);
      row.dataLimit = round2(a.mismatch + a.dataPp);
      if (r.mismatchExclData > row.chromeLimit) row.bad.push('chrome');
      if (r.mismatch > row.dataLimit) row.bad.push('data');
    } else if (accepted) row.bad.push('not in baseline');
    rows.push(row);
    if (row.bad.length) failures.push(`${name}: ${row.bad.join(', ')}`);
  }
  const ctlBad = [];
  if (accepted) {
    for (const [name, box] of Object.entries(accepted.controls)) {
      const dom = report.controls[name] && report.controls[name].dom;
      if (!dom) {
        ctlBad.push(`${name} missing`);
        continue;
      }
      const d = dom.map((v, k) => Math.round(v - box[k]));
      if (Math.max(...d.map(Math.abs)) > tol.geometryPx) ctlBad.push(`${name} moved ${d.join(',')}`);
    }
    for (const c of ctlBad) failures.push(`control ${c}`);
  }
  const totals = [
    ['total', report.total, accepted && round2(accepted.total + tol.totalPp)],
    ['total excl. data', report.totalExclData,
      accepted && round2(accepted.totalExclData + tol.totalPp)],
  ];
  for (const [n, v, lim] of totals) if (lim != null && v > lim) failures.push(`${n}: ${v} % > ${lim} %`);

  const lines = [];
  lines.push(`visual gate ${ENV} chromium ${report.browser.version} ${report.viewport.width}x`
    + `${report.viewport.height} --play  (${report.url})`);
  lines.push(`${pad('region', 12)} ${lpad('geomΔ', 6)} ${lpad('chrome %', 9)} ${lpad('limit', 7)}`
    + ` ${lpad('data %', 8)} ${lpad('limit', 7)}  verdict`);
  for (const r of rows) {
    lines.push(`${pad(r.name, 12)} ${lpad(r.geom ?? '-', 6)} ${lpad(r.chrome, 9)} `
      + `${lpad(r.chromeLimit ?? '-', 7)} ${lpad(r.data, 8)} ${lpad(r.dataLimit ?? '-', 7)}  `
      + `${r.bad.length ? `FAIL ${r.bad.join(', ')}` : 'ok'}`);
  }
  for (const [n, v, lim] of totals) {
    lines.push(`${pad(n, 19)} ${lpad(v, 9)} % limit ${lim ?? '-'} %  ${lim != null && v > lim
      ? 'FAIL' : 'ok'}`);
  }
  lines.push(`controls: ${accepted ? Object.keys(accepted.controls).length : 0} checked within `
    + `+-${tol.geometryPx} px${ctlBad.length ? `, FAIL: ${ctlBad.join('; ')}` : ', ok'}`);
  const verdict = { env: ENV, pass: failures.length === 0, failures, rows, totals, report: 'report.json' };
  writeFileSync(path.join(OUT, 'gate.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  lines.push('');
  if (failures.length) {
    lines.push(`FAIL visual gate: ${failures.length} problem(s); artifacts in ${OUT}`);
    for (const f of failures) lines.push(`   x ${f}`);
  } else {
    lines.push(`PASS visual gate (${rows.length} regions, controls, totals)`);
  }
  console.log(lines.join('\n'));
  return failures.length === 0;
}

(UPDATE ? updateBaseline().then(() => true) : gate())
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error(`FAIL visual gate: ${e.message || e}`);
    process.exit(1);
  });
