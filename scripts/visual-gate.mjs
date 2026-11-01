#!/usr/bin/env node
// Visual regression gate: the deterministic --play scene (scripts/visual-compare.mjs) at the
// reference viewport (1536x1024) in Playwright's Chromium, judged against the ACCEPTED values in
// tests/visual/baseline.json. The scene is the first screen (the Playground of Q004 option A,
// plan P002); its regions and their boxes are tests/visual/regions.json. Fails closed: a missing baseline for this environment, a different
// Chromium build, a page error, a missing panel or any threshold breach exits 1.
//
//   node scripts/visual-gate.mjs [target] [--out <dir>]
//   node scripts/visual-gate.mjs [target] --update-baseline [--runs 3] [--out <dir>]
//                                [--accept-rise "<reason>"]
//   node scripts/visual-gate.mjs --help
//
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// --out   artifacts (default tests/visual/out-gate): current.png, reference.png, diff.png,
//         side-by-side.png, report.json (the raw comparison) and gate.json (the verdict).
// --update-baseline  deliberately re-accept this environment's values: runs the scene --runs
//         times (default 3), refuses if the chrome (data hosts excluded) is not reproducible,
//         measures the run-to-run variance of every region and writes the accepted values and
//         tolerances for this environment into baseline.json (other environments are kept).
// Re-acceptance bound (K056): --update-baseline refuses a region whose accepted mismatch rises,
//         in this one acceptance, by more than RISE_BOUND_PP (2 pp) beyond the runToRunPct
//         stored in the baseline being replaced, never the variance this run measures, so a
//         change cannot widen its own allowance by making a region noisier. A region absent
//         from the baseline being replaced has no accepted value to rise from and is refused
//         too. Each acceptance stores the sha256 of tests/visual/reference.png it was measured
//         against; a regeneration of that file (F011) resets every region's mismatch, in
//         either direction, so a digest different from the stored one is refused as well. A
//         browser bump beyond the bound, a regenerated reference and a redesign pass only with
//         --accept-rise "<reason>", which records { region, rise, reason, date } under the
//         environment's acceptedRises (region 'reference.png' with rise null, from and to for a
//         regeneration); an empty reason is refused (exit 2). An environment with no earlier
//         acceptance is not bounded here. Across a branch, tests/unit/visual-gate-bound.test.mjs
//         judges the committed baseline.json against the merge base's with branchBound, so
//         repeated acceptances on one branch cannot add up past the bound unrecorded.
//
// Rules per region (mismatch = % of the region's pixels that differ from reference.png):
//   geometry   every panel's DOM box within +-geometryPx of its reference box (regions.json)
//   chrome     mismatch with the data hosts excluded <= accepted + chromePp
//   data       mismatch including the data hosts    <= accepted + that region's dataPp, which is
//              the measured run-to-run pixel variance + chromePp, rounded up to 0.5 pp (a
//              plot that moves 3-3.5 % between runs, as the V2 reference's phase plot did,
//              gets 4 pp)
//   controls   every control's DOM box within +-geometryPx of its accepted box
//   total      full frame, with and without data hosts, <= accepted + totalPp
//
// The environment key is <platform>-<arch> (CI runs the visual job in the Playwright container
// image pinned to the lockfile's version, linux-x64); system-ui renders differently per OS, so
// every environment carries its own accepted values.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(ROOT, 'tests/visual/baseline.json');
const requireHere = createRequire(import.meta.url);

const DEFAULT_TOLERANCE = { chromePp: 0.5, totalPp: 0.5, geometryPx: 2 };
// --update-baseline refuses when the chrome is not reproducible between runs (it measured 0.00
// in every region): a moving chrome would make baseline + 0.5 pp meaningless.
const MAX_CHROME_RUN_VARIANCE_PP = 0.25;
/** How far, beyond its stored run-to-run variance, a region's accepted mismatch may rise. */
export const RISE_BOUND_PP = 2;
/** The region name of a reference.png regeneration in refusals and acceptedRises. */
export const REFERENCE_REGION = 'reference.png';
/** baseline.json's note, rewritten by every acceptance. */
export const BASELINE_NOTE = 'Accepted visual values per environment, written only by '
  + 'node scripts/visual-gate.mjs --update-baseline. Percentages are pixels that differ from '
  + 'tests/visual/reference.png (pixelmatch threshold 0.12), whose sha256 each environment '
  + "stores as reference. A re-acceptance may raise a region's mismatch by at most its stored "
  + `runToRunPct + ${RISE_BOUND_PP} pp; acceptedRises records each rise accepted beyond that, `
  + 'and each regeneration of the reference, with --accept-rise and its reason. See '
  + 'scripts/visual-gate.mjs.';

