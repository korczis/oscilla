#!/usr/bin/env node
// MEASURE visual reference: the MEASURE workspace of the built app at 1536x1024 (and the
// guided-first phone layout at 390x844) in Playwright's Chromium, showing a deterministic
// TEST CONTEXT experiment (tests/browser/fixtures/v3-experiments.mjs: the real engine on a
// synthetic io, fixed clock and seeds) through the real import and "Show in Measure" path. The
// screenshot is compared pixel by pixel with the accepted reference of this environment.
//
//   node scripts/visual-measure.mjs [target] [--out <dir>]
//   node scripts/visual-measure.mjs [target] --update-reference
//
// target: 'dist' (default) -> dist/index.html; any other path or http(s) URL as is.
// Fails closed: a missing reference for this environment (<platform>-<arch>), a page error, a
// different Chromium build or more than MAX_MISMATCH_PCT differing pixels exits 1. References
// live in tests/visual/measure/ with their browser version; re-accept them deliberately with
// --update-reference (the CI environment, linux-x64, through the Playwright container like the
// main visual gate: see tests/README.md). The page says TEST CONTEXT on the result and in the
// experiment name: the reference never shows synthetic data as a measurement.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);
const { chromium } = requireHere('playwright');
const { PNG } = requireHere('pngjs');
const pixelmatchMod = requireHere('pixelmatch');
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const REF_DIR = path.join(ROOT, 'tests/visual/measure');
const META_FILE = path.join(REF_DIR, 'references.json');
const ENV = `${process.platform}-${process.arch}`;
// Pixels that may differ from the accepted reference (anti-aliasing of text and curves).
const MAX_MISMATCH_PCT = 0.5;
const VIEWS = [
  { id: 'desktop', width: 1536, height: 1024 },
  { id: 'phone', width: 390, height: 844 },
];

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const TARGET = positional[0] || 'dist';
const OUT = path.resolve(option('--out') || path.join(ROOT, 'tests/visual/out-measure'));
const UPDATE = args.includes('--update-reference');

function targetUrl(t) {
  if (/^https?:\/\//.test(t)) return t;
  const file = t === 'dist' ? path.join(ROOT, 'dist/index.html') : path.resolve(t);
  return pathToFileURL(file).href;
}

async function capture(browser, view, fixture) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(targetUrl(TARGET));
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  const id = await page.evaluate((json) => window.OSCILLA.app.experimentsImportText(json),
    fixture.json);
  if (!id) throw new Error('the fixture experiment was not imported');
  await page.evaluate(async (eid) => {
    const a = window.OSCILLA.app;
    await a.experimentsShowInMeasure(eid);
    a.measureSetTab('response');
    if (!a.safetyCollapsed) a.collapseSafety();
    a.alerts = [];
    if (document.activeElement) document.activeElement.blur();
    document.querySelector('.osc-main').scrollTop = 0;
  }, id);
  await page.waitForSelector('#osc-measure-chart-response .uplot', { timeout: 10000 });
  // Two frames for the chart rebuild after the layout settled (no animation runs here).
  await page.evaluate(() => new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
  }));
  await page.mouse.move(0, view.height - 1);
  const file = path.join(OUT, `current-${view.id}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, errors };
}

function compare(currentFile, referenceFile, diffFile) {
  const a = PNG.sync.read(readFileSync(currentFile));
  const b = PNG.sync.read(readFileSync(referenceFile));
  if (a.width !== b.width || a.height !== b.height) {
    return { pct: 100, note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height,
    { threshold: 0.12, includeAA: false });
  writeFileSync(diffFile, PNG.sync.write(diff));
  return { pct: +(100 * n / (a.width * a.height)).toFixed(3) };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { buildFixtures } = await import(pathToFileURL(path.join(ROOT,
    'tests/browser/fixtures/v3-experiments.mjs')).href);
  const { a } = await buildFixtures();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const version = browser.version();
  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8'))
    : { schema: 1, environments: {} };
  const failures = [];
  const lines = [`MEASURE visual reference ${ENV} chromium ${version}`];
  try {
    for (const view of VIEWS) {
      const { file, errors } = await capture(browser, view, a);
      for (const e of errors) failures.push(`${view.id}: page error ${e}`);
      const ref = path.join(REF_DIR, `${ENV}-${view.id}.png`);
      if (UPDATE) {
        if (errors.length) throw new Error(`page errors, refusing to accept: ${errors.join('; ')}`);
        mkdirSync(REF_DIR, { recursive: true });
        writeFileSync(ref, readFileSync(file));
        lines.push(`  ${view.id}: accepted -> ${path.relative(ROOT, ref)}`);
        continue;
      }
      const accepted = meta.environments[ENV];
      if (!accepted || !existsSync(ref)) {
        failures.push(`${view.id}: no accepted reference for ${ENV} (record one deliberately with `
          + '--update-reference)');
        continue;
      }
      if (accepted.browser !== version) {
        failures.push(`${view.id}: reference accepted with chromium ${accepted.browser}, this run `
          + `is ${version}; re-accept with --update-reference`);
      }
      const r = compare(file, ref, path.join(OUT, `diff-${view.id}.png`));
      const bad = r.pct > MAX_MISMATCH_PCT;
      if (bad) failures.push(`${view.id}: ${r.pct} % of pixels differ (limit ${MAX_MISMATCH_PCT} %)`
        + `${r.note ? `, ${r.note}` : ''}`);
      lines.push(`  ${view.id.padEnd(8)} ${String(r.pct).padStart(7)} % differ  `
        + `${bad ? 'FAIL' : 'ok'}`);
    }
  } finally {
    await browser.close();
  }
  if (UPDATE) {
    meta.schema = 1;
    meta.note = 'Accepted MEASURE references per environment, written only by '
      + 'node scripts/visual-measure.mjs --update-reference.';
    meta.environments = { ...meta.environments, [ENV]: { browser: version,
      views: VIEWS.map((v) => `${v.width}x${v.height}`) } };
    meta.environments = Object.fromEntries(Object.entries(meta.environments).sort());
    writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
  }
  writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify({ env: ENV, version, failures },
    null, 2)}\n`);
  lines.push(failures.length ? `FAIL MEASURE visual reference: ${failures.length} problem(s); `
    + `artifacts in ${OUT}` : `PASS MEASURE visual reference (${VIEWS.length} views)`);
  for (const f of failures) lines.push(`   x ${f}`);
  console.log(lines.join('\n'));
  return failures.length === 0;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
  console.error(`FAIL MEASURE visual reference: ${e.message || e}`);
  process.exit(1);
});