const USAGE = `usage: node scripts/visual-gate.mjs [target] [--out <dir>]
       node scripts/visual-gate.mjs [target] --update-baseline [--runs N] [--out <dir>]
                                    [--accept-rise "<reason>"]
       node scripts/visual-gate.mjs --help`;

class UsageError extends Error {}

/**
 * Parse the command line. Pure: throws UsageError (exit 2) on a bad flag, a flag without its
 * value or an empty --accept-rise reason; --accept-rise is valid only with --update-baseline.
 */
export function parseArgs(argv) {
  const valued = ['--out', '--runs', '--accept-rise'];
  const known = [...valued, '--update-baseline', '--help'];
  const opts = { target: 'dist', out: undefined, update: false, runs: 3, acceptRise: undefined,
    help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    if (!known.includes(a)) throw new UsageError(`unknown flag ${a}`);
    if (valued.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        throw new UsageError(a === '--accept-rise'
          ? '--accept-rise needs a reason: --accept-rise "<reason>"' : `${a} needs a value`);
      }
      i++;
      if (a === '--out') opts.out = v;
      else if (a === '--runs') {
        const n = Number(v);
        if (!Number.isInteger(n)) throw new UsageError(`--runs needs a whole number, got ${v}`);
        opts.runs = Math.max(2, n);
      }
      else opts.acceptRise = v;
    } else if (a === '--update-baseline') opts.update = true;
    else opts.help = true;
  }
  if (opts.acceptRise !== undefined && !opts.acceptRise.trim()) {
    throw new UsageError('--accept-rise needs a non-empty reason');
  }
  if (opts.acceptRise !== undefined && !opts.update) {
    throw new UsageError('--accept-rise applies only to --update-baseline');
  }
  if (positional[0]) opts.target = positional[0];
  return opts;
}

const ceilHalf = (v) => Math.ceil(v * 2 - 1e-9) / 2;
const round2 = (v) => +v.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/** A file's sha256 as 'sha256:<hex>'. */
export function fileDigest(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

/**
 * The re-acceptance bound: the regions of `next` (the values this acceptance would write,
 * { name: { mismatch, ... } }) whose accepted mismatch rises beyond the allowance of the
 * baseline being replaced (`prev`, that environment's block of baseline.json, or undefined).
 * The allowance is prev's stored runToRunPct (0 when not stored) + boundPp; any runToRunPct in
 * `next` is ignored. A region absent from prev is returned with kind 'new' and its whole
 * mismatch as the rise. `reference` (this run's reference.png digest) different from prev's
 * stored one is returned first, kind 'reference'; a prev without a stored digest cannot be
 * compared. No prev environment: nothing to rise from, nothing returned.
 */
export function acceptanceBound(prev, next, { boundPp = RISE_BOUND_PP, reference } = {}) {
  if (!prev || !prev.regions) return [];
  const out = [];
  if (reference && prev.reference && reference !== prev.reference) {
    out.push({ region: REFERENCE_REGION, kind: 'reference', from: prev.reference, to: reference,
      rise: null, runToRunPct: null, allowance: null });
  }
  for (const [region, n] of Object.entries(next)) {
    const p = prev.regions[region];
    if (!p) {
      out.push({ region, kind: 'new', from: null, to: n.mismatch, rise: round2(n.mismatch),
        runToRunPct: null, allowance: null });
      continue;
    }
    const stored = Number.isFinite(p.runToRunPct) ? p.runToRunPct : 0;
    const allowance = round2(stored + boundPp);
    const rise = round2(n.mismatch - p.mismatch);
    if (rise > allowance) {
      out.push({ region, kind: 'rise', from: p.mismatch, to: n.mismatch, rise,
        runToRunPct: stored, allowance });
    }
  }
  return out;
}

/**
 * Judge one acceptance: refused unless every region is within the bound, or `acceptRise` gives
 * a reason, in which case each region beyond the bound becomes a record { region, rise, reason,
 * date } (`date` an ISO day, taken from the run by the caller). An empty reason is refused
 * whether or not anything rose.
 */
export function judgeAcceptance(prev, next,
  { acceptRise, date, boundPp = RISE_BOUND_PP, reference } = {}) {
  if (acceptRise !== undefined && (typeof acceptRise !== 'string' || !acceptRise.trim())) {
    return { pass: false, refused: [], records: [],
      error: '--accept-rise needs a non-empty reason' };
  }
  const refused = acceptanceBound(prev, next, { boundPp, reference });
  if (!refused.length) return { pass: true, refused, records: [] };
  if (acceptRise === undefined) {
    return { pass: false, refused, records: [], error: formatRefused(refused) };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return { pass: false, refused, records: [],
      error: `accept-rise date ${date} is not an ISO day` };
  }
  const reason = acceptRise.trim();
  return { pass: true, refused,
    records: refused.map((r) => (r.kind === 'reference'
      ? { region: r.region, rise: null, reason, date, from: r.from, to: r.to }
      : { region: r.region, rise: r.rise, reason, date })) };
}

/** The acceptedRises an environment carries after this acceptance: prev's, then the new. */
export function nextAcceptedRises(prev, records) {
  return [...((prev && prev.acceptedRises) || []), ...records];
}

/** One refused entry as a line of the refusal message. */
function refusedLine(r) {
  if (r.kind === 'new') {
    return `${r.region}: not in the baseline being replaced (mismatch ${r.to} %)`;
  }
  if (r.kind === 'reference') {
    return `${r.region}: regenerated (${r.from} -> ${r.to}), every region's mismatch is reset`;
  }
  return `${r.region}: ${r.from} % -> ${r.to} %, rise ${r.rise} pp > allowance ${r.allowance} pp `
    + `(run-to-run ${r.runToRunPct} + ${RISE_BOUND_PP})`;
}

/** The refusal message: every region beyond the bound, with its rise and allowance. */
export function formatRefused(refused) {
  return 'accepted mismatch rises beyond the re-acceptance bound (stored run-to-run variance '
    + `+ ${RISE_BOUND_PP} pp), refusing to accept; a deliberate change passes with `
    + '--accept-rise "<reason>":\n  ' + refused.map(refusedLine).join('\n  ');
}

/**
 * One acceptance as data: `base` (baseline.json's content, not mutated) with environment `env`
 * replaced by `block` ({ browser, viewport, runs, total, totalExclData, regions, controls }),
 * the `reference` digest it was measured against and its acceptedRises (the earlier ones, then
 * this acceptance's records). Returns judgeAcceptance's verdict and, when it passes, the
 * `baseline` to write; a refused acceptance has `baseline` null.
 */
export function acceptEnvironment(base, env, block, { acceptRise, date, reference, tol } = {}) {
  const prev = base.environments && base.environments[env];
  const judged = judgeAcceptance(prev, block.regions, { acceptRise, date, reference });
  if (!judged.pass) return { ...judged, baseline: null };
  const acceptedRises = nextAcceptedRises(prev, judged.records);
  const environments = { ...(base.environments || {}) };
  environments[env] = {
    browser: block.browser,
    viewport: block.viewport,
    ...(reference ? { reference } : {}),
    runs: block.runs,
    total: block.total,
    totalExclData: block.totalExclData,
    regions: block.regions,
    controls: block.controls,
    ...(acceptedRises.length ? { acceptedRises } : {}),
  };
  const baseline = { ...base, schema: 1, note: BASELINE_NOTE,
    tolerance: tol || base.tolerance || DEFAULT_TOLERANCE,
    environments: Object.fromEntries(Object.entries(environments).sort()) };
  return { ...judged, baseline };
}

/**
 * The bound across a whole branch, so that repeated acceptances cannot add up past it: every
 * environment of `head` (the branch's baseline.json) judged against the same environment of
 * `base` (the merge base's) with acceptanceBound. Each region beyond the bound, and a
 * reference.png the branch changed (`referenceChanged`) in an environment whose block it
 * changed, must be covered by an acceptedRises record for that region which the branch added;
 * every record of `base` must still be there. An environment new on the branch is not judged.
 * Returns the uncovered entries, each with its `env` (empty: the branch is within the bound).
 */
export function branchBound(base, head,
  { referenceChanged = false, boundPp = RISE_BOUND_PP } = {}) {
  const out = [];
  const baseEnvs = (base && base.environments) || {};
  const headEnvs = (head && head.environments) || {};
  let reaccepted = false;
  for (const [env, h] of Object.entries(headEnvs)) {
    const b = baseEnvs[env];
    if (!b) continue;
    const key = (r) => JSON.stringify(r);
    const before = (b.acceptedRises || []).map(key);
    const after = (h.acceptedRises || []).map(key);
    for (const k of before) {
      if (!after.includes(k)) {
        out.push({ env, region: JSON.parse(k).region, kind: 'dropped-record' });
      }
    }
    const added = (h.acceptedRises || []).filter((r) => !before.includes(key(r))
      && typeof r.reason === 'string' && r.reason.trim());
    const covered = (region) => added.some((r) => r.region === region);
    const refused = acceptanceBound(b, h.regions || {}, { boundPp });
    const changed = key(b) !== key(h);
    reaccepted = reaccepted || changed;
    if (referenceChanged && changed) {
      refused.unshift({ region: REFERENCE_REGION, kind: 'reference', rise: null });
    }
    for (const r of refused) if (!covered(r.region)) out.push({ env, ...r });
  }
  if (referenceChanged && !reaccepted) {
    out.push({ env: null, region: REFERENCE_REGION, kind: 'reference', rise: null });
  }
  return out;
}

function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return { schema: 1, environments: {} };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

/** Pixel-diff two captures and return the per-region % of differing pixels. */
function runToRun(fileA, fileB, regions) {
  const { PNG } = requireHere('pngjs');
  const pixelmatchMod = requireHere('pixelmatch');
  const pixelmatch = pixelmatchMod.default || pixelmatchMod;
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

async function updateBaseline({ TARGET, OUT, RUNS, ENV, acceptRise }) {
  const { compare, REGIONS_FILE } = await import('./visual-compare.mjs');
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
  const accepted = acceptEnvironment(base, ENV, {
    browser: first.browser,
    viewport: first.viewport,
    runs: RUNS,
    total: Math.max(...runs.map((r) => r.report.total)),
    totalExclData: Math.max(...runs.map((r) => r.report.totalExclData)),
    regions,
    controls,
  }, { acceptRise, date: new Date().toISOString().slice(0, 10), tol,
    reference: fileDigest(path.resolve(path.dirname(REGIONS_FILE), cfg.reference)) });
  if (!accepted.pass) throw new Error(accepted.error);
  writeFileSync(BASELINE_FILE, `${JSON.stringify(accepted.baseline, null, 2)}\n`);
  console.log(`accepted ${ENV} (${first.browser.name} ${first.browser.version}, ${RUNS} runs) `
    + `-> ${path.relative(ROOT, BASELINE_FILE)}`);
  for (const [n, r] of Object.entries(regions)) {
    console.log(`  ${pad(n, 12)} data ${lpad(r.mismatch, 6)} % (+${r.dataPp})  chrome `
      + `${lpad(r.mismatchExclData, 6)} % (+${tol.chromePp})  run-to-run ${r.runToRunPct} %`);
  }
  for (const r of accepted.records) {
    console.log(`  accepted ${r.rise === null ? `${r.region} regeneration` : `rise ${r.region} `
      + `+${r.rise} pp`} (${r.date}): ${r.reason}`);
  }
}

async function gate({ TARGET, OUT, ENV }) {
  const { compare, REGIONS_FILE } = await import('./visual-compare.mjs');
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
      + `this run is ${report.browser.version}; re-accept with --update-baseline (a rise beyond `
      + 'the re-acceptance bound needs --accept-rise "<reason>")');
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

// Real paths on both sides: started through a symlink (macOS /tmp, a symlinked checkout) the
// gate must still know it is the program run, or it would do nothing and exit 0.
const isMain = Boolean(process.argv[1]) && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`visual gate: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const run = {
    TARGET: opts.target,
    OUT: path.resolve(opts.out || path.join(ROOT, 'tests/visual/out-gate')),
    RUNS: opts.runs,
    ENV: `${process.platform}-${process.arch}`,
    acceptRise: opts.acceptRise,
  };
  (opts.update ? updateBaseline(run).then(() => true) : gate(run))
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error(`FAIL visual gate: ${e.message || e}`);
      process.exit(1);
    });
}
